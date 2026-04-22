//! Chat stream protocol — typed events for real-time CLI/WebSocket chat.
//!
//! These events flow from the agent loop through the ActivityStream to
//! connected chat clients. Designed for token-by-token text streaming,
//! tool execution visibility, and agent lifecycle awareness.

use serde::{Deserialize, Serialize};

/// Whether a file was newly created or an existing file was modified.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileOperation {
    Created,
    Modified,
}

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

    /// Idea was recalled or stored.
    IdeaActivity {
        action: String, // "recalled" or "stored"
        name: String,
        preview: String,
    },

    /// An event handler fired during session lifecycle (e.g. session:start),
    /// injecting one or more ideas into the agent's context. The frontend
    /// renders this as an inline "event → ideas" chip row so the user can
    /// see exactly what context was added and by which event.
    ///
    /// `prepersisted` signals that the producer has already written the
    /// corresponding `event_fired` row and called `record_fire`. The daemon's
    /// wire-observer skips both writes when this is true, avoiding double
    /// persistence and double fire-count for events emitted by `spawn_session`
    /// (session:start, session:execution_start) that need their row ordered
    /// BEFORE the user-message row for correct UI timeline ordering.
    EventFired {
        event_id: String,
        event_name: String,
        pattern: String,
        idea_ids: Vec<String>,
        #[serde(default)]
        prepersisted: bool,
    },

    /// A file on disk was created or modified by the agent.
    FileChanged {
        tool_use_id: String,
        path: String,
        operation: FileOperation,
        bytes: u64,
    },

    /// A file was removed by the agent.
    FileDeleted { tool_use_id: String, path: String },

    /// A tool's output exceeded the size threshold and was summarized by the
    /// runtime before being injected back into the conversation. The `summary`
    /// field replaces the full output for display purposes.
    ToolSummarized {
        tool_use_id: String,
        tool_name: String,
        original_bytes: u64,
        summary: String,
    },

    /// Context was compacted.
    Compacted {
        original_messages: usize,
        remaining_messages: usize,
        compaction_number: u32,
        /// Paths re-read from disk after compaction stripped earlier file-read
        /// tool outputs. The UI shows a chip for each restored file.
        restored_files: Vec<String>,
    },

    /// Pre-compact snip stage: old conversation rounds deterministically
    /// removed from the compactable window to free tokens. No LLM call.
    /// Fires before the full LLM compaction so the UI can show the exact
    /// pipeline the runtime ran.
    SnipCompacted { tokens_freed: u32 },

    /// Pre-compact microcompact stage: the content of N oldest tool_results
    /// for "compactable" tools (shell, read, glob, grep) was replaced with a
    /// cleared sentinel so the raw tool output no longer occupies context.
    /// No LLM call.
    MicroCompacted { cleared: u32 },

    /// Pre-compact structural collapse: stale system messages removed and
    /// long tool results truncated to head+tail previews. No LLM call.
    ContextCollapsed { tokens_freed: u32 },

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

    /// Partial output from a failed streaming attempt should be discarded.
    /// Emitted when the agent loop recovers from a streaming error (reactive
    /// compact, fallback model switch) after TextDelta/ToolStart events were
    /// already sent. The frontend should discard any partial output from the
    /// step indicated by `step`.
    Tombstone { step: u32, reason: String },

    /// An error occurred.
    Error { message: String, recoverable: bool },
}

/// Ring buffer of events retained for late subscribers (e.g. hard refresh
/// mid-turn). Shared between the sender and the session registry so a new
/// subscriber can replay the current turn before hooking up to live fanout.
pub type EventBacklog =
    std::sync::Arc<std::sync::Mutex<std::collections::VecDeque<ChatStreamEvent>>>;

/// A chat stream sender that observers/middleware can use to emit events.
///
/// Wraps a tokio broadcast sender. Sending is non-blocking — if no
/// subscribers are connected, events are silently dropped.
///
/// When a backlog is attached (via [`Self::new_with_backlog`]), every
/// published event is also appended to the ring so late subscribers can
/// replay the current turn. The backlog is cleared when `Complete` or
/// `Error` is published — backlogs scope to ONE in-flight turn.
#[derive(Clone)]
pub struct ChatStreamSender {
    tx: tokio::sync::broadcast::Sender<ChatStreamEvent>,
    backlog: Option<(EventBacklog, usize)>,
}

impl ChatStreamSender {
    pub fn new(capacity: usize) -> (Self, tokio::sync::broadcast::Receiver<ChatStreamEvent>) {
        let (tx, rx) = tokio::sync::broadcast::channel(capacity);
        (Self { tx, backlog: None }, rx)
    }

    /// Like [`Self::new`] but also returns a handle to a shared backlog ring
    /// that retains the last `backlog_size` events of the current turn.
    pub fn new_with_backlog(
        capacity: usize,
        backlog_size: usize,
    ) -> (
        Self,
        tokio::sync::broadcast::Receiver<ChatStreamEvent>,
        EventBacklog,
    ) {
        let (tx, rx) = tokio::sync::broadcast::channel(capacity);
        let backlog: EventBacklog = std::sync::Arc::new(std::sync::Mutex::new(
            std::collections::VecDeque::with_capacity(backlog_size),
        ));
        (
            Self {
                tx,
                backlog: Some((backlog.clone(), backlog_size)),
            },
            rx,
            backlog,
        )
    }

    pub fn send(&self, event: ChatStreamEvent) {
        if let Some((backlog, cap)) = &self.backlog
            && let Ok(mut q) = backlog.lock()
        {
            let terminal = matches!(
                event,
                ChatStreamEvent::Complete { .. } | ChatStreamEvent::Error { .. }
            );
            if terminal {
                q.clear();
            } else {
                while q.len() >= *cap {
                    q.pop_front();
                }
                q.push_back(event.clone());
            }
            // Broadcast WHILE holding the backlog lock so a concurrent
            // `snapshot_and_subscribe` can't interleave between append
            // and broadcast. Either a subscriber sees the event in the
            // snapshot (ours runs first) or via the live channel (theirs
            // runs first) — never both.
            let _ = self.tx.send(event);
            return;
        }
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<ChatStreamEvent> {
        self.tx.subscribe()
    }

    /// Atomically snapshot the backlog and subscribe to the live stream.
    /// Holding the backlog lock across both operations guarantees no
    /// event is delivered twice: any concurrent `send` blocks on the
    /// backlog mutex, so it either lands in our snapshot or is
    /// broadcast strictly after our `rx` was created.
    pub fn snapshot_and_subscribe(
        &self,
    ) -> (
        Vec<ChatStreamEvent>,
        tokio::sync::broadcast::Receiver<ChatStreamEvent>,
    ) {
        if let Some((backlog, _cap)) = &self.backlog
            && let Ok(q) = backlog.lock()
        {
            let snapshot: Vec<_> = q.iter().cloned().collect();
            let rx = self.tx.subscribe();
            return (snapshot, rx);
        }
        (Vec::new(), self.tx.subscribe())
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(event: &ChatStreamEvent) -> ChatStreamEvent {
        let json = serde_json::to_string(event).expect("serialize");
        serde_json::from_str(&json).expect("deserialize")
    }

    fn assert_json_type(event: &ChatStreamEvent, expected_type: &str) {
        let v: serde_json::Value = serde_json::to_value(event).expect("to_value");
        assert_eq!(
            v["type"].as_str().unwrap_or(""),
            expected_type,
            "event type tag mismatch"
        );
    }

    #[test]
    fn file_changed_created_round_trip() {
        let event = ChatStreamEvent::FileChanged {
            tool_use_id: "tu_123".to_string(),
            path: "/workspace/src/main.rs".to_string(),
            operation: FileOperation::Created,
            bytes: 1024,
        };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::FileChanged {
                tool_use_id,
                path,
                operation,
                bytes,
            } => {
                assert_eq!(tool_use_id, "tu_123");
                assert_eq!(path, "/workspace/src/main.rs");
                assert!(matches!(operation, FileOperation::Created));
                assert_eq!(bytes, 1024);
            }
            _ => panic!("expected FileChanged"),
        }
        assert_json_type(&event, "FileChanged");
    }

    #[test]
    fn file_changed_modified_round_trip() {
        let event = ChatStreamEvent::FileChanged {
            tool_use_id: "tu_456".to_string(),
            path: "src/lib.rs".to_string(),
            operation: FileOperation::Modified,
            bytes: 2048,
        };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::FileChanged { operation, .. } => {
                assert!(matches!(operation, FileOperation::Modified));
            }
            _ => panic!("expected FileChanged"),
        }
        // Verify operation serializes as lowercase.
        let v: serde_json::Value = serde_json::to_value(&event).expect("to_value");
        assert_eq!(v["operation"].as_str().unwrap_or(""), "modified");
    }

    #[test]
    fn file_operation_serializes_lowercase() {
        let created = serde_json::to_value(FileOperation::Created).unwrap();
        let modified = serde_json::to_value(FileOperation::Modified).unwrap();
        assert_eq!(created.as_str().unwrap(), "created");
        assert_eq!(modified.as_str().unwrap(), "modified");
    }

    #[test]
    fn file_deleted_round_trip() {
        let event = ChatStreamEvent::FileDeleted {
            tool_use_id: "tu_789".to_string(),
            path: "/workspace/old.rs".to_string(),
        };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::FileDeleted { tool_use_id, path } => {
                assert_eq!(tool_use_id, "tu_789");
                assert_eq!(path, "/workspace/old.rs");
            }
            _ => panic!("expected FileDeleted"),
        }
        assert_json_type(&event, "FileDeleted");
    }

    #[test]
    fn tool_summarized_round_trip() {
        let event = ChatStreamEvent::ToolSummarized {
            tool_use_id: "tu_abc".to_string(),
            tool_name: "shell".to_string(),
            original_bytes: 50_000,
            summary: "Command output showed 3 errors in build log.".to_string(),
        };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::ToolSummarized {
                tool_use_id,
                tool_name,
                original_bytes,
                summary,
            } => {
                assert_eq!(tool_use_id, "tu_abc");
                assert_eq!(tool_name, "shell");
                assert_eq!(original_bytes, 50_000);
                assert!(summary.contains("errors"));
            }
            _ => panic!("expected ToolSummarized"),
        }
        assert_json_type(&event, "ToolSummarized");
    }

    #[test]
    fn compacted_with_restored_files_round_trip() {
        let event = ChatStreamEvent::Compacted {
            original_messages: 42,
            remaining_messages: 10,
            compaction_number: 1,
            restored_files: vec!["src/main.rs".to_string(), "src/lib.rs".to_string()],
        };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::Compacted {
                original_messages,
                remaining_messages,
                compaction_number,
                restored_files,
            } => {
                assert_eq!(original_messages, 42);
                assert_eq!(remaining_messages, 10);
                assert_eq!(compaction_number, 1);
                assert_eq!(restored_files.len(), 2);
                assert!(restored_files.contains(&"src/main.rs".to_string()));
            }
            _ => panic!("expected Compacted"),
        }
    }

    #[test]
    fn compacted_empty_restored_files_round_trip() {
        let event = ChatStreamEvent::Compacted {
            original_messages: 20,
            remaining_messages: 5,
            compaction_number: 0,
            restored_files: Vec::new(),
        };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::Compacted { restored_files, .. } => {
                assert!(restored_files.is_empty());
            }
            _ => panic!("expected Compacted"),
        }
    }

    #[test]
    fn snip_compacted_round_trip() {
        let event = ChatStreamEvent::SnipCompacted { tokens_freed: 1234 };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::SnipCompacted { tokens_freed } => {
                assert_eq!(tokens_freed, 1234);
            }
            _ => panic!("expected SnipCompacted"),
        }
        assert_json_type(&event, "SnipCompacted");
    }

    #[test]
    fn micro_compacted_round_trip() {
        let event = ChatStreamEvent::MicroCompacted { cleared: 7 };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::MicroCompacted { cleared } => {
                assert_eq!(cleared, 7);
            }
            _ => panic!("expected MicroCompacted"),
        }
        assert_json_type(&event, "MicroCompacted");
    }

    #[test]
    fn backlog_replays_to_late_subscriber_and_clears_on_complete() {
        let (sender, _seed_rx, _backlog) = ChatStreamSender::new_with_backlog(16, 8);

        sender.send(ChatStreamEvent::StepStart {
            step: 1,
            model: "m".into(),
        });
        sender.send(ChatStreamEvent::TextDelta { text: "a".into() });
        sender.send(ChatStreamEvent::TextDelta { text: "b".into() });

        // Late subscriber gets everything replayed.
        let (snapshot, mut rx) = sender.snapshot_and_subscribe();
        assert_eq!(snapshot.len(), 3);
        assert!(matches!(snapshot[0], ChatStreamEvent::StepStart { .. }));

        // Live events after attach flow through rx.
        sender.send(ChatStreamEvent::TextDelta { text: "c".into() });
        match rx.try_recv() {
            Ok(ChatStreamEvent::TextDelta { text }) => assert_eq!(text, "c"),
            other => panic!("expected TextDelta(c), got {other:?}"),
        }

        // Complete clears the backlog — a subsequent reconnect starts fresh.
        sender.send(ChatStreamEvent::Complete {
            stop_reason: "end_turn".into(),
            total_prompt_tokens: 0,
            total_completion_tokens: 0,
            iterations: 1,
            cost_usd: 0.0,
        });
        let (post_complete, _rx2) = sender.snapshot_and_subscribe();
        assert!(
            post_complete.is_empty(),
            "backlog must clear on Complete — got {post_complete:?}"
        );
    }

    #[test]
    fn backlog_drops_oldest_when_ring_is_full() {
        let (sender, _seed_rx, _backlog) = ChatStreamSender::new_with_backlog(16, 3);
        for i in 0..5 {
            sender.send(ChatStreamEvent::TextDelta {
                text: i.to_string(),
            });
        }
        let (snapshot, _rx) = sender.snapshot_and_subscribe();
        assert_eq!(snapshot.len(), 3);
        match &snapshot[0] {
            ChatStreamEvent::TextDelta { text } => assert_eq!(text, "2"),
            other => panic!("expected TextDelta(2), got {other:?}"),
        }
    }

    #[test]
    fn context_collapsed_round_trip() {
        let event = ChatStreamEvent::ContextCollapsed { tokens_freed: 9000 };
        let rt = round_trip(&event);
        match rt {
            ChatStreamEvent::ContextCollapsed { tokens_freed } => {
                assert_eq!(tokens_freed, 9000);
            }
            _ => panic!("expected ContextCollapsed"),
        }
        assert_json_type(&event, "ContextCollapsed");
    }
}
