// design note: transcript.inject is event_only because allowing the LLM to
// directly inject transcript messages would be a self-injection attack surface
// — the LLM could manufacture history it never actually produced. Events are
// operator-configured and thus trusted to add messages.
//
// The session_id comes from ExecutionContext, not from args, to prevent event
// args from forging a target session. The tool_registry's invoke() passes ctx
// but the Tool::execute() signature only receives args. We bridge this by
// building a light wrapper tool in the event dispatch path that closes over
// the session_id. For now, transcript.inject reads the session_id from
// args["_session_id"] if present (set by the event dispatcher from ctx), and
// falls back to returning an error if it's absent. This is documented as
// temporary pending a richer Tool::execute_with_ctx() signature in Phase 3.

use std::sync::Arc;

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use tracing::info;

use crate::session_store::SessionStore;

/// Adds a message to the current session's transcript.
///
/// Args: `{ "role": "system"|"user"|"assistant", "content": String,
///           "_session_id": String (injected by event dispatcher from ctx) }`
///
/// The `_session_id` field is populated by the event dispatcher from
/// `ExecutionContext::session_id` before calling execute(). It is prefixed
/// with `_` to signal it is runtime-injected, not operator-provided.
///
/// ACL: event_only (set in build_runtime_registry).
pub struct TranscriptInjectTool {
    session_store: Option<Arc<SessionStore>>,
}

impl TranscriptInjectTool {
    pub fn new(session_store: Option<Arc<SessionStore>>) -> Self {
        Self { session_store }
    }
}

#[async_trait]
impl Tool for TranscriptInjectTool {
    fn name(&self) -> &str {
        "transcript.inject"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "transcript.inject".into(),
            description: "Add a message to the current session's transcript. \
                          Only callable by events. The runtime injects _session_id \
                          from the execution context."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "enum": ["system", "user", "assistant"],
                        "description": "Role of the injected message."
                    },
                    "content": {
                        "type": "string",
                        "description": "Content of the injected message."
                    },
                    "_session_id": {
                        "type": "string",
                        "description": "Runtime-injected session ID (set by event dispatcher)."
                    }
                },
                "required": ["role", "content"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        // Validate args first so field errors surface even without a store.
        let role = match args.get("role").and_then(|v| v.as_str()) {
            Some(r) if ["system", "user", "assistant"].contains(&r) => r.to_string(),
            Some(r) => {
                return Ok(ToolResult::error(format!(
                    "transcript.inject: invalid role '{r}', must be system/user/assistant"
                )));
            }
            None => {
                return Ok(ToolResult::error(
                    "transcript.inject: missing required field 'role'",
                ));
            }
        };

        let content = match args.get("content").and_then(|v| v.as_str()) {
            Some(c) if !c.is_empty() => c.to_string(),
            _ => {
                return Ok(ToolResult::error(
                    "transcript.inject: missing or empty 'content'",
                ));
            }
        };

        let session_id = match args.get("_session_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                return Ok(ToolResult::error(
                    "transcript.inject: missing '_session_id' (must be injected by event dispatcher)",
                ));
            }
        };

        let store = match self.session_store.as_ref() {
            Some(s) => s,
            None => {
                return Ok(ToolResult::error(
                    "transcript.inject: no session store configured",
                ));
            }
        };

        let preview: String = content.chars().take(80).collect();
        let ellipsis = if content.len() > 80 { "…" } else { "" };
        info!(
            session = %session_id,
            role = %role,
            preview = %format!("{preview}{ellipsis}"),
            "transcript.inject: injecting message"
        );

        match store
            .record_by_session(&session_id, &role, &content, Some("event"))
            .await
        {
            Ok(_) => Ok(ToolResult::success(format!(
                "injected: {role}: {preview}{ellipsis}"
            ))),
            Err(e) => Ok(ToolResult::error(format!(
                "transcript.inject: failed to record message: {e}"
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
        let tool = TranscriptInjectTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "role": "user",
                "content": "hello",
                "_session_id": "s1"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("no session store"));
    }

    #[tokio::test]
    async fn invalid_role_returns_error() {
        let tool = TranscriptInjectTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "role": "god",
                "content": "smite",
                "_session_id": "s1"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("invalid role"));
    }

    #[tokio::test]
    async fn missing_session_id_returns_error() {
        let tool = TranscriptInjectTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "role": "user",
                "content": "hello"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("_session_id"));
    }

    #[tokio::test]
    async fn empty_content_returns_error() {
        let tool = TranscriptInjectTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "role": "user",
                "content": "",
                "_session_id": "s1"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("empty"));
    }
}
