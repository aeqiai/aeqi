//! Tenant scoping helpers shared across IPC command handlers.

use crate::agent_registry::AgentRegistry;

/// Check if a root agent name is in the allowed list.
pub fn is_allowed(allowed: &Option<Vec<String>>, name: &str) -> bool {
    match allowed {
        None => true,
        Some(list) => list.iter().any(|c| c == name),
    }
}

/// Validate project field in the request against scope.
/// Returns an error JSON if access is denied.
pub fn check_project(
    allowed: &Option<Vec<String>>,
    request: &serde_json::Value,
) -> Option<serde_json::Value> {
    allowed.as_ref()?;
    for field in &["project", "company"] {
        if let Some(val) = request.get(*field).and_then(|v| v.as_str())
            && !val.is_empty()
            && !is_allowed(allowed, val)
        {
            return Some(serde_json::json!({"ok": false, "error": "access denied"}));
        }
    }
    None
}

/// Walk the agent's parent chain up to a root agent and check if it's allowed.
/// Handles arbitrary nesting depth (safety limit of 10 levels).
pub async fn check_agent_access(
    registry: &AgentRegistry,
    allowed: &Option<Vec<String>>,
    agent_id: &str,
) -> bool {
    if allowed.is_none() {
        return true;
    }
    let allowed = allowed.as_ref().unwrap();

    let mut current_id = agent_id.to_string();
    for _ in 0..10 {
        match registry.get(&current_id).await {
            Ok(Some(agent)) => {
                if agent.parent_id.is_none() {
                    return allowed.iter().any(|c| c == &agent.name);
                }
                match agent.parent_id {
                    Some(pid) => current_id = pid,
                    None => return false,
                }
            }
            _ => return false,
        }
    }
    false
}

/// Build the set of agent IDs belonging to allowed root agents.
/// Used for filtering lists of quests, approvals, etc.
pub async fn allowed_agent_ids(
    registry: &AgentRegistry,
    allowed: &Option<Vec<String>>,
) -> Option<std::collections::HashSet<String>> {
    let allowed = allowed.as_ref()?;
    let all_agents = registry.list(None, None).await.unwrap_or_default();
    let root_ids: std::collections::HashSet<String> = all_agents
        .iter()
        .filter(|a| a.parent_id.is_none() && allowed.iter().any(|c| c == &a.name))
        .map(|a| a.id.clone())
        .collect();
    // Iteratively expand to include all descendants.
    let mut ids = root_ids.clone();
    loop {
        let before = ids.len();
        for a in &all_agents {
            if !ids.contains(&a.id) && a.parent_id.as_ref().is_some_and(|pid| ids.contains(pid)) {
                ids.insert(a.id.clone());
            }
        }
        if ids.len() == before {
            break;
        }
    }
    Some(ids)
}
