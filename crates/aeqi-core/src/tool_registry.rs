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
use tracing::{info, warn};

use crate::chat_stream::ChatStreamSender;
use crate::credentials::{CredentialResolver, ResolutionScope};
use crate::traits::{Tool, ToolResult};

/// Decouples the agent's pattern-firing path from the orchestrator's event store.
///
/// The orchestrator implements this trait; the agent calls `dispatch` when it
/// needs to fire a pattern (e.g. `context:budget:exceeded`). If any enabled
/// event is configured for the pattern, `dispatch` runs its tool_calls and
/// returns `true` so the caller can skip the inline fallback path.
///
/// Returning `false` tells the caller to use the built-in fallback — important
/// for bare-CLI / test environments where the event store is not available.
pub trait PatternDispatcher: Send + Sync + 'static {
    /// Fire all enabled events matching `pattern`, executing their `tool_calls`.
    ///
    /// `trigger_args`: structured context from the detector, substituted into
    /// event tool_call args (e.g. `{session_id}`, `{estimated_tokens}`).
    /// `ctx`: execution context for ACL checks and session-id injection.
    ///
    /// Return semantic: **"did any matching event run?"** — regardless of
    /// whether its tool_calls produced context output. Returns `true` when
    /// at least one enabled event with a non-empty tool_calls list was
    /// dispatched (even if individual tools returned `is_error`; those are
    /// logged, not fatal). Returns `false` only when no event was configured
    /// for the pattern, or every matching event had an empty tool_calls list.
    ///
    /// Pure side-effect chains (session.spawn → ideas.store_many,
    /// session.spawn → transcript.replace_middle) still return `true` — the
    /// previous "produces context" semantic silently failed the inline
    /// fallback suppression for compaction and consolidation. Callers that
    /// need the *context* output from an event (rare; only the assembly
    /// pipeline does) consume `parts` directly, not this return value.
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
#[derive(Clone, Default)]
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
    /// Optional credential resolver. When wired, `ToolRegistry::invoke`
    /// resolves `Tool::required_credentials()` before calling the tool.
    /// `None` in bare-CLI / test contexts where no credential substrate is
    /// available — tools that declare credentials gracefully degrade by
    /// receiving `None` for each slot (and may surface a tool error if
    /// they treat the credential as required).
    pub credential_resolver: Option<CredentialResolver>,
    /// Optional user/channel/installation scoping for the resolver. The
    /// `agent_id` field above always populates the agent-scope fallback.
    pub credential_scope: ResolutionScope,
}

impl std::fmt::Debug for ExecutionContext {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExecutionContext")
            .field("session_id", &self.session_id)
            .field("agent_id", &self.agent_id)
            .field("user_input", &self.user_input)
            .field("transcript_tail", &self.transcript_tail)
            .field("quest_description", &self.quest_description)
            .field("tool_deny", &self.tool_deny)
            .field("has_chat_stream", &self.chat_stream.is_some())
            .field(
                "has_credential_resolver",
                &self.credential_resolver.is_some(),
            )
            .field("credential_scope", &self.credential_scope)
            .finish()
    }
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
    /// (T1.12a) Tag-policy-derived default cap on in-context result size, in
    /// chars. Applies when a tool returns `None` from `max_result_chars()`.
    /// Wired by the orchestrator from the merged `EffectivePolicy`. `None`
    /// (default) preserves the pre-T1.12 unbounded behaviour.
    default_max_result_chars: Option<usize>,
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
            default_max_result_chars: None,
        }
    }

    /// (T1.12a) Set the registry-wide default cap on in-context result size.
    /// Applies to tools that return `None` from `max_result_chars()`.
    /// Pass `None` to disable the default (pre-T1.12 behaviour).
    pub fn set_default_max_result_chars(&mut self, cap: Option<usize>) {
        self.default_max_result_chars = cap;
    }

    /// Read the registry-wide default cap on in-context result size.
    pub fn default_max_result_chars(&self) -> Option<usize> {
        self.default_max_result_chars
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
    ///
    /// Credential resolution:
    ///  - If the tool declares `required_credentials()` and `ctx` has a
    ///    [`CredentialResolver`] wired up, each need is resolved against
    ///    the substrate before `execute_with_credentials` is called.
    ///  - A required credential that fails to resolve becomes a
    ///    `ToolResult::error` carrying a stable reason code (see
    ///    `CredentialReasonCode::as_str`) instead of invoking the tool.
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

        let needs = tool.required_credentials();
        if needs.is_empty() {
            let result = tool.execute(args).await?;
            return Ok(self.maybe_truncate_result(tool.as_ref(), result));
        }

        let resolver = match ctx.credential_resolver.as_ref() {
            Some(r) => r,
            None => {
                // No resolver wired — tools that declared credentials get
                // a vector of `None`s. Required-but-absent treatment is up
                // to the tool's `execute_with_credentials`.
                let none_vec = needs.iter().map(|_| None).collect::<Vec<_>>();
                let result = tool.execute_with_credentials(args, none_vec).await?;
                return Ok(self.maybe_truncate_result(tool.as_ref(), result));
            }
        };

        // Build the resolution scope from ctx (agent_id always present;
        // user/channel/installation come from ctx.credential_scope).
        let mut scope = ctx.credential_scope.clone();
        if scope.agent_id.is_none() && !ctx.agent_id.is_empty() {
            scope.agent_id = Some(ctx.agent_id.clone());
        }

        let mut resolved: Vec<Option<crate::credentials::UsableCredential>> =
            Vec::with_capacity(needs.len());
        for need in &needs {
            match resolver.resolve(need, &scope).await {
                Ok(opt) => resolved.push(opt),
                Err(e) => {
                    warn!(
                        tool = %tool_name,
                        provider = need.provider,
                        name = need.name,
                        code = %e.code,
                        "credential resolution failed",
                    );
                    return Ok(ToolResult::error(format!(
                        "{}: {} (provider={} name={})",
                        e.code, e.message, need.provider, need.name
                    )));
                }
            }
        }

        let result = tool
            .execute_with_credentials(args.clone(), resolved.clone())
            .await?;

        // Refresh-on-401 retry: a tool that hit a 401 from the upstream
        // provider returns `is_error=true` with `data = {"reason_code":
        // "auth_expired", "credential_id": "..."}`. The registry refreshes
        // the offending credential and re-invokes the tool exactly once.
        // If the second attempt also returns `auth_expired` we surface the
        // result verbatim — the framework guarantees at-most-one retry.
        if result.is_error
            && result.data.get("reason_code").and_then(|v| v.as_str()) == Some("auth_expired")
            && let Some(credential_id) = result.data.get("credential_id").and_then(|v| v.as_str())
        {
            let refreshed = match resolver.refresh_by_id(credential_id).await {
                Ok(c) => c,
                Err(e) => {
                    warn!(
                        tool = %tool_name,
                        credential_id,
                        code = %e.code,
                        "refresh-on-401 failed",
                    );
                    return Ok(ToolResult::error(format!(
                        "{}: {} (credential_id={credential_id})",
                        e.code, e.message
                    )));
                }
            };
            // Replace the matching slot in `resolved` with the freshly-minted
            // credential. We match by id so multi-credential tools retry only
            // the slot that 401'd.
            for slot in resolved.iter_mut() {
                if slot
                    .as_ref()
                    .map(|c| c.id == credential_id)
                    .unwrap_or(false)
                {
                    *slot = Some(refreshed.clone());
                }
            }
            let retried = tool.execute_with_credentials(args, resolved).await?;
            return Ok(self.maybe_truncate_result(tool.as_ref(), retried));
        }

        Ok(self.maybe_truncate_result(tool.as_ref(), result))
    }

    /// (T1.12a) Apply per-tool / tag-policy max_result_chars truncation to a
    /// fresh `ToolResult`. The full original output is stashed under
    /// `data._full_output` so persistence layers can still record the
    /// un-truncated content into `event_invocations`. The marker shape is
    /// `[truncated; full result available via tool_invocation_id=<id>]`
    /// where `<id>` is a freshly-minted UUID; callers that persist the
    /// truncation event log this id alongside the full output for retrieval.
    ///
    /// `tool.max_result_chars()` overrides the registry-level
    /// `default_max_result_chars`. `None` from both disables truncation.
    fn maybe_truncate_result(&self, tool: &dyn Tool, mut result: ToolResult) -> ToolResult {
        let cap = tool.max_result_chars().or(self.default_max_result_chars);
        let Some(cap) = cap else {
            return result;
        };
        if result.output.len() <= cap {
            return result;
        }
        // Honour char boundaries so we don't slice a multi-byte UTF-8 sequence.
        let mut end = cap.min(result.output.len());
        while end > 0 && !result.output.is_char_boundary(end) {
            end -= 1;
        }
        let invocation_id = uuid::Uuid::new_v4();
        let full = std::mem::take(&mut result.output);
        let mut truncated = String::with_capacity(end + 96);
        truncated.push_str(&full[..end]);
        truncated.push_str(&format!(
            "\n[truncated; full result available via tool_invocation_id={invocation_id}]"
        ));
        result.output = truncated;
        // Stash the full original for downstream persistence. We extend
        // existing object data when present; otherwise build a fresh map.
        match &mut result.data {
            serde_json::Value::Object(map) => {
                map.insert("_full_output".to_string(), serde_json::Value::String(full));
                map.insert(
                    "_tool_invocation_id".to_string(),
                    serde_json::Value::String(invocation_id.to_string()),
                );
            }
            _ => {
                let mut map = serde_json::Map::new();
                map.insert("_full_output".to_string(), serde_json::Value::String(full));
                map.insert(
                    "_tool_invocation_id".to_string(),
                    serde_json::Value::String(invocation_id.to_string()),
                );
                result.data = serde_json::Value::Object(map);
            }
        }
        info!(
            tool = %tool.name(),
            tool_invocation_id = %invocation_id,
            cap,
            full_len = result
                .data
                .get("_full_output")
                .and_then(|v| v.as_str())
                .map(|s| s.len())
                .unwrap_or(0),
            "tool result truncated; full output preserved on data._full_output"
        );
        result
    }

    /// Whether the named tool's `output` is context (e.g. `ideas.assemble`)
    /// rather than a side-effect diagnostic (e.g. `transcript.inject`). Used
    /// by event dispatch to decide whether to append output to assembled parts.
    ///
    /// Returns `false` for unknown tools (safe default).
    pub fn produces_context(&self, tool_name: &str) -> bool {
        self.tools
            .get(tool_name)
            .map(|t| t.produces_context())
            .unwrap_or(false)
    }

    /// Fire all events configured for `pattern`, running their tool_calls.
    ///
    /// The registry has no event store wired — this method always returns `Ok(false)`
    /// so callers know to use their inline fallback. Operator-configurable event
    /// dispatch goes through `PatternDispatcher` (implemented by the orchestrator via
    /// its event store). This method is the bare-CLI / test fallback entry point that
    /// middleware detectors call; the pattern fires through `PatternDispatcher` when
    /// a full orchestrator is running.
    pub async fn invoke_pattern(
        &self,
        pattern: &str,
        ctx: &ExecutionContext,
        _trigger_args: &serde_json::Value,
    ) -> Result<bool> {
        info!(
            pattern = %pattern,
            session = %ctx.session_id,
            "invoke_pattern: no event store wired (bare registry — caller should use PatternDispatcher)"
        );
        Ok(false)
    }
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

    /// Returns a fixed-size `output` so we can verify truncation cleanly.
    struct OversizedTool {
        name: String,
        size: usize,
        per_tool_cap: Option<usize>,
    }

    #[async_trait]
    impl Tool for OversizedTool {
        async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
            Ok(ToolResult::success("a".repeat(self.size)))
        }
        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: self.name.clone(),
                description: "oversized tool".into(),
                input_schema: serde_json::json!({"type": "object"}),
            }
        }
        fn name(&self) -> &str {
            &self.name
        }
        fn max_result_chars(&self) -> Option<usize> {
            self.per_tool_cap
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

    /// invoke_pattern always returns Ok(false) — no event store is wired in the
    /// bare ToolRegistry. Callers should use PatternDispatcher for event-driven
    /// dispatch; this method is a pass-through for bare-CLI / test environments.
    #[tokio::test]
    async fn invoke_pattern_always_returns_false() {
        let reg = ToolRegistry::new(vec![]);
        let ctx = ExecutionContext::test("s1", "a1");
        let args = serde_json::json!({});
        // All patterns return Ok(false) — no default handler fallback.
        for pattern in &[
            "loop:detected",
            "guardrail:violation",
            "graph_guardrail:high_impact",
            "shell:command_failed",
            "some:unknown:pattern",
        ] {
            let r = reg.invoke_pattern(pattern, &ctx, &args).await;
            assert!(r.is_ok(), "invoke_pattern must not error for {pattern}");
            assert!(
                !r.unwrap(),
                "invoke_pattern must return false (no event store) for {pattern}"
            );
        }
    }

    // ── T1.12a max_result_chars truncation ─────────────────────────────────

    /// Test 1: tool returning oversized result with a tight per-tool cap →
    /// in-context output is truncated and the marker is appended; the full
    /// original output is preserved on `data._full_output` so the
    /// persistence layer can record the un-truncated text.
    #[tokio::test]
    async fn t1_12a_per_tool_cap_truncates_with_marker_and_preserves_full() {
        let tool = Arc::new(OversizedTool {
            name: "big".into(),
            size: 10_000,
            per_tool_cap: Some(512),
        });
        let reg = ToolRegistry::new(vec![tool]);
        let ctx = ExecutionContext::test("s", "a");

        let res = reg
            .invoke("big", serde_json::json!({}), CallerKind::System, &ctx)
            .await
            .unwrap();

        // First 512 chars are kept verbatim, then the marker is appended.
        assert!(
            res.output.starts_with(&"a".repeat(512)),
            "first 512 chars must survive truncation, got: {}",
            &res.output[..res.output.len().min(40)]
        );
        assert!(
            res.output
                .contains("[truncated; full result available via tool_invocation_id="),
            "marker must be appended; got: {}",
            &res.output[res.output.len().saturating_sub(120)..]
        );
        // Marker shape is recoverable: ends with `=<id>]`.
        assert!(res.output.trim_end().ends_with(']'));
        // Full original is preserved on data._full_output for persistence.
        let full = res
            .data
            .get("_full_output")
            .and_then(|v| v.as_str())
            .expect("_full_output must be present on truncated result");
        assert_eq!(full.len(), 10_000);
        // The invocation id is also exposed for log correlation.
        assert!(
            res.data
                .get("_tool_invocation_id")
                .and_then(|v| v.as_str())
                .is_some()
        );
    }

    /// Test 2: a tool that does NOT override `max_result_chars` and a
    /// registry without a default cap → no truncation, no marker, no
    /// `_full_output` side channel.
    #[tokio::test]
    async fn t1_12a_no_cap_means_no_truncation() {
        let tool = Arc::new(OversizedTool {
            name: "big".into(),
            size: 10_000,
            per_tool_cap: None,
        });
        let reg = ToolRegistry::new(vec![tool]);
        let ctx = ExecutionContext::test("s", "a");

        let res = reg
            .invoke("big", serde_json::json!({}), CallerKind::System, &ctx)
            .await
            .unwrap();
        assert_eq!(res.output.len(), 10_000);
        assert!(!res.output.contains("[truncated"));
        assert!(res.data.is_null());
    }

    /// Test 3: tag-policy default applies when the tool doesn't override.
    /// The registry's `set_default_max_result_chars` represents the merged
    /// effective policy from `tag_policy.rs`; a tool returning `None`
    /// inherits this cap.
    #[tokio::test]
    async fn t1_12a_registry_default_applies_when_tool_does_not_override() {
        let tool = Arc::new(OversizedTool {
            name: "big".into(),
            size: 10_000,
            per_tool_cap: None,
        });
        let mut reg = ToolRegistry::new(vec![tool]);
        reg.set_default_max_result_chars(Some(1024));
        let ctx = ExecutionContext::test("s", "a");

        let res = reg
            .invoke("big", serde_json::json!({}), CallerKind::System, &ctx)
            .await
            .unwrap();
        assert!(res.output.len() < 10_000, "output must be truncated");
        assert!(res.output.starts_with(&"a".repeat(1024)));
        assert!(
            res.output
                .contains("[truncated; full result available via tool_invocation_id=")
        );
        assert_eq!(
            res.data
                .get("_full_output")
                .and_then(|v| v.as_str())
                .map(|s| s.len()),
            Some(10_000)
        );
    }

    /// Test 4: per-tool override beats the registry default. Tool says
    /// 2048 chars; registry default is 1024 → the tool's looser cap applies
    /// (2048).
    #[tokio::test]
    async fn t1_12a_tool_override_beats_registry_default() {
        let tool = Arc::new(OversizedTool {
            name: "big".into(),
            size: 10_000,
            per_tool_cap: Some(2048),
        });
        let mut reg = ToolRegistry::new(vec![tool]);
        reg.set_default_max_result_chars(Some(1024));
        let ctx = ExecutionContext::test("s", "a");

        let res = reg
            .invoke("big", serde_json::json!({}), CallerKind::System, &ctx)
            .await
            .unwrap();
        assert!(res.output.starts_with(&"a".repeat(2048)));
        // The 1025th char must still be present (proving the registry
        // default of 1024 did NOT bind). The marker portion of `output`
        // may contain hex 'a's from the UUID, so split at the marker
        // boundary before counting.
        let marker_idx = res
            .output
            .find("\n[truncated;")
            .expect("truncation marker must be present");
        assert_eq!(
            res.output[..marker_idx]
                .chars()
                .filter(|c| *c == 'a')
                .count(),
            2048,
            "exactly 2048 'a' chars must precede the marker (per-tool cap binds, not 1024 default)"
        );
        assert!(
            res.output
                .contains("[truncated; full result available via tool_invocation_id=")
        );
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
