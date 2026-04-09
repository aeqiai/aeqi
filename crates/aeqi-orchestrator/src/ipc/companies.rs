//! Company management IPC handlers.

use super::tenancy::is_allowed;

pub async fn handle_companies(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let companies = ctx.agent_registry.list_companies().await.unwrap_or_default();
    let companies: Vec<_> = if allowed.is_some() {
        companies
            .into_iter()
            .filter(|c| is_allowed(allowed, &c.name))
            .collect()
    } else {
        companies
    };
    let mut result: Vec<serde_json::Value> = Vec::new();
    for company in &companies {
        let task_counts = if let Some(ref aid) = company.agent_id {
            ctx.agent_registry
                .list_tasks(None, Some(aid))
                .await
                .map(|tasks| {
                    let total = tasks.len();
                    let open = tasks.iter().filter(|t| !t.is_closed()).count();
                    let pending = tasks
                        .iter()
                        .filter(|t| t.status == aeqi_quests::QuestStatus::Pending)
                        .count();
                    let in_progress = tasks
                        .iter()
                        .filter(|t| t.status == aeqi_quests::QuestStatus::InProgress)
                        .count();
                    let done = tasks
                        .iter()
                        .filter(|t| t.status == aeqi_quests::QuestStatus::Done)
                        .count();
                    let cancelled = tasks
                        .iter()
                        .filter(|t| t.status == aeqi_quests::QuestStatus::Cancelled)
                        .count();
                    (total, open, pending, in_progress, done, cancelled)
                })
                .unwrap_or_default()
        } else {
            (0, 0, 0, 0, 0, 0)
        };
        result.push(serde_json::json!({
            "name": company.name,
            "display_name": company.display_name,
            "prefix": company.prefix,
            "tagline": company.tagline,
            "logo_url": company.logo_url,
            "source": company.source,
            "open_tasks": task_counts.1,
            "total_tasks": task_counts.0,
            "pending_tasks": task_counts.2,
            "in_progress_tasks": task_counts.3,
            "done_tasks": task_counts.4,
            "cancelled_tasks": task_counts.5,
        }));
    }
    serde_json::json!({"ok": true, "companies": result})
}

pub async fn handle_create_company(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let is_safe_name = !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && name.len() <= 128;
    if !is_safe_name {
        return serde_json::json!({"ok": false, "error": "invalid company name"});
    }

    let prefix = request
        .get("prefix")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| name.chars().take(2).collect::<String>().to_lowercase());
    let tagline = request
        .get("tagline")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let now = chrono::Utc::now().to_rfc3339();
    let record = crate::agent_registry::CompanyRecord {
        name: name.to_string(),
        display_name: None,
        prefix: prefix.clone(),
        tagline,
        logo_url: None,
        primer: None,
        repo: None,
        model: None,
        max_workers: 2,
        execution_mode: "agent".to_string(),
        worker_timeout_secs: 1800,
        worktree_root: None,
        max_turns: Some(25),
        max_budget_usd: None,
        max_cost_per_day_usd: None,
        source: "api".to_string(),
        agent_id: None,
        created_at: now.clone(),
        updated_at: now,
    };
    match ctx.agent_registry.create_company(&record).await {
        Ok(()) => {
            let agent = ctx
                .agent_registry
                .spawn(
                    name,
                    Some(name),
                    "company",
                    &format!("You are the primary agent for {name}. Help the team research, plan, and execute work."),
                    None,
                    None,
                    &[],
                )
                .await;
            match &agent {
                Ok(a) => {
                    if let Err(e) = ctx
                        .agent_registry
                        .update_company_agent_id(name, &a.id)
                        .await
                    {
                        tracing::warn!(
                            "create_company: failed to link agent to company '{}': {e}",
                            name
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "create_company: failed to spawn agent for '{}': {e}",
                        name
                    );
                }
            }
            if let Ok(cwd) = std::env::current_dir() {
                let project_dir = cwd.join("projects").join(name);
                let _ = std::fs::create_dir_all(&project_dir);
            }
            serde_json::json!({"ok": true, "company": {"name": name, "prefix": prefix}})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_update_company(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if name.is_empty() {
        serde_json::json!({"ok": false, "error": "name is required"})
    } else if allowed.is_some() && !is_allowed(allowed, name) {
        serde_json::json!({"ok": false, "error": "access denied"})
    } else {
        let display_name = request.get("display_name").and_then(|v| v.as_str());
        let tagline = request.get("tagline").and_then(|v| v.as_str());
        let logo_url = request.get("logo_url").and_then(|v| v.as_str());
        match ctx
            .agent_registry
            .update_company(name, display_name, tagline, logo_url)
            .await
        {
            Ok(()) => serde_json::json!({"ok": true}),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    }
}
