//! LLM-backed failure classifier.
//!
//! Pure dependencies: provider + model + activity_log. Invoked from anywhere
//! that observes a failed quest run; callers use the returned mode to decide
//! Blocked vs. Pending retry and append `enrichment` to the quest description
//! on re-queue.
//!
//! Returns `Some((enrichment, mode))` when classification succeeds; `None`
//! when adaptive retry is disabled, no provider is configured, or the LLM
//! call fails.

use std::sync::Arc;

use aeqi_core::traits::{ChatRequest, Message, MessageContent, Provider, Role};
use tracing::info;

use crate::activity_log::ActivityLog;
use crate::failure_analysis::{FailureAnalysis, FailureMode};

/// Configuration inputs for the classifier. Keeping them in a struct makes the
/// call sites (worker today, QueueExecutor tomorrow) easy to read.
pub struct ClassifyInputs<'a> {
    pub subject: &'a str,
    pub description: &'a str,
    pub error_text: &'a str,
    pub quest_id: &'a str,
    pub agent_name: &'a str,
    pub worker_name: &'a str,
}

/// Run a failure classification pass. Fires a provider call at `temperature =
/// 0.0`, `max_tokens = 256`, parses the response, and emits a
/// `decision` / `FailureAnalyzed` activity_log entry.
///
/// Returns `None` unchanged in any non-happy path so the caller can fall back
/// to the non-adaptive retry behavior.
pub async fn classify_failure(
    provider: &Arc<dyn Provider>,
    model: &str,
    activity_log: &Arc<ActivityLog>,
    inputs: ClassifyInputs<'_>,
) -> Option<(String, FailureMode)> {
    if model.is_empty() {
        return None;
    }

    let prompt =
        FailureAnalysis::analysis_prompt(inputs.subject, inputs.description, inputs.error_text);
    let request = ChatRequest {
        model: model.to_string(),
        messages: vec![Message {
            role: Role::User,
            content: MessageContent::text(&prompt),
        }],
        tools: vec![],
        max_tokens: 256,
        temperature: 0.0,
    };

    let response = match provider.chat(&request).await {
        Ok(r) if r.content.is_some() => r,
        _ => return None,
    };

    let analysis = FailureAnalysis::parse(response.content.as_deref().unwrap_or_default());
    info!(
        worker = %inputs.worker_name,
        task = %inputs.quest_id,
        mode = ?analysis.mode,
        "failure analysis completed"
    );

    let _ = activity_log
        .emit(
            "decision",
            None,
            None,
            Some(inputs.quest_id),
            &serde_json::json!({
                "decision_type": "FailureAnalyzed",
                "agent": inputs.agent_name,
                "reasoning": format!("Mode: {:?}, Reasoning: {}", analysis.mode, analysis.reasoning),
            }),
        )
        .await;

    let enrichment = analysis.enrich_description();
    let mode = analysis.mode;
    Some((enrichment, mode))
}
