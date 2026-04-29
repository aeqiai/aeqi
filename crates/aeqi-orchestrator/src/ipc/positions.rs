//! Position IPC handlers.
//!
//! Two commands today: `list_positions` (positions + edges for an entity)
//! and `create_position` (mint a fresh slot + optionally attach an edge to
//! an existing parent). Tenancy is enforced against the active scope —
//! positions live inside an entity, so the caller's `allowed` list filters
//! reads and rejects writes outside their scope.

use crate::position_registry::OccupantKind;

use super::tenancy::is_allowed;

pub async fn handle_list_positions(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let entity_id = match super::request_field(request, "entity_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "entity_id is required"}),
    };

    if allowed.is_some() && !is_allowed(allowed, &entity_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let positions = match ctx.position_registry.list_for_entity(&entity_id).await {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let edges = match ctx
        .position_registry
        .list_edges_for_entity(&entity_id)
        .await
    {
        Ok(v) => v,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    serde_json::json!({
        "ok": true,
        "positions": positions,
        "edges": edges,
    })
}

pub async fn handle_create_position(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let entity_id = match super::request_field(request, "entity_id") {
        Some(s) if !s.is_empty() => s.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "entity_id is required"}),
    };
    if allowed.is_some() && !is_allowed(allowed, &entity_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
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
    if matches!(kind, OccupantKind::Human | OccupantKind::Agent) && occupant_id.is_none() {
        return serde_json::json!({
            "ok": false,
            "error": "occupant_id is required when occupant_kind is human or agent",
        });
    }

    let parent_position_id =
        super::request_field(request, "parent_position_id").map(str::to_string);

    let position = match ctx
        .position_registry
        .create(&entity_id, &title, kind, occupant_id.as_deref())
        .await
    {
        Ok(p) => p,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if let Some(parent_id) = parent_position_id.as_deref()
        && let Err(e) = ctx
            .position_registry
            .add_edge(parent_id, &position.id)
            .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    serde_json::json!({"ok": true, "position": position})
}
