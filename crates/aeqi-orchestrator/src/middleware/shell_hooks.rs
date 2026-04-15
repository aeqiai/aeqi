//! Shell Hook Middleware — executes user-configurable shell commands at lifecycle points.
//!
//! Bridges AEQI's middleware system with external validation tools by running
//! shell commands at defined hook points. Hook definitions are loaded from agent
//! ideas tagged "hook" at construction time.
//!
//! Each hook idea's content is parsed as key-value pairs:
//! ```text
//! event: after_step
//! command: cargo test --workspace 2>&1 | tail -5
//! blocking: true
//! timeout: 30000
//! ```
//!
//! Supported events:
//! - `after_step` — runs after each agent step (when the model finishes with no tool calls).
//!   Blocking hooks that fail inject their output back into the conversation so the agent
//!   can react. Non-blocking hooks fire and forget.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tracing::{debug, info, warn};

use super::{Middleware, MiddlewareAction, ORDER_SHELL_HOOKS, WorkerContext};
use aeqi_core::traits::{IdeaQuery, IdeaStore};

/// A parsed shell hook definition.
#[derive(Debug, Clone)]
struct ShellHook {
    /// Lifecycle event: "after_step".
    event: String,
    /// Shell command to execute.
    command: String,
    /// If true, command output is fed back as an injection on failure.
    /// If false, the command is fire-and-forget.
    blocking: bool,
    /// Maximum execution time in milliseconds.
    timeout_ms: u64,
}

/// Result of executing a shell hook.
enum HookResult {
    /// Command succeeded (exit code 0).
    Ok,
    /// Command failed (blocking hook) — includes captured output.
    BlockingError(String),
    /// Command exceeded its timeout.
    Timeout,
}

/// Middleware that executes user-configurable shell commands at lifecycle points.
///
/// Hook definitions are loaded from agent ideas tagged "hook" once at construction.
/// Only the `after_step` event is currently implemented — it validates the agent's
/// work after each step and can inject failure output to force corrections.
pub struct ShellHookMiddleware {
    hooks: Vec<ShellHook>,
}

impl ShellHookMiddleware {
    /// Create a new ShellHookMiddleware by loading hook ideas from the store.
    ///
    /// Searches for ideas tagged "hook" and parses each one's content as a
    /// hook definition. Invalid definitions are logged and skipped.
    pub async fn from_idea_store(store: &Arc<dyn IdeaStore>, agent_id: Option<&str>) -> Self {
        let mut query = IdeaQuery::new("hook", 50);
        query.tags = vec!["hook".to_string()];
        if let Some(id) = agent_id {
            query.agent_id = Some(id.to_string());
        }

        let hooks = match store.search(&query).await {
            Ok(ideas) => {
                let mut parsed = Vec::new();
                for idea in &ideas {
                    match Self::parse_hook(&idea.content) {
                        Some(hook) => {
                            info!(
                                event = %hook.event,
                                command = %hook.command,
                                blocking = hook.blocking,
                                timeout_ms = hook.timeout_ms,
                                "loaded shell hook from idea '{}'",
                                idea.name
                            );
                            parsed.push(hook);
                        }
                        None => {
                            warn!(
                                name = %idea.name,
                                "failed to parse shell hook idea — missing 'event' or 'command' field"
                            );
                        }
                    }
                }
                parsed
            }
            Err(e) => {
                warn!(error = %e, "failed to search for hook ideas");
                Vec::new()
            }
        };

        Self { hooks }
    }

    /// Create with pre-built hooks (for testing).
    #[cfg(test)]
    fn with_hooks(hooks: Vec<ShellHook>) -> Self {
        Self { hooks }
    }

    /// Parse a hook definition from idea content.
    ///
    /// Expected format (key-value, one per line):
    /// ```text
    /// event: after_step
    /// command: cargo test --workspace 2>&1 | tail -5
    /// blocking: true
    /// timeout: 30000
    /// ```
    fn parse_hook(content: &str) -> Option<ShellHook> {
        let mut event = None;
        let mut command = None;
        let mut blocking = true;
        let mut timeout_ms = 30_000u64;

        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim().to_lowercase();
                let value = value.trim();
                match key.as_str() {
                    "event" => event = Some(value.to_string()),
                    "command" => command = Some(value.to_string()),
                    "blocking" => blocking = value.eq_ignore_ascii_case("true"),
                    "timeout" => {
                        if let Ok(ms) = value.parse::<u64>() {
                            timeout_ms = ms;
                        }
                    }
                    _ => {}
                }
            }
        }

        Some(ShellHook {
            event: event?,
            command: command?,
            blocking,
            timeout_ms,
        })
    }

    /// Whether any hooks are configured.
    pub fn has_hooks(&self) -> bool {
        !self.hooks.is_empty()
    }

    /// Execute hooks for a given event, returning injections for blocking failures.
    async fn run_hooks_for_event(&self, event: &str) -> Vec<String> {
        let matching: Vec<&ShellHook> = self.hooks.iter().filter(|h| h.event == event).collect();

        if matching.is_empty() {
            return Vec::new();
        }

        let mut injections = Vec::new();

        for hook in matching {
            if hook.blocking {
                match execute_hook(hook).await {
                    HookResult::Ok => {
                        debug!(command = %hook.command, "shell hook passed");
                    }
                    HookResult::BlockingError(output) => {
                        info!(command = %hook.command, "shell hook failed — injecting output");
                        injections.push(format!(
                            "[Shell Hook] Command failed: `{}`\nOutput:\n{}",
                            hook.command, output
                        ));
                    }
                    HookResult::Timeout => {
                        warn!(
                            command = %hook.command,
                            timeout_ms = hook.timeout_ms,
                            "shell hook timed out"
                        );
                        injections.push(format!(
                            "[Shell Hook] Command timed out after {}ms: `{}`",
                            hook.timeout_ms, hook.command
                        ));
                    }
                }
            } else {
                // Fire-and-forget: spawn and don't wait.
                let cmd = hook.command.clone();
                let timeout = hook.timeout_ms;
                tokio::spawn(async move {
                    let fire_hook = ShellHook {
                        event: String::new(),
                        command: cmd.clone(),
                        blocking: false,
                        timeout_ms: timeout,
                    };
                    match execute_hook(&fire_hook).await {
                        HookResult::Ok => {
                            debug!(command = %cmd, "fire-and-forget shell hook completed");
                        }
                        HookResult::BlockingError(output) => {
                            warn!(
                                command = %cmd,
                                output = %output,
                                "fire-and-forget shell hook failed"
                            );
                        }
                        HookResult::Timeout => {
                            warn!(command = %cmd, "fire-and-forget shell hook timed out");
                        }
                    }
                });
            }
        }

        injections
    }
}

/// Execute a single shell hook command with timeout.
async fn execute_hook(hook: &ShellHook) -> HookResult {
    let timeout = Duration::from_millis(hook.timeout_ms);

    let result = tokio::time::timeout(timeout, async {
        tokio::process::Command::new("sh")
            .arg("-c")
            .arg(&hook.command)
            .output()
            .await
    })
    .await;

    match result {
        Ok(Ok(output)) => {
            if output.status.success() {
                HookResult::Ok
            } else {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined = if stderr.is_empty() {
                    stdout.to_string()
                } else if stdout.is_empty() {
                    stderr.to_string()
                } else {
                    format!("{stdout}\n{stderr}")
                };
                // Truncate to avoid injecting enormous output.
                let truncated = if combined.len() > 4096 {
                    format!("{}...(truncated)", &combined[..4096])
                } else {
                    combined
                };
                HookResult::BlockingError(truncated)
            }
        }
        Ok(Err(e)) => HookResult::BlockingError(format!("Failed to execute command: {e}")),
        Err(_) => HookResult::Timeout,
    }
}

#[async_trait]
impl Middleware for ShellHookMiddleware {
    fn name(&self) -> &str {
        "shell_hooks"
    }

    fn order(&self) -> u32 {
        ORDER_SHELL_HOOKS
    }

    async fn after_step(
        &self,
        _ctx: &mut WorkerContext,
        _response_text: &str,
        _stop_reason: &str,
    ) -> MiddlewareAction {
        let injections = self.run_hooks_for_event("after_step").await;
        if injections.is_empty() {
            MiddlewareAction::Continue
        } else {
            MiddlewareAction::Inject(injections)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::middleware::test_helpers::test_ctx;

    #[test]
    fn parse_hook_full() {
        let content = "\
event: after_step
command: cargo test --workspace 2>&1 | tail -5
blocking: true
timeout: 30000";
        let hook = ShellHookMiddleware::parse_hook(content).unwrap();
        assert_eq!(hook.event, "after_step");
        assert_eq!(hook.command, "cargo test --workspace 2>&1 | tail -5");
        assert!(hook.blocking);
        assert_eq!(hook.timeout_ms, 30000);
    }

    #[test]
    fn parse_hook_defaults() {
        let content = "\
event: after_step
command: echo hello";
        let hook = ShellHookMiddleware::parse_hook(content).unwrap();
        assert_eq!(hook.event, "after_step");
        assert_eq!(hook.command, "echo hello");
        assert!(hook.blocking); // default
        assert_eq!(hook.timeout_ms, 30000); // default
    }

    #[test]
    fn parse_hook_non_blocking() {
        let content = "\
event: after_step
command: notify-send 'done'
blocking: false
timeout: 5000";
        let hook = ShellHookMiddleware::parse_hook(content).unwrap();
        assert!(!hook.blocking);
        assert_eq!(hook.timeout_ms, 5000);
    }

    #[test]
    fn parse_hook_missing_event() {
        let content = "command: echo hello";
        assert!(ShellHookMiddleware::parse_hook(content).is_none());
    }

    #[test]
    fn parse_hook_missing_command() {
        let content = "event: after_step";
        assert!(ShellHookMiddleware::parse_hook(content).is_none());
    }

    #[test]
    fn parse_hook_empty_content() {
        assert!(ShellHookMiddleware::parse_hook("").is_none());
    }

    #[test]
    fn parse_hook_whitespace_tolerant() {
        let content = "\
  event:   after_step
  command:   echo hi
  blocking:   false  ";
        let hook = ShellHookMiddleware::parse_hook(content).unwrap();
        assert_eq!(hook.event, "after_step");
        assert_eq!(hook.command, "echo hi");
        assert!(!hook.blocking);
    }

    #[tokio::test]
    async fn hook_success_continues() {
        let mw = ShellHookMiddleware::with_hooks(vec![ShellHook {
            event: "after_step".into(),
            command: "true".into(), // always succeeds
            blocking: true,
            timeout_ms: 5000,
        }]);
        let mut ctx = test_ctx();
        let action = mw.after_step(&mut ctx, "done", "end_turn").await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    #[tokio::test]
    async fn hook_failure_injects() {
        let mw = ShellHookMiddleware::with_hooks(vec![ShellHook {
            event: "after_step".into(),
            command: "echo 'test failed'; exit 1".into(),
            blocking: true,
            timeout_ms: 5000,
        }]);
        let mut ctx = test_ctx();
        let action = mw.after_step(&mut ctx, "done", "end_turn").await;
        match action {
            MiddlewareAction::Inject(msgs) => {
                assert_eq!(msgs.len(), 1);
                assert!(msgs[0].contains("test failed"));
                assert!(msgs[0].contains("[Shell Hook]"));
            }
            other => panic!("expected Inject, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn hook_timeout_injects() {
        let mw = ShellHookMiddleware::with_hooks(vec![ShellHook {
            event: "after_step".into(),
            command: "sleep 60".into(),
            blocking: true,
            timeout_ms: 100, // 100ms timeout
        }]);
        let mut ctx = test_ctx();
        let action = mw.after_step(&mut ctx, "done", "end_turn").await;
        match action {
            MiddlewareAction::Inject(msgs) => {
                assert_eq!(msgs.len(), 1);
                assert!(msgs[0].contains("timed out"));
            }
            other => panic!("expected Inject for timeout, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn no_hooks_continues() {
        let mw = ShellHookMiddleware::with_hooks(vec![]);
        let mut ctx = test_ctx();
        let action = mw.after_step(&mut ctx, "done", "end_turn").await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    #[tokio::test]
    async fn wrong_event_ignored() {
        let mw = ShellHookMiddleware::with_hooks(vec![ShellHook {
            event: "before_tool".into(),
            command: "exit 1".into(),
            blocking: true,
            timeout_ms: 5000,
        }]);
        let mut ctx = test_ctx();
        // after_step should not trigger a "before_tool" hook.
        let action = mw.after_step(&mut ctx, "done", "end_turn").await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    #[tokio::test]
    async fn multiple_hooks_aggregate_failures() {
        let mw = ShellHookMiddleware::with_hooks(vec![
            ShellHook {
                event: "after_step".into(),
                command: "true".into(), // succeeds
                blocking: true,
                timeout_ms: 5000,
            },
            ShellHook {
                event: "after_step".into(),
                command: "echo 'lint fail'; exit 1".into(), // fails
                blocking: true,
                timeout_ms: 5000,
            },
            ShellHook {
                event: "after_step".into(),
                command: "echo 'test fail'; exit 2".into(), // fails
                blocking: true,
                timeout_ms: 5000,
            },
        ]);
        let mut ctx = test_ctx();
        let action = mw.after_step(&mut ctx, "done", "end_turn").await;
        match action {
            MiddlewareAction::Inject(msgs) => {
                assert_eq!(msgs.len(), 2, "expected 2 failures, got {}", msgs.len());
                assert!(msgs[0].contains("lint fail"));
                assert!(msgs[1].contains("test fail"));
            }
            other => panic!("expected Inject with 2 failures, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn has_hooks_reflects_state() {
        let empty = ShellHookMiddleware::with_hooks(vec![]);
        assert!(!empty.has_hooks());

        let with = ShellHookMiddleware::with_hooks(vec![ShellHook {
            event: "after_step".into(),
            command: "true".into(),
            blocking: true,
            timeout_ms: 5000,
        }]);
        assert!(with.has_hooks());
    }
}
