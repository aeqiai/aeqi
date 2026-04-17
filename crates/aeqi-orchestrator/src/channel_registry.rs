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
use tracing::{info, warn};

use crate::agent_registry::ConnectionPool;

/// Which transport a channel speaks.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChannelKind {
    Telegram,
    Discord,
    Slack,
    Whatsapp,
}

impl ChannelKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChannelKind::Telegram => "telegram",
            ChannelKind::Discord => "discord",
            ChannelKind::Slack => "slack",
            ChannelKind::Whatsapp => "whatsapp",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "telegram" => Some(Self::Telegram),
            "discord" => Some(Self::Discord),
            "slack" => Some(Self::Slack),
            "whatsapp" => Some(Self::Whatsapp),
            _ => None,
        }
    }
}

/// Typed config per channel kind. The DB column stores this as JSON,
/// deserialized against the kind column.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ChannelConfig {
    Telegram(TelegramConfig),
    Discord(DiscordConfig),
    Slack(SlackConfig),
    Whatsapp(WhatsappConfig),
}

impl ChannelConfig {
    pub fn kind(&self) -> ChannelKind {
        match self {
            Self::Telegram(_) => ChannelKind::Telegram,
            Self::Discord(_) => ChannelKind::Discord,
            Self::Slack(_) => ChannelKind::Slack,
            Self::Whatsapp(_) => ChannelKind::Whatsapp,
        }
    }
}

/// Telegram bot token only. Whitelist lives in `channel_allowed_chats` —
/// toggling a single chat must not require rewriting (and risking
/// corruption of) the token blob. Serde drops any extra fields on legacy
/// rows during the one-shot migration.
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

    /// Replace-or-insert. Used only by the legacy-idea migration where the
    /// intent is explicitly to overwrite stale state — never call this from
    /// user-driven code paths (use `create` instead).
    async fn replace(&self, c: &NewChannel) -> Result<Channel> {
        let kind = c.config.kind();
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let config_json = serde_json::to_string(&c.config)?;
        {
            let db = self.db.lock().await;
            db.execute(
                "INSERT INTO channels (id, agent_id, kind, config, enabled, created_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5)
                 ON CONFLICT(agent_id, kind) DO UPDATE SET
                     config = excluded.config,
                     enabled = 1,
                     updated_at = excluded.created_at",
                params![id, c.agent_id, kind.as_str(), config_json, now.to_rfc3339(),],
            )?;
        }
        self.get_by_agent_kind(&c.agent_id, kind)
            .await?
            .context("channel replace produced no row")
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

    /// Atomic per-row migration step: replace the allowed_chats set AND
    /// rewrite the config blob in a single transaction, so a crash can't
    /// leave the row half-migrated (inline field still present while the
    /// joined table also has the rows). Used only by
    /// `migrate_inline_allowed_chats`.
    async fn extract_inline_allowed_chats_tx(
        &self,
        channel_id: &str,
        chat_ids: &[String],
        new_config_json: &str,
    ) -> Result<()> {
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
        tx.execute(
            "UPDATE channels SET config = ?1 WHERE id = ?2",
            params![new_config_json, channel_id],
        )?;
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

/// Name of the done-marker for the channel-ideas → channels-table migration.
/// Present in `applied_migrations` ⇒ we never scan ideas for `channel:*`
/// again, no matter how many times the daemon boots.
const CHANNELS_FROM_IDEAS_MIGRATION: &str = "channels_from_ideas_v1";

/// Done-marker for extracting inline `allowed_chats` out of channel config
/// blobs (pre-B2 writes) into the `channel_allowed_chats` table.
const INLINE_ALLOWED_CHATS_MIGRATION: &str = "channel_allowed_chats_extraction_v1";

/// One-shot migration: copy legacy `channel:*` ideas into the channels
/// table, then delete the ideas. Guarded by a row in `applied_migrations`
/// so it runs exactly once across the daemon's lifetime — after that, the
/// function is a cheap SELECT that returns 0.
///
/// Handles both schema shapes seen in the wild:
///   - { "token": "...", "allowed_chats": [...] }   (daemon's reader)
///   - { "bot_token": "...", "allowed_chats": [...] } (UI's writer)
pub async fn migrate_channel_ideas(
    store: &ChannelStore,
    idea_store: &dyn aeqi_core::traits::IdeaStore,
) -> Result<usize> {
    if is_migration_applied(&store.db, CHANNELS_FROM_IDEAS_MIGRATION).await? {
        return Ok(0);
    }
    // Propagate errors instead of swallowing with `.unwrap_or_default()` —
    // an idea-store outage at boot should fail loudly, not silently skip
    // migration and then happily mark it done.
    let ideas = idea_store
        .search_by_prefix("channel:", 200)
        .context("failed to scan ideas for channel:* migration")?;
    let mut migrated = 0usize;
    for idea in ideas {
        let Some(agent_id) = idea.agent_id.clone() else {
            warn!(name = %idea.name, "channel:* idea with no agent_id, skipping");
            continue;
        };
        let kind_str = idea.name.strip_prefix("channel:").unwrap_or("");
        let Some(kind) = ChannelKind::parse(kind_str) else {
            warn!(name = %idea.name, "unknown channel kind, skipping");
            continue;
        };
        let legacy = match parse_legacy_config(kind, &idea.content) {
            Ok(c) => c,
            Err(e) => {
                warn!(name = %idea.name, error = %e, "failed to parse legacy channel config");
                continue;
            }
        };
        let new = NewChannel {
            agent_id: agent_id.clone(),
            config: legacy.config,
        };
        let channel = match store.replace(&new).await {
            Ok(c) => c,
            Err(e) => {
                // Don't abort the whole batch on one bad row — match the per-item
                // best-effort convention used elsewhere in this loop.
                warn!(name = %idea.name, error = %e, "channel replace failed during migration");
                continue;
            }
        };
        // Copy the legacy inline whitelist into the new allowed_chats table.
        if !legacy.allowed_chats.is_empty() {
            let chat_ids: Vec<String> =
                legacy.allowed_chats.iter().map(|n| n.to_string()).collect();
            if let Err(e) = store.set_allowed_chats(&channel.id, &chat_ids).await {
                warn!(channel_id = %channel.id, error = %e, "failed to migrate allowed_chats");
            }
        }
        // Delete the source idea so the migration is one-way.
        if let Err(e) = idea_store.delete(&idea.id).await {
            warn!(id = %idea.id, error = %e, "failed to delete migrated channel idea");
        } else {
            migrated += 1;
            info!(agent_id = %agent_id, kind = %kind.as_str(), "migrated channel:* idea to channels table");
        }
    }
    mark_migration_applied(&store.db, CHANNELS_FROM_IDEAS_MIGRATION).await?;
    Ok(migrated)
}

/// One-shot migration: for every channel row whose config blob still has an
/// inline `allowed_chats` array (pre-B2 writes), move those ids into the
/// `channel_allowed_chats` table and strip the field from the blob. Idempotent
/// via `applied_migrations`. Safe to run even if no rows have inline chats.
pub async fn migrate_inline_allowed_chats(store: &ChannelStore) -> Result<usize> {
    if is_migration_applied(&store.db, INLINE_ALLOWED_CHATS_MIGRATION).await? {
        return Ok(0);
    }
    // Collect (id, raw_config_json) pairs, then process outside the lock so
    // `set_allowed_chats` can re-acquire the connection.
    let rows: Vec<(String, String)> = {
        let conn = store.db.lock().await;
        let mut stmt = conn.prepare("SELECT id, config FROM channels")?;
        let iter = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        iter.collect::<std::result::Result<Vec<_>, _>>()?
    };
    let mut migrated = 0usize;
    for (id, raw) in rows {
        let mut value: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                warn!(channel_id = %id, error = %e, "skipping channel with unparseable config");
                continue;
            }
        };
        let Some(obj) = value.as_object_mut() else {
            continue;
        };
        let Some(arr) = obj.remove("allowed_chats") else {
            continue; // nothing to extract
        };
        let chat_ids: Vec<String> = match arr {
            serde_json::Value::Array(items) => items
                .iter()
                .filter_map(|v| match v {
                    serde_json::Value::String(s) => Some(s.clone()),
                    serde_json::Value::Number(n) => Some(n.to_string()),
                    _ => None,
                })
                .collect(),
            _ => continue,
        };
        // One transaction for the chats-write AND the blob-strip, so a crash
        // can't leave the row half-migrated. On re-run, `applied_migrations`
        // won't be set yet, so we'd reprocess — with the single-tx guarantee
        // the reprocess is clean (either both committed or neither did).
        let new_raw = serde_json::to_string(&value)?;
        if let Err(e) = store
            .extract_inline_allowed_chats_tx(&id, &chat_ids, &new_raw)
            .await
        {
            warn!(channel_id = %id, error = %e, "failed to migrate inline allowed_chats");
            continue;
        }
        migrated += 1;
        info!(channel_id = %id, count = chat_ids.len(), "extracted inline allowed_chats");
    }
    mark_migration_applied(&store.db, INLINE_ALLOWED_CHATS_MIGRATION).await?;
    Ok(migrated)
}

async fn is_migration_applied(db: &ConnectionPool, name: &str) -> Result<bool> {
    let conn = db.lock().await;
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM applied_migrations WHERE name = ?1",
        params![name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

async fn mark_migration_applied(db: &ConnectionPool, name: &str) -> Result<()> {
    let conn = db.lock().await;
    conn.execute(
        "INSERT OR IGNORE INTO applied_migrations (name, applied_at) VALUES (?1, ?2)",
        params![name, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

/// Legacy config bundle: the typed config *plus* any inline allowed_chats
/// array that used to live in the JSON blob. Returned from the legacy-idea
/// migration so we can write both sides in one pass.
struct LegacyConfig {
    config: ChannelConfig,
    allowed_chats: Vec<i64>,
}

fn parse_legacy_config(kind: ChannelKind, content: &str) -> Result<LegacyConfig> {
    let v: serde_json::Value = serde_json::from_str(content)?;
    let allowed_chats = v
        .get("allowed_chats")
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_i64()).collect::<Vec<_>>())
        .unwrap_or_default();
    let config = match kind {
        ChannelKind::Telegram => {
            // Accept either `token` (daemon's shape) or `bot_token` (UI's shape).
            let token = v
                .get("token")
                .or_else(|| v.get("bot_token"))
                .and_then(|x| x.as_str())
                .context("telegram config missing token/bot_token")?
                .to_string();
            ChannelConfig::Telegram(TelegramConfig { token })
        }
        ChannelKind::Discord => ChannelConfig::Discord(serde_json::from_value(v)?),
        ChannelKind::Slack => ChannelConfig::Slack(serde_json::from_value(v)?),
        ChannelKind::Whatsapp => ChannelConfig::Whatsapp(serde_json::from_value(v)?),
    };
    Ok(LegacyConfig {
        config,
        allowed_chats,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use aeqi_core::traits::{Idea, IdeaQuery, IdeaStore};
    use std::sync::Mutex;

    async fn test_registry() -> AgentRegistry {
        let dir = tempfile::tempdir().unwrap();
        AgentRegistry::open(dir.path()).unwrap()
    }

    fn tg(token: &str) -> ChannelConfig {
        ChannelConfig::Telegram(TelegramConfig {
            token: token.into(),
        })
    }

    /// In-memory IdeaStore that seeds a prefix-searchable set and tracks
    /// which ids got deleted during the migration. No FTS, no scoring —
    /// just enough for the migration's read/delete flow.
    struct FakeIdeaStore {
        ideas: Mutex<Vec<Idea>>,
        deleted: Mutex<Vec<String>>,
    }

    impl FakeIdeaStore {
        fn new(ideas: Vec<Idea>) -> Self {
            Self {
                ideas: Mutex::new(ideas),
                deleted: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait::async_trait]
    impl IdeaStore for FakeIdeaStore {
        async fn store(
            &self,
            _name: &str,
            _content: &str,
            _tags: &[String],
            _agent_id: Option<&str>,
        ) -> anyhow::Result<String> {
            Ok("stub".into())
        }
        async fn search(&self, _query: &IdeaQuery) -> anyhow::Result<Vec<Idea>> {
            Ok(Vec::new())
        }
        fn search_by_prefix(&self, prefix: &str, _limit: usize) -> anyhow::Result<Vec<Idea>> {
            Ok(self
                .ideas
                .lock()
                .unwrap()
                .iter()
                .filter(|i| i.name.starts_with(prefix))
                .cloned()
                .collect())
        }
        async fn delete(&self, id: &str) -> anyhow::Result<()> {
            self.deleted.lock().unwrap().push(id.to_string());
            self.ideas.lock().unwrap().retain(|i| i.id != id);
            Ok(())
        }
        fn name(&self) -> &str {
            "fake"
        }
    }

    fn legacy_idea(id: &str, agent_id: &str, kind: &str, content: &str) -> Idea {
        Idea {
            id: id.into(),
            name: format!("channel:{kind}"),
            content: content.into(),
            tags: vec![],
            agent_id: Some(agent_id.into()),
            created_at: Utc::now(),
            session_id: None,
            score: 1.0,
            injection_mode: None,
            inheritance: "self".into(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        }
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

    /// First call migrates the legacy idea; second call is a cheap no-op
    /// because the `applied_migrations` row blocks re-entry. This is what
    /// stops the daemon from re-scanning ideas on every boot forever.
    #[tokio::test]
    async fn migrate_channel_ideas_runs_exactly_once() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        let idea = legacy_idea(
            "i1",
            &alice.id,
            "telegram",
            r#"{"token":"legacy-token","allowed_chats":[]}"#,
        );
        // Plant a ghost idea that would get re-migrated on every boot if the
        // done-marker weren't in place.
        let idea_store = FakeIdeaStore::new(vec![idea]);

        // First run: migrates the one idea.
        let n = migrate_channel_ideas(&store, &idea_store).await.unwrap();
        assert_eq!(n, 1);
        assert_eq!(idea_store.deleted.lock().unwrap().len(), 1);

        // Simulate a stray legacy idea appearing AFTER the migration was
        // marked done (e.g. a buggy caller writes one). The marker means we
        // don't touch it — it stays in the idea store, where an observer
        // can notice and clean up. Without the marker, the migration would
        // happily keep sucking channel:* ideas into the channels table on
        // every boot indefinitely.
        idea_store.ideas.lock().unwrap().push(legacy_idea(
            "i2",
            &alice.id,
            "telegram",
            r#"{"token":"ghost-token"}"#,
        ));

        let n2 = migrate_channel_ideas(&store, &idea_store).await.unwrap();
        assert_eq!(n2, 0, "marker should short-circuit subsequent runs");
        // The ghost idea was not deleted.
        assert_eq!(idea_store.deleted.lock().unwrap().len(), 1);
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

    /// Legacy channel rows written pre-B2 carried `allowed_chats` inline in
    /// the config blob. The one-shot extraction migration must lift them into
    /// the `channel_allowed_chats` table and strip the field from the blob,
    /// and must not run twice.
    #[tokio::test]
    async fn migrate_inline_allowed_chats_extracts_and_is_idempotent() {
        let reg = test_registry().await;
        let alice = reg.spawn("alice", None, None, None).await.unwrap();
        let store = ChannelStore::new(reg.db());

        // Insert a pre-B2 shape directly: valid telegram config PLUS inline
        // `allowed_chats`. Serde would ignore the field on read, but the
        // bytes are still sitting in the column.
        {
            let db = reg.db();
            let conn = db.lock().await;
            conn.execute(
                "INSERT INTO channels (id, agent_id, kind, config, enabled, created_at)
                 VALUES ('legacy-row', ?1, 'telegram',
                   '{\"kind\":\"telegram\",\"token\":\"t\",\"allowed_chats\":[\"111\",222]}',
                   1, '2026-01-01T00:00:00Z')",
                params![alice.id],
            )
            .unwrap();
        }

        let n = migrate_inline_allowed_chats(&store).await.unwrap();
        assert_eq!(n, 1);

        let chats = store.list_allowed_chats("legacy-row").await.unwrap();
        let mut sorted = chats.clone();
        sorted.sort();
        assert_eq!(sorted, vec!["111".to_string(), "222".to_string()]);

        // Blob no longer carries allowed_chats — so a subsequent run is a no-op.
        let raw: String = {
            let db = reg.db();
            let conn = db.lock().await;
            conn.query_row(
                "SELECT config FROM channels WHERE id = 'legacy-row'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert!(
            !raw.contains("allowed_chats"),
            "config blob should be stripped, got: {raw}"
        );

        let n2 = migrate_inline_allowed_chats(&store).await.unwrap();
        assert_eq!(n2, 0, "marker should short-circuit subsequent runs");
    }
}
