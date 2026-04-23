//! Idea seeding IPC handler.
//!
//! Stores ideas via `store()`, spawns agents, and creates `on_session_start`
//! events referencing the ideas directly. No injection_mode involved.

/// Seed ideas into a tenant's idea store + spawn agents + wire events.
/// Called by the platform after root agent provisioning.
///
/// Request shape:
/// ```json
/// {
///   "cmd": "seed_ideas",
///   "ideas": [
///     { "name": "...", "content": "...", "agent_id": "agent-name",
///       "tags": ["evergreen"], "tool_allow": [], "tool_deny": [] }
///   ],
///   "agents": [
///     { "name": "Shadow", "template": "shadow-identity", "model": "..." }
///   ]
/// }
/// ```
pub async fn handle_seed_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let ideas = request.get("ideas").and_then(|v| v.as_array());
    let agents = request.get("agents").and_then(|v| v.as_array());

    let idea_store = ctx
        .message_router
        .as_ref()
        .and_then(|mr| mr.idea_store.as_ref());

    let Some(idea_store) = idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let mut idea_results = Vec::new();
    // Track ideas per agent for event wiring.
    let mut agent_idea_ids: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();

    // Phase 1: Store ideas.
    if let Some(ideas) = ideas {
        for idea_val in ideas {
            let name = idea_val["name"].as_str().unwrap_or("");
            let content = idea_val["content"].as_str().unwrap_or("");
            if name.is_empty() || content.is_empty() {
                idea_results.push(
                    serde_json::json!({"name": name, "status": "skipped", "reason": "empty"}),
                );
                continue;
            }

            let tags: Vec<String> = idea_val["tags"]
                .as_array()
                .map(|vals| {
                    vals.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_else(|| vec!["fact".to_string()]);
            let agent_id = idea_val["agent_id"].as_str();

            match idea_store.store(name, content, &tags, agent_id).await {
                Ok(id) => {
                    // Track this idea for event wiring.
                    if let Some(agent) = agent_id {
                        agent_idea_ids
                            .entry(agent.to_string())
                            .or_default()
                            .push(id.clone());
                    }
                    idea_results
                        .push(serde_json::json!({"name": name, "id": id, "status": "created"}));
                }
                Err(e) => {
                    idea_results.push(serde_json::json!({"name": name, "status": "error", "error": e.to_string()}));
                }
            }
        }
    }

    // Phase 2: Spawn agents.
    let mut agent_results = Vec::new();
    if let Some(agents) = agents {
        for agent_val in agents {
            let name = agent_val["name"].as_str().unwrap_or("");
            let model = agent_val["model"].as_str();

            let _template = agent_val["template"].as_str().unwrap_or("seeded");

            if name.is_empty() {
                agent_results.push(serde_json::json!({"name": name, "status": "skipped"}));
                continue;
            }

            // Skip if agent already exists.
            if let Ok(Some(_)) = ctx.agent_registry.get_active_by_name(name).await {
                agent_results.push(serde_json::json!({"name": name, "status": "exists"}));
                continue;
            }

            match ctx.agent_registry.spawn(name, None, model).await {
                Ok(agent) => {
                    // Reassign ideas that reference this agent by name to use UUID.
                    let _ = idea_store.reassign_agent(name, &agent.id).await;

                    // Wire on_session_start event with the agent's ideas.
                    if let Some(idea_ids) = agent_idea_ids.remove(name)
                        && let Some(ref ehs) = ctx.event_handler_store
                    {
                        let _ = ehs
                            .update_on_session_start_ideas(&agent.id, &idea_ids)
                            .await;
                    }

                    agent_results.push(serde_json::json!({
                        "name": name,
                        "id": agent.id,
                        "status": "spawned",
                    }));
                }
                Err(e) => {
                    agent_results.push(serde_json::json!({
                        "name": name,
                        "status": "error",
                        "error": e.to_string(),
                    }));
                }
            }
        }
    }

    serde_json::json!({
        "ok": true,
        "ideas": idea_results,
        "agents": agent_results,
    })
}
