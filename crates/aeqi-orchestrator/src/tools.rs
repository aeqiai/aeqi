use aeqi_core::traits::Tool;
use aeqi_core::traits::{ToolResult, ToolSpec};
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use aeqi_core::traits::{IdeaQuery, IdeaStore};

// ---------------------------------------------------------------------------
// Helper: format quest detail
// ---------------------------------------------------------------------------

/// Format an `aeqi_quests::Quest` into a human-readable detail string.
fn format_quest_detail(quest: &aeqi_quests::Quest) -> String {
    let mut out = format!(
        "Quest: {} \nStatus: {:?}\nPriority: {}\nSubject: {}\n",
        quest.id, quest.status, quest.priority, quest.name,
    );
    if !quest.description.is_empty() {
        out.push_str(&format!("Description: {}\n", quest.description));
    }
    if let Some(ref agent_id) = quest.agent_id {
        out.push_str(&format!("Agent: {}\n", agent_id));
    }
    if let Some(outcome) = quest.quest_outcome() {
        out.push_str(&format!("Outcome: {}\n", outcome.kind));
        out.push_str(&format!("Outcome summary: {}\n", outcome.summary));
        if let Some(reason) = outcome.reason {
            out.push_str(&format!("Outcome reason: {}\n", reason));
        }
    }
    if quest.retry_count > 0 {
        out.push_str(&format!("Retries: {}\n", quest.retry_count));
    }
    if !quest.checkpoints.is_empty() {
        out.push_str(&format!("Checkpoints: {}\n", quest.checkpoints.len()));
    }
    out
}

// ---------------------------------------------------------------------------
// Helper: OpenRouter / worker usage
// ---------------------------------------------------------------------------

/// Query OpenRouter /api/v1/auth/key and return a formatted credit summary.
pub async fn collect_openrouter_usage(api_key: &str) -> Result<String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()?;

    let resp = client
        .get("https://openrouter.ai/api/v1/auth/key")
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .context("request failed")?;

    let v: serde_json::Value = resp.json().await.context("failed to parse response")?;
    let data = v.get("data").context("no data field in response")?;

    let usage = data.get("usage").and_then(|u| u.as_f64()).unwrap_or(0.0);
    let limit = data.get("limit").and_then(|l| l.as_f64());
    let limit_str = match limit {
        Some(l) => format!("${l:.2}"),
        None => "unlimited".to_string(),
    };

    let mut out = format!("  Spent: ${usage:.4} / {limit_str}\n");

    if let Some(rl) = data.get("rate_limit") {
        let requests = rl.get("requests").and_then(|r| r.as_u64()).unwrap_or(0);
        let interval = rl.get("interval").and_then(|i| i.as_str()).unwrap_or("?");
        out.push_str(&format!("  Rate limit: {requests} req/{interval}\n"));
    }

    Ok(out)
}

/// Read ~/.aeqi/usage.jsonl and return a per-project cost summary.
pub async fn collect_worker_usage() -> Result<String> {
    let path = usage_log_path();

    let content = tokio::fs::read_to_string(&path)
        .await
        .context("no usage log yet")?;

    let mut project_totals: HashMap<String, (f64, usize)> = HashMap::new();
    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
            let project = entry
                .get("project")
                .or_else(|| entry.get("rig"))
                .and_then(|r| r.as_str())
                .unwrap_or("unknown")
                .to_string();
            let cost = entry
                .get("cost_usd")
                .and_then(|c| c.as_f64())
                .unwrap_or(0.0);
            let e = project_totals.entry(project).or_insert((0.0, 0));
            e.0 += cost;
            e.1 += 1;
        }
    }

    if project_totals.is_empty() {
        return Ok("  (no executions logged yet)\n".to_string());
    }

    let mut projects: Vec<_> = project_totals.iter().collect();
    projects.sort_by(|a, b| {
        b.1.0
            .partial_cmp(&a.1.0)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut out = String::new();
    let total_cost: f64 = projects.iter().map(|(_, (c, _))| c).sum();
    for (project, (cost, count)) in &projects {
        out.push_str(&format!("  {project}: ${cost:.4} ({count} runs)\n"));
    }
    out.push_str(&format!("  Total: ${total_cost:.4}\n"));

    Ok(out)
}

pub fn usage_log_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/root"))
        .join(".aeqi")
        .join("usage.jsonl")
}

// ===================================================================
// 1. AGENTS TOOL — hire | retire | list | self
// ===================================================================

/// Unified agents tool combining hire, retire, list, and self-introspection.
pub struct AgentsTool {
    agent_name: String,
    agent_registry: Arc<AgentRegistry>,
    templates_dir: PathBuf,
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
    activity_log: Arc<ActivityLog>,
}

impl AgentsTool {
    pub fn new(
        agent_name: String,
        agent_registry: Arc<AgentRegistry>,
        templates_dir: PathBuf,
        event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            agent_name,
            agent_registry,
            templates_dir,
            event_handler_store,
            activity_log,
        }
    }

    async fn action_hire(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let template = args
            .get("template")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'template'"))?;
        let parent_id = args
            .get("parent_id")
            .and_then(|v| v.as_str())
            .unwrap_or(&self.agent_name);

        let template_path = self.templates_dir.join(template).join("agent.md");
        let content = tokio::fs::read_to_string(&template_path)
            .await
            .with_context(|| format!("failed to read template: {}", template_path.display()))?;

        let agent = self
            .agent_registry
            .spawn_from_template(&content, Some(parent_id))
            .await?;

        // Emit child_added for the parent.
        let _ = self
            .activity_log
            .emit(
                "child_added",
                Some(parent_id),
                None,
                None,
                &serde_json::json!({"child_name": agent.name, "child_id": agent.id}),
            )
            .await;

        Ok(ToolResult::success(format!(
            "Agent hired: {} (id: {}, template: {})",
            agent.name, agent.id, template
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

        // Emit child_removed for the parent.
        if let Some(ref parent_id) = agent.parent_id {
            let _ = self
                .activity_log
                .emit(
                    "child_removed",
                    Some(parent_id),
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
                "- {} (id: {}, display: {}, status: {})\n",
                agent.name,
                agent.id,
                agent.display_name.as_deref().unwrap_or("-"),
                agent.status,
            ));
        }
        Ok(ToolResult::success(output))
    }

    async fn action_self(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let detail = args.get("detail").and_then(|v| v.as_str()).unwrap_or("all");

        let agent = match self
            .agent_registry
            .get_active_by_name(&self.agent_name)
            .await?
        {
            Some(a) => a,
            None => {
                return Ok(ToolResult::error(format!(
                    "Could not find active agent with name: {}",
                    self.agent_name
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
                    "display_name": agent.display_name,
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
                        "display_name": a.display_name,
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
                        "display_name": a.display_name,
                        "status": format!("{}", a.status),
                    })
                })
                .collect();

            result.insert(
                "tree".to_string(),
                serde_json::json!({
                    "parent_id": agent.parent_id,
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
                        "name": q.name,
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
                Actions: hire (spawn from template), retire (deactivate), \
                list (show agents), self (introspect). \
                To delegate work, use quests(action='create')."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["hire", "retire", "list", "self"],
                        "description": "hire: spawn agent from template. retire: deactivate agent. list: show agents. self: introspect."
                    },
                    "template": {
                        "type": "string",
                        "description": "Template directory name, e.g. 'shadow', 'analyst' (for hire)"
                    },
                    "parent_id": {
                        "type": "string",
                        "description": "Parent agent ID — defaults to calling agent (for hire)"
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
                    },
                    "to": {
                        "type": "string",
                        "description": "Target for delegation: 'subagent' for ephemeral child session, or an agent name to create a quest (for delegate)"
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The task or message to delegate (for delegate)"
                    },
                    "skill": {
                        "type": "string",
                        "description": "Optional skill hint for the delegated agent (for delegate)"
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

// ===================================================================
// 2. IDEAS TOOL — store | search | update | delete
// ===================================================================

/// Unified ideas tool combining store, search, update, and delete.
pub struct IdeasTool {
    memory: Arc<dyn IdeaStore>,
    activity_log: Arc<ActivityLog>,
}

impl IdeasTool {
    pub fn new(memory: Arc<dyn IdeaStore>, activity_log: Arc<ActivityLog>) -> Self {
        Self {
            memory,
            activity_log,
        }
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
            .or_else(|| args.get("key"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing name"))?;
        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing content"))?;
        let tags = Self::parse_tags(args).unwrap_or_else(|| vec!["fact".to_string()]);
        let agent_id = args.get("agent_id").and_then(|v| v.as_str());

        match self.memory.store(key, content, &tags, agent_id).await {
            Ok(id) => {
                // Emit idea_received so lifecycle events can fire.
                if let Some(aid) = agent_id {
                    let _ = self
                        .activity_log
                        .emit(
                            "idea_received",
                            Some(aid),
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

        if let Some(agent_id) = args.get("agent_id").and_then(|v| v.as_str()) {
            query = query.with_agent(agent_id);
        }

        match self.memory.search(&query).await {
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
        let name = args
            .get("name")
            .or_else(|| args.get("key"))
            .and_then(|v| v.as_str());
        let content = args.get("content").and_then(|v| v.as_str());
        let tags = Self::parse_tags(args);

        if name.is_none() && content.is_none() && tags.is_none() {
            return Ok(ToolResult::error(
                "Provide at least one of name, content, or tags".to_string(),
            ));
        }

        match self.memory.update(id, name, content, tags.as_deref()).await {
            Ok(()) => Ok(ToolResult::success(format!("Updated idea {id}"))),
            Err(e) => Ok(ToolResult::error(format!("Failed to update: {e}"))),
        }
    }

    async fn action_delete(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;

        match self.memory.delete(id).await {
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
            description: "Store, search, update, or delete ideas (semantic memories). Use for facts, preferences, patterns, and context worth remembering.".to_string(),
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
                    "agent_id": { "type": "string", "description": "Agent ID to scope memories (for store, search)" },
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

// ===================================================================
// 3. QUESTS TOOL — create | list | show | update | close | cancel
// ===================================================================

/// Unified quests tool combining create, list, show, update, close, cancel.
pub struct QuestsTool {
    agent_registry: Arc<AgentRegistry>,
    agent_name: String,
    activity_log: Arc<ActivityLog>,
    /// Session ID of the calling agent, propagated as creator_session_id.
    session_id: Option<String>,
}

impl QuestsTool {
    pub fn new(
        agent_registry: Arc<AgentRegistry>,
        agent_name: String,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            agent_registry,
            agent_name,
            activity_log,
            session_id: None,
        }
    }

    /// Set the session ID of the calling session. Used to propagate
    /// creator_session_id in quest_created events.
    pub fn with_session_id(mut self, id: Option<String>) -> Self {
        self.session_id = id;
        self
    }

    async fn action_create(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let agent_hint = args
            .get("agent")
            .and_then(|v| v.as_str())
            .unwrap_or(&self.agent_name);
        let subject = args
            .get("subject")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing subject"))?;
        let description = args
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let priority_str = args
            .get("priority")
            .and_then(|v| v.as_str())
            .unwrap_or("normal");

        let agent = match self.agent_registry.resolve_by_hint(agent_hint).await {
            Ok(Some(a)) => a,
            Ok(None) => {
                return Ok(ToolResult::error(format!("Agent not found: {agent_hint}")));
            }
            Err(e) => {
                return Ok(ToolResult::error(format!("Failed to resolve agent: {e}")));
            }
        };

        // Parse optional idea_ids from the request.
        let idea_ids: Vec<String> = args
            .get("idea_ids")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        let quest = match self
            .agent_registry
            .create_task(&agent.id, subject, description, &idea_ids, &[])
            .await
        {
            Ok(q) => q,
            Err(e) => {
                return Ok(ToolResult::error(format!("Failed to create quest: {e}")));
            }
        };

        let quest_id = quest.id.0.clone();

        // Broadcast quest_created so the scheduler wakes up immediately.
        // Include creator_session_id so the scheduler can route completion
        // notifications back to the originating session.
        let _ = self
            .activity_log
            .emit(
                "quest_created",
                Some(&agent.id),
                self.session_id.as_deref(),
                Some(&quest_id),
                &serde_json::json!({
                    "subject": subject,
                    "creator_session_id": self.session_id,
                }),
            )
            .await;

        if priority_str != "normal" {
            let priority = match priority_str.to_lowercase().as_str() {
                "low" => aeqi_quests::Priority::Low,
                "high" => aeqi_quests::Priority::High,
                "critical" => aeqi_quests::Priority::Critical,
                _ => aeqi_quests::Priority::Normal,
            };
            if let Err(e) = self
                .agent_registry
                .update_task(&quest_id, |q| {
                    q.priority = priority;
                })
                .await
            {
                return Ok(ToolResult::error(format!(
                    "Quest created ({quest_id}) but failed to set priority: {e}"
                )));
            }
        }

        Ok(ToolResult::success(format!(
            "Created quest {quest_id}: {subject} (agent: {}, priority: {priority_str})",
            agent.name
        )))
    }

    async fn action_list(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let status = args.get("status").and_then(|v| v.as_str());
        let agent_hint = args.get("agent").and_then(|v| v.as_str());

        let agent_id = match agent_hint {
            Some(hint) => match self.agent_registry.resolve_by_hint(hint).await {
                Ok(Some(a)) => Some(a.id),
                Ok(None) => {
                    return Ok(ToolResult::error(format!("Agent not found: {hint}")));
                }
                Err(e) => {
                    return Ok(ToolResult::error(format!("Failed to resolve agent: {e}")));
                }
            },
            None => None,
        };

        let quests = match self
            .agent_registry
            .list_tasks(status, agent_id.as_deref())
            .await
        {
            Ok(q) => q,
            Err(e) => {
                return Ok(ToolResult::error(format!("Failed to list quests: {e}")));
            }
        };

        if quests.is_empty() {
            let mut msg = "No quests found".to_string();
            if let Some(s) = status {
                msg.push_str(&format!(" with status={s}"));
            }
            if let Some(hint) = agent_hint {
                msg.push_str(&format!(" for agent={hint}"));
            }
            msg.push('.');
            return Ok(ToolResult::success(msg));
        }

        let mut out = format!("Found {} quest(s):\n\n", quests.len());
        for q in &quests {
            out.push_str(&format!(
                "- {} [{}] (priority: {}) — {}\n",
                q.id, q.status, q.priority, q.name
            ));
        }
        Ok(ToolResult::success(out))
    }

    async fn action_show(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;

        match self.agent_registry.get_task(quest_id).await {
            Ok(Some(quest)) => Ok(ToolResult::success(format_quest_detail(&quest))),
            Ok(None) => Ok(ToolResult::error(format!("Quest not found: {quest_id}"))),
            Err(e) => Ok(ToolResult::error(format!("Failed to get quest: {e}"))),
        }
    }

    async fn action_update(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let status_str = args.get("status").and_then(|v| v.as_str());
        let priority_str = args.get("priority").and_then(|v| v.as_str());

        if status_str.is_none() && priority_str.is_none() {
            return Ok(ToolResult::error(
                "Provide at least one of 'status' or 'priority' to update.",
            ));
        }

        let status = match status_str {
            Some(s) => {
                let parsed = match s.to_lowercase().as_str() {
                    "pending" => aeqi_quests::QuestStatus::Pending,
                    "in_progress" => aeqi_quests::QuestStatus::InProgress,
                    "done" => aeqi_quests::QuestStatus::Done,
                    "blocked" => aeqi_quests::QuestStatus::Blocked,
                    "cancelled" => aeqi_quests::QuestStatus::Cancelled,
                    _ => {
                        return Ok(ToolResult::error(format!(
                            "Invalid status: {s}. Use: pending, in_progress, done, blocked, cancelled"
                        )));
                    }
                };
                Some(parsed)
            }
            None => None,
        };

        let priority = match priority_str {
            Some(p) => {
                let parsed = match p.to_lowercase().as_str() {
                    "low" => aeqi_quests::Priority::Low,
                    "normal" => aeqi_quests::Priority::Normal,
                    "high" => aeqi_quests::Priority::High,
                    "critical" => aeqi_quests::Priority::Critical,
                    _ => {
                        return Ok(ToolResult::error(format!(
                            "Invalid priority: {p}. Use: low, normal, high, critical"
                        )));
                    }
                };
                Some(parsed)
            }
            None => None,
        };

        if let Some(new_status) = status
            && let Err(e) = self
                .agent_registry
                .update_task_status(quest_id, new_status)
                .await
        {
            return Ok(ToolResult::error(format!(
                "Failed to update quest {quest_id} status: {e}"
            )));
        }

        if let Some(new_priority) = priority
            && let Err(e) = self
                .agent_registry
                .update_task(quest_id, |q| {
                    q.priority = new_priority;
                })
                .await
        {
            return Ok(ToolResult::error(format!(
                "Failed to update quest {quest_id} priority: {e}"
            )));
        }

        let mut msg = format!("Quest {quest_id} updated:");
        if let Some(s) = status_str {
            msg.push_str(&format!(" status={s}"));
        }
        if let Some(p) = priority_str {
            msg.push_str(&format!(" priority={p}"));
        }
        Ok(ToolResult::success(msg))
    }

    async fn action_close(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let result = args
            .get("result")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing result"))?;

        let result_owned = result.to_string();
        match self
            .agent_registry
            .update_task(quest_id, |q| {
                q.status = aeqi_quests::QuestStatus::Done;
                q.set_quest_outcome(&aeqi_quests::QuestOutcomeRecord::new(
                    aeqi_quests::QuestOutcomeKind::Done,
                    &result_owned,
                ));
            })
            .await
        {
            Ok(_) => Ok(ToolResult::success(format!(
                "Quest {quest_id} closed as done."
            ))),
            Err(e) => Ok(ToolResult::error(format!(
                "Failed to close quest {quest_id}: {e}"
            ))),
        }
    }

    async fn action_cancel(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let reason = args
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("Cancelled by agent");

        let reason_owned = reason.to_string();
        match self
            .agent_registry
            .update_task(quest_id, |q| {
                q.status = aeqi_quests::QuestStatus::Cancelled;
                q.set_quest_outcome(&aeqi_quests::QuestOutcomeRecord::new(
                    aeqi_quests::QuestOutcomeKind::Cancelled,
                    &reason_owned,
                ));
            })
            .await
        {
            Ok(_) => Ok(ToolResult::success(format!("Quest {quest_id} cancelled."))),
            Err(e) => Ok(ToolResult::error(format!(
                "Failed to cancel quest {quest_id}: {e}"
            ))),
        }
    }
}

#[async_trait]
impl Tool for QuestsTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'action'"))?;

        match action {
            "create" => self.action_create(&args).await,
            "list" => self.action_list(&args).await,
            "show" => self.action_show(&args).await,
            "update" => self.action_update(&args).await,
            "close" => self.action_close(&args).await,
            "cancel" => self.action_cancel(&args).await,
            other => Ok(ToolResult::error(format!(
                "Unknown action: {other}. Use: create, list, show, update, close, cancel"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests".to_string(),
            description: "Manage quests: create, list, show details, update status/priority, close with result, or cancel.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "show", "update", "close", "cancel"],
                        "description": "create: make a new quest (needs subject). list: show quests (optional status, agent). show: quest details (needs quest_id). update: change status/priority (needs quest_id). close: complete with result (needs quest_id, result). cancel: abort (needs quest_id)."
                    },
                    "quest_id": { "type": "string", "description": "Quest ID (for show/update/close/cancel)" },
                    "subject": { "type": "string", "description": "Quest subject (for create)" },
                    "description": { "type": "string", "description": "Quest description (for create)" },
                    "agent": { "type": "string", "description": "Target agent name (for create, list)" },
                    "status": { "type": "string", "enum": ["pending", "in_progress", "done", "blocked", "cancelled"], "description": "Filter or new status (for list, update)" },
                    "priority": { "type": "string", "enum": ["low", "normal", "high", "critical"], "description": "Priority (for create, update)" },
                    "result": { "type": "string", "description": "Completion result (for close)" },
                    "reason": { "type": "string", "description": "Cancellation reason (for cancel)" }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests"
    }
}

// ===================================================================
// 4. EVENTS TOOL — create | list | enable | disable | delete
// ===================================================================

/// Unified events tool for CRUD on agent-owned event handlers.
/// Renamed from TriggerManageTool; same logic.
pub struct EventsTool {
    event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
    agent_id: String,
}

impl EventsTool {
    pub fn new(
        event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
        agent_id: String,
    ) -> Self {
        Self {
            event_handler_store,
            agent_id,
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
                        context_modifier: None,
                    });
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
                        agent_id: self.agent_id.clone(),
                        name: name.to_string(),
                        pattern: pattern.clone(),
                        idea_ids,
                        cooldown_secs,
                        system: false,
                    })
                    .await
                {
                    Ok(event) => Ok(ToolResult {
                        output: format!(
                            "Event '{}' created (id: {}, pattern: {})",
                            event.name, event.id, event.pattern,
                        ),
                        is_error: false,
                        context_modifier: None,
                    }),
                    Err(e) => Ok(ToolResult {
                        output: format!("Failed to create event: {e}"),
                        is_error: true,
                        context_modifier: None,
                    }),
                }
            }

            "list" => {
                let events = self
                    .event_handler_store
                    .list_for_agent(&self.agent_id)
                    .await
                    .unwrap_or_default();
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
                        context_modifier: None,
                    }),
                    Err(e) => Ok(ToolResult {
                        output: format!("Failed: {e}"),
                        is_error: true,
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
                        context_modifier: None,
                    }),
                    Err(e) => Ok(ToolResult {
                        output: format!("Failed: {e}"),
                        is_error: true,
                        context_modifier: None,
                    }),
                }
            }

            other => Ok(ToolResult {
                output: format!(
                    "Unknown action: {other}. Use: create, list, enable, disable, delete"
                ),
                is_error: true,
                context_modifier: None,
            }),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "events".to_string(),
            description: "Create, list, enable, disable, or delete event handlers for this agent. Events automate recurring quests on a schedule or in response to lifecycle events.".to_string(),
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

// ===================================================================
// 5. SHELL — unchanged (SandboxedShellTool stays as-is)
// ===================================================================

/// Shell tool that executes commands inside a bubblewrap sandbox scoped to a
/// git worktree. Network is disabled; only the worktree is writable.
///
/// Falls back to plain bash execution when bwrap is not enabled.
pub struct SandboxedShellTool {
    sandbox: Arc<crate::sandbox::QuestSandbox>,
    timeout_secs: u64,
}

impl SandboxedShellTool {
    pub fn new(sandbox: Arc<crate::sandbox::QuestSandbox>) -> Self {
        Self {
            sandbox,
            timeout_secs: 120,
        }
    }

    pub fn with_timeout(mut self, timeout_secs: u64) -> Self {
        self.timeout_secs = timeout_secs;
        self
    }
}

#[async_trait]
impl Tool for SandboxedShellTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'command' argument"))?;

        let timeout_ms = args
            .get("timeout")
            .and_then(|v| v.as_u64())
            .unwrap_or(self.timeout_secs * 1000)
            .min(600_000);
        let timeout_dur = std::time::Duration::from_millis(timeout_ms);

        let run_in_background = args
            .get("run_in_background")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        tracing::debug!(
            command = %command,
            sandbox = %self.sandbox.quest_id,
            bwrap = self.sandbox.enable_bwrap,
            timeout_ms,
            run_in_background,
            "executing sandboxed shell command"
        );

        if run_in_background {
            let mut child = self
                .sandbox
                .build_command(command)
                .spawn()
                .map_err(|e| anyhow::anyhow!("failed to spawn background command: {e}"))?;

            let pid = child.id().unwrap_or(0);

            tokio::spawn(async move {
                let _ = child.wait().await;
            });

            return Ok(ToolResult::success(format!(
                "Command started in background. PID: {pid}"
            )));
        }

        let result =
            tokio::time::timeout(timeout_dur, self.sandbox.build_command(command).output()).await;

        match result {
            Ok(Ok(output)) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);

                let mut result_text = String::new();

                if !stdout.is_empty() {
                    result_text.push_str(&stdout);
                }
                if !stderr.is_empty() {
                    if !result_text.is_empty() {
                        result_text.push('\n');
                    }
                    result_text.push_str("STDERR:\n");
                    result_text.push_str(&stderr);
                }

                if result_text.is_empty() {
                    result_text = "(no output)".to_string();
                }

                if result_text.len() > 30000 {
                    result_text.truncate(30000);
                    result_text.push_str("\n... (output truncated)");
                }

                if output.status.success() {
                    Ok(ToolResult::success(result_text))
                } else {
                    Ok(ToolResult::error(format!(
                        "exit code {}\n{}",
                        output.status.code().unwrap_or(-1),
                        result_text
                    )))
                }
            }
            Ok(Err(e)) => Ok(ToolResult::error(format!("failed to execute command: {e}"))),
            Err(_) => Ok(ToolResult::error(format!(
                "command timed out after {timeout_ms}ms"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "shell".to_string(),
            description: "Execute a shell command in the sandboxed workspace. Commands run in an isolated environment with no network access. Only the workspace directory is writable.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The bash command to execute"
                    },
                    "description": {
                        "type": "string",
                        "description": "Clear description of what this command does"
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Timeout in milliseconds (default: 120000, max: 600000)"
                    },
                    "run_in_background": {
                        "type": "boolean",
                        "description": "Run command in background and return immediately"
                    }
                },
                "required": ["command"]
            }),
        }
    }

    fn name(&self) -> &str {
        "shell"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }

    fn cascades_error_to_siblings(&self) -> bool {
        true
    }
}

// ===================================================================
// 6. CODE TOOL — search | graph | transcript | usage
// ===================================================================

/// Unified code intelligence tool combining graph queries, transcript search,
/// and usage statistics.
pub struct CodeTool {
    db_path: Option<PathBuf>,
    session_store: Option<Arc<crate::SessionStore>>,
    api_key: Option<String>,
}

impl CodeTool {
    pub fn new(
        db_path: Option<PathBuf>,
        session_store: Option<Arc<crate::SessionStore>>,
        api_key: Option<String>,
    ) -> Self {
        Self {
            db_path,
            session_store,
            api_key,
        }
    }

    async fn action_graph(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let db_path = match &self.db_path {
            Some(p) => p,
            None => {
                return Ok(ToolResult::error(
                    "code graph not available (no DB path configured)".to_string(),
                ));
            }
        };

        let sub_action = args
            .get("sub_action")
            .and_then(|v| v.as_str())
            .unwrap_or("stats");

        let store = match aeqi_graph::GraphStore::open(db_path) {
            Ok(s) => s,
            Err(e) => return Ok(ToolResult::error(format!("graph DB not available: {e}"))),
        };

        let result = match sub_action {
            "search" => {
                let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
                let results = store.search_nodes(query, limit)?;
                serde_json::json!({
                    "count": results.len(),
                    "nodes": results,
                })
            }
            "context" => {
                let node_id = args.get("node_id").and_then(|v| v.as_str()).unwrap_or("");
                let ctx = store.context(node_id)?;
                serde_json::json!({
                    "node": ctx.node,
                    "callers": ctx.callers,
                    "callees": ctx.callees,
                    "implementors": ctx.implementors,
                })
            }
            "impact" => {
                let node_id = args.get("node_id").and_then(|v| v.as_str()).unwrap_or("");
                let depth = args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as u32;
                let entries = store.impact(&[node_id], depth)?;
                let affected: Vec<serde_json::Value> = entries
                    .iter()
                    .map(|e| {
                        serde_json::json!({
                            "node": e.node.name,
                            "file": e.node.file_path,
                            "depth": e.depth,
                        })
                    })
                    .collect();
                serde_json::json!({"affected": affected})
            }
            "file" => {
                let file_path = args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
                let nodes = store.nodes_in_file(file_path)?;
                serde_json::json!({
                    "file": file_path,
                    "count": nodes.len(),
                    "symbols": nodes,
                })
            }
            "stats" => {
                let stats = store.stats()?;
                serde_json::json!({"stats": format!("{stats:?}")})
            }
            _ => {
                return Ok(ToolResult::error(format!(
                    "unknown graph sub_action: {sub_action}. Use: search, context, impact, file, stats"
                )));
            }
        };

        Ok(ToolResult::success(serde_json::to_string_pretty(&result)?))
    }

    async fn action_transcript(&self, args: &serde_json::Value) -> Result<ToolResult> {
        let ss = match &self.session_store {
            Some(s) => s,
            None => {
                return Ok(ToolResult::error(
                    "transcript search not available (no session store configured)".to_string(),
                ));
            }
        };

        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("'query' is required"))?;
        let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

        match ss.search_transcripts(query, limit).await {
            Ok(messages) => {
                if messages.is_empty() {
                    return Ok(ToolResult {
                        output: "No transcript matches found.".to_string(),
                        is_error: false,
                        context_modifier: None,
                    });
                }
                let results: Vec<String> = messages
                    .iter()
                    .map(|m| {
                        let preview: String = m.content.chars().take(200).collect();
                        format!(
                            "[{}] {}: {}",
                            m.timestamp.format("%Y-%m-%d %H:%M"),
                            m.role,
                            preview
                        )
                    })
                    .collect();
                Ok(ToolResult {
                    output: format!("{} matches:\n{}", results.len(), results.join("\n\n")),
                    is_error: false,
                    context_modifier: None,
                })
            }
            Err(e) => Ok(ToolResult {
                output: format!("Transcript search failed: {e}"),
                is_error: true,
                context_modifier: None,
            }),
        }
    }

    async fn action_search(&self, args: &serde_json::Value) -> Result<ToolResult> {
        // Convenience: "search" dispatches to graph search by default.
        self.action_graph(&{
            let mut a = args.clone();
            a.as_object_mut()
                .map(|m| m.insert("sub_action".to_string(), serde_json::json!("search")));
            a
        })
        .await
    }

    async fn action_usage(&self) -> Result<ToolResult> {
        let mut output = String::new();

        output.push_str("**OpenRouter API Key**\n");
        match &self.api_key {
            Some(key) => match collect_openrouter_usage(key).await {
                Ok(s) => output.push_str(&s),
                Err(e) => output.push_str(&format!("  Error fetching key info: {e}\n")),
            },
            None => output.push_str("  (API key not configured)\n"),
        }
        output.push('\n');

        output.push_str("**Worker Executions (all time)**\n");
        match collect_worker_usage().await {
            Ok(s) => output.push_str(&s),
            Err(_) => output.push_str("  (no executions logged yet)\n"),
        }

        Ok(ToolResult::success(output))
    }
}

#[async_trait]
impl Tool for CodeTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'action'"))?;

        match action {
            "search" => self.action_search(&args).await,
            "graph" => self.action_graph(&args).await,
            "transcript" => self.action_transcript(&args).await,
            "usage" => self.action_usage().await,
            other => Ok(ToolResult::error(format!(
                "Unknown action: {other}. Use: search, graph, transcript, usage"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "code".to_string(),
            description: "Code intelligence, transcript search, and usage stats. search: FTS symbol search. graph: advanced queries (sub_action: search/context/impact/file/stats). transcript: search past session transcripts. usage: API key and worker cost stats.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["search", "graph", "transcript", "usage"],
                        "description": "search: quick FTS symbol search (needs query). graph: advanced graph queries (needs sub_action). transcript: search past sessions (needs query). usage: API/worker cost stats."
                    },
                    "sub_action": {
                        "type": "string",
                        "enum": ["search", "context", "impact", "file", "stats"],
                        "description": "Graph sub-action (for action=graph): search, context, impact, file, stats"
                    },
                    "query": { "type": "string", "description": "Search query (for search, graph/search, transcript)" },
                    "node_id": { "type": "string", "description": "Node ID (for graph context/impact)" },
                    "file_path": { "type": "string", "description": "File path (for graph file)" },
                    "depth": { "type": "integer", "description": "Impact depth (for graph impact, default 3)" },
                    "limit": { "type": "integer", "description": "Max results (default 10)" }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "code"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

// ===================================================================
// build_orchestration_tools — creates the consolidated orchestration tools
// ===================================================================

pub fn build_orchestration_tools(
    agent_name: String,
    activity_log: Arc<ActivityLog>,
    api_key: Option<String>,
    memory: Option<Arc<dyn IdeaStore>>,
    graph_db_path: Option<PathBuf>,
    session_store: Option<Arc<crate::SessionStore>>,
    agent_registry: Arc<crate::agent_registry::AgentRegistry>,
) -> Vec<Arc<dyn Tool>> {
    let templates_dir = std::env::current_dir().unwrap_or_default().join("agents");
    let event_handler_store = Arc::new(crate::event_handler::EventHandlerStore::new(
        agent_registry.db(),
    ));

    // 1. Agents tool (hire/retire/list/self)
    let agents_tool = AgentsTool::new(
        agent_name.clone(),
        agent_registry.clone(),
        templates_dir,
        Some(event_handler_store.clone()),
        activity_log.clone(),
    );

    // 2. Quests tool (create/list/show/update/close/cancel)
    let quests_tool = QuestsTool::new(
        agent_registry.clone(),
        agent_name.clone(),
        activity_log.clone(),
    );

    // 3. Events tool (create/list/enable/disable/delete)
    let events_tool = EventsTool::new(event_handler_store, agent_name);

    // 4. Code tool (search/graph/transcript/usage)
    let code_tool = CodeTool::new(graph_db_path, session_store, api_key);

    let mut tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(agents_tool),
        Arc::new(quests_tool),
        Arc::new(events_tool),
        Arc::new(code_tool),
    ];

    // 5. Ideas tool (store/search/update/delete)
    if let Some(mem) = memory {
        tools.push(Arc::new(IdeasTool::new(mem, activity_log)));
    } else {
        tracing::warn!("ideas tool unavailable: no memory backend configured");
    }

    // 6. Web tool (fetch/search)
    tools.push(Arc::new(WebTool));

    tools
}

// ---------------------------------------------------------------------------
// WebTool — consolidated web fetch + search
// ---------------------------------------------------------------------------

pub struct WebTool;

#[async_trait]
impl Tool for WebTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("fetch");
        match action {
            "fetch" => {
                let tool = aeqi_tools::WebFetchTool;
                tool.execute(args).await
            }
            "search" => {
                let tool = aeqi_tools::WebSearchTool;
                tool.execute(args).await
            }
            other => Ok(ToolResult::error(format!(
                "unknown web action '{other}'. Use: fetch, search"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "web".to_string(),
            description: "Web access: fetch a URL or search the internet.\n\n\
                Actions:\n\
                - fetch: retrieve a web page as readable text (needs: url)\n\
                - search: search the web via DuckDuckGo (needs: query)"
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["fetch", "search"],
                        "description": "fetch: get a URL. search: web search."
                    },
                    "url": {
                        "type": "string",
                        "description": "URL to fetch (for fetch action)"
                    },
                    "query": {
                        "type": "string",
                        "description": "Search query (for search action)"
                    },
                    "max_length": {
                        "type": "integer",
                        "description": "Max response length in chars (for fetch)"
                    }
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "web"
    }
}
