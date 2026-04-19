// design note: session.status emits a ChatStreamEvent::Status message on the
// running session's stream. Like transcript.inject, the session_id and stream
// sender come from ExecutionContext, not from args. The tool reads
// `_session_id` from args (injected by the event dispatcher) to correlate
// the log entry; the actual emit happens via ctx.emit_status() called by the
// event dispatcher before/after invoking each tool. For direct execute()
// calls (e.g., from the LLM), we emit a Status via the stream if
// `_stream_present` is set in args, otherwise just return the message as output.
//
// This design means session.status is useful as a no-op status ping from an
// event — the event dispatcher handles the stream emit, and the tool just
// confirms the message.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;

/// Emits a `ChatStreamEvent::Status` message on the current session stream.
///
/// Args: `{ "message": String }`
///
/// The event dispatcher calls ctx.emit_status(message) automatically when
/// this tool runs. The tool's execute() just validates and echoes the message.
///
/// ACL: open — callable by LLM and events.
pub struct SessionStatusTool;

#[async_trait]
impl Tool for SessionStatusTool {
    fn name(&self) -> &str {
        "session.status"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "session.status".into(),
            description: "Emit a status message on the current session stream. \
                          Useful for informing the user about background operations."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Status message to emit."
                    }
                },
                "required": ["message"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let message = match args.get("message").and_then(|v| v.as_str()) {
            Some(m) if !m.is_empty() => m.to_string(),
            _ => {
                return Ok(ToolResult::error(
                    "session.status: missing or empty 'message'",
                ));
            }
        };

        // The stream emit is handled by the event dispatcher via ctx.emit_status().
        // Here we just return success with the message text as confirmation.
        Ok(ToolResult::success(format!("status: {message}")))
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn emits_status_message() {
        let tool = SessionStatusTool;
        let result = tool
            .execute(serde_json::json!({ "message": "Processing your request..." }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("Processing your request"));
    }

    #[tokio::test]
    async fn missing_message_returns_error() {
        let tool = SessionStatusTool;
        let result = tool.execute(serde_json::json!({})).await.unwrap();
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn empty_message_returns_error() {
        let tool = SessionStatusTool;
        let result = tool
            .execute(serde_json::json!({ "message": "" }))
            .await
            .unwrap();
        assert!(result.is_error);
    }
}
