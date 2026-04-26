//! Persistent Session Store — SQLite-backed session history
//! that survives daemon restarts.
//!
//! Uses a shared connection pool from AgentRegistry (aeqi.db).
//! Sessions will move to sessions.db in the template/state split.

use aeqi_core::InjectedMessage;
use aeqi_core::traits::PendingMessageSource;
use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::debug;

/// A single session message.
#[derive(Debug, Clone)]
pub struct SessionMessage {
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub source: Option<String>,
}

/// One row of the director-inbox query — a session that has fired
/// `question.ask` and is currently waiting on a human reply. Returned raw
/// from `SessionStore::list_awaiting`; the IPC layer joins the agent name
/// and walks the parent chain to the root agent before serializing for
/// the wire.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwaitingSessionRow {
    pub session_id: String,
    pub agent_id: Option<String>,
    pub session_name: String,
    pub awaiting_subject: Option<String>,
    pub awaiting_at: String,
    pub last_agent_message: Option<String>,
}

/// A session with UUID addressing.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub agent_id: Option<String>,
    pub session_type: String,
    pub name: String,
    pub status: String,
    pub created_at: String,
    pub closed_at: Option<String>,
    pub parent_id: Option<String>,
    pub quest_id: Option<String>,
    pub first_message: Option<String>,
}

/// A single typed thread event in a session timeline.
#[derive(Debug, Clone)]
pub struct ThreadEvent {
    pub id: i64,
    pub session_id: String,
    pub event_type: String,
    pub role: String,
    pub content: String,
    pub timestamp: DateTime<Utc>,
    pub source: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub sender_id: Option<String>,
    pub transport: Option<String>,
}

/// A tool-call trace extracted from a quest's sessions — the read-side
/// primitive for the closed learning loop. Each row corresponds to one
/// completed tool invocation inside a session linked to the given quest.
///
/// The shape matches the `tool_complete` metadata already persisted in
/// `session_messages` by the orchestrator's chat-stream consumer, so no
/// new emission site is required.
#[derive(Debug, Clone, Serialize)]
pub struct ToolTrace {
    pub session_id: String,
    pub tool_name: String,
    pub tool_use_id: Option<String>,
    pub success: Option<bool>,
    pub input_preview: Option<String>,
    pub output_preview: Option<String>,
    pub duration_ms: Option<u64>,
    pub timestamp: DateTime<Utc>,
}

/// A sender identity — who sent a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sender {
    pub id: String,
    pub transport: String,
    pub transport_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub account_id: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// A row from `event_invocations` — top-level record for one pattern dispatch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventInvocationRow {
    pub id: i64,
    pub session_id: String,
    pub pattern: String,
    pub event_name: Option<String>,
    pub caller_kind: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,
    pub error: Option<String>,
    pub tool_calls_json: String,
    /// Optional quality signal in `[0.0, 1.0]` recorded by the dispatcher when a
    /// tool result carried `outcome_score`. NULL on legacy rows and on
    /// invocations whose tools did not opt in. T1.2 of the universality plan.
    pub outcome_score: Option<f64>,
    /// Free-form details paired with `outcome_score`. NULL when the dispatcher
    /// has nothing to record.
    pub outcome_details: Option<String>,
}

/// A row from `event_invocation_steps` — one tool call within an invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvocationStepRow {
    pub id: i64,
    pub invocation_id: i64,
    pub step_index: i64,
    pub tool_name: String,
    pub args_json: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub result_summary: Option<String>,
    pub status: String,
    pub error: Option<String>,
}

/// An execution trace entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTrace {
    pub id: i64,
    pub session_id: String,
    pub trace_type: String,
    pub agent_id: Option<String>,
    pub content: String,
    pub created_at: String,
    pub metadata: Option<serde_json::Value>,
}

/// A claimed pending message — returned by `claim_next_pending`.
/// While this row exists in 'running' state it is the per-session
/// execution lease. Deletion (via `delete_pending`) releases the lease.
#[derive(Debug, Clone)]
pub struct PendingClaim {
    pub id: i64,
    pub payload: String,
}

/// Persistent session store backed by SQLite.
pub struct SessionStore {
    db: Arc<crate::agent_registry::ConnectionPool>,
    /// Max messages per session before auto-summarization kicks in.
    pub max_messages_per_chat: usize,
}

/// Idempotent migration that creates the FTS5 mirror over `session_messages`
/// — `messages_fts` plus the `session_messages_ai/ad/au` sync triggers — and
/// backfills the index on legacy DBs that have rows in `session_messages`
/// but an empty FTS index.
///
/// Runs at daemon startup alongside [`ensure_invocation_outcome_columns`].
/// Safe to call multiple times: every CREATE uses `IF NOT EXISTS`, and the
/// backfill is gated on the index actually being empty.
///
/// Tokeniser pinned to `unicode61 remove_diacritics 2` so accented variants
/// match plain ASCII queries (e.g. `cafe` → `café`). Legacy DBs that already
/// have a `messages_fts` table without that tokeniser keep their existing
/// table — `IF NOT EXISTS` is non-destructive on purpose; rebuilding the
/// vtable would risk losing rows that the triggers haven't yet synced.
pub fn ensure_messages_fts(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
             content,
             content='session_messages',
             content_rowid='id',
             tokenize='unicode61 remove_diacritics 2'
         );
         CREATE TRIGGER IF NOT EXISTS session_messages_ai AFTER INSERT ON session_messages BEGIN
             INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
         END;
         CREATE TRIGGER IF NOT EXISTS session_messages_ad AFTER DELETE ON session_messages BEGIN
             INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
         END;
         CREATE TRIGGER IF NOT EXISTS session_messages_au AFTER UPDATE ON session_messages BEGIN
             INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
             INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
         END;",
    )
    .context("failed to create messages_fts virtual table + triggers")?;

    // One-time backfill: only runs when the FTS index is empty AND there
    // are messages to mirror. The triggers above keep the index in sync
    // from this point forward, so this branch is skipped on every
    // subsequent startup.
    let fts_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM messages_fts", [], |row| row.get(0))?;
    let messages_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM session_messages", [], |row| {
            row.get(0)
        })?;
    if fts_count == 0 && messages_count > 0 {
        conn.execute(
            "INSERT INTO messages_fts(rowid, content) \
             SELECT id, content FROM session_messages",
            [],
        )
        .context("failed to backfill messages_fts from session_messages")?;
        debug!(rows = messages_count, "messages_fts backfilled");
    }

    Ok(())
}

/// Idempotent migration that adds the T1.2 outcome columns
/// (`outcome_score REAL`, `outcome_details TEXT`) to legacy `event_invocations`
/// tables. Fresh DBs already get the columns from `create_invocation_tables`'s
/// CREATE TABLE — this helper exists for DBs that were created before T1.2
/// landed. Pure ADD COLUMN, never destructive.
fn ensure_invocation_outcome_columns(conn: &Connection) -> rusqlite::Result<()> {
    let cols: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(event_invocations)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.contains("outcome_score") {
        conn.execute(
            "ALTER TABLE event_invocations ADD COLUMN outcome_score REAL",
            [],
        )?;
    }
    if !cols.contains("outcome_details") {
        conn.execute(
            "ALTER TABLE event_invocations ADD COLUMN outcome_details TEXT",
            [],
        )?;
    }
    Ok(())
}

/// Idempotent migration that adds the director-inbox columns
/// (`awaiting_at TEXT`, `awaiting_subject TEXT`) and the partial inbox index
/// to the `sessions` table. This helper is the sole source of truth for those
/// columns: `create_tables` no longer declares them inline, mirroring the
/// `can_self_delegate` precedent. Both columns are nullable; on a legacy DB
/// existing rows become NULL with no further work, and on a fresh DB the
/// helper runs immediately after `CREATE TABLE` so the schema converges.
fn ensure_session_awaiting_columns(conn: &Connection) -> rusqlite::Result<()> {
    let cols: std::collections::HashSet<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.contains("awaiting_at") {
        conn.execute("ALTER TABLE sessions ADD COLUMN awaiting_at TEXT", [])?;
    }
    if !cols.contains("awaiting_subject") {
        conn.execute("ALTER TABLE sessions ADD COLUMN awaiting_subject TEXT", [])?;
    }
    // The partial index is idempotent (`CREATE INDEX IF NOT EXISTS`) — safe to
    // run on every boot. Lives here rather than in the CREATE TABLE batch so a
    // legacy DB that skipped the batch's `CREATE INDEX` still gets it.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sess_awaiting ON sessions(awaiting_at) \
         WHERE awaiting_at IS NOT NULL",
        [],
    )?;
    Ok(())
}

impl SessionStore {
    /// Create a SessionStore sharing a connection pool (from AgentRegistry).
    pub fn new(db: Arc<crate::agent_registry::ConnectionPool>) -> Self {
        Self {
            db,
            max_messages_per_chat: 30,
        }
    }

    /// Borrow the underlying connection pool. Used by the `sessions.search`
    /// tool (and only by tools that need to issue SQL the public API doesn't
    /// already cover) — public accessor rather than a friend-style hack.
    pub fn db(&self) -> Arc<crate::agent_registry::ConnectionPool> {
        self.db.clone()
    }

    /// Create the session-related tables and indexes. Called during AgentRegistry::open().
    pub fn create_tables(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS session_messages (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 chat_id INTEGER,
                 session_id TEXT,
                 role TEXT NOT NULL,
                 content TEXT NOT NULL,
                 timestamp TEXT NOT NULL,
                 summarized INTEGER DEFAULT 0,
                 source TEXT DEFAULT NULL,
                 event_type TEXT NOT NULL DEFAULT 'message',
                 metadata TEXT DEFAULT NULL,
                 sender_id TEXT,
                 transport TEXT DEFAULT 'unknown'
             );
             CREATE INDEX IF NOT EXISTS idx_session_msgs_session ON session_messages(session_id);
             CREATE INDEX IF NOT EXISTS idx_session_msgs_ts ON session_messages(timestamp);
             CREATE INDEX IF NOT EXISTS idx_session_msgs_chat ON session_messages(chat_id);

             CREATE TABLE IF NOT EXISTS session_summaries (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 chat_id INTEGER,
                 session_id TEXT,
                 summary TEXT NOT NULL,
                 covers_until TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_summ_session ON session_summaries(session_id);

             CREATE TABLE IF NOT EXISTS sessions (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT,
                 session_type TEXT NOT NULL,
                 name TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'active',
                 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                 closed_at TEXT,
                 parent_id TEXT,
                 quest_id TEXT,
                 first_message TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_sess_agent ON sessions(agent_id);
             CREATE INDEX IF NOT EXISTS idx_sess_type ON sessions(session_type);
             CREATE INDEX IF NOT EXISTS idx_sess_parent ON sessions(parent_id);
             CREATE INDEX IF NOT EXISTS idx_sess_quest ON sessions(quest_id);

             CREATE TABLE IF NOT EXISTS senders (
                 id           TEXT PRIMARY KEY,
                 transport    TEXT NOT NULL,
                 transport_id TEXT NOT NULL,
                 display_name TEXT NOT NULL,
                 avatar_url   TEXT,
                 account_id   TEXT,
                 metadata     TEXT,
                 created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                 last_seen_at TEXT,
                 UNIQUE(transport, transport_id)
             );
             CREATE INDEX IF NOT EXISTS idx_sender_transport ON senders(transport, transport_id);

             CREATE TABLE IF NOT EXISTS session_traces (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL,
                 trace_type TEXT NOT NULL,
                 agent_id   TEXT,
                 content    TEXT NOT NULL DEFAULT '',
                 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                 metadata   TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_st_session ON session_traces(session_id);

             CREATE TABLE IF NOT EXISTS session_gateways (
                 id           TEXT PRIMARY KEY,
                 session_id   TEXT NOT NULL,
                 gateway_type TEXT NOT NULL,
                 config       TEXT NOT NULL DEFAULT '{}',
                 status       TEXT NOT NULL DEFAULT 'active',
                 created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                 updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );
             CREATE INDEX IF NOT EXISTS idx_sg_session ON session_gateways(session_id);

             CREATE TABLE IF NOT EXISTS pending_messages (
                 id         INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL,
                 payload    TEXT NOT NULL,
                 status     TEXT NOT NULL DEFAULT 'queued',
                 created_at INTEGER NOT NULL,
                 started_at INTEGER
             );
             CREATE INDEX IF NOT EXISTS idx_pending_session_status
                 ON pending_messages(session_id, status, id);",
        )
        .context("failed to create session store tables")?;

        Self::create_invocation_tables(conn)?;

        ensure_messages_fts(conn).context("failed to ensure messages_fts table + triggers")?;

        debug!("session store tables created");

        Ok(())
    }

    /// Create the event invocation tracing tables.
    /// Called from `create_tables` so they are always present.
    ///
    /// `outcome_score` and `outcome_details` were added by T1.2 of the
    /// universality plan as optional, additive quality-signal columns. They are
    /// NULL by default and only populated when an event tool returns the
    /// matching fields on its `ToolResult`. Legacy DBs catch up via
    /// `ensure_invocation_outcome_columns`.
    pub fn create_invocation_tables(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS event_invocations (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 session_id TEXT NOT NULL,
                 pattern TEXT NOT NULL,
                 event_name TEXT,
                 caller_kind TEXT NOT NULL,
                 started_at TEXT NOT NULL,
                 finished_at TEXT,
                 status TEXT NOT NULL,
                 error TEXT,
                 tool_calls_json TEXT NOT NULL,
                 outcome_score REAL,
                 outcome_details TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_event_invocations_session
                 ON event_invocations(session_id, started_at DESC);

             CREATE TABLE IF NOT EXISTS event_invocation_steps (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 invocation_id INTEGER NOT NULL REFERENCES event_invocations(id),
                 step_index INTEGER NOT NULL,
                 tool_name TEXT NOT NULL,
                 args_json TEXT NOT NULL,
                 started_at TEXT NOT NULL,
                 finished_at TEXT,
                 result_summary TEXT,
                 status TEXT NOT NULL,
                 error TEXT
             );",
        )
        .context("failed to create event invocation tables")?;

        ensure_invocation_outcome_columns(conn)
            .context("failed to ensure outcome columns on event_invocations")?;
        ensure_session_awaiting_columns(conn)
            .context("failed to ensure awaiting columns on sessions")?;
        Ok(())
    }

    // ── Pending message queue (per-session FIFO, DB-backed lease) ──

    /// Enqueue a pending message for a session. Returns the new row id.
    /// The payload is opaque JSON — the executor deserializes it.
    ///
    /// Side effect: if the payload looks user-originated (kind is null /
    /// "chat" / "user_reply") AND the session currently has `awaiting_at`
    /// set, the awaiting bit is cleared atomically in the same
    /// transaction. This closes the stale-inbox-row hole when a director
    /// answers an awaiting session by typing in the regular chat composer
    /// instead of the inbox-page inline reply. Quest re-enqueues
    /// (`kind == "quest"`) deliberately do NOT clear — they're the agent
    /// continuing its own work, not a human responding.
    pub async fn enqueue_pending(&self, session_id: &str, payload: &str) -> Result<i64> {
        let mut db = self.db.lock().await;
        let now = Utc::now().timestamp();
        let tx = db.transaction()?;
        tx.execute(
            "INSERT INTO pending_messages (session_id, payload, status, created_at) \
             VALUES (?1, ?2, 'queued', ?3)",
            params![session_id, payload, now],
        )
        .context("failed to enqueue pending message")?;
        let id = tx.last_insert_rowid();
        // Peek at the payload kind; null/chat/user_reply count as user-
        // originated. Quest re-enqueues are excluded. Parse failures are
        // treated as user-originated (legacy raw-string payloads were the
        // chat path).
        let user_originated = match crate::queue_executor::QueuedMessage::from_payload(payload) {
            Ok(qm) => !qm.is_quest(),
            Err(_) => true,
        };
        if user_originated {
            tx.execute(
                "UPDATE sessions SET awaiting_at = NULL, awaiting_subject = NULL \
                 WHERE id = ?1 AND awaiting_at IS NOT NULL",
                params![session_id],
            )?;
        }
        tx.commit()?;
        Ok(id)
    }

    /// Atomically claim the next queued message for a session, iff no other
    /// message is currently in 'running' state for that session. Returns
    /// `(id, payload)` on success, `None` if nothing to run right now.
    ///
    /// This is the sole serialization point per session: the `NOT EXISTS`
    /// subquery guarantees at most one 'running' row per session_id.
    pub async fn claim_next_pending(&self, session_id: &str) -> Result<Option<PendingClaim>> {
        let db = self.db.lock().await;
        let now = Utc::now().timestamp();
        let mut stmt = db.prepare(
            "UPDATE pending_messages \
             SET status = 'running', started_at = ?1 \
             WHERE id = ( \
                 SELECT id FROM pending_messages p1 \
                 WHERE p1.session_id = ?2 AND p1.status = 'queued' \
                   AND NOT EXISTS ( \
                       SELECT 1 FROM pending_messages p2 \
                       WHERE p2.session_id = p1.session_id AND p2.status = 'running' \
                   ) \
                 ORDER BY id LIMIT 1 \
             ) \
             RETURNING id, payload",
        )?;
        let mut rows = stmt.query(params![now, session_id])?;
        if let Some(row) = rows.next()? {
            let id: i64 = row.get(0)?;
            let payload: String = row.get(1)?;
            Ok(Some(PendingClaim { id, payload }))
        } else {
            Ok(None)
        }
    }

    /// Delete a pending row after its execution completes (success or
    /// handled failure). The row acts as the per-session lease while it
    /// exists in 'running' state — deletion releases the lease.
    pub async fn delete_pending(&self, id: i64) -> Result<()> {
        let db = self.db.lock().await;
        db.execute("DELETE FROM pending_messages WHERE id = ?1", params![id])
            .context("failed to delete pending message")?;
        Ok(())
    }

    /// Atomically claim all `queued` pending rows for `session_id` whose id
    /// is strictly greater than `since_id` (or all queued rows when `since_id`
    /// is `None`). Claimed rows are DELETEd so the main drain loop cannot also
    /// pick them up for the next turn.
    ///
    /// Called at each agent step boundary for mid-turn user-message injection.
    /// The `since_id` watermark prevents double-consuming the row that started
    /// the current turn (which the drain loop already DELETEd via
    /// [`delete_pending`]).
    pub async fn claim_pending_for_session(
        &self,
        session_id: &str,
        since_id: Option<i64>,
    ) -> Result<Vec<InjectedMessage>> {
        let db = self.db.lock().await;
        let threshold = since_id.unwrap_or(i64::MIN);
        let mut stmt = db.prepare(
            "DELETE FROM pending_messages \
             WHERE id IN ( \
                 SELECT id FROM pending_messages \
                 WHERE session_id = ?1 AND status = 'queued' AND id > ?2 \
                 ORDER BY id \
             ) \
             RETURNING id, payload",
        )?;
        let rows = stmt
            .query_map(params![session_id, threshold], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        // Mid-turn step-boundary injection (consumed in `agent::run`) writes
        // `content` directly into a `Role::User` message. Pre-fix this method
        // returned the raw `payload` JSON, which meant the LLM saw the
        // `QueuedMessage` envelope instead of the user's words. Parse here
        // and surface the inner text. Legacy raw-string payloads (test
        // fixtures, old daemon writes) fall back to the literal payload so
        // forward-compat is preserved.
        Ok(rows
            .into_iter()
            .map(|(id, payload)| {
                let content = match crate::queue_executor::QueuedMessage::from_payload(&payload) {
                    Ok(qm) => qm.message,
                    Err(_) => payload,
                };
                InjectedMessage { id, content }
            })
            .collect())
    }

    /// Return distinct session_ids that have at least one 'queued' row.
    /// Used at daemon startup to resume drain after a crash.
    pub async fn sessions_with_queued(&self) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt =
            db.prepare("SELECT DISTINCT session_id FROM pending_messages WHERE status = 'queued'")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Recover from a daemon crash: delete any orphaned 'running' rows.
    /// Returns the number of rows dropped. Agent runs have side effects
    /// (tool calls, external APIs) — replaying them is usually wrong, so
    /// the default policy is drop-and-log rather than requeue.
    pub async fn recover_orphaned_running(&self) -> Result<usize> {
        let db = self.db.lock().await;
        let n = db.execute("DELETE FROM pending_messages WHERE status = 'running'", [])?;
        Ok(n)
    }

    // ── Legacy chat_id methods (used by message_router / Telegram pipeline) ──

    /// Record a message in a conversation (legacy chat_id path).
    pub async fn record(&self, chat_id: i64, role: &str, content: &str) -> Result<()> {
        self.record_with_source(chat_id, role, content, None).await
    }

    /// Record a message with source tag (legacy chat_id path).
    pub async fn record_with_source(
        &self,
        chat_id: i64,
        role: &str,
        content: &str,
        source: Option<&str>,
    ) -> Result<()> {
        self.record_event(chat_id, "message", role, content, source, None)
            .await
    }

    /// Record a typed event in a conversation timeline (legacy chat_id path).
    pub async fn record_event(
        &self,
        chat_id: i64,
        event_type: &str,
        role: &str,
        content: &str,
        source: Option<&str>,
        metadata: Option<&serde_json::Value>,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        let metadata_text = metadata.map(serde_json::Value::to_string);
        db.execute(
            "INSERT INTO session_messages (chat_id, role, content, timestamp, source, event_type, metadata) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![chat_id, role, content, now, source, event_type, metadata_text],
        )
        .context("failed to insert session message")?;
        Ok(())
    }

    /// Get recent messages for a chat (legacy chat_id path).
    pub async fn recent(&self, chat_id: i64, limit: usize) -> Result<Vec<SessionMessage>> {
        self.recent_with_offset(chat_id, limit, 0).await
    }

    /// Get messages for a chat with offset-based pagination (legacy chat_id path).
    pub async fn recent_with_offset(
        &self,
        chat_id: i64,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<SessionMessage>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT chat_id, role, content, timestamp, source FROM session_messages \
             WHERE chat_id = ?1 AND summarized = 0 AND event_type = 'message' \
             ORDER BY id DESC LIMIT ?2 OFFSET ?3",
        )?;

        let rows = stmt
            .query_map(params![chat_id, limit as i64, offset as i64], |row| {
                let cid: i64 = row.get(0)?;
                Ok(SessionMessage {
                    session_id: cid.to_string(),
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get::<_, String>(3).map(|s| {
                        DateTime::parse_from_rfc3339(&s)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now())
                    })?,
                    source: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Reverse to chronological order.
        let mut messages = rows;
        messages.reverse();
        Ok(messages)
    }

    /// Get conversation context formatted as a string (for injection into task descriptions).
    pub async fn context_string(&self, chat_id: i64, limit: usize) -> Result<String> {
        let messages = self.recent(chat_id, limit).await?;
        if messages.is_empty() {
            return Ok(String::new());
        }

        // Prepend any summary if available.
        let db = self.db.lock().await;
        let summary: Option<String> = db
            .query_row(
                "SELECT summary FROM session_summaries WHERE chat_id = ?1 ORDER BY id DESC LIMIT 1",
                params![chat_id],
                |row| row.get(0),
            )
            .ok();
        drop(db);

        let mut ctx = String::from("## Conversation History\n\n");

        if let Some(ref s) = summary {
            ctx.push_str(&format!("*Earlier context:* {s}\n\n"));
        }

        for msg in &messages {
            ctx.push_str(&format!("**{}**: {}\n\n", msg.role, msg.content));
        }

        Ok(ctx)
    }

    /// Full-text search across all transcripts.
    pub async fn search_transcripts(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<SessionMessage>> {
        let db = self.db.lock().await;

        let mut stmt = db.prepare(
            "SELECT sm.session_id, sm.role, sm.content, sm.timestamp, sm.source
             FROM session_messages sm
             WHERE sm.rowid IN (
                 SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?1
             )
             ORDER BY sm.timestamp DESC
             LIMIT ?2",
        )?;

        let messages = stmt
            .query_map(params![query, limit as i64], |row| {
                Ok(SessionMessage {
                    session_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row
                        .get::<_, String>(3)
                        .ok()
                        .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
                        .map(|d| d.with_timezone(&chrono::Utc))
                        .unwrap_or_default(),
                    source: row.get(4).ok(),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(messages)
    }

    /// Count unsummarized messages for a chat (legacy chat_id path).
    pub async fn message_count(&self, chat_id: i64) -> Result<usize> {
        let db = self.db.lock().await;
        let count: i64 = db.query_row(
            "SELECT COUNT(*) FROM session_messages WHERE chat_id = ?1 AND summarized = 0 AND event_type = 'message'",
            params![chat_id],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    /// Store a summary and mark older messages as summarized (legacy chat_id path).
    pub async fn save_summary(
        &self,
        chat_id: i64,
        summary: &str,
        keep_recent: usize,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();

        db.execute(
            "INSERT INTO session_summaries (chat_id, summary, covers_until) VALUES (?1, ?2, ?3)",
            params![chat_id, summary, now],
        )?;

        // Mark all but the most recent `keep_recent` as summarized.
        db.execute(
            "UPDATE session_messages SET summarized = 1 WHERE chat_id = ?1 AND summarized = 0 AND event_type = 'message' \
             AND id NOT IN (SELECT id FROM session_messages WHERE chat_id = ?1 AND summarized = 0 AND event_type = 'message' ORDER BY id DESC LIMIT ?2)",
            params![chat_id, keep_recent as i64],
        )?;

        debug!(chat_id, "session summary saved");
        Ok(())
    }

    /// Evict messages older than the given duration.
    pub async fn evict_older_than(&self, hours: i64) -> Result<usize> {
        let cutoff = (Utc::now() - chrono::TimeDelta::hours(hours)).to_rfc3339();
        let db = self.db.lock().await;

        let deleted: usize = db.execute(
            "DELETE FROM session_messages WHERE timestamp < ?1",
            params![cutoff],
        )?;

        if deleted > 0 {
            debug!(deleted, hours, "evicted old session messages");
        }

        Ok(deleted)
    }

    /// Get typed timeline events for a chat (legacy chat_id path).
    pub async fn timeline(&self, chat_id: i64, limit: usize) -> Result<Vec<ThreadEvent>> {
        self.timeline_with_offset(chat_id, limit, 0).await
    }

    /// Get timeline events for a chat with offset-based pagination (legacy chat_id path).
    pub async fn timeline_with_offset(
        &self,
        chat_id: i64,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<ThreadEvent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, chat_id, event_type, role, content, timestamp, source, metadata \
             FROM session_messages \
             WHERE chat_id = ?1 AND summarized = 0 \
             ORDER BY id DESC LIMIT ?2 OFFSET ?3",
        )?;

        let rows = stmt
            .query_map(params![chat_id, limit as i64, offset as i64], |row| {
                let metadata_text: Option<String> = row.get(7)?;
                let cid: i64 = row.get(1)?;
                Ok(ThreadEvent {
                    id: row.get(0)?,
                    session_id: cid.to_string(),
                    event_type: row.get(2)?,
                    role: row.get(3)?,
                    content: row.get(4)?,
                    timestamp: row.get::<_, String>(5).map(|s| {
                        DateTime::parse_from_rfc3339(&s)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now())
                    })?,
                    source: row.get(6)?,
                    metadata: metadata_text
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok()),
                    sender_id: None,
                    transport: None,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut events = rows;
        events.reverse();
        Ok(events)
    }

    /// Get transcript for a specific task.
    pub async fn task_transcript(
        &self,
        quest_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionMessage>> {
        let channel_name = format!("transcript:task:{}", quest_id);
        let chat_id = named_channel_chat_id(&channel_name);
        self.recent(chat_id, limit).await
    }

    /// Retrieve message history by agent UUID (looks up via sessions table).
    pub async fn get_history_by_agent_id(
        &self,
        agent_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionMessage>> {
        let db = self.db.lock().await;

        // Find session_id for this agent.
        let session_id: Option<String> = db
            .query_row(
                "SELECT id FROM sessions WHERE agent_id = ?1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
                params![agent_id],
                |row| row.get(0),
            )
            .ok();

        let session_id = match session_id {
            Some(id) => id,
            None => {
                // Fallback: try channels table if it exists.
                let chat_id: Option<i64> = db
                    .query_row(
                        "SELECT chat_id FROM channels WHERE agent_id = ?1 LIMIT 1",
                        params![agent_id],
                        |row| row.get(0),
                    )
                    .ok();
                match chat_id {
                    Some(cid) => {
                        drop(db);
                        return self.recent(cid, limit).await;
                    }
                    None => return Ok(Vec::new()),
                }
            }
        };

        let mut stmt = db.prepare(
            "SELECT session_id, role, content, timestamp, source FROM session_messages \
             WHERE session_id = ?1 AND summarized = 0 AND event_type = 'message' \
             ORDER BY id DESC LIMIT ?2",
        )?;

        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                Ok(SessionMessage {
                    session_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get::<_, String>(3).map(|s| {
                        DateTime::parse_from_rfc3339(&s)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now())
                    })?,
                    source: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut messages = rows;
        messages.reverse();
        Ok(messages)
    }

    /// Retrieve full timeline (messages + tool events) by agent UUID.
    pub async fn get_timeline_by_agent_id(
        &self,
        agent_id: &str,
        limit: usize,
    ) -> Result<Vec<ThreadEvent>> {
        let db = self.db.lock().await;

        // Find session_id for this agent.
        let session_id: Option<String> = db
            .query_row(
                "SELECT id FROM sessions WHERE agent_id = ?1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
                params![agent_id],
                |row| row.get(0),
            )
            .ok();

        let session_id = match session_id {
            Some(id) => id,
            None => {
                // Fallback: try channels table.
                let chat_id: Option<i64> = db
                    .query_row(
                        "SELECT chat_id FROM channels WHERE agent_id = ?1 LIMIT 1",
                        params![agent_id],
                        |row| row.get(0),
                    )
                    .ok();
                match chat_id {
                    Some(cid) => {
                        drop(db);
                        return self.timeline(cid, limit).await;
                    }
                    None => return Ok(Vec::new()),
                }
            }
        };
        drop(db);

        self.timeline_by_session(&session_id, limit).await
    }

    // ── Session methods (UUID-based) ──

    /// Record a message by session UUID — inserts directly into session_messages with session_id.
    pub async fn record_by_session(
        &self,
        session_id: &str,
        role: &str,
        content: &str,
        source: Option<&str>,
    ) -> Result<()> {
        self.record_event_by_session(session_id, "message", role, content, source, None)
            .await
    }

    /// Record a typed event by session UUID — inserts directly into session_messages with session_id.
    ///
    /// Accepts optional `sender_id` and `transport` for the new identity model.
    /// When not provided, the columns remain NULL / default.
    pub async fn record_event_by_session(
        &self,
        session_id: &str,
        event_type: &str,
        role: &str,
        content: &str,
        source: Option<&str>,
        metadata: Option<&serde_json::Value>,
    ) -> Result<()> {
        self.record_event_by_session_with_sender(
            session_id, event_type, role, content, source, metadata, None, None,
        )
        .await
    }

    /// Record a typed event with sender identity.
    pub async fn record_event_by_session_with_sender(
        &self,
        session_id: &str,
        event_type: &str,
        role: &str,
        content: &str,
        source: Option<&str>,
        metadata: Option<&serde_json::Value>,
        sender_id: Option<&str>,
        transport: Option<&str>,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        let metadata_text = metadata.map(serde_json::Value::to_string);
        db.execute(
            "INSERT INTO session_messages (session_id, role, content, timestamp, source, event_type, metadata, sender_id, transport) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![session_id, role, content, now, source, event_type, metadata_text, sender_id, transport],
        )
        .context("failed to insert session message by session_id")?;

        // Populate first_message on sessions table when this is the first user message.
        if role == "user" && !content.is_empty() {
            let _ = db.execute(
                "UPDATE sessions SET first_message = ?1 WHERE id = ?2 AND first_message IS NULL",
                params![&content[..content.len().min(200)], session_id],
            );
        }

        Ok(())
    }

    /// Soft-delete the middle messages in a session's transcript by marking them
    /// `summarized = 1`. Preserves the first `preserve_head` messages (by id ASC)
    /// and the last `preserve_tail` messages (by id DESC); everything in between
    /// is marked as summarized and will be excluded from future `history_by_session`
    /// queries.
    ///
    /// Returns the number of rows marked as summarized.
    pub async fn summarize_range_by_session(
        &self,
        session_id: &str,
        preserve_head: usize,
        preserve_tail: usize,
    ) -> Result<usize> {
        let db = self.db.lock().await;
        // Identify the IDs to keep from head (first preserve_head rows by id ASC).
        let head_ids: Vec<i64> = {
            let mut stmt = db.prepare(
                "SELECT id FROM session_messages \
                 WHERE session_id = ?1 AND summarized = 0 AND event_type = 'message' \
                 ORDER BY id ASC LIMIT ?2",
            )?;
            stmt.query_map(params![session_id, preserve_head as i64], |row| row.get(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };

        // Identify the IDs to keep from tail (last preserve_tail rows by id DESC).
        let tail_ids: Vec<i64> = {
            let mut stmt = db.prepare(
                "SELECT id FROM session_messages \
                 WHERE session_id = ?1 AND summarized = 0 AND event_type = 'message' \
                 ORDER BY id DESC LIMIT ?2",
            )?;
            stmt.query_map(params![session_id, preserve_tail as i64], |row| row.get(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };

        // Mark everything NOT in head_ids or tail_ids as summarized.
        // Build the exclusion set.
        let mut keep_ids: Vec<i64> = head_ids;
        keep_ids.extend(tail_ids);
        keep_ids.sort();
        keep_ids.dedup();

        if keep_ids.is_empty() {
            // Mark all non-summarized messages.
            let count = db.execute(
                "UPDATE session_messages SET summarized = 1 \
                 WHERE session_id = ?1 AND summarized = 0 AND event_type = 'message'",
                params![session_id],
            )?;
            return Ok(count);
        }

        // SQLite doesn't support parameterized IN lists easily via rusqlite without
        // manual formatting. Build the NOT IN clause with literal integers (safe:
        // they are i64 values we fetched from the DB, not user input).
        let id_list = keep_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "UPDATE session_messages SET summarized = 1 \
             WHERE session_id = ?1 AND summarized = 0 AND event_type = 'message' \
             AND id NOT IN ({id_list})"
        );
        let count = db.execute(&sql, params![session_id])?;
        Ok(count)
    }

    /// Get message history by session UUID — queries session_messages directly.
    pub async fn history_by_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionMessage>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT session_id, role, content, timestamp, source FROM session_messages \
             WHERE session_id = ?1 AND summarized = 0 AND event_type = 'message' \
             ORDER BY id DESC LIMIT ?2",
        )?;

        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                Ok(SessionMessage {
                    session_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get::<_, String>(3).map(|s| {
                        DateTime::parse_from_rfc3339(&s)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now())
                    })?,
                    source: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut messages = rows;
        messages.reverse();
        Ok(messages)
    }

    /// Get full timeline (messages + tool events) by session UUID — queries session_messages directly.
    pub async fn timeline_by_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<ThreadEvent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, session_id, event_type, role, content, timestamp, source, metadata, sender_id, transport \
             FROM session_messages \
             WHERE session_id = ?1 AND summarized = 0 \
             ORDER BY id DESC LIMIT ?2",
        )?;

        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                let metadata_text: Option<String> = row.get(7)?;
                Ok(ThreadEvent {
                    id: row.get(0)?,
                    session_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    event_type: row.get(2)?,
                    role: row.get(3)?,
                    content: row.get(4)?,
                    timestamp: row.get::<_, String>(5).map(|s| {
                        DateTime::parse_from_rfc3339(&s)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now())
                    })?,
                    source: row.get(6)?,
                    metadata: metadata_text
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok()),
                    sender_id: row.get(8)?,
                    transport: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut events = rows;
        events.reverse();
        Ok(events)
    }

    /// Extract tool-call traces for every session linked to a quest.
    ///
    /// This is the read-side of the closed learning loop: it joins
    /// `sessions.quest_id` against `session_messages` for rows where
    /// `event_type = 'tool_complete'` and unpacks the metadata blob that
    /// the chat-stream consumer wrote when the tool finished executing.
    ///
    /// Returns traces in chronological order across all sessions for the
    /// quest. Callers can group by `tool_name` to produce candidate
    /// skills, or feed the full stream into a summariser.
    pub async fn tool_traces_for_quest(&self, quest_id: &str) -> Result<Vec<ToolTrace>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT sm.session_id, sm.content, sm.timestamp, sm.metadata \
             FROM session_messages sm \
             JOIN sessions s ON sm.session_id = s.id \
             WHERE s.quest_id = ?1 AND sm.event_type = 'tool_complete' AND sm.summarized = 0 \
             ORDER BY sm.id ASC",
        )?;

        let rows = stmt
            .query_map(params![quest_id], |row| {
                let session_id: Option<String> = row.get(0)?;
                let tool_name_fallback: String = row.get(1)?;
                let ts_str: String = row.get(2)?;
                let metadata_text: Option<String> = row.get(3)?;

                let metadata: Option<serde_json::Value> = metadata_text
                    .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());

                let str_from = |key: &str| -> Option<String> {
                    metadata
                        .as_ref()
                        .and_then(|m| m.get(key))
                        .and_then(|v| v.as_str().map(|s| s.to_string()))
                };
                let bool_from = |key: &str| -> Option<bool> {
                    metadata
                        .as_ref()
                        .and_then(|m| m.get(key))
                        .and_then(|v| v.as_bool())
                };
                let u64_from = |key: &str| -> Option<u64> {
                    metadata
                        .as_ref()
                        .and_then(|m| m.get(key))
                        .and_then(|v| v.as_u64())
                };

                Ok(ToolTrace {
                    session_id: session_id.unwrap_or_default(),
                    tool_name: str_from("tool_name").unwrap_or(tool_name_fallback),
                    tool_use_id: str_from("tool_use_id"),
                    success: bool_from("success"),
                    input_preview: str_from("input_preview"),
                    output_preview: str_from("output_preview"),
                    duration_ms: u64_from("duration_ms"),
                    timestamp: DateTime::parse_from_rfc3339(&ts_str)
                        .map(|dt| dt.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now()),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    /// Load tool traces grouped by quest for an agent's recent distinct
    /// quests. Returns up to `limit_quests` most-recent quests (by most-
    /// recent session activity), each paired with its full chronological
    /// trace across every session linked to that quest.
    ///
    /// This is the read-side of the cross-quest learning rule: the caller
    /// mines tool-sequence patterns that recur across quests, not just
    /// within one. Excludes `exclude_quest_id` from the returned set when
    /// supplied (so the caller can combine it with a just-closed quest's
    /// traces without double-counting).
    pub async fn recent_quest_traces(
        &self,
        agent_id: &str,
        limit_quests: usize,
        exclude_quest_id: Option<&str>,
    ) -> Result<Vec<(String, Vec<ToolTrace>)>> {
        let db = self.db.lock().await;

        let mut stmt = db.prepare(
            "SELECT s.quest_id, MAX(sm.id) AS last_trace \
             FROM session_messages sm \
             JOIN sessions s ON sm.session_id = s.id \
             WHERE s.agent_id = ?1 \
               AND s.quest_id IS NOT NULL AND s.quest_id != '' \
               AND sm.event_type = 'tool_complete' AND sm.summarized = 0 \
             GROUP BY s.quest_id \
             ORDER BY last_trace DESC \
             LIMIT ?2",
        )?;
        let quest_ids: Vec<String> = stmt
            .query_map(params![agent_id, limit_quests as i64 + 1], |row| {
                let qid: String = row.get(0)?;
                Ok(qid)
            })?
            .filter_map(|r| r.ok())
            .filter(|qid| exclude_quest_id.is_none_or(|ex| qid != ex))
            .take(limit_quests)
            .collect();
        drop(stmt);

        let mut out: Vec<(String, Vec<ToolTrace>)> = Vec::with_capacity(quest_ids.len());
        for qid in quest_ids {
            let mut stmt = db.prepare(
                "SELECT sm.session_id, sm.content, sm.timestamp, sm.metadata \
                 FROM session_messages sm \
                 JOIN sessions s ON sm.session_id = s.id \
                 WHERE s.quest_id = ?1 AND sm.event_type = 'tool_complete' AND sm.summarized = 0 \
                 ORDER BY sm.id ASC",
            )?;
            let traces = stmt
                .query_map(params![qid], |row| {
                    let session_id: Option<String> = row.get(0)?;
                    let tool_name_fallback: String = row.get(1)?;
                    let ts_str: String = row.get(2)?;
                    let metadata_text: Option<String> = row.get(3)?;

                    let metadata: Option<serde_json::Value> = metadata_text
                        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());

                    let str_from = |key: &str| -> Option<String> {
                        metadata
                            .as_ref()
                            .and_then(|m| m.get(key))
                            .and_then(|v| v.as_str().map(|s| s.to_string()))
                    };
                    let bool_from = |key: &str| -> Option<bool> {
                        metadata
                            .as_ref()
                            .and_then(|m| m.get(key))
                            .and_then(|v| v.as_bool())
                    };
                    let u64_from = |key: &str| -> Option<u64> {
                        metadata
                            .as_ref()
                            .and_then(|m| m.get(key))
                            .and_then(|v| v.as_u64())
                    };

                    Ok(ToolTrace {
                        session_id: session_id.unwrap_or_default(),
                        tool_name: str_from("tool_name").unwrap_or(tool_name_fallback),
                        tool_use_id: str_from("tool_use_id"),
                        success: bool_from("success"),
                        input_preview: str_from("input_preview"),
                        output_preview: str_from("output_preview"),
                        duration_ms: u64_from("duration_ms"),
                        timestamp: DateTime::parse_from_rfc3339(&ts_str)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now()),
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            out.push((qid, traces));
        }

        Ok(out)
    }

    /// List sessions, optionally filtered by agent_id.
    pub async fn list_sessions(
        &self,
        agent_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Session>> {
        let db = self.db.lock().await;

        let (sql, boxed_params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match agent_id {
            Some(aid) => (
                "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, quest_id, first_message \
                 FROM sessions WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT ?2"
                    .to_string(),
                vec![
                    Box::new(aid.to_string()) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(limit as i64),
                ],
            ),
            None => (
                "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, quest_id, first_message \
                 FROM sessions ORDER BY created_at DESC LIMIT ?1"
                    .to_string(),
                vec![Box::new(limit as i64) as Box<dyn rusqlite::types::ToSql>],
            ),
        };

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            boxed_params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = db.prepare(&sql)?;
        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok(Session {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    session_type: row.get(2)?,
                    name: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    closed_at: row.get(6)?,
                    parent_id: row.get(7)?,
                    quest_id: row.get(8)?,
                    first_message: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    }

    /// Create a new session. Returns the session UUID.
    pub async fn create_session(
        &self,
        agent_id: &str,
        session_type: &str,
        name: &str,
        parent_id: Option<&str>,
        quest_id: Option<&str>,
    ) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO sessions (id, agent_id, session_type, name, status, parent_id, quest_id)
             VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)",
            params![id, agent_id, session_type, name, parent_id, quest_id],
        )?;
        Ok(id)
    }

    /// Create a session with a pre-assigned ID (e.g. from channel_sessions).
    pub async fn create_session_with_id(
        &self,
        id: &str,
        agent_id: &str,
        session_type: &str,
        name: &str,
        parent_id: Option<&str>,
        quest_id: Option<&str>,
    ) -> Result<String> {
        let db = self.db.lock().await;
        db.execute(
            "INSERT OR IGNORE INTO sessions (id, agent_id, session_type, name, status, parent_id, quest_id)
             VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?6)",
            params![id, agent_id, session_type, name, parent_id, quest_id],
        )?;
        Ok(id.to_string())
    }

    /// Close a session by setting status to 'closed'.
    pub async fn close_session(&self, session_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "UPDATE sessions SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
             WHERE id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    /// Mark a session as awaiting a human reply. Stamps `awaiting_at` with
    /// the current ISO8601 timestamp and stores a short `subject` line that
    /// the director-inbox UI uses as the row preview.
    ///
    /// Idempotent within a session: re-asking overwrites the prior subject
    /// and refreshes the timestamp. Pairs with [`Self::clear_awaiting`] and
    /// the atomic [`Self::answer_awaiting`].
    pub async fn set_awaiting(&self, session_id: &str, subject: &str) -> Result<()> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        db.execute(
            "UPDATE sessions SET awaiting_at = ?1, awaiting_subject = ?2 WHERE id = ?3",
            params![now, subject, session_id],
        )?;
        Ok(())
    }

    /// Clear the awaiting state on a session — the human has responded (or
    /// the agent has rescinded the question). Non-atomic counterpart used by
    /// recovery / cleanup paths; the inbox-answer hot path uses
    /// [`Self::answer_awaiting`] which clears + enqueues in one transaction.
    pub async fn clear_awaiting(&self, session_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "UPDATE sessions SET awaiting_at = NULL, awaiting_subject = NULL WHERE id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    /// List every session currently awaiting a human reply, optionally
    /// filtered to a specific allow-set of agent ids (platform mode), or
    /// unfiltered (runtime mode).
    ///
    /// Returns raw rows — joining agent name and walking the parent chain to
    /// the root happens at the IPC layer where `AgentRegistry` is in scope.
    /// `last_agent_message` is the most recent assistant message body (or
    /// `None` if the agent fired the ask without ever speaking, which is
    /// possible but rare). Sorted newest-first by `awaiting_at`.
    pub async fn list_awaiting(
        &self,
        allowed_agent_ids: Option<&std::collections::HashSet<String>>,
    ) -> Result<Vec<AwaitingSessionRow>> {
        let db = self.db.lock().await;
        // The partial index on `awaiting_at IS NOT NULL` makes this scan
        // bound by the (small) inbox size, not the full session table.
        let mut stmt = db.prepare(
            "SELECT s.id, s.agent_id, s.name, s.awaiting_subject, s.awaiting_at,
                    (SELECT content FROM session_messages
                     WHERE session_id = s.id AND role = 'assistant'
                     ORDER BY id DESC LIMIT 1) AS last_msg
             FROM sessions s
             WHERE s.awaiting_at IS NOT NULL
             ORDER BY s.awaiting_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(AwaitingSessionRow {
                session_id: row.get(0)?,
                agent_id: row.get::<_, Option<String>>(1)?,
                session_name: row.get(2)?,
                awaiting_subject: row.get(3)?,
                awaiting_at: row.get(4)?,
                last_agent_message: row.get(5)?,
            })
        })?;
        let mut out: Vec<AwaitingSessionRow> = rows.filter_map(|r| r.ok()).collect();
        if let Some(allow) = allowed_agent_ids {
            out.retain(|r| match &r.agent_id {
                Some(id) => allow.contains(id),
                None => false,
            });
        }
        Ok(out)
    }

    /// Atomic "director answers from the inbox" path. In a single
    /// `BEGIN IMMEDIATE` transaction, this:
    ///   1. UPDATEs `sessions` to clear `awaiting_at` IFF it was non-null
    ///   2. If the UPDATE affected zero rows (someone else already answered
    ///      or the session was never awaiting), ROLLBACKs and returns
    ///      `Ok(false)` — the caller MUST treat this as "race lost".
    ///   3. Otherwise INSERTs the supplied payload into `pending_messages`
    ///      with `status='queued'` so the next `claim_and_run_loop` tick
    ///      picks it up as the human's reply, COMMITs, returns `Ok(true)`.
    ///
    /// This is the only place outside `enqueue_pending` that writes to
    /// `pending_messages` — kept dedicated rather than folded into a
    /// general "enqueue and clear" helper because most enqueue paths
    /// (quest re-runs, internal continuations) must NOT clear awaiting.
    pub async fn answer_awaiting(&self, session_id: &str, payload: &str) -> Result<bool> {
        let mut db = self.db.lock().await;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let cleared = tx.execute(
            "UPDATE sessions SET awaiting_at = NULL, awaiting_subject = NULL \
             WHERE id = ?1 AND awaiting_at IS NOT NULL",
            params![session_id],
        )?;
        if cleared == 0 {
            // Race lost — already answered or never awaiting. Tx rolls back
            // implicitly when dropped without commit.
            return Ok(false);
        }
        let now = Utc::now().timestamp();
        tx.execute(
            "INSERT INTO pending_messages (session_id, payload, status, created_at) \
             VALUES (?1, ?2, 'queued', ?3)",
            params![session_id, payload, now],
        )?;
        tx.commit()?;
        Ok(true)
    }

    /// Get a single session by ID.
    pub async fn get_session(&self, session_id: &str) -> Result<Option<Session>> {
        let db = self.db.lock().await;
        let session = db
            .query_row(
                "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, quest_id, first_message
                 FROM sessions WHERE id = ?1",
                params![session_id],
                |row| {
                    Ok(Session {
                        id: row.get(0)?,
                        agent_id: row.get(1)?,
                        session_type: row.get(2)?,
                        name: row.get(3)?,
                        status: row.get(4)?,
                        created_at: row.get(5)?,
                        closed_at: row.get(6)?,
                        parent_id: row.get(7)?,
                        quest_id: row.get(8)?,
                        first_message: row.get(9)?,
                    })
                },
            )
            .optional()?;
        Ok(session)
    }

    /// Returns true if this session has any prior `event_fired` row — i.e.
    /// at least one execution has already dispatched lifecycle events.
    /// Used by `spawn_session` to gate the once-per-session `session:start`
    /// event: fire iff no prior execution. Covers both cases where the
    /// session row is created (a) by spawn_session itself or (b) via a
    /// separate create_session IPC call before the first message.
    pub async fn has_prior_execution(&self, session_id: &str) -> bool {
        let db = self.db.lock().await;
        let count: Result<i64, _> = db.query_row(
            "SELECT COUNT(*) FROM session_messages
             WHERE session_id = ?1 AND event_type = 'event_fired'",
            params![session_id],
            |row| row.get(0),
        );
        matches!(count, Ok(n) if n > 0)
    }

    /// List child sessions for a given parent session.
    pub async fn list_children(&self, parent_id: &str) -> Result<Vec<Session>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, quest_id, first_message
             FROM sessions WHERE parent_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map(params![parent_id], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    agent_id: row.get(1)?,
                    session_type: row.get(2)?,
                    name: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    closed_at: row.get(6)?,
                    parent_id: row.get(7)?,
                    quest_id: row.get(8)?,
                    first_message: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    // ── Legacy channel helpers (kept for message_router compatibility) ──

    /// Ensure a channel exists (legacy, wraps ensure_channel_with_agent).
    pub async fn ensure_channel(&self, chat_id: i64, channel_type: &str, name: &str) -> Result<()> {
        self.ensure_channel_with_agent(chat_id, channel_type, name, None)
            .await
    }

    /// Ensure a channel exists with an optional agent_id (legacy).
    /// Creates a row in the channels table if it still exists, otherwise no-op.
    pub async fn ensure_channel_with_agent(
        &self,
        chat_id: i64,
        channel_type: &str,
        name: &str,
        agent_id: Option<&str>,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        // Try to insert into channels if the table still exists. Silently ignore if gone.
        let _ = db.execute(
            "INSERT OR IGNORE INTO channels (chat_id, channel_type, name, created_at, agent_id)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(chat_id) DO UPDATE SET agent_id = COALESCE(excluded.agent_id, channels.agent_id)",
            params![chat_id, channel_type, name, now, agent_id],
        );
        Ok(())
    }

    /// List all channels (legacy, for message_router).
    pub async fn list_channels(&self) -> Result<Vec<ChannelInfo>> {
        let db = self.db.lock().await;
        let mut stmt = match db.prepare(
            "SELECT ch.chat_id, ch.channel_type, ch.name, ch.created_at,
                    (SELECT content FROM session_messages WHERE chat_id = ch.chat_id AND event_type = 'message' ORDER BY id DESC LIMIT 1),
                    (SELECT timestamp FROM session_messages WHERE chat_id = ch.chat_id AND event_type = 'message' ORDER BY id DESC LIMIT 1)
             FROM channels ch
             ORDER BY ch.created_at",
        ) {
            Ok(s) => s,
            Err(_) => return Ok(Vec::new()), // channels table may not exist
        };
        let results = stmt
            .query_map([], |row| {
                Ok(ChannelInfo {
                    chat_id: row.get(0)?,
                    channel_type: row.get(1)?,
                    name: row.get(2)?,
                    created_at: row.get(3)?,
                    last_message: row.get(4)?,
                    last_message_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(results)
    }

    // ── Sender identity methods ──

    /// Resolve or create a sender identity.
    ///
    /// If a sender with the same (transport, transport_id) exists, updates
    /// `last_seen_at` and returns the existing record. Otherwise creates a
    /// new sender with a fresh UUID.
    /// Fork a session: create a new session with messages copied up to (and including) the given message ID.
    pub async fn fork_session(
        &self,
        source_session_id: &str,
        up_to_message_id: i64,
    ) -> Result<String> {
        let db = self.db.lock().await;

        // Get the source session info.
        let (agent_id, name): (String, String) = db.query_row(
            "SELECT agent_id, name FROM sessions WHERE id = ?1",
            params![source_session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

        // Create the new session.
        let new_id = uuid::Uuid::new_v4().to_string();
        let forked_name = format!("{name} (fork)");
        db.execute(
            "INSERT INTO sessions (id, agent_id, session_type, name, status, parent_id)
             VALUES (?1, ?2, 'interactive', ?3, 'active', ?4)",
            params![new_id, agent_id, forked_name, source_session_id],
        )?;

        // Copy messages up to the given message ID.
        db.execute(
            "INSERT INTO session_messages (session_id, role, content, timestamp, source, event_type, metadata, sender_id, transport)
             SELECT ?1, role, content, timestamp, source, event_type, metadata, sender_id, transport
             FROM session_messages
             WHERE session_id = ?2 AND id <= ?3
             ORDER BY id ASC",
            params![new_id, source_session_id, up_to_message_id],
        )?;

        Ok(new_id)
    }

    #[allow(clippy::type_complexity)]
    pub async fn resolve_sender(
        &self,
        transport: &str,
        transport_id: &str,
        display_name: &str,
        avatar_url: Option<&str>,
        account_id: Option<&str>,
        metadata: Option<&serde_json::Value>,
    ) -> Result<Sender> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();

        // Try to find existing sender.
        let existing: Option<(
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = db
            .query_row(
                "SELECT id, display_name, avatar_url, account_id, metadata \
                 FROM senders WHERE transport = ?1 AND transport_id = ?2",
                params![transport, transport_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?;

        if let Some((id, _existing_name, existing_avatar, existing_account, existing_meta)) =
            existing
        {
            // Update last_seen_at (and display_name if it changed).
            db.execute(
                "UPDATE senders SET last_seen_at = ?1, display_name = ?2 WHERE id = ?3",
                params![now, display_name, id],
            )?;
            return Ok(Sender {
                id,
                transport: transport.to_string(),
                transport_id: transport_id.to_string(),
                display_name: display_name.to_string(),
                avatar_url: avatar_url.map(|s| s.to_string()).or(existing_avatar),
                account_id: account_id.map(|s| s.to_string()).or(existing_account),
                metadata: metadata
                    .cloned()
                    .or_else(|| existing_meta.and_then(|raw| serde_json::from_str(&raw).ok())),
            });
        }

        // Create new sender.
        let id = uuid::Uuid::new_v4().to_string();
        let metadata_text = metadata.map(serde_json::Value::to_string);
        db.execute(
            "INSERT INTO senders (id, transport, transport_id, display_name, avatar_url, account_id, metadata, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, transport, transport_id, display_name, avatar_url, account_id, metadata_text, now],
        ).context("failed to insert sender")?;

        Ok(Sender {
            id,
            transport: transport.to_string(),
            transport_id: transport_id.to_string(),
            display_name: display_name.to_string(),
            avatar_url: avatar_url.map(|s| s.to_string()),
            account_id: account_id.map(|s| s.to_string()),
            metadata: metadata.cloned(),
        })
    }

    /// Record a message with sender identity.
    ///
    /// Inserts into session_messages with sender_id and transport columns.
    /// The `role` is inferred: if no explicit role is provided, we default
    /// to "user" (callers can override for assistant messages).
    pub async fn record_message(
        &self,
        session_id: &str,
        sender_id: &str,
        transport: &str,
        role: &str,
        content: &str,
        metadata: Option<&serde_json::Value>,
    ) -> Result<i64> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        let metadata_text = metadata.map(serde_json::Value::to_string);
        db.execute(
            "INSERT INTO session_messages (session_id, role, content, timestamp, event_type, metadata, sender_id, transport) \
             VALUES (?1, ?2, ?3, ?4, 'message', ?5, ?6, ?7)",
            params![session_id, role, content, now, metadata_text, sender_id, transport],
        )
        .context("failed to insert message with sender")?;
        let id = db.last_insert_rowid();

        // Populate first_message on sessions table when this is the first user message.
        if role == "user" && !content.is_empty() {
            let _ = db.execute(
                "UPDATE sessions SET first_message = ?1 WHERE id = ?2 AND first_message IS NULL",
                params![&content[..content.len().min(200)], session_id],
            );
        }

        Ok(id)
    }

    /// Record an execution trace.
    ///
    /// Traces are separate from messages — they represent execution events
    /// like tool calls, delegation starts, errors, etc.
    pub async fn record_trace(
        &self,
        session_id: &str,
        trace_type: &str,
        agent_id: Option<&str>,
        content: &str,
        metadata: Option<&serde_json::Value>,
    ) -> Result<i64> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        let metadata_text = metadata.map(serde_json::Value::to_string);
        db.execute(
            "INSERT INTO session_traces (session_id, trace_type, agent_id, content, created_at, metadata) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, trace_type, agent_id, content, now, metadata_text],
        )
        .context("failed to insert session trace")?;
        Ok(db.last_insert_rowid())
    }

    /// Get a sender by ID.
    pub async fn get_sender(&self, sender_id: &str) -> Result<Option<Sender>> {
        let db = self.db.lock().await;
        db.query_row(
            "SELECT id, transport, transport_id, display_name, avatar_url, account_id, metadata \
             FROM senders WHERE id = ?1",
            params![sender_id],
            |row| {
                let metadata_text: Option<String> = row.get(6)?;
                Ok(Sender {
                    id: row.get(0)?,
                    transport: row.get(1)?,
                    transport_id: row.get(2)?,
                    display_name: row.get(3)?,
                    avatar_url: row.get(4)?,
                    account_id: row.get(5)?,
                    metadata: metadata_text.and_then(|raw| serde_json::from_str(&raw).ok()),
                })
            },
        )
        .optional()
        .context("failed to query sender")
    }

    /// Get traces for a session.
    pub async fn traces_by_session(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<SessionTrace>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, session_id, trace_type, agent_id, content, created_at, metadata \
             FROM session_traces WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                let metadata_text: Option<String> = row.get(6)?;
                Ok(SessionTrace {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    trace_type: row.get(2)?,
                    agent_id: row.get(3)?,
                    content: row.get(4)?,
                    created_at: row.get(5)?,
                    metadata: metadata_text.and_then(|raw| serde_json::from_str(&raw).ok()),
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut traces = rows;
        traces.reverse();
        Ok(traces)
    }

    // ── Event invocation tracing ──

    /// Open a new invocation record. Returns the auto-incremented row id.
    pub async fn start_invocation(
        &self,
        session_id: &str,
        pattern: &str,
        event_name: Option<&str>,
        caller_kind: &str,
        tool_calls_json: &str,
    ) -> Result<i64> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO event_invocations \
             (session_id, pattern, event_name, caller_kind, started_at, status, tool_calls_json) \
             VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)",
            params![
                session_id,
                pattern,
                event_name,
                caller_kind,
                now,
                tool_calls_json
            ],
        )
        .context("failed to insert event_invocation")?;
        Ok(db.last_insert_rowid())
    }

    /// Open a step record for a single tool call within an invocation. Returns the step row id.
    pub async fn start_step(
        &self,
        invocation_id: i64,
        step_index: i64,
        tool_name: &str,
        args_json: &str,
    ) -> Result<i64> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO event_invocation_steps \
             (invocation_id, step_index, tool_name, args_json, started_at, status) \
             VALUES (?1, ?2, ?3, ?4, ?5, 'running')",
            params![invocation_id, step_index, tool_name, args_json, now],
        )
        .context("failed to insert event_invocation_step")?;
        Ok(db.last_insert_rowid())
    }

    /// Close a step record with its outcome. `status` is `'ok'` or `'error'`.
    pub async fn finish_step(
        &self,
        step_id: i64,
        result_summary: Option<&str>,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        db.execute(
            "UPDATE event_invocation_steps \
             SET finished_at = ?1, result_summary = ?2, status = ?3, error = ?4 \
             WHERE id = ?5",
            params![now, result_summary, status, error, step_id],
        )
        .context("failed to update event_invocation_step")?;
        Ok(())
    }

    /// Close an invocation record with its final outcome. `status` is `'ok'` or `'error'`.
    pub async fn finish_invocation(
        &self,
        invocation_id: i64,
        status: &str,
        error: Option<&str>,
    ) -> Result<()> {
        self.finish_invocation_with_outcome(invocation_id, status, error, None, None)
            .await
    }

    /// Close an invocation record with optional outcome score and details.
    /// `outcome_score` is expected to be in `[0.0, 1.0]` (callers clamp at the
    /// dispatcher boundary so the warning fires once per offending tool call).
    /// `None` for either column persists NULL — the legacy zero-behavior path.
    pub async fn finish_invocation_with_outcome(
        &self,
        invocation_id: i64,
        status: &str,
        error: Option<&str>,
        outcome_score: Option<f64>,
        outcome_details: Option<&str>,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let now = Utc::now().to_rfc3339();
        db.execute(
            "UPDATE event_invocations \
             SET finished_at = ?1, status = ?2, error = ?3, \
                 outcome_score = ?4, outcome_details = ?5 \
             WHERE id = ?6",
            params![
                now,
                status,
                error,
                outcome_score,
                outcome_details,
                invocation_id
            ],
        )
        .context("failed to update event_invocation")?;
        Ok(())
    }

    /// List recent invocations for a session. Returns newest-first.
    pub async fn list_invocations(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<EventInvocationRow>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, session_id, pattern, event_name, caller_kind, \
                    started_at, finished_at, status, error, tool_calls_json, \
                    outcome_score, outcome_details \
             FROM event_invocations \
             WHERE session_id = ?1 \
             ORDER BY started_at DESC, id DESC \
             LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                Ok(EventInvocationRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    pattern: row.get(2)?,
                    event_name: row.get(3)?,
                    caller_kind: row.get(4)?,
                    started_at: row.get(5)?,
                    finished_at: row.get(6)?,
                    status: row.get(7)?,
                    error: row.get(8)?,
                    tool_calls_json: row.get(9)?,
                    outcome_score: row.get(10)?,
                    outcome_details: row.get(11)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// List recent invocations for one event, identified by name+pattern.
    /// Returns newest-first across all sessions. Used by the per-event fires
    /// panel — the same event may have fired in many sessions, so we widen
    /// the filter from session_id to (event_name, pattern).
    pub async fn list_invocations_for_event(
        &self,
        event_name: &str,
        pattern: &str,
        limit: usize,
    ) -> Result<Vec<EventInvocationRow>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, session_id, pattern, event_name, caller_kind, \
                    started_at, finished_at, status, error, tool_calls_json, \
                    outcome_score, outcome_details \
             FROM event_invocations \
             WHERE event_name = ?1 AND pattern = ?2 \
             ORDER BY started_at DESC, id DESC \
             LIMIT ?3",
        )?;
        let rows = stmt
            .query_map(params![event_name, pattern, limit as i64], |row| {
                Ok(EventInvocationRow {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    pattern: row.get(2)?,
                    event_name: row.get(3)?,
                    caller_kind: row.get(4)?,
                    started_at: row.get(5)?,
                    finished_at: row.get(6)?,
                    status: row.get(7)?,
                    error: row.get(8)?,
                    tool_calls_json: row.get(9)?,
                    outcome_score: row.get(10)?,
                    outcome_details: row.get(11)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Fetch a single invocation and all its steps.
    pub async fn get_invocation_detail(
        &self,
        invocation_id: i64,
    ) -> Result<(EventInvocationRow, Vec<InvocationStepRow>)> {
        let db = self.db.lock().await;

        let inv = db
            .query_row(
                "SELECT id, session_id, pattern, event_name, caller_kind, \
                        started_at, finished_at, status, error, tool_calls_json, \
                        outcome_score, outcome_details \
                 FROM event_invocations WHERE id = ?1",
                params![invocation_id],
                |row| {
                    Ok(EventInvocationRow {
                        id: row.get(0)?,
                        session_id: row.get(1)?,
                        pattern: row.get(2)?,
                        event_name: row.get(3)?,
                        caller_kind: row.get(4)?,
                        started_at: row.get(5)?,
                        finished_at: row.get(6)?,
                        status: row.get(7)?,
                        error: row.get(8)?,
                        tool_calls_json: row.get(9)?,
                        outcome_score: row.get(10)?,
                        outcome_details: row.get(11)?,
                    })
                },
            )
            .context("invocation not found")?;

        let mut stmt = db.prepare(
            "SELECT id, invocation_id, step_index, tool_name, args_json, \
                    started_at, finished_at, result_summary, status, error \
             FROM event_invocation_steps \
             WHERE invocation_id = ?1 \
             ORDER BY step_index ASC",
        )?;
        let steps = stmt
            .query_map(params![invocation_id], |row| {
                Ok(InvocationStepRow {
                    id: row.get(0)?,
                    invocation_id: row.get(1)?,
                    step_index: row.get(2)?,
                    tool_name: row.get(3)?,
                    args_json: row.get(4)?,
                    started_at: row.get(5)?,
                    finished_at: row.get(6)?,
                    result_summary: row.get(7)?,
                    status: row.get(8)?,
                    error: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok((inv, steps))
    }
}

#[async_trait]
impl PendingMessageSource for SessionStore {
    async fn claim_pending_for_session(
        &self,
        session_id: &str,
        since_id: Option<i64>,
    ) -> Result<Vec<InjectedMessage>> {
        self.claim_pending_for_session(session_id, since_id).await
    }
}

/// Mask to keep chat IDs within JS MAX_SAFE_INTEGER (2^53 - 1).
/// Bottom 4 bits reserved for channel-type tag.
const JS_SAFE_MASK: u64 = 0x1F_FFFF_FFFF_FFF0;

fn hashed_chat_id(key: &str, tag: u64) -> i64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    (hash & JS_SAFE_MASK | tag) as i64
}

/// Deterministic chat ID for a project-wide channel (legacy).
pub(crate) fn project_chat_id(project_name: &str) -> i64 {
    hashed_chat_id(&format!("project:{project_name}"), 1)
}

/// Deterministic chat ID for a named shared channel (legacy).
pub(crate) fn named_channel_chat_id(channel_name: &str) -> i64 {
    hashed_chat_id(&format!("channel:{channel_name}"), 2)
}

/// Deterministic chat ID for the agency-wide group chat (legacy).
pub(crate) fn agency_chat_id() -> i64 {
    hashed_chat_id("agency:global", 3)
}

/// Channel metadata returned by `list_channels` (legacy).
#[derive(Debug, Clone)]
pub struct ChannelInfo {
    pub chat_id: i64,
    pub channel_type: String,
    pub name: String,
    pub created_at: String,
    pub last_message: Option<String>,
    pub last_message_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn open_test_db() -> Arc<crate::agent_registry::ConnectionPool> {
        let pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
        }
        Arc::new(pool)
    }

    async fn test_store() -> SessionStore {
        SessionStore::new(open_test_db().await)
    }

    #[tokio::test]
    async fn test_record_and_recent() {
        let store = test_store().await;

        store.record(123, "User", "hello").await.unwrap();
        store.record(123, "Assistant", "hi there").await.unwrap();
        store.record(123, "User", "how are you?").await.unwrap();

        let msgs = store.recent(123, 10).await.unwrap();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].role, "User");
        assert_eq!(msgs[0].content, "hello");
        assert_eq!(msgs[2].content, "how are you?");
    }

    #[tokio::test]
    async fn test_recent_limit() {
        let store = test_store().await;

        for i in 0..10 {
            store.record(1, "User", &format!("msg {i}")).await.unwrap();
        }

        let msgs = store.recent(1, 3).await.unwrap();
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].content, "msg 7");
        assert_eq!(msgs[2].content, "msg 9");
    }

    #[tokio::test]
    async fn test_context_string() {
        let store = test_store().await;

        store.record(42, "User", "hello").await.unwrap();
        store.record(42, "Assistant", "world").await.unwrap();

        let ctx = store.context_string(42, 10).await.unwrap();
        assert!(ctx.contains("Conversation History"));
        assert!(ctx.contains("**User**: hello"));
        assert!(ctx.contains("**Assistant**: world"));
    }

    #[tokio::test]
    async fn test_context_string_empty() {
        let store = test_store().await;

        let ctx = store.context_string(999, 10).await.unwrap();
        assert!(ctx.is_empty());
    }

    #[tokio::test]
    async fn test_save_summary() {
        let store = test_store().await;

        for i in 0..10 {
            store.record(1, "User", &format!("msg {i}")).await.unwrap();
        }

        store
            .save_summary(1, "User said messages 0-7", 2)
            .await
            .unwrap();

        // Only 2 recent messages should remain unsummarized.
        let msgs = store.recent(1, 100).await.unwrap();
        assert_eq!(msgs.len(), 2);

        // Summary should appear in context.
        let ctx = store.context_string(1, 100).await.unwrap();
        assert!(ctx.contains("User said messages 0-7"));
    }

    #[tokio::test]
    async fn test_message_count() {
        let store = test_store().await;

        store.record(1, "User", "a").await.unwrap();
        store.record(1, "User", "b").await.unwrap();
        store.record(2, "User", "c").await.unwrap();

        assert_eq!(store.message_count(1).await.unwrap(), 2);
        assert_eq!(store.message_count(2).await.unwrap(), 1);
        assert_eq!(store.message_count(999).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_chat_isolation() {
        let store = test_store().await;

        store.record(1, "User", "chat1").await.unwrap();
        store.record(2, "User", "chat2").await.unwrap();

        let msgs1 = store.recent(1, 10).await.unwrap();
        let msgs2 = store.recent(2, 10).await.unwrap();

        assert_eq!(msgs1.len(), 1);
        assert_eq!(msgs1[0].content, "chat1");
        assert_eq!(msgs2.len(), 1);
        assert_eq!(msgs2[0].content, "chat2");
    }

    #[tokio::test]
    async fn test_timeline_records_typed_events() {
        let store = test_store().await;

        store.record(7, "User", "hello").await.unwrap();
        store
            .record_event(
                7,
                "quest_created",
                "system",
                "Quest sg-001 created.",
                Some("web"),
                Some(&serde_json::json!({"quest_id": "sg-001"})),
            )
            .await
            .unwrap();

        let events = store.timeline(7, 10).await.unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].event_type, "message");
        assert_eq!(events[1].event_type, "quest_created");
        assert_eq!(
            events[1]
                .metadata
                .as_ref()
                .and_then(|m| m.get("quest_id"))
                .and_then(|v| v.as_str()),
            Some("sg-001")
        );

        let messages = store.recent(7, 10).await.unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "hello");
    }

    // ── Session tests ──

    #[tokio::test]
    async fn test_record_and_history_by_session() {
        let store = test_store().await;

        let session_id = store
            .create_session("agent-1", "web", "history-test", None, None)
            .await
            .unwrap();

        store
            .record_by_session(&session_id, "user", "hello from session", Some("web"))
            .await
            .unwrap();
        store
            .record_by_session(&session_id, "assistant", "hi back", Some("web"))
            .await
            .unwrap();

        let msgs = store.history_by_session(&session_id, 10).await.unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].content, "hello from session");
        assert_eq!(msgs[1].content, "hi back");
    }

    #[tokio::test]
    async fn test_list_sessions_filtering() {
        let store = test_store().await;

        store
            .create_session("a1", "web", "s1", None, None)
            .await
            .unwrap();
        store
            .create_session("a1", "web", "s2", None, None)
            .await
            .unwrap();
        store
            .create_session("a2", "web", "s3", None, None)
            .await
            .unwrap();

        let all = store.list_sessions(None, 100).await.unwrap();
        assert_eq!(all.len(), 3);

        let by_agent = store.list_sessions(Some("a1"), 100).await.unwrap();
        assert_eq!(by_agent.len(), 2);
    }

    #[tokio::test]
    async fn record_empty_content() {
        let store = test_store().await;

        // Recording empty content should succeed (the DB allows it).
        store.record(1, "User", "").await.unwrap();

        let msgs = store.recent(1, 10).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "");
    }

    #[tokio::test]
    async fn list_sessions_empty() {
        let store = test_store().await;

        let sessions = store.list_sessions(None, 100).await.unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn close_nonexistent_session() {
        let store = test_store().await;

        // close_session runs an UPDATE that matches zero rows — no error, just a no-op.
        let result = store.close_session("nonexistent-uuid").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn session_messages_with_limit() {
        let store = test_store().await;

        let session_id = store
            .create_session("agent-1", "web", "limit-test", None, None)
            .await
            .unwrap();

        for i in 0..10 {
            store
                .record_by_session(&session_id, "user", &format!("msg {i}"), Some("web"))
                .await
                .unwrap();
        }

        let msgs = store.history_by_session(&session_id, 3).await.unwrap();
        assert_eq!(msgs.len(), 3);
        // Should return the 3 most recent messages.
        assert_eq!(msgs[0].content, "msg 7");
        assert_eq!(msgs[1].content, "msg 8");
        assert_eq!(msgs[2].content, "msg 9");
    }

    #[tokio::test]
    async fn create_session_no_legacy_chat_id() {
        let store = test_store().await;

        let id = store
            .create_session("agent-1", "perpetual", "Test Session", None, None)
            .await
            .unwrap();
        assert!(!id.is_empty());

        let session = store.get_session(&id).await.unwrap().unwrap();
        assert_eq!(session.agent_id.as_deref(), Some("agent-1"));
        assert_eq!(session.session_type, "perpetual");
    }

    #[test]
    fn test_deterministic_chat_ids_use_distinct_tags() {
        let project = project_chat_id("alpha");
        let named = named_channel_chat_id("ops");
        let agency = agency_chat_id();

        assert_ne!(project, named);
        assert_ne!(project, agency);
        assert_ne!(named, agency);
    }

    // ── Sender + trace tests ──

    #[tokio::test]
    async fn test_resolve_sender_creates_new() {
        let store = test_store().await;

        let sender = store
            .resolve_sender("telegram", "12345", "Alice", None, None, None)
            .await
            .unwrap();

        assert!(!sender.id.is_empty());
        assert_eq!(sender.transport, "telegram");
        assert_eq!(sender.transport_id, "12345");
        assert_eq!(sender.display_name, "Alice");
    }

    #[tokio::test]
    async fn test_resolve_sender_returns_existing() {
        let store = test_store().await;

        let s1 = store
            .resolve_sender("telegram", "12345", "Alice", None, None, None)
            .await
            .unwrap();
        let s2 = store
            .resolve_sender("telegram", "12345", "Alice Updated", None, None, None)
            .await
            .unwrap();

        // Same sender — same ID.
        assert_eq!(s1.id, s2.id);
        // Display name updated.
        assert_eq!(s2.display_name, "Alice Updated");
    }

    #[tokio::test]
    async fn test_resolve_sender_different_transports() {
        let store = test_store().await;

        let s1 = store
            .resolve_sender("telegram", "12345", "Alice", None, None, None)
            .await
            .unwrap();
        let s2 = store
            .resolve_sender("web", "12345", "Alice", None, None, None)
            .await
            .unwrap();

        // Different transport = different sender.
        assert_ne!(s1.id, s2.id);
    }

    #[tokio::test]
    async fn test_get_sender() {
        let store = test_store().await;

        let sender = store
            .resolve_sender(
                "web",
                "user@example.com",
                "Bob",
                Some("https://avatar.url"),
                None,
                None,
            )
            .await
            .unwrap();

        let fetched = store.get_sender(&sender.id).await.unwrap().unwrap();
        assert_eq!(fetched.id, sender.id);
        assert_eq!(fetched.display_name, "Bob");
        assert_eq!(fetched.avatar_url.as_deref(), Some("https://avatar.url"));
    }

    #[tokio::test]
    async fn test_record_message_with_sender() {
        let store = test_store().await;

        let session_id = store
            .create_session("agent-1", "web", "sender-test", None, None)
            .await
            .unwrap();

        let sender = store
            .resolve_sender("web", "user@example.com", "Bob", None, None, None)
            .await
            .unwrap();

        let msg_id = store
            .record_message(
                &session_id,
                &sender.id,
                "web",
                "user",
                "hello from bob",
                None,
            )
            .await
            .unwrap();
        assert!(msg_id > 0);

        // Verify it appears in timeline with sender info.
        let timeline = store.timeline_by_session(&session_id, 10).await.unwrap();
        assert_eq!(timeline.len(), 1);
        assert_eq!(timeline[0].content, "hello from bob");
        assert_eq!(timeline[0].sender_id.as_deref(), Some(sender.id.as_str()));
        assert_eq!(timeline[0].transport.as_deref(), Some("web"));
    }

    #[tokio::test]
    async fn test_record_trace() {
        let store = test_store().await;

        let session_id = store
            .create_session("agent-1", "web", "trace-test", None, None)
            .await
            .unwrap();

        let trace_id = store
            .record_trace(
                &session_id,
                "tool_call",
                Some("agent-1"),
                "Called search tool",
                Some(&serde_json::json!({"tool": "search", "duration_ms": 42})),
            )
            .await
            .unwrap();
        assert!(trace_id > 0);

        let traces = store.traces_by_session(&session_id, 10).await.unwrap();
        assert_eq!(traces.len(), 1);
        assert_eq!(traces[0].trace_type, "tool_call");
        assert_eq!(traces[0].agent_id.as_deref(), Some("agent-1"));
        assert_eq!(traces[0].content, "Called search tool");
        assert_eq!(
            traces[0]
                .metadata
                .as_ref()
                .and_then(|m| m.get("tool"))
                .and_then(|v| v.as_str()),
            Some("search")
        );
    }

    #[tokio::test]
    async fn test_record_event_with_sender() {
        let store = test_store().await;

        let session_id = store
            .create_session("agent-1", "web", "event-sender-test", None, None)
            .await
            .unwrap();

        let sender = store
            .resolve_sender("web", "user1", "User One", None, None, None)
            .await
            .unwrap();

        store
            .record_event_by_session_with_sender(
                &session_id,
                "message",
                "user",
                "hello",
                Some("web"),
                None,
                Some(&sender.id),
                Some("web"),
            )
            .await
            .unwrap();

        let timeline = store.timeline_by_session(&session_id, 10).await.unwrap();
        assert_eq!(timeline.len(), 1);
        assert_eq!(timeline[0].sender_id.as_deref(), Some(sender.id.as_str()));
        assert_eq!(timeline[0].transport.as_deref(), Some("web"));
    }

    #[tokio::test]
    async fn test_record_message_populates_first_message() {
        let store = test_store().await;

        let session_id = store
            .create_session("agent-1", "web", "first-msg-test", None, None)
            .await
            .unwrap();

        let sender = store
            .resolve_sender("web", "user1", "User", None, None, None)
            .await
            .unwrap();

        store
            .record_message(
                &session_id,
                &sender.id,
                "web",
                "user",
                "My first message",
                None,
            )
            .await
            .unwrap();

        let session = store.get_session(&session_id).await.unwrap().unwrap();
        assert_eq!(session.first_message.as_deref(), Some("My first message"));
    }

    #[tokio::test]
    async fn tool_traces_for_quest_groups_across_sessions() {
        let store = test_store().await;

        // Two sessions for the same quest, one unrelated session for control.
        let s_quest_a = store
            .create_session("a1", "web", "quest-session-a", None, Some("lu-42"))
            .await
            .unwrap();
        let s_quest_b = store
            .create_session("a1", "web", "quest-session-b", None, Some("lu-42"))
            .await
            .unwrap();
        let s_other = store
            .create_session("a1", "web", "other", None, Some("lu-99"))
            .await
            .unwrap();

        // Two tool completions in session A, one in B, one in the unrelated session.
        let write_trace = async |sid: &str, tool: &str, success: bool, dur: u64| {
            store
                .record_event_by_session(
                    sid,
                    "tool_complete",
                    "system",
                    tool,
                    Some("session"),
                    Some(&serde_json::json!({
                        "tool_use_id": format!("tu_{tool}"),
                        "tool_name": tool,
                        "success": success,
                        "input_preview": format!("input for {tool}"),
                        "output_preview": format!("output from {tool}"),
                        "duration_ms": dur,
                    })),
                )
                .await
                .unwrap();
        };
        write_trace(&s_quest_a, "edit_file", true, 12).await;
        write_trace(&s_quest_a, "read_file", true, 3).await;
        write_trace(&s_quest_b, "run_tests", false, 4200).await;
        write_trace(&s_other, "edit_file", true, 9).await;

        // A non-tool event in the quest's session — should be ignored.
        store
            .record_event_by_session(
                &s_quest_a,
                "message",
                "user",
                "unrelated user message",
                Some("web"),
                None,
            )
            .await
            .unwrap();

        let traces = store.tool_traces_for_quest("lu-42").await.unwrap();
        assert_eq!(
            traces.len(),
            3,
            "expected 3 traces across the quest's sessions"
        );
        let tool_names: Vec<&str> = traces.iter().map(|t| t.tool_name.as_str()).collect();
        assert!(tool_names.contains(&"edit_file"));
        assert!(tool_names.contains(&"read_file"));
        assert!(tool_names.contains(&"run_tests"));
        assert!(!tool_names.contains(&"unrelated user message"));

        // Metadata is unpacked.
        let run_tests = traces
            .iter()
            .find(|t| t.tool_name == "run_tests")
            .expect("run_tests trace present");
        assert_eq!(run_tests.success, Some(false));
        assert_eq!(run_tests.duration_ms, Some(4200));
        assert_eq!(run_tests.tool_use_id.as_deref(), Some("tu_run_tests"));
        assert_eq!(run_tests.session_id, s_quest_b);

        // Traces for the unrelated quest are isolated.
        let other = store.tool_traces_for_quest("lu-99").await.unwrap();
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].tool_name, "edit_file");
    }

    /// Phase 5: `summarize_range_by_session` removes the middle messages and
    /// preserves head + tail. Verifies the core operation used by
    /// `transcript.replace_middle`.
    #[tokio::test]
    async fn transcript_replace_middle_preserves_head_and_tail() {
        let store = test_store().await;
        let session_id = "test-replace-middle";

        // Insert 10 messages.
        for i in 0..10u32 {
            store
                .record_by_session(session_id, "user", &format!("msg {i}"), None)
                .await
                .unwrap();
        }

        let before = store.history_by_session(session_id, 100).await.unwrap();
        assert_eq!(before.len(), 10);

        // Summarize middle (preserve head=3, tail=2).
        let deleted = store
            .summarize_range_by_session(session_id, 3, 2)
            .await
            .unwrap();
        assert_eq!(deleted, 5, "should delete the 5 middle messages");

        // After summarization: 5 messages remain (3 head + 2 tail).
        let after = store.history_by_session(session_id, 100).await.unwrap();
        assert_eq!(after.len(), 5);
        assert_eq!(after[0].content, "msg 0");
        assert_eq!(after[1].content, "msg 1");
        assert_eq!(after[2].content, "msg 2");
        assert_eq!(after[3].content, "msg 8");
        assert_eq!(after[4].content, "msg 9");
    }

    /// Phase 5: `summarize_range_by_session` is a no-op when head + tail >= total.
    #[tokio::test]
    async fn summarize_range_nothing_to_remove() {
        let store = test_store().await;
        let session_id = "test-nothing-to-remove";

        for i in 0..5u32 {
            store
                .record_by_session(session_id, "user", &format!("msg {i}"), None)
                .await
                .unwrap();
        }

        // preserve_head=3, preserve_tail=3 → head+tail=6 > total=5 → nothing deleted.
        let deleted = store
            .summarize_range_by_session(session_id, 3, 3)
            .await
            .unwrap();
        assert_eq!(deleted, 0);

        let after = store.history_by_session(session_id, 100).await.unwrap();
        assert_eq!(after.len(), 5, "all messages preserved");
    }

    /// Phase 5: `summarize_range_by_session` with preserve_head=0, preserve_tail=0
    /// marks all messages as summarized.
    #[tokio::test]
    async fn summarize_range_marks_all_when_zero_bounds() {
        let store = test_store().await;
        let session_id = "test-all-summarized";

        for i in 0..5u32 {
            store
                .record_by_session(session_id, "user", &format!("msg {i}"), None)
                .await
                .unwrap();
        }

        let deleted = store
            .summarize_range_by_session(session_id, 0, 0)
            .await
            .unwrap();
        assert_eq!(deleted, 5);

        let after = store.history_by_session(session_id, 100).await.unwrap();
        assert!(after.is_empty(), "all messages summarized");
    }

    // ── Event invocation trace tests ──

    #[tokio::test]
    async fn invocation_roundtrip_ok() {
        let store = test_store().await;
        let session_id = "inv-test-session";

        // Create invocation.
        let inv_id = store
            .start_invocation(
                session_id,
                "session:start",
                Some("on_start"),
                "Event",
                r#"[{"tool":"transcript.inject","args":{}}]"#,
            )
            .await
            .unwrap();
        assert!(inv_id > 0);

        // Insert two steps.
        let step1 = store
            .start_step(inv_id, 0, "transcript.inject", r#"{"content":"hello"}"#)
            .await
            .unwrap();
        let step2 = store
            .start_step(inv_id, 1, "ideas.assemble", r#"{"names":["primer"]}"#)
            .await
            .unwrap();

        // Finish step 1 — success.
        store
            .finish_step(step1, Some("injected hello"), "ok", None)
            .await
            .unwrap();

        // Finish step 2 — error.
        store
            .finish_step(step2, None, "error", Some("ideas store unavailable"))
            .await
            .unwrap();

        // Finish invocation — error because step 2 failed.
        store
            .finish_invocation(inv_id, "error", Some("step 1/2 failed"))
            .await
            .unwrap();

        // Read back detail.
        let (inv, steps) = store.get_invocation_detail(inv_id).await.unwrap();
        assert_eq!(inv.session_id, session_id);
        assert_eq!(inv.pattern, "session:start");
        assert_eq!(inv.event_name.as_deref(), Some("on_start"));
        assert_eq!(inv.caller_kind, "Event");
        assert_eq!(inv.status, "error");
        assert!(inv.error.is_some());
        assert!(inv.finished_at.is_some());
        assert_eq!(steps.len(), 2);

        // Steps are ordered by step_index.
        assert_eq!(steps[0].tool_name, "transcript.inject");
        assert_eq!(steps[0].status, "ok");
        assert_eq!(steps[0].result_summary.as_deref(), Some("injected hello"));
        assert!(steps[0].finished_at.is_some());

        assert_eq!(steps[1].tool_name, "ideas.assemble");
        assert_eq!(steps[1].status, "error");
        assert_eq!(steps[1].error.as_deref(), Some("ideas store unavailable"));
    }

    #[tokio::test]
    async fn list_invocations_returns_newest_first() {
        let store = test_store().await;
        let session_id = "inv-list-session";

        for i in 0..3u32 {
            let id = store
                .start_invocation(session_id, &format!("pattern:{i}"), None, "System", "[]")
                .await
                .unwrap();
            store.finish_invocation(id, "ok", None).await.unwrap();
        }

        let rows = store.list_invocations(session_id, 10).await.unwrap();
        assert_eq!(rows.len(), 3);
        // Newest first: pattern:2, pattern:1, pattern:0.
        assert_eq!(rows[0].pattern, "pattern:2");
        assert_eq!(rows[2].pattern, "pattern:0");
        for r in &rows {
            assert_eq!(r.status, "ok");
        }
    }

    #[tokio::test]
    async fn list_invocations_limit_is_respected() {
        let store = test_store().await;
        let session_id = "inv-limit-session";

        for i in 0..5u32 {
            let id = store
                .start_invocation(session_id, &format!("p:{i}"), None, "Llm", "[]")
                .await
                .unwrap();
            store.finish_invocation(id, "ok", None).await.unwrap();
        }

        let rows = store.list_invocations(session_id, 3).await.unwrap();
        assert_eq!(rows.len(), 3);
    }

    // ── Step-boundary injection tests ──────────────────────────────────────

    /// `claim_pending_for_session` should atomically remove and return all
    /// `queued` rows for the session whose id is strictly greater than the
    /// watermark. After the call those rows no longer exist in the table.
    #[tokio::test]
    async fn claim_pending_for_session_respects_watermark() {
        let store = test_store().await;
        let sid = "sess-inject";

        // Enqueue three messages. The second and third arrive AFTER the turn
        // started, so we simulate watermark = first_id.
        let first_id = store.enqueue_pending(sid, "msg-1").await.unwrap();
        let second_id = store.enqueue_pending(sid, "msg-2").await.unwrap();
        let third_id = store.enqueue_pending(sid, "msg-3").await.unwrap();

        // Claim with watermark = first_id should return rows 2 and 3 only.
        let claimed = store
            .claim_pending_for_session(sid, Some(first_id))
            .await
            .unwrap();
        assert_eq!(claimed.len(), 2);
        let ids: Vec<i64> = claimed.iter().map(|r| r.id).collect();
        assert!(ids.contains(&second_id));
        assert!(ids.contains(&third_id));
        assert_eq!(claimed[0].content, "msg-2");
        assert_eq!(claimed[1].content, "msg-3");

        // The claimed rows must be gone from the table — a second call returns
        // nothing (above the same watermark).
        let re_claim = store
            .claim_pending_for_session(sid, Some(first_id))
            .await
            .unwrap();
        assert!(re_claim.is_empty(), "claimed rows must not be re-claimable");
    }

    /// When `since_id` is `None`, all queued rows for the session are returned.
    #[tokio::test]
    async fn claim_pending_for_session_none_watermark_claims_all() {
        let store = test_store().await;
        let sid = "sess-all";

        store.enqueue_pending(sid, "a").await.unwrap();
        store.enqueue_pending(sid, "b").await.unwrap();

        let claimed = store.claim_pending_for_session(sid, None).await.unwrap();
        assert_eq!(claimed.len(), 2);
        // All rows are deleted.
        let again = store.claim_pending_for_session(sid, None).await.unwrap();
        assert!(again.is_empty());
    }

    /// The `PendingMessageSource` trait impl on `SessionStore` delegates to
    /// the inherent method. Verify the trait object is callable and produces
    /// the same results.
    #[tokio::test]
    async fn pending_message_source_trait_impl() {
        use aeqi_core::traits::PendingMessageSource;
        use std::sync::Arc;

        let store = Arc::new(test_store().await);
        let sid = "sess-trait";

        let id1 = store.enqueue_pending(sid, "hello").await.unwrap();
        store.enqueue_pending(sid, "world").await.unwrap();

        // Upcast to trait object — this verifies the impl compiles and works.
        let source: Arc<dyn PendingMessageSource> = store.clone();
        let injected = source
            .claim_pending_for_session(sid, Some(id1))
            .await
            .unwrap();

        assert_eq!(injected.len(), 1);
        assert_eq!(injected[0].content, "world");
    }

    /// Injection must not claim rows belonging to other sessions.
    #[tokio::test]
    async fn claim_pending_for_session_isolates_sessions() {
        let store = test_store().await;

        let sid_a = "sess-a";
        let sid_b = "sess-b";

        let id_a = store.enqueue_pending(sid_a, "for-a").await.unwrap();
        store.enqueue_pending(sid_b, "for-b").await.unwrap();

        // Claim all queued rows for sid_a (no watermark).
        let claimed_a = store.claim_pending_for_session(sid_a, None).await.unwrap();
        assert_eq!(claimed_a.len(), 1);
        assert_eq!(claimed_a[0].id, id_a);

        // sid_b's row is untouched.
        let claimed_b = store.claim_pending_for_session(sid_b, None).await.unwrap();
        assert_eq!(claimed_b.len(), 1);
        assert_eq!(claimed_b[0].content, "for-b");
    }

    #[tokio::test]
    async fn result_summary_truncation_at_2000_chars() {
        // The truncation itself happens in idea_assembly, but this test
        // verifies round-trip storage of a 2001-char string and the
        // accessor returns it unmodified (truncation is the caller's job).
        let store = test_store().await;
        let inv_id = store
            .start_invocation("trunc-session", "p:x", None, "Event", "[]")
            .await
            .unwrap();
        let step_id = store.start_step(inv_id, 0, "tool.x", "{}").await.unwrap();
        let long_summary = "x".repeat(2001);
        store
            .finish_step(step_id, Some(&long_summary), "ok", None)
            .await
            .unwrap();
        let (_, steps) = store.get_invocation_detail(inv_id).await.unwrap();
        assert_eq!(
            steps[0].result_summary.as_deref().map(|s| s.len()),
            Some(2001)
        );
    }

    // ── T1.2 outcome columns (universality plan) ──────────────────────────

    /// Fresh DB after `create_invocation_tables` exposes both T1.2 columns
    /// and they default to NULL. Re-running the helper is a no-op (the
    /// migration is idempotent) and keeps existing rows untouched.
    #[tokio::test]
    async fn t1_2_outcome_columns_present_and_default_null_idempotent() {
        let pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
            // Idempotent re-application — must not error or duplicate columns.
            SessionStore::create_invocation_tables(&conn).unwrap();
            ensure_invocation_outcome_columns(&conn).unwrap();
            ensure_invocation_outcome_columns(&conn).unwrap();

            let mut stmt = conn
                .prepare("PRAGMA table_info(event_invocations)")
                .unwrap();
            let cols: std::collections::HashSet<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            assert!(cols.contains("outcome_score"), "outcome_score missing");
            assert!(cols.contains("outcome_details"), "outcome_details missing");
        }

        let store = SessionStore::new(Arc::new(pool));
        let inv_id = store
            .start_invocation("t1-2-fresh", "p:x", None, "Event", "[]")
            .await
            .unwrap();
        store.finish_invocation(inv_id, "ok", None).await.unwrap();
        let (row, _) = store.get_invocation_detail(inv_id).await.unwrap();
        assert!(row.outcome_score.is_none());
        assert!(row.outcome_details.is_none());
    }

    /// Simulate a legacy DB that pre-dates T1.2 (no outcome columns) and
    /// confirm the migration adds them without losing data.
    #[tokio::test]
    async fn t1_2_migration_applies_to_legacy_db_without_data_loss() {
        let pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;

            // Hand-build the pre-T1.2 shape.
            conn.execute_batch(
                "CREATE TABLE event_invocations (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     session_id TEXT NOT NULL,
                     pattern TEXT NOT NULL,
                     event_name TEXT,
                     caller_kind TEXT NOT NULL,
                     started_at TEXT NOT NULL,
                     finished_at TEXT,
                     status TEXT NOT NULL,
                     error TEXT,
                     tool_calls_json TEXT NOT NULL
                 );
                 CREATE TABLE event_invocation_steps (
                     id INTEGER PRIMARY KEY AUTOINCREMENT,
                     invocation_id INTEGER NOT NULL REFERENCES event_invocations(id),
                     step_index INTEGER NOT NULL,
                     tool_name TEXT NOT NULL,
                     args_json TEXT NOT NULL,
                     started_at TEXT NOT NULL,
                     finished_at TEXT,
                     result_summary TEXT,
                     status TEXT NOT NULL,
                     error TEXT
                 );",
            )
            .unwrap();

            // Pre-existing legacy row.
            conn.execute(
                "INSERT INTO event_invocations \
                 (session_id, pattern, event_name, caller_kind, started_at, status, tool_calls_json) \
                 VALUES ('legacy', 'session:start', 'on_start', 'Event', '2026-04-25T00:00:00Z', 'ok', '[]')",
                [],
            )
            .unwrap();

            // Simulate the rest of `create_tables` so SessionStore methods work.
            // We only need session_messages + sessions for `get_invocation_detail`
            // — but get_invocation_detail only reads event_invocation*, so
            // creating just the missing message tables is unnecessary. The
            // migration alone is enough; the assertion verifies it.
            ensure_invocation_outcome_columns(&conn).unwrap();

            let mut stmt = conn
                .prepare("PRAGMA table_info(event_invocations)")
                .unwrap();
            let cols: std::collections::HashSet<String> = stmt
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect();
            assert!(cols.contains("outcome_score"));
            assert!(cols.contains("outcome_details"));

            // Legacy row survives with NULL outcomes.
            let (legacy_session, score, details): (String, Option<f64>, Option<String>) = conn
                .query_row(
                    "SELECT session_id, outcome_score, outcome_details \
                     FROM event_invocations WHERE id = 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(legacy_session, "legacy");
            assert!(score.is_none());
            assert!(details.is_none());
        }
    }

    /// `finish_invocation_with_outcome` persists the supplied score/details.
    #[tokio::test]
    async fn t1_2_finish_invocation_persists_outcome_score_and_details() {
        let store = test_store().await;
        let inv_id = store
            .start_invocation("t1-2-score", "p:x", None, "Event", "[]")
            .await
            .unwrap();
        store
            .finish_invocation_with_outcome(inv_id, "ok", None, Some(0.7), Some("worked"))
            .await
            .unwrap();
        let (row, _) = store.get_invocation_detail(inv_id).await.unwrap();
        assert!((row.outcome_score.unwrap() - 0.7).abs() < f64::EPSILON);
        assert_eq!(row.outcome_details.as_deref(), Some("worked"));
    }

    /// Default `finish_invocation` (no outcome) leaves both columns NULL —
    /// the legacy zero-behavior path required by the neutral-dial invariant.
    #[tokio::test]
    async fn t1_2_finish_invocation_without_outcome_persists_null() {
        let store = test_store().await;
        let inv_id = store
            .start_invocation("t1-2-null", "p:x", None, "Event", "[]")
            .await
            .unwrap();
        store.finish_invocation(inv_id, "ok", None).await.unwrap();
        let (row, _) = store.get_invocation_detail(inv_id).await.unwrap();
        assert!(row.outcome_score.is_none());
        assert!(row.outcome_details.is_none());
    }

    // ── Director-inbox awaiting columns ─────────────────────────────────────

    /// Migration on a legacy `sessions` table: columns added, idempotent on
    /// repeated invocation, partial index created.
    #[tokio::test]
    async fn ensure_session_awaiting_columns_migrates_legacy() {
        let pool = open_test_db().await;
        let conn = pool.lock().await;
        // Drop the modern table and synthesize a legacy one without the
        // awaiting_* columns (mirrors the pattern in the outcome-columns test).
        conn.execute("DROP TABLE sessions", []).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT,
                 session_type TEXT NOT NULL,
                 name TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'active',
                 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                 closed_at TEXT,
                 parent_id TEXT,
                 quest_id TEXT,
                 first_message TEXT
             );",
        )
        .unwrap();

        ensure_session_awaiting_columns(&conn).unwrap();
        // Idempotent — running again is a no-op, not an error.
        ensure_session_awaiting_columns(&conn).unwrap();

        let cols: std::collections::HashSet<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(sessions)").unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(cols.contains("awaiting_at"));
        assert!(cols.contains("awaiting_subject"));
    }

    /// Fresh-install path: `create_tables` (which calls the migration helper
    /// transitively via `create_invocation_tables`) leaves the new DB with the
    /// awaiting columns. This guards the consolidation: the CREATE TABLE block
    /// no longer declares the columns inline, so the migration helper is the
    /// sole source of truth and must run on every boot — including the first.
    #[tokio::test]
    async fn migration_runs_on_fresh_install() {
        let pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
            let cols: std::collections::HashSet<String> = {
                let mut stmt = conn.prepare("PRAGMA table_info(sessions)").unwrap();
                stmt.query_map([], |row| row.get::<_, String>(1))
                    .unwrap()
                    .filter_map(|r| r.ok())
                    .collect()
            };
            assert!(
                cols.contains("awaiting_at"),
                "fresh DB must expose awaiting_at via the migration helper"
            );
            assert!(
                cols.contains("awaiting_subject"),
                "fresh DB must expose awaiting_subject via the migration helper"
            );
            // The partial inbox index must also be present after a fresh
            // create_tables — the migration helper owns that creation now.
            let idx_present: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master \
                     WHERE type = 'index' AND name = 'idx_sess_awaiting'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                idx_present, 1,
                "idx_sess_awaiting must be created on fresh install"
            );
        }
    }

    /// `set_awaiting` / `clear_awaiting` round-trip writes and reads via the
    /// inbox query.
    #[tokio::test]
    async fn set_and_clear_awaiting_round_trip() {
        let store = test_store().await;
        let session_id = store
            .create_session("agent-1", "session", "ask flow", None, None)
            .await
            .unwrap();

        // Pre-condition: nothing in the inbox.
        let pre = store.list_awaiting(None).await.unwrap();
        assert!(pre.iter().all(|r| r.session_id != session_id));

        store
            .set_awaiting(&session_id, "Approve $200 budget?")
            .await
            .unwrap();
        let listed = store.list_awaiting(None).await.unwrap();
        let row = listed
            .iter()
            .find(|r| r.session_id == session_id)
            .expect("session must appear in inbox after set_awaiting");
        assert_eq!(
            row.awaiting_subject.as_deref(),
            Some("Approve $200 budget?")
        );
        assert!(!row.awaiting_at.is_empty());

        store.clear_awaiting(&session_id).await.unwrap();
        let post = store.list_awaiting(None).await.unwrap();
        assert!(post.iter().all(|r| r.session_id != session_id));
    }

    /// `list_awaiting` filters to the supplied agent allow-set when given
    /// (platform mode); returns everything when `None` (runtime mode).
    #[tokio::test]
    async fn list_awaiting_respects_agent_filter() {
        let store = test_store().await;
        let s_a = store
            .create_session("agent-allowed", "session", "a", None, None)
            .await
            .unwrap();
        let s_b = store
            .create_session("agent-blocked", "session", "b", None, None)
            .await
            .unwrap();
        store.set_awaiting(&s_a, "subject a").await.unwrap();
        store.set_awaiting(&s_b, "subject b").await.unwrap();

        let mut allow = std::collections::HashSet::new();
        allow.insert("agent-allowed".to_string());
        let filtered = store.list_awaiting(Some(&allow)).await.unwrap();
        assert!(filtered.iter().any(|r| r.session_id == s_a));
        assert!(!filtered.iter().any(|r| r.session_id == s_b));

        let unfiltered = store.list_awaiting(None).await.unwrap();
        assert!(unfiltered.iter().any(|r| r.session_id == s_a));
        assert!(unfiltered.iter().any(|r| r.session_id == s_b));
    }

    /// `answer_awaiting` clears the bit and enqueues a pending message in a
    /// single transaction. Returning `Ok(true)` means we won the race.
    #[tokio::test]
    async fn answer_awaiting_clears_and_enqueues_atomically() {
        let store = test_store().await;
        let session_id = store
            .create_session("agent-x", "session", "ask flow", None, None)
            .await
            .unwrap();
        store.set_awaiting(&session_id, "subj").await.unwrap();

        let won = store
            .answer_awaiting(&session_id, "{\"kind\":\"user_reply\",\"message\":\"yes\"}")
            .await
            .unwrap();
        assert!(won);

        // Bit cleared.
        let post = store.list_awaiting(None).await.unwrap();
        assert!(post.iter().all(|r| r.session_id != session_id));

        // Pending row visible to the next claim.
        let claimed = store
            .claim_pending_for_session(&session_id, None)
            .await
            .unwrap();
        assert_eq!(claimed.len(), 1);
    }

    /// `claim_pending_for_session` must surface the inner user text from a
    /// structured `QueuedMessage` payload — not the raw JSON envelope. This
    /// is what the agent's step-boundary injection path consumes and feeds
    /// into the LLM as a `Role::User` message. Pre-fix it leaked the JSON
    /// shape into the prompt.
    #[tokio::test]
    async fn claim_pending_extracts_message_from_queued_payload() {
        let store = test_store().await;
        let sid = "sess-extract";

        let qm = crate::queue_executor::QueuedMessage::user_reply(
            "agent-x",
            "ship it",
            Some("user-1".to_string()),
        );
        let payload = qm.to_payload().unwrap();
        store.enqueue_pending(sid, &payload).await.unwrap();

        let claimed = store.claim_pending_for_session(sid, None).await.unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(
            claimed[0].content, "ship it",
            "structured payloads must surface the inner message text, not the JSON envelope"
        );
    }

    /// A regular chat enqueue (user-originated) must clear `awaiting_at`
    /// if the session was awaiting. This closes the stale-inbox-row hole
    /// when a director types into the chat composer instead of using the
    /// inbox inline reply.
    #[tokio::test]
    async fn enqueue_pending_clears_awaiting_for_user_payload() {
        let store = test_store().await;
        let session_id = store
            .create_session("agent-z", "session", "chat reply", None, None)
            .await
            .unwrap();
        store.set_awaiting(&session_id, "subj").await.unwrap();

        let qm = crate::queue_executor::QueuedMessage::chat(
            "agent-z",
            "answering in chat",
            None,
            Some("web".to_string()),
        );
        let payload = qm.to_payload().unwrap();
        store.enqueue_pending(&session_id, &payload).await.unwrap();

        let listed = store.list_awaiting(None).await.unwrap();
        assert!(
            listed.iter().all(|r| r.session_id != session_id),
            "user-originated enqueue must clear awaiting_at"
        );
    }

    /// Quest re-enqueues must NOT clear `awaiting_at` — they're the agent
    /// continuing its own work, not a human answering.
    #[tokio::test]
    async fn enqueue_pending_preserves_awaiting_for_quest_payload() {
        let store = test_store().await;
        let session_id = store
            .create_session("agent-z", "session", "quest re-enqueue", None, None)
            .await
            .unwrap();
        store.set_awaiting(&session_id, "subj").await.unwrap();

        let qm = crate::queue_executor::QueuedMessage::quest(
            "agent-z",
            "continue quest",
            "quest-id",
            None,
            None,
        );
        let payload = qm.to_payload().unwrap();
        store.enqueue_pending(&session_id, &payload).await.unwrap();

        let listed = store.list_awaiting(None).await.unwrap();
        assert!(
            listed.iter().any(|r| r.session_id == session_id),
            "quest enqueue must NOT clear awaiting_at — only human replies do"
        );
    }

    /// Second `answer_awaiting` for the same session must lose — the row
    /// count check on the UPDATE prevents a duplicate enqueue.
    #[tokio::test]
    async fn answer_awaiting_second_caller_loses() {
        let store = test_store().await;
        let session_id = store
            .create_session("agent-y", "session", "ask flow", None, None)
            .await
            .unwrap();
        store.set_awaiting(&session_id, "subj").await.unwrap();

        let won = store
            .answer_awaiting(&session_id, "{\"message\":\"first\"}")
            .await
            .unwrap();
        assert!(won);

        let lost = store
            .answer_awaiting(&session_id, "{\"message\":\"second\"}")
            .await
            .unwrap();
        assert!(
            !lost,
            "second caller must return Ok(false) once awaiting_at is cleared"
        );

        // Exactly one pending row exists.
        let claimed = store
            .claim_pending_for_session(&session_id, None)
            .await
            .unwrap();
        assert_eq!(claimed.len(), 1);
    }
}
