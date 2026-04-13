//! Event handler IPC commands — CRUD for the fourth primitive.

use super::request_field;
use crate::event_handler::NewEvent;

pub async fn handle_list_events(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref store) = ctx.event_handler_store else {
        return serde_json::json!({"ok": false, "error": "event handler store not available"});
    };

    let agent_id = request_field(request, "agent_id");

    let events = if let Some(agent_id) = agent_id {
        store.list_for_agent(agent_id).await
    } else {
        store.list_enabled().await
    };

    match events {
        Ok(list) => {
            let items: Vec<serde_json::Value> = list.iter().map(event_to_json).collect();
            serde_json::json!({"ok": true, "events": items})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_create_event(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref store) = ctx.event_handler_store else {
        return serde_json::json!({"ok": false, "error": "event handler store not available"});
    };

    let agent_id = request_field(request, "agent_id").unwrap_or("");
    let name = request_field(request, "name").unwrap_or("");
    let pattern = request_field(request, "pattern").unwrap_or("");

    if agent_id.is_empty() || name.is_empty() || pattern.is_empty() {
        return serde_json::json!({"ok": false, "error": "agent_id, name, and pattern are required"});
    }

    let scope = request_field(request, "scope").unwrap_or("self");
    let idea_id = request_field(request, "idea_id").map(|s| s.to_string());
    let content = request_field(request, "content").map(|s| s.to_string());
    let cooldown_secs = request
        .get("cooldown_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let max_budget_usd = request.get("max_budget_usd").and_then(|v| v.as_f64());
    let webhook_secret = request_field(request, "webhook_secret").map(|s| s.to_string());
    let system = request
        .get("system")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let idea_ids: Vec<String> = request
        .get("idea_ids")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let new_event = NewEvent {
        agent_id: agent_id.to_string(),
        name: name.to_string(),
        pattern: pattern.to_string(),
        scope: scope.to_string(),
        idea_id,
        idea_ids,
        content,
        cooldown_secs,
        max_budget_usd,
        webhook_secret,
        system,
    };

    match store.create(&new_event).await {
        Ok(event) => serde_json::json!({"ok": true, "event": event_to_json(&event)}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_update_event(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref store) = ctx.event_handler_store else {
        return serde_json::json!({"ok": false, "error": "event handler store not available"});
    };

    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    let enabled = request.get("enabled").and_then(|v| v.as_bool());
    let content = request_field(request, "content");
    let pattern = request_field(request, "pattern");
    let scope = request_field(request, "scope");
    let cooldown_secs = request.get("cooldown_secs").and_then(|v| v.as_u64());
    let idea_id = request_field(request, "idea_id");
    let max_budget_usd = request.get("max_budget_usd").and_then(|v| v.as_f64());

    // Check if any field is provided at all.
    if enabled.is_none()
        && content.is_none()
        && pattern.is_none()
        && scope.is_none()
        && cooldown_secs.is_none()
        && idea_id.is_none()
        && max_budget_usd.is_none()
    {
        return serde_json::json!({"ok": false, "error": "at least one field to update is required"});
    }

    match store
        .update_fields(id, enabled, content, pattern, scope, cooldown_secs, idea_id, max_budget_usd)
        .await
    {
        Ok(()) => {
            // Return the updated event.
            match store.get(id).await {
                Ok(Some(event)) => serde_json::json!({"ok": true, "event": event_to_json(&event)}),
                Ok(None) => serde_json::json!({"ok": true}),
                Err(_) => serde_json::json!({"ok": true}),
            }
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_delete_event(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref store) = ctx.event_handler_store else {
        return serde_json::json!({"ok": false, "error": "event handler store not available"});
    };

    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    match store.delete(id).await {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

fn event_to_json(e: &crate::event_handler::Event) -> serde_json::Value {
    serde_json::json!({
        "id": e.id,
        "agent_id": e.agent_id,
        "name": e.name,
        "pattern": e.pattern,
        "scope": e.scope,
        "idea_id": e.idea_id,
        "idea_ids": e.idea_ids,
        "content": e.content,
        "enabled": e.enabled,
        "cooldown_secs": e.cooldown_secs,
        "max_budget_usd": e.max_budget_usd,
        "webhook_secret": e.webhook_secret,
        "last_fired": e.last_fired,
        "fire_count": e.fire_count,
        "total_cost_usd": e.total_cost_usd,
        "system": e.system,
        "created_at": e.created_at,
    })
}
