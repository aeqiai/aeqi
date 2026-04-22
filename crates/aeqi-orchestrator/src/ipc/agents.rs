//! Agent registry IPC handlers.

use super::request_field;
use super::tenancy::{check_agent_access, is_allowed};

pub async fn handle_agents_registry(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let parent_id = request.get("parent_id").and_then(|v| v.as_str());
    let parent_filter: Option<Option<&str>> = if request.get("parent_id").is_some() {
        Some(parent_id)
    } else {
        None
    };
    let status_filter = request.get("status").and_then(|v| v.as_str());
    let status = status_filter.and_then(|s| match s {
        "active" => Some(crate::agent_registry::AgentStatus::Active),
        "paused" => Some(crate::agent_registry::AgentStatus::Paused),
        "retired" => Some(crate::agent_registry::AgentStatus::Retired),
        _ => None,
    });
    match ctx.agent_registry.list(parent_filter, status).await {
        Ok(agents) => {
            let filtered_agents = if allowed.is_some() {
                let root_ids: std::collections::HashSet<String> = agents
                    .iter()
                    .filter(|a| {
                        a.parent_id.is_none()
                            && (is_allowed(allowed, &a.name) || is_allowed(allowed, &a.id))
                    })
                    .map(|a| a.id.clone())
                    .collect();
                let mut allowed_ids = root_ids.clone();
                loop {
                    let before = allowed_ids.len();
                    for a in &agents {
                        if !allowed_ids.contains(&a.id)
                            && a.parent_id
                                .as_ref()
                                .is_some_and(|pid| allowed_ids.contains(pid))
                        {
                            allowed_ids.insert(a.id.clone());
                        }
                    }
                    if allowed_ids.len() == before {
                        break;
                    }
                }
                agents
                    .into_iter()
                    .filter(|a| allowed_ids.contains(&a.id))
                    .collect::<Vec<_>>()
            } else {
                agents
            };
            let mut items: Vec<serde_json::Value> = Vec::with_capacity(filtered_agents.len());
            for a in &filtered_agents {
                items.push(serde_json::json!({
                    "id": a.id,
                    "name": a.name,
                    "display_name": a.display_name,
                    "parent_id": a.parent_id,
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
                    "display_name": a.display_name,
                    "parent_id": a.parent_id,
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
/// Optional: `parent_id` (attaches under an existing agent; root otherwise),
/// `display_name`, `model`, `system_prompt` (persisted as an `identity` +
/// `evergreen` idea owned by the new agent — matches the shape used by
/// company-template spawns so `assemble_ideas` picks it up at session:start).
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

    let parent_id = request
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let display_name = request
        .get("display_name")
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

    let agent = match ctx
        .agent_registry
        .spawn(name, display_name, parent_id, model)
        .await
    {
        Ok(a) => a,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let mut warnings: Vec<String> = Vec::new();
    if let Some(prompt) = system_prompt {
        match ctx.idea_store.as_ref() {
            Some(store) => {
                let label = agent.display_name.as_deref().unwrap_or(&agent.name);
                let idea_name = format!("Persona — {label}");
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
            "display_name": agent.display_name,
            "parent_id": agent.parent_id,
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
                "display_name": agent.display_name,
                "parent_id": agent.parent_id,
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

pub async fn handle_approvals(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let status = request_field(request, "status");
    match ctx.agent_registry.list_approvals(status).await {
        Ok(approvals) => {
            let approvals: Vec<serde_json::Value> = if allowed.is_some() {
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
                let allowed_ids: std::collections::HashSet<String> = all_agents
                    .iter()
                    .filter(|a| {
                        root_ids.contains(&a.id)
                            || a.parent_id
                                .as_ref()
                                .map(|p| root_ids.contains(p))
                                .unwrap_or(false)
                    })
                    .map(|a| a.id.clone())
                    .collect();
                approvals
                    .into_iter()
                    .filter(|a| {
                        a.get("agent_id")
                            .and_then(|v| v.as_str())
                            .map(|id| allowed_ids.contains(id))
                            .unwrap_or(false)
                    })
                    .collect()
            } else {
                approvals
            };
            serde_json::json!({"ok": true, "approvals": approvals})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_resolve_approval(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let approval_id = request_field(request, "approval_id").unwrap_or("");
    let status = request_field(request, "status").unwrap_or("");
    let decided_by = request_field(request, "decided_by").unwrap_or("");
    let note = request_field(request, "note");

    if approval_id.is_empty() || status.is_empty() || decided_by.is_empty() {
        return serde_json::json!({"ok": false, "error": "approval_id, status, and decided_by are required"});
    }

    if allowed.is_some() {
        let ok = match ctx.agent_registry.list_approvals(None).await {
            Ok(list) => {
                let matching = list
                    .iter()
                    .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(approval_id));
                match matching
                    .and_then(|a| a.get("agent_id"))
                    .and_then(|v| v.as_str())
                {
                    Some(aid) => check_agent_access(&ctx.agent_registry, allowed, aid).await,
                    None => false,
                }
            }
            _ => false,
        };
        if !ok {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    }

    match ctx
        .agent_registry
        .resolve_approval(approval_id, status, decided_by, note)
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
