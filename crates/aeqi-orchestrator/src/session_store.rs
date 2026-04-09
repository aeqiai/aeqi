//! Persistent Session Store — SQLite-backed session history
//! that survives daemon restarts.
//!
//! Uses a shared `Arc<Mutex<Connection>>` from AgentRegistry (agents.db)
//! instead of opening a separate sessions.db file.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
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
    #[serde(alias = "task_id")]
    pub quest_id: Option<String>,
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
}

/// Persistent session store backed by SQLite.
pub struct SessionStore {
    db: Arc<Mutex<Connection>>,
    /// Max messages per session before auto-summarization kicks in.
    pub max_messages_per_chat: usize,
}

impl SessionStore {
    /// Create a SessionStore sharing an existing connection (from AgentRegistry).
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self {
            db,
            max_messages_per_chat: 30,
        }
    }

    /// Create the session-related tables and indexes. Called during AgentRegistry::open().
    pub fn create_tables(conn: &Connection) -> Result<()> {
        // ── Migration: Rename legacy tables if they exist ──

        // Rename conversations → session_messages (idempotent).
        {
            let has_conversations: bool = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'",
                )?
                .query_map([], |_row| Ok(()))?
                .next()
                .is_some();
            if has_conversations {
                let _ = conn.execute_batch("ALTER TABLE conversations RENAME TO session_messages;");
            }
        }

        // Rename conversation_summaries → session_summaries (idempotent).
        {
            let has_conv_summaries: bool = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
                )?
                .query_map([], |_row| Ok(()))?
                .next()
                .is_some();
            if has_conv_summaries {
                let _ = conn.execute_batch(
                    "ALTER TABLE conversation_summaries RENAME TO session_summaries;",
                );
            }
        }

        // ── Fix: make chat_id nullable (was NOT NULL from legacy conversations table) ──
        // SQLite doesn't support ALTER COLUMN, so we recreate the table.
        {
            let chat_id_notnull: bool = conn
                .prepare("PRAGMA table_info(session_messages)")
                .ok()
                .map(|mut stmt| {
                    stmt.query_map([], |row| {
                        Ok((row.get::<_, String>(1)?, row.get::<_, bool>(3)?))
                    })
                    .ok()
                    .map(|rows| {
                        rows.filter_map(|r| r.ok())
                            .any(|(name, notnull)| name == "chat_id" && notnull)
                    })
                    .unwrap_or(false)
                })
                .unwrap_or(false);

            if chat_id_notnull {
                // Drop FTS triggers first (they reference session_messages).
                let _ = conn.execute_batch(
                    "DROP TRIGGER IF EXISTS session_messages_ai;
                     DROP TRIGGER IF EXISTS session_messages_ad;
                     DROP TRIGGER IF EXISTS session_messages_au;
                     DROP TRIGGER IF EXISTS conversations_ai;
                     DROP TRIGGER IF EXISTS conversations_ad;
                     DROP TRIGGER IF EXISTS conversations_au;
                     DROP TABLE IF EXISTS messages_fts;
                     DROP TABLE IF EXISTS session_messages_new;",
                );
                let _ = conn.execute_batch(
                    "CREATE TABLE session_messages_new (
                         id INTEGER PRIMARY KEY AUTOINCREMENT,
                         chat_id INTEGER,
                         session_id TEXT,
                         role TEXT NOT NULL,
                         content TEXT NOT NULL,
                         timestamp TEXT NOT NULL,
                         summarized INTEGER DEFAULT 0,
                         source TEXT DEFAULT NULL,
                         event_type TEXT NOT NULL DEFAULT 'message',
                         metadata TEXT DEFAULT NULL
                     );
                     INSERT INTO session_messages_new (id, chat_id, session_id, role, content, timestamp, summarized, source, event_type, metadata)
                         SELECT id, chat_id, session_id, role, content, timestamp, summarized, source, event_type, metadata FROM session_messages;
                     DROP TABLE session_messages;
                     ALTER TABLE session_messages_new RENAME TO session_messages;",
                );
            }
        }

        // ── Create session_messages table (new schema) ──
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
                 metadata TEXT DEFAULT NULL
             );",
        )
        .context("failed to initialize session_messages schema")?;

        // Legacy column migrations (idempotent — columns may already exist).
        let _ =
            conn.execute_batch("ALTER TABLE session_messages ADD COLUMN source TEXT DEFAULT NULL;");
        let _ = conn.execute_batch(
            "ALTER TABLE session_messages ADD COLUMN event_type TEXT DEFAULT 'message';",
        );
        let _ = conn
            .execute_batch("ALTER TABLE session_messages ADD COLUMN metadata TEXT DEFAULT NULL;");
        // Add session_id column for tables migrated from conversations.
        let _ = conn
            .execute_batch("ALTER TABLE session_messages ADD COLUMN session_id TEXT DEFAULT NULL;");
        // Preserve legacy chat_id column so old data isn't lost.
        let _ = conn.execute_batch("ALTER TABLE session_messages ADD COLUMN chat_id INTEGER;");
        // Legacy index (may already exist under old name).
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_conv_chat ON session_messages(chat_id);",
        );
        // Indexes that depend on columns added above.
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_session_msgs_session ON session_messages(session_id);
             CREATE INDEX IF NOT EXISTS idx_session_msgs_ts ON session_messages(timestamp);",
        );

        // ── session_summaries table ──
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS session_summaries (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 chat_id INTEGER,
                 summary TEXT NOT NULL,
                 covers_until TEXT NOT NULL
             );",
        )
        .context("failed to create session_summaries table")?;
        // Add session_id column (idempotent — may already exist).
        let _ = conn.execute_batch(
            "ALTER TABLE session_summaries ADD COLUMN session_id TEXT DEFAULT NULL;",
        );
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_summ_session ON session_summaries(session_id);",
        );

        // ── Legacy channels table — keep for migration reads, but do NOT create new rows ──
        // (table may exist from old schema; we don't create it fresh)

        // Drop old FTS triggers that reference 'conversations' BEFORE creating new ones.
        let _ = conn.execute_batch(
            "DROP TRIGGER IF EXISTS conversations_ai;
             DROP TRIGGER IF EXISTS conversations_ad;
             DROP TRIGGER IF EXISTS conversations_au;",
        );

        // Drop old FTS table if it points to wrong content table, then recreate.
        // (FTS5 content table can't be changed after creation)
        let _ = conn.execute_batch("DROP TABLE IF EXISTS messages_fts;");

        // FTS5 virtual table for full-text search across transcripts.
        let _ = conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                 content,
                 content=session_messages,
                 content_rowid=id
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
        );

        // ── 4A-migrate: Rename old `unified_sessions` → `sessions` if needed ──
        {
            let has_old: bool = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='unified_sessions'",
                )?
                .query_map([], |_row| Ok(()))?
                .next()
                .is_some();
            if has_old {
                conn.execute_batch("ALTER TABLE unified_sessions RENAME TO sessions;")?;
                let _ = conn.execute_batch(
                    "DROP INDEX IF EXISTS idx_usess_agent;
                     DROP INDEX IF EXISTS idx_usess_project;
                     DROP INDEX IF EXISTS idx_usess_type;
                     DROP INDEX IF EXISTS idx_sess_project;
                     CREATE INDEX IF NOT EXISTS idx_sess_agent ON sessions(agent_id);
                     CREATE INDEX IF NOT EXISTS idx_sess_type ON sessions(session_type);",
                );
            }
        }

        // ── Sessions table ──
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS sessions (
                 id TEXT PRIMARY KEY,
                 legacy_chat_id INTEGER,
                 agent_id TEXT,
                 session_type TEXT NOT NULL,
                 name TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'active',
                 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
                 closed_at TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_sess_agent ON sessions(agent_id);
             CREATE INDEX IF NOT EXISTS idx_sess_type ON sessions(session_type);",
        )
        .context("failed to create sessions table")?;

        // ── Phase A: Add parent_id and task_id to sessions ──
        let _ = conn.execute_batch("ALTER TABLE sessions ADD COLUMN parent_id TEXT;");
        let _ = conn.execute_batch("ALTER TABLE sessions ADD COLUMN task_id TEXT;");
        let _ = conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_sess_parent ON sessions(parent_id);
             CREATE INDEX IF NOT EXISTS idx_sess_task ON sessions(task_id);",
        );

        // ── Phase 4: Rename task_id → quest_id ──
        let _ = conn.execute_batch("ALTER TABLE sessions ADD COLUMN quest_id TEXT;");
        let _ = conn.execute_batch(
            "UPDATE sessions SET quest_id = task_id WHERE quest_id IS NULL AND task_id IS NOT NULL;",
        );
        let _ =
            conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_sess_quest ON sessions(quest_id);");

        // ── Backfill session_id into session_messages from sessions.legacy_chat_id ──
        let _ = conn.execute_batch(
            "UPDATE session_messages SET session_id = (
                 SELECT s.id FROM sessions s WHERE s.legacy_chat_id = session_messages.chat_id
             ) WHERE session_id IS NULL AND chat_id IS NOT NULL;",
        );

        // ── Backfill session_id into session_summaries from sessions.legacy_chat_id ──
        let _ = conn.execute_batch(
            "UPDATE session_summaries SET session_id = (
                 SELECT s.id FROM sessions s WHERE s.legacy_chat_id = session_summaries.chat_id
             ) WHERE session_id IS NULL AND chat_id IS NOT NULL;",
        );

        // ── 4B: Backfill sessions from channels (legacy) ──
        {
            let has_channels: bool = conn
                .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='channels'")?
                .query_map([], |_row| Ok(()))?
                .next()
                .is_some();
            if has_channels {
                let _ = conn.execute_batch(
                    "INSERT OR IGNORE INTO sessions (id, legacy_chat_id, agent_id, session_type, name, status, created_at)
                     SELECT
                         lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
                         chat_id,
                         agent_id,
                         channel_type,
                         name,
                         'active',
                         created_at
                     FROM channels
                     WHERE chat_id NOT IN (SELECT legacy_chat_id FROM sessions WHERE legacy_chat_id IS NOT NULL);",
                );
            }
        }

        // ── 4C: Backfill from agent_sessions (if it exists) ──
        {
            let has_agent_sessions: bool = conn
                .prepare(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_sessions'",
                )?
                .query_map([], |_row| Ok(()))?
                .next()
                .is_some();
            if has_agent_sessions {
                let _ = conn.execute_batch(
                    "INSERT OR IGNORE INTO sessions (id, agent_id, session_type, name, status, created_at, closed_at)
                     SELECT id, agent_id, 'perpetual', 'Permanent Session', status, created_at, closed_at
                     FROM agent_sessions
                     WHERE id NOT IN (SELECT id FROM sessions);",
                );
            }
        }

        debug!("session store tables created");

        Ok(())
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

    /// Get or create a session UUID for a legacy chat_id.
    pub async fn ensure_session(
        &self,
        chat_id: i64,
        session_type: &str,
        name: &str,
        agent_id: Option<&str>,
    ) -> Result<String> {
        let db = self.db.lock().await;
        // Check if session exists for this chat_id.
        let existing: Option<String> = db
            .query_row(
                "SELECT id FROM sessions WHERE legacy_chat_id = ?1",
                params![chat_id],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(id) = existing {
            return Ok(id);
        }

        // Create new.
        let id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO sessions (id, legacy_chat_id, session_type, name, agent_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, chat_id, session_type, name, agent_id],
        )?;
        Ok(id)
    }

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
    pub async fn record_event_by_session(
        &self,
        session_id: &str,
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
            "INSERT INTO session_messages (session_id, role, content, timestamp, source, event_type, metadata) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![session_id, role, content, now, source, event_type, metadata_text],
        )
        .context("failed to insert session message by session_id")?;
        Ok(())
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
            "SELECT id, session_id, event_type, role, content, timestamp, source, metadata \
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
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut events = rows;
        events.reverse();
        Ok(events)
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
                "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, COALESCE(quest_id, task_id) as quest_id \
                 FROM sessions WHERE agent_id = ?1 ORDER BY created_at DESC LIMIT ?2"
                    .to_string(),
                vec![
                    Box::new(aid.to_string()) as Box<dyn rusqlite::types::ToSql>,
                    Box::new(limit as i64),
                ],
            ),
            None => (
                "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, COALESCE(quest_id, task_id) as quest_id \
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

    /// Get a single session by ID.
    pub async fn get_session(&self, session_id: &str) -> Result<Option<Session>> {
        let db = self.db.lock().await;
        let session = db
            .query_row(
                "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, COALESCE(quest_id, task_id) as quest_id
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
                    })
                },
            )
            .optional()?;
        Ok(session)
    }

    /// List child sessions for a given parent session.
    pub async fn list_children(&self, parent_id: &str) -> Result<Vec<Session>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, agent_id, session_type, name, status, created_at, closed_at, parent_id, COALESCE(quest_id, task_id) as quest_id
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

    fn open_test_db() -> Arc<Mutex<Connection>> {
        let conn = Connection::open_in_memory().unwrap();
        SessionStore::create_tables(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    fn test_store() -> SessionStore {
        SessionStore::new(open_test_db())
    }

    #[tokio::test]
    async fn test_record_and_recent() {
        let store = test_store();

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
        let store = test_store();

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
        let store = test_store();

        store.record(42, "User", "hello").await.unwrap();
        store.record(42, "Assistant", "world").await.unwrap();

        let ctx = store.context_string(42, 10).await.unwrap();
        assert!(ctx.contains("Conversation History"));
        assert!(ctx.contains("**User**: hello"));
        assert!(ctx.contains("**Assistant**: world"));
    }

    #[tokio::test]
    async fn test_context_string_empty() {
        let store = test_store();

        let ctx = store.context_string(999, 10).await.unwrap();
        assert!(ctx.is_empty());
    }

    #[tokio::test]
    async fn test_save_summary() {
        let store = test_store();

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
        let store = test_store();

        store.record(1, "User", "a").await.unwrap();
        store.record(1, "User", "b").await.unwrap();
        store.record(2, "User", "c").await.unwrap();

        assert_eq!(store.message_count(1).await.unwrap(), 2);
        assert_eq!(store.message_count(2).await.unwrap(), 1);
        assert_eq!(store.message_count(999).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn test_chat_isolation() {
        let store = test_store();

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
        let store = test_store();

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
    async fn test_ensure_session_creates_and_returns() {
        let store = test_store();

        let id1 = store
            .ensure_session(100, "web", "test-session", None)
            .await
            .unwrap();
        assert!(!id1.is_empty());
        assert!(id1.contains('-')); // UUID format

        // Calling again returns the same ID.
        let id2 = store
            .ensure_session(100, "web", "test-session", None)
            .await
            .unwrap();
        assert_eq!(id1, id2);
    }

    #[tokio::test]
    async fn test_ensure_session_with_agent() {
        let store = test_store();

        let id = store
            .ensure_session(200, "web", "agent-session", Some("agent-uuid-1"))
            .await
            .unwrap();

        let sessions = store.list_sessions(Some("agent-uuid-1"), 10).await.unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, id);
        assert_eq!(sessions[0].agent_id.as_deref(), Some("agent-uuid-1"));
    }

    #[tokio::test]
    async fn test_record_and_history_by_session() {
        let store = test_store();

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
        let store = test_store();

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
        let store = test_store();

        // Recording empty content should succeed (the DB allows it).
        store.record(1, "User", "").await.unwrap();

        let msgs = store.recent(1, 10).await.unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].content, "");
    }

    #[tokio::test]
    async fn list_sessions_empty() {
        let store = test_store();

        let sessions = store.list_sessions(None, 100).await.unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn close_nonexistent_session() {
        let store = test_store();

        // close_session runs an UPDATE that matches zero rows — no error, just a no-op.
        let result = store.close_session("nonexistent-uuid").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn session_messages_with_limit() {
        let store = test_store();

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
        let store = test_store();

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
}
