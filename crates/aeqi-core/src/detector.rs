//! PatternDetector trait — formal contract for middleware detectors.
//!
//! A detector inspects runtime context (tool calls, shell output, graph state)
//! and fires patterns when it sees something noteworthy. Detectors do not author
//! LLM-facing content — that is the event's job. The caller (Agent or
//! MiddlewareChain) iterates detectors, collects [`DetectedPattern`] values, and
//! invokes the pattern dispatcher for each one.

use async_trait::async_trait;

/// A record of a single tool invocation, sufficient for detection purposes.
#[derive(Debug, Clone)]
pub struct ToolCallRecord {
    /// Tool name (e.g. "Bash", "Edit").
    pub name: String,
    /// Serialized input parameters (JSON string).
    pub input: String,
}

/// Runtime context passed to each detector on every check.
///
/// Fields are the union of what the built-in detectors actually need.
/// YAGNI: no fields for future detectors — add them when a real detector
/// requires them.
pub struct DetectionContext<'a> {
    /// Session identifier — used when firing patterns via the dispatcher.
    pub session_id: &'a str,
    /// Agent identifier — used when firing patterns via the dispatcher.
    pub agent_id: &'a str,
    /// Project name — used by graph-aware detectors to locate graph data.
    pub project_name: &'a str,
    /// The most recently completed tool call, if detection is running in the
    /// "after tool" lifecycle slot. `None` in the "after step" slot.
    pub latest_tool_call: Option<&'a ToolCallRecord>,
    /// (T1.12b) The agent's most recent assistant message text, populated
    /// by the agent loop when running detectors in the "after step" slot
    /// (no tool calls). Used by the completion-guard detector to check for
    /// premature-completion phrases. `None` in the "after tool" slot.
    pub last_assistant_message: Option<&'a str>,
}

/// A pattern that a detector has decided should fire.
#[derive(Debug, Clone)]
pub struct DetectedPattern {
    /// Pattern key (e.g. `"loop:detected"`, `"shell:command_failed"`).
    pub pattern: String,
    /// Structured context from the detector, passed through to the event's
    /// tool_calls as substitution variables.
    pub args: serde_json::Value,
}

/// A detector inspects runtime context and fires patterns when it sees
/// something noteworthy.
///
/// Detectors do not author LLM-facing content — that is the event's job.
/// Returning an empty `Vec` means nothing was detected in this call.
#[async_trait]
pub trait PatternDetector: Send + Sync {
    /// Human-readable name for logging and diagnostics.
    fn name(&self) -> &'static str;

    /// Run detection against the provided context.
    ///
    /// Returns the patterns that fired, along with their payload args.
    /// An empty `Vec` means nothing was detected.
    async fn detect(&self, ctx: &DetectionContext<'_>) -> Vec<DetectedPattern>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AlwaysFiresDetector;

    #[async_trait]
    impl PatternDetector for AlwaysFiresDetector {
        fn name(&self) -> &'static str {
            "always_fires"
        }

        async fn detect(&self, _ctx: &DetectionContext<'_>) -> Vec<DetectedPattern> {
            vec![DetectedPattern {
                pattern: "test:pattern".to_string(),
                args: serde_json::json!({ "reason": "always fires" }),
            }]
        }
    }

    struct NeverFiresDetector;

    #[async_trait]
    impl PatternDetector for NeverFiresDetector {
        fn name(&self) -> &'static str {
            "never_fires"
        }

        async fn detect(&self, _ctx: &DetectionContext<'_>) -> Vec<DetectedPattern> {
            vec![]
        }
    }

    #[tokio::test]
    async fn always_fires_returns_pattern() {
        let d = AlwaysFiresDetector;
        let call = ToolCallRecord {
            name: "Bash".to_string(),
            input: r#"{"command":"ls"}"#.to_string(),
        };
        let ctx = DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "my-project",
            latest_tool_call: Some(&call),
            last_assistant_message: None,
        };
        let patterns = d.detect(&ctx).await;
        assert_eq!(patterns.len(), 1);
        assert_eq!(patterns[0].pattern, "test:pattern");
    }

    #[tokio::test]
    async fn never_fires_returns_empty() {
        let d = NeverFiresDetector;
        let ctx = DetectionContext {
            session_id: "s1",
            agent_id: "a1",
            project_name: "my-project",
            latest_tool_call: None,
            last_assistant_message: None,
        };
        let patterns = d.detect(&ctx).await;
        assert!(patterns.is_empty());
    }
}
