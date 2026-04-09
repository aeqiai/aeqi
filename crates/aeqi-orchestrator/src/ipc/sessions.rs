//! Session management IPC handlers.
//!
//! Note: `session_send` stays in daemon.rs because it writes directly to the socket
//! for streaming mode.

use super::request_field;
use super::tenancy::check_agent_access;

pub async fn handle_list_sessions(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    if let Some(ref ss) = ctx.session_store {
        let hint = request_field(request, "agent_id").unwrap_or("");
        if hint.is_empty() {
            return serde_json::json!({"ok": false, "error": "agent_id is required"});
        }
        let resolved_id = if hint.len() == 36 && hint.contains('-') {
            hint.to_string()
        } else {
            match ctx.agent_registry.resolve_by_hint(hint).await {
                Ok(Some(agent)) => agent.id,
                _ => hint.to_string(),
            }
        };
        if !check_agent_access(&ctx.agent_registry, allowed, &resolved_id).await {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
        match ss.list_sessions(Some(&resolved_id), 100).await {
            Ok(sessions) => serde_json::json!({"ok": true, "sessions": sessions}),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    } else {
        serde_json::json!({"ok": false, "error": "session store not available"})
    }
}

pub async fn handle_sessions(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_id = request_field(request, "agent_id").map(|s| s.to_string());
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

    if allowed.is_some() && agent_id.is_none() {
        return serde_json::json!({"ok": true, "sessions": []});
    }
    if allowed.is_some()
        && agent_id.as_deref().is_some()
        && !check_agent_access(&ctx.agent_registry, allowed, agent_id.as_deref().unwrap()).await
    {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    if let Some(ref ss) = ctx.session_store {
        match ss.list_sessions(agent_id.as_deref(), limit).await {
            Ok(sessions) => serde_json::json!({"ok": true, "sessions": sessions}),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    } else {
        serde_json::json!({"ok": false, "error": "session store not available"})
    }
}

pub async fn handle_create_session(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    if let Some(ref ss) = ctx.session_store {
        let agent_id = request_field(request, "agent_id").unwrap_or("");
        if agent_id.is_empty() {
            return serde_json::json!({"ok": false, "error": "agent_id is required"});
        }
        if !check_agent_access(&ctx.agent_registry, allowed, agent_id).await {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
        match ss
            .create_session(agent_id, "perpetual", "Permanent Session", None, None)
            .await
        {
            Ok(session_id) => serde_json::json!({"ok": true, "session_id": session_id}),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    } else {
        serde_json::json!({"ok": false, "error": "session store not available"})
    }
}

pub async fn handle_close_session(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let session_id = request_field(request, "session_id").unwrap_or("");
    if session_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "session_id is required"});
    }

    if allowed.is_some() {
        let ok = if let Some(ref ss) = ctx.session_store {
            match ss.get_session(session_id).await {
                Ok(Some(s)) => match s.agent_id.as_deref() {
                    Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                    None => false,
                },
                _ => false,
            }
        } else {
            false
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    let was_running = ctx.session_manager.close(session_id).await;
    let db_closed = if let Some(ref ss) = ctx.session_store {
        ss.close_session(session_id).await.is_ok()
    } else {
        false
    };

    serde_json::json!({
        "ok": true,
        "was_running": was_running,
        "db_closed": db_closed,
    })
}

/// Returns `None` if the tenancy check failed (caller should write the error and continue).
/// Returns `Some(json)` for the normal response.
pub async fn handle_session_messages(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> Option<serde_json::Value> {
    if let Some(ref ss) = ctx.session_store {
        let session_id = request_field(request, "session_id").unwrap_or("");
        let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
        if allowed.is_some() {
            let session_ok = match ss.get_session(session_id).await {
                Ok(Some(session)) => match session.agent_id.as_deref() {
                    Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                    None => false,
                },
                _ => false,
            };
            if !session_ok {
                return None;
            }
        }
        match ss.timeline_by_session(session_id, limit).await {
            Ok(events) => {
                let msgs: Vec<serde_json::Value> = events
                    .iter()
                    .map(|e| {
                        let mut obj = serde_json::json!({
                            "role": e.role,
                            "content": e.content,
                            "created_at": e.timestamp.to_rfc3339(),
                            "source": e.source,
                            "event_type": e.event_type,
                        });
                        if let Some(ref meta) = e.metadata {
                            obj["metadata"] = meta.clone();
                        }
                        obj
                    })
                    .collect();
                Some(serde_json::json!({"ok": true, "messages": msgs}))
            }
            Err(e) => Some(serde_json::json!({"ok": false, "error": e.to_string()})),
        }
    } else {
        Some(serde_json::json!({"ok": false, "error": "session store not available"}))
    }
}

/// Returns `None` if the tenancy check failed (caller should write the error and continue).
/// Returns `Some(json)` for the normal response.
pub async fn handle_session_children(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> Option<serde_json::Value> {
    if let Some(ref ss) = ctx.session_store {
        let session_id = request_field(request, "session_id").unwrap_or("");
        if allowed.is_some() {
            let ok = match ss.get_session(session_id).await {
                Ok(Some(s)) => match s.agent_id.as_deref() {
                    Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                    None => false,
                },
                _ => false,
            };
            if !ok {
                return None;
            }
        }
        match ss.list_children(session_id).await {
            Ok(children) => Some(serde_json::json!({"ok": true, "sessions": children})),
            Err(e) => Some(serde_json::json!({"ok": false, "error": e.to_string()})),
        }
    } else {
        Some(serde_json::json!({"ok": false, "error": "session store not available"}))
    }
}
