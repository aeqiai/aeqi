use aeqi_core::traits::{IdeaStore, Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;

use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;

use super::PERSONA_IDEA_TAGS;

/// Unified agents tool combining hire, retire, list, and self-introspection.
pub struct AgentsTool {
    agent_id: String,
    agent_registry: Arc<AgentRegistry>,
    idea_store: Option<Arc<dyn IdeaStore>>,
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
    activity_log: Arc<ActivityLog>,
}

impl AgentsTool {
    pub fn new(
        agent_id: String,
        agent_registry: Arc<AgentRegistry>,
        idea_store: Option<Arc<dyn IdeaStore>>,
        event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            agent_id,
            agent_registry,
            idea_store,
            event_handler_store,
            activity_log,
        }
    }

    async fn action_hire(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let name = args
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'name'"))?;
        let model = args
            .get("model")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let system_prompt = args
            .get("system_prompt")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());

        // `parent_agent_id` can be an explicit agent id, or defaults to the
        // calling agent so hiring from inside a session always attaches a child.
        let parent_hint = args
            .get("parent_agent_id")
            .and_then(|v| v.as_str())
            .unwrap_or(&self.agent_id);
        let parent_agent_id = match self.agent_registry.resolve_by_hint(parent_hint).await? {
            Some(parent) => parent.id,
            None => {
                return Ok(ToolResult::error(format!(
                    "parent agent not found: {parent_hint}"
                )));
            }
        };

        let agent = self
            .agent_registry
            .spawn(name, Some(&parent_agent_id), model)
            .await?;

        if let (Some(store), Some(prompt)) = (self.idea_store.as_ref(), system_prompt) {
            let idea_name = format!("Persona — {}", agent.name);
            let tags: Vec<String> = PERSONA_IDEA_TAGS.iter().map(|s| s.to_string()).collect();
            let _ = store
                .store(&idea_name, prompt, &tags, Some(&agent.id))
                .await;
        }

        let _ = self
            .activity_log
            .emit(
                "child_added",
                Some(&parent_agent_id),
                None,
                None,
                &serde_json::json!({"child_name": agent.name, "child_id": agent.id}),
            )
            .await;

        Ok(ToolResult::success(format!(
            "Agent hired: {} (id: {})",
            agent.name, agent.id
        )))
    }

    async fn action_retire(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let agent_hint = args
            .get("agent")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'agent'"))?;

        let agent = self
            .agent_registry
            .resolve_by_hint(agent_hint)
            .await?
            .ok_or_else(|| anyhow::anyhow!("agent not found: {agent_hint}"))?;

        self.agent_registry
            .set_status(&agent.id, crate::agent_registry::AgentStatus::Retired)
            .await?;

        // Emit child_removed under the agent's entity (the canonical
        // tenancy anchor; position-DAG ancestors aren't needed here).
        if let Some(ref entity_id) = agent.entity_id {
            let _ = self
                .activity_log
                .emit(
                    "child_removed",
                    Some(entity_id),
                    None,
                    None,
                    &serde_json::json!({"child_name": agent.name, "child_id": agent.id}),
                )
                .await;
        }

        Ok(ToolResult::success(format!(
            "Agent '{}' (id: {}) retired.",
            agent.name, agent.id
        )))
    }

    async fn action_list(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let status_str = args
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("active");

        let status_filter = match status_str {
            "active" => Some(crate::agent_registry::AgentStatus::Active),
            "paused" => Some(crate::agent_registry::AgentStatus::Paused),
            "retired" => Some(crate::agent_registry::AgentStatus::Retired),
            "all" => None,
            _ => Some(crate::agent_registry::AgentStatus::Active),
        };

        let agents = self.agent_registry.list(None, status_filter).await?;

        if agents.is_empty() {
            return Ok(ToolResult::success(format!(
                "No agents with status '{status_str}'."
            )));
        }

        let mut output = String::new();
        for agent in &agents {
            output.push_str(&format!(
                "- {} (id: {}, status: {})\n",
                agent.name, agent.id, agent.status,
            ));
        }
        Ok(ToolResult::success(output))
    }

    async fn action_self(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let detail = args.get("detail").and_then(|v| v.as_str()).unwrap_or("all");

        let agent = match self.agent_registry.get(&self.agent_id).await? {
            Some(a) => a,
            None => {
                return Ok(ToolResult::error(format!(
                    "Could not find active agent with id: {}",
                    self.agent_id
                )));
            }
        };

        let mut result = serde_json::Map::new();

        if detail == "identity" || detail == "all" {
            result.insert(
                "identity".to_string(),
                serde_json::json!({
                    "id": agent.id,
                    "name": agent.name,
                    "model": agent.model,
                    "status": format!("{}", agent.status),
                    "created_at": agent.created_at.to_rfc3339(),
                }),
            );
        }

        if detail == "tree" || detail == "all" {
            let ancestors = self
                .agent_registry
                .get_ancestors(&agent.id)
                .await
                .unwrap_or_default();
            let parent_chain: Vec<serde_json::Value> = ancestors
                .iter()
                .skip(1)
                .map(|a| {
                    serde_json::json!({
                        "id": a.id,
                        "name": a.name,
                    })
                })
                .collect();

            let children = self
                .agent_registry
                .get_children(&agent.id)
                .await
                .unwrap_or_default();
            let children_list: Vec<serde_json::Value> = children
                .iter()
                .map(|a| {
                    serde_json::json!({
                        "id": a.id,
                        "name": a.name,
                        "status": format!("{}", a.status),
                    })
                })
                .collect();

            result.insert(
                "tree".to_string(),
                serde_json::json!({
                    "entity_id": agent.entity_id,
                    "ancestors": parent_chain,
                    "children": children_list,
                }),
            );
        }

        if detail == "quests" || detail == "all" {
            let quests = self
                .agent_registry
                .list_tasks(None, Some(&agent.id))
                .await
                .unwrap_or_default();
            let quests_list: Vec<serde_json::Value> = quests
                .iter()
                .map(|q| {
                    serde_json::json!({
                        "id": q.id.0,
                        "name": q.title(),
                        "status": format!("{:?}", q.status),
                        "priority": format!("{}", q.priority),
                    })
                })
                .collect();

            result.insert("quests".to_string(), serde_json::json!(quests_list));
        }

        if detail == "events" || detail == "all" {
            if let Some(ref ehs) = self.event_handler_store {
                let events = ehs.list_for_agent(&agent.id).await.unwrap_or_default();
                let events_list: Vec<serde_json::Value> = events
                    .iter()
                    .map(|e| {
                        serde_json::json!({
                            "id": e.id,
                            "name": e.name,
                            "pattern": e.pattern,
                            "enabled": e.enabled,
                        })
                    })
                    .collect();
                result.insert("events".to_string(), serde_json::json!(events_list));
            } else {
                result.insert("events".to_string(), serde_json::json!([]));
            }
        }

        Ok(ToolResult::success(serde_json::to_string_pretty(
            &serde_json::Value::Object(result),
        )?))
    }
}

#[async_trait]
impl Tool for AgentsTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'action'"))?;

        match action {
            "hire" => self.action_hire(&args).await,
            "retire" => self.action_retire(&args).await,
            "list" => self.action_list(&args).await,
            "self" => self.action_self(&args).await,
            other => Ok(ToolResult::error(format!(
                "Unknown action: {other}. Use: hire, retire, list, self. \
                 To delegate work, use quests(action='create', agent='target-name')."
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "agents".to_string(),
            description: "Manage agents in the agent tree. \
                Actions: hire (spawn a child agent), retire (deactivate), \
                list (show agents), self (introspect). \
                To delegate work, use quests(action='create')."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["hire", "retire", "list", "self"],
                        "description": "hire: spawn a child agent under the caller. retire: deactivate agent. list: show agents. self: introspect."
                    },
                    "name": {
                        "type": "string",
                        "description": "New agent's visible name (for hire)"
                    },
                    "model": {
                        "type": "string",
                        "description": "Optional model override, e.g. 'anthropic/claude-sonnet-4.6' (for hire)"
                    },
                    "system_prompt": {
                        "type": "string",
                        "description": "Optional persona. Stored as an identity idea on the new agent (for hire)"
                    },
                    "parent_agent_id": {
                        "type": "string",
                        "description": "Parent agent ID — the new agent's position is wired under the parent's primary position. Defaults to the calling agent."
                    },
                    "agent": {
                        "type": "string",
                        "description": "Agent name or ID (for retire)"
                    },
                    "status": {
                        "type": "string",
                        "enum": ["active", "paused", "retired", "all"],
                        "description": "Filter by agent status (for list, default: active)"
                    },
                    "detail": {
                        "type": "string",
                        "enum": ["identity", "tree", "quests", "events", "all"],
                        "description": "Which section to return (for self, default: all)"
                    }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "agents"
    }

    fn is_concurrent_safe(&self, input: &serde_json::Value) -> bool {
        matches!(
            input.get("action").and_then(|v| v.as_str()),
            Some("list") | Some("self")
        )
    }
}
