//! Per-iteration LLM request assembly: step ideas, step events, and context tracking.

use std::path::PathBuf;

use tracing::warn;

use super::Agent;

// ---------------------------------------------------------------------------
// Step-level idea spec
// ---------------------------------------------------------------------------

/// A step-level idea injected before each API call.
///
/// Content is snapshotted at session start to prevent mid-flight drift.
/// Shell expansion (`allow_shell`) runs once at snapshot time.
#[derive(Debug, Clone)]
pub struct StepIdeaSpec {
    /// Path to the source `.md` file (retained for diagnostics only).
    pub path: PathBuf,
    /// Whether to expand `!`backtick`` shell commands.
    pub allow_shell: bool,
    /// Name for logging.
    pub name: String,
    /// Snapshotted content. When set, `build_step_context` uses this
    /// instead of re-reading from disk.
    pub content: Option<String>,
}

// ---------------------------------------------------------------------------
// Step event metadata
// ---------------------------------------------------------------------------

/// Metadata for an event that fires every LLM step (e.g. `session:step_start`).
///
/// The agent emits a [`ChatStreamEvent::EventFired`] for each entry at the
/// moment it emits `StepStart` — so the UI renders the event_fired pill at
/// its truthful firing location, directly below each step marker, instead of
/// being batched once upfront by the orchestrator.
#[derive(Debug, Clone)]
pub struct StepEventMeta {
    pub event_id: String,
    pub event_name: String,
    pub pattern: String,
    pub idea_ids: Vec<String>,
}

// ---------------------------------------------------------------------------
// Context tracker
// ---------------------------------------------------------------------------

/// Tracks token usage and compaction state across loop iterations.
#[derive(Debug, Default)]
pub(crate) struct ContextTracker {
    pub(crate) total_prompt_tokens: u32,
    pub(crate) total_completion_tokens: u32,
    /// Prompt tokens from the most recent API response.
    pub(crate) last_prompt_tokens: u32,
    pub(crate) compactions: u32,
}

impl ContextTracker {
    pub(crate) fn update(&mut self, usage: &crate::traits::Usage) {
        self.total_prompt_tokens += usage.prompt_tokens;
        self.total_completion_tokens += usage.completion_tokens;
        self.last_prompt_tokens = usage.prompt_tokens;
    }

    pub(crate) fn estimated_context_tokens(&self) -> u32 {
        self.last_prompt_tokens
    }
}

// ---------------------------------------------------------------------------
// Step context builder (method on Agent)
// ---------------------------------------------------------------------------

impl Agent {
    /// Build step context from snapshotted idea content.
    ///
    /// Content is read from the `StepIdeaSpec.content` field, which is
    /// populated at session start. This prevents mid-flight context drift
    /// when files are edited during a running session.
    pub(super) async fn build_step_context(&self) -> String {
        let step_ideas = self.step_ideas.lock().await;
        let mut parts: Vec<String> = Vec::new();
        for spec in step_ideas.iter() {
            // Use snapshotted content if available, otherwise read from disk (legacy).
            let body = if let Some(ref cached) = spec.content {
                cached.clone()
            } else {
                match std::fs::read_to_string(&spec.path) {
                    Ok(content) => {
                        let parsed = match crate::frontmatter::parse_frontmatter(&content) {
                            Ok((_meta, body)) => body,
                            Err(_) => content,
                        };
                        if spec.allow_shell {
                            crate::frontmatter::expand_shell_commands(&parsed)
                        } else {
                            parsed
                        }
                    }
                    Err(e) => {
                        warn!(
                            agent = %self.config.name,
                            path = %spec.path.display(),
                            idea = %spec.name,
                            "failed to read step idea: {e}"
                        );
                        continue;
                    }
                }
            };

            if !body.trim().is_empty() {
                parts.push(body);
            }
        }
        parts.join("\n\n---\n\n")
    }
}
