use crate::runtime::{RuntimeOutcome, RuntimeOutcomeStatus};

/// Parsed outcome from a worker's result text.
#[derive(Debug, Clone)]
pub enum QuestOutcome {
    /// Task completed successfully.
    Done(String),
    /// Worker is blocked and needs input to continue.
    Blocked {
        /// The specific question or information needed.
        question: String,
        /// Full result text including work done so far.
        full_text: String,
    },
    /// Worker hit context exhaustion but made progress. Re-queue with checkpoint.
    Handoff {
        /// Summary of progress made and what remains.
        checkpoint: String,
    },
    /// Task failed due to a technical error.
    Failed(String),
}

impl QuestOutcome {
    /// Legacy compatibility parser while callers migrate to runtime-first outcomes.
    pub fn parse(result_text: &str) -> Self {
        let runtime = RuntimeOutcome::from_agent_response(result_text, Vec::new());
        Self::from_runtime_outcome(&runtime)
    }

    pub fn from_runtime_outcome(runtime: &RuntimeOutcome) -> Self {
        match runtime.status {
            RuntimeOutcomeStatus::Done => Self::Done(runtime.summary.clone()),
            RuntimeOutcomeStatus::Blocked => Self::Blocked {
                question: runtime
                    .reason
                    .clone()
                    .unwrap_or_else(|| runtime.summary.clone()),
                full_text: runtime.summary.clone(),
            },
            RuntimeOutcomeStatus::Handoff => Self::Handoff {
                checkpoint: runtime.summary.clone(),
            },
            RuntimeOutcomeStatus::Failed => Self::Failed(
                runtime
                    .reason
                    .clone()
                    .unwrap_or_else(|| runtime.summary.clone()),
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_done_output() {
        let outcome = QuestOutcome::parse("I fixed the bug and committed to feat/fix-pms.");
        assert!(matches!(outcome, QuestOutcome::Done(_)));
    }

    #[test]
    fn parses_blocked_output() {
        let text = "BLOCKED:\nShould the new endpoint require auth?\n\nI implemented the handler.";
        let outcome = QuestOutcome::parse(text);
        match outcome {
            QuestOutcome::Blocked { question, .. } => {
                assert_eq!(question, "Should the new endpoint require auth?");
            }
            _ => panic!("expected blocked"),
        }
    }

    #[test]
    fn parses_failed_output() {
        let outcome =
            QuestOutcome::parse("FAILED:\ncargo build returned 3 errors in pms/src/main.rs");
        assert!(matches!(outcome, QuestOutcome::Failed(_)));
    }

    #[test]
    fn empty_output_is_failure() {
        let outcome = QuestOutcome::parse("");
        assert!(matches!(outcome, QuestOutcome::Failed(_)));

        let outcome = QuestOutcome::parse("   \n  \n  ");
        assert!(matches!(outcome, QuestOutcome::Failed(_)));
    }

    #[test]
    fn parses_handoff_output() {
        let text = "HANDOFF:\nImplemented the worker queue, remaining: metrics wiring.";
        let outcome = QuestOutcome::parse(text);
        match outcome {
            QuestOutcome::Handoff { checkpoint } => {
                assert!(checkpoint.contains("Implemented the worker queue"));
            }
            _ => panic!("expected handoff"),
        }
    }

    #[test]
    fn parses_structured_json_output() {
        let outcome = QuestOutcome::parse(
            r#"{"status":"failed","summary":"cargo test failed","reason":"workspace has compile errors"}"#,
        );

        match outcome {
            QuestOutcome::Failed(reason) => {
                assert_eq!(reason, "workspace has compile errors");
            }
            _ => panic!("expected failed"),
        }
    }
}
