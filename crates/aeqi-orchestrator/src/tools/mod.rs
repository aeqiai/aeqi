pub mod agents;
pub mod events;
pub mod ideas;
pub mod openrouter_usage;
pub mod quests;

pub use agents::AgentsTool;
pub use events::EventsTool;
pub use ideas::IdeasTool;
pub use openrouter_usage::{collect_openrouter_usage, collect_worker_usage, usage_log_path};
pub use quests::QuestsTool;

use aeqi_core::traits::{IdeaStore, Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;

use crate::activity_log::ActivityLog;

pub(crate) const PERSONA_IDEA_TAGS: &[&str] = &["identity", "evergreen"];

// ===================================================================
// SHELL TOOL — sandboxed shell execution
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

    /// Basic validation of shell commands to prevent obvious injection attempts.
    /// This is not comprehensive but catches the most dangerous patterns.
    fn validate_command(&self, command: &str) -> Result<()> {
        // Check for dangerous patterns that could indicate injection attempts
        let dangerous_patterns = [
            "rm -rf /",             // Dangerous deletion
            "rm -rf /*",            // Dangerous deletion
            ":(){ :|:& };:",        // Fork bomb
            "mkfs",                 // Filesystem formatting
            "dd if=/dev/zero",      // Disk wiping
            "> /dev/sda",           // Disk writing
            "chmod -R 777 /",       // Permission changes
            "chown -R root:root /", // Ownership changes
        ];

        let lower_command = command.to_lowercase();

        for pattern in dangerous_patterns {
            if lower_command.contains(pattern) {
                return Err(anyhow::anyhow!(
                    "Command contains dangerous pattern: {}",
                    pattern
                ));
            }
        }

        // Check for multiple command separators in a row (could indicate injection)
        let separators = [";", "&&", "||", "|"];
        let mut separator_count = 0;

        for ch in command.chars() {
            if separators.iter().any(|s| s.contains(ch)) {
                separator_count += 1;
                if separator_count > 5 {
                    return Err(anyhow::anyhow!(
                        "Command contains too many command separators"
                    ));
                }
            } else if !separators.iter().any(|s| s.contains(ch)) {
                separator_count = 0;
            }
        }

        Ok(())
    }
}

#[async_trait]
impl Tool for SandboxedShellTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing 'command' argument"))?;

        // Validate command for safety
        self.validate_command(command)?;

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
// CODE TOOL — search | graph | transcript | usage
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
                        data: serde_json::Value::Null,
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
                    data: serde_json::Value::Null,
                    context_modifier: None,
                })
            }
            Err(e) => Ok(ToolResult {
                output: format!("Transcript search failed: {e}"),
                is_error: true,
                data: serde_json::Value::Null,
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
    agent_id: String,
    activity_log: Arc<ActivityLog>,
    api_key: Option<String>,
    idea_store: Option<Arc<dyn IdeaStore>>,
    graph_db_path: Option<PathBuf>,
    session_store: Option<Arc<crate::SessionStore>>,
    agent_registry: Arc<crate::agent_registry::AgentRegistry>,
    pattern_dispatcher: Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
) -> Vec<Arc<dyn Tool>> {
    let event_handler_store = Arc::new(crate::event_handler::EventHandlerStore::new(
        agent_registry.db(),
    ));

    // 1. Agents tool (hire/retire/list/self)
    let agents_tool = AgentsTool::new(
        agent_id.clone(),
        agent_registry.clone(),
        idea_store.clone(),
        Some(event_handler_store.clone()),
        activity_log.clone(),
    );

    // 2. Quests tool (create/list/show/update/close/cancel)
    // Threading `pattern_dispatcher` lets `quests(action='close')` fire
    // `session:quest_end` end-to-end (incl. event chains with `tool_calls`,
    // like the seeded reflect-after-quest chain). Without it, the LLM
    // tool-close path is a dead end for the reflection loop.
    let quests_tool = QuestsTool::new(
        agent_registry.clone(),
        agent_id.clone(),
        activity_log.clone(),
    )
    .with_event_assembly(idea_store.clone(), event_handler_store.clone())
    .with_pattern_dispatcher(pattern_dispatcher);

    // 3. Events tool (create/list/enable/disable/delete)
    let events_tool = EventsTool::new(
        event_handler_store,
        agent_id.clone(),
        agent_registry.clone(),
    );

    // 4. Code tool (search/graph/transcript/usage)
    let code_tool = CodeTool::new(graph_db_path, session_store, api_key);

    let mut tools: Vec<Arc<dyn Tool>> = vec![
        Arc::new(agents_tool),
        Arc::new(quests_tool),
        Arc::new(events_tool),
        Arc::new(code_tool),
    ];

    // 5. Ideas tool (store/search/update/delete)
    if let Some(mem) = idea_store {
        let ideas_tool = IdeasTool::new(mem, activity_log)
            .with_agent_context(agent_registry.clone(), agent_id.clone());
        tools.push(Arc::new(ideas_tool));
    } else {
        tracing::warn!("ideas tool unavailable: no idea store configured");
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
