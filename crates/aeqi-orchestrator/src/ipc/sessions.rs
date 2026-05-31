//! Session management IPC handlers.
//!
//! Note: `session_send` stays in daemon.rs because it writes directly to the socket
//! for streaming mode.

use super::request_field;
use super::tenancy::{allowed_agent_ids, check_agent_access};
pub async fn handle_list_sessions(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    if let Some(ref ss) = ctx.session_store {
        let hint = request_field(request, "agent_id").unwrap_or("");
        let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
        if hint.is_empty() {
            let result = match allowed_agent_ids(&ctx.agent_registry, allowed).await {
                Some(agent_ids) => ss.list_sessions_for_agents(&agent_ids, limit).await,
                None => ss.list_sessions(None, limit).await,
            };
            return match result {
                Ok(sessions) => serde_json::json!({"ok": true, "sessions": sessions}),
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            };
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
        match ss.list_sessions(Some(&resolved_id), limit).await {
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
    if allowed.is_some()
        && agent_id.as_deref().is_some()
        && !check_agent_access(&ctx.agent_registry, allowed, agent_id.as_deref().unwrap()).await
    {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    if let Some(ref ss) = ctx.session_store {
        let result = if let Some(agent_id) = agent_id.as_deref() {
            ss.list_sessions(Some(agent_id), limit).await
        } else {
            match allowed_agent_ids(&ctx.agent_registry, allowed).await {
                Some(agent_ids) => ss.list_sessions_for_agents(&agent_ids, limit).await,
                None => ss.list_sessions(None, limit).await,
            }
        };
        match result {
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
            Ok(session_id) => {
                if let Some(user_id) = request_field(request, "caller_user_id") {
                    let _ = ss
                        .add_session_participant(&session_id, "user", user_id, None)
                        .await;
                }
                serde_json::json!({"ok": true, "session_id": session_id})
            }
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

    let was_running = ctx.execution_registry.cancel(session_id).await;
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

/// `list_channels_for_entity` — return all in-app, Slack-style channels owned
/// by a Company. Phase-1 of the in-aeqi Channels surface.
///
/// Channels are sessions with `session_type='channel'` and `company_id` set.
/// They are distinct from the gateway-channel rows surfaced by
/// `list_channel_sessions` (which are Telegram / WhatsApp / Slack-app
/// transport bindings, not chat surfaces).
pub async fn handle_list_channels_for_entity(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = request_field(request, "company_id").unwrap_or("");
    if company_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "company_id is required"});
    }
    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };
    match ss.list_channels_for_entity(company_id).await {
        Ok(rows) => serde_json::json!({"ok": true, "channels": rows}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// `create_channel` — create a new in-app, Slack-style channel for an entity.
///
/// Request shape:
/// ```json
/// {
///   "company_id":    "<uuid>",
///   "name":         "<channel name>",
///   "participants": [{ "kind": "user|agent|position", "id": "<id>" }]
/// }
/// ```
///
/// Returns `{ ok, session_id, name }`. The optional `participants` array
/// seeds the initial roster via `add_session_participant` (idempotent —
/// duplicate identities silently dropped). No system join messages are
/// emitted for the initial roster (the channel itself is the notification).
pub async fn handle_create_channel(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = request_field(request, "company_id").unwrap_or("");
    if company_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "company_id is required"});
    }
    let name = request_field(request, "name").unwrap_or("").trim();
    if name.is_empty() {
        return serde_json::json!({"ok": false, "error": "name is required"});
    }
    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };

    let session_id = match ss.create_entity_channel(company_id, name).await {
        Ok(id) => id,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if let Some(arr) = request.get("participants").and_then(|v| v.as_array()) {
        for entry in arr {
            let kind = entry
                .get("kind")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let id = entry
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if kind.is_empty() || id.is_empty() {
                continue;
            }
            let _ = ss
                .add_session_participant(&session_id, kind, id, None)
                .await;
        }
    }

    serde_json::json!({
        "ok": true,
        "session_id": session_id,
        "name": name,
    })
}

/// Read the participant roster for any session. Phase-1 channels surface
/// uses this; idea/role surfaces have their own dedicated handlers.
pub async fn handle_session_participants(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let session_id = request_field(request, "session_id").unwrap_or("");
    if session_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "session_id required"});
    }
    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };
    match ss.list_participants(session_id).await {
        Ok(rows) => serde_json::json!({"ok": true, "participants": rows}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_list_channel_sessions(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
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
    match ctx
        .agent_registry
        .list_channel_session_records(&resolved_id)
        .await
    {
        Ok(rows) => {
            let sessions: Vec<serde_json::Value> = rows
                .into_iter()
                .map(|record| {
                    serde_json::json!({
                        "channel_key": record.key.as_key(),
                        "session_id": record.session_id,
                        "chat_id": record.key.peer_id,
                        "peer_id": record.key.peer_id,
                        "transport": record.key.transport,
                        "agent_id": record.key.agent_id,
                        "created_at": record.created_at,
                    })
                })
                .collect();
            serde_json::json!({"ok": true, "sessions": sessions})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
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
                // Collect unique sender_ids for batch lookup.
                let sender_ids: Vec<String> = events
                    .iter()
                    .filter_map(|e| e.sender_id.clone())
                    .collect::<std::collections::HashSet<_>>()
                    .into_iter()
                    .collect();

                // Fetch sender info for all unique sender_ids.
                let mut sender_map: std::collections::HashMap<String, serde_json::Value> =
                    std::collections::HashMap::new();
                for sid in &sender_ids {
                    if let Ok(Some(sender)) = ss.get_sender(sid).await {
                        sender_map.insert(
                            sid.clone(),
                            serde_json::json!({
                                "id": sender.id,
                                "display_name": sender.display_name,
                                "transport": sender.transport,
                                "avatar_url": sender.avatar_url,
                            }),
                        );
                    }
                }

                let msgs: Vec<serde_json::Value> = events
                    .iter()
                    .map(|e| {
                        let mut obj = serde_json::json!({
                            "id": e.id,
                            "session_id": e.session_id,
                            "role": e.role,
                            "content": e.content,
                            "created_at": e.timestamp.to_rfc3339(),
                            "source": e.source,
                            "event_type": e.event_type,
                            "transport": e.transport,
                            "from_kind": e.from_kind,
                            "from_id": e.from_id,
                        });
                        if let Some(ref meta) = e.metadata {
                            obj["metadata"] = meta.clone();
                        }
                        if let Some(ref sid) = e.sender_id
                            && let Some(sender_json) = sender_map.get(sid)
                        {
                            obj["sender"] = sender_json.clone();
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
