//! Status, readiness, metrics, and other observability IPC handlers.

use super::tenancy::is_allowed;

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
    let spent = ctx.activity_log.daily_cost().await.unwrap_or(0.0);
    let budget = ctx.daily_budget_usd;
    let remaining = (budget - spent).max(0.0);
    crate::daemon::readiness_response(
        worker_limits,
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

pub async fn handle_activity(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let task_filter = request
        .get("quest_id")
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

