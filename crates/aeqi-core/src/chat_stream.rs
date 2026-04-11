//! Chat stream protocol — typed events for real-time CLI/WebSocket chat.
//!
//! These events flow from the agent loop through the EventBroadcaster to
//! connected chat clients. Designed for token-by-token text streaming,
//! tool execution visibility, and agent lifecycle awareness.

use serde::{Deserialize, Serialize};

/// A streaming event emitted during chat-based agent execution.
///
/// Events are ordered and should be rendered incrementally by the client.
/// The protocol is designed so that a client joining mid-stream can
/// reconstruct the current state from the most recent `StepStart` event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ChatStreamEvent {
    /// Agent is starting a new step (LLM call).
    StepStart { step: u32, model: String },

    /// Incremental text token from the model's response.
    TextDelta { text: String },

    /// The model is invoking a tool.
    ToolStart {
        tool_use_id: String,
        tool_name: String,
    },

    /// Incremental output from a running tool (e.g., shell stdout).
    ToolProgress { tool_use_id: String, output: String },

    /// A tool execution completed.
    ToolComplete {
        tool_use_id: String,
        tool_name: String,
        success: bool,
        /// Human-readable summary of what was called (e.g., "ls -la /home/...").
        input_preview: String,
        /// Preview of the output (first 500 chars).
        output_preview: String,
        duration_ms: u64,
    },

    /// Status message from the agent runtime (e.g., "Compacting context...").
    Status { message: String },

    /// Agent is delegating to a subagent.
    DelegateStart {
        worker_name: String,
        task_subject: String,
    },

    /// Subagent completed its work.
    DelegateComplete {
        worker_name: String,
        outcome: String,
    },

    /// Memory was recalled or stored.
    MemoryActivity {
        action: String, // "recalled" or "stored"
        key: String,
        preview: String,
    },

    /// Context was compacted.
    Compacted {
        original_messages: usize,
        remaining_messages: usize,
        compaction_number: u32,
    },

    /// The agent's step is complete (model returned end_turn).
    StepComplete {
        step: u32,
        prompt_tokens: u32,
        completion_tokens: u32,
    },

    /// The entire agent run is finished.
    Complete {
        stop_reason: String,
        total_prompt_tokens: u32,
        total_completion_tokens: u32,
        iterations: u32,
        cost_usd: f64,
    },

    /// An error occurred.
    Error { message: String, recoverable: bool },
}

/// A chat stream sender that observers/middleware can use to emit events.
///
/// Wraps a tokio broadcast sender. Sending is non-blocking — if no
/// subscribers are connected, events are silently dropped.
#[derive(Clone)]
pub struct ChatStreamSender {
    tx: tokio::sync::broadcast::Sender<ChatStreamEvent>,
}

impl ChatStreamSender {
    pub fn new(capacity: usize) -> (Self, tokio::sync::broadcast::Receiver<ChatStreamEvent>) {
        let (tx, rx) = tokio::sync::broadcast::channel(capacity);
        (Self { tx }, rx)
    }

    pub fn send(&self, event: ChatStreamEvent) {
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<ChatStreamEvent> {
        self.tx.subscribe()
    }

    pub fn subscriber_count(&self) -> usize {
        self.tx.receiver_count()
    }
}

impl std::fmt::Debug for ChatStreamSender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChatStreamSender")
            .field("subscribers", &self.tx.receiver_count())
            .finish()
    }
}
