//! Quest/task IPC handlers.

use aeqi_core::Scope;

use crate::quest_assignee::{
    QuestCallerPrincipal, auto_assignee_for_status, caller_principal_from_request,
    validate_assignee_update,
};

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
                // Tenancy maps to entity, not parent_id. An agent is in
                // scope iff its entity_id (or own name/id) hits the allowed list.
                Some(
                    all_agents
                        .iter()
                        .filter(|a| {
                            a.entity_id
                                .as_deref()
                                .map(|eid| is_allowed(allowed, eid))
                                .unwrap_or(false)
                                || is_allowed(allowed, &a.name)
                                || is_allowed(allowed, &a.id)
                        })
                        .map(|a| a.id.clone())
                        .collect(),
                )
            } else {
                None
            };

            // Bulk-hydrate the linked ideas so each quest in the list can
            // surface its title/body/tags without an N+1 fetch from the UI.
            let visible: Vec<&aeqi_quests::Quest> = quests
                .iter()
                .filter(|quest| match &allowed_agent_ids {
                    None => true,
                    Some(ids) => quest
                        .agent_id
                        .as_deref()
                        .map(|a| ids.contains(a))
                        .unwrap_or(true),
                })
                .collect();
            let idea_ids: Vec<String> = visible
                .iter()
                .map(|q| q.idea_id.clone())
                .filter(|id| !id.is_empty())
                .collect();
            let ideas: std::collections::HashMap<String, aeqi_core::traits::Idea> =
                if idea_ids.is_empty() {
                    Default::default()
                } else if let Some(ref store) = ctx.idea_store {
                    store
                        .get_by_ids(&idea_ids)
                        .await
                        .unwrap_or_default()
                        .into_iter()
                        .map(|i| (i.id.clone(), i))
                        .collect()
                } else {
                    Default::default()
                };

            let all_quests: Vec<serde_json::Value> = visible
                .iter()
                .map(|quest| {
                    let idea = if quest.idea_id.is_empty() {
                        None
                    } else {
                        ideas.get(quest.idea_id.as_str())
                    };
                    serde_json::json!({
                        "id": quest.id.0,
                        "idea_id": quest.idea_id,
                        "idea": idea.map(idea_to_json),
                        "status": quest.status.to_string(),
                        "priority": quest.priority.to_string(),
                        "agent_id": quest.agent_id,
                        "assignee": quest.assignee,
                        "scope": quest.scope.as_str(),
                        "retry_count": quest.retry_count,
                        "project": quest.agent_id.as_deref().or(project_filter).unwrap_or(""),
                        "created_at": quest.created_at.to_rfc3339(),
                        "updated_at": quest.updated_at.map(|t| t.to_rfc3339()),
                        "closed_at": quest.closed_at.map(|t| t.to_rfc3339()),
                        "due_at": quest.due_at.map(|t| t.to_rfc3339()),
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

    // Two-flow body shape per docs/quest-idea-unification.md:
    //
    //   Flow A — request carries `idea: { name, content, scope?, agent_id? }`:
    //            mint the idea first, then wrap a quest around it.
    //   Flow B — request carries `idea_id: "..."`: validate it exists, then
    //            create a quest pointing at the existing idea.
    //   Flow C — neither — legacy path, kept for back-compat. Subject /
    //            description / labels arrive as scalars; the lazy backfill
    //            (WS-1c) mints an idea on the next boot.
    let idea_obj = request.get("idea").and_then(|v| v.as_object()).cloned();
    let provided_idea_id = request
        .get("idea_id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Flow A overrides subject/description from the embedded idea body so the
    // quest subject mirrors `idea.name`. The legacy fields stay populated for
    // phase-2 back-compat (UI still renders quest.subject from the row).
    let subject = idea_obj
        .as_ref()
        .and_then(|m| m.get("name").and_then(|v| v.as_str()))
        .or_else(|| request.get("subject").and_then(|v| v.as_str()))
        .unwrap_or("");
    let description = idea_obj
        .as_ref()
        .and_then(|m| m.get("content").and_then(|v| v.as_str()))
        .or_else(|| request.get("description").and_then(|v| v.as_str()))
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
    let acceptance_criteria = request
        .get("acceptance_criteria")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let requested_scope = request
        .get("scope")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Scope>().ok());

    // `subject` may be absent on Flow B (pure `idea_id` reference) — the
    // resolved idea's name covers the validation downstream. Only require
    // it on Flow A / Flow C.
    if project.is_empty() {
        return serde_json::json!({"ok": false, "error": "project is required"});
    }
    let has_idea_ref = idea_obj.is_some() || provided_idea_id.is_some();
    if !has_idea_ref && subject.is_empty() {
        return serde_json::json!({
            "ok": false,
            "error": "subject is required (or supply idea / idea_id)",
        });
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
    // ── Resolve / mint the linked idea (Flow A vs B vs legacy) ─────────
    let agent = if let Some(aid) = explicit_agent_id {
        ctx.agent_registry.resolve_by_hint(aid).await.ok().flatten()
    } else if let Some(name) = agent_name_hint {
        ctx.agent_registry
            .resolve_by_hint(name)
            .await
            .ok()
            .flatten()
    } else {
        None
    };
    let scope_for_quest = requested_scope.unwrap_or(if agent.is_some() {
        aeqi_core::Scope::SelfScope
    } else {
        aeqi_core::Scope::Global
    });

    let linked_idea_id: Option<String> = match (&provided_idea_id, &idea_obj) {
        (Some(existing_id), _) => {
            // Flow B — validate the idea exists.
            let store = match ctx.idea_store.as_ref() {
                Some(s) => s,
                None => {
                    return serde_json::json!({"ok": false, "error": "idea store not available"});
                }
            };
            match store.get_by_ids(std::slice::from_ref(existing_id)).await {
                Ok(ideas) if !ideas.is_empty() => Some(existing_id.clone()),
                Ok(_) => {
                    return serde_json::json!({
                        "ok": false,
                        "error": format!("idea_id not found: {existing_id}"),
                    });
                }
                Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
        (None, Some(idea_map)) => {
            // Flow A — mint a fresh idea from the embedded body.
            let store = match ctx.idea_store.as_ref() {
                Some(s) => s,
                None => {
                    return serde_json::json!({"ok": false, "error": "idea store not available"});
                }
            };
            let name = idea_map.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let content = idea_map
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if name.trim().is_empty() {
                return serde_json::json!({
                    "ok": false,
                    "error": "idea.name is required when minting a new idea",
                });
            }
            let tags: Vec<String> = idea_map
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let idea_scope = idea_map
                .get("scope")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<Scope>().ok())
                .unwrap_or(scope_for_quest);
            let owner = idea_map
                .get("agent_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| agent.as_ref().map(|agent| agent.id.clone()));
            match store
                .store_with_scope(name, content, &tags, owner.as_deref(), idea_scope)
                .await
            {
                Ok(id) if !id.is_empty() => Some(id),
                Ok(_) => {
                    // Within-24h dedup short-circuit returned an empty id;
                    // resolve the active row by (agent_id, name) to keep the
                    // quest pointed at a real idea. Last resort: error.
                    match store.get_active_id_by_name(name, owner.as_deref()).await {
                        Ok(Some(id)) => Some(id),
                        Ok(None) => {
                            return serde_json::json!({
                                "ok": false,
                                "error": "idea minting was deduped but no active row resolved",
                            });
                        }
                        Err(e) => {
                            return serde_json::json!({"ok": false, "error": e.to_string()});
                        }
                    }
                }
                Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
        (None, None) => None, // Legacy path — backfill mints later.
    };

    // Pick the create path. Explicit agent targets create agent-scoped quests.
    // User-principal MCP calls without `agent` / `agent_id` create unbound
    // global quests inside this tenant runtime instead of silently assigning
    // work to the project/root agent.
    let create_result = if let Some(agent) = agent.as_ref() {
        if let Some(ref iid) = linked_idea_id {
            ctx.agent_registry
                .create_task_with_idea_id(&agent.id, iid, &depends_on, parent_id, scope_for_quest)
                .await
        } else {
            ctx.agent_registry
                .create_task_v2_scoped(
                    &agent.id,
                    subject,
                    description,
                    &idea_ids,
                    &labels,
                    &depends_on,
                    parent_id,
                    scope_for_quest,
                )
                .await
        }
    } else {
        ctx.agent_registry
            .create_unbound_task_scoped(
                project,
                subject,
                description,
                &labels,
                linked_idea_id.as_deref(),
                &depends_on,
                parent_id,
            )
            .await
    };

    match create_result {
        Ok(quest) => {
            // Acceptance criteria has folded into the linked idea body in
            // phase 3 — append it as a `## Acceptance` section if the
            // request supplied one separately. Idea reference updates flow
            // through the idea API, not the quest, so this is the same
            // path the legacy preset-with-acceptance flow takes today.
            if let (Some(ac), Some(store)) = (acceptance_criteria.as_ref(), ctx.idea_store.as_ref())
                && !quest.idea_id.is_empty()
                && let Ok(mut ideas) = store.get_by_ids(std::slice::from_ref(&quest.idea_id)).await
                && let Some(existing) = ideas.pop()
            {
                let mut content = existing.content.trim_end().to_string();
                if !content.is_empty() {
                    content.push_str("\n\n");
                }
                content.push_str("## Acceptance\n");
                content.push_str(ac);
                let _ = store
                    .update(&quest.idea_id, None, Some(&content), None)
                    .await;
            }

            // Fetch the linked idea body so the response can carry it
            // inline (UI routes to the new quest without a follow-up GET).
            let inline_idea = match ctx.idea_store.as_ref() {
                Some(store) if !quest.idea_id.is_empty() => store
                    .get_by_ids(std::slice::from_ref(&quest.idea_id))
                    .await
                    .ok()
                    .and_then(|mut v| v.pop()),
                _ => None,
            };

            let subject_for_log = inline_idea
                .as_ref()
                .map(|i| i.name.as_str())
                .unwrap_or(subject);
            let agent_log_id = agent.as_ref().map(|a| a.id.as_str());
            let agent_session_id = agent.as_ref().and_then(|a| a.session_id.as_deref());
            let _ = ctx
                .activity_log
                .emit(
                    "quest_created",
                    agent_log_id,
                    agent_session_id,
                    Some(&quest.id.0),
                    &serde_json::json!({
                        "subject": subject_for_log,
                        "project": project,
                        "creator_session_id": agent_session_id,
                        "parent": parent_id,
                        "depends_on": depends_on.iter().map(|d| &d.0).collect::<Vec<_>>(),
                        "idea_id": quest.idea_id,
                    }),
                )
                .await;
            serde_json::json!({
                "ok": true,
                "quest": {
                    "id": quest.id.0,
                    "idea_id": quest.idea_id,
                    "status": quest.status.to_string(),
                    "agent_id": quest.agent_id,
                    "assignee": quest.assignee,
                    "scope": quest.scope.as_str(),
                    "project": project,
                },
                "idea": inline_idea.as_ref().map(idea_to_json),
            })
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Compact JSON form of an `Idea` used in `GET /quests/:id` and
/// `POST /quests` responses. Mirrors the ideas-list/detail payloads: the
/// frontend can render the same `<IdeaCanvas>` from this shape.
fn idea_to_json(idea: &aeqi_core::traits::Idea) -> serde_json::Value {
    serde_json::json!({
        "id": idea.id,
        "name": idea.name,
        "content": idea.content,
        "tags": idea.tags,
        "agent_id": idea.agent_id,
        "scope": idea.scope.as_str(),
        "session_id": idea.session_id,
        "created_at": idea.created_at.to_rfc3339(),
    })
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
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if quest_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    if allowed.is_some() {
        let ok = match ctx.agent_registry.get_task(quest_id).await {
            Ok(Some(q)) => match q.agent_id.as_deref() {
                Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                None => true,
            },
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    match ctx.agent_registry.get_task(quest_id).await {
        Ok(Some(quest)) => {
            // Embed the linked idea so the UI can render `<IdeaCanvas>`
            // without a follow-up fetch. Also surface a sibling-quest count
            // so the front-end can show the "Shared spec · N quests" badge
            // without needing its own RPC.
            let (inline_idea, sibling_quests) = match ctx.idea_store.as_ref() {
                Some(store) if !quest.idea_id.is_empty() => {
                    let idea = store
                        .get_by_ids(std::slice::from_ref(&quest.idea_id))
                        .await
                        .ok()
                        .and_then(|mut v| v.pop());
                    let siblings = ctx
                        .agent_registry
                        .find_quests_by_idea_id(&quest.idea_id)
                        .await
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|qid| qid != &quest.id.0)
                        .collect::<Vec<_>>();
                    (idea, siblings)
                }
                _ => (None, Vec::new()),
            };

            serde_json::json!({
                "ok": true,
                "quest": {
                    "id": quest.id.0,
                    "idea_id": quest.idea_id,
                    "status": quest.status.to_string(),
                    "priority": quest.priority.to_string(),
                    "agent_id": quest.agent_id,
                    "assignee": quest.assignee,
                    "scope": quest.scope.as_str(),
                    "retry_count": quest.retry_count,
                    "project": quest.agent_id.as_deref().unwrap_or(project),
                    "created_at": quest.created_at.to_rfc3339(),
                    "updated_at": quest.updated_at.map(|t| t.to_rfc3339()),
                    "closed_at": quest.closed_at.map(|t| t.to_rfc3339()),
                    "due_at": quest.due_at.map(|t| t.to_rfc3339()),
                    "outcome": quest.quest_outcome(),
                    "runtime": quest.runtime(),
                    "depends_on": quest.depends_on.iter().map(|d| &d.0).collect::<Vec<_>>(),
                    "sibling_quest_ids": sibling_quests,
                },
                "idea": inline_idea.as_ref().map(idea_to_json),
            })
        }
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

    let previous = match ctx.agent_registry.get_task(quest_id).await {
        Ok(Some(q)) => q,
        Ok(None) => return serde_json::json!({"ok": false, "error": "quest not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if allowed.is_some() {
        let ok = match previous.agent_id.as_deref() {
            Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
            None => true,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    let status_str = request.get("status").and_then(|v| v.as_str());
    let priority_str = request.get("priority").and_then(|v| v.as_str());
    let agent_id = request.get("agent_id").and_then(|v| v.as_str());
    let scope = request
        .get("scope")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Scope>().ok());

    // `assignee` is polymorphic: `agent:<id>` | `user:<id>` | null.
    // The request can pass an explicit JSON `null` to unassign, or omit
    // the key entirely to leave the field untouched. We model both with
    // `Option<Option<String>>` — outer Some means "field present in
    // payload", inner None means "explicit null = unassign".
    let assignee_update: Option<Option<String>> = match request.get("assignee") {
        None => None,
        Some(serde_json::Value::Null) => Some(None),
        Some(serde_json::Value::String(s)) if s.is_empty() => Some(None),
        Some(serde_json::Value::String(s)) => Some(Some(s.clone())),
        _ => {
            return serde_json::json!({
                "ok": false,
                "error": "Invalid assignee. Use 'user:<uuid>', 'agent:<uuid>', empty string, or null."
            });
        }
    };

    // `due_at` mirrors the assignee three-state pattern: absent → leave
    // alone, JSON null → clear, RFC3339 string OR unix-second number →
    // set. Accept both wire shapes so the UI can stay flexible (the
    // current frontend sends RFC3339 from `Date.toISOString()`).
    let due_at_update: Option<Option<chrono::DateTime<chrono::Utc>>> = match request.get("due_at") {
        None => None,
        Some(serde_json::Value::Null) => Some(None),
        Some(serde_json::Value::String(s)) if s.is_empty() => Some(None),
        Some(serde_json::Value::String(s)) => chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| Some(Some(d.with_timezone(&chrono::Utc))))
            .unwrap_or(None),
        Some(serde_json::Value::Number(n)) => n
            .as_i64()
            .and_then(|secs| chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0))
            .map(|d| Some(Some(d)))
            .unwrap_or(None),
        _ => None,
    };

    // Phase-2 allowlist: editorial fields (subject / description / labels /
    // acceptance_criteria) belong to the linked idea now. Old clients still
    // send them — warn-and-drop rather than reject so phase-2 rollouts don't
    // break the legacy UI mid-deploy. The warn fires once per request so a
    // misbehaving caller is loud in the log without spamming.
    for legacy_field in [
        "subject",
        "description",
        "labels",
        "acceptance_criteria",
        "idea_ids",
    ] {
        if request.get(legacy_field).is_some() {
            tracing::warn!(
                field = legacy_field,
                quest = quest_id,
                "PUT /quests dropped legacy editorial field — edit the linked idea instead"
            );
        }
    }

    let status = status_str.map(|s| match s {
        "backlog" => aeqi_quests::QuestStatus::Backlog,
        "todo" => aeqi_quests::QuestStatus::Todo,
        "in_progress" => aeqi_quests::QuestStatus::InProgress,
        "done" => aeqi_quests::QuestStatus::Done,
        "cancelled" => aeqi_quests::QuestStatus::Cancelled,
        // Legacy aliases — map old vocabulary onto the v5.2 set.
        "pending" => aeqi_quests::QuestStatus::Todo,
        "blocked" => aeqi_quests::QuestStatus::Backlog,
        _ => aeqi_quests::QuestStatus::Todo,
    });

    let priority = priority_str.map(|s| match s {
        "low" => aeqi_quests::Priority::Low,
        "high" => aeqi_quests::Priority::High,
        "critical" => aeqi_quests::Priority::Critical,
        _ => aeqi_quests::Priority::Normal,
    });

    let caller_principal = caller_principal_from_request(request);
    let assignee_update = match auto_assignee_for_status(
        status,
        previous.assignee.as_deref(),
        assignee_update,
        caller_principal.clone(),
    ) {
        Ok(update) => update,
        Err(e) => return serde_json::json!({"ok": false, "error": e}),
    };
    let assignee_update = match validate_assignee_update(&ctx.agent_registry, assignee_update).await
    {
        Ok(update) => update,
        Err(e) => return serde_json::json!({"ok": false, "error": e}),
    };

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
            if let Some(agent_id) = agent_id {
                quest.agent_id = Some(agent_id.to_string());
            }
            if let Some(scope) = scope {
                quest.scope = scope;
            }
            if let Some(next) = assignee_update {
                quest.assignee = next;
            }
            if let Some(next) = due_at_update {
                quest.due_at = next;
            }
        })
        .await
    {
        Ok(quest) => {
            let changes = quest_activity_changes(&previous, &quest);
            emit_quest_update_activity(ctx, &quest, &changes).await;
            if previous.status != aeqi_quests::QuestStatus::Done
                && quest.status == aeqi_quests::QuestStatus::Done
            {
                emit_quest_completed_activity(ctx, &quest, caller_principal, "ipc_update").await;
            }

            // Editorial fields live on the linked idea — fetch it lazily
            // for the response so the UI can refresh without a 2nd RPC.
            let idea = match ctx.idea_store.as_ref() {
                Some(store) if !quest.idea_id.is_empty() => store
                    .get_by_ids(std::slice::from_ref(&quest.idea_id))
                    .await
                    .ok()
                    .and_then(|mut v| v.pop()),
                _ => None,
            };
            serde_json::json!({
                "ok": true,
                "quest": {
                    "id": quest.id.0,
                    "idea_id": quest.idea_id,
                    "status": quest.status.to_string(),
                    "priority": quest.priority.to_string(),
                    "agent_id": quest.agent_id,
                    "assignee": quest.assignee,
                    "scope": quest.scope.as_str(),
                    "due_at": quest.due_at.map(|t| t.to_rfc3339()),
                },
                "idea": idea.as_ref().map(idea_to_json),
            })
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

fn opt_string_value(value: &Option<String>) -> serde_json::Value {
    value
        .as_ref()
        .map(|v| serde_json::Value::String(v.clone()))
        .unwrap_or(serde_json::Value::Null)
}

fn opt_datetime_value(value: &Option<chrono::DateTime<chrono::Utc>>) -> serde_json::Value {
    value
        .as_ref()
        .map(|v| serde_json::Value::String(v.to_rfc3339()))
        .unwrap_or(serde_json::Value::Null)
}

fn quest_activity_changes(
    previous: &aeqi_quests::Quest,
    next: &aeqi_quests::Quest,
) -> Vec<serde_json::Value> {
    let mut changes = Vec::new();
    if previous.status != next.status {
        changes.push(serde_json::json!({
            "field": "status",
            "from": previous.status.to_string(),
            "to": next.status.to_string(),
        }));
    }
    if previous.priority != next.priority {
        changes.push(serde_json::json!({
            "field": "priority",
            "from": previous.priority.to_string(),
            "to": next.priority.to_string(),
        }));
    }
    if previous.agent_id != next.agent_id {
        changes.push(serde_json::json!({
            "field": "agent_id",
            "from": opt_string_value(&previous.agent_id),
            "to": opt_string_value(&next.agent_id),
        }));
    }
    if previous.assignee != next.assignee {
        changes.push(serde_json::json!({
            "field": "assignee",
            "from": opt_string_value(&previous.assignee),
            "to": opt_string_value(&next.assignee),
        }));
    }
    if previous.scope != next.scope {
        changes.push(serde_json::json!({
            "field": "scope",
            "from": previous.scope.as_str(),
            "to": next.scope.as_str(),
        }));
    }
    if previous.due_at != next.due_at {
        changes.push(serde_json::json!({
            "field": "due_at",
            "from": opt_datetime_value(&previous.due_at),
            "to": opt_datetime_value(&next.due_at),
        }));
    }
    changes
}

fn display_activity_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "unset".to_string(),
        serde_json::Value::String(s) if s.is_empty() => "unset".to_string(),
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn quest_activity_summary(changes: &[serde_json::Value]) -> String {
    let parts: Vec<String> = changes
        .iter()
        .filter_map(|change| {
            let field = change.get("field")?.as_str()?;
            let from =
                display_activity_value(change.get("from").unwrap_or(&serde_json::Value::Null));
            let to = display_activity_value(change.get("to").unwrap_or(&serde_json::Value::Null));
            Some(format!("{field}: {from} -> {to}"))
        })
        .collect();
    if parts.is_empty() {
        "quest updated".to_string()
    } else {
        parts.join("; ")
    }
}

async fn emit_quest_update_activity(
    ctx: &super::CommandContext,
    quest: &aeqi_quests::Quest,
    changes: &[serde_json::Value],
) {
    if changes.is_empty() || quest.idea_id.is_empty() {
        return;
    }

    let Some(ref idea_store) = ctx.idea_store else {
        return;
    };
    let session_id =
        match super::ideas::ensure_idea_session(ctx, idea_store.as_ref(), &quest.idea_id).await {
            Ok(session_id) => session_id,
            Err(e) => {
                tracing::warn!(
                    quest = %quest.id.0,
                    idea = %quest.idea_id,
                    error = %e,
                    "emit_quest_update_activity: ensure_idea_session failed"
                );
                return;
            }
        };

    let Some(ref ss) = ctx.session_store else {
        return;
    };
    let summary = quest_activity_summary(changes);
    let metadata = serde_json::json!({
        "kind": "quest_updated",
        "quest_id": quest.id.0,
        "idea_id": quest.idea_id,
        "changes": changes,
        "actor_kind": "system",
    });
    if let Err(e) = ss
        .append_system_activity(&session_id, &summary, &metadata)
        .await
    {
        tracing::warn!(
            quest = %quest.id.0,
            idea = %quest.idea_id,
            error = %e,
            "emit_quest_update_activity: append_system_activity failed"
        );
    }
}

async fn emit_quest_completed_activity(
    ctx: &super::CommandContext,
    quest: &aeqi_quests::Quest,
    caller: Option<QuestCallerPrincipal>,
    source: &str,
) {
    let (caller_kind, caller_id, caller_agent_id) = match caller {
        Some(QuestCallerPrincipal::User(id)) => ("user", Some(id), None),
        Some(QuestCallerPrincipal::Agent(id)) => ("agent", Some(id.clone()), Some(id)),
        None => ("unknown", None, None),
    };
    let agent_id = caller_agent_id.or_else(|| quest.agent_id.clone());
    let content = serde_json::json!({
        "source": source,
        "outcome": "done",
        "assignee": quest.assignee.clone(),
        "caller_kind": caller_kind,
        "caller_id": caller_id,
    });

    if let Err(e) = ctx
        .activity_log
        .emit(
            "quest_completed",
            agent_id.as_deref(),
            None,
            Some(&quest.id.0),
            &content,
        )
        .await
    {
        tracing::warn!(
            quest = %quest.id.0,
            error = %e,
            "emit_quest_completed_activity failed"
        );
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
    // "merge" (default), "commit" (keep branch), "discard" (throw away changes)
    let finalize = request
        .get("finalize")
        .and_then(|v| v.as_str())
        .unwrap_or("merge");

    if quest_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "quest_id is required"});
    }

    if allowed.is_some() {
        let ok = match ctx.agent_registry.get_task(quest_id).await {
            Ok(Some(q)) => match q.agent_id.as_deref() {
                Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                None => true,
            },
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    // Fetch quest before closing to get worktree info and ownership state.
    let quest_before = match ctx.agent_registry.get_task(quest_id).await {
        Ok(Some(q)) => q,
        Ok(None) => return serde_json::json!({"ok": false, "error": "quest not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    let caller_principal = caller_principal_from_request(request);
    let assignee_update = match auto_assignee_for_status(
        Some(aeqi_quests::QuestStatus::Done),
        quest_before.assignee.as_deref(),
        None,
        caller_principal.clone(),
    ) {
        Ok(update) => update,
        Err(e) => return serde_json::json!({"ok": false, "error": e}),
    };
    let assignee_update = match validate_assignee_update(&ctx.agent_registry, assignee_update).await
    {
        Ok(update) => update,
        Err(e) => return serde_json::json!({"ok": false, "error": e}),
    };
    let was_done = quest_before.status == aeqi_quests::QuestStatus::Done;
    let worktree_path = quest_before.worktree_path.clone();
    let worktree_branch = quest_before.worktree_branch.clone();

    // Finalize worktree if quest has one.
    let mut merge_result: Option<serde_json::Value> = None;
    if let (Some(wt_path), Some(_branch)) = (&worktree_path, &worktree_branch) {
        let wt = std::path::Path::new(wt_path);
        if wt.exists() {
            // Resolve repo root from the worktree.
            let repo_root_output = tokio::process::Command::new("git")
                .args(["rev-parse", "--show-toplevel"])
                .current_dir(wt)
                .output()
                .await;
            let repo_root = repo_root_output
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
                .unwrap_or_default();

            if !repo_root.is_empty() {
                let sandbox = crate::sandbox::QuestSandbox::open_existing(
                    quest_id,
                    wt.to_path_buf(),
                    std::path::PathBuf::from(&repo_root),
                    false,
                );

                if let Ok(sb) = sandbox {
                    // Extract diff before finalizing.
                    let diff = sb.extract_diff().await.ok();

                    let action = match finalize {
                        "commit" => crate::sandbox::FinalizeAction::CommitOnly {
                            message: format!("quest {quest_id}: {reason}"),
                        },
                        "discard" => crate::sandbox::FinalizeAction::Discard,
                        _ => crate::sandbox::FinalizeAction::CommitAndMerge {
                            message: format!("quest {quest_id}: {reason}"),
                            target_branch: "main".to_string(),
                        },
                    };

                    match sb.finalize(action).await {
                        Ok(commit_hash) => {
                            merge_result = Some(serde_json::json!({
                                "finalized": finalize,
                                "commit": commit_hash,
                                "diff": diff.as_ref().map(|d| serde_json::json!({
                                    "files_changed": d.files_changed,
                                    "insertions": d.insertions,
                                    "deletions": d.deletions,
                                })),
                            }));
                        }
                        Err(e) => {
                            merge_result = Some(serde_json::json!({
                                "finalized": false,
                                "error": e.to_string(),
                            }));
                        }
                    }
                }
            }
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
            if let Some(next_assignee) = assignee_update.clone() {
                quest.assignee = next_assignee;
            }
            // Clear worktree fields after finalization.
            if merge_result.is_some() {
                quest.worktree_path = None;
                quest.worktree_branch = None;
            }
        })
        .await
    {
        Ok(quest) => {
            if !was_done {
                emit_quest_completed_activity(ctx, &quest, caller_principal, "ipc_close").await;
            }

            // Mirror to the linked GitHub issue (quest 67-218.1). Best-effort
            // — the local close is already durable; a failed mirror logs warn
            // and returns to here without touching the response shape.
            let state_reason = if matches!(quest.status, aeqi_quests::QuestStatus::Cancelled) {
                "not_planned"
            } else {
                "completed"
            };
            let comment = format!("Closed via AEQI quest {quest_id}: {reason}");
            crate::tools::quests::mirror_quest_close_to_github(&quest, &comment, state_reason)
                .await;

            // Fire `session:quest_end` through the daemon-level pattern
            // dispatcher so the seeded reflect-after-quest chain
            // (session.spawn → ideas.store_many) runs. Without this, every
            // quest closed via the web/IPC path was a dead end for the
            // reflection loop — the event was enabled in the DB but no code
            // ever called `dispatch("session:quest_end", ...)` from here.
            dispatch_quest_end_for_ipc_close(
                ctx.pattern_dispatcher.as_ref(),
                quest_id,
                reason,
                &quest,
            )
            .await;

            let mut result = serde_json::json!({
                "ok": true,
                "quest": {
                    "id": quest.id.0,
                    "status": quest.status.to_string(),
                    "scope": quest.scope.as_str(),
                    "outcome": quest.quest_outcome(),
                    "runtime": quest.runtime(),
                }
            });
            if let Some(mr) = merge_result {
                result["worktree"] = mr;
            }
            result
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Attach a GitHub issue URL to a quest (quest 67-218).
///
/// Persists to `quest.metadata.github_issue_url`. Idempotent re-attach with
/// the same URL is a no-op; a different URL overwrites the previous binding
/// and emits a `tracing::warn!`. The close-time mirror (post comment + close
/// issue) is a separate quest, 67-218.1.
pub async fn handle_attach_github_issue(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let quest_id = request
        .get("quest_id")
        .or_else(|| request.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if quest_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "quest_id is required"});
    }
    let url = request.get("url").and_then(|v| v.as_str()).unwrap_or("");
    if url.is_empty() {
        return serde_json::json!({"ok": false, "error": "url is required"});
    }

    if let Err(e) = crate::tools::quests::validate_github_issue_url(url) {
        return serde_json::json!({"ok": false, "error": e});
    }

    let existing = match ctx.agent_registry.get_task(quest_id).await {
        Ok(Some(q)) => q,
        Ok(None) => return serde_json::json!({"ok": false, "error": "quest not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if allowed.is_some() {
        let ok = match existing.agent_id.as_deref() {
            Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
            None => true,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    let prev = crate::tools::quests::quest_github_issue_url(&existing).map(|s| s.to_owned());
    match prev.as_deref() {
        Some(current) if current == url => {
            return serde_json::json!({
                "ok": true,
                "quest_id": quest_id,
                "github_issue_url": url,
                "changed": false,
            });
        }
        Some(current) => {
            tracing::warn!(
                quest_id,
                previous = current,
                new = url,
                "github_issue_url overwritten on attach (ipc)"
            );
        }
        None => {}
    }

    let url_owned = url.to_owned();
    if let Err(e) = ctx
        .agent_registry
        .update_task(quest_id, |q| {
            if !q.metadata.is_object() {
                q.metadata = serde_json::json!({});
            }
            if let Some(map) = q.metadata.as_object_mut() {
                map.insert(
                    "github_issue_url".to_string(),
                    serde_json::Value::String(url_owned.clone()),
                );
            }
        })
        .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    serde_json::json!({
        "ok": true,
        "quest_id": quest_id,
        "github_issue_url": url,
        "changed": true,
    })
}

/// Return every `tool_complete` trace captured across sessions bound to a quest.
///
/// This is the read-side of the closed learning loop (quest `lu-005`): it
/// gives callers an ordered stream of tool invocations — tool_name, args,
/// result preview, duration — that happened inside the quest's sessions.
/// A downstream pass can group the traces by `tool_name` to synthesise
/// candidate skills.
pub async fn handle_quest_traces(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let quest_id = request
        .get("id")
        .or_else(|| request.get("quest_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if quest_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    if allowed.is_some() {
        let ok = match ctx.agent_registry.get_task(quest_id).await {
            Ok(Some(q)) => match q.agent_id.as_deref() {
                Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                None => true,
            },
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    let Some(ref session_store) = ctx.session_store else {
        return serde_json::json!({
            "ok": false,
            "error": "session store not configured",
        });
    };

    match session_store.tool_traces_for_quest(quest_id).await {
        Ok(traces) => serde_json::json!({
            "ok": true,
            "quest_id": quest_id,
            "count": traces.len(),
            "traces": traces,
        }),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Assemble the system prompt that would be used when a quest starts, without
/// mutating any state. Used by `POST /api/quests/preflight` so the user can
/// inspect what context the agent will receive before committing.
pub async fn handle_quest_preflight(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
) -> serde_json::Value {
    let agent_id = match request
        .get("agent_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        Some(id) => id,
        None => return serde_json::json!({"ok": false, "error": "agent_id is required"}),
    };
    let description = request
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if description.is_empty() {
        return serde_json::json!({"ok": false, "error": "description is required"});
    }

    // Verify the agent exists.
    match ctx.agent_registry.get(agent_id).await {
        Ok(None) => {
            return serde_json::json!({"ok": false, "error": "agent not found", "code": "not_found"});
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        Ok(Some(_)) => {}
    }

    let task_idea_ids: Vec<String> = request
        .get("task_idea_ids")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // Prefer the shared store from context; fall back to a fresh one if absent.
    let fallback_store;
    let event_store: &crate::event_handler::EventHandlerStore =
        if let Some(ref ehs) = ctx.event_handler_store {
            ehs.as_ref()
        } else {
            fallback_store = crate::event_handler::EventHandlerStore::new(ctx.agent_registry.db());
            &fallback_store
        };

    let assembled = crate::idea_assembly::assemble_ideas_for_quest_start(
        &ctx.agent_registry,
        ctx.idea_store.as_ref(),
        event_store,
        agent_id,
        &task_idea_ids,
        description,
        None,
    )
    .await;

    serde_json::json!({
        "ok": true,
        "system": assembled.system,
        "tools": {
            "allow": assembled.tools.allow,
            "deny": assembled.tools.deny,
        }
    })
}

/// Fire `session:quest_end` on the daemon-level pattern dispatcher so the
/// seeded reflect-after-quest chain (`session.spawn(meta:reflector-template)`
/// → `ideas.store_many`) runs when a quest is closed via IPC/web.
///
/// Extracted from `handle_close_quest` as a free function so it can be
/// exercised without standing up the full `CommandContext`.
///
/// Mirrors `check_consolidation_threshold` in `ipc/ideas.rs`: we synthesize a
/// `event:session:quest_end:<quest_id>` session_id so the seed's
/// `{session_id}` placeholder substitutes to a non-empty value (the
/// `session.spawn` tool rejects an empty `parent_session`). The `event:`
/// prefix lets session-genealogy filters exclude IPC-originated synthetic
/// sessions cleanly. `agent_id` in the ExecutionContext stays empty — the
/// seed is global-scope, so `visibility_sql_clause` accepts the empty
/// viewer.
async fn dispatch_quest_end_for_ipc_close(
    dispatcher: Option<&std::sync::Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
    quest_id: &str,
    reason: &str,
    quest: &aeqi_quests::Quest,
) {
    let Some(dispatcher) = dispatcher else {
        tracing::warn!(
            quest_id,
            "session:quest_end not dispatched from IPC close: no pattern_dispatcher wired"
        );
        return;
    };

    let synthetic_session_id = format!("event:session:quest_end:{quest_id}");
    let trigger_args = serde_json::json!({
        "session_id": synthetic_session_id,
        "agent_id": quest.agent_id.clone().unwrap_or_default(),
        "quest_id": quest_id,
        "reason": reason,
        "outcome": quest.quest_outcome(),
        "transcript_preview": format!(
            "Quest {quest_id} ({subject}) closed via IPC: {reason}",
            subject = quest.title(),
        ),
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });
    let exec_ctx = aeqi_core::tool_registry::ExecutionContext {
        session_id: synthetic_session_id.clone(),
        ..Default::default()
    };
    let handled = dispatcher
        .dispatch("session:quest_end", &exec_ctx, &trigger_args)
        .await;
    if handled {
        tracing::info!(
            quest_id,
            synthetic_session = %synthetic_session_id,
            "session:quest_end dispatched (IPC close → reflect-after-quest)"
        );
    } else {
        tracing::debug!(
            quest_id,
            "session:quest_end dispatch returned false (no matching event configured)"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::tool_registry::{ExecutionContext, PatternDispatcher};
    use std::sync::Arc;
    use std::sync::Mutex;

    /// Recording dispatcher: captures every `dispatch` call so tests can
    /// assert which patterns fired and what trigger_args they carried.
    #[derive(Default)]
    struct RecordingDispatcher {
        calls: Mutex<Vec<(String, String, serde_json::Value)>>,
    }

    impl PatternDispatcher for RecordingDispatcher {
        fn dispatch<'a>(
            &'a self,
            pattern: &'a str,
            ctx: &'a ExecutionContext,
            trigger_args: &'a serde_json::Value,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + 'a>> {
            let pattern = pattern.to_string();
            let session_id = ctx.session_id.clone();
            let trigger_args = trigger_args.clone();
            Box::pin(async move {
                self.calls
                    .lock()
                    .unwrap()
                    .push((pattern, session_id, trigger_args));
                true
            })
        }
    }

    fn stub_quest(id: &str, agent_id: Option<&str>) -> aeqi_quests::Quest {
        aeqi_quests::Quest {
            id: aeqi_quests::QuestId(id.to_string()),
            idea_id: format!("idea-{id}"),
            idea: None,
            status: aeqi_quests::QuestStatus::Done,
            priority: Default::default(),
            agent_id: agent_id.map(str::to_string),
            assignee: None,
            scope: aeqi_core::Scope::SelfScope,
            depends_on: Vec::new(),
            retry_count: 0,
            checkpoints: Vec::new(),
            metadata: serde_json::Value::Null,
            created_at: chrono::Utc::now(),
            updated_at: Some(chrono::Utc::now()),
            closed_at: Some(chrono::Utc::now()),
            due_at: None,
            outcome: None,
            worktree_branch: None,
            worktree_path: None,
            creator_session_id: None,
        }
    }

    async fn quest_update_ctx() -> (
        crate::ipc::CommandContext,
        Arc<crate::agent_registry::AgentRegistry>,
        Arc<crate::session_store::SessionStore>,
        Arc<dyn aeqi_core::traits::IdeaStore>,
        tempfile::TempDir,
    ) {
        use crate::dispatch::{DispatchConfig, Dispatcher};
        use crate::ipc::ActivityBuffer;
        use tokio::sync::Mutex as TokioMutex;

        let dir = tempfile::tempdir().unwrap();
        let registry = Arc::new(crate::agent_registry::AgentRegistry::open(dir.path()).unwrap());
        let sessions_pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = sessions_pool.lock().await;
            crate::session_store::SessionStore::create_tables(&conn).unwrap();
        }
        let session_store = Arc::new(crate::session_store::SessionStore::new(Arc::new(
            sessions_pool,
        )));
        let idea_store: Arc<dyn aeqi_core::traits::IdeaStore> =
            Arc::new(aeqi_ideas::SqliteIdeas::open(&dir.path().join("aeqi.db"), 30.0).unwrap());
        let (embed_queue, _rx) = aeqi_ideas::embed_worker::EmbedQueue::channel(8);
        let ctx = crate::ipc::CommandContext {
            metrics: Arc::new(crate::metrics::AEQIMetrics::new()),
            activity_log: Arc::new(crate::activity_log::ActivityLog::new(
                registry.sessions_db(),
            )),
            session_store: Some(Arc::clone(&session_store)),
            event_handler_store: None,
            agent_registry: Arc::clone(&registry),
            entity_registry: Arc::new(crate::entity_registry::EntityRegistry::open(registry.db())),
            role_registry: Arc::new(crate::role_registry::RoleRegistry::open(registry.db())),
            idea_store: Some(Arc::clone(&idea_store)),
            message_router: None,
            activity_buffer: Arc::new(TokioMutex::new(ActivityBuffer::default())),
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
        (ctx, registry, session_store, idea_store, dir)
    }

    /// Regression lock: the IPC close path must fire `session:quest_end`
    /// through the wired `PatternDispatcher`. Before this fix the dispatch
    /// never happened, so the reflection loop had a `fire_count` of 0 in
    /// production despite 200+ closed quests.
    #[tokio::test]
    async fn ipc_close_dispatches_session_quest_end_via_pattern_dispatcher() {
        let recorder = Arc::new(RecordingDispatcher::default());
        let dispatcher: Arc<dyn PatternDispatcher> = recorder.clone();

        let quest = stub_quest("q-abc", Some("agent-123"));
        dispatch_quest_end_for_ipc_close(
            Some(&dispatcher),
            &quest.id.0,
            "finished by user",
            &quest,
        )
        .await;

        let calls = recorder.calls.lock().unwrap();
        assert_eq!(calls.len(), 1, "must dispatch exactly once");
        let (pattern, session_id, trigger_args) = &calls[0];
        assert_eq!(pattern, "session:quest_end");
        assert_eq!(
            session_id, "event:session:quest_end:q-abc",
            "synthetic session_id encodes the quest id so session.spawn has a non-empty parent"
        );
        assert_eq!(
            trigger_args.get("quest_id").and_then(|v| v.as_str()),
            Some("q-abc"),
        );
        assert_eq!(
            trigger_args.get("agent_id").and_then(|v| v.as_str()),
            Some("agent-123"),
        );
        assert_eq!(
            trigger_args.get("reason").and_then(|v| v.as_str()),
            Some("finished by user"),
        );
        assert!(
            trigger_args
                .get("transcript_preview")
                .and_then(|v| v.as_str())
                .is_some_and(|s| s.contains("q-abc")),
            "transcript_preview must reference the closing quest"
        );
    }

    /// When no dispatcher is wired (older daemon builds, embedded tests),
    /// the close path must degrade silently — never panic, never return an
    /// error — so the quest still closes normally.
    #[tokio::test]
    async fn ipc_close_without_dispatcher_is_a_no_op() {
        let quest = stub_quest("q-nop", None);
        // Passing `None` must not panic or hang.
        dispatch_quest_end_for_ipc_close(None, &quest.id.0, "no dispatcher wired", &quest).await;
    }

    #[tokio::test]
    async fn update_quest_emits_activity_into_linked_idea_session() {
        let (ctx, registry, session_store, idea_store, _dir) = quest_update_ctx().await;
        let agent = registry.spawn("Quest Tester", None, None).await.unwrap();
        let quest = registry
            .create_task(&agent.id, "Track lifecycle", "body", &[], &[])
            .await
            .unwrap();
        let user_id = uuid::Uuid::new_v4().to_string();
        let assignee = format!("user:{user_id}");

        let resp = handle_update_quest(
            &ctx,
            &serde_json::json!({
                "id": quest.id.0,
                "status": "in_progress",
                "assignee": assignee,
            }),
            &None,
        )
        .await;
        assert_eq!(resp["ok"], true, "update response: {resp}");

        let idea = idea_store
            .get_by_ids(std::slice::from_ref(&quest.idea_id))
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let session_id = idea
            .session_id
            .expect("quest update must lazy-create the linked idea session");
        let messages = session_store
            .system_messages_by_session(&session_id, 10)
            .await
            .unwrap();
        let activity = messages
            .iter()
            .find(|m| m.content.contains("status: todo -> in_progress"))
            .expect("quest lifecycle activity row must exist");
        assert!(
            activity
                .content
                .contains(&format!("assignee: unset -> {assignee}")),
            "activity summary should include assignee change: {:?}",
            activity.content
        );
        let metadata = activity.metadata.as_ref().expect("metadata must be set");
        assert_eq!(metadata["kind"], "quest_updated");
        assert_eq!(metadata["quest_id"], quest.id.0);
        assert_eq!(metadata["idea_id"], quest.idea_id);
        assert_eq!(metadata["changes"].as_array().unwrap().len(), 2);
    }

    #[tokio::test]
    async fn update_quest_rejects_invalid_assignee_string() {
        let (ctx, registry, _session_store, _idea_store, _dir) = quest_update_ctx().await;
        let agent = registry.spawn("Quest Tester", None, None).await.unwrap();
        let quest = registry
            .create_task(&agent.id, "Track lifecycle", "body", &[], &[])
            .await
            .unwrap();

        let resp = handle_update_quest(
            &ctx,
            &serde_json::json!({
                "id": quest.id.0,
                "assignee": "claude",
            }),
            &None,
        )
        .await;

        assert_eq!(resp["ok"], false, "update response: {resp}");
        assert!(resp["error"].as_str().unwrap().contains("Invalid assignee"));
        let stored = registry.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(stored.assignee, None);
    }

    #[tokio::test]
    async fn update_quest_rejects_unknown_agent_assignee() {
        let (ctx, registry, _session_store, _idea_store, _dir) = quest_update_ctx().await;
        let agent = registry.spawn("Quest Tester", None, None).await.unwrap();
        let quest = registry
            .create_task(&agent.id, "Track lifecycle", "body", &[], &[])
            .await
            .unwrap();
        let unknown = uuid::Uuid::new_v4();

        let resp = handle_update_quest(
            &ctx,
            &serde_json::json!({
                "id": quest.id.0,
                "assignee": format!("agent:{unknown}"),
            }),
            &None,
        )
        .await;

        assert_eq!(resp["ok"], false, "update response: {resp}");
        assert!(
            resp["error"]
                .as_str()
                .unwrap()
                .contains("Unknown assignee agent")
        );
        let stored = registry.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(stored.assignee, None);
    }

    #[tokio::test]
    async fn update_quest_auto_binds_in_progress_to_caller_user() {
        let (ctx, registry, _session_store, _idea_store, _dir) = quest_update_ctx().await;
        let agent = registry.spawn("Quest Tester", None, None).await.unwrap();
        let quest = registry
            .create_task(&agent.id, "Track lifecycle", "body", &[], &[])
            .await
            .unwrap();
        let user_id = uuid::Uuid::new_v4().to_string();
        let expected = format!("user:{user_id}");

        let resp = handle_update_quest(
            &ctx,
            &serde_json::json!({
                "id": quest.id.0,
                "status": "in_progress",
                "caller_user_id": user_id,
            }),
            &None,
        )
        .await;

        assert_eq!(resp["ok"], true, "update response: {resp}");
        assert_eq!(resp["quest"]["assignee"], expected);
        let stored = registry.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(stored.status, aeqi_quests::QuestStatus::InProgress);
        assert_eq!(stored.assignee.as_deref(), Some(expected.as_str()));
    }

    #[tokio::test]
    async fn update_quest_done_auto_binds_caller_and_emits_completed_activity() {
        let (ctx, registry, _session_store, _idea_store, _dir) = quest_update_ctx().await;
        let agent = registry.spawn("Quest Tester", None, None).await.unwrap();
        let quest = registry
            .create_task(&agent.id, "Track lifecycle", "body", &[], &[])
            .await
            .unwrap();
        let user_id = uuid::Uuid::new_v4().to_string();
        let expected = format!("user:{user_id}");

        let resp = handle_update_quest(
            &ctx,
            &serde_json::json!({
                "id": quest.id.0,
                "status": "done",
                "caller_user_id": user_id,
            }),
            &None,
        )
        .await;

        assert_eq!(resp["ok"], true, "update response: {resp}");
        assert_eq!(resp["quest"]["assignee"], expected);
        let stored = registry.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(stored.status, aeqi_quests::QuestStatus::Done);
        assert_eq!(stored.assignee.as_deref(), Some(expected.as_str()));
        assert!(stored.closed_at.is_some());

        let events = ctx
            .activity_log
            .query(
                &crate::activity_log::EventFilter {
                    event_type: Some("quest_completed".to_string()),
                    quest_id: Some(quest.id.0.clone()),
                    ..Default::default()
                },
                10,
                0,
            )
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content["source"], "ipc_update");
        assert_eq!(events[0].content["assignee"], expected);
    }

    #[tokio::test]
    async fn close_quest_auto_binds_caller_and_emits_completed_activity() {
        let (ctx, registry, _session_store, _idea_store, _dir) = quest_update_ctx().await;
        let agent = registry.spawn("Quest Tester", None, None).await.unwrap();
        let quest = registry
            .create_task(&agent.id, "Track lifecycle", "body", &[], &[])
            .await
            .unwrap();
        let user_id = uuid::Uuid::new_v4().to_string();
        let expected = format!("user:{user_id}");

        let resp = handle_close_quest(
            &ctx,
            &serde_json::json!({
                "quest_id": quest.id.0,
                "reason": "finished",
                "caller_user_id": user_id,
            }),
            &None,
        )
        .await;

        assert_eq!(resp["ok"], true, "close response: {resp}");
        let stored = registry.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(stored.status, aeqi_quests::QuestStatus::Done);
        assert_eq!(stored.assignee.as_deref(), Some(expected.as_str()));
        assert!(stored.closed_at.is_some());

        let events = ctx
            .activity_log
            .query(
                &crate::activity_log::EventFilter {
                    event_type: Some("quest_completed".to_string()),
                    quest_id: Some(quest.id.0.clone()),
                    ..Default::default()
                },
                10,
                0,
            )
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].content["source"], "ipc_close");
        assert_eq!(events[0].content["assignee"], expected);
    }
}
