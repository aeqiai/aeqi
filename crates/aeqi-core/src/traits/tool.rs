use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::provider::ToolSpec;
use crate::credentials::{CredentialNeed, UsableCredential};

/// Modification to apply to the agent context after a tool executes.
/// Tools return these to evolve the agent's capabilities mid-session.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ContextModifier {
    /// System message to inject before the next step.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inject_system_message: Option<String>,
    /// Tool specs to add to the agent's available tools for subsequent steps.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub add_tool_specs: Vec<ToolSpec>,
}

/// Result of executing a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    /// Human-readable / LLM-facing summary. This is what gets appended to
    /// assembled context, shown in traces, and referenced by `{tool_calls.N.output}`
    /// string substitution in event tool_calls.
    pub output: String,
    pub is_error: bool,
    /// Structured side-channel. Tools that produce data worth chaining (e.g.
    /// `session.spawn` returning a new session_id + summary) populate this so
    /// subsequent tool_calls in the same event firing can reference specific
    /// fields via `{tool_calls.N.data.path}` substitution. Defaults to `Null`
    /// when the tool has nothing typed to expose beyond `output`.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
    /// Optional context modifier applied after this tool completes.
    /// Only honored for non-concurrent tools (to avoid race conditions).
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub context_modifier: Option<ContextModifier>,
    /// Optional quality signal in `[0.0, 1.0]`. When a tool returns a score the
    /// dispatcher persists it on `event_invocations.outcome_score` so later
    /// consolidation can treat it as a generic outcome metric. Out-of-range
    /// values are clamped at the dispatcher boundary; tools should still keep
    /// values in range to avoid the warning.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub outcome_score: Option<f64>,
    /// Optional free-form details accompanying `outcome_score`. Persisted as
    /// `event_invocations.outcome_details` when present.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub outcome_details: Option<String>,
}

impl ToolResult {
    pub fn success(output: impl Into<String>) -> Self {
        Self {
            output: output.into(),
            is_error: false,
            data: serde_json::Value::Null,
            context_modifier: None,
            outcome_score: None,
            outcome_details: None,
        }
    }

    pub fn error(output: impl Into<String>) -> Self {
        Self {
            output: output.into(),
            is_error: true,
            data: serde_json::Value::Null,
            context_modifier: None,
            outcome_score: None,
            outcome_details: None,
        }
    }

    /// Attach structured data to this result. Downstream tool_calls in the same
    /// event firing can reference fields via `{tool_calls.N.data.path}` substitution.
    pub fn with_data(mut self, data: serde_json::Value) -> Self {
        self.data = data;
        self
    }

    /// Attach a context modifier to this result.
    pub fn with_context_modifier(mut self, modifier: ContextModifier) -> Self {
        self.context_modifier = Some(modifier);
        self
    }

    /// Attach a quality score in `[0.0, 1.0]`. Out-of-range values are still
    /// stored verbatim here; clamping happens at the dispatcher boundary so
    /// the warning fires once per offending tool call.
    pub fn with_outcome_score(mut self, score: f64) -> Self {
        self.outcome_score = Some(score);
        self
    }

    /// Attach free-form outcome details paired with `outcome_score`.
    pub fn with_outcome_details(mut self, details: impl Into<String>) -> Self {
        self.outcome_details = Some(details.into());
        self
    }
}

/// What happens when the user interrupts during tool execution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterruptBehavior {
    /// Stop the tool and discard its result.
    Cancel,
    /// Keep running; the interruption waits until the tool finishes.
    Block,
}

/// Tool execution trait. Each tool implements this.
#[async_trait]
pub trait Tool: Send + Sync {
    /// Execute the tool with given arguments.
    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult>;

    /// Return the tool specification for LLM function calling.
    fn spec(&self) -> ToolSpec;

    /// Tool name (must match spec().name).
    fn name(&self) -> &str;

    /// Whether this tool is safe to run concurrently with other concurrent-safe tools.
    /// Read-only tools (file reads, searches, greps) should return true.
    /// Write tools (file edits, shell commands that mutate) should return false.
    /// The agent runs concurrent-safe tools in parallel and exclusive tools sequentially.
    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }

    /// Whether this tool performs irreversible operations (delete, overwrite, send).
    /// Used by permission systems and safety checks.
    fn is_destructive(&self, _input: &serde_json::Value) -> bool {
        false
    }

    /// Whether errors from this tool should cancel sibling tools in a concurrent batch.
    /// Only shell/bash tools should return true — they often have implicit dependency
    /// chains where a failure invalidates siblings. Read-only tools (file reads, searches)
    /// should not cascade errors since they are independent queries.
    fn cascades_error_to_siblings(&self) -> bool {
        false
    }

    /// What should happen when the user interrupts while this tool is running.
    /// Default: Block (keep running).
    fn interrupt_behavior(&self) -> InterruptBehavior {
        InterruptBehavior::Block
    }

    /// Maximum result size in characters before the result is persisted to disk.
    /// Returns None to use the agent's default (50K chars).
    /// Tools that self-bound their output (e.g., file read with token limit)
    /// can return Some(usize::MAX) to opt out of persistence.
    fn max_result_size_chars(&self) -> Option<usize> {
        None
    }

    /// (T1.12a) Maximum **in-context** result size in characters before
    /// `ToolRegistry::invoke` truncates the output sent back to callers
    /// (e.g. an LLM tool_result message, an event tool_call output reference).
    ///
    /// `None` disables per-tool truncation. When the registry has a
    /// tag-policy default configured, that default applies for tools that
    /// don't override.
    ///
    /// Returning `Some(n)`: outputs longer than `n` chars are truncated to
    /// `n` chars and the marker
    /// `[truncated; full result available via tool_invocation_id=<id>]`
    /// is appended. The full original output is preserved on
    /// `ToolResult.data._full_output` so the persistence layer can record
    /// the un-truncated text into `event_invocations.event_invocation_steps`.
    fn max_result_chars(&self) -> Option<usize> {
        None
    }

    /// Human-readable activity description for spinner/status display.
    /// e.g., "Reading src/main.rs", "Searching for pattern".
    fn activity_description(&self, _input: &serde_json::Value) -> Option<String> {
        None
    }

    /// Whether this tool's `output` should be appended to an event's assembled
    /// context parts when invoked via the event dispatch path.
    ///
    /// True for tools whose output IS context (e.g. `ideas.assemble` returning
    /// the assembled idea bodies). False for side-effect tools whose `output`
    /// is a diagnostic acknowledgement (e.g. `transcript.inject`,
    /// `session.spawn`, `session.send`) — those must not leak into the LLM
    /// prompt or the model will echo the diagnostic back as if it were an
    /// instruction.
    ///
    /// Default is `false` (safe — only whitelisted context-producing tools
    /// contribute to assembled parts). Does not affect LLM-invoked tool_calls,
    /// which always feed `output` back as a tool_result message.
    fn produces_context(&self) -> bool {
        false
    }

    /// Credentials this tool needs from the substrate before execution.
    ///
    /// The runtime resolves these into concrete `UsableCredential`s before
    /// calling `execute()`. Tools that don't need any credential (the
    /// majority — file reads, shell, ideas.*) leave this as the default
    /// empty list and run unchanged.
    ///
    /// Resolution policy and reason-code mapping live in
    /// `aeqi_core::credentials::CredentialResolver`. A required credential
    /// that fails to resolve becomes a `ToolResult::error` carrying the
    /// stable reason code (see `CredentialReasonCode`).
    fn required_credentials(&self) -> Vec<CredentialNeed> {
        Vec::new()
    }

    /// Execute with credentials resolved by the runtime.
    ///
    /// Default implementation delegates to `execute(args)` and ignores the
    /// credentials. Tools that declare `required_credentials()` override
    /// this method to consume the resolved credentials.
    ///
    /// `credentials[i]` corresponds to `required_credentials()[i]`. For
    /// optional needs that resolved to `None`, the slot is `None`.
    async fn execute_with_credentials(
        &self,
        args: serde_json::Value,
        _credentials: Vec<Option<UsableCredential>>,
    ) -> anyhow::Result<ToolResult> {
        self.execute(args).await
    }
}
