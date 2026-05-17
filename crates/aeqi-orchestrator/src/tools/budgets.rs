//! `budgets` agent tool — the LLM-callable surface for the role-budget
//! primitive.
//!
//! See `architecture_role_budget_canonical.md` § 9 (per-tool catalog) for
//! the canonical action set and auth predicates. Single tool with an
//! `action` enum (matches `events` / `ideas` / `roles` convention).
//!
//! ## Auth model
//!
//! - **Reads** (`list`, `tree`, `show`, `history`) — any agent in the
//!   trust.
//! - **Mutations** (`create`, `allocate`, `spend_treasury`, `set_policy`,
//!   `hire`, `dissolve`) — caller's role must occupy the budget's
//!   owner role. `BudgetRegistry` enforces this on every write; the tool
//!   layer adds early-fail with helpful errors.
//! - `spend_inference` is **not** exposed here — it is `set_event_only`
//!   in `tools/mod.rs` so only the inference gateway (System CallerKind)
//!   can invoke it.
//!
//! Authority is anchored on the **calling agent**: `agent_id` is
//! closure-captured at registration time so the LLM cannot forge identity
//! via args. The trust the agent acts in is read from the agent's
//! `trust_id`.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;

use crate::agent_registry::AgentRegistry;
use crate::budget_registry::{
    AllowanceBundle, BudgetError, BudgetKind, BudgetRegistry, NewRoleSpec, RolloverMode,
};
use crate::role_registry::{OccupantKind, RoleRegistry};

/// Single multi-action tool exposed to the LLM as `budgets`.
pub struct BudgetsTool {
    agent_registry: Arc<AgentRegistry>,
    role_registry: Arc<RoleRegistry>,
    /// UUID of the agent this tool is bound to. Closure-captured.
    agent_id: String,
}

impl BudgetsTool {
    pub fn new(
        agent_registry: Arc<AgentRegistry>,
        role_registry: Arc<RoleRegistry>,
        agent_id: String,
    ) -> Self {
        Self {
            agent_registry,
            role_registry,
            agent_id,
        }
    }

    fn registry(&self) -> BudgetRegistry {
        BudgetRegistry::open(self.agent_registry.db())
    }

    /// Resolve the trust the calling agent acts in.
    async fn resolve_trust(&self) -> Result<String> {
        let agent = self
            .agent_registry
            .resolve_by_hint(&self.agent_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("calling agent not found: {}", self.agent_id))?;
        agent
            .trust_id
            .ok_or_else(|| anyhow::anyhow!("agent has no entity (cannot act in any trust)"))
    }

    /// Find the role the agent occupies in the trust. Multi-role agents
    /// pass `as_role_id`. Returns the role id or an error response the
    /// caller should bubble back.
    async fn caller_role(
        &self,
        trust_id: &str,
        explicit: Option<&str>,
    ) -> Result<String, ToolResult> {
        let (roles, _edges) = self
            .role_registry
            .list_for_entity_with_grants(trust_id)
            .await
            .map_err(|e| ToolResult::error(format!("list roles: {e}")))?;
        let occupied: Vec<String> = roles
            .into_iter()
            .filter(|r| {
                matches!(r.occupant_kind, OccupantKind::Agent)
                    && r.occupant_id.as_deref() == Some(&self.agent_id)
            })
            .map(|r| r.id)
            .collect();
        if let Some(r) = explicit {
            if occupied.iter().any(|x| x == r) {
                return Ok(r.to_string());
            }
            return Err(ToolResult::error(format!("agent does not occupy role {r}")));
        }
        match occupied.len() {
            0 => Err(ToolResult::error(
                "agent occupies no role in this trust — no authority to spend",
            )),
            1 => Ok(occupied.into_iter().next().unwrap()),
            _ => Err(ToolResult::error(format!(
                "agent occupies multiple roles ({}); pass `as_role_id`",
                occupied.join(", ")
            ))),
        }
    }

    fn parse_bundle(args: &serde_json::Value, key: &str) -> AllowanceBundle {
        let v = args.get(key).cloned().unwrap_or(serde_json::Value::Null);
        AllowanceBundle {
            inference_credits: v
                .get("inference_credits")
                .and_then(|x| x.as_i64())
                .unwrap_or(0),
            treasury_cap: v.get("treasury_cap").and_then(|x| x.as_i64()).unwrap_or(0),
            suballoc_cap: v.get("suballoc_cap").and_then(|x| x.as_i64()).unwrap_or(0),
            hire_cap: v.get("hire_cap").and_then(|x| x.as_i64()).unwrap_or(0),
        }
    }

    fn idempotency_key(args: &serde_json::Value) -> Option<String> {
        args.get("idempotency_key")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
    }

    fn explicit_role(args: &serde_json::Value) -> Option<String> {
        args.get("as_role_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
    }

    fn budget_error(err: anyhow::Error) -> ToolResult {
        if let Some(be) = err.downcast_ref::<BudgetError>() {
            ToolResult::error(format!("{} ({})", be, be.code()))
        } else {
            ToolResult::error(err.to_string())
        }
    }

    // ── Read actions ─────────────────────────────────────────────────────

    async fn action_list(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let owner = args
            .get("owner_role_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let parent = args
            .get("parent_budget_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let only_primary = args.get("is_primary").and_then(|v| v.as_bool());

        let budgets = self
            .registry()
            .list_budgets(&trust_id, owner, parent, only_primary)
            .await?;
        Ok(
            ToolResult::success(format!("{} budget(s)", budgets.len())).with_data(
                serde_json::json!({
                    "trust_id": trust_id,
                    "budgets": budgets,
                }),
            ),
        )
    }

    async fn action_tree(&self) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let tree = self.registry().budget_tree(&trust_id).await?;
        Ok(ToolResult::success(format!(
            "Budget DAG: {} nodes, {} edges",
            tree.nodes.len(),
            tree.edges.len()
        ))
        .with_data(serde_json::to_value(&tree)?))
    }

    async fn action_show(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let id = match args.get("budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("budget_id is required")),
        };
        let registry = self.registry();
        let budget = match registry.get_budget(&id).await? {
            Some(b) => b,
            None => return Ok(ToolResult::error(format!("budget {id} not found"))),
        };
        let allowance = registry.current_allowance(&id).await.ok();
        let policy = registry.get_policy(&id).await?;
        let summary = match &allowance {
            Some(a) => format!(
                "Budget '{}' (epoch {}): inference {}/{} treasury {}/{} suballoc {}/{} hire {}/{}",
                budget.name,
                a.epoch,
                a.spent_inference,
                a.caps.inference_credits,
                a.spent_treasury,
                a.caps.treasury_cap,
                a.spent_suballoc,
                a.caps.suballoc_cap,
                a.used_hire,
                a.caps.hire_cap,
            ),
            None => format!("Budget '{}' (no current allowance)", budget.name),
        };
        Ok(ToolResult::success(summary).with_data(serde_json::json!({
            "budget": budget,
            "allowance": allowance,
            "policy": policy,
        })))
    }

    async fn action_history(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let id = match args.get("budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("budget_id is required")),
        };
        let event_type = args
            .get("event_type")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let since = args
            .get("since")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&chrono::Utc));
        let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(50);
        let events = self
            .registry()
            .spend_history(&id, since, event_type, limit)
            .await?;
        Ok(ToolResult::success(format!("{} event(s)", events.len()))
            .with_data(serde_json::json!({"events": events})))
    }

    // ── Write actions ────────────────────────────────────────────────────

    async fn action_create(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let caller_role = match self
            .caller_role(&trust_id, Self::explicit_role(args).as_deref())
            .await
        {
            Ok(r) => r,
            Err(t) => return Ok(t),
        };
        let owner_role_id = match args.get("owner_role_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("owner_role_id is required")),
        };
        let name = match args.get("name").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("name is required")),
        };
        let parent = args
            .get("parent_budget_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let kind: BudgetKind = args
            .get("kind")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(BudgetKind::Operating);
        let idem = Self::idempotency_key(args);
        match self
            .registry()
            .create_budget(
                &trust_id,
                parent,
                &owner_role_id,
                &name,
                kind,
                &caller_role,
                Some(&self.agent_id),
                idem.as_deref(),
            )
            .await
        {
            Ok(id) => Ok(
                ToolResult::success(format!("Created budget {name} ({id})")).with_data(
                    serde_json::json!({
                        "budget_id": id,
                        "trust_id": trust_id,
                    }),
                ),
            ),
            Err(e) => Ok(Self::budget_error(e)),
        }
    }

    async fn action_allocate(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let caller_role = match self
            .caller_role(&trust_id, Self::explicit_role(args).as_deref())
            .await
        {
            Ok(r) => r,
            Err(t) => return Ok(t),
        };
        let parent_id = match args.get("parent_budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("parent_budget_id is required")),
        };
        let child_id = match args.get("child_budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("child_budget_id is required")),
        };
        let bundle = Self::parse_bundle(args, "bundle");
        let idem = Self::idempotency_key(args);
        match self
            .registry()
            .allocate(
                &parent_id,
                &child_id,
                bundle,
                &caller_role,
                Some(&self.agent_id),
                idem.as_deref(),
            )
            .await
        {
            Ok(()) => Ok(ToolResult::success(format!(
                "Sub-allocated from {parent_id} → {child_id}"
            ))),
            Err(e) => Ok(Self::budget_error(e)),
        }
    }

    async fn action_spend_treasury(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let caller_role = match self
            .caller_role(&trust_id, Self::explicit_role(args).as_deref())
            .await
        {
            Ok(r) => r,
            Err(t) => return Ok(t),
        };
        let id = match args.get("budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("budget_id is required")),
        };
        let destination = match args.get("destination").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("destination is required")),
        };
        let amount = match args.get("amount").and_then(|v| v.as_i64()) {
            Some(a) if a > 0 => a,
            _ => return Ok(ToolResult::error("amount must be a positive integer")),
        };
        let memo = args
            .get("memo")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let idem = Self::idempotency_key(args);
        match self
            .registry()
            .spend_treasury(
                &id,
                &destination,
                amount,
                memo,
                &caller_role,
                Some(&self.agent_id),
                idem.as_deref(),
            )
            .await
        {
            Ok(()) => Ok(ToolResult::success(format!(
                "Sent {amount} from budget {id} → {destination}"
            ))),
            Err(e) => Ok(Self::budget_error(e)),
        }
    }

    async fn action_set_policy(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let caller_role = match self
            .caller_role(&trust_id, Self::explicit_role(args).as_deref())
            .await
        {
            Ok(r) => r,
            Err(t) => return Ok(t),
        };
        let id = match args.get("budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("budget_id is required")),
        };
        let policy_v = args
            .get("policy")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let defaults = AllowanceBundle {
            inference_credits: policy_v
                .get("default_inference")
                .or_else(|| policy_v.get("inference_credits"))
                .and_then(|x| x.as_i64())
                .unwrap_or(0),
            treasury_cap: policy_v
                .get("default_treasury")
                .or_else(|| policy_v.get("treasury_cap"))
                .and_then(|x| x.as_i64())
                .unwrap_or(0),
            suballoc_cap: policy_v
                .get("default_suballoc")
                .or_else(|| policy_v.get("suballoc_cap"))
                .and_then(|x| x.as_i64())
                .unwrap_or(0),
            hire_cap: policy_v
                .get("default_hire")
                .or_else(|| policy_v.get("hire_cap"))
                .and_then(|x| x.as_i64())
                .unwrap_or(0),
        };
        let epoch_period_secs = policy_v
            .get("epoch_period_secs")
            .and_then(|v| v.as_i64())
            .unwrap_or(604_800);
        let rollover_mode: RolloverMode = policy_v
            .get("rollover_mode")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or(RolloverMode::Burn);
        let idem = Self::idempotency_key(args);
        match self
            .registry()
            .set_policy(
                &id,
                defaults,
                epoch_period_secs,
                rollover_mode,
                &caller_role,
                Some(&self.agent_id),
                idem.as_deref(),
            )
            .await
        {
            Ok(()) => Ok(ToolResult::success(format!("Updated policy for {id}"))),
            Err(e) => Ok(Self::budget_error(e)),
        }
    }

    async fn action_hire(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let caller_role = match self
            .caller_role(&trust_id, Self::explicit_role(args).as_deref())
            .await
        {
            Ok(r) => r,
            Err(t) => return Ok(t),
        };
        let parent_budget_id = match args.get("parent_budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("parent_budget_id is required")),
        };
        let parent_role_id = match args.get("parent_role_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("parent_role_id is required")),
        };
        let new_role_v = args
            .get("new_role")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let new_role: NewRoleSpec = match serde_json::from_value(new_role_v) {
            Ok(spec) => spec,
            Err(e) => return Ok(ToolResult::error(format!("new_role: {e}"))),
        };
        let bundle = Self::parse_bundle(args, "bundle");
        let idem = Self::idempotency_key(args);
        match self
            .registry()
            .hire(
                &parent_budget_id,
                &parent_role_id,
                new_role,
                bundle,
                &caller_role,
                Some(&self.agent_id),
                idem.as_deref(),
            )
            .await
        {
            Ok(res) => Ok(ToolResult::success(format!(
                "Hired role {} with primary budget {}",
                res.role_id, res.primary_budget_id
            ))
            .with_data(serde_json::json!({
                "role_id": res.role_id,
                "primary_budget_id": res.primary_budget_id,
            }))),
            Err(e) => Ok(Self::budget_error(e)),
        }
    }

    async fn action_refresh(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let id = match args.get("budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("budget_id is required")),
        };
        match self.registry().refresh(&id).await {
            Ok(Some(a)) => Ok(
                ToolResult::success(format!("Refreshed {id} → epoch {}", a.epoch))
                    .with_data(serde_json::json!({"allowance": a})),
            ),
            Ok(None) => Ok(ToolResult::success(format!(
                "{id} already on the current epoch"
            ))),
            Err(e) => Ok(Self::budget_error(e)),
        }
    }

    async fn action_dissolve(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let trust_id = self
            .resolve_trust()
            .await
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        let caller_role = match self
            .caller_role(&trust_id, Self::explicit_role(args).as_deref())
            .await
        {
            Ok(r) => r,
            Err(t) => return Ok(t),
        };
        let id = match args.get("budget_id").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => return Ok(ToolResult::error("budget_id is required")),
        };
        let idem = Self::idempotency_key(args);
        match self
            .registry()
            .dissolve(&id, &caller_role, Some(&self.agent_id), idem.as_deref())
            .await
        {
            Ok(()) => Ok(ToolResult::success(format!("Dissolved budget {id}"))),
            Err(e) => Ok(Self::budget_error(e)),
        }
    }
}

#[async_trait]
impl Tool for BudgetsTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("list");
        match action {
            "list" => self.action_list(&args).await,
            "tree" => self.action_tree().await,
            "show" => self.action_show(&args).await,
            "history" => self.action_history(&args).await,
            "create" => self.action_create(&args).await,
            "allocate" => self.action_allocate(&args).await,
            "spend_treasury" => self.action_spend_treasury(&args).await,
            "set_policy" => self.action_set_policy(&args).await,
            "hire" => self.action_hire(&args).await,
            "refresh" => self.action_refresh(&args).await,
            "dissolve" => self.action_dissolve(&args).await,
            other => Ok(ToolResult::error(format!(
                "unknown action {other:?}; use list|tree|show|history|create|allocate|spend_treasury|set_policy|hire|refresh|dissolve",
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "budgets".to_string(),
            description:
                "Read or modify budgets in the calling agent's trust (company). \
                 Budgets are the cost-center primitive — each owned by exactly one role; \
                 the occupant of that role spends from it. \
                 Reads: `list`, `tree` (DAG), `show` (one budget + current allowance), `history` (events). \
                 Writes: `create` (new child budget), `allocate` (sub-allocate parent→child), \
                 `spend_treasury` (USDC outflow — destructive, confirm destination with the user), \
                 `set_policy` (refresh defaults + period + burn|rollover), \
                 `hire` (atomic create role + primary budget + initial allocation), \
                 `refresh` (advance epoch if boundary crossed), `dissolve` (leaf + zero-balance only). \
                 The agent must occupy the budget's owner role to mutate. \
                 Always run `show` before any spend or allocate to confirm headroom."
                    .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": [
                            "list", "tree", "show", "history",
                            "create", "allocate", "spend_treasury",
                            "set_policy", "hire", "refresh", "dissolve"
                        ],
                        "description": "What to do. Defaults to `list`."
                    },
                    "budget_id": { "type": "string", "description": "Target budget id (for show, history, spend_treasury, set_policy, refresh, dissolve)." },
                    "owner_role_id": { "type": "string", "description": "Role that will own a new budget (for create); filter on list." },
                    "parent_budget_id": { "type": "string", "description": "Parent budget for create / allocate / hire." },
                    "child_budget_id": { "type": "string", "description": "Existing child budget to allocate INTO (for allocate)." },
                    "name": { "type": "string", "description": "Budget name (for create)." },
                    "kind": {
                        "type": "string",
                        "enum": ["primary", "operating", "hiring", "project", "discretionary"],
                        "description": "Taxonomy hint, no logic depends on it. Default operating."
                    },
                    "is_primary": { "type": "boolean", "description": "Filter on list." },
                    "destination": { "type": "string", "description": "Recipient address for spend_treasury." },
                    "amount": { "type": "integer", "description": "USDC base units (6 decimals) for spend_treasury, or micro-USD for inference budgets." },
                    "memo": { "type": "string", "description": "Memo accompanying a treasury transfer." },
                    "bundle": {
                        "type": "object",
                        "description": "Per-rail amounts for allocate / hire.",
                        "properties": {
                            "inference_credits": { "type": "integer", "description": "micro-USD" },
                            "treasury_cap": { "type": "integer", "description": "USDC base units" },
                            "suballoc_cap": { "type": "integer" },
                            "hire_cap": { "type": "integer" }
                        }
                    },
                    "policy": {
                        "type": "object",
                        "description": "For set_policy. Defines what the next refresh credits.",
                        "properties": {
                            "default_inference": { "type": "integer" },
                            "default_treasury": { "type": "integer" },
                            "default_suballoc": { "type": "integer" },
                            "default_hire": { "type": "integer" },
                            "epoch_period_secs": { "type": "integer", "description": "Default 604800 (7d)." },
                            "rollover_mode": { "type": "string", "enum": ["burn", "rollover"], "description": "Default burn." }
                        }
                    },
                    "parent_role_id": { "type": "string", "description": "Existing role under which the new role attaches (for hire)." },
                    "new_role": {
                        "type": "object",
                        "description": "New role spec for hire.",
                        "properties": {
                            "title": { "type": "string" },
                            "role_type": { "type": "string", "enum": ["director", "operational", "advisor"] },
                            "occupant_kind": { "type": "string", "enum": ["human", "agent", "vacant"] },
                            "occupant_id": { "type": "string" },
                            "grants": { "type": "array", "items": { "type": "string" } }
                        },
                        "required": ["title"]
                    },
                    "event_type": { "type": "string", "description": "Filter on history." },
                    "since": { "type": "string", "description": "RFC3339 timestamp filter on history." },
                    "limit": { "type": "integer", "description": "Cap on history rows. Default 50, max 500." },
                    "as_role_id": { "type": "string", "description": "Disambiguates which of the agent's roles is acting (multi-role agents only)." },
                    "idempotency_key": { "type": "string", "description": "Per-budget unique key — same key on retry returns the original result without double-debiting." }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "budgets"
    }

    fn is_concurrent_safe(&self, input: &serde_json::Value) -> bool {
        let action = input
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("list");
        matches!(action, "list" | "tree" | "show" | "history")
    }

    fn is_destructive(&self, input: &serde_json::Value) -> bool {
        let action = input.get("action").and_then(|v| v.as_str()).unwrap_or("");
        matches!(action, "spend_treasury" | "dissolve")
    }

    fn produces_context(&self) -> bool {
        // Only the read actions actually emit context-bearing output, but
        // setting this to true lets event chains assemble allowance state
        // into a follow-on tool call's prompt. Mutation outputs are
        // diagnostic acks and are short.
        true
    }

    fn activity_description(&self, input: &serde_json::Value) -> Option<String> {
        let action = input
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("list");
        Some(match action {
            "list" => "Listing budgets".to_string(),
            "tree" => "Reading budget tree".to_string(),
            "show" => "Reading budget".to_string(),
            "history" => "Reading budget history".to_string(),
            "create" => "Creating budget".to_string(),
            "allocate" => "Sub-allocating budget".to_string(),
            "spend_treasury" => "Spending treasury".to_string(),
            "set_policy" => "Updating budget policy".to_string(),
            "hire" => "Hiring (role + budget)".to_string(),
            "refresh" => "Refreshing budget epoch".to_string(),
            "dissolve" => "Dissolving budget".to_string(),
            other => format!("budgets.{other}"),
        })
    }
}
