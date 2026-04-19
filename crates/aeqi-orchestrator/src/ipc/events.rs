//! Event handler IPC commands — CRUD for the fourth primitive.

use super::request_field;
use crate::event_handler::{NewEvent, ToolCall};

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

    // `agent_id` may be null/missing → global event.
    let agent_id_opt = request_field(request, "agent_id").map(|s| s.to_string());
    let name = request_field(request, "name").unwrap_or("");
    let pattern = request_field(request, "pattern").unwrap_or("");

    if name.is_empty() || pattern.is_empty() {
        return serde_json::json!({"ok": false, "error": "name and pattern are required"});
    }

    let cooldown_secs = request
        .get("cooldown_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let system = request
        .get("system")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let idea_ids = match parse_required_idea_ids(request) {
        Ok(ids) => ids,
        Err(error) => return serde_json::json!({"ok": false, "error": error}),
    };

    let query_template = request_field(request, "query_template").map(|s| s.to_string());
    let query_top_k = request
        .get("query_top_k")
        .and_then(|v| v.as_u64())
        .and_then(|v| u32::try_from(v).ok());
    let query_tag_filter: Option<Vec<String>> = request
        .get("query_tag_filter")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .filter(|v: &Vec<String>| !v.is_empty());

    let tool_calls = parse_tool_calls(request);

    let new_event = NewEvent {
        agent_id: agent_id_opt,
        name: name.to_string(),
        pattern: pattern.to_string(),
        idea_ids,
        query_template,
        query_top_k,
        query_tag_filter,
        tool_calls,
        cooldown_secs,
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
    let pattern = request_field(request, "pattern");
    let cooldown_secs = request.get("cooldown_secs").and_then(|v| v.as_u64());
    let idea_ids = match parse_optional_idea_ids(request) {
        Ok(ids) => ids,
        Err(error) => return serde_json::json!({"ok": false, "error": error}),
    };

    let query_template: Option<Option<String>> = request.get("query_template").map(|v| match v {
        serde_json::Value::Null => None,
        serde_json::Value::String(s) => Some(s.clone()),
        _ => None,
    });
    let query_top_k: Option<Option<u32>> = request.get("query_top_k").map(|v| match v {
        serde_json::Value::Null => None,
        serde_json::Value::Number(n) => n.as_u64().and_then(|v| u32::try_from(v).ok()),
        _ => None,
    });
    let query_tag_filter: Option<Option<Vec<String>>> =
        request.get("query_tag_filter").map(|v| match v {
            serde_json::Value::Null => None,
            serde_json::Value::Array(arr) => {
                let tags: Vec<String> = arr
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect();
                if tags.is_empty() { None } else { Some(tags) }
            }
            _ => None,
        });

    let tool_calls_opt: Option<Vec<ToolCall>> = if request.get("tool_calls").is_some() {
        Some(parse_tool_calls(request))
    } else {
        None
    };

    // Check if any field is provided at all.
    if enabled.is_none()
        && pattern.is_none()
        && cooldown_secs.is_none()
        && idea_ids.is_none()
        && query_template.is_none()
        && query_top_k.is_none()
        && query_tag_filter.is_none()
        && tool_calls_opt.is_none()
    {
        return serde_json::json!({"ok": false, "error": "at least one field to update is required"});
    }

    match store
        .update_fields(
            id,
            enabled,
            pattern,
            cooldown_secs,
            idea_ids.as_deref(),
            query_template.as_ref().map(|v| v.as_deref()),
            query_top_k,
            query_tag_filter.as_ref().map(|v| v.as_deref()),
            tool_calls_opt.as_deref(),
        )
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

/// Trigger an event pattern for an agent and return the assembled ideas context.
///
/// Resolves agent by name → id, runs `assemble_ideas` with the specified pattern's
/// referenced ideas, and returns the full assembled prompt. This lets external
/// consumers (like Claude Code session hooks) receive the same context that the
/// AEQI runtime would inject during its own event lifecycle.
pub async fn handle_trigger_event(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref event_store) = ctx.event_handler_store else {
        return serde_json::json!({"ok": false, "error": "event handler store not available"});
    };

    // Accept either agent name or agent_id.
    let agent_name = request_field(request, "agent");
    let agent_id_direct = request_field(request, "agent_id");
    let pattern = request_field(request, "pattern").unwrap_or("session:start");

    // Resolve agent_id: prefer direct ID, fall back to name lookup.
    let agent_id = if let Some(id) = agent_id_direct {
        id.to_string()
    } else if let Some(name) = agent_name {
        match ctx.agent_registry.get_active_by_name(name).await {
            Ok(Some(agent)) => agent.id,
            Ok(None) => {
                return serde_json::json!({"ok": false, "error": format!("agent '{}' not found", name)});
            }
            Err(e) => {
                return serde_json::json!({"ok": false, "error": e.to_string()});
            }
        }
    } else {
        return serde_json::json!({"ok": false, "error": "agent or agent_id is required"});
    };

    // Allow the caller (e.g. session hook, debug tool) to pass through context
    // values that the event's query_template may reference.
    let assembly_ctx = crate::idea_assembly::AssemblyContext {
        user_prompt: request_field(request, "user_prompt").map(str::to_string),
        tool_output: request_field(request, "tool_output").map(str::to_string),
        quest_description: request_field(request, "quest_description").map(str::to_string),
    };

    // Run assemble_ideas — same path as the internal runtime, parameterized by pattern.
    // No ToolDispatch here: handle_trigger_event is a preview/dry-run path used by
    // the UI test-trigger; it doesn't need to actually execute side-effecting tools.
    let assembled = crate::idea_assembly::assemble_ideas_for_pattern(
        &ctx.agent_registry,
        ctx.idea_store.as_ref(),
        event_store,
        &agent_id,
        &[],
        pattern,
        &assembly_ctx,
        None,
    )
    .await;

    let system_prompt = assembled.system;

    // Also return the matched events for visibility.
    let matched_events = event_store.get_events_for_pattern(&agent_id, pattern).await;
    let event_items: Vec<serde_json::Value> = matched_events.iter().map(event_to_json).collect();

    serde_json::json!({
        "ok": true,
        "agent_id": agent_id,
        "pattern": pattern,
        "system_prompt": system_prompt,
        "matched_events": event_items,
    })
}

/// List recent invocations for a session, optionally with full step detail.
pub async fn handle_trace_events(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref store) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };

    // Distinguish the two query shapes:
    //   { invocation_id: int }  → detail view
    //   { session_id: str, limit?: int } → list view
    if let Some(inv_id) = request.get("invocation_id").and_then(|v| v.as_i64()) {
        match store.get_invocation_detail(inv_id).await {
            Ok((inv, steps)) => serde_json::json!({
                "ok": true,
                "invocation": invocation_to_json(&inv),
                "steps": steps.iter().map(step_to_json).collect::<Vec<_>>(),
            }),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    } else {
        let session_id = match super::request_field(request, "session_id") {
            Some(s) => s,
            None => {
                return serde_json::json!({
                    "ok": false,
                    "error": "session_id or invocation_id is required"
                });
            }
        };
        let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
        match store.list_invocations(session_id, limit).await {
            Ok(rows) => serde_json::json!({
                "ok": true,
                "invocations": rows.iter().map(invocation_to_json).collect::<Vec<_>>(),
            }),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    }
}

fn invocation_to_json(r: &crate::session_store::EventInvocationRow) -> serde_json::Value {
    serde_json::json!({
        "id": r.id,
        "session_id": r.session_id,
        "pattern": r.pattern,
        "event_name": r.event_name,
        "caller_kind": r.caller_kind,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "status": r.status,
        "error": r.error,
        "tool_calls_json": r.tool_calls_json,
    })
}

fn step_to_json(r: &crate::session_store::InvocationStepRow) -> serde_json::Value {
    serde_json::json!({
        "id": r.id,
        "invocation_id": r.invocation_id,
        "step_index": r.step_index,
        "tool_name": r.tool_name,
        "args_json": r.args_json,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "result_summary": r.result_summary,
        "status": r.status,
        "error": r.error,
    })
}

fn event_to_json(e: &crate::event_handler::Event) -> serde_json::Value {
    serde_json::json!({
        "id": e.id,
        "agent_id": e.agent_id,
        "name": e.name,
        "pattern": e.pattern,
        "idea_ids": e.idea_ids,
        "query_template": e.query_template,
        "query_top_k": e.query_top_k,
        "query_tag_filter": e.query_tag_filter,
        "tool_calls": e.tool_calls,
        "enabled": e.enabled,
        "cooldown_secs": e.cooldown_secs,
        "last_fired": e.last_fired,
        "fire_count": e.fire_count,
        "total_cost_usd": e.total_cost_usd,
        "system": e.system,
        "created_at": e.created_at,
    })
}

fn parse_tool_calls(request: &serde_json::Value) -> Vec<ToolCall> {
    let Some(arr) = request.get("tool_calls").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let tool = item.get("tool")?.as_str()?.to_string();
            let args = item
                .get("args")
                .cloned()
                .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
            Some(ToolCall { tool, args })
        })
        .collect()
}

fn parse_required_idea_ids(request: &serde_json::Value) -> Result<Vec<String>, String> {
    match request.get("idea_ids") {
        None => Ok(Vec::new()),
        Some(value) => parse_idea_ids_array(value),
    }
}

fn parse_optional_idea_ids(request: &serde_json::Value) -> Result<Option<Vec<String>>, String> {
    match request.get("idea_ids") {
        None => Ok(None),
        Some(value) => parse_idea_ids_array(value).map(Some),
    }
}

fn parse_idea_ids_array(value: &serde_json::Value) -> Result<Vec<String>, String> {
    let Some(items) = value.as_array() else {
        return Err("idea_ids must be an array of strings".to_string());
    };

    let mut ids = Vec::with_capacity(items.len());
    for item in items {
        let Some(id) = item.as_str() else {
            return Err("idea_ids must be an array of strings".to_string());
        };
        ids.push(id.to_string());
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_optional_idea_ids_distinguishes_omitted_from_empty() {
        let omitted = serde_json::json!({});
        assert_eq!(parse_optional_idea_ids(&omitted).unwrap(), None);

        let empty = serde_json::json!({"idea_ids": []});
        assert_eq!(parse_optional_idea_ids(&empty).unwrap(), Some(vec![]));

        let populated = serde_json::json!({"idea_ids": ["i1", "i2"]});
        assert_eq!(
            parse_optional_idea_ids(&populated).unwrap(),
            Some(vec!["i1".to_string(), "i2".to_string()])
        );
    }

    #[test]
    fn parse_optional_idea_ids_rejects_non_array_values() {
        let invalid = serde_json::json!({"idea_ids": "not-an-array"});
        assert!(parse_optional_idea_ids(&invalid).is_err());
    }
}
