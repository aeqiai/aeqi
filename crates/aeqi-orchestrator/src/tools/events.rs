use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;

use crate::agent_registry::AgentRegistry;

/// Unified events tool for CRUD on agent-owned event handlers.
/// Renamed from TriggerManageTool; same logic.
pub struct EventsTool {
    event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
    agent_id: String,
    agent_registry: Arc<AgentRegistry>,
}

impl EventsTool {
    pub fn new(
        event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
        agent_id: String,
        agent_registry: Arc<AgentRegistry>,
    ) -> Self {
        Self {
            event_handler_store,
            agent_id,
            agent_registry,
        }
    }
}

#[async_trait]
impl Tool for EventsTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("list");

        match action {
            "create" => {
                let name = args
                    .get("name")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("'name' is required"))?;
                let cooldown_secs = args
                    .get("cooldown_secs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let pattern = if let Some(schedule) = args.get("schedule").and_then(|v| v.as_str())
                {
                    format!("schedule:{schedule}")
                } else if let Some(event) = args.get("event_pattern").and_then(|v| v.as_str()) {
                    format!("session:{event}")
                } else if let Some(p) = args.get("pattern").and_then(|v| v.as_str()) {
                    p.to_string()
                } else {
                    return Ok(ToolResult {
                        output: "provide 'schedule', 'event_pattern', or 'pattern'".to_string(),
                        is_error: true,
                        data: serde_json::Value::Null,
                        context_modifier: None,
                    });
                };

                // Resolve agent_id and scope for the new event.
                let scope_str = args.get("scope").and_then(|v| v.as_str()).unwrap_or("self");
                let scope = match scope_str.parse::<aeqi_core::Scope>() {
                    Ok(s) => s,
                    Err(_) => {
                        return Ok(ToolResult::error(format!(
                            "invalid scope {scope_str:?}; use: self, siblings, children, branch, global"
                        )));
                    }
                };

                let target_agent_id = args.get("agent_id").and_then(|v| v.as_str());
                // The calling agent is bound to this tool instance by UUID.
                let calling_uuid = Some(self.agent_id.clone());
                let resolved_agent_id = match target_agent_id {
                    None => calling_uuid
                        .as_deref()
                        .map(str::to_string)
                        .or(Some(self.agent_id.clone())),
                    Some(tid) => {
                        let is_self = calling_uuid.as_deref() == Some(tid);
                        if is_self {
                            calling_uuid
                                .as_deref()
                                .map(str::to_string)
                                .or(Some(self.agent_id.clone()))
                        } else {
                            // Permission check: target must be a descendant of the calling agent.
                            let caller = calling_uuid.as_deref().unwrap_or(&self.agent_id);
                            match self.agent_registry.list_descendants(caller).await {
                                Ok(descendants) if descendants.iter().any(|d| d == tid) => {
                                    Some(tid.to_string())
                                }
                                Ok(_) => {
                                    return Ok(ToolResult::error(format!(
                                        "agent_id {tid:?} is not a descendant of the calling agent"
                                    )));
                                }
                                Err(e) => {
                                    return Ok(ToolResult::error(format!(
                                        "failed to verify agent_id: {e}"
                                    )));
                                }
                            }
                        }
                    }
                };

                // Global scope: no anchor agent.
                let event_agent_id = if scope == aeqi_core::Scope::Global {
                    None
                } else {
                    resolved_agent_id
                };

                let idea_ids: Vec<String> = args
                    .get("idea_ids")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();

                match self
                    .event_handler_store
                    .create(&crate::event_handler::NewEvent {
                        agent_id: event_agent_id,
                        scope,
                        name: name.to_string(),
                        pattern: pattern.clone(),
                        idea_ids,
                        cooldown_secs,
                        ..Default::default()
                    })
                    .await
                {
                    Ok(event) => Ok(ToolResult {
                        output: format!(
                            "Event '{}' created (id: {}, pattern: {})",
                            event.name, event.id, event.pattern,
                        ),
                        is_error: false,
                        data: serde_json::Value::Null,
                        context_modifier: None,
                    }),
                    Err(e) => Ok(ToolResult {
                        output: format!("Failed to create event: {e}"),
                        is_error: true,
                        data: serde_json::Value::Null,
                        context_modifier: None,
                    }),
                }
            }

            "list" => {
                let events = match Some(self.agent_id.as_str()) {
                    Some(uuid) => {
                        match crate::scope_visibility::visibility_sql_clause(
                            &self.agent_registry,
                            uuid,
                        )
                        .await
                        {
                            Ok((clause, bind_params)) => self
                                .event_handler_store
                                .list_visible_to(&clause, &bind_params)
                                .await
                                .unwrap_or_default(),
                            Err(_) => self
                                .event_handler_store
                                .list_for_agent(uuid)
                                .await
                                .unwrap_or_default(),
                        }
                    }
                    None => self
                        .event_handler_store
                        .list_for_agent(&self.agent_id)
                        .await
                        .unwrap_or_default(),
                };
                let items: Vec<String> = events
                    .iter()
                    .map(|e| {
                        let ideas = if e.idea_ids.is_empty() {
                            String::new()
                        } else {
                            format!(", idea_ids: [{}]", e.idea_ids.join(", "))
                        };
                        format!(
                            "- {} (id: {}, pattern: {}, enabled: {}, fires: {}{})",
                            e.name, e.id, e.pattern, e.enabled, e.fire_count, ideas
                        )
                    })
                    .collect();
                Ok(ToolResult {
                    output: if items.is_empty() {
                        "No events.".to_string()
                    } else {
                        items.join("\n")
                    },
                    is_error: false,
                    data: serde_json::Value::Null,
                    context_modifier: None,
                })
            }

            "enable" | "disable" => {
                let id = args
                    .get("event_id")
                    .or_else(|| args.get("trigger_id"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("'event_id' is required"))?;
                let enabled = action == "enable";
                match self.event_handler_store.set_enabled(id, enabled).await {
                    Ok(()) => Ok(ToolResult {
                        output: format!(
                            "Event {id} {}.",
                            if enabled { "enabled" } else { "disabled" }
                        ),
                        is_error: false,
                        data: serde_json::Value::Null,
                        context_modifier: None,
                    }),
                    Err(e) => Ok(ToolResult {
                        output: format!("Failed: {e}"),
                        is_error: true,
                        data: serde_json::Value::Null,
                        context_modifier: None,
                    }),
                }
            }

            "delete" => {
                let id = args
                    .get("event_id")
                    .or_else(|| args.get("trigger_id"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("'event_id' is required"))?;
                match self.event_handler_store.delete(id).await {
                    Ok(()) => Ok(ToolResult {
                        output: format!("Event {id} deleted."),
                        is_error: false,
                        data: serde_json::Value::Null,
                        context_modifier: None,
                    }),
                    Err(e) => Ok(ToolResult {
                        output: format!("Failed: {e}"),
                        is_error: true,
                        data: serde_json::Value::Null,
                        context_modifier: None,
                    }),
                }
            }

            other => Ok(ToolResult {
                output: format!(
                    "Unknown action: {other}. Use: create, list, enable, disable, delete"
                ),
                is_error: true,
                data: serde_json::Value::Null,
                context_modifier: None,
            }),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "events".to_string(),
            description: "Create, list, enable, disable, or delete event handlers. Events automate recurring quests on a schedule or in response to lifecycle events. list returns all events visible to this agent (own + scoped).".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "enable", "disable", "delete"],
                        "description": "Action to perform"
                    },
                    "name": {
                        "type": "string",
                        "description": "Event handler name (for create)"
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Full pattern string (e.g. 'schedule:0 9 * * *', 'session:quest_result')"
                    },
                    "schedule": {
                        "type": "string",
                        "description": "Cron expression or interval (e.g., '0 9 * * *') — shorthand for pattern 'schedule:<expr>'"
                    },
                    "event_pattern": {
                        "type": "string",
                        "description": "Lifecycle event (e.g. 'quest_completed') — shorthand for pattern 'session:<event>'"
                    },
                    "content": {
                        "type": "string",
                        "description": "Inline instruction to run when the event fires"
                    },
                    "cooldown_secs": {
                        "type": "integer",
                        "description": "Minimum seconds between fires"
                    },
                    "max_budget_usd": {
                        "type": "number",
                        "description": "Maximum budget per execution in USD"
                    },
                    "event_id": {
                        "type": "string",
                        "description": "Event handler ID (for enable/disable/delete)"
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "Anchor agent for the event (for create). Defaults to calling agent. Must be a descendant of the calling agent."
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["self", "siblings", "children", "branch", "global"],
                        "description": "Visibility scope (for create). Defaults to 'self'. 'global' clears agent_id anchor."
                    }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "events"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}
