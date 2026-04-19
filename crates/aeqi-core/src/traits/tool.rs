use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use super::provider::ToolSpec;

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
}

impl ToolResult {
    pub fn success(output: impl Into<String>) -> Self {
        Self {
            output: output.into(),
            is_error: false,
            data: serde_json::Value::Null,
            context_modifier: None,
        }
    }

    pub fn error(output: impl Into<String>) -> Self {
        Self {
            output: output.into(),
            is_error: true,
            data: serde_json::Value::Null,
            context_modifier: None,
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

    /// Human-readable activity description for spinner/status display.
    /// e.g., "Reading src/main.rs", "Searching for pattern".
    fn activity_description(&self, _input: &serde_json::Value) -> Option<String> {
        None
    }
}
