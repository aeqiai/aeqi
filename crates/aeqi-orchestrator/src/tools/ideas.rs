use aeqi_core::traits::{IdeaQuery, IdeaStore, Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;

use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;

/// Unified ideas tool combining store, search, update, and delete.
pub struct IdeasTool {
    idea_store: Arc<dyn IdeaStore>,
    activity_log: Arc<ActivityLog>,
    agent_registry: Option<Arc<AgentRegistry>>,
    agent_id: Option<String>,
}

impl IdeasTool {
    pub fn new(idea_store: Arc<dyn IdeaStore>, activity_log: Arc<ActivityLog>) -> Self {
        Self {
            idea_store,
            activity_log,
            agent_registry: None,
            agent_id: None,
        }
    }

    /// Attach an agent registry and calling agent ID for scope-aware operations.
    pub fn with_agent_context(mut self, registry: Arc<AgentRegistry>, agent_id: String) -> Self {
        self.agent_registry = Some(registry);
        self.agent_id = Some(agent_id);
        self
    }

    fn parse_tags(args: &serde_json::Value) -> Option<Vec<String>> {
        args.get("tags").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
    }

    async fn action_store(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let key = args
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'name'"))?;
        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing content"))?;
        let tags = Self::parse_tags(args).unwrap_or_else(|| vec!["fact".to_string()]);

        // Resolve scope.
        let scope_str = args.get("scope").and_then(|v| v.as_str()).unwrap_or("self");
        let scope = match scope_str.parse::<aeqi_core::Scope>() {
            Ok(s) => s,
            Err(_) => {
                return Ok(ToolResult::error(format!(
                    "invalid scope {scope_str:?}; use: self, siblings, children, branch, global"
                )));
            }
        };

        // Resolve agent_id with permission check.
        let raw_agent_id = args.get("agent_id").and_then(|v| v.as_str());
        // Resolve calling agent UUID so permission checks and DB writes use stable IDs.
        let calling_uuid: Option<String> = if let Some(registry) = &self.agent_registry {
            if let Some(ref aid) = self.agent_id {
                registry
                    .resolve_by_hint(aid)
                    .await
                    .ok()
                    .flatten()
                    .map(|a| a.id)
            } else {
                None
            }
        } else {
            None
        };
        let agent_id: Option<String> = if scope == aeqi_core::Scope::Global {
            None
        } else {
            match raw_agent_id {
                None => calling_uuid.clone().or_else(|| self.agent_id.clone()),
                Some(tid) => {
                    let caller_id = calling_uuid.as_deref().unwrap_or_default();
                    let is_self = caller_id == tid || self.agent_id.as_deref() == Some(tid);
                    if is_self {
                        calling_uuid.or_else(|| self.agent_id.clone())
                    } else if let Some(registry) = &self.agent_registry {
                        match registry.list_descendants(caller_id).await {
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
                    } else {
                        Some(tid.to_string())
                    }
                }
            }
        };

        match self
            .idea_store
            .store_with_scope(key, content, &tags, agent_id.as_deref(), scope)
            .await
        {
            Ok(id) => {
                // Emit idea_received so lifecycle events can fire.
                if let Some(ref aid) = agent_id {
                    let _ = self
                        .activity_log
                        .emit(
                            "idea_received",
                            Some(aid.as_str()),
                            None,
                            None,
                            &serde_json::json!({"name": key, "idea_id": id}),
                        )
                        .await;
                }
                Ok(ToolResult::success(format!("Stored memory {id} {key}")))
            }
            Err(e) => Ok(ToolResult::error(format!("Failed to store: {e}"))),
        }
    }

    async fn action_search(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let query_text = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing query"))?;
        let top_k = args.get("top_k").and_then(|v| v.as_u64()).unwrap_or(5) as usize;

        let mut query = IdeaQuery::new(query_text, top_k);

        // If the caller requests a specific agent_id, scope to that agent.
        // Otherwise use the full visibility clause so the LLM sees all ideas visible to it.
        if let Some(agent_id) = args.get("agent_id").and_then(|v| v.as_str()) {
            query = query.with_agent(agent_id);
        } else if let (Some(registry), Some(viewer_id)) = (&self.agent_registry, &self.agent_id) {
            // Resolve UUID for visibility clause.
            let viewer_uuid = registry
                .resolve_by_hint(viewer_id)
                .await
                .ok()
                .flatten()
                .map(|a| a.id);
            let viewer_uuid_ref = viewer_uuid.as_deref().unwrap_or(viewer_id.as_str());
            if let Ok((_, bind_params)) =
                crate::scope_visibility::visibility_sql_clause(registry, viewer_uuid_ref).await
            {
                // bind_params from visibility_sql_clause is the flat list of anchor IDs
                // (some IDs appear multiple times across scope levels — deduplicate).
                let unique_ids: Vec<String> = {
                    let mut seen = std::collections::HashSet::new();
                    bind_params
                        .into_iter()
                        .filter(|id| seen.insert(id.clone()))
                        .collect()
                };
                query = query.with_visible_anchors(unique_ids);
            }
        }

        match self.idea_store.search(&query).await {
            Ok(results) if results.is_empty() => Ok(ToolResult::success(format!(
                "No memories found for: {query_text}"
            ))),
            Ok(results) => {
                let mut output = String::new();
                for (i, entry) in results.iter().enumerate() {
                    let age = chrono::Utc::now() - entry.created_at;
                    let age_str = if age.num_days() > 0 {
                        format!("{}d ago", age.num_days())
                    } else if age.num_hours() > 0 {
                        format!("{}h ago", age.num_hours())
                    } else {
                        format!("{}m ago", age.num_minutes())
                    };
                    let tags = if entry.tags.is_empty() {
                        String::new()
                    } else {
                        format!(" [{}]", entry.tags.join(", "))
                    };
                    output.push_str(&format!(
                        "{}. id={} [{}] ({:.2}) {}{} — {}\n",
                        i + 1,
                        entry.id,
                        age_str,
                        entry.score,
                        entry.name,
                        tags,
                        entry.content,
                    ));
                }
                Ok(ToolResult::success(output))
            }
            Err(e) => Ok(ToolResult::error(format!("Search failed: {e}"))),
        }
    }

    async fn action_update(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;
        let name = args.get("name").and_then(|v| v.as_str());
        let content = args.get("content").and_then(|v| v.as_str());
        let tags = Self::parse_tags(args);

        if name.is_none() && content.is_none() && tags.is_none() {
            return Ok(ToolResult::error(
                "Provide at least one of name, content, or tags".to_string(),
            ));
        }

        match self
            .idea_store
            .update(id, name, content, tags.as_deref())
            .await
        {
            Ok(()) => Ok(ToolResult::success(format!("Updated idea {id}"))),
            Err(e) => Ok(ToolResult::error(format!("Failed to update: {e}"))),
        }
    }

    async fn action_delete(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;

        match self.idea_store.delete(id).await {
            Ok(()) => Ok(ToolResult::success(format!("Deleted idea {id}"))),
            Err(e) => Ok(ToolResult::error(format!("Failed to delete: {e}"))),
        }
    }
}

#[async_trait]
impl Tool for IdeasTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'action'"))?;

        match action {
            "store" => self.action_store(&args).await,
            "search" => self.action_search(&args).await,
            "update" => self.action_update(&args).await,
            "delete" => self.action_delete(&args).await,
            other => Ok(ToolResult::error(format!(
                "Unknown action: {other}. Use: store, search, update, delete"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas".to_string(),
            description: "Store, search, update, or delete ideas (semantic memories). Use for facts, preferences, patterns, and context worth remembering. search returns all ideas visible to this agent by default.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["store", "search", "update", "delete"],
                        "description": "store: save a memory (needs name, content). search: find memories (needs query). update: modify an existing idea (needs id plus name/content/tags). delete: remove a memory (needs id)."
                    },
                    "id": { "type": "string", "description": "Idea ID to update or delete (for update, delete)" },
                    "name": { "type": "string", "description": "Short label for the memory, e.g. 'jwt-auth-preference' (for store, update)" },
                    "content": { "type": "string", "description": "The memory content to store or replace (for store, update)" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Tags to store or replace on an idea (for store, update)" },
                    "agent_id": { "type": "string", "description": "Anchor agent for this idea (for store, search). Defaults to calling agent. Must be a descendant of the calling agent." },
                    "scope": {
                        "type": "string",
                        "enum": ["self", "siblings", "children", "branch", "global"],
                        "description": "Visibility scope (for store). Defaults to 'self'. 'global' clears the agent_id anchor."
                    },
                    "query": { "type": "string", "description": "Natural language search query (for search)" },
                    "top_k": { "type": "integer", "description": "Max results to return (for search, default: 5)" }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas"
    }
}
