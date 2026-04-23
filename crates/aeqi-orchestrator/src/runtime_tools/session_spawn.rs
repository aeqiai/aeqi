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
///
/// Capability gate: the calling agent must have `can_self_delegate = true`
/// (set via the DB column). Agents without this capability receive a
/// `ToolResult::error` and the spawn is not performed.
pub struct SessionSpawnTool {
    spawn_fn: Option<SpawnFn>,
    /// Mirror of `Agent::can_self_delegate` for the agent that owns this
    /// tool registry. When `false`, all calls to `session.spawn` are rejected.
    can_self_delegate: bool,
}

impl SessionSpawnTool {
    /// Stub constructor — no spawn function wired. Calls return an error
    /// indicating the runtime has not been fully initialised.
    pub fn stub() -> Self {
        Self {
            spawn_fn: None,
            can_self_delegate: false,
        }
    }

    /// Fully wired constructor — spawn_fn will be called when the tool fires.
    /// `can_self_delegate` is sourced from the owning agent's DB record.
    pub fn new(spawn_fn: SpawnFn, can_self_delegate: bool) -> Self {
        Self {
            spawn_fn: Some(spawn_fn),
            can_self_delegate,
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
        // Capability gate: only agents with `can_self_delegate = true` may
        // spawn a child session of themselves.  Every `session.spawn` call is
        // implicitly a self-delegation — the spawned session runs under the
        // same agent. Agents that have not been granted this capability receive
        // a clean error rather than silently doing nothing.
        if !self.can_self_delegate {
            return Ok(ToolResult::error(
                "this agent is not authorized to spawn a child of itself \
                 (can_self_delegate = false); \
                 a transport-owning agent or an operator must enable this capability",
            ));
        }

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

    /// Helper: build a no-op spawn_fn that always returns the given string.
    fn ok_spawn_fn(output: &'static str) -> SpawnFn {
        Arc::new(move |_req: SpawnRequest| Box::pin(async move { Ok(output.to_string()) }))
    }

    // ── Existing behaviour ────────────────────────────────────────────────────

    #[tokio::test]
    async fn stub_returns_not_wired_error() {
        // Stub has can_self_delegate = false, so the capability gate fires first.
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
        // Gate fires before the "not wired" check — message contains either.
        assert!(
            result.output.contains("not authorized") || result.output.contains("not wired"),
            "unexpected error: {}",
            result.output
        );
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
        let tool = SessionSpawnTool::new(spawn_fn, true); // can_self_delegate = true
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
        let tool = SessionSpawnTool::new(spawn_fn, true); // can_self_delegate = true
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
        // Needs can_self_delegate = true so it passes the gate and reaches the
        // kind validation.
        let tool = SessionSpawnTool::new(ok_spawn_fn(""), true);
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
        let tool = SessionSpawnTool::new(ok_spawn_fn(""), true);
        let result = tool
            .execute(serde_json::json!({ "parent_session": "sess-abc" }))
            .await
            .unwrap();
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn missing_parent_session_returns_error() {
        let tool = SessionSpawnTool::new(ok_spawn_fn(""), true);
        let result = tool
            .execute(serde_json::json!({ "kind": "compactor" }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("parent_session"));
    }

    // ── Capability gate ───────────────────────────────────────────────────────

    /// An agent with `can_self_delegate = false` is blocked from session.spawn.
    #[tokio::test]
    async fn no_self_delegate_blocked() {
        let tool = SessionSpawnTool::new(ok_spawn_fn("should not reach"), false);
        let result = tool
            .execute(serde_json::json!({
                "kind": "compactor",
                "parent_session": "sess-xyz"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(
            result.output.contains("not authorized"),
            "expected capability error, got: {}",
            result.output
        );
    }

    /// An agent with `can_self_delegate = true` passes the gate.
    #[tokio::test]
    async fn self_delegate_allowed() {
        let tool = SessionSpawnTool::new(ok_spawn_fn("spawned"), true);
        let result = tool
            .execute(serde_json::json!({
                "kind": "compactor",
                "parent_session": "sess-xyz"
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "unexpected error: {}", result.output);
        assert!(result.output.contains("spawned"));
    }

    /// Stub (no spawn_fn) still surfaces the capability error first.
    #[tokio::test]
    async fn stub_blocked_by_capability_gate() {
        let tool = SessionSpawnTool::stub(); // can_self_delegate = false
        let result = tool
            .execute(serde_json::json!({
                "kind": "continuation",
                "parent_session": "sess-xyz"
            }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("not authorized"));
    }
}
