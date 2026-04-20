//! Channels — connector wiring for outbound/inbound agent messaging.
//!
//! Unlike ideas (injectable text) or events (reaction rules), a channel is
//! typed runtime state that the daemon uses to open and maintain a transport
//! (Telegram poller, Discord gateway, etc.). Each kind has its own config
//! shape. Store + daemon talk to `Channel` values, never raw JSON.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::warn;

use crate::agent_registry::ConnectionPool;

// Re-exports come through the crate root (see `lib.rs`).

/// Which transport a channel speaks.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ChannelKind {
    Telegram,
    Discord,
    Slack,
    Whatsapp,
    /// Personal WhatsApp Web via the Baileys Node bridge — QR-paired, no Twilio.
    WhatsappBaileys,
}

impl ChannelKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChannelKind::Telegram => "telegram",
            ChannelKind::Discord => "discord",
            ChannelKind::Slack => "slack",
            ChannelKind::Whatsapp => "whatsapp",
            ChannelKind::WhatsappBaileys => "whatsapp-baileys",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "telegram" => Some(Self::Telegram),
            "discord" => Some(Self::Discord),
            "slack" => Some(Self::Slack),
            "whatsapp" => Some(Self::Whatsapp),
            "whatsapp-baileys" => Some(Self::WhatsappBaileys),
            _ => None,
        }
    }
}

/// Typed config per channel kind. The DB column stores this as JSON,
/// deserialized against the kind column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ChannelConfig {
    Telegram(TelegramConfig),
    Discord(DiscordConfig),
    Slack(SlackConfig),
    Whatsapp(WhatsappConfig),
    WhatsappBaileys(WhatsappBaileysConfig),
}

impl ChannelConfig {
    pub fn kind(&self) -> ChannelKind {
        match self {
            Self::Telegram(_) => ChannelKind::Telegram,
            Self::Discord(_) => ChannelKind::Discord,
            Self::Slack(_) => ChannelKind::Slack,
            Self::Whatsapp(_) => ChannelKind::Whatsapp,
            Self::WhatsappBaileys(_) => ChannelKind::WhatsappBaileys,
        }
    }
}

/// Telegram bot token only. Whitelist lives in `channel_allowed_chats` —
/// toggling a single chat must not require rewriting (and risking
/// corruption of) the token blob.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelegramConfig {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscordConfig {
    pub token: String,
    #[serde(default)]
    pub allowed_channels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackConfig {
    pub bot_token: String,
    #[serde(default)]
    pub app_token: Option<String>,
    #[serde(default)]
    pub allowed_channels: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsappConfig {
    pub phone_number_id: String,
    pub access_token: String,
    #[serde(default)]
    pub verify_token: Option<String>,
}

/// Baileys-backed WhatsApp (user's own WhatsApp Web session).
///
/// No tokens — auth is a scanned QR. `session_dir`, when set, overrides
/// the default path (`~/.aeqi/platforms/whatsapp-baileys/<channel_id>`);
/// keep it `None` for the default, which lets the channel_id govern the
/// filesystem layout.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatsappBaileysConfig {
    #[serde(default)]
    pub session_dir: Option<String>,
    /// Optional JID-level whitelist. Applied in addition to the shared
    /// `channel_allowed_chats` table.
    #[serde(default)]
    pub allowed_jids: Vec<String>,
}

/// A channel row: one transport binding for one agent.
///
/// `allowed_chats` is populated from the separate `channel_allowed_chats`
/// table, not the config blob. Empty vec = no whitelist (accept all).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub agent_id: String,
    pub kind: ChannelKind,
    pub config: ChannelConfig,
    pub enabled: bool,
    #[serde(default)]
    pub allowed_chats: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// For creating a new channel.
pub struct NewChannel {
    pub agent_id: String,
    pub config: ChannelConfig,
}

/// Hook that spawns the per-channel background gateway (Baileys Node bridge,
/// Telegram poller, …). Implemented in aeqi-cli where the full `SpawnContext`
/// lives; registered on the `Daemon` at startup so IPC create/enable handlers
/// can bring a freshly-written row live without waiting for a daemon restart.
pub trait ChannelSpawner: Send + Sync {
    /// Spawn (or re-spawn) the gateway task for this channel. Returns `true`
    /// if a task was started. Must be non-blocking — the implementation owns
    /// its own `tokio::spawn`.
    fn spawn(&self, channel: Channel) -> bool;
}

/// Typed errors that user-facing callers need to discriminate. `Conflict` is
/// the one the IPC/HTTP layer maps to a 409-like response; everything else
/// collapses into a generic 500-ish storage error.
#[derive(Debug, thiserror::Error)]
pub enum ChannelError {
    #[error("a {kind:?} channel already exists for this agent — delete it first")]
    Conflict { kind: ChannelKind },
    #[error(transparent)]
    Storage(#[from] anyhow::Error),
}

/// SQLite extended error code for `UNIQUE` constraint failures. We can't
/// match on string prefixes because rusqlite's message format changes
/// between versions.
const SQLITE_CONSTRAINT_UNIQUE: i32 = 2067;

fn is_unique_constraint_violation(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(err, _)
            if err.extended_code == SQLITE_CONSTRAINT_UNIQUE
    )
}

/// SQLite-backed channel store. Shares the aeqi.db pool.
pub struct ChannelStore {
    db: Arc<ConnectionPool>,
}

impl ChannelStore {
    pub fn new(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    /// Create a channel. Fails with `ChannelError::Conflict` if the agent
    /// already has a channel of the same kind — callers must explicitly
    /// delete the existing row first. This replaced a silent upsert whose
    /// "always works" behavior hid bugs (double-clicks, stale UI state)
    /// behind opaque config clobbers.
    pub async fn create(&self, c: &NewChannel) -> Result<Channel, ChannelError> {
        let kind = c.config.kind();
        // Fast-path: obvious conflict surfaces a clean error without a DB
        // round-trip through INSERT. But the pool is multi-connection, so
        // this check is NOT authoritative — the unique index + error mapping
        // below is what actually enforces uniqueness under races.
        if self
            .get_by_agent_kind(&c.agent_id, kind)
            .await
            .map_err(ChannelError::Storage)?
            .is_some()
        {
            return Err(ChannelError::Conflict { kind });
        }
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let config_json = serde_json::to_string(&c.config).map_err(anyhow::Error::from)?;
        let insert_result = {
            let db = self.db.lock().await;
            db.execute(
                "INSERT INTO channels (id, agent_id, kind, config, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![id, c.agent_id, kind.as_str(), config_json, now.to_rfc3339(),],
            )
        };
        if let Err(e) = insert_result {
            // Map SQLITE_CONSTRAINT_UNIQUE (extended code 2067) on the
            // (agent_id, kind) index to a typed Conflict — the pool has
            // multiple connections so two concurrent `create` calls can both
            // pass the pre-check and race the INSERT; the loser is a real
            // conflict, not a generic storage failure.
            if is_unique_constraint_violation(&e) {
                return Err(ChannelError::Conflict { kind });
            }
            return Err(ChannelError::Storage(anyhow::Error::from(e)));
        }
        // Look up by the id we just generated, not by (agent_id, kind). With
        // a multi-connection pool + WAL, a different pool connection could
        // theoretically snapshot a concurrent writer's row here under
        // (agent_id, kind) — which would return wrong data. Primary-key
        // lookup on our own UUID is race-free and cheaper.
        self.get_by_id(&id)
            .await
            .map_err(ChannelError::Storage)?
            .context("channel create produced no row")
            .map_err(ChannelError::Storage)
    }

    pub async fn get_by_agent_kind(
        &self,
        agent_id: &str,
        kind: ChannelKind,
    ) -> Result<Option<Channel>> {
        let ch = {
            let db = self.db.lock().await;
            db.query_row(
                "SELECT id, agent_id, kind, config, enabled, created_at, updated_at
                 FROM channels WHERE agent_id = ?1 AND kind = ?2",
                params![agent_id, kind.as_str()],
                |row| Ok(row_to_channel(row)),
            )
            .optional()?
            .transpose()?
        };
        if let Some(mut ch) = ch {
            ch.allowed_chats = self.list_allowed_chats(&ch.id).await?;
            Ok(Some(ch))
        } else {
            Ok(None)
        }
    }

    /// Look up a channel by its id. The returned `agent_id` is the
    /// authoritative owner — callers must use *this* value for tenancy checks
    /// on destructive ops, never a caller-supplied agent_id.
    pub async fn get_by_id(&self, id: &str) -> Result<Option<Channel>> {
        let ch = {
            let db = self.db.lock().await;
            db.query_row(
                "SELECT id, agent_id, kind, config, enabled, created_at, updated_at
                 FROM channels WHERE id = ?1",
                params![id],
                |row| Ok(row_to_channel(row)),
            )
            .optional()?
            .transpose()?
        };
        if let Some(mut ch) = ch {
            ch.allowed_chats = self.list_allowed_chats(&ch.id).await?;
            Ok(Some(ch))
        } else {
            Ok(None)
        }
    }

    pub async fn list_for_agent(&self, agent_id: &str) -> Result<Vec<Channel>> {
        let rows: Vec<_> = {
            let db = self.db.lock().await;
            let mut stmt = db.prepare(
                "SELECT id, agent_id, kind, config, enabled, created_at, updated_at
                 FROM channels WHERE agent_id = ?1 ORDER BY kind",
            )?;
            stmt.query_map(params![agent_id], |row| Ok(row_to_channel(row)))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut channels = collect_channels_logging_skipped(rows);
        for ch in &mut channels {
            ch.allowed_chats = self.list_allowed_chats(&ch.id).await?;
        }
        Ok(channels)
    }

    /// List every enabled channel across all agents. Used by the daemon at
    /// startup to spin up gateways.
    ///
    /// Malformed rows (unknown kind, invalid JSON, missing fields after a
    /// schema change) are logged and skipped rather than aborting the whole
    /// scan — one bad row must not take down every agent's gateway on boot.
    pub async fn list_enabled(&self) -> Result<Vec<Channel>> {
        let rows: Vec<_> = {
            let db = self.db.lock().await;
            let mut stmt = db.prepare(
                "SELECT id, agent_id, kind, config, enabled, created_at, updated_at
                 FROM channels WHERE enabled = 1",
            )?;
            stmt.query_map([], |row| Ok(row_to_channel(row)))?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut channels = collect_channels_logging_skipped(rows);
        for ch in &mut channels {
            ch.allowed_chats = self.list_allowed_chats(&ch.id).await?;
        }
        Ok(channels)
    }

    pub async fn delete(&self, id: &str) -> Result<bool> {
        let db = self.db.lock().await;
        // ON DELETE CASCADE on channel_allowed_chats handles whitelist cleanup.
        let n = db.execute("DELETE FROM channels WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    pub async fn set_enabled(&self, id: &str, enabled: bool) -> Result<bool> {
        let db = self.db.lock().await;
        let n = db.execute(
            "UPDATE channels SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
            params![if enabled { 1 } else { 0 }, Utc::now().to_rfc3339(), id],
        )?;
        Ok(n > 0)
    }

    // --- allowed_chats CRUD ----------------------------------------------

    /// List the whitelist for a channel. Empty = no whitelist (accept all).
    pub async fn list_allowed_chats(&self, channel_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT chat_id FROM channel_allowed_chats
             WHERE channel_id = ?1 ORDER BY added_at",
        )?;
        let rows = stmt.query_map(params![channel_id], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Add one chat to the whitelist. Idempotent (INSERT OR IGNORE).
    pub async fn add_allowed_chat(&self, channel_id: &str, chat_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT OR IGNORE INTO channel_allowed_chats (channel_id, chat_id, added_at)
             VALUES (?1, ?2, ?3)",
            params![channel_id, chat_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    /// Remove one chat from the whitelist. No-op if absent.
    pub async fn remove_allowed_chat(&self, channel_id: &str, chat_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "DELETE FROM channel_allowed_chats
             WHERE channel_id = ?1 AND chat_id = ?2",
            params![channel_id, chat_id],
        )?;
        Ok(())
    }

    /// Replace the whitelist entirely with `chat_ids`. Atomic (transaction).
    /// Used by the UI's "toggle whitelist mode" flow.
    pub async fn set_allowed_chats(&self, channel_id: &str, chat_ids: &[String]) -> Result<()> {
        let mut db = self.db.lock().await;
        let tx = db.transaction()?;
        tx.execute(
            "DELETE FROM channel_allowed_chats WHERE channel_id = ?1",
            params![channel_id],
        )?;
        let now = Utc::now().to_rfc3339();
        for chat_id in chat_ids {
            tx.execute(
                "INSERT OR IGNORE INTO channel_allowed_chats (channel_id, chat_id, added_at)
                 VALUES (?1, ?2, ?3)",
                params![channel_id, chat_id, now],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

/// Turn a batch of per-row `Result<Channel>` into `Vec<Channel>`, logging
/// and dropping any row that failed to parse. Isolation: one corrupt row
/// must never block the rest of the scan — that's how a future schema
/// rename would silently take down every agent's gateway at boot.
fn collect_channels_logging_skipped(rows: Vec<Result<Channel>>) -> Vec<Channel> {
    rows.into_iter()
        .filter_map(|r| match r {
            Ok(c) => Some(c),
            Err(e) => {
                warn!(error = %e, "skipping malformed channel row");
                None
            }
        })
        .collect()
}

fn row_to_channel(row: &rusqlite::Row<'_>) -> Result<Channel> {
    let id: String = row.get(0)?;
    let agent_id: String = row.get(1)?;
    let kind_str: String = row.get(2)?;
    let config_str: String = row.get(3)?;
    let enabled: i64 = row.get(4)?;
    let created_at: String = row.get(5)?;
    let updated_at: Option<String> = row.get(6)?;

    let kind = ChannelKind::parse(&kind_str)
        .with_context(|| format!("unknown channel kind in db: {kind_str}"))?;
    let config: ChannelConfig = serde_json::from_str(&config_str)
        .with_context(|| format!("invalid channel config JSON for channel {id}"))?;

    Ok(Channel {
        id,
        agent_id,
        kind,
        config,
        enabled: enabled != 0,
        // Populated separately by the store via `list_allowed_chats` — rows
        // live in the `channel_allowed_chats` table, not the config blob.
        allowed_chats: Vec::new(),
        created_at: DateTime::parse_from_rfc3339(&created_at)?.with_timezone(&Utc),
        updated_at: updated_at
            .map(|s| DateTime::parse_from_rfc3339(&s).map(|dt| dt.with_timezone(&Utc)))
            .transpose()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;

    async fn test_registry() -> AgentRegistry {
        let dir = tempfile::tempdir().unwrap();
        AgentRegistry::open(dir.path()).unwrap()
    }

    fn tg(token: &str) -> ChannelConfig {
        ChannelConfig::Telegram(TelegramConfig {
            token: token.into(),
        })
    }

    /// Regression guard: `get_by_id` must return the channel's real owner so
    /// destructive ops (delete, set_enabled) can check tenancy against the row,
    /// not against a caller-supplied agent_id.
    #[tokio::test]
    async fn get_by_id_returns_true_owner() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None, None).await.unwrap();
        let bob = reg.spawn("bob", None, None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        let alice_ch = store
            .create(&NewChannel {
                agent_id: alice.id.clone(),
                config: tg("alice-token"),
            })
            .await
            .unwrap();

        // Even if Bob pretends Alice's channel is his, the store reports the
        // truth. The IPC handler uses this truth for the access check, so
        // Bob's claim never reaches the destructive call.
        let found = store.get_by_id(&alice_ch.id).await.unwrap().unwrap();
        assert_eq!(found.agent_id, alice.id);
        assert_ne!(found.agent_id, bob.id);
    }

    /// Regression guard: a single corrupt row must not take down every
    /// agent's gateway at boot. The daemon scans `list_enabled()` on startup,
    /// so `?` propagation there turned one bad config into a site-wide outage.
    #[tokio::test]
    async fn list_enabled_skips_malformed_rows() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        // Insert a valid row...
        store
            .create(&NewChannel {
                agent_id: alice.id.clone(),
                config: tg("valid-token"),
            })
            .await
            .unwrap();

        // ...and a malformed row directly via SQL, simulating corruption or
        // a future schema rename that breaks deserialization.
        {
            let db = reg.db();
            let conn = db.lock().await;
            conn.execute(
                "INSERT INTO channels (id, agent_id, kind, config, enabled, created_at)
                 VALUES ('bad-id', ?1, 'discord', '{this is not valid json', 1, '2026-01-01T00:00:00Z')",
                params![alice.id],
            )
            .unwrap();
        }

        // list_enabled must return the valid row, logging+dropping the bad one.
        let channels = store.list_enabled().await.unwrap();
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0].agent_id, alice.id);
    }

    /// Create is keyed on `(agent_id, kind)` — a caller who owns agent X
    /// can't clobber agent Y's channel by passing agent_id=X, because the row
    /// lookup finds X's channel (possibly none) and leaves Y's alone.
    #[tokio::test]
    async fn create_cannot_clobber_other_agents_channel() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None, None).await.unwrap();
        let bob = reg.spawn("bob", None, None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        let alice_before = store
            .create(&NewChannel {
                agent_id: alice.id.clone(),
                config: tg("alice-token"),
            })
            .await
            .unwrap();

        // Bob creates his own telegram — Alice's row must be untouched.
        store
            .create(&NewChannel {
                agent_id: bob.id.clone(),
                config: tg("bob-token"),
            })
            .await
            .unwrap();

        let alice_after = store.get_by_id(&alice_before.id).await.unwrap().unwrap();
        assert_eq!(alice_after.agent_id, alice.id);
        match alice_after.config {
            ChannelConfig::Telegram(cfg) => assert_eq!(cfg.token, "alice-token"),
            _ => panic!("expected telegram"),
        }
    }

    /// A second `create` with the same (agent_id, kind) must return
    /// `ChannelError::Conflict` — the silent-upsert behavior that preceded
    /// this hid bugs behind quiet config clobbers.
    #[tokio::test]
    async fn create_rejects_duplicate_kind_with_conflict() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        store
            .create(&NewChannel {
                agent_id: alice.id.clone(),
                config: tg("first-token"),
            })
            .await
            .unwrap();

        let err = store
            .create(&NewChannel {
                agent_id: alice.id.clone(),
                config: tg("second-token"),
            })
            .await
            .expect_err("duplicate create must fail");
        assert!(
            matches!(
                err,
                ChannelError::Conflict {
                    kind: ChannelKind::Telegram
                }
            ),
            "expected Conflict, got {err:?}"
        );
    }
}
