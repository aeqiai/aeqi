//! Event handlers — the fourth primitive.
//!
//! An event is a reaction rule: when pattern X fires on agent Y,
//! run idea Z. Events replace triggers and express the entire agent lifecycle.

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::info;

use crate::agent_registry::ConnectionPool;

/// A reaction rule. `agent_id = None` = global: fires for every agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: String,
    pub agent_id: Option<String>,
    pub name: String,
    /// Pattern: "session:start", "session:quest_start", "schedule:0 9 * * *", "webhook:abc123"
    pub pattern: String,
    /// References to ideas to inject when this event fires.
    pub idea_ids: Vec<String>,
    pub enabled: bool,
    pub cooldown_secs: u64,
    pub last_fired: Option<DateTime<Utc>>,
    pub fire_count: u64,
    pub total_cost_usd: f64,
    /// System events cannot be deleted.
    pub system: bool,
    pub created_at: DateTime<Utc>,
}

/// For creating a new event. `agent_id = None` creates a global event.
pub struct NewEvent {
    pub agent_id: Option<String>,
    pub name: String,
    pub pattern: String,
    /// References to ideas to inject when this event fires.
    pub idea_ids: Vec<String>,
    pub cooldown_secs: u64,
    pub system: bool,
}

/// SQLite-backed event handler store. Shares the aeqi.db connection pool.
pub struct EventHandlerStore {
    db: Arc<ConnectionPool>,
}

impl EventHandlerStore {
    pub fn new(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    /// Create a new event handler.
    pub async fn create(&self, e: &NewEvent) -> Result<Event> {
        if e.agent_id.is_none() && e.pattern.starts_with("schedule:") {
            anyhow::bail!(
                "schedule:* events require a concrete agent_id — a global schedule has no agent to fire against"
            );
        }
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
        let idea_ids_json = serde_json::to_string(&e.idea_ids).unwrap_or_else(|_| "[]".to_string());
        {
            let db = self.db.lock().await;
            db.execute(
                "INSERT OR IGNORE INTO events (id, agent_id, name, pattern, scope, idea_ids, enabled, cooldown_secs, system, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'self', ?5, 1, ?6, ?7, ?8)",
                params![
                    id, e.agent_id, e.name, e.pattern,
                    idea_ids_json, e.cooldown_secs as i64,
                    if e.system { 1 } else { 0 },
                    now.to_rfc3339(),
                ],
            )?;
        }
        // INSERT OR IGNORE may skip if (agent_id, name) already exists.
        // In that case, return the existing event.
        match self.get(&id).await? {
            Some(event) => {
                info!(id = %id, agent = ?e.agent_id, name = %e.name, pattern = %e.pattern, "event created");
                Ok(event)
            }
            None => {
                // Already exists — find by (agent_id, name). NULL-safe match via IS.
                let db = self.db.lock().await;
                let existing = db
                    .query_row(
                        "SELECT * FROM events WHERE agent_id IS ?1 AND name = ?2",
                        params![e.agent_id, e.name],
                        |row| Ok(row_to_event(row)),
                    )
                    .optional()?;
                match existing {
                    Some(event) => Ok(event),
                    None => anyhow::bail!("event creation failed for {}", e.name),
                }
            }
        }
    }

    /// Get an event by ID.
    pub async fn get(&self, id: &str) -> Result<Option<Event>> {
        let db = self.db.lock().await;
        db.query_row("SELECT * FROM events WHERE id = ?1", params![id], |row| {
            Ok(row_to_event(row))
        })
        .optional()
        .map_err(Into::into)
    }

    /// List events visible to an agent: its own + globals.
    pub async fn list_for_agent(&self, agent_id: &str) -> Result<Vec<Event>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM events WHERE agent_id = ?1 OR agent_id IS NULL ORDER BY name",
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
        let mut stmt =
            db.prepare("SELECT * FROM events WHERE enabled = 1 ORDER BY agent_id, name")?;
        let events = stmt
            .query_map([], |row| Ok(row_to_event(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(events)
    }

    /// List enabled events matching a pattern prefix (e.g., "session:", "schedule:").
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

    /// Partial update of event fields.
    pub async fn update_fields(
        &self,
        id: &str,
        enabled: Option<bool>,
        pattern: Option<&str>,
        cooldown_secs: Option<u64>,
        idea_ids: Option<&[String]>,
    ) -> Result<()> {
        let db = self.db.lock().await;

        // Build dynamic UPDATE.
        let mut sets = Vec::new();
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(enabled) = enabled {
            sets.push("enabled = ?");
            values.push(Box::new(if enabled { 1i64 } else { 0i64 }));
        }
        if let Some(pattern) = pattern {
            sets.push("pattern = ?");
            values.push(Box::new(pattern.to_string()));
        }
        if let Some(cooldown_secs) = cooldown_secs {
            sets.push("cooldown_secs = ?");
            values.push(Box::new(cooldown_secs as i64));
        }
        if let Some(idea_ids) = idea_ids {
            // Explicit update semantics: replace the full array, including clearing it.
            let json = serde_json::to_string(idea_ids).unwrap_or_else(|_| "[]".to_string());
            sets.push("idea_ids = ?");
            values.push(Box::new(json));
        }

        if sets.is_empty() {
            anyhow::bail!("no fields to update");
        }

        values.push(Box::new(id.to_string()));
        let sql = format!("UPDATE events SET {} WHERE id = ?", sets.join(", "));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|v| v.as_ref()).collect();
        db.execute(&sql, param_refs.as_slice())?;
        Ok(())
    }

    /// Set idea_ids on an agent's own `on_session_start` event.
    /// Creates a per-agent event if one doesn't exist yet (ignores globals).
    pub async fn update_on_session_start_ideas(
        &self,
        agent_id: &str,
        idea_ids: &[String],
    ) -> Result<()> {
        let events = self.list_for_agent(agent_id).await?;
        let existing = events.iter().find(|e| {
            e.agent_id.as_deref() == Some(agent_id)
                && e.name == "on_session_start"
                && e.pattern.contains("session_start")
        });

        if let Some(ev) = existing {
            // Merge new idea_ids with existing ones (no duplicates).
            let mut merged: Vec<String> = ev.idea_ids.clone();
            for id in idea_ids {
                if !merged.contains(id) {
                    merged.push(id.clone());
                }
            }
            self.update_idea_ids(&ev.id, &merged).await
        } else {
            // Create the event.
            self.create(&NewEvent {
                agent_id: Some(agent_id.to_string()),
                name: "on_session_start".to_string(),
                pattern: "session:start".to_string(),
                idea_ids: idea_ids.to_vec(),
                cooldown_secs: 0,
                system: false,
            })
            .await?;
            Ok(())
        }
    }

    /// Update the idea_ids JSON array on an event.
    pub async fn update_idea_ids(&self, id: &str, idea_ids: &[String]) -> Result<()> {
        let json = serde_json::to_string(idea_ids).unwrap_or_else(|_| "[]".to_string());
        let db = self.db.lock().await;
        db.execute(
            "UPDATE events SET idea_ids = ?1 WHERE id = ?2",
            params![json, id],
        )?;
        Ok(())
    }

    /// Enable or disable an event.
    pub async fn set_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        let db = self.db.lock().await;
        // Cannot disable system events.
        let is_system: bool = db
            .query_row(
                "SELECT system FROM events WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
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
            .query_row(
                "SELECT system FROM events WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
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

    /// Get enabled events matching a pattern for an agent: its own + globals.
    pub async fn get_events_for_pattern(&self, agent_id: &str, pattern: &str) -> Vec<Event> {
        let db = self.db.lock().await;
        let like_pattern = format!("{pattern}%");
        let result: Result<Vec<Event>> = (|| {
            let mut stmt = db.prepare(
                "SELECT * FROM events
                 WHERE (agent_id = ?1 OR agent_id IS NULL)
                   AND enabled = 1
                   AND pattern LIKE ?2
                 ORDER BY name",
            )?;
            let events = stmt
                .query_map(params![agent_id, like_pattern], |row| Ok(row_to_event(row)))?
                .filter_map(|r| r.ok())
                .collect();
            Ok(events)
        })();
        result.unwrap_or_default()
    }

    /// Count enabled events.
    pub async fn count_enabled(&self) -> Result<u64> {
        let db = self.db.lock().await;
        let count: i64 =
            db.query_row("SELECT COUNT(*) FROM events WHERE enabled = 1", [], |row| {
                row.get(0)
            })?;
        Ok(count as u64)
    }
}

/// Seed global lifecycle events. One row per lifecycle phase, agent_id = NULL.
/// Every agent inherits these via `list_for_agent` / `get_events_for_pattern`.
/// Idempotent: safe to call at every boot.
pub async fn create_default_lifecycle_events(store: &EventHandlerStore) -> anyhow::Result<()> {
    // (event_name, pattern, idea_key, idea_content)
    let defaults: &[(&str, &str, &str, &str)] = &[
        (
            "on_session_start",
            "session:start",
            "session:start",
            "You are an AEQI agent. Your world is four primitives: agents (you and your peers), ideas (text you can read, write, and search), quests (work items with worktrees), events (patterns that inject ideas at lifecycle moments).\n\nIdeas are the only persistent context. If something is worth remembering across sessions, store it as an idea — tagged so future-you can find it. Searching and storing ideas is a deliberate tool call, not automatic.",
        ),
        (
            "on_quest_start",
            "session:quest_start",
            "session:quest-start",
            "A quest has been assigned to you. You own it end-to-end inside its worktree.\n\nWork the quest: understand the ask, make the change, verify it, and close the quest with a summary when done. Spawn sub-agents, commit, and iterate without asking for mid-quest approval — the assignment is the authorization.\n\nIf you are truly blocked (missing credential, unreachable external service, or a decision only a human can make), close with status `blocked` and a specific question. Ambiguity in the spec is not blocked — make the best call and keep moving.",
        ),
        (
            "on_quest_end",
            "session:quest_end",
            "session:quest-end",
            "You are closing a quest. Summarize the outcome, note any concerns a reviewer should look at, and — if you learned something reusable — store it as an idea so the next quest benefits.",
        ),
        (
            "on_quest_result",
            "session:quest_result",
            "session:quest-result",
            "A quest you delegated has completed and the result is available. Review the summary and the diff, decide what to do next, and create follow-up quests if the work isn't done.",
        ),
        (
            "on_execution_start",
            "session:execution_start",
            "session:execution-start",
            "",
        ),
        (
            "on_step_start",
            "session:step_start",
            "session:step-start",
            "",
        ),
    ];

    let now = chrono::Utc::now().to_rfc3339();

    for &(name, pattern, idea_key, idea_content) in defaults {
        // Seed ideas are globals (agent_id IS NULL) — one row total, shared by
        // every agent's lifecycle events. Resolve-or-create the canonical row,
        // then overwrite its content so code is the source of truth on every boot.
        let idea_id = {
            let db = store.db.lock().await;
            let existing: Option<String> = db
                .query_row(
                    "SELECT id FROM ideas WHERE agent_id IS NULL AND name = ?1",
                    rusqlite::params![idea_key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| anyhow::anyhow!("failed to check seed idea {idea_key}: {e}"))?;
            if let Some(id) = existing {
                db.execute(
                    "UPDATE ideas SET content = ?1 WHERE id = ?2",
                    rusqlite::params![idea_content, id],
                )
                .map_err(|e| anyhow::anyhow!("failed to refresh seed idea {idea_key}: {e}"))?;
                id
            } else {
                let new_id = uuid::Uuid::new_v4().to_string();
                db.execute(
                    "INSERT INTO ideas (id, name, content, scope, agent_id, created_at)
                     VALUES (?1, ?2, ?3, 'domain', NULL, ?4)",
                    rusqlite::params![new_id, idea_key, idea_content, now],
                )
                .map_err(|e| anyhow::anyhow!("failed to insert seed idea {idea_key}: {e}"))?;
                db.execute(
                    "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, 'procedure')",
                    rusqlite::params![new_id],
                )
                .map_err(|e| anyhow::anyhow!("failed to tag seed idea {idea_key}: {e}"))?;
                new_id
            }
        };

        // Create the global event referencing the shared idea.
        store
            .create(&NewEvent {
                agent_id: None,
                name: name.to_string(),
                pattern: pattern.to_string(),
                idea_ids: vec![idea_id],
                cooldown_secs: 0,
                system: true,
            })
            .await?;
    }

    info!("seeded 6 global lifecycle events pointing at global seed ideas");
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

    let idea_ids_str: String = row.get("idea_ids").unwrap_or_else(|_| "[]".to_string());
    let idea_ids: Vec<String> = serde_json::from_str(&idea_ids_str).unwrap_or_default();

    Event {
        id: row.get("id").unwrap_or_default(),
        agent_id: row.get("agent_id").ok().flatten(),
        name: row.get("name").unwrap_or_default(),
        pattern: row.get("pattern").unwrap_or_default(),
        idea_ids,
        enabled: row.get::<_, i64>("enabled").unwrap_or(1) != 0,
        cooldown_secs: row.get::<_, i64>("cooldown_secs").unwrap_or(0) as u64,
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
                 id TEXT PRIMARY KEY, agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
                 name TEXT NOT NULL, pattern TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'self',
                 idea_ids TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1,
                 cooldown_secs INTEGER NOT NULL DEFAULT 0,
                 last_fired TEXT, fire_count INTEGER NOT NULL DEFAULT 0,
                 total_cost_usd REAL NOT NULL DEFAULT 0.0, system INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL
             );
             CREATE UNIQUE INDEX idx_events_unique_name
                 ON events(COALESCE(agent_id, ''), name);",
        )
        .unwrap();
        drop(conn);
        EventHandlerStore::new(Arc::new(pool))
    }

    #[tokio::test]
    async fn create_and_list() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "morning-brief".into(),
                pattern: "schedule:0 9 * * *".into(),
                idea_ids: Vec::new(),
                cooldown_secs: 300,
                system: false,
            })
            .await
            .unwrap();

        assert_eq!(event.name, "morning-brief");
        assert_eq!(event.pattern, "schedule:0 9 * * *");
        assert!(!event.system);

        let events = store.list_for_agent("a1").await.unwrap();
        assert_eq!(events.len(), 1);
    }

    #[tokio::test]
    async fn system_events_cannot_be_deleted() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "on-quest-received".into(),
                pattern: "session:quest_start".into(),
                idea_ids: Vec::new(),
                cooldown_secs: 0,
                system: true,
            })
            .await
            .unwrap();

        assert!(store.delete(&event.id).await.is_err());
        assert!(store.set_enabled(&event.id, false).await.is_err());
    }

    #[tokio::test]
    async fn record_fire_updates_stats() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "test".into(),
                pattern: "session:test".into(),
                idea_ids: Vec::new(),
                cooldown_secs: 0,
                system: false,
            })
            .await
            .unwrap();

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
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "sched1".into(),
                pattern: "schedule:0 9 * * *".into(),
                idea_ids: Vec::new(),
                cooldown_secs: 0,
                system: false,
            })
            .await
            .unwrap();
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "lifecycle1".into(),
                pattern: "session:quest_start".into(),
                idea_ids: Vec::new(),
                cooldown_secs: 0,
                system: false,
            })
            .await
            .unwrap();

        let schedules = store.list_by_pattern_prefix("schedule:").await.unwrap();
        assert_eq!(schedules.len(), 1);
        assert_eq!(schedules[0].name, "sched1");

        let lifecycle = store.list_by_pattern_prefix("session:").await.unwrap();
        assert_eq!(lifecycle.len(), 1);
    }

    #[tokio::test]
    async fn update_fields_replaces_idea_ids_and_respects_omission() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "update-me".into(),
                pattern: "session:update_me".into(),
                idea_ids: vec!["keep-a".into(), "keep-b".into()],
                cooldown_secs: 0,
                system: false,
            })
            .await
            .unwrap();

        // Update with no idea_ids change — idea_ids should remain.
        store
            .update_fields(&event.id, None, None, None, None)
            .await
            .unwrap_err(); // no fields to update

        let after_omitted = store.get(&event.id).await.unwrap().unwrap();
        assert_eq!(
            after_omitted.idea_ids,
            vec!["keep-a".to_string(), "keep-b".to_string()]
        );

        let replacement = vec!["new-a".to_string(), "new-b".to_string()];
        store
            .update_fields(&event.id, None, None, None, Some(&replacement))
            .await
            .unwrap();

        let after_replace = store.get(&event.id).await.unwrap().unwrap();
        assert_eq!(after_replace.idea_ids, replacement);

        let cleared: Vec<String> = Vec::new();
        store
            .update_fields(&event.id, None, None, None, Some(&cleared))
            .await
            .unwrap();

        let after_clear = store.get(&event.id).await.unwrap().unwrap();
        assert!(after_clear.idea_ids.is_empty());
    }
}
