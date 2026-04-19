// design note: ExecutionContext is passed alongside tool args so tools can read
// runtime state without it being in their serialised args. This avoids the
// user-input injection attack surface noted in the design review: an operator
// who can write event args should not be able to forge session_id, agent_id, or
// other runtime values by putting them in the args JSON.
//
// CallerKind lets the registry enforce per-tool ACLs so, e.g., transcript.inject
// cannot be called by the LLM (only by events). The check happens inside
// ToolRegistry::invoke before the tool's execute() is called.
//
// DEFAULT_HANDLERS: each pattern key maps to a fallback closure that runs when
// no enabled event is configured for that pattern. Phase 4 will replace the
// log-only stubs with real logic. The indirection exists now so call-sites
// (middleware detectors) can call invoke_pattern unconditionally without knowing
// whether an event is configured.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use anyhow::Result;
use tracing::info;

use crate::chat_stream::ChatStreamSender;
use crate::traits::{Tool, ToolResult};

/// Who is invoking a tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallerKind {
    /// Invoked by the LLM via a tool_use block.
    Llm,
    /// Invoked by an event firing (event-driven lifecycle).
    Event,
    /// Invoked by the runtime itself (compaction, session bootstrap, etc.).
    System,
}

/// Runtime values available to a tool call without them being in the args JSON.
///
/// Tools that need session context read it here, not from args, so operator-
/// writable event args cannot forge identity or session state.
#[derive(Debug, Clone, Default)]
pub struct ExecutionContext {
    pub session_id: String,
    pub agent_id: String,
    /// Last user message, available for `{user_input}` substitution.
    pub user_input: Option<String>,
    /// Recent N messages serialised as text (for compactor context).
    pub transcript_tail: Option<String>,
    /// Quest description for the active quest, if any.
    pub quest_description: Option<String>,
    /// Tool names denied for this agent.
    pub tool_deny: Vec<String>,
    /// Sender for emitting Status events on the current session's stream.
    /// `None` in tests or contexts without a live stream.
    pub chat_stream: Option<ChatStreamSender>,
}

impl ExecutionContext {
    /// Build a minimal context for tests.
    pub fn test(session_id: impl Into<String>, agent_id: impl Into<String>) -> Self {
        Self {
            session_id: session_id.into(),
            agent_id: agent_id.into(),
            ..Default::default()
        }
    }

    /// Emit a `Status` event on the session stream, if one is wired up.
    pub fn emit_status(&self, message: impl Into<String>) {
        if let Some(ref tx) = self.chat_stream {
            tx.send(crate::chat_stream::ChatStreamEvent::Status {
                message: message.into(),
            });
        }
    }
}

/// A registry that maps tool names to `Arc<dyn Tool>` implementations and
/// enforces per-tool caller ACLs.
///
/// All tools that need to be callable from events or the LLM are registered
/// here. The LLM dispatch path (StreamingToolExecutor) uses `get()` + direct
/// execute; the event dispatch path uses `invoke()` which checks ACLs first.
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn Tool>>,
    /// Tools that can only be called by the LLM, not by events or the runtime.
    llm_only: HashSet<String>,
    /// Tools that can only be called by events (event-fired), not by the LLM.
    event_only: HashSet<String>,
}

impl ToolRegistry {
    /// Build a registry from a flat list of tools. All tools default to
    /// unrestricted (callable by LLM, events, and system).
    pub fn new(tools: Vec<Arc<dyn Tool>>) -> Self {
        let map = tools
            .into_iter()
            .map(|t| (t.name().to_string(), t))
            .collect();
        Self {
            tools: map,
            llm_only: HashSet::new(),
            event_only: HashSet::new(),
        }
    }

    /// Mark a tool as LLM-only (events and system callers are denied).
    pub fn set_llm_only(&mut self, name: impl Into<String>) {
        let n = name.into();
        self.event_only.remove(&n);
        self.llm_only.insert(n);
    }

    /// Mark a tool as event-only (LLM callers are denied).
    pub fn set_event_only(&mut self, name: impl Into<String>) {
        let n = name.into();
        self.llm_only.remove(&n);
        self.event_only.insert(n);
    }

    /// Look up a tool by name.
    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    /// Return all registered tools as a flat list (order is unspecified).
    pub fn all_tools(&self) -> Vec<Arc<dyn Tool>> {
        self.tools.values().cloned().collect()
    }

    /// Check whether `caller` is allowed to invoke `tool_name`.
    /// Returns `true` if the tool is unknown (unknown tools fail later in invoke).
    pub fn can_call(&self, tool_name: &str, caller: CallerKind) -> bool {
        match caller {
            CallerKind::Llm => !self.event_only.contains(tool_name),
            CallerKind::Event => !self.llm_only.contains(tool_name),
            CallerKind::System => true, // system bypasses ACL
        }
    }

    /// Invoke a tool by name, enforcing caller ACLs and per-agent tool_deny.
    ///
    /// ACL precedence:
    ///  1. `ctx.tool_deny` — per-agent runtime deny list (highest priority).
    ///  2. Registry `llm_only` / `event_only` sets — per-tool caller ACL.
    ///  3. Tool not found → error.
    pub async fn invoke(
        &self,
        tool_name: &str,
        args: serde_json::Value,
        caller: CallerKind,
        ctx: &ExecutionContext,
    ) -> Result<ToolResult> {
        // Per-agent deny list (tool_deny configured on the agent row).
        if ctx.tool_deny.iter().any(|d| d == tool_name) {
            return Ok(ToolResult::error(format!(
                "tool '{tool_name}' is denied for this agent"
            )));
        }

        // Per-tool caller ACL.
        if !self.can_call(tool_name, caller) {
            return Ok(ToolResult::error(format!(
                "tool '{tool_name}' cannot be called by {:?}",
                caller
            )));
        }

        let tool = self
            .tools
            .get(tool_name)
            .ok_or_else(|| anyhow::anyhow!("unknown tool: {tool_name}"))?;

        tool.execute(args).await
    }

    /// Fire all events configured for `pattern`, running their tool_calls.
    /// If no events are configured for the pattern (or the caller does not
    /// supply an event lookup fn), falls back to DEFAULT_HANDLERS.
    ///
    /// Phase 4 will wire real event lookup here. For now, the event lookup
    /// closure is always `None` in callers; only the fallback table runs.
    pub fn invoke_pattern(&self, pattern: &str, ctx: &ExecutionContext) -> Result<()> {
        // Phase 4 will replace this stub with event lookup + tool dispatch.
        // For now: look up the pattern in DEFAULT_HANDLERS and run the fallback.
        let handler = DEFAULT_HANDLERS
            .iter()
            .find(|(p, _)| *p == pattern)
            .map(|(_, h)| *h);

        match handler {
            Some(h) => {
                h(pattern, ctx);
                Ok(())
            }
            None => {
                info!(
                    pattern = %pattern,
                    session = %ctx.session_id,
                    "invoke_pattern: no event configured and no default handler for pattern"
                );
                Ok(())
            }
        }
    }
}

/// Fallback handler signature: `(pattern, ctx) -> ()`.
type PatternFallback = fn(&str, &ExecutionContext);

/// Default handler table — keyed by pattern, value is a fallback that runs
/// when no enabled event is configured for that pattern.
///
/// Phase 4 will replace these log-only stubs with real logic (e.g. inline loop
/// detection response, inline guardrail violation response, inline context
/// compaction trigger).
static DEFAULT_HANDLERS: &[(&str, PatternFallback)] = &[
    ("loop:detected", fallback_loop_detected),
    ("guardrail:violation", fallback_guardrail_violation),
    ("context:budget:exceeded", fallback_context_budget_exceeded),
    ("shell:command_failed", fallback_shell_command_failed),
];

fn fallback_loop_detected(pattern: &str, ctx: &ExecutionContext) {
    info!(
        pattern = %pattern,
        session = %ctx.session_id,
        "default fallback: loop:detected — no event configured, logging only (Phase 4 will handle)"
    );
}

fn fallback_guardrail_violation(pattern: &str, ctx: &ExecutionContext) {
    info!(
        pattern = %pattern,
        session = %ctx.session_id,
        "default fallback: guardrail:violation — no event configured, logging only (Phase 4 will handle)"
    );
}

fn fallback_context_budget_exceeded(pattern: &str, ctx: &ExecutionContext) {
    info!(
        pattern = %pattern,
        session = %ctx.session_id,
        "default fallback: context:budget:exceeded — no event configured, logging only (Phase 4 will handle)"
    );
}

fn fallback_shell_command_failed(pattern: &str, ctx: &ExecutionContext) {
    info!(
        pattern = %pattern,
        session = %ctx.session_id,
        "default fallback: shell:command_failed — no event configured, logging only (Phase 4 will handle)"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traits::{ToolResult, ToolSpec};
    use async_trait::async_trait;

    struct EchoTool {
        name: String,
    }

    #[async_trait]
    impl Tool for EchoTool {
        async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
            Ok(ToolResult::success(format!(
                "echo:{} args:{args}",
                self.name
            )))
        }
        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: self.name.clone(),
                description: "echo tool".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }
        }
        fn name(&self) -> &str {
            &self.name
        }
    }

    fn registry_with_tools() -> ToolRegistry {
        let tools: Vec<Arc<dyn Tool>> = vec![
            Arc::new(EchoTool {
                name: "open_tool".into(),
            }),
            Arc::new(EchoTool {
                name: "llm_tool".into(),
            }),
            Arc::new(EchoTool {
                name: "event_tool".into(),
            }),
        ];
        let mut reg = ToolRegistry::new(tools);
        reg.set_llm_only("llm_tool");
        reg.set_event_only("event_tool");
        reg
    }

    #[test]
    fn can_call_enforces_acls() {
        let reg = registry_with_tools();

        // open_tool: no restrictions
        assert!(reg.can_call("open_tool", CallerKind::Llm));
        assert!(reg.can_call("open_tool", CallerKind::Event));
        assert!(reg.can_call("open_tool", CallerKind::System));

        // llm_tool: LLM-only
        assert!(reg.can_call("llm_tool", CallerKind::Llm));
        assert!(!reg.can_call("llm_tool", CallerKind::Event));
        assert!(reg.can_call("llm_tool", CallerKind::System));

        // event_tool: event-only
        assert!(!reg.can_call("event_tool", CallerKind::Llm));
        assert!(reg.can_call("event_tool", CallerKind::Event));
        assert!(reg.can_call("event_tool", CallerKind::System));
    }

    #[tokio::test]
    async fn invoke_respects_caller_acl() {
        let reg = registry_with_tools();
        let ctx = ExecutionContext::test("s1", "a1");

        // LLM calling llm_tool succeeds.
        let res = reg
            .invoke("llm_tool", serde_json::json!({}), CallerKind::Llm, &ctx)
            .await
            .unwrap();
        assert!(!res.is_error);

        // Event calling llm_tool is denied.
        let res = reg
            .invoke("llm_tool", serde_json::json!({}), CallerKind::Event, &ctx)
            .await
            .unwrap();
        assert!(res.is_error);
        assert!(res.output.contains("cannot be called"));

        // LLM calling event_tool is denied.
        let res = reg
            .invoke("event_tool", serde_json::json!({}), CallerKind::Llm, &ctx)
            .await
            .unwrap();
        assert!(res.is_error);

        // Event calling event_tool succeeds.
        let res = reg
            .invoke("event_tool", serde_json::json!({}), CallerKind::Event, &ctx)
            .await
            .unwrap();
        assert!(!res.is_error);
    }

    #[tokio::test]
    async fn invoke_respects_tool_deny() {
        let reg = registry_with_tools();
        let mut ctx = ExecutionContext::test("s1", "a1");
        ctx.tool_deny = vec!["open_tool".to_string()];

        let res = reg
            .invoke("open_tool", serde_json::json!({}), CallerKind::Llm, &ctx)
            .await
            .unwrap();
        assert!(res.is_error);
        assert!(res.output.contains("denied"));
    }

    #[tokio::test]
    async fn invoke_unknown_tool_returns_error() {
        let reg = registry_with_tools();
        let ctx = ExecutionContext::test("s1", "a1");
        let err = reg
            .invoke(
                "nonexistent",
                serde_json::json!({}),
                CallerKind::System,
                &ctx,
            )
            .await;
        assert!(err.is_err());
        assert!(err.unwrap_err().to_string().contains("unknown tool"));
    }

    #[test]
    fn invoke_pattern_with_default_handler_does_not_error() {
        let reg = ToolRegistry::new(vec![]);
        let ctx = ExecutionContext::test("s1", "a1");
        // Known patterns with default handlers must succeed.
        assert!(reg.invoke_pattern("loop:detected", &ctx).is_ok());
        assert!(reg.invoke_pattern("guardrail:violation", &ctx).is_ok());
        assert!(reg.invoke_pattern("context:budget:exceeded", &ctx).is_ok());
        assert!(reg.invoke_pattern("shell:command_failed", &ctx).is_ok());
    }

    #[test]
    fn invoke_pattern_unknown_pattern_does_not_error() {
        let reg = ToolRegistry::new(vec![]);
        let ctx = ExecutionContext::test("s1", "a1");
        // Unknown patterns should log and return Ok.
        assert!(reg.invoke_pattern("some:unknown:pattern", &ctx).is_ok());
    }

    #[test]
    fn set_event_only_removes_llm_only_and_vice_versa() {
        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(EchoTool { name: "t".into() })];
        let mut reg = ToolRegistry::new(tools);
        reg.set_llm_only("t");
        assert!(!reg.can_call("t", CallerKind::Event));
        // Flip to event_only — should clear the llm_only flag.
        reg.set_event_only("t");
        assert!(reg.can_call("t", CallerKind::Event));
        assert!(!reg.can_call("t", CallerKind::Llm));
    }
}
