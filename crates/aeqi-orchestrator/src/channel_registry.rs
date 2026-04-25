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

/// Telegram channel marker. The kind discriminant carries the meaning;
/// the bot token lives in the credentials substrate keyed on `(channel,
/// <channel_id>, telegram, token)`. Whitelist lives in
/// `channel_allowed_chats`.
///
/// `#[serde(default)]` lets pre-T1.9.1 config JSON (which still carried
/// `token: "..."`) deserialize without error — the migration walker
/// strips the inline field on the next boot.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TelegramConfig {}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct DiscordConfig {
    pub allowed_channels: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SlackConfig {
    pub allowed_channels: Vec<String>,
}

/// WhatsApp Cloud API channel.
///
/// `phone_number_id` is a public identifier (Meta hands it back via the
/// console) — not a secret, so it lives in the config blob. The
/// `access_token` and `verify_token` belong in the substrate.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WhatsappConfig {
    pub phone_number_id: String,
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

/// One row of the per-channel whitelist.
///
/// `reply_allowed` separates inbound and outbound: when `true` (the legacy
/// default) the gateway ingests messages from this chat *and* the agent's
/// outbound reply/react tools may target it; when `false` the chat is
/// **read-only** — messages still flow into transcripts so an agent can
/// observe the conversation, but any attempt to send a reply or reaction is
/// refused at the tool layer with a user-facing error.
///
/// Wire format mirrors the struct: `{ "chat_id": "...", "reply_allowed": true }`.
/// Legacy callers that send a flat `["chat_id", ...]` array are accepted via
/// the `Channel.allowed_chats` deserializer (`reply_allowed` defaults to true).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AllowedChat {
    pub chat_id: String,
    /// Whether the agent's outbound tools may send to this chat.
    /// Defaults to `true` so legacy/string-only deserialization keeps the
    /// historical "ingest = act" behavior.
    #[serde(default = "default_reply_allowed")]
    pub reply_allowed: bool,
}

fn default_reply_allowed() -> bool {
    true
}

impl AllowedChat {
    /// Construct an entry with reply enabled (the legacy default).
    pub fn allow(chat_id: impl Into<String>) -> Self {
        Self {
            chat_id: chat_id.into(),
            reply_allowed: true,
        }
    }

    /// Construct a read-only entry (ingest only, outbound blocked).
    pub fn read_only(chat_id: impl Into<String>) -> Self {
        Self {
            chat_id: chat_id.into(),
            reply_allowed: false,
        }
    }
}

/// A channel row: one transport binding for one agent.
///
/// `allowed_chats` is populated from the separate `channel_allowed_chats`
/// table, not the config blob. Empty vec = no whitelist (accept all).
///
/// Deserialization accepts either the typed shape (`[{chat_id, reply_allowed}, ...]`)
/// or the legacy flat-string shape (`["chat_id", ...]`); flat strings are
/// promoted to `AllowedChat { chat_id, reply_allowed: true }` so older
/// IPC/HTTP clients keep working unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub agent_id: String,
    pub kind: ChannelKind,
    pub config: ChannelConfig,
    pub enabled: bool,
    #[serde(default, deserialize_with = "deserialize_allowed_chats")]
    pub allowed_chats: Vec<AllowedChat>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Custom deserializer that accepts either the typed shape or the legacy
/// flat-string array. Used for inbound IPC/HTTP payloads where the UI may
/// still send a `["chat_id", ...]` list during the transition.
fn deserialize_allowed_chats<'de, D>(de: D) -> Result<Vec<AllowedChat>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum LegacyOrTyped {
        Typed(AllowedChat),
        Legacy(String),
    }

    let raw: Vec<LegacyOrTyped> = Vec::deserialize(de)?;
    Ok(raw
        .into_iter()
        .map(|v| match v {
            LegacyOrTyped::Typed(a) => a,
            LegacyOrTyped::Legacy(s) => AllowedChat {
                chat_id: s,
                reply_allowed: true,
            },
        })
        .collect())
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
    /// Returns `AllowedChat` rows so callers see both the chat id and the
    /// outbound `reply_allowed` flag — needed to split inbound ingestion
    /// from outbound reply authorization in the gateways and tools.
    pub async fn list_allowed_chats(&self, channel_id: &str) -> Result<Vec<AllowedChat>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT chat_id, reply_allowed FROM channel_allowed_chats
             WHERE channel_id = ?1 ORDER BY added_at",
        )?;
        let rows = stmt.query_map(params![channel_id], |row| {
            let chat_id: String = row.get(0)?;
            let reply_allowed: i64 = row.get(1)?;
            Ok(AllowedChat {
                chat_id,
                reply_allowed: reply_allowed != 0,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Add one chat to the whitelist. Idempotent (INSERT OR IGNORE).
    pub async fn add_allowed_chat(&self, channel_id: &str, entry: &AllowedChat) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT OR IGNORE INTO channel_allowed_chats
                 (channel_id, chat_id, added_at, reply_allowed)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                channel_id,
                entry.chat_id,
                Utc::now().to_rfc3339(),
                if entry.reply_allowed { 1 } else { 0 }
            ],
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

    /// Replace the whitelist entirely with `chats`. Atomic (transaction).
    /// Used by the UI's "toggle whitelist mode" flow.
    pub async fn set_allowed_chats(&self, channel_id: &str, chats: &[AllowedChat]) -> Result<()> {
        let mut db = self.db.lock().await;
        let tx = db.transaction()?;
        tx.execute(
            "DELETE FROM channel_allowed_chats WHERE channel_id = ?1",
            params![channel_id],
        )?;
        let now = Utc::now().to_rfc3339();
        for entry in chats {
            tx.execute(
                "INSERT OR IGNORE INTO channel_allowed_chats
                     (channel_id, chat_id, added_at, reply_allowed)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    channel_id,
                    entry.chat_id,
                    now,
                    if entry.reply_allowed { 1 } else { 0 }
                ],
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

    /// Test helper — kept named `tg` so the diff is small. The token is
    /// no longer carried on the config struct; channel_id-derived
    /// substrate lookups are how production code resolves it. Tests that
    /// need the token in flight should write a credentials row directly.
    fn tg(_token: &str) -> ChannelConfig {
        ChannelConfig::Telegram(TelegramConfig::default())
    }

    /// Regression guard: `get_by_id` must return the channel's real owner so
    /// destructive ops (delete, set_enabled) can check tenancy against the row,
    /// not against a caller-supplied agent_id.
    #[tokio::test]
    async fn get_by_id_returns_true_owner() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None).await.unwrap();
        let bob = reg.spawn("bob", None, None).await.unwrap();
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
        let alice = reg.spawn("alice", None, None).await.unwrap();
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
        let alice = reg.spawn("alice", None, None).await.unwrap();
        let bob = reg.spawn("bob", None, None).await.unwrap();
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
        // Tokens no longer live on the config struct (T1.9.1) — the test
        // just confirms the row is reachable as Alice's telegram channel.
        assert!(matches!(alice_after.config, ChannelConfig::Telegram(_)));
    }

    /// A second `create` with the same (agent_id, kind) must return
    /// `ChannelError::Conflict` — the silent-upsert behavior that preceded
    /// this hid bugs behind quiet config clobbers.
    #[tokio::test]
    async fn create_rejects_duplicate_kind_with_conflict() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None).await.unwrap();
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

    /// T1.9.1: legacy config JSON that still carries `token` (or
    /// `bot_token`, etc.) in the blob must deserialize cleanly. The
    /// `#[serde(default)]` annotation lets each typed config struct
    /// ignore the unknown field; the migration walker strips it on the
    /// next boot.
    #[test]
    fn legacy_telegram_config_json_with_inline_token_deserializes() {
        let json = r#"{"kind":"telegram","token":"ABC"}"#;
        let cfg: ChannelConfig = serde_json::from_str(json).expect("legacy JSON must parse");
        assert_eq!(cfg.kind(), ChannelKind::Telegram);
    }

    #[test]
    fn legacy_slack_config_json_with_inline_tokens_deserializes() {
        let json =
            r#"{"kind":"slack","bot_token":"xoxb","app_token":"xapp","allowed_channels":["C1"]}"#;
        let cfg: ChannelConfig = serde_json::from_str(json).expect("legacy slack JSON must parse");
        match cfg {
            ChannelConfig::Slack(s) => assert_eq!(s.allowed_channels, vec!["C1".to_string()]),
            _ => panic!("expected Slack"),
        }
    }

    #[test]
    fn legacy_whatsapp_config_json_with_inline_tokens_deserializes() {
        let json = r#"{"kind":"whatsapp","phone_number_id":"PNI","access_token":"AT","verify_token":"VT"}"#;
        let cfg: ChannelConfig = serde_json::from_str(json).expect("legacy WA JSON must parse");
        match cfg {
            ChannelConfig::Whatsapp(w) => assert_eq!(w.phone_number_id, "PNI"),
            _ => panic!("expected Whatsapp"),
        }
    }

    /// `set_allowed_chats` round-trips the `reply_allowed` flag — both the
    /// allow path (true, the legacy default) and the read-only path
    /// (false). Without this, the schema migration could land but the
    /// CRUD layer would silently coerce everything back to true.
    #[tokio::test]
    async fn set_allowed_chats_roundtrips_reply_allowed_flag() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        let ch = store
            .create(&NewChannel {
                agent_id: alice.id.clone(),
                config: tg("alice-token"),
            })
            .await
            .unwrap();

        let chats = vec![
            AllowedChat {
                chat_id: "100".to_string(),
                reply_allowed: true,
            },
            AllowedChat {
                chat_id: "200".to_string(),
                reply_allowed: false,
            },
        ];
        store.set_allowed_chats(&ch.id, &chats).await.unwrap();

        let got = store.list_allowed_chats(&ch.id).await.unwrap();
        assert_eq!(got.len(), 2, "both rows must persist");
        let by_id: std::collections::HashMap<_, _> = got
            .iter()
            .map(|a| (a.chat_id.clone(), a.reply_allowed))
            .collect();
        assert_eq!(by_id.get("100"), Some(&true));
        assert_eq!(by_id.get("200"), Some(&false));
    }

    /// `add_allowed_chat` writes the flag through, not the default. Guards
    /// against a regression where the helper hard-codes `reply_allowed=1`
    /// while only `set_allowed_chats` honours the input shape.
    #[tokio::test]
    async fn add_allowed_chat_preserves_read_only_flag() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        let ch = store
            .create(&NewChannel {
                agent_id: alice.id.clone(),
                config: tg("alice-token"),
            })
            .await
            .unwrap();

        store
            .add_allowed_chat(&ch.id, &AllowedChat::read_only("readonly-jid"))
            .await
            .unwrap();
        store
            .add_allowed_chat(&ch.id, &AllowedChat::allow("active-jid"))
            .await
            .unwrap();

        let got = store.list_allowed_chats(&ch.id).await.unwrap();
        let by_id: std::collections::HashMap<_, _> = got
            .iter()
            .map(|a| (a.chat_id.clone(), a.reply_allowed))
            .collect();
        assert_eq!(by_id.get("readonly-jid"), Some(&false));
        assert_eq!(by_id.get("active-jid"), Some(&true));
    }

    /// Migration from the pre-`reply_allowed` schema must:
    ///   1. add the column,
    ///   2. backfill every existing row to `reply_allowed=1` (legacy
    ///      "ingest = act" semantics — operators expect their previously
    ///      whitelisted chats to keep responding after the upgrade),
    ///   3. be idempotent on subsequent calls.
    ///
    /// We rebuild the legacy table shape directly so the test cannot rely
    /// on the modern `CREATE TABLE` doing the right thing for us.
    #[tokio::test]
    async fn ensure_channel_allowed_chats_columns_migrates_legacy() {
        use crate::agent_registry::ConnectionPool;
        let pool = ConnectionPool::in_memory().unwrap();
        let conn = pool.lock().await;

        // Synthesize a pre-migration shape — the `channels` parent is also
        // recreated minimally so the FK has somewhere to point.
        conn.execute_batch(
            "CREATE TABLE channels (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT NOT NULL,
                 kind TEXT NOT NULL,
                 config TEXT NOT NULL,
                 enabled INTEGER NOT NULL DEFAULT 1,
                 created_at TEXT NOT NULL,
                 updated_at TEXT
             );
             CREATE TABLE channel_allowed_chats (
                 channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                 chat_id TEXT NOT NULL,
                 added_at TEXT NOT NULL,
                 PRIMARY KEY (channel_id, chat_id)
             );
             INSERT INTO channels (id, agent_id, kind, config, created_at)
                 VALUES ('ch1', 'a1', 'telegram', '{\"kind\":\"telegram\"}', '2026-01-01T00:00:00Z');
             INSERT INTO channel_allowed_chats (channel_id, chat_id, added_at)
                 VALUES ('ch1', '111', '2026-01-01T00:00:00Z'),
                        ('ch1', '222', '2026-01-01T00:00:00Z');",
        )
        .unwrap();

        // No `reply_allowed` column yet.
        let pre_cols: std::collections::HashSet<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(channel_allowed_chats)")
                .unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(!pre_cols.contains("reply_allowed"));

        crate::agent_registry::ensure_channel_allowed_chats_columns(&conn).unwrap();
        // Idempotent — second call must not error.
        crate::agent_registry::ensure_channel_allowed_chats_columns(&conn).unwrap();

        let post_cols: std::collections::HashSet<String> = {
            let mut stmt = conn
                .prepare("PRAGMA table_info(channel_allowed_chats)")
                .unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(post_cols.contains("reply_allowed"));

        // Existing rows backfilled to 1 (preserve legacy "act" behavior).
        let mut stmt = conn
            .prepare("SELECT chat_id, reply_allowed FROM channel_allowed_chats ORDER BY chat_id")
            .unwrap();
        let rows: Vec<(String, i64)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(rows, vec![("111".to_string(), 1), ("222".to_string(), 1)]);
    }

    /// Inbound IPC payloads may still arrive in the legacy flat-string
    /// shape. The `Channel.allowed_chats` deserializer must accept both,
    /// promoting strings to `AllowedChat { chat_id, reply_allowed: true }`.
    #[test]
    fn channel_deserialize_accepts_legacy_string_array() {
        // Build a minimal Channel JSON in the legacy shape.
        let json = serde_json::json!({
            "id": "ch1",
            "agent_id": "a1",
            "kind": "telegram",
            "config": {"kind": "telegram"},
            "enabled": true,
            "allowed_chats": ["100", "200"],
            "created_at": "2026-01-01T00:00:00Z"
        });
        let ch: Channel = serde_json::from_value(json).expect("legacy shape must deserialize");
        assert_eq!(ch.allowed_chats.len(), 2);
        assert!(ch.allowed_chats.iter().all(|a| a.reply_allowed));
        assert_eq!(ch.allowed_chats[0].chat_id, "100");
        assert_eq!(ch.allowed_chats[1].chat_id, "200");
    }

    #[test]
    fn channel_deserialize_accepts_typed_array() {
        let json = serde_json::json!({
            "id": "ch1",
            "agent_id": "a1",
            "kind": "telegram",
            "config": {"kind": "telegram"},
            "enabled": true,
            "allowed_chats": [
                {"chat_id": "100", "reply_allowed": true},
                {"chat_id": "200", "reply_allowed": false}
            ],
            "created_at": "2026-01-01T00:00:00Z"
        });
        let ch: Channel = serde_json::from_value(json).expect("typed shape must deserialize");
        assert_eq!(ch.allowed_chats.len(), 2);
        assert!(ch.allowed_chats[0].reply_allowed);
        assert!(!ch.allowed_chats[1].reply_allowed);
    }
}
