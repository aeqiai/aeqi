//! LLM health classification shared by session and schedule surfaces.

use aeqi_core::agent::AgentResult;

pub const EMPTY_COMPLETION_EVENT: &str = "llm.empty_completion";

/// Default per-schedule backoff when a cron-fired session burns prompt tokens
/// but produces no completion tokens because the provider stopped abnormally.
pub const EMPTY_COMPLETION_SCHEDULE_COOLDOWN_SECS: u64 = 30 * 60;

pub fn is_empty_completion_failure(completion_tokens: u32, stop_reason: &str) -> bool {
    completion_tokens == 0 && !is_success_stop_reason(stop_reason)
}

pub fn is_empty_completion_failure_result(result: &AgentResult) -> bool {
    let stop_reason = format!("{:?}", result.stop_reason);
    is_empty_completion_failure(result.total_completion_tokens, &stop_reason)
}

fn is_success_stop_reason(stop_reason: &str) -> bool {
    let normalized = stop_reason
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_ascii_lowercase();
    matches!(normalized.as_str(), "endturn" | "endturnstop" | "stop")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_completion_with_api_error_is_failure() {
        assert!(is_empty_completion_failure(0, "ApiError(\"402\")"));
    }

    #[test]
    fn empty_completion_with_success_stop_is_not_failure() {
        assert!(!is_empty_completion_failure(0, "EndTurn"));
        assert!(!is_empty_completion_failure(0, "end_turn"));
        assert!(!is_empty_completion_failure(0, "stop"));
    }

    #[test]
    fn non_empty_completion_is_not_empty_failure() {
        assert!(!is_empty_completion_failure(12, "ApiError(\"late\")"));
    }
}
