// design note: session.spawn breaks the SessionManager/ToolRegistry dependency
// cycle via a SpawnFn closure injected at registry-build time. The closure
// captures a Weak<SessionManager> + Arc<dyn Provider>; the tool calls it and
// returns the spawned session's output as a string.
//
// Two spawn kinds:
//   "compactor" → spawn_ephemeral_session (lightweight: no worktree/sandbox/
//                 event replay, single LLM call, returns response text)
//   "continuation" → spawn_session (full session with seed content as initial
//                    user message, auto-closes when done)

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;

/// Async spawn closure injected into `SessionSpawnTool` to break the
/// SessionManager ↔ ToolRegistry cycle.
pub type SpawnFn = Arc<
    dyn Fn(SpawnRequest) -> Pin<Box<dyn Future<Output = anyhow::Result<String>> + Send>>
        + Send
        + Sync,
>;

/// Arguments for a session spawn request.
#[derive(Debug, Clone)]
pub struct SpawnRequest {
    /// "compactor" (lightweight ephemeral) | "continuation" (full session).
    pub kind: String,
    /// Idea name to use as system instructions (loaded by the spawned session).
    pub instructions_idea: Option<String>,
    /// Seed content passed as the initial user message or system context.
    pub seed_content: Option<String>,
    /// Parent session ID for chaining / genealogy tracking.
    pub parent_session_id: String,
}

/// Spawns a new session (compactor or continuation).
///
/// Args: `{
///   "kind": "compactor" | "continuation",
///   "instructions_idea": Option<String>,   // idea name for system instructions
///   "seed_content": Option<String>,         // seed content for the session
///   "parent_session": String                // parent session ID
/// }`
///
/// `compactor` kind uses lightweight mode (no worktree, no sandbox, no event
/// replay). `continuation` kind spawns a full session with the seed content
/// as the initial context.
///
/// ACL: open — callable by LLM (for delegation) and events.
pub struct SessionSpawnTool {
    spawn_fn: Option<SpawnFn>,
}

impl SessionSpawnTool {
    /// Stub constructor — no spawn function wired. Calls return an error
    /// indicating the runtime has not been fully initialised.
    pub fn stub() -> Self {
        Self { spawn_fn: None }
    }

    /// Fully wired constructor — spawn_fn will be called when the tool fires.
    pub fn new(spawn_fn: SpawnFn) -> Self {
        Self {
            spawn_fn: Some(spawn_fn),
        }
    }
}

#[async_trait]
impl Tool for SessionSpawnTool {
    fn name(&self) -> &str {
        "session.spawn"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "session.spawn".into(),
            description: "Spawn a new session. 'compactor' kind uses lightweight mode \
                          (no worktree/sandbox). 'continuation' kind starts a full session."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "kind": {
                        "type": "string",
                        "enum": ["compactor", "continuation"],
                        "description": "Session kind to spawn."
                    },
                    "instructions_idea": {
                        "type": "string",
                        "description": "Name of the idea to use as system instructions."
                    },
                    "seed_content": {
                        "type": "string",
                        "description": "Seed content injected at session start."
                    },
                    "parent_session": {
                        "type": "string",
                        "description": "Parent session ID for chaining."
                    }
                },
                "required": ["kind", "parent_session"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let kind = match args.get("kind").and_then(|v| v.as_str()) {
            Some("compactor") | Some("continuation") => args["kind"].as_str().unwrap().to_string(),
            Some(k) => {
                return Ok(ToolResult::error(format!(
                    "session.spawn: invalid kind '{k}', must be compactor or continuation"
                )));
            }
            None => {
                return Ok(ToolResult::error(
                    "session.spawn: missing required field 'kind'",
                ));
            }
        };

        let parent_session_id = match args.get("parent_session").and_then(|v| v.as_str()) {
            Some(p) if !p.is_empty() => p.to_string(),
            _ => {
                return Ok(ToolResult::error(
                    "session.spawn: missing or empty 'parent_session'",
                ));
            }
        };

        let instructions_idea = args
            .get("instructions_idea")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let seed_content = args
            .get("seed_content")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let Some(ref spawn_fn) = self.spawn_fn else {
            return Ok(ToolResult::error(
                "session.spawn: not wired — SessionManager not yet configured \
                 (call build_runtime_registry with a spawn_fn to enable session spawning)",
            ));
        };

        let req = SpawnRequest {
            kind,
            instructions_idea,
            seed_content,
            parent_session_id,
        };

        match spawn_fn(req).await {
            Ok(output) => {
                // Expose structured data so downstream tool_calls in the same
                // event firing can chain via e.g. `{tool_calls.0.data.summary}`.
                let data = serde_json::json!({
                    "summary": output,
                });
                Ok(ToolResult::success(output).with_data(data))
            }
            Err(e) => Ok(ToolResult::error(format!("session.spawn failed: {e}"))),
        }
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false // session spawning is a side-effecting operation
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stub_returns_not_wired_error() {
        let tool = SessionSpawnTool::stub();
        let result = tool
            .execute(serde_json::json!({
                "kind": "compactor",
                "parent_session": "sess-abc",
                "instructions_idea": "session:compactor-instructions"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("not wired"));
    }

    #[tokio::test]
    async fn wired_compactor_spawn_calls_spawn_fn() {
        let called = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let called_clone = called.clone();
        let spawn_fn: SpawnFn = Arc::new(move |req: SpawnRequest| {
            let called = called_clone.clone();
            Box::pin(async move {
                called.store(true, std::sync::atomic::Ordering::SeqCst);
                assert_eq!(req.kind, "compactor");
                assert_eq!(req.parent_session_id, "sess-abc");
                assert_eq!(
                    req.instructions_idea.as_deref(),
                    Some("session:compactor-instructions")
                );
                Ok("compacted output".to_string())
            })
        });
        let tool = SessionSpawnTool::new(spawn_fn);
        let result = tool
            .execute(serde_json::json!({
                "kind": "compactor",
                "parent_session": "sess-abc",
                "instructions_idea": "session:compactor-instructions"
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "unexpected error: {}", result.output);
        assert!(result.output.contains("compacted output"));
        assert!(called.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[tokio::test]
    async fn wired_continuation_spawn_calls_spawn_fn() {
        let spawn_fn: SpawnFn = Arc::new(|req: SpawnRequest| {
            Box::pin(async move {
                assert_eq!(req.kind, "continuation");
                Ok(format!("continuation started, seed={:?}", req.seed_content))
            })
        });
        let tool = SessionSpawnTool::new(spawn_fn);
        let result = tool
            .execute(serde_json::json!({
                "kind": "continuation",
                "parent_session": "sess-abc",
                "seed_content": "Prior context here."
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("continuation started"));
    }

    #[tokio::test]
    async fn invalid_kind_returns_error() {
        let tool = SessionSpawnTool::stub();
        let result = tool
            .execute(serde_json::json!({
                "kind": "unknown",
                "parent_session": "sess-abc"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("invalid kind"));
    }

    #[tokio::test]
    async fn missing_kind_returns_error() {
        let tool = SessionSpawnTool::stub();
        let result = tool
            .execute(serde_json::json!({ "parent_session": "sess-abc" }))
            .await
            .unwrap();
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn missing_parent_session_returns_error() {
        let tool = SessionSpawnTool::stub();
        let result = tool
            .execute(serde_json::json!({ "kind": "compactor" }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("parent_session"));
    }
}
