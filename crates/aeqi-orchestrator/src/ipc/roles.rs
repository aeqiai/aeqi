//! Role IPC handlers.
//!
//! Commands: `list_roles`, `create_role`, `change_occupant`,
//!           `update_role`, `update_role_edges`, `archive_role`, `get_role`,
//!           `user_grants`.
//!
//! `change_occupant` swaps the role's occupant and rotates the participant
//! set on every session anchored to that role, then appends a system
//! hand-off message so the conversation history is continuous.
//! Tenancy is enforced against the active scope — roles live inside an
//! entity, so the caller's `allowed` list filters reads and rejects writes
//! outside their scope.
//!
//! Mutation commands gate on the caller holding `roles.manage` inside the
//! relevant role branch. The caller id comes from `caller_user_id` injected
//! by the HTTP layer via `ipc_proxy`.

use crate::role_registry::{OccupantKind, RoleType};

use super::tenancy::is_allowed;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract `caller_user_id` from the request.
fn caller_user_id(request: &serde_json::Value) -> &str {
    request
        .get("caller_user_id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

/// Check that the caller can manage `role_id` through the role DAG.
/// A caller must hold `roles.manage` on an occupied role that is the target
/// role or one of its ancestors. This keeps authority edits scoped to the
/// caller's delegated branch instead of making `roles.manage` global.
async fn require_can_manage_role(
    ctx: &super::CommandContext,
    company_id: &str,
    role_id: &str,
    caller_id: &str,
) -> Option<serde_json::Value> {
    if caller_id.is_empty() {
        return Some(serde_json::json!({"ok": false, "error": "authentication required"}));
    }
    match ctx
        .role_registry
        .user_can_manage_role(company_id, caller_id, role_id)
        .await
    {
        Ok(true) => None,
        Ok(false) => Some(serde_json::json!({
            "ok": false,
            "error": "forbidden: role is outside caller's managed branch",
            "code": "forbidden",
        })),
        Err(e) => Some(serde_json::json!({"ok": false, "error": e.to_string()})),
    }
}

async fn require_can_create_root_role(
    ctx: &super::CommandContext,
    company_id: &str,
    caller_id: &str,
) -> Option<serde_json::Value> {
    if caller_id.is_empty() {
        return Some(serde_json::json!({"ok": false, "error": "authentication required"}));
    }
    match ctx
        .role_registry
        .user_can_create_root_role(company_id, caller_id)
        .await
    {
        Ok(true) => None,
        Ok(false) => Some(serde_json::json!({
            "ok": false,
            "error": "forbidden: director role required to create root roles",
            "code": "forbidden",
        })),
        Err(e) => Some(serde_json::json!({"ok": false, "error": e.to_string()})),
    }
}

// ── Read handlers ─────────────────────────────────────────────────────────────

pub async fn handle_list_roles(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };

    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let (roles, edges) = match ctx
        .role_registry
        .list_for_entity_with_grants(&company_id)
        .await
    {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    serde_json::json!({
        "ok": true,
        "roles": roles,
        "edges": edges,
    })
}

pub async fn handle_get_role(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let role_id = match super::request_field(request, "role_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "role_id is required"}),
    };

    // Fetch role (includes grants).
    let role = match ctx.role_registry.get(&role_id).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return serde_json::json!({"ok": false, "error": "role not found", "code": "not_found"});
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Fetch parent and child role ids.
    let company_id = role.company_id.clone();
    let edges = match ctx.role_registry.list_edges_for_entity(&company_id).await {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let parent_ids: Vec<&str> = edges
        .iter()
        .filter(|e| e.child_role_id == role_id)
        .map(|e| e.parent_role_id.as_str())
        .collect();
    let child_ids: Vec<&str> = edges
        .iter()
        .filter(|e| e.parent_role_id == role_id)
        .map(|e| e.child_role_id.as_str())
        .collect();

    serde_json::json!({
        "ok": true,
        "role": role,
        "parent_ids": parent_ids,
        "child_ids": child_ids,
    })
}

pub async fn handle_user_grants(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };
    let user_id = match super::request_field(request, "user_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "user_id is required"}),
    };

    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    match ctx
        .role_registry
        .user_grants_for_entity(&company_id, &user_id)
        .await
    {
        Ok(grants) => serde_json::json!({"ok": true, "grants": grants}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

// ── Mutation handlers ─────────────────────────────────────────────────────────

pub async fn handle_create_role(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "company_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &company_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    // Creating without a parent mints a root-level authority seat, so it is
    // limited to Directors. Creating below a parent is scoped to the caller's
    // managed branch.
    let caller_id = caller_user_id(request).to_string();
    let parent_role_id = super::request_field(request, "parent_role_id").map(str::to_string);
    if let Some(parent_id) = parent_role_id.as_deref() {
        if let Some(err) = require_can_manage_role(ctx, &company_id, parent_id, &caller_id).await {
            return err;
        }
    } else if let Some(err) = require_can_create_root_role(ctx, &company_id, &caller_id).await {
        return err;
    }

    let title = super::request_field(request, "title")
        .unwrap_or("")
        .to_string();
    let kind_str = super::request_field(request, "occupant_kind").unwrap_or("vacant");
    let kind = match kind_str.parse::<OccupantKind>() {
        Ok(k) => k,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let occupant_id = super::request_field(request, "occupant_id").map(str::to_string);
    if matches!(
        kind,
        OccupantKind::Human | OccupantKind::Agent | OccupantKind::Company
    ) && occupant_id.is_none()
    {
        return serde_json::json!({
            "ok": false,
            "error": "occupant_id is required when occupant_kind is human, agent, or company",
        });
    }

    let role_type_str = super::request_field(request, "role_type").unwrap_or("operational");
    let role_type = match role_type_str.parse::<RoleType>() {
        Ok(rt) => rt,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let founder = request
        .get("founder")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let grants: Option<Vec<String>> = request.get("grants").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    });

    // Pre-check: if the occupant already has a role in this entity (e.g. a
    // spawn-time row created by `spawn_with_entity_id`), adopt that row instead
    // of minting a second one.  Update its title, role_type, and grants so the
    // caller's intent wins, then wire the edge as normal.
    let role = if let Some(occ_id) = occupant_id.as_deref() {
        match ctx.role_registry.get_by_occupant(&company_id, occ_id).await {
            Ok(Some(existing)) => {
                if let Some(err) =
                    require_can_manage_role(ctx, &company_id, &existing.id, &caller_id).await
                {
                    return err;
                }
                let effective_grants = match grants {
                    Some(ref g) if !g.is_empty() => g.clone(),
                    _ => crate::role_registry::default_grants_for_type(role_type),
                };
                if let Err(e) = ctx
                    .role_registry
                    .update_role(
                        &existing.id,
                        Some(&title),
                        Some(role_type),
                        Some(effective_grants),
                    )
                    .await
                {
                    return serde_json::json!({"ok": false, "error": e.to_string()});
                }
                match ctx.role_registry.get(&existing.id).await {
                    Ok(Some(r)) => r,
                    Ok(None) => {
                        return serde_json::json!({"ok": false, "error": "role vanished after update"});
                    }
                    Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
                }
            }
            Ok(None) => match ctx
                .role_registry
                .create_with_type(
                    &company_id,
                    &title,
                    kind,
                    Some(occ_id),
                    role_type,
                    founder,
                    grants,
                )
                .await
            {
                Ok(r) => r,
                Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
            },
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    } else {
        match ctx
            .role_registry
            .create_with_type(&company_id, &title, kind, None, role_type, founder, grants)
            .await
        {
            Ok(r) => r,
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    };

    if let Some(parent_id) = parent_role_id.as_deref()
        && let Err(e) = ctx.role_registry.add_edge(parent_id, &role.id).await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Quest 67-132 — accept an optional `description_idea_id` on create.
    // Field shape: present non-empty string → set; null or empty string →
    // clear (a fresh role starts cleared, so this is a no-op on create);
    // field absent → leave alone.
    if let Some(field) = request.get("description_idea_id")
        && let Some(idea_id) = description_idea_from_field(field)
        && let Err(e) = ctx
            .role_registry
            .set_description_idea(&role.id, idea_id.as_deref())
            .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Re-fetch so the response reflects the description_idea_id we may
    // have just stamped + the canonical updated_at.
    let role = match ctx.role_registry.get(&role.id).await {
        Ok(Some(r)) => r,
        Ok(None) => return serde_json::json!({"ok": false, "error": "role vanished after create"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    serde_json::json!({"ok": true, "role": role})
}

/// Quest 67-132 — extract the optional `description_idea_id` field shape.
/// Outer `Option` distinguishes "field present but caller doesn't want a
/// write" (`None`) from "write a value" (`Some(...)`). Inner `Option<String>`
/// is the value to write — `Some("idea-id")` to set, `None` to clear.
///
/// Mappings:
///   * `null`             → write `None` (clear)
///   * `""` (empty string) → write `None` (clear)
///   * non-empty string    → write `Some(s)` (set)
///   * other JSON types    → no write (caller error; logged elsewhere)
fn description_idea_from_field(field: &serde_json::Value) -> Option<Option<String>> {
    if field.is_null() {
        return Some(None);
    }
    field.as_str().map(|s| {
        if s.is_empty() {
            None
        } else {
            Some(s.to_string())
        }
    })
}

/// Handle an `update_role` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "role_id":         "<uuid>",
///   "title":           "new title",       // optional
///   "role_type":       "director",        // optional
///   "grants":          ["roles.manage"],  // optional — replaces full set
///   "caller_user_id":  "<user-id>"        // injected by ipc_proxy
/// }
/// ```
pub async fn handle_update_role(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let role_id = match super::request_field(request, "role_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "role_id is required"}),
    };

    // We need the company_id to do the grant check.
    let company_id = match ctx.role_registry.get(&role_id).await {
        Ok(Some(r)) => r.company_id,
        Ok(None) => {
            return serde_json::json!({"ok": false, "error": "role not found", "code": "not_found"});
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let caller_id = caller_user_id(request).to_string();
    if let Some(err) = require_can_manage_role(ctx, &company_id, &role_id, &caller_id).await {
        return err;
    }

    let title = super::request_field(request, "title").map(str::to_string);
    let role_type = super::request_field(request, "role_type")
        .map(|s| s.parse::<RoleType>())
        .transpose();
    let role_type = match role_type {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let grants: Option<Vec<String>> = request.get("grants").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect()
    });

    if let Err(e) = ctx
        .role_registry
        .update_role(&role_id, title.as_deref(), role_type, grants)
        .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Quest 67-132 — accept an optional `description_idea_id` on update.
    // See `description_idea_from_field` for the field shape.
    if let Some(field) = request.get("description_idea_id")
        && let Some(idea_id) = description_idea_from_field(field)
        && let Err(e) = ctx
            .role_registry
            .set_description_idea(&role_id, idea_id.as_deref())
            .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    match ctx.role_registry.get(&role_id).await {
        Ok(Some(updated)) => serde_json::json!({"ok": true, "role": updated}),
        Ok(None) => serde_json::json!({"ok": false, "error": "role not found after update"}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Handle an `update_role_edges` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "role_id":          "<uuid>",
///   "parent_role_ids":  ["<uuid>"], // optional — replaces incoming edges
///   "child_role_ids":   ["<uuid>"], // optional — replaces outgoing edges
///   "caller_user_id":   "<user-id>" // injected by ipc_proxy
/// }
/// ```
pub async fn handle_update_role_edges(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let role_id = match super::request_field(request, "role_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "role_id is required"}),
    };

    let company_id = match ctx.role_registry.get(&role_id).await {
        Ok(Some(r)) => r.company_id,
        Ok(None) => {
            return serde_json::json!({"ok": false, "error": "role not found", "code": "not_found"});
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let caller_id = caller_user_id(request).to_string();
    if let Some(err) = require_can_manage_role(ctx, &company_id, &role_id, &caller_id).await {
        return err;
    }

    if let Some(parent_ids) = request.get("parent_role_ids").and_then(|v| v.as_array()) {
        let parent_ids = parent_ids
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect::<Vec<_>>();
        for parent_id in &parent_ids {
            if let Some(err) =
                require_can_manage_role(ctx, &company_id, parent_id, &caller_id).await
            {
                return err;
            }
        }
        if let Err(e) = ctx
            .role_registry
            .set_parent_edges(&role_id, parent_ids)
            .await
        {
            return serde_json::json!({"ok": false, "error": e.to_string()});
        }
    }

    if let Some(child_ids) = request.get("child_role_ids").and_then(|v| v.as_array()) {
        let child_ids = child_ids
            .iter()
            .filter_map(|v| v.as_str().map(str::to_string))
            .collect::<Vec<_>>();
        for child_id in &child_ids {
            if let Some(err) = require_can_manage_role(ctx, &company_id, child_id, &caller_id).await
            {
                return err;
            }
        }
        if let Err(e) = ctx.role_registry.set_child_edges(&role_id, child_ids).await {
            return serde_json::json!({"ok": false, "error": e.to_string()});
        }
    }

    let role = match ctx.role_registry.get(&role_id).await {
        Ok(Some(role)) => role,
        Ok(None) => return serde_json::json!({"ok": false, "error": "role not found after update"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let edges = match ctx.role_registry.list_edges_for_entity(&company_id).await {
        Ok(edges) => edges,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    serde_json::json!({"ok": true, "role": role, "edges": edges})
}

/// Handle an `archive_role` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "role_id":        "<uuid>",
///   "caller_user_id": "<user-id>"   // injected by ipc_proxy
/// }
/// ```
pub async fn handle_archive_role(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let role_id = match super::request_field(request, "role_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "role_id is required"}),
    };

    let company_id = match ctx.role_registry.get(&role_id).await {
        Ok(Some(r)) => r.company_id,
        Ok(None) => {
            return serde_json::json!({"ok": false, "error": "role not found", "code": "not_found"});
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let caller_id = caller_user_id(request).to_string();
    if let Some(err) = require_can_manage_role(ctx, &company_id, &role_id, &caller_id).await {
        return err;
    }

    match ctx.role_registry.archive_role(&role_id).await {
        Ok(()) => serde_json::json!({"ok": true, "role_id": role_id}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Handle a `change_occupant` IPC command.
///
/// # Request shape
///
/// ```json
/// {
///   "role_id":        "<uuid>",
///   "occupant_kind":  "human" | "agent" | "vacant",
///   "occupant_id":    "<id>"    // required unless kind=vacant
/// }
/// ```
///
/// # Side effects
///
/// For every active session with `target_role_id = role_id`:
///   1. Removes the OLD occupant from `session_participants`.
///   2. Adds the NEW occupant to `session_participants` (joined_by="system").
///   3. Appends a system message: `"<old_kind>:<old_id> handed off to <new_kind>:<new_id>"`.
///
/// This preserves session continuity through occupant changes.
pub async fn handle_change_occupant(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let role_id = match super::request_field(request, "role_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "role_id is required"}),
    };
    let kind_str = super::request_field(request, "occupant_kind").unwrap_or("vacant");
    let new_kind = match kind_str.parse::<OccupantKind>() {
        Ok(k) => k,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let new_occupant_id = super::request_field(request, "occupant_id").map(str::to_string);
    if matches!(
        new_kind,
        OccupantKind::Human | OccupantKind::Agent | OccupantKind::Company
    ) && new_occupant_id.is_none()
    {
        return serde_json::json!({
            "ok": false,
            "error": "occupant_id is required when occupant_kind is human, agent, or company",
        });
    }

    // Fetch the current (old) occupant before the update; also get company_id for grant check.
    let role = match ctx.role_registry.get(&role_id).await {
        Ok(Some(r)) => r,
        Ok(None) => return serde_json::json!({"ok": false, "error": "role not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Gate on branch-scoped roles.manage.
    let caller_id = caller_user_id(request).to_string();
    if let Some(err) = require_can_manage_role(ctx, &role.company_id, &role_id, &caller_id).await {
        return err;
    }

    let old_kind_str = match role.occupant_kind {
        OccupantKind::Human => "user",
        OccupantKind::Agent => "agent",
        OccupantKind::Company => "company",
        OccupantKind::Vacant => "vacant",
    };
    let old_occupant_id = role.occupant_id.clone();

    // Persist the update.
    if let Err(e) = ctx
        .role_registry
        .update_occupant(&role_id, new_kind, new_occupant_id.as_deref())
        .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Rotate participants on every anchored session.
    let Some(ref ss) = ctx.session_store else {
        // No session store — update succeeded but no session rotation.
        return serde_json::json!({"ok": true, "sessions_updated": 0});
    };

    let anchored = match ss.sessions_by_target_role(&role_id).await {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let new_kind_str = match new_kind {
        OccupantKind::Human => "user",
        OccupantKind::Agent => "agent",
        OccupantKind::Company => "company",
        OccupantKind::Vacant => "vacant",
    };

    let handoff_body = {
        let old_label = old_occupant_id
            .as_deref()
            .map(|id| format!("{old_kind_str}:{id}"))
            .unwrap_or_else(|| "vacant".to_string());
        let new_label = new_occupant_id
            .as_deref()
            .map(|id| format!("{new_kind_str}:{id}"))
            .unwrap_or_else(|| "vacant".to_string());
        format!("{old_label} handed off to {new_label}")
    };

    let mut sessions_updated: usize = 0;
    for session_id in &anchored {
        // Remove old occupant (no-op if vacant or already absent).
        if let Some(ref old_id) = old_occupant_id
            && !matches!(role.occupant_kind, OccupantKind::Vacant)
        {
            let _ = ss
                .remove_session_participant(session_id, old_kind_str, old_id)
                .await;
        }

        // Add new occupant (idempotent if already a participant).
        if let Some(ref new_id) = new_occupant_id
            && !matches!(new_kind, OccupantKind::Vacant)
        {
            let _ = ss
                .add_session_participant(session_id, new_kind_str, new_id, Some("system"))
                .await;
        }

        // Append hand-off system message.
        let _ = ss
            .append_message_from(session_id, "system", &handoff_body, "system", None, None)
            .await;

        sessions_updated += 1;
    }

    serde_json::json!({
        "ok": true,
        "role_id": role_id,
        "sessions_updated": sessions_updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ipc::CommandContext;
    use crate::session_store::SessionStore;
    use std::sync::Arc;

    async fn build_test_ctx(dir: &std::path::Path) -> (CommandContext, Arc<SessionStore>) {
        use crate::dispatch::{DispatchConfig, Dispatcher};
        use crate::ipc::ActivityBuffer;
        use tokio::sync::Mutex;

        let registry = Arc::new(crate::agent_registry::AgentRegistry::open(dir).unwrap());
        let sessions_pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = sessions_pool.lock().await;
            SessionStore::create_tables(&conn).unwrap();
        }
        let ss = Arc::new(SessionStore::new(Arc::new(sessions_pool)));
        let (embed_queue, _rx) = aeqi_ideas::embed_worker::EmbedQueue::channel(8);

        let ctx = CommandContext {
            metrics: Arc::new(crate::metrics::AEQIMetrics::new()),
            activity_log: Arc::new(crate::activity_log::ActivityLog::new(registry.db())),
            session_store: Some(Arc::clone(&ss)),
            event_handler_store: None,
            agent_registry: registry.clone(),
            entity_registry: Arc::new(crate::entity_registry::EntityRegistry::open(registry.db())),
            role_registry: Arc::new(crate::role_registry::RoleRegistry::open(registry.db())),
            idea_store: None,
            message_router: None,
            activity_buffer: Arc::new(Mutex::new(ActivityBuffer::default())),
            default_provider: None,
            default_model: "test".to_string(),
            session_manager: Arc::new(crate::session_manager::SessionManager::new()),
            dispatcher: Arc::new(Dispatcher::new(DispatchConfig::default())),
            daily_budget_usd: 0.0,
            skill_loader: None,
            execution_registry: Arc::new(crate::execution_registry::ExecutionRegistry::new()),
            stream_registry: Arc::new(crate::stream_registry::StreamRegistry::new()),
            channel_spawner: None,
            tag_policy_cache: Arc::new(aeqi_ideas::tag_policy::TagPolicyCache::new(60)),
            embed_queue: Arc::new(embed_queue),
            embedder: None,
            recall_cache: Arc::new(aeqi_ideas::RecallCache::default()),
            pattern_dispatcher: None,
            credentials: None,
        };
        (ctx, ss)
    }

    /// Create an entity with a Director-occupied role for the given user, then
    /// return the company_id so tests can create additional roles.
    async fn make_entity_with_director(ctx: &CommandContext, user_id: &str) -> String {
        let entity = ctx
            .entity_registry
            .create_new(
                "Test Co",
                &format!("testco-{}", uuid::Uuid::new_v4()),
                crate::entity_registry::EntityType::Company,
                None,
                None,
            )
            .await
            .unwrap();
        ctx.role_registry
            .create_with_type(
                &entity.id,
                "Founder",
                OccupantKind::Human,
                Some(user_id),
                crate::role_registry::RoleType::Director,
                true,
                None,
            )
            .await
            .unwrap();
        entity.id
    }

    async fn founding_director_id(ctx: &CommandContext, company_id: &str) -> String {
        ctx.role_registry
            .list_for_entity_with_grants(company_id)
            .await
            .unwrap()
            .0
            .into_iter()
            .find(|role| role.founder)
            .expect("founding director")
            .id
    }

    async fn attach_to_founding_director(ctx: &CommandContext, company_id: &str, role_id: &str) {
        let founder_id = founding_director_id(ctx, company_id).await;
        ctx.role_registry
            .add_edge(&founder_id, role_id)
            .await
            .expect("attach to founder");
    }

    /// Create an entity + agent-occupied role in the given ctx.
    async fn make_occupied_role(ctx: &CommandContext, agent_id: &str) -> (String, String) {
        let company_id = make_entity_with_director(ctx, "owner-user").await;
        let role = ctx
            .role_registry
            .create_with_type(
                &company_id,
                "CEO",
                OccupantKind::Agent,
                Some(agent_id),
                crate::role_registry::RoleType::Director,
                false,
                None,
            )
            .await
            .unwrap();
        attach_to_founding_director(ctx, &company_id, &role.id).await;
        (role.id, company_id)
    }

    #[tokio::test]
    async fn change_occupant_swaps_participants_and_emits_handoff() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, ss) = build_test_ctx(dir.path()).await;

        let old_agent = "agent-old";
        let new_agent = "agent-new";

        let (role_id, _entity_id) = make_occupied_role(&ctx, old_agent).await;

        // Anchor a session on the role and add the old occupant as a
        // participant so change_occupant has something to rotate.
        let session_id = ss
            .create_role_session(&role_id, &format!("role:{role_id}"))
            .await
            .unwrap();
        ss.add_session_participant(&session_id, "agent", old_agent, None)
            .await
            .unwrap();

        // owner-user has Director role → passes roles.manage check.
        let req = serde_json::json!({
            "role_id": role_id,
            "occupant_kind": "agent",
            "occupant_id": new_agent,
            "caller_user_id": "owner-user",
        });

        let resp = handle_change_occupant(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["sessions_updated"], 1);

        // Old occupant must be gone from session_participants.
        let participants = {
            let pool = ss.db();
            let db = pool.lock().await;
            let mut stmt = db
                .prepare(
                    "SELECT identity_kind, identity_id FROM session_participants \
                     WHERE session_id = ?1",
                )
                .unwrap();
            stmt.query_map(rusqlite::params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .unwrap()
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
        };
        assert!(
            !participants
                .iter()
                .any(|(k, id)| k == "agent" && id == old_agent),
            "old occupant must be removed from participants; got {participants:?}"
        );
        assert!(
            participants
                .iter()
                .any(|(k, id)| k == "agent" && id == new_agent),
            "new occupant must be added to participants; got {participants:?}"
        );

        // Hand-off system message must be in the timeline.
        let timeline = ss.timeline_by_session(&session_id, 10).await.unwrap();
        let handoff = timeline
            .iter()
            .find(|e| e.content.contains("handed off to"));
        assert!(handoff.is_some(), "handoff message not found in timeline");
        assert_eq!(handoff.unwrap().role, "system");
    }

    #[tokio::test]
    async fn change_occupant_session_continuity() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, ss) = build_test_ctx(dir.path()).await;

        let (role_id, _entity_id) = make_occupied_role(&ctx, "agent-alpha").await;

        let session_id_before = ss
            .create_role_session(&role_id, &format!("role:{role_id}"))
            .await
            .unwrap();

        let req = serde_json::json!({
            "role_id": role_id,
            "occupant_kind": "agent",
            "occupant_id": "agent-beta",
            "caller_user_id": "owner-user",
        });
        let resp = handle_change_occupant(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true);

        let still_active = ss.get_session(&session_id_before).await.unwrap().unwrap();
        assert_eq!(
            still_active.id, session_id_before,
            "session id must not change after occupant swap"
        );
        assert_eq!(still_active.status, "active");
    }

    #[tokio::test]
    async fn change_occupant_forbidden_without_grant() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _ss) = build_test_ctx(dir.path()).await;

        let company_id = make_entity_with_director(&ctx, "owner-user").await;
        let role = ctx
            .role_registry
            .create_with_type(
                &company_id,
                "Ops",
                OccupantKind::Agent,
                Some("agent-z"),
                crate::role_registry::RoleType::Operational,
                false,
                None,
            )
            .await
            .unwrap();

        let req = serde_json::json!({
            "role_id": role.id,
            "occupant_kind": "agent",
            "occupant_id": "agent-new",
            "caller_user_id": "stranger",
        });
        let resp = handle_change_occupant(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["code"], "forbidden");
    }

    #[tokio::test]
    async fn create_role_with_type_and_grants() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _ss) = build_test_ctx(dir.path()).await;

        let company_id = make_entity_with_director(&ctx, "owner").await;

        let req = serde_json::json!({
            "company_id": company_id,
            "title": "Advisor",
            "occupant_kind": "vacant",
            "role_type": "advisor",
            "founder": false,
            "caller_user_id": "owner",
        });
        let resp = handle_create_role(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");
        assert_eq!(resp["role"]["role_type"], "advisor");
    }

    #[tokio::test]
    async fn update_role_changes_title() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _ss) = build_test_ctx(dir.path()).await;

        let company_id = make_entity_with_director(&ctx, "owner").await;
        let role = ctx
            .role_registry
            .create(&company_id, "Old Title", OccupantKind::Vacant, None)
            .await
            .unwrap();
        attach_to_founding_director(&ctx, &company_id, &role.id).await;

        let req = serde_json::json!({
            "role_id": role.id,
            "title": "New Title",
            "caller_user_id": "owner",
        });
        let resp = handle_update_role(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");
        assert_eq!(resp["role"]["title"], "New Title");
    }

    #[tokio::test]
    async fn archive_role_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _ss) = build_test_ctx(dir.path()).await;

        let company_id = make_entity_with_director(&ctx, "owner").await;
        let role = ctx
            .role_registry
            .create(&company_id, "Temp", OccupantKind::Vacant, None)
            .await
            .unwrap();
        attach_to_founding_director(&ctx, &company_id, &role.id).await;

        let req = serde_json::json!({
            "role_id": role.id,
            "caller_user_id": "owner",
        });
        let resp = handle_archive_role(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");

        let get_resp = handle_get_role(&ctx, &serde_json::json!({"role_id": role.id}), &None).await;
        assert_eq!(get_resp["ok"], false);
        assert_eq!(get_resp["code"], "not_found");
    }

    #[tokio::test]
    async fn update_role_edges_replaces_parents() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _ss) = build_test_ctx(dir.path()).await;
        let company_id = make_entity_with_director(&ctx, "owner").await;

        let board = ctx
            .role_registry
            .create_with_type(
                &company_id,
                "Board",
                OccupantKind::Vacant,
                None,
                RoleType::Director,
                false,
                None,
            )
            .await
            .expect("board");
        let operator = ctx
            .role_registry
            .create_with_type(
                &company_id,
                "Operator",
                OccupantKind::Vacant,
                None,
                RoleType::Operational,
                false,
                None,
            )
            .await
            .expect("operator");
        attach_to_founding_director(&ctx, &company_id, &board.id).await;
        attach_to_founding_director(&ctx, &company_id, &operator.id).await;

        let req = serde_json::json!({
            "role_id": operator.id,
            "parent_role_ids": [board.id],
            "caller_user_id": "owner",
        });
        let resp = handle_update_role_edges(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");
        let edges = resp["edges"].as_array().expect("edges");
        assert!(edges.iter().any(|edge| {
            edge["parent_role_id"] == board.id && edge["child_role_id"] == operator.id
        }));
    }

    #[tokio::test]
    async fn user_grants_handler_returns_grants() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _ss) = build_test_ctx(dir.path()).await;

        let company_id = make_entity_with_director(&ctx, "owner").await;

        let req = serde_json::json!({"company_id": company_id, "user_id": "owner"});
        let resp = handle_user_grants(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");
        let grants = resp["grants"].as_array().unwrap();
        assert!(
            grants
                .iter()
                .any(|g| g == crate::role_registry::GRANT_ROLES_MANAGE),
            "director must have roles.manage"
        );
    }

    /// Quest 67-132: create + update accept `description_idea_id`; absent
    /// field leaves the column NULL; explicit null clears a previously-set
    /// pointer.
    #[tokio::test]
    async fn description_idea_id_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let (ctx, _ss) = build_test_ctx(dir.path()).await;
        let company_id = make_entity_with_director(&ctx, "owner").await;

        // Create with a description_idea_id present.
        let create_req = serde_json::json!({
            "company_id": company_id,
            "title": "CFO",
            "occupant_kind": "vacant",
            "role_type": "director",
            "description_idea_id": "idea-charter-cfo-v1",
            "caller_user_id": "owner",
        });
        let resp = handle_create_role(&ctx, &create_req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");
        assert_eq!(resp["role"]["description_idea_id"], "idea-charter-cfo-v1");
        let role_id = resp["role"]["id"].as_str().unwrap().to_string();

        // Update with no description field — pointer must survive.
        let update_req = serde_json::json!({
            "role_id": role_id,
            "title": "Chief Financial Officer",
            "caller_user_id": "owner",
        });
        let resp = handle_update_role(&ctx, &update_req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");
        assert_eq!(
            resp["role"]["description_idea_id"], "idea-charter-cfo-v1",
            "absent field must NOT clear the pointer"
        );

        // Update with explicit null — pointer must clear.
        let clear_req = serde_json::json!({
            "role_id": role_id,
            "description_idea_id": serde_json::Value::Null,
            "caller_user_id": "owner",
        });
        let resp = handle_update_role(&ctx, &clear_req, &None).await;
        assert_eq!(resp["ok"], true, "{resp}");
        assert!(
            resp["role"].get("description_idea_id").is_none()
                || resp["role"]["description_idea_id"].is_null(),
            "explicit null must clear the pointer (skip_serializing_if + None"
        );
    }
}
