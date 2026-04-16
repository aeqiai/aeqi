//! Root agent management IPC handlers (legacy "companies" commands).

use super::tenancy::is_allowed;

pub async fn handle_companies(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agents = ctx
        .agent_registry
        .list_root_agents()
        .await
        .unwrap_or_default();
    let agents: Vec<_> = if allowed.is_some() {
        agents
            .into_iter()
            .filter(|a| is_allowed(allowed, &a.name))
            .collect()
    } else {
        agents
    };
    let mut result: Vec<serde_json::Value> = Vec::new();
    for agent in &agents {
        let task_counts = ctx
            .agent_registry
            .list_tasks(None, Some(&agent.id))
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
            .unwrap_or_default();
        result.push(serde_json::json!({
            "name": agent.name,
            "display_name": agent.display_name,
            "prefix": agent.quest_prefix,
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
        return serde_json::json!({"ok": false, "error": "invalid name"});
    }

    let prefix = request
        .get("prefix")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| name.chars().take(2).collect::<String>().to_lowercase());

    // Spawn a root agent (parent_id = None).
    let agent = ctx.agent_registry.spawn(name, Some(name), None, None).await;
    match agent {
        Ok(_a) => {
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
        let display_name = request
            .get("display_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        // Find the root agent by name and update it.
        match ctx.agent_registry.list_root_agents().await {
            Ok(agents) => {
                if let Some(agent) = agents.iter().find(|a| a.name == name) {
                    match ctx
                        .agent_registry
                        .update_display_name(&agent.id, display_name.as_deref())
                        .await
                    {
                        Ok(()) => serde_json::json!({"ok": true}),
                        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                    }
                } else {
                    serde_json::json!({"ok": false, "error": "root agent not found"})
                }
            }
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    }
}
