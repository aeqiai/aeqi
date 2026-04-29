//! Agent registry IPC handlers.

use super::request_field;
use super::tenancy::{check_agent_access, is_allowed};

pub async fn handle_agents_registry(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let entity_id = request
        .get("entity_id")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let status_filter = request.get("status").and_then(|v| v.as_str());
    let status = status_filter.and_then(|s| match s {
        "active" => Some(crate::agent_registry::AgentStatus::Active),
        "paused" => Some(crate::agent_registry::AgentStatus::Paused),
        "retired" => Some(crate::agent_registry::AgentStatus::Retired),
        _ => None,
    });
    match ctx.agent_registry.list(entity_id, status).await {
        Ok(agents) => {
            let filtered_agents = if let Some(list) = allowed.as_ref() {
                // An agent is reachable iff its entity matches a name/id in
                // the allowed scope. Tenancy maps to entity, not parent_id.
                agents
                    .into_iter()
                    .filter(|a| {
                        a.entity_id
                            .as_deref()
                            .map(|eid| list.iter().any(|c| c == eid))
                            .unwrap_or(false)
                            || list.iter().any(|c| c == &a.name || c == &a.id)
                    })
                    .collect::<Vec<_>>()
            } else {
                agents
            };
            let mut items: Vec<serde_json::Value> = Vec::with_capacity(filtered_agents.len());
            for a in &filtered_agents {
                items.push(serde_json::json!({
                    "id": a.id,
                    "name": a.name,
                    "entity_id": a.entity_id,
                    "model": a.model,
                    "status": a.status,
                    "created_at": a.created_at.to_rfc3339(),
                    "last_active": a.last_active.map(|dt| dt.to_rfc3339()),
                    "session_count": a.session_count,
                    "total_tokens": a.total_tokens,
                    "color": a.color,
                    "avatar": a.avatar,
                    "faces": a.faces,
                    "session_id": a.session_id,
                }));
            }
            serde_json::json!({"ok": true, "agents": items})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_agent_children(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_id = request
        .get("agent_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if agent_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "agent_id is required"});
    }
    match ctx.agent_registry.get_children(agent_id).await {
        Ok(children) => {
            let mut items: Vec<serde_json::Value> = Vec::with_capacity(children.len());
            for a in &children {
                items.push(serde_json::json!({
                    "id": a.id,
                    "name": a.name,
                    "entity_id": a.entity_id,
                    "model": a.model,
                    "status": a.status,
                    "created_at": a.created_at.to_rfc3339(),
                }));
            }
            serde_json::json!({"ok": true, "children": items})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Spawn a new agent from a request body.
///
/// Required: `name`.
/// Optional: `parent_agent_id` (attaches the new agent's position under the
/// parent agent's primary position; root otherwise), `model`,
/// `system_prompt` (persisted as an `identity` + `evergreen` idea owned by
/// the new agent — matches the shape used by company-template spawns so
/// `assemble_ideas` picks it up at session:start).
pub async fn handle_agent_spawn(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(name) = name else {
        return serde_json::json!({"ok": false, "error": "name is required"});
    };

    let parent_agent_id = request
        .get("parent_agent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let model = request
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let system_prompt = request
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let can_self_delegate = request.get("can_self_delegate").and_then(|v| v.as_bool());
    let can_ask_director = request.get("can_ask_director").and_then(|v| v.as_bool());

    let agent = match ctx.agent_registry.spawn(name, parent_agent_id, model).await {
        Ok(a) => a,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Apply optional capability flags set at hire time.
    let mut warnings: Vec<String> = Vec::new();
    if let Some(csd) = can_self_delegate
        && let Err(e) = ctx
            .agent_registry
            .set_can_self_delegate(&agent.id, csd)
            .await
    {
        warnings.push(format!("can_self_delegate update failed: {e}"));
    }
    if let Some(cad) = can_ask_director
        && let Err(e) = ctx
            .agent_registry
            .set_can_ask_director(&agent.id, cad)
            .await
    {
        warnings.push(format!("can_ask_director update failed: {e}"));
    }

    if let Some(prompt) = system_prompt {
        match ctx.idea_store.as_ref() {
            Some(store) => {
                let idea_name = format!("Persona — {}", agent.name);
                let tags = vec!["identity".to_string(), "evergreen".to_string()];
                if let Err(err) = store
                    .store(&idea_name, prompt, &tags, Some(&agent.id))
                    .await
                {
                    warnings.push(format!("identity idea store failed: {err}"));
                }
            }
            None => {
                warnings.push("system_prompt ignored: idea store unavailable".to_string());
            }
        }
    }

    serde_json::json!({
        "ok": true,
        "agent": {
            "id": agent.id,
            "name": agent.name,
            "entity_id": agent.entity_id,
            "status": agent.status,
        },
        "warnings": warnings,
    })
}

pub async fn handle_agent_delete(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = request.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id required"});
    }
    let cascade = request
        .get("cascade")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !check_agent_access(&ctx.agent_registry, allowed, id).await {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }
    match ctx.agent_registry.delete_agent(id, cascade).await {
        Ok(n) => serde_json::json!({"ok": true, "deleted": n, "cascade": cascade}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_agent_set_status(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let status_str = request.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if name.is_empty() || status_str.is_empty() {
        return serde_json::json!({"ok": false, "error": "name and status required"});
    }
    if allowed.is_some() && !is_allowed(allowed, name) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }
    let status = match status_str {
        "active" => Some(crate::agent_registry::AgentStatus::Active),
        "paused" => Some(crate::agent_registry::AgentStatus::Paused),
        "retired" => Some(crate::agent_registry::AgentStatus::Retired),
        _ => None,
    };
    match status {
        Some(s) => match ctx.agent_registry.set_status(name, s).await {
            Ok(_) => serde_json::json!({"ok": true}),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        },
        None => {
            serde_json::json!({"ok": false, "error": format!("invalid status: {status_str}")})
        }
    }
}

pub async fn handle_agent_info(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if name.is_empty() {
        return serde_json::json!({"ok": false, "error": "name is required"});
    }
    match ctx.agent_registry.get_active_by_name(name).await {
        Ok(Some(agent)) => {
            let ancestors = ctx
                .agent_registry
                .get_ancestors(&agent.id)
                .await
                .unwrap_or_default();
            let idea_chain: Vec<serde_json::Value> = ancestors
                .iter()
                .rev()
                .map(|a| {
                    serde_json::json!({
                        "agent_name": a.name,
                        "agent_id": a.id,
                    })
                })
                .collect();

            serde_json::json!({
                "ok": true,
                "id": agent.id,
                "name": agent.name,
                "entity_id": agent.entity_id,
                "model": agent.model,
                "status": agent.status,
                "idea_chain": idea_chain,
            })
        }
        Ok(None) => {
            serde_json::json!({"ok": false, "error": format!("agent '{}' not found", name)})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_agent_identity(
    _ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if agent_name.is_empty() {
        return serde_json::json!({"ok": false, "error": "name is required"});
    }
    let agent_dir = std::env::current_dir()
        .unwrap_or_default()
        .join("agents")
        .join(agent_name);

    if !agent_dir.exists() {
        return serde_json::json!({"ok": false, "error": format!("agent directory not found: {}", agent_dir.display())});
    }

    let mut files = serde_json::Map::new();
    let identity_files = [
        "PERSONA.md",
        "IDENTITY.md",
        "KNOWLEDGE.md",
        "MEMORY.md",
        "PREFERENCES.md",
        "AGENTS.md",
        "agent.md",
    ];
    for filename in &identity_files {
        let path = agent_dir.join(filename);
        if path.exists()
            && let Ok(content) = std::fs::read_to_string(&path)
        {
            files.insert(filename.to_string(), serde_json::Value::String(content));
        }
    }
    serde_json::json!({
        "ok": true,
        "agent": agent_name,
        "files": files,
    })
}

pub async fn handle_save_agent_file(
    _ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let filename = request
        .get("filename")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let content = request
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let allowed_files = [
        "PERSONA.md",
        "IDENTITY.md",
        "KNOWLEDGE.md",
        "MEMORY.md",
        "PREFERENCES.md",
        "AGENTS.md",
        "agent.md",
    ];
    if agent_name.is_empty() || filename.is_empty() {
        return serde_json::json!({"ok": false, "error": "name and filename required"});
    }
    if !allowed_files.contains(&filename) {
        return serde_json::json!({"ok": false, "error": format!("cannot edit {filename}")});
    }

    let agent_dir = std::env::current_dir()
        .unwrap_or_default()
        .join("agents")
        .join(agent_name);
    let path = agent_dir.join(filename);
    match std::fs::write(&path, content) {
        Ok(_) => {
            tracing::info!(
                agent = agent_name,
                file = filename,
                "agent file updated via web"
            );
            serde_json::json!({"ok": true, "saved": filename})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_budget_policies(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    match ctx.agent_registry.list_budget_policies().await {
        Ok(policies) => serde_json::json!({"ok": true, "policies": policies}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_create_budget_policy(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_id = request_field(request, "agent_id").unwrap_or("");
    let window = request_field(request, "window").unwrap_or("");
    let amount_usd = request
        .get("amount_usd")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    if agent_id.is_empty() || window.is_empty() || amount_usd <= 0.0 {
        serde_json::json!({"ok": false, "error": "agent_id, window, and positive amount_usd are required"})
    } else {
        match ctx
            .agent_registry
            .create_budget_policy(agent_id, window, amount_usd)
            .await
        {
            Ok(id) => serde_json::json!({"ok": true, "id": id}),
            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    }
}

/// Toggle the `can_ask_director` capability on an existing agent. Mirrors the
/// post-spawn shape used by `handle_agent_delete` for tenancy: the caller's
/// scope must include the agent's root before the column can be flipped.
pub async fn handle_set_can_ask_director(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_id = request_field(request, "agent_id").unwrap_or("");
    if agent_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "agent_id required"});
    }
    let value = match request.get("value").and_then(|v| v.as_bool()) {
        Some(b) => b,
        None => return serde_json::json!({"ok": false, "error": "value (bool) required"}),
    };
    if !check_agent_access(&ctx.agent_registry, allowed, agent_id).await {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }
    match ctx
        .agent_registry
        .set_can_ask_director(agent_id, value)
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
