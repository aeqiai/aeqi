// `message_to` — universal outbound-message agent tool.
//
// Any LLM-spawned agent can target a session, idea, agent, or user through
// this single verb. The closure pattern mirrors `question.ask`: the calling
// agent's identity and the session store are captured at registry-build time
// so the LLM cannot influence routing via args.
//
// ACL: LLM-only (same reasoning as `question.ask` — events should not be
// able to manufacture agent-attributed outbound messages).
//
// target.kind | behaviour
// ------------|------------------------------------------------------------
// "session"   | append directly to the named session.
// "idea"      | lazy-create the idea's session (same as IPC wave-1).
// "agent"     | find-or-create a 1:1 agent↔agent DM session; append.
// "user"      | find-or-create a 1:1 agent↔user DM session; append.
// "position"  | deferred to Wave-3b (position primitive scope).

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;

/// Result returned by a successful `MessageToFn` call.
#[derive(Debug, Clone)]
pub struct MessageToResult {
    /// The session the message was appended to (resolved or created).
    pub session_id: String,
    /// Row-id of the newly inserted message.
    pub message_id: i64,
}

/// Async closure injected at registry-build time, same pattern as `AskFn`.
/// Captures session_store + calling agent_id so the LLM cannot spoof them.
pub type MessageToFn = Arc<
    dyn Fn(
            MessageToRequest,
        ) -> Pin<Box<dyn Future<Output = anyhow::Result<MessageToResult>> + Send>>
        + Send
        + Sync,
>;

/// LLM-supplied arguments for a `message_to` call.
#[derive(Debug, Clone)]
pub struct MessageToRequest {
    pub target_kind: String,
    pub target_id: String,
    pub body: String,
    pub payload_kind: Option<String>,
}

const MAX_BODY_LEN: usize = 8192;

/// Send a message to a target — session, idea, agent, user, or position.
/// The universal outbound-communication verb for agents.
pub struct MessageToTool {
    message_to_fn: Option<MessageToFn>,
}

impl MessageToTool {
    /// Stub — no closure wired; all calls return an error.
    /// Used in stub registries (spec-only contexts).
    pub fn stub() -> Self {
        Self {
            message_to_fn: None,
        }
    }

    /// Fully wired constructor.
    pub fn new(message_to_fn: MessageToFn) -> Self {
        Self {
            message_to_fn: Some(message_to_fn),
        }
    }
}

#[async_trait]
impl Tool for MessageToTool {
    fn name(&self) -> &str {
        "message_to"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "message_to".into(),
            description: "Send a message to a target — a session, an idea (lazy-creates its \
                          session), an agent, a user, or a position. Use this for any \
                          communication with another participant in the company."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "target": {
                        "type": "object",
                        "description": "Who to send to.",
                        "properties": {
                            "kind": {
                                "type": "string",
                                "enum": ["session", "idea", "agent", "user", "position"],
                                "description": "Target type. 'position' is reserved for a future wave."
                            },
                            "id": {
                                "type": "string",
                                "description": "ID of the target."
                            }
                        },
                        "required": ["kind", "id"]
                    },
                    "body": {
                        "type": "string",
                        "description": "The message text (≤8192 chars)."
                    },
                    "payload_kind": {
                        "type": "string",
                        "enum": ["comment", "decision_request", "fyi", "question", "status_update"],
                        "description": "Optional structured-payload discriminator. Omit for plain messages."
                    }
                },
                "required": ["target", "body"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        // Parse target object.
        let target = match args.get("target") {
            Some(t) if t.is_object() => t,
            _ => {
                return Ok(ToolResult::error(
                    "message_to: missing or invalid 'target' object",
                ));
            }
        };
        let target_kind = match target.get("kind").and_then(|v| v.as_str()) {
            Some(k) if !k.trim().is_empty() => k.to_string(),
            _ => {
                return Ok(ToolResult::error("message_to: target.kind is required"));
            }
        };
        let target_id = match target.get("id").and_then(|v| v.as_str()) {
            Some(id) if !id.trim().is_empty() => id.to_string(),
            _ => {
                return Ok(ToolResult::error("message_to: target.id is required"));
            }
        };

        // "position" target is deferred.
        if target_kind == "position" {
            return Ok(ToolResult::error(
                "message_to: target.kind='position' is not yet implemented (Wave-3b)",
            ));
        }

        let body = match args.get("body").and_then(|v| v.as_str()) {
            Some(b) if !b.trim().is_empty() => b.to_string(),
            _ => {
                return Ok(ToolResult::error("message_to: missing or empty 'body'"));
            }
        };
        if body.chars().count() > MAX_BODY_LEN {
            return Ok(ToolResult::error(format!(
                "message_to: body exceeds {MAX_BODY_LEN} chars; trim it",
            )));
        }

        let payload_kind = args
            .get("payload_kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let Some(ref f) = self.message_to_fn else {
            return Ok(ToolResult::error(
                "message_to: not wired — SessionManager not yet configured",
            ));
        };

        let req = MessageToRequest {
            target_kind,
            target_id,
            body,
            payload_kind,
        };

        match f(req).await {
            Ok(res) => Ok(ToolResult::success(format!(
                "message sent; session_id={} message_id={}",
                res.session_id, res.message_id,
            ))),
            Err(e) => Ok(ToolResult::error(format!("message_to failed: {e}"))),
        }
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        // Writes to transcript + potentially creates sessions; serialize.
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_fn() -> (MessageToFn, Arc<std::sync::Mutex<Option<MessageToRequest>>>) {
        let captured: Arc<std::sync::Mutex<Option<MessageToRequest>>> =
            Arc::new(std::sync::Mutex::new(None));
        let captured_clone = captured.clone();
        let f: MessageToFn = Arc::new(move |req: MessageToRequest| {
            let captured = captured_clone.clone();
            Box::pin(async move {
                *captured.lock().unwrap() = Some(req);
                Ok(MessageToResult {
                    session_id: "sess-1".to_string(),
                    message_id: 42,
                })
            })
        });
        (f, captured)
    }

    #[tokio::test]
    async fn stub_returns_not_wired_error() {
        let tool = MessageToTool::stub();
        let result = tool
            .execute(serde_json::json!({
                "target": {"kind": "user", "id": "u1"},
                "body": "hello"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("not wired"), "{}", result.output);
    }

    #[tokio::test]
    async fn missing_target_returns_error() {
        let (f, _) = ok_fn();
        let tool = MessageToTool::new(f);
        let result = tool
            .execute(serde_json::json!({"body": "hi"}))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("target"), "{}", result.output);
    }

    #[tokio::test]
    async fn missing_body_returns_error() {
        let (f, _) = ok_fn();
        let tool = MessageToTool::new(f);
        let result = tool
            .execute(serde_json::json!({"target": {"kind": "user", "id": "u1"}}))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("body"), "{}", result.output);
    }

    #[tokio::test]
    async fn oversized_body_returns_error() {
        let (f, _) = ok_fn();
        let tool = MessageToTool::new(f);
        let huge = "x".repeat(MAX_BODY_LEN + 1);
        let result = tool
            .execute(serde_json::json!({
                "target": {"kind": "user", "id": "u1"},
                "body": huge
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("exceeds"), "{}", result.output);
    }

    #[tokio::test]
    async fn position_target_deferred_error() {
        let (f, _) = ok_fn();
        let tool = MessageToTool::new(f);
        let result = tool
            .execute(serde_json::json!({
                "target": {"kind": "position", "id": "pos-1"},
                "body": "hi"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(
            result.output.contains("not yet implemented"),
            "{}",
            result.output
        );
    }

    #[tokio::test]
    async fn wired_call_succeeds_and_returns_ids() {
        let (f, captured) = ok_fn();
        let tool = MessageToTool::new(f);
        let result = tool
            .execute(serde_json::json!({
                "target": {"kind": "user", "id": "user-abc"},
                "body": "decision needed",
                "payload_kind": "decision_request"
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "unexpected error: {}", result.output);
        assert!(result.output.contains("sess-1"));
        assert!(result.output.contains("42"));
        let req = captured.lock().unwrap().clone().expect("fn called");
        assert_eq!(req.target_kind, "user");
        assert_eq!(req.target_id, "user-abc");
        assert_eq!(req.body, "decision needed");
        assert_eq!(req.payload_kind.as_deref(), Some("decision_request"));
    }

    #[tokio::test]
    async fn wired_call_agent_target() {
        let (f, captured) = ok_fn();
        let tool = MessageToTool::new(f);
        let result = tool
            .execute(serde_json::json!({
                "target": {"kind": "agent", "id": "agent-xyz"},
                "body": "status update",
                "payload_kind": "status_update"
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "unexpected error: {}", result.output);
        let req = captured.lock().unwrap().clone().expect("fn called");
        assert_eq!(req.target_kind, "agent");
        assert_eq!(req.target_id, "agent-xyz");
    }
}
