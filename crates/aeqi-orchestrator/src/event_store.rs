//! Unified event store — one table for all events.
//!
//! Replaces: audit log, cost ledger, expertise ledger, session messages,
//! dispatch bus. Every event is an immutable row with a type, optional
//! agent/session/task foreign keys, and JSON content.

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, warn};

// ---------------------------------------------------------------------------
// Dispatch types (formerly in message.rs)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DispatchKind {
    /// A delegation request from one agent to another.
    DelegateRequest {
        prompt: String,
        /// How the response should be routed: "origin", "perpetual", "async", "department", "none".
        response_mode: String,
        /// Whether to also create a tracked task for this delegation.
        create_task: bool,
        /// Optional skill hint for the target agent.
        skill: Option<String>,
        /// Dispatch ID this is replying to (for chained delegations).
        reply_to: Option<String>,
        /// Session ID of the calling agent, so the child worker can set parent_id.
        #[serde(default)]
        parent_session_id: Option<String>,
    },
    /// A response to a previous DelegateRequest.
    DelegateResponse {
        /// The dispatch ID of the original DelegateRequest.
        reply_to: String,
        /// Copied from the request for routing purposes.
        response_mode: String,
        /// The response content.
        content: String,
    },
    /// Escalation to human operator when all automated resolution is exhausted.
    HumanEscalation {
        project: String,
        task_id: String,
        subject: String,
        summary: String,
    },
}

impl DispatchKind {
    pub fn requires_ack_by_default(&self) -> bool {
        matches!(self, Self::DelegateRequest { .. })
    }

    pub fn subject_tag(&self) -> &'static str {
        match self {
            Self::DelegateRequest { .. } => "DELEGATE_REQUEST",
            Self::DelegateResponse { .. } => "DELEGATE_RESPONSE",
            Self::HumanEscalation { .. } => "HUMAN_ESCALATION",
        }
    }

    pub fn body_text(&self) -> String {
        match self {
            Self::DelegateRequest {
                prompt,
                response_mode,
                create_task,
                skill,
                reply_to,
                ..
            } => {
                let mut text = format!(
                    "Delegation request (response_mode: {response_mode}, create_task: {create_task})"
                );
                if let Some(s) = skill {
                    text.push_str(&format!(", skill: {s}"));
                }
                if let Some(rt) = reply_to {
                    text.push_str(&format!(", reply_to: {rt}"));
                }
                text.push_str(&format!("\n\n{prompt}"));
                text
            }
            Self::DelegateResponse {
                reply_to,
                response_mode,
                content,
            } => format!(
                "Delegation response (reply_to: {reply_to}, mode: {response_mode})\n\n{content}"
            ),
            Self::HumanEscalation {
                project,
                task_id,
                subject,
                summary,
            } => format!(
                "BLOCKED: {project}/{task_id} — {subject}\n\n{summary}\n\n\
                     This task has exhausted all automated resolution attempts and requires human input.",
            ),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dispatch {
    pub from: String,
    pub to: String,
    pub kind: DispatchKind,
    pub timestamp: DateTime<Utc>,
    pub read: bool,
    /// Unique dispatch ID for acknowledgment tracking.
    #[serde(default = "default_dispatch_id")]
    pub id: String,
    /// Whether this dispatch requires explicit acknowledgment.
    #[serde(default)]
    pub requires_ack: bool,
    /// Number of retry attempts so far.
    #[serde(default)]
    pub retry_count: u32,
    /// Maximum retries before dead-lettering.
    #[serde(default = "default_max_retries")]
    pub max_retries: u32,
    /// When the dispatch was first sent (for total latency tracking).
    #[serde(default = "Utc::now")]
    pub first_sent_at: DateTime<Utc>,
    /// Optional idempotency key. If set, duplicate dispatches with the same key
    /// are silently dropped. Prevents duplicate work on retry/reconnect.
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

/// Snapshot of control-plane delivery state.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DispatchHealth {
    /// Messages currently unread by their recipient.
    pub unread: usize,
    /// Ack-required messages that were delivered but not yet acknowledged.
    pub awaiting_ack: usize,
    /// Ack-required messages that are back in the unread queue after a retry.
    pub retrying_delivery: usize,
    /// Awaiting-ack messages older than the patrol retry threshold.
    pub overdue_ack: usize,
    /// Messages that exhausted retries and are now in dead-letter state.
    pub dead_letters: usize,
}

fn default_dispatch_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn default_max_retries() -> u32 {
    3
}

impl Dispatch {
    pub fn new_typed(from: &str, to: &str, kind: DispatchKind) -> Self {
        let now = Utc::now();
        let requires_ack = kind.requires_ack_by_default();
        Self {
            from: from.to_string(),
            to: to.to_string(),
            kind,
            timestamp: now,
            read: false,
            id: default_dispatch_id(),
            requires_ack,
            retry_count: 0,
            max_retries: 3,
            first_sent_at: now,
            idempotency_key: None,
        }
    }

    /// Mark this dispatch as requiring acknowledgment.
    pub fn with_ack_required(mut self) -> Self {
        self.requires_ack = true;
        self
    }

    /// Set an idempotency key to prevent duplicate execution.
    pub fn with_idempotency_key(mut self, key: impl Into<String>) -> Self {
        self.idempotency_key = Some(key.into());
        self
    }

    /// Serialize this dispatch to JSON content for EventStore storage.
    fn to_event_content(&self) -> serde_json::Value {
        let kind_json = serde_json::to_value(&self.kind).unwrap_or_default();
        serde_json::json!({
            "from": self.from,
            "to": self.to,
            "kind": kind_json,
            "status": if self.read { "read" } else { "pending" },
            "dispatch_id": self.id,
            "requires_ack": self.requires_ack,
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "first_sent_at": self.first_sent_at.to_rfc3339(),
            "idempotency_key": self.idempotency_key,
        })
    }

    /// Reconstruct a Dispatch from an Event's content JSON.
    fn from_event(event: &Event) -> Option<Self> {
        let c = &event.content;
        let from = c.get("from")?.as_str()?.to_string();
        let to = c.get("to")?.as_str()?.to_string();
        let kind: DispatchKind = serde_json::from_value(c.get("kind")?.clone()).ok()?;
        let status = c
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("pending");
        let dispatch_id = c
            .get("dispatch_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let requires_ack = c
            .get("requires_ack")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let retry_count = c.get("retry_count").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
        let max_retries = c.get("max_retries").and_then(|v| v.as_u64()).unwrap_or(3) as u32;
        let first_sent_at = c
            .get("first_sent_at")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or(event.created_at);
        let idempotency_key = c
            .get("idempotency_key")
            .and_then(|v| v.as_str())
            .map(String::from);

        Some(Dispatch {
            from,
            to,
            kind,
            timestamp: event.created_at,
            read: status != "pending",
            id: if dispatch_id.is_empty() {
                event.id.clone()
            } else {
                dispatch_id
            },
            requires_ack,
            retry_count,
            max_retries,
            first_sent_at,
            idempotency_key,
        })
    }
}

/// A single event in the unified store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    pub quest_id: Option<String>,
    pub content: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

/// Query filters for event retrieval.
#[derive(Debug, Default)]
pub struct EventFilter {
    pub event_type: Option<String>,
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    pub quest_id: Option<String>,
    pub since: Option<DateTime<Utc>>,
    pub since_id: Option<String>,
}

/// The unified event store, backed by a shared SQLite connection.
pub struct EventStore {
    db: Arc<Mutex<Connection>>,
    /// TTL for dispatch pruning (seconds).
    dispatch_ttl_secs: std::sync::atomic::AtomicU64,
    /// Max queue depth per recipient (soft limit).
    dispatch_max_queue: usize,
    /// Optional event broadcaster for emitting DispatchReceived events.
    event_broadcaster: std::sync::RwLock<Option<Arc<crate::execution_events::EventBroadcaster>>>,
}

impl EventStore {
    /// Create an EventStore sharing an existing connection (from AgentRegistry).
    pub fn new(db: Arc<Mutex<Connection>>) -> Self {
        Self {
            db,
            dispatch_ttl_secs: std::sync::atomic::AtomicU64::new(3600),
            dispatch_max_queue: 1000,
            event_broadcaster: std::sync::RwLock::new(None),
        }
    }

    /// Set the event broadcaster for emitting DispatchReceived events.
    pub fn set_event_broadcaster(
        &self,
        broadcaster: Arc<crate::execution_events::EventBroadcaster>,
    ) {
        if let Ok(mut guard) = self.event_broadcaster.write() {
            *guard = Some(broadcaster);
        }
    }

    pub fn set_dispatch_ttl(&self, secs: u64) {
        self.dispatch_ttl_secs
            .store(secs, std::sync::atomic::Ordering::Relaxed);
    }

    /// Create the events table and indexes. Called during AgentRegistry::open().
    pub fn create_tables(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
                 id TEXT PRIMARY KEY,
                 type TEXT NOT NULL,
                 agent_id TEXT,
                 session_id TEXT,
                 quest_id TEXT,
                 content TEXT NOT NULL DEFAULT '{}',
                 created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
             CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
             CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
             CREATE INDEX IF NOT EXISTS idx_events_quest ON events(quest_id);
             CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);",
        )?;

        // FTS5 for full-text search over event content.
        // Ignore errors (FTS5 may not be compiled in on all platforms).
        let _ = conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
                 USING fts5(content, content=events, content_rowid=rowid);",
        );

        Ok(())
    }

    /// Emit a new event. Returns the event ID.
    pub async fn emit(
        &self,
        event_type: &str,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        quest_id: Option<&str>,
        content: &serde_json::Value,
    ) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let content_str = serde_json::to_string(content)?;

        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO events (id, type, agent_id, session_id, quest_id, content, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                event_type,
                agent_id,
                session_id,
                quest_id,
                content_str,
                now
            ],
        )?;

        debug!(id = %id, event_type = %event_type, "event emitted");
        Ok(id)
    }

    /// Query events with filters.
    pub async fn query(&self, filter: &EventFilter, limit: u32, offset: u32) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut sql = String::from("SELECT * FROM events WHERE 1=1");
        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut idx = 1;

        if let Some(ref t) = filter.event_type {
            sql.push_str(&format!(" AND type = ?{idx}"));
            param_values.push(Box::new(t.clone()));
            idx += 1;
        }
        if let Some(ref a) = filter.agent_id {
            sql.push_str(&format!(" AND agent_id = ?{idx}"));
            param_values.push(Box::new(a.clone()));
            idx += 1;
        }
        if let Some(ref s) = filter.session_id {
            sql.push_str(&format!(" AND session_id = ?{idx}"));
            param_values.push(Box::new(s.clone()));
            idx += 1;
        }
        if let Some(ref t) = filter.quest_id {
            sql.push_str(&format!(" AND quest_id = ?{idx}"));
            param_values.push(Box::new(t.clone()));
            idx += 1;
        }
        if let Some(ref since) = filter.since {
            sql.push_str(&format!(" AND created_at >= ?{idx}"));
            param_values.push(Box::new(since.to_rfc3339()));
            idx += 1;
        }
        if let Some(ref since_id) = filter.since_id {
            sql.push_str(&format!(" AND id > ?{idx}"));
            param_values.push(Box::new(since_id.clone()));
            idx += 1;
        }

        sql.push_str(&format!(
            " ORDER BY created_at DESC LIMIT ?{idx} OFFSET ?{}",
            idx + 1
        ));
        param_values.push(Box::new(limit));
        param_values.push(Box::new(offset));

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|b| b.as_ref()).collect();

        let mut stmt = db.prepare(&sql)?;
        let events = stmt
            .query_map(params_refs.as_slice(), |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(events)
    }

    /// Sum a JSON field across events of a given type, with optional date filter.
    /// Used for budget checking: `query_sum("cost", "$.cost_usd", Some(today))`.
    pub async fn query_sum(
        &self,
        event_type: &str,
        json_path: &str,
        since: Option<&DateTime<Utc>>,
    ) -> Result<f64> {
        let db = self.db.lock().await;
        let sql = if since.is_some() {
            format!(
                "SELECT COALESCE(SUM(json_extract(content, '{json_path}')), 0.0)
                 FROM events WHERE type = ?1 AND created_at >= ?2"
            )
        } else {
            format!(
                "SELECT COALESCE(SUM(json_extract(content, '{json_path}')), 0.0)
                 FROM events WHERE type = ?1"
            )
        };

        let result: f64 = if let Some(since_dt) = since {
            db.query_row(&sql, params![event_type, since_dt.to_rfc3339()], |row| {
                row.get(0)
            })?
        } else {
            db.query_row(&sql, params![event_type], |row| row.get(0))?
        };

        Ok(result)
    }

    /// Get events since a given ID (for tailing/polling).
    pub async fn tail(
        &self,
        event_type: Option<&str>,
        since_id: &str,
        limit: u32,
    ) -> Result<Vec<Event>> {
        let filter = EventFilter {
            event_type: event_type.map(String::from),
            since_id: Some(since_id.to_string()),
            ..Default::default()
        };
        self.query(&filter, limit, 0).await
    }

    /// Full-text search over event content.
    pub async fn search(&self, query_text: &str, limit: u32) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT e.* FROM events e
             JOIN events_fts f ON e.rowid = f.rowid
             WHERE events_fts MATCH ?1
             ORDER BY rank LIMIT ?2",
        )?;
        let events = stmt
            .query_map(params![query_text, limit], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// Update an event's content (for status changes on dispatches).
    pub async fn update(&self, event_id: &str, content: &serde_json::Value) -> Result<()> {
        let content_str = serde_json::to_string(content)?;
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE events SET content = ?1 WHERE id = ?2",
            params![content_str, event_id],
        )?;
        if updated == 0 {
            anyhow::bail!("event '{event_id}' not found");
        }
        Ok(())
    }

    /// Count events matching a filter.
    pub async fn count(&self, event_type: &str, since: Option<&DateTime<Utc>>) -> Result<u64> {
        let db = self.db.lock().await;
        let count: i64 = if let Some(since_dt) = since {
            db.query_row(
                "SELECT COUNT(*) FROM events WHERE type = ?1 AND created_at >= ?2",
                params![event_type, since_dt.to_rfc3339()],
                |row| row.get(0),
            )?
        } else {
            db.query_row(
                "SELECT COUNT(*) FROM events WHERE type = ?1",
                params![event_type],
                |row| row.get(0),
            )?
        };
        Ok(count as u64)
    }

    /// Query expertise data from task_completed events (replaces ExpertiseLedger).
    pub async fn query_expertise(&self) -> Result<Vec<serde_json::Value>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT json_extract(content, '$.agent_name') as agent,
                    SUM(CASE WHEN json_extract(content, '$.outcome') = 'done' THEN 1 ELSE 0 END) as wins,
                    COUNT(*) as total,
                    AVG(json_extract(content, '$.cost_usd')) as avg_cost
             FROM events WHERE type = 'task_completed'
             GROUP BY agent ORDER BY wins DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                let agent: String = row.get(0)?;
                let wins: i64 = row.get(1)?;
                let total: i64 = row.get(2)?;
                let avg_cost: f64 = row.get(3)?;
                Ok(serde_json::json!({
                    "agent": agent,
                    "wins": wins,
                    "total": total,
                    "avg_cost": avg_cost,
                    "success_rate": if total > 0 { wins as f64 / total as f64 } else { 0.0 },
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    // -----------------------------------------------------------------------
    // Cost helpers (replaces CostLedger)
    // -----------------------------------------------------------------------

    /// Record a cost event.
    pub async fn record_cost(
        &self,
        agent_id: &str,
        quest_id: &str,
        agent_name: &str,
        cost_usd: f64,
        turns: u32,
    ) -> Result<String> {
        self.emit(
            "cost",
            Some(agent_id),
            None,
            Some(quest_id),
            &serde_json::json!({
                "agent_name": agent_name,
                "cost_usd": cost_usd,
                "turns": turns,
            }),
        )
        .await
    }

    /// Get total cost for today.
    pub async fn daily_cost(&self) -> Result<f64> {
        let today = chrono::Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let today = DateTime::<Utc>::from_naive_utc_and_offset(today, Utc);
        self.query_sum("cost", "$.cost_usd", Some(&today)).await
    }

    /// Get all project costs for today as a map.
    pub async fn daily_costs_by_project(&self) -> Result<std::collections::HashMap<String, f64>> {
        let today = chrono::Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let today_str = DateTime::<Utc>::from_naive_utc_and_offset(today, Utc).to_rfc3339();
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT json_extract(content, '$.project') as project,
                    SUM(json_extract(content, '$.cost_usd')) as total
             FROM events WHERE type = 'cost' AND created_at >= ?1
             GROUP BY project",
        )?;
        let rows: Vec<(String, f64)> = stmt
            .query_map(params![today_str], |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, f64>(1).unwrap_or(0.0),
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows.into_iter().collect())
    }

    /// Get total cost for a specific project today.
    pub async fn daily_cost_by_project(&self, project: &str) -> Result<f64> {
        let today = chrono::Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let today_str = DateTime::<Utc>::from_naive_utc_and_offset(today, Utc).to_rfc3339();
        let db = self.db.lock().await;
        let result: f64 = db.query_row(
            "SELECT COALESCE(SUM(json_extract(content, '$.cost_usd')), 0.0)
             FROM events WHERE type = 'cost'
             AND json_extract(content, '$.project') = ?1
             AND created_at >= ?2",
            params![project, today_str],
            |row| row.get(0),
        )?;
        Ok(result)
    }

    /// Delete old events (for pruning).
    pub async fn prune(&self, event_type: &str, older_than: &DateTime<Utc>) -> Result<u64> {
        let db = self.db.lock().await;
        let deleted = db.execute(
            "DELETE FROM events WHERE type = ?1 AND created_at < ?2",
            params![event_type, older_than.to_rfc3339()],
        )?;
        Ok(deleted as u64)
    }

    // -----------------------------------------------------------------------
    // Dispatch helpers (replaces DispatchBus SQLite/memory backends)
    // -----------------------------------------------------------------------

    /// Send a dispatch: store as a "dispatch" event. Returns the event ID.
    ///
    /// Content JSON stores: from, to, kind, status, requires_ack, retry_count,
    /// max_retries, first_sent_at, idempotency_key.
    pub async fn send_dispatch(&self, content: &serde_json::Value) -> Result<String> {
        // Idempotency check: if idempotency_key is set, reject duplicates.
        if let Some(key) = content.get("idempotency_key").and_then(|v| v.as_str())
            && !key.is_empty()
        {
            let db = self.db.lock().await;
            let exists: bool = db.query_row(
                "SELECT COUNT(*) > 0 FROM events
                     WHERE type = 'dispatch'
                     AND json_extract(content, '$.idempotency_key') = ?1",
                params![key],
                |row| row.get(0),
            )?;
            if exists {
                debug!(key = %key, "dispatch dropped (idempotency key already exists)");
                anyhow::bail!("idempotency_key_exists");
            }
            drop(db);
        }

        self.emit("dispatch", None, None, None, content).await
    }

    /// Read unread dispatches for a recipient, marking them as read.
    pub async fn read_dispatches(&self, recipient: &str) -> Result<Vec<Event>> {
        let db = self.db.lock().await;

        // Find unread dispatches addressed to this recipient.
        let mut stmt = db.prepare(
            "SELECT * FROM events
             WHERE type = 'dispatch'
             AND json_extract(content, '$.to') = ?1
             AND json_extract(content, '$.status') = 'pending'
             ORDER BY created_at ASC",
        )?;
        let events: Vec<Event> = stmt
            .query_map(params![recipient], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();

        // Mark them as read.
        for event in &events {
            let _ = db.execute(
                "UPDATE events SET content = json_set(content, '$.status', 'read')
                 WHERE id = ?1",
                params![event.id],
            );
        }

        Ok(events)
    }

    /// Acknowledge a dispatch by event ID, preventing future retries.
    pub async fn acknowledge_dispatch(&self, dispatch_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "UPDATE events SET content = json_set(
                json_set(content, '$.status', 'acked'),
                '$.requires_ack', json('false')
             )
             WHERE type = 'dispatch'
             AND json_extract(content, '$.dispatch_id') = ?1",
            params![dispatch_id],
        )?;
        Ok(())
    }

    /// Get all dispatches (for health checks, listing, etc.).
    pub async fn all_dispatches(&self) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut stmt =
            db.prepare("SELECT * FROM events WHERE type = 'dispatch' ORDER BY created_at ASC")?;
        let events = stmt
            .query_map([], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// Drain all unread dispatches (mark as read, return them).
    pub async fn drain_dispatches(&self) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM events
             WHERE type = 'dispatch'
             AND json_extract(content, '$.status') = 'pending'
             ORDER BY created_at ASC",
        )?;
        let events: Vec<Event> = stmt
            .query_map([], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();

        for event in &events {
            let _ = db.execute(
                "UPDATE events SET content = json_set(content, '$.status', 'read')
                 WHERE id = ?1",
                params![event.id],
            );
        }

        Ok(events)
    }

    /// Count pending (unread) dispatches.
    pub async fn pending_dispatch_count(&self) -> Result<u64> {
        let db = self.db.lock().await;
        let count: i64 = db.query_row(
            "SELECT COUNT(*) FROM events
             WHERE type = 'dispatch'
             AND json_extract(content, '$.status') = 'pending'",
            [],
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }

    /// Count unread dispatches for a specific recipient.
    pub async fn unread_dispatch_count(&self, recipient: &str) -> Result<u64> {
        let db = self.db.lock().await;
        let count: i64 = db.query_row(
            "SELECT COUNT(*) FROM events
             WHERE type = 'dispatch'
             AND json_extract(content, '$.to') = ?1
             AND json_extract(content, '$.status') = 'pending'",
            params![recipient],
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }

    /// Retry unacknowledged dispatches older than `max_age_secs` that haven't
    /// exceeded their retry limit. Increments retry_count, resets status to pending.
    pub async fn retry_unacked_dispatches(&self, max_age_secs: u64) -> Result<Vec<Event>> {
        let cutoff = (Utc::now() - chrono::Duration::seconds(max_age_secs as i64)).to_rfc3339();
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;

        // Update matching dispatches: status=read, requires_ack=true,
        // retry_count < max_retries, created_at < cutoff.
        db.execute(
            "UPDATE events SET content = json_set(
                json_set(
                    json_set(content, '$.status', 'pending'),
                    '$.retry_count', json_extract(content, '$.retry_count') + 1
                ),
                '$.retried_at', ?1
             )
             WHERE type = 'dispatch'
             AND json_extract(content, '$.status') = 'read'
             AND json_extract(content, '$.requires_ack') = 1
             AND json_extract(content, '$.retry_count') < json_extract(content, '$.max_retries')
             AND created_at <= ?2",
            params![now, cutoff],
        )?;

        // Return the retried dispatches.
        let mut stmt = db.prepare(
            "SELECT * FROM events
             WHERE type = 'dispatch'
             AND json_extract(content, '$.status') = 'pending'
             AND json_extract(content, '$.requires_ack') = 1
             AND json_extract(content, '$.retry_count') > 0
             AND json_extract(content, '$.retry_count') < json_extract(content, '$.max_retries')
             ORDER BY created_at ASC",
        )?;
        let events = stmt
            .query_map([], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// Return dispatches that have exceeded their max retry count (dead letters).
    pub async fn dead_letter_dispatches(&self) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM events
             WHERE type = 'dispatch'
             AND json_extract(content, '$.requires_ack') = 1
             AND json_extract(content, '$.retry_count') >= json_extract(content, '$.max_retries')
             ORDER BY created_at ASC",
        )?;
        let events = stmt
            .query_map([], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    // -----------------------------------------------------------------------
    // High-level Dispatch API (formerly DispatchBus)
    // -----------------------------------------------------------------------

    /// Send a dispatch, prune old entries, and emit a DispatchReceived event.
    pub async fn send(&self, dispatch: Dispatch) {
        let content = dispatch.to_event_content();

        match self.send_dispatch(&content).await {
            Ok(_id) => {
                debug!(to = %dispatch.to, kind = %dispatch.kind.subject_tag(), "dispatch sent via EventStore");
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("idempotency_key_exists") {
                    debug!(to = %dispatch.to, "dispatch dropped (idempotency key already exists)");
                    return;
                }
                warn!(error = %e, to = %dispatch.to, "failed to send dispatch");
                return;
            }
        }

        // Prune old dispatches and enforce queue depth limits.
        self.prune_and_limit_dispatches(&dispatch.to).await;

        // Emit DispatchReceived event for trigger system.
        if let Ok(guard) = self.event_broadcaster.read()
            && let Some(ref broadcaster) = *guard
        {
            broadcaster.publish(crate::execution_events::ExecutionEvent::DispatchReceived {
                from_agent: dispatch.from.clone(),
                to_agent: dispatch.to.clone(),
                kind: dispatch.kind.subject_tag().to_string(),
            });
        }
    }

    /// Prune old dispatches and enforce per-recipient queue depth limits.
    async fn prune_and_limit_dispatches(&self, recipient: &str) {
        let ttl = self
            .dispatch_ttl_secs
            .load(std::sync::atomic::Ordering::Relaxed);
        let cutoff = Utc::now() - chrono::Duration::seconds(ttl as i64);
        let _ = self.prune("dispatch", &cutoff).await;

        let count = self.unread_dispatch_count(recipient).await.unwrap_or(0) as usize;
        if count > self.dispatch_max_queue {
            warn!(
                recipient = %recipient,
                count = count,
                limit = self.dispatch_max_queue,
                "dispatch queue depth exceeds limit"
            );
        }
    }

    /// Read unread dispatches for a recipient as typed Dispatch structs.
    pub async fn read(&self, recipient: &str) -> Vec<Dispatch> {
        match self.read_dispatches(recipient).await {
            Ok(events) => events.iter().filter_map(Dispatch::from_event).collect(),
            Err(e) => {
                warn!(error = %e, "failed to read dispatches");
                Vec::new()
            }
        }
    }

    /// Return all dispatches as typed Dispatch structs.
    pub async fn all(&self) -> Vec<Dispatch> {
        match self.all_dispatches().await {
            Ok(events) => events.iter().filter_map(Dispatch::from_event).collect(),
            Err(e) => {
                warn!(error = %e, "failed to list all dispatches");
                Vec::new()
            }
        }
    }

    /// Count unread dispatches for a recipient.
    pub async fn unread_count(&self, recipient: &str) -> usize {
        self.unread_dispatch_count(recipient).await.unwrap_or(0) as usize
    }

    /// Summarize current control-plane delivery health.
    pub async fn dispatch_health(&self, overdue_age_secs: u64) -> DispatchHealth {
        let overdue_cutoff = Utc::now() - chrono::Duration::seconds(overdue_age_secs as i64);
        let dispatches = self.all().await;
        Self::summarize_health(&dispatches, overdue_cutoff)
    }

    /// Drain all unread dispatches (mark as read, return them as Dispatch structs).
    pub fn drain(&self) -> Vec<Dispatch> {
        match tokio::runtime::Handle::try_current() {
            Ok(handle) => tokio::task::block_in_place(|| {
                handle.block_on(async {
                    match self.drain_dispatches().await {
                        Ok(events) => events.iter().filter_map(Dispatch::from_event).collect(),
                        Err(e) => {
                            warn!(error = %e, "failed to drain dispatches");
                            Vec::new()
                        }
                    }
                })
            }),
            Err(_) => Vec::new(),
        }
    }

    /// Acknowledge a dispatch by ID, preventing future retries.
    pub async fn acknowledge(&self, dispatch_id: &str) {
        if let Err(e) = self.acknowledge_dispatch(dispatch_id).await {
            warn!(error = %e, dispatch_id = %dispatch_id, "failed to acknowledge dispatch");
        }
    }

    /// Return unacknowledged dispatches older than `max_age_secs` that haven't
    /// exceeded their retry limit. Increments retry_count on each returned dispatch.
    pub async fn retry_unacked(&self, max_age_secs: u64) -> Vec<Dispatch> {
        match self.retry_unacked_dispatches(max_age_secs).await {
            Ok(events) => events.iter().filter_map(Dispatch::from_event).collect(),
            Err(e) => {
                warn!(error = %e, "failed to retry unacked dispatches");
                Vec::new()
            }
        }
    }

    /// Return dispatches that have exceeded their max retry count (dead letters) as Dispatch structs.
    pub async fn dead_letters(&self) -> Vec<Dispatch> {
        match self.dead_letter_dispatches().await {
            Ok(events) => events.iter().filter_map(Dispatch::from_event).collect(),
            Err(e) => {
                warn!(error = %e, "failed to get dead letter dispatches");
                Vec::new()
            }
        }
    }

    /// No-op: persistence is handled by SQLite.
    pub async fn save_dispatches(&self) -> Result<()> {
        Ok(())
    }

    /// No-op: state is already persisted in SQLite.
    /// Returns the count of pending dispatches for logging.
    pub async fn load_dispatches(&self) -> Result<usize> {
        let count = self.pending_dispatch_count().await.unwrap_or(0) as usize;
        if count > 0 {
            debug!(count, "event store has persisted unread dispatches");
        }
        Ok(count)
    }

    fn summarize_health(dispatches: &[Dispatch], overdue_cutoff: DateTime<Utc>) -> DispatchHealth {
        let mut health = DispatchHealth::default();

        for dispatch in dispatches {
            if !dispatch.read {
                health.unread += 1;
            }

            if !dispatch.requires_ack {
                continue;
            }

            if dispatch.retry_count >= dispatch.max_retries {
                health.dead_letters += 1;
                continue;
            }

            if dispatch.read {
                health.awaiting_ack += 1;
                if dispatch.timestamp < overdue_cutoff {
                    health.overdue_ack += 1;
                }
            } else if dispatch.retry_count > 0 {
                health.retrying_delivery += 1;
            }
        }

        health
    }
}

fn row_to_event(row: &rusqlite::Row) -> Event {
    Event {
        id: row.get("id").unwrap_or_default(),
        event_type: row.get("type").unwrap_or_default(),
        agent_id: row.get("agent_id").ok(),
        session_id: row.get("session_id").ok(),
        quest_id: row.get("quest_id").ok(),
        content: row
            .get::<_, String>("content")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(serde_json::Value::Null),
        created_at: row
            .get::<_, String>("created_at")
            .ok()
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> Arc<Mutex<Connection>> {
        let conn = Connection::open_in_memory().unwrap();
        EventStore::create_tables(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn emit_and_query() {
        let db = open_test_db();
        let store = EventStore::new(db);

        let id = store
            .emit(
                "decision",
                Some("agent-1"),
                None,
                Some("task-1"),
                &serde_json::json!({"reasoning": "test decision"}),
            )
            .await
            .unwrap();

        let events = store
            .query(
                &EventFilter {
                    event_type: Some("decision".to_string()),
                    ..Default::default()
                },
                10,
                0,
            )
            .await
            .unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].id, id);
        assert_eq!(events[0].event_type, "decision");
    }

    #[tokio::test]
    async fn query_sum() {
        let db = open_test_db();
        let store = EventStore::new(db);

        store
            .emit(
                "cost",
                Some("a1"),
                None,
                Some("t1"),
                &serde_json::json!({"cost_usd": 1.5}),
            )
            .await
            .unwrap();
        store
            .emit(
                "cost",
                Some("a1"),
                None,
                Some("t2"),
                &serde_json::json!({"cost_usd": 2.3}),
            )
            .await
            .unwrap();

        let total = store.query_sum("cost", "$.cost_usd", None).await.unwrap();
        assert!((total - 3.8).abs() < 0.01);
    }

    #[tokio::test]
    async fn update_event() {
        let db = open_test_db();
        let store = EventStore::new(db);

        let id = store
            .emit(
                "dispatch",
                None,
                None,
                None,
                &serde_json::json!({"status": "pending"}),
            )
            .await
            .unwrap();

        store
            .update(&id, &serde_json::json!({"status": "acked"}))
            .await
            .unwrap();

        let events = store
            .query(
                &EventFilter {
                    event_type: Some("dispatch".to_string()),
                    ..Default::default()
                },
                10,
                0,
            )
            .await
            .unwrap();
        assert_eq!(events[0].content["status"], "acked");
    }

    #[tokio::test]
    async fn count_events() {
        let db = open_test_db();
        let store = EventStore::new(db);

        store
            .emit("test", None, None, None, &serde_json::json!({}))
            .await
            .unwrap();
        store
            .emit("test", None, None, None, &serde_json::json!({}))
            .await
            .unwrap();
        store
            .emit("other", None, None, None, &serde_json::json!({}))
            .await
            .unwrap();

        assert_eq!(store.count("test", None).await.unwrap(), 2);
        assert_eq!(store.count("other", None).await.unwrap(), 1);
    }

    fn open_test_store() -> Arc<EventStore> {
        let db = open_test_db();
        Arc::new(EventStore::new(db))
    }

    fn test_delegate_request() -> DispatchKind {
        DispatchKind::DelegateRequest {
            prompt: "do something".into(),
            response_mode: "origin".into(),
            create_task: false,
            skill: None,
            reply_to: None,
            parent_session_id: None,
        }
    }

    fn test_delegate_response() -> DispatchKind {
        DispatchKind::DelegateResponse {
            reply_to: "d-123".into(),
            response_mode: "origin".into(),
            content: "done".into(),
        }
    }

    fn test_human_escalation() -> DispatchKind {
        DispatchKind::HumanEscalation {
            project: "demo".into(),
            task_id: "t1".into(),
            subject: "blocked".into(),
            summary: "help".into(),
        }
    }

    #[tokio::test]
    async fn test_send_and_read() {
        let store = open_test_store();
        store
            .send(Dispatch::new_typed("a", "b", test_delegate_request()))
            .await;

        let msgs = store.read("b").await;
        assert_eq!(msgs.len(), 1);

        let msgs = store.read("b").await;
        assert_eq!(msgs.len(), 0);
    }

    #[tokio::test]
    async fn test_indexed_recipient() {
        let store = open_test_store();

        store
            .send(Dispatch::new_typed("a", "b", test_delegate_request()))
            .await;
        store
            .send(Dispatch::new_typed("a", "c", test_delegate_response()))
            .await;

        assert_eq!(store.read("b").await.len(), 1);
        assert_eq!(store.read("c").await.len(), 1);
        assert_eq!(store.read("d").await.len(), 0);
    }

    #[tokio::test]
    async fn test_ack_required_dispatch() {
        let store = open_test_store();
        let dispatch = Dispatch::new_typed("a", "b", test_delegate_request()).with_ack_required();
        let dispatch_id = dispatch.id.clone();
        assert!(dispatch.requires_ack);
        store.send(dispatch).await;

        let delivered = store.read("b").await;
        assert_eq!(delivered.len(), 1);

        let retries = store.retry_unacked(0).await;
        assert_eq!(retries.len(), 1);
        assert_eq!(retries[0].retry_count, 1);

        // After ack: should not be retried.
        store.acknowledge(&dispatch_id).await;
        let retries = store.retry_unacked(0).await;
        assert_eq!(retries.len(), 0);
    }

    #[tokio::test]
    async fn test_dead_letter_after_max_retries() {
        let store = open_test_store();
        let mut dispatch =
            Dispatch::new_typed("a", "b", test_delegate_request()).with_ack_required();
        dispatch.max_retries = 2;
        store.send(dispatch).await;
        let delivered = store.read("b").await;
        assert_eq!(delivered.len(), 1);

        // Retry twice to exhaust max_retries.
        let _ = store.retry_unacked(0).await; // retry_count -> 1
        let retried = store.read("b").await;
        assert_eq!(retried.len(), 1);
        let _ = store.retry_unacked(0).await; // retry_count -> 2

        // Should now be dead-lettered.
        let dead = store.dead_letters().await;
        assert_eq!(dead.len(), 1);

        // Retry should return nothing (exceeded max).
        let retries = store.retry_unacked(0).await;
        assert_eq!(retries.len(), 0);
    }

    #[tokio::test]
    async fn test_ack_prevents_retry() {
        let store = open_test_store();
        let dispatch = Dispatch::new_typed("a", "b", test_delegate_request()).with_ack_required();
        let id = dispatch.id.clone();
        store.send(dispatch).await;
        let delivered = store.read("b").await;
        assert_eq!(delivered.len(), 1);

        store.acknowledge(&id).await;

        let retries = store.retry_unacked(0).await;
        assert!(retries.is_empty());

        let dead = store.dead_letters().await;
        assert!(dead.is_empty());
    }

    #[test]
    fn test_critical_dispatches_require_ack_by_default() {
        assert!(Dispatch::new_typed("a", "leader", test_delegate_request(),).requires_ack);
        assert!(!Dispatch::new_typed("a", "leader", test_delegate_response(),).requires_ack);
        assert!(!Dispatch::new_typed("a", "leader", test_human_escalation(),).requires_ack);
    }
}
