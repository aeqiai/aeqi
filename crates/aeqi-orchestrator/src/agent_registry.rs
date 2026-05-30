//! Agent Registry — agent identities, scoped to entities.
//!
//! An agent is an identity owned by exactly one entity (`agents.trust_id`).
//! Hierarchy lives in the position DAG (`positions` + `position_edges`):
//! every agent that participates in an org chart is the occupant of one or
//! more positions, and authority/delegation queries walk `position_edges`.
//!
//! - Spawn = create an agent identity (and, when appropriate, a position
//!   that links the new agent into an entity's org chart).
//! - Delegate = sibling↔sibling or parent↔child message passing, resolved by
//!   recursive CTEs over `position_edges`.
//! - Memory = walk the position DAG upward from the agent's position(s).
//! - Identity = per-agent ideas/events + model, anchored on `agent.id`.
//!
//! Persistent agents are NOT running processes — they are identities that get
//! loaded into fresh sessions on demand. Their "persistence" comes from:
//! 1. Stable UUID → entity-scoped memory accumulates across sessions.
//! 2. Registry metadata → survives daemon restarts.
//! 3. Position-DAG membership → memory scoping and delegation.

use aeqi_core::Scope;
use aeqi_ideas::SqliteIdeas;
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info};

use crate::channel_session::{ChannelSessionKey, ChannelSessionRecord};

/// Optional per-agent LLM boundary.
///
/// `None` fields mean "any"; `Some(vec![])` means "none". The matrix is
/// intentionally small and checked at inference seams, not at tool-dispatch
/// seams, so it layers cleanly with `tool_deny`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InferenceCapability {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_providers: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_models: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_per_call_usd: Option<f64>,
}

impl InferenceCapability {
    pub fn allows_request(
        &self,
        provider: &str,
        model: &str,
    ) -> Result<(), InferenceCapabilityError> {
        if let Some(allowed) = &self.allowed_providers
            && !allowed.iter().any(|p| p == provider)
        {
            return Err(InferenceCapabilityError::CapabilityViolation {
                provider: provider.to_string(),
                model: model.to_string(),
                allowed: self.allowed_summary(),
            });
        }
        if let Some(allowed) = &self.allowed_models
            && !allowed.iter().any(|m| m == model)
        {
            return Err(InferenceCapabilityError::CapabilityViolation {
                provider: provider.to_string(),
                model: model.to_string(),
                allowed: self.allowed_summary(),
            });
        }
        Ok(())
    }

    fn allowed_summary(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "<unserializable capability>".to_string())
    }
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum InferenceCapabilityError {
    #[error(
        "inference capability violation: provider '{provider}' model '{model}' not allowed by {allowed}"
    )]
    CapabilityViolation {
        provider: String,
        model: String,
        allowed: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapTableEntry {
    pub id: String,
    pub trust_id: String,
    pub allocation_key: String,
    pub holder_kind: String,
    pub holder_id: Option<String>,
    pub security_type: String,
    pub basis_points: i64,
    pub vesting_months: Option<i64>,
    pub cliff_months: Option<i64>,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityView {
    pub id: String,
    pub trust_id: String,
    pub owner_user_id: Option<String>,
    pub key: String,
    pub label: String,
    pub kind: String,
    pub scope: String,
    pub path: Option<String>,
    pub search: Option<String>,
    pub layout_json: Option<serde_json::Value>,
    pub pinned: bool,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityViewUpsert {
    pub id: Option<String>,
    pub key: String,
    pub label: String,
    pub kind: String,
    pub scope: String,
    pub path: Option<String>,
    pub search: Option<String>,
    pub layout_json: Option<serde_json::Value>,
    pub pinned: bool,
    pub sort_order: i64,
}

struct CapTableSeed<'a> {
    trust_id: &'a str,
    allocation_key: &'a str,
    holder_kind: &'a str,
    holder_id: Option<&'a str>,
    security_type: &'a str,
    basis_points: i64,
    vesting_months: Option<i64>,
    cliff_months: Option<i64>,
}

/// A persistent agent identity — one record = one node in the agent tree.
///
/// Identity, personality, and capabilities are expressed through ideas
/// referenced via events — not static struct fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    /// Stable UUID — the true identity. Used for memory scoping, delegation, everything.
    pub id: String,
    /// Human-readable label (NOT unique — multiple agents can share a name).
    pub name: String,
    /// Owning entity UUID. Every agent belongs to exactly one entity.
    pub trust_id: Option<String>,
    /// Preferred model. None = inherit from the agent's position-DAG ancestry.
    pub model: Option<String>,
    /// Agent status.
    pub status: AgentStatus,
    pub created_at: DateTime<Utc>,
    pub last_active: Option<DateTime<Utc>>,
    pub session_count: u32,
    pub total_tokens: u64,
    /// Running USD cost across every inference call attributed to this agent.
    /// Updated atomically by `record_inference_call`. Denormalized for fast
    /// agents-list rendering — `inference_calls` table is the audit trail.
    #[serde(default)]
    pub lifetime_cost_usd: f64,
    // --- Visual identity ---
    pub color: Option<String>,
    pub avatar: Option<String>,
    /// Emotional faces shown during different states.
    pub faces: Option<std::collections::HashMap<String, String>>,
    /// Maximum concurrent workers for this agent (default: 1).
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: u32,
    /// Current session ID.
    #[serde(default)]
    pub session_id: Option<String>,
    // --- Operational fields (the "agent OS" columns) ---
    /// Working directory for this agent (repo path). None = inherit from parent.
    #[serde(default)]
    pub workdir: Option<String>,
    /// Budget in USD. None = inherit from parent's budget_policies.
    #[serde(default)]
    pub budget_usd: Option<f64>,
    /// Execution mode: "agent" (native loop) or "claude_code" (CLI delegation).
    #[serde(default)]
    pub execution_mode: Option<String>,
    /// Quest ID prefix (e.g., "sg" for sigil). None = derived from name.
    #[serde(default)]
    pub quest_prefix: Option<String>,
    /// Worker timeout in seconds. None = inherit from parent or use global default.
    #[serde(default)]
    pub worker_timeout_secs: Option<u64>,
    /// Tools denied for this agent (JSON array of tool names). Empty = all tools allowed.
    #[serde(default)]
    pub tool_deny: Vec<String>,
    /// Whether this agent is allowed to spawn a child session of itself via
    /// `session.spawn`. Defaults to `false`. Set `true` for transport-bound
    /// agents (Telegram / WhatsApp / Discord owners) that rely on self-delegation
    /// for interactive continuation.
    #[serde(default)]
    pub can_self_delegate: bool,
    /// Whether this agent is allowed to fire `question.ask` to surface a
    /// question/decision to a director via the home-page inbox. Defaults to
    /// `false` — operator opts in per agent. Same posture as
    /// `can_self_delegate`: dangerous-by-default tool, off until trusted.
    #[serde(default)]
    pub can_ask_director: bool,
    /// Optional provider/model capability matrix. `None` preserves legacy
    /// behavior: any configured provider/model may be used.
    #[serde(default)]
    pub inference_cap: Option<InferenceCapability>,
    /// Optional override for the model used by compactor (kind="compactor")
    /// session.spawn calls. `None` falls back to the agent's primary model.
    ///
    /// Pairs with `inference_cap`: the override must satisfy the capability
    /// matrix when one is set, otherwise the compactor spawn is rejected.
    /// Typical use: pin compactor to a cheaper/faster model
    /// (e.g. `anthropic/claude-haiku-4.5`) while the agent runs on a primary
    /// model like Sonnet/Opus.
    #[serde(default)]
    pub compactor_model: Option<String>,
    /// Optional provider hint for compactor session.spawn calls. Recorded for
    /// audit + future routing; the runtime currently uses the orchestrator's
    /// default provider for ephemeral spawns. When set and the active provider
    /// differs, a warning is logged so operators can spot misconfiguration.
    #[serde(default)]
    pub compactor_provider: Option<String>,
}

fn default_max_concurrent() -> u32 {
    1
}

fn bootstrap_cap_table_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cap_table_entries (
             id TEXT PRIMARY KEY,
             trust_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
             allocation_key TEXT NOT NULL,
             holder_kind TEXT NOT NULL CHECK (holder_kind IN ('creator', 'unassigned')),
             holder_id TEXT,
             security_type TEXT NOT NULL CHECK (
                 security_type IN ('common', 'vesting_common', 'option_pool')
             ),
             basis_points INTEGER NOT NULL CHECK (basis_points BETWEEN 1 AND 10000),
             vesting_months INTEGER CHECK (vesting_months IS NULL OR vesting_months >= 0),
             cliff_months INTEGER CHECK (cliff_months IS NULL OR cliff_months >= 0),
             created_at TEXT NOT NULL,
             UNIQUE(trust_id, allocation_key),
             CHECK (holder_kind != 'unassigned' OR holder_id IS NULL)
         );
         CREATE INDEX IF NOT EXISTS idx_cap_table_entries_trust
             ON cap_table_entries(trust_id);",
    )
}

fn bootstrap_entity_view_tables(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS entity_views (
             id TEXT PRIMARY KEY,
             trust_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
             owner_user_id TEXT NOT NULL DEFAULT '',
             key TEXT NOT NULL,
             label TEXT NOT NULL,
             kind TEXT NOT NULL CHECK (kind IN ('route', 'dashboard')),
             scope TEXT NOT NULL CHECK (scope IN ('private', 'public')),
             path TEXT,
             search TEXT,
             layout_json TEXT,
             pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
             sort_order INTEGER NOT NULL DEFAULT 0,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             UNIQUE(trust_id, owner_user_id, key)
         );
         CREATE INDEX IF NOT EXISTS idx_entity_views_trust
             ON entity_views(trust_id);
         CREATE INDEX IF NOT EXISTS idx_entity_views_owner
             ON entity_views(trust_id, owner_user_id);",
    )
}

fn normalize_entity_view_owner(owner_user_id: Option<&str>) -> String {
    owner_user_id
        .map(str::trim)
        .filter(|owner| !owner.is_empty())
        .unwrap_or("")
        .to_string()
}

fn validate_entity_view(view: &EntityViewUpsert) -> Result<()> {
    if view.key.trim().is_empty() {
        anyhow::bail!("view key is required");
    }
    if view.label.trim().is_empty() {
        anyhow::bail!("view label is required");
    }
    match view.kind.as_str() {
        "route" | "dashboard" => {}
        _ => anyhow::bail!("view kind must be route or dashboard"),
    }
    match view.scope.as_str() {
        "private" | "public" => {}
        _ => anyhow::bail!("view scope must be private or public"),
    }
    Ok(())
}

fn entity_view_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<EntityView> {
    let owner_user_id: String = row.get(2)?;
    let layout_raw: Option<String> = row.get(9)?;
    Ok(EntityView {
        id: row.get(0)?,
        trust_id: row.get(1)?,
        owner_user_id: if owner_user_id.is_empty() {
            None
        } else {
            Some(owner_user_id)
        },
        key: row.get(3)?,
        label: row.get(4)?,
        kind: row.get(5)?,
        scope: row.get(6)?,
        path: row.get(7)?,
        search: row.get(8)?,
        layout_json: layout_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
        pinned: row.get::<_, i64>(10)? != 0,
        sort_order: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
    })
}

/// Embedded migration 0002 — drops the legacy event columns
/// (`idea_ids`, `query_template`, `query_top_k`, `query_tag_filter`).
/// `tool_calls` is the canonical pattern shape now.
const MIGRATION_0002_DROP_LEGACY_EVENT_COLUMNS: &str =
    include_str!("../migrations/0002_drop_legacy_event_columns.sql");

fn ensure_event_columns(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(events)")?;
    let columns: Vec<(String, i64)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?))
        })?
        .filter_map(|r| r.ok())
        .collect();
    let existing: std::collections::HashSet<String> =
        columns.iter().map(|(n, _)| n.clone()).collect();

    // Forward-only columns that may be missing on legacy DBs. tool_calls is
    // the canonical pattern shape; legacy idea_ids/query_* columns are
    // dropped by migration 0002 below.
    if !existing.contains("tool_calls") {
        conn.execute(
            "ALTER TABLE events ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]'",
            [],
        )?;
    }

    // Heal pre-baseline installs where `agent_id` was NOT NULL. The current
    // schema makes it nullable (NULL = global event). SQLite can't drop a
    // NOT NULL constraint in place, so rebuild the table when we detect the
    // old shape — and take the opportunity to land the canonical column set
    // (no legacy columns) so migration 0002 doesn't have to drop them.
    let agent_id_notnull = columns
        .iter()
        .find(|(n, _)| n == "agent_id")
        .map(|(_, nn)| *nn == 1)
        .unwrap_or(false);
    if agent_id_notnull {
        conn.execute_batch(
            "BEGIN;
             CREATE TABLE events_new (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
                 name TEXT NOT NULL,
                 pattern TEXT NOT NULL,
                 scope TEXT NOT NULL DEFAULT 'self',
                 tool_calls TEXT NOT NULL DEFAULT '[]',
                 enabled INTEGER NOT NULL DEFAULT 1,
                 cooldown_secs INTEGER NOT NULL DEFAULT 0,
                 last_fired TEXT,
                 fire_count INTEGER NOT NULL DEFAULT 0,
                 total_cost_usd REAL NOT NULL DEFAULT 0.0,
                 system INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL
             );
             INSERT INTO events_new
                 (id, agent_id, name, pattern, scope, tool_calls, enabled,
                  cooldown_secs, last_fired, fire_count, total_cost_usd,
                  system, created_at)
                 SELECT id, agent_id, name, pattern, scope,
                        COALESCE(tool_calls, '[]') AS tool_calls,
                        enabled, cooldown_secs, last_fired, fire_count,
                        total_cost_usd, system, created_at
                   FROM events;
             DROP TABLE events;
             ALTER TABLE events_new RENAME TO events;
             CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
             CREATE INDEX IF NOT EXISTS idx_events_pattern ON events(pattern);
             CREATE INDEX IF NOT EXISTS idx_events_enabled ON events(enabled);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_name
                 ON events(COALESCE(agent_id, ''), name);
             COMMIT;",
        )?;
    }

    // Migration 0002 — idempotent drop of the four legacy columns.
    // The unconditional ALTER TABLE DROP COLUMN errors on already-dropped
    // columns, so gate each statement on the column being present.
    let post_columns: std::collections::HashSet<String> = {
        let mut s = conn.prepare("PRAGMA table_info(events)")?;
        s.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    for legacy_col in [
        "idea_ids",
        "query_template",
        "query_top_k",
        "query_tag_filter",
    ] {
        if post_columns.contains(legacy_col) {
            conn.execute(&format!("ALTER TABLE events DROP COLUMN {legacy_col}"), [])?;
        }
    }
    // Reference the embedded SQL so it stays in the binary alongside the
    // executed code path (single source of truth for documentation).
    let _ = MIGRATION_0002_DROP_LEGACY_EVENT_COLUMNS;

    Ok(())
}

/// Idempotent scope-model migration for aeqi.db (events + ideas tables).
///
/// - Adds `scope` column to `events` if absent (already present in current schema,
///   but older on-disk DBs may lack it).
/// - Normalises legacy `events.scope` values that are not in the new enum:
///   rows with `agent_id IS NULL` → `scope='global'`; others → `scope='self'`.
/// - Same treatment for `ideas.scope` which previously defaulted to `'domain'`.
fn ensure_aeqi_db_scope_columns(conn: &Connection) -> rusqlite::Result<()> {
    // ── events ──────────────────────────────────────────────────────────────
    // `scope` is present in the current CREATE TABLE but may be absent on old DBs.
    let event_cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(events)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !event_cols.iter().any(|c| c == "scope") {
        conn.execute_batch("ALTER TABLE events ADD COLUMN scope TEXT NOT NULL DEFAULT 'self'")?;
    }

    // Migrate events: NULL agent_id rows → 'global'; non-'self'/non-'global' → 'self'.
    conn.execute_batch(
        "UPDATE events SET scope = 'global'
         WHERE agent_id IS NULL AND scope NOT IN ('self','siblings','children','branch','global');
         UPDATE events SET scope = 'self'
         WHERE agent_id IS NOT NULL AND scope NOT IN ('self','siblings','children','branch','global');",
    )?;
    // Existing events with agent_id IS NULL and scope='self' (old default) → 'global'.
    conn.execute_batch(
        "UPDATE events SET scope = 'global' WHERE agent_id IS NULL AND scope = 'self';",
    )?;

    // ── ideas ────────────────────────────────────────────────────────────────
    // `scope` column already exists (DEFAULT 'domain'). Normalise the value.
    conn.execute_batch(
        "UPDATE ideas SET scope = 'global'
         WHERE agent_id IS NULL AND scope NOT IN ('self','siblings','children','branch','global');
         UPDATE ideas SET scope = 'self'
         WHERE agent_id IS NOT NULL AND scope NOT IN ('self','siblings','children','branch','global');",
    )?;
    Ok(())
}

/// Idempotent scope-model migration for sessions.db (quests table).
///
/// - Adds `scope` column if absent.
/// - Migrates NULL-agent_id rows to `scope='global'` and normalises any other
///   non-enum values to `scope='self'`.
fn ensure_scope_columns(conn: &Connection) -> rusqlite::Result<()> {
    let quest_cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(quests)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !quest_cols.iter().any(|c| c == "scope") {
        conn.execute_batch("ALTER TABLE quests ADD COLUMN scope TEXT NOT NULL DEFAULT 'self'")?;
    }

    // Migrate quests: NULL agent_id → 'global'; non-enum values → 'self'.
    conn.execute_batch(
        "UPDATE quests SET scope = 'global'
         WHERE agent_id IS NULL AND scope NOT IN ('self','siblings','children','branch','global');
         UPDATE quests SET scope = 'self'
         WHERE agent_id IS NOT NULL AND scope NOT IN ('self','siblings','children','branch','global');",
    )?;
    Ok(())
}

/// Phase 1 of the quest ↔ idea unification: add the `idea_id` FK column to
/// legacy `quests` tables. Nullable until the backfill (WS-1c) has populated
/// every row; phase 3 (WS-8) flips to NOT NULL after the legacy editorial
/// columns are dropped. Idempotent — only ADDs the column if missing.
fn ensure_quest_idea_id_column(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(quests)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "idea_id") {
        conn.execute_batch("ALTER TABLE quests ADD COLUMN idea_id TEXT")?;
    }
    // Index added on legacy DBs so the FK lookup path exists immediately.
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_quests_idea ON quests(idea_id)")?;
    Ok(())
}

/// Idempotent: add the `assignee` column on legacy DBs that pre-date
/// the polymorphic-assignee feature. Stores prefix-typed identities
/// (`agent:<id>` | `user:<id>`) — distinct from `agent_id`, which is
/// the visibility-tree anchor. Fresh DBs already include the column
/// from the CREATE TABLE; this is the catch-up for upgraded ones.
fn ensure_quest_assignee_column(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(quests)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "assignee") {
        conn.execute_batch("ALTER TABLE quests ADD COLUMN assignee TEXT")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_quests_assignee ON quests(assignee)")?;
    Ok(())
}

/// Quest 67-213 phase-1: partial index for `assignee LIKE 'role:%'` lookups.
///
/// The full `idx_quests_assignee` index already covers exact-match queries
/// on `role:<uuid>`. This partial index is the fanout helper for "which
/// quests target role X?" listings (and any future indexer that scans
/// role-bound quests separately from principal-bound quests). Cheap to
/// maintain — only role-assigned rows pay write cost. Idempotent.
fn ensure_quest_assignee_role_index(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_quests_assignee_role
         ON quests(assignee)
         WHERE assignee LIKE 'role:%'",
    )?;
    Ok(())
}

/// Idempotent: add the `due_at` column on legacy DBs that pre-date
/// the Phase-2 due-date feature. Stored as a Unix-second integer (no
/// timezone games — UTC). NULL = no deadline. Fresh DBs include the
/// column from the CREATE TABLE; this is the catch-up for upgraded
/// ones. The companion index supports the toolbar's "sort by due"
/// option without scanning the whole table.
fn ensure_quest_due_at_column(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(quests)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "due_at") {
        conn.execute_batch("ALTER TABLE quests ADD COLUMN due_at INTEGER")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_quests_due_at ON quests(due_at)")?;
    Ok(())
}

/// Phase 3 cleanup (WS-8a): drop the legacy editorial columns and flip
/// `idea_id` to NOT NULL. SQLite's pre-3.35 `ALTER TABLE` lacks
/// `DROP COLUMN`, so we do the canonical rebuild dance — create the new
/// shape, copy preserved columns over, drop the legacy table, rename.
///
/// Idempotent. The function inspects `PRAGMA table_info(quests)`; if any
/// of the legacy columns are still present, the rebuild runs. Otherwise
/// it returns immediately. A pre-flight verifies every row has a non-null
/// `idea_id` (the WS-1c backfill should have ensured this) — if any
/// straggler exists, the cleanup aborts with an error rather than losing
/// the row's editorial body to the column drop.
fn cleanup_legacy_quest_columns(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(quests)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };

    let legacy_cols = [
        "subject",
        "description",
        "acceptance_criteria",
        "labels",
        "idea_ids",
    ];
    let has_legacy = legacy_cols
        .iter()
        .any(|name| cols.iter().any(|c| c == name));
    if !has_legacy {
        return Ok(());
    }

    // Pre-flight: every row must already carry a non-null `idea_id`.
    // The WS-1c backfill that ran moments ago should have made this so;
    // bailing here is the loudest failure mode if anything regressed.
    let nulls: i64 = conn.query_row(
        "SELECT COUNT(*) FROM quests WHERE idea_id IS NULL",
        [],
        |row| row.get(0),
    )?;
    if nulls > 0 {
        return Err(rusqlite::Error::InvalidQuery);
    }

    info!("rebuilding quests table to drop legacy editorial columns (WS-8a)");

    // SQLite advice for table rebuilds: use `legacy_alter_table=ON` to skip
    // the foreign-key-action rename rewrite, then run the rebuild inside
    // an explicit transaction so a crash mid-flight rolls back to the
    // legacy shape.
    conn.execute_batch(
        "PRAGMA legacy_alter_table=ON;
         BEGIN IMMEDIATE;
         CREATE TABLE quests_new (
             id TEXT PRIMARY KEY,
             idea_id TEXT NOT NULL,
             status TEXT NOT NULL DEFAULT 'todo',
             priority TEXT NOT NULL DEFAULT 'normal',
             agent_id TEXT,
             scope TEXT NOT NULL DEFAULT 'self',
             retry_count INTEGER NOT NULL DEFAULT 0,
             checkpoints TEXT NOT NULL DEFAULT '[]',
             metadata TEXT NOT NULL DEFAULT '{}',
             depends_on TEXT NOT NULL DEFAULT '[]',
             outcome TEXT,
             worktree_branch TEXT,
             worktree_path TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT,
             closed_at TEXT,
             closed_reason TEXT,
             creator_session_id TEXT,
             kind TEXT NOT NULL DEFAULT 'task'
         );
         INSERT INTO quests_new (
             id, idea_id, status, priority, agent_id, scope, retry_count,
             checkpoints, metadata, depends_on, outcome, worktree_branch,
             worktree_path, created_at, updated_at, closed_at, closed_reason,
             creator_session_id
         )
         SELECT
             id, idea_id, status, priority, agent_id, scope, retry_count,
             checkpoints, metadata, depends_on, outcome, worktree_branch,
             worktree_path, created_at, updated_at, closed_at, closed_reason,
             creator_session_id
         FROM quests;
         DROP TABLE quests;
         ALTER TABLE quests_new RENAME TO quests;
         CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
         CREATE INDEX IF NOT EXISTS idx_quests_agent ON quests(agent_id);
         CREATE INDEX IF NOT EXISTS idx_quests_created ON quests(created_at);
         CREATE INDEX IF NOT EXISTS idx_quests_idea ON quests(idea_id);
         COMMIT;
         PRAGMA legacy_alter_table=OFF;",
    )?;

    info!("legacy quest columns dropped — schema is on the canonical shape");
    Ok(())
}

/// Phase 1 backfill (WS-1c): for every quest with `idea_id IS NULL`, mint or
/// reuse an idea row in `aeqi.db` and link the quest to it.
///
/// Idempotent: re-running the function is a no-op once every quest carries a
/// non-null `idea_id`. Cross-DB writes are not transactional — on crash
/// between the idea INSERT and the quest UPDATE, the orphan idea is detected
/// on the next pass via the `(COALESCE(agent_id,''), name)` unique index, so
/// the same quest re-links to the same idea instead of duplicating.
///
/// `idea_id_db` is `aeqi.db`; `quests_db` is `sessions.db`. Both are taken by
/// shared reference because this runs inside the synchronous `open()` path
/// where we already hold raw `Connection` handles before pool conversion.
fn backfill_quest_idea_ids(
    idea_db: &Connection,
    quests_db: &Connection,
) -> rusqlite::Result<usize> {
    #[derive(Debug)]
    struct LegacyQuest {
        id: String,
        subject: String,
        description: String,
        acceptance: Option<String>,
        labels_json: String,
        agent_id: Option<String>,
        scope: String,
    }

    // The legacy columns get rebuilt out by `cleanup_legacy_quest_columns`;
    // on the post-cleanup shape there's nothing to backfill, so a quick
    // PRAGMA check skips the SELECT and lets the function be a no-op on
    // fresh DBs and post-phase-3 DBs alike.
    let cols: Vec<String> = {
        let mut stmt = quests_db.prepare("PRAGMA table_info(quests)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "subject") {
        return Ok(0);
    }

    let mut stmt = quests_db.prepare(
        "SELECT id, subject, description, acceptance_criteria, labels, agent_id, scope
         FROM quests WHERE idea_id IS NULL",
    )?;
    let legacy: Vec<LegacyQuest> = stmt
        .query_map([], |row| {
            Ok(LegacyQuest {
                id: row.get(0)?,
                subject: row.get(1)?,
                description: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                acceptance: row.get::<_, Option<String>>(3)?,
                labels_json: row
                    .get::<_, Option<String>>(4)?
                    .unwrap_or_else(|| "[]".into()),
                agent_id: row.get(5)?,
                scope: row
                    .get::<_, Option<String>>(6)?
                    .unwrap_or_else(|| "self".into()),
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    if legacy.is_empty() {
        return Ok(0);
    }

    info!(
        count = legacy.len(),
        "backfilling idea rows for legacy quests"
    );
    let mut linked = 0usize;
    let now = Utc::now().to_rfc3339();

    for quest in legacy {
        let name = if quest.subject.trim().is_empty() {
            format!("(quest {})", quest.id)
        } else {
            quest.subject.clone()
        };

        let mut content = quest.description.clone();
        if let Some(ac) = quest.acceptance.as_ref().filter(|s| !s.trim().is_empty()) {
            if !content.is_empty() {
                content.push_str("\n\n");
            }
            content.push_str("## Acceptance\n");
            content.push_str(ac);
        }
        if content.is_empty() {
            content.push_str("(backfilled from legacy quest with empty body)");
        }

        // Reuse existing idea by (agent_id, name) when present — the unique
        // index guarantees at most one — otherwise mint a fresh row.
        let existing_id: Option<String> = idea_db
            .query_row(
                "SELECT id FROM ideas
                 WHERE COALESCE(agent_id, '') = COALESCE(?1, '') AND name = ?2
                 LIMIT 1",
                rusqlite::params![quest.agent_id, name],
                |row| row.get(0),
            )
            .optional()?;

        let idea_id = if let Some(id) = existing_id {
            id
        } else {
            let id = uuid::Uuid::new_v4().to_string();
            idea_db.execute(
                "INSERT INTO ideas (id, name, content, scope, agent_id, created_at,
                                    status, embedding_pending)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 1)",
                rusqlite::params![id, name, content, quest.scope, quest.agent_id, now],
            )?;

            let labels: Vec<String> = serde_json::from_str(&quest.labels_json).unwrap_or_default();
            for tag in labels {
                let tag = tag.trim().to_lowercase();
                if tag.is_empty() {
                    continue;
                }
                idea_db.execute(
                    "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                    rusqlite::params![id, tag],
                )?;
            }
            // Tag every backfill row so phase-3 cleanup / rollback can find
            // them in one query.
            idea_db.execute(
                "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, 'aeqi:backfill')",
                rusqlite::params![id],
            )?;
            id
        };

        quests_db.execute(
            "UPDATE quests SET idea_id = ?1 WHERE id = ?2",
            rusqlite::params![idea_id, quest.id],
        )?;
        linked += 1;
    }

    info!(linked, "quest ↔ idea backfill complete");
    Ok(linked)
}

/// Idempotent migration: adds the `can_self_delegate` column to the `agents`
/// table (older on-disk DBs won't have it) and backfills transport-bound agents.
///
/// Transport-bound agents are those that own at least one row in `channels`.
/// Their `can_self_delegate` is set to 1 because they need interactive
/// self-delegation capability. All other agents keep the default of 0.
fn ensure_agent_columns(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(agents)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "can_self_delegate") {
        conn.execute_batch(
            "ALTER TABLE agents ADD COLUMN can_self_delegate INTEGER NOT NULL DEFAULT 0;",
        )?;
        // Backfill: any agent that owns a channel row is transport-bound and
        // Backfill: transport-bound agents get self-delegate enabled.
        conn.execute_batch(
            "UPDATE agents SET can_self_delegate = 1
             WHERE id IN (SELECT DISTINCT agent_id FROM channels);",
        )?;
    }
    if !cols.iter().any(|c| c == "can_ask_director") {
        // Same shape as `can_self_delegate`: nullable-style boolean stored as
        // INTEGER NOT NULL DEFAULT 0. No backfill — every existing agent
        // stays opted-out until the operator flips the bit.
        conn.execute_batch(
            "ALTER TABLE agents ADD COLUMN can_ask_director INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    if !cols.iter().any(|c| c == "lifetime_cost_usd") {
        // Denormalized running USD cost across every inference call attributed
        // to this agent. Populated by `record_inference_call`; rendered on the
        // agents-list view without joining `inference_calls`.
        conn.execute_batch(
            "ALTER TABLE agents ADD COLUMN lifetime_cost_usd REAL NOT NULL DEFAULT 0;",
        )?;
    }
    if !cols.iter().any(|c| c == "inference_cap") {
        // Nullable JSON capability matrix. NULL means no constraint.
        conn.execute_batch("ALTER TABLE agents ADD COLUMN inference_cap TEXT;")?;
    }
    if !cols.iter().any(|c| c == "compactor_model") {
        // Optional per-agent override for the model used by compactor
        // (kind="compactor") session.spawn calls. NULL = inherit primary model.
        conn.execute_batch("ALTER TABLE agents ADD COLUMN compactor_model TEXT;")?;
    }
    if !cols.iter().any(|c| c == "compactor_provider") {
        // Optional provider hint for compactor session.spawn calls. NULL =
        // inherit the orchestrator default provider.
        conn.execute_batch("ALTER TABLE agents ADD COLUMN compactor_provider TEXT;")?;
    }
    Ok(())
}

/// Per-call inference accounting table — source of truth for the per-agent
/// cost / token rollups stored on `agents.total_tokens` /
/// `agents.lifetime_cost_usd` / `agents.session_count`. One row per
/// `agent completed` emission. Idempotent; safe to call on every open.
fn ensure_inference_calls_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS inference_calls (
             id TEXT PRIMARY KEY,
             agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
             session_id TEXT,
             model TEXT NOT NULL,
             prompt_tokens INTEGER NOT NULL DEFAULT 0,
             completion_tokens INTEGER NOT NULL DEFAULT 0,
             cost_usd REAL NOT NULL DEFAULT 0,
             stop_reason TEXT,
             correlation_id TEXT,
             created_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_inference_calls_agent
             ON inference_calls(agent_id);
         CREATE INDEX IF NOT EXISTS idx_inference_calls_created
             ON inference_calls(created_at);",
    )?;
    Ok(())
}

/// Idempotent migration: ensures the `trust_id` column exists on the `agents`
/// table and is indexed. Backfill of `trust_id` for legacy rows is handled
/// by the parent_id-walk path inside `bootstrap_legacy_hierarchy_carryover`,
/// which runs before this column is dropped of its lineage source.
///
/// Run order: called from `AgentRegistry::open` after `ensure_agent_columns`
/// and after the legacy entity-row backfill so the FK target rows exist.
/// Phase-1 public-profile columns on `entities`. Two fields, both
/// idempotent: `tagline` (one-line description) and `public` (boolean
/// flag — when 1, the workspace exposes a public profile at
/// `<host>/<slug>`; when 0, returns 404 to non-members).
fn ensure_entity_public_columns(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(entities)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "tagline") {
        conn.execute_batch("ALTER TABLE entities ADD COLUMN tagline TEXT;")?;
    }
    if !cols.iter().any(|c| c == "public") {
        conn.execute_batch("ALTER TABLE entities ADD COLUMN public INTEGER NOT NULL DEFAULT 0;")?;
    }
    Ok(())
}

/// Idempotent ALTER TABLE … RENAME COLUMN for the ae-062 phase-B
/// `entity_id → trust_id` sweep. No-op if `table` is missing, if `from`
/// is absent, or if `to` is already present.
fn rename_legacy_column(
    conn: &Connection,
    table: &str,
    from: &str,
    to: &str,
) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if cols.is_empty() {
        return Ok(());
    }
    let has_from = cols.iter().any(|c| c == from);
    let has_to = cols.iter().any(|c| c == to);
    if has_from && !has_to {
        conn.execute(
            &format!("ALTER TABLE {table} RENAME COLUMN {from} TO {to}"),
            [],
        )?;
    }
    Ok(())
}

fn ensure_agent_entity_id_column(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(agents)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    let has_legacy = cols.iter().any(|c| c == "entity_id");
    let has_canonical = cols.iter().any(|c| c == "trust_id");
    if has_legacy && !has_canonical {
        // Live-DB carryover from before the ae-062 phase-B rename.
        conn.execute("ALTER TABLE agents RENAME COLUMN entity_id TO trust_id", [])?;
    } else if !has_canonical {
        conn.execute_batch(
            "ALTER TABLE agents ADD COLUMN trust_id TEXT REFERENCES entities(id) ON DELETE SET NULL;",
        )?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_agents_entity ON agents(trust_id);")?;
    Ok(())
}

/// Phase-0 schema for the role primitive. Roles are the canonical
/// org-chart slot inside an entity; an occupant is a human, an agent, or
/// vacant. Authority is resolved by transitive closure over `role_edges`
/// (DAG — flat boards at the top are first-class).
fn bootstrap_role_tables(conn: &Connection) -> rusqlite::Result<()> {
    // ae-062 phase B: rename legacy `entity_id` → `trust_id` on live DBs.
    // CREATE TABLE IF NOT EXISTS below uses the new name, so reconcile first.
    rename_legacy_column(conn, "roles", "entity_id", "trust_id")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS roles (
             id TEXT PRIMARY KEY,
             trust_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
             title TEXT NOT NULL DEFAULT '',
             occupant_kind TEXT NOT NULL CHECK (occupant_kind IN ('human','agent','trust','vacant')),
             occupant_id TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT,
             CHECK (
                 (occupant_kind = 'vacant' AND occupant_id IS NULL)
                 OR (occupant_kind IN ('human','agent','trust') AND occupant_id IS NOT NULL)
             )
         );
         CREATE INDEX IF NOT EXISTS idx_roles_entity ON roles(trust_id);
         CREATE INDEX IF NOT EXISTS idx_roles_occupant
             ON roles(occupant_kind, occupant_id);

         CREATE TABLE IF NOT EXISTS role_edges (
             parent_role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
             child_role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
             PRIMARY KEY (parent_role_id, child_role_id),
             CHECK (parent_role_id <> child_role_id)
         );
         CREATE INDEX IF NOT EXISTS idx_role_edges_child
             ON role_edges(child_role_id);",
    )?;
    Ok(())
}

/// Add role_type + founder columns to `roles` and create the `role_grants` table.
/// Idempotent: each ALTER TABLE is guarded by a PRAGMA table_info check; the
/// table creation uses CREATE TABLE IF NOT EXISTS.
///
/// Also adds the `description_idea_id` column wired in quest 67-132 — a soft
/// pointer into the `ideas` table so a role's description can be a first-class
/// Idea (charter linking, audit trail, occupant rotation without rewriting the
/// persona). FK is intentionally NOT enforced via REFERENCES on the ALTER:
/// SQLite ALTER TABLE doesn't validate added FKs against existing rows, and
/// the orchestrator already opens both tables in the same `aeqi.db` so any
/// referential validation would belong to a write-time guard, not the schema.
fn migrate_role_types_and_grants(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(roles)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "role_type") {
        conn.execute_batch(
            "ALTER TABLE roles ADD COLUMN role_type TEXT NOT NULL DEFAULT 'operational' \
             CHECK (role_type IN ('director','advisor','operational'));",
        )?;
    }
    if !cols.iter().any(|c| c == "founder") {
        conn.execute_batch("ALTER TABLE roles ADD COLUMN founder INTEGER NOT NULL DEFAULT 0;")?;
    }
    if !cols.iter().any(|c| c == "description_idea_id") {
        conn.execute_batch("ALTER TABLE roles ADD COLUMN description_idea_id TEXT;")?;
    }
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS role_grants (
             role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
             grant   TEXT NOT NULL,
             created_at TEXT NOT NULL,
             PRIMARY KEY (role_id, grant)
         );
         CREATE INDEX IF NOT EXISTS idx_role_grants_grant ON role_grants(grant);",
    )?;
    Ok(())
}

/// Idempotent rename migration: positions → roles, position_edges → role_edges.
///
/// Detects state via sqlite_master:
///   - `roles` already exists → skip (already renamed or fresh boot ran bootstrap_role_tables).
///   - `positions` exists but `roles` doesn't → perform the rename sequence.
///   - Neither exists → no-op (fresh DB; bootstrap_role_tables creates `roles` directly).
fn ensure_role_rename(conn: &Connection) -> rusqlite::Result<()> {
    let roles_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='roles'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if roles_exists {
        return Ok(());
    }

    let positions_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='positions'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if !positions_exists {
        return Ok(());
    }

    // positions exists, roles doesn't — perform rename.
    conn.execute_batch("ALTER TABLE positions RENAME TO roles;")?;
    conn.execute_batch("ALTER TABLE position_edges RENAME TO role_edges;")?;

    // Rename columns on role_edges (SQLite >= 3.25).
    let re_cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(role_edges)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if re_cols.iter().any(|c| c == "parent_position_id") {
        conn.execute_batch(
            "ALTER TABLE role_edges RENAME COLUMN parent_position_id TO parent_role_id;",
        )?;
    }
    if re_cols.iter().any(|c| c == "child_position_id") {
        conn.execute_batch(
            "ALTER TABLE role_edges RENAME COLUMN child_position_id TO child_role_id;",
        )?;
    }

    // Drop old indexes (they referred to the old table/column names).
    conn.execute_batch(
        "DROP INDEX IF EXISTS idx_positions_entity;
         DROP INDEX IF EXISTS idx_positions_occupant;
         DROP INDEX IF EXISTS idx_position_edges_child;",
    )?;
    // Create new canonical indexes.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_roles_entity ON roles(trust_id);
         CREATE INDEX IF NOT EXISTS idx_roles_occupant ON roles(occupant_kind, occupant_id);
         CREATE INDEX IF NOT EXISTS idx_role_edges_child ON role_edges(child_role_id);",
    )?;

    Ok(())
}

/// One-shot legacy carryover. Reads what's left of the pre-Phase-4 hierarchy
/// shape (`agents.parent_id` if the column still exists, plus the
/// `agent_ancestry` closure table if it still exists) and folds the data into
/// the canonical post-Phase-4 surfaces:
///
/// - Every legacy root agent (`parent_id IS NULL`) gets an `entities` row
///   keyed on the same UUID. This keeps wire IDs stable across the upgrade.
/// - Every agent gets a position (`position.id == agent.id` for legacy rows;
///   fresh agents minted after Phase 4 get distinct UUIDs).
/// - Every legacy `agents.parent_id` edge becomes a `position_edges` row.
/// - Every agent's `trust_id` is filled in by walking the `parent_id` chain
///   up to the root.
///
/// Idempotent: safe to call on every boot, no-op once the legacy columns and
/// tables are gone.
fn legacy_hierarchy_carryover(conn: &Connection) -> rusqlite::Result<()> {
    let agent_cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(agents)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    let has_parent_id = agent_cols.iter().any(|c| c == "parent_id");
    if !has_parent_id {
        return Ok(());
    }

    // 1. Backfill entities (1 row per legacy root agent).
    conn.execute_batch(
        "INSERT INTO entities (id, type, name, slug, created_at)
         SELECT id, 'company', name, name, created_at
         FROM agents
         WHERE parent_id IS NULL
         ON CONFLICT(id) DO NOTHING;",
    )?;

    // 2. Walk `parent_id` chain to populate `agents.trust_id` for legacy
    //    rows. Uses a recursive CTE so we don't depend on `agent_ancestry`.
    conn.execute_batch(
        "WITH RECURSIVE ancestors(id, root_id) AS (
             SELECT id, id FROM agents WHERE parent_id IS NULL
             UNION ALL
             SELECT a.id, anc.root_id
             FROM agents a JOIN ancestors anc ON a.parent_id = anc.id
         )
         UPDATE agents
         SET trust_id = (SELECT root_id FROM ancestors WHERE ancestors.id = agents.id)
         WHERE trust_id IS NULL;",
    )?;

    // 3. Backfill roles: one per agent inside its entity.
    conn.execute_batch(
        "INSERT INTO roles (id, trust_id, title, occupant_kind, occupant_id, created_at)
         SELECT a.id, a.trust_id, a.name, 'agent', a.id, a.created_at
         FROM agents a
         WHERE a.trust_id IS NOT NULL
         ON CONFLICT(id) DO NOTHING;",
    )?;

    // 4. Backfill role_edges from `agents.parent_id`.
    conn.execute_batch(
        "INSERT INTO role_edges (parent_role_id, child_role_id)
         SELECT a.parent_id, a.id
         FROM agents a
         WHERE a.parent_id IS NOT NULL
           AND a.trust_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM roles WHERE id = a.parent_id)
           AND EXISTS (SELECT 1 FROM roles WHERE id = a.id)
         ON CONFLICT(parent_role_id, child_role_id) DO NOTHING;",
    )?;

    Ok(())
}

/// One-shot, idempotent retirement of the legacy hierarchy storage:
///
/// - Drop the `agent_ancestry` closure table (`position_edges` + recursive
///   CTEs replace it).
/// - Drop the trigger that auto-fills `trust_id` from `parent_id`
///   (Phase-4 spawn does this explicitly).
/// - Drop the `parent_id` column from `agents`.
/// - Drop the `agent_directors` table on legacy DBs (the runtime never
///   read from it; the canonical user→entity link lives in the platform's
///   `user_access` table).
///
/// SQLite >= 3.35 supports `ALTER TABLE ... DROP COLUMN` natively. The
/// rusqlite-bundled SQLite is 3.45+, so this is safe.
fn retire_legacy_hierarchy_storage(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS ensure_agent_entity_id;
         DROP INDEX IF EXISTS idx_agent_ancestry_ancestor;
         DROP INDEX IF EXISTS idx_agent_ancestry_descendant;
         DROP TABLE IF EXISTS agent_ancestry;
         DROP INDEX IF EXISTS idx_agent_directors_user_active;
         DROP TABLE IF EXISTS agent_directors;
         DROP INDEX IF EXISTS idx_agents_parent;",
    )?;

    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(agents)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if cols.iter().any(|c| c == "parent_id") {
        conn.execute_batch("ALTER TABLE agents DROP COLUMN parent_id;")?;
    }

    Ok(())
}

/// One-shot, idempotent migration that decouples entity UUIDs from the agent
/// UUIDs they shared in the Phase-1 backfill. For every entity whose `id`
/// equals an agent's `id`, mint a fresh entity UUID, copy the entity row to
/// the new id, re-point all FKs (`agents.trust_id`, `positions.trust_id`,
/// `entities.parent_entity_id`), then delete the old entity row. Optionally
/// fans out to the platform's `runtime_placements.agent_id` column when the
/// platform DB sits at the standard path.
///
/// Idempotent: a single SELECT short-circuits the migration once every
/// entity has a fresh, distinct UUID.
fn decouple_entity_uuids_from_agent_uuids(conn: &Connection) -> rusqlite::Result<()> {
    let collision_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entities e WHERE EXISTS (SELECT 1 FROM agents a WHERE a.id = e.id)",
        [],
        |row| row.get(0),
    )?;
    if collision_count == 0 {
        return Ok(());
    }

    info!(
        count = collision_count,
        "decoupling entity UUIDs from agent UUIDs"
    );

    let collisions: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT e.id FROM entities e WHERE EXISTS (SELECT 1 FROM agents a WHERE a.id = e.id)",
        )?;
        stmt.query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect()
    };

    let mut platform_remapping: Vec<(String, String)> = Vec::new();

    conn.execute_batch("BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON;")?;
    for old_id in &collisions {
        let new_id = uuid::Uuid::new_v4().to_string();

        // Rewrite the entity's primary key in place. SQLite permits
        // updating a PK; the deferred FK check ensures dependents (agents,
        // positions, entities.parent_entity_id) can be re-pointed inside
        // the same transaction without intermediate orphan errors.
        conn.execute(
            "UPDATE entities SET id = ?1 WHERE id = ?2",
            params![new_id, old_id],
        )?;
        conn.execute(
            "UPDATE entities SET parent_entity_id = ?1 WHERE parent_entity_id = ?2",
            params![new_id, old_id],
        )?;
        conn.execute(
            "UPDATE agents SET trust_id = ?1 WHERE trust_id = ?2",
            params![new_id, old_id],
        )?;
        conn.execute(
            "UPDATE roles SET trust_id = ?1 WHERE trust_id = ?2",
            params![new_id, old_id],
        )?;

        platform_remapping.push((old_id.clone(), new_id));
    }
    conn.execute_batch("COMMIT;")?;

    // Best-effort fan-out to the platform DB. Absent in tests; harmless if
    // `runtime_placements` doesn't exist (PRAGMA-guarded).
    if let Some(platform_path) = platform_db_path()
        && platform_path.exists()
        && let Err(e) = remap_platform_placements(&platform_path, &platform_remapping)
    {
        tracing::warn!(error = %e, "platform.db remapping failed");
    }

    Ok(())
}

fn platform_db_path() -> Option<std::path::PathBuf> {
    let path = std::path::PathBuf::from("/var/lib/aeqi/platform.db");
    if path.exists() { Some(path) } else { None }
}

fn remap_platform_placements(
    path: &std::path::Path,
    remapping: &[(String, String)],
) -> rusqlite::Result<()> {
    let conn = Connection::open(path)?;
    let has_table: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_placements'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .is_some();
    if !has_table {
        return Ok(());
    }

    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(runtime_placements)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "agent_id") {
        return Ok(());
    }

    for (old_id, new_id) in remapping {
        conn.execute(
            "UPDATE runtime_placements SET agent_id = ?1 WHERE agent_id = ?2",
            params![new_id, old_id],
        )?;
    }
    Ok(())
}

/// Idempotent migration: adds the `reply_allowed` column to
/// `channel_allowed_chats`. DEFAULT 1 preserves the legacy semantics for
/// pre-existing rows — every previously-whitelisted chat keeps its ability
/// to receive auto-replies. New "read-only" rows are written with 0.
pub(crate) fn ensure_channel_allowed_chats_columns(conn: &Connection) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(channel_allowed_chats)")?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if !cols.iter().any(|c| c == "reply_allowed") {
        conn.execute_batch(
            "ALTER TABLE channel_allowed_chats
             ADD COLUMN reply_allowed INTEGER NOT NULL DEFAULT 1;",
        )?;
    }
    Ok(())
}

fn normalize_agent_names(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE agents
         SET name = TRIM(display_name),
             display_name = NULL
         WHERE display_name IS NOT NULL
           AND TRIM(display_name) <> ''",
        [],
    )?;
    Ok(())
}

/// Lifecycle status of an agent.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Active,
    Paused,
    Retired,
}

impl std::fmt::Display for AgentStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentStatus::Active => write!(f, "active"),
            AgentStatus::Paused => write!(f, "paused"),
            AgentStatus::Retired => write!(f, "retired"),
        }
    }
}

/// One row from the `inference_calls` audit table — emitted by
/// `record_inference_call`, consumed by `recent_inference_calls`.
/// Mirrors the table schema 1:1 with the `created_at` left as a
/// pre-formatted RFC-3339 string so downstream IPC payloads can pass
/// it through untouched.
#[derive(Debug, Clone, serde::Serialize)]
pub struct InferenceCall {
    pub id: String,
    pub agent_id: String,
    pub session_id: Option<String>,
    pub model: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub cost_usd: f64,
    pub stop_reason: Option<String>,
    pub correlation_id: Option<String>,
    pub created_at: String,
}

/// A single execution record tracked in the `runs` table.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RunRecord {
    pub id: String,
    pub session_id: Option<String>,
    pub quest_id: Option<String>,
    pub agent_id: Option<String>,
    pub model: Option<String>,
    pub status: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub cost_usd: f64,
    pub tokens_used: i64,
    pub turns: i64,
    pub outcome: Option<String>,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub duration_ms: Option<i64>,
}

/// Maintains N connections to the same database, distributing lock contention
/// across them. All connections share WAL mode + busy_timeout settings.
/// Round-robins via atomic counter.
pub struct ConnectionPool {
    connections: Vec<Mutex<Connection>>,
    next: std::sync::atomic::AtomicUsize,
}

impl ConnectionPool {
    /// Open a pool of `size` connections to the same DB file.
    pub fn open(db_path: &Path, size: usize) -> Result<Self> {
        let mut connections = Vec::with_capacity(size);
        for _ in 0..size {
            let conn = Connection::open(db_path)?;
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA busy_timeout = 5000;
                 PRAGMA foreign_keys = ON;",
            )?;
            connections.push(Mutex::new(conn));
        }
        Ok(Self {
            connections,
            next: std::sync::atomic::AtomicUsize::new(0),
        })
    }

    /// Create a single-connection in-memory pool (for tests).
    pub fn in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;",
        )?;
        Ok(Self {
            connections: vec![Mutex::new(conn)],
            next: std::sync::atomic::AtomicUsize::new(0),
        })
    }

    /// Acquire a connection from the pool.
    pub async fn lock(&self) -> tokio::sync::MutexGuard<'_, Connection> {
        let idx =
            self.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed) % self.connections.len();
        self.connections[idx].lock().await
    }
}

/// SQLite-backed registry — the single source of truth for the agent tree.
///
/// Two databases:
/// - `aeqi.db` (template — portable, copy = clone agent tree): agents, events, ideas, quest_sequences
/// - `sessions.db` (journal — per-instance, ephemeral): sessions, messages, activity, runs, quests
pub struct AgentRegistry {
    db: Arc<ConnectionPool>,
    sessions_db: Arc<ConnectionPool>,
    /// Data directory containing the SQLite databases + the `files/` blob store.
    data_dir: std::path::PathBuf,
    /// When set, every newly-spawned agent gets an auto-provisioned custodial
    /// wallet. Tests / CLI tools that don't need wallets simply leave this
    /// `None` and the spawn path skips provisioning.
    wallets: Option<Arc<crate::wallet_ctx::WalletProvisioner>>,
}

impl AgentRegistry {
    /// Open or create the registry database.
    pub fn open(data_dir: &Path) -> Result<Self> {
        let db_path = data_dir.join("aeqi.db");
        let conn = Connection::open(&db_path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;",
        )?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agents (
                 id TEXT PRIMARY KEY,
                 name TEXT NOT NULL,
                 display_name TEXT,
                 model TEXT,
                 status TEXT NOT NULL DEFAULT 'active',
                 created_at TEXT NOT NULL,
                 last_active TEXT,
                 session_count INTEGER NOT NULL DEFAULT 0,
                 total_tokens INTEGER NOT NULL DEFAULT 0,
                 color TEXT,
                 avatar TEXT,
                 faces TEXT,
                 max_concurrent INTEGER NOT NULL DEFAULT 1,
                 session_id TEXT,
                 workdir TEXT,
                 budget_usd REAL,
                 execution_mode TEXT,
                 quest_prefix TEXT,
                 worker_timeout_secs INTEGER,
                 tool_deny TEXT NOT NULL DEFAULT '[]',
                 inference_cap TEXT,
                 compactor_model TEXT,
                 compactor_provider TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
             CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);",
        )?;

        // Quest sequences table (ID generation config — stays in aeqi.db).
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS quest_sequences (
                 prefix TEXT PRIMARY KEY,
                 next_seq INTEGER NOT NULL DEFAULT 1
             );",
        )?;

        // Events table — reaction rules (the fourth primitive).
        // agent_id is nullable: NULL rows are global events visible to every agent.
        // Uniqueness is enforced by a COALESCE-based index so two globals can't
        // share a name and a global and a per-agent row can't collide either.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
                 name TEXT NOT NULL,
                 pattern TEXT NOT NULL,
                 scope TEXT NOT NULL DEFAULT 'self',
                 tool_calls TEXT NOT NULL DEFAULT '[]',
                 enabled INTEGER NOT NULL DEFAULT 1,
                 cooldown_secs INTEGER NOT NULL DEFAULT 0,
                 last_fired TEXT,
                 fire_count INTEGER NOT NULL DEFAULT 0,
                 total_cost_usd REAL NOT NULL DEFAULT 0.0,
                 system INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
             CREATE INDEX IF NOT EXISTS idx_events_pattern ON events(pattern);
             CREATE INDEX IF NOT EXISTS idx_events_enabled ON events(enabled);
             CREATE UNIQUE INDEX IF NOT EXISTS idx_events_unique_name
                 ON events(COALESCE(agent_id, ''), name);",
        )?;

        // Schema heal for pre-existing DBs: ADD COLUMN is idempotent via
        // PRAGMA check so upgraded installs get the new fields without a
        // migrations framework.
        ensure_event_columns(&conn)?;
        normalize_agent_names(&conn)?;

        // Channels table — connector wiring (Telegram, Discord, Slack, WhatsApp).
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS channels (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                 kind TEXT NOT NULL,
                 config TEXT NOT NULL,
                 enabled INTEGER NOT NULL DEFAULT 1,
                 created_at TEXT NOT NULL,
                 updated_at TEXT,
                 UNIQUE(agent_id, kind)
             );
             CREATE INDEX IF NOT EXISTS idx_channels_agent ON channels(agent_id);
             CREATE INDEX IF NOT EXISTS idx_channels_kind ON channels(kind);",
        )?;

        // Per-channel chat whitelist. `chat_id` is TEXT so every transport fits:
        // Telegram i64, Discord snowflake strings, UUIDs, phone numbers.
        //
        // `reply_allowed` separates inbound and outbound: rows with
        // reply_allowed=1 (the default — preserves legacy "act on this chat"
        // behavior) let the agent's outbound tools target the JID; rows with
        // reply_allowed=0 are read-only — the gateway still ingests the
        // message, but the reply/react tools refuse to dispatch.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS channel_allowed_chats (
                 channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
                 chat_id TEXT NOT NULL,
                 added_at TEXT NOT NULL,
                 reply_allowed INTEGER NOT NULL DEFAULT 1,
                 PRIMARY KEY (channel_id, chat_id)
             );
             CREATE INDEX IF NOT EXISTS idx_channel_allowed_chats_channel
                 ON channel_allowed_chats(channel_id);",
        )?;
        ensure_channel_allowed_chats_columns(&conn)?;

        // Files table — Drive storage, scoped to an agent.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS files (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                 name TEXT NOT NULL,
                 mime TEXT NOT NULL DEFAULT 'application/octet-stream',
                 size_bytes INTEGER NOT NULL DEFAULT 0,
                 storage_path TEXT NOT NULL,
                 uploaded_by TEXT,
                 uploaded_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_files_agent ON files(agent_id);
             CREATE INDEX IF NOT EXISTS idx_files_uploaded ON files(uploaded_at);",
        )?;

        // Ideas live in the shared tags-only schema maintained by aeqi-ideas.
        SqliteIdeas::prepare_schema(&conn)?;

        // Seal the ideas invariant: (COALESCE(agent_id, ''), name) is unique.
        conn.execute_batch(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_ideas_agent_name_unique
                 ON ideas(COALESCE(agent_id, ''), name);",
        )?;

        // ── Agent-column migration (idempotent) ─────────────────────────────
        // Must run after channels table exists (backfill JOINs on it).
        ensure_agent_columns(&conn)?;

        // ── Inference accounting (idempotent) ───────────────────────────────
        // Source-of-truth `inference_calls` rows + `agents.lifetime_cost_usd`
        // running totals. Written by `record_inference_call` from the
        // queue executor every time an agent run completes.
        ensure_inference_calls_table(&conn)?;

        // ── Scope-model migration for aeqi.db (idempotent) ──────────────────
        // Normalises legacy scope values in events and ideas to the new enum.
        ensure_aeqi_db_scope_columns(&conn)?;

        // ── Entity primitive — Phase A ───────────────────────────────────────
        // Bootstrap the entities table, backfill root agents → entity rows,
        // add agents.trust_id column, backfill via ancestry walk, and install
        // the trigger that auto-fills trust_id on future INSERTs. All
        // operations are idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING /
        // PRAGMA-guarded ALTER TABLE) so re-running on every daemon start is safe.

        // 1. Create the entities table and its indexes.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS entities (
                 id TEXT PRIMARY KEY,
                 type TEXT NOT NULL DEFAULT 'company'
                     CHECK (type IN ('company')),
                 name TEXT NOT NULL,
                 slug TEXT NOT NULL,
                 parent_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
                 owner_user_id TEXT,
                 metadata TEXT NOT NULL DEFAULT '{}',
                 created_at TEXT NOT NULL,
                 updated_at TEXT
             );
             CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_slug ON entities(slug);
             CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
             CREATE INDEX IF NOT EXISTS idx_entities_parent ON entities(parent_entity_id);",
        )?;

        // 1b. Public-profile columns (tagline + public flag). Phase 1 of
        //     the public-profiles ship — Settings tab killed, hero strip
        //     on Overview owns these. Idempotent ALTER guarded by PRAGMA.
        ensure_entity_public_columns(&conn)?;

        // 2. Add agents.trust_id column (guarded by PRAGMA table_info check).
        ensure_agent_entity_id_column(&conn)?;

        // 3a. Rename legacy positions → roles (idempotent; no-op on fresh DBs).
        ensure_role_rename(&conn)?;

        // 3b. Role primitive tables (roles + role_edges) — only creates if absent.
        bootstrap_role_tables(&conn)?;

        // 3c. role_type, founder, and role_grants — added in roles-grants wave.
        migrate_role_types_and_grants(&conn)?;

        // 3d. Budget primitive — budgets + allowances + policies + events +
        //     treasury_config. Idempotent. See `budget_registry.rs` and
        //     `architecture_role_budget_canonical.md`.
        crate::budget_registry::bootstrap_budget_tables(&conn)?;

        // 3e. Cap-table primitive — authoritative launch defaults for newly
        //     minted TRUSTs. Idempotent so upgraded installs learn the table
        //     without a separate migration runner.
        bootstrap_cap_table_tables(&conn)?;

        // 3f. Views primitive — durable TRUST-local route/dashboard layouts
        //     that agents and the UI can share instead of localStorage only.
        bootstrap_entity_view_tables(&conn)?;

        // 4. Legacy carryover — only fires while `agents.parent_id` still
        //    exists on disk. Backfills entities, agents.trust_id,
        //    roles, and role_edges from the legacy parent_id chain.
        legacy_hierarchy_carryover(&conn)?;

        // 5. Retire the legacy storage: drop `agent_ancestry`, drop the
        //    parent_id-driven trigger, drop `agent_directors`, drop the
        //    `agents.parent_id` column. Idempotent.
        retire_legacy_hierarchy_storage(&conn)?;

        // 6. Decouple entity UUIDs from the agent UUIDs they shared in the
        //    Phase-1 backfill. Idempotent — short-circuits when no
        //    `entity.id == an_agent.id` collisions remain.
        decouple_entity_uuids_from_agent_uuids(&conn)?;

        drop(conn);
        let pool = ConnectionPool::open(&db_path, 4)?;
        info!(path = %db_path.display(), pool_size = 4, "aeqi.db opened");

        // ── sessions.db — journal database (per-instance, ephemeral) ──
        let sessions_path = data_dir.join("sessions.db");
        let sconn = Connection::open(&sessions_path)?;
        sconn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;",
        )?;

        // Quests table — phase-3 canonical shape. Editorial fields live on
        // the linked idea (FK `idea_id`); the row carries lifecycle only.
        //
        // Fresh DBs land here directly. Legacy DBs (with `subject` /
        // `description` / `acceptance_criteria` / `labels` / `idea_ids`)
        // are rebuilt to this shape by `cleanup_legacy_quest_columns`
        // below, after the backfill has populated `idea_id` on every row.
        sconn.execute_batch(
            "CREATE TABLE IF NOT EXISTS quests (
                 id TEXT PRIMARY KEY,
                 idea_id TEXT NOT NULL,
                 status TEXT NOT NULL DEFAULT 'todo',
                 priority TEXT NOT NULL DEFAULT 'normal',
                 agent_id TEXT,
                 scope TEXT NOT NULL DEFAULT 'self',
                 retry_count INTEGER NOT NULL DEFAULT 0,
                 checkpoints TEXT NOT NULL DEFAULT '[]',
                 metadata TEXT NOT NULL DEFAULT '{}',
                 depends_on TEXT NOT NULL DEFAULT '[]',
                 outcome TEXT,
                 worktree_branch TEXT,
                 worktree_path TEXT,
                 created_at TEXT NOT NULL,
                 updated_at TEXT,
                 closed_at TEXT,
                 closed_reason TEXT,
                 creator_session_id TEXT,
                 assignee TEXT,
                 due_at INTEGER,
                 kind TEXT NOT NULL DEFAULT 'task'
             );
             CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
             CREATE INDEX IF NOT EXISTS idx_quests_agent ON quests(agent_id);
             CREATE INDEX IF NOT EXISTS idx_quests_created ON quests(created_at);",
        )?;
        // Backfill `kind` for existing DBs that pre-date the kind taxonomy
        // (idea `architecture/kind-taxonomy-and-the-structural-vs-categorical-rule`).
        //
        // ORDER MATTERS: `CREATE TABLE IF NOT EXISTS` above is a no-op
        // against existing DBs, so the `kind` column from the schema
        // literal is NOT applied to live tables — we must ALTER first
        // and create the index AFTER. The original Phase 1.1 commit
        // (8827ef24) placed `idx_quests_kind` inside the CREATE TABLE
        // batch, which crash-looped every existing-DB host on startup
        // with `no such column: kind in CREATE INDEX...`. SQLite has no
        // `ALTER TABLE ADD COLUMN IF NOT EXISTS`, so the existence check
        // happens via PRAGMA table_info.
        let has_kind: bool = sconn
            .prepare("PRAGMA table_info(quests)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .any(|c| c == "kind");
        if !has_kind {
            sconn.execute_batch(
                "ALTER TABLE quests ADD COLUMN kind TEXT NOT NULL DEFAULT 'task';",
            )?;
        }
        // Idempotent — works whether the column was just added (existing
        // DB) or already existed from the CREATE TABLE literal (fresh DB).
        sconn.execute_batch("CREATE INDEX IF NOT EXISTS idx_quests_kind ON quests(kind);")?;
        // The `idx_quests_idea` index lives in `ensure_quest_idea_id_column`
        // because legacy DBs reach this point with the table already in
        // place but the `idea_id` column not yet added — a CREATE INDEX
        // referencing a missing column would crash before the column-add
        // migration runs three lines down. Fresh DBs land here with
        // `idea_id NOT NULL` already, and the column-add helper short-
        // circuits but still creates the index.

        // ── Scope-model migration (idempotent) ──────────────────────────────
        // ADD COLUMN is guarded by PRAGMA table_info; UPDATE is guarded by
        // the sentinel "WHERE scope = 'self' AND agent_id IS NULL" so it only
        // touches rows that haven't been migrated yet.
        ensure_scope_columns(&sconn)?;

        // ── Quest ↔ Idea FK column (idempotent) ─────────────────────────────
        // Phase 1 leftover: legacy DBs land here with the column missing.
        // Fresh DBs already have it from the CREATE TABLE above.
        ensure_quest_idea_id_column(&sconn)?;

        // ── Quest ↔ Idea backfill (WS-1c, idempotent) ──────────────────────
        // Mints (or reuses) an idea row for every quest that still has a NULL
        // `idea_id`. No-op once every quest is linked. Cross-DB, non-atomic;
        // the (agent_id, name) unique index makes a crashed half-write
        // recover correctly on the next boot.
        //
        // The aeqi.db `conn` was already moved into `pool`, so a separate
        // short-lived connection covers the backfill window.
        {
            let backfill_idea_conn = Connection::open(&db_path)?;
            backfill_idea_conn
                .execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;
            backfill_quest_idea_ids(&backfill_idea_conn, &sconn)?;
        }

        // ── Phase-3 cleanup (WS-8a, idempotent, irreversible per-row) ──────
        // Drops the legacy editorial columns and flips `idea_id` to NOT NULL.
        // No-op on fresh DBs; one-shot on legacy DBs once the backfill above
        // confirms every row has a non-null `idea_id`. SQLite < 3.35 lacks
        // ALTER TABLE DROP COLUMN, so the rebuild is the safe lowest-common-
        // denominator path.
        cleanup_legacy_quest_columns(&sconn)?;

        // ── Polymorphic assignee column (idempotent) ────────────────────────
        // `agent:<id>` | `user:<id>` pointers; distinct from `agent_id`
        // which anchors the visibility tree. Runs after the legacy
        // cleanup rebuild so the column survives the table rebuild on
        // upgrade-path DBs; fresh DBs already carry it from CREATE
        // TABLE and this is a short-circuit no-op.
        ensure_quest_assignee_column(&sconn)?;

        // ── Quest 67-213 phase-1: role-bound assignee fanout index ──────────
        // Partial index on `assignee LIKE 'role:%'` for the role fanout
        // query path. Idempotent. Co-located with the assignee column
        // migration so the index is guaranteed to exist on every DB that
        // accepts the new `role:<id>` write shape.
        ensure_quest_assignee_role_index(&sconn)?;

        // ── Phase-2 due-date column (idempotent) ────────────────────────────
        // `due_at INTEGER` (Unix-second timestamp; nullable). Linear-style
        // soft deadline. Fresh DBs already carry it from CREATE TABLE; this
        // is the catch-up path for upgraded ones, registered after the
        // legacy-cleanup table rebuild so the column survives that dance.
        ensure_quest_due_at_column(&sconn)?;

        // ── v5.2 status rename (idempotent) ────────────────────────────────
        // Rewrites the two legacy status strings to the canonical 5-status
        // Linear-style vocabulary in place. UPDATE … WHERE clauses make
        // both calls cheap no-ops once the rows have been migrated.
        sconn.execute(
            "UPDATE quests SET status = 'todo' WHERE status = 'pending'",
            [],
        )?;
        sconn.execute(
            "UPDATE quests SET status = 'backlog' WHERE status = 'blocked'",
            [],
        )?;

        // Activity table (audit log, cost tracking — in sessions.db).
        crate::activity_log::ActivityLog::create_tables(&sconn)?;

        // Session/conversation tables (unified session store — in sessions.db).
        crate::session_store::SessionStore::create_tables(&sconn)?;

        // Runs table — execution tracking (in sessions.db).
        sconn.execute_batch(
            "CREATE TABLE IF NOT EXISTS runs (
                 id TEXT PRIMARY KEY,
                 session_id TEXT,
                 quest_id TEXT,
                 agent_id TEXT,
                 model TEXT,
                 status TEXT NOT NULL DEFAULT 'created',
                 started_at TEXT,
                 finished_at TEXT,
                 cost_usd REAL NOT NULL DEFAULT 0,
                 tokens_used INTEGER NOT NULL DEFAULT 0,
                 turns INTEGER NOT NULL DEFAULT 0,
                 outcome TEXT,
                 prompt_tokens INTEGER NOT NULL DEFAULT 0,
                 completion_tokens INTEGER NOT NULL DEFAULT 0,
                 duration_ms INTEGER
             );
             CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
             CREATE INDEX IF NOT EXISTS idx_runs_quest ON runs(quest_id);
             CREATE INDEX IF NOT EXISTS idx_runs_agent ON runs(agent_id);
             CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);",
        )?;

        // Channel sessions table — maps channel_key (e.g. "telegram:agent_id:chat_id")
        // to a persistent session_id for session-based channel routing.
        sconn.execute_batch(
            "CREATE TABLE IF NOT EXISTS channel_sessions (
                 channel_key TEXT PRIMARY KEY,
                 session_id TEXT NOT NULL,
                 agent_id TEXT NOT NULL,
                 created_at TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_channel_sessions_agent ON channel_sessions(agent_id);",
        )?;

        drop(sconn);
        let sessions_pool = ConnectionPool::open(&sessions_path, 4)?;
        info!(path = %sessions_path.display(), pool_size = 4, "sessions.db opened");

        Ok(Self {
            db: Arc::new(pool),
            sessions_db: Arc::new(sessions_pool),
            data_dir: data_dir.to_path_buf(),
            wallets: None,
        })
    }

    /// Path where per-agent file blobs are stored (`{data_dir}/files/`).
    /// The directory is not created here — the file-storage module ensures it
    /// on first write.
    pub fn files_dir(&self) -> std::path::PathBuf {
        self.data_dir.join("files")
    }

    /// Attach a wallet provisioner so every newly-spawned agent gets an
    /// auto-provisioned custodial wallet. Builder-style — meant to be chained
    /// onto `AgentRegistry::open(...)`. When unset, spawn() skips wallet
    /// provisioning (which keeps tests, CLI tools, and preset seeders quiet).
    pub fn with_wallets(mut self, wallets: Arc<crate::wallet_ctx::WalletProvisioner>) -> Self {
        self.wallets = Some(wallets);
        self
    }

    // -----------------------------------------------------------------------
    // Core CRUD
    // -----------------------------------------------------------------------

    /// Spawn a new agent.
    ///
    /// - `parent_agent_id = None` → mint a fresh entity, a fresh agent UUID,
    ///   and a fresh role UUID. Three distinct IDs.
    /// - `parent_agent_id = Some(pid)` → reuse the parent's entity, mint a
    ///   fresh agent UUID, mint a fresh role UUID, and add an edge from
    ///   the parent's primary role to the new role. The parent's
    ///   primary role is the (single) role this entity has where
    ///   `occupant_id == parent_agent_id`.
    pub async fn spawn(
        &self,
        name: &str,
        parent_agent_id: Option<&str>,
        model: Option<&str>,
    ) -> Result<Agent> {
        self.spawn_with_entity_id(name, parent_agent_id, model, None, None)
            .await
    }

    /// Spawn variant that lets the caller supply the `trust_id` for the
    /// fresh-root case. Used by the platform-driven `/start/launch` path:
    /// the platform mints the canonical UUID and passes it through. No-op
    /// when `parent_agent_id` is `Some` (child spawns always reuse the
    /// parent's trust_id).
    ///
    /// `entity_slug_override` decouples the `entities.slug` column from the
    /// root agent's `canonical_name`. Blueprints carry their own brand slug
    /// (`blueprint.slug` — e.g. `meridian-supply`) which is the right value
    /// for the entity slug; the persona name (e.g. `Maya Reyes`) is an
    /// agent-level identifier and would create confusing UNIQUE collisions
    /// across deploys when used as the entity slug. Defaults to the
    /// canonical name (matches pre-refactor behaviour) when `None`.
    pub async fn spawn_with_entity_id(
        &self,
        name: &str,
        parent_agent_id: Option<&str>,
        model: Option<&str>,
        entity_id_override: Option<&str>,
        entity_slug_override: Option<&str>,
    ) -> Result<Agent> {
        let agent_id = uuid::Uuid::new_v4().to_string();
        let role_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let session_id = uuid::Uuid::new_v4().to_string();
        let canonical_name = name.trim().to_string();

        let db = self.db.lock().await;

        // Resolve entity (and parent role when relevant). Three distinct
        // IDs for fresh root spawns; reused entity for child spawns.
        let (trust_id, parent_role_id): (String, Option<String>) =
            if let Some(pid) = parent_agent_id {
                let parent_entity_id: String = db
                    .query_row(
                        "SELECT trust_id FROM agents WHERE id = ?1",
                        params![pid],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .optional()?
                    .flatten()
                    .ok_or_else(|| {
                        anyhow::anyhow!("parent agent '{pid}' has no trust_id; cannot attach child")
                    })?;

                // Look up the parent's primary role inside this entity.
                let parent_pos: Option<String> = db
                    .query_row(
                        "SELECT id FROM roles
                         WHERE trust_id = ?1 AND occupant_kind = 'agent' AND occupant_id = ?2
                         ORDER BY created_at ASC
                         LIMIT 1",
                        params![parent_entity_id, pid],
                        |row| row.get(0),
                    )
                    .optional()?;

                (parent_entity_id, parent_pos)
            } else {
                let fresh_entity_id = entity_id_override
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
                // When the caller supplied an explicit entity_id_override, skip the
                // INSERT if that entity already exists — the agent is being attached
                // to an existing Company, not creating a new one.  When no override
                // was given (fresh root spawn, e.g. signup flow) always insert.
                let already_exists = entity_id_override.is_some() && {
                    let count: i64 = db
                        .query_row(
                            "SELECT COUNT(*) FROM entities WHERE id = ?1",
                            params![fresh_entity_id],
                            |row| row.get(0),
                        )
                        .unwrap_or(0);
                    count > 0
                };
                if !already_exists {
                    // Decouple entities.slug from the root agent's canonical_name.
                    // When the caller supplied a slug override (the canonical
                    // path: blueprints carry their own brand slug), use it. The
                    // entity name still mirrors the canonical_name so existing
                    // platform code that reads it stays unaffected.
                    let entity_slug = entity_slug_override
                        .map(str::to_string)
                        .unwrap_or_else(|| canonical_name.clone());
                    db.execute(
                        "INSERT INTO entities (id, type, name, slug, metadata, created_at)
                         VALUES (?1, 'company', ?2, ?3, '{}', ?4)",
                        params![
                            fresh_entity_id,
                            canonical_name,
                            entity_slug,
                            now.to_rfc3339(),
                        ],
                    )?;
                }
                (fresh_entity_id, None)
            };

        let agent = Agent {
            id: agent_id.clone(),
            name: canonical_name.clone(),
            trust_id: Some(trust_id.clone()),
            model: model.map(|s| s.to_string()),
            status: AgentStatus::Active,
            created_at: now,
            last_active: None,
            session_count: 0,
            total_tokens: 0,
            lifetime_cost_usd: 0.0,
            color: None,
            avatar: None,
            faces: None,
            max_concurrent: 1,
            session_id: Some(session_id.clone()),
            workdir: None,
            budget_usd: None,
            execution_mode: None,
            quest_prefix: None,
            worker_timeout_secs: None,
            tool_deny: Vec::new(),
            can_self_delegate: false,
            can_ask_director: false,
            inference_cap: None,
            compactor_model: None,
            compactor_provider: None,
        };

        db.execute(
            "INSERT INTO agents (id, name, display_name, model, status, created_at, session_id, trust_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                agent.id,
                agent.name,
                Option::<String>::None,
                agent.model,
                agent.status.to_string(),
                agent.created_at.to_rfc3339(),
                session_id,
                trust_id,
            ],
        )?;

        // Mint the role and (when this is a child spawn) the DAG edge.
        db.execute(
            "INSERT INTO roles (id, trust_id, title, occupant_kind, occupant_id, created_at)
             VALUES (?1, ?2, ?3, 'agent', ?4, ?5)",
            params![
                role_id,
                trust_id,
                canonical_name,
                agent.id,
                now.to_rfc3339(),
            ],
        )?;
        if let Some(parent_pos) = parent_role_id.as_deref() {
            db.execute(
                "INSERT INTO role_edges (parent_role_id, child_role_id)
                 VALUES (?1, ?2)
                 ON CONFLICT(parent_role_id, child_role_id) DO NOTHING",
                params![parent_pos, role_id],
            )?;
        }

        info!(
            agent_id = %agent.id,
            trust_id = %trust_id,
            role_id = %role_id,
            parent_agent_id = ?parent_agent_id,
            "agent spawned"
        );
        drop(db);

        // Lifecycle events are global (seeded once at daemon boot). Schedule
        // events however must be per-agent — `EventHandlerStore::create`
        // rejects global schedule:* rows because a global cron has no agent
        // to fire against. Seed the standard daily-digest + weekly-consolidate
        // schedules here so every freshly-spawned agent gets a vanilla
        // reflection cadence out of the box. Idempotent — the
        // `idx_events_unique_name` index makes duplicate inserts no-ops.
        if let Err(e) = self
            .install_default_scheduled_events(&agent.id, &session_id)
            .await
        {
            tracing::warn!(
                agent_id = %agent.id,
                error = %e,
                "failed to install default scheduled events; agent still spawned"
            );
        }

        // Auto-provision a custodial wallet for this agent when wallets are
        // attached. Idempotent (safe across restarts and re-spawns). Errors
        // are logged but do NOT roll back the agent — wallet provisioning
        // can be retried via Phase 5+ endpoints.
        if let Some(ref wallets) = self.wallets {
            match aeqi_wallets::ensure_agent_custodial_wallet(
                &wallets.db,
                wallets.kek.as_ref(),
                &agent.id,
            )
            .await
            {
                Ok(Some(w)) => tracing::info!(
                    agent_id = %agent.id,
                    address = %w.address,
                    "provisioned custodial wallet for new agent"
                ),
                Ok(None) => tracing::debug!(
                    agent_id = %agent.id,
                    "agent already has wallet (idempotent re-spawn)"
                ),
                Err(e) => tracing::error!(
                    agent_id = %agent.id,
                    error = %e,
                    "agent wallet provisioning failed; agent spawned without wallet"
                ),
            }
        }

        Ok(agent)
    }

    /// Install the two standard per-agent schedule events: `daily-digest` and
    /// `weekly-consolidate`. Both spawn a compactor session from a meta-idea
    /// template; operators can override by calling
    /// `events(action='update', event_id=..., …)` after spawn.
    ///
    /// Idempotent: relies on the UNIQUE (COALESCE(agent_id,''), name) index
    /// on `events`. Calling twice for the same agent is a no-op.
    pub async fn install_default_scheduled_events(
        &self,
        agent_id: &str,
        session_id: &str,
    ) -> Result<()> {
        let seeds: [(&str, &str, &str, &str, &str); 2] = [
            (
                "daily-digest",
                "schedule:0 0 * * *",
                "meta:daily-reflector-template",
                "Agent={agent_id} — review last 24h",
                session_id,
            ),
            (
                "weekly-consolidate",
                "schedule:0 0 * * 0",
                "meta:weekly-consolidator-template",
                "Agent={agent_id} — review last 7d",
                session_id,
            ),
        ];

        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        for (name, pattern, instructions_idea, seed_content, parent_session) in seeds {
            // Event-chain (Round 6): spawn a tool-less compactor sub-agent that
            // emits a JSON array of reflection / consolidation ideas, then pipe
            // that JSON into ideas.store_many for persistence. Without the
            // store_many step the sub-agent output evaporates because the
            // session.spawn tools vector is empty.
            let authored_by = match name {
                "daily-digest" => "daily-reflector",
                "weekly-consolidate" => "weekly-consolidator",
                _ => "reflector",
            };
            let tag_suffix = match name {
                "daily-digest" => {
                    serde_json::json!([format!("source:agent:{}", agent_id), "reflection:daily"])
                }
                "weekly-consolidate" => {
                    serde_json::json!([format!("source:agent:{}", agent_id), "reflection:weekly"])
                }
                _ => serde_json::json!([]),
            };
            let tool_calls = serde_json::json!([
                {
                    "tool": "session.spawn",
                    "args": {
                        "kind": "compactor",
                        "instructions_idea": instructions_idea,
                        "seed_content": seed_content,
                        "parent_session": parent_session,
                    }
                },
                {
                    "tool": "ideas.store_many",
                    "args": {
                        "from_json": "{last_tool_result}",
                        "authored_by": format!("{}:{}", authored_by, agent_id),
                        "tag_suffix": tag_suffix,
                    }
                }
            ]);
            let tool_calls_json =
                serde_json::to_string(&tool_calls).unwrap_or_else(|_| "[]".to_string());
            let event_id = uuid::Uuid::new_v4().to_string();
            db.execute(
                "INSERT OR IGNORE INTO events (
                     id, agent_id, name, pattern, scope, tool_calls,
                     enabled, cooldown_secs, system, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, 0, 0, ?7)",
                params![
                    event_id,
                    agent_id,
                    name,
                    pattern,
                    Scope::SelfScope.as_str(),
                    tool_calls_json,
                    now,
                ],
            )?;
        }
        Ok(())
    }

    /// Get a specific agent by UUID.
    pub async fn get(&self, id: &str) -> Result<Option<Agent>> {
        let db = self.db.lock().await;
        let agent = db
            .query_row("SELECT * FROM agents WHERE id = ?1", params![id], |row| {
                Ok(row_to_agent(row))
            })
            .optional()?;
        Ok(agent)
    }

    /// Get agents by name (multiple can share a name).
    pub async fn get_by_name(&self, name: &str) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt =
            db.prepare("SELECT * FROM agents WHERE name = ?1 ORDER BY created_at DESC")?;
        let agents = stmt
            .query_map(params![name], |row| Ok(row_to_agent(row)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    /// Get the first active agent with this name.
    pub async fn get_active_by_name(&self, name: &str) -> Result<Option<Agent>> {
        let db = self.db.lock().await;
        let agent = db
            .query_row(
                "SELECT * FROM agents
                 WHERE status = 'active'
                   AND name = ?1 COLLATE NOCASE
                 ORDER BY created_at DESC
                 LIMIT 1",
                params![name],
                |row| Ok(row_to_agent(row)),
            )
            .optional()?;
        Ok(agent)
    }

    /// Resolve an agent by hint — UUID first, then the single visible name.
    pub async fn resolve_by_hint(&self, hint: &str) -> Result<Option<Agent>> {
        if let Some(agent) = self.get(hint).await? {
            return Ok(Some(agent));
        }
        self.get_active_by_name(hint).await
    }

    /// Return the entity's default agent — the active agent whose role has
    /// no incoming edges in the role DAG. Returns `None` when no agent
    /// occupies a topmost role.
    pub async fn get_default_agent(&self) -> Result<Option<Agent>> {
        let db = self.db.lock().await;
        db.query_row(
            "SELECT a.* FROM agents a
             JOIN roles r ON r.occupant_kind = 'agent' AND r.occupant_id = a.id
             WHERE a.status = 'active'
               AND r.id NOT IN (SELECT child_role_id FROM role_edges)
             ORDER BY a.created_at ASC
             LIMIT 1",
            [],
            |row| Ok(row_to_agent(row)),
        )
        .optional()
        .map_err(Into::into)
    }

    /// List all agents, optionally filtered by status. Optional `trust_id`
    /// restricts the result to a single entity's agent set.
    pub async fn list(
        &self,
        trust_id: Option<&str>,
        status: Option<AgentStatus>,
    ) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut sql = "SELECT * FROM agents WHERE 1=1".to_string();
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(eid) = trust_id {
            sql.push_str(" AND trust_id = ?");
            params_vec.push(Box::new(eid.to_string()));
        }
        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            params_vec.push(Box::new(s.to_string()));
        }
        sql.push_str(" ORDER BY created_at DESC");

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = db.prepare(&sql)?;
        let agents = stmt
            .query_map(params_refs.as_slice(), |row| Ok(row_to_agent(row)))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(agents)
    }

    /// List all active agents.
    pub async fn list_active(&self) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM agents WHERE status = 'active' \
             ORDER BY COALESCE(last_active, created_at) DESC",
        )?;
        let agents = stmt
            .query_map([], |row| Ok(row_to_agent(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(agents)
    }

    // -----------------------------------------------------------------------
    // Tree operations
    // -----------------------------------------------------------------------

    /// Direct reports of `agent_id` resolved through the role DAG.
    pub async fn get_children(&self, agent_id: &str) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT DISTINCT a.* FROM agents a
             JOIN roles cr ON cr.occupant_kind = 'agent' AND cr.occupant_id = a.id
             JOIN role_edges e ON e.child_role_id = cr.id
             JOIN roles pr ON pr.id = e.parent_role_id
             WHERE pr.occupant_kind = 'agent'
               AND pr.occupant_id = ?1
               AND a.status = 'active'
             ORDER BY a.name ASC",
        )?;
        let agents = stmt
            .query_map(params![agent_id], |row| Ok(row_to_agent(row)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    /// Walk the position DAG upward from the agent's position(s) and return
    /// every distinct agent on the way up, starting with `agent_id` itself.
    /// Order: nearest ancestor first, root last. Cycle-safe (recursive CTE
    /// over a DAG).
    pub async fn get_ancestors(&self, agent_id: &str) -> Result<Vec<Agent>> {
        let ids = self.get_ancestor_ids(agent_id).await?;
        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(agent) = self.get(&id).await? {
                out.push(agent);
            }
        }
        Ok(out)
    }

    /// Ancestor agent IDs starting with `agent_id` itself, walking the
    /// role DAG upward. Topological order: nearest first, root last.
    pub async fn get_ancestor_ids(&self, agent_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "WITH RECURSIVE ancestor_roles(id, depth) AS (
                 SELECT r.id, 0 FROM roles r
                 WHERE r.occupant_kind = 'agent' AND r.occupant_id = ?1
                 UNION
                 SELECT e.parent_role_id, ar.depth + 1
                 FROM role_edges e
                 JOIN ancestor_roles ar ON e.child_role_id = ar.id
             )
             SELECT DISTINCT r.occupant_id, MIN(ar.depth) AS depth
             FROM ancestor_roles ar
             JOIN roles r ON r.id = ar.id
             WHERE r.occupant_kind = 'agent' AND r.occupant_id IS NOT NULL
             GROUP BY r.occupant_id
             ORDER BY depth ASC",
        )?;
        let ids = stmt
            .query_map(params![agent_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// All descendant agent IDs (excluding `agent_id`). Walks the role
    /// DAG downward from the agent's role(s).
    pub async fn list_descendants(&self, agent_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "WITH RECURSIVE descendant_roles(id) AS (
                 SELECT r.id FROM roles r
                 WHERE r.occupant_kind = 'agent' AND r.occupant_id = ?1
                 UNION
                 SELECT e.child_role_id
                 FROM role_edges e
                 JOIN descendant_roles dr ON e.parent_role_id = dr.id
             )
             SELECT DISTINCT r.occupant_id FROM descendant_roles dr
             JOIN roles r ON r.id = dr.id
             WHERE r.occupant_kind = 'agent'
               AND r.occupant_id IS NOT NULL
               AND r.occupant_id <> ?1",
        )?;
        let ids = stmt
            .query_map(params![agent_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Sibling agent IDs — agents whose roles share at least one parent
    /// role with `agent_id`'s role(s), excluding `agent_id` itself.
    /// Returns an empty vec when `agent_id` has no role or no parents.
    pub async fn list_siblings(&self, agent_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT DISTINCT sr.occupant_id FROM roles sr
             WHERE sr.occupant_kind = 'agent'
               AND sr.occupant_id IS NOT NULL
               AND sr.occupant_id <> ?1
               AND sr.id IN (
                   SELECT e2.child_role_id FROM role_edges e2
                   WHERE e2.parent_role_id IN (
                       SELECT e1.parent_role_id FROM role_edges e1
                       JOIN roles r ON r.id = e1.child_role_id
                       WHERE r.occupant_kind = 'agent' AND r.occupant_id = ?1
                   )
               )",
        )?;
        let ids = stmt
            .query_map(params![agent_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Self plus every descendant agent (full subtree). Walks the role
    /// DAG downward from the agent's role(s).
    pub async fn get_subtree(&self, agent_id: &str) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "WITH RECURSIVE descendant_roles(id) AS (
                 SELECT r.id FROM roles r
                 WHERE r.occupant_kind = 'agent' AND r.occupant_id = ?1
                 UNION
                 SELECT e.child_role_id
                 FROM role_edges e
                 JOIN descendant_roles dr ON e.parent_role_id = dr.id
             )
             SELECT DISTINCT a.* FROM agents a
             JOIN descendant_roles dr
               ON dr.id IN (
                   SELECT r.id FROM roles r
                   WHERE r.occupant_kind = 'agent' AND r.occupant_id = a.id
               )
             ORDER BY a.created_at ASC",
        )?;
        let agents = stmt
            .query_map(params![agent_id], |row| Ok(row_to_agent(row)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    /// Ideas visible to an agent. Visibility is anchored to concrete agent IDs,
    /// not role titles or role classes: two agents occupying roles with the same
    /// title do not inherit each other's ideas. The current list surface exposes
    /// self + any descendant + any global (`agent_id IS NULL`).
    ///
    /// Parents do NOT flow down (covered by the descendant leg from the parent's
    /// own view), so a child never sees private ideas of its parent.
    pub async fn list_ideas_visible_to(
        &self,
        agent_id: &str,
    ) -> Result<Vec<aeqi_core::traits::Idea>> {
        // Tuple of (id, name, content, agent_id, session_id, created_at, scope, ...).
        // Local to this method so the row shape doesn't leak into the module.
        //
        // NOTE: The `inheritance`, `tool_allow`, `tool_deny` columns were
        // dropped in the v3 ideas-schema migration and are absent from the
        // v10 baseline `initial_schema`. Selecting them here would 500 on
        // fresh DBs with "no such column: inheritance" — legacy DBs that
        // still carry the columns physically are harmless but must not be
        // relied on. The `Idea` struct fields of the same name are filled
        // with defaults below.
        type IdeaRow = (
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            String,
            Option<String>,
            Option<String>,
            String,
            Option<String>,
        );

        let db = self.db.lock().await;
        let rows: Vec<IdeaRow> = {
            let mut stmt = db.prepare(
                "SELECT id, name, content, agent_id, session_id, created_at, scope, \
                        parent_idea_id, properties, kind, file_id
                 FROM ideas
                 WHERE agent_id IS NULL
                    OR agent_id = ?1
                    OR agent_id IN (
                        WITH RECURSIVE descendant_roles(id) AS (
                            SELECT r.id FROM roles r
                            WHERE r.occupant_kind = 'agent' AND r.occupant_id = ?1
                            UNION
                            SELECT e.child_role_id
                            FROM role_edges e
                            JOIN descendant_roles dr ON e.parent_role_id = dr.id
                        )
                        SELECT DISTINCT r.occupant_id FROM descendant_roles dr
                        JOIN roles r ON r.id = dr.id
                        WHERE r.occupant_kind = 'agent' AND r.occupant_id IS NOT NULL
                    )
                 ORDER BY created_at DESC",
            )?;
            stmt.query_map(params![agent_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)
                        .unwrap_or_else(|_| "self".to_string()),
                    row.get::<_, Option<String>>(7).ok().flatten(),
                    row.get::<_, Option<String>>(8).ok().flatten(),
                    row.get::<_, String>(9)
                        .unwrap_or_else(|_| "note".to_string()),
                    row.get::<_, Option<String>>(10).ok().flatten(),
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
        };

        // Hydrate tags per idea (secondary query; tag set tends to be tiny).
        let mut out = Vec::with_capacity(rows.len());
        for (
            id,
            name,
            content,
            aid,
            session_id,
            created_at,
            scope_str,
            parent_idea_id,
            props_json,
            kind,
            file_id,
        ) in rows
        {
            let properties: Option<serde_json::Value> = props_json
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok());
            let tags: Vec<String> = {
                let mut tag_stmt =
                    db.prepare("SELECT tag FROM idea_tags WHERE idea_id = ?1 ORDER BY tag")?;
                tag_stmt
                    .query_map(params![id], |r| r.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .collect()
            };
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at)
                .map(|d| d.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now());
            let scope = scope_str.parse().unwrap_or_else(|_| {
                if aid.is_none() {
                    Scope::Global
                } else {
                    Scope::SelfScope
                }
            });
            out.push(aeqi_core::traits::Idea {
                id,
                name,
                content,
                tags,
                agent_id: aid,
                session_id,
                created_at,
                score: 1.0,
                scope,
                inheritance: "self".to_string(),
                tool_allow: Vec::new(),
                tool_deny: Vec::new(),
                parent_idea_id,
                properties,
                kind,
                file_id,
            });
        }
        Ok(out)
    }

    /// Reparent an agent in the position DAG. Disconnects every incoming
    /// edge to the agent's positions and (when `new_parent_agent_id` is
    /// provided) wires a fresh edge from the new parent's primary position.
    pub async fn move_agent(
        &self,
        agent_id: &str,
        new_parent_agent_id: Option<&str>,
    ) -> Result<()> {
        // Cycle check.
        if let Some(pid) = new_parent_agent_id {
            let subtree = self.get_subtree(agent_id).await?;
            if subtree.iter().any(|a| a.id == pid) {
                anyhow::bail!("cannot move agent under its own subtree (would create cycle)");
            }
        }

        let db = self.db.lock().await;

        let agent_role_ids: Vec<String> = {
            let mut stmt = db.prepare(
                "SELECT id FROM roles WHERE occupant_kind = 'agent' AND occupant_id = ?1",
            )?;
            stmt.query_map(params![agent_id], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect()
        };
        if agent_role_ids.is_empty() {
            anyhow::bail!("agent '{agent_id}' has no role to reparent");
        }

        // Disconnect every incoming edge to this agent's roles.
        let placeholders = std::iter::repeat_n("?", agent_role_ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("DELETE FROM role_edges WHERE child_role_id IN ({placeholders})");
        let params_vec: Vec<&dyn rusqlite::ToSql> = agent_role_ids
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();
        db.execute(&sql, params_vec.as_slice())?;

        if let Some(pid) = new_parent_agent_id {
            // Resolve the new parent's primary role (must be in the same
            // entity for the edge to make sense).
            let parent_role: Option<String> = db
                .query_row(
                    "SELECT id FROM roles
                     WHERE occupant_kind = 'agent' AND occupant_id = ?1
                     ORDER BY created_at ASC
                     LIMIT 1",
                    params![pid],
                    |row| row.get(0),
                )
                .optional()?;
            let Some(parent_role) = parent_role else {
                anyhow::bail!("new parent '{pid}' has no role");
            };

            for child_role in &agent_role_ids {
                db.execute(
                    "INSERT INTO role_edges (parent_role_id, child_role_id)
                     VALUES (?1, ?2)
                     ON CONFLICT(parent_role_id, child_role_id) DO NOTHING",
                    params![parent_role, child_role],
                )?;
            }
        }

        info!(
            agent_id = %agent_id,
            new_parent_agent_id = ?new_parent_agent_id,
            "agent reparented"
        );
        Ok(())
    }

    /// Find the default agent to talk to — the entity's default, or a
    /// named child.
    pub async fn default_agent(&self, hint: Option<&str>) -> Result<Option<Agent>> {
        if let Some(h) = hint
            && let Some(agent) = self.resolve_by_hint(h).await?
        {
            return Ok(Some(agent));
        }
        self.get_default_agent().await
    }

    // -----------------------------------------------------------------------
    // Stats & lifecycle
    // -----------------------------------------------------------------------

    /// Record a session for this agent.
    pub async fn record_session(&self, id: &str, tokens: u64) -> Result<()> {
        let db = self.db.lock().await;
        db.execute(
            "UPDATE agents SET
                session_count = session_count + 1,
                last_active = ?1,
                total_tokens = total_tokens + ?2
             WHERE id = ?3",
            params![Utc::now().to_rfc3339(), tokens as i64, id],
        )?;
        debug!(id = %id, tokens, "agent session recorded");
        Ok(())
    }

    /// Record one inference call against an agent. Inserts a row into
    /// `inference_calls` AND atomically rolls the totals up onto the
    /// `agents` row (`total_tokens`, `session_count`, `lifetime_cost_usd`,
    /// `last_active`). Single transaction so the audit row and the
    /// running totals stay consistent.
    ///
    /// `cost_usd` should be pre-computed by the caller via
    /// `aeqi_providers::estimate_cost(&model, prompt_tokens, completion_tokens)`.
    /// Unknown models fall back to `DEFAULT_PRICE` (1.00 / 3.00 per Mtok),
    /// not zero, so the column never lies about cost being free.
    #[allow(clippy::too_many_arguments)]
    pub async fn record_inference_call(
        &self,
        agent_id: &str,
        session_id: Option<&str>,
        model: &str,
        prompt_tokens: u32,
        completion_tokens: u32,
        cost_usd: f64,
        stop_reason: Option<&str>,
        correlation_id: Option<&str>,
    ) -> Result<()> {
        let call_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let total_tokens = prompt_tokens as i64 + completion_tokens as i64;
        let db = self.db.lock().await;
        // Single SQL transaction — INSERT the audit row, then UPDATE the
        // agents rollup atomically. SQLite's implicit savepoint per
        // execute() is fine here; we use BEGIN/COMMIT to keep the two
        // writes coupled if a future caller adds a third write.
        db.execute_batch("BEGIN IMMEDIATE;")?;
        let insert_res = db.execute(
            "INSERT INTO inference_calls
                 (id, agent_id, session_id, model, prompt_tokens,
                  completion_tokens, cost_usd, stop_reason, correlation_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                call_id,
                agent_id,
                session_id,
                model,
                prompt_tokens as i64,
                completion_tokens as i64,
                cost_usd,
                stop_reason,
                correlation_id,
                now,
            ],
        );
        if let Err(e) = insert_res {
            db.execute_batch("ROLLBACK;")?;
            return Err(e.into());
        }
        let update_res = db.execute(
            "UPDATE agents SET
                 session_count = session_count + 1,
                 total_tokens = total_tokens + ?1,
                 lifetime_cost_usd = lifetime_cost_usd + ?2,
                 last_active = ?3
             WHERE id = ?4",
            params![total_tokens, cost_usd, now, agent_id],
        );
        match update_res {
            Ok(_) => {
                db.execute_batch("COMMIT;")?;
                debug!(
                    agent_id = %agent_id,
                    model = %model,
                    prompt_tokens,
                    completion_tokens,
                    cost_usd,
                    "inference call recorded"
                );
                Ok(())
            }
            Err(e) => {
                db.execute_batch("ROLLBACK;")?;
                Err(e.into())
            }
        }
    }

    /// Read the last `limit` inference calls attributed to `agent_id`,
    /// ordered most-recent first. Pure-read consumer of the
    /// `inference_calls` audit table; surfaced via the
    /// `agents_recent_inference_calls` IPC verb so the UI's
    /// agent-Treasury tab can render a per-call ledger without joining
    /// across tables on the client. `limit` is clamped to [1, 500] to
    /// keep payloads bounded.
    pub async fn recent_inference_calls(
        &self,
        agent_id: &str,
        limit: u32,
    ) -> Result<Vec<InferenceCall>> {
        let limit = limit.clamp(1, 500) as i64;
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, agent_id, session_id, model, prompt_tokens,
                    completion_tokens, cost_usd, stop_reason,
                    correlation_id, created_at
             FROM inference_calls
             WHERE agent_id = ?1
             ORDER BY datetime(created_at) DESC, id DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![agent_id, limit], |row| {
            Ok(InferenceCall {
                id: row.get::<_, String>(0)?,
                agent_id: row.get::<_, String>(1)?,
                session_id: row.get::<_, Option<String>>(2)?,
                model: row.get::<_, String>(3)?,
                prompt_tokens: row.get::<_, i64>(4)? as u32,
                completion_tokens: row.get::<_, i64>(5)? as u32,
                cost_usd: row.get::<_, f64>(6)?,
                stop_reason: row.get::<_, Option<String>>(7)?,
                correlation_id: row.get::<_, Option<String>>(8)?,
                created_at: row.get::<_, String>(9)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Change agent status.
    pub async fn set_status(&self, id: &str, status: AgentStatus) -> Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET status = ?1 WHERE id = ?2",
            params![status.to_string(), id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        info!(id = %id, status = %status, "agent status updated");
        Ok(())
    }

    /// Hard-delete an agent.
    ///
    /// - `cascade = false` — promote the agent's direct reports under its
    ///   own parents in the position DAG (every parent edge of the deleted
    ///   agent's positions is rewritten to point at each child position),
    ///   then delete the agent row. Returns the count removed (always 1).
    /// - `cascade = true` — delete the agent plus every descendant agent
    ///   resolved through the position DAG. Returns the count.
    ///
    /// Ideas and quests are unaffected — their `agent_id` columns have no
    /// FK, so references are left in place as historical pointers. Events,
    /// channels, and files are per-agent resources with `ON DELETE CASCADE`
    /// and are wiped alongside each deleted agent.
    pub async fn delete_agent(&self, id: &str, cascade: bool) -> Result<usize> {
        if !cascade {
            // Resolve the agent's roles, their parents, and their
            // children, then rewire children under the grandparent set.
            let db = self.db.lock().await;
            let agent_role_ids: Vec<String> = {
                let mut stmt = db.prepare(
                    "SELECT id FROM roles WHERE occupant_kind = 'agent' AND occupant_id = ?1",
                )?;
                stmt.query_map(params![id], |row| row.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .collect()
            };

            // Parents and children of the agent's roles.
            let mut parents: Vec<String> = Vec::new();
            let mut children: Vec<String> = Vec::new();
            if !agent_role_ids.is_empty() {
                let placeholders = std::iter::repeat_n("?", agent_role_ids.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let parent_sql = format!(
                    "SELECT DISTINCT parent_role_id FROM role_edges WHERE child_role_id IN ({placeholders})"
                );
                let child_sql = format!(
                    "SELECT DISTINCT child_role_id FROM role_edges WHERE parent_role_id IN ({placeholders})"
                );
                let p_vec: Vec<&dyn rusqlite::ToSql> = agent_role_ids
                    .iter()
                    .map(|s| s as &dyn rusqlite::ToSql)
                    .collect();
                {
                    let mut stmt = db.prepare(&parent_sql)?;
                    parents = stmt
                        .query_map(p_vec.as_slice(), |row| row.get::<_, String>(0))?
                        .filter_map(|r| r.ok())
                        .collect();
                }
                {
                    let mut stmt = db.prepare(&child_sql)?;
                    children = stmt
                        .query_map(p_vec.as_slice(), |row| row.get::<_, String>(0))?
                        .filter_map(|r| r.ok())
                        .collect();
                }
            }

            // Rewire children under the deleted agent's grandparents.
            for child in &children {
                for parent in &parents {
                    db.execute(
                        "INSERT INTO role_edges (parent_role_id, child_role_id)
                         VALUES (?1, ?2)
                         ON CONFLICT(parent_role_id, child_role_id) DO NOTHING",
                        params![parent, child],
                    )?;
                }
            }

            // Delete the agent — `ON DELETE CASCADE` on roles.trust_id
            // is not what we want here; roles for this agent get
            // dropped explicitly so any other entity references stay clean.
            for role in &agent_role_ids {
                db.execute("DELETE FROM roles WHERE id = ?1", params![role])?;
            }
            let deleted = db.execute("DELETE FROM agents WHERE id = ?1", params![id])?;
            if deleted == 0 {
                anyhow::bail!("agent '{id}' not found");
            }
            info!(id = %id, "agent deleted (children promoted)");
            return Ok(deleted);
        }

        // Cascade: collect every descendant agent (and self), drop them all.
        let mut subtree = self.list_descendants(id).await?;
        subtree.push(id.to_string());

        let exists = self.get(id).await?.is_some();
        if !exists {
            anyhow::bail!("agent '{id}' not found");
        }

        let db = self.db.lock().await;
        let placeholders = std::iter::repeat_n("?", subtree.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("DELETE FROM agents WHERE id IN ({placeholders})");
        let params_vec: Vec<&dyn rusqlite::ToSql> =
            subtree.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let deleted = db.execute(&sql, params_vec.as_slice())?;

        // Drop the matching roles (roles are scoped to entities and
        // `ON DELETE CASCADE` would fire only if the entity was deleted).
        let pos_sql = format!(
            "DELETE FROM roles WHERE occupant_kind = 'agent' AND occupant_id IN ({placeholders})"
        );
        db.execute(&pos_sql, params_vec.as_slice())?;

        info!(id = %id, count = deleted, "agent subtree deleted");
        Ok(deleted)
    }

    /// Update the model for an agent.
    pub async fn update_model(&self, id: &str, model: &str) -> Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET model = ?1 WHERE id = ?2",
            params![model, id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        info!(id = %id, model = %model, "agent model updated");
        Ok(())
    }

    /// Update operational fields on an agent.
    pub async fn update_agent_ops(
        &self,
        id: &str,
        workdir: Option<&str>,
        budget_usd: Option<f64>,
        execution_mode: Option<&str>,
        quest_prefix: Option<&str>,
        worker_timeout_secs: Option<u64>,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET workdir = ?1, budget_usd = ?2, execution_mode = ?3, quest_prefix = ?4, worker_timeout_secs = ?5 WHERE id = ?6",
            params![
                workdir,
                budget_usd,
                execution_mode,
                quest_prefix,
                worker_timeout_secs.map(|v| v as i64),
                id,
            ],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        info!(id = %id, "agent operational fields updated");
        Ok(())
    }

    /// Set tool_deny for an agent.
    pub async fn set_tool_deny(&self, id: &str, tool_deny: &[String]) -> Result<()> {
        let json = serde_json::to_string(tool_deny)?;
        let db = self.db.lock().await;
        db.execute(
            "UPDATE agents SET tool_deny = ?1 WHERE id = ?2",
            params![json, id],
        )?;
        Ok(())
    }

    /// Set `can_self_delegate` for an agent.
    pub async fn set_can_self_delegate(&self, id: &str, value: bool) -> Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET can_self_delegate = ?1 WHERE id = ?2",
            params![value as i64, id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        Ok(())
    }

    /// Set `can_ask_director` for an agent. Toggles whether this agent is
    /// allowed to fire `question.ask` and surface a question to the
    /// home-page director inbox. Off-by-default; same posture as
    /// `set_can_self_delegate`.
    pub async fn set_can_ask_director(&self, id: &str, value: bool) -> Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET can_ask_director = ?1 WHERE id = ?2",
            params![value as i64, id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        Ok(())
    }

    /// Set or clear the compactor model + provider overrides for an agent.
    /// Passing `None` clears the override; the agent then falls back to its
    /// primary model and the orchestrator default provider for compactor
    /// (kind="compactor") session.spawn calls.
    ///
    /// When `inference_cap` is set on the agent, the compactor model is
    /// enforced against the matrix at spawn time — setting an out-of-policy
    /// model here does NOT bypass the gate, it just shifts the failure to
    /// the next compactor spawn.
    pub async fn set_compactor_overrides(
        &self,
        id: &str,
        compactor_model: Option<&str>,
        compactor_provider: Option<&str>,
    ) -> Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET compactor_model = ?1, compactor_provider = ?2 WHERE id = ?3",
            params![compactor_model, compactor_provider, id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        Ok(())
    }

    /// Set or clear the per-agent inference capability matrix.
    pub async fn set_inference_capability(
        &self,
        id: &str,
        capability: Option<&InferenceCapability>,
    ) -> Result<()> {
        let json = capability
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| anyhow::anyhow!("invalid inference capability: {e}"))?;
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET inference_cap = ?1 WHERE id = ?2",
            params![json, id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        Ok(())
    }

    /// Set the model for an agent.
    pub async fn set_model(&self, id: &str, model: &str) -> Result<()> {
        let db = self.db.lock().await;
        let model_val = if model.is_empty() { None } else { Some(model) };
        db.execute(
            "UPDATE agents SET model = ?1 WHERE id = ?2",
            params![model_val, id],
        )?;
        Ok(())
    }

    pub async fn update_name(&self, id: &str, name: &str) -> Result<()> {
        let db = self.db.lock().await;
        let name = name.trim();
        db.execute(
            "UPDATE agents SET name = ?1, display_name = NULL WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    }

    /// Set visual identity (color + avatar) for an agent. Either field may be
    /// `None` to leave it unset. Used by template spawn to carry the template's
    /// styling onto the freshly-created agent without a second round-trip.
    pub async fn set_visual_identity(
        &self,
        id: &str,
        color: Option<&str>,
        avatar: Option<&str>,
    ) -> Result<()> {
        if color.is_none() && avatar.is_none() {
            return Ok(());
        }
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET color = COALESCE(?1, color), avatar = COALESCE(?2, avatar) WHERE id = ?3",
            params![color, avatar, id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{id}' not found");
        }
        Ok(())
    }

    /// Resolve workdir for an agent — walks ancestor chain to find first non-None.
    pub async fn resolve_workdir(&self, agent_id: &str) -> Result<Option<String>> {
        let ancestors = self.get_ancestors(agent_id).await?;
        for a in &ancestors {
            if let Some(ref wd) = a.workdir {
                return Ok(Some(wd.clone()));
            }
        }
        Ok(None)
    }

    /// Resolve execution mode for an agent — walks ancestor chain.
    pub async fn resolve_execution_mode(&self, agent_id: &str) -> Result<String> {
        let ancestors = self.get_ancestors(agent_id).await?;
        for a in &ancestors {
            if let Some(ref mode) = a.execution_mode {
                return Ok(mode.clone());
            }
        }
        Ok("agent".to_string())
    }

    /// Resolve worker timeout for an agent — walks ancestor chain.
    pub async fn resolve_worker_timeout(&self, agent_id: &str) -> Result<u64> {
        let ancestors = self.get_ancestors(agent_id).await?;
        for a in &ancestors {
            if let Some(timeout) = a.worker_timeout_secs {
                return Ok(timeout);
            }
        }
        Ok(3600) // Default: 1 hour.
    }

    /// Resolve model for an agent — walks ancestor chain, falls back to default.
    pub async fn resolve_model(&self, agent_id: &str, default_model: &str) -> String {
        if let Ok(ancestors) = self.get_ancestors(agent_id).await {
            for a in &ancestors {
                if let Some(ref model) = a.model {
                    return model.clone();
                }
            }
        }
        default_model.to_string()
    }

    /// Get max_concurrent for an agent by ID. Returns 1 if not found.
    pub async fn get_max_concurrent(&self, id: &str) -> Result<u32> {
        let db = self.db.lock().await;
        let max_concurrent: Option<u32> = db
            .query_row(
                "SELECT max_concurrent FROM agents WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(max_concurrent.unwrap_or(1))
    }

    // -----------------------------------------------------------------------
    // Budget policy operations
    // -----------------------------------------------------------------------

    pub async fn list_budget_policies(&self) -> Result<Vec<serde_json::Value>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, agent_id, window, amount_usd, warn_pct, hard_stop, paused, created_at \
             FROM budget_policies ORDER BY created_at DESC",
        )?;
        let policies = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "agent_id": row.get::<_, String>(1)?,
                    "window": row.get::<_, String>(2)?,
                    "amount_usd": row.get::<_, f64>(3)?,
                    "warn_pct": row.get::<_, f64>(4)?,
                    "hard_stop": row.get::<_, i32>(5)? != 0,
                    "paused": row.get::<_, i32>(6)? != 0,
                    "created_at": row.get::<_, String>(7)?,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(policies)
    }

    pub async fn create_budget_policy(
        &self,
        agent_id: &str,
        window: &str,
        amount_usd: f64,
    ) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO budget_policies (id, agent_id, window, amount_usd, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, agent_id, window, amount_usd, now],
        )?;
        info!(id = %id, agent_id = %agent_id, "budget policy created");
        Ok(id)
    }

    /// Check budget for an agent — walks ancestor chain to find the tightest policy.
    pub async fn check_budget(&self, agent_id: &str) -> Result<Option<f64>> {
        let ancestor_ids = self.get_ancestor_ids(agent_id).await?;
        let db = self.db.lock().await;
        let mut tightest: Option<f64> = None;
        for id in &ancestor_ids {
            let amount: Option<f64> = db
                .query_row(
                    "SELECT amount_usd FROM budget_policies \
                     WHERE agent_id = ?1 AND paused = 0 \
                     ORDER BY amount_usd ASC LIMIT 1",
                    params![id],
                    |row| row.get(0),
                )
                .optional()?;
            if let Some(a) = amount {
                tightest = Some(tightest.map_or(a, |t: f64| t.min(a)));
            }
        }
        Ok(tightest)
    }

    pub async fn set_budget_paused(&self, policy_id: &str, paused: bool) -> Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE budget_policies SET paused = ?1 WHERE id = ?2",
            params![paused as i32, policy_id],
        )?;
        if updated == 0 {
            anyhow::bail!("budget policy '{policy_id}' not found");
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Unified task store (SQLite-backed, replaces per-project JSONL)
    // -----------------------------------------------------------------------

    // DELETED: Prompt store — content_hash, prompt_source_hash,
    // insert_prompt_record, materialize_prompt_entries, create_prompt,
    // create_prompt_full, find_prompt_by_name, upsert_managed_prompt,
    // get_prompt, list_prompts, update_prompt, delete_prompt,
    // resolve_prompts, set_agent_prompt_ids.
    // Prompt data now lives exclusively in ideas.db.

    /// Resolve idea_ids — returns empty (prompts table is deleted).
    pub async fn resolve_ideas(&self, _ids: &[String]) -> Result<Vec<serde_json::Value>> {
        Ok(Vec::new())
    }

    /// Mint (or reuse) an idea row for a quest's editorial body. Returns the
    /// idea id. Reuse semantics match the WS-1c backfill: when the same
    /// `(agent_id, name)` already has a row in `ideas`, we link to it
    /// instead of duplicating. `_idea_ids` is kept in the signature
    /// because it used to thread cross-references onto the quest;
    /// post-phase-3 the canonical place for those is `[[wiki-links]]`
    /// inside the idea body, so the parameter is intentionally ignored.
    async fn mint_or_reuse_quest_idea(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
        scope: Scope,
    ) -> Result<String> {
        let name_for_lookup = if name.trim().is_empty() {
            "(untitled)".to_string()
        } else {
            name.to_string()
        };
        let content_for_insert = if content.is_empty() {
            String::new()
        } else {
            content.to_string()
        };
        let agent_owned = agent_id.map(|s| s.to_string());
        let scope_owned = scope.as_str().to_string();
        let tags_owned: Vec<String> = tags.iter().map(|t| t.trim().to_lowercase()).collect();

        let db = self.db.lock().await;
        let existing: Option<String> = db
            .query_row(
                "SELECT id FROM ideas
                 WHERE COALESCE(agent_id, '') = COALESCE(?1, '') AND name = ?2
                 LIMIT 1",
                params![agent_owned, name_for_lookup],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return Ok(id);
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO ideas (id, name, content, scope, agent_id, created_at,
                                status, embedding_pending)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 1)",
            params![
                id,
                name_for_lookup,
                content_for_insert,
                scope_owned,
                agent_owned,
                now
            ],
        )?;
        for tag in &tags_owned {
            if tag.is_empty() {
                continue;
            }
            db.execute(
                "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                params![id, tag],
            )?;
        }
        Ok(id)
    }

    /// Create a task assigned to an agent.
    pub async fn create_task(
        &self,
        agent_id: &str,
        subject: &str,
        description: &str,
        idea_ids: &[String],
        labels: &[String],
    ) -> Result<aeqi_quests::Quest> {
        self.create_task_scoped(
            agent_id,
            subject,
            description,
            idea_ids,
            labels,
            Scope::SelfScope,
        )
        .await
    }

    pub async fn create_task_scoped(
        &self,
        agent_id: &str,
        subject: &str,
        description: &str,
        _idea_ids: &[String],
        labels: &[String],
        scope: Scope,
    ) -> Result<aeqi_quests::Quest> {
        // Resolve quest prefix: agent's quest_prefix, or first 2 chars of name, or "t".
        let agent = self
            .get(agent_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("agent not found: {agent_id}"))?;
        let prefix = agent.quest_prefix.unwrap_or_else(|| {
            let name = &agent.name;
            if name.len() >= 2 {
                name[..2].to_lowercase()
            } else {
                "t".to_string()
            }
        });

        // Rate limit: reject if agent has exceeded daily quest creation limit.
        {
            let sdb = self.sessions_db.lock().await;
            let max_daily_tasks: u32 = 50;
            let today_count: u32 = sdb.query_row(
                "SELECT COUNT(*) FROM quests WHERE agent_id = ?1 AND created_at > date('now')",
                params![agent_id],
                |row| row.get(0),
            )?;
            if today_count >= max_daily_tasks {
                anyhow::bail!("Agent has reached daily quest creation limit ({max_daily_tasks})");
            }
        }

        // Mint (or reuse) the linked idea before allocating the quest id —
        // a failure here aborts cleanly without leaving a half-created row.
        let idea_id = self
            .mint_or_reuse_quest_idea(subject, description, labels, Some(agent_id), scope)
            .await?;

        // Get and increment sequence for this prefix (quest_sequences lives in aeqi.db).
        let seq: u32 = {
            let db = self.db.lock().await;
            db.execute(
                "INSERT OR IGNORE INTO quest_sequences (prefix, next_seq) VALUES (?1, 1)",
                params![prefix],
            )?;
            db.query_row(
                "UPDATE quest_sequences SET next_seq = next_seq + 1 WHERE prefix = ?1 RETURNING next_seq - 1",
                params![prefix],
                |row| row.get(0),
            )?
        };

        let quest_id = format!("{prefix}-{seq:03}");
        let now = chrono::Utc::now();

        let mut quest = aeqi_quests::Quest::with_agent(
            aeqi_quests::QuestId(quest_id.clone()),
            idea_id.clone(),
            Some(agent_id),
        );
        let _ = subject;
        quest.scope = scope;
        quest.created_at = now;

        let sdb = self.sessions_db.lock().await;
        sdb.execute(
            "INSERT INTO quests (id, idea_id, status, priority, agent_id, scope, created_at)
             VALUES (?1, ?2, 'todo', 'normal', ?3, ?4, ?5)",
            params![
                quest_id,
                idea_id,
                agent_id,
                scope.as_str(),
                now.to_rfc3339()
            ],
        )?;

        info!(quest = %quest_id, agent = %agent.name, subject = %subject, "quest created");
        Ok(quest)
    }

    /// Create a task linked to a pre-existing idea. The Flow A / Flow B
    /// IPC path resolves the idea (mint or validate) up-front, so we
    /// skip the second mint that `create_task_v2_scoped` would do —
    /// going through this helper means the caller has already taken
    /// responsibility for the linked idea.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_task_with_idea_id(
        &self,
        agent_id: &str,
        idea_id: &str,
        depends_on: &[aeqi_quests::QuestId],
        parent_id: Option<&str>,
        scope: Scope,
    ) -> Result<aeqi_quests::Quest> {
        let agent = self
            .get(agent_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("agent not found: {agent_id}"))?;
        let prefix = agent.quest_prefix.unwrap_or_else(|| {
            let name = &agent.name;
            if name.len() >= 2 {
                name[..2].to_lowercase()
            } else {
                "t".to_string()
            }
        });

        {
            let sdb = self.sessions_db.lock().await;
            let max_daily_tasks: u32 = 50;
            let today_count: u32 = sdb.query_row(
                "SELECT COUNT(*) FROM quests WHERE agent_id = ?1 AND created_at > date('now')",
                params![agent_id],
                |row| row.get(0),
            )?;
            if today_count >= max_daily_tasks {
                anyhow::bail!("Agent has reached daily quest creation limit ({max_daily_tasks})");
            }
        }

        let quest_id = if let Some(pid) = parent_id {
            let sdb = self.sessions_db.lock().await;
            let child_count: u32 = sdb.query_row(
                "SELECT COUNT(*) FROM quests WHERE id LIKE ?1",
                params![format!("{pid}.%")],
                |row| row.get(0),
            )?;
            let parent_quest_id = aeqi_quests::QuestId(pid.to_string());
            parent_quest_id.child(child_count + 1).0
        } else {
            let db = self.db.lock().await;
            db.execute(
                "INSERT OR IGNORE INTO quest_sequences (prefix, next_seq) VALUES (?1, 1)",
                params![prefix],
            )?;
            db.query_row(
                "UPDATE quest_sequences SET next_seq = next_seq + 1 WHERE prefix = ?1 RETURNING next_seq - 1",
                params![prefix],
                |row| row.get::<_, u32>(0),
            )
            .map(|seq| format!("{prefix}-{seq:03}"))?
        };

        let now = chrono::Utc::now();
        let deps_json = serde_json::to_string(depends_on)?;

        let mut quest = aeqi_quests::Quest::with_agent(
            aeqi_quests::QuestId(quest_id.clone()),
            idea_id.to_string(),
            Some(agent_id),
        );
        quest.depends_on = depends_on.to_vec();
        quest.scope = scope;
        quest.created_at = now;

        let sdb = self.sessions_db.lock().await;
        sdb.execute(
            "INSERT INTO quests (id, idea_id, status, priority, agent_id, scope, depends_on, created_at)
             VALUES (?1, ?2, 'todo', 'normal', ?3, ?4, ?5, ?6)",
            params![quest_id, idea_id, agent_id, scope.as_str(), deps_json, now.to_rfc3339()],
        )?;

        info!(quest = %quest_id, agent = %agent.name, idea_id, parent = ?parent_id, "quest created (idea-linked)");
        Ok(quest)
    }

    pub async fn create_unbound_task_scoped(
        &self,
        project: &str,
        subject: &str,
        description: &str,
        labels: &[String],
        linked_idea_id: Option<&str>,
        depends_on: &[aeqi_quests::QuestId],
        parent_id: Option<&str>,
    ) -> Result<aeqi_quests::Quest> {
        let prefix = self.quest_prefix_for_project(project).await?;
        let idea_id = match linked_idea_id {
            Some(id) => id.to_string(),
            None => {
                self.mint_or_reuse_quest_idea(subject, description, labels, None, Scope::Global)
                    .await?
            }
        };

        let quest_id = if let Some(pid) = parent_id {
            let sdb = self.sessions_db.lock().await;
            let child_count: u32 = sdb.query_row(
                "SELECT COUNT(*) FROM quests WHERE id LIKE ?1",
                params![format!("{pid}.%")],
                |row| row.get(0),
            )?;
            let parent_quest_id = aeqi_quests::QuestId(pid.to_string());
            parent_quest_id.child(child_count + 1).0
        } else {
            let db = self.db.lock().await;
            db.execute(
                "INSERT OR IGNORE INTO quest_sequences (prefix, next_seq) VALUES (?1, 1)",
                params![prefix],
            )?;
            db.query_row(
                "UPDATE quest_sequences SET next_seq = next_seq + 1 WHERE prefix = ?1 RETURNING next_seq - 1",
                params![prefix],
                |row| row.get::<_, u32>(0),
            )
            .map(|seq| format!("{prefix}-{seq:03}"))?
        };

        let now = chrono::Utc::now();
        let deps_json = serde_json::to_string(depends_on)?;
        let mut quest = aeqi_quests::Quest::with_agent(
            aeqi_quests::QuestId(quest_id.clone()),
            idea_id.clone(),
            None,
        );
        let _ = subject;
        quest.depends_on = depends_on.to_vec();
        quest.scope = Scope::Global;
        quest.created_at = now;

        let sdb = self.sessions_db.lock().await;
        sdb.execute(
            "INSERT INTO quests (id, idea_id, status, priority, agent_id, scope, depends_on, created_at)
             VALUES (?1, ?2, 'todo', 'normal', NULL, 'global', ?3, ?4)",
            params![quest_id, idea_id, deps_json, now.to_rfc3339()],
        )?;

        info!(quest = %quest_id, project, idea_id, parent = ?parent_id, "unbound quest created");
        Ok(quest)
    }

    async fn quest_prefix_for_project(&self, project: &str) -> Result<String> {
        if let Some(agent) = self.default_agent(Some(project)).await? {
            if let Some(prefix) = agent.quest_prefix {
                return Ok(prefix);
            }
            return Ok(Self::fallback_quest_prefix(&agent.name));
        }
        Ok(Self::fallback_quest_prefix(project))
    }

    fn fallback_quest_prefix(label: &str) -> String {
        let normalized: String = label
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(2)
            .flat_map(|c| c.to_lowercase())
            .collect();
        if normalized.is_empty() {
            "q".to_string()
        } else {
            normalized
        }
    }

    /// Create a task with v2 features: depends_on, parent (child task) support.
    pub async fn create_task_v2(
        &self,
        agent_id: &str,
        subject: &str,
        description: &str,
        idea_ids: &[String],
        labels: &[String],
        depends_on: &[aeqi_quests::QuestId],
        parent_id: Option<&str>,
    ) -> Result<aeqi_quests::Quest> {
        self.create_task_v2_scoped(
            agent_id,
            subject,
            description,
            idea_ids,
            labels,
            depends_on,
            parent_id,
            Scope::SelfScope,
        )
        .await
    }

    pub async fn create_task_v2_scoped(
        &self,
        agent_id: &str,
        subject: &str,
        description: &str,
        _idea_ids: &[String],
        labels: &[String],
        depends_on: &[aeqi_quests::QuestId],
        parent_id: Option<&str>,
        scope: Scope,
    ) -> Result<aeqi_quests::Quest> {
        // Resolve quest prefix: agent's quest_prefix, or first 2 chars of name, or "t".
        let agent = self
            .get(agent_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("agent not found: {agent_id}"))?;
        let prefix = agent.quest_prefix.unwrap_or_else(|| {
            let name = &agent.name;
            if name.len() >= 2 {
                name[..2].to_lowercase()
            } else {
                "t".to_string()
            }
        });

        // Rate limit: reject if agent has exceeded daily quest creation limit.
        {
            let sdb = self.sessions_db.lock().await;
            let max_daily_tasks: u32 = 50;
            let today_count: u32 = sdb.query_row(
                "SELECT COUNT(*) FROM quests WHERE agent_id = ?1 AND created_at > date('now')",
                params![agent_id],
                |row| row.get(0),
            )?;
            if today_count >= max_daily_tasks {
                anyhow::bail!("Agent has reached daily quest creation limit ({max_daily_tasks})");
            }
        }

        // Mint the linked idea before quest-id allocation so a failure there
        // aborts cleanly without consuming a sequence number.
        let idea_id = self
            .mint_or_reuse_quest_idea(subject, description, labels, Some(agent_id), scope)
            .await?;

        // If parent is specified, create a child ID; otherwise create a root ID.
        let quest_id = if let Some(pid) = parent_id {
            // Find next child sequence for this parent (quests in sessions.db).
            let sdb = self.sessions_db.lock().await;
            let child_count: u32 = sdb.query_row(
                "SELECT COUNT(*) FROM quests WHERE id LIKE ?1",
                params![format!("{pid}.%")],
                |row| row.get(0),
            )?;
            let parent_quest_id = aeqi_quests::QuestId(pid.to_string());
            parent_quest_id.child(child_count + 1).0
        } else {
            // Root-level: get and increment sequence for this prefix (quest_sequences in aeqi.db).
            let db = self.db.lock().await;
            db.execute(
                "INSERT OR IGNORE INTO quest_sequences (prefix, next_seq) VALUES (?1, 1)",
                params![prefix],
            )?;
            let seq: u32 = db.query_row(
                "UPDATE quest_sequences SET next_seq = next_seq + 1 WHERE prefix = ?1 RETURNING next_seq - 1",
                params![prefix],
                |row| row.get(0),
            )?;
            format!("{prefix}-{seq:03}")
        };

        let now = chrono::Utc::now();
        let deps_json = serde_json::to_string(depends_on)?;

        let mut quest = aeqi_quests::Quest::with_agent(
            aeqi_quests::QuestId(quest_id.clone()),
            idea_id.clone(),
            Some(agent_id),
        );
        let _ = subject;
        quest.depends_on = depends_on.to_vec();
        quest.scope = scope;
        quest.created_at = now;

        let sdb = self.sessions_db.lock().await;
        sdb.execute(
            "INSERT INTO quests (id, idea_id, status, priority, agent_id, scope, depends_on, created_at)
             VALUES (?1, ?2, 'todo', 'normal', ?3, ?4, ?5, ?6)",
            params![quest_id, idea_id, agent_id, scope.as_str(), deps_json, now.to_rfc3339()],
        )?;

        info!(quest = %quest_id, agent = %agent.name, subject = %subject, parent = ?parent_id, "quest created (v2)");
        Ok(quest)
    }

    /// Find an open (Pending or InProgress) quest whose linked idea has the
    /// given name. Used for atomic claim checking — `claim:` prefixed
    /// idea names map a single open quest to a unique resource.
    pub async fn find_open_task_by_subject(
        &self,
        subject: &str,
    ) -> Result<Option<aeqi_quests::Quest>> {
        // Two-step lookup across the cross-DB FK boundary.
        let idea_id: Option<String> = {
            let db = self.db.lock().await;
            db.query_row(
                "SELECT id FROM ideas WHERE name = ?1 LIMIT 1",
                params![subject],
                |row| row.get(0),
            )
            .optional()?
        };
        let Some(idea_id) = idea_id else {
            return Ok(None);
        };

        let db = self.sessions_db.lock().await;
        let task = db
            .query_row(
                "SELECT * FROM quests
                 WHERE idea_id = ?1 AND status IN ('todo', 'in_progress')
                 LIMIT 1",
                params![idea_id],
                |row| Ok(row_to_task(row)),
            )
            .optional()?;
        Ok(task)
    }

    /// All quests ready to run — Todo status, no unmet dependencies.
    /// Backlog quests are explicitly NOT ready: they're parked, awaiting
    /// the user to promote them to Todo.
    pub async fn ready_tasks(&self) -> Result<Vec<aeqi_quests::Quest>> {
        let db = self.sessions_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM quests WHERE status = 'todo' ORDER BY
             CASE priority
                WHEN 'critical' THEN 0
                WHEN 'high' THEN 1
                WHEN 'normal' THEN 2
                WHEN 'low' THEN 3
                ELSE 4
             END,
             created_at ASC",
        )?;
        let tasks: Vec<aeqi_quests::Quest> = stmt
            .query_map([], |row| Ok(row_to_task(row)))?
            .filter_map(|r| r.ok())
            .collect();

        // Filter out tasks with unmet dependencies.
        let ready: Vec<aeqi_quests::Quest> = tasks
            .into_iter()
            .filter(|t| {
                if t.depends_on.is_empty() {
                    return true;
                }
                // Check all deps are done (synchronous — we have the db lock).
                t.depends_on.iter().all(|dep_id| {
                    db.query_row(
                        "SELECT status FROM quests WHERE id = ?1",
                        params![dep_id.0],
                        |row| row.get::<_, String>(0),
                    )
                    .ok()
                    .as_deref()
                        == Some("done")
                })
            })
            .collect();

        Ok(ready)
    }

    /// Count quests currently in `in_progress` state, grouped by agent_id.
    /// Used by `QuestEnqueuer` to enforce per-agent concurrency caps without
    /// needing an in-memory worker map.
    pub async fn in_progress_counts_by_agent(
        &self,
    ) -> Result<std::collections::HashMap<String, u32>> {
        let db = self.sessions_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT agent_id, COUNT(*) FROM quests \
             WHERE status = 'in_progress' AND agent_id IS NOT NULL \
             GROUP BY agent_id",
        )?;
        let rows = stmt.query_map([], |row| {
            let agent_id: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok((agent_id, count as u32))
        })?;
        let mut map = std::collections::HashMap::new();
        for r in rows.flatten() {
            map.insert(r.0, r.1);
        }
        Ok(map)
    }

    /// Get a quest by ID.
    pub async fn get_task(&self, quest_id: &str) -> Result<Option<aeqi_quests::Quest>> {
        let db = self.sessions_db.lock().await;
        let quest = db
            .query_row(
                "SELECT * FROM quests WHERE id = ?1",
                params![quest_id],
                |row| Ok(row_to_task(row)),
            )
            .optional()?;
        Ok(quest)
    }

    /// Hydrate a quest's linked idea snapshot from `aeqi.db`. Tests + the
    /// API layer use this to read `quest.title()` / `quest.body()` /
    /// `quest.idea_tags()` after a fetch without standing up the full
    /// `IdeaStore` plumbing.
    pub async fn hydrate_quest_idea(&self, quest: &mut aeqi_quests::Quest) -> Result<()> {
        let idea_id = quest.idea_id.clone();
        if idea_id.is_empty() {
            return Ok(());
        }
        let db = self.db.lock().await;
        let idea = db
            .query_row(
                "SELECT id, name, content, scope, agent_id, session_id, created_at, kind, file_id
                 FROM ideas WHERE id = ?1",
                params![idea_id],
                |row| {
                    let scope_str: String = row.get(3)?;
                    let scope: Scope = scope_str.parse().unwrap_or(Scope::SelfScope);
                    let created: String = row.get(6)?;
                    let created_at = chrono::DateTime::parse_from_rfc3339(&created)
                        .map(|d| d.with_timezone(&chrono::Utc))
                        .unwrap_or_else(|_| chrono::Utc::now());
                    Ok(aeqi_core::traits::Idea {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        content: row.get(2)?,
                        tags: vec![],
                        agent_id: row.get(4)?,
                        session_id: row.get(5)?,
                        score: 0.0,
                        scope,
                        inheritance: "self".to_string(),
                        tool_allow: vec![],
                        tool_deny: vec![],
                        parent_idea_id: None,
                        properties: None,
                        created_at,
                        kind: row.get::<_, String>(7)?,
                        file_id: row.get(8)?,
                    })
                },
            )
            .optional()?;
        if let Some(mut idea) = idea {
            // Pull the tag rows in a follow-up query so the snapshot
            // mirrors what `IdeaStore::get_by_ids` would return.
            let mut stmt =
                db.prepare("SELECT tag FROM idea_tags WHERE idea_id = ?1 ORDER BY tag")?;
            let tags: Vec<String> = stmt
                .query_map(params![idea_id], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();
            idea.tags = tags;
            quest.idea = Some(idea);
        }
        Ok(())
    }

    /// IDs of every quest currently linked to a given idea. Used by the
    /// `DELETE /ideas/:id` pre-flight (returning the list lets the UI
    /// show a "delete those quests first" conflict modal) and by the
    /// shared-spec badge in the quest detail view.
    pub async fn find_quests_by_idea_id(&self, idea_id: &str) -> Result<Vec<String>> {
        let db = self.sessions_db.lock().await;
        let mut stmt = db.prepare("SELECT id FROM quests WHERE idea_id = ?1 ORDER BY id ASC")?;
        let ids = stmt
            .query_map(params![idea_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Set the `idea_id` FK on a quest. Thin wrapper over `update_task` —
    /// exposed so the create-quest path doesn't need to take a closure.
    pub async fn set_quest_idea_id(
        &self,
        quest_id: &str,
        idea_id: &str,
    ) -> Result<aeqi_quests::Quest> {
        let new_id = idea_id.to_string();
        self.update_task(quest_id, |quest| {
            quest.idea_id = new_id;
        })
        .await
    }

    /// Update a quest's status.
    pub async fn update_task_status(
        &self,
        quest_id: &str,
        status: aeqi_quests::QuestStatus,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let status_str = status.to_string();
        let db = self.sessions_db.lock().await;

        let closed_at = if matches!(
            status,
            aeqi_quests::QuestStatus::Done | aeqi_quests::QuestStatus::Cancelled
        ) {
            Some(now.clone())
        } else {
            None
        };

        db.execute(
            "UPDATE quests SET status = ?1, updated_at = ?2, closed_at = COALESCE(?3, closed_at) WHERE id = ?4",
            params![status_str, now, closed_at, quest_id],
        )?;
        Ok(())
    }

    /// Atomically finalize a quest run. One SQLite transaction covers the
    /// status flip, the `retry_count` bump (for retry outcomes), and the
    /// `closed_at` stamp (for terminal outcomes). Replaces the legacy
    /// select-then-update pair (`update_task` + `update_task_status`) so a
    /// concurrent finalize cannot interleave between the read and the write.
    ///
    /// - `bump_retry = true` increments `retry_count` by 1 (used when the
    ///   agent stopped with a retryable reason and the quest is going back
    ///   to `Pending`).
    /// - `Done` and `Cancelled` stamp `closed_at` to now.
    pub async fn finalize_quest(
        &self,
        quest_id: &str,
        status: aeqi_quests::QuestStatus,
        bump_retry: bool,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let status_str = status.to_string();
        let closed_at = if matches!(
            status,
            aeqi_quests::QuestStatus::Done | aeqi_quests::QuestStatus::Cancelled
        ) {
            Some(now.clone())
        } else {
            None
        };
        let retry_delta: i64 = if bump_retry { 1 } else { 0 };

        let db = self.sessions_db.lock().await;
        let tx = db.unchecked_transaction()?;
        tx.execute(
            "UPDATE quests SET
                status = ?1,
                updated_at = ?2,
                closed_at = COALESCE(?3, closed_at),
                retry_count = retry_count + ?4
             WHERE id = ?5",
            params![status_str, now, closed_at, retry_delta, quest_id],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Reset quests stuck in `in_progress` from a previous daemon run.
    /// These quests had workers that were killed by a crash/restart.
    pub async fn reset_stale_in_progress(&self) -> Result<usize> {
        let db = self.sessions_db.lock().await;
        let count = db.execute(
            "UPDATE quests SET status = 'todo', retry_count = retry_count + 1 WHERE status = 'in_progress'",
            [],
        )?;
        Ok(count)
    }

    /// Update a quest using a closure (mirrors QuestBoard API).
    pub async fn update_task<F: FnOnce(&mut aeqi_quests::Quest)>(
        &self,
        quest_id: &str,
        f: F,
    ) -> Result<aeqi_quests::Quest> {
        let db = self.sessions_db.lock().await;
        let mut quest = db
            .query_row(
                "SELECT * FROM quests WHERE id = ?1",
                params![quest_id],
                |row| Ok(row_to_task(row)),
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("quest not found: {quest_id}"))?;

        f(&mut quest);

        let now = chrono::Utc::now().to_rfc3339();
        let checkpoints_json = serde_json::to_string(&quest.checkpoints).unwrap_or_default();
        let deps_json = serde_json::to_string(&quest.depends_on).unwrap_or_default();
        let metadata_json = serde_json::to_string(&quest.metadata).unwrap_or_default();
        let outcome_json = quest
            .outcome
            .as_ref()
            .and_then(|o| serde_json::to_string(o).ok());

        db.execute(
            "UPDATE quests SET
                idea_id = ?1, status = ?2, priority = ?3,
                agent_id = ?4, assignee = ?5, scope = ?6,
                retry_count = ?7, checkpoints = ?8, metadata = ?9,
                depends_on = ?10,
                updated_at = ?11, closed_at = ?12, outcome = ?13,
                due_at = ?14, worktree_branch = ?15, worktree_path = ?16
             WHERE id = ?17",
            params![
                quest.idea_id,
                quest.status.to_string(),
                quest.priority.to_string(),
                quest.agent_id,
                quest.assignee,
                quest.scope.as_str(),
                quest.retry_count,
                checkpoints_json,
                metadata_json,
                deps_json,
                now,
                quest.closed_at.map(|d| d.to_rfc3339()),
                outcome_json,
                quest.due_at.map(|d| d.timestamp()),
                quest.worktree_branch,
                quest.worktree_path,
                quest.id.0,
            ],
        )?;

        Ok(quest)
    }

    /// Update the scope of an existing quest.
    pub async fn update_task_scope(&self, quest_id: &str, scope: Scope) -> Result<()> {
        let db = self.sessions_db.lock().await;
        db.execute(
            "UPDATE quests SET scope = ?1, updated_at = ?2 WHERE id = ?3",
            params![scope.as_str(), chrono::Utc::now().to_rfc3339(), quest_id],
        )?;
        Ok(())
    }

    /// List tasks visible to a viewer agent, using a precomputed
    /// `(visibility_clause, bind_params)` from `scope_visibility::visibility_sql_clause`.
    /// Optionally filtered by status.
    pub async fn list_tasks_visible(
        &self,
        visibility_clause: &str,
        bind_params: &[String],
        status: Option<&str>,
    ) -> Result<Vec<aeqi_quests::Quest>> {
        let db = self.sessions_db.lock().await;
        let mut sql = format!("SELECT * FROM quests WHERE {visibility_clause}");
        let mut all_params: Vec<Box<dyn rusqlite::types::ToSql>> = bind_params
            .iter()
            .map(|s| Box::new(s.clone()) as Box<dyn rusqlite::types::ToSql>)
            .collect();

        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            all_params.push(Box::new(s.to_string()));
        }
        sql.push_str(" ORDER BY created_at DESC");

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            all_params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = db.prepare(&sql)?;
        let tasks = stmt
            .query_map(param_refs.as_slice(), |row| Ok(row_to_task(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tasks)
    }

    /// List all tasks, optionally filtered by status and/or agent.
    pub async fn list_tasks(
        &self,
        status: Option<&str>,
        agent_id: Option<&str>,
    ) -> Result<Vec<aeqi_quests::Quest>> {
        let db = self.sessions_db.lock().await;
        let mut sql = "SELECT * FROM quests WHERE 1=1".to_string();
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(s) = status {
            sql.push_str(" AND status = ?");
            params_vec.push(Box::new(s.to_string()));
        }
        if let Some(a) = agent_id {
            sql.push_str(" AND agent_id = ?");
            params_vec.push(Box::new(a.to_string()));
        }
        sql.push_str(" ORDER BY created_at DESC");

        let params_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = db.prepare(&sql)?;
        let tasks = stmt
            .query_map(params_refs.as_slice(), |row| Ok(row_to_task(row)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(tasks)
    }

    /// List direct children of a quest by ID prefix.
    ///
    /// Returns all quests whose ID starts with `{prefix}.` but does NOT contain
    /// a further dot (i.e., direct children only, not grandchildren).
    pub async fn list_tasks_by_prefix(&self, prefix: &str) -> Result<Vec<aeqi_quests::Quest>> {
        let db = self.sessions_db.lock().await;
        let like_pattern = format!("{prefix}.%");
        let mut stmt = db.prepare("SELECT * FROM quests WHERE id LIKE ?1 ORDER BY id ASC")?;
        let tasks: Vec<aeqi_quests::Quest> = stmt
            .query_map(params![like_pattern], |row| Ok(row_to_task(row)))?
            .filter_map(|r| r.ok())
            // Filter to direct children only (no grandchildren).
            .filter(|q| !q.id.0[prefix.len() + 1..].contains('.'))
            .collect();
        Ok(tasks)
    }

    // -- Execution runs -------------------------------------------------------

    /// Create a new execution run record. Returns the run ID.
    pub async fn create_run(
        &self,
        session_id: Option<&str>,
        quest_id: Option<&str>,
        agent_id: &str,
        model: Option<&str>,
    ) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let db = self.sessions_db.lock().await;
        db.execute(
            "INSERT INTO runs (id, session_id, quest_id, agent_id, model, status, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'running', ?6)",
            rusqlite::params![id, session_id, quest_id, agent_id, model, now],
        )?;
        Ok(id)
    }

    /// Complete an execution run with outcome and cost.
    pub async fn complete_run(
        &self,
        run_id: &str,
        status: &str,
        cost_usd: f64,
        turns: u32,
        outcome: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let db = self.sessions_db.lock().await;
        db.execute(
            "UPDATE runs SET status = ?1, cost_usd = ?2, turns = ?3, outcome = ?4, finished_at = ?5
             WHERE id = ?6",
            rusqlite::params![status, cost_usd, turns as i64, outcome, now, run_id],
        )?;
        Ok(())
    }

    /// Complete a run with full execution metrics.
    pub async fn complete_run_full(
        &self,
        run_id: &str,
        status: &str,
        cost_usd: f64,
        turns: u32,
        outcome: Option<&str>,
        prompt_tokens: u32,
        completion_tokens: u32,
        duration_ms: Option<u64>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let tokens_used = prompt_tokens + completion_tokens;
        let db = self.sessions_db.lock().await;
        db.execute(
            "UPDATE runs SET status = ?1, cost_usd = ?2, turns = ?3, outcome = ?4,
             finished_at = ?5, tokens_used = ?6, prompt_tokens = ?7,
             completion_tokens = ?8, duration_ms = ?9
             WHERE id = ?10",
            rusqlite::params![
                status,
                cost_usd,
                turns as i64,
                outcome,
                now,
                tokens_used as i64,
                prompt_tokens as i64,
                completion_tokens as i64,
                duration_ms.map(|d| d as i64),
                run_id,
            ],
        )?;
        Ok(())
    }

    /// List recent execution runs, optionally filtered by agent or session.
    pub async fn list_runs(
        &self,
        agent_id: Option<&str>,
        session_id: Option<&str>,
        limit: u32,
    ) -> Result<Vec<RunRecord>> {
        let db = self.sessions_db.lock().await;
        let mut sql = String::from(
            "SELECT id, session_id, quest_id, agent_id, model, status,
                    started_at, finished_at, cost_usd, tokens_used, turns, outcome,
                    prompt_tokens, completion_tokens, duration_ms
             FROM runs WHERE 1=1",
        );
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(aid) = agent_id {
            sql.push_str(&format!(" AND agent_id = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(aid.to_string()));
        }
        if let Some(sid) = session_id {
            sql.push_str(&format!(" AND session_id = ?{}", params_vec.len() + 1));
            params_vec.push(Box::new(sid.to_string()));
        }
        sql.push_str(&format!(
            " ORDER BY started_at DESC LIMIT ?{}",
            params_vec.len() + 1
        ));
        params_vec.push(Box::new(limit as i64));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params_vec.iter().map(|p| p.as_ref()).collect();
        let mut stmt = db.prepare(&sql)?;
        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(RunRecord {
                id: row.get(0)?,
                session_id: row.get(1)?,
                quest_id: row.get(2)?,
                agent_id: row.get(3)?,
                model: row.get(4)?,
                status: row.get(5)?,
                started_at: row.get(6)?,
                finished_at: row.get(7)?,
                cost_usd: row.get(8)?,
                tokens_used: row.get(9)?,
                turns: row.get(10)?,
                outcome: row.get(11)?,
                prompt_tokens: row.get::<_, i64>(12).unwrap_or(0),
                completion_tokens: row.get::<_, i64>(13).unwrap_or(0),
                duration_ms: row.get(14).ok(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub async fn seed_personal_cap_table_defaults(
        &self,
        trust_id: &str,
        creator_user_id: Option<&str>,
    ) -> Result<()> {
        self.upsert_cap_table_entry(CapTableSeed {
            trust_id,
            allocation_key: "creator_common",
            holder_kind: "creator",
            holder_id: creator_user_id,
            security_type: "common",
            basis_points: 10_000,
            vesting_months: None,
            cliff_months: None,
        })
        .await
    }

    pub async fn seed_company_cap_table_defaults(
        &self,
        trust_id: &str,
        creator_user_id: Option<&str>,
    ) -> Result<()> {
        self.upsert_cap_table_entry(CapTableSeed {
            trust_id,
            allocation_key: "founder_vesting_common",
            holder_kind: "creator",
            holder_id: creator_user_id,
            security_type: "vesting_common",
            basis_points: 8_000,
            vesting_months: Some(48),
            cliff_months: Some(12),
        })
        .await?;
        self.upsert_cap_table_entry(CapTableSeed {
            trust_id,
            allocation_key: "option_pool",
            holder_kind: "unassigned",
            holder_id: None,
            security_type: "option_pool",
            basis_points: 2_000,
            vesting_months: None,
            cliff_months: None,
        })
        .await
    }

    async fn upsert_cap_table_entry(&self, seed: CapTableSeed<'_>) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO cap_table_entries (
                 id, trust_id, allocation_key, holder_kind, holder_id,
                 security_type, basis_points, vesting_months, cliff_months, created_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(trust_id, allocation_key) DO UPDATE SET
                 holder_kind = excluded.holder_kind,
                 holder_id = COALESCE(excluded.holder_id, cap_table_entries.holder_id),
                 security_type = excluded.security_type,
                 basis_points = excluded.basis_points,
                 vesting_months = excluded.vesting_months,
                 cliff_months = excluded.cliff_months",
            params![
                uuid::Uuid::new_v4().to_string(),
                seed.trust_id,
                seed.allocation_key,
                seed.holder_kind,
                seed.holder_id,
                seed.security_type,
                seed.basis_points,
                seed.vesting_months,
                seed.cliff_months,
                now,
            ],
        )?;
        Ok(())
    }

    pub async fn list_cap_table_entries(&self, trust_id: &str) -> Result<Vec<CapTableEntry>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, trust_id, allocation_key, holder_kind, holder_id,
                    security_type, basis_points, vesting_months, cliff_months, created_at
             FROM cap_table_entries
             WHERE trust_id = ?1
             ORDER BY allocation_key ASC",
        )?;
        let rows = stmt.query_map(params![trust_id], |row| {
            Ok(CapTableEntry {
                id: row.get(0)?,
                trust_id: row.get(1)?,
                allocation_key: row.get(2)?,
                holder_kind: row.get(3)?,
                holder_id: row.get(4)?,
                security_type: row.get(5)?,
                basis_points: row.get(6)?,
                vesting_months: row.get(7)?,
                cliff_months: row.get(8)?,
                created_at: row.get(9)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub async fn list_entity_views(
        &self,
        trust_id: &str,
        owner_user_id: Option<&str>,
    ) -> Result<Vec<EntityView>> {
        let owner = normalize_entity_view_owner(owner_user_id);
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, trust_id, owner_user_id, key, label, kind, scope, path, search,
                    layout_json, pinned, sort_order, created_at, updated_at
             FROM entity_views
             WHERE trust_id = ?1
               AND (owner_user_id = '' OR owner_user_id = ?2)
             ORDER BY pinned DESC, sort_order ASC, label ASC, key ASC",
        )?;
        let rows = stmt.query_map(params![trust_id, owner], entity_view_from_row)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(Into::into)
    }

    pub async fn upsert_entity_views(
        &self,
        trust_id: &str,
        owner_user_id: Option<&str>,
        views: Vec<EntityViewUpsert>,
    ) -> Result<Vec<EntityView>> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        for view in views {
            validate_entity_view(&view)?;
            let owner = if view.scope == "public" {
                String::new()
            } else {
                normalize_entity_view_owner(owner_user_id)
            };
            let layout_json = view
                .layout_json
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?;
            db.execute(
                "INSERT INTO entity_views (
                     id, trust_id, owner_user_id, key, label, kind, scope, path, search,
                     layout_json, pinned, sort_order, created_at, updated_at
                 )
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
                 ON CONFLICT(trust_id, owner_user_id, key) DO UPDATE SET
                     label = excluded.label,
                     kind = excluded.kind,
                     scope = excluded.scope,
                     path = excluded.path,
                     search = excluded.search,
                     layout_json = excluded.layout_json,
                     pinned = excluded.pinned,
                     sort_order = excluded.sort_order,
                     updated_at = excluded.updated_at",
                params![
                    view.id
                        .filter(|id| !id.trim().is_empty())
                        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                    trust_id,
                    owner,
                    view.key.trim(),
                    view.label.trim(),
                    view.kind,
                    view.scope,
                    view.path
                        .as_deref()
                        .map(str::trim)
                        .filter(|path| !path.is_empty()),
                    view.search
                        .as_deref()
                        .map(str::trim)
                        .filter(|search| !search.is_empty()),
                    layout_json,
                    if view.pinned { 1_i64 } else { 0_i64 },
                    view.sort_order,
                    now,
                    now,
                ],
            )?;
        }
        drop(db);
        self.list_entity_views(trust_id, owner_user_id).await
    }

    pub async fn delete_entity_view(
        &self,
        trust_id: &str,
        owner_user_id: Option<&str>,
        id_or_key: &str,
    ) -> Result<usize> {
        let owner = normalize_entity_view_owner(owner_user_id);
        let db = self.db.lock().await;
        let changed = db.execute(
            "DELETE FROM entity_views
             WHERE trust_id = ?1
               AND owner_user_id = ?2
               AND (id = ?3 OR key = ?3)",
            params![trust_id, owner, id_or_key],
        )?;
        Ok(changed)
    }

    /// Expose the template connection pool (aeqi.db: agents, events, ideas, quest_sequences).
    pub fn db(&self) -> Arc<ConnectionPool> {
        self.db.clone()
    }

    /// Expose the journal connection pool (sessions.db: sessions, activity, runs, quests).
    pub fn sessions_db(&self) -> Arc<ConnectionPool> {
        self.sessions_db.clone()
    }

    // -- Channel Sessions CRUD -----------------------------------------------

    /// Look up or create a channel session for a given channel_key.
    ///
    /// channel_key is a stable identifier like "telegram:{agent_id}:{chat_id}".
    /// Returns the session_id (existing or newly created).
    pub async fn get_or_create_channel_session(
        &self,
        channel_key: &str,
        agent_id: &str,
    ) -> Result<String> {
        let db = self.sessions_db.lock().await;

        // Try to find existing.
        let existing: Option<String> = db
            .query_row(
                "SELECT session_id FROM channel_sessions WHERE channel_key = ?1",
                params![channel_key],
                |row| row.get(0),
            )
            .optional()?;

        if let Some(session_id) = existing {
            return Ok(session_id);
        }

        // Create a new session_id.
        let session_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        db.execute(
            "INSERT INTO channel_sessions (channel_key, session_id, agent_id, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![channel_key, session_id, agent_id, now],
        )?;

        debug!(channel_key, session_id = %session_id, "created channel session");
        Ok(session_id)
    }

    /// Typed wrapper around `get_or_create_channel_session`.
    ///
    /// Prefer this in new runtime code; the string-taking method remains for
    /// compatibility with older gateway call sites.
    pub async fn get_or_create_channel_session_for_key(
        &self,
        key: &ChannelSessionKey,
    ) -> Result<String> {
        self.get_or_create_channel_session(&key.as_key(), &key.agent_id)
            .await
    }

    /// List all channel sessions for a given agent.
    /// Returns (channel_key, session_id, created_at) tuples.
    pub async fn list_channel_sessions(
        &self,
        agent_id: &str,
    ) -> Result<Vec<(String, String, String)>> {
        let db = self.sessions_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT channel_key, session_id, created_at FROM channel_sessions WHERE agent_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt
            .query_map(params![agent_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Typed view of channel sessions for a given agent.
    ///
    /// Invalid persisted keys return an error so operators see corruption
    /// instead of receiving an incomplete runtime picture.
    pub async fn list_channel_session_records(
        &self,
        agent_id: &str,
    ) -> Result<Vec<ChannelSessionRecord>> {
        self.list_channel_sessions(agent_id)
            .await?
            .into_iter()
            .map(|(channel_key, session_id, created_at)| {
                let key = ChannelSessionKey::parse(&channel_key)?;
                Ok(ChannelSessionRecord {
                    key,
                    session_id,
                    created_at,
                })
            })
            .collect()
    }

    /// Look up channel_key for a given session_id (reverse lookup).
    pub async fn get_channel_key_for_session(&self, session_id: &str) -> Result<Option<String>> {
        let db = self.sessions_db.lock().await;
        let key: Option<String> = db
            .query_row(
                "SELECT channel_key FROM channel_sessions WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()?;
        Ok(key)
    }

    /// Typed reverse lookup for a channel-bound session.
    ///
    /// Invalid legacy keys surface as an error rather than being silently
    /// treated as "not a channel session".
    pub async fn get_channel_session_key_for_session(
        &self,
        session_id: &str,
    ) -> Result<Option<ChannelSessionKey>> {
        self.get_channel_key_for_session(session_id)
            .await?
            .map(|key| ChannelSessionKey::parse(&key).map_err(anyhow::Error::from))
            .transpose()
    }

    /// List quest IDs that have been in_progress for more than `max_hours` with no updates.
    pub async fn list_stale_quests(&self, max_hours: u32) -> Result<Vec<String>> {
        let cutoff = (chrono::Utc::now() - chrono::Duration::hours(max_hours as i64)).to_rfc3339();
        let db = self.sessions_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id FROM quests
             WHERE status = 'in_progress'
             AND (updated_at IS NULL OR updated_at < ?1)
             AND created_at < ?1",
        )?;
        let ids: Vec<String> = stmt
            .query_map(params![cutoff], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    // -- Cross-DB orphan cleanup ----------------------------------------------

    /// Clean up orphaned records in sessions.db for agents that no longer exist in aeqi.db.
    pub async fn cleanup_orphaned_sessions(&self) -> Result<usize> {
        let known_ids: std::collections::HashSet<String> = {
            let db = self.db.lock().await;
            let mut stmt = db.prepare("SELECT id FROM agents")?;
            stmt.query_map([], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect()
        };

        let sdb = self.sessions_db.lock().await;
        let now = chrono::Utc::now().to_rfc3339();
        let mut total_affected = 0usize;

        // 1. Close orphaned sessions (active sessions with agent_ids not in aeqi.db).
        {
            let mut stmt = sdb.prepare(
                "SELECT DISTINCT agent_id FROM sessions WHERE agent_id IS NOT NULL AND status = 'active'",
            )?;
            let orphan_agent_ids: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .filter(|id| !known_ids.contains(id))
                .collect();
            for agent_id in &orphan_agent_ids {
                let closed = sdb.execute(
                    "UPDATE sessions SET status = 'closed', closed_at = ?1
                     WHERE agent_id = ?2 AND status = 'active'",
                    params![now, agent_id],
                )?;
                if closed > 0 {
                    info!(agent_id = %agent_id, sessions = closed, "closed orphaned sessions");
                    total_affected += closed;
                }
            }
        }

        // 2. Prune old messages from sessions closed > 30 days ago.
        {
            let cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).to_rfc3339();
            let deleted = sdb.execute(
                "DELETE FROM session_messages WHERE session_id IN (
                     SELECT id FROM sessions WHERE status = 'closed' AND closed_at < ?1
                 )",
                params![cutoff],
            )?;
            if deleted > 0 {
                info!(
                    messages = deleted,
                    "pruned old messages from sessions closed > 30 days ago"
                );
                total_affected += deleted;
            }
        }

        // 3. Remove channel_sessions for non-existent agents.
        {
            let mut stmt = sdb.prepare("SELECT DISTINCT agent_id FROM channel_sessions")?;
            let orphan_channel_agents: Vec<String> = stmt
                .query_map([], |row| row.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .filter(|id| !known_ids.contains(id))
                .collect();
            for agent_id in &orphan_channel_agents {
                let deleted = sdb.execute(
                    "DELETE FROM channel_sessions WHERE agent_id = ?1",
                    params![agent_id],
                )?;
                if deleted > 0 {
                    info!(agent_id = %agent_id, count = deleted, "removed orphaned channel_sessions");
                    total_affected += deleted;
                }
            }
        }

        if total_affected > 0 {
            info!(
                total = total_affected,
                "cross-database orphan cleanup complete"
            );
        }
        Ok(total_affected)
    }

    /// List the default agent for every entity — the agent whose role has
    /// no incoming edges in the role DAG. A role-DAG model can carry
    /// multiple topmost roles per entity (e.g. a board); today every
    /// entity has exactly one.
    pub async fn list_entity_agents(&self) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT DISTINCT a.* FROM agents a
             JOIN roles r ON r.occupant_kind = 'agent' AND r.occupant_id = a.id
             WHERE r.id NOT IN (SELECT child_role_id FROM role_edges)
             ORDER BY a.name",
        )?;
        let agents = stmt
            .query_map([], |row| Ok(row_to_agent(row)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    // ── Drive / files ──────────────────────────────────────────────────────
    //
    // Files are scoped to a single agent. Access follows the agent's visibility
    // (enforced at the IPC layer via `allowed_roots`). The blob lives on disk
    // at `{data_dir}/files/{id}`; the row here is the metadata.

    /// Insert a file metadata row. Call `file_store::write_blob` first to land
    /// the bytes on disk — this function does not touch the blob store.
    pub async fn create_file(
        &self,
        id: &str,
        agent_id: &str,
        name: &str,
        mime: &str,
        size_bytes: u64,
        storage_path: &str,
        uploaded_by: Option<&str>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO files (id, agent_id, name, mime, size_bytes, storage_path, uploaded_by, uploaded_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, agent_id, name, mime, size_bytes as i64, storage_path, uploaded_by, now],
        )?;
        Ok(())
    }

    /// List files for a specific agent, newest upload first.
    pub async fn list_files_for_agent(&self, agent_id: &str) -> Result<Vec<serde_json::Value>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT id, agent_id, name, mime, size_bytes, uploaded_by, uploaded_at \
             FROM files WHERE agent_id = ?1 ORDER BY uploaded_at DESC",
        )?;
        let files = stmt
            .query_map(params![agent_id], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, String>(0)?,
                    "agent_id": row.get::<_, String>(1)?,
                    "name": row.get::<_, String>(2)?,
                    "mime": row.get::<_, String>(3)?,
                    "size_bytes": row.get::<_, i64>(4)?,
                    "uploaded_by": row.get::<_, Option<String>>(5)?,
                    "uploaded_at": row.get::<_, String>(6)?,
                }))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(files)
    }

    /// Fetch a single file's metadata by id. Returns None if not found.
    pub async fn get_file(&self, id: &str) -> Result<Option<serde_json::Value>> {
        let db = self.db.lock().await;
        let row = db
            .query_row(
                "SELECT id, agent_id, name, mime, size_bytes, uploaded_by, uploaded_at \
                 FROM files WHERE id = ?1",
                params![id],
                |row| {
                    Ok(serde_json::json!({
                        "id": row.get::<_, String>(0)?,
                        "agent_id": row.get::<_, String>(1)?,
                        "name": row.get::<_, String>(2)?,
                        "mime": row.get::<_, String>(3)?,
                        "size_bytes": row.get::<_, i64>(4)?,
                        "uploaded_by": row.get::<_, Option<String>>(5)?,
                        "uploaded_at": row.get::<_, String>(6)?,
                    }))
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Delete the metadata row. Caller is responsible for calling
    /// `file_store::delete_blob` to remove bytes from disk.
    pub async fn delete_file(&self, id: &str) -> Result<bool> {
        let db = self.db.lock().await;
        let affected = db.execute("DELETE FROM files WHERE id = ?1", params![id])?;
        Ok(affected > 0)
    }
}

/// Convert a SQLite row to a Task.
fn row_to_task(row: &rusqlite::Row) -> aeqi_quests::Quest {
    let checkpoints_str: String = row.get("checkpoints").unwrap_or_else(|_| "[]".to_string());
    let deps_str: String = row.get("depends_on").unwrap_or_else(|_| "[]".to_string());
    let metadata_str: String = row.get("metadata").unwrap_or_else(|_| "{}".to_string());
    let outcome_str: String = row.get("outcome").unwrap_or_else(|_| String::new());

    // Status string parser. Legacy "pending" / "blocked" rows from
    // before the v5.2 status rename get mapped on read so the
    // five-status enum is never surprised — the boot migration also
    // rewrites them in place, but the read-side fallback covers any
    // stragglers (incl. JSONL replay paths that bypass the SQL UPDATE).
    let status_str: String = row.get("status").unwrap_or_else(|_| "todo".to_string());
    let status = match status_str.as_str() {
        "backlog" => aeqi_quests::QuestStatus::Backlog,
        "todo" => aeqi_quests::QuestStatus::Todo,
        "in_progress" => aeqi_quests::QuestStatus::InProgress,
        "done" => aeqi_quests::QuestStatus::Done,
        "cancelled" => aeqi_quests::QuestStatus::Cancelled,
        // Legacy values:
        "pending" => aeqi_quests::QuestStatus::Todo,
        "blocked" => aeqi_quests::QuestStatus::Backlog,
        _ => aeqi_quests::QuestStatus::Todo,
    };

    let priority_str: String = row.get("priority").unwrap_or_else(|_| "normal".to_string());
    let priority = match priority_str.as_str() {
        "low" => aeqi_quests::quest::Priority::Low,
        "high" => aeqi_quests::quest::Priority::High,
        "critical" => aeqi_quests::quest::Priority::Critical,
        _ => aeqi_quests::quest::Priority::Normal,
    };

    // Parse outcome from the dedicated column, falling back to legacy closed_reason.
    let outcome: Option<aeqi_quests::QuestOutcomeRecord> = if !outcome_str.is_empty() {
        serde_json::from_str(&outcome_str).ok()
    } else {
        // Legacy fallback: synthesize from closed_reason if present.
        row.get::<_, String>("closed_reason")
            .ok()
            .filter(|s| !s.is_empty())
            .map(|reason| {
                let kind = if status_str == "cancelled" {
                    aeqi_quests::QuestOutcomeKind::Cancelled
                } else {
                    aeqi_quests::QuestOutcomeKind::Done
                };
                aeqi_quests::QuestOutcomeRecord::new(kind, reason)
            })
    };

    let quest_scope: Scope = row
        .get::<_, String>("scope")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(Scope::SelfScope);

    aeqi_quests::Quest {
        id: aeqi_quests::QuestId(row.get("id").unwrap_or_default()),
        idea_id: row.get::<_, String>("idea_id").unwrap_or_default(),
        idea: None,
        status,
        priority,
        kind: "task".to_string(),
        agent_id: row.get("agent_id").ok(),
        assignee: row.get::<_, Option<String>>("assignee").unwrap_or(None),
        scope: quest_scope,
        depends_on: serde_json::from_str(&deps_str).unwrap_or_default(),
        retry_count: row.get::<_, u32>("retry_count").unwrap_or(0),
        checkpoints: serde_json::from_str(&checkpoints_str).unwrap_or_default(),
        metadata: serde_json::from_str(&metadata_str).unwrap_or(serde_json::Value::Null),
        created_at: row
            .get::<_, String>("created_at")
            .ok()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or_default(),
        updated_at: row
            .get::<_, String>("updated_at")
            .ok()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        closed_at: row
            .get::<_, String>("closed_at")
            .ok()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&chrono::Utc)),
        // due_at is stored as a Unix-second integer (Phase-2 column).
        // Legacy rows that pre-date the column read NULL via `get().ok()`
        // and decode to None.
        due_at: row
            .get::<_, Option<i64>>("due_at")
            .ok()
            .flatten()
            .and_then(|s| chrono::DateTime::<chrono::Utc>::from_timestamp(s, 0)),
        outcome,
        worktree_branch: row.get("worktree_branch").ok(),
        worktree_path: row.get("worktree_path").ok(),
        creator_session_id: row.get("creator_session_id").ok(),
    }
}

fn row_to_agent(row: &rusqlite::Row) -> Agent {
    let status_str: String = row.get("status").unwrap_or_default();
    let status = match status_str.as_str() {
        "paused" => AgentStatus::Paused,
        "retired" => AgentStatus::Retired,
        _ => AgentStatus::Active,
    };
    Agent {
        id: row.get("id").unwrap_or_default(),
        name: row.get("name").unwrap_or_default(),
        trust_id: row.get("trust_id").ok(),
        model: row.get("model").ok(),
        status,
        created_at: row
            .get::<_, String>("created_at")
            .ok()
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_default(),
        last_active: row
            .get::<_, String>("last_active")
            .ok()
            .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
            .map(|d| d.with_timezone(&Utc)),
        session_count: row.get("session_count").unwrap_or(0),
        total_tokens: row.get::<_, i64>("total_tokens").unwrap_or(0) as u64,
        lifetime_cost_usd: row.get::<_, f64>("lifetime_cost_usd").unwrap_or(0.0),
        color: row.get("color").ok(),
        avatar: row.get("avatar").ok(),
        faces: row
            .get::<_, String>("faces")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok()),
        max_concurrent: row.get::<_, u32>("max_concurrent").unwrap_or(1),
        session_id: row.get("session_id").ok(),
        workdir: row.get("workdir").ok(),
        budget_usd: row.get("budget_usd").ok(),
        execution_mode: row.get("execution_mode").ok(),
        quest_prefix: row.get("quest_prefix").ok(),
        worker_timeout_secs: row
            .get::<_, i64>("worker_timeout_secs")
            .ok()
            .map(|v| v as u64),
        tool_deny: row
            .get::<_, String>("tool_deny")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        can_self_delegate: row.get::<_, i64>("can_self_delegate").unwrap_or(0) != 0,
        can_ask_director: row.get::<_, i64>("can_ask_director").unwrap_or(0) != 0,
        inference_cap: row
            .get::<_, Option<String>>("inference_cap")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok()),
        compactor_model: row
            .get::<_, Option<String>>("compactor_model")
            .ok()
            .flatten(),
        compactor_provider: row
            .get::<_, Option<String>>("compactor_provider")
            .ok()
            .flatten(),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_registry() -> AgentRegistry {
        let dir = tempfile::tempdir().unwrap();
        AgentRegistry::open(dir.path()).unwrap()
    }

    #[test]
    fn inference_capability_allows_matching_provider_and_model() {
        let cap = InferenceCapability {
            allowed_providers: Some(vec!["openrouter".to_string()]),
            allowed_models: Some(vec!["anthropic/claude-sonnet-4.6".to_string()]),
            max_cost_per_call_usd: Some(0.25),
        };

        assert!(
            cap.allows_request("openrouter", "anthropic/claude-sonnet-4.6")
                .is_ok()
        );
    }

    #[test]
    fn inference_capability_rejects_disallowed_provider() {
        let cap = InferenceCapability {
            allowed_providers: Some(vec!["anthropic".to_string()]),
            allowed_models: None,
            max_cost_per_call_usd: None,
        };

        let err = cap
            .allows_request("openrouter", "anthropic/claude-sonnet-4.6")
            .unwrap_err();

        assert!(matches!(
            err,
            InferenceCapabilityError::CapabilityViolation { .. }
        ));
    }

    #[test]
    fn inference_capability_rejects_disallowed_model() {
        let cap = InferenceCapability {
            allowed_providers: None,
            allowed_models: Some(vec!["openai/gpt-5.2".to_string()]),
            max_cost_per_call_usd: None,
        };

        let err = cap
            .allows_request("openrouter", "anthropic/claude-sonnet-4.6")
            .unwrap_err();

        assert!(matches!(
            err,
            InferenceCapabilityError::CapabilityViolation { .. }
        ));
    }

    // ── Quest 67-180.4 deliverable 9: compactor overrides round-trip ───────────

    #[tokio::test]
    async fn compactor_overrides_round_trip_on_agent() {
        let registry = test_registry().await;
        let agent = registry
            .spawn("compactor-agent", None, Some("anthropic/claude-sonnet-4.6"))
            .await
            .unwrap();
        assert!(agent.compactor_model.is_none());
        assert!(agent.compactor_provider.is_none());

        registry
            .set_compactor_overrides(
                &agent.id,
                Some("anthropic/claude-haiku-4.5"),
                Some("anthropic"),
            )
            .await
            .unwrap();
        let loaded = registry.get(&agent.id).await.unwrap().unwrap();
        assert_eq!(
            loaded.compactor_model.as_deref(),
            Some("anthropic/claude-haiku-4.5")
        );
        assert_eq!(loaded.compactor_provider.as_deref(), Some("anthropic"));

        // Clearing both flips back to None.
        registry
            .set_compactor_overrides(&agent.id, None, None)
            .await
            .unwrap();
        let loaded = registry.get(&agent.id).await.unwrap().unwrap();
        assert!(loaded.compactor_model.is_none());
        assert!(loaded.compactor_provider.is_none());
    }

    #[tokio::test]
    async fn inference_capability_round_trips_on_agent() {
        let registry = test_registry().await;
        let agent = registry
            .spawn("cap-agent", None, Some("anthropic/claude-sonnet-4.6"))
            .await
            .unwrap();

        assert!(agent.inference_cap.is_none());

        let cap = InferenceCapability {
            allowed_providers: Some(vec!["openrouter".to_string()]),
            allowed_models: Some(vec!["anthropic/claude-sonnet-4.6".to_string()]),
            max_cost_per_call_usd: None,
        };
        registry
            .set_inference_capability(&agent.id, Some(&cap))
            .await
            .unwrap();

        let loaded = registry.get(&agent.id).await.unwrap().unwrap();
        assert_eq!(loaded.inference_cap, Some(cap));

        registry
            .set_inference_capability(&agent.id, None)
            .await
            .unwrap();
        let loaded = registry.get(&agent.id).await.unwrap().unwrap();
        assert!(loaded.inference_cap.is_none());
    }

    /// Minimal-schema fixture for `backfill_quest_idea_ids`. We don't reuse
    /// `AgentRegistry::open` here because the goal is to drive the function
    /// directly against handcrafted legacy rows.
    fn backfill_fixture() -> (tempfile::TempDir, Connection, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let idea_path = dir.path().join("aeqi.db");
        let quest_path = dir.path().join("sessions.db");

        let idea_conn = Connection::open(&idea_path).unwrap();
        idea_conn
            .execute_batch("PRAGMA foreign_keys = ON;")
            .unwrap();
        aeqi_ideas::SqliteIdeas::prepare_schema(&idea_conn).unwrap();
        idea_conn
            .execute_batch(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_ideas_agent_name_unique
                     ON ideas(COALESCE(agent_id, ''), name);",
            )
            .unwrap();

        let quest_conn = Connection::open(&quest_path).unwrap();
        // Mirrors the legacy on-disk schema so the rebuild path can SELECT
        // every preserved lifecycle column. Columns the cleanup drops
        // (subject / description / acceptance_criteria / labels / idea_ids)
        // sit alongside the canonical ones the rebuild keeps.
        quest_conn
            .execute_batch(
                "CREATE TABLE quests (
                     id TEXT PRIMARY KEY,
                     subject TEXT NOT NULL,
                     description TEXT NOT NULL DEFAULT '',
                     status TEXT NOT NULL DEFAULT 'todo',
                     priority TEXT NOT NULL DEFAULT 'normal',
                     agent_id TEXT,
                     scope TEXT NOT NULL DEFAULT 'self',
                     idea_ids TEXT NOT NULL DEFAULT '[]',
                     idea_id TEXT,
                     labels TEXT NOT NULL DEFAULT '[]',
                     retry_count INTEGER NOT NULL DEFAULT 0,
                     checkpoints TEXT NOT NULL DEFAULT '[]',
                     metadata TEXT NOT NULL DEFAULT '{}',
                     depends_on TEXT NOT NULL DEFAULT '[]',
                     acceptance_criteria TEXT,
                     outcome TEXT,
                     worktree_branch TEXT,
                     worktree_path TEXT,
                     created_at TEXT NOT NULL,
                     updated_at TEXT,
                     closed_at TEXT,
                     closed_reason TEXT,
                     creator_session_id TEXT
                 );",
            )
            .unwrap();
        (dir, idea_conn, quest_conn)
    }

    #[test]
    fn backfill_links_legacy_quest_to_synthetic_idea() {
        let (_dir, idea_conn, quest_conn) = backfill_fixture();

        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, description, scope, agent_id,
                                     labels, acceptance_criteria, created_at)
                 VALUES (?1, ?2, ?3, 'self', ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    "as-001",
                    "Fix login bug",
                    "Login is broken on Safari",
                    "agent-1",
                    "[\"bug\",\"frontend\"]",
                    "User can log in on Safari without errors",
                    Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();

        let linked = backfill_quest_idea_ids(&idea_conn, &quest_conn).unwrap();
        assert_eq!(linked, 1);

        let idea_id: String = quest_conn
            .query_row("SELECT idea_id FROM quests WHERE id = 'as-001'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(!idea_id.is_empty());

        let (name, content, scope, agent_id): (String, String, String, Option<String>) = idea_conn
            .query_row(
                "SELECT name, content, scope, agent_id FROM ideas WHERE id = ?1",
                rusqlite::params![idea_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(name, "Fix login bug");
        assert!(content.contains("Login is broken on Safari"));
        assert!(content.contains("## Acceptance"));
        assert!(content.contains("User can log in on Safari without errors"));
        assert_eq!(scope, "self");
        assert_eq!(agent_id.as_deref(), Some("agent-1"));

        let tags: Vec<String> = idea_conn
            .prepare("SELECT tag FROM idea_tags WHERE idea_id = ?1 ORDER BY tag")
            .unwrap()
            .query_map(rusqlite::params![idea_id], |r| r.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert!(tags.contains(&"bug".to_string()));
        assert!(tags.contains(&"frontend".to_string()));
        assert!(tags.contains(&"aeqi:backfill".to_string()));
    }

    #[test]
    fn backfill_is_idempotent() {
        let (_dir, idea_conn, quest_conn) = backfill_fixture();

        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, description, agent_id, created_at)
                 VALUES ('as-001', 'Quest A', 'Body', 'agent-1', ?1)",
                rusqlite::params![Utc::now().to_rfc3339()],
            )
            .unwrap();

        let first = backfill_quest_idea_ids(&idea_conn, &quest_conn).unwrap();
        let second = backfill_quest_idea_ids(&idea_conn, &quest_conn).unwrap();
        assert_eq!(first, 1);
        assert_eq!(second, 0);

        let idea_count: i64 = idea_conn
            .query_row("SELECT COUNT(*) FROM ideas", [], |r| r.get(0))
            .unwrap();
        assert_eq!(idea_count, 1);
    }

    #[test]
    fn backfill_reuses_existing_idea_by_name() {
        let (_dir, idea_conn, quest_conn) = backfill_fixture();

        // Pre-existing idea with the same (agent_id, name) the quest will
        // resolve to: the backfill must link rather than mint a duplicate.
        idea_conn
            .execute(
                "INSERT INTO ideas (id, name, content, scope, agent_id, created_at, status)
                 VALUES ('idea-pre', 'auth-spec', 'Existing body', 'self', 'agent-1', ?1, 'active')",
                rusqlite::params![Utc::now().to_rfc3339()],
            )
            .unwrap();

        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, description, agent_id, created_at)
                 VALUES ('as-001', 'auth-spec', 'New quest body', 'agent-1', ?1)",
                rusqlite::params![Utc::now().to_rfc3339()],
            )
            .unwrap();

        let linked = backfill_quest_idea_ids(&idea_conn, &quest_conn).unwrap();
        assert_eq!(linked, 1);

        let idea_id: String = quest_conn
            .query_row("SELECT idea_id FROM quests WHERE id = 'as-001'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(idea_id, "idea-pre");

        let count: i64 = idea_conn
            .query_row("SELECT COUNT(*) FROM ideas", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn backfill_handles_empty_subject_and_body() {
        let (_dir, idea_conn, quest_conn) = backfill_fixture();

        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, description, agent_id, created_at)
                 VALUES ('as-001', '', '', 'agent-1', ?1)",
                rusqlite::params![Utc::now().to_rfc3339()],
            )
            .unwrap();

        let linked = backfill_quest_idea_ids(&idea_conn, &quest_conn).unwrap();
        assert_eq!(linked, 1);

        let (name, content): (String, String) = idea_conn
            .query_row("SELECT name, content FROM ideas", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(name, "(quest as-001)");
        assert!(content.contains("backfilled from legacy quest"));
    }

    #[test]
    fn cleanup_legacy_quest_columns_rebuilds_to_canonical_shape() {
        let (_dir, _idea_conn, quest_conn) = backfill_fixture();

        // Seed two rows with the legacy editorial columns populated and
        // both pointing at minted ideas — `cleanup_legacy_quest_columns`
        // requires every quest already carries a non-null `idea_id`.
        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, description, agent_id, idea_id, created_at)
                 VALUES (?1, 'Subj A', 'Body A', 'agent-1', 'idea-a', ?2)",
                rusqlite::params!["as-001", Utc::now().to_rfc3339()],
            )
            .unwrap();
        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, description, agent_id, idea_id, created_at)
                 VALUES (?1, 'Subj B', 'Body B', 'agent-2', 'idea-b', ?2)",
                rusqlite::params!["as-002", Utc::now().to_rfc3339()],
            )
            .unwrap();

        cleanup_legacy_quest_columns(&quest_conn).unwrap();

        // Legacy columns gone; canonical shape lives.
        let cols: Vec<String> = {
            let mut stmt = quest_conn.prepare("PRAGMA table_info(quests)").unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        for legacy in [
            "subject",
            "description",
            "acceptance_criteria",
            "labels",
            "idea_ids",
        ] {
            assert!(
                !cols.iter().any(|c| c == legacy),
                "legacy column `{legacy}` still present"
            );
        }
        assert!(cols.iter().any(|c| c == "idea_id"));

        // Both rows survived with their FK + lifecycle metadata intact.
        let mut stmt = quest_conn
            .prepare("SELECT id, idea_id, agent_id FROM quests ORDER BY id ASC")
            .unwrap();
        let rows: Vec<(String, String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        assert_eq!(
            rows,
            vec![
                (
                    "as-001".to_string(),
                    "idea-a".to_string(),
                    "agent-1".to_string()
                ),
                (
                    "as-002".to_string(),
                    "idea-b".to_string(),
                    "agent-2".to_string()
                ),
            ]
        );

        // `idea_id` is now NOT NULL — inserting a row without one fails.
        let err = quest_conn.execute(
            "INSERT INTO quests (id, status, priority, scope, created_at)
             VALUES ('as-003', 'todo', 'normal', 'self', ?1)",
            rusqlite::params![Utc::now().to_rfc3339()],
        );
        assert!(err.is_err(), "NOT NULL constraint should reject the insert");

        // Indexes recreated.
        let idx_count: i64 = quest_conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master
                 WHERE type='index' AND tbl_name='quests' AND name LIKE 'idx_quests_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(idx_count, 4);
    }

    #[test]
    fn cleanup_legacy_quest_columns_is_idempotent() {
        let (_dir, _idea_conn, quest_conn) = backfill_fixture();

        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, agent_id, idea_id, created_at)
                 VALUES ('as-001', 'Subj', 'agent-1', 'idea-a', ?1)",
                rusqlite::params![Utc::now().to_rfc3339()],
            )
            .unwrap();

        cleanup_legacy_quest_columns(&quest_conn).unwrap();
        // Second run is a pure no-op — no schema churn, no row loss.
        cleanup_legacy_quest_columns(&quest_conn).unwrap();

        let count: i64 = quest_conn
            .query_row("SELECT COUNT(*) FROM quests", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn cleanup_legacy_quest_columns_aborts_on_null_idea_id() {
        let (_dir, _idea_conn, quest_conn) = backfill_fixture();

        // Row deliberately left with `idea_id IS NULL` — the cleanup must
        // refuse to drop the legacy columns and lose its editorial body.
        quest_conn
            .execute(
                "INSERT INTO quests (id, subject, agent_id, created_at)
                 VALUES ('as-001', 'Pre-backfill', 'agent-1', ?1)",
                rusqlite::params![Utc::now().to_rfc3339()],
            )
            .unwrap();

        assert!(cleanup_legacy_quest_columns(&quest_conn).is_err());

        // Schema untouched — legacy columns still there.
        let cols: Vec<String> = {
            let mut stmt = quest_conn.prepare("PRAGMA table_info(quests)").unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(cols.iter().any(|c| c == "subject"));
    }

    /// Reproduce the exact pre-Phase-4 production shape: one entity row,
    /// one agent row, one position row — all sharing the same UUID. Run
    /// the open() boot sequence and assert the post-migration invariants:
    ///
    /// - `agents.parent_id` column is gone.
    /// - `agent_ancestry` and `agent_directors` tables are gone.
    /// - The entity has a fresh UUID, distinct from the agent UUID.
    /// - `agents.trust_id` is rewritten to point at the fresh UUID.
    /// - `positions.trust_id` is rewritten to the fresh UUID.
    /// - The migration is idempotent — running open() a second time is a no-op.
    #[tokio::test]
    async fn phase4_migration_decouples_legacy_uuids() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("aeqi.db");

        // Build the legacy schema by hand and seed with the production shape.
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 CREATE TABLE agents (
                     id TEXT PRIMARY KEY,
                     name TEXT NOT NULL,
                     parent_id TEXT,
                     trust_id TEXT,
                     status TEXT NOT NULL DEFAULT 'active',
                     created_at TEXT NOT NULL,
                     last_active TEXT,
                     session_count INTEGER NOT NULL DEFAULT 0,
                     total_tokens INTEGER NOT NULL DEFAULT 0,
                     model TEXT,
                     display_name TEXT,
                     color TEXT,
                     avatar TEXT,
                     faces TEXT,
                     max_concurrent INTEGER NOT NULL DEFAULT 1,
                     session_id TEXT,
                     workdir TEXT,
                     budget_usd REAL,
                     execution_mode TEXT,
                     quest_prefix TEXT,
                     worker_timeout_secs INTEGER,
                     tool_deny TEXT NOT NULL DEFAULT '[]',
                     can_self_delegate INTEGER NOT NULL DEFAULT 0,
                     can_ask_director INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE INDEX idx_agents_parent ON agents(parent_id);
                 CREATE TABLE agent_ancestry (
                     descendant_id TEXT NOT NULL,
                     ancestor_id TEXT NOT NULL,
                     depth INTEGER NOT NULL,
                     PRIMARY KEY (descendant_id, ancestor_id)
                 );",
            )
            .unwrap();

            // Single root agent, just like the live Luca Eich entry.
            let shared_id = "1b6bcf4e-79f0-4d8e-9a55-501e87149836";
            conn.execute(
                "INSERT INTO agents (id, name, parent_id, trust_id, created_at)
                 VALUES (?1, 'Luca Eich', NULL, ?1, '2026-04-01T00:00:00Z')",
                params![shared_id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO agent_ancestry (descendant_id, ancestor_id, depth) VALUES (?1, ?1, 0)",
                params![shared_id],
            )
            .unwrap();
        }

        // Open the registry — this fires every Phase-4 migration helper.
        let _registry = AgentRegistry::open(dir.path()).unwrap();

        // Re-open the file directly to inspect the post-migration shape.
        let conn = Connection::open(&db_path).unwrap();

        // 1. parent_id column is gone.
        let agent_cols: Vec<String> = {
            let mut stmt = conn.prepare("PRAGMA table_info(agents)").unwrap();
            stmt.query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(|r| r.ok())
                .collect()
        };
        assert!(
            !agent_cols.iter().any(|c| c == "parent_id"),
            "agents.parent_id must be dropped",
        );

        // 2. agent_ancestry table is gone.
        let has_ancestry: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_ancestry'",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        assert!(
            has_ancestry.is_none(),
            "agent_ancestry table must be dropped"
        );

        // 3. Entity UUID is fresh; agent UUID stays.
        let agent_id = "1b6bcf4e-79f0-4d8e-9a55-501e87149836";
        let agent_entity_id: String = conn
            .query_row(
                "SELECT trust_id FROM agents WHERE id = ?1",
                params![agent_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_ne!(
            agent_entity_id, agent_id,
            "entity UUID must be decoupled from the agent UUID",
        );

        let entity_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entities WHERE id = ?1",
                params![agent_entity_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(entity_count, 1, "entity row must live at the fresh UUID");

        let old_entity_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entities WHERE id = ?1",
                params![agent_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            old_entity_count, 0,
            "the legacy entity row sharing the agent UUID must be deleted",
        );

        // 4. Role re-pointed.
        let role_entity_id: String = conn
            .query_row(
                "SELECT trust_id FROM roles WHERE occupant_id = ?1",
                params![agent_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(role_entity_id, agent_entity_id);

        // 5. Idempotence: a second open() is a clean no-op.
        drop(conn);
        let _registry2 = AgentRegistry::open(dir.path()).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        let entity_count_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM entities WHERE id = ?1",
                params![agent_entity_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            entity_count_after, 1,
            "second open() must not duplicate or drop the entity row"
        );
    }

    #[tokio::test]
    async fn spawn_and_get() {
        let reg = test_registry().await;
        let agent = reg
            .spawn("Shadow", None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        assert_eq!(agent.name, "Shadow");
        assert!(agent.trust_id.is_some(), "spawned agent must own an entity");
        assert_ne!(
            agent.trust_id.as_deref(),
            Some(agent.id.as_str()),
            "entity UUID must be distinct from agent UUID"
        );
        assert_eq!(agent.status, AgentStatus::Active);

        let fetched = reg.get(&agent.id).await.unwrap().unwrap();
        assert_eq!(fetched.id, agent.id);
    }

    #[tokio::test]
    async fn parent_child_relationship() {
        let reg = test_registry().await;
        let root = reg.spawn("assistant", None, None).await.unwrap();
        let child = reg
            .spawn("engineering", Some(&root.id), None)
            .await
            .unwrap();
        let grandchild = reg.spawn("backend", Some(&child.id), None).await.unwrap();

        // Children
        let children = reg.get_children(&root.id).await.unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "engineering");

        // Ancestors
        let ancestors = reg.get_ancestors(&grandchild.id).await.unwrap();
        assert_eq!(ancestors.len(), 3);
        assert_eq!(ancestors[0].name, "backend");
        assert_eq!(ancestors[1].name, "engineering");
        assert_eq!(ancestors[2].name, "assistant");

        // Ancestor IDs
        let ids = reg.get_ancestor_ids(&grandchild.id).await.unwrap();
        assert_eq!(
            ids,
            vec![grandchild.id.clone(), child.id.clone(), root.id.clone()]
        );
    }

    #[tokio::test]
    async fn get_default_agent() {
        let reg = test_registry().await;
        let topmost = reg.spawn("assistant", None, None).await.unwrap();
        let _child = reg.spawn("worker", Some(&topmost.id), None).await.unwrap();

        let found = reg.get_default_agent().await.unwrap().unwrap();
        assert_eq!(found.id, topmost.id);
    }

    #[tokio::test]
    async fn subtree() {
        let reg = test_registry().await;
        let root = reg.spawn("root", None, None).await.unwrap();
        let a = reg.spawn("a", Some(&root.id), None).await.unwrap();
        let _b = reg.spawn("b", Some(&root.id), None).await.unwrap();
        let _c = reg.spawn("c", Some(&a.id), None).await.unwrap();

        let tree = reg.get_subtree(&root.id).await.unwrap();
        assert_eq!(tree.len(), 4); // root + a + b + c
    }

    #[tokio::test]
    async fn move_agent_prevents_cycles() {
        let reg = test_registry().await;
        let root = reg.spawn("root", None, None).await.unwrap();
        let child = reg.spawn("child", Some(&root.id), None).await.unwrap();

        // Moving root under child would create a cycle.
        let result = reg.move_agent(&root.id, Some(&child.id)).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn finalize_quest_done_stamps_closed_at() {
        let reg = test_registry().await;
        let agent = reg.spawn("worker", None, None).await.unwrap();
        let quest = reg
            .create_task(&agent.id, "subj", "desc", &[], &[])
            .await
            .unwrap();

        reg.finalize_quest(&quest.id.0, aeqi_quests::QuestStatus::Done, false)
            .await
            .unwrap();

        let got = reg.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(got.status, aeqi_quests::QuestStatus::Done);
        assert_eq!(got.retry_count, 0);
        assert!(got.closed_at.is_some(), "Done must stamp closed_at");
    }

    #[tokio::test]
    async fn finalize_quest_retry_bumps_counter_and_leaves_closed_at_null() {
        let reg = test_registry().await;
        let agent = reg.spawn("worker", None, None).await.unwrap();
        let quest = reg
            .create_task(&agent.id, "subj", "desc", &[], &[])
            .await
            .unwrap();

        reg.finalize_quest(&quest.id.0, aeqi_quests::QuestStatus::Todo, true)
            .await
            .unwrap();
        reg.finalize_quest(&quest.id.0, aeqi_quests::QuestStatus::Todo, true)
            .await
            .unwrap();

        let got = reg.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(got.status, aeqi_quests::QuestStatus::Todo);
        assert_eq!(got.retry_count, 2);
        assert!(got.closed_at.is_none(), "Pending must not stamp closed_at");
    }

    #[tokio::test]
    async fn create_unbound_task_scoped_stores_global_quest_without_agent() {
        let reg = test_registry().await;
        let default = reg.spawn("worker", None, None).await.unwrap();
        reg.update_agent_ops(&default.id, None, None, None, Some("wk"), None)
            .await
            .unwrap();

        let quest = reg
            .create_unbound_task_scoped(
                "aeqi",
                "User-scoped MCP quest",
                "desc",
                &[],
                None,
                &[],
                None,
            )
            .await
            .unwrap();

        assert!(quest.id.0.starts_with("wk-"));
        assert_eq!(quest.agent_id, None);
        assert_eq!(quest.scope, Scope::Global);

        let stored = reg.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(stored.agent_id, None);
        assert_eq!(stored.scope, Scope::Global);
        assert!(!stored.idea_id.is_empty());
    }

    #[tokio::test]
    async fn record_session_updates_stats() {
        let reg = test_registry().await;
        let agent = reg.spawn("test", None, None).await.unwrap();

        reg.record_session(&agent.id, 5000).await.unwrap();
        reg.record_session(&agent.id, 3000).await.unwrap();

        let updated = reg.get(&agent.id).await.unwrap().unwrap();
        assert_eq!(updated.session_count, 2);
        assert_eq!(updated.total_tokens, 8000);
    }

    #[tokio::test]
    async fn record_inference_call_writes_audit_row_and_updates_rollup() {
        let reg = test_registry().await;
        let agent = reg.spawn("billable", None, None).await.unwrap();

        // Two calls under deepseek pricing (0.27 in / 1.10 out per Mtok).
        // call A: 1000 prompt + 500 completion
        // call B: 500 prompt + 250 completion
        let cost_a = aeqi_providers::estimate_cost("deepseek/deepseek-chat", 1000, 500);
        let cost_b = aeqi_providers::estimate_cost("deepseek/deepseek-chat", 500, 250);
        reg.record_inference_call(
            &agent.id,
            Some("session-A"),
            "deepseek/deepseek-chat",
            1000,
            500,
            cost_a,
            Some("EndTurn"),
            Some("corr-A"),
        )
        .await
        .unwrap();
        reg.record_inference_call(
            &agent.id,
            Some("session-B"),
            "deepseek/deepseek-chat",
            500,
            250,
            cost_b,
            Some("EndTurn"),
            Some("corr-B"),
        )
        .await
        .unwrap();

        let updated = reg.get(&agent.id).await.unwrap().unwrap();
        assert_eq!(updated.session_count, 2, "session_count counts calls");
        assert_eq!(updated.total_tokens, 1000 + 500 + 500 + 250);
        // f64 sum of two fixed inputs is exact at this magnitude — no epsilon needed.
        assert!(
            (updated.lifetime_cost_usd - (cost_a + cost_b)).abs() < 1e-12,
            "lifetime_cost_usd must accumulate atomically: got {}, want {}",
            updated.lifetime_cost_usd,
            cost_a + cost_b
        );
        assert!(updated.last_active.is_some(), "last_active must be stamped");

        // Audit table populated.
        let db = reg.db.lock().await;
        let n: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM inference_calls WHERE agent_id = ?1",
                params![agent.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(n, 2);
        let total_cost: f64 = db
            .query_row(
                "SELECT COALESCE(SUM(cost_usd), 0) FROM inference_calls WHERE agent_id = ?1",
                params![agent.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!((total_cost - (cost_a + cost_b)).abs() < 1e-12);
    }

    #[tokio::test]
    async fn get_by_name_found_and_missing() {
        let reg = test_registry().await;
        reg.spawn("shadow", None, None).await.unwrap();

        let found = reg.get_by_name("shadow").await.unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "shadow");

        let missing = reg.get_by_name("nonexistent").await.unwrap();
        assert!(missing.is_empty());
    }

    #[tokio::test]
    async fn get_active_by_name_returns_none_for_retired() {
        let reg = test_registry().await;
        let agent = reg.spawn("worker", None, None).await.unwrap();

        // Active agent should be found.
        let found = reg.get_active_by_name("worker").await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().id, agent.id);

        // Retire it.
        reg.set_status(&agent.id, AgentStatus::Retired)
            .await
            .unwrap();

        let gone = reg.get_active_by_name("worker").await.unwrap();
        assert!(gone.is_none());
    }

    #[tokio::test]
    async fn resolve_by_hint_name_uuid_partial() {
        let reg = test_registry().await;
        let agent = reg.spawn("Analyst", None, None).await.unwrap();

        let by_name = reg.resolve_by_hint("Analyst").await.unwrap();
        assert!(by_name.is_some());
        assert_eq!(by_name.unwrap().id, agent.id);

        let by_uuid = reg.resolve_by_hint(&agent.id).await.unwrap();
        assert!(by_uuid.is_some());
        assert_eq!(by_uuid.unwrap().name, "Analyst");

        let none = reg.resolve_by_hint("zzz-no-such-agent").await.unwrap();
        assert!(none.is_none());
    }

    #[tokio::test]
    async fn list_filters_by_entity_and_status() {
        let reg = test_registry().await;
        let root = reg.spawn("root", None, None).await.unwrap();
        let child_a = reg.spawn("a", Some(&root.id), None).await.unwrap();
        let _child_b = reg.spawn("b", Some(&root.id), None).await.unwrap();

        reg.set_status(&child_a.id, AgentStatus::Paused)
            .await
            .unwrap();

        let all = reg.list(None, None).await.unwrap();
        assert_eq!(all.len(), 3);

        let trust_id = root.trust_id.as_deref().unwrap();
        let entity_agents = reg.list(Some(trust_id), None).await.unwrap();
        assert_eq!(entity_agents.len(), 3);

        let entity_agents = reg.list_entity_agents().await.unwrap();
        assert_eq!(entity_agents.len(), 1);
        assert_eq!(entity_agents[0].name, "root");

        let active_in_entity = reg
            .list(Some(trust_id), Some(AgentStatus::Active))
            .await
            .unwrap();
        assert_eq!(active_in_entity.len(), 2);

        let paused = reg.list(None, Some(AgentStatus::Paused)).await.unwrap();
        assert_eq!(paused.len(), 1);
        assert_eq!(paused[0].name, "a");
    }

    #[tokio::test]
    async fn list_ideas_visible_to_does_not_propagate_by_role_title() {
        let reg = test_registry().await;
        let root = reg.spawn("director", None, None).await.unwrap();
        let alice_cto = reg.spawn("cto", Some(&root.id), None).await.unwrap();
        let bob_cto = reg.spawn("cto", Some(&root.id), None).await.unwrap();
        let now = Utc::now().to_rfc3339();

        {
            let db = reg.db.lock().await;
            db.execute(
                "INSERT INTO ideas (id, name, content, scope, agent_id, created_at, status)
                 VALUES ('idea-alice-cto', 'cto-private-plan', 'private to one CTO role holder',
                         'self', ?1, ?2, 'active')",
                params![alice_cto.id, now],
            )
            .unwrap();
        }

        let alice_visible = reg.list_ideas_visible_to(&alice_cto.id).await.unwrap();
        assert!(
            alice_visible.iter().any(|i| i.id == "idea-alice-cto"),
            "the anchoring agent must see its own idea"
        );

        let bob_visible = reg.list_ideas_visible_to(&bob_cto.id).await.unwrap();
        assert!(
            !bob_visible.iter().any(|i| i.id == "idea-alice-cto"),
            "matching role titles must not confer idea visibility"
        );

        let director_visible = reg.list_ideas_visible_to(&root.id).await.unwrap();
        assert!(
            director_visible.iter().any(|i| i.id == "idea-alice-cto"),
            "the explicit role DAG still lets a parent view descendant ideas"
        );
    }

    #[tokio::test]
    async fn list_active_excludes_paused_and_retired() {
        let reg = test_registry().await;
        let a = reg.spawn("active1", None, None).await.unwrap();
        let b = reg.spawn("paused1", None, None).await.unwrap();
        let c = reg.spawn("retired1", None, None).await.unwrap();
        let _d = reg.spawn("active2", None, None).await.unwrap();

        reg.set_status(&b.id, AgentStatus::Paused).await.unwrap();
        reg.set_status(&c.id, AgentStatus::Retired).await.unwrap();

        let active = reg.list_active().await.unwrap();
        assert_eq!(active.len(), 2);
        for agent in &active {
            assert_eq!(agent.status, AgentStatus::Active);
        }
        let names: Vec<&str> = active.iter().map(|a| a.name.as_str()).collect();
        assert!(names.contains(&"active1"));
        assert!(names.contains(&"active2"));
        assert!(!names.contains(&"paused1"));

        // Paused != deleted — still retrievable via get().
        let found = reg.get(&a.id).await.unwrap();
        assert!(found.is_some());
    }

    #[tokio::test]
    async fn delete_agent_reparent_promotes_children_to_grandparent() {
        let reg = test_registry().await;
        let root = reg.spawn("root", None, None).await.unwrap();
        let middle = reg.spawn("middle", Some(&root.id), None).await.unwrap();
        let leaf_a = reg.spawn("leaf_a", Some(&middle.id), None).await.unwrap();
        let leaf_b = reg.spawn("leaf_b", Some(&middle.id), None).await.unwrap();

        let deleted = reg.delete_agent(&middle.id, false).await.unwrap();
        assert_eq!(deleted, 1);

        assert!(reg.get(&middle.id).await.unwrap().is_none());
        // After delete-with-promote, leaf_a and leaf_b should report root
        // among their position-DAG ancestors.
        for leaf in [&leaf_a, &leaf_b] {
            let ancestors = reg.get_ancestor_ids(&leaf.id).await.unwrap();
            assert!(
                ancestors.contains(&root.id),
                "leaf {} should have root in ancestors after promote; got {:?}",
                leaf.name,
                ancestors,
            );
        }
    }

    #[tokio::test]
    async fn delete_agent_cascade_removes_subtree() {
        let reg = test_registry().await;
        let root = reg.spawn("root", None, None).await.unwrap();
        let branch = reg.spawn("branch", Some(&root.id), None).await.unwrap();
        let leaf = reg.spawn("leaf", Some(&branch.id), None).await.unwrap();
        let sibling = reg.spawn("sibling", Some(&root.id), None).await.unwrap();

        let deleted = reg.delete_agent(&branch.id, true).await.unwrap();
        assert_eq!(deleted, 2);

        assert!(reg.get(&branch.id).await.unwrap().is_none());
        assert!(reg.get(&leaf.id).await.unwrap().is_none());
        // Siblings outside the subtree survive.
        assert!(reg.get(&sibling.id).await.unwrap().is_some());
        assert!(reg.get(&root.id).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn delete_agent_reparent_root_orphans_children() {
        let reg = test_registry().await;
        let root = reg.spawn("root", None, None).await.unwrap();
        let child = reg.spawn("child", Some(&root.id), None).await.unwrap();

        reg.delete_agent(&root.id, false).await.unwrap();

        // After deleting the root, the child has no remaining ancestors
        // beyond itself in the position DAG.
        let ancestors = reg.get_ancestor_ids(&child.id).await.unwrap();
        assert_eq!(ancestors, vec![child.id.clone()]);
    }

    #[tokio::test]
    async fn set_status_transitions() {
        let reg = test_registry().await;
        let agent = reg.spawn("lifecycle", None, None).await.unwrap();

        assert_eq!(
            reg.get(&agent.id).await.unwrap().unwrap().status,
            AgentStatus::Active
        );

        reg.set_status(&agent.id, AgentStatus::Paused)
            .await
            .unwrap();
        assert_eq!(
            reg.get(&agent.id).await.unwrap().unwrap().status,
            AgentStatus::Paused
        );

        reg.set_status(&agent.id, AgentStatus::Retired)
            .await
            .unwrap();
        assert_eq!(
            reg.get(&agent.id).await.unwrap().unwrap().status,
            AgentStatus::Retired
        );
    }

    #[tokio::test]
    async fn create_get_list_tasks() {
        let reg = test_registry().await;
        let agent = reg.spawn("tasker", None, None).await.unwrap();

        let t1 = reg
            .create_task(&agent.id, "Build API", "Build the REST API", &[], &[])
            .await
            .unwrap();
        let t2 = reg
            .create_task(
                &agent.id,
                "Write tests",
                "Add unit tests",
                &["idea-abc".to_string()],
                &["testing".into()],
            )
            .await
            .unwrap();

        let mut fetched = reg.get_task(&t1.id.0).await.unwrap().unwrap();
        reg.hydrate_quest_idea(&mut fetched).await.unwrap();
        assert_eq!(fetched.title(), "Build API");
        assert_eq!(fetched.body(), "Build the REST API");

        let mut fetched2 = reg.get_task(&t2.id.0).await.unwrap().unwrap();
        reg.hydrate_quest_idea(&mut fetched2).await.unwrap();
        assert_eq!(fetched2.idea_tags(), &["testing".to_string()]);

        let missing = reg.get_task("no-such-task").await.unwrap();
        assert!(missing.is_none());

        let all = reg.list_tasks(None, None).await.unwrap();
        assert_eq!(all.len(), 2);

        reg.update_task_status(&t1.id.0, aeqi_quests::QuestStatus::Done)
            .await
            .unwrap();
        let mut todo = reg.list_tasks(Some("todo"), None).await.unwrap();
        for q in todo.iter_mut() {
            reg.hydrate_quest_idea(q).await.unwrap();
        }
        assert_eq!(todo.len(), 1);
        assert_eq!(todo[0].title(), "Write tests");

        let mut done = reg.list_tasks(Some("done"), None).await.unwrap();
        for q in done.iter_mut() {
            reg.hydrate_quest_idea(q).await.unwrap();
        }
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].title(), "Build API");

        let by_agent = reg.list_tasks(None, Some(&agent.id)).await.unwrap();
        assert_eq!(by_agent.len(), 2);
    }

    #[tokio::test]
    async fn update_task_persists_scope_changes() {
        let reg = test_registry().await;
        let agent = reg.spawn("tasker", None, None).await.unwrap();

        let task = reg
            .create_task(&agent.id, "Scoped quest", "desc", &[], &[])
            .await
            .unwrap();

        reg.update_task(&task.id.0, |quest| {
            quest.scope = Scope::Branch;
        })
        .await
        .unwrap();

        let fetched = reg.get_task(&task.id.0).await.unwrap().unwrap();
        assert_eq!(fetched.scope, Scope::Branch);
    }

    #[tokio::test]
    async fn update_task_persists_idea_id() {
        let reg = test_registry().await;
        let agent = reg.spawn("tasker", None, None).await.unwrap();
        let task = reg
            .create_task(&agent.id, "Linked quest", "", &[], &[])
            .await
            .unwrap();

        // Round-trips correctly via the closure form …
        reg.update_task(&task.id.0, |quest| {
            quest.idea_id = "idea-abc".to_string();
        })
        .await
        .unwrap();
        let after_update = reg.get_task(&task.id.0).await.unwrap().unwrap();
        assert_eq!(after_update.idea_id, "idea-abc");

        // … and via the dedicated setter used by the create-quest IPC.
        let after_set = reg.set_quest_idea_id(&task.id.0, "idea-xyz").await.unwrap();
        assert_eq!(after_set.idea_id, "idea-xyz");
        let refetched = reg.get_task(&task.id.0).await.unwrap().unwrap();
        assert_eq!(refetched.idea_id, "idea-xyz");
    }

    #[tokio::test]
    async fn find_quests_by_idea_id_returns_only_linked_quests() {
        let reg = test_registry().await;
        let agent = reg.spawn("tasker", None, None).await.unwrap();

        let q1 = reg
            .create_task(&agent.id, "linked one", "", &[], &[])
            .await
            .unwrap();
        let q2 = reg
            .create_task(&agent.id, "linked two", "", &[], &[])
            .await
            .unwrap();
        let q3 = reg
            .create_task(&agent.id, "unlinked", "", &[], &[])
            .await
            .unwrap();

        reg.set_quest_idea_id(&q1.id.0, "shared-spec")
            .await
            .unwrap();
        reg.set_quest_idea_id(&q2.id.0, "shared-spec")
            .await
            .unwrap();
        reg.set_quest_idea_id(&q3.id.0, "lonely-spec")
            .await
            .unwrap();

        let mut linked = reg.find_quests_by_idea_id("shared-spec").await.unwrap();
        linked.sort();
        let mut expected = vec![q1.id.0.clone(), q2.id.0.clone()];
        expected.sort();
        assert_eq!(linked, expected);

        let solo = reg.find_quests_by_idea_id("lonely-spec").await.unwrap();
        assert_eq!(solo, vec![q3.id.0]);

        let none = reg.find_quests_by_idea_id("ghost").await.unwrap();
        assert!(none.is_empty());
    }

    /// A freshly spawned agent gets the two default schedule events
    /// (daily-digest + weekly-consolidate) with the correct patterns,
    /// concrete agent_id, and a session.spawn tool call.
    #[tokio::test]
    async fn spawn_installs_default_scheduled_events() {
        let reg = test_registry().await;
        let agent = reg.spawn("scheduled", None, None).await.unwrap();

        let db = reg.db.lock().await;
        let mut stmt = db
            .prepare(
                "SELECT name, pattern, agent_id, tool_calls FROM events
                 WHERE agent_id = ?1 AND pattern LIKE 'schedule:%'
                 ORDER BY name",
            )
            .unwrap();
        let rows: Vec<(String, String, String, String)> = stmt
            .query_map(params![agent.id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(rows.len(), 2, "should seed exactly 2 schedule events");

        // Alphabetical: daily-digest then weekly-consolidate.
        assert_eq!(rows[0].0, "daily-digest");
        assert_eq!(rows[0].1, "schedule:0 0 * * *");
        assert_eq!(rows[0].2, agent.id);
        let daily_tc: serde_json::Value = serde_json::from_str(&rows[0].3).unwrap();
        assert_eq!(daily_tc[0]["tool"], "session.spawn");
        assert_eq!(daily_tc[0]["args"]["kind"], "compactor");
        assert_eq!(
            daily_tc[0]["args"]["instructions_idea"],
            "meta:daily-reflector-template"
        );
        assert_eq!(
            daily_tc[0]["args"]["parent_session"],
            agent.session_id.clone().unwrap()
        );

        assert_eq!(rows[1].0, "weekly-consolidate");
        assert_eq!(rows[1].1, "schedule:0 0 * * 0");
        assert_eq!(rows[1].2, agent.id);
        let weekly_tc: serde_json::Value = serde_json::from_str(&rows[1].3).unwrap();
        assert_eq!(
            weekly_tc[0]["args"]["instructions_idea"],
            "meta:weekly-consolidator-template"
        );

        // Round 6: the schedule event must chain session.spawn with
        // ideas.store_many so the sub-agent's JSON output is actually
        // persisted. Without the second call the reflection output evaporates.
        assert_eq!(daily_tc[1]["tool"], "ideas.store_many");
        assert_eq!(daily_tc[1]["args"]["from_json"], "{last_tool_result}");
        assert!(
            daily_tc[1]["args"]["authored_by"]
                .as_str()
                .unwrap_or("")
                .starts_with("daily-reflector:"),
            "daily authored_by must be daily-reflector:{{agent_id}}; got {}",
            daily_tc[1]["args"]["authored_by"]
        );
        assert_eq!(weekly_tc[1]["tool"], "ideas.store_many");
        assert_eq!(weekly_tc[1]["args"]["from_json"], "{last_tool_result}");
    }

    /// Calling `install_default_scheduled_events` twice for the same agent is
    /// idempotent — the unique (COALESCE(agent_id,''), name) index turns the
    /// second insert into a no-op so we don't end up with 4 rows.
    #[tokio::test]
    async fn install_default_scheduled_events_is_idempotent() {
        let reg = test_registry().await;
        let agent = reg.spawn("idem", None, None).await.unwrap();

        // Second explicit install — spawn already ran one.
        reg.install_default_scheduled_events(&agent.id, "fake-session")
            .await
            .unwrap();

        let db = reg.db.lock().await;
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM events WHERE agent_id = ?1 AND pattern LIKE 'schedule:%'",
                params![agent.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "idempotent: still exactly 2 schedule events");
    }

    /// Per-agent schedule seeds must not clobber the global lifecycle events
    /// seeded once at daemon boot — those rows have agent_id IS NULL and stay
    /// that way after a spawn.
    #[tokio::test]
    async fn spawn_leaves_global_events_untouched() {
        let reg = test_registry().await;

        // Simulate a pre-existing global lifecycle event (the kind
        // create_default_lifecycle_events inserts at boot).
        {
            let db = reg.db.lock().await;
            db.execute(
                "INSERT INTO events (
                     id, agent_id, name, pattern, scope, tool_calls,
                     enabled, cooldown_secs, system, created_at
                 ) VALUES ('global-1', NULL, 'session:start', 'session:start',
                          'global', '[]', 1, 0, 1, '2026-01-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }

        let _agent = reg.spawn("tenant", None, None).await.unwrap();

        let db = reg.db.lock().await;
        let global_count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM events WHERE agent_id IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            global_count, 1,
            "global lifecycle events must remain agent_id IS NULL"
        );
        let global_name: String = db
            .query_row(
                "SELECT name FROM events WHERE agent_id IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(global_name, "session:start");
    }
}
