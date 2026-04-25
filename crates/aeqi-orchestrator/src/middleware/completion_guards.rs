//! Completion-guard middleware — fires `agent:premature_completion` when an
//! agent ends a turn with no tool calls but its last message contains
//! "I'm done"-shaped phrases.
//!
//! This is the substrate-fit version of hermes's `ensure_no_empty_msg`
//! middleware (catches "premature victory" failures where the agent declares
//! a task complete without ever producing the artifact).
//!
//! Detection happens in the **after-step** lifecycle slot — by construction
//! that slot only fires when the model finished without any tool calls, so
//! the "no tool calls" half of the predicate is implicit. We just need to
//! scan the assistant's last message for completion-shaped phrases.
//!
//! Content authoring (the LLM-facing nudge) is owned by an event configured
//! for the `agent:premature_completion` pattern. The default seed in
//! `event_handler::seed_lifecycle_events` injects a confirmation-request
//! `transcript.inject` so an operator who does nothing still gets the
//! safety-net behaviour. Operators override by creating their own event for
//! the same pattern (e.g. firing `ideas.store_many` against a reflector
//! persona instead of nudging in-place).

use aeqi_core::detector::{DetectedPattern, DetectionContext, PatternDetector};
use async_trait::async_trait;
use tracing::warn;

use super::{Middleware, MiddlewareAction, ORDER_COMPLETION_GUARDS, WorkerContext};

/// Locked phrase set for premature-completion detection.
///
/// Per T1.12b spec, this set is **not** user-extensible in this PR. Future
/// work: surface as a tag-policy field so operators can tune the trigger
/// per-agent. The phrases are matched as case-insensitive substrings so
/// punctuation and surrounding text don't break detection.
const COMPLETION_PHRASES: &[&str] = &[
    "i've finished",
    "i'm done",
    "all set",
    "task complete",
    "that should do it",
];

/// Returns `true` when `text` contains any of [`COMPLETION_PHRASES`]
/// (case-insensitive substring match).
fn contains_completion_phrase(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }
    let lower = text.to_lowercase();
    COMPLETION_PHRASES.iter().any(|p| lower.contains(p))
}

/// Completion-guard middleware. See module docs.
#[derive(Default)]
pub struct CompletionGuardMiddleware;

impl CompletionGuardMiddleware {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl Middleware for CompletionGuardMiddleware {
    fn name(&self) -> &str {
        "completion_guards"
    }

    fn order(&self) -> u32 {
        ORDER_COMPLETION_GUARDS
    }

    async fn after_step(
        &self,
        ctx: &mut WorkerContext,
        response_text: &str,
        _stop_reason: &str,
    ) -> MiddlewareAction {
        // The after-step hook is called by the agent loop only when the
        // model finishes with no tool calls (see `agent/mod.rs`). The
        // "ended with no tool calls" half of the predicate is therefore
        // implicit — we only need to check for completion phrases.
        if !contains_completion_phrase(response_text) {
            return MiddlewareAction::Continue;
        }

        if let Some(ref registry) = ctx.registry {
            let ectx = ctx.as_execution_context();
            let preview: String = response_text.chars().take(160).collect();
            let trigger_args = serde_json::json!({
                "agent_id": ctx.agent_name,
                "session_id": ctx.session_id,
                "message_preview": preview,
            });
            let reg = registry.clone();
            tokio::spawn(async move {
                if let Err(e) = reg
                    .invoke_pattern("agent:premature_completion", &ectx, &trigger_args)
                    .await
                {
                    warn!(error = %e, "completion_guards: invoke_pattern failed");
                }
            });
        } else {
            warn!(
                agent = %ctx.agent_name,
                "agent:premature_completion (no registry — pattern logged only): \
                 turn ended with no tool calls and a completion-shaped phrase",
            );
        }

        MiddlewareAction::Continue
    }
}

// ---------------------------------------------------------------------------
// PatternDetector impl
// ---------------------------------------------------------------------------

#[async_trait]
impl PatternDetector for CompletionGuardMiddleware {
    fn name(&self) -> &'static str {
        "completion_guards"
    }

    /// Detect premature-completion phrases at the end-of-step slot.
    ///
    /// Fires `agent:premature_completion` when:
    ///  - `latest_tool_call` is `None` (we are in the after-step slot, i.e.
    ///    the turn ended with no tool calls), AND
    ///  - `last_assistant_message` contains a completion-shaped phrase from
    ///    [`COMPLETION_PHRASES`] (case-insensitive substring match).
    ///
    /// Returns nothing in the after-tool slot or when the message is empty
    /// or carries no completion phrase. Tool-using turns therefore cannot
    /// false-positive.
    async fn detect(&self, ctx: &DetectionContext<'_>) -> Vec<DetectedPattern> {
        if ctx.latest_tool_call.is_some() {
            // After-tool slot: by definition the turn used a tool call, so
            // the premature-completion predicate cannot fire.
            return vec![];
        }
        let Some(text) = ctx.last_assistant_message else {
            return vec![];
        };
        if !contains_completion_phrase(text) {
            return vec![];
        }
        let preview: String = text.chars().take(160).collect();
        vec![DetectedPattern {
            pattern: "agent:premature_completion".to_string(),
            args: serde_json::json!({
                "agent_id": ctx.agent_id,
                "session_id": ctx.session_id,
                "message_preview": preview,
            }),
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::middleware::test_helpers::test_ctx;

    #[test]
    fn phrase_match_case_insensitive() {
        assert!(contains_completion_phrase("I've finished the refactor."));
        assert!(contains_completion_phrase("ok, I'M DONE!"));
        assert!(contains_completion_phrase("All set — ship it."));
        assert!(contains_completion_phrase("Task complete."));
        assert!(contains_completion_phrase("That should do it for now."));
    }

    #[test]
    fn phrase_match_negatives() {
        assert!(!contains_completion_phrase(""));
        assert!(!contains_completion_phrase("Working on it..."));
        assert!(!contains_completion_phrase(
            "I'll keep going until the tests pass."
        ));
    }

    /// Test 5: Turn ends with no tool calls + last assistant message contains
    /// "i've finished" → detector fires `agent:premature_completion`.
    #[tokio::test]
    async fn t1_12b_detector_fires_on_completion_phrase_at_step_end() {
        let d = CompletionGuardMiddleware::new();
        let ctx = DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "test",
            latest_tool_call: None,
            last_assistant_message: Some("Great — I've finished the task."),
        };
        let patterns = d.detect(&ctx).await;
        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].pattern, "agent:premature_completion");
        assert_eq!(patterns[0].args["agent_id"], "a1");
        assert_eq!(patterns[0].args["session_id"], "s1");
        assert!(
            patterns[0].args["message_preview"]
                .as_str()
                .unwrap()
                .contains("finished")
        );
    }

    /// Test 6: Turn ends WITH a tool call present → detector does NOT fire
    /// the premature-completion pattern. (This guards against false
    /// positives during tool-using turns.)
    #[tokio::test]
    async fn t1_12b_detector_does_not_fire_when_tool_call_is_present() {
        let d = CompletionGuardMiddleware::new();
        let record = aeqi_core::detector::ToolCallRecord {
            name: "Bash".to_string(),
            input: r#"{"command":"ls"}"#.to_string(),
        };
        let ctx = DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "test",
            latest_tool_call: Some(&record),
            last_assistant_message: Some("I've finished now."),
        };
        let patterns = d.detect(&ctx).await;
        assert!(
            patterns.is_empty(),
            "tool-using turn must not false-positive premature_completion"
        );
    }

    #[tokio::test]
    async fn t1_12b_detector_no_message_returns_empty() {
        let d = CompletionGuardMiddleware::new();
        let ctx = DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "test",
            latest_tool_call: None,
            last_assistant_message: None,
        };
        assert!(d.detect(&ctx).await.is_empty());
    }

    #[tokio::test]
    async fn t1_12b_detector_message_without_phrase_returns_empty() {
        let d = CompletionGuardMiddleware::new();
        let ctx = DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "test",
            latest_tool_call: None,
            last_assistant_message: Some("Working on it; will finish in a moment."),
        };
        assert!(d.detect(&ctx).await.is_empty());
    }

    /// Middleware path: response_text carries a completion phrase → after_step
    /// returns Continue (the pattern is fired via spawn; the hook itself
    /// never short-circuits).
    #[tokio::test]
    async fn t1_12b_middleware_after_step_fires_pattern_and_continues() {
        let mw = CompletionGuardMiddleware::new();
        let mut ctx = test_ctx();
        let action = mw
            .after_step(&mut ctx, "I've finished the implementation.", "EndTurn")
            .await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }

    /// Middleware path: response_text carries no completion phrase → no-op
    /// Continue.
    #[tokio::test]
    async fn t1_12b_middleware_after_step_no_phrase_continues() {
        let mw = CompletionGuardMiddleware::new();
        let mut ctx = test_ctx();
        let action = mw
            .after_step(&mut ctx, "Still working on it.", "EndTurn")
            .await;
        assert!(matches!(action, MiddlewareAction::Continue));
    }
}
