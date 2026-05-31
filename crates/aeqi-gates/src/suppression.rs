//! Notification suppression — the STOP-path primitive (quest 67-189).
//!
//! When the demo cohort says "stop messaging me," that opt-out has to survive
//! across notification channels, restarts, and any future send sequences. The
//! contract is:
//!
//! 1. `is_suppressed(channel, address)` is the single send-time check every
//!    outbound notification must call. Returning `true` means the sender
//!    skips and logs.
//! 2. `suppress(channel, address)` flips a binding to suppressed. Idempotent —
//!    re-suppression refreshes `suppressed_at` to the latest timestamp.
//! 3. `resume(channel, address)` clears suppression. Idempotent.
//!
//! The Telegram channel poll loop intercepts `/stop` and `/resume` text and
//! drives this trait (see `crates/aeqi-gates/src/telegram.rs`). The email
//! path (List-Unsubscribe header + signed-JWT confirmation page) is filed as
//! follow-up quests 67-189.1 and 67-189.2 — both gated on this primitive.
//!
//! # Storage
//!
//! Bindings live in their own sqlite database (`notifications.db`) opened
//! independently of `aeqi.db` and `accounts.db`. The schema is idempotent
//! (CREATE TABLE IF NOT EXISTS) and self-applies on `open`. There's no
//! migration runner — the table is greenfield and intentionally simple.

use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::Utc;
use rusqlite::{Connection, OptionalExtension, params};
use std::path::Path;
use std::sync::Mutex;
use uuid::Uuid;

/// Notification channel discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Telegram,
    Email,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Telegram => "telegram",
            Channel::Email => "email",
        }
    }
}

/// A single binding row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub id: String,
    pub company_id: Option<String>,
    pub channel: String,
    pub address: String,
    pub signer_address: Option<String>,
    pub suppressed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Suppression primitive used by every notification sender.
///
/// `is_suppressed` is the gate — call it before any send. `suppress` and
/// `resume` mutate the binding. Implementations must be `Send + Sync` so the
/// trait object can be stored on long-lived channels (e.g.
/// `TelegramChannel`).
#[async_trait]
pub trait NotificationSuppression: Send + Sync {
    /// Returns `true` if the given `(channel, address)` has been suppressed
    /// AND not subsequently resumed. Unknown bindings are NOT suppressed —
    /// the default is "send is allowed."
    async fn is_suppressed(&self, channel: Channel, address: &str) -> Result<bool>;

    /// Mark `(channel, address)` as suppressed. Creates the binding row if
    /// it doesn't exist yet. `signer_address` is optional context for who
    /// owns this binding (useful for later "resume all bindings for signer
    /// X" semantics; today the primitive is per-address).
    async fn suppress(
        &self,
        channel: Channel,
        address: &str,
        signer_address: Option<&str>,
    ) -> Result<()>;

    /// Clear the `suppressed_at` timestamp. No-op if the binding doesn't
    /// exist (a resume without a prior suppress is meaningless).
    async fn resume(&self, channel: Channel, address: &str) -> Result<()>;

    /// Fetch a binding for diagnostics / tests. Returns `None` if no row.
    async fn get(&self, channel: Channel, address: &str) -> Result<Option<Binding>>;
}

/// Sqlite-backed default impl. Holds its own connection so it can be
/// `Send + Sync` via the `Mutex<Connection>` pattern matching
/// `aeqi-web::accounts::AccountStore`.
pub struct SqliteNotificationSuppression {
    conn: Mutex<Connection>,
}

impl SqliteNotificationSuppression {
    /// Open (or create) the notifications database at `<data_dir>/notifications.db`.
    pub fn open(data_dir: &Path) -> Result<Self> {
        let path = data_dir.join("notifications.db");
        let conn = Connection::open(&path)
            .with_context(|| format!("open notifications.db at {}", path.display()))?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
        rename_legacy_entity_id(&conn, "notification_bindings")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notification_bindings (
                id              TEXT PRIMARY KEY,
                company_id       TEXT,
                channel         TEXT NOT NULL,
                address         TEXT NOT NULL,
                signer_address  TEXT,
                suppressed_at   TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                UNIQUE(channel, address)
            );
            CREATE INDEX IF NOT EXISTS idx_notification_bindings_signer
                ON notification_bindings(signer_address);
            CREATE INDEX IF NOT EXISTS idx_notification_bindings_suppressed
                ON notification_bindings(suppressed_at)
                WHERE suppressed_at IS NOT NULL;",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open from an existing connection — useful in tests when sharing a
    /// `:memory:` DB across components.
    pub fn from_connection(conn: Connection) -> Result<Self> {
        rename_legacy_entity_id(&conn, "notification_bindings")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS notification_bindings (
                id              TEXT PRIMARY KEY,
                company_id       TEXT,
                channel         TEXT NOT NULL,
                address         TEXT NOT NULL,
                signer_address  TEXT,
                suppressed_at   TEXT,
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                UNIQUE(channel, address)
            );",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }
}

/// ae-062 phase B: rename legacy `entity_id` → `company_id` on live DBs.
/// No-op if the table is missing, the legacy column is absent, or the
/// canonical column is already present.
fn rename_legacy_entity_id(conn: &Connection, table: &str) -> Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if cols.is_empty() {
        return Ok(());
    }
    let has_legacy = cols.iter().any(|c| c == "entity_id");
    let has_canonical = cols.iter().any(|c| c == "company_id");
    if has_legacy && !has_canonical {
        conn.execute(
            &format!("ALTER TABLE {table} RENAME COLUMN entity_id TO company_id"),
            [],
        )?;
    }
    Ok(())
}

#[async_trait]
impl NotificationSuppression for SqliteNotificationSuppression {
    async fn is_suppressed(&self, channel: Channel, address: &str) -> Result<bool> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("poisoned: {e}"))?;
        // .optional() handles "no row"; the inner Option<String> handles
        // "row exists but suppressed_at IS NULL". Both map to "not suppressed."
        let row: Option<Option<String>> = conn
            .query_row(
                "SELECT suppressed_at FROM notification_bindings WHERE channel = ?1 AND address = ?2",
                params![channel.as_str(), address],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?;
        Ok(matches!(row, Some(Some(_))))
    }

    async fn suppress(
        &self,
        channel: Channel,
        address: &str,
        signer_address: Option<&str>,
    ) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("poisoned: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let id = Uuid::new_v4().to_string();
        // Upsert: if the binding exists, refresh suppressed_at + updated_at.
        // If not, insert a new row. Idempotent re-suppression refreshes the
        // timestamp so we can tell when the most recent /stop landed.
        conn.execute(
            "INSERT INTO notification_bindings
                (id, company_id, channel, address, signer_address, suppressed_at, created_at, updated_at)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?5, ?5)
             ON CONFLICT(channel, address) DO UPDATE SET
                suppressed_at = excluded.suppressed_at,
                updated_at = excluded.updated_at,
                signer_address = COALESCE(excluded.signer_address, notification_bindings.signer_address)",
            params![id, channel.as_str(), address, signer_address, now],
        )?;
        Ok(())
    }

    async fn resume(&self, channel: Channel, address: &str) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("poisoned: {e}"))?;
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE notification_bindings
             SET suppressed_at = NULL, updated_at = ?1
             WHERE channel = ?2 AND address = ?3",
            params![now, channel.as_str(), address],
        )?;
        Ok(())
    }

    async fn get(&self, channel: Channel, address: &str) -> Result<Option<Binding>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("poisoned: {e}"))?;
        let row = conn
            .query_row(
                "SELECT id, company_id, channel, address, signer_address,
                        suppressed_at, created_at, updated_at
                 FROM notification_bindings
                 WHERE channel = ?1 AND address = ?2",
                params![channel.as_str(), address],
                |row| {
                    Ok(Binding {
                        id: row.get(0)?,
                        company_id: row.get(1)?,
                        channel: row.get(2)?,
                        address: row.get(3)?,
                        signer_address: row.get(4)?,
                        suppressed_at: row.get(5)?,
                        created_at: row.get(6)?,
                        updated_at: row.get(7)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (TempDir, SqliteNotificationSuppression) {
        let tmp = TempDir::new().unwrap();
        let s = SqliteNotificationSuppression::open(tmp.path()).unwrap();
        (tmp, s)
    }

    #[tokio::test]
    async fn unknown_binding_is_not_suppressed() {
        let (_tmp, s) = store();
        assert!(!s.is_suppressed(Channel::Telegram, "12345").await.unwrap());
    }

    #[tokio::test]
    async fn suppress_then_is_suppressed_returns_true() {
        let (_tmp, s) = store();
        s.suppress(Channel::Telegram, "12345", None).await.unwrap();
        assert!(s.is_suppressed(Channel::Telegram, "12345").await.unwrap());
    }

    #[tokio::test]
    async fn resume_clears_suppression() {
        let (_tmp, s) = store();
        s.suppress(Channel::Telegram, "12345", None).await.unwrap();
        s.resume(Channel::Telegram, "12345").await.unwrap();
        assert!(!s.is_suppressed(Channel::Telegram, "12345").await.unwrap());
    }

    #[tokio::test]
    async fn resume_unknown_binding_is_noop() {
        let (_tmp, s) = store();
        s.resume(Channel::Email, "alice@example.com").await.unwrap();
        assert!(
            s.get(Channel::Email, "alice@example.com")
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn suppress_is_idempotent_and_refreshes_timestamp() {
        let (_tmp, s) = store();
        s.suppress(Channel::Telegram, "12345", None).await.unwrap();
        let first = s.get(Channel::Telegram, "12345").await.unwrap().unwrap();

        // Tiny gap so the second timestamp is strictly later.
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        s.suppress(Channel::Telegram, "12345", None).await.unwrap();
        let second = s.get(Channel::Telegram, "12345").await.unwrap().unwrap();

        // Same row (PK preserved by UNIQUE conflict path), refreshed timestamp.
        assert_eq!(first.id, second.id);
        assert!(second.suppressed_at > first.suppressed_at);
    }

    #[tokio::test]
    async fn channels_are_independent() {
        let (_tmp, s) = store();
        s.suppress(Channel::Telegram, "alice@example.com", None)
            .await
            .unwrap();
        // Same address on email channel must NOT be suppressed.
        assert!(
            !s.is_suppressed(Channel::Email, "alice@example.com")
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn signer_is_recorded_and_preserved_on_resuppress() {
        let (_tmp, s) = store();
        s.suppress(Channel::Telegram, "12345", Some("0xABC"))
            .await
            .unwrap();
        let first = s.get(Channel::Telegram, "12345").await.unwrap().unwrap();
        assert_eq!(first.signer_address.as_deref(), Some("0xABC"));

        // Re-suppress without a signer arg must NOT clear the recorded signer.
        s.suppress(Channel::Telegram, "12345", None).await.unwrap();
        let second = s.get(Channel::Telegram, "12345").await.unwrap().unwrap();
        assert_eq!(second.signer_address.as_deref(), Some("0xABC"));
    }
}
