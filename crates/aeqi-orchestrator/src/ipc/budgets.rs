//! Budget IPC handlers.
//!
//! Commands: `list_budgets`, `get_budget`, `budget_tree`, `get_allowance`,
//!           `allowance_history`, `create_budget`, `allocate_allowance`,
//!           `spend_inference`, `spend_treasury`, `set_policy`, `hire_role`,
//!           `refresh_allowance`, `dissolve_budget`, `pause_treasury`,
//!           `init_treasury_config`.
//!
//! See `architecture_role_budget_canonical.md` (auto-memory) for the full
//! design.
//!
//! ## Auth model
//!
//! - **Reads** require `treasury.read` at the company (entity).
//! - **Mutations** require the caller to occupy the budget's owner role
//!   (or, for `pause_treasury` / `init_treasury_config`, the company's
//!   `admin_role`). The caller's role is resolved by walking
//!   `roles WHERE company_id = company AND occupant_kind = 'human' AND occupant_id = caller_user_id`.
//!   When the caller occupies multiple roles in this company the request
//!   must include `as_role_id` to disambiguate.
//! - `spend_inference` is reserved for the `treasury_config.inference_gateway`
//!   agent — it is registered as `set_event_only` in `tools/mod.rs` so the
//!   LLM cannot call it directly.

use crate::budget_registry::{
    AllowanceBundle, BudgetError, BudgetKind, BudgetRegistry, NewRoleSpec, RolloverMode,
};
use crate::role_registry::GRANT_TREASURY_READ;
use chrono::{DateTime, Utc};

use super::tenancy::is_allowed;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn caller_user_id(request: &serde_json::Value) -> &str {
    request
        .get("caller_user_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

fn caller_agent_id(request: &serde_json::Value) -> Option<&str> {
    request
        .get("caller_agent_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

fn idempotency_key(request: &serde_json::Value) -> Option<&str> {
    request
        .get("idempotency_key")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

fn registry(ctx: &super::CommandContext) -> BudgetRegistry {
    BudgetRegistry::open(ctx.agent_registry.db())
}

/// Map a `BudgetError` into a structured IPC error response with a stable
/// `code` field so the UI / agent tools can switch on it cleanly.
fn budget_error_response(err: anyhow::Error) -> serde_json::Value {
    if let Some(be) = err.downcast_ref::<BudgetError>() {
        serde_json::json!({
            "ok": false,
            "error": be.to_string(),
            "code": be.code(),
        })
    } else {
        serde_json::json!({"ok": false, "error": err.to_string()})
    }
}

/// Resolve the caller's acting role within a company.
///
/// When `as_role_id` is present, validate the caller actually occupies it.
/// Otherwise look up the unique role the caller occupies in this company.
/// Multi-role callers without `as_role_id` get `EAmbiguousCallerRole` so
/// their tool / UI can prompt for which chair they're acting from.
async fn resolve_caller_role(
    ctx: &super::CommandContext,
    company_id: &str,
    caller_id: &str,
    request: &serde_json::Value,
) -> Result<String, serde_json::Value> {
    if caller_id.is_empty() {
        return Err(serde_json::json!({
            "ok": false,
            "error": "authentication required",
            "code": "auth_required",
        }));
    }

    // Pull every role this user occupies in this company.
    let (roles, _edges) = match ctx
        .role_registry
        .list_for_entity_with_grants(company_id)
        .await
    {
        Ok(v) => v,
        Err(e) => return Err(serde_json::json!({"ok": false, "error": e.to_string()})),
    };
    let occupied: Vec<String> = roles
        .into_iter()
        .filter(|r| r.occupant_id.as_deref() == Some(caller_id))
        .map(|r| r.id)
        .collect();

    let explicit = request
        .get("as_role_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    if let Some(role) = explicit {
        if occupied.iter().any(|r| r == role) {
            return Ok(role.to_string());
        }
        return Err(serde_json::json!({
            "ok": false,
            "error": format!("caller does not occupy role {role}"),
            "code": "ENotOccupant",
        }));
    }

    match occupied.len() {
        0 => Err(serde_json::json!({
            "ok": false,
            "error": "caller has no role in this company",
            "code": "EAgentNotInCompany",
        })),
        1 => Ok(occupied.into_iter().next().unwrap()),
        _ => Err(serde_json::json!({
            "ok": false,
            "error": "caller occupies multiple roles; pass as_role_id",
            "code": "EAmbiguousCallerRole",
            "roles": occupied,
        })),
    }
}

async fn require_treasury_read(
    ctx: &super::CommandContext,
    company_id: &str,
    caller_id: &str,
) -> Option<serde_json::Value> {
    if caller_id.is_empty() {
        return Some(serde_json::json!({
            "ok": false,
            "error": "authentication required",
            "code": "auth_required",
        }));
    }
    match ctx
        .role_registry
        .user_has_grant(company_id, caller_id, GRANT_TREASURY_READ)
        .await
    {
        Ok(true) => None,
        Ok(false) => Some(serde_json::json!({
            "ok": false,
            "error": "forbidden: treasury.read required",
            "code": "forbidden",
        })),
        Err(e) => Some(serde_json::json!({"ok": false, "error": e.to_string()})),
    }
}

fn parse_bundle(v: &serde_json::Value) -> AllowanceBundle {
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

// ── Read handlers ─────────────────────────────────────────────────────────────

pub async fn handle_list_budgets(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id")
        .or_else(|| super::request_field(request, "company_id"))
    {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }
    let caller = caller_user_id(request).to_string();
    if let Some(err) = require_treasury_read(ctx, &company_id, &caller).await {
        return err;
    }

    let owner = request
        .get("owner_role_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let parent = request
        .get("parent_budget_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let only_primary = request.get("is_primary").and_then(|v| v.as_bool());

    match registry(ctx)
        .list_budgets(&company_id, owner, parent, only_primary)
        .await
    {
        Ok(budgets) => serde_json::json!({"ok": true, "budgets": budgets}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_get_budget(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    let caller = caller_user_id(request).to_string();

    let budgets = registry(ctx);
    let budget = match budgets.get_budget(&id).await {
        Ok(Some(b)) => b,
        Ok(None) => {
            return serde_json::json!({
                "ok": false,
                "error": "budget not found",
                "code": "ENotFound",
            });
        }
        Err(e) => return budget_error_response(e),
    };

    if let Some(err) = require_treasury_read(ctx, &budget.company_id, &caller).await {
        return err;
    }

    let allowance = budgets.current_allowance(&id).await.ok();
    let policy = budgets.get_policy(&id).await.ok().flatten();

    serde_json::json!({
        "ok": true,
        "budget": budget,
        "allowance": allowance,
        "policy": policy,
    })
}

pub async fn handle_budget_tree(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id")
        .or_else(|| super::request_field(request, "company_id"))
    {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }
    let caller = caller_user_id(request).to_string();
    if let Some(err) = require_treasury_read(ctx, &company_id, &caller).await {
        return err;
    }
    match registry(ctx).budget_tree(&company_id).await {
        Ok(tree) => serde_json::json!({"ok": true, "tree": tree}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_get_allowance(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    let caller = caller_user_id(request).to_string();
    let budgets = registry(ctx);
    let budget = match budgets.get_budget(&id).await {
        Ok(Some(b)) => b,
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "budget not found",
                "code": "ENotFound",
            });
        }
    };
    if let Some(err) = require_treasury_read(ctx, &budget.company_id, &caller).await {
        return err;
    }
    match budgets.current_allowance(&id).await {
        Ok(a) => serde_json::json!({"ok": true, "allowance": a}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_allowance_history(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    let caller = caller_user_id(request).to_string();
    let budgets = registry(ctx);
    let budget = match budgets.get_budget(&id).await {
        Ok(Some(b)) => b,
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "budget not found",
                "code": "ENotFound",
            });
        }
    };
    if let Some(err) = require_treasury_read(ctx, &budget.company_id, &caller).await {
        return err;
    }

    let event_type = request
        .get("event_type")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let since: Option<DateTime<Utc>> = request
        .get("since")
        .and_then(|v| v.as_str())
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|t| t.with_timezone(&Utc));
    let limit = request.get("limit").and_then(|v| v.as_i64()).unwrap_or(50);
    match budgets.spend_history(&id, since, event_type, limit).await {
        Ok(events) => serde_json::json!({"ok": true, "events": events}),
        Err(e) => budget_error_response(e),
    }
}

// ── Mutation handlers ─────────────────────────────────────────────────────────

pub async fn handle_create_budget(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id")
        .or_else(|| super::request_field(request, "company_id"))
    {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let caller_id = caller_user_id(request).to_string();
    let caller_role = match resolve_caller_role(ctx, &company_id, &caller_id, request).await {
        Ok(r) => r,
        Err(e) => return e,
    };

    let owner_role_id = match super::request_field(request, "owner_role_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "owner_role_id is required"}),
    };
    let name = match super::request_field(request, "name") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "name is required"}),
    };
    let parent = request
        .get("parent_budget_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let kind: BudgetKind = request
        .get("kind")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse().ok())
        .unwrap_or(BudgetKind::Operating);

    match registry(ctx)
        .create_budget(
            &company_id,
            parent,
            &owner_role_id,
            &name,
            kind,
            &caller_role,
            caller_agent_id(request),
            idempotency_key(request),
        )
        .await
    {
        Ok(id) => serde_json::json!({"ok": true, "budget_id": id}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_allocate_allowance(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let parent_id = match super::request_field(request, "parent_budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "parent_budget_id is required"}),
    };
    let child_id = match super::request_field(request, "child_budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "child_budget_id is required"}),
    };
    let bundle = parse_bundle(request.get("bundle").unwrap_or(&serde_json::Value::Null));

    let budgets = registry(ctx);
    let parent_budget = match budgets.get_budget(&parent_id).await {
        Ok(Some(b)) => b,
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "parent budget not found",
                "code": "ENotFound",
            });
        }
    };
    let caller_id = caller_user_id(request).to_string();
    let caller_role =
        match resolve_caller_role(ctx, &parent_budget.company_id, &caller_id, request).await {
            Ok(r) => r,
            Err(e) => return e,
        };

    match budgets
        .allocate(
            &parent_id,
            &child_id,
            bundle,
            &caller_role,
            caller_agent_id(request),
            idempotency_key(request),
        )
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_set_policy(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    let policy_v = request
        .get("policy")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    // Policy uses canonical `default_*` names (per the brief). Fall back to
    // bundle-style names so the same handler accepts both shapes — agent
    // tools and direct callers stay consistent.
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

    let budgets = registry(ctx);
    let budget = match budgets.get_budget(&id).await {
        Ok(Some(b)) => b,
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "budget not found",
                "code": "ENotFound",
            });
        }
    };
    let caller_id = caller_user_id(request).to_string();
    let caller_role = match resolve_caller_role(ctx, &budget.company_id, &caller_id, request).await
    {
        Ok(r) => r,
        Err(e) => return e,
    };

    match budgets
        .set_policy(
            &id,
            defaults,
            epoch_period_secs,
            rollover_mode,
            &caller_role,
            caller_agent_id(request),
            idempotency_key(request),
        )
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_spend_treasury(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    let destination = match super::request_field(request, "destination") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "destination is required"}),
    };
    let amount = match request.get("amount").and_then(|v| v.as_i64()) {
        Some(a) if a > 0 => a,
        _ => return serde_json::json!({"ok": false, "error": "amount must be a positive integer"}),
    };
    let memo = request
        .get("memo")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());

    let budgets = registry(ctx);
    let budget = match budgets.get_budget(&id).await {
        Ok(Some(b)) => b,
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "budget not found",
                "code": "ENotFound",
            });
        }
    };
    let caller_id = caller_user_id(request).to_string();
    let caller_role = match resolve_caller_role(ctx, &budget.company_id, &caller_id, request).await
    {
        Ok(r) => r,
        Err(e) => return e,
    };

    match budgets
        .spend_treasury(
            &id,
            &destination,
            amount,
            memo,
            &caller_role,
            caller_agent_id(request),
            idempotency_key(request),
        )
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => budget_error_response(e),
    }
}

/// **Internal**: only callable by the `treasury_config.inference_gateway`
/// agent. Registered as `set_event_only` in `tools/mod.rs`. The IPC
/// surface validates the gateway identity by passing `caller_agent_id`
/// through to `BudgetRegistry::spend_inference` which checks against the
/// company config row.
pub async fn handle_spend_inference(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    let amount = match request.get("amount").and_then(|v| v.as_i64()) {
        Some(a) if a >= 0 => a,
        _ => {
            return serde_json::json!({"ok": false, "error": "amount must be a non-negative integer"});
        }
    };
    let request_hash = match super::request_field(request, "request_hash") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "request_hash is required"}),
    };
    let actor = match super::request_field(request, "actor_agent_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "actor_agent_id is required"}),
    };
    let gateway = match super::request_field(request, "gateway_agent_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "gateway_agent_id is required"}),
    };

    match registry(ctx)
        .spend_inference(&id, amount, &request_hash, &actor, &gateway)
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_hire_role(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let parent_budget_id = match super::request_field(request, "parent_budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "parent_budget_id is required"}),
    };
    let parent_role_id = match super::request_field(request, "parent_role_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "parent_role_id is required"}),
    };
    let new_role: NewRoleSpec = match request.get("new_role").cloned() {
        Some(v) => match serde_json::from_value(v) {
            Ok(spec) => spec,
            Err(e) => {
                return serde_json::json!({
                    "ok": false,
                    "error": format!("new_role: {e}"),
                });
            }
        },
        None => return serde_json::json!({"ok": false, "error": "new_role is required"}),
    };
    let bundle = parse_bundle(request.get("bundle").unwrap_or(&serde_json::Value::Null));

    let budgets = registry(ctx);
    let parent_budget = match budgets.get_budget(&parent_budget_id).await {
        Ok(Some(b)) => b,
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "parent budget not found",
                "code": "ENotFound",
            });
        }
    };
    let caller_id = caller_user_id(request).to_string();
    let caller_role =
        match resolve_caller_role(ctx, &parent_budget.company_id, &caller_id, request).await {
            Ok(r) => r,
            Err(e) => return e,
        };

    match budgets
        .hire(
            &parent_budget_id,
            &parent_role_id,
            new_role,
            bundle,
            &caller_role,
            caller_agent_id(request),
            idempotency_key(request),
        )
        .await
    {
        Ok(res) => serde_json::json!({
            "ok": true,
            "role_id": res.role_id,
            "primary_budget_id": res.primary_budget_id,
        }),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_refresh_allowance(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    match registry(ctx).refresh(&id).await {
        Ok(opt) => serde_json::json!({"ok": true, "allowance": opt}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_dissolve_budget(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = match super::request_field(request, "budget_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "budget_id is required"}),
    };
    let budgets = registry(ctx);
    let budget = match budgets.get_budget(&id).await {
        Ok(Some(b)) => b,
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "budget not found",
                "code": "ENotFound",
            });
        }
    };
    let caller_id = caller_user_id(request).to_string();
    let caller_role = match resolve_caller_role(ctx, &budget.company_id, &caller_id, request).await
    {
        Ok(r) => r,
        Err(e) => return e,
    };
    match budgets
        .dissolve(
            &id,
            &caller_role,
            caller_agent_id(request),
            idempotency_key(request),
        )
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_pause_treasury(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id")
        .or_else(|| super::request_field(request, "company_id"))
    {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }
    let paused = request
        .get("paused")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let caller_id = caller_user_id(request).to_string();
    let caller_role = match resolve_caller_role(ctx, &company_id, &caller_id, request).await {
        Ok(r) => r,
        Err(e) => return e,
    };
    match registry(ctx)
        .set_pause(&company_id, paused, &caller_role, caller_agent_id(request))
        .await
    {
        Ok(()) => serde_json::json!({"ok": true, "paused": paused}),
        Err(e) => budget_error_response(e),
    }
}

pub async fn handle_init_treasury_config(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id")
        .or_else(|| super::request_field(request, "company_id"))
    {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }
    let gateway = match super::request_field(request, "inference_gateway") {
        Some(s) => s.to_string(),
        None => {
            return serde_json::json!({
                "ok": false,
                "error": "inference_gateway is required",
            });
        }
    };
    let admin = match super::request_field(request, "admin_role_id") {
        Some(s) => s.to_string(),
        None => return serde_json::json!({"ok": false, "error": "admin_role_id is required"}),
    };
    // Caller must hold roles.manage on the company to call this — admin role
    // bootstrapping is administrative.
    let caller_id = caller_user_id(request).to_string();
    if caller_id.is_empty() {
        return serde_json::json!({
            "ok": false,
            "error": "authentication required",
            "code": "auth_required",
        });
    }
    match ctx
        .role_registry
        .user_has_grant(
            &company_id,
            &caller_id,
            crate::role_registry::GRANT_ROLES_MANAGE,
        )
        .await
    {
        Ok(true) => {}
        Ok(false) => {
            return serde_json::json!({
                "ok": false,
                "error": "forbidden: roles.manage required",
                "code": "forbidden",
            });
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    }

    match registry(ctx)
        .init_treasury_config(&company_id, &gateway, &admin)
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => budget_error_response(e),
    }
}
