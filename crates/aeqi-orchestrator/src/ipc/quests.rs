//! Quest/task IPC handlers.

use aeqi_core::Scope;

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
                        .unwrap_or(false),
                })
                .collect();
            let idea_ids: Vec<String> = visible.iter().filter_map(|q| q.idea_id.clone()).collect();
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
                    let idea = quest.idea_id.as_deref().and_then(|id| ideas.get(id));
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

    let agent = match agent {
        Some(a) => a,
        None => return serde_json::json!({"ok": false, "error": "no agent found for project"}),
    };

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
    let scope_for_quest = requested_scope.unwrap_or(aeqi_core::Scope::SelfScope);

    // ── Resolve / mint the linked idea (Flow A vs B vs legacy) ─────────
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
                .unwrap_or_else(|| agent.id.clone());
            match store
                .store_with_scope(name, content, &tags, Some(owner.as_str()), idea_scope)
                .await
            {
                Ok(id) if !id.is_empty() => Some(id),
                Ok(_) => {
                    // Within-24h dedup short-circuit returned an empty id;
                    // resolve the active row by (agent_id, name) to keep the
                    // quest pointed at a real idea. Last resort: error.
                    match store
                        .get_active_id_by_name(name, Some(owner.as_str()))
                        .await
                    {
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

    // Pick the create path. With `linked_idea_id` resolved (Flow A/B) we
    // skip the in-method mint that `create_task_v2_scoped` would otherwise
    // do, keeping the quest pointed at the exact idea row the IPC layer
    // resolved. Flow C (legacy) still hits the older path so the in-method
    // mint covers callers that haven't been migrated yet.
    let create_result = if let Some(ref iid) = linked_idea_id {
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
    };

    match create_result {
        Ok(quest) => {
            // Acceptance criteria has folded into the linked idea body in
            // phase 3 — append it as a `## Acceptance` section if the
            // request supplied one separately. Idea reference updates flow
            // through the idea API, not the quest, so this is the same
            // path the legacy preset-with-acceptance flow takes today.
            if let (Some(ac), Some(id), Some(store)) = (
                acceptance_criteria.as_ref(),
                quest.idea_id.as_ref(),
                ctx.idea_store.as_ref(),
            ) && let Ok(mut ideas) = store.get_by_ids(std::slice::from_ref(id)).await
                && let Some(existing) = ideas.pop()
            {
                let mut content = existing.content.trim_end().to_string();
                if !content.is_empty() {
                    content.push_str("\n\n");
                }
                content.push_str("## Acceptance\n");
                content.push_str(ac);
                let _ = store.update(id, None, Some(&content), None).await;
            }

            // Fetch the linked idea body so the response can carry it
            // inline (UI routes to the new quest without a follow-up GET).
            let inline_idea = match (&quest.idea_id, ctx.idea_store.as_ref()) {
                (Some(id), Some(store)) => store
                    .get_by_ids(std::slice::from_ref(id))
                    .await
                    .ok()
                    .and_then(|mut v| v.pop()),
                _ => None,
            };

            let subject_for_log = inline_idea
                .as_ref()
                .map(|i| i.name.as_str())
                .unwrap_or(subject);
            let _ = ctx
                .activity_log
                .emit(
                    "quest_created",
                    Some(&agent.id),
                    agent.session_id.as_deref(),
                    Some(&quest.id.0),
                    &serde_json::json!({
                        "subject": subject_for_log,
                        "project": project,
                        "creator_session_id": agent.session_id,
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
        Ok(Some(quest)) => {
            // Embed the linked idea so the UI can render `<IdeaCanvas>`
            // without a follow-up fetch. Also surface a sibling-quest count
            // so the front-end can show the "Shared spec · N quests" badge
            // without needing its own RPC.
            let (inline_idea, sibling_quests) = match (&quest.idea_id, ctx.idea_store.as_ref()) {
                (Some(idea_id), Some(store)) => {
                    let idea = store
                        .get_by_ids(std::slice::from_ref(idea_id))
                        .await
                        .ok()
                        .and_then(|mut v| v.pop());
                    let siblings = ctx
                        .agent_registry
                        .find_quests_by_idea_id(idea_id)
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
                    "project": quest.agent_id.as_deref().unwrap_or(""),
                    "created_at": quest.created_at.to_rfc3339(),
                    "updated_at": quest.updated_at.map(|t| t.to_rfc3339()),
                    "closed_at": quest.closed_at.map(|t| t.to_rfc3339()),
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
        })
        .await
    {
        Ok(quest) => {
            // Editorial fields live on the linked idea — fetch it lazily
            // for the response so the UI can refresh without a 2nd RPC.
            let idea = match (&quest.idea_id, ctx.idea_store.as_ref()) {
                (Some(id), Some(store)) => store
                    .get_by_ids(std::slice::from_ref(id))
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
                },
                "idea": idea.as_ref().map(idea_to_json),
            })
        }
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
                None => false,
            },
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    // Fetch quest before closing to get worktree info.
    let quest_before = ctx.agent_registry.get_task(quest_id).await.ok().flatten();
    let worktree_path = quest_before.as_ref().and_then(|q| q.worktree_path.clone());
    let worktree_branch = quest_before
        .as_ref()
        .and_then(|q| q.worktree_branch.clone());

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
            // Clear worktree fields after finalization.
            if merge_result.is_some() {
                quest.worktree_path = None;
                quest.worktree_branch = None;
            }
        })
        .await
    {
        Ok(quest) => {
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
                None => false,
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
            idea_id: Some(format!("idea-{id}")),
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
            outcome: None,
            worktree_branch: None,
            worktree_path: None,
            creator_session_id: None,
        }
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
}
