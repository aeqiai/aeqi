//! Chat IPC handlers.

use super::request_field;
use super::tenancy::{check_agent_access, is_allowed};
use crate::daemon::{
    attach_chat_id, find_quest_snapshot, merge_timeline_metadata, resolve_web_chat_id,
};
use crate::message_router::{IncomingMessage, MessageSource};

pub async fn handle_chat(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let message = request
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let project_hint = request_field(request, "project");
    let channel_name = request_field(request, "channel_name");
    let sender = request
        .get("sender")
        .and_then(|v| v.as_str())
        .unwrap_or("user");

    match &ctx.message_router {
        Some(engine) => {
            let chat_id = resolve_web_chat_id(
                request.get("chat_id").and_then(|v| v.as_i64()),
                project_hint,
                channel_name,
            );

            let msg = IncomingMessage {
                message: message.to_string(),
                chat_id,
                sender: sender.to_string(),
                source: MessageSource::Web,
                project_hint: project_hint.map(|s| s.to_string()),
                channel_name: channel_name.map(|s| s.to_string()),
                agent_id: None,
            };

            if let Some(response) = engine.handle_message(&msg).await {
                attach_chat_id(response.to_json(), chat_id)
            } else {
                let response = engine.status_response(project_hint, Some(message)).await;
                engine.record_exchange(&msg, &response.context).await;
                attach_chat_id(response.to_json(), chat_id)
            }
        }
        None => serde_json::json!({"ok": false, "error": "chat engine not initialized"}),
    }
}

/// Returns `None` if the tenancy check failed (caller should write the error and continue).
/// Returns `Some(json)` for the normal response.
pub async fn handle_session_message(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> Option<serde_json::Value> {
    let message = request
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let project_hint = request_field(request, "project");
    let channel_name = request_field(request, "channel_name");
    let sender = request
        .get("sender")
        .and_then(|v| v.as_str())
        .unwrap_or("user");
    let agent_id = request_field(request, "agent_id");

    if let Some(aid) = agent_id
        && !check_agent_access(&ctx.agent_registry, allowed, aid).await
    {
        return None;
    }

    match &ctx.message_router {
        Some(engine) => {
            if message.is_empty() {
                Some(serde_json::json!({"ok": false, "error": "message is required"}))
            } else {
                let chat_id = resolve_web_chat_id(
                    request.get("chat_id").and_then(|v| v.as_i64()),
                    project_hint,
                    channel_name,
                );

                let msg = IncomingMessage {
                    message: message.to_string(),
                    chat_id,
                    sender: sender.to_string(),
                    source: MessageSource::Web,
                    project_hint: project_hint.map(|s| s.to_string()),
                    channel_name: channel_name.map(|s| s.to_string()),
                    agent_id: agent_id.map(|s| s.to_string()),
                };

                if let Some(response) = engine.handle_message(&msg).await {
                    Some(attach_chat_id(response.to_json(), chat_id))
                } else {
                    match engine.handle_message_full(&msg, None).await {
                        Ok(handle) => Some(serde_json::json!({
                            "ok": true,
                            "action": "quest_created",
                            "task_handle": handle.quest_id,
                            "chat_id": handle.chat_id,
                            "context": "Processing your message...",
                        })),
                        Err(e) => Some(serde_json::json!({
                            "ok": false,
                            "error": e.to_string(),
                        })),
                    }
                }
            }
        }
        None => Some(serde_json::json!({"ok": false, "error": "chat engine not initialized"})),
    }
}

pub async fn handle_chat_poll(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let quest_id = request
        .get("quest_id")
        .or_else(|| request.get("task_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    match &ctx.message_router {
        Some(engine) => {
            if quest_id.is_empty() {
                serde_json::json!({"ok": false, "error": "quest_id is required"})
            } else {
                match engine.poll_completion(quest_id).await {
                    Some(completion) => serde_json::json!({
                        "ok": true,
                        "completed": true,
                        "status": format!("{:?}", completion.status),
                        "text": completion.text,
                        "chat_id": completion.chat_id,
                    }),
                    None => serde_json::json!({
                        "ok": true,
                        "completed": false,
                    }),
                }
            }
        }
        None => serde_json::json!({"ok": false, "error": "chat engine not initialized"}),
    }
}

pub async fn handle_chat_history(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let chat_id = request.get("chat_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let offset = request.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let project_hint = request_field(request, "project");
    let channel_name = request_field(request, "channel_name");
    let agent_id_param = request_field(request, "agent_id").map(|s| s.to_string());

    if allowed.is_some()
        && project_hint.is_none()
        && agent_id_param.is_none()
        && channel_name.is_none()
        && chat_id == 0
    {
        return serde_json::json!({"ok": true, "messages": []});
    }

    if let Some(ref aid) = agent_id_param {
        if let Some(ref ss) = ctx.session_store {
            match ss.get_timeline_by_agent_id(aid, limit).await {
                Ok(events) => {
                    let msgs: Vec<serde_json::Value> = events
                        .iter()
                        .map(|e| {
                            let mut obj = serde_json::json!({
                                "role": e.role,
                                "content": e.content,
                                "timestamp": e.timestamp.to_rfc3339(),
                                "source": e.source,
                                "event_type": e.event_type,
                            });
                            if let Some(ref meta) = e.metadata {
                                obj["metadata"] = meta.clone();
                            }
                            obj
                        })
                        .collect();
                    return serde_json::json!({"ok": true, "messages": msgs});
                }
                Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        } else {
            return serde_json::json!({"ok": false, "error": "session store not initialized"});
        }
    }

    match &ctx.message_router {
        Some(engine) => {
            let resolved_chat_id = resolve_web_chat_id(
                if chat_id != 0 { Some(chat_id) } else { None },
                project_hint,
                channel_name,
            );
            match engine.get_history(resolved_chat_id, limit, offset).await {
                Ok(messages) => {
                    let msgs: Vec<serde_json::Value> = messages
                        .iter()
                        .map(|m| {
                            serde_json::json!({
                                "role": m.role,
                                "content": m.content,
                                "timestamp": m.timestamp.to_rfc3339(),
                                "source": m.source,
                            })
                        })
                        .collect();
                    serde_json::json!({"ok": true, "messages": msgs, "chat_id": resolved_chat_id})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
        None => serde_json::json!({"ok": false, "error": "chat engine not initialized"}),
    }
}

pub async fn handle_chat_timeline(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let chat_id = request.get("chat_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;
    let offset = request.get("offset").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let project_hint = request_field(request, "project");
    let channel_name = request_field(request, "channel_name");

    if allowed.is_some() && project_hint.is_none() && channel_name.is_none() && chat_id == 0 {
        return serde_json::json!({"ok": true, "events": []});
    }

    match &ctx.message_router {
        Some(engine) => {
            let resolved_chat_id = resolve_web_chat_id(
                if chat_id != 0 { Some(chat_id) } else { None },
                project_hint,
                channel_name,
            );
            match engine.get_timeline(resolved_chat_id, limit, offset).await {
                Ok(events) => {
                    let mut items = Vec::with_capacity(events.len());
                    for event in &events {
                        let task_snapshot = if let Some(metadata) = event.metadata.as_ref() {
                            if let Some(quest_id) = metadata
                                .get("quest_id")
                                .or_else(|| metadata.get("task_id"))
                                .and_then(|value| value.as_str())
                            {
                                find_quest_snapshot(&ctx.agent_registry, quest_id).await
                            } else {
                                None
                            }
                        } else {
                            None
                        };

                        items.push(serde_json::json!({
                            "id": event.id,
                            "chat_id": event.session_id,
                            "event_type": event.event_type,
                            "role": event.role,
                            "content": event.content,
                            "timestamp": event.timestamp.to_rfc3339(),
                            "source": event.source,
                            "metadata": merge_timeline_metadata(event.metadata.as_ref(), task_snapshot),
                        }));
                    }
                    serde_json::json!({"ok": true, "events": items, "chat_id": resolved_chat_id})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
        None => serde_json::json!({"ok": false, "error": "chat engine not initialized"}),
    }
}

pub async fn handle_chat_channels(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    match &ctx.message_router {
        Some(engine) => match engine.list_channels().await {
            Ok(channels) => {
                let channels: Vec<_> = if allowed.is_some() {
                    channels
                        .into_iter()
                        .filter(|c| is_allowed(allowed, &c.name))
                        .collect()
                } else {
                    channels
                };
                let chs: Vec<serde_json::Value> = channels
                    .iter()
                    .map(|c| {
                        serde_json::json!({
                            "chat_id": c.chat_id,
                            "channel_type": c.channel_type,
                            "name": c.name,
                            "created_at": c.created_at,
                            "last_message": c.last_message,
                            "last_message_at": c.last_message_at,
                        })
                    })
                    .collect();
                serde_json::json!({"ok": true, "channels": chs})
            }
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        },
        None => serde_json::json!({"ok": false, "error": "chat engine not initialized"}),
    }
}
