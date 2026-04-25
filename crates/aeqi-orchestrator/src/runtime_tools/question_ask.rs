// Design note: `question.ask` is the agent's hook into the director-inbox
// flow. The agent fires the tool with a question + optional subject; the
// system records the question on the transcript, stamps `awaiting_at` on
// the session, and (best-effort) fires the `question:awaiting` pattern so
// operators can wire reactions (telegram ping, consolidation, etc.). The
// tool itself does NOT terminate the agent's turn — the agent's run ends
// naturally when it has nothing more to say after firing the ask. The
// session reappears for the answering director at `/`; the human's reply
// arrives via `pending_messages` and the existing claim_and_run_loop fires
// a fresh spawn that reads the answer as a normal user message.
//
// The session_id is captured by the AskFn closure at registry-build time
// (the same trick session.spawn uses to break the SessionManager ↔ tool
// dependency cycle), NOT read from the LLM's args. This means the LLM
// cannot lie about which session it's running in; the system always
// stamps the right session.
//
// ACL: LLM-only. Allowing event-fired tool_calls to invoke question.ask
// would let an operator-configured event manufacture questions the agent
// never asked — wrong primitive boundary.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;

/// Async ask closure injected into `QuestionAskTool` to break the
/// SessionManager ↔ ToolRegistry cycle. Captures the session_id +
/// agent_id at build time so the LLM can't influence routing via args.
pub type AskFn = Arc<
    dyn Fn(AskRequest) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> + Send + Sync,
>;

/// LLM-supplied args for an ask. The session_id and agent_id this ask
/// belongs to are captured by the `AskFn` closure at registry-build time —
/// never carried in this struct, so the LLM cannot influence routing.
#[derive(Debug, Clone)]
pub struct AskRequest {
    /// The full question body (will be appended to the transcript as an
    /// `assistant` message).
    pub prompt: String,
    /// Short label for the inbox row preview; ≤80 chars by tool contract.
    pub subject: String,
}

const MAX_PROMPT_LEN: usize = 4096;
const MAX_SUBJECT_LEN: usize = 80;

/// Surface a question or decision to a human director via the home-page
/// inbox. The session this tool fires from is marked as "awaiting human
/// reply"; the agent's turn ends; when a director answers from the inbox,
/// the agent re-spawns and reads the reply as a normal user message.
///
/// Args: `{
///   "prompt":  String (required, ≤4096 chars)
///   "subject": Option<String> (≤80 chars; defaults to truncated prompt)
/// }`
///
/// ACL: LLM-only.
///
/// Capability gate: the calling agent must have `can_ask_director = true`
/// (set via the DB column). Off by default; operator opts in per agent.
pub struct QuestionAskTool {
    ask_fn: Option<AskFn>,
    /// Mirror of `Agent::can_ask_director` for the agent that owns this
    /// tool registry. When `false`, all calls are rejected with a
    /// capability error.
    can_ask_director: bool,
}

impl QuestionAskTool {
    /// Stub constructor — no ask function wired. Calls return an error.
    /// Used in stub registries (specs-only) and in spawns where the
    /// capability is off (the gate fires before `ask_fn` would be missed).
    pub fn stub() -> Self {
        Self {
            ask_fn: None,
            can_ask_director: false,
        }
    }

    /// Fully wired constructor — `ask_fn` will be invoked when the tool
    /// fires and the capability gate passes. `can_ask_director` is
    /// sourced from the owning agent's DB record.
    pub fn new(ask_fn: AskFn, can_ask_director: bool) -> Self {
        Self {
            ask_fn: Some(ask_fn),
            can_ask_director,
        }
    }
}

/// Derive the inbox subject. If the agent supplied one, truncate to
/// `MAX_SUBJECT_LEN`. Else take the prompt's first non-empty line,
/// collapse whitespace, and truncate.
fn derive_subject(prompt: &str, supplied: Option<&str>) -> String {
    if let Some(s) = supplied {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return truncate_chars(trimmed, MAX_SUBJECT_LEN);
        }
    }
    let collapsed: String = prompt.split_whitespace().collect::<Vec<&str>>().join(" ");
    truncate_chars(collapsed.trim(), MAX_SUBJECT_LEN)
}

/// Char-aware truncation (avoids slicing in the middle of a multi-byte
/// UTF-8 sequence). Adds an ellipsis if any chars were dropped.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    let count = s.chars().count();
    if count <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[async_trait]
impl Tool for QuestionAskTool {
    fn name(&self) -> &str {
        "question.ask"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "question.ask".into(),
            description: "Surface a question or decision to a human director via the home-page \
                          inbox. Use only when you genuinely need a human answer to proceed and \
                          there is no human in the current chat. Your turn ends after firing — \
                          do not say 'I'll wait' or 'is there anything else' afterward; that \
                          chat continuation does NOT reach the director and reads as noise to \
                          the chat user. The director answers from /, you re-spawn with their \
                          reply as your next user message."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "The FULL question body the director reads — context + \
                                        options + the ask, in one message. NOT a title. Be \
                                        specific enough that the director can decide in one \
                                        read."
                    },
                    "subject": {
                        "type": "string",
                        "description": "Optional ≤80-char preview line for the inbox row. \
                                        Defaults to a truncated prompt. Use this when the \
                                        prompt is long and you want a punchier preview."
                    }
                },
                "required": ["prompt"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        // Capability gate — same posture as session.spawn. Off by default;
        // operator opts in per agent via `set_can_ask_director`.
        if !self.can_ask_director {
            return Ok(ToolResult::error(
                "this agent is not authorized to ask the director \
                 (can_ask_director = false); an operator must enable this capability",
            ));
        }

        let prompt = match args.get("prompt").and_then(|v| v.as_str()) {
            Some(p) if !p.trim().is_empty() => p.to_string(),
            _ => {
                return Ok(ToolResult::error("question.ask: missing or empty 'prompt'"));
            }
        };
        if prompt.chars().count() > MAX_PROMPT_LEN {
            return Ok(ToolResult::error(format!(
                "question.ask: prompt exceeds {MAX_PROMPT_LEN} chars; trim it",
            )));
        }

        let subject = derive_subject(&prompt, args.get("subject").and_then(|v| v.as_str()));

        let Some(ref ask_fn) = self.ask_fn else {
            return Ok(ToolResult::error(
                "question.ask: not wired — SessionManager not yet configured",
            ));
        };

        let req = AskRequest {
            prompt,
            subject: subject.clone(),
        };

        match ask_fn(req).await {
            Ok(()) => Ok(ToolResult::success(format!(
                "question posted to director inbox; awaiting reply (subject: \"{subject}\")",
            ))),
            Err(e) => Ok(ToolResult::error(format!("question.ask failed: {e}"))),
        }
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        // Stamping `awaiting_at` and writing a transcript row is a
        // side-effecting operation; serialize like every other writer.
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_ask_fn() -> (AskFn, Arc<std::sync::Mutex<Option<AskRequest>>>) {
        let captured: Arc<std::sync::Mutex<Option<AskRequest>>> =
            Arc::new(std::sync::Mutex::new(None));
        let captured_clone = captured.clone();
        let ask_fn: AskFn = Arc::new(move |req: AskRequest| {
            let captured = captured_clone.clone();
            Box::pin(async move {
                *captured.lock().unwrap() = Some(req);
                Ok(())
            })
        });
        (ask_fn, captured)
    }

    #[tokio::test]
    async fn stub_returns_capability_error_first() {
        let tool = QuestionAskTool::stub();
        let result = tool
            .execute(serde_json::json!({ "prompt": "should I?" }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(
            result.output.contains("not authorized"),
            "expected capability error, got: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn missing_prompt_returns_error() {
        let (ask_fn, _) = ok_ask_fn();
        let tool = QuestionAskTool::new(ask_fn, true);
        let result = tool.execute(serde_json::json!({})).await.unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("prompt"));
    }

    #[tokio::test]
    async fn empty_prompt_returns_error() {
        let (ask_fn, _) = ok_ask_fn();
        let tool = QuestionAskTool::new(ask_fn, true);
        let result = tool
            .execute(serde_json::json!({ "prompt": "   " }))
            .await
            .unwrap();
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn capability_off_blocks_with_wired_fn() {
        // Even with a working ask_fn, capability=false rejects.
        let (ask_fn, captured) = ok_ask_fn();
        let tool = QuestionAskTool::new(ask_fn, false);
        let result = tool
            .execute(serde_json::json!({ "prompt": "anything" }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("not authorized"));
        assert!(
            captured.lock().unwrap().is_none(),
            "ask_fn must NOT be invoked when capability is off"
        );
    }

    #[tokio::test]
    async fn wired_call_invokes_ask_fn_and_succeeds() {
        let (ask_fn, captured) = ok_ask_fn();
        let tool = QuestionAskTool::new(ask_fn, true);
        let result = tool
            .execute(serde_json::json!({
                "prompt": "ship it?",
                "subject": "deploy approval"
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "unexpected error: {}", result.output);
        let req = captured.lock().unwrap().clone().expect("ask_fn called");
        assert_eq!(req.prompt, "ship it?");
        assert_eq!(req.subject, "deploy approval");
    }

    #[tokio::test]
    async fn subject_defaults_to_truncated_prompt_when_omitted() {
        let (ask_fn, captured) = ok_ask_fn();
        let tool = QuestionAskTool::new(ask_fn, true);
        let prompt =
            "should I commit and push the migration to staging tonight given the team is offline";
        let result = tool
            .execute(serde_json::json!({ "prompt": prompt }))
            .await
            .unwrap();
        assert!(!result.is_error);
        let req = captured.lock().unwrap().clone().unwrap();
        assert!(req.subject.chars().count() <= MAX_SUBJECT_LEN);
        // First-run prompts that exceed MAX_SUBJECT_LEN must end with the
        // ellipsis truncation marker.
        if prompt.chars().count() > MAX_SUBJECT_LEN {
            assert!(req.subject.ends_with('…'));
        }
    }

    #[tokio::test]
    async fn oversized_prompt_returns_error() {
        let (ask_fn, _) = ok_ask_fn();
        let tool = QuestionAskTool::new(ask_fn, true);
        let huge = "x".repeat(MAX_PROMPT_LEN + 1);
        let result = tool
            .execute(serde_json::json!({ "prompt": huge }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("exceeds"));
    }

    #[tokio::test]
    async fn supplied_subject_overrides_prompt_default_and_truncates() {
        let (ask_fn, captured) = ok_ask_fn();
        let tool = QuestionAskTool::new(ask_fn, true);
        let long_subject = "x".repeat(MAX_SUBJECT_LEN + 10);
        let result = tool
            .execute(serde_json::json!({
                "prompt": "any prompt",
                "subject": long_subject
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        let req = captured.lock().unwrap().clone().unwrap();
        assert!(req.subject.chars().count() <= MAX_SUBJECT_LEN);
        assert!(req.subject.ends_with('…'));
    }
}
