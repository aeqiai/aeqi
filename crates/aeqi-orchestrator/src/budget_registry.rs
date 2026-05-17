//! Budget Registry — the canonical role-budget primitive.
//!
//! Budgets are the cost-center primitive. Every budget has exactly one
//! owner role; the occupant of that role spends from it. Budgets form
//! their own DAG (`parent_budget_id`) which is independent of the
//! role DAG (`role_edges`) — money routes around the org chart freely.
//!
//! See `architecture_role_budget_canonical.md` (auto-memory) for the
//! full design brief. This file owns:
//!
//! 1. Schema setup (`bootstrap_budget_tables`) — called from
//!    [`AgentRegistry::open`] on every boot, idempotent.
//! 2. Domain types — `Budget`, `BudgetAllowance`, `BudgetPolicy`,
//!    `AllowanceBundle`, `TreasuryEvent`, `TreasuryConfig`,
//!    `BudgetKind`, `RolloverMode`, `BudgetError`.
//! 3. [`BudgetRegistry`] — async API over the `ConnectionPool` shared
//!    with [`AgentRegistry`] / [`RoleRegistry`] / [`EntityRegistry`].
//!
//! ## TRUST id mapping
//!
//! Off-chain (this layer) uses `trust_id` everywhere a TRUST id appears
//! in the brief. Every entity is a TRUST in the off-chain canonical
//! model; the chain port (WS-B7) replaces this column with the on-chain
//! TRUST address.
//!
//! ## What lands later (not in WS-B1)
//!
//! - Activity log emission per mutation (brief §10) — handler hook
//!   left where the event row is written; wire in WS-B2.
//! - Scheduled `refresh` cron (brief §15) — `refresh_at` is the
//!   testable seam; the cron firing it lands in WS-B2.
//! - IPC handlers (WS-B2), agent tools (WS-B4), MCP outward (WS-B5).

use crate::agent_registry::ConnectionPool;
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;

// ── Errors ────────────────────────────────────────────────────────────────────

/// Stable, programmatically discriminable errors. IPC handlers and agent
/// tools downcast `anyhow::Error` to this enum to surface structured
/// error responses to the LLM and to the UI.
#[derive(Debug, Error)]
pub enum BudgetError {
    #[error("caller role does not occupy this budget's owner role")]
    ENotOwner,
    #[error("caller is not the occupant of role {role}")]
    ENotOccupant { role: String },
    #[error("agent occupies multiple roles in this trust; pass `as_role_id`")]
    EAmbiguousCallerRole { roles: Vec<String> },
    #[error("agent has no role in this trust")]
    EAgentNotInTrust,
    #[error("insufficient inference credits: need {need}, remaining {remaining}")]
    EInsufficientInference { need: i64, remaining: i64 },
    #[error("insufficient treasury cap: need {need}, remaining {remaining}")]
    EInsufficientTreasury { need: i64, remaining: i64 },
    #[error("insufficient suballoc cap: need {need}, remaining {remaining}")]
    EInsufficientSuballoc { need: i64, remaining: i64 },
    #[error("hire cap exceeded: cap {cap}, used {used}")]
    EHireCapExceeded { cap: i64, used: i64 },
    #[error("paused: treasury operations halted for this trust")]
    EPaused,
    #[error("vacant role cannot spend (no occupant signer)")]
    EVacantOwnerCannotSpend,
    #[error("inference gateway mismatch: caller {caller}")]
    EGatewayMismatch { caller: String },
    #[error("policy missing for budget {budget}")]
    EPolicyMissing { budget: String },
    #[error("duplicate request_hash {hash}")]
    EDuplicateRequestHash { hash: String },
    #[error("budget {budget} has descendants; dissolve children first")]
    EBudgetHasDescendants { budget: String },
    #[error("budget {budget} has non-zero balance; cannot dissolve")]
    EBudgetNonZeroBalance { budget: String },
    #[error("owner role {role} not in trust {trust}")]
    EOwnerRoleNotInTrust { role: String, trust: String },
    #[error("parent budget {parent} not in trust {trust}")]
    EParentBudgetNotInTrust { parent: String, trust: String },
    #[error("budget not found: {0}")]
    ENotFound(String),
    #[error("primary budget cannot be dissolved while role exists")]
    EPrimaryBudgetCannotDissolve,
}

impl BudgetError {
    /// Stable string code for IPC / tool error responses.
    pub fn code(&self) -> &'static str {
        match self {
            Self::ENotOwner => "ENotOwner",
            Self::ENotOccupant { .. } => "ENotOccupant",
            Self::EAmbiguousCallerRole { .. } => "EAmbiguousCallerRole",
            Self::EAgentNotInTrust => "EAgentNotInTrust",
            Self::EInsufficientInference { .. } => "EInsufficientInference",
            Self::EInsufficientTreasury { .. } => "EInsufficientTreasury",
            Self::EInsufficientSuballoc { .. } => "EInsufficientSuballoc",
            Self::EHireCapExceeded { .. } => "EHireCapExceeded",
            Self::EPaused => "EPaused",
            Self::EVacantOwnerCannotSpend => "EVacantOwnerCannotSpend",
            Self::EGatewayMismatch { .. } => "EGatewayMismatch",
            Self::EPolicyMissing { .. } => "EPolicyMissing",
            Self::EDuplicateRequestHash { .. } => "EDuplicateRequestHash",
            Self::EBudgetHasDescendants { .. } => "EBudgetHasDescendants",
            Self::EBudgetNonZeroBalance { .. } => "EBudgetNonZeroBalance",
            Self::EOwnerRoleNotInTrust { .. } => "EOwnerRoleNotInTrust",
            Self::EParentBudgetNotInTrust { .. } => "EParentBudgetNotInTrust",
            Self::ENotFound(_) => "ENotFound",
            Self::EPrimaryBudgetCannotDissolve => "EPrimaryBudgetCannotDissolve",
        }
    }
}

// ── Domain types ──────────────────────────────────────────────────────────────

/// Budget kind — UI taxonomy hint, no logic depends on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BudgetKind {
    Primary,
    Operating,
    Hiring,
    Project,
    Discretionary,
}

impl BudgetKind {
    pub fn as_db(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Operating => "operating",
            Self::Hiring => "hiring",
            Self::Project => "project",
            Self::Discretionary => "discretionary",
        }
    }
}

impl std::str::FromStr for BudgetKind {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "primary" => Ok(Self::Primary),
            "operating" => Ok(Self::Operating),
            "hiring" => Ok(Self::Hiring),
            "project" => Ok(Self::Project),
            "discretionary" => Ok(Self::Discretionary),
            other => anyhow::bail!("unknown budget kind: {}", other),
        }
    }
}

/// What `refresh` does at the epoch boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RolloverMode {
    /// Drop unspent caps; new epoch starts at policy defaults.
    Burn,
    /// Carry forward (latest.cap - latest.spent) on top of policy defaults
    /// for inference / treasury / suballoc rails.
    Rollover,
}

impl RolloverMode {
    pub fn as_db(self) -> &'static str {
        match self {
            Self::Burn => "burn",
            Self::Rollover => "rollover",
        }
    }
}

impl std::str::FromStr for RolloverMode {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "burn" => Ok(Self::Burn),
            "rollover" => Ok(Self::Rollover),
            other => anyhow::bail!("unknown rollover mode: {}", other),
        }
    }
}

/// Per-rail allowance values. Used as input on allocate / hire / set_policy
/// and as the `caps` portion of [`BudgetAllowance`].
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AllowanceBundle {
    /// micro-USD
    pub inference_credits: i64,
    /// USDC base units (6 decimals)
    pub treasury_cap: i64,
    pub suballoc_cap: i64,
    pub hire_cap: i64,
}

impl AllowanceBundle {
    pub fn zero() -> Self {
        Self::default()
    }
}

/// One budget row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Budget {
    pub id: String,
    pub trust_id: String,
    pub parent_budget_id: Option<String>,
    pub owner_role_id: String,
    pub name: String,
    pub kind: BudgetKind,
    pub is_primary: bool,
    pub created_by_role_id: Option<String>,
    pub created_at: String,
}

/// One (budget, epoch) row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetAllowance {
    pub budget_id: String,
    pub epoch: i64,
    pub caps: AllowanceBundle,
    pub spent_inference: i64,
    pub spent_treasury: i64,
    pub spent_suballoc: i64,
    pub used_hire: i64,
    pub last_event_at: String,
}

impl BudgetAllowance {
    pub fn remaining_inference(&self) -> i64 {
        (self.caps.inference_credits - self.spent_inference).max(0)
    }
    pub fn remaining_treasury(&self) -> i64 {
        (self.caps.treasury_cap - self.spent_treasury).max(0)
    }
    pub fn remaining_suballoc(&self) -> i64 {
        (self.caps.suballoc_cap - self.spent_suballoc).max(0)
    }
    pub fn remaining_hire(&self) -> i64 {
        (self.caps.hire_cap - self.used_hire).max(0)
    }
}

/// Per-budget refresh policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetPolicy {
    pub budget_id: String,
    pub defaults: AllowanceBundle,
    pub epoch_period_secs: i64,
    pub rollover_mode: RolloverMode,
    pub set_by_role_id: Option<String>,
    pub updated_at: String,
}

impl BudgetPolicy {
    pub fn zero(budget_id: impl Into<String>) -> Self {
        Self {
            budget_id: budget_id.into(),
            defaults: AllowanceBundle::zero(),
            epoch_period_secs: 604_800,
            rollover_mode: RolloverMode::Burn,
            set_by_role_id: None,
            updated_at: Utc::now().to_rfc3339(),
        }
    }
}

/// One row in `treasury_events`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasuryEvent {
    pub id: i64,
    pub event_type: String,
    pub budget_id: String,
    pub acting_role_id: String,
    pub actor_agent_id: Option<String>,
    pub counter_budget_id: Option<String>,
    pub epoch: i64,
    pub amount: Option<i64>,
    pub request_hash: Option<String>,
    pub idempotency_key: Option<String>,
    pub created_at: String,
}

/// Per-trust treasury config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasuryConfig {
    pub trust_id: String,
    pub inference_gateway: String,
    pub paused: bool,
    pub admin_role_id: String,
    pub updated_at: String,
}

/// A node + its children, used by `budget_tree`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BudgetTree {
    pub nodes: Vec<Budget>,
    pub edges: Vec<(String, String)>,
}

/// Spec for the new role created by `hire`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewRoleSpec {
    pub title: String,
    /// `director` | `operational` | `advisor`. Defaults to `operational`.
    #[serde(default)]
    pub role_type: Option<String>,
    /// Initial grants. Defaults to the role-type defaults if `None`.
    #[serde(default)]
    pub grants: Option<Vec<String>>,
    /// `human` | `agent` | `vacant`. Defaults to `vacant`.
    #[serde(default)]
    pub occupant_kind: Option<String>,
    #[serde(default)]
    pub occupant_id: Option<String>,
}

/// Result of `hire`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HireResult {
    pub role_id: String,
    pub primary_budget_id: String,
}

// Canonical event types — kept as constants so IPC + UI render code can
// switch on them without typos.
pub const EV_BUDGET_CREATED: &str = "budget_created";
pub const EV_ALLOWANCE_CREATED: &str = "allowance_created";
pub const EV_ALLOCATED: &str = "allocated";
pub const EV_INFERENCE_SPENT: &str = "inference_spent";
pub const EV_TREASURY_SPENT: &str = "treasury_spent";
pub const EV_HIRED: &str = "hired";
pub const EV_EPOCH_REFRESHED: &str = "epoch_refreshed";
pub const EV_POLICY_SET: &str = "policy_set";
pub const EV_BUDGET_DISSOLVED: &str = "budget_dissolved";
pub const EV_TREASURY_PAUSED: &str = "treasury_paused";

// ── Schema ────────────────────────────────────────────────────────────────────

/// Idempotent. Called from [`AgentRegistry::open`] right after the role
/// tables are bootstrapped, before the connection pool is built.
pub fn bootstrap_budget_tables(conn: &Connection) -> rusqlite::Result<()> {
    // ae-062 phase B: rename legacy `entity_id` columns to canonical
    // `trust_id` on live DBs. CREATE TABLE IF NOT EXISTS below uses the
    // new column names, so we must reconcile any pre-rename DB first.
    rename_legacy_entity_id(conn, "budgets")?;
    rename_legacy_entity_id(conn, "treasury_config")?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS budgets (
             id                 TEXT PRIMARY KEY,
             trust_id           TEXT NOT NULL,
             parent_budget_id   TEXT REFERENCES budgets(id) ON DELETE RESTRICT,
             owner_role_id      TEXT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
             name               TEXT NOT NULL,
             kind               TEXT NOT NULL DEFAULT 'operating',
             is_primary         INTEGER NOT NULL DEFAULT 0,
             created_by_role_id TEXT REFERENCES roles(id),
             created_at         TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_budgets_trust ON budgets(trust_id);
         CREATE INDEX IF NOT EXISTS idx_budgets_owner ON budgets(owner_role_id);
         CREATE INDEX IF NOT EXISTS idx_budgets_parent ON budgets(parent_budget_id);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_owner_primary
             ON budgets(owner_role_id) WHERE is_primary = 1;

         CREATE TABLE IF NOT EXISTS budget_allowances (
             budget_id          TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
             epoch              INTEGER NOT NULL,
             inference_credits  INTEGER NOT NULL DEFAULT 0,
             treasury_cap       INTEGER NOT NULL DEFAULT 0,
             suballoc_cap       INTEGER NOT NULL DEFAULT 0,
             hire_cap           INTEGER NOT NULL DEFAULT 0,
             spent_inference    INTEGER NOT NULL DEFAULT 0,
             spent_treasury     INTEGER NOT NULL DEFAULT 0,
             spent_suballoc     INTEGER NOT NULL DEFAULT 0,
             used_hire          INTEGER NOT NULL DEFAULT 0,
             last_event_at      TEXT NOT NULL,
             PRIMARY KEY (budget_id, epoch)
         );

         CREATE TABLE IF NOT EXISTS budget_policies (
             budget_id          TEXT PRIMARY KEY REFERENCES budgets(id) ON DELETE CASCADE,
             default_inference  INTEGER NOT NULL DEFAULT 0,
             default_treasury   INTEGER NOT NULL DEFAULT 0,
             default_suballoc   INTEGER NOT NULL DEFAULT 0,
             default_hire       INTEGER NOT NULL DEFAULT 0,
             epoch_period_secs  INTEGER NOT NULL DEFAULT 604800,
             rollover_mode      TEXT NOT NULL DEFAULT 'burn'
                                CHECK (rollover_mode IN ('burn','rollover')),
             set_by_role_id     TEXT REFERENCES roles(id),
             updated_at         TEXT NOT NULL
         );

         CREATE TABLE IF NOT EXISTS treasury_events (
             id                 INTEGER PRIMARY KEY AUTOINCREMENT,
             event_type         TEXT NOT NULL,
             budget_id          TEXT NOT NULL REFERENCES budgets(id),
             acting_role_id     TEXT NOT NULL REFERENCES roles(id),
             actor_agent_id     TEXT,
             counter_budget_id  TEXT REFERENCES budgets(id),
             epoch              INTEGER NOT NULL,
             amount             INTEGER,
             request_hash       TEXT,
             idempotency_key    TEXT,
             created_at         TEXT NOT NULL
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_events_request_hash
             ON treasury_events(request_hash) WHERE request_hash IS NOT NULL;
         CREATE UNIQUE INDEX IF NOT EXISTS idx_treasury_events_idempotency
             ON treasury_events(budget_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
         CREATE INDEX IF NOT EXISTS idx_treasury_events_budget_epoch
             ON treasury_events(budget_id, epoch);
         CREATE INDEX IF NOT EXISTS idx_treasury_events_type
             ON treasury_events(event_type);

         CREATE TABLE IF NOT EXISTS treasury_config (
             trust_id           TEXT PRIMARY KEY,
             inference_gateway  TEXT NOT NULL,
             paused             INTEGER NOT NULL DEFAULT 0,
             admin_role_id      TEXT NOT NULL REFERENCES roles(id),
             updated_at         TEXT NOT NULL
         );",
    )?;
    Ok(())
}

/// Idempotent: if `table` exists on disk with a legacy `entity_id` column,
/// rename it to `trust_id`. No-op if the table does not exist, or if the
/// rename has already run. Skips if `trust_id` is already present (the table
/// was created fresh under the new column name).
fn rename_legacy_entity_id(conn: &Connection, table: &str) -> rusqlite::Result<()> {
    let cols: Vec<String> = {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        stmt.query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect()
    };
    if cols.is_empty() {
        return Ok(());
    }
    let has_legacy = cols.iter().any(|c| c == "entity_id");
    let has_canonical = cols.iter().any(|c| c == "trust_id");
    if has_legacy && !has_canonical {
        conn.execute(
            &format!("ALTER TABLE {table} RENAME COLUMN entity_id TO trust_id"),
            [],
        )?;
    }
    Ok(())
}

// ── Row mappers ───────────────────────────────────────────────────────────────

fn row_to_budget(row: &rusqlite::Row<'_>) -> rusqlite::Result<Budget> {
    Ok(Budget {
        id: row.get(0)?,
        trust_id: row.get(1)?,
        parent_budget_id: row.get(2)?,
        owner_role_id: row.get(3)?,
        name: row.get(4)?,
        kind: {
            let s: String = row.get(5)?;
            s.parse::<BudgetKind>().unwrap_or(BudgetKind::Operating)
        },
        is_primary: {
            let v: i64 = row.get(6)?;
            v != 0
        },
        created_by_role_id: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn row_to_allowance(row: &rusqlite::Row<'_>) -> rusqlite::Result<BudgetAllowance> {
    Ok(BudgetAllowance {
        budget_id: row.get(0)?,
        epoch: row.get(1)?,
        caps: AllowanceBundle {
            inference_credits: row.get(2)?,
            treasury_cap: row.get(3)?,
            suballoc_cap: row.get(4)?,
            hire_cap: row.get(5)?,
        },
        spent_inference: row.get(6)?,
        spent_treasury: row.get(7)?,
        spent_suballoc: row.get(8)?,
        used_hire: row.get(9)?,
        last_event_at: row.get(10)?,
    })
}

fn row_to_policy(row: &rusqlite::Row<'_>) -> rusqlite::Result<BudgetPolicy> {
    Ok(BudgetPolicy {
        budget_id: row.get(0)?,
        defaults: AllowanceBundle {
            inference_credits: row.get(1)?,
            treasury_cap: row.get(2)?,
            suballoc_cap: row.get(3)?,
            hire_cap: row.get(4)?,
        },
        epoch_period_secs: row.get(5)?,
        rollover_mode: {
            let s: String = row.get(6)?;
            s.parse::<RolloverMode>().unwrap_or(RolloverMode::Burn)
        },
        set_by_role_id: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<TreasuryEvent> {
    Ok(TreasuryEvent {
        id: row.get(0)?,
        event_type: row.get(1)?,
        budget_id: row.get(2)?,
        acting_role_id: row.get(3)?,
        actor_agent_id: row.get(4)?,
        counter_budget_id: row.get(5)?,
        epoch: row.get(6)?,
        amount: row.get(7)?,
        request_hash: row.get(8)?,
        idempotency_key: row.get(9)?,
        created_at: row.get(10)?,
    })
}

const SQL_BUDGET_COLS: &str = "id, trust_id, parent_budget_id, owner_role_id, name, kind, is_primary, \
     created_by_role_id, created_at";

const SQL_ALLOWANCE_COLS: &str = "budget_id, epoch, inference_credits, treasury_cap, suballoc_cap, hire_cap, \
     spent_inference, spent_treasury, spent_suballoc, used_hire, last_event_at";

const SQL_POLICY_COLS: &str = "budget_id, default_inference, default_treasury, default_suballoc, \
     default_hire, epoch_period_secs, rollover_mode, set_by_role_id, updated_at";

const SQL_EVENT_COLS: &str = "id, event_type, budget_id, acting_role_id, actor_agent_id, counter_budget_id, \
     epoch, amount, request_hash, idempotency_key, created_at";

// ── Registry ──────────────────────────────────────────────────────────────────

/// SQLite-backed budget registry. Shares `ConnectionPool` with
/// [`AgentRegistry`] / [`RoleRegistry`] / [`EntityRegistry`] —
/// budgets live in the same `aeqi.db` as roles + role_edges.
pub struct BudgetRegistry {
    db: Arc<ConnectionPool>,
}

impl BudgetRegistry {
    pub fn open(db: Arc<ConnectionPool>) -> Self {
        Self { db }
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    pub async fn get_budget(&self, id: &str) -> Result<Option<Budget>> {
        let db = self.db.lock().await;
        Ok(db
            .query_row(
                &format!("SELECT {SQL_BUDGET_COLS} FROM budgets WHERE id = ?1"),
                params![id],
                row_to_budget,
            )
            .optional()?)
    }

    pub async fn list_budgets(
        &self,
        trust_id: &str,
        owner_role_id: Option<&str>,
        parent_budget_id: Option<&str>,
        only_primary: Option<bool>,
    ) -> Result<Vec<Budget>> {
        let db = self.db.lock().await;
        let mut sql = format!("SELECT {SQL_BUDGET_COLS} FROM budgets WHERE trust_id = ?1");
        if owner_role_id.is_some() {
            sql.push_str(" AND owner_role_id = ?2");
        }
        if parent_budget_id.is_some() {
            sql.push_str(if owner_role_id.is_some() {
                " AND parent_budget_id = ?3"
            } else {
                " AND parent_budget_id = ?2"
            });
        }
        if let Some(prim) = only_primary {
            // append at the end with the next index
            let next =
                2 + (owner_role_id.is_some() as usize) + (parent_budget_id.is_some() as usize);
            sql.push_str(&format!(" AND is_primary = ?{next}"));
            let mut stmt = db.prepare(&sql)?;
            let rows: Vec<Budget> = match (owner_role_id, parent_budget_id) {
                (None, None) => stmt
                    .query_map(params![trust_id, prim as i64], row_to_budget)?
                    .filter_map(|r| r.ok())
                    .collect(),
                (Some(o), None) => stmt
                    .query_map(params![trust_id, o, prim as i64], row_to_budget)?
                    .filter_map(|r| r.ok())
                    .collect(),
                (None, Some(p)) => stmt
                    .query_map(params![trust_id, p, prim as i64], row_to_budget)?
                    .filter_map(|r| r.ok())
                    .collect(),
                (Some(o), Some(p)) => stmt
                    .query_map(params![trust_id, o, p, prim as i64], row_to_budget)?
                    .filter_map(|r| r.ok())
                    .collect(),
            };
            return Ok(rows);
        }
        sql.push_str(" ORDER BY created_at ASC");
        let mut stmt = db.prepare(&sql)?;
        let rows: Vec<Budget> = match (owner_role_id, parent_budget_id) {
            (None, None) => stmt
                .query_map(params![trust_id], row_to_budget)?
                .filter_map(|r| r.ok())
                .collect(),
            (Some(o), None) => stmt
                .query_map(params![trust_id, o], row_to_budget)?
                .filter_map(|r| r.ok())
                .collect(),
            (None, Some(p)) => stmt
                .query_map(params![trust_id, p], row_to_budget)?
                .filter_map(|r| r.ok())
                .collect(),
            (Some(o), Some(p)) => stmt
                .query_map(params![trust_id, o, p], row_to_budget)?
                .filter_map(|r| r.ok())
                .collect(),
        };
        Ok(rows)
    }

    pub async fn budget_tree(&self, trust_id: &str) -> Result<BudgetTree> {
        let db = self.db.lock().await;
        let nodes: Vec<Budget> = {
            let mut stmt = db.prepare(&format!(
                "SELECT {SQL_BUDGET_COLS} FROM budgets WHERE trust_id = ?1 \
                 ORDER BY created_at ASC"
            ))?;
            stmt.query_map(params![trust_id], row_to_budget)?
                .filter_map(|r| r.ok())
                .collect()
        };
        let edges: Vec<(String, String)> = {
            let mut stmt = db.prepare(
                "SELECT b.parent_budget_id, b.id \
                 FROM budgets b \
                 WHERE b.trust_id = ?1 AND b.parent_budget_id IS NOT NULL",
            )?;
            stmt.query_map(params![trust_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .collect()
        };
        Ok(BudgetTree { nodes, edges })
    }

    pub async fn get_allowance(
        &self,
        budget_id: &str,
        epoch: i64,
    ) -> Result<Option<BudgetAllowance>> {
        let db = self.db.lock().await;
        Ok(db
            .query_row(
                &format!(
                    "SELECT {SQL_ALLOWANCE_COLS} FROM budget_allowances \
                     WHERE budget_id = ?1 AND epoch = ?2"
                ),
                params![budget_id, epoch],
                row_to_allowance,
            )
            .optional()?)
    }

    /// The most-recent allowance row for this budget (any epoch).
    /// Does not refresh — callers wanting the live current epoch use
    /// [`current_allowance`] (which auto-refreshes).
    pub async fn latest_allowance(&self, budget_id: &str) -> Result<Option<BudgetAllowance>> {
        let db = self.db.lock().await;
        Ok(db
            .query_row(
                &format!(
                    "SELECT {SQL_ALLOWANCE_COLS} FROM budget_allowances \
                     WHERE budget_id = ?1 \
                     ORDER BY epoch DESC LIMIT 1"
                ),
                params![budget_id],
                row_to_allowance,
            )
            .optional()?)
    }

    /// The current epoch's allowance, materialising it from policy if the
    /// epoch boundary has passed.
    pub async fn current_allowance(&self, budget_id: &str) -> Result<BudgetAllowance> {
        self.refresh(budget_id).await?;
        let latest =
            self.latest_allowance(budget_id)
                .await?
                .ok_or_else(|| BudgetError::EPolicyMissing {
                    budget: budget_id.to_string(),
                })?;
        Ok(latest)
    }

    pub async fn get_policy(&self, budget_id: &str) -> Result<Option<BudgetPolicy>> {
        let db = self.db.lock().await;
        Ok(db
            .query_row(
                &format!("SELECT {SQL_POLICY_COLS} FROM budget_policies WHERE budget_id = ?1"),
                params![budget_id],
                row_to_policy,
            )
            .optional()?)
    }

    pub async fn spend_history(
        &self,
        budget_id: &str,
        since: Option<DateTime<Utc>>,
        event_type: Option<&str>,
        limit: i64,
    ) -> Result<Vec<TreasuryEvent>> {
        let limit = limit.clamp(1, 500);
        let db = self.db.lock().await;
        let since_str = since.map(|t| t.to_rfc3339());
        let mut sql = format!("SELECT {SQL_EVENT_COLS} FROM treasury_events WHERE budget_id = ?1");
        let mut idx = 2;
        if since_str.is_some() {
            sql.push_str(&format!(" AND created_at >= ?{idx}"));
            idx += 1;
        }
        if event_type.is_some() {
            sql.push_str(&format!(" AND event_type = ?{idx}"));
            idx += 1;
        }
        sql.push_str(&format!(" ORDER BY id DESC LIMIT ?{idx}"));
        let mut stmt = db.prepare(&sql)?;
        let rows: Vec<TreasuryEvent> = match (&since_str, event_type) {
            (None, None) => stmt
                .query_map(params![budget_id, limit], row_to_event)?
                .filter_map(|r| r.ok())
                .collect(),
            (Some(s), None) => stmt
                .query_map(params![budget_id, s, limit], row_to_event)?
                .filter_map(|r| r.ok())
                .collect(),
            (None, Some(et)) => stmt
                .query_map(params![budget_id, et, limit], row_to_event)?
                .filter_map(|r| r.ok())
                .collect(),
            (Some(s), Some(et)) => stmt
                .query_map(params![budget_id, s, et, limit], row_to_event)?
                .filter_map(|r| r.ok())
                .collect(),
        };
        Ok(rows)
    }

    pub async fn get_treasury_config(&self, trust_id: &str) -> Result<Option<TreasuryConfig>> {
        let db = self.db.lock().await;
        Ok(db
            .query_row(
                "SELECT trust_id, inference_gateway, paused, admin_role_id, updated_at \
                 FROM treasury_config WHERE trust_id = ?1",
                params![trust_id],
                |row| {
                    Ok(TreasuryConfig {
                        trust_id: row.get(0)?,
                        inference_gateway: row.get(1)?,
                        paused: {
                            let v: i64 = row.get(2)?;
                            v != 0
                        },
                        admin_role_id: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .optional()?)
    }

    /// Look up or lazily create the primary budget for a role. Zero-funded;
    /// callers fund it via `allocate` from a parent budget.
    pub async fn primary_budget(&self, role_id: &str) -> Result<Budget> {
        // Fast path — read.
        {
            let db = self.db.lock().await;
            let existing: Option<Budget> = db
                .query_row(
                    &format!(
                        "SELECT {SQL_BUDGET_COLS} FROM budgets \
                         WHERE owner_role_id = ?1 AND is_primary = 1"
                    ),
                    params![role_id],
                    row_to_budget,
                )
                .optional()?;
            if let Some(b) = existing {
                return Ok(b);
            }
        }
        // Slow path — create. Resolve the role's entity (= trust_id) first.
        let trust_id: String = {
            let db = self.db.lock().await;
            db.query_row(
                "SELECT trust_id FROM roles WHERE id = ?1",
                params![role_id],
                |row| row.get::<_, String>(0),
            )?
        };
        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let title: String = {
            let db = self.db.lock().await;
            db.query_row(
                "SELECT title FROM roles WHERE id = ?1",
                params![role_id],
                |row| row.get::<_, String>(0),
            )?
        };
        let name = format!("Primary — {title}");
        {
            let db = self.db.lock().await;
            db.execute(
                "INSERT INTO budgets (id, trust_id, parent_budget_id, owner_role_id, \
                                      name, kind, is_primary, created_by_role_id, created_at) \
                 VALUES (?1, ?2, NULL, ?3, ?4, 'primary', 1, NULL, ?5)",
                params![id, trust_id, role_id, name, now],
            )?;
            // Default zero policy so refresh() has something to read.
            db.execute(
                "INSERT INTO budget_policies (budget_id, default_inference, default_treasury, \
                                              default_suballoc, default_hire, epoch_period_secs, \
                                              rollover_mode, set_by_role_id, updated_at) \
                 VALUES (?1, 0, 0, 0, 0, 604800, 'burn', NULL, ?2)",
                params![id, now],
            )?;
        }
        self.get_budget(&id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("primary budget vanished after insert"))
    }

    // ── Writes ────────────────────────────────────────────────────────────────

    /// Create a child budget under an optional parent. `caller_role` must
    /// occupy the parent budget's owner_role (or, when `parent_budget_id`
    /// is `None`, must hold `roles.manage` on the trust — that gate is
    /// enforced at the IPC layer; this method trusts the caller_role).
    pub async fn create_budget(
        &self,
        trust_id: &str,
        parent_budget_id: Option<&str>,
        owner_role_id: &str,
        name: &str,
        kind: BudgetKind,
        caller_role: &str,
        caller_agent_id: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<String> {
        self.assert_not_paused(trust_id).await?;
        self.assert_owner_role_in_trust(owner_role_id, trust_id)
            .await?;

        // Auth: when parent provided, caller must be the parent's owner.
        if let Some(parent) = parent_budget_id {
            let parent_b = self
                .get_budget(parent)
                .await?
                .ok_or_else(|| BudgetError::ENotFound(parent.to_string()))?;
            if parent_b.trust_id != trust_id {
                return Err(BudgetError::EParentBudgetNotInTrust {
                    parent: parent.to_string(),
                    trust: trust_id.to_string(),
                }
                .into());
            }
            if parent_b.owner_role_id != caller_role {
                return Err(BudgetError::ENotOwner.into());
            }
        }

        if let Some(key) = idempotency_key
            && let Some(existing) = self.dedup_existing(parent_budget_id, key).await?
        {
            return existing
                .counter_budget_id
                .ok_or_else(|| anyhow::anyhow!("dedup row has no counter_budget_id"));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        {
            let db = self.db.lock().await;
            db.execute(
                "INSERT INTO budgets (id, trust_id, parent_budget_id, owner_role_id, \
                                      name, kind, is_primary, created_by_role_id, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8)",
                params![
                    id,
                    trust_id,
                    parent_budget_id,
                    owner_role_id,
                    name,
                    kind.as_db(),
                    caller_role,
                    now
                ],
            )?;
            // Zero default policy — the owner can `set_policy` to fund the
            // refresh cycle.
            db.execute(
                "INSERT INTO budget_policies (budget_id, default_inference, default_treasury, \
                                              default_suballoc, default_hire, epoch_period_secs, \
                                              rollover_mode, set_by_role_id, updated_at) \
                 VALUES (?1, 0, 0, 0, 0, 604800, 'burn', ?2, ?3)",
                params![id, caller_role, now],
            )?;
            // Audit event scoped to the parent (or to the new budget when no parent).
            let event_budget = parent_budget_id.unwrap_or(&id);
            insert_event(
                &db,
                EV_BUDGET_CREATED,
                event_budget,
                caller_role,
                caller_agent_id,
                Some(&id),
                0,
                None,
                None,
                idempotency_key,
                &now,
            )?;
        }
        Ok(id)
    }

    pub async fn set_policy(
        &self,
        budget_id: &str,
        defaults: AllowanceBundle,
        epoch_period_secs: i64,
        rollover_mode: RolloverMode,
        caller_role: &str,
        caller_agent_id: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<()> {
        let budget = self
            .get_budget(budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(budget_id.to_string()))?;
        self.assert_not_paused(&budget.trust_id).await?;
        if budget.owner_role_id != caller_role {
            return Err(BudgetError::ENotOwner.into());
        }
        if let Some(key) = idempotency_key
            && self.dedup_existing(Some(budget_id), key).await?.is_some()
        {
            return Ok(());
        }
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO budget_policies (budget_id, default_inference, default_treasury, \
                                          default_suballoc, default_hire, epoch_period_secs, \
                                          rollover_mode, set_by_role_id, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(budget_id) DO UPDATE SET
                 default_inference = excluded.default_inference,
                 default_treasury  = excluded.default_treasury,
                 default_suballoc  = excluded.default_suballoc,
                 default_hire      = excluded.default_hire,
                 epoch_period_secs = excluded.epoch_period_secs,
                 rollover_mode     = excluded.rollover_mode,
                 set_by_role_id    = excluded.set_by_role_id,
                 updated_at        = excluded.updated_at",
            params![
                budget_id,
                defaults.inference_credits,
                defaults.treasury_cap,
                defaults.suballoc_cap,
                defaults.hire_cap,
                epoch_period_secs,
                rollover_mode.as_db(),
                caller_role,
                now
            ],
        )?;
        insert_event(
            &db,
            EV_POLICY_SET,
            budget_id,
            caller_role,
            caller_agent_id,
            None,
            0,
            None,
            None,
            idempotency_key,
            &now,
        )?;
        Ok(())
    }

    /// Sub-allocate from a parent budget to an existing child budget,
    /// debiting the parent's caps and crediting the child's current epoch.
    pub async fn allocate(
        &self,
        parent_budget_id: &str,
        child_budget_id: &str,
        bundle: AllowanceBundle,
        caller_role: &str,
        caller_agent_id: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<()> {
        let parent = self
            .get_budget(parent_budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(parent_budget_id.to_string()))?;
        let child = self
            .get_budget(child_budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(child_budget_id.to_string()))?;
        self.assert_not_paused(&parent.trust_id).await?;
        if parent.owner_role_id != caller_role {
            return Err(BudgetError::ENotOwner.into());
        }
        if parent.trust_id != child.trust_id {
            return Err(BudgetError::EParentBudgetNotInTrust {
                parent: parent_budget_id.to_string(),
                trust: child.trust_id.clone(),
            }
            .into());
        }
        if let Some(key) = idempotency_key
            && self
                .dedup_existing(Some(parent_budget_id), key)
                .await?
                .is_some()
        {
            return Ok(());
        }

        // Make sure both sides have current allowance rows.
        self.refresh(parent_budget_id).await?;
        self.refresh(child_budget_id).await?;

        let parent_alw = self
            .latest_allowance(parent_budget_id)
            .await?
            .ok_or_else(|| BudgetError::EPolicyMissing {
                budget: parent_budget_id.to_string(),
            })?;
        let child_alw = self
            .latest_allowance(child_budget_id)
            .await?
            .ok_or_else(|| BudgetError::EPolicyMissing {
                budget: child_budget_id.to_string(),
            })?;

        // Cap checks — parent's suballoc rail covers inference + treasury +
        // suballoc-down outflows. We treat the parent's `suballoc_cap` as a
        // single carve-out budget; per-rail bundle just decides how the
        // child slices its own allowance.
        let need_total = bundle.inference_credits + bundle.treasury_cap + bundle.suballoc_cap;
        let remaining_sub = parent_alw.remaining_suballoc();
        if need_total > remaining_sub {
            return Err(BudgetError::EInsufficientSuballoc {
                need: need_total,
                remaining: remaining_sub,
            }
            .into());
        }
        if bundle.hire_cap > parent_alw.remaining_hire() {
            return Err(BudgetError::EHireCapExceeded {
                cap: parent_alw.caps.hire_cap,
                used: parent_alw.used_hire + bundle.hire_cap,
            }
            .into());
        }

        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;

        db.execute(
            "UPDATE budget_allowances SET spent_suballoc = spent_suballoc + ?1, \
                                          used_hire      = used_hire + ?2, \
                                          last_event_at  = ?3 \
             WHERE budget_id = ?4 AND epoch = ?5",
            params![
                need_total,
                bundle.hire_cap,
                now,
                parent_budget_id,
                parent_alw.epoch
            ],
        )?;
        db.execute(
            "UPDATE budget_allowances SET inference_credits = inference_credits + ?1, \
                                          treasury_cap      = treasury_cap + ?2, \
                                          suballoc_cap      = suballoc_cap + ?3, \
                                          hire_cap          = hire_cap + ?4, \
                                          last_event_at     = ?5 \
             WHERE budget_id = ?6 AND epoch = ?7",
            params![
                bundle.inference_credits,
                bundle.treasury_cap,
                bundle.suballoc_cap,
                bundle.hire_cap,
                now,
                child_budget_id,
                child_alw.epoch
            ],
        )?;
        insert_event(
            &db,
            EV_ALLOCATED,
            parent_budget_id,
            caller_role,
            caller_agent_id,
            Some(child_budget_id),
            parent_alw.epoch,
            Some(need_total),
            None,
            idempotency_key,
            &now,
        )?;
        Ok(())
    }

    /// Debit an inference burn against a budget. The caller MUST be the
    /// trust's `inference_gateway` agent; this is enforced by the IPC
    /// layer (CallerKind::System tools bypass agent ACL but this helper
    /// re-checks against the registered gateway agent_id for defense in
    /// depth).
    pub async fn spend_inference(
        &self,
        budget_id: &str,
        amount: i64,
        request_hash: &str,
        actor_agent_id: &str,
        gateway_agent_id: &str,
    ) -> Result<()> {
        let budget = self
            .get_budget(budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(budget_id.to_string()))?;
        let cfg = self
            .get_treasury_config(&budget.trust_id)
            .await?
            .ok_or_else(|| BudgetError::EGatewayMismatch {
                caller: gateway_agent_id.to_string(),
            })?;
        if cfg.paused {
            return Err(BudgetError::EPaused.into());
        }
        if cfg.inference_gateway != gateway_agent_id {
            return Err(BudgetError::EGatewayMismatch {
                caller: gateway_agent_id.to_string(),
            }
            .into());
        }

        // Idempotency on request_hash — explicit dedup before the unique
        // index would fire so the caller gets a clean Ok rather than an
        // anyhow surfacing the SQLite UNIQUE error.
        if self.dedup_request_hash(request_hash).await?.is_some() {
            return Ok(());
        }

        self.refresh(budget_id).await?;
        let alw =
            self.latest_allowance(budget_id)
                .await?
                .ok_or_else(|| BudgetError::EPolicyMissing {
                    budget: budget_id.to_string(),
                })?;
        let remaining = alw.remaining_inference();
        if amount > remaining {
            return Err(BudgetError::EInsufficientInference {
                need: amount,
                remaining,
            }
            .into());
        }
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "UPDATE budget_allowances SET spent_inference = spent_inference + ?1, \
                                          last_event_at   = ?2 \
             WHERE budget_id = ?3 AND epoch = ?4",
            params![amount, now, budget_id, alw.epoch],
        )?;
        insert_event(
            &db,
            EV_INFERENCE_SPENT,
            budget_id,
            &budget.owner_role_id,
            Some(actor_agent_id),
            None,
            alw.epoch,
            Some(amount),
            Some(request_hash),
            None,
            &now,
        )?;
        Ok(())
    }

    /// USDC outflow from this trust's treasury vault, debiting the budget's
    /// `treasury_cap`. Caller must occupy the budget's owner role.
    pub async fn spend_treasury(
        &self,
        budget_id: &str,
        destination: &str,
        amount: i64,
        memo: Option<&str>,
        caller_role: &str,
        caller_agent_id: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<()> {
        let budget = self
            .get_budget(budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(budget_id.to_string()))?;
        self.assert_not_paused(&budget.trust_id).await?;
        if budget.owner_role_id != caller_role {
            return Err(BudgetError::ENotOwner.into());
        }
        // Vacant owner cannot spend (no signer).
        let owner_kind: String = {
            let db = self.db.lock().await;
            db.query_row(
                "SELECT occupant_kind FROM roles WHERE id = ?1",
                params![&budget.owner_role_id],
                |row| row.get::<_, String>(0),
            )?
        };
        if owner_kind == "vacant" {
            return Err(BudgetError::EVacantOwnerCannotSpend.into());
        }
        if let Some(key) = idempotency_key
            && self.dedup_existing(Some(budget_id), key).await?.is_some()
        {
            return Ok(());
        }

        self.refresh(budget_id).await?;
        let alw =
            self.latest_allowance(budget_id)
                .await?
                .ok_or_else(|| BudgetError::EPolicyMissing {
                    budget: budget_id.to_string(),
                })?;
        let remaining = alw.remaining_treasury();
        if amount > remaining {
            return Err(BudgetError::EInsufficientTreasury {
                need: amount,
                remaining,
            }
            .into());
        }
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "UPDATE budget_allowances SET spent_treasury = spent_treasury + ?1, \
                                          last_event_at  = ?2 \
             WHERE budget_id = ?3 AND epoch = ?4",
            params![amount, now, budget_id, alw.epoch],
        )?;
        // memo is folded into request_hash slot for now; treasury_events
        // will gain a `memo` column in WS-B2 when transactions render in UI.
        let _ = memo;
        let _ = destination;
        insert_event(
            &db,
            EV_TREASURY_SPENT,
            budget_id,
            caller_role,
            caller_agent_id,
            None,
            alw.epoch,
            Some(amount),
            None,
            idempotency_key,
            &now,
        )?;
        Ok(())
    }

    /// Atomic compose: create new role under `parent_role_id`, auto-create
    /// its primary budget, allocate from `parent_budget_id` into the new
    /// primary. Caller must occupy `parent_budget`'s owner role.
    pub async fn hire(
        &self,
        parent_budget_id: &str,
        parent_role_id: &str,
        new_role: NewRoleSpec,
        bundle: AllowanceBundle,
        caller_role: &str,
        caller_agent_id: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<HireResult> {
        let parent = self
            .get_budget(parent_budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(parent_budget_id.to_string()))?;
        self.assert_not_paused(&parent.trust_id).await?;
        if parent.owner_role_id != caller_role {
            return Err(BudgetError::ENotOwner.into());
        }
        if let Some(key) = idempotency_key
            && let Some(existing) = self.dedup_existing(Some(parent_budget_id), key).await?
        {
            return Ok(HireResult {
                role_id: existing
                    .counter_budget_id
                    .as_ref()
                    .map(|_| String::new())
                    .unwrap_or_default(),
                primary_budget_id: existing.counter_budget_id.unwrap_or_default(),
            });
        }

        let role_id = uuid::Uuid::new_v4().to_string();
        let budget_id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let occupant_kind = new_role.occupant_kind.as_deref().unwrap_or("vacant");
        let occupant_id = if occupant_kind == "vacant" {
            None
        } else {
            new_role.occupant_id.clone()
        };
        let role_type = new_role.role_type.as_deref().unwrap_or("operational");
        let grants = new_role.grants.clone().unwrap_or_else(|| match role_type {
            "director" => vec![
                "roles.manage".into(),
                "agents.spawn".into(),
                "agents.configure".into(),
                "treasury.read".into(),
                "governance.read".into(),
                "settings.modify".into(),
            ],
            "advisor" => vec!["treasury.read".into(), "governance.read".into()],
            _ => vec![
                "roles.manage".into(),
                "agents.spawn".into(),
                "agents.configure".into(),
                "treasury.read".into(),
            ],
        });

        // Atomic transaction across roles + role_edges + budgets +
        // budget_policies + budget_allowances + treasury_events.
        {
            let mut conn = self.db.lock().await;
            let tx = conn.transaction()?;

            // 1. Insert the new role row. Mirrors RoleRegistry::create_with_type.
            tx.execute(
                "INSERT INTO roles (id, trust_id, title, occupant_kind, occupant_id, \
                                    role_type, founder, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7)",
                params![
                    role_id,
                    parent.trust_id,
                    new_role.title,
                    occupant_kind,
                    occupant_id,
                    role_type,
                    now
                ],
            )?;
            for g in &grants {
                tx.execute(
                    "INSERT INTO role_grants (role_id, grant, created_at) \
                     VALUES (?1, ?2, ?3) \
                     ON CONFLICT(role_id, grant) DO NOTHING",
                    params![role_id, g, now],
                )?;
            }

            // 2. Insert the role edge: parent_role_id → new role.
            if parent_role_id != role_id {
                tx.execute(
                    "INSERT INTO role_edges (parent_role_id, child_role_id) \
                     VALUES (?1, ?2) \
                     ON CONFLICT(parent_role_id, child_role_id) DO NOTHING",
                    params![parent_role_id, role_id],
                )?;
            }

            // 3. Insert the primary budget for the new role.
            let name = format!("Primary — {}", new_role.title);
            tx.execute(
                "INSERT INTO budgets (id, trust_id, parent_budget_id, owner_role_id, name, \
                                      kind, is_primary, created_by_role_id, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, 'primary', 1, ?6, ?7)",
                params![
                    budget_id,
                    parent.trust_id,
                    parent_budget_id,
                    role_id,
                    name,
                    caller_role,
                    now
                ],
            )?;
            tx.execute(
                "INSERT INTO budget_policies (budget_id, default_inference, default_treasury, \
                                              default_suballoc, default_hire, epoch_period_secs, \
                                              rollover_mode, set_by_role_id, updated_at) \
                 VALUES (?1, 0, 0, 0, 0, 604800, 'burn', ?2, ?3)",
                params![budget_id, caller_role, now],
            )?;

            // 4. Refresh parent + new child allowances (epoch 0 materialises).
            let parent_period = tx
                .query_row(
                    "SELECT epoch_period_secs FROM budget_policies WHERE budget_id = ?1",
                    params![parent_budget_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(604_800);
            let parent_anchor = trust_anchor_unix(&tx, &parent.trust_id)?;
            let now_unix = Utc::now().timestamp();
            let parent_epoch = ((now_unix - parent_anchor) / parent_period.max(1)).max(0);
            let child_period = 604_800_i64;
            let child_anchor = parent_anchor;
            let child_epoch = ((now_unix - child_anchor) / child_period.max(1)).max(0);

            // Ensure parent's epoch row exists (with policy defaults).
            ensure_allowance_row(&tx, parent_budget_id, parent_epoch, &now)?;
            // Child starts at zero caps.
            tx.execute(
                "INSERT INTO budget_allowances (budget_id, epoch, last_event_at) \
                 VALUES (?1, ?2, ?3) \
                 ON CONFLICT(budget_id, epoch) DO NOTHING",
                params![budget_id, child_epoch, now],
            )?;

            // 5. Cap check + debit on parent suballoc + hire rails.
            let parent_row: BudgetAllowance = tx.query_row(
                &format!(
                    "SELECT {SQL_ALLOWANCE_COLS} FROM budget_allowances \
                     WHERE budget_id = ?1 AND epoch = ?2"
                ),
                params![parent_budget_id, parent_epoch],
                row_to_allowance,
            )?;
            let need_total = bundle.inference_credits + bundle.treasury_cap + bundle.suballoc_cap;
            if need_total > parent_row.remaining_suballoc() {
                return Err(BudgetError::EInsufficientSuballoc {
                    need: need_total,
                    remaining: parent_row.remaining_suballoc(),
                }
                .into());
            }
            if parent_row.remaining_hire() < 1 {
                return Err(BudgetError::EHireCapExceeded {
                    cap: parent_row.caps.hire_cap,
                    used: parent_row.used_hire + 1,
                }
                .into());
            }
            tx.execute(
                "UPDATE budget_allowances SET spent_suballoc = spent_suballoc + ?1, \
                                              used_hire      = used_hire + 1, \
                                              last_event_at  = ?2 \
                 WHERE budget_id = ?3 AND epoch = ?4",
                params![need_total, now, parent_budget_id, parent_epoch],
            )?;
            tx.execute(
                "UPDATE budget_allowances SET inference_credits = inference_credits + ?1, \
                                              treasury_cap      = treasury_cap + ?2, \
                                              suballoc_cap      = suballoc_cap + ?3, \
                                              hire_cap          = hire_cap + ?4, \
                                              last_event_at     = ?5 \
                 WHERE budget_id = ?6 AND epoch = ?7",
                params![
                    bundle.inference_credits,
                    bundle.treasury_cap,
                    bundle.suballoc_cap,
                    bundle.hire_cap,
                    now,
                    budget_id,
                    child_epoch
                ],
            )?;

            // 6. Audit events: budget_created, allocated, hired.
            tx.execute(
                "INSERT INTO treasury_events (event_type, budget_id, acting_role_id, \
                                              actor_agent_id, counter_budget_id, epoch, amount, \
                                              request_hash, idempotency_key, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    EV_BUDGET_CREATED,
                    parent_budget_id,
                    caller_role,
                    caller_agent_id,
                    &budget_id,
                    parent_epoch,
                    Option::<i64>::None,
                    Option::<&str>::None,
                    Option::<&str>::None,
                    now,
                ],
            )?;
            tx.execute(
                "INSERT INTO treasury_events (event_type, budget_id, acting_role_id, \
                                              actor_agent_id, counter_budget_id, epoch, amount, \
                                              request_hash, idempotency_key, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    EV_ALLOCATED,
                    parent_budget_id,
                    caller_role,
                    caller_agent_id,
                    &budget_id,
                    parent_epoch,
                    need_total,
                    Option::<&str>::None,
                    Option::<&str>::None,
                    now,
                ],
            )?;
            tx.execute(
                "INSERT INTO treasury_events (event_type, budget_id, acting_role_id, \
                                              actor_agent_id, counter_budget_id, epoch, amount, \
                                              request_hash, idempotency_key, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    EV_HIRED,
                    parent_budget_id,
                    caller_role,
                    caller_agent_id,
                    // The new role is recoverable via this budget's owner_role_id;
                    // counter_budget_id has a FK to budgets so we point at the
                    // primary budget we just created.
                    &budget_id,
                    parent_epoch,
                    Option::<i64>::None,
                    Option::<&str>::None,
                    idempotency_key,
                    now,
                ],
            )?;

            tx.commit()?;
        }

        Ok(HireResult {
            role_id,
            primary_budget_id: budget_id,
        })
    }

    /// Materialise the next epoch's allowance from policy if the boundary
    /// has crossed. Permissionless. Idempotent.
    pub async fn refresh(&self, budget_id: &str) -> Result<Option<BudgetAllowance>> {
        self.refresh_at(budget_id, Utc::now()).await
    }

    /// Test seam — pass a specific `now` to exercise epoch boundaries.
    pub async fn refresh_at(
        &self,
        budget_id: &str,
        now: DateTime<Utc>,
    ) -> Result<Option<BudgetAllowance>> {
        let budget = self
            .get_budget(budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(budget_id.to_string()))?;
        let policy =
            self.get_policy(budget_id)
                .await?
                .ok_or_else(|| BudgetError::EPolicyMissing {
                    budget: budget_id.to_string(),
                })?;

        let now_str = now.to_rfc3339();
        let now_unix = now.timestamp();

        let mut conn = self.db.lock().await;
        let anchor = trust_anchor_unix(&conn, &budget.trust_id)?;
        let period = policy.epoch_period_secs.max(1);
        let current_epoch = ((now_unix - anchor) / period).max(0);

        // Latest allowance row for this budget (any epoch).
        let latest: Option<BudgetAllowance> = conn
            .query_row(
                &format!(
                    "SELECT {SQL_ALLOWANCE_COLS} FROM budget_allowances \
                     WHERE budget_id = ?1 ORDER BY epoch DESC LIMIT 1"
                ),
                params![budget_id],
                row_to_allowance,
            )
            .optional()?;

        let need_new = match &latest {
            None => true,
            Some(l) => l.epoch < current_epoch,
        };
        if !need_new {
            return Ok(None);
        }

        // Compute new caps from policy (and rollover if applicable).
        let mut new_caps = policy.defaults;
        if let Some(l) = &latest
            && policy.rollover_mode == RolloverMode::Rollover
        {
            new_caps.inference_credits += l.remaining_inference();
            new_caps.treasury_cap += l.remaining_treasury();
            new_caps.suballoc_cap += l.remaining_suballoc();
        }

        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO budget_allowances (budget_id, epoch, inference_credits, \
                                            treasury_cap, suballoc_cap, hire_cap, \
                                            last_event_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
             ON CONFLICT(budget_id, epoch) DO UPDATE SET
                 inference_credits = excluded.inference_credits,
                 treasury_cap      = excluded.treasury_cap,
                 suballoc_cap      = excluded.suballoc_cap,
                 hire_cap          = excluded.hire_cap,
                 last_event_at     = excluded.last_event_at",
            params![
                budget_id,
                current_epoch,
                new_caps.inference_credits,
                new_caps.treasury_cap,
                new_caps.suballoc_cap,
                new_caps.hire_cap,
                now_str,
            ],
        )?;
        let event_type = if latest.is_none() {
            EV_ALLOWANCE_CREATED
        } else {
            EV_EPOCH_REFRESHED
        };
        tx.execute(
            "INSERT INTO treasury_events (event_type, budget_id, acting_role_id, \
                                          actor_agent_id, counter_budget_id, epoch, amount, \
                                          request_hash, idempotency_key, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                event_type,
                budget_id,
                &budget.owner_role_id,
                Option::<&str>::None,
                Option::<&str>::None,
                current_epoch,
                Option::<i64>::None,
                Option::<&str>::None,
                Option::<&str>::None,
                now_str,
            ],
        )?;
        tx.commit()?;

        let row: BudgetAllowance = conn.query_row(
            &format!(
                "SELECT {SQL_ALLOWANCE_COLS} FROM budget_allowances \
                 WHERE budget_id = ?1 AND epoch = ?2"
            ),
            params![budget_id, current_epoch],
            row_to_allowance,
        )?;
        Ok(Some(row))
    }

    /// Dissolve a leaf budget (no children, zero balance across all rails).
    /// The owner role's primary budget cannot be dissolved while the role
    /// exists — dissolve the role first.
    pub async fn dissolve(
        &self,
        budget_id: &str,
        caller_role: &str,
        caller_agent_id: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<()> {
        let budget = self
            .get_budget(budget_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(budget_id.to_string()))?;
        self.assert_not_paused(&budget.trust_id).await?;
        if budget.owner_role_id != caller_role {
            // Allow parent-budget owner to dissolve descendants too.
            if let Some(parent_id) = &budget.parent_budget_id {
                let parent = self
                    .get_budget(parent_id)
                    .await?
                    .ok_or_else(|| BudgetError::ENotFound(parent_id.to_string()))?;
                if parent.owner_role_id != caller_role {
                    return Err(BudgetError::ENotOwner.into());
                }
            } else {
                return Err(BudgetError::ENotOwner.into());
            }
        }
        if budget.is_primary {
            return Err(BudgetError::EPrimaryBudgetCannotDissolve.into());
        }
        if let Some(key) = idempotency_key
            && self.dedup_existing(Some(budget_id), key).await?.is_some()
        {
            return Ok(());
        }

        let now = Utc::now().to_rfc3339();
        let mut conn = self.db.lock().await;

        // No descendants?
        let descendants: i64 = conn.query_row(
            "SELECT COUNT(*) FROM budgets WHERE parent_budget_id = ?1",
            params![budget_id],
            |row| row.get(0),
        )?;
        if descendants > 0 {
            return Err(BudgetError::EBudgetHasDescendants {
                budget: budget_id.to_string(),
            }
            .into());
        }
        // Zero balance across all current epoch rails?
        let nonzero: i64 = conn.query_row(
            "SELECT COUNT(*) FROM budget_allowances \
             WHERE budget_id = ?1 \
               AND ( (inference_credits - spent_inference) <> 0 \
                  OR (treasury_cap - spent_treasury) <> 0 \
                  OR (suballoc_cap - spent_suballoc) <> 0 \
                  OR (hire_cap - used_hire) <> 0 )",
            params![budget_id],
            |row| row.get(0),
        )?;
        if nonzero > 0 {
            return Err(BudgetError::EBudgetNonZeroBalance {
                budget: budget_id.to_string(),
            }
            .into());
        }

        let tx = conn.transaction()?;
        // Dissolve = full erase of the budget + its history. We delete
        // events in the same tx so the FK on treasury_events.budget_id
        // (NO ACTION by default) doesn't reject the budget delete. The
        // BUDGET_DISSOLVED event below references the budget by id but
        // is INSERTed AFTER the cleanup, then deleted with the budget.
        // Net: dissolve is acknowledged via the event row's existence
        // for the duration of this tx, then both vanish — operators
        // who need historical dissolve records read the activity log
        // (WS-B2 wires to ActivityLog).
        tx.execute(
            "DELETE FROM treasury_events WHERE budget_id = ?1 OR counter_budget_id = ?1",
            params![budget_id],
        )?;
        // Audit event AFTER the cleanup so the event row records the
        // dissolution itself; it's deleted alongside the budget below.
        tx.execute(
            "INSERT INTO treasury_events (event_type, budget_id, acting_role_id, \
                                          actor_agent_id, counter_budget_id, epoch, amount, \
                                          request_hash, idempotency_key, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                EV_BUDGET_DISSOLVED,
                budget_id,
                caller_role,
                caller_agent_id,
                Option::<&str>::None,
                0_i64,
                Option::<i64>::None,
                Option::<&str>::None,
                idempotency_key,
                now,
            ],
        )?;
        // Cascade through allowances + policy via ON DELETE CASCADE on
        // those FKs. Then drop the dissolution event we just emitted (it
        // still references the budget so the FK would block the delete).
        tx.execute(
            "DELETE FROM treasury_events WHERE budget_id = ?1",
            params![budget_id],
        )?;
        tx.execute("DELETE FROM budgets WHERE id = ?1", params![budget_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Pause / unpause every spend + allocate in this trust. Reads keep
    /// working. Caller must occupy `treasury_config.admin_role_id`.
    pub async fn set_pause(
        &self,
        trust_id: &str,
        paused: bool,
        caller_role: &str,
        caller_agent_id: Option<&str>,
    ) -> Result<()> {
        let cfg = self
            .get_treasury_config(trust_id)
            .await?
            .ok_or_else(|| BudgetError::ENotFound(format!("treasury_config:{trust_id}")))?;
        if cfg.admin_role_id != caller_role {
            return Err(BudgetError::ENotOwner.into());
        }
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "UPDATE treasury_config SET paused = ?1, updated_at = ?2 WHERE trust_id = ?3",
            params![paused as i64, now, trust_id],
        )?;
        // Audit emitted against admin_role's primary budget — but we don't
        // have it handy. For now, write against the first budget in the
        // trust as a convention; WS-B2 will surface this on the trust's
        // overview rather than a specific budget.
        let target_budget: Option<String> = db
            .query_row(
                "SELECT id FROM budgets WHERE trust_id = ?1 ORDER BY created_at ASC LIMIT 1",
                params![trust_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(b) = target_budget {
            insert_event(
                &db,
                EV_TREASURY_PAUSED,
                &b,
                caller_role,
                caller_agent_id,
                None,
                0,
                Some(paused as i64),
                None,
                None,
                &now,
            )?;
        }
        Ok(())
    }

    /// Initialise the trust's treasury config. Idempotent (UPSERT).
    pub async fn init_treasury_config(
        &self,
        trust_id: &str,
        inference_gateway_agent_id: &str,
        admin_role_id: &str,
    ) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        let db = self.db.lock().await;
        db.execute(
            "INSERT INTO treasury_config (trust_id, inference_gateway, paused, admin_role_id, \
                                          updated_at) \
             VALUES (?1, ?2, 0, ?3, ?4) \
             ON CONFLICT(trust_id) DO UPDATE SET
                 inference_gateway = excluded.inference_gateway,
                 admin_role_id     = excluded.admin_role_id,
                 updated_at        = excluded.updated_at",
            params![trust_id, inference_gateway_agent_id, admin_role_id, now],
        )?;
        Ok(())
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    async fn assert_not_paused(&self, trust_id: &str) -> Result<()> {
        let cfg = self.get_treasury_config(trust_id).await?;
        if let Some(c) = cfg
            && c.paused
        {
            return Err(BudgetError::EPaused.into());
        }
        Ok(())
    }

    async fn assert_owner_role_in_trust(&self, role_id: &str, trust_id: &str) -> Result<()> {
        let db = self.db.lock().await;
        let role_trust_id: Option<String> = db
            .query_row(
                "SELECT trust_id FROM roles WHERE id = ?1",
                params![role_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        match role_trust_id {
            Some(e) if e == trust_id => Ok(()),
            _ => Err(BudgetError::EOwnerRoleNotInTrust {
                role: role_id.to_string(),
                trust: trust_id.to_string(),
            }
            .into()),
        }
    }

    async fn dedup_existing(
        &self,
        budget_id: Option<&str>,
        idempotency_key: &str,
    ) -> Result<Option<TreasuryEvent>> {
        let db = self.db.lock().await;
        let row = match budget_id {
            Some(b) => db
                .query_row(
                    &format!(
                        "SELECT {SQL_EVENT_COLS} FROM treasury_events \
                         WHERE budget_id = ?1 AND idempotency_key = ?2 \
                         ORDER BY id DESC LIMIT 1"
                    ),
                    params![b, idempotency_key],
                    row_to_event,
                )
                .optional()?,
            None => db
                .query_row(
                    &format!(
                        "SELECT {SQL_EVENT_COLS} FROM treasury_events \
                         WHERE idempotency_key = ?1 \
                         ORDER BY id DESC LIMIT 1"
                    ),
                    params![idempotency_key],
                    row_to_event,
                )
                .optional()?,
        };
        Ok(row)
    }

    async fn dedup_request_hash(&self, request_hash: &str) -> Result<Option<TreasuryEvent>> {
        let db = self.db.lock().await;
        Ok(db
            .query_row(
                &format!(
                    "SELECT {SQL_EVENT_COLS} FROM treasury_events \
                     WHERE request_hash = ?1 \
                     ORDER BY id DESC LIMIT 1"
                ),
                params![request_hash],
                row_to_event,
            )
            .optional()?)
    }
}

// ── DB-internal helpers (sync, run inside a held lock) ─────────────────────────

fn trust_anchor_unix(conn: &Connection, trust_id: &str) -> rusqlite::Result<i64> {
    // Use the entity's `created_at` as the epoch anchor. Falls back to
    // the unix epoch (0) if the entity row is missing — defensive.
    let anchor: Option<String> = conn
        .query_row(
            "SELECT created_at FROM entities WHERE id = ?1",
            params![trust_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(ts) = anchor else {
        return Ok(0);
    };
    Ok(DateTime::parse_from_rfc3339(&ts)
        .map(|t| t.timestamp())
        .unwrap_or(0))
}

fn ensure_allowance_row(
    conn: &Connection,
    budget_id: &str,
    epoch: i64,
    now: &str,
) -> rusqlite::Result<()> {
    // Reads policy defaults so the row materialises with caps in place.
    let policy: Option<(i64, i64, i64, i64)> = conn
        .query_row(
            "SELECT default_inference, default_treasury, default_suballoc, default_hire \
             FROM budget_policies WHERE budget_id = ?1",
            params![budget_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let (di, dt, ds, dh) = policy.unwrap_or((0, 0, 0, 0));
    conn.execute(
        "INSERT INTO budget_allowances (budget_id, epoch, inference_credits, treasury_cap, \
                                        suballoc_cap, hire_cap, last_event_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(budget_id, epoch) DO NOTHING",
        params![budget_id, epoch, di, dt, ds, dh, now],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_event(
    conn: &Connection,
    event_type: &str,
    budget_id: &str,
    acting_role_id: &str,
    actor_agent_id: Option<&str>,
    counter_budget_id: Option<&str>,
    epoch: i64,
    amount: Option<i64>,
    request_hash: Option<&str>,
    idempotency_key: Option<&str>,
    created_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO treasury_events (event_type, budget_id, acting_role_id, actor_agent_id, \
                                      counter_budget_id, epoch, amount, request_hash, \
                                      idempotency_key, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            event_type,
            budget_id,
            acting_role_id,
            actor_agent_id,
            counter_budget_id,
            epoch,
            amount,
            request_hash,
            idempotency_key,
            created_at,
        ],
    )?;
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use crate::role_registry::{OccupantKind, RoleRegistry, RoleType};
    use std::sync::Arc;
    use tempfile::TempDir;

    struct Harness {
        _dir: TempDir,
        _agents: Arc<AgentRegistry>,
        entities: crate::entity_registry::EntityRegistry,
        roles: RoleRegistry,
        budgets: BudgetRegistry,
    }

    fn open_harness() -> Harness {
        let dir = TempDir::new().expect("tempdir");
        let agents = Arc::new(AgentRegistry::open(dir.path()).expect("agent registry"));
        let entities = crate::entity_registry::EntityRegistry::open(agents.db());
        let roles = RoleRegistry::open(agents.db());
        let budgets = BudgetRegistry::open(agents.db());
        Harness {
            _dir: dir,
            _agents: agents,
            entities,
            roles,
            budgets,
        }
    }

    async fn make_entity(
        entities: &crate::entity_registry::EntityRegistry,
        slug: &str,
    ) -> crate::entity_registry::Entity {
        entities
            .create_new(
                "Acme Co",
                slug,
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .expect("create entity")
    }

    async fn make_role(
        roles: &RoleRegistry,
        trust_id: &str,
        title: &str,
        kind: OccupantKind,
        occupant: Option<&str>,
    ) -> String {
        roles
            .create_with_type(
                trust_id,
                title,
                kind,
                occupant,
                RoleType::Operational,
                false,
                None,
            )
            .await
            .expect("create role")
            .id
    }

    #[tokio::test]
    async fn schema_setup_idempotent() {
        // Bootstrap the budget tables twice on the same connection — the
        // second call must be a no-op (every CREATE / INDEX is guarded by
        // IF NOT EXISTS).
        use rusqlite::Connection;
        let conn = Connection::open_in_memory().expect("memory db");
        // Pre-create the role + entity tables that budgets reference, since
        // bootstrap_budget_tables alone doesn't own those.
        conn.execute_batch(
            "CREATE TABLE entities (id TEXT PRIMARY KEY, slug TEXT, type TEXT, \
                                    name TEXT, created_at TEXT NOT NULL);
             CREATE TABLE roles (id TEXT PRIMARY KEY, trust_id TEXT, title TEXT, \
                                 occupant_kind TEXT, occupant_id TEXT, \
                                 role_type TEXT, founder INTEGER, \
                                 created_at TEXT NOT NULL, updated_at TEXT);",
        )
        .expect("seed schema");
        bootstrap_budget_tables(&conn).expect("first bootstrap");
        bootstrap_budget_tables(&conn).expect("second bootstrap (idempotent)");
    }

    #[tokio::test]
    async fn create_budget_and_get() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme1").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;

        let id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Operating FY26",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .expect("create root");

        let b = h.budgets.get_budget(&id).await.unwrap().unwrap();
        assert_eq!(b.name, "Operating FY26");
        assert_eq!(b.owner_role_id, ceo);
        assert_eq!(b.kind, BudgetKind::Operating);
        assert!(!b.is_primary);
    }

    #[tokio::test]
    async fn primary_budget_lazy_creates_and_caches() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme2").await;
        let cto = make_role(&h.roles, &entity.id, "CTO", OccupantKind::Human, Some("u2")).await;

        let p1 = h.budgets.primary_budget(&cto).await.expect("p1");
        let p2 = h.budgets.primary_budget(&cto).await.expect("p2");
        assert_eq!(p1.id, p2.id);
        assert!(p1.is_primary);
        assert_eq!(p1.kind, BudgetKind::Primary);
    }

    #[tokio::test]
    async fn allocate_parent_to_child_debits_caps() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme3").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let cto = make_role(&h.roles, &entity.id, "CTO", OccupantKind::Human, Some("u2")).await;

        // Root budget owned by CEO, funded via policy.
        let parent_id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Operating",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &parent_id,
                AllowanceBundle {
                    inference_credits: 0,
                    treasury_cap: 0,
                    suballoc_cap: 1000,
                    hire_cap: 5,
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets.refresh(&parent_id).await.unwrap();

        // Child budget owned by CTO.
        let child_id = h
            .budgets
            .create_budget(
                &entity.id,
                Some(&parent_id),
                &cto,
                "Eng",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets.refresh(&child_id).await.unwrap();

        // CEO sub-allocates 200 inference + 100 treasury into Eng.
        h.budgets
            .allocate(
                &parent_id,
                &child_id,
                AllowanceBundle {
                    inference_credits: 200,
                    treasury_cap: 100,
                    suballoc_cap: 0,
                    hire_cap: 1,
                },
                &ceo,
                None,
                None,
            )
            .await
            .expect("allocate");

        let child = h.budgets.current_allowance(&child_id).await.unwrap();
        assert_eq!(child.caps.inference_credits, 200);
        assert_eq!(child.caps.treasury_cap, 100);
        assert_eq!(child.caps.hire_cap, 1);

        let parent = h.budgets.current_allowance(&parent_id).await.unwrap();
        assert_eq!(parent.spent_suballoc, 300);
        assert_eq!(parent.used_hire, 1);
    }

    #[tokio::test]
    async fn allocate_rejects_insufficient_suballoc() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme4").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let cto = make_role(&h.roles, &entity.id, "CTO", OccupantKind::Human, Some("u2")).await;
        let parent_id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Operating",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &parent_id,
                AllowanceBundle {
                    suballoc_cap: 50,
                    hire_cap: 5,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        let child_id = h
            .budgets
            .create_budget(
                &entity.id,
                Some(&parent_id),
                &cto,
                "Eng",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();

        let err = h
            .budgets
            .allocate(
                &parent_id,
                &child_id,
                AllowanceBundle {
                    inference_credits: 100,
                    ..Default::default()
                },
                &ceo,
                None,
                None,
            )
            .await
            .unwrap_err();
        let be = err.downcast_ref::<BudgetError>().expect("downcast");
        assert_eq!(be.code(), "EInsufficientSuballoc");
    }

    #[tokio::test]
    async fn spend_inference_dedups_on_request_hash() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme5").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &id,
                AllowanceBundle {
                    inference_credits: 1000,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .init_treasury_config(&entity.id, "gateway-1", &ceo)
            .await
            .unwrap();
        h.budgets
            .spend_inference(&id, 100, "hash-1", "agent-A", "gateway-1")
            .await
            .unwrap();
        // Second call with the same hash must not double-debit.
        h.budgets
            .spend_inference(&id, 100, "hash-1", "agent-A", "gateway-1")
            .await
            .unwrap();
        let alw = h.budgets.current_allowance(&id).await.unwrap();
        assert_eq!(alw.spent_inference, 100);
    }

    #[tokio::test]
    async fn spend_treasury_rejects_vacant_owner() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme6").await;
        let admin = make_role(
            &h.roles,
            &entity.id,
            "Admin",
            OccupantKind::Human,
            Some("u1"),
        )
        .await;
        let vacant = make_role(&h.roles, &entity.id, "CFO", OccupantKind::Vacant, None).await;
        let id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &vacant,
                "Vault",
                BudgetKind::Operating,
                &admin,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &id,
                AllowanceBundle {
                    treasury_cap: 1000,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &vacant,
                None,
                None,
            )
            .await
            .unwrap();

        let err = h
            .budgets
            .spend_treasury(&id, "0xdest", 100, None, &vacant, None, None)
            .await
            .unwrap_err();
        assert_eq!(
            err.downcast_ref::<BudgetError>().unwrap().code(),
            "EVacantOwnerCannotSpend"
        );
    }

    #[tokio::test]
    async fn spend_treasury_rejects_caller_not_owner() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme7").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let cto = make_role(&h.roles, &entity.id, "CTO", OccupantKind::Human, Some("u2")).await;
        let id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &id,
                AllowanceBundle {
                    treasury_cap: 1000,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();

        // CTO tries to spend CEO's budget.
        let err = h
            .budgets
            .spend_treasury(&id, "0xdest", 100, None, &cto, None, None)
            .await
            .unwrap_err();
        assert_eq!(
            err.downcast_ref::<BudgetError>().unwrap().code(),
            "ENotOwner"
        );
    }

    #[tokio::test]
    async fn hire_atomic_creates_role_budget_and_allocates() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme8").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let parent_b = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &parent_b,
                AllowanceBundle {
                    inference_credits: 500,
                    suballoc_cap: 1000,
                    hire_cap: 3,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets.refresh(&parent_b).await.unwrap();

        let res = h
            .budgets
            .hire(
                &parent_b,
                &ceo,
                NewRoleSpec {
                    title: "Senior Eng".into(),
                    role_type: Some("operational".into()),
                    grants: None,
                    occupant_kind: Some("agent".into()),
                    occupant_id: Some("agent-X".into()),
                },
                AllowanceBundle {
                    inference_credits: 200,
                    treasury_cap: 0,
                    suballoc_cap: 0,
                    hire_cap: 0,
                },
                &ceo,
                None,
                None,
            )
            .await
            .expect("hire");

        // The new role exists.
        let r = h.roles.get(&res.role_id).await.unwrap().unwrap();
        assert_eq!(r.title, "Senior Eng");
        assert_eq!(r.occupant_kind, OccupantKind::Agent);

        // The new primary budget exists, owned by the new role.
        let b = h
            .budgets
            .get_budget(&res.primary_budget_id)
            .await
            .unwrap()
            .unwrap();
        assert!(b.is_primary);
        assert_eq!(b.owner_role_id, res.role_id);

        // Parent debited; child credited.
        let parent_alw = h.budgets.current_allowance(&parent_b).await.unwrap();
        assert_eq!(parent_alw.spent_suballoc, 200);
        assert_eq!(parent_alw.used_hire, 1);
        let child_alw = h
            .budgets
            .current_allowance(&res.primary_budget_id)
            .await
            .unwrap();
        assert_eq!(child_alw.caps.inference_credits, 200);

        // Edge wired.
        let edges = h.roles.list_edges_for_entity(&entity.id).await.unwrap();
        assert!(
            edges
                .iter()
                .any(|e| e.parent_role_id == ceo && e.child_role_id == res.role_id)
        );
    }

    #[tokio::test]
    async fn refresh_burn_mode_drops_unspent() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme9").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &id,
                AllowanceBundle {
                    inference_credits: 1000,
                    ..Default::default()
                },
                86_400, // daily epochs
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        // Materialise epoch 0 at t0 (just past the entity's created_at).
        let t0 = Utc::now() + chrono::Duration::seconds(1);
        h.budgets.refresh_at(&id, t0).await.unwrap();
        // Advance 2 epochs; refresh should mint a new row at policy defaults.
        let t2 = t0 + chrono::Duration::seconds(2 * 86_400);
        let new = h.budgets.refresh_at(&id, t2).await.unwrap().unwrap();
        assert!(new.epoch > 0);
        assert_eq!(new.caps.inference_credits, 1000);
        assert_eq!(new.spent_inference, 0);
    }

    #[tokio::test]
    async fn refresh_rollover_mode_carries_unspent() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme10").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &id,
                AllowanceBundle {
                    inference_credits: 1000,
                    ..Default::default()
                },
                86_400,
                RolloverMode::Rollover,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .init_treasury_config(&entity.id, "gw", &ceo)
            .await
            .unwrap();
        let t0 = Utc::now() + chrono::Duration::seconds(1);
        h.budgets.refresh_at(&id, t0).await.unwrap();
        // Burn 200.
        h.budgets
            .spend_inference(&id, 200, "hashA", "agent-X", "gw")
            .await
            .unwrap();
        // Roll into next epoch.
        let t2 = t0 + chrono::Duration::seconds(2 * 86_400);
        let next = h.budgets.refresh_at(&id, t2).await.unwrap().unwrap();
        // 1000 + (1000 - 200) = 1800 carried.
        assert_eq!(next.caps.inference_credits, 1800);
        assert_eq!(next.spent_inference, 0);
    }

    #[tokio::test]
    async fn pause_halts_mutations() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme11").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let id = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &id,
                AllowanceBundle {
                    treasury_cap: 1000,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .init_treasury_config(&entity.id, "gw", &ceo)
            .await
            .unwrap();
        h.budgets
            .set_pause(&entity.id, true, &ceo, None)
            .await
            .unwrap();

        let err = h
            .budgets
            .spend_treasury(&id, "0xdest", 50, None, &ceo, None, None)
            .await
            .unwrap_err();
        assert_eq!(err.downcast_ref::<BudgetError>().unwrap().code(), "EPaused");
    }

    #[tokio::test]
    async fn dissolve_rejects_non_zero_balance() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme12").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let cto = make_role(&h.roles, &entity.id, "CTO", OccupantKind::Human, Some("u2")).await;
        let parent_b = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &parent_b,
                AllowanceBundle {
                    suballoc_cap: 1000,
                    hire_cap: 5,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        let child_b = h
            .budgets
            .create_budget(
                &entity.id,
                Some(&parent_b),
                &cto,
                "Eng",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets.refresh(&parent_b).await.unwrap();
        h.budgets.refresh(&child_b).await.unwrap();
        h.budgets
            .allocate(
                &parent_b,
                &child_b,
                AllowanceBundle {
                    inference_credits: 50,
                    ..Default::default()
                },
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        let err = h
            .budgets
            .dissolve(&child_b, &cto, None, None)
            .await
            .unwrap_err();
        assert_eq!(
            err.downcast_ref::<BudgetError>().unwrap().code(),
            "EBudgetNonZeroBalance"
        );
    }

    #[tokio::test]
    async fn idempotency_key_returns_original() {
        let h = open_harness();
        let entity = make_entity(&h.entities, "acme13").await;
        let ceo = make_role(&h.roles, &entity.id, "CEO", OccupantKind::Human, Some("u1")).await;
        let cto = make_role(&h.roles, &entity.id, "CTO", OccupantKind::Human, Some("u2")).await;
        let parent_b = h
            .budgets
            .create_budget(
                &entity.id,
                None,
                &ceo,
                "Op",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        h.budgets
            .set_policy(
                &parent_b,
                AllowanceBundle {
                    suballoc_cap: 1000,
                    hire_cap: 5,
                    ..Default::default()
                },
                604_800,
                RolloverMode::Burn,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        let child_b = h
            .budgets
            .create_budget(
                &entity.id,
                Some(&parent_b),
                &cto,
                "Eng",
                BudgetKind::Operating,
                &ceo,
                None,
                None,
            )
            .await
            .unwrap();
        // First call debits 100.
        h.budgets
            .allocate(
                &parent_b,
                &child_b,
                AllowanceBundle {
                    inference_credits: 100,
                    ..Default::default()
                },
                &ceo,
                None,
                Some("op-1"),
            )
            .await
            .unwrap();
        // Second call with same key: no debit.
        h.budgets
            .allocate(
                &parent_b,
                &child_b,
                AllowanceBundle {
                    inference_credits: 100,
                    ..Default::default()
                },
                &ceo,
                None,
                Some("op-1"),
            )
            .await
            .unwrap();
        let parent_alw = h.budgets.current_allowance(&parent_b).await.unwrap();
        assert_eq!(parent_alw.spent_suballoc, 100);
    }
}
