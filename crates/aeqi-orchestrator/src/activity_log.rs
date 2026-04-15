//! Unified activity log — one table for all events.
//!
//! Replaces: audit log, cost ledger, expertise ledger, session messages.
//! Every event is an immutable row with a type, optional agent/session/quest
//! foreign keys, and JSON content.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::debug;

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

/// The unified activity log, backed by a shared SQLite connection.
pub struct ActivityLog {
    db: Arc<crate::agent_registry::ConnectionPool>,
    /// Broadcast channel for push-based event dispatch (scheduler subscribes).
    broadcast_tx: tokio::sync::broadcast::Sender<serde_json::Value>,
}

impl ActivityLog {
    /// Create an ActivityLog sharing a connection pool (from AgentRegistry).
    pub fn new(db: Arc<crate::agent_registry::ConnectionPool>) -> Self {
        let (broadcast_tx, _) = tokio::sync::broadcast::channel(256);
        Self { db, broadcast_tx }
    }

    /// Subscribe to the event broadcast channel for push-based dispatch.
    /// The scheduler uses this to wake immediately on relevant events
    /// (quest_created, quest_completed) instead of polling.
    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<serde_json::Value> {
        self.broadcast_tx.subscribe()
    }

    /// Create the events table and indexes. Called during AgentRegistry::open().
    pub fn create_tables(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS activity (
                 id TEXT PRIMARY KEY,
                 type TEXT NOT NULL,
                 agent_id TEXT,
                 session_id TEXT,
                 quest_id TEXT,
                 content TEXT NOT NULL DEFAULT '{}',
                 created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(type);
             CREATE INDEX IF NOT EXISTS idx_activity_agent ON activity(agent_id);
             CREATE INDEX IF NOT EXISTS idx_activity_session ON activity(session_id);
             CREATE INDEX IF NOT EXISTS idx_activity_quest ON activity(quest_id);
             CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);",
        )?;

        // FTS5 for full-text search over event content.
        // Ignore errors (FTS5 may not be compiled in on all platforms).
        let _ = conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS activity_fts
                 USING fts5(content, content=activity, content_rowid=rowid);",
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
            "INSERT INTO activity (id, type, agent_id, session_id, quest_id, content, created_at)
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

        // Broadcast for push-based dispatch (scheduler wakes immediately).
        // Ignore send errors — no subscribers is fine.
        let _ = self.broadcast_tx.send(serde_json::json!({
            "type": event_type,
            "quest_id": quest_id,
            "agent_id": agent_id,
        }));

        Ok(id)
    }

    /// Query events with filters.
    pub async fn query(&self, filter: &EventFilter, limit: u32, offset: u32) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut sql = String::from("SELECT * FROM activity WHERE 1=1");
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
                 FROM activity WHERE type = ?1 AND created_at >= ?2"
            )
        } else {
            format!(
                "SELECT COALESCE(SUM(json_extract(content, '{json_path}')), 0.0)
                 FROM activity WHERE type = ?1"
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
            "SELECT e.* FROM activity e
             JOIN activity_fts f ON e.rowid = f.rowid
             WHERE activity_fts MATCH ?1
             ORDER BY rank LIMIT ?2",
        )?;
        let events = stmt
            .query_map(params![query_text, limit], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// Update an event's content (for status changes).
    pub async fn update(&self, event_id: &str, content: &serde_json::Value) -> Result<()> {
        let content_str = serde_json::to_string(content)?;
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE activity SET content = ?1 WHERE id = ?2",
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
                "SELECT COUNT(*) FROM activity WHERE type = ?1 AND created_at >= ?2",
                params![event_type, since_dt.to_rfc3339()],
                |row| row.get(0),
            )?
        } else {
            db.query_row(
                "SELECT COUNT(*) FROM activity WHERE type = ?1",
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
             FROM activity WHERE type = 'task_completed'
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
        steps: u32,
    ) -> Result<String> {
        self.emit(
            "cost",
            Some(agent_id),
            None,
            Some(quest_id),
            &serde_json::json!({
                "agent_name": agent_name,
                "cost_usd": cost_usd,
                "steps": steps,
            }),
        )
        .await
    }

    /// Get total cost for today.
    pub async fn daily_cost(&self) -> Result<f64> {
        let today = chrono::Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .context("midnight should always be valid")?;
        let today = DateTime::<Utc>::from_naive_utc_and_offset(today, Utc);
        self.query_sum("cost", "$.cost_usd", Some(&today)).await
    }

    /// Get all project costs for today as a map.
    pub async fn daily_costs_by_project(&self) -> Result<std::collections::HashMap<String, f64>> {
        let today = chrono::Utc::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .context("midnight should always be valid")?;
        let today_str = DateTime::<Utc>::from_naive_utc_and_offset(today, Utc).to_rfc3339();
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT json_extract(content, '$.project') as project,
                    SUM(json_extract(content, '$.cost_usd')) as total
             FROM activity WHERE type = 'cost' AND created_at >= ?1
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
            .context("midnight should always be valid")?;
        let today_str = DateTime::<Utc>::from_naive_utc_and_offset(today, Utc).to_rfc3339();
        let db = self.db.lock().await;
        let result: f64 = db.query_row(
            "SELECT COALESCE(SUM(json_extract(content, '$.cost_usd')), 0.0)
             FROM activity WHERE type = 'cost'
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
            "DELETE FROM activity WHERE type = ?1 AND created_at < ?2",
            params![event_type, older_than.to_rfc3339()],
        )?;
        Ok(deleted as u64)
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

    async fn open_test_db() -> Arc<crate::agent_registry::ConnectionPool> {
        let pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = pool.lock().await;
            ActivityLog::create_tables(&conn).unwrap();
        }
        Arc::new(pool)
    }

    #[tokio::test]
    async fn emit_and_query() {
        let db = open_test_db().await;
        let store = ActivityLog::new(db);

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
        let db = open_test_db().await;
        let store = ActivityLog::new(db);

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
        let db = open_test_db().await;
        let store = ActivityLog::new(db);

        let id = store
            .emit(
                "quest_created",
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
                    event_type: Some("quest_created".to_string()),
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
        let db = open_test_db().await;
        let store = ActivityLog::new(db);

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
}
