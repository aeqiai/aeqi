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

pub async fn handle_agent_spawn(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let template = request
        .get("template")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if template.is_empty() {
        return serde_json::json!({"ok": false, "error": "template is required"});
    }
    let template_content = match crate::templates::identity_template_content(template) {
        Some(c) => c,
        None => {
            return serde_json::json!({"ok": false, "error": format!("template not found: {template}")});
        }
    };
    spawn_agent_from_content(
        &ctx.agent_registry,
        ctx.idea_store.as_ref(),
        template_content,
        request,
    )
    .await
}

/// Handler-inner for `/api/agents/spawn`. Split out so it can be unit-tested
/// without constructing the full `CommandContext`.
///
/// Honours three UI-supplied overrides on top of the base template:
/// - `parent_id` — attaches the new agent under an existing agent (hierarchy)
/// - `display_name` — overrides the frontmatter display_name
/// - `system_prompt` — persisted as an `identity` + `evergreen` idea owned by
///   the agent, matching the shape used by the company-template spawn path.
pub(crate) async fn spawn_agent_from_content(
    registry: &crate::agent_registry::AgentRegistry,
    idea_store: Option<&std::sync::Arc<dyn aeqi_core::traits::IdeaStore>>,
    template_content: &str,
    request: &serde_json::Value,
) -> serde_json::Value {
    let parent_id = request
        .get("parent_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let display_name_override = request
        .get("display_name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let system_prompt_override = request
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let mut agent = match registry
        .spawn_from_template(template_content, parent_id)
        .await
    {
        Ok(a) => a,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let mut warnings: Vec<String> = Vec::new();

    if let Some(name) = display_name_override {
        match registry.update_display_name(&agent.id, Some(name)).await {
            Ok(()) => agent.display_name = Some(name.to_string()),
            Err(err) => warnings.push(format!("display_name update failed: {err}")),
        }
    }

    if let Some(prompt) = system_prompt_override {
        match idea_store {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use std::sync::Arc;

    const LEADER_TEMPLATE: &str =
        "---\nname: leader\nmodel: anthropic/claude-sonnet-4.6\n---\n\nYou are a leader.";

    async fn test_registry() -> AgentRegistry {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        std::mem::forget(dir);
        AgentRegistry::open(&path).unwrap()
    }

    fn test_idea_store() -> Arc<dyn aeqi_core::traits::IdeaStore> {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("ideas.db");
        std::mem::forget(dir);
        Arc::new(aeqi_ideas::SqliteIdeas::open(&db_path, 30.0).unwrap())
    }

    #[tokio::test]
    async fn spawn_agent_honours_parent_id_display_name_and_system_prompt() {
        let registry = test_registry().await;
        let idea_store = test_idea_store();

        let root = registry
            .spawn("company", None, None, None)
            .await
            .expect("root spawn");

        let request = serde_json::json!({
            "template": "leader",
            "parent_id": root.id,
            "display_name": "CEO",
            "system_prompt": "You are the CEO. Decisive, restrained.",
        });

        let resp =
            spawn_agent_from_content(&registry, Some(&idea_store), LEADER_TEMPLATE, &request).await;

        assert_eq!(resp.get("ok").and_then(|v| v.as_bool()), Some(true));
        let warnings = resp
            .get("warnings")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");

        let agent_json = resp.get("agent").expect("agent block");
        let new_id = agent_json
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();
        assert_eq!(
            agent_json.get("parent_id").and_then(|v| v.as_str()),
            Some(root.id.as_str()),
            "parent_id must flow through to the DB row"
        );
        assert_eq!(
            agent_json.get("display_name").and_then(|v| v.as_str()),
            Some("CEO"),
            "display_name override must be persisted"
        );

        let identity_ideas = idea_store
            .ideas_by_tags(&["identity".to_string()], 50)
            .await
            .unwrap();
        assert!(
            identity_ideas
                .iter()
                .any(|i| i.agent_id.as_deref() == Some(new_id.as_str())),
            "system_prompt override must be persisted as an identity idea \
             owned by the new agent; got {:?}",
            identity_ideas
                .iter()
                .map(|i| (&i.name, &i.agent_id))
                .collect::<Vec<_>>(),
        );
    }

    #[tokio::test]
    async fn spawn_agent_without_overrides_still_succeeds() {
        let registry = test_registry().await;
        let idea_store = test_idea_store();

        let request = serde_json::json!({ "template": "leader" });
        let resp =
            spawn_agent_from_content(&registry, Some(&idea_store), LEADER_TEMPLATE, &request).await;

        assert_eq!(resp.get("ok").and_then(|v| v.as_bool()), Some(true));
        let agent_json = resp.get("agent").expect("agent block");
        assert_eq!(
            agent_json.get("name").and_then(|v| v.as_str()),
            Some("leader")
        );
        assert!(agent_json.get("parent_id").is_some_and(|v| v.is_null()));
    }

    #[tokio::test]
    async fn spawn_agent_warns_when_system_prompt_given_but_no_idea_store() {
        let registry = test_registry().await;

        let request = serde_json::json!({
            "template": "leader",
            "system_prompt": "body",
        });
        let resp = spawn_agent_from_content(&registry, None, LEADER_TEMPLATE, &request).await;

        assert_eq!(resp.get("ok").and_then(|v| v.as_bool()), Some(true));
        let warnings = resp
            .get("warnings")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert!(
            warnings.iter().any(|w| w
                .as_str()
                .is_some_and(|s| s.contains("idea store unavailable"))),
            "expected an idea-store-unavailable warning; got {warnings:?}",
        );
    }
}
