//! Event handlers — the fourth primitive.
//!
//! An event is a reaction rule: when pattern X fires on agent Y's scope,
//! run idea Z. Events replace triggers and express the entire agent lifecycle.

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;

use crate::agent_registry::ConnectionPool;

/// A reaction rule owned by an agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub agent_id: String,
    pub name: String,
    /// Pattern: "lifecycle:quest_received", "schedule:0 9 * * *", "webhook:abc123"
    pub pattern: String,
    /// Scope: "self", "children", "descendants"
    pub scope: String,
    /// Reference to an idea to run (optional — can use inline content instead).
    pub idea_id: Option<String>,
    /// Inline instruction (used if idea_id is None).
    pub content: Option<String>,
    pub enabled: bool,
    pub cooldown_secs: u64,
    pub max_budget_usd: Option<f64>,
    pub webhook_secret: Option<String>,
    pub last_fired: Option<DateTime<Utc>>,
    pub fire_count: u64,
    pub total_cost_usd: f64,
    /// System events cannot be deleted (lifecycle handlers).
    pub system: bool,
    pub created_at: DateTime<Utc>,
}

/// For creating a new event.
pub struct NewEvent {
    pub agent_id: String,
    pub name: String,
    pub pattern: String,
    pub scope: String,
    pub idea_id: Option<String>,
    pub content: Option<String>,
    pub cooldown_secs: u64,
    pub max_budget_usd: Option<f64>,
    pub webhook_secret: Option<String>,
    pub system: bool,
}

/// SQLite-backed activity log. Shares the agents.db connection pool.
pub struct EventHandlerStore {
    db: Arc<ConnectionPool>,
}

impl EventHandlerStore {
    pub fn new(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    /// Create a new event handler.
    pub async fn create(&self, e: &NewEvent) -> Result<Event> {
        // Validate schedule interval minimum.
        if e.pattern.starts_with("schedule:every ") {
            let interval_part = &e.pattern["schedule:every ".len()..];
            if let Some(num_str) = interval_part.strip_suffix('s') {
                let secs: u64 = num_str.parse().unwrap_or(0);
                if secs < 60 {
                    anyhow::bail!("schedule interval must be >= 60 seconds, got {secs}s");
                }
            }
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        {
            let db = self.db.lock().await;
            db.execute(
                "INSERT INTO events (id, agent_id, name, pattern, scope, idea_id, content, enabled, cooldown_secs, max_budget_usd, webhook_secret, system, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?10, ?11, ?12)",
                params![
                    id, e.agent_id, e.name, e.pattern, e.scope,
                    e.idea_id, e.content, e.cooldown_secs as i64,
                    e.max_budget_usd, e.webhook_secret,
                    if e.system { 1 } else { 0 },
                    now.to_rfc3339(),
                ],
            )?;
        }
        info!(id = %id, agent = %e.agent_id, name = %e.name, pattern = %e.pattern, "event created");
        self.get(&id).await?.ok_or_else(|| anyhow::anyhow!("event created but not found"))
    }

    /// Get an event by ID.
    pub async fn get(&self, id: &str) -> Result<Option<Event>> {
        let db = self.db.lock().await;
        db.query_row(
            "SELECT * FROM events WHERE id = ?1",
            params![id],
            |row| Ok(row_to_event(row)),
        )
        .optional()
        .map_err(Into::into)
    }

    /// List all events for an agent.
    pub async fn list_for_agent(&self, agent_id: &str) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM events WHERE agent_id = ?1 ORDER BY name",
        )?;
        let events = stmt
            .query_map(params![agent_id], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// List all enabled events.
    pub async fn list_enabled(&self) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM events WHERE enabled = 1 ORDER BY agent_id, name",
        )?;
        let events = stmt
            .query_map([], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// List enabled events matching a pattern prefix (e.g., "lifecycle:", "schedule:").
    pub async fn list_by_pattern_prefix(&self, prefix: &str) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let pattern = format!("{prefix}%");
        let mut stmt = db.prepare(
            "SELECT * FROM events WHERE enabled = 1 AND pattern LIKE ?1 ORDER BY agent_id",
        )?;
        let events = stmt
            .query_map(params![pattern], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// Find a webhook event by its public ID (extracted from pattern "webhook:PUBLIC_ID").
    pub async fn find_webhook(&self, public_id: &str) -> Result<Option<Event>> {
        let pattern = format!("webhook:{public_id}");
        let db = self.db.lock().await;
        db.query_row(
            "SELECT * FROM events WHERE pattern = ?1 AND enabled = 1",
            params![pattern],
            |row| Ok(row_to_event(row)),
        )
        .optional()
        .map_err(Into::into)
    }

    /// Enable or disable an event.
    pub async fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        let db = self.db.lock().await;
        // Cannot disable system events.
        let is_system: bool = db
            .query_row("SELECT system FROM events WHERE id = ?1", params![id], |row| row.get(0))
            .unwrap_or(false);
        if is_system && !enabled {
            anyhow::bail!("cannot disable system lifecycle event");
        }
        db.execute(
            "UPDATE events SET enabled = ?1 WHERE id = ?2",
            params![if enabled { 1 } else { 0 }, id],
        )?;
        Ok(())
    }

    /// Delete an event. System events cannot be deleted.
    pub async fn delete(&self, id: &str) -> Result<()> {
        let db = self.db.lock().await;
        let is_system: bool = db
            .query_row("SELECT system FROM events WHERE id = ?1", params![id], |row| row.get(0))
            .unwrap_or(false);
        if is_system {
            anyhow::bail!("cannot delete system lifecycle event");
        }
        db.execute("DELETE FROM events WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Record that an event fired. Updates last_fired, fire_count, total_cost_usd.
    pub async fn record_fire(&self, id: &str, cost_usd: f64) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "UPDATE events SET last_fired = ?1, fire_count = fire_count + 1, total_cost_usd = total_cost_usd + ?2 WHERE id = ?3",
            params![now, cost_usd, id],
        )?;
        Ok(())
    }

    /// Advance-before-execute: mark fired BEFORE creating the quest.
    /// Ensures at-most-once semantics on crash.
    pub async fn advance_before_execute(&self, id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "UPDATE events SET last_fired = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        Ok(())
    }

    /// Count enabled events.
    pub async fn count_enabled(&self) -> Result<u64> {
        let db = self.db.lock().await;
        let count: i64 = db.query_row(
            "SELECT COUNT(*) FROM events WHERE enabled = 1",
            [],
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }
}

/// Create default lifecycle events for a newly spawned agent.
pub async fn create_default_lifecycle_events(
    store: &EventHandlerStore,
    agent_id: &str,
) -> anyhow::Result<()> {
    let defaults: &[(&str, &str, &str, &str)] = &[
        (
            "on_quest_received",
            "lifecycle:quest_received",
            "self",
            "A quest has been assigned to you. Analyze the requirements, plan your approach, and begin working. Use your tools (shell, file read/write, ideas) to complete the work. When finished, call quests_close with a summary of what you accomplished.",
        ),
        (
            "on_quest_completed",
            "lifecycle:quest_completed",
            "self",
            "You completed a quest. Reflect on what you learned. Store any reusable knowledge as ideas using ideas_store. Key facts, procedures, and preferences should be preserved for future work.",
        ),
        (
            "on_quest_failed",
            "lifecycle:quest_failed",
            "self",
            "A quest failed. Analyze the root cause. If the failure is recoverable and retry count is under 3, create a refined quest with lessons learned using quests_create. If the failure is terminal or retries exhausted, store the failure analysis as an idea and notify your parent by creating a quest describing the blocker.",
        ),
        (
            "on_child_completed",
            "lifecycle:quest_completed",
            "children",
            "A child agent completed a quest. Review the outcome. If there are dependent quests waiting on this result, they will be unblocked automatically. Store any cross-cutting insights as ideas.",
        ),
        (
            "on_child_failed",
            "lifecycle:quest_failed",
            "children",
            "A child agent failed a quest. Evaluate whether to: (1) create a refined retry quest for the same child, (2) reassign to a different child via quests_create, or (3) handle the work yourself. Consider the failure reason before deciding.",
        ),
        (
            "on_idea_received",
            "lifecycle:idea_received",
            "self",
            "New knowledge has been shared with you. Acknowledge it and integrate it into your working context. This may change how you approach future quests.",
        ),
        (
            "on_budget_exceeded",
            "lifecycle:budget_exceeded",
            "self",
            "Your cost budget has been exceeded. Immediately checkpoint any in-progress work. Do not start new tool calls. Report the situation to your parent by creating a quest describing what was completed and what remains.",
        ),
    ];

    for &(name, pattern, scope, content) in defaults {
        store
            .create(&NewEvent {
                agent_id: agent_id.to_string(),
                name: name.to_string(),
                pattern: pattern.to_string(),
                scope: scope.to_string(),
                idea_id: None,
                content: Some(content.to_string()),
                cooldown_secs: 0,
                max_budget_usd: None,
                webhook_secret: None,
                system: true,
            })
            .await?;
    }

    info!(agent_id = %agent_id, "created 7 default lifecycle events");
    Ok(())
}

fn row_to_event(row: &rusqlite::Row) -> Event {
    let last_fired_str: Option<String> = row.get("last_fired").ok().flatten();
    let last_fired = last_fired_str
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&Utc));
    let created_str: String = row.get("created_at").unwrap_or_default();
    let created_at = DateTime::parse_from_rfc3339(&created_str)
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    Event {
        id: row.get("id").unwrap_or_default(),
        agent_id: row.get("agent_id").unwrap_or_default(),
        name: row.get("name").unwrap_or_default(),
        pattern: row.get("pattern").unwrap_or_default(),
        scope: row.get("scope").unwrap_or_else(|_| "self".to_string()),
        idea_id: row.get("idea_id").ok().flatten(),
        content: row.get("content").ok().flatten(),
        enabled: row.get::<_, i64>("enabled").unwrap_or(1) != 0,
        cooldown_secs: row.get::<_, i64>("cooldown_secs").unwrap_or(0) as u64,
        max_budget_usd: row.get("max_budget_usd").ok().flatten(),
        webhook_secret: row.get("webhook_secret").ok().flatten(),
        last_fired,
        fire_count: row.get::<_, i64>("fire_count").unwrap_or(0) as u64,
        total_cost_usd: row.get("total_cost_usd").unwrap_or(0.0),
        system: row.get::<_, i64>("system").unwrap_or(0) != 0,
        created_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_store() -> EventHandlerStore {
        let pool = ConnectionPool::in_memory().unwrap();
        let conn = pool.lock().await;
        conn.execute_batch(
            "CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'active', created_at TEXT NOT NULL);
             INSERT INTO agents (id, name, created_at) VALUES ('a1', 'shadow', '2026-01-01T00:00:00Z');
             CREATE TABLE events (
                 id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                 name TEXT NOT NULL, pattern TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'self',
                 idea_id TEXT, content TEXT, enabled INTEGER NOT NULL DEFAULT 1,
                 cooldown_secs INTEGER NOT NULL DEFAULT 0, max_budget_usd REAL,
                 webhook_secret TEXT, last_fired TEXT, fire_count INTEGER NOT NULL DEFAULT 0,
                 total_cost_usd REAL NOT NULL DEFAULT 0.0, system INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL, UNIQUE(agent_id, name)
             );",
        )
        .unwrap();
        drop(conn);
        EventHandlerStore::new(Arc::new(pool))
    }

    #[tokio::test]
    async fn create_and_list() {
        let store = test_store().await;
        let event = store.create(&NewEvent {
            agent_id: "a1".into(),
            name: "morning-brief".into(),
            pattern: "schedule:0 9 * * *".into(),
            scope: "self".into(),
            idea_id: None,
            content: Some("Run morning brief".into()),
            cooldown_secs: 300,
            max_budget_usd: Some(1.0),
            webhook_secret: None,
            system: false,
        }).await.unwrap();

        assert_eq!(event.name, "morning-brief");
        assert_eq!(event.pattern, "schedule:0 9 * * *");
        assert!(!event.system);

        let events = store.list_for_agent("a1").await.unwrap();
        assert_eq!(events.len(), 1);
    }

    #[tokio::test]
    async fn system_events_cannot_be_deleted() {
        let store = test_store().await;
        let event = store.create(&NewEvent {
            agent_id: "a1".into(),
            name: "on-quest-received".into(),
            pattern: "lifecycle:quest_received".into(),
            scope: "self".into(),
            idea_id: None,
            content: Some("Start working".into()),
            cooldown_secs: 0,
            max_budget_usd: None,
            webhook_secret: None,
            system: true,
        }).await.unwrap();

        assert!(store.delete(&event.id).await.is_err());
        assert!(store.set_enabled(&event.id, false).await.is_err());
    }

    #[tokio::test]
    async fn record_fire_updates_stats() {
        let store = test_store().await;
        let event = store.create(&NewEvent {
            agent_id: "a1".into(),
            name: "test".into(),
            pattern: "lifecycle:test".into(),
            scope: "self".into(),
            idea_id: None,
            content: None,
            cooldown_secs: 0,
            max_budget_usd: None,
            webhook_secret: None,
            system: false,
        }).await.unwrap();

        store.record_fire(&event.id, 0.5).await.unwrap();
        store.record_fire(&event.id, 0.3).await.unwrap();

        let updated = store.get(&event.id).await.unwrap().unwrap();
        assert_eq!(updated.fire_count, 2);
        assert!((updated.total_cost_usd - 0.8).abs() < 0.01);
        assert!(updated.last_fired.is_some());
    }

    #[tokio::test]
    async fn list_by_pattern_prefix() {
        let store = test_store().await;
        store.create(&NewEvent {
            agent_id: "a1".into(), name: "sched1".into(),
            pattern: "schedule:0 9 * * *".into(), scope: "self".into(),
            idea_id: None, content: None, cooldown_secs: 0,
            max_budget_usd: None, webhook_secret: None, system: false,
        }).await.unwrap();
        store.create(&NewEvent {
            agent_id: "a1".into(), name: "lifecycle1".into(),
            pattern: "lifecycle:quest_received".into(), scope: "self".into(),
            idea_id: None, content: None, cooldown_secs: 0,
            max_budget_usd: None, webhook_secret: None, system: false,
        }).await.unwrap();

        let schedules = store.list_by_pattern_prefix("schedule:").await.unwrap();
        assert_eq!(schedules.len(), 1);
        assert_eq!(schedules[0].name, "sched1");

        let lifecycle = store.list_by_pattern_prefix("lifecycle:").await.unwrap();
        assert_eq!(lifecycle.len(), 1);
    }
}
