//! Notes (idea-store backed) IPC handlers.

pub async fn handle_notes(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("*");
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;

    if allowed.is_some() && (project == "*" || project.is_empty()) {
        return serde_json::json!({"ok": true, "entries": []});
    }

    if let Some(ref engine) = ctx.message_router {
        if let Some(mem) = engine.idea_store.as_ref() {
            let query_text = request
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            let search_text = if query_text.is_empty() {
                "*".to_string()
            } else {
                query_text
            };
            let q = aeqi_core::traits::IdeaQuery::new(&search_text, limit);
            match mem.search(&q).await {
                Ok(entries) => {
                    let items: Vec<serde_json::Value> = entries
                        .iter()
                        .map(|e| {
                            serde_json::json!({
                                "name": e.name,
                                "content": e.content,
                                "agent": e.agent_id.as_deref().unwrap_or("system"),
                                "project": project,
                                "tags": [],
                                "created_at": e.created_at.to_rfc3339(),
                            })
                        })
                        .collect();
                    serde_json::json!({"ok": true, "entries": items})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        } else {
            serde_json::json!({"ok": true, "entries": []})
        }
    } else {
        serde_json::json!({"ok": true, "entries": []})
    }
}

pub async fn handle_get_notes(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let name = request
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if let Some(ref engine) = ctx.message_router {
        if let Some(mem) = engine.idea_store.as_ref() {
            let q = aeqi_core::traits::IdeaQuery::new(name, 1);
            match mem.search(&q).await {
                Ok(entries) => {
                    if let Some(e) = entries.into_iter().find(|e| e.name == name) {
                        serde_json::json!({
                            "ok": true,
                            "entry": {
                                "name": e.name,
                                "content": e.content,
                                "agent": e.agent_id.as_deref().unwrap_or("system"),
                                "project": project,
                                "tags": [],
                                "created_at": e.created_at.to_rfc3339(),
                            }
                        })
                    } else {
                        serde_json::json!({"ok": true, "entry": null})
                    }
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        } else {
            serde_json::json!({"ok": true, "entry": null})
        }
    } else {
        serde_json::json!({"ok": true, "entry": null})
    }
}

pub async fn handle_claim_notes(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let resource = request
        .get("resource")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let agent = request
        .get("agent")
        .and_then(|v| v.as_str())
        .unwrap_or("worker");
    let content = request
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if resource.is_empty() || project.is_empty() {
        return serde_json::json!({"ok": false, "error": "resource and project are required"});
    }

    let claim_label = format!("claim:{resource}");
    let existing = ctx
        .agent_registry
        .list_tasks(Some("in_progress"), None)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|t| t.labels.contains(&claim_label));

    match existing {
        Some(task) => {
            let holder = task.agent_id.as_deref().unwrap_or("unknown");
            if holder == agent {
                serde_json::json!({"ok": true, "result": "renewed", "resource": resource})
            } else {
                serde_json::json!({"ok": true, "result": "held", "holder": holder, "content": task.description})
            }
        }
        None => {
            let agent_id = ctx
                .agent_registry
                .resolve_by_hint(agent)
                .await
                .ok()
                .flatten()
                .map(|a| a.name.clone())
                .unwrap_or_else(|| agent.to_string());
            match ctx
                .agent_registry
                .create_task(
                    &agent_id,
                    &format!("claim: {resource}"),
                    content,
                    &[],
                    &[claim_label],
                )
                .await
            {
                Ok(task) => {
                    let _ = ctx
                        .agent_registry
                        .update_task_status(&task.id.0, aeqi_quests::QuestStatus::InProgress)
                        .await;
                    serde_json::json!({"ok": true, "result": "acquired", "resource": resource})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
    }
}

pub async fn handle_release_notes(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let resource = request
        .get("resource")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let _agent = request
        .get("agent")
        .and_then(|v| v.as_str())
        .unwrap_or("worker");
    let _force = request
        .get("force")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let claim_label = format!("claim:{resource}");
    let existing = ctx
        .agent_registry
        .list_tasks(Some("in_progress"), None)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|t| t.labels.contains(&claim_label));

    match existing {
        Some(task) => {
            match ctx
                .agent_registry
                .update_task_status(&task.id.0, aeqi_quests::QuestStatus::Done)
                .await
            {
                Ok(()) => serde_json::json!({"ok": true, "released": true}),
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
        None => {
            serde_json::json!({"ok": true, "released": false, "reason": "not found or not owned"})
        }
    }
}

pub async fn handle_delete_notes(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let _project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let name = request
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if let Some(ref engine) = ctx.message_router {
        if let Some(mem) = engine.idea_store.as_ref() {
            let q = aeqi_core::traits::IdeaQuery::new(name, 5);
            match mem.search(&q).await {
                Ok(entries) => {
                    let mut deleted = false;
                    for e in &entries {
                        if e.name == name {
                            let _ = mem.delete(&e.id).await;
                            deleted = true;
                        }
                    }
                    serde_json::json!({"ok": true, "deleted": deleted})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        } else {
            serde_json::json!({"ok": true, "deleted": false})
        }
    } else {
        serde_json::json!({"ok": true, "deleted": false})
    }
}

pub async fn handle_check_claim(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let resource = request
        .get("resource")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let claim_label = format!("claim:{resource}");
    let existing = ctx
        .agent_registry
        .list_tasks(Some("in_progress"), None)
        .await
        .unwrap_or_default()
        .into_iter()
        .find(|t| t.labels.contains(&claim_label));
    match existing {
        Some(task) => {
            let holder = task.agent_id.as_deref().unwrap_or("unknown");
            serde_json::json!({"ok": true, "claimed": true, "agent": holder, "content": task.description})
        }
        None => serde_json::json!({"ok": true, "claimed": false}),
    }
}
