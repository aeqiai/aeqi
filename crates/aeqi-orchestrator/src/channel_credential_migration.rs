//! T1.9.1 — Move B.1: one-shot channel-token migration.
//!
//! Walks every row in `channels`, lifts any token-shaped fields out of the
//! row's `config` JSON, materializes them as credentials substrate rows
//! (`scope_kind='channel', scope_id=<channel_id>, provider=<kind>,
//! name=<field_name>, lifecycle_kind='static_secret'`), and rewrites
//! `channels.config` with the field removed.
//!
//! Idempotent: a row with no token fields in its config and a credential
//! already in the substrate is a no-op. Re-running the walker after a
//! successful migration walks empty configs and exits clean.
//!
//! Destructive: after this runs, the legacy `token` / `bot_token` /
//! `access_token` / `verify_token` keys never live in `channels.config`
//! again. `TelegramConfig` / `SlackConfig` / `DiscordConfig` /
//! `WhatsappConfig` have those fields removed entirely; existing rows that
//! still carry them deserialize via `#[serde(default)]` and the migration
//! cleans them up.

use std::sync::Arc;

use aeqi_core::credentials::{CredentialInsert, CredentialKey, CredentialStore, ScopeKind};
use anyhow::{Context, Result};
use rusqlite::{OptionalExtension, params};
use tracing::{debug, warn};

use crate::agent_registry::ConnectionPool;

/// Token-shaped field names per channel kind. Empty for kinds that hold no
/// secrets in `channels.config` (e.g. `whatsapp-baileys`, where auth lives
/// in a Baileys session_dir handled separately by T1.9.2).
fn token_fields_for(kind: &str) -> &'static [&'static str] {
    match kind {
        "telegram" => &["token"],
        "slack" => &["bot_token", "app_token"],
        "discord" => &["token"],
        "whatsapp" => &["access_token", "verify_token"],
        _ => &[],
    }
}

/// Snapshot of one channel row read at the start of migration.
struct ChannelRow {
    id: String,
    kind: String,
    config: serde_json::Value,
}

/// Walk every channel row and migrate token-shaped fields into the
/// credentials substrate. Returns `(migrated, already_migrated)` counts —
/// `migrated` is the number of channel rows whose config was rewritten,
/// `already_migrated` counts rows that needed no rewrite.
pub async fn migrate_and_strip_channel_tokens(
    db: Arc<ConnectionPool>,
    credentials: &CredentialStore,
) -> Result<(usize, usize)> {
    // Pull all channel rows up front so we don't hold the pool lock across
    // the per-row credential write + UPDATE roundtrip. The set is small
    // (one row per agent per kind) — bounded.
    //
    // Fresh-DB tolerance: this migration runs at daemon boot BEFORE
    // `AgentRegistry::open` creates the `channels` table on a fresh
    // tenant. Returning (0, 0) when the table doesn't exist lets the
    // boot continue — the table will be created downstream and there
    // are no rows to migrate yet. Without this, fresh tenants
    // crash-loop forever (systemd restart counter hit 45,000+ for the
    // 2026-04-29 sandbox-launch incident).
    let rows: Vec<ChannelRow> = {
        let conn = db.lock().await;
        let table_exists: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='channels'",
                [],
                |_| Ok(true),
            )
            .optional()
            .context("probe channels table existence")?
            .unwrap_or(false);
        if !table_exists {
            return Ok((0, 0));
        }
        let mut stmt = conn
            .prepare("SELECT id, kind, config FROM channels")
            .context("prepare channels select")?;
        let iter = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let kind: String = row.get(1)?;
                let config_str: String = row.get(2)?;
                Ok((id, kind, config_str))
            })
            .context("query channels")?;
        let mut out = Vec::new();
        for r in iter {
            let (id, kind, config_str) = r.context("read channel row")?;
            // Best-effort JSON parse — a malformed row gets logged and
            // skipped, never fails the whole migration.
            match serde_json::from_str::<serde_json::Value>(&config_str) {
                Ok(config) => out.push(ChannelRow { id, kind, config }),
                Err(e) => {
                    warn!(
                        channel_id = %id,
                        error = %e,
                        "skipping channel with unparseable config JSON during token migration"
                    );
                }
            }
        }
        out
    };

    let mut migrated = 0usize;
    let mut already_migrated = 0usize;

    for ChannelRow {
        id,
        kind,
        mut config,
    } in rows
    {
        let fields = token_fields_for(&kind);
        if fields.is_empty() {
            already_migrated += 1;
            continue;
        }

        let obj = match config.as_object_mut() {
            Some(o) => o,
            None => {
                // Non-object config — log and leave alone; a separate
                // schema check would catch this if it ever happens.
                warn!(channel_id = %id, kind = %kind, "channel config is not a JSON object — skipping");
                continue;
            }
        };

        let mut row_changed = false;
        for &field in fields {
            let value = match obj.get(field) {
                Some(serde_json::Value::String(s)) if !s.is_empty() => s.clone(),
                _ => continue,
            };

            // Insert into substrate. If the credential already exists for
            // this (channel, kind, field) — typically because a prior
            // migration run partially ran — skip the insert and still
            // strip the field from the config (idempotent re-run).
            let key = CredentialKey {
                scope_kind: ScopeKind::Channel,
                scope_id: id.clone(),
                provider: kind.clone(),
                name: field.to_string(),
            };
            let existed = credentials
                .find(&key)
                .await
                .context("look up existing channel credential")?
                .is_some();
            if !existed {
                credentials
                    .insert(CredentialInsert {
                        scope_kind: ScopeKind::Channel,
                        scope_id: id.clone(),
                        provider: kind.clone(),
                        name: field.to_string(),
                        lifecycle_kind: "static_secret".to_string(),
                        plaintext_blob: value.into_bytes(),
                        metadata: serde_json::json!({"source": "channel_config_migration"}),
                        expires_at: None,
                    })
                    .await
                    .with_context(|| {
                        format!(
                            "insert credential for channel {} kind {} field {}",
                            id, kind, field
                        )
                    })?;
                debug!(channel_id = %id, kind = %kind, field, "materialized channel token into credentials");
            }

            obj.remove(field);
            row_changed = true;
        }

        if row_changed {
            let new_json =
                serde_json::to_string(&config).context("re-serialize stripped channel config")?;
            let conn = db.lock().await;
            conn.execute(
                "UPDATE channels SET config = ?1, updated_at = ?2 WHERE id = ?3",
                params![new_json, chrono::Utc::now().to_rfc3339(), id],
            )
            .with_context(|| format!("UPDATE channels.config for {}", id))?;
            migrated += 1;
        } else {
            already_migrated += 1;
        }
    }

    Ok((migrated, already_migrated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::credentials::{CredentialCipher, CredentialStore};
    use rusqlite::Connection;
    use std::sync::Mutex as StdMutex;

    async fn fresh_store() -> CredentialStore {
        let conn = Connection::open_in_memory().unwrap();
        CredentialStore::initialize_schema(&conn).unwrap();
        let cipher = CredentialCipher::ephemeral();
        CredentialStore::new(Arc::new(StdMutex::new(conn)), cipher)
    }

    async fn fresh_pool() -> Arc<ConnectionPool> {
        let pool = ConnectionPool::in_memory().unwrap();
        // Stamp just the `channels` table — no need for the full
        // agent-registry schema for these tests.
        {
            let conn = pool.lock().await;
            conn.execute_batch(
                "CREATE TABLE channels (
                    id TEXT PRIMARY KEY,
                    agent_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    config TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT,
                    UNIQUE (agent_id, kind)
                );",
            )
            .unwrap();
        }
        Arc::new(pool)
    }

    async fn insert_channel(pool: &ConnectionPool, id: &str, kind: &str, config: &str) {
        let conn = pool.lock().await;
        conn.execute(
            "INSERT INTO channels (id, agent_id, kind, config, enabled, created_at)
             VALUES (?1, 'agent', ?2, ?3, 1, '2026-04-25T00:00:00Z')",
            params![id, kind, config],
        )
        .unwrap();
    }

    async fn read_config(pool: &ConnectionPool, id: &str) -> String {
        let conn = pool.lock().await;
        conn.query_row(
            "SELECT config FROM channels WHERE id = ?1",
            params![id],
            |row| row.get::<_, String>(0),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn migrates_telegram_token_into_substrate_and_strips_field() {
        let store = fresh_store().await;
        let pool = fresh_pool().await;
        insert_channel(
            &pool,
            "ch-tg",
            "telegram",
            r#"{"kind":"telegram","token":"ABC"}"#,
        )
        .await;

        let (migrated, already) = migrate_and_strip_channel_tokens(pool.clone(), &store)
            .await
            .unwrap();
        assert_eq!(migrated, 1);
        assert_eq!(already, 0);

        // Credential row materialized.
        let row = store
            .find(&CredentialKey {
                scope_kind: ScopeKind::Channel,
                scope_id: "ch-tg".into(),
                provider: "telegram".into(),
                name: "token".into(),
            })
            .await
            .unwrap()
            .expect("token row");
        let plain = store.decrypt(&row).unwrap();
        assert_eq!(plain, b"ABC");

        // Config JSON no longer carries the token field.
        let cfg = read_config(&pool, "ch-tg").await;
        let parsed: serde_json::Value = serde_json::from_str(&cfg).unwrap();
        assert!(
            parsed.get("token").is_none(),
            "token field must be stripped"
        );
        assert_eq!(
            parsed.get("kind").and_then(|v| v.as_str()),
            Some("telegram")
        );
    }

    #[tokio::test]
    async fn idempotent_on_already_migrated_row() {
        let store = fresh_store().await;
        let pool = fresh_pool().await;
        insert_channel(
            &pool,
            "ch-tg",
            "telegram",
            r#"{"kind":"telegram","token":"ABC"}"#,
        )
        .await;

        // First run.
        migrate_and_strip_channel_tokens(pool.clone(), &store)
            .await
            .unwrap();
        // Second run: token absent, credential already present → no migration.
        let (migrated, already) = migrate_and_strip_channel_tokens(pool.clone(), &store)
            .await
            .unwrap();
        assert_eq!(migrated, 0);
        assert_eq!(already, 1);
    }

    #[tokio::test]
    async fn migrates_slack_bot_token_and_app_token() {
        let store = fresh_store().await;
        let pool = fresh_pool().await;
        insert_channel(
            &pool,
            "ch-sl",
            "slack",
            r#"{"kind":"slack","bot_token":"xoxb-1","app_token":"xapp-1","allowed_channels":["C1"]}"#,
        )
        .await;

        let (migrated, _) = migrate_and_strip_channel_tokens(pool.clone(), &store)
            .await
            .unwrap();
        assert_eq!(migrated, 1);

        for name in ["bot_token", "app_token"] {
            let row = store
                .find(&CredentialKey {
                    scope_kind: ScopeKind::Channel,
                    scope_id: "ch-sl".into(),
                    provider: "slack".into(),
                    name: name.into(),
                })
                .await
                .unwrap();
            assert!(
                row.is_some(),
                "expected slack credential {} to be present",
                name
            );
        }

        // allowed_channels (non-secret) survives the strip.
        let cfg = read_config(&pool, "ch-sl").await;
        let parsed: serde_json::Value = serde_json::from_str(&cfg).unwrap();
        assert!(parsed.get("bot_token").is_none());
        assert!(parsed.get("app_token").is_none());
        assert_eq!(
            parsed
                .get("allowed_channels")
                .and_then(|v| v.as_array())
                .map(Vec::len),
            Some(1)
        );
    }

    #[tokio::test]
    async fn migrates_whatsapp_cloud_tokens_keeps_phone_id() {
        let store = fresh_store().await;
        let pool = fresh_pool().await;
        insert_channel(
            &pool,
            "ch-wa",
            "whatsapp",
            r#"{"kind":"whatsapp","phone_number_id":"PNI","access_token":"AT","verify_token":"VT"}"#,
        )
        .await;

        let (migrated, _) = migrate_and_strip_channel_tokens(pool.clone(), &store)
            .await
            .unwrap();
        assert_eq!(migrated, 1);

        let cfg = read_config(&pool, "ch-wa").await;
        let parsed: serde_json::Value = serde_json::from_str(&cfg).unwrap();
        // phone_number_id is a public identifier, not a secret — must
        // survive the strip.
        assert_eq!(
            parsed.get("phone_number_id").and_then(|v| v.as_str()),
            Some("PNI")
        );
        assert!(parsed.get("access_token").is_none());
        assert!(parsed.get("verify_token").is_none());

        for name in ["access_token", "verify_token"] {
            assert!(
                store
                    .find(&CredentialKey {
                        scope_kind: ScopeKind::Channel,
                        scope_id: "ch-wa".into(),
                        provider: "whatsapp".into(),
                        name: name.into(),
                    })
                    .await
                    .unwrap()
                    .is_some(),
                "whatsapp credential {} missing",
                name
            );
        }
    }

    #[tokio::test]
    async fn whatsapp_baileys_has_no_token_fields_to_migrate() {
        let store = fresh_store().await;
        let pool = fresh_pool().await;
        insert_channel(
            &pool,
            "ch-wb",
            "whatsapp-baileys",
            r#"{"kind":"whatsapp-baileys"}"#,
        )
        .await;

        let (migrated, already) = migrate_and_strip_channel_tokens(pool.clone(), &store)
            .await
            .unwrap();
        assert_eq!(migrated, 0);
        assert_eq!(already, 1);
    }
}
