//! Quest/task IPC handlers.

use super::tenancy::{check_agent_access, is_allowed};
pub async fn handle_quests(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project_filter = request.get("project").and_then(|v| v.as_str());
    let status_filter = request.get("status").and_then(|v| v.as_str());
    let agent_filter = request.get("agent_id").and_then(|v| v.as_str());
    let resolved_agent = if agent_filter.is_some() {
        agent_filter.map(|s| s.to_string())
    } else if let Some(proj) = project_filter {
        ctx.agent_registry
            .resolve_by_hint(proj)
            .await
            .ok()
            .flatten()
            .map(|a| a.id)
    } else {
        None
    };
    match ctx
        .agent_registry
        .list_tasks(status_filter, resolved_agent.as_deref())
        .await
    {
        Ok(quests) => {
            let allowed_agent_ids: Option<std::collections::HashSet<String>> = if allowed.is_some()
            {
                let all_agents = ctx
                    .agent_registry
                    .list(None, None)
                    .await
                    .unwrap_or_default();
                let company_ids: std::collections::HashSet<String> = all_agents
                    .iter()
                    .filter(|a| a.parent_id.is_none() && is_allowed(allowed, &a.name))
                    .map(|a| a.id.clone())
                    .collect();
                Some(
                    all_agents
                        .iter()
                        .filter(|a| {
                            company_ids.contains(&a.id)
                                || a.parent_id
                                    .as_ref()
                                    .map(|p| company_ids.contains(p))
                                    .unwrap_or(false)
                        })
                        .map(|a| a.id.clone())
                        .collect(),
                )
            } else {
                None
            };

            let all_quests: Vec<serde_json::Value> = quests
                .iter()
                .filter(|quest| match &allowed_agent_ids {
                    None => true,
                    Some(ids) => quest
                        .agent_id
                        .as_deref()
                        .map(|a| ids.contains(a))
                        .unwrap_or(false),
                })
                .map(|quest| {
                    serde_json::json!({
                        "id": quest.id.0,
                        "subject": quest.name,
                        "description": quest.description,
                        "status": quest.status.to_string(),
                        "priority": quest.priority.to_string(),
                        "agent_id": quest.agent_id,
                        "idea_ids": quest.idea_ids,
                        "labels": quest.labels,
                        "retry_count": quest.retry_count,
                        "project": quest.agent_id.as_deref().unwrap_or(""),
                        "created_at": quest.created_at.to_rfc3339(),
                        "updated_at": quest.updated_at.map(|t| t.to_rfc3339()),
                        "closed_at": quest.closed_at.map(|t| t.to_rfc3339()),
                        "outcome": quest.quest_outcome(),
                        "runtime": quest.runtime(),
                    })
                })
                .collect();
            serde_json::json!({"ok": true, "quests": all_quests, "partial": false})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_create_quest(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let subject = request
        .get("subject")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let description = request
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let explicit_agent_id = request.get("agent_id").and_then(|v| v.as_str());
    let agent_name_hint = request.get("agent").and_then(|v| v.as_str());
    let depends_on: Vec<aeqi_quests::QuestId> = request
        .get("depends_on")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| aeqi_quests::QuestId(s.to_string())))
                .collect()
        })
        .unwrap_or_default();
    let parent_id = request.get("parent").and_then(|v| v.as_str());

    if project.is_empty() || subject.is_empty() {
        return serde_json::json!({"ok": false, "error": "project and subject are required"});
    }

    // Atomic claim check.
    let claim_conflict = if subject.starts_with("claim:") {
        ctx.agent_registry
            .find_open_task_by_subject(subject)
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    if let Some(existing_quest) = claim_conflict {
        let claimer = existing_quest.agent_id.as_deref().unwrap_or("unknown");
        return serde_json::json!({
            "ok": false,
            "error": format!("Resource claimed by {claimer}"),
            "existing_quest_id": existing_quest.id.0,
        });
    }

    let agent = if let Some(aid) = explicit_agent_id {
        ctx.agent_registry.resolve_by_hint(aid).await.ok().flatten()
    } else if let Some(name) = agent_name_hint {
        ctx.agent_registry
            .resolve_by_hint(name)
            .await
            .ok()
            .flatten()
    } else {
        ctx.agent_registry
            .default_agent(Some(project))
            .await
            .ok()
            .flatten()
    };

    match agent {
        Some(agent) => {
            let idea_ids: Vec<String> = request
                .get("idea_ids")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let labels: Vec<String> = request
                .get("labels")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            match ctx
                .agent_registry
                .create_task_v2(
                    &agent.id,
                    subject,
                    description,
                    &idea_ids,
                    &labels,
                    &depends_on,
                    parent_id,
                )
                .await
            {
                Ok(quest) => {
                    let _ = ctx
                        .activity_log
                        .emit(
                            "quest_created",
                            Some(&agent.id),
                            agent.session_id.as_deref(),
                            Some(&quest.id.0),
                            &serde_json::json!({
                                "subject": quest.name,
                                "project": project,
                                "creator_session_id": agent.session_id,
                                "parent": parent_id,
                                "depends_on": depends_on.iter().map(|d| &d.0).collect::<Vec<_>>(),
                            }),
                        )
                        .await;
                    serde_json::json!({
                        "ok": true,
                        "quest": {
                            "id": quest.id.0,
                            "subject": quest.name,
                            "status": quest.status.to_string(),
                            "agent_id": quest.agent_id,
                            "project": project,
                        }
                    })
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
        None => serde_json::json!({"ok": false, "error": "no agent found for project"}),
    }
}

pub async fn handle_get_quest(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let quest_id = request
        .get("id")
        .or_else(|| request.get("quest_id"))
        .or_else(|| request.get("task_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if quest_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    if allowed.is_some() {
        let ok = match ctx.agent_registry.get_task(quest_id).await {
            Ok(Some(q)) => match q.agent_id.as_deref() {
                Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                None => false,
            },
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    match ctx.agent_registry.get_task(quest_id).await {
        Ok(Some(quest)) => serde_json::json!({
            "ok": true,
            "quest": {
                "id": quest.id.0,
                "subject": quest.name,
                "description": quest.description,
                "status": quest.status.to_string(),
                "priority": quest.priority.to_string(),
                "agent_id": quest.agent_id,
                "idea_ids": quest.idea_ids,
                "labels": quest.labels,
                "retry_count": quest.retry_count,
                "project": quest.agent_id.as_deref().unwrap_or(""),
                "created_at": quest.created_at.to_rfc3339(),
                "updated_at": quest.updated_at.map(|t| t.to_rfc3339()),
                "closed_at": quest.closed_at.map(|t| t.to_rfc3339()),
                "outcome": quest.quest_outcome(),
                "runtime": quest.runtime(),
                "depends_on": quest.depends_on.iter().map(|d| &d.0).collect::<Vec<_>>(),
                "acceptance_criteria": quest.acceptance_criteria,
            }
        }),
        Ok(None) => serde_json::json!({"ok": false, "error": "quest not found"}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_update_quest(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let quest_id = request
        .get("id")
        .or_else(|| request.get("quest_id"))
        .or_else(|| request.get("task_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if quest_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    if allowed.is_some() {
        let ok = match ctx.agent_registry.get_task(quest_id).await {
            Ok(Some(q)) => match q.agent_id.as_deref() {
                Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                None => false,
            },
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    let status_str = request.get("status").and_then(|v| v.as_str());
    let priority_str = request.get("priority").and_then(|v| v.as_str());
    let description = request.get("description").and_then(|v| v.as_str());
    let agent_id = request.get("agent_id").and_then(|v| v.as_str());
    let labels: Option<Vec<String>> = request
        .get("labels")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        });

    let status = status_str.map(|s| match s {
        "in_progress" => aeqi_quests::QuestStatus::InProgress,
        "done" => aeqi_quests::QuestStatus::Done,
        "blocked" => aeqi_quests::QuestStatus::Blocked,
        "cancelled" => aeqi_quests::QuestStatus::Cancelled,
        _ => aeqi_quests::QuestStatus::Pending,
    });

    let priority = priority_str.map(|s| match s {
        "low" => aeqi_quests::Priority::Low,
        "high" => aeqi_quests::Priority::High,
        "critical" => aeqi_quests::Priority::Critical,
        _ => aeqi_quests::Priority::Normal,
    });

    match ctx
        .agent_registry
        .update_task(quest_id, |quest| {
            if let Some(status) = status {
                quest.status = status;
                if matches!(
                    quest.status,
                    aeqi_quests::QuestStatus::Done | aeqi_quests::QuestStatus::Cancelled
                ) {
                    quest.closed_at = Some(chrono::Utc::now());
                }
            }
            if let Some(priority) = priority {
                quest.priority = priority;
            }
            if let Some(description) = description {
                quest.description = description.to_string();
            }
            if let Some(agent_id) = agent_id {
                quest.agent_id = Some(agent_id.to_string());
            }
            if let Some(ref labels) = labels {
                quest.labels = labels.clone();
            }
        })
        .await
    {
        Ok(quest) => serde_json::json!({
            "ok": true,
            "quest": {
                "id": quest.id.0,
                "subject": quest.name,
                "description": quest.description,
                "status": quest.status.to_string(),
                "priority": quest.priority.to_string(),
                "agent_id": quest.agent_id,
                "labels": quest.labels,
            }
        }),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_close_quest(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let quest_id = request
        .get("quest_id")
        .or_else(|| request.get("task_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let reason = request
        .get("reason")
        .and_then(|v| v.as_str())
        .unwrap_or("closed via web");

    if quest_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "quest_id is required"});
    }

    if allowed.is_some() {
        let ok = match ctx.agent_registry.get_task(quest_id).await {
            Ok(Some(q)) => match q.agent_id.as_deref() {
                Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                None => false,
            },
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    match ctx
        .agent_registry
        .update_task(quest_id, |quest| {
            quest.status = aeqi_quests::QuestStatus::Done;
            quest.closed_at = Some(chrono::Utc::now());
            quest.set_quest_outcome(&aeqi_quests::QuestOutcomeRecord::new(
                aeqi_quests::QuestOutcomeKind::Done,
                reason,
            ));
        })
        .await
    {
        Ok(quest) => serde_json::json!({
            "ok": true,
            "quest": {
                "id": quest.id.0,
                "status": quest.status.to_string(),
                "outcome": quest.quest_outcome(),
                "runtime": quest.runtime(),
            }
        }),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
