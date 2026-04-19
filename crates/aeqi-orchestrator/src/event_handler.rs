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

/// An event-level tool call — fired in order when the event's pattern matches.
///
/// Distinct from `aeqi_core::traits::provider::ToolCall` (which models an LLM
/// response tool call). This struct is the configured, serializable "what to
/// run" stored on the event row. Phase 2 will wire these into the tool registry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    /// Tool name, e.g. `"ideas.search"`, `"ideas.assemble"`, `"session.spawn"`.
    pub tool: String,
    /// Arguments passed to the tool. String values may contain `{placeholder}`
    /// tokens that are substituted at fire-time (see `substitute_args`).
    pub args: serde_json::Value,
}

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
    /// Optional semantic-search template expanded + queried at fire time.
    /// Supports `{user_prompt}`, `{tool_output}`, `{quest_description}`.
    /// Unknown placeholders pass through literally.
    #[serde(default)]
    pub query_template: Option<String>,
    /// Top-k for the dynamic semantic search. Defaults to 5 when the
    /// template is set but this is absent.
    #[serde(default)]
    pub query_top_k: Option<u32>,
    /// Restrict `query_template` retrieval to ideas tagged with any of these.
    /// Empty/None = no filter (all ideas eligible by similarity). The default
    /// `on_quest_start` seed sets this to `["promoted"]` so candidate or
    /// rejected skills cannot leak into the assembled prompt.
    #[serde(default)]
    pub query_tag_filter: Option<Vec<String>>,
    /// Tool calls to execute when this event fires. When non-empty, the runtime
    /// executes these sequentially and skips the legacy `idea_ids`/`query_template`
    /// path. When empty, the legacy path runs unchanged (fallback).
    #[serde(default)]
    pub tool_calls: Vec<ToolCall>,
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
#[derive(Default)]
pub struct NewEvent {
    pub agent_id: Option<String>,
    pub name: String,
    pub pattern: String,
    /// References to ideas to inject when this event fires.
    pub idea_ids: Vec<String>,
    pub query_template: Option<String>,
    pub query_top_k: Option<u32>,
    pub query_tag_filter: Option<Vec<String>>,
    /// Tool calls to execute when this event fires (empty = use legacy path).
    pub tool_calls: Vec<ToolCall>,
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
        let query_top_k_i64 = e.query_top_k.map(|k| k as i64);
        let query_tag_filter_json = e
            .query_tag_filter
            .as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));
        let tool_calls_json =
            serde_json::to_string(&e.tool_calls).unwrap_or_else(|_| "[]".to_string());
        {
            let db = self.db.lock().await;
            db.execute(
                "INSERT OR IGNORE INTO events (id, agent_id, name, pattern, scope, idea_ids, query_template, query_top_k, query_tag_filter, tool_calls, enabled, cooldown_secs, system, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'self', ?5, ?6, ?7, ?8, ?9, 1, ?10, ?11, ?12)",
                params![
                    id, e.agent_id, e.name, e.pattern,
                    idea_ids_json, e.query_template, query_top_k_i64, query_tag_filter_json,
                    tool_calls_json,
                    e.cooldown_secs as i64,
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
    #[allow(clippy::too_many_arguments)]
    pub async fn update_fields(
        &self,
        id: &str,
        enabled: Option<bool>,
        pattern: Option<&str>,
        cooldown_secs: Option<u64>,
        idea_ids: Option<&[String]>,
        query_template: Option<Option<&str>>,
        query_top_k: Option<Option<u32>>,
        query_tag_filter: Option<Option<&[String]>>,
        tool_calls: Option<&[ToolCall]>,
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
        if let Some(qt) = query_template {
            sets.push("query_template = ?");
            values.push(Box::new(qt.map(|s| s.to_string())));
        }
        if let Some(qk) = query_top_k {
            sets.push("query_top_k = ?");
            values.push(Box::new(qk.map(|k| k as i64)));
        }
        if let Some(qtf) = query_tag_filter {
            sets.push("query_tag_filter = ?");
            values.push(Box::new(qtf.map(|slice| {
                serde_json::to_string(slice).unwrap_or_else(|_| "[]".to_string())
            })));
        }
        if let Some(tcs) = tool_calls {
            let json = serde_json::to_string(tcs).unwrap_or_else(|_| "[]".to_string());
            sets.push("tool_calls = ?");
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
                query_template: None,
                query_top_k: None,
                query_tag_filter: None,
                tool_calls: Vec::new(),
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

    /// Get enabled events matching an exact pattern for an agent: its own + globals.
    ///
    /// Unlike `get_events_for_pattern` (which uses LIKE for prefix matching),
    /// this method matches the pattern exactly — used for pattern dispatcher
    /// lookup where `context:budget:exceeded` must not prefix-match other patterns.
    pub async fn get_events_for_exact_pattern(&self, agent_id: &str, pattern: &str) -> Vec<Event> {
        let db = self.db.lock().await;
        let result: Result<Vec<Event>> = (|| {
            let mut stmt = db.prepare(
                "SELECT * FROM events
                 WHERE (agent_id = ?1 OR agent_id IS NULL)
                   AND enabled = 1
                   AND pattern = ?2
                 ORDER BY name",
            )?;
            let events = stmt
                .query_map(params![agent_id, pattern], |row| Ok(row_to_event(row)))?
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

/// Remove events left behind by old seeding paths. Called on daemon boot.
/// Returns `(legacy_lifecycle_rows, redundant_shadow_rows)`.
///
/// Two separate cleanups:
/// 1. Rows patterned `lifecycle:*` — predate the `session:*` rename (Apr 15).
/// 2. Per-agent `system` rows at `session:*` patterns that are already covered
///    by a global (`agent_id IS NULL`) `system` row at the same pattern. These
///    are shadows from the Apr-16 per-agent migration that predates globals
///    (Apr 18) and duplicate context when they fire.
pub fn purge_redundant_system_events(
    conn: &rusqlite::Connection,
) -> rusqlite::Result<(usize, usize)> {
    let legacy = conn.execute("DELETE FROM events WHERE pattern LIKE 'lifecycle:%'", [])?;
    let shadows = conn.execute(
        "DELETE FROM events \
         WHERE agent_id IS NOT NULL \
           AND system = 1 \
           AND pattern LIKE 'session:%' \
           AND pattern IN ( \
               SELECT pattern FROM events \
               WHERE agent_id IS NULL AND system = 1 \
           )",
        [],
    )?;
    Ok((legacy, shadows))
}

/// Idempotently seed all lifecycle events (8 session/context patterns + 4 middleware
/// patterns) into the events table as global (`agent_id = NULL`) system events.
///
/// For each pattern, the function checks whether **any** global event with that exact
/// pattern already exists. If so, it is skipped (idempotent). Otherwise a new event is
/// inserted.
///
/// Returns the number of events inserted (0 on a fully-seeded install).
pub async fn seed_lifecycle_events(store: &EventHandlerStore) -> anyhow::Result<usize> {
    // The 8 session/context lifecycle patterns already covered by
    // `create_default_lifecycle_events` are re-checked here for idempotency. Their
    // content is managed by `create_default_lifecycle_events` (which runs first on every
    // boot and refreshes tool_calls); this function's job is to return an accurate count.

    // 4 middleware patterns: these were previously only covered by DEFAULT_HANDLERS in
    // ToolRegistry. Seeding them here makes every LLM-facing string operator-visible.
    struct MiddlewareSeed {
        name: &'static str,
        pattern: &'static str,
        tool_calls: Vec<ToolCall>,
    }

    let middleware_seeds: Vec<MiddlewareSeed> = vec![
        MiddlewareSeed {
            name: "on_loop_detected",
            pattern: "loop:detected",
            tool_calls: vec![ToolCall {
                tool: "transcript.inject".into(),
                args: serde_json::json!({
                    "role": "system",
                    "content": "WARNING: You have called '{tool_name}' with identical arguments {count} times in the last {window_size} calls. This looks like a loop. Change your approach or you will be terminated."
                }),
            }],
        },
        MiddlewareSeed {
            name: "on_guardrail_violation",
            pattern: "guardrail:violation",
            tool_calls: vec![ToolCall {
                tool: "transcript.inject".into(),
                args: serde_json::json!({
                    "role": "system",
                    "content": "[Guardrails] Tool '{tool_name}' is not on the allow list. {rule}. Verify this action is safe before proceeding."
                }),
            }],
        },
        MiddlewareSeed {
            name: "on_graph_guardrail_high_impact",
            pattern: "graph_guardrail:high_impact",
            tool_calls: vec![ToolCall {
                tool: "transcript.inject".into(),
                args: serde_json::json!({
                    "role": "system",
                    "content": "[Graph Guardrails] High-impact change detected: {warning}"
                }),
            }],
        },
        MiddlewareSeed {
            name: "on_shell_command_failed",
            pattern: "shell:command_failed",
            tool_calls: vec![ToolCall {
                tool: "transcript.inject".into(),
                args: serde_json::json!({
                    "role": "system",
                    "content": "[Shell Hook] Command failed: `{command}`\nOutput:\n{output}"
                }),
            }],
        },
    ];

    let all_patterns: &[&str] = &[
        "session:start",
        "session:quest_start",
        "session:quest_end",
        "session:quest_result",
        "session:execution_start",
        "session:step_start",
        "session:recap_on_resume",
        "context:budget:exceeded",
        "loop:detected",
        "guardrail:violation",
        "graph_guardrail:high_impact",
        "shell:command_failed",
    ];

    // Count which patterns already have a global event row.
    let already_seeded: std::collections::HashSet<String> = {
        let db = store.db.lock().await;
        let mut seeded = std::collections::HashSet::new();
        for pattern in all_patterns {
            let exists: bool = db
                .query_row(
                    "SELECT 1 FROM events WHERE agent_id IS NULL AND pattern = ?1 LIMIT 1",
                    rusqlite::params![pattern],
                    |_| Ok(true),
                )
                .optional()
                .unwrap_or(None)
                .unwrap_or(false);
            if exists {
                seeded.insert(pattern.to_string());
            }
        }
        seeded
    };

    let mut inserted = 0usize;

    // Seed middleware patterns that are not yet present.
    for seed in &middleware_seeds {
        if already_seeded.contains(seed.pattern) {
            continue;
        }
        store
            .create(&NewEvent {
                agent_id: None,
                name: seed.name.to_string(),
                pattern: seed.pattern.to_string(),
                idea_ids: Vec::new(),
                query_template: None,
                query_top_k: None,
                query_tag_filter: None,
                tool_calls: seed.tool_calls.clone(),
                cooldown_secs: 0,
                system: true,
            })
            .await?;
        inserted += 1;
    }

    // Lifecycle patterns are seeded by create_default_lifecycle_events; count the ones
    // that were absent before this run (rare — only on a brand-new install where
    // create_default_lifecycle_events hasn't run yet).
    let lifecycle_patterns: &[&str] = &[
        "session:start",
        "session:quest_start",
        "session:quest_end",
        "session:quest_result",
        "session:execution_start",
        "session:step_start",
        "session:recap_on_resume",
        "context:budget:exceeded",
    ];
    for pattern in lifecycle_patterns {
        if !already_seeded.contains(*pattern) {
            inserted += 1;
        }
    }

    info!(
        n = inserted,
        "seeded {} lifecycle+middleware events", inserted
    );
    Ok(inserted)
}

/// One row in the lifecycle seed table.
struct LifecycleSeed {
    name: &'static str,
    pattern: &'static str,
    idea_key: &'static str,
    idea_content: &'static str,
    /// When `true`, the idea referenced by `idea_key` is NOT seeded or updated
    /// by the lifecycle loop — it is managed elsewhere (e.g. insert-if-absent
    /// in `seed_standalone_global_ideas`). Used for `on_context_budget_exceeded`
    /// which references `session:compact-prompt` but must not overwrite it.
    skip_idea_seed: bool,
    /// Legacy query_template field — kept as fallback when tool_calls is empty.
    query_template: Option<&'static str>,
    query_top_k: Option<u32>,
    query_tag_filter: Option<&'static [&'static str]>,
    /// New tool_calls — when non-empty, replaces the legacy path at runtime.
    /// On every boot, both this *and* the legacy fields are written so rollback
    /// is a code revert (Phase 5 will drop the legacy columns).
    tool_calls: Vec<ToolCall>,
}

pub async fn create_default_lifecycle_events(store: &EventHandlerStore) -> anyhow::Result<()> {
    let defaults: Vec<LifecycleSeed> = vec![
        LifecycleSeed {
            name: "on_session_start",
            pattern: "session:start",
            idea_key: "session:start",
            idea_content: "You are an AEQI agent. Your world is four primitives: agents (you and your peers), ideas (text you can read, write, and search), quests (work items with worktrees), events (patterns that inject ideas at lifecycle moments).\n\nIdeas are the only persistent context. If something is worth remembering across sessions, store it as an idea — tagged so future-you can find it. Searching and storing ideas is a deliberate tool call, not automatic.",
            skip_idea_seed: false,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            // Fetch the session primer idea by name — exact equivalent of the
            // legacy idea_ids injection but expressed as a first-class tool call.
            tool_calls: vec![ToolCall {
                tool: "ideas.assemble".into(),
                args: serde_json::json!({ "names": ["session:start"] }),
            }],
        },
        LifecycleSeed {
            name: "on_quest_start",
            pattern: "session:quest_start",
            idea_key: "session:quest-start",
            idea_content: "A quest has been assigned to you. You own it end-to-end inside its worktree.\n\nWork the quest: understand the ask, make the change, verify it, and close the quest with a summary when done. Spawn sub-agents, commit, and iterate without asking for mid-quest approval — the assignment is the authorization.\n\nIf you are truly blocked (missing credential, unreachable external service, or a decision only a human can make), close with status `blocked` and a specific question. Ambiguity in the spec is not blocked — make the best call and keep moving.",
            skip_idea_seed: false,
            // Surfaces promoted skills relevant to the quest — the read-side of the
            // closed learning loop (lu-005). The `promoted` tag filter is a hard
            // gate: candidate- or rejected-tagged ideas cannot leak into the
            // assembled prompt purely on semantic similarity (night-shift leak #4).
            query_template: Some("skill promoted {quest_description}"),
            query_top_k: Some(5),
            query_tag_filter: Some(&["promoted"]),
            tool_calls: vec![
                // Inject the quest-start primer idea.
                ToolCall {
                    tool: "ideas.assemble".into(),
                    args: serde_json::json!({ "names": ["session:quest-start"] }),
                },
                // Surface promoted skills relevant to the quest description.
                ToolCall {
                    tool: "ideas.search".into(),
                    args: serde_json::json!({
                        "query": "skill promoted {quest_description}",
                        "tags": ["promoted"],
                        "top_k": 5
                    }),
                },
            ],
        },
        LifecycleSeed {
            name: "on_quest_end",
            pattern: "session:quest_end",
            idea_key: "session:quest-end",
            // Fires when the worker calls `quests(action=close)` — the assembled
            // content is prepended to the close tool's success message so a
            // user-configured postmortem/reflection template actually reaches
            // the model at the natural quest-closing moment.
            idea_content: "You are closing a quest. Summarize the outcome, note any concerns a reviewer should look at, and — if you learned something reusable — store it as an idea so the next quest benefits.",
            skip_idea_seed: false,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            tool_calls: vec![ToolCall {
                tool: "ideas.assemble".into(),
                args: serde_json::json!({ "names": ["session:quest-end"] }),
            }],
        },
        LifecycleSeed {
            name: "on_quest_result",
            pattern: "session:quest_result",
            idea_key: "session:quest-result",
            idea_content: "A quest you delegated has completed and the result is available. Review the summary and the diff, decide what to do next, and create follow-up quests if the work isn't done.",
            skip_idea_seed: false,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            tool_calls: vec![ToolCall {
                tool: "ideas.assemble".into(),
                args: serde_json::json!({ "names": ["session:quest-result"] }),
            }],
        },
        LifecycleSeed {
            name: "on_execution_start",
            pattern: "session:execution_start",
            idea_key: "session:execution-start",
            idea_content: "",
            skip_idea_seed: false,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            // Empty idea_content — no context to inject at execution start by default.
            // Operator can add tool_calls here to inject custom context.
            tool_calls: Vec::new(),
        },
        LifecycleSeed {
            name: "on_step_start",
            pattern: "session:step_start",
            idea_key: "session:step-start",
            idea_content: "",
            skip_idea_seed: false,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            // Empty — step_start ideas are resolved via assemble_step_ideas_for_worker
            // (static idea_ids path) rather than tool_calls, for now.
            tool_calls: Vec::new(),
        },
        LifecycleSeed {
            name: "on_recap_on_resume",
            pattern: "session:recap_on_resume",
            idea_key: "session:recap-on-resume",
            // Fires once per resumed session when the forked/loaded history was
            // non-empty. Gives the configured idea template a chance to provide
            // the model with recap guidance — replaces the old hardcoded
            // fetch_recap path ripped out as leak #11.
            idea_content: "This session is resuming with prior history loaded above. Before continuing, briefly recap where you left off — the last concrete action, the current objective, and any in-flight blockers — so the next step is grounded in that thread rather than starting cold.",
            skip_idea_seed: false,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            tool_calls: vec![ToolCall {
                tool: "ideas.assemble".into(),
                args: serde_json::json!({ "names": ["session:recap-on-resume"] }),
            }],
        },
        LifecycleSeed {
            name: "on_context_budget_exceeded",
            pattern: "context:budget:exceeded",
            idea_key: "session:compact-prompt",
            // This idea is seeded via seed_standalone_global_ideas (insert-if-absent).
            // The lifecycle loop must NOT overwrite it on every boot — set
            // skip_idea_seed = true so operator edits to session:compact-prompt persist.
            idea_content: "",
            skip_idea_seed: true,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            // Phase 5: compaction-as-delegation.
            // When context budget is exceeded:
            //   1. session.spawn spawns a lightweight compactor session with the
            //      transcript preview as seed content. Returns the compaction summary.
            //   2. transcript.replace_middle removes the middle messages from the
            //      current session and inserts the summary as a system message.
            // {transcript_preview} and {session_id} are substituted from trigger_args
            // at fire time. {last_tool_result} is the output of step 1 (the summary).
            tool_calls: vec![
                ToolCall {
                    tool: "session.spawn".into(),
                    args: serde_json::json!({
                        "kind": "compactor",
                        "instructions_idea": "session:compact-prompt",
                        "seed_content": "{transcript_preview}",
                        "parent_session": "{session_id}"
                    }),
                },
                ToolCall {
                    tool: "transcript.replace_middle".into(),
                    args: serde_json::json!({
                        "preserve_head": 3,
                        "preserve_tail": 6,
                        "replacement_role": "system",
                        "replacement_content": "# Context Summary (compactor session)\n\n{last_tool_result}"
                    }),
                },
            ],
        },
    ];

    let now = chrono::Utc::now().to_rfc3339();

    for seed in &defaults {
        let LifecycleSeed {
            name,
            pattern,
            idea_key,
            idea_content,
            skip_idea_seed,
            query_template,
            query_top_k,
            query_tag_filter,
            tool_calls,
        } = seed;

        // Seed ideas are globals (agent_id IS NULL) — one row total, shared by
        // every agent's lifecycle events. Resolve-or-create the canonical row,
        // then overwrite its content so code is the source of truth on every boot.
        //
        // Exception: when `skip_idea_seed` is true, the idea is managed elsewhere
        // (e.g. insert-if-absent in seed_standalone_global_ideas) and must NOT be
        // overwritten on every boot. We still resolve the idea_id for the event row.
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
                if !skip_idea_seed {
                    db.execute(
                        "UPDATE ideas SET content = ?1 WHERE id = ?2",
                        rusqlite::params![idea_content, id],
                    )
                    .map_err(|e| anyhow::anyhow!("failed to refresh seed idea {idea_key}: {e}"))?;
                }
                id
            } else if !skip_idea_seed {
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
            } else {
                // skip_idea_seed AND idea not present yet — will be seeded by
                // seed_standalone_global_ideas later. Use a placeholder ID for now;
                // the event row's idea_ids will be empty (acceptable: tool_calls path
                // doesn't use idea_ids).
                String::new()
            }
        };

        // Create the global event referencing the shared idea.
        let tag_filter_owned = query_tag_filter.map(|slice| {
            slice
                .iter()
                .map(|&s| s.to_string())
                .collect::<Vec<String>>()
        });
        let idea_ids_for_event = if idea_id.is_empty() {
            vec![]
        } else {
            vec![idea_id]
        };
        store
            .create(&NewEvent {
                agent_id: None,
                name: name.to_string(),
                pattern: pattern.to_string(),
                idea_ids: idea_ids_for_event,
                query_template: query_template.map(str::to_string),
                query_top_k: *query_top_k,
                query_tag_filter: tag_filter_owned.clone(),
                tool_calls: tool_calls.clone(),
                cooldown_secs: 0,
                system: true,
            })
            .await?;

        // create() is INSERT OR IGNORE. Refresh query_template / query_top_k /
        // query_tag_filter / tool_calls on system events so existing installs
        // pick up code changes — matching the "code is the source of truth on
        // every boot" pattern used for seed idea content above.
        let tag_filter_json = tag_filter_owned
            .as_ref()
            .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string()));
        let tool_calls_json =
            serde_json::to_string(tool_calls).unwrap_or_else(|_| "[]".to_string());
        {
            let db = store.db.lock().await;
            db.execute(
                "UPDATE events \
                 SET query_template = ?1, query_top_k = ?2, query_tag_filter = ?3, tool_calls = ?4
                 WHERE agent_id IS NULL AND name = ?5 AND system = 1",
                rusqlite::params![
                    query_template,
                    query_top_k.map(|k| k as i64),
                    tag_filter_json,
                    tool_calls_json,
                    name,
                ],
            )
            .map_err(|e| anyhow::anyhow!("failed to refresh seed event {name}: {e}"))?;
        }
    }

    info!("seeded 8 global lifecycle events with tool_calls and legacy fallback fields");
    seed_standalone_global_ideas(store).await?;
    Ok(())
}

/// Seed global ideas that are used by the runtime but not bound to any event
/// pattern (e.g. the compaction prompt loaded by the agent loop when it hits
/// the context ceiling).
///
/// Unlike lifecycle event ideas, these use **insert-if-absent** semantics so
/// operator edits in the Ideas UI persist across restarts — the intent is to
/// expose opinionated LLM-facing strings as first-class editable ideas rather
/// than hide them in `const &str` blocks.
async fn seed_standalone_global_ideas(store: &EventHandlerStore) -> anyhow::Result<()> {
    let seeds: &[(&str, &str, &[&str])] = &[(
        "session:compact-prompt",
        aeqi_core::agent::DEFAULT_COMPACT_PROMPT,
        &["system", "prompt"],
    )];
    let now = chrono::Utc::now().to_rfc3339();
    for &(name, content, tags) in seeds {
        let db = store.db.lock().await;
        let existing: Option<String> = db
            .query_row(
                "SELECT id FROM ideas WHERE agent_id IS NULL AND name = ?1",
                rusqlite::params![name],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| anyhow::anyhow!("failed to check standalone seed {name}: {e}"))?;
        if existing.is_some() {
            continue;
        }
        let new_id = uuid::Uuid::new_v4().to_string();
        db.execute(
            "INSERT INTO ideas (id, name, content, scope, agent_id, created_at)
             VALUES (?1, ?2, ?3, 'domain', NULL, ?4)",
            rusqlite::params![new_id, name, content, now],
        )
        .map_err(|e| anyhow::anyhow!("failed to insert standalone seed {name}: {e}"))?;
        for tag in tags {
            db.execute(
                "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                rusqlite::params![new_id, tag],
            )
            .map_err(|e| anyhow::anyhow!("failed to tag standalone seed {name}: {e}"))?;
        }
    }
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

    let query_template: Option<String> = row.get("query_template").ok().flatten();
    let query_top_k: Option<u32> = row
        .get::<_, Option<i64>>("query_top_k")
        .ok()
        .flatten()
        .and_then(|v| u32::try_from(v).ok());
    let query_tag_filter: Option<Vec<String>> = row
        .get::<_, Option<String>>("query_tag_filter")
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .filter(|v| !v.is_empty());
    let tool_calls: Vec<ToolCall> = row
        .get::<_, String>("tool_calls")
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<ToolCall>>(&s).ok())
        .unwrap_or_default();

    Event {
        id: row.get("id").unwrap_or_default(),
        agent_id: row.get("agent_id").ok().flatten(),
        name: row.get("name").unwrap_or_default(),
        pattern: row.get("pattern").unwrap_or_default(),
        idea_ids,
        query_template,
        query_top_k,
        query_tag_filter,
        tool_calls,
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
                 idea_ids TEXT NOT NULL DEFAULT '[]',
                 query_template TEXT, query_top_k INTEGER, query_tag_filter TEXT,
                 tool_calls TEXT NOT NULL DEFAULT '[]',
                 enabled INTEGER NOT NULL DEFAULT 1,
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

    /// Phase-1 guard: `tool_calls` round-trips through SQLite correctly, and
    /// the stub execution path is taken (not the legacy idea_ids path) when
    /// `tool_calls` is non-empty.
    #[tokio::test]
    async fn tool_calls_roundtrip_and_stub_path() {
        let store = test_store().await;

        let tc = vec![
            ToolCall {
                tool: "ideas.assemble".to_string(),
                args: serde_json::json!({"names": ["session:primer"]}),
            },
            ToolCall {
                tool: "ideas.search".to_string(),
                args: serde_json::json!({"query": "{user_input}", "top_k": 5}),
            },
        ];

        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "tool-call-test".into(),
                pattern: "session:start".into(),
                tool_calls: tc.clone(),
                ..Default::default()
            })
            .await
            .unwrap();

        // Verify tool_calls persisted and deserialised correctly.
        assert_eq!(event.tool_calls.len(), 2);
        assert_eq!(event.tool_calls[0].tool, "ideas.assemble");
        assert_eq!(
            event.tool_calls[0].args,
            serde_json::json!({"names": ["session:primer"]})
        );
        assert_eq!(event.tool_calls[1].tool, "ideas.search");
        assert_eq!(
            event.tool_calls[1].args["query"].as_str(),
            Some("{user_input}")
        );

        // Verify round-trip through get().
        let fetched = store.get(&event.id).await.unwrap().unwrap();
        assert_eq!(fetched.tool_calls.len(), 2);
        assert_eq!(fetched.tool_calls[0].tool, "ideas.assemble");
        assert_eq!(fetched.tool_calls[1].tool, "ideas.search");

        // Verify that the event with tool_calls is correctly identified as
        // having tool_calls (non-empty) — this is the condition the idea_assembly
        // stub path checks in Phase 1.
        assert!(!fetched.tool_calls.is_empty());

        // Verify legacy events still have empty tool_calls.
        let legacy = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "legacy-event".into(),
                pattern: "session:quest_start".into(),
                idea_ids: vec!["some-idea".into()],
                ..Default::default()
            })
            .await
            .unwrap();
        assert!(
            legacy.tool_calls.is_empty(),
            "legacy events without tool_calls must default to empty Vec"
        );
    }

    #[tokio::test]
    async fn create_and_list() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "morning-brief".into(),
                pattern: "schedule:0 9 * * *".into(),
                cooldown_secs: 300,
                ..Default::default()
            })
            .await
            .unwrap();

        assert_eq!(event.name, "morning-brief");
        assert_eq!(event.pattern, "schedule:0 9 * * *");
        assert!(!event.system);

        let events = store.list_for_agent("a1").await.unwrap();
        assert_eq!(events.len(), 1);
    }

    /// Regression guard for the scheduler/idea-assembly path: `session:start`
    /// must NOT prefix-match `session:quest_start`. This is the invariant the
    /// multi-pattern `assemble_ideas_for_quest_start` relies on — if
    /// `get_events_for_pattern` ever widens its LIKE semantics, the assembly
    /// would start double-injecting quest_start events on plain session_start
    /// traversals. Pinned here so the behavior is explicit.
    #[tokio::test]
    async fn session_start_pattern_does_not_prefix_match_quest_start() {
        let store = test_store().await;
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "quest_starter".into(),
                pattern: "session:quest_start".into(),
                ..Default::default()
            })
            .await
            .unwrap();
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "session_starter".into(),
                pattern: "session:start".into(),
                ..Default::default()
            })
            .await
            .unwrap();

        let session_hits = store.get_events_for_pattern("a1", "session:start").await;
        assert_eq!(
            session_hits.len(),
            1,
            "session:start must only match itself"
        );
        assert_eq!(session_hits[0].name, "session_starter");

        let quest_hits = store
            .get_events_for_pattern("a1", "session:quest_start")
            .await;
        assert_eq!(quest_hits.len(), 1);
        assert_eq!(quest_hits[0].name, "quest_starter");
    }

    #[tokio::test]
    async fn system_events_cannot_be_deleted() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "on-quest-received".into(),
                pattern: "session:quest_start".into(),
                system: true,
                ..Default::default()
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
                ..Default::default()
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
                ..Default::default()
            })
            .await
            .unwrap();
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "lifecycle1".into(),
                pattern: "session:quest_start".into(),
                ..Default::default()
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
                ..Default::default()
            })
            .await
            .unwrap();

        // Update with no idea_ids change — idea_ids should remain.
        store
            .update_fields(&event.id, None, None, None, None, None, None, None, None)
            .await
            .unwrap_err(); // no fields to update

        let after_omitted = store.get(&event.id).await.unwrap().unwrap();
        assert_eq!(
            after_omitted.idea_ids,
            vec!["keep-a".to_string(), "keep-b".to_string()]
        );

        let replacement = vec!["new-a".to_string(), "new-b".to_string()];
        store
            .update_fields(
                &event.id,
                None,
                None,
                None,
                Some(&replacement),
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();

        let after_replace = store.get(&event.id).await.unwrap().unwrap();
        assert_eq!(after_replace.idea_ids, replacement);

        let cleared: Vec<String> = Vec::new();
        store
            .update_fields(
                &event.id,
                None,
                None,
                None,
                Some(&cleared),
                None,
                None,
                None,
                None,
            )
            .await
            .unwrap();

        let after_clear = store.get(&event.id).await.unwrap().unwrap();
        assert!(after_clear.idea_ids.is_empty());
    }

    /// The daemon boot purge must:
    /// - delete legacy `lifecycle:*` rows,
    /// - delete per-agent `system` rows at `session:*` patterns whose pattern
    ///   is also covered by a global (`agent_id IS NULL`) `system` row,
    /// - leave globals untouched,
    /// - leave per-agent non-system rows untouched (user-created customizations),
    /// - leave per-agent `system` rows at patterns with no global counterpart
    ///   untouched (not redundant).
    #[tokio::test]
    async fn purge_redundant_system_events_keeps_globals_and_user_rows() {
        let store = test_store().await;

        // Global system row — keep.
        store
            .create(&NewEvent {
                agent_id: None,
                name: "global-qs".into(),
                pattern: "session:quest_start".into(),
                system: true,
                ..Default::default()
            })
            .await
            .unwrap();
        // Per-agent system row shadowing the global — delete.
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "shadow-qs".into(),
                pattern: "session:quest_start".into(),
                system: true,
                ..Default::default()
            })
            .await
            .unwrap();
        // Per-agent system row with no global counterpart — keep.
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "bespoke".into(),
                pattern: "session:bespoke".into(),
                system: true,
                ..Default::default()
            })
            .await
            .unwrap();
        // User-created per-agent row at a shadowed pattern — keep (system=0).
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "user-qs".into(),
                pattern: "session:quest_start".into(),
                system: false,
                ..Default::default()
            })
            .await
            .unwrap();
        // Legacy lifecycle row — delete.
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "legacy".into(),
                pattern: "lifecycle:quest-received".into(),
                ..Default::default()
            })
            .await
            .unwrap();

        let pool = store.db.clone();
        let conn = pool.lock().await;
        let (legacy, shadows) = purge_redundant_system_events(&conn).unwrap();
        assert_eq!(legacy, 1, "one lifecycle:* row should be purged");
        assert_eq!(shadows, 1, "only the shadow system row should be purged");

        let mut names: Vec<String> = conn
            .prepare("SELECT name FROM events ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        names.sort();
        assert_eq!(names, vec!["bespoke", "global-qs", "user-qs"]);
    }

    /// Creates a test store with both events and ideas tables (needed for lifecycle seed tests).
    async fn test_store_with_ideas() -> EventHandlerStore {
        let pool = ConnectionPool::in_memory().unwrap();
        let conn = pool.lock().await;
        conn.execute_batch(
            "CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'active', created_at TEXT NOT NULL);
             INSERT INTO agents (id, name, created_at) VALUES ('a1', 'shadow', '2026-01-01T00:00:00Z');
             CREATE TABLE events (
                 id TEXT PRIMARY KEY, agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
                 name TEXT NOT NULL, pattern TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'self',
                 idea_ids TEXT NOT NULL DEFAULT '[]',
                 query_template TEXT, query_top_k INTEGER, query_tag_filter TEXT,
                 tool_calls TEXT NOT NULL DEFAULT '[]',
                 enabled INTEGER NOT NULL DEFAULT 1,
                 cooldown_secs INTEGER NOT NULL DEFAULT 0,
                 last_fired TEXT, fire_count INTEGER NOT NULL DEFAULT 0,
                 total_cost_usd REAL NOT NULL DEFAULT 0.0, system INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL
             );
             CREATE UNIQUE INDEX idx_events_unique_name
                 ON events(COALESCE(agent_id, ''), name);
             CREATE TABLE ideas (
                 id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL,
                 scope TEXT NOT NULL DEFAULT 'domain', agent_id TEXT,
                 created_at TEXT NOT NULL
             );
             CREATE TABLE idea_tags (
                 idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
                 tag TEXT NOT NULL,
                 UNIQUE(idea_id, tag)
             );",
        )
        .unwrap();
        drop(conn);
        EventHandlerStore::new(Arc::new(pool))
    }

    /// Phase 3: update_fields persists tool_calls to the DB and roundtrips correctly.
    #[tokio::test]
    async fn update_fields_persists_tool_calls() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "tc-test".into(),
                pattern: "session:tc_test".into(),
                ..Default::default()
            })
            .await
            .unwrap();

        // Verify default: empty tool_calls.
        let before = store.get(&event.id).await.unwrap().unwrap();
        assert!(
            before.tool_calls.is_empty(),
            "should start with empty tool_calls"
        );

        // Write tool_calls via update_fields.
        let calls = vec![
            ToolCall {
                tool: "ideas.assemble".into(),
                args: serde_json::json!({"names": ["session:start"]}),
            },
            ToolCall {
                tool: "ideas.search".into(),
                args: serde_json::json!({"query": "test", "top_k": 3}),
            },
        ];
        store
            .update_fields(
                &event.id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(&calls),
            )
            .await
            .unwrap();

        // Verify roundtrip.
        let after = store.get(&event.id).await.unwrap().unwrap();
        assert_eq!(after.tool_calls.len(), 2);
        assert_eq!(after.tool_calls[0].tool, "ideas.assemble");
        assert_eq!(after.tool_calls[1].tool, "ideas.search");
        assert_eq!(after.tool_calls[1].args["top_k"], 3);

        // Clear to empty.
        store
            .update_fields(
                &event.id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(&[]),
            )
            .await
            .unwrap();
        let cleared = store.get(&event.id).await.unwrap().unwrap();
        assert!(
            cleared.tool_calls.is_empty(),
            "tool_calls should be empty after clearing"
        );
    }

    /// Phase 3: all 7 lifecycle seeds have both tool_calls AND legacy fallback fields
    /// populated so rollback is possible without data loss.
    #[tokio::test]
    async fn seed_migration_preserves_fallback() {
        let store = test_store_with_ideas().await;
        create_default_lifecycle_events(&store).await.unwrap();

        // Seeds that use legacy query_template path (non-None) must keep it.
        let all = store.list_by_pattern_prefix("session:").await.unwrap();
        let quest_start: Vec<_> = all
            .iter()
            .filter(|e| e.pattern == "session:quest_start")
            .collect();
        assert!(!quest_start.is_empty(), "on_quest_start seed must exist");
        let qs = quest_start[0];
        // Legacy field preserved.
        assert!(
            qs.query_template.is_some(),
            "on_quest_start must retain query_template for rollback"
        );
        assert_eq!(qs.query_top_k, Some(5));
        // New tool_calls populated.
        assert!(
            !qs.tool_calls.is_empty(),
            "on_quest_start must have tool_calls"
        );
        assert!(
            qs.tool_calls.iter().any(|tc| tc.tool == "ideas.search"),
            "on_quest_start tool_calls must include ideas.search"
        );

        // Seeds with no legacy query (session:start, quest_end, etc.) have no
        // query_template but must still have a non-empty idea_ids (legacy path).
        let session_start: Vec<_> = all
            .iter()
            .filter(|e| e.pattern == "session:start")
            .collect();
        assert!(
            !session_start.is_empty(),
            "on_session_start seed must exist"
        );
        let ss = session_start[0];
        // Legacy idea_ids fallback present.
        assert!(
            !ss.idea_ids.is_empty(),
            "on_session_start must retain idea_ids for rollback"
        );
        // New tool_calls present.
        assert!(
            !ss.tool_calls.is_empty(),
            "on_session_start must have tool_calls"
        );
        assert_eq!(ss.tool_calls[0].tool, "ideas.assemble");

        // Verify all 7 seeds were created (reuse `all` already fetched above).
        let seed_patterns = [
            "session:start",
            "session:quest_start",
            "session:quest_end",
            "session:quest_result",
            "session:execution_start",
            "session:step_start",
            "session:recap_on_resume",
            "context:budget:exceeded",
        ];
        for pattern in &seed_patterns {
            assert!(
                all.iter().any(|e| e.pattern == *pattern) || {
                    // context:budget:exceeded lives outside the session: prefix so
                    // list_by_pattern_prefix("session:") won't return it.
                    // Re-fetch all events to check.
                    store
                        .list_enabled()
                        .await
                        .unwrap()
                        .iter()
                        .any(|e| e.pattern == *pattern)
                },
                "seed pattern {pattern} must be present"
            );
        }
    }

    /// Phase 3: update_fields with only tool_calls updates the DB without
    /// touching other fields.
    #[tokio::test]
    async fn update_fields_tool_calls_does_not_clobber_other_fields() {
        let store = test_store().await;
        let event = store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "clobber-guard".into(),
                pattern: "session:clobber_guard".into(),
                idea_ids: vec!["idea-1".into()],
                query_template: Some("my template".into()),
                query_top_k: Some(7),
                ..Default::default()
            })
            .await
            .unwrap();

        let calls = vec![ToolCall {
            tool: "ideas.assemble".into(),
            args: serde_json::json!({"names": ["test"]}),
        }];
        store
            .update_fields(
                &event.id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(&calls),
            )
            .await
            .unwrap();

        let after = store.get(&event.id).await.unwrap().unwrap();
        // Tool calls written.
        assert_eq!(after.tool_calls.len(), 1);
        assert_eq!(after.tool_calls[0].tool, "ideas.assemble");
        // Legacy fields untouched.
        assert_eq!(after.idea_ids, vec!["idea-1".to_string()]);
        assert_eq!(after.query_template.as_deref(), Some("my template"));
        assert_eq!(after.query_top_k, Some(7));
    }

    /// Phase 5: the `on_context_budget_exceeded` seed exists with the correct
    /// pattern and tool_calls (session.spawn + transcript.replace_middle).
    #[tokio::test]
    async fn context_budget_exceeded_seed_has_correct_tool_calls() {
        let store = test_store_with_ideas().await;
        create_default_lifecycle_events(&store).await.unwrap();

        let events = store
            .get_events_for_exact_pattern("", "context:budget:exceeded")
            .await;
        assert!(
            !events.is_empty(),
            "on_context_budget_exceeded seed must exist"
        );
        let ev = &events[0];
        assert_eq!(ev.name, "on_context_budget_exceeded");
        assert_eq!(ev.pattern, "context:budget:exceeded");
        assert!(ev.system, "must be a system event");
        assert!(ev.enabled, "must be enabled by default");

        // Verify tool_calls: session.spawn → transcript.replace_middle.
        assert_eq!(
            ev.tool_calls.len(),
            2,
            "on_context_budget_exceeded must have 2 tool_calls"
        );
        assert_eq!(ev.tool_calls[0].tool, "session.spawn");
        assert_eq!(ev.tool_calls[1].tool, "transcript.replace_middle");
        assert_eq!(ev.tool_calls[0].args["kind"].as_str(), Some("compactor"));
        assert_eq!(
            ev.tool_calls[1].args["replacement_role"].as_str(),
            Some("system")
        );
    }

    /// Phase 5: get_events_for_exact_pattern returns only events with
    /// an exact pattern match (not prefix-matched like get_events_for_pattern).
    #[tokio::test]
    async fn get_events_for_exact_pattern_does_not_match_prefix() {
        let store = test_store().await;
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "exact".into(),
                pattern: "context:budget:exceeded".into(),
                ..Default::default()
            })
            .await
            .unwrap();
        store
            .create(&NewEvent {
                agent_id: Some("a1".into()),
                name: "prefix-only".into(),
                pattern: "context:budget:exceeded:extra".into(),
                ..Default::default()
            })
            .await
            .unwrap();

        let hits = store
            .get_events_for_exact_pattern("a1", "context:budget:exceeded")
            .await;
        assert_eq!(hits.len(), 1, "only exact match should be returned");
        assert_eq!(hits[0].name, "exact");
    }

    /// seed_lifecycle_events on an empty store inserts 4 middleware seed events
    /// (the 8 lifecycle events are handled by create_default_lifecycle_events, which
    /// runs first on daemon boot). On a re-run it inserts 0.
    #[tokio::test]
    async fn seed_lifecycle_events_is_idempotent() {
        let store = test_store_with_ideas().await;

        // First call: create_default_lifecycle_events seeds the 8 lifecycle patterns.
        create_default_lifecycle_events(&store).await.unwrap();

        // seed_lifecycle_events reports 0 for the lifecycle patterns (already present)
        // but inserts 4 middleware patterns.
        let n = seed_lifecycle_events(&store).await.unwrap();
        assert_eq!(n, 4, "should insert 4 middleware seed events on first run");

        // Re-run: all 12 patterns exist → no insertions.
        let n2 = seed_lifecycle_events(&store).await.unwrap();
        assert_eq!(n2, 0, "second run must be a no-op (idempotent)");
    }

    /// seed_lifecycle_events on a totally empty store (no lifecycle events yet)
    /// reports 12 (8 lifecycle + 4 middleware) as the count.
    #[tokio::test]
    async fn seed_lifecycle_events_counts_missing_lifecycle_patterns() {
        let store = test_store_with_ideas().await;

        // Do NOT call create_default_lifecycle_events first.
        let n = seed_lifecycle_events(&store).await.unwrap();
        // 4 middleware patterns are inserted; 8 lifecycle patterns are counted as
        // "absent before this run" even though create_default_lifecycle_events hasn't
        // inserted them yet. The count reflects what was missing.
        assert_eq!(
            n, 12,
            "should count all 12 missing patterns on a clean store"
        );
    }

    /// After seed_lifecycle_events the 4 middleware patterns exist as global
    /// system events with transcript.inject tool_calls.
    #[tokio::test]
    async fn seed_lifecycle_events_middleware_patterns_have_tool_calls() {
        let store = test_store_with_ideas().await;
        create_default_lifecycle_events(&store).await.unwrap();
        seed_lifecycle_events(&store).await.unwrap();

        for pattern in &[
            "loop:detected",
            "guardrail:violation",
            "graph_guardrail:high_impact",
            "shell:command_failed",
        ] {
            let events = store.get_events_for_exact_pattern("", pattern).await;
            assert!(
                !events.is_empty(),
                "middleware pattern {pattern} must be seeded"
            );
            let ev = &events[0];
            assert!(ev.system, "middleware seed must be a system event");
            assert!(ev.enabled, "middleware seed must be enabled");
            assert_eq!(
                ev.tool_calls.len(),
                1,
                "middleware seed must have 1 tool_call"
            );
            assert_eq!(
                ev.tool_calls[0].tool, "transcript.inject",
                "middleware seed tool_call must be transcript.inject"
            );
        }
    }
}
