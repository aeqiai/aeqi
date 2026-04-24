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
                let root_ids: std::collections::HashSet<String> = all_agents
                    .iter()
                    .filter(|a| {
                        a.parent_id.is_none()
                            && (is_allowed(allowed, &a.name) || is_allowed(allowed, &a.id))
                    })
                    .map(|a| a.id.clone())
                    .collect();
                Some(
                    all_agents
                        .iter()
                        .filter(|a| {
                            root_ids.contains(&a.id)
                                || a.parent_id
                                    .as_ref()
                                    .map(|p| root_ids.contains(p))
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
                        "scope": quest.scope.as_str(),
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
    let acceptance_criteria = request
        .get("acceptance_criteria")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let requested_scope = request
        .get("scope")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Scope>().ok());

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
                .create_task_v2_scoped(
                    &agent.id,
                    subject,
                    description,
                    &idea_ids,
                    &labels,
                    &depends_on,
                    parent_id,
                    requested_scope.unwrap_or(aeqi_core::Scope::SelfScope),
                )
                .await
            {
                Ok(mut quest) => {
                    // Persist acceptance_criteria if supplied (e.g. from a preset).
                    if let Some(ref ac) = acceptance_criteria {
                        let quest_id = quest.id.0.clone();
                        let ac_clone = ac.clone();
                        if let Ok(updated) = ctx
                            .agent_registry
                            .update_task(&quest_id, |q| {
                                q.acceptance_criteria = Some(ac_clone);
                            })
                            .await
                        {
                            quest = updated;
                        }
                    }
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
                            "description": quest.description,
                            "status": quest.status.to_string(),
                            "agent_id": quest.agent_id,
                            "scope": quest.scope.as_str(),
                            "project": project,
                            "acceptance_criteria": quest.acceptance_criteria,
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
                "scope": quest.scope.as_str(),
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
    let scope = request
        .get("scope")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<Scope>().ok());
    let labels: Option<Vec<String>> = request.get("labels").and_then(|v| v.as_array()).map(|arr| {
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
            if let Some(scope) = scope {
                quest.scope = scope;
            }
        })
        .await
    {
        Ok(quest) => {
            serde_json::json!({
                "ok": true,
                "quest": {
                    "id": quest.id.0,
                    "subject": quest.name,
                    "description": quest.description,
                    "status": quest.status.to_string(),
                    "priority": quest.priority.to_string(),
                    "agent_id": quest.agent_id,
                    "scope": quest.scope.as_str(),
                    "labels": quest.labels,
                }
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
            subject = quest.name,
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
            name: "Unit test quest".to_string(),
            description: String::new(),
            status: aeqi_quests::QuestStatus::Done,
            priority: Default::default(),
            agent_id: agent_id.map(str::to_string),
            scope: aeqi_core::Scope::SelfScope,
            depends_on: Vec::new(),
            idea_ids: Vec::new(),
            labels: Vec::new(),
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
            acceptance_criteria: None,
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
