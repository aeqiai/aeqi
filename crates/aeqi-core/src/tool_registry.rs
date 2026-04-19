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
// DEFAULT_HANDLERS: each pattern key maps to a function that formats the warning
// string for that pattern from trigger_args. invoke_pattern calls transcript.inject
// with the formatted string (best-effort: if transcript.inject is not in this
// registry or fails, the warning is logged instead). Operators configure events
// to override these defaults; if any enabled event is configured for the pattern,
// the event's tool_calls run instead and the default handler is skipped.
//
// PatternDispatcher: a trait that decouples the Agent (aeqi-core) from the
// orchestrator's event store. The orchestrator implements PatternDispatcher by
// querying the event store for matching enabled events, running their tool_calls,
// and returning `true` if any event handled the pattern. The Agent calls this
// before falling back to inline compaction so the operator can override compaction
// via the `context:budget:exceeded` event without any changes to agent.rs.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use anyhow::Result;
use tracing::info;

use crate::chat_stream::ChatStreamSender;
use crate::traits::{Tool, ToolResult};

/// Decouples the agent's pattern-firing path from the orchestrator's event store.
///
/// The orchestrator implements this trait; the agent calls `dispatch` when it
/// needs to fire a pattern (e.g. `context:budget:exceeded`). If any enabled
/// event is configured for the pattern and ran its tool_calls successfully,
/// `dispatch` returns `true` so the caller can skip the inline fallback path.
///
/// Returning `false` (or an `Err`) tells the caller to use the built-in
/// fallback — important for bare-CLI / test environments where the event store
/// is not available.
pub trait PatternDispatcher: Send + Sync + 'static {
    /// Fire all enabled events matching `pattern`, executing their `tool_calls`.
    ///
    /// `trigger_args`: structured context from the detector, substituted into
    /// event tool_call args (e.g. `{session_id}`, `{estimated_tokens}`).
    /// `ctx`: execution context for ACL checks and session-id injection.
    ///
    /// Returns `true` if at least one event was found and handled the pattern
    /// (all tool_calls ran without fatal error). Returns `false` if no event
    /// was configured for the pattern — caller should use inline fallback.
    fn dispatch<'a>(
        &'a self,
        pattern: &'a str,
        ctx: &'a ExecutionContext,
        trigger_args: &'a serde_json::Value,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

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
    ///
    /// `trigger_args`: structured data from the detector (e.g. tool_name, count)
    /// that default handlers use to format the warning string.
    ///
    /// Execution order:
    /// 1. Look up `pattern` in DEFAULT_HANDLERS. If found, format the warning
    ///    string from `trigger_args` and inject it via `transcript.inject`
    ///    (best-effort: if transcript.inject is absent or fails, warn to tracing).
    /// 2. If no default handler exists for the pattern, log and return Ok(false).
    ///
    /// Returns `false` — the registry has no event store wired. Callers that want
    /// operator-configurable event dispatch should use a `PatternDispatcher` (the
    /// orchestrator implements this via its event store). This method is the pure
    /// registry fallback for bare-CLI / test environments.
    pub async fn invoke_pattern(
        &self,
        pattern: &str,
        ctx: &ExecutionContext,
        trigger_args: &serde_json::Value,
    ) -> Result<bool> {
        // Default handler: format warning string and inject via transcript.inject.
        let warning_text = DEFAULT_HANDLERS
            .iter()
            .find(|(p, _)| *p == pattern)
            .map(|(_, fmt)| fmt(trigger_args));

        match warning_text {
            Some(text) => {
                let inject_args = serde_json::json!({
                    "role": "system",
                    "content": text,
                    "_session_id": ctx.session_id,
                });
                match self
                    .invoke("transcript.inject", inject_args, CallerKind::Event, ctx)
                    .await
                {
                    Ok(result) if result.is_error => {
                        // transcript.inject not wired or returned error — fall back to tracing.
                        tracing::warn!(
                            pattern = %pattern,
                            session = %ctx.session_id,
                            warning = %text,
                            "default handler: transcript.inject failed ({}), warning logged",
                            result.output
                        );
                    }
                    Err(_) => {
                        // transcript.inject not in this registry — fall back to tracing.
                        tracing::warn!(
                            pattern = %pattern,
                            session = %ctx.session_id,
                            warning = %text,
                            "default handler: transcript.inject not available, warning logged"
                        );
                    }
                    Ok(_) => {} // injected successfully
                }
                // The default handler ran (injected a warning) but did not perform
                // compaction — return false so callers use their inline fallback.
                Ok(false)
            }
            None => {
                info!(
                    pattern = %pattern,
                    session = %ctx.session_id,
                    "invoke_pattern: no event configured and no default handler for pattern"
                );
                Ok(false)
            }
        }
    }
}

/// Default handler signature: formats a warning string from trigger_args.
///
/// The string is then injected via transcript.inject by invoke_pattern.
/// If transcript.inject is unavailable, the string is emitted to tracing.warn.
type PatternFormatter = fn(&serde_json::Value) -> String;

/// Default handler table — keyed by pattern, value is a formatter that produces
/// the warning string from trigger_args when no enabled event is configured.
///
/// Patterns present here preserve old middleware behavior as the fallback:
/// operators can configure an event to override these defaults.
static DEFAULT_HANDLERS: &[(&str, PatternFormatter)] = &[
    ("loop:detected", format_loop_detected),
    ("guardrail:violation", format_guardrail_violation),
    (
        "graph_guardrail:high_impact",
        format_graph_guardrail_high_impact,
    ),
    ("shell:command_failed", format_shell_command_failed),
];

fn format_loop_detected(args: &serde_json::Value) -> String {
    let tool_name = args
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("<unknown>");
    let count = args.get("count").and_then(|v| v.as_u64()).unwrap_or(0);
    let window = args
        .get("window_size")
        .and_then(|v| v.as_u64())
        .unwrap_or(10);
    format!(
        "WARNING: You have called '{tool_name}' with identical arguments {count} times \
         in the last {window} calls. This looks like a loop. Change your approach \
         or you will be terminated."
    )
}

fn format_guardrail_violation(args: &serde_json::Value) -> String {
    let tool_name = args
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("<unknown>");
    let rule = args
        .get("rule")
        .and_then(|v| v.as_str())
        .unwrap_or("not on the allow list");
    format!(
        "[Guardrails] Tool '{tool_name}' is not on the allow list. \
         {rule}. Verify this action is safe before proceeding."
    )
}

fn format_graph_guardrail_high_impact(args: &serde_json::Value) -> String {
    let warning = args
        .get("warning")
        .and_then(|v| v.as_str())
        .unwrap_or("<impact details unavailable>");
    format!("[Graph Guardrails] High-impact change detected: {warning}")
}

fn format_shell_command_failed(args: &serde_json::Value) -> String {
    let command = args
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("<unknown>");
    let output = args.get("output").and_then(|v| v.as_str()).unwrap_or("");
    format!("[Shell Hook] Command failed: `{command}`\nOutput:\n{output}")
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

    #[tokio::test]
    async fn invoke_pattern_with_default_handler_does_not_error() {
        let reg = ToolRegistry::new(vec![]);
        let ctx = ExecutionContext::test("s1", "a1");
        let args = serde_json::json!({});
        // Known patterns with default handlers must succeed.
        // transcript.inject is absent — default handler logs and returns Ok(false)
        // (false = did not handle compaction, caller should use inline fallback).
        let r = reg.invoke_pattern("loop:detected", &ctx, &args).await;
        assert!(r.is_ok());
        assert!(!r.unwrap(), "default handler returns false (fallback path)");
        let r = reg.invoke_pattern("guardrail:violation", &ctx, &args).await;
        assert!(r.is_ok());
        assert!(!r.unwrap());
        let r = reg
            .invoke_pattern("graph_guardrail:high_impact", &ctx, &args)
            .await;
        assert!(r.is_ok());
        assert!(!r.unwrap());
        let r = reg
            .invoke_pattern("shell:command_failed", &ctx, &args)
            .await;
        assert!(r.is_ok());
        assert!(!r.unwrap());
    }

    #[tokio::test]
    async fn invoke_pattern_unknown_pattern_does_not_error() {
        let reg = ToolRegistry::new(vec![]);
        let ctx = ExecutionContext::test("s1", "a1");
        let args = serde_json::json!({});
        // Unknown patterns should log and return Ok(false).
        let r = reg
            .invoke_pattern("some:unknown:pattern", &ctx, &args)
            .await;
        assert!(r.is_ok());
        assert!(!r.unwrap());
    }

    #[tokio::test]
    async fn invoke_pattern_loop_detected_formats_warning() {
        // When transcript.inject is registered, it should receive the formatted warning.
        // We use EchoTool to simulate transcript.inject for testing purposes.
        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(EchoTool {
            name: "transcript.inject".into(),
        })];
        let mut reg = ToolRegistry::new(tools);
        reg.set_event_only("transcript.inject");

        let ctx = ExecutionContext::test("s1", "a1");
        let args = serde_json::json!({
            "tool_name": "Bash",
            "count": 3,
            "window_size": 10,
        });
        // Default handler ran but returned false (no compaction delegation).
        let result = reg.invoke_pattern("loop:detected", &ctx, &args).await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn invoke_pattern_guardrail_violation_formats_warning() {
        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(EchoTool {
            name: "transcript.inject".into(),
        })];
        let mut reg = ToolRegistry::new(tools);
        reg.set_event_only("transcript.inject");

        let ctx = ExecutionContext::test("s1", "a1");
        let args = serde_json::json!({
            "tool_name": "Write",
            "rule": "not on the allow list",
        });
        let result = reg.invoke_pattern("guardrail:violation", &ctx, &args).await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[tokio::test]
    async fn invoke_pattern_shell_command_failed_formats_warning() {
        let tools: Vec<Arc<dyn Tool>> = vec![Arc::new(EchoTool {
            name: "transcript.inject".into(),
        })];
        let mut reg = ToolRegistry::new(tools);
        reg.set_event_only("transcript.inject");

        let ctx = ExecutionContext::test("s1", "a1");
        let args = serde_json::json!({
            "command": "cargo test",
            "exit_code": 1,
            "output": "test failed",
        });
        let result = reg
            .invoke_pattern("shell:command_failed", &ctx, &args)
            .await;
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }

    #[test]
    fn default_handler_formats_loop_detected_correctly() {
        let args = serde_json::json!({
            "tool_name": "Bash",
            "count": 3,
            "window_size": 10,
        });
        let text = format_loop_detected(&args);
        assert!(text.contains("Bash"));
        assert!(text.contains("3"));
        assert!(text.contains("10"));
        assert!(text.contains("WARNING"));
    }

    #[test]
    fn default_handler_formats_guardrail_violation_correctly() {
        let args = serde_json::json!({
            "tool_name": "Write",
            "rule": "not on the allow list",
        });
        let text = format_guardrail_violation(&args);
        assert!(text.contains("Write"));
        assert!(text.contains("Guardrails"));
    }

    #[test]
    fn default_handler_formats_shell_command_failed_correctly() {
        let args = serde_json::json!({
            "command": "cargo test",
            "output": "test failed",
        });
        let text = format_shell_command_failed(&args);
        assert!(text.contains("cargo test"));
        assert!(text.contains("test failed"));
        assert!(text.contains("Shell Hook"));
    }

    #[test]
    fn default_handler_formats_graph_guardrail_correctly() {
        let args = serde_json::json!({
            "warning": "MyTrait (trait) has 5 implementations — verify all are updated",
        });
        let text = format_graph_guardrail_high_impact(&args);
        assert!(text.contains("Graph Guardrails"));
        assert!(text.contains("MyTrait"));
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
