// design note: session.spawn is a stub in Phase 2. Full implementation (calling
// SessionManager::spawn_session or the new spawn_ephemeral_session) requires
// Arc<SessionManager> + Arc<dyn Provider> to be passed in, which creates a
// dependency cycle between the tool and the session manager that owns the
// tool registry.
//
// Phase 3 will resolve this via one of:
//   a) Passing a SpawnFn closure (Box<dyn Fn(..) -> BoxFuture<...>>) at
//      construction time, breaking the cycle.
//   b) An async channel where the tool posts a spawn request and the session
//      manager processes it outside the tool's scope.
//
// For now, execute() validates args and returns Ok with a
// "spawn not yet wired" status so callers can see the tool is present and
// parseable. The 'kind' field drives the lightweight vs. full spawn path.
//
// The 'compactor' kind must use lightweight mode: skip worktree, skip sandbox,
// skip event replay, just provider + idea-as-system-context + call. This is
// documented here so Phase 3's implementer knows the requirement.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use tracing::warn;

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
pub struct SessionSpawnTool;

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

        let parent_session = match args.get("parent_session").and_then(|v| v.as_str()) {
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

        // Phase 2 stub: args are validated but the actual spawn is not yet wired.
        // Phase 3 will inject a SpawnFn closure and call it here.
        warn!(
            kind = %kind,
            parent_session = %parent_session,
            instructions_idea = ?instructions_idea,
            "session.spawn: Phase 2 stub — spawn not yet wired (Phase 3 will implement)"
        );

        Ok(ToolResult::success(format!(
            "session.spawn: validated (kind={kind}, parent={parent_session}) — \
             spawn wiring deferred to Phase 3"
        )))
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false // session spawning is a side-effecting operation
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn valid_compactor_spawn_returns_stub_ok() {
        let tool = SessionSpawnTool;
        let result = tool
            .execute(serde_json::json!({
                "kind": "compactor",
                "parent_session": "sess-abc",
                "instructions_idea": "session:compactor-instructions"
            }))
            .await
            .unwrap();
        // Phase 2 stub: succeeds with a notice that wiring is deferred.
        assert!(!result.is_error);
        assert!(result.output.contains("Phase 3"));
    }

    #[tokio::test]
    async fn valid_continuation_spawn_returns_stub_ok() {
        let tool = SessionSpawnTool;
        let result = tool
            .execute(serde_json::json!({
                "kind": "continuation",
                "parent_session": "sess-abc",
                "seed_content": "Prior context here."
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
    }

    #[tokio::test]
    async fn invalid_kind_returns_error() {
        let tool = SessionSpawnTool;
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
        let tool = SessionSpawnTool;
        let result = tool
            .execute(serde_json::json!({ "parent_session": "sess-abc" }))
            .await
            .unwrap();
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn missing_parent_session_returns_error() {
        let tool = SessionSpawnTool;
        let result = tool
            .execute(serde_json::json!({ "kind": "compactor" }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("parent_session"));
    }
}
