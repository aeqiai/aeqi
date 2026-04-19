// design note: transcript.replace_middle is the compaction-as-delegation
// companion to transcript.inject. Where transcript.inject appends a message,
// transcript.replace_middle removes the middle messages (between head and tail
// preservation boundaries) and inserts a replacement message in their place.
//
// This is how compaction-as-delegation achieves continuation-in-place: the
// compactor session produces a summary, transcript.inject writes it, then
// transcript.replace_middle removes the original middle messages that were
// summarised. Session identity (session_id) is preserved throughout, so
// subscribers and the UI see no churn.
//
// ACL: event_only — allowing the LLM to remove its own history would be a
// self-lobotomy attack surface.

use std::sync::Arc;

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use tracing::info;

use crate::session_store::SessionStore;

/// Replaces the middle messages in a session's transcript.
///
/// Preserves the first `preserve_head` messages and the last `preserve_tail`
/// messages, deleting everything in between and inserting
/// `replacement_message` at the seam.
///
/// Args:
/// ```json
/// {
///   "preserve_head": 3,
///   "preserve_tail": 6,
///   "replacement_role": "system",
///   "replacement_content": "# Context Summary\n...",
///   "_session_id": "<injected by event dispatcher>"
/// }
/// ```
///
/// ACL: event_only (set in `build_runtime_registry`).
pub struct TranscriptReplaceMiddleTool {
    session_store: Option<Arc<SessionStore>>,
}

impl TranscriptReplaceMiddleTool {
    pub fn new(session_store: Option<Arc<SessionStore>>) -> Self {
        Self { session_store }
    }
}

#[async_trait]
impl Tool for TranscriptReplaceMiddleTool {
    fn name(&self) -> &str {
        "transcript.replace_middle"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "transcript.replace_middle".into(),
            description: "Replace the middle messages in the current session's transcript. \
                          Preserves the first `preserve_head` messages and last `preserve_tail` \
                          messages; deletes everything between them and inserts \
                          `replacement_role`/`replacement_content` at the seam. \
                          Only callable by events."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "preserve_head": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Number of messages to keep from the start of the transcript."
                    },
                    "preserve_tail": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Number of messages to keep from the end of the transcript."
                    },
                    "replacement_role": {
                        "type": "string",
                        "enum": ["system", "user", "assistant"],
                        "description": "Role for the replacement message inserted at the seam."
                    },
                    "replacement_content": {
                        "type": "string",
                        "description": "Content of the replacement message."
                    },
                    "_session_id": {
                        "type": "string",
                        "description": "Runtime-injected session ID (set by event dispatcher)."
                    }
                },
                "required": ["preserve_head", "preserve_tail", "replacement_role", "replacement_content"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let preserve_head = match args.get("preserve_head").and_then(|v| v.as_u64()) {
            Some(n) => n as usize,
            None => {
                return Ok(ToolResult::error(
                    "transcript.replace_middle: missing or invalid 'preserve_head'",
                ));
            }
        };

        let preserve_tail = match args.get("preserve_tail").and_then(|v| v.as_u64()) {
            Some(n) => n as usize,
            None => {
                return Ok(ToolResult::error(
                    "transcript.replace_middle: missing or invalid 'preserve_tail'",
                ));
            }
        };

        let replacement_role = match args.get("replacement_role").and_then(|v| v.as_str()) {
            Some(r) if ["system", "user", "assistant"].contains(&r) => r.to_string(),
            Some(r) => {
                return Ok(ToolResult::error(format!(
                    "transcript.replace_middle: invalid replacement_role '{r}', must be system/user/assistant"
                )));
            }
            None => {
                return Ok(ToolResult::error(
                    "transcript.replace_middle: missing required field 'replacement_role'",
                ));
            }
        };

        let replacement_content = match args.get("replacement_content").and_then(|v| v.as_str()) {
            Some(c) if !c.is_empty() => c.to_string(),
            _ => {
                return Ok(ToolResult::error(
                    "transcript.replace_middle: missing or empty 'replacement_content'",
                ));
            }
        };

        let session_id = match args.get("_session_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                return Ok(ToolResult::error(
                    "transcript.replace_middle: missing '_session_id' (must be injected by event dispatcher)",
                ));
            }
        };

        let store = match self.session_store.as_ref() {
            Some(s) => s,
            None => {
                return Ok(ToolResult::error(
                    "transcript.replace_middle: no session store configured",
                ));
            }
        };

        // Fetch current messages to determine which rows to delete.
        let messages = match store.history_by_session(&session_id, 10_000).await {
            Ok(msgs) => msgs,
            Err(e) => {
                return Ok(ToolResult::error(format!(
                    "transcript.replace_middle: failed to load transcript: {e}"
                )));
            }
        };

        let total = messages.len();
        // Guard: if head + tail >= total, nothing to replace.
        if preserve_head + preserve_tail >= total {
            return Ok(ToolResult::success(format!(
                "transcript.replace_middle: nothing to replace \
                 (total={total}, preserve_head={preserve_head}, preserve_tail={preserve_tail})"
            )));
        }

        let middle_count = total - preserve_head - preserve_tail;

        // Soft-delete middle messages and insert replacement via the store.
        match store
            .summarize_range_by_session(&session_id, preserve_head, preserve_tail)
            .await
        {
            Ok(deleted) => {
                match store
                    .record_by_session(
                        &session_id,
                        &replacement_role,
                        &replacement_content,
                        Some("compaction"),
                    )
                    .await
                {
                    Ok(()) => {
                        let preview: String = replacement_content.chars().take(80).collect();
                        let ellipsis = if replacement_content.len() > 80 {
                            "…"
                        } else {
                            ""
                        };
                        info!(
                            session = %session_id,
                            deleted = deleted,
                            middle_count = middle_count,
                            "transcript.replace_middle: replaced middle with compaction summary"
                        );
                        Ok(ToolResult::success(format!(
                            "replaced_middle: {deleted} messages summarized, \
                             replacement inserted: {replacement_role}: {preview}{ellipsis}"
                        )))
                    }
                    Err(e) => Ok(ToolResult::error(format!(
                        "transcript.replace_middle: failed to insert replacement: {e}"
                    ))),
                }
            }
            Err(e) => Ok(ToolResult::error(format!(
                "transcript.replace_middle: failed to summarize messages: {e}"
            ))),
        }
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false // transcript writes must be sequential
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn missing_session_store_returns_error() {
        let tool = TranscriptReplaceMiddleTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "preserve_head": 3,
                "preserve_tail": 6,
                "replacement_role": "system",
                "replacement_content": "# Summary",
                "_session_id": "s1"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("no session store"));
    }

    #[tokio::test]
    async fn invalid_role_returns_error() {
        let tool = TranscriptReplaceMiddleTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "preserve_head": 3,
                "preserve_tail": 6,
                "replacement_role": "oracle",
                "replacement_content": "# Summary",
                "_session_id": "s1"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("invalid replacement_role"));
    }

    #[tokio::test]
    async fn missing_session_id_returns_error() {
        let tool = TranscriptReplaceMiddleTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "preserve_head": 3,
                "preserve_tail": 6,
                "replacement_role": "system",
                "replacement_content": "# Summary"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("_session_id"));
    }

    #[tokio::test]
    async fn empty_replacement_content_returns_error() {
        let tool = TranscriptReplaceMiddleTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "preserve_head": 3,
                "preserve_tail": 6,
                "replacement_role": "system",
                "replacement_content": "",
                "_session_id": "s1"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("empty"));
    }

    #[tokio::test]
    async fn missing_preserve_head_returns_error() {
        let tool = TranscriptReplaceMiddleTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "preserve_tail": 6,
                "replacement_role": "system",
                "replacement_content": "# Summary",
                "_session_id": "s1"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("preserve_head"));
    }
}
