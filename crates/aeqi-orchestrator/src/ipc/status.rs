//! Status, readiness, metrics, and other observability IPC handlers.

use super::tenancy::is_allowed;
const ACK_RETRY_AGE_SECS: u64 = 60;

pub async fn handle_ping(
    _ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    serde_json::json!({"ok": true, "pong": true})
}

pub async fn handle_status(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project_names: Vec<String> = ctx
        .agent_registry
        .list_active()
        .await
        .map(|agents| agents.iter().map(|a| a.name.clone()).collect())
        .unwrap_or_default();
    let project_names: Vec<String> = if allowed.is_some() {
        project_names
            .into_iter()
            .filter(|n| is_allowed(allowed, n))
            .collect()
    } else {
        project_names
    };
    let worker_count = ctx.scheduler.config.max_workers;
    let dispatch_health = ctx.dispatch_es.dispatch_health(ACK_RETRY_AGE_SECS).await;
    let mail_count = dispatch_health.unread;
    let trigger_count = if let Some(ref ts) = ctx.trigger_store {
        ts.count_enabled().await.unwrap_or(0)
    } else {
        0
    };

    let spent = ctx.activity_log.daily_cost().await.unwrap_or(0.0);
    let budget = ctx.daily_budget_usd;
    let remaining = (budget - spent).max(0.0);
    let project_costs = ctx
        .activity_log
        .daily_costs_by_project()
        .await
        .unwrap_or_default();
    let project_budget_info: serde_json::Map<String, serde_json::Value> = {
        let mut all_projects: std::collections::HashSet<String> =
            ctx.project_budgets.keys().cloned().collect();
        all_projects.extend(project_costs.keys().cloned());
        all_projects
            .into_iter()
            .filter(|name| is_allowed(allowed, name))
            .map(|name| {
                let p_spent = project_costs.get(&name).copied().unwrap_or(0.0);
                let p_budget = ctx.project_budgets.get(&name).copied().unwrap_or(budget);
                let p_remaining = (p_budget - p_spent).max(0.0);
                (
                    name,
                    serde_json::json!({
                        "spent_usd": p_spent,
                        "budget_usd": p_budget,
                        "remaining_usd": p_remaining,
                    }),
                )
            })
            .collect()
    };

    let active = ctx.scheduler.active_count().await;
    let agent_counts = ctx.scheduler.agent_counts().await;
    let workers = ctx.scheduler.worker_status().await;

    serde_json::json!({
        "ok": true,
        "projects": project_names,
        "project_count": project_names.len(),
        "max_workers": worker_count,
        "triggers": trigger_count,
        "pending_mail": mail_count,
        "dispatch_health": {
            "unread": dispatch_health.unread,
            "awaiting_ack": dispatch_health.awaiting_ack,
            "retrying_delivery": dispatch_health.retrying_delivery,
            "overdue_ack": dispatch_health.overdue_ack,
            "dead_letters": dispatch_health.dead_letters,
        },
        "cost_today_usd": spent,
        "daily_budget_usd": budget,
        "budget_remaining_usd": remaining,
        "project_budgets": project_budget_info,
        "scheduler_active": true,
        "scheduler_active_workers": active,
        "scheduler_agent_counts": agent_counts,
        "scheduler_workers": workers,
    })
}

pub async fn handle_readiness(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
    readiness: &crate::daemon::ReadinessContext,
) -> serde_json::Value {
    let worker_limits: Vec<(String, u32)> = ctx
        .agent_registry
        .list_active()
        .await
        .map(|agents| {
            agents
                .iter()
                .map(|a| (a.name.clone(), ctx.scheduler.config.max_workers))
                .collect()
        })
        .unwrap_or_default();
    let dispatch_health = ctx.dispatch_es.dispatch_health(ACK_RETRY_AGE_SECS).await;
    let spent = ctx.activity_log.daily_cost().await.unwrap_or(0.0);
    let budget = ctx.daily_budget_usd;
    let remaining = (budget - spent).max(0.0);
    crate::daemon::readiness_response(
        &ctx.leader_agent_name,
        worker_limits,
        dispatch_health,
        (spent, budget, remaining),
        readiness,
    )
}

pub async fn handle_worker_progress(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let workers = ctx.scheduler.worker_status().await;
    let workers: Vec<serde_json::Value> = if allowed.is_some() {
        workers
            .into_iter()
            .filter(|w| {
                w.get("agent_name")
                    .and_then(|v| v.as_str())
                    .map(|n| is_allowed(allowed, n))
                    .unwrap_or(false)
            })
            .collect()
    } else {
        workers
    };
    serde_json::json!({"ok": true, "workers": workers})
}

pub async fn handle_worker_events(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let cursor = request.get("cursor").and_then(|v| v.as_u64());
    let snapshot = {
        let buffer: tokio::sync::MutexGuard<'_, super::ActivityBuffer> = ctx.activity_buffer.lock().await;
        buffer.read_since(cursor)
    };
    let events: Vec<crate::activity::Activity> = if allowed.is_some() {
        snapshot
            .events
            .into_iter()
            .filter(|ev| match ev {
                crate::activity::Activity::QuestStarted { project, .. } => {
                    is_allowed(allowed, project)
                }
                _ => false,
            })
            .collect()
    } else {
        snapshot.events
    };
    serde_json::json!({
        "ok": true,
        "events": events,
        "next_cursor": snapshot.next_cursor,
        "oldest_cursor": snapshot.oldest_cursor,
        "reset": snapshot.reset,
    })
}

pub async fn handle_metrics(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let text = ctx.metrics.render();
    serde_json::json!({"ok": true, "metrics": text})
}

pub async fn handle_cost(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let spent = ctx.activity_log.daily_cost().await.unwrap_or(0.0);
    let budget = ctx.daily_budget_usd;
    let remaining = (budget - spent).max(0.0);
    let report = ctx
        .activity_log
        .daily_costs_by_project()
        .await
        .unwrap_or_default();
    let report: std::collections::HashMap<String, f64> = if allowed.is_some() {
        report
            .into_iter()
            .filter(|(k, _)| is_allowed(allowed, k))
            .collect()
    } else {
        report
    };
    let project_budget_info: serde_json::Map<String, serde_json::Value> = {
        let mut all_projects: std::collections::HashSet<String> =
            ctx.project_budgets.keys().cloned().collect();
        all_projects.extend(report.keys().cloned());
        all_projects
            .into_iter()
            .filter(|name| is_allowed(allowed, name))
            .map(|name| {
                let p_spent = report.get(&name).copied().unwrap_or(0.0);
                let p_budget = ctx.project_budgets.get(&name).copied().unwrap_or(budget);
                let p_remaining = (p_budget - p_spent).max(0.0);
                (
                    name,
                    serde_json::json!({
                        "spent_usd": p_spent,
                        "budget_usd": p_budget,
                        "remaining_usd": p_remaining,
                    }),
                )
            })
            .collect()
    };
    serde_json::json!({
        "ok": true,
        "spent_today_usd": spent,
        "daily_budget_usd": budget,
        "remaining_usd": remaining,
        "per_project": report,
        "project_budgets": project_budget_info,
    })
}

pub async fn handle_audit(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let task_filter = request
        .get("quest_id")
        .or_else(|| request.get("task_id"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let last = request.get("last").and_then(|v| v.as_u64()).unwrap_or(20) as u32;
    let filter = crate::activity_log::EventFilter {
        event_type: Some("decision".to_string()),
        quest_id: task_filter,
        ..Default::default()
    };
    match ctx.activity_log.query(&filter, last, 0).await {
        Ok(events) => {
            let items: Vec<serde_json::Value> = events
                .iter()
                .filter(|e| {
                    if allowed.is_none() {
                        return true;
                    }
                    e.content
                        .get("agent")
                        .and_then(|v| v.as_str())
                        .map(|n| is_allowed(allowed, n))
                        .unwrap_or(false)
                })
                .map(|e| {
                    serde_json::json!({
                        "timestamp": e.created_at.to_rfc3339(),
                        "decision_type": e.content.get("decision_type").and_then(|v| v.as_str()).unwrap_or(""),
                        "quest_id": e.quest_id,
                        "agent": e.content.get("agent").and_then(|v| v.as_str()).unwrap_or(""),
                        "reasoning": e.content.get("reasoning").and_then(|v| v.as_str()).unwrap_or(""),
                    })
                })
                .collect();
            serde_json::json!({"ok": true, "events": items})
        }
        Err(e) => {
            serde_json::json!({"ok": false, "error": e.to_string()})
        }
    }
}

pub async fn handle_expertise(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    match ctx.activity_log.query_expertise().await {
        Ok(scores) => {
            let scores: Vec<serde_json::Value> = if allowed.is_some() {
                scores
                    .into_iter()
                    .filter(|s| {
                        s.get("agent")
                            .and_then(|v| v.as_str())
                            .map(|n| is_allowed(allowed, n))
                            .unwrap_or(false)
                    })
                    .collect()
            } else {
                scores
            };
            serde_json::json!({"ok": true, "scores": scores})
        }
        Err(e) => {
            serde_json::json!({"ok": false, "error": e.to_string()})
        }
    }
}

pub async fn handle_rate_limit(
    _ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let rl_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".aeqi")
        .join("rate_limit.json");
    match std::fs::read_to_string(&rl_path) {
        Ok(content) => match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(rl) => serde_json::json!({"ok": true, "rate_limit": rl}),
            Err(_) => serde_json::json!({"ok": true, "rate_limit": null}),
        },
        Err(_) => serde_json::json!({"ok": true, "rate_limit": null}),
    }
}

pub async fn handle_skills(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    // Use unified PromptLoader if available, otherwise fall back to ad-hoc scan.
    let loader = match ctx.prompt_loader {
        Some(ref l) => l.clone(),
        None => {
            let l = crate::prompt_loader::PromptLoader::from_cwd();
            std::sync::Arc::new(l)
        }
    };

    let entries = loader.entries_filtered(allowed).await;
    let skills: Vec<serde_json::Value> = entries
        .into_iter()
        .map(|e| {
            serde_json::json!({
                "name": e.name,
                "source": e.source,
                "kind": e.kind,
                "path": e.path.display().to_string(),
                "content": e.content,
            })
        })
        .collect();

    serde_json::json!({"ok": true, "skills": skills})
}

pub async fn handle_pipelines(
    _ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let cwd = std::env::current_dir().unwrap_or_default();
    let mut pipelines = Vec::new();
    let shared_dir = cwd.join("projects").join("shared").join("pipelines");
    if shared_dir.exists() {
        for entry in std::fs::read_dir(&shared_dir)
            .into_iter()
            .flatten()
            .flatten()
        {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "toml") {
                let name = path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                let content = std::fs::read_to_string(&path).unwrap_or_default();
                pipelines.push(serde_json::json!({
                    "name": name,
                    "content": content,
                }));
            }
        }
    }
    serde_json::json!({"ok": true, "pipelines": pipelines})
}

pub async fn handle_triggers(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    match &ctx.trigger_store {
        Some(store) => {
            let triggers = store.list_all().await.unwrap_or_default();
            let triggers: Vec<_> = if allowed.is_some() {
                triggers
                    .into_iter()
                    .filter(|t| is_allowed(allowed, &t.agent_id))
                    .collect()
            } else {
                triggers
            };
            let items: Vec<serde_json::Value> = triggers
                .iter()
                .map(|t| {
                    let mut item = serde_json::json!({
                        "id": t.id,
                        "agent_id": t.agent_id,
                        "name": t.name,
                        "type": t.trigger_type.type_str(),
                        "skill": t.skill,
                        "enabled": t.enabled,
                        "max_budget_usd": t.max_budget_usd,
                        "last_fired": t.last_fired.map(|dt| dt.to_rfc3339()),
                        "fire_count": t.fire_count,
                        "total_cost_usd": t.total_cost_usd,
                        "created_at": t.created_at.to_rfc3339(),
                    });
                    if let crate::trigger::TriggerType::Webhook {
                        public_id,
                        signing_secret,
                    } = &t.trigger_type
                    {
                        item["public_id"] = serde_json::json!(public_id);
                        item["has_signing_secret"] = serde_json::json!(signing_secret.is_some());
                    }
                    item
                })
                .collect();
            serde_json::json!({"ok": true, "triggers": items})
        }
        None => serde_json::json!({"ok": true, "triggers": []}),
    }
}

pub async fn handle_webhook_fire(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let public_id = request
        .get("public_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let signature = request
        .get("signature")
        .and_then(|v| v.as_str())
        .map(String::from);
    let body_b64 = request
        .get("body_b64")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if public_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "public_id is required"});
    }

    match &ctx.trigger_store {
        Some(store) => match store.find_by_public_id(public_id).await {
            Ok(Some(trigger)) => {
                let sig_error = if let crate::trigger::TriggerType::Webhook {
                    signing_secret: Some(secret),
                    ..
                } = &trigger.trigger_type
                {
                    let raw_body = base64::Engine::decode(
                        &base64::engine::general_purpose::STANDARD,
                        body_b64,
                    )
                    .unwrap_or_default();
                    match &signature {
                        Some(sig) => {
                            if !crate::trigger::verify_webhook_signature(secret, &raw_body, sig) {
                                Some(serde_json::json!({"ok": false, "error": "invalid signature"}))
                            } else {
                                None
                            }
                        }
                        None => Some(
                            serde_json::json!({"ok": false, "error": "signature required but not provided"}),
                        ),
                    }
                } else {
                    None
                };

                if let Some(err_resp) = sig_error {
                    return err_resp;
                }

                let project = match ctx.agent_registry.get(&trigger.agent_id).await {
                    Ok(Some(agent)) => agent.parent_id.clone().or_else(|| Some(agent.name.clone())),
                    _ => None,
                };

                match project {
                    Some(_project) => {
                        let _ = store.advance_before_execute(&trigger.id).await;

                        let subject = format!("[webhook:{}] {}", trigger.name, trigger.skill);
                        let description = format!(
                            "Webhook '{}' fired. Run skill '{}' for agent {}.",
                            trigger.name, trigger.skill, trigger.agent_id
                        );

                        match ctx
                            .agent_registry
                            .create_task(
                                &trigger.agent_id,
                                &subject,
                                &description,
                                Some(&trigger.skill),
                                &[],
                            )
                            .await
                        {
                            Ok(task) => {
                                let _ = ctx
                                    .dispatch_es
                                    .emit(
                                        "quest_created",
                                        Some(&trigger.agent_id),
                                        None,
                                        Some(&task.id.0),
                                        &serde_json::json!({
                                            "subject": task.name,
                                            "trigger": trigger.name,
                                        }),
                                    )
                                    .await;
                                let _ = store.record_fire(&trigger.id, 0.0).await;
                                serde_json::json!({
                                    "ok": true,
                                    "quest_id": task.id
                                })
                            }
                            Err(e) => {
                                serde_json::json!({"ok": false, "error": format!("failed to create quest: {e}")})
                            }
                        }
                    }
                    None => {
                        serde_json::json!({"ok": false, "error": "trigger agent has no project scope"})
                    }
                }
            }
            Ok(None) => serde_json::json!({"ok": false, "error": "webhook not found"}),
            Err(e) => serde_json::json!({"ok": false, "error": format!("lookup failed: {e}")}),
        },
        None => serde_json::json!({"ok": false, "error": "trigger store not initialized"}),
    }
}

pub async fn handle_mail(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let messages = ctx.dispatch_es.drain();
    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| {
            serde_json::json!({
                "from": m.from,
                "to": m.to,
                "subject": m.kind.subject_tag(),
                "body": m.kind.body_text(),
            })
        })
        .collect();
    serde_json::json!({"ok": true, "messages": msgs})
}

pub async fn handle_dispatches(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let recipient = request.get("recipient").and_then(|v| v.as_str());
    let state = request.get("state").and_then(|v| v.as_str());
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let overdue_cutoff = chrono::Utc::now() - chrono::Duration::seconds(ACK_RETRY_AGE_SECS as i64);
    let mut dispatches = ctx.dispatch_es.all().await;
    if allowed.is_some() {
        dispatches.retain(|d| is_allowed(allowed, &d.to) || is_allowed(allowed, &d.from));
    }
    if let Some(recipient) = recipient {
        dispatches.retain(|d| d.to == recipient);
    }
    if let Some(state) = state {
        dispatches.retain(|d| crate::daemon::dispatch_state(d, overdue_cutoff) == state);
    }
    dispatches.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    dispatches.truncate(limit);
    let items: Vec<serde_json::Value> = dispatches
        .iter()
        .map(|d| crate::daemon::dispatch_summary_json(d, overdue_cutoff))
        .collect();
    let health = ctx.dispatch_es.dispatch_health(ACK_RETRY_AGE_SECS).await;
    serde_json::json!({
        "ok": true,
        "count": items.len(),
        "dispatch_health": {
            "unread": health.unread,
            "awaiting_ack": health.awaiting_ack,
            "retrying_delivery": health.retrying_delivery,
            "overdue_ack": health.overdue_ack,
            "dead_letters": health.dead_letters,
        },
        "dispatches": items,
    })
}
