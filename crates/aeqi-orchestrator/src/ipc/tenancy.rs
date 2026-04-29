//! Tenant scoping helpers shared across IPC command handlers.

use crate::agent_registry::AgentRegistry;

/// Check if a root agent name or ID is in the allowed list.
/// During the transition period, the allowed list may contain either names or UUIDs.
pub fn is_allowed(allowed: &Option<Vec<String>>, name_or_id: &str) -> bool {
    match allowed {
        None => true,
        Some(list) => list.iter().any(|c| c == name_or_id),
    }
}

/// Validate project field in the request against scope.
/// Returns an error JSON if access is denied.
pub fn check_project(
    allowed: &Option<Vec<String>>,
    request: &serde_json::Value,
) -> Option<serde_json::Value> {
    allowed.as_ref()?;
    if let Some(val) = request.get("project").and_then(|v| v.as_str())
        && !val.is_empty()
        && !is_allowed(allowed, val)
    {
        return Some(serde_json::json!({"ok": false, "error": "access denied"}));
    }
    None
}

/// Check whether the agent is reachable from the allowed scope. The agent's
/// owning entity (`agents.entity_id`) is the canonical tenancy anchor;
/// allowing an entity grants access to every agent inside it. The legacy
/// shape (allowed contains agent names) is supported by also matching the
/// agent's own name/id directly.
pub async fn check_agent_access(
    registry: &AgentRegistry,
    allowed: &Option<Vec<String>>,
    agent_id: &str,
) -> bool {
    if allowed.is_none() {
        return true;
    }
    let allowed = allowed.as_ref().unwrap();

    match registry.get(agent_id).await {
        Ok(Some(agent)) => {
            if let Some(eid) = agent.entity_id.as_deref()
                && allowed.iter().any(|c| c == eid)
            {
                return true;
            }
            allowed.iter().any(|c| c == &agent.name || c == &agent.id)
        }
        _ => false,
    }
}

/// Build the set of agent IDs belonging to allowed entities. Used for
/// filtering lists of quests, approvals, etc. The allowed list may contain
/// entity ids, entity slugs, or root-agent names/ids; an agent is in scope
/// when its owning entity hits any of those, or when the agent itself is
/// named explicitly in the allowed list.
pub async fn allowed_agent_ids(
    registry: &AgentRegistry,
    allowed: &Option<Vec<String>>,
) -> Option<std::collections::HashSet<String>> {
    let allowed = allowed.as_ref()?;
    let all_agents = registry.list(None, None).await.unwrap_or_default();
    Some(
        all_agents
            .iter()
            .filter(|a| {
                a.entity_id
                    .as_deref()
                    .map(|eid| allowed.iter().any(|c| c == eid))
                    .unwrap_or(false)
                    || allowed.iter().any(|c| c == &a.name || c == &a.id)
            })
            .map(|a| a.id.clone())
            .collect(),
    )
}
