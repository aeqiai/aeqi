//! Root agent management IPC handlers.

use super::tenancy::is_allowed;

pub async fn handle_roots(
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
            .filter(|a| is_allowed(allowed, &a.name) || is_allowed(allowed, &a.id))
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
                    .filter(|t| t.status == aeqi_quests::QuestStatus::Todo)
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
        // After Phase 4 the workspace identity (`entity_id`) and the
        // backing root agent UUID (`agent_id`) are distinct. Surface both
        // explicitly so callers (notably the SaaS platform's placement
        // cache) can populate each column without ambiguity. `id` stays
        // wired to the agent UUID for legacy callers that haven't moved
        // off `/api/roots` yet — new callers should prefer `/api/entities`
        // where `id` = `entity_id`.
        result.push(serde_json::json!({
            "id": agent.id,
            "agent_id": agent.id,
            "entity_id": agent.entity_id,
            "name": agent.name,
            "prefix": agent.quest_prefix,
            "open_tasks": task_counts.1,
            "total_tasks": task_counts.0,
            "pending_tasks": task_counts.2,
            "in_progress_tasks": task_counts.3,
            "done_tasks": task_counts.4,
            "cancelled_tasks": task_counts.5,
        }));
    }
    serde_json::json!({"ok": true, "roots": result})
}

pub async fn handle_create_root(
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

    // Spawn a root agent (no parent → fresh entity + agent + position).
    let agent = ctx.agent_registry.spawn(name, None, None).await;
    match agent {
        Ok(a) => {
            if let Ok(cwd) = std::env::current_dir() {
                let project_dir = cwd.join("projects").join(name);
                let _ = std::fs::create_dir_all(&project_dir);
            }
            serde_json::json!({"ok": true, "id": a.id, "root": {"name": name, "prefix": prefix}})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_update_root(
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
        let new_name = request
            .get("new_name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        // Find the root agent by name or ID and update it.
        match ctx.agent_registry.list_root_agents().await {
            Ok(agents) => {
                if let Some(agent) = agents.iter().find(|a| a.name == name || a.id == name) {
                    let Some(new_name) = new_name else {
                        return serde_json::json!({"ok": false, "error": "new_name is required"});
                    };
                    match ctx.agent_registry.update_name(&agent.id, new_name).await {
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
