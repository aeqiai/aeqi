use aeqi_core::traits::Tool;
use aeqi_core::traits::{Channel, ToolResult, ToolSpec};
use anyhow::{Context, Result};
use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::agent_registry::AgentRegistry;
use crate::activity_log::ActivityLog;
use aeqi_core::traits::{IdeaStore, IdeaCategory, IdeaQuery};

/// Tool that surfaces OpenRouter key usage and per-project worker execution
/// costs aggregated from `~/.aeqi/usage.jsonl`.
pub struct UsageStatsTool {
    api_key: Option<String>,
}

impl UsageStatsTool {
    pub fn new(api_key: Option<String>) -> Self {
        Self { api_key }
    }
}

#[async_trait]
impl Tool for UsageStatsTool {
    async fn execute(&self, _args: serde_json::Value) -> Result<ToolResult> {
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "usage_stats".to_string(),
            description:
                "Get OpenRouter API key credit usage and per-project worker execution costs."
                    .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    fn name(&self) -> &str {
        "usage_stats"
    }
}

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

pub struct IdeaStoreTool {
    memory: Arc<dyn IdeaStore>,
}

impl IdeaStoreTool {
    pub fn new(memory: Arc<dyn IdeaStore>) -> Self {
        Self { memory }
    }
}

#[async_trait]
impl Tool for IdeaStoreTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let key = args
            .get("key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing key"))?;
        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing content"))?;
        let category = match args.get("category").and_then(|v| v.as_str()) {
            Some("procedure") => IdeaCategory::Procedure,
            Some("preference") => IdeaCategory::Preference,
            Some("context") => IdeaCategory::Context,
            Some("evergreen") => IdeaCategory::Evergreen,
            _ => IdeaCategory::Fact,
        };
        let agent_id = args.get("agent_id").and_then(|v| v.as_str());

        match self.memory.store(key, content, category, agent_id).await {
            Ok(id) => Ok(ToolResult::success(format!("Stored memory {id} {key}"))),
            Err(e) => Ok(ToolResult::error(format!("Failed to store: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas_store".to_string(),
            description: "Store a memory with semantic embeddings for later recall. Use for facts, preferences, patterns, and context worth remembering.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "key": { "type": "string", "description": "Short label for the memory (e.g. 'jwt-auth-preference')" },
                    "content": { "type": "string", "description": "The memory content to store" },
                    "category": { "type": "string", "enum": ["fact", "procedure", "preference", "context", "evergreen"], "description": "Memory category (default: fact)" },
                    "agent_id": { "type": "string", "description": "Agent ID to associate with this memory" }
                },
                "required": ["key", "content"]
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas_store"
    }
}

pub struct IdeaRecallTool {
    memory: Arc<dyn IdeaStore>,
}

impl IdeaRecallTool {
    pub fn new(memory: Arc<dyn IdeaStore>) -> Self {
        Self { memory }
    }
}

#[async_trait]
impl Tool for IdeaRecallTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
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
                    output.push_str(&format!(
                        "{}. [{}] ({:.2}) {} — {}\n",
                        i + 1,
                        age_str,
                        entry.score,
                        entry.key,
                        entry.content,
                    ));
                }
                Ok(ToolResult::success(output))
            }
            Err(e) => Ok(ToolResult::error(format!("Search failed: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas_recall".to_string(),
            description: "Search memories using semantic similarity + keyword matching. Returns the most relevant memories ranked by hybrid score.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Natural language search query" },
                    "top_k": { "type": "integer", "description": "Max results to return (default: 5)" },
                    "agent_id": { "type": "string", "description": "Filter to a specific agent's memories" }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas_recall"
    }
}

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
    if let Some(outcome) = quest.task_outcome() {
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

/// Tool for reading full quest details by ID.
pub struct QuestDetailTool {
    agent_registry: Arc<AgentRegistry>,
}

impl QuestDetailTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for QuestDetailTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests_show".to_string(),
            description: "Read full details of a quest by its ID.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "quest_id": { "type": "string", "description": "Quest ID (e.g. 'as-001')" }
                },
                "required": ["quest_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests_show"
    }
}

/// Tool for cancelling a quest by ID.
pub struct QuestCancelTool {
    agent_registry: Arc<AgentRegistry>,
}

impl QuestCancelTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for QuestCancelTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let reason = args
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("Cancelled by leader agent");

        let reason_owned = reason.to_string();
        match self
            .agent_registry
            .update_task(quest_id, |q| {
                q.status = aeqi_quests::QuestStatus::Cancelled;
                q.set_task_outcome(&aeqi_quests::QuestOutcomeRecord::new(
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests_cancel".to_string(),
            description: "Cancel a quest by its ID.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "quest_id": { "type": "string", "description": "Quest ID to cancel" },
                    "reason": { "type": "string", "description": "Reason for cancellation" }
                },
                "required": ["quest_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests_cancel"
    }
}

/// Tool for reprioritizing a quest.
pub struct QuestReprioritizeTool {
    agent_registry: Arc<AgentRegistry>,
}

impl QuestReprioritizeTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for QuestReprioritizeTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let priority_str = args
            .get("priority")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing priority"))?;

        let priority = match priority_str.to_lowercase().as_str() {
            "low" => aeqi_quests::Priority::Low,
            "normal" => aeqi_quests::Priority::Normal,
            "high" => aeqi_quests::Priority::High,
            "critical" => aeqi_quests::Priority::Critical,
            _ => {
                return Ok(ToolResult::error(format!(
                    "Invalid priority: {priority_str}. Use: low, normal, high, critical"
                )));
            }
        };

        match self
            .agent_registry
            .update_task(quest_id, |q| {
                q.priority = priority;
            })
            .await
        {
            Ok(_) => Ok(ToolResult::success(format!(
                "Quest {quest_id} reprioritized to {priority}."
            ))),
            Err(e) => Ok(ToolResult::error(format!(
                "Failed to reprioritize quest {quest_id}: {e}"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests_prioritize".to_string(),
            description: "Change the priority of a quest.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "quest_id": { "type": "string", "description": "Quest ID to reprioritize" },
                    "priority": { "type": "string", "enum": ["low", "normal", "high", "critical"], "description": "New priority level" }
                },
                "required": ["quest_id", "priority"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests_prioritize"
    }
}

// ---------------------------------------------------------------------------
// Quest CRUD tools (SQLite-backed via AgentRegistry)
// ---------------------------------------------------------------------------

/// Create a quest on self or a named agent.
pub struct QuestCreateTool {
    agent_registry: Arc<AgentRegistry>,
    agent_name: String,
}

impl QuestCreateTool {
    pub fn new(agent_registry: Arc<AgentRegistry>, agent_name: String) -> Self {
        Self {
            agent_registry,
            agent_name,
        }
    }
}

#[async_trait]
impl Tool for QuestCreateTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
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

        // Resolve agent name/hint to a registered agent.
        let agent = match self.agent_registry.resolve_by_hint(agent_hint).await {
            Ok(Some(a)) => a,
            Ok(None) => {
                return Ok(ToolResult::error(format!(
                    "Agent not found: {agent_hint}"
                )));
            }
            Err(e) => {
                return Ok(ToolResult::error(format!(
                    "Failed to resolve agent: {e}"
                )));
            }
        };

        let quest = match self
            .agent_registry
            .create_task(&agent.id, subject, description, None, &[])
            .await
        {
            Ok(q) => q,
            Err(e) => {
                return Ok(ToolResult::error(format!(
                    "Failed to create quest: {e}"
                )));
            }
        };

        // Apply non-default priority if requested.
        let quest_id = quest.id.0.clone();
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests_create".to_string(),
            description: "Create a new quest on self or a named agent.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "agent": { "type": "string", "description": "Agent name or ID (defaults to self)" },
                    "subject": { "type": "string", "description": "Short title for the quest" },
                    "description": { "type": "string", "description": "Detailed description of the quest" },
                    "priority": { "type": "string", "enum": ["low", "normal", "high", "critical"], "description": "Priority level (default: normal)" }
                },
                "required": ["subject"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests_create"
    }
}

/// List quests filtered by status and/or agent.
pub struct QuestListTool {
    agent_registry: Arc<AgentRegistry>,
}

impl QuestListTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for QuestListTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let status = args.get("status").and_then(|v| v.as_str());
        let agent_hint = args.get("agent").and_then(|v| v.as_str());

        // Resolve agent hint to agent ID if provided.
        let agent_id = match agent_hint {
            Some(hint) => match self.agent_registry.resolve_by_hint(hint).await {
                Ok(Some(a)) => Some(a.id),
                Ok(None) => {
                    return Ok(ToolResult::error(format!(
                        "Agent not found: {hint}"
                    )));
                }
                Err(e) => {
                    return Ok(ToolResult::error(format!(
                        "Failed to resolve agent: {e}"
                    )));
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
                return Ok(ToolResult::error(format!(
                    "Failed to list quests: {e}"
                )));
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests_list".to_string(),
            description: "List quests, optionally filtered by status and/or agent.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "status": { "type": "string", "enum": ["pending", "in_progress", "done", "blocked", "cancelled"], "description": "Filter by quest status" },
                    "agent": { "type": "string", "description": "Filter by agent name or ID" }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "quests_list"
    }
}

/// Update a quest's status.
pub struct QuestUpdateTool {
    agent_registry: Arc<AgentRegistry>,
}

impl QuestUpdateTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for QuestUpdateTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let quest_id = args
            .get("quest_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing quest_id"))?;
        let status_str = args
            .get("status")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing status"))?;

        let status = match status_str.to_lowercase().as_str() {
            "pending" => aeqi_quests::QuestStatus::Pending,
            "in_progress" => aeqi_quests::QuestStatus::InProgress,
            "done" => aeqi_quests::QuestStatus::Done,
            "blocked" => aeqi_quests::QuestStatus::Blocked,
            "cancelled" => aeqi_quests::QuestStatus::Cancelled,
            _ => {
                return Ok(ToolResult::error(format!(
                    "Invalid status: {status_str}. Use: pending, in_progress, done, blocked, cancelled"
                )));
            }
        };

        match self
            .agent_registry
            .update_task_status(quest_id, status)
            .await
        {
            Ok(()) => Ok(ToolResult::success(format!(
                "Quest {quest_id} status updated to {status_str}."
            ))),
            Err(e) => Ok(ToolResult::error(format!(
                "Failed to update quest {quest_id}: {e}"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests_update".to_string(),
            description: "Update a quest's status.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "quest_id": { "type": "string", "description": "Quest ID (e.g. 'as-001')" },
                    "status": { "type": "string", "enum": ["pending", "in_progress", "done", "blocked", "cancelled"], "description": "New status" }
                },
                "required": ["quest_id", "status"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests_update"
    }
}

/// Complete a quest with a result summary.
pub struct QuestCloseTool {
    agent_registry: Arc<AgentRegistry>,
}

impl QuestCloseTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for QuestCloseTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
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
                q.set_task_outcome(&aeqi_quests::QuestOutcomeRecord::new(
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quests_close".to_string(),
            description: "Complete a quest with a result summary.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "quest_id": { "type": "string", "description": "Quest ID to close" },
                    "result": { "type": "string", "description": "Text summary of the quest result" }
                },
                "required": ["quest_id", "result"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quests_close"
    }
}

/// Tool for posting/querying shared insights and claiming resources via quests.
///
/// post/query/get/delete operate on the idea store.
/// claim/release operate on quests via agent_registry.
pub struct NotesTool {
    idea_store: Arc<dyn IdeaStore>,
    agent_registry: Arc<crate::agent_registry::AgentRegistry>,
    agent_name: String,
}

impl NotesTool {
    pub fn new(
        idea_store: Arc<dyn IdeaStore>,
        agent_registry: Arc<crate::agent_registry::AgentRegistry>,
        agent_name: String,
    ) -> Self {
        Self {
            idea_store,
            agent_registry,
            agent_name,
        }
    }
}

#[async_trait]
impl Tool for NotesTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("query");

        match action {
            "post" => {
                let key = args
                    .get("key")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing key"))?;
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing content"))?;

                match self
                    .idea_store
                    .store(key, content, aeqi_core::traits::IdeaCategory::Fact, None)
                    .await
                {
                    Ok(id) => Ok(ToolResult::success(format!(
                        "Stored idea: {key} (id: {id})"
                    ))),
                    Err(e) => Ok(ToolResult::error(format!("Failed to store: {e}"))),
                }
            }
            "query" => {
                let query_text = args
                    .get("tags")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .filter(|s| !s.is_empty())
                    .or_else(|| args.get("key").and_then(|v| v.as_str()).map(String::from))
                    .unwrap_or_else(|| "*".to_string());
                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

                let q = aeqi_core::traits::IdeaQuery::new(&query_text, limit);
                match self.idea_store.search(&q).await {
                    Ok(entries) if entries.is_empty() => {
                        Ok(ToolResult::success("No matching entries."))
                    }
                    Ok(entries) => {
                        let mut out = String::new();
                        for e in &entries {
                            out.push_str(&format!(
                                "{}: {} (by {})\n",
                                e.key,
                                e.content,
                                e.agent_id.as_deref().unwrap_or("system"),
                            ));
                        }
                        Ok(ToolResult::success(out))
                    }
                    Err(e) => Ok(ToolResult::error(format!("Query failed: {e}"))),
                }
            }
            "get" => {
                let key = args
                    .get("key")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing key"))?;

                let q = aeqi_core::traits::IdeaQuery::new(key, 5);
                match self.idea_store.search(&q).await {
                    Ok(entries) => {
                        if let Some(e) = entries.into_iter().find(|e| e.key == key) {
                            Ok(ToolResult::success(format!(
                                "{}: {} (by {})",
                                e.key,
                                e.content,
                                e.agent_id.as_deref().unwrap_or("system"),
                            )))
                        } else {
                            Ok(ToolResult::success(format!(
                                "No entry found for key: {key}"
                            )))
                        }
                    }
                    Err(e) => Ok(ToolResult::error(format!("Get failed: {e}"))),
                }
            }
            "claim" => {
                let resource = args
                    .get("resource")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing resource"))?;
                let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let claim_label = format!("claim:{resource}");

                // Check for existing in-progress claim quest.
                let existing = self
                    .agent_registry
                    .list_tasks(Some("in_progress"), None)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .find(|t| t.labels.contains(&claim_label));

                match existing {
                    Some(task) => {
                        let holder = task.agent_id.as_deref().unwrap_or("unknown");
                        if holder == self.agent_name {
                            Ok(ToolResult::success(format!("Renewed claim: {resource}")))
                        } else {
                            Ok(ToolResult::success(format!(
                                "BLOCKED — {resource} is claimed by {holder}: {}",
                                task.description
                            )))
                        }
                    }
                    None => {
                        let agent_id = self
                            .agent_registry
                            .resolve_by_hint(&self.agent_name)
                            .await
                            .ok()
                            .flatten()
                            .map(|a| a.name.clone())
                            .unwrap_or_else(|| self.agent_name.clone());
                        match self
                            .agent_registry
                            .create_task(
                                &agent_id,
                                &format!("claim: {resource}"),
                                content,
                                None,
                                &[claim_label],
                            )
                            .await
                        {
                            Ok(task) => {
                                let _ = self
                                    .agent_registry
                                    .update_task_status(
                                        &task.id.0,
                                        aeqi_quests::QuestStatus::InProgress,
                                    )
                                    .await;
                                Ok(ToolResult::success(format!("Claimed: {resource}")))
                            }
                            Err(e) => Ok(ToolResult::error(format!("Claim failed: {e}"))),
                        }
                    }
                }
            }
            "release" => {
                let resource = args
                    .get("resource")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing resource"))?;
                let claim_label = format!("claim:{resource}");

                let existing = self
                    .agent_registry
                    .list_tasks(Some("in_progress"), None)
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .find(|t| t.labels.contains(&claim_label));

                match existing {
                    Some(task) => {
                        match self
                            .agent_registry
                            .update_task_status(&task.id.0, aeqi_quests::QuestStatus::Done)
                            .await
                        {
                            Ok(()) => Ok(ToolResult::success(format!("Released: {resource}"))),
                            Err(e) => Ok(ToolResult::error(format!("Release failed: {e}"))),
                        }
                    }
                    None => Ok(ToolResult::success(format!(
                        "No active claim found for: {resource}"
                    ))),
                }
            }
            "delete" => {
                let key = args
                    .get("key")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing key"))?;

                let q = aeqi_core::traits::IdeaQuery::new(key, 5);
                match self.idea_store.search(&q).await {
                    Ok(entries) => {
                        let mut deleted = false;
                        for e in &entries {
                            if e.key == key {
                                let _ = self.idea_store.delete(&e.id).await;
                                deleted = true;
                            }
                        }
                        if deleted {
                            Ok(ToolResult::success(format!("Deleted: {key}")))
                        } else {
                            Ok(ToolResult::success(format!("No entry found for: {key}")))
                        }
                    }
                    Err(e) => Ok(ToolResult::error(format!("Delete failed: {e}"))),
                }
            }
            _ => Ok(ToolResult::error(format!(
                "Unknown action: {action}. Use: post, query, get, claim, release, delete"
            ))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notes".to_string(),
            description: "Shared coordination surface. Post discoveries, claim resources, signal state, query entries. Actions: post (store idea), query (search), get (lookup by key), claim (exclusive resource lock via quest), release (drop claim), delete (remove entry).".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["post", "query", "get", "claim", "release", "delete"], "description": "Action to perform (default: query)" },
                    "key": { "type": "string", "description": "Key for post/get/delete" },
                    "resource": { "type": "string", "description": "Resource path for claim/release (e.g. src/api/auth.rs)" },
                    "content": { "type": "string", "description": "Content to post or claim description" },
                    "tags": { "type": "array", "items": { "type": "string" }, "description": "Tags for filtering/categorization" },
                    "limit": { "type": "integer", "description": "Max results for query (default: 10)" },
                    "force": { "type": "boolean", "description": "Force release even if claimed by another agent" }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "notes"
    }
}

// ---------------------------------------------------------------------------
// AgentsHireTool — spawn a child agent from a template
// ---------------------------------------------------------------------------

/// Tool for spawning a child agent from a template file.
pub struct AgentsHireTool {
    agent_registry: Arc<AgentRegistry>,
    caller_agent_id: String,
    templates_dir: PathBuf,
}

impl AgentsHireTool {
    pub fn new(
        agent_registry: Arc<AgentRegistry>,
        caller_agent_id: String,
        templates_dir: PathBuf,
    ) -> Self {
        Self {
            agent_registry,
            caller_agent_id,
            templates_dir,
        }
    }
}

#[async_trait]
impl Tool for AgentsHireTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let template = args
            .get("template")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'template'"))?;
        let parent_id = args
            .get("parent_id")
            .and_then(|v| v.as_str())
            .unwrap_or(&self.caller_agent_id);

        let template_path = self.templates_dir.join(template).join("agent.md");
        let content = tokio::fs::read_to_string(&template_path)
            .await
            .with_context(|| format!("failed to read template: {}", template_path.display()))?;

        let agent = self
            .agent_registry
            .spawn_from_template(&content, Some(parent_id))
            .await?;

        Ok(ToolResult::success(format!(
            "Agent hired: {} (id: {}, template: {})",
            agent.name, agent.id, template
        )))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "agents_hire".to_string(),
            description: "Spawn a child agent from a template. Reads the template file and registers a new agent in the hierarchy.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "template": {
                        "type": "string",
                        "description": "Template directory name (e.g. 'shadow', 'analyst')"
                    },
                    "display_name": {
                        "type": "string",
                        "description": "Optional display name for the new agent"
                    },
                    "parent_id": {
                        "type": "string",
                        "description": "Parent agent ID (defaults to the calling agent)"
                    }
                },
                "required": ["template"]
            }),
        }
    }

    fn name(&self) -> &str {
        "agents_hire"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// AgentsRetireTool — retire an agent
// ---------------------------------------------------------------------------

/// Tool for retiring an agent by name or ID.
pub struct AgentsRetireTool {
    agent_registry: Arc<AgentRegistry>,
}

impl AgentsRetireTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for AgentsRetireTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
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

        Ok(ToolResult::success(format!(
            "Agent '{}' (id: {}) retired.",
            agent.name, agent.id
        )))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "agents_retire".to_string(),
            description:
                "Retire an agent by name or ID. The agent will no longer be scheduled for work."
                    .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "Agent name or ID to retire"
                    }
                },
                "required": ["agent"]
            }),
        }
    }

    fn name(&self) -> &str {
        "agents_retire"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// AgentsListTool — list agents
// ---------------------------------------------------------------------------

/// Tool for listing agents, optionally filtered by status.
pub struct AgentsListTool {
    agent_registry: Arc<AgentRegistry>,
}

impl AgentsListTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for AgentsListTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
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
                "- {} (id: {}, display: {}, status: {}, template: {})\n",
                agent.name,
                agent.id,
                agent.display_name.as_deref().unwrap_or("-"),
                agent.status,
                agent.template,
            ));
        }
        Ok(ToolResult::success(output))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "agents_list".to_string(),
            description:
                "List agents, optionally filtered by status (active, paused, retired, all)."
                    .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["active", "paused", "retired", "all"],
                        "default": "active",
                        "description": "Filter by agent status (default: active)"
                    }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "agents_list"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// EventsCreateTool — create an event handler
// ---------------------------------------------------------------------------

/// Tool for creating an event handler (scheduled or lifecycle-driven).
pub struct EventsCreateTool {
    event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
    agent_id: String,
}

impl EventsCreateTool {
    pub fn new(event_handler_store: Arc<crate::event_handler::EventHandlerStore>, agent_id: String) -> Self {
        Self {
            event_handler_store,
            agent_id,
        }
    }
}

#[async_trait]
impl Tool for EventsCreateTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let name = args
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'name'"))?;

        // Build the pattern string: "schedule:<expr>" or "lifecycle:<event>".
        let pattern = if let Some(schedule) = args.get("schedule").and_then(|v| v.as_str()) {
            format!("schedule:{schedule}")
        } else if let Some(event) = args.get("event").and_then(|v| v.as_str()) {
            format!("lifecycle:{event}")
        } else if let Some(p) = args.get("pattern").and_then(|v| v.as_str()) {
            p.to_string()
        } else {
            return Ok(ToolResult::error(
                "Provide 'schedule' (cron expr), 'event' (lifecycle event), or 'pattern'.",
            ));
        };

        let scope = args
            .get("scope")
            .and_then(|v| v.as_str())
            .unwrap_or("self")
            .to_string();
        let content = args.get("content").and_then(|v| v.as_str()).map(String::from);
        // Also accept legacy "skill" as content fallback.
        let content = content.or_else(|| args.get("skill").and_then(|v| v.as_str()).map(String::from));
        let cooldown_secs = args
            .get("cooldown_secs")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let max_budget_usd = args.get("max_budget_usd").and_then(|v| v.as_f64());

        match self
            .event_handler_store
            .create(&crate::event_handler::NewEvent {
                agent_id: self.agent_id.clone(),
                name: name.to_string(),
                pattern: pattern.clone(),
                scope,
                idea_id: None,
                content,
                cooldown_secs,
                max_budget_usd,
                webhook_secret: None,
                system: false,
            })
            .await
        {
            Ok(event) => Ok(ToolResult::success(format!(
                "Event '{}' created (id: {}, pattern: {})",
                event.name,
                event.id,
                event.pattern,
            ))),
            Err(e) => Ok(ToolResult::error(format!("Failed to create event: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "events_create".to_string(),
            description:
                "Create a new event handler (scheduled or lifecycle-driven) that runs automatically."
                    .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Event handler name"
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Full pattern string (e.g. 'schedule:0 9 * * *', 'lifecycle:quest_completed')"
                    },
                    "schedule": {
                        "type": "string",
                        "description": "Cron expression (e.g. '0 9 * * *') — shorthand for pattern 'schedule:<expr>'"
                    },
                    "event": {
                        "type": "string",
                        "description": "Lifecycle event (e.g. 'quest_completed') — shorthand for pattern 'lifecycle:<event>'"
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["self", "children", "descendants"],
                        "description": "Event scope (default: 'self')"
                    },
                    "content": {
                        "type": "string",
                        "description": "Inline instruction to run when the event fires"
                    },
                    "cooldown_secs": {
                        "type": "integer",
                        "description": "Minimum seconds between fires (default: 0)"
                    },
                    "max_budget_usd": {
                        "type": "number",
                        "description": "Maximum budget per execution in USD"
                    }
                },
                "required": ["name"]
            }),
        }
    }

    fn name(&self) -> &str {
        "events_create"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// EventsListTool — list events for the current agent
// ---------------------------------------------------------------------------

/// Tool for listing event handlers owned by the current agent.
pub struct EventsListTool {
    event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
    agent_id: String,
}

impl EventsListTool {
    pub fn new(event_handler_store: Arc<crate::event_handler::EventHandlerStore>, agent_id: String) -> Self {
        Self {
            event_handler_store,
            agent_id,
        }
    }
}

#[async_trait]
impl Tool for EventsListTool {
    async fn execute(&self, _args: serde_json::Value) -> Result<ToolResult> {
        let events = self
            .event_handler_store
            .list_for_agent(&self.agent_id)
            .await
            .unwrap_or_default();

        if events.is_empty() {
            return Ok(ToolResult::success("No events."));
        }

        let items: Vec<String> = events
            .iter()
            .map(|e| {
                format!(
                    "- {} (id: {}, pattern: {}, enabled: {}, fires: {})",
                    e.name,
                    e.id,
                    e.pattern,
                    e.enabled,
                    e.fire_count
                )
            })
            .collect();
        Ok(ToolResult::success(items.join("\n")))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "events_list".to_string(),
            description: "List all event handlers owned by this agent.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    fn name(&self) -> &str {
        "events_list"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// EventsRemoveTool — remove an event handler
// ---------------------------------------------------------------------------

/// Tool for removing (deleting) an event handler by ID.
pub struct EventsRemoveTool {
    event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
}

impl EventsRemoveTool {
    pub fn new(event_handler_store: Arc<crate::event_handler::EventHandlerStore>) -> Self {
        Self { event_handler_store }
    }
}

#[async_trait]
impl Tool for EventsRemoveTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let event_id = args
            .get("event_id")
            .or_else(|| args.get("trigger_id"))
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'event_id'"))?;

        match self.event_handler_store.delete(event_id).await {
            Ok(()) => Ok(ToolResult::success(format!(
                "Event {event_id} removed."
            ))),
            Err(e) => Ok(ToolResult::error(format!("Failed to remove event: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "events_remove".to_string(),
            description: "Remove (delete) an event handler by its ID.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "event_id": {
                        "type": "string",
                        "description": "ID of the event handler to remove"
                    }
                },
                "required": ["event_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "events_remove"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

// ── Prompt tools ──

pub struct IdeasListTool {
    agent_registry: Arc<AgentRegistry>,
}

impl IdeasListTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for IdeasListTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let tag = args.get("tag").and_then(|v| v.as_str());
        match self.agent_registry.list_prompts(tag).await {
            Ok(prompts) => {
                let items: Vec<String> = prompts
                    .iter()
                    .map(|p| {
                        format!(
                            "- {} [{}] — {}",
                            p.name,
                            p.tags.join(", "),
                            p.content.chars().take(80).collect::<String>()
                        )
                    })
                    .collect();
                Ok(ToolResult::success(format!(
                    "{} prompts found:\n{}",
                    prompts.len(),
                    items.join("\n")
                )))
            }
            Err(e) => Ok(ToolResult::error(format!("Failed to list prompts: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas_list".to_string(),
            description: "List available ideas, optionally filtered by tag.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "tag": {
                        "type": "string",
                        "description": "Filter prompts by tag (e.g., 'workflow', 'identity', 'skill')"
                    }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas_list"
    }
}

pub struct IdeasLoadTool {
    agent_registry: Arc<AgentRegistry>,
}

impl IdeasLoadTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for IdeasLoadTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let name = args
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'name'"))?;
        match self.agent_registry.list_prompts(None).await {
            Ok(prompts) => {
                if let Some(p) = prompts.iter().find(|p| p.name == name) {
                    Ok(ToolResult::success(format!(
                        "# {}\ntags: {}\n\n{}",
                        p.name,
                        p.tags.join(", "),
                        p.content
                    )))
                } else {
                    Ok(ToolResult::error(format!("Prompt '{name}' not found.")))
                }
            }
            Err(e) => Ok(ToolResult::error(format!("Failed to load prompt: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas_load".to_string(),
            description: "Load an idea by name. Returns the full content.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the prompt to load"
                    }
                },
                "required": ["name"]
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas_load"
    }
}

pub struct IdeasFindTool {
    agent_registry: Arc<AgentRegistry>,
}

impl IdeasFindTool {
    pub fn new(agent_registry: Arc<AgentRegistry>) -> Self {
        Self { agent_registry }
    }
}

#[async_trait]
impl Tool for IdeasFindTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'query'"))?
            .to_lowercase();
        match self.agent_registry.list_prompts(None).await {
            Ok(prompts) => {
                let matches: Vec<String> = prompts
                    .iter()
                    .filter(|p| {
                        p.name.to_lowercase().contains(&query)
                            || p.content.to_lowercase().contains(&query)
                            || p.tags.iter().any(|t| t.to_lowercase().contains(&query))
                    })
                    .map(|p| {
                        format!(
                            "- {} [{}] — {}",
                            p.name,
                            p.tags.join(", "),
                            p.content.chars().take(80).collect::<String>()
                        )
                    })
                    .collect();
                Ok(ToolResult::success(format!(
                    "{} matches for '{}':\n{}",
                    matches.len(),
                    query,
                    matches.join("\n")
                )))
            }
            Err(e) => Ok(ToolResult::error(format!("Failed to search prompts: {e}"))),
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas_find".to_string(),
            description: "Search ideas by name, content, or tag.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query to match against prompt names, content, and tags"
                    }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas_find"
    }
}

// ---------------------------------------------------------------------------
// AgentSelfTool — introspection: identity, tree position, quests, events
// ---------------------------------------------------------------------------

/// Tool for agents to introspect their own identity, hierarchy position,
/// active quests, and event handlers.
pub struct AgentSelfTool {
    agent_name: String,
    agent_registry: Arc<AgentRegistry>,
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
}

impl AgentSelfTool {
    pub fn new(
        agent_name: String,
        agent_registry: Arc<AgentRegistry>,
        event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
    ) -> Self {
        Self {
            agent_name,
            agent_registry,
            event_handler_store,
        }
    }
}

#[async_trait]
impl Tool for AgentSelfTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let detail = args
            .get("detail")
            .and_then(|v| v.as_str())
            .unwrap_or("all");

        // Look up self by name.
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

        // Identity section.
        if detail == "identity" || detail == "all" {
            result.insert(
                "identity".to_string(),
                serde_json::json!({
                    "id": agent.id,
                    "name": agent.name,
                    "display_name": agent.display_name,
                    "model": agent.model,
                    "status": format!("{}", agent.status),
                    "capabilities": agent.capabilities,
                    "created_at": agent.created_at.to_rfc3339(),
                }),
            );
        }

        // Tree section.
        if detail == "tree" || detail == "all" {
            let ancestors = self
                .agent_registry
                .get_ancestors(&agent.id)
                .await
                .unwrap_or_default();
            // get_ancestors returns the chain starting from self, so skip self.
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

        // Quests section.
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

        // Events section.
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
                            "scope": e.scope,
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "agent_self".to_string(),
            description: "Introspect: see your own identity, position in the agent tree, active quests, and event handlers.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "detail": {
                        "type": "string",
                        "enum": ["identity", "tree", "quests", "events", "all"],
                        "description": "Which section to return (default: all)"
                    }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "agent_self"
    }
}

pub fn build_orchestration_tools(
    leader_name: String,
    _default_project: String,
    project_name: Option<String>,
    activity_log: Arc<ActivityLog>,
    _channels: Arc<RwLock<HashMap<String, Arc<dyn Channel>>>>,
    api_key: Option<String>,
    memory: Option<Arc<dyn IdeaStore>>,
    graph_db_path: Option<PathBuf>,
    session_id: Option<String>,
    provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    session_store: Option<Arc<crate::SessionStore>>,
    session_manager: Option<Arc<crate::session_manager::SessionManager>>,
    default_model: String,
    agent_registry: Arc<crate::agent_registry::AgentRegistry>,
) -> Vec<Arc<dyn Tool>> {
    let mut delegate_tool = crate::delegate::DelegateTool::new(activity_log, leader_name.clone())
        .with_project(project_name)
        .with_agent_registry(agent_registry.clone());
    if let Some(sid) = session_id {
        delegate_tool = delegate_tool.with_session_id(sid);
    }
    if let Some(ref p) = provider {
        delegate_tool = delegate_tool.with_provider(p.clone());
    }
    if let Some(ref sm) = session_manager {
        delegate_tool = delegate_tool.with_session_manager(sm.clone());
    }
    if let Some(ref ss) = session_store {
        delegate_tool = delegate_tool.with_session_store(ss.clone());
    }
    delegate_tool = delegate_tool.with_default_model(default_model);

    let detail_tool = QuestDetailTool::new(agent_registry.clone());
    let cancel_tool = QuestCancelTool::new(agent_registry.clone());
    let reprioritize_tool = QuestReprioritizeTool::new(agent_registry.clone());
    let create_tool = QuestCreateTool::new(agent_registry.clone(), leader_name.clone());
    let quest_list_tool = QuestListTool::new(agent_registry.clone());
    let update_tool = QuestUpdateTool::new(agent_registry.clone());
    let close_tool = QuestCloseTool::new(agent_registry.clone());

    // Agent management tools.
    let templates_dir = std::env::current_dir().unwrap_or_default().join("agents");
    let hire_tool = AgentsHireTool::new(agent_registry.clone(), leader_name.clone(), templates_dir);
    let retire_tool = AgentsRetireTool::new(agent_registry.clone());
    let list_tool = AgentsListTool::new(agent_registry.clone());

    // Events tools via EventHandlerStore.
    let event_handler_store = Arc::new(crate::event_handler::EventHandlerStore::new(agent_registry.db()));
    let events_create_tool = EventsCreateTool::new(event_handler_store.clone(), leader_name.clone());
    let events_list_tool = EventsListTool::new(event_handler_store.clone(), leader_name.clone());
    let events_remove_tool = EventsRemoveTool::new(event_handler_store);

    // Self-introspection tool.
    let event_handler_store = Arc::new(crate::event_handler::EventHandlerStore::new(
        agent_registry.db(),
    ));
    let agent_self_tool = AgentSelfTool::new(
        leader_name.clone(),
        agent_registry.clone(),
        Some(event_handler_store),
    );

    let mut tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(detail_tool),
        Arc::new(cancel_tool),
        Arc::new(reprioritize_tool),
        Arc::new(create_tool),
        Arc::new(quest_list_tool),
        Arc::new(update_tool),
        Arc::new(close_tool),
        Arc::new(delegate_tool),
        Arc::new(UsageStatsTool::new(api_key)),
        Arc::new(hire_tool),
        Arc::new(retire_tool),
        Arc::new(list_tool),
        Arc::new(events_create_tool),
        Arc::new(events_list_tool),
        Arc::new(events_remove_tool),
        Arc::new(IdeasListTool::new(agent_registry.clone())),
        Arc::new(IdeasLoadTool::new(agent_registry.clone())),
        Arc::new(IdeasFindTool::new(agent_registry.clone())),
        Arc::new(agent_self_tool),
    ];

    if let Some(mem) = memory {
        tools.push(Arc::new(IdeaStoreTool::new(mem.clone())));
        tools.push(Arc::new(IdeaRecallTool::new(mem.clone())));
        tools.push(Arc::new(NotesTool::new(mem, agent_registry, leader_name)));
    }

    if let Some(gp) = graph_db_path {
        tools.push(Arc::new(GraphTool::new(gp)));
    }

    tools
}

// ---------------------------------------------------------------------------
// GraphTool — code intelligence via aeqi-graph
// ---------------------------------------------------------------------------

/// Tool exposing code graph queries: search symbols, get context, analyze impact.
pub struct GraphTool {
    db_path: PathBuf,
}

impl GraphTool {
    pub fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }
}

#[async_trait]
impl Tool for GraphTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let action = args
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or("stats");

        let store = match aeqi_graph::GraphStore::open(&self.db_path) {
            Ok(s) => s,
            Err(e) => return Ok(ToolResult::error(format!("graph DB not available: {e}"))),
        };

        let result = match action {
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
                return Ok(ToolResult::error(format!("unknown graph action: {action}")));
            }
        };

        Ok(ToolResult::success(serde_json::to_string_pretty(&result)?))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas_graph".to_string(),
            description: "Query the code intelligence graph. Search symbols, get 360° context (callers/callees/implementors), analyze blast radius, list symbols in a file.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["search", "context", "impact", "file", "stats"],
                        "description": "search=FTS symbol search, context=360° view, impact=blast radius, file=symbols in a file, stats=graph statistics"
                    },
                    "query": {"type": "string", "description": "Search query (for search action)"},
                    "node_id": {"type": "string", "description": "Node ID (for context/impact actions)"},
                    "file_path": {"type": "string", "description": "File path (for file action)"},
                    "depth": {"type": "integer", "description": "Impact depth (default 3)"},
                    "limit": {"type": "integer", "description": "Max results (default 10)"}
                },
                "required": ["action"]
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas_graph"
    }
}

// ---------------------------------------------------------------------------
// TriggerManageTool — CRUD for agent-owned event handlers
// ---------------------------------------------------------------------------

/// Tool for creating, listing, enabling, disabling, and deleting event handlers.
/// Scoped to the calling agent's own events.
pub struct TriggerManageTool {
    event_handler_store: Arc<crate::event_handler::EventHandlerStore>,
    agent_id: String,
}

impl TriggerManageTool {
    pub fn new(event_handler_store: Arc<crate::event_handler::EventHandlerStore>, agent_id: String) -> Self {
        Self {
            event_handler_store,
            agent_id,
        }
    }
}

#[async_trait]
impl Tool for TriggerManageTool {
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
                let max_budget_usd = args.get("max_budget_usd").and_then(|v| v.as_f64());
                let cooldown_secs = args
                    .get("cooldown_secs")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                let scope = args
                    .get("scope")
                    .and_then(|v| v.as_str())
                    .unwrap_or("self")
                    .to_string();

                // Build pattern from schedule, event_pattern, or raw pattern.
                let pattern = if let Some(schedule) =
                    args.get("schedule").and_then(|v| v.as_str())
                {
                    format!("schedule:{schedule}")
                } else if let Some(event) = args.get("event_pattern").and_then(|v| v.as_str()) {
                    format!("lifecycle:{event}")
                } else if let Some(p) = args.get("pattern").and_then(|v| v.as_str()) {
                    p.to_string()
                } else {
                    return Ok(ToolResult {
                        output: "provide 'schedule', 'event_pattern', or 'pattern'".to_string(),
                        is_error: true,
                        context_modifier: None,
                    });
                };

                // Content: explicit content field, or fall back to legacy "skill".
                let content = args.get("content").and_then(|v| v.as_str()).map(String::from)
                    .or_else(|| args.get("skill").and_then(|v| v.as_str()).map(String::from));

                match self
                    .event_handler_store
                    .create(&crate::event_handler::NewEvent {
                        agent_id: self.agent_id.clone(),
                        name: name.to_string(),
                        pattern: pattern.clone(),
                        scope,
                        idea_id: None,
                        content,
                        cooldown_secs,
                        max_budget_usd,
                        webhook_secret: None,
                        system: false,
                    })
                    .await
                {
                    Ok(event) => Ok(ToolResult {
                        output: format!(
                            "Event '{}' created (id: {}, pattern: {})",
                            event.name,
                            event.id,
                            event.pattern,
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
                        format!(
                            "- {} (id: {}, pattern: {}, enabled: {}, fires: {})",
                            e.name,
                            e.id,
                            e.pattern,
                            e.enabled,
                            e.fire_count
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
            name: "events_manage".to_string(),
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
                        "description": "Full pattern string (e.g. 'schedule:0 9 * * *', 'lifecycle:quest_completed')"
                    },
                    "schedule": {
                        "type": "string",
                        "description": "Cron expression or interval (e.g., '0 9 * * *') — shorthand for pattern 'schedule:<expr>'"
                    },
                    "event_pattern": {
                        "type": "string",
                        "description": "Lifecycle event (e.g. 'quest_completed') — shorthand for pattern 'lifecycle:<event>'"
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["self", "children", "descendants"],
                        "description": "Event scope (default: 'self')"
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
        "events_manage"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

// ChannelPostTool removed — routing is handled by DelegateTool.

// ---------------------------------------------------------------------------
// TranscriptSearchTool — FTS search across past session transcripts
// ---------------------------------------------------------------------------

/// Tool for agents to search past session transcripts via FTS5.
pub struct TranscriptSearchTool {
    session_store: Arc<crate::SessionStore>,
}

impl TranscriptSearchTool {
    pub fn new(session_store: Arc<crate::SessionStore>) -> Self {
        Self { session_store }
    }
}

#[async_trait]
impl Tool for TranscriptSearchTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("'query' is required"))?;
        let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

        match self.session_store.search_transcripts(query, limit).await {
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

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas_search".to_string(),
            description: "Search past session transcripts. Returns matching messages from previous agent sessions. Use when you need to recall HOW you solved something.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query (FTS5 syntax: words, phrases in quotes, OR/AND/NOT)"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10)"
                    }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "ideas_search"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// Sandboxed Shell Tool — wraps shell commands in bubblewrap for session isolation
// ---------------------------------------------------------------------------

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

        // Parse timeout: arg in ms, default to self.timeout_secs * 1000, cap at 600_000ms.
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

            // Reap child to prevent zombies.
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

                // Truncate if too long.
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
}
