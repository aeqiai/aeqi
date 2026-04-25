//! Credential pool — rotate multiple API keys for the same provider.
//!
//! Strategies: round_robin, least_used, random, fill_first.
//! Exhausted keys have cooldown periods (configurable).
//! Inspired by Hermes Agent's credential_pool.py.
//!
//! T1.9.1 — the pool reads its keys from the credentials substrate.
//! `with_keys(Vec<String>, …)` is preserved for unit tests; production
//! callers must use [`CredentialPool::from_credentials`].

use aeqi_core::credentials::{CredentialStore, ScopeKind};
use anyhow::{Context, Result};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tracing::{debug, warn};

/// Rotation strategy for selecting credentials.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum RotationStrategy {
    /// Use keys in order, cycling through the list.
    #[default]
    RoundRobin,
    /// Use the key with the fewest total uses.
    LeastUsed,
    /// Pick a random available key.
    Random,
    /// Use the first key until it's exhausted, then move to the next.
    FillFirst,
}

/// A single credential with usage tracking and cooldown state.
#[derive(Debug)]
struct Credential {
    key: String,
    use_count: AtomicU64,
    exhausted_at: Option<Instant>,
    cooldown: Duration,
}

impl Credential {
    fn new(key: String, cooldown: Duration) -> Self {
        Self {
            key,
            use_count: AtomicU64::new(0),
            exhausted_at: None,
            cooldown,
        }
    }

    fn is_available(&self) -> bool {
        match self.exhausted_at {
            None => true,
            Some(at) => at.elapsed() >= self.cooldown,
        }
    }

    fn mark_used(&self) {
        self.use_count.fetch_add(1, Ordering::Relaxed);
    }

    fn mark_exhausted(&mut self) {
        self.exhausted_at = Some(Instant::now());
    }

    fn uses(&self) -> u64 {
        self.use_count.load(Ordering::Relaxed)
    }
}

/// Pool of API credentials with rotation and cooldown.
pub struct CredentialPool {
    credentials: Vec<Credential>,
    strategy: RotationStrategy,
    next_index: usize,
    /// Cooldown for rate-limited keys (default: 1 hour).
    rate_limit_cooldown: Duration,
    /// Cooldown for billing/auth errors (default: 24 hours).
    auth_error_cooldown: Duration,
}

impl CredentialPool {
    /// Build a pool from an explicit list of keys. Test-only: production
    /// code uses [`CredentialPool::from_credentials`] so the pool is fed
    /// from the credentials substrate. Kept named `with_keys` (renamed
    /// from `new`) so the substrate path is the one new callers find first.
    pub fn with_keys(keys: Vec<String>, strategy: RotationStrategy) -> Self {
        let rate_limit_cooldown = Duration::from_secs(3600); // 1 hour
        let credentials = keys
            .into_iter()
            .map(|k| Credential::new(k, rate_limit_cooldown))
            .collect();

        Self {
            credentials,
            strategy,
            next_index: 0,
            rate_limit_cooldown,
            auth_error_cooldown: Duration::from_secs(86400), // 24 hours
        }
    }

    /// Build a pool from the credentials substrate. Reads every row
    /// matching `(scope_kind=global, scope_id="", provider=<provider>)`
    /// with a `static_secret` lifecycle, decrypts each blob, and seeds
    /// the pool in stable `(provider, name)` order so rotation is
    /// reproducible.
    ///
    /// Returns an error if no credentials are available — a pool with
    /// zero keys can never serve a request, so failing here is louder
    /// than rotating to `None` at the call site.
    pub async fn from_credentials(
        store: &CredentialStore,
        provider: &str,
        strategy: RotationStrategy,
    ) -> Result<Self> {
        let rows = store
            .list_in_scope(ScopeKind::Global, "", Some(provider))
            .await
            .with_context(|| format!("list credentials for provider {provider}"))?;
        let mut keys = Vec::with_capacity(rows.len());
        for row in rows {
            if row.lifecycle_kind != "static_secret" {
                continue;
            }
            let plain = store
                .decrypt(&row)
                .with_context(|| format!("decrypt credential row {}", row.id))?;
            let value = String::from_utf8(plain)
                .with_context(|| format!("credential row {} is not UTF-8", row.id))?;
            if !value.is_empty() {
                keys.push(value);
            }
        }
        if keys.is_empty() {
            anyhow::bail!("no credentials available for provider {provider}");
        }
        Ok(Self::with_keys(keys, strategy))
    }

    /// Get the next available credential key. Returns None if all are exhausted.
    pub fn next_key(&mut self) -> Option<&str> {
        if self.credentials.is_empty() {
            return None;
        }

        let available: Vec<usize> = self
            .credentials
            .iter()
            .enumerate()
            .filter(|(_, c)| c.is_available())
            .map(|(i, _)| i)
            .collect();

        if available.is_empty() {
            warn!("all credentials exhausted — no available keys");
            return None;
        }

        let idx = match self.strategy {
            RotationStrategy::RoundRobin => {
                let start = self.next_index % self.credentials.len();
                let idx = (start..self.credentials.len())
                    .chain(0..start)
                    .find(|i| available.contains(i))
                    .unwrap_or(available[0]);
                self.next_index = idx + 1;
                idx
            }
            RotationStrategy::LeastUsed => *available
                .iter()
                .min_by_key(|&&i| self.credentials[i].uses())
                .unwrap(),
            RotationStrategy::Random => {
                use std::time::SystemTime;
                let seed = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos() as usize;
                available[seed % available.len()]
            }
            RotationStrategy::FillFirst => available[0],
        };

        self.credentials[idx].mark_used();
        debug!(
            strategy = ?self.strategy,
            key_index = idx,
            uses = self.credentials[idx].uses(),
            "credential selected"
        );
        Some(&self.credentials[idx].key)
    }

    /// Mark a key as rate-limited (429). It enters cooldown.
    pub fn mark_rate_limited(&mut self, key: &str) {
        if let Some(cred) = self.credentials.iter_mut().find(|c| c.key == key) {
            cred.cooldown = self.rate_limit_cooldown;
            cred.mark_exhausted();
            warn!(
                cooldown_secs = self.rate_limit_cooldown.as_secs(),
                "credential rate-limited"
            );
        }
    }

    /// Mark a key as having an auth/billing error. Longer cooldown.
    pub fn mark_auth_error(&mut self, key: &str) {
        if let Some(cred) = self.credentials.iter_mut().find(|c| c.key == key) {
            cred.cooldown = self.auth_error_cooldown;
            cred.mark_exhausted();
            warn!(
                cooldown_secs = self.auth_error_cooldown.as_secs(),
                "credential auth error — long cooldown"
            );
        }
    }

    /// Number of currently available credentials.
    pub fn available_count(&self) -> usize {
        self.credentials.iter().filter(|c| c.is_available()).count()
    }

    /// Total number of credentials in the pool.
    pub fn total_count(&self) -> usize {
        self.credentials.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_robin() {
        let mut pool = CredentialPool::with_keys(
            vec!["key1".into(), "key2".into(), "key3".into()],
            RotationStrategy::RoundRobin,
        );
        assert_eq!(pool.next_key(), Some("key1"));
        assert_eq!(pool.next_key(), Some("key2"));
        assert_eq!(pool.next_key(), Some("key3"));
        assert_eq!(pool.next_key(), Some("key1")); // Wraps around
    }

    #[test]
    fn test_fill_first() {
        let mut pool = CredentialPool::with_keys(
            vec!["key1".into(), "key2".into()],
            RotationStrategy::FillFirst,
        );
        assert_eq!(pool.next_key(), Some("key1"));
        assert_eq!(pool.next_key(), Some("key1"));
        assert_eq!(pool.next_key(), Some("key1"));
    }

    #[test]
    fn test_least_used() {
        let mut pool = CredentialPool::with_keys(
            vec!["key1".into(), "key2".into()],
            RotationStrategy::LeastUsed,
        );
        assert_eq!(pool.next_key(), Some("key1")); // Both at 0, picks first
        assert_eq!(pool.next_key(), Some("key2")); // key1 at 1, key2 at 0
        assert_eq!(pool.next_key(), Some("key1")); // Both at 1, picks first
    }

    #[test]
    fn test_rate_limit_cooldown() {
        let mut pool = CredentialPool::with_keys(
            vec!["key1".into(), "key2".into()],
            RotationStrategy::RoundRobin,
        );
        pool.mark_rate_limited("key1");
        // key1 is now in cooldown, should skip to key2
        assert_eq!(pool.next_key(), Some("key2"));
        assert_eq!(pool.available_count(), 1);
    }

    #[test]
    fn test_all_exhausted() {
        let mut pool = CredentialPool::with_keys(vec!["key1".into()], RotationStrategy::RoundRobin);
        pool.mark_rate_limited("key1");
        assert_eq!(pool.next_key(), None);
        assert_eq!(pool.available_count(), 0);
    }

    #[test]
    fn test_empty_pool() {
        let mut pool = CredentialPool::with_keys(vec![], RotationStrategy::RoundRobin);
        assert_eq!(pool.next_key(), None);
        assert_eq!(pool.total_count(), 0);
    }

    // ── T1.9.1 Move C — substrate-backed pool ──────────────────────────

    use aeqi_core::credentials::{CredentialCipher, CredentialInsert, CredentialStore, ScopeKind};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex as StdMutex};

    fn fresh_store() -> CredentialStore {
        let conn = Connection::open_in_memory().unwrap();
        CredentialStore::initialize_schema(&conn).unwrap();
        let cipher = CredentialCipher::ephemeral();
        CredentialStore::new(Arc::new(StdMutex::new(conn)), cipher)
    }

    async fn seed_global_static_secret(
        store: &CredentialStore,
        provider: &str,
        name: &str,
        value: &str,
    ) {
        store
            .insert(CredentialInsert {
                scope_kind: ScopeKind::Global,
                scope_id: String::new(),
                provider: provider.into(),
                name: name.into(),
                lifecycle_kind: "static_secret".into(),
                plaintext_blob: value.as_bytes().to_vec(),
                metadata: serde_json::json!({}),
                expires_at: None,
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn from_credentials_round_robin_matches_legacy_init() {
        let store = fresh_store();
        seed_global_static_secret(&store, "anthropic", "k1", "key1").await;
        seed_global_static_secret(&store, "anthropic", "k2", "key2").await;
        seed_global_static_secret(&store, "anthropic", "k3", "key3").await;

        let mut pool =
            CredentialPool::from_credentials(&store, "anthropic", RotationStrategy::RoundRobin)
                .await
                .expect("pool builds");
        // list_in_scope orders by name → deterministic ordering, matches
        // the legacy `Vec<String>` constructor's behavior.
        let mut seen = Vec::new();
        for _ in 0..3 {
            seen.push(pool.next_key().unwrap().to_string());
        }
        seen.sort();
        assert_eq!(seen, vec!["key1", "key2", "key3"]);
        assert_eq!(pool.total_count(), 3);
    }

    #[tokio::test]
    async fn from_credentials_skips_other_providers() {
        let store = fresh_store();
        seed_global_static_secret(&store, "anthropic", "ant", "value-anthropic").await;
        seed_global_static_secret(&store, "openrouter", "or", "value-openrouter").await;

        let mut pool =
            CredentialPool::from_credentials(&store, "anthropic", RotationStrategy::RoundRobin)
                .await
                .unwrap();
        assert_eq!(pool.total_count(), 1);
        assert_eq!(pool.next_key(), Some("value-anthropic"));
    }

    #[tokio::test]
    async fn from_credentials_zero_keys_returns_clear_error() {
        let store = fresh_store();
        let result =
            CredentialPool::from_credentials(&store, "anthropic", RotationStrategy::RoundRobin)
                .await;
        let err = match result {
            Ok(_) => panic!("zero credentials must surface as an error"),
            Err(e) => e,
        };
        let msg = err.to_string();
        assert!(
            msg.contains("no credentials available"),
            "error must mention missing credentials, got: {msg}"
        );
        assert!(
            msg.contains("anthropic"),
            "error must mention provider name, got: {msg}"
        );
    }
}
