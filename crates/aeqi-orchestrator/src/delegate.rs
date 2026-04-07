//! Unified delegate tool — consolidates subagent spawning, dispatch sending,
//! task assignment, and channel posting into a single `delegate` tool with
//! routing determined by the `to` parameter.
//!
//! Response modes:
//! - `origin` — response injected back into the caller's conversation
//! - `perpetual` — response delivered to the caller's perpetual session
//! - `async` — fire-and-forget; caller notified on completion
//! - `none` — no response expected

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use std::sync::Arc;
use tracing::info;

use crate::SessionStore;
use crate::agent_registry::AgentRegistry;
use crate::event_store::{Dispatch, DispatchKind, EventStore};
use crate::session_manager::SessionManager;

// ---------------------------------------------------------------------------
// DelegateTool
// ---------------------------------------------------------------------------

/// Unified tool for delegating work to subagents or named agents.
///
/// Routing is determined by the `to` parameter:
/// - `"subagent"` — delegate to the project-default agent (ephemeral worker)
/// - `"dept:<name>"` — resolved to agent lookup by name (backward compat)
/// - `<agent_name>` — send a DelegateRequest dispatch to a named agent
pub struct DelegateTool {
    event_store: Arc<EventStore>,
    /// The name of the calling agent (used as the "from" field in dispatches).
    agent_name: String,
    /// Optional agent registry for resolving default agents.
    agent_registry: Option<Arc<AgentRegistry>>,
    /// Project name for scoping default-agent lookups.
    project_name: Option<String>,
    /// Fallback target when no project-default agent is found (system escalation target).
    fallback_target: Option<String>,
    /// Session ID of the calling agent, propagated as parent_session_id in delegations.
    session_id: Option<String>,
    /// Provider for direct session spawning (bypasses dispatch bus).
    provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    /// Session store for persisting session records.
    session_store: Option<Arc<SessionStore>>,
    /// Session manager for registering running sessions.
    session_manager: Option<Arc<SessionManager>>,
    /// Default model name for spawned child sessions.
    default_model: String,
}

impl DelegateTool {
    pub fn new(event_store: Arc<EventStore>, agent_name: String) -> Self {
        Self {
            event_store,
            agent_name,
            agent_registry: None,
            project_name: None,
            fallback_target: None,
            session_id: None,
            provider: None,
            session_store: None,
            session_manager: None,
            default_model: String::new(),
        }
    }

    /// Set the agent registry for resolving default agents.
    pub fn with_agent_registry(mut self, agent_registry: Arc<AgentRegistry>) -> Self {
        self.agent_registry = Some(agent_registry);
        self
    }

    /// Set the project name for scoping default-agent lookups.
    pub fn with_project(mut self, project_name: Option<String>) -> Self {
        self.project_name = project_name;
        self
    }

    /// Set the session ID of the calling agent. Propagated as `parent_session_id`
    /// in DelegateRequest dispatches so child workers can link their sessions.
    pub fn with_session_id(mut self, id: String) -> Self {
        self.session_id = Some(id);
        self
    }

    /// Set the provider for direct session spawning.
    pub fn with_provider(mut self, p: Arc<dyn aeqi_core::traits::Provider>) -> Self {
        self.provider = Some(p);
        self
    }

    /// Set the session store for persisting session records.
    pub fn with_session_store(mut self, ss: Arc<SessionStore>) -> Self {
        self.session_store = Some(ss);
        self
    }

    /// Set the session manager for registering running sessions.
    pub fn with_session_manager(mut self, sm: Arc<SessionManager>) -> Self {
        self.session_manager = Some(sm);
        self
    }

    /// Set the default model for spawned child sessions.
    pub fn with_default_model(mut self, m: String) -> Self {
        self.default_model = m;
        self
    }

    /// Parse a response mode string, defaulting to "origin".
    fn parse_response_mode(args: &serde_json::Value) -> String {
        args.get("response")
            .and_then(|v| v.as_str())
            .unwrap_or("origin")
            .to_string()
    }

    /// Handle delegation to a named agent via DelegateRequest dispatch.
    async fn delegate_to_agent(
        &self,
        to: &str,
        prompt: &str,
        response_mode: &str,
        create_task: bool,
        skill: Option<String>,
    ) -> Result<ToolResult> {
        let kind = DispatchKind::DelegateRequest {
            prompt: prompt.to_string(),
            response_mode: response_mode.to_string(),
            create_task,
            skill: skill.clone(),
            reply_to: None,
            parent_session_id: self.session_id.clone(),
        };

        let dispatch = Dispatch::new_typed(&self.agent_name, to, kind);
        let dispatch_id = dispatch.id.clone();

        info!(
            from = %self.agent_name,
            to = %to,
            response_mode = %response_mode,
            create_task = create_task,
            dispatch_id = %dispatch_id,
            parent_session_id = ?self.session_id,
            "sending DelegateRequest dispatch"
        );

        self.event_store.send(dispatch).await;

        let mut msg = format!(
            "Delegation sent to '{to}' (dispatch_id: {dispatch_id}, response_mode: {response_mode})"
        );
        if create_task {
            msg.push_str("\nQuest creation requested — target agent will pick up via quest queue.");
        }
        if let Some(s) = &skill {
            msg.push_str(&format!("\nSkill hint: {s}"));
        }

        Ok(ToolResult::success(msg))
    }

    /// Resolve the target agent for subagent delegation.
    ///
    /// Tries the agent registry's project-default first, then falls back
    /// to the configured system escalation target.
    async fn resolve_subagent_target(&self) -> Option<String> {
        if let Some(ref agent_reg) = self.agent_registry {
            // Try project-default agent.
            if let Some(ref project) = self.project_name
                && let Ok(Some(agent)) = agent_reg.default_agent(Some(project.as_str())).await
            {
                info!(
                    project = %project,
                    agent = %agent.name,
                    "resolved project-default agent for subagent dispatch"
                );
                return Some(agent.name.clone());
            }

            // Fallback to any active agent.
            if let Ok(Some(agent)) = agent_reg.default_agent(None).await {
                info!(
                    agent = %agent.name,
                    "resolved fallback active agent for subagent dispatch"
                );
                return Some(agent.name.clone());
            }
        }

        // Fall back to system escalation target.
        self.fallback_target.clone()
    }

    /// Spawn a child session via SessionManager.spawn_session() — the universal executor.
    ///
    /// Resolves the target agent, delegates all session building to SessionManager,
    /// and returns the session ID. The session auto-closes when the agent finishes.
    async fn spawn_session(&self, prompt: &str, skill: Option<&str>) -> Result<ToolResult> {
        let sm = self
            .session_manager
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no session manager for direct session spawn"))?;
        let provider = self
            .provider
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("no provider configured for direct session spawn"))?;

        // Resolve target agent name/id.
        let agent_id = self
            .resolve_subagent_target()
            .await
            .unwrap_or_else(|| self.agent_name.clone());

        let mut spawn_opts = crate::session_manager::SpawnOptions::new()
            .with_name(format!("Delegation from {}", self.agent_name));
        if let Some(ref pid) = self.session_id {
            spawn_opts = spawn_opts.with_parent(pid.clone());
        }
        if let Some(ref proj) = self.project_name {
            spawn_opts = spawn_opts.with_project(proj.clone());
        }
        if let Some(s) = skill {
            spawn_opts = spawn_opts.with_skill(s);
        }

        let spawned = sm
            .spawn_session(&agent_id, prompt, provider.clone(), spawn_opts)
            .await?;

        info!(
            session_id = %spawned.session_id,
            target = %agent_id,
            parent = ?self.session_id,
            "spawned child session via SessionManager"
        );

        Ok(ToolResult::success(format!(
            "Session {} spawned for '{}'. Running asynchronously — result will be recorded when complete.",
            spawned.session_id, agent_id
        )))
    }
}

#[async_trait]
impl Tool for DelegateTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let to = args
            .get("to")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'to'"))?;
        let prompt = args
            .get("prompt")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing required parameter 'prompt'"))?;

        let response_mode = Self::parse_response_mode(&args);
        let create_task = args
            .get("create_quest")
            .or_else(|| args.get("create_task"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let skill = args.get("skill").and_then(|v| v.as_str()).map(String::from);

        match to {
            // Pattern 1: Subagent — spawn session directly (or fallback to dispatch)
            "subagent" => {
                if self.provider.is_some() && self.session_manager.is_some() {
                    // Direct spawn — no dispatch bus, no patrol delay.
                    self.spawn_session(prompt, skill.as_deref()).await
                } else {
                    // Fallback to dispatch (legacy path — provider/session_manager not wired).
                    let target = self.resolve_subagent_target().await;
                    let target = match target {
                        Some(name) => name,
                        None => {
                            return Ok(ToolResult::error(
                                "No target agent available for subagent delegation. \
                                 Configure a project-default agent or system escalation target.",
                            ));
                        }
                    };

                    info!(
                        from = %self.agent_name,
                        resolved_target = %target,
                        "subagent request routed to project-default agent (dispatch fallback)"
                    );

                    self.delegate_to_agent(&target, prompt, "origin", true, skill)
                        .await
                }
            }

            // Pattern 3: dept:<name> — backward compat, resolves to named agent
            dept_target if dept_target.starts_with("dept:") => {
                let agent_name = &dept_target[5..]; // strip "dept:" prefix
                if agent_name.is_empty() {
                    return Ok(ToolResult::error(
                        "Agent name cannot be empty. Use 'dept:<name>' or an agent name directly.",
                    ));
                }
                info!(
                    from = %self.agent_name,
                    agent = %agent_name,
                    "dept: prefix resolved to agent lookup"
                );
                self.delegate_to_agent(agent_name, prompt, &response_mode, create_task, skill)
                    .await
            }

            // Pattern 2 & 4: Named agent (or fallback for unknown targets)
            agent_name => {
                // Self-delegation: spawn a child session instead of dispatching to yourself.
                if agent_name == self.agent_name
                    && self.provider.is_some()
                    && self.session_manager.is_some()
                {
                    self.spawn_session(prompt, skill.as_deref()).await
                } else {
                    self.delegate_to_agent(agent_name, prompt, &response_mode, create_task, skill)
                        .await
                }
            }
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "aeqi_delegate".to_string(),
            description: "Delegate work to subagents or named agents. \
                Routes based on the 'to' parameter: \
                'subagent' spawns an ephemeral sub-agent, \
                'dept:<name>' resolves to a named agent (backward compat), \
                or any other value sends a delegation request to a named agent. \
                Response mode controls how results are returned: \
                'origin' (inject back into caller), \
                'perpetual' (deliver to perpetual session), \
                'async' (fire-and-forget with notification), \
                'none' (no response expected)."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "Target: 'subagent' for ephemeral agent, or an agent name (dept:<name> also accepted for backward compat)"
                    },
                    "prompt": {
                        "type": "string",
                        "description": "The task or message to delegate"
                    },
                    "response": {
                        "type": "string",
                        "enum": ["origin", "perpetual", "async", "none"],
                        "default": "origin",
                        "description": "How the response should be routed back"
                    },
                    "create_quest": {
                        "type": "boolean",
                        "default": false,
                        "description": "Whether to also create a tracked quest for this delegation"
                    },
                    "skill": {
                        "type": "string",
                        "description": "Optional skill hint for the target agent"
                    },
                    "tools": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional tool allowlist for subagent mode"
                    }
                },
                "required": ["to", "prompt"]
            }),
        }
    }

    fn name(&self) -> &str {
        "aeqi_delegate"
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn test_event_store() -> Arc<crate::event_store::EventStore> {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::event_store::EventStore::create_tables(&conn).unwrap();
        let db = Arc::new(tokio::sync::Mutex::new(conn));
        Arc::new(crate::event_store::EventStore::new(db))
    }

    fn make_tool() -> DelegateTool {
        DelegateTool::new(test_event_store(), "test-agent".to_string())
    }

    #[test]
    fn test_parse_response_mode_default() {
        let args = serde_json::json!({});
        assert_eq!(DelegateTool::parse_response_mode(&args), "origin");
    }

    #[test]
    fn test_parse_response_mode_explicit() {
        let args = serde_json::json!({"response": "async"});
        assert_eq!(DelegateTool::parse_response_mode(&args), "async");
    }

    #[test]
    fn test_spec_has_required_fields() {
        let tool = make_tool();
        let spec = tool.spec();
        assert_eq!(spec.name, "aeqi_delegate");
        let required = spec.input_schema["required"].as_array().unwrap();
        assert!(required.contains(&serde_json::json!("to")));
        assert!(required.contains(&serde_json::json!("prompt")));
    }

    #[test]
    fn test_name() {
        let tool = make_tool();
        assert_eq!(tool.name(), "aeqi_delegate");
    }

    #[tokio::test]
    async fn test_subagent_no_target_returns_error() {
        // Without agent_registry or fallback_target, subagent should error.
        let tool = make_tool();
        let args = serde_json::json!({
            "to": "subagent",
            "prompt": "do something"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("No target agent available"));
    }

    #[tokio::test]
    async fn test_subagent_with_fallback_target() {
        let es = test_event_store();
        let mut tool = DelegateTool::new(es.clone(), "caller".to_string());
        tool.fallback_target = Some("leader".to_string());

        let args = serde_json::json!({
            "to": "subagent",
            "prompt": "handle this task",
            "skill": "code-review"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("leader"));
        assert!(result.output.contains("dispatch_id"));
        assert!(result.output.contains("Quest creation requested"));
        assert!(result.output.contains("code-review"));

        // Verify the dispatch was sent to the fallback target.
        let messages = es.read("leader").await;
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].from, "caller");
        assert_eq!(messages[0].to, "leader");
        assert_eq!(messages[0].kind.subject_tag(), "DELEGATE_REQUEST");
    }

    #[tokio::test]
    async fn test_dept_prefix_resolves_to_agent() {
        let tool = make_tool();
        let args = serde_json::json!({
            "to": "dept:engineering",
            "prompt": "review this PR"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(!result.is_error);
        // dept:engineering now resolves to agent "engineering"
        assert!(result.output.contains("engineering"));
        assert!(result.output.contains("dispatch_id"));
    }

    #[tokio::test]
    async fn test_dept_prefix_empty_name_rejected() {
        let tool = make_tool();
        let args = serde_json::json!({
            "to": "dept:",
            "prompt": "review this PR"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("cannot be empty"));
    }

    #[tokio::test]
    async fn test_named_agent_dispatch() {
        let tool = make_tool();
        let args = serde_json::json!({
            "to": "researcher",
            "prompt": "find the auth bug",
            "response": "async",
            "create_quest": true,
            "skill": "code-review"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("researcher"));
        assert!(result.output.contains("dispatch_id"));
        assert!(result.output.contains("Quest creation requested"));
        assert!(result.output.contains("code-review"));
    }

    #[tokio::test]
    async fn test_missing_to_param() {
        let tool = make_tool();
        let args = serde_json::json!({
            "prompt": "do something"
        });
        let result = tool.execute(args).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_missing_prompt_param() {
        let tool = make_tool();
        let args = serde_json::json!({
            "to": "researcher"
        });
        let result = tool.execute(args).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_dispatch_actually_sent() {
        let es = test_event_store();
        let tool = DelegateTool::new(es.clone(), "sender".to_string());

        let args = serde_json::json!({
            "to": "receiver",
            "prompt": "hello agent"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(!result.is_error);

        // Verify the dispatch landed in the event store.
        let messages = es.read("receiver").await;
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].from, "sender");
        assert_eq!(messages[0].to, "receiver");
        assert_eq!(messages[0].kind.subject_tag(), "DELEGATE_REQUEST");
    }

    #[tokio::test]
    async fn test_dept_prefix_dispatch_sent_to_agent() {
        let es = test_event_store();
        let tool = DelegateTool::new(es.clone(), "leader".to_string());

        let args = serde_json::json!({
            "to": "dept:ops",
            "prompt": "check server health"
        });
        let result = tool.execute(args).await.unwrap();
        assert!(!result.is_error);

        // dept:ops now resolves to agent "ops".
        let messages = es.read("ops").await;
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].from, "leader");
        assert_eq!(messages[0].kind.subject_tag(), "DELEGATE_REQUEST");
    }
}
