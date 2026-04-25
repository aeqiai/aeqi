//! Autonomous agent loop — the core execution engine of AEQI's native runtime.
//!
//! ## Module layout
//!
//! | Module | Contents |
//! |--------|----------|
//! | `mod.rs` (this file) | Agent struct, constructor, builder, `run()` loop, session persistence |
//! | `compaction` | Token estimation, snip/microcompact/context-collapse, error classification |
//! | `step_context` | `StepIdeaSpec`, `StepEventMeta`, `ContextTracker`, `build_step_context` |
//! | `streaming` | `call_streaming_with_tools`, SSE processing, `StreamingToolOutcome` |
//! | `tool_result` | `ProcessedToolResult`, persistence, truncation, enrichment, file tracking |

pub mod compaction;
pub mod step_context;
pub mod streaming;
pub mod tool_result;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use tracing::{debug, info, warn};

use crate::traits::{
    ChatRequest, ContentPart, Event, IdeaStore, LoopAction, Message, MessageContent, Observer,
    PendingMessageSource, Provider, Role, StopReason, Tool, ToolSpec,
};

use compaction::{
    DIMINISHING_RETURNS_COUNT, DIMINISHING_RETURNS_THRESHOLD, MAX_COMPACTIONS_PER_RUN,
    MICROCOMPACT_KEEP_RECENT, POST_COMPACT_MAX_FILES, TOKEN_BUDGET_COMPLETION_THRESHOLD,
    is_context_length_error, microcompact, snip_compact,
};
use step_context::{ContextTracker, StepEventMeta, StepIdeaSpec};
use streaming::StreamingToolOutcome;
use tool_result::{
    ContentReplacementState, ProcessedToolResult, RecentFile, build_tool_batch_summary,
    detect_file_changes, enforce_result_budget, extract_file_path_from_result, format_tool_input,
    inject_enrichments, is_file_read_tool, persist_tool_result, resolve_persist_dir_path,
    truncate_result,
};

// ---------------------------------------------------------------------------
// LoopNotification — injected between steps
// ---------------------------------------------------------------------------

/// Generic notification that can be injected into the agent loop between steps.
/// Used by background agents to deliver results to the parent.
#[derive(Debug, Clone)]
pub struct LoopNotification {
    /// Content to inject as a user-role message (e.g., XML task-notification).
    pub content: String,
}

/// Sender half for injecting notifications into an agent loop.
pub type NotificationSender = mpsc::UnboundedSender<LoopNotification>;
/// Receiver half for draining notifications inside the agent loop.
pub type NotificationReceiver = mpsc::UnboundedReceiver<LoopNotification>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Default per-tool result size limit (characters).
const DEFAULT_MAX_TOOL_RESULT_CHARS: usize = 50_000;

/// Default aggregate tool results limit per step (characters).
const DEFAULT_MAX_TOOL_RESULTS_PER_STEP: usize = 200_000;

/// Consecutive failures before switching to fallback model.
const FALLBACK_TRIGGER_COUNT: u32 = 3;

/// Hard cap on message count to prevent unbounded memory growth.
/// If compaction fails or is exhausted, the loop halts rather than OOM.
const MAX_MESSAGES_HARD_CAP: usize = 5_000;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/// Configuration for an agent loop.
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// Model to use (provider-specific format).
    pub model: String,
    /// Maximum iterations (LLM round-trips) before stopping.
    pub max_iterations: u32,
    /// Maximum tokens per LLM response.
    pub max_tokens: u32,
    /// Temperature for generation.
    pub temperature: f32,
    /// Name of this agent (for logging).
    pub name: String,
    /// Agent UUID in the agent tree. Used for memory scoping.
    pub agent_id: Option<String>,
    /// Ancestor agent IDs for hierarchical memory search.
    /// [self_id, parent_id, grandparent_id, ..., root_id].
    /// Populated by the orchestrator from the agent tree.
    pub ancestor_ids: Vec<String>,
    /// Model's context window size in tokens. Drives compaction decisions.
    pub context_window: u32,
    /// Maximum characters per individual tool result before persistence/truncation.
    pub max_tool_result_chars: usize,
    /// Maximum aggregate tool result characters per step.
    pub max_tool_results_per_step: usize,
    /// Loop-level retries on transient API errors. Default: 0.
    /// Retries should normally be handled by the Provider layer (ReliableProvider,
    /// FallbackChain). Set >0 only when your provider lacks built-in retry.
    /// Context-length errors are always handled by the loop (compact + retry)
    /// regardless of this setting.
    pub max_retries: u32,
    /// Base delay for exponential backoff on loop-level retries (ms).
    pub retry_base_delay_ms: u64,
    /// Auto-continue attempts when output is truncated (MaxTokens stop reason).
    pub max_output_recovery: u32,
    /// Compact context when estimated tokens exceed this fraction of context_window.
    pub compact_threshold: f32,
    /// Initial messages to preserve during compaction.
    pub compact_preserve_head: usize,
    /// Trailing messages to preserve during compaction.
    pub compact_preserve_tail: usize,
    /// Loop-level fallback model on consecutive failures. None = no fallback.
    /// Prefer using FallbackChain at the Provider layer instead. This field
    /// exists for simple setups (e.g., `aeqi run`) where the provider isn't
    /// wrapped in a chain.
    pub fallback_model: Option<String>,
    /// Directory for persisting large tool results. None = use temp dir on demand.
    pub persist_dir: Option<PathBuf>,
    /// File path for session state persistence. When set, the agent saves its
    /// conversation state after each compaction. On restart, if the file exists,
    /// the agent resumes from the saved state instead of starting fresh.
    pub session_file: Option<PathBuf>,
    /// Optional token budget for auto-continuation. When set, the agent continues
    /// automatically after end-step if total output tokens < budget * 0.9.
    /// Parsed from "+500k" or "use 2m tokens" syntax in the user input.
    pub token_budget: Option<u32>,
    /// Cheap/fast model for simple messages. When set, the agent routes trivial
    /// steps (short messages without code, URLs, or complex keywords) to this
    /// model instead of the primary. Saves cost on simple queries while keeping
    /// quality for complex work. Hermes calls this "smart model routing."
    pub routing_model: Option<String>,
    /// Optional compaction instructions appended to the compaction body.
    /// Forwarded to the compactor session via the `context:budget:exceeded` event.
    pub compact_instructions: Option<String>,
    /// Optional full override for the compaction body seeded into the compactor
    /// session. When `Some`, seeds the `session:compact-prompt` idea for the agent.
    /// When `None`, falls back to `DEFAULT_COMPACT_PROMPT`.
    pub compact_prompt_template: Option<String>,
    /// Session UUID for the running session. Set by the orchestrator when the
    /// agent runs inside a managed session. Used to build the ExecutionContext
    /// passed to `PatternDispatcher::dispatch` during compaction delegation.
    /// Empty string means no session is set (bare-CLI / test mode).
    pub session_id: String,
    /// Project name — passed to detectors that need to locate project-specific data
    /// (e.g. graph guardrails look up a per-project code graph DB).
    /// Empty string when running outside a project context.
    pub project_name: String,
    /// Whether this agent is permitted to spawn a child session of itself via
    /// `session.spawn` (self-delegation). Defaults to `false`.
    /// Transport-bound agents (Telegram / WhatsApp / Discord owners) set this
    /// to `true` because their interactive continuation model depends on it.
    pub can_self_delegate: bool,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            model: "anthropic/claude-sonnet-4.6".to_string(),
            max_iterations: 20,
            max_tokens: 8192,
            temperature: 0.0,
            name: "agent".to_string(),
            agent_id: None,
            ancestor_ids: Vec::new(),
            context_window: 200_000,
            max_tool_result_chars: DEFAULT_MAX_TOOL_RESULT_CHARS,
            max_tool_results_per_step: DEFAULT_MAX_TOOL_RESULTS_PER_STEP,
            max_retries: 0,
            retry_base_delay_ms: 500,
            max_output_recovery: 3,
            compact_threshold: 0.80,
            compact_preserve_head: 3,
            compact_preserve_tail: 6,
            fallback_model: None,
            persist_dir: None,
            session_file: None,
            token_budget: None,
            routing_model: None,
            compact_instructions: None,
            compact_prompt_template: None,
            session_id: String::new(),
            project_name: String::new(),
            can_self_delegate: false,
        }
    }
}

impl AgentConfig {
    /// Parse a token budget from the user input. Recognizes:
    /// - "+500k", "+2m" (at start or end of input)
    /// - "use 500k tokens", "spend 2m tokens"
    pub fn parse_token_budget(input: &str) -> Option<u32> {
        let lower = input.to_lowercase();

        // Pattern: +Nk or +Nm at start or end.
        for word in lower.split_whitespace() {
            let word = word.trim_start_matches('+');
            if let Some(n) = Self::parse_token_shorthand(word) {
                return Some(n);
            }
        }

        // Pattern: "use Nk tokens" or "spend Nm tokens".
        if let Some(pos) = lower.find("use ").or_else(|| lower.find("spend ")) {
            let after = &lower[pos..];
            for word in after.split_whitespace().skip(1) {
                if let Some(n) = Self::parse_token_shorthand(word) {
                    return Some(n);
                }
            }
        }

        None
    }

    /// Determine if a message is "simple" — suitable for a cheap routing model.
    /// Conservative: any sign of complexity keeps the primary model.
    /// Based on Hermes's smart model routing heuristic.
    pub(super) fn is_simple_message(text: &str) -> bool {
        // Too long → complex
        if text.len() > 500 {
            return false;
        }
        // Contains code indicators → complex
        if text.contains("```")
            || text.contains("fn ")
            || text.contains("def ")
            || text.contains("class ")
            || text.contains("import ")
        {
            return false;
        }
        // Contains URLs → complex (needs web context)
        if text.contains("http://") || text.contains("https://") {
            return false;
        }
        // Complex keywords → keep primary
        let complex_keywords = [
            "refactor",
            "implement",
            "debug",
            "fix",
            "migrate",
            "deploy",
            "architecture",
            "design",
            "review",
            "analyze",
            "optimize",
            "test",
            "benchmark",
            "security",
            "performance",
        ];
        let lower = text.to_lowercase();
        if complex_keywords.iter().any(|kw| lower.contains(kw)) {
            return false;
        }
        // Multiple sentences → likely complex
        if text.matches(". ").count() >= 3 {
            return false;
        }
        true
    }

    fn parse_token_shorthand(s: &str) -> Option<u32> {
        let s = s
            .trim_end_matches("tokens")
            .trim_end_matches("token")
            .trim();
        if let Some(n) = s.strip_suffix('k') {
            n.parse::<f32>().ok().map(|v| (v * 1000.0) as u32)
        } else if let Some(n) = s.strip_suffix('m') {
            n.parse::<f32>().ok().map(|v| (v * 1_000_000.0) as u32)
        } else {
            s.parse::<u32>().ok().filter(|&n| n > 1000)
        }
    }
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/// Why the agent stopped.
#[derive(Debug, Clone, PartialEq)]
pub enum AgentStopReason {
    /// Normal completion — LLM returned end_turn with no tool calls.
    EndTurn,
    /// Hit max_iterations limit.
    MaxIterations,
    /// Halted by observer/middleware.
    Halted(String),
    /// All API retries exhausted.
    ApiError(String),
    /// Context window exhausted after compaction attempts.
    ContextExhausted,
    /// Model switched to fallback due to consecutive errors.
    FallbackActivated,
    /// Cancelled by parent agent (interrupt propagation).
    Cancelled,
}

/// Result from an agent run.
#[derive(Debug, Clone)]
pub struct AgentResult {
    pub text: String,
    pub total_prompt_tokens: u32,
    pub total_completion_tokens: u32,
    pub iterations: u32,
    pub model: String,
    pub stop_reason: AgentStopReason,
}

// ---------------------------------------------------------------------------
// Session state — serializable checkpoint for resume
// ---------------------------------------------------------------------------

/// Serializable snapshot of agent loop state for session resume.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionState {
    /// Conversation messages at checkpoint time.
    pub messages: Vec<Message>,
    /// Iterations completed.
    pub iterations: u32,
    /// Total prompt tokens consumed.
    pub total_prompt_tokens: u32,
    /// Total completion tokens consumed.
    pub total_completion_tokens: u32,
    /// Number of compactions performed.
    pub compactions: u32,
    /// Active model at checkpoint (may differ from config if fallback was triggered).
    pub active_model: String,
    /// Timestamp of checkpoint (epoch millis).
    pub timestamp_ms: u64,
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/// Why the loop continued to the next iteration — for debugging and analytics.
#[derive(Debug, Clone)]
pub enum LoopTransition {
    Initial,
    ToolUse,
    OutputTruncated {
        attempt: u32,
    },
    ContextCompacted,
    /// Reactive compaction: 413/context-length error recovered via emergency compact.
    ReactiveCompact,
    /// Snip compaction removed old rounds (no API call).
    SnipCompacted {
        tokens_freed: u32,
    },
    /// Context collapse: deterministic drain of low-value middle content (no API call).
    ContextCollapsed {
        tokens_freed: u32,
    },
    FallbackModelSwitch,
    AfterTurnContinue,
}

// ---------------------------------------------------------------------------
// Default compaction prompt
// ---------------------------------------------------------------------------

/// Default compaction prompt body. Used as the content for the seeded
/// `session:compact-prompt` idea when none is set by the operator.
///
/// Contains `{custom_instructions}` and `{transcript}` placeholders. The
/// prompt is AEQI's only built-in opinionated LLM template; exposing it as
/// a public constant keeps the taxonomy discoverable, overridable via config,
/// and obvious in code search rather than buried inside the agent loop.
pub const DEFAULT_COMPACT_PROMPT: &str = "CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.\n\
Tool calls will be REJECTED and will waste your only step — you will fail the task.\n\
Your entire response must be plain text: an <analysis> block followed by a <summary> block.\n\n\
You are summarizing an autonomous agent's execution context. This summary \
replaces the compacted messages — the agent will use it to continue working. \
Anything you omit is lost forever.\n\n\
First write an <analysis> block as a drafting scratchpad (it will be stripped), \
then a <summary> block with ALL of these sections:\n\n\
1. **Primary Request and Intent** — What was the user's original request? \
What are the acceptance criteria? What is the end goal?\n\
2. **Key Technical Concepts** — Domain-specific terms, patterns, and \
constraints that affect the work. Include library versions, API contracts, \
architectural decisions.\n\
3. **Files and Code Sections** — Every file read, edited, or created. \
Include filenames with paths, what changed, and **full code snippets** for \
any code that is currently being worked on or was recently modified.\n\
4. **Errors and Fixes** — Every error encountered and exactly how it was \
resolved. Include error messages verbatim. This prevents re-encountering \
the same issues.\n\
5. **Problem Solving** — The reasoning chain: what was tried, what worked, \
what was rejected and why. Include rejected approaches to prevent retry.\n\
6. **All User Messages** — Reproduce every user instruction, clarification, \
or correction. Do not paraphrase — use the user's exact words for requests \
and corrections.\n\
7. **Pending Tasks** — What remains to be done, in dependency order. \
Include any task IDs, branch names, or tracking references.\n\
8. **Current Work** — What the agent was doing at the moment of compaction. \
Be precise: filename, function name, line range, what operation was in \
progress. Include enough detail to resume without re-reading.\n\
9. **Next Step** — The single immediate next action the agent should take. \
Include direct quotes from tool output or code that show where work left off.\n\n\
Be precise. Include filenames, function signatures, error messages, and \
code snippets where they affect the next action. Vague summaries cause \
the agent to redo work or make wrong assumptions.\n\n\
{custom_instructions}\
## Execution Transcript\n\n{transcript}";

// ---------------------------------------------------------------------------
// Agent struct
// ---------------------------------------------------------------------------

/// Autonomous agent loop — the core execution engine of AEQI's native runtime.
///
/// ## Layer Responsibilities
///
/// The agent loop is ONE layer in AEQI's execution stack. It owns what only
/// the loop can do. Everything else is delegated:
///
/// | Concern | Owner | Not the loop's job |
/// |---------|-------|--------------------|
/// | Message history | **Agent loop** | |
/// | Tool execution | **Agent loop** | |
/// | Context compaction | **Agent loop** | Middleware also compresses, but at a different level |
/// | Tool result persistence | **Agent loop** | |
/// | MaxTokens recovery | **Agent loop** | |
/// | Context-length recovery | **Agent loop** | |
/// | Observer hooks | **Agent loop** | |
/// | Transient error retry | Provider layer | Loop has opt-in safety net (max_retries) |
/// | Model fallback | Provider layer | Loop has opt-in escape hatch (fallback_model) |
/// | Cost tracking | Middleware | via after_model hook |
/// | Guardrails | Middleware | via before_tool hook |
/// | Loop detection | Middleware | via after_model hook |
/// | Memory refresh | Middleware | via after_tool hook |
/// | Budget enforcement | Middleware | via before_model hook |
///
/// ## Key Design Choices (AEQI-specific, not copied from Claude Code)
///
/// - **Tool result persistence over truncation**: Large outputs are written to disk
///   with a preview. The model can re-read the full output via file tools. Data is
///   never lost — critical for autonomous agents that can't ask the user to re-run.
///
/// - **Multi-stage compaction**: (1) Digest old tool results cheaply, (2) LLM-based
///   structured summary focused on task state, not conversation. The compaction prompt
///   is tuned for autonomous execution: what's done, what's remaining, what to do next.
///
/// - **Tool concurrency via trait**: `Tool::is_concurrent_safe()` lets each tool
///   declare its safety. Safe tools run in parallel, unsafe tools run sequentially.
///
/// - **after_step hook**: Enables AEQI's verification pipeline to validate the
///   agent's work before accepting a "done" signal.
pub struct Agent {
    pub(super) config: AgentConfig,
    pub(super) provider: Arc<dyn Provider>,
    pub(super) tools: Vec<Arc<dyn Tool>>,
    pub(super) observer: Arc<dyn Observer>,
    pub(super) system_prompt: String,
    /// (T1.11) Optional per-segment view of the system prompt. When set,
    /// the agent emits the initial `Role::System` message with
    /// `MessageContent::Parts` so each segment carries its own
    /// `cache_control` marker; providers that respect cache_control
    /// (Anthropic) emit per-block annotations on the wire, others strip.
    /// `None` (default) means the legacy single-block flat-string path.
    pub(super) system_prompt_segments: Option<Vec<crate::prompt::AssembledPromptSegment>>,
    /// Step-level ideas re-read from disk before each API call. Mutable at
    /// runtime — messages can amend step ideas mid-session.
    pub(super) step_ideas: Mutex<Vec<StepIdeaSpec>>,
    /// Step-level events whose ideas contribute to `step_ideas`. Used to
    /// emit a truthful `EventFired` pill per actual firing at step start.
    pub(super) step_events: Mutex<Vec<StepEventMeta>>,
    pub(super) idea_store: Option<Arc<dyn IdeaStore>>,
    pub(super) chat_stream: Option<crate::chat_stream::ChatStreamSender>,
    /// Receiver for notifications from background agents. Drained between steps.
    pub(super) notification_rx: Option<Arc<Mutex<NotificationReceiver>>>,
    /// Cancellation signal. When set to true, the agent loop exits at the next
    /// iteration boundary. Used for interrupt propagation from parent agents.
    pub(super) cancel_token: Arc<std::sync::atomic::AtomicBool>,
    /// Prior conversation history (for forked sessions).
    pub(super) history: Vec<Message>,
    /// Optional event-driven pattern dispatcher (wired by the orchestrator).
    ///
    /// When present, the compaction pipeline fires `context:budget:exceeded`
    /// via this dispatcher. If an enabled event handles the pattern (returns
    /// `true`), compaction is delegated to the event's tool_calls (e.g.
    /// `transcript.replace_middle`). When absent or no event handles the
    /// pattern, context pressure is reduced by snip/microcompact only.
    pub(super) pattern_dispatcher: Option<Arc<dyn crate::tool_registry::PatternDispatcher>>,
    /// Pattern detectors run at each tool-call and step boundary.
    ///
    /// Each detector inspects the current [`DetectionContext`] and returns
    /// zero or more [`DetectedPattern`] values. The agent loop fires each
    /// pattern through `pattern_dispatcher` (or logs it when no dispatcher
    /// is wired). Detectors do not author LLM-facing content — that is the
    /// event's job.
    pub(super) detectors: Vec<Arc<dyn crate::detector::PatternDetector>>,
    /// Per-turn refresh context assembled from `session:execution_start`
    /// events. Injected as a system message AFTER the user message on every
    /// LLM request within this spawn. Set once per spawn — lifetime matches
    /// `session:execution_start` (once per turn). Empty string = no injection.
    pub(super) execution_context: String,
    /// Source for step-boundary user-message injection. When set, the agent
    /// loop claims any pending messages for `config.session_id` at each step
    /// boundary (right before `StepStart`) and appends them as `Role::User`
    /// entries so the model sees them on the next LLM round-trip.
    pub(super) pending_source: Option<Arc<dyn PendingMessageSource>>,
    /// Watermark: the `pending_messages.id` that was consumed when this turn
    /// started. Step-boundary injection only claims rows with `id > watermark`
    /// so the main drain loop's claim (for the NEXT turn) is never stolen.
    pub(super) last_pending_id: Option<i64>,
}

// ---------------------------------------------------------------------------
// Constructor + builder
// ---------------------------------------------------------------------------

impl Agent {
    pub fn new(
        config: AgentConfig,
        provider: Arc<dyn Provider>,
        tools: Vec<Arc<dyn Tool>>,
        observer: Arc<dyn Observer>,
        system_prompt: String,
    ) -> Self {
        Self {
            config,
            provider,
            tools,
            observer,
            system_prompt,
            system_prompt_segments: None,
            step_ideas: Mutex::new(Vec::new()),
            step_events: Mutex::new(Vec::new()),
            idea_store: None,
            chat_stream: None,
            notification_rx: None,
            history: Vec::new(),
            cancel_token: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            pattern_dispatcher: None,
            detectors: Vec::new(),
            execution_context: String::new(),
            pending_source: None,
            last_pending_id: None,
        }
    }

    /// Get the cancel token for external interrupt signaling.
    /// Set to `true` to stop the agent at the next iteration boundary.
    pub fn cancel_token(&self) -> Arc<std::sync::atomic::AtomicBool> {
        self.cancel_token.clone()
    }

    /// Attach a pattern dispatcher for event-driven compaction delegation.
    pub fn with_pattern_dispatcher(
        mut self,
        dispatcher: Arc<dyn crate::tool_registry::PatternDispatcher>,
    ) -> Self {
        self.pattern_dispatcher = Some(dispatcher);
        self
    }

    /// Attach pattern detectors that run at each tool-call and step boundary.
    pub fn with_detectors(
        mut self,
        detectors: Vec<Arc<dyn crate::detector::PatternDetector>>,
    ) -> Self {
        self.detectors = detectors;
        self
    }

    /// Attach prior conversation history (for forked sessions).
    /// These messages are prepended before the new user input in `run()`.
    pub fn with_history(mut self, messages: Vec<Message>) -> Self {
        self.history = messages;
        self
    }

    /// Attach an idea store for context recall.
    pub fn with_idea_store(mut self, idea_store: Arc<dyn IdeaStore>) -> Self {
        self.idea_store = Some(idea_store);
        self
    }

    /// Attach a chat stream sender for real-time event streaming to clients.
    pub fn with_chat_stream(mut self, sender: crate::chat_stream::ChatStreamSender) -> Self {
        self.chat_stream = Some(sender);
        self
    }

    /// Attach a notification receiver for background agent results.
    /// Notifications are drained between steps and injected as user-role messages.
    pub fn with_notification_rx(mut self, rx: NotificationReceiver) -> Self {
        self.notification_rx = Some(Arc::new(Mutex::new(rx)));
        self
    }

    /// Attach step-level ideas that are re-read from disk before each API call.
    pub fn with_step_ideas(mut self, specs: Vec<StepIdeaSpec>) -> Self {
        self.step_ideas = Mutex::new(specs);
        self
    }

    /// Attach per-turn refresh context assembled from `session:execution_start`
    /// events. Injected as a system message appended after the user message on
    /// every LLM request within this spawn. Lifetime matches a single turn.
    pub fn with_execution_context(mut self, ctx: String) -> Self {
        self.execution_context = ctx;
        self
    }

    /// (T1.11) Attach the segmented view of the system prompt. When set,
    /// the agent emits the initial system message with
    /// `MessageContent::Parts` so per-segment cache_control markers reach
    /// the provider. The flat-string `system_prompt` constructor argument
    /// remains the source of truth for transcripts and observability —
    /// segments are only consulted when constructing the LLM request.
    /// Empty segment vec is treated as "no override" so callers can pass
    /// `Some(vec)` unconditionally.
    pub fn with_system_prompt_segments(
        mut self,
        segments: Vec<crate::prompt::AssembledPromptSegment>,
    ) -> Self {
        if !segments.is_empty() {
            self.system_prompt_segments = Some(segments);
        }
        self
    }

    /// Attach metadata for events that fire every step. At each `StepStart`
    /// the agent emits a `ChatStreamEvent::EventFired` per entry so the UI
    /// renders the pill at the truthful firing location.
    pub fn with_step_events(mut self, events: Vec<StepEventMeta>) -> Self {
        self.step_events = Mutex::new(events);
        self
    }

    /// Attach a pending message source for step-boundary injection.
    pub fn with_pending_source(
        mut self,
        source: Arc<dyn PendingMessageSource>,
        starting_pending_id: Option<i64>,
    ) -> Self {
        self.pending_source = Some(source);
        self.last_pending_id = starting_pending_id;
        self
    }

    // -----------------------------------------------------------------------
    // Emit helper
    // -----------------------------------------------------------------------

    /// Emit a chat stream event if a sender is attached.
    pub(super) fn emit(&self, event: crate::chat_stream::ChatStreamEvent) {
        if let Some(ref tx) = self.chat_stream {
            tx.send(event);
        }
    }

    // -----------------------------------------------------------------------
    // Pattern detector dispatch
    // -----------------------------------------------------------------------

    /// Run all registered detectors against `ctx` and fire each returned pattern.
    async fn run_detectors(&self, ctx: &crate::detector::DetectionContext<'_>) {
        if self.detectors.is_empty() {
            return;
        }

        let session_id = ctx.session_id.to_owned();
        let agent_id = ctx.agent_id.to_owned();

        for detector in &self.detectors {
            let patterns = detector.detect(ctx).await;
            for fired in patterns {
                if let Some(ref dispatcher) = self.pattern_dispatcher {
                    use crate::tool_registry::ExecutionContext;
                    let ectx = ExecutionContext {
                        session_id: session_id.clone(),
                        agent_id: agent_id.clone(),
                        ..Default::default()
                    };
                    dispatcher
                        .dispatch(&fired.pattern, &ectx, &fired.args)
                        .await;
                } else {
                    warn!(
                        pattern = %fired.pattern,
                        detector = %detector.name(),
                        "detector fired pattern (no dispatcher wired)"
                    );
                }
            }
        }
    }

    /// Same as `run_detectors` but returns whether any pattern was dispatched.
    /// Used in tests to verify detector+dispatcher integration.
    #[cfg(test)]
    pub(crate) async fn run_detectors_test(
        &self,
        ctx: &crate::detector::DetectionContext<'_>,
    ) -> Vec<String> {
        let mut fired_patterns = Vec::new();
        if self.detectors.is_empty() {
            return fired_patterns;
        }

        let session_id = ctx.session_id.to_owned();
        let agent_id = ctx.agent_id.to_owned();

        for detector in &self.detectors {
            let patterns = detector.detect(ctx).await;
            for fired in patterns {
                fired_patterns.push(fired.pattern.clone());
                if let Some(ref dispatcher) = self.pattern_dispatcher {
                    use crate::tool_registry::ExecutionContext;
                    let ectx = ExecutionContext {
                        session_id: session_id.clone(),
                        agent_id: agent_id.clone(),
                        ..Default::default()
                    };
                    dispatcher
                        .dispatch(&fired.pattern, &ectx, &fired.args)
                        .await;
                } else {
                    warn!(
                        pattern = %fired.pattern,
                        detector = %detector.name(),
                        "detector fired pattern (no dispatcher wired)"
                    );
                }
            }
        }
        fired_patterns
    }

    // -----------------------------------------------------------------------
    // Resolve persist dir (thin wrapper over free fn in tool_result)
    // -----------------------------------------------------------------------

    fn resolve_persist_dir<'a>(&self, created: &'a mut Option<PathBuf>) -> Option<&'a Path> {
        if created.is_some() {
            return created.as_deref();
        }
        resolve_persist_dir_path(&self.config, created);
        created.as_deref()
    }

    // -----------------------------------------------------------------------
    // Main loop
    // -----------------------------------------------------------------------

    /// Run the agent with an input message.
    pub async fn run(&self, input: &str) -> anyhow::Result<AgentResult> {
        self.observer
            .record(Event::AgentStart {
                agent_name: self.config.name.clone(),
            })
            .await;

        // Build initial messages.
        //
        // (T1.11) When `system_prompt_segments` is set, emit the system
        // message as `MessageContent::Parts` so per-segment cache_control
        // markers reach providers that respect them (Anthropic). Otherwise
        // fall back to a flat-text system message — byte-identical to the
        // pre-T1.11 path.
        let system_content = match &self.system_prompt_segments {
            Some(segments) => {
                use crate::traits::ContentPart;
                let parts: Vec<ContentPart> = segments
                    .iter()
                    .filter(|s| !s.content.is_empty())
                    .map(|s| ContentPart::Text {
                        text: s.content.clone(),
                        cache_control: s.cache_control,
                    })
                    .collect();
                if parts.is_empty() {
                    MessageContent::text(&self.system_prompt)
                } else {
                    MessageContent::Parts(parts)
                }
            }
            None => MessageContent::text(&self.system_prompt),
        };
        let mut messages = vec![Message {
            role: Role::System,
            content: system_content,
        }];

        // Inject prior conversation history (forked sessions).
        if !self.history.is_empty() {
            debug!(agent = %self.config.name, count = self.history.len(), "injecting forked history");
            messages.extend(self.history.iter().cloned());
        }

        messages.push(Message {
            role: Role::User,
            content: MessageContent::text(input),
        });

        let tool_specs: Vec<ToolSpec> = self.tools.iter().map(|t| t.spec()).collect();

        let mut tracker = ContextTracker::default();
        let mut iterations = 0u32;
        let mut final_text = String::new();
        let mut recent_files: Vec<RecentFile> = Vec::new();
        let mut consecutive_low_output: u32 = 0;

        // --- Session resume: restore from checkpoint if available ---
        if let Some(ref session_file) = self.config.session_file
            && let Some(state) = Self::load_session(session_file).await
        {
            // Validate checkpoint integrity: reject empty/corrupt states.
            if state.messages.is_empty() {
                warn!(
                    agent = %self.config.name,
                    "session checkpoint has empty messages, starting fresh"
                );
                if let Err(e) = tokio::fs::remove_file(session_file).await {
                    debug!(agent = %self.config.name, "failed to remove corrupt session file: {e}");
                }
            } else {
                messages = state.messages;
                iterations = state.iterations;
                tracker.total_prompt_tokens = state.total_prompt_tokens;
                tracker.total_completion_tokens = state.total_completion_tokens;
                tracker.compactions = state.compactions;
                // Inject a resume message so the model knows it's continuing.
                messages.push(Message {
                    role: Role::User,
                    content: MessageContent::text(
                        "Session resumed from checkpoint. Continue where you left off. \
                         Do not repeat completed work.",
                    ),
                });
            }
        }
        let mut output_recovery_count = 0u32;
        let mut stop_reason = AgentStopReason::EndTurn;
        let mut transition = LoopTransition::Initial;
        let mut consecutive_errors = 0u32;
        let mut active_model = self.config.model.clone();
        let mut persist_dir_created: Option<PathBuf> = None;
        let mut has_attempted_reactive_compact = false;
        let mut replacement_state = ContentReplacementState::new();
        // Watermark for step-boundary injection: tracks the highest
        // `pending_messages.id` claimed at a boundary within this turn.
        let mut injection_watermark: Option<i64> = self.last_pending_id;

        loop {
            // Check cancellation signal (set by parent interrupt propagation).
            if self.cancel_token.load(std::sync::atomic::Ordering::Relaxed) {
                warn!(agent = %self.config.name, "agent cancelled by parent");
                stop_reason = AgentStopReason::Cancelled;
                break;
            }

            iterations += 1;
            if iterations > self.config.max_iterations {
                warn!(
                    agent = %self.config.name,
                    max = self.config.max_iterations,
                    "agent hit max iterations"
                );
                stop_reason = AgentStopReason::MaxIterations;
                break;
            }

            // Hard cap on message history to prevent unbounded memory growth.
            if messages.len() > MAX_MESSAGES_HARD_CAP {
                warn!(
                    agent = %self.config.name,
                    messages = messages.len(),
                    cap = MAX_MESSAGES_HARD_CAP,
                    "message history exceeded hard cap — halting to prevent OOM"
                );
                stop_reason = AgentStopReason::ContextExhausted;
                break;
            }

            // --- before_model hook ---
            match self.observer.before_model(iterations).await {
                LoopAction::Halt(reason) => {
                    warn!(agent = %self.config.name, reason = %reason, "before_model halted");
                    final_text = format!("HALTED by middleware: {reason}");
                    stop_reason = AgentStopReason::Halted(reason);
                    break;
                }
                LoopAction::Inject(msgs) => {
                    for msg in msgs {
                        let preview: String = msg.chars().take(160).collect();
                        self.emit(crate::chat_stream::ChatStreamEvent::Status {
                            message: format!("middleware injected system message: {preview}"),
                        });
                        messages.push(Message {
                            role: Role::System,
                            content: MessageContent::text(&msg),
                        });
                    }
                }
                LoopAction::Continue => {}
            }

            // --- Context window management (3-stage compaction pipeline) ---
            let (compaction_result, estimated_tokens) = self
                .run_compaction_pipeline(
                    &mut messages,
                    &mut tracker,
                    &mut has_attempted_reactive_compact,
                    iterations,
                    &active_model,
                )
                .await;
            if let Some(t) = compaction_result {
                transition = t;
            }

            // --- Conversation repair: ensure tool_use/tool_result pairing ---
            if matches!(
                transition,
                LoopTransition::ContextCompacted
                    | LoopTransition::ReactiveCompact
                    | LoopTransition::SnipCompacted { .. }
                    | LoopTransition::ContextCollapsed { .. }
                    | LoopTransition::FallbackModelSwitch
            ) {
                Self::repair_tool_pairing(&mut messages);
            }

            // Smart model routing: use cheap model for simple messages when configured.
            let step_model = if let Some(ref routing) = self.config.routing_model
                && iterations == 1
            {
                let last_user_text = messages
                    .iter()
                    .rev()
                    .find(|m| m.role == Role::User)
                    .and_then(|m| m.content.as_text())
                    .unwrap_or("");
                if AgentConfig::is_simple_message(last_user_text) {
                    debug!(
                        agent = %self.config.name,
                        routing = %routing,
                        "smart routing: simple message → cheap model"
                    );
                    routing.clone()
                } else {
                    active_model.clone()
                }
            } else {
                active_model.clone()
            };

            // Build request. Clone messages once; append ephemeral per-turn
            // and per-iteration context as system messages at the end.
            let step_ctx = self.build_step_context().await;
            let mut request_messages = messages.clone();
            if !self.execution_context.is_empty() {
                request_messages.push(Message {
                    role: Role::System,
                    content: MessageContent::text(format!(
                        "<execution-context>\n{}\n</execution-context>",
                        self.execution_context
                    )),
                });
            }
            if !step_ctx.is_empty() {
                request_messages.push(Message {
                    role: Role::System,
                    content: MessageContent::text(format!(
                        "<step-context>\n{step_ctx}\n</step-context>"
                    )),
                });
            }
            let request = ChatRequest {
                model: step_model,
                messages: request_messages,
                tools: tool_specs.clone(),
                max_tokens: self.config.max_tokens,
                temperature: self.config.temperature,
            };

            self.observer
                .record(Event::LlmRequest {
                    model: request.model.clone(),
                    tokens: estimated_tokens,
                })
                .await;

            // Step-boundary injection: claim any user messages that arrived
            // for this session while this turn was already running.
            if let Some(ref src) = self.pending_source {
                let sid = &self.config.session_id;
                if !sid.is_empty() {
                    match src
                        .claim_pending_for_session(sid, injection_watermark)
                        .await
                    {
                        Ok(injected) => {
                            for row in injected {
                                debug!(
                                    agent = %self.config.name,
                                    id = row.id,
                                    after_step = iterations - 1,
                                    "step-boundary injection: user message claimed"
                                );
                                messages.push(Message {
                                    role: Role::User,
                                    content: MessageContent::text(&row.content),
                                });
                                self.emit(crate::chat_stream::ChatStreamEvent::UserInjected {
                                    text: row.content,
                                    after_step: iterations - 1,
                                    message_id: Some(row.id),
                                });
                                injection_watermark = Some(row.id);
                            }
                        }
                        Err(e) => {
                            warn!(
                                agent = %self.config.name,
                                error = %e,
                                "step-boundary injection: claim failed, continuing"
                            );
                        }
                    }
                }
            }

            // Emit StepStart divider, then per-step EventFired pills.
            self.emit(crate::chat_stream::ChatStreamEvent::StepStart {
                step: iterations,
                model: request.model.clone(),
            });

            {
                let step_events = self.step_events.lock().await;
                for ev in step_events.iter() {
                    self.emit(crate::chat_stream::ChatStreamEvent::EventFired {
                        event_id: ev.event_id.clone(),
                        event_name: ev.event_name.clone(),
                        pattern: ev.pattern.clone(),
                        idea_ids: ev.idea_ids.clone(),
                        prepersisted: false,
                    });
                }
            }

            // --- Call provider (streaming with early tool execution) ---
            let response;
            let streaming_tool_outcome;

            match self.call_streaming_with_tools(&request).await {
                Ok((resp, outcome)) => {
                    streaming_tool_outcome = outcome;
                    consecutive_errors = 0;
                    response = resp;
                }
                Err(e) => {
                    let err_str = e.to_string();
                    consecutive_errors += 1;

                    // Context-length error → reactive compact and retry.
                    if is_context_length_error(&err_str)
                        && !has_attempted_reactive_compact
                        && tracker.compactions < MAX_COMPACTIONS_PER_RUN
                    {
                        let protected =
                            self.config.compact_preserve_head + self.config.compact_preserve_tail;
                        if messages.len() > protected {
                            warn!(
                                agent = %self.config.name,
                                "reactive compact: context too long, emergency compaction"
                            );
                            self.emit(crate::chat_stream::ChatStreamEvent::Tombstone {
                                step: iterations,
                                reason: "context too long — emergency compaction".into(),
                            });
                            self.emit(crate::chat_stream::ChatStreamEvent::Status {
                                message: "Emergency context compaction...".into(),
                            });
                            let freed = snip_compact(
                                &mut messages,
                                self.config.compact_preserve_head,
                                self.config.compact_preserve_tail,
                            );
                            if freed > 0 {
                                self.emit(crate::chat_stream::ChatStreamEvent::SnipCompacted {
                                    tokens_freed: freed,
                                });
                            }
                            let cleared = microcompact(
                                &mut messages,
                                self.config.compact_preserve_tail,
                                MICROCOMPACT_KEEP_RECENT,
                            );
                            if cleared > 0 {
                                self.emit(crate::chat_stream::ChatStreamEvent::MicroCompacted {
                                    cleared: cleared as u32,
                                });
                            }
                            tracker.compactions += 1;
                            has_attempted_reactive_compact = true;
                            iterations -= 1;
                            transition = LoopTransition::ReactiveCompact;
                            continue;
                        }
                    }

                    // Fallback model — switch on consecutive failures.
                    if consecutive_errors >= FALLBACK_TRIGGER_COUNT
                        && let Some(ref fallback) = self.config.fallback_model
                        && active_model != *fallback
                    {
                        warn!(
                            agent = %self.config.name,
                            consecutive_errors,
                            from = %active_model,
                            to = %fallback,
                            "switching to fallback model"
                        );
                        self.emit(crate::chat_stream::ChatStreamEvent::Tombstone {
                            step: iterations,
                            reason: format!(
                                "switching to fallback model after {consecutive_errors} errors"
                            ),
                        });
                        active_model = fallback.clone();
                        consecutive_errors = 0;
                        iterations -= 1;
                        transition = LoopTransition::FallbackModelSwitch;
                        stop_reason = AgentStopReason::FallbackActivated;
                        continue;
                    }

                    // All automatic recovery exhausted — surface the error.
                    self.emit(crate::chat_stream::ChatStreamEvent::Error {
                        message: err_str.clone(),
                        recoverable: false,
                    });

                    let action = self.observer.on_error(iterations, &err_str).await;
                    match action {
                        LoopAction::Halt(reason) => {
                            stop_reason = AgentStopReason::Halted(reason);
                        }
                        _ => {
                            if is_context_length_error(&err_str) {
                                stop_reason = AgentStopReason::ContextExhausted;
                            } else {
                                stop_reason = AgentStopReason::ApiError(err_str);
                            }
                        }
                    }
                    break;
                }
            };

            tracker.update(&response.usage);

            self.observer
                .record(Event::LlmResponse {
                    model: active_model.clone(),
                    prompt_tokens: response.usage.prompt_tokens,
                    completion_tokens: response.usage.completion_tokens,
                })
                .await;

            self.emit(crate::chat_stream::ChatStreamEvent::StepComplete {
                step: iterations,
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
                cache_read_input_tokens: response.usage.cache_read_input_tokens,
            });

            // --- after_model hook ---
            match self
                .observer
                .after_model(
                    iterations,
                    response.usage.prompt_tokens,
                    response.usage.completion_tokens,
                )
                .await
            {
                LoopAction::Halt(reason) => {
                    warn!(agent = %self.config.name, reason = %reason, "after_model halted");
                    final_text = format!("HALTED by middleware: {reason}");
                    stop_reason = AgentStopReason::Halted(reason);
                    break;
                }
                LoopAction::Inject(msgs) => {
                    for msg in msgs {
                        let preview: String = msg.chars().take(160).collect();
                        self.emit(crate::chat_stream::ChatStreamEvent::Status {
                            message: format!(
                                "middleware injected system message after model: {preview}"
                            ),
                        });
                        messages.push(Message {
                            role: Role::System,
                            content: MessageContent::text(&msg),
                        });
                    }
                }
                LoopAction::Continue => {}
            }

            debug!(
                agent = %self.config.name,
                iteration = iterations,
                tool_calls = response.tool_calls.len(),
                stop_reason = ?response.stop_reason,
                prompt_tokens = response.usage.prompt_tokens,
                completion_tokens = response.usage.completion_tokens,
                transition = ?transition,
                "LLM response"
            );

            // Accumulate text.
            if let Some(ref text) = response.content {
                final_text = text.clone();
            }

            // --- Step completion: no tool calls ---
            if response.tool_calls.is_empty() {
                // MaxTokens recovery: output was truncated, auto-continue.
                if response.stop_reason == StopReason::MaxTokens
                    && output_recovery_count < self.config.max_output_recovery
                {
                    output_recovery_count += 1;
                    info!(
                        agent = %self.config.name,
                        attempt = output_recovery_count,
                        max = self.config.max_output_recovery,
                        "output truncated (MaxTokens), auto-continuing"
                    );

                    if let Some(ref text) = response.content {
                        messages.push(Message {
                            role: Role::Assistant,
                            content: MessageContent::text(text),
                        });
                    }

                    messages.push(Message {
                        role: Role::User,
                        content: MessageContent::text(
                            "Output was truncated. Continue executing the task from where \
                             you left off. Do not repeat completed work. If the remaining \
                             work is large, break it into smaller tool calls.",
                        ),
                    });

                    transition = LoopTransition::OutputTruncated {
                        attempt: output_recovery_count,
                    };
                    continue;
                }

                // --- Run pattern detectors at end-of-step (no tool calls) ---
                {
                    use crate::detector::DetectionContext;
                    let ctx = DetectionContext {
                        session_id: &self.config.session_id,
                        agent_id: self.config.agent_id.as_deref().unwrap_or(&self.config.name),
                        project_name: &self.config.project_name,
                        latest_tool_call: None,
                    };
                    self.run_detectors(&ctx).await;
                }

                // --- after_step hook ---
                let stop_str = format!("{:?}", response.stop_reason);
                match self
                    .observer
                    .after_step(iterations, &final_text, &stop_str)
                    .await
                {
                    LoopAction::Inject(msgs) => {
                        info!(
                            agent = %self.config.name,
                            injected = msgs.len(),
                            "after_step forcing continuation"
                        );
                        if let Some(ref text) = response.content {
                            messages.push(Message {
                                role: Role::Assistant,
                                content: MessageContent::text(text),
                            });
                        }
                        for msg in msgs {
                            let preview: String = msg.chars().take(160).collect();
                            self.emit(crate::chat_stream::ChatStreamEvent::Status {
                                message: format!(
                                    "middleware forced continuation with user message: {preview}"
                                ),
                            });
                            messages.push(Message {
                                role: Role::User,
                                content: MessageContent::text(&msg),
                            });
                        }
                        transition = LoopTransition::AfterTurnContinue;
                        continue;
                    }
                    LoopAction::Halt(reason) => {
                        stop_reason = AgentStopReason::Halted(reason);
                        break;
                    }
                    LoopAction::Continue => {
                        // Token budget auto-continuation.
                        if let Some(budget) = self.config.token_budget {
                            let used = tracker.total_completion_tokens;
                            let threshold =
                                (budget as f32 * TOKEN_BUDGET_COMPLETION_THRESHOLD) as u32;
                            if used < threshold {
                                let pct = (used as f32 / budget as f32 * 100.0) as u32;
                                info!(
                                    agent = %self.config.name,
                                    used, budget, pct,
                                    "token budget not exhausted, auto-continuing"
                                );
                                if let Some(ref text) = response.content {
                                    messages.push(Message {
                                        role: Role::Assistant,
                                        content: MessageContent::text(text),
                                    });
                                }
                                messages.push(Message {
                                    role: Role::User,
                                    content: MessageContent::text(format!(
                                        "Stopped at {pct}% of token target ({used} / {budget}). \
                                         Keep working — do not summarize or ask if you should continue."
                                    )),
                                });
                                transition = LoopTransition::AfterTurnContinue;
                                continue;
                            }
                        }
                        // Empty response after tool result = model glitch. Nudge to continue.
                        if response.content.as_deref().unwrap_or("").trim().is_empty()
                            && response.tool_calls.is_empty()
                            && messages.last().is_some_and(|m| m.role == Role::Tool)
                            && output_recovery_count < 2
                        {
                            output_recovery_count += 1;
                            warn!(
                                agent = %self.config.name,
                                attempt = output_recovery_count,
                                "empty response after tool result — nudging model to continue"
                            );
                            messages.push(Message {
                                role: Role::User,
                                content: MessageContent::text(
                                    "You called a tool but gave an empty response. \
                                     Please analyze the tool result and respond to the user.",
                                ),
                            });
                            transition = LoopTransition::AfterTurnContinue;
                            continue;
                        }

                        break;
                    }
                }
            }

            // Reset output recovery counter on tool-use steps.
            output_recovery_count = 0;

            // --- Diminishing returns detection ---
            if response.usage.completion_tokens < DIMINISHING_RETURNS_THRESHOLD {
                consecutive_low_output += 1;
                if consecutive_low_output >= DIMINISHING_RETURNS_COUNT {
                    warn!(
                        agent = %self.config.name,
                        consecutive = consecutive_low_output,
                        threshold = DIMINISHING_RETURNS_THRESHOLD,
                        "diminishing returns detected — stopping"
                    );
                    stop_reason = AgentStopReason::Halted(
                        "Diminishing returns: agent producing minimal output".to_string(),
                    );
                    break;
                }
            } else {
                consecutive_low_output = 0;
            }

            // --- Build assistant message ---
            let mut assistant_parts: Vec<ContentPart> = Vec::new();
            if let Some(ref text) = response.content {
                assistant_parts.push(ContentPart::text(text.clone()));
            }
            for tc in &response.tool_calls {
                assistant_parts.push(ContentPart::ToolUse {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    input: tc.arguments.clone(),
                });
            }

            messages.push(Message {
                role: Role::Assistant,
                content: MessageContent::Parts(assistant_parts),
            });

            // --- before_tool + Execute tools ---
            let mut all_results: Vec<tool_result::ToolExecResult> = Vec::new();
            let mut tool_result_parts: Vec<ContentPart> = Vec::new();
            let mut loop_halted = false;

            match streaming_tool_outcome {
                StreamingToolOutcome::Executed(results) => {
                    all_results = results;
                }
                StreamingToolOutcome::Halted {
                    reason,
                    tool_result_parts: parts,
                } => {
                    warn!(agent = %self.config.name, reason = %reason, "before_tool halted (streaming)");
                    tool_result_parts = parts;
                    final_text = format!("HALTED by middleware: {reason}");
                    stop_reason = AgentStopReason::Halted(reason);
                    loop_halted = true;
                }
                StreamingToolOutcome::NoTools => {}
            }

            if loop_halted {
                if !tool_result_parts.is_empty() {
                    messages.push(Message {
                        role: Role::Tool,
                        content: MessageContent::Parts(tool_result_parts),
                    });
                }
                break;
            }

            // --- Process results: observe, persist/truncate, budget ---
            let mut processed: Vec<ProcessedToolResult> = Vec::with_capacity(all_results.len());

            for (id, name, input_args, result, duration_ms) in all_results {
                match result {
                    Ok(tr) => {
                        self.observer
                            .record(Event::ToolCall {
                                tool_name: name.clone(),
                                duration_ms,
                            })
                            .await;

                        match self
                            .observer
                            .after_tool(&name, &tr.output, tr.is_error)
                            .await
                        {
                            LoopAction::Halt(reason) => {
                                warn!(agent = %self.config.name, tool = %name, reason = %reason, "after_tool halted");
                                final_text = format!("HALTED by middleware (after_tool): {reason}");
                                stop_reason = AgentStopReason::Halted(reason);
                                processed.push(ProcessedToolResult {
                                    id,
                                    name,
                                    output: tr.output,
                                    is_error: tr.is_error,
                                });
                                loop_halted = true;
                                break;
                            }
                            LoopAction::Inject(_) | LoopAction::Continue => {}
                        }

                        // Run pattern detectors after each tool call.
                        {
                            use crate::detector::{DetectionContext, ToolCallRecord};
                            let record = ToolCallRecord {
                                name: name.clone(),
                                input: input_args.to_string(),
                            };
                            let ctx = DetectionContext {
                                session_id: &self.config.session_id,
                                agent_id: self
                                    .config
                                    .agent_id
                                    .as_deref()
                                    .unwrap_or(&self.config.name),
                                project_name: &self.config.project_name,
                                latest_tool_call: Some(&record),
                            };
                            self.run_detectors(&ctx).await;
                        }

                        self.emit(crate::chat_stream::ChatStreamEvent::ToolComplete {
                            tool_use_id: id.clone(),
                            tool_name: name.clone(),
                            success: !tr.is_error,
                            input_preview: format_tool_input(&name, &input_args),
                            output_preview: tr.output.chars().take(500).collect(),
                            duration_ms,
                        });

                        // Emit DelegateComplete for agents(action=delegate).
                        if name == "agents" {
                            let worker = input_args
                                .get("to")
                                .and_then(|v| v.as_str())
                                .unwrap_or("subagent")
                                .to_string();
                            let outcome = if tr.is_error {
                                format!(
                                    "error: {}",
                                    tr.output.chars().take(300).collect::<String>()
                                )
                            } else {
                                tr.output.chars().take(300).collect::<String>()
                            };
                            self.emit(crate::chat_stream::ChatStreamEvent::DelegateComplete {
                                worker_name: worker,
                                outcome,
                            });
                        }

                        // Empty result injection — prevents model confusion on step boundaries.
                        let output = if tr.output.trim().is_empty() && !tr.is_error {
                            format!("({name} completed with no output)")
                        } else {
                            tr.output
                        };

                        processed.push(ProcessedToolResult {
                            id,
                            name,
                            output,
                            is_error: tr.is_error,
                        });
                    }
                    Err(e) => {
                        self.observer
                            .record(Event::ToolError {
                                tool_name: name.clone(),
                                error: e.to_string(),
                            })
                            .await;

                        match self.observer.after_tool(&name, &e.to_string(), true).await {
                            LoopAction::Halt(reason) => {
                                warn!(agent = %self.config.name, tool = %name, reason = %reason, "after_tool halted (error path)");
                                final_text = format!("HALTED by middleware (after_tool): {reason}");
                                stop_reason = AgentStopReason::Halted(reason);
                                processed.push(ProcessedToolResult {
                                    id,
                                    name,
                                    output: format!("Tool execution error: {e}"),
                                    is_error: true,
                                });
                                loop_halted = true;
                                break;
                            }
                            LoopAction::Inject(_) | LoopAction::Continue => {}
                        }

                        processed.push(ProcessedToolResult {
                            id,
                            name,
                            output: format!("Tool execution error: {e}"),
                            is_error: true,
                        });
                    }
                }
            }

            // after_tool halt: push results so far and break outer loop.
            if loop_halted {
                for r in &processed {
                    tool_result_parts.push(ContentPart::ToolResult {
                        tool_use_id: r.id.clone(),
                        content: r.output.clone(),
                        is_error: r.is_error,
                    });
                }
                if !tool_result_parts.is_empty() {
                    messages.push(Message {
                        role: Role::Tool,
                        content: MessageContent::Parts(tool_result_parts),
                    });
                }
                break;
            }

            // --- Persist or truncate oversized results ---
            for r in &mut processed {
                if r.is_error || r.output.len() <= self.config.max_tool_result_chars {
                    continue;
                }
                let original_len = r.output.len();

                // Try disk persistence first.
                if let Some(dir) = self.resolve_persist_dir(&mut persist_dir_created) {
                    match persist_tool_result(dir, &r.id, &r.output).await {
                        Ok(persisted_msg) => {
                            debug!(
                                agent = %self.config.name,
                                tool = %r.name,
                                original = original_len,
                                "tool result persisted to disk"
                            );
                            replacement_state.mark_persisted(&r.id, &persisted_msg);
                            r.output = persisted_msg;
                            self.emit(crate::chat_stream::ChatStreamEvent::ToolSummarized {
                                tool_use_id: r.id.clone(),
                                tool_name: r.name.clone(),
                                original_bytes: original_len as u64,
                                summary: r.output.chars().take(200).collect(),
                            });
                            continue;
                        }
                        Err(e) => {
                            warn!(agent = %self.config.name, "persist failed, falling back to truncation: {e}");
                        }
                    }
                }

                // Fallback: truncate with head+tail preview.
                r.output = truncate_result(&r.output, self.config.max_tool_result_chars);
                replacement_state.mark_truncated(&r.id);
                debug!(
                    agent = %self.config.name,
                    tool = %r.name,
                    original = original_len,
                    truncated_to = r.output.len(),
                    "tool result truncated"
                );
                self.emit(crate::chat_stream::ChatStreamEvent::ToolSummarized {
                    tool_use_id: r.id.clone(),
                    tool_name: r.name.clone(),
                    original_bytes: original_len as u64,
                    summary: r.output.chars().take(200).collect(),
                });
            }

            // --- Enforce aggregate per-step budget ---
            let aggregate_truncated =
                enforce_result_budget(&mut processed, self.config.max_tool_results_per_step);
            for (id, name, original_bytes, new_bytes) in aggregate_truncated {
                self.emit(crate::chat_stream::ChatStreamEvent::ToolSummarized {
                    tool_use_id: id,
                    tool_name: name,
                    original_bytes,
                    summary: format!(
                        "aggregate-budget truncation: {original_bytes} → {new_bytes} bytes"
                    ),
                });
            }

            // --- Budget pressure injection into last tool result ---
            {
                let budget_pct = if self.config.max_iterations > 0 {
                    (iterations as f32 / self.config.max_iterations as f32 * 100.0) as u32
                } else {
                    0
                };
                if budget_pct >= 90 {
                    if let Some(last) = processed.last_mut() {
                        last.output.push_str(&format!(
                            "\n\n⚠️ BUDGET WARNING: {budget_pct}% of iteration budget used \
                             ({iterations}/{} steps). Wrap up current work and commit results NOW.",
                            self.config.max_iterations
                        ));
                        self.emit(crate::chat_stream::ChatStreamEvent::Status {
                            message: format!(
                                "budget pressure: injected 90% warning into last tool result ({iterations}/{} steps)",
                                self.config.max_iterations
                            ),
                        });
                    }
                } else if budget_pct >= 70
                    && let Some(last) = processed.last_mut()
                {
                    last.output.push_str(&format!(
                        "\n\n💡 Budget note: {budget_pct}% of iteration budget used \
                         ({iterations}/{} steps). Plan remaining work efficiently.",
                        self.config.max_iterations
                    ));
                    self.emit(crate::chat_stream::ChatStreamEvent::Status {
                        message: format!(
                            "budget pressure: injected 70% note into last tool result ({iterations}/{} steps)",
                            self.config.max_iterations
                        ),
                    });
                }
            }

            // --- Track recently-read files for post-compact restoration ---
            for r in &processed {
                if !r.is_error
                    && is_file_read_tool(&r.name)
                    && let Some(path) = extract_file_path_from_result(&r.output)
                {
                    recent_files.retain(|f| f.path != path);
                    let mtime_secs = std::fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    recent_files.push(RecentFile { path, mtime_secs });
                    if recent_files.len() > POST_COMPACT_MAX_FILES * 2 {
                        recent_files.drain(..recent_files.len() - POST_COMPACT_MAX_FILES);
                    }
                }
            }

            // Build tool result message.
            for r in &processed {
                tool_result_parts.push(ContentPart::ToolResult {
                    tool_use_id: r.id.clone(),
                    content: r.output.clone(),
                    is_error: r.is_error,
                });
            }

            messages.push(Message {
                role: Role::Tool,
                content: MessageContent::Parts(tool_result_parts),
            });

            // --- Tool batch summary ---
            let total_output_chars: usize = processed.iter().map(|r| r.output.len()).sum();
            if total_output_chars > 5000 {
                let summary = build_tool_batch_summary(&processed);
                let summary_chars = summary.chars().count();
                messages.push(Message {
                    role: Role::System,
                    content: MessageContent::text(summary),
                });
                self.emit(crate::chat_stream::ChatStreamEvent::Status {
                    message: format!(
                        "tool batch digest: injected summary of {} tool result(s) ({} chars → {} char digest)",
                        processed.len(),
                        total_output_chars,
                        summary_chars
                    ),
                });
            }

            // --- Detect file changes since last read ---
            let file_change_msgs = detect_file_changes(&recent_files).await;
            if !file_change_msgs.is_empty() {
                debug!(
                    agent = %self.config.name,
                    changes = file_change_msgs.len(),
                    "injecting file change notifications"
                );
                for (path, msg) in file_change_msgs {
                    self.emit(crate::chat_stream::ChatStreamEvent::Status {
                        message: format!(
                            "external file change: injected re-read reminder for {path}"
                        ),
                    });
                    messages.push(msg);
                }
            }

            // --- Collect enrichments from observers ---
            let attachments = self.observer.collect_attachments(iterations).await;
            if !attachments.is_empty() {
                let injected = inject_enrichments(&mut messages, attachments, &self.config);
                for (source, tokens) in injected {
                    self.emit(crate::chat_stream::ChatStreamEvent::Status {
                        message: format!("enrichment injected: {source} (~{tokens} tokens)"),
                    });
                }
            }

            // --- Drain background agent notifications ---
            if let Some(ref rx) = self.notification_rx {
                let mut rx_guard = rx.lock().await;
                let mut notif_count = 0u32;
                while let Ok(notif) = rx_guard.try_recv() {
                    let preview: String = notif.content.chars().take(200).collect();
                    self.emit(crate::chat_stream::ChatStreamEvent::Status {
                        message: format!(
                            "background notification injected as user message ({} chars): {preview}",
                            notif.content.chars().count()
                        ),
                    });
                    messages.push(Message {
                        role: Role::User,
                        content: MessageContent::text(&notif.content),
                    });
                    notif_count += 1;
                }
                if notif_count > 0 {
                    debug!(
                        agent = %self.config.name,
                        count = notif_count,
                        "injected background agent notifications"
                    );
                }
            }

            transition = LoopTransition::ToolUse;

            // If stop reason is EndTurn (not ToolUse), break after executing tools.
            if response.stop_reason == StopReason::EndTurn {
                break;
            }
        }

        // Final session checkpoint — save before cleanup.
        if let Some(ref sf) = self.config.session_file {
            Self::save_session(&messages, &tracker, iterations, &active_model, sf).await;
        }

        // Cleanup persisted tool results.
        if let Some(dir) = persist_dir_created
            && let Err(e) = tokio::fs::remove_dir_all(&dir).await
        {
            debug!(agent = %self.config.name, path = %dir.display(), "cleanup persist dir: {e}");
        }

        self.observer
            .record(Event::AgentEnd {
                agent_name: self.config.name.clone(),
                iterations,
            })
            .await;

        self.emit(crate::chat_stream::ChatStreamEvent::Complete {
            stop_reason: format!("{:?}", stop_reason),
            total_prompt_tokens: tracker.total_prompt_tokens,
            total_completion_tokens: tracker.total_completion_tokens,
            iterations,
            cost_usd: 0.0,
        });

        info!(
            agent = %self.config.name,
            iterations,
            prompt_tokens = tracker.total_prompt_tokens,
            completion_tokens = tracker.total_completion_tokens,
            compactions = tracker.compactions,
            model = %active_model,
            stop = ?stop_reason,
            "agent completed"
        );

        Ok(AgentResult {
            text: final_text,
            total_prompt_tokens: tracker.total_prompt_tokens,
            total_completion_tokens: tracker.total_completion_tokens,
            iterations,
            model: active_model,
            stop_reason,
        })
    }

    // -----------------------------------------------------------------------
    // Session persistence
    // -----------------------------------------------------------------------

    /// Save a session checkpoint to the configured session file.
    pub(super) async fn save_session(
        messages: &[Message],
        tracker: &ContextTracker,
        iterations: u32,
        active_model: &str,
        session_file: &Path,
    ) {
        let state = SessionState {
            messages: messages.to_vec(),
            iterations,
            total_prompt_tokens: tracker.total_prompt_tokens,
            total_completion_tokens: tracker.total_completion_tokens,
            compactions: tracker.compactions,
            active_model: active_model.to_string(),
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        };

        match serde_json::to_string(&state) {
            Ok(json) => {
                if let Some(parent) = session_file.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match tokio::fs::write(session_file, json).await {
                    Ok(()) => {
                        debug!(
                            path = %session_file.display(),
                            iterations,
                            messages = messages.len(),
                            "session checkpoint saved"
                        );
                    }
                    Err(e) => {
                        warn!(
                            path = %session_file.display(),
                            "failed to save session checkpoint: {e}"
                        );
                    }
                }
            }
            Err(e) => {
                warn!("failed to serialize session state: {e}");
            }
        }
    }

    /// Load a session checkpoint from the configured session file.
    /// Returns None if the file doesn't exist or can't be parsed.
    async fn load_session(session_file: &Path) -> Option<SessionState> {
        match tokio::fs::read_to_string(session_file).await {
            Ok(json) => match serde_json::from_str::<SessionState>(&json) {
                Ok(state) => {
                    info!(
                        path = %session_file.display(),
                        iterations = state.iterations,
                        messages = state.messages.len(),
                        age_ms = {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;
                            now.saturating_sub(state.timestamp_ms)
                        },
                        "resuming from session checkpoint"
                    );
                    Some(state)
                }
                Err(e) => {
                    warn!(path = %session_file.display(), "corrupt session file, starting fresh: {e}");
                    None
                }
            },
            Err(_) => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::compaction::estimate_tokens_from_messages;
    use crate::agent::tool_result::{enforce_result_budget, truncate_result};
    use crate::traits::{ContentPart, Message, MessageContent, Role};

    #[test]
    fn test_truncate_result_below_limit() {
        let output = "short output";
        let result = truncate_result(output, 100);
        assert_eq!(result, output);
    }

    #[test]
    fn test_truncate_result_above_limit() {
        let output = "a".repeat(10_000);
        let result = truncate_result(&output, 1000);
        assert!(result.len() < output.len());
        assert!(result.contains("characters truncated"));
        assert!(result.starts_with("aaaa"));
        assert!(result.ends_with("aaaa"));
    }

    #[test]
    fn test_truncate_result_utf8_safe() {
        let output = "🦀".repeat(5000);
        let result = truncate_result(&output, 1000);
        assert!(result.contains("truncated"));
    }

    #[test]
    fn test_enforce_result_budget_under_budget() {
        let mut results = vec![
            ProcessedToolResult {
                id: "1".into(),
                name: "a".into(),
                output: "x".repeat(100),
                is_error: false,
            },
            ProcessedToolResult {
                id: "2".into(),
                name: "b".into(),
                output: "y".repeat(100),
                is_error: false,
            },
        ];
        enforce_result_budget(&mut results, 1000);
        assert_eq!(results[0].output.len(), 100);
        assert_eq!(results[1].output.len(), 100);
    }

    #[test]
    fn test_enforce_result_budget_over_budget() {
        let mut results = vec![
            ProcessedToolResult {
                id: "1".into(),
                name: "small".into(),
                output: "x".repeat(100),
                is_error: false,
            },
            ProcessedToolResult {
                id: "2".into(),
                name: "big".into(),
                output: "y".repeat(10_000),
                is_error: false,
            },
        ];
        enforce_result_budget(&mut results, 5000);
        let total: usize = results.iter().map(|r| r.output.len()).sum();
        assert!(total <= 5500, "total was {total}");
        assert_eq!(results[0].output.len(), 100);
        assert!(results[1].output.len() < 10_000);
    }

    #[test]
    fn test_enforce_result_budget_skips_errors() {
        let mut results = vec![ProcessedToolResult {
            id: "1".into(),
            name: "err".into(),
            output: "x".repeat(10_000),
            is_error: true,
        }];
        enforce_result_budget(&mut results, 100);
        assert_eq!(results[0].output.len(), 10_000);
    }

    #[test]
    fn test_estimate_tokens() {
        let messages = vec![
            Message {
                role: Role::System,
                content: MessageContent::text("a".repeat(400)),
            },
            Message {
                role: Role::User,
                content: MessageContent::text("b".repeat(400)),
            },
        ];
        let tokens = estimate_tokens_from_messages(&messages);
        assert_eq!(tokens, 200);
    }

    #[test]
    fn test_estimate_tokens_structured_content() {
        let messages = vec![Message {
            role: Role::Assistant,
            content: MessageContent::Parts(vec![ContentPart::ToolResult {
                tool_use_id: "x".into(),
                content: "a".repeat(300),
                is_error: false,
            }]),
        }];
        let tokens = estimate_tokens_from_messages(&messages);
        assert_eq!(tokens, 100);
    }

    #[test]
    fn test_is_retryable_error() {
        use compaction::is_retryable_error;
        assert!(is_retryable_error("rate limit exceeded"));
        assert!(is_retryable_error("HTTP 429 Too Many Requests"));
        assert!(is_retryable_error("server is overloaded"));
        assert!(is_retryable_error("connection reset"));
        assert!(is_retryable_error("request timed out"));
        assert!(!is_retryable_error("invalid API key"));
        assert!(!is_retryable_error("malformed request body"));
    }

    #[test]
    fn test_is_context_length_error() {
        use compaction::is_context_length_error;
        assert!(is_context_length_error(
            "request exceeds maximum context length"
        ));
        assert!(is_context_length_error("token limit reached"));
        assert!(is_context_length_error("prompt is too long"));
        assert!(!is_context_length_error("network timeout"));
        assert!(!is_context_length_error("rate limited"));
    }

    #[test]
    fn test_default_config_values() {
        let config = AgentConfig::default();
        assert_eq!(config.context_window, 200_000);
        assert_eq!(config.max_tool_result_chars, 50_000);
        assert_eq!(config.max_tool_results_per_step, 200_000);
        assert_eq!(config.max_retries, 0);
        assert_eq!(config.max_output_recovery, 3);
        assert_eq!(config.max_tokens, 8192);
        assert!(config.fallback_model.is_none());
        assert!(config.persist_dir.is_none());
        assert!((config.compact_threshold - 0.80).abs() < f32::EPSILON);
    }

    #[test]
    fn test_parse_token_budget_shorthand() {
        assert_eq!(AgentConfig::parse_token_budget("+500k"), Some(500_000));
        assert_eq!(AgentConfig::parse_token_budget("+2m"), Some(2_000_000));
        assert_eq!(
            AgentConfig::parse_token_budget("fix the bug +500k"),
            Some(500_000)
        );
        assert_eq!(AgentConfig::parse_token_budget("+1.5m"), Some(1_500_000));
    }

    #[test]
    fn test_parse_token_budget_verbose() {
        assert_eq!(
            AgentConfig::parse_token_budget("use 500k tokens"),
            Some(500_000)
        );
        assert_eq!(
            AgentConfig::parse_token_budget("spend 2m tokens on this"),
            Some(2_000_000)
        );
    }

    #[test]
    fn test_parse_token_budget_none() {
        assert_eq!(AgentConfig::parse_token_budget("fix the bug"), None);
        assert_eq!(AgentConfig::parse_token_budget("hello world"), None);
    }

    #[test]
    fn test_agent_stop_reason_eq() {
        assert_eq!(AgentStopReason::EndTurn, AgentStopReason::EndTurn);
        assert_eq!(
            AgentStopReason::MaxIterations,
            AgentStopReason::MaxIterations
        );
        assert_ne!(AgentStopReason::EndTurn, AgentStopReason::MaxIterations);
    }

    #[test]
    fn test_generate_preview_short() {
        use tool_result::generate_preview;
        let content = "hello world";
        let preview = generate_preview(content, 100);
        assert_eq!(preview, "hello world");
    }

    #[test]
    fn test_generate_preview_cuts_at_newline() {
        use tool_result::generate_preview;
        let content = "line1\nline2\nline3\nline4\nline5";
        let preview = generate_preview(content, 20);
        assert!(preview.ends_with("..."));
        assert!(!preview.contains("line5"));
    }

    #[test]
    fn test_microcompact() {
        use compaction::microcompact;
        let mut messages = vec![
            Message {
                role: Role::System,
                content: MessageContent::text("system"),
            },
            Message {
                role: Role::Assistant,
                content: MessageContent::Parts(vec![ContentPart::ToolUse {
                    id: "t1".into(),
                    name: "read_file".into(),
                    input: serde_json::json!({"file_path": "/src/main.rs"}),
                }]),
            },
            Message {
                role: Role::Tool,
                content: MessageContent::Parts(vec![ContentPart::ToolResult {
                    tool_use_id: "t1".into(),
                    content: "x".repeat(1000),
                    is_error: false,
                }]),
            },
            Message {
                role: Role::Assistant,
                content: MessageContent::Parts(vec![ContentPart::ToolUse {
                    id: "t2".into(),
                    name: "grep".into(),
                    input: serde_json::json!({"pattern": "foo"}),
                }]),
            },
            Message {
                role: Role::Tool,
                content: MessageContent::Parts(vec![ContentPart::ToolResult {
                    tool_use_id: "t2".into(),
                    content: "y".repeat(1000),
                    is_error: false,
                }]),
            },
        ];

        microcompact(&mut messages, 0, 1);

        if let MessageContent::Parts(parts) = &messages[2].content
            && let ContentPart::ToolResult { content, .. } = &parts[0]
        {
            assert_eq!(content, "[Old tool result content cleared]");
        }

        if let MessageContent::Parts(parts) = &messages[4].content
            && let ContentPart::ToolResult { content, .. } = &parts[0]
        {
            assert_eq!(content.len(), 1000, "recent result should be preserved");
        }
    }

    #[test]
    fn test_snip_compact() {
        use compaction::snip_compact;
        let mut messages = vec![
            Message {
                role: Role::System,
                content: MessageContent::text("system prompt"),
            },
            Message {
                role: Role::User,
                content: MessageContent::text("user request"),
            },
            Message {
                role: Role::Assistant,
                content: MessageContent::text("a".repeat(400)),
            },
            Message {
                role: Role::Tool,
                content: MessageContent::Parts(vec![ContentPart::ToolResult {
                    tool_use_id: "t1".into(),
                    content: "b".repeat(400),
                    is_error: false,
                }]),
            },
            Message {
                role: Role::Assistant,
                content: MessageContent::text("recent work"),
            },
        ];

        let freed = snip_compact(&mut messages, 2, 1);
        assert!(freed > 0, "should have freed tokens");
        assert_eq!(
            messages.len(),
            3,
            "should have 3 messages after snip (was 5)"
        );
        assert_eq!(messages[0].role, Role::System);
        assert_eq!(messages[1].role, Role::User);
        assert_eq!(messages[2].role, Role::Assistant);
    }

    #[test]
    fn test_loop_transition_debug() {
        let t = LoopTransition::ToolUse;
        assert_eq!(format!("{t:?}"), "ToolUse");
        let t = LoopTransition::OutputTruncated { attempt: 2 };
        assert!(format!("{t:?}").contains("2"));
    }

    // -----------------------------------------------------------------------
    // PatternDetector integration test
    // -----------------------------------------------------------------------

    use crate::detector::{DetectedPattern, DetectionContext, PatternDetector, ToolCallRecord};
    use crate::tool_registry::{ExecutionContext, PatternDispatcher};
    use std::pin::Pin;
    use std::sync::{Arc as SyncArc, Mutex as StdMutex};

    struct MockDetector {
        pattern: &'static str,
    }

    #[async_trait::async_trait]
    impl PatternDetector for MockDetector {
        fn name(&self) -> &'static str {
            "mock"
        }
        async fn detect(&self, _ctx: &DetectionContext<'_>) -> Vec<DetectedPattern> {
            vec![DetectedPattern {
                pattern: self.pattern.to_string(),
                args: serde_json::json!({ "key": "value" }),
            }]
        }
    }

    struct SpyDispatcher {
        dispatched: SyncArc<StdMutex<Vec<String>>>,
    }

    impl PatternDispatcher for SpyDispatcher {
        fn dispatch<'a>(
            &'a self,
            pattern: &'a str,
            _ctx: &'a ExecutionContext,
            _trigger_args: &'a serde_json::Value,
        ) -> Pin<Box<dyn std::future::Future<Output = bool> + Send + 'a>> {
            let pattern = pattern.to_string();
            let dispatched = self.dispatched.clone();
            Box::pin(async move {
                dispatched.lock().unwrap().push(pattern);
                true
            })
        }
    }

    struct NopProvider;

    #[async_trait::async_trait]
    impl crate::traits::Provider for NopProvider {
        fn name(&self) -> &str {
            "nop"
        }
        async fn health_check(&self) -> anyhow::Result<()> {
            Ok(())
        }
        async fn chat(
            &self,
            _request: &crate::traits::ChatRequest,
        ) -> anyhow::Result<crate::traits::ChatResponse> {
            Ok(crate::traits::ChatResponse {
                content: Some("done".to_string()),
                tool_calls: vec![],
                usage: crate::traits::Usage {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    cache_creation_input_tokens: 0,
                    cache_read_input_tokens: 0,
                },
                stop_reason: crate::traits::StopReason::EndTurn,
            })
        }
    }

    struct NopObserver;

    #[async_trait::async_trait]
    impl crate::traits::Observer for NopObserver {
        fn name(&self) -> &str {
            "nop"
        }
        async fn record(&self, _event: crate::traits::Event) {}
    }

    #[tokio::test]
    async fn run_detectors_test_fires_pattern_and_calls_dispatcher() {
        let dispatched: SyncArc<StdMutex<Vec<String>>> = SyncArc::new(StdMutex::new(Vec::new()));

        let dispatcher = Arc::new(SpyDispatcher {
            dispatched: dispatched.clone(),
        });

        let detector: Arc<dyn PatternDetector> = Arc::new(MockDetector {
            pattern: "test:pattern",
        });

        let agent = Agent::new(
            AgentConfig::default(),
            Arc::new(NopProvider),
            vec![],
            Arc::new(NopObserver),
            "system".to_string(),
        )
        .with_pattern_dispatcher(dispatcher)
        .with_detectors(vec![detector]);

        let record = ToolCallRecord {
            name: "Bash".to_string(),
            input: "ls".to_string(),
        };
        let ctx = DetectionContext {
            session_id: "sess-1",
            agent_id: "agent-1",
            project_name: "test-project",
            latest_tool_call: Some(&record),
        };

        let fired = agent.run_detectors_test(&ctx).await;

        assert_eq!(fired, vec!["test:pattern"]);
        assert_eq!(dispatched.lock().unwrap().as_slice(), ["test:pattern"]);
    }
}
