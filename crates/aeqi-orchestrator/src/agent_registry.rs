//! Agent Registry — the unified agent tree.
//!
//! Everything is an agent. A root agent has parent_id IS NULL.
//! A "worker" is an agent. The root agent (parent_id IS NULL) is the user's
//! workspace — the single point of contact. Structure is emergent, not typed.
//!
//! The agent tree IS the process tree:
//! - Spawn = create a child agent
//! - Delegate = parent→child or sibling→sibling message passing
//! - Memory = walk parent_id chain (self → parent → grandparent → root)
//! - Identity = per-agent (ideas/events, model)
//!
//! Persistent agents are NOT running processes — they are identities that get
//! loaded into fresh sessions on demand. Their "persistence" comes from:
//! 1. Stable UUID → entity-scoped memory accumulates across sessions
//! 2. Registry metadata → survives daemon restarts
//! 3. Tree position → parent_id chain for memory scoping and delegation

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
    /// Parent agent UUID. None = root agent (the user's workspace).
    pub parent_id: Option<String>,
    /// Preferred model. None = inherit from parent.
    pub model: Option<String>,
    /// Agent status.
    pub status: AgentStatus,
    pub created_at: DateTime<Utc>,
    pub last_active: Option<DateTime<Utc>>,
    pub session_count: u32,
    pub total_tokens: u64,
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
}

fn default_max_concurrent() -> u32 {
    1
}

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
    for (col, ddl) in [
        (
            "query_template",
            "ALTER TABLE events ADD COLUMN query_template TEXT",
        ),
        (
            "query_top_k",
            "ALTER TABLE events ADD COLUMN query_top_k INTEGER",
        ),
        (
            "query_tag_filter",
            "ALTER TABLE events ADD COLUMN query_tag_filter TEXT",
        ),
        (
            "tool_calls",
            "ALTER TABLE events ADD COLUMN tool_calls TEXT NOT NULL DEFAULT '[]'",
        ),
    ] {
        if !existing.contains(col) {
            conn.execute(ddl, [])?;
        }
    }

    // Heal pre-baseline installs where `agent_id` was NOT NULL. The current
    // schema makes it nullable (NULL = global event). SQLite can't drop a
    // NOT NULL constraint in place, so rebuild the table when we detect the
    // old shape.
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
                 idea_ids TEXT NOT NULL DEFAULT '[]',
                 query_template TEXT,
                 query_top_k INTEGER,
                 enabled INTEGER NOT NULL DEFAULT 1,
                 cooldown_secs INTEGER NOT NULL DEFAULT 0,
                 last_fired TEXT,
                 fire_count INTEGER NOT NULL DEFAULT 0,
                 total_cost_usd REAL NOT NULL DEFAULT 0.0,
                 system INTEGER NOT NULL DEFAULT 0,
                 created_at TEXT NOT NULL
             );
             INSERT INTO events_new
                 (id, agent_id, name, pattern, scope, idea_ids,
                  query_template, query_top_k, enabled, cooldown_secs,
                  last_fired, fire_count, total_cost_usd, system, created_at)
                 SELECT id, agent_id, name, pattern, scope, idea_ids,
                        query_template, query_top_k, enabled, cooldown_secs,
                        last_fired, fire_count, total_cost_usd, system, created_at
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
                 parent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
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
                 tool_deny TEXT NOT NULL DEFAULT '[]'
             );
             CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_id);
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
                 idea_ids TEXT NOT NULL DEFAULT '[]',
                 query_template TEXT,
                 query_top_k INTEGER,
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

        // Agent ancestry closure table — materialised parent chain.
        // Self-row at depth=0 is always present, so visibility queries
        // resolve via a single JOIN / IN without walking parent_id recursively.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_ancestry (
                 descendant_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                 ancestor_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
                 depth INTEGER NOT NULL,
                 PRIMARY KEY (descendant_id, ancestor_id)
             );
             CREATE INDEX IF NOT EXISTS idx_agent_ancestry_ancestor
                 ON agent_ancestry(ancestor_id);
             CREATE INDEX IF NOT EXISTS idx_agent_ancestry_descendant
                 ON agent_ancestry(descendant_id);",
        )?;

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

        // ── Scope-model migration for aeqi.db (idempotent) ──────────────────
        // Normalises legacy scope values in events and ideas to the new enum.
        ensure_aeqi_db_scope_columns(&conn)?;

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

        // Quests table (live work state — lives in sessions.db).
        //
        // `idea_id` is the quest ↔ idea unification FK — points at the idea
        // that owns the quest's editorial body (subject + content). Nullable
        // during the additive-migration phase; becomes NOT NULL once the
        // backfill has populated every existing row (see
        // `docs/quest-idea-unification.md`, phase 1 → phase 3).
        sconn.execute_batch(
            "CREATE TABLE IF NOT EXISTS quests (
                 id TEXT PRIMARY KEY,
                 subject TEXT NOT NULL,
                 description TEXT NOT NULL DEFAULT '',
                 status TEXT NOT NULL DEFAULT 'pending',
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
             );
             CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
             CREATE INDEX IF NOT EXISTS idx_quests_agent ON quests(agent_id);
             CREATE INDEX IF NOT EXISTS idx_quests_created ON quests(created_at);
             CREATE INDEX IF NOT EXISTS idx_quests_idea ON quests(idea_id);",
        )?;

        // ── Scope-model migration (idempotent) ──────────────────────────────
        // ADD COLUMN is guarded by PRAGMA table_info; UPDATE is guarded by
        // the sentinel "WHERE scope = 'self' AND agent_id IS NULL" so it only
        // touches rows that haven't been migrated yet.
        ensure_scope_columns(&sconn)?;

        // ── Quest ↔ Idea FK column (idempotent) ─────────────────────────────
        // Phase 1 of the quest-idea unification: introduce the FK column on
        // legacy DBs without touching existing rows.
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

    /// Spawn a new agent directly.
    pub async fn spawn(
        &self,
        name: &str,
        parent_id: Option<&str>,
        model: Option<&str>,
    ) -> Result<Agent> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let session_id = uuid::Uuid::new_v4().to_string();
        let canonical_name = name.trim().to_string();

        let agent = Agent {
            id: id.clone(),
            name: canonical_name,
            parent_id: parent_id.map(|s| s.to_string()),
            model: model.map(|s| s.to_string()),
            status: AgentStatus::Active,
            created_at: now,
            last_active: None,
            session_count: 0,
            total_tokens: 0,
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
        };

        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO agents (id, name, display_name, parent_id, model, status, created_at, session_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                agent.id,
                agent.name,
                Option::<String>::None,
                agent.parent_id,
                agent.model,
                agent.status.to_string(),
                agent.created_at.to_rfc3339(),
                session_id,
            ],
        )?;

        // Maintain closure table: self-row at depth 0, then parent chain at depth+1.
        db.execute(
            "INSERT INTO agent_ancestry (descendant_id, ancestor_id, depth) VALUES (?1, ?1, 0)",
            params![agent.id],
        )?;
        if let Some(pid) = parent_id {
            db.execute(
                "INSERT INTO agent_ancestry (descendant_id, ancestor_id, depth)
                 SELECT ?1, ancestor_id, depth + 1
                 FROM agent_ancestry WHERE descendant_id = ?2",
                params![agent.id, pid],
            )?;
        }

        info!(id = %agent.id, name = %agent.name, parent_id = ?parent_id, "agent spawned");
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
                     id, agent_id, name, pattern, scope, idea_ids,
                     query_template, query_top_k, tool_calls,
                     enabled, cooldown_secs, system, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, '[]', NULL, NULL, ?6, 1, 0, 0, ?7)",
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

    /// Get the root agent (parent_id IS NULL, status = active).
    /// In a single-root runtime, this is the primary root agent.
    pub async fn get_root_agent(&self) -> Result<Option<Agent>> {
        let db = self.db.lock().await;
        db.query_row(
            "SELECT * FROM agents WHERE parent_id IS NULL AND status = 'active' LIMIT 1",
            [],
            |row| Ok(row_to_agent(row)),
        )
        .optional()
        .map_err(Into::into)
    }

    /// List all agents, optionally filtered by parent and/or status.
    pub async fn list(
        &self,
        parent_id: Option<Option<&str>>,
        status: Option<AgentStatus>,
    ) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut sql = "SELECT * FROM agents WHERE 1=1".to_string();
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(pid) = parent_id {
            match pid {
                Some(id) => {
                    sql.push_str(" AND parent_id = ?");
                    params_vec.push(Box::new(id.to_string()));
                }
                None => {
                    sql.push_str(" AND parent_id IS NULL");
                }
            }
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

    /// Get the root agent (parent_id IS NULL). Every workspace has exactly one.
    pub async fn get_root(&self) -> Result<Option<Agent>> {
        let db = self.db.lock().await;
        let agent = db
            .query_row(
                "SELECT * FROM agents WHERE parent_id IS NULL AND status = 'active' ORDER BY created_at ASC LIMIT 1",
                [],
                |row| Ok(row_to_agent(row)),
            )
            .optional()?;
        Ok(agent)
    }

    /// Get direct children of an agent.
    pub async fn get_children(&self, agent_id: &str) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM agents WHERE parent_id = ?1 AND status = 'active' ORDER BY name ASC",
        )?;
        let agents = stmt
            .query_map(params![agent_id], |row| Ok(row_to_agent(row)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    /// Walk the parent_id chain from an agent up to root.
    /// Returns the chain starting from the given agent (inclusive).
    /// Includes cycle detection.
    pub async fn get_ancestors(&self, agent_id: &str) -> Result<Vec<Agent>> {
        let mut chain = Vec::new();
        let mut current_id = Some(agent_id.to_string());
        let mut visited = std::collections::HashSet::new();

        while let Some(id) = current_id {
            if !visited.insert(id.clone()) {
                tracing::warn!(agent_id = %id, "cycle detected in agent hierarchy");
                break;
            }
            match self.get(&id).await? {
                Some(agent) => {
                    current_id = agent.parent_id.clone();
                    chain.push(agent);
                }
                None => break,
            }
        }

        Ok(chain)
    }

    /// Get the ancestor IDs for an agent (for memory scoping).
    /// Returns [self_id, parent_id, grandparent_id, ..., root_id].
    pub async fn get_ancestor_ids(&self, agent_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut ids = Vec::new();
        let mut current_id = Some(agent_id.to_string());
        let mut visited = std::collections::HashSet::new();

        while let Some(id) = current_id {
            if !visited.insert(id.clone()) {
                break;
            }
            ids.push(id.clone());
            current_id = db
                .query_row(
                    "SELECT parent_id FROM agents WHERE id = ?1",
                    params![id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();
        }

        Ok(ids)
    }

    /// Get all descendant IDs of an agent (excludes self).
    ///
    /// Uses the `agent_ancestry` closure table for O(1) lookup.
    /// Returns an empty vec when the agent has no descendants.
    pub async fn list_descendants(&self, agent_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "SELECT descendant_id FROM agent_ancestry
             WHERE ancestor_id = ?1 AND depth > 0",
        )?;
        let ids = stmt
            .query_map(params![agent_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Get sibling agent IDs — agents that share the same `parent_id` as
    /// `agent_id`, excluding `agent_id` itself.
    ///
    /// Returns an empty vec for root agents (parent_id IS NULL) or agents
    /// with no siblings.
    pub async fn list_siblings(&self, agent_id: &str) -> Result<Vec<String>> {
        let db = self.db.lock().await;
        let parent_id: Option<String> = db
            .query_row(
                "SELECT parent_id FROM agents WHERE id = ?1",
                params![agent_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();

        let Some(pid) = parent_id else {
            return Ok(Vec::new());
        };

        let mut stmt = db.prepare(
            "SELECT id FROM agents WHERE parent_id = ?1 AND id != ?2 AND status = 'active'",
        )?;
        let ids = stmt
            .query_map(params![pid, agent_id], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Get the full subtree rooted at an agent (recursive CTE).
    pub async fn get_subtree(&self, agent_id: &str) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare(
            "WITH RECURSIVE subtree AS (
                 SELECT * FROM agents WHERE id = ?1
                 UNION ALL
                 SELECT a.* FROM agents a
                 JOIN subtree s ON a.parent_id = s.id
             )
             SELECT * FROM subtree ORDER BY created_at ASC",
        )?;
        let agents = stmt
            .query_map(params![agent_id], |row| Ok(row_to_agent(row)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(agents)
    }

    /// Ideas visible to an agent. Scope rule:
    ///   self + any descendant + any global (`agent_id IS NULL`).
    /// Parents do NOT flow down (covered by the descendant leg from the parent's
    /// own view), so a child never sees private ideas of its parent.
    pub async fn list_ideas_visible_to(
        &self,
        agent_id: &str,
    ) -> Result<Vec<aeqi_core::traits::Idea>> {
        // Tuple of (id, name, content, agent_id, session_id, created_at, scope).
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
        );

        let db = self.db.lock().await;
        let rows: Vec<IdeaRow> = {
            let mut stmt = db.prepare(
                "SELECT id, name, content, agent_id, session_id, created_at, scope
                 FROM ideas
                 WHERE agent_id IS NULL
                    OR agent_id IN (
                        SELECT descendant_id FROM agent_ancestry WHERE ancestor_id = ?1
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
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
        };

        // Hydrate tags per idea (secondary query; tag set tends to be tiny).
        let mut out = Vec::with_capacity(rows.len());
        for (id, name, content, aid, session_id, created_at, scope_str) in rows {
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
            });
        }
        Ok(out)
    }

    /// Move an agent to a new parent (reparent).
    pub async fn move_agent(&self, agent_id: &str, new_parent_id: Option<&str>) -> Result<()> {
        // Prevent cycles: new parent must not be a descendant of agent_id.
        if let Some(pid) = new_parent_id {
            let subtree = self.get_subtree(agent_id).await?;
            if subtree.iter().any(|a| a.id == pid) {
                anyhow::bail!("cannot move agent under its own subtree (would create cycle)");
            }
        }

        let db = self.db.lock().await;
        let updated = db.execute(
            "UPDATE agents SET parent_id = ?1 WHERE id = ?2",
            params![new_parent_id, agent_id],
        )?;
        if updated == 0 {
            anyhow::bail!("agent '{agent_id}' not found");
        }

        // Closure-table reparent: drop stale ancestor links for the moved subtree,
        // then re-link the subtree under the new parent's ancestors.
        db.execute(
            "DELETE FROM agent_ancestry
             WHERE descendant_id IN (SELECT descendant_id FROM agent_ancestry WHERE ancestor_id = ?1)
               AND ancestor_id NOT IN (SELECT descendant_id FROM agent_ancestry WHERE ancestor_id = ?1)",
            params![agent_id],
        )?;
        if let Some(pid) = new_parent_id {
            db.execute(
                "INSERT INTO agent_ancestry (descendant_id, ancestor_id, depth)
                 SELECT d.descendant_id, x.ancestor_id, d.depth + x.depth + 1
                 FROM agent_ancestry d, agent_ancestry x
                 WHERE d.ancestor_id = ?1 AND x.descendant_id = ?2",
                params![agent_id, pid],
            )?;
        }

        info!(agent_id = %agent_id, new_parent_id = ?new_parent_id, "agent reparented");
        Ok(())
    }

    /// Find the default agent to talk to — the root, or a named child.
    pub async fn default_agent(&self, hint: Option<&str>) -> Result<Option<Agent>> {
        if let Some(h) = hint
            && let Some(agent) = self.resolve_by_hint(h).await?
        {
            return Ok(Some(agent));
        }
        self.get_root().await
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
    /// - `cascade = false` — reparent the agent's direct children to its
    ///   own parent (grandparent) so the subtree stays connected, then
    ///   delete the row. Returns the count of rows removed (always 1).
    /// - `cascade = true` — delete the agent plus every descendant in one
    ///   shot via the `agent_ancestry` closure table. Returns the count.
    ///
    /// Ideas and quests are unaffected — their `agent_id` columns have no
    /// FK, so references are left in place as historical pointers. Events,
    /// channels, and files are per-agent resources with `ON DELETE CASCADE`
    /// and are wiped alongside each deleted agent.
    pub async fn delete_agent(&self, id: &str, cascade: bool) -> Result<usize> {
        let db = self.db.lock().await;

        let current_parent: Option<String> = db
            .query_row(
                "SELECT parent_id FROM agents WHERE id = ?1",
                params![id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();

        if !cascade {
            db.execute(
                "UPDATE agents SET parent_id = ?1 WHERE parent_id = ?2",
                params![current_parent, id],
            )?;
            let deleted = db.execute("DELETE FROM agents WHERE id = ?1", params![id])?;
            if deleted == 0 {
                anyhow::bail!("agent '{id}' not found");
            }
            info!(id = %id, "agent deleted (children promoted)");
            return Ok(deleted);
        }

        let mut stmt =
            db.prepare("SELECT descendant_id FROM agent_ancestry WHERE ancestor_id = ?1")?;
        let subtree: Vec<String> = stmt
            .query_map(params![id], |r| r.get::<_, String>(0))?
            .filter_map(std::result::Result::ok)
            .collect();
        drop(stmt);

        if subtree.is_empty() {
            anyhow::bail!("agent '{id}' not found");
        }

        let placeholders = std::iter::repeat_n("?", subtree.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!("DELETE FROM agents WHERE id IN ({placeholders})");
        let params_vec: Vec<&dyn rusqlite::ToSql> =
            subtree.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let deleted = db.execute(&sql, params_vec.as_slice())?;
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
        idea_ids: &[String],
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

        let sdb = self.sessions_db.lock().await;

        // Rate limit: reject if agent has exceeded daily quest creation limit.
        let max_daily_tasks: u32 = 50;
        let today_count: u32 = sdb.query_row(
            "SELECT COUNT(*) FROM quests WHERE agent_id = ?1 AND created_at > date('now')",
            params![agent_id],
            |row| row.get(0),
        )?;
        if today_count >= max_daily_tasks {
            anyhow::bail!("Agent has reached daily quest creation limit ({max_daily_tasks})");
        }
        drop(sdb);

        // Get and increment sequence for this prefix (quest_sequences lives in aeqi.db).
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
        drop(db);

        let quest_id = format!("{prefix}-{seq:03}");
        let now = chrono::Utc::now();
        let labels_json = serde_json::to_string(labels)?;

        let idea_ids_json = serde_json::to_string(idea_ids)?;

        let quest = aeqi_quests::Quest {
            id: aeqi_quests::QuestId(quest_id.clone()),
            name: subject.to_string(),
            description: description.to_string(),
            status: aeqi_quests::QuestStatus::Pending,
            priority: aeqi_quests::quest::Priority::Normal,
            agent_id: Some(agent_id.to_string()),
            scope,
            depends_on: Vec::new(),
            idea_id: None,
            idea_ids: idea_ids.to_vec(),
            labels: labels.to_vec(),
            retry_count: 0,
            checkpoints: Vec::new(),
            metadata: serde_json::Value::Null,
            created_at: now,
            updated_at: None,
            closed_at: None,
            outcome: None,
            acceptance_criteria: None,
            worktree_branch: None,
            worktree_path: None,
            creator_session_id: None,
        };

        let sdb = self.sessions_db.lock().await;
        sdb.execute(
            "INSERT INTO quests (id, subject, description, status, priority, agent_id, scope, idea_ids, labels, created_at, idea_id)
             VALUES (?1, ?2, ?3, 'pending', 'normal', ?4, ?5, ?6, ?7, ?8, NULL)",
            params![
                quest_id,
                subject,
                description,
                agent_id,
                scope.as_str(),
                idea_ids_json,
                labels_json,
                now.to_rfc3339(),
            ],
        )?;

        info!(quest = %quest_id, agent = %agent.name, subject = %subject, "quest created");
        Ok(quest)
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
        idea_ids: &[String],
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
        let labels_json = serde_json::to_string(labels)?;
        let deps_json = serde_json::to_string(depends_on)?;
        let idea_ids_json = serde_json::to_string(idea_ids)?;

        let mut quest = aeqi_quests::Quest::with_agent(
            aeqi_quests::QuestId(quest_id.clone()),
            subject,
            Some(agent_id),
        );
        quest.description = description.to_string();
        quest.depends_on = depends_on.to_vec();
        quest.idea_ids = idea_ids.to_vec();
        quest.labels = labels.to_vec();
        quest.scope = scope;
        quest.created_at = now;

        let sdb = self.sessions_db.lock().await;
        sdb.execute(
            "INSERT INTO quests (id, subject, description, status, priority, agent_id, scope, idea_ids, labels, depends_on, created_at, idea_id)
             VALUES (?1, ?2, ?3, 'pending', 'normal', ?4, ?5, ?6, ?7, ?8, ?9, NULL)",
            params![
                quest_id,
                subject,
                description,
                agent_id,
                scope.as_str(),
                idea_ids_json,
                labels_json,
                deps_json,
                now.to_rfc3339(),
            ],
        )?;

        info!(quest = %quest_id, agent = %agent.name, subject = %subject, parent = ?parent_id, "quest created (v2)");
        Ok(quest)
    }

    /// Find an open (Pending or InProgress) quest by exact subject match.
    /// Used for atomic claim checking.
    pub async fn find_open_task_by_subject(
        &self,
        subject: &str,
    ) -> Result<Option<aeqi_quests::Quest>> {
        let db = self.sessions_db.lock().await;
        let task = db
            .query_row(
                "SELECT * FROM quests WHERE subject = ?1 AND status IN ('pending', 'in_progress') LIMIT 1",
                params![subject],
                |row| Ok(row_to_task(row)),
            )
            .optional()?;
        Ok(task)
    }

    /// Get all pending tasks that are ready to run (no unmet dependencies).
    pub async fn ready_tasks(&self) -> Result<Vec<aeqi_quests::Quest>> {
        let db = self.sessions_db.lock().await;
        let mut stmt = db.prepare(
            "SELECT * FROM quests WHERE status = 'pending' ORDER BY
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
            quest.idea_id = Some(new_id);
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
            "UPDATE quests SET status = 'pending', retry_count = retry_count + 1 WHERE status = 'in_progress'",
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
        let labels_json = serde_json::to_string(&quest.labels).unwrap_or_default();
        let checkpoints_json = serde_json::to_string(&quest.checkpoints).unwrap_or_default();
        let deps_json = serde_json::to_string(&quest.depends_on).unwrap_or_default();
        let idea_ids_json = serde_json::to_string(&quest.idea_ids).unwrap_or_default();
        let metadata_json = serde_json::to_string(&quest.metadata).unwrap_or_default();
        let outcome_json = quest
            .outcome
            .as_ref()
            .and_then(|o| serde_json::to_string(o).ok());

        db.execute(
            "UPDATE quests SET
                subject = ?1, description = ?2, status = ?3, priority = ?4,
                agent_id = ?5, scope = ?6, idea_ids = ?7, labels = ?8,
                retry_count = ?9, checkpoints = ?10, metadata = ?11,
                depends_on = ?12, acceptance_criteria = ?13,
                updated_at = ?14, closed_at = ?15, outcome = ?16,
                idea_id = ?17
             WHERE id = ?18",
            params![
                quest.name,
                quest.description,
                quest.status.to_string(),
                quest.priority.to_string(),
                quest.agent_id,
                quest.scope.as_str(),
                idea_ids_json,
                labels_json,
                quest.retry_count,
                checkpoints_json,
                metadata_json,
                deps_json,
                quest.acceptance_criteria,
                now,
                quest.closed_at.map(|d| d.to_rfc3339()),
                outcome_json,
                quest.idea_id,
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
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
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

    /// List root agents (agents with no parent).
    pub async fn list_root_agents(&self) -> Result<Vec<Agent>> {
        let db = self.db.lock().await;
        let mut stmt = db.prepare("SELECT * FROM agents WHERE parent_id IS NULL ORDER BY name")?;
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
    let labels_str: String = row.get("labels").unwrap_or_else(|_| "[]".to_string());
    let checkpoints_str: String = row.get("checkpoints").unwrap_or_else(|_| "[]".to_string());
    let deps_str: String = row.get("depends_on").unwrap_or_else(|_| "[]".to_string());
    let idea_ids_str: String = row.get("idea_ids").unwrap_or_else(|_| "[]".to_string());
    let metadata_str: String = row.get("metadata").unwrap_or_else(|_| "{}".to_string());
    let outcome_str: String = row.get("outcome").unwrap_or_else(|_| String::new());

    let status_str: String = row.get("status").unwrap_or_else(|_| "pending".to_string());
    let status = match status_str.as_str() {
        "in_progress" => aeqi_quests::QuestStatus::InProgress,
        "done" => aeqi_quests::QuestStatus::Done,
        "blocked" => aeqi_quests::QuestStatus::Blocked,
        "cancelled" => aeqi_quests::QuestStatus::Cancelled,
        _ => aeqi_quests::QuestStatus::Pending,
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
        name: row.get("subject").unwrap_or_default(),
        description: row.get("description").unwrap_or_default(),
        status,
        priority,
        agent_id: row.get("agent_id").ok(),
        scope: quest_scope,
        depends_on: serde_json::from_str(&deps_str).unwrap_or_default(),
        idea_id: row.get::<_, Option<String>>("idea_id").unwrap_or(None),
        idea_ids: serde_json::from_str(&idea_ids_str).unwrap_or_default(),
        labels: serde_json::from_str(&labels_str).unwrap_or_default(),
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
        outcome,
        acceptance_criteria: row.get("acceptance_criteria").ok(),
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
        parent_id: row.get("parent_id").ok(),
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
        quest_conn
            .execute_batch(
                "CREATE TABLE quests (
                     id TEXT PRIMARY KEY,
                     subject TEXT NOT NULL,
                     description TEXT NOT NULL DEFAULT '',
                     status TEXT NOT NULL DEFAULT 'pending',
                     priority TEXT NOT NULL DEFAULT 'normal',
                     agent_id TEXT,
                     scope TEXT NOT NULL DEFAULT 'self',
                     idea_ids TEXT NOT NULL DEFAULT '[]',
                     idea_id TEXT,
                     labels TEXT NOT NULL DEFAULT '[]',
                     acceptance_criteria TEXT,
                     created_at TEXT NOT NULL
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

    #[tokio::test]
    async fn spawn_and_get() {
        let reg = test_registry().await;
        let agent = reg
            .spawn("Shadow", None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        assert_eq!(agent.name, "Shadow");
        assert!(agent.parent_id.is_none()); // Root agent
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
    async fn get_root() {
        let reg = test_registry().await;
        let root = reg.spawn("assistant", None, None).await.unwrap();
        let _child = reg.spawn("worker", Some(&root.id), None).await.unwrap();

        let found = reg.get_root().await.unwrap().unwrap();
        assert_eq!(found.id, root.id);
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

        reg.finalize_quest(&quest.id.0, aeqi_quests::QuestStatus::Pending, true)
            .await
            .unwrap();
        reg.finalize_quest(&quest.id.0, aeqi_quests::QuestStatus::Pending, true)
            .await
            .unwrap();

        let got = reg.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(got.status, aeqi_quests::QuestStatus::Pending);
        assert_eq!(got.retry_count, 2);
        assert!(got.closed_at.is_none(), "Pending must not stamp closed_at");
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
    async fn list_with_parent_and_status_filters() {
        let reg = test_registry().await;
        let root = reg.spawn("root", None, None).await.unwrap();
        let child_a = reg.spawn("a", Some(&root.id), None).await.unwrap();
        let _child_b = reg.spawn("b", Some(&root.id), None).await.unwrap();

        reg.set_status(&child_a.id, AgentStatus::Paused)
            .await
            .unwrap();

        let all = reg.list(None, None).await.unwrap();
        assert_eq!(all.len(), 3);

        let children = reg.list(Some(Some(&root.id)), None).await.unwrap();
        assert_eq!(children.len(), 2);

        // parent IS NULL = root agents only
        let roots = reg.list(Some(None), None).await.unwrap();
        assert_eq!(roots.len(), 1);
        assert_eq!(roots[0].name, "root");

        let active_children = reg
            .list(Some(Some(&root.id)), Some(AgentStatus::Active))
            .await
            .unwrap();
        assert_eq!(active_children.len(), 1);
        assert_eq!(active_children[0].name, "b");

        let paused = reg.list(None, Some(AgentStatus::Paused)).await.unwrap();
        assert_eq!(paused.len(), 1);
        assert_eq!(paused[0].name, "a");
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
        let a = reg.get(&leaf_a.id).await.unwrap().unwrap();
        let b = reg.get(&leaf_b.id).await.unwrap().unwrap();
        assert_eq!(a.parent_id.as_deref(), Some(root.id.as_str()));
        assert_eq!(b.parent_id.as_deref(), Some(root.id.as_str()));
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

        let orphan = reg.get(&child.id).await.unwrap().unwrap();
        assert!(orphan.parent_id.is_none());
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

        let fetched = reg.get_task(&t1.id.0).await.unwrap().unwrap();
        assert_eq!(fetched.name, "Build API");
        assert_eq!(fetched.description, "Build the REST API");

        let fetched2 = reg.get_task(&t2.id.0).await.unwrap().unwrap();
        assert_eq!(fetched2.idea_ids, vec!["idea-abc".to_string()]);
        assert_eq!(fetched2.labels, vec!["testing".to_string()]);

        let missing = reg.get_task("no-such-task").await.unwrap();
        assert!(missing.is_none());

        let all = reg.list_tasks(None, None).await.unwrap();
        assert_eq!(all.len(), 2);

        reg.update_task_status(&t1.id.0, aeqi_quests::QuestStatus::Done)
            .await
            .unwrap();
        let pending = reg.list_tasks(Some("pending"), None).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].name, "Write tests");

        let done = reg.list_tasks(Some("done"), None).await.unwrap();
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].name, "Build API");

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
            quest.idea_id = Some("idea-abc".to_string());
        })
        .await
        .unwrap();
        let after_update = reg.get_task(&task.id.0).await.unwrap().unwrap();
        assert_eq!(after_update.idea_id.as_deref(), Some("idea-abc"));

        // … and via the dedicated setter used by the create-quest IPC.
        let after_set = reg.set_quest_idea_id(&task.id.0, "idea-xyz").await.unwrap();
        assert_eq!(after_set.idea_id.as_deref(), Some("idea-xyz"));
        let refetched = reg.get_task(&task.id.0).await.unwrap().unwrap();
        assert_eq!(refetched.idea_id.as_deref(), Some("idea-xyz"));
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
                     id, agent_id, name, pattern, scope, idea_ids,
                     tool_calls, enabled, cooldown_secs, system, created_at
                 ) VALUES ('global-1', NULL, 'session:start', 'session:start',
                          'global', '[]', '[]', 1, 0, 1, '2026-01-01T00:00:00Z')",
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
