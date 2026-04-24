use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, mpsc};
use tracing::{debug, info, warn};

use crate::traits::{
    ChatRequest, ChatResponse, ContentPart, ContextAttachment, Event, IdeaStore, LoopAction,
    Message, MessageContent, Observer, PendingMessageSource, Provider, Role, StopReason, Tool,
    ToolResult, ToolSpec, Usage,
};

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

/// Default characters-per-token estimate for plain text.
const CHARS_PER_TOKEN: usize = 4;

/// Characters-per-token for structured content (JSON tool results, code).
const CHARS_PER_TOKEN_STRUCTURED: usize = 3;

/// Maximum compaction attempts per agent run to prevent infinite loops.
const MAX_COMPACTIONS_PER_RUN: u32 = 3;

/// Microcompact: keep the N most recent compactable tool results.
const MICROCOMPACT_KEEP_RECENT: usize = 5;

/// Tool names whose results can be cleared by microcompact.
const COMPACTABLE_TOOLS: &[&str] = &[
    "read",
    "read_file",
    "readfile",
    "cat",
    "shell",
    "bash",
    "grep",
    "glob",
    "web_search",
    "websearch",
    "web_fetch",
    "webfetch",
    "edit",
    "edit_file",
    "fileedit",
    "write",
    "write_file",
    "filewrite",
];

/// Cleared content marker for microcompacted tool results.
const MICROCOMPACT_CLEARED: &str = "[Old tool result content cleared]";

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

/// Consecutive failures before switching to fallback model.
const FALLBACK_TRIGGER_COUNT: u32 = 3;

/// Preview size for persisted tool results (bytes).
const PERSIST_PREVIEW_SIZE: usize = 2000;

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
    fn is_simple_message(text: &str) -> bool {
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

/// Tracks token usage and compaction state across loop iterations.
#[derive(Debug, Default)]
struct ContextTracker {
    total_prompt_tokens: u32,
    total_completion_tokens: u32,
    /// Prompt tokens from the most recent API response.
    last_prompt_tokens: u32,
    compactions: u32,
}

impl ContextTracker {
    fn update(&mut self, usage: &Usage) {
        self.total_prompt_tokens += usage.prompt_tokens;
        self.total_completion_tokens += usage.completion_tokens;
        self.last_prompt_tokens = usage.prompt_tokens;
    }

    fn estimated_context_tokens(&self) -> u32 {
        self.last_prompt_tokens
    }
}

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

/// Intermediate tool result during processing.
struct ProcessedToolResult {
    id: String,
    name: String,
    output: String,
    is_error: bool,
}

/// A completed tool result: (id, name, input_args, result, duration_ms).
type ToolExecResult = (
    String,
    String,
    serde_json::Value,
    Result<ToolResult, anyhow::Error>,
    u64,
);

/// Outcome of streaming tool execution from `call_streaming_with_tools`.
enum StreamingToolOutcome {
    /// No tools in the LLM response.
    NoTools,
    /// Tools were executed during streaming — results ready for processing.
    Executed(Vec<ToolExecResult>),
    /// A before_tool hook halted during streaming.
    Halted {
        reason: String,
        tool_result_parts: Vec<ContentPart>,
    },
}

/// Tracks which tool results have been replaced/persisted, ensuring consistent
/// decisions across compactions and subagent forks (cache coherency).
#[derive(Debug, Clone, Default)]
pub struct ContentReplacementState {
    /// tool_use_id → replacement type applied.
    replacements: std::collections::HashMap<String, ReplacementType>,
}

// Variants recorded per tool_use_id for auditability. Matched by Debug
// output and visible via the activity log; not destructured in hot paths.
#[derive(Debug, Clone)]
#[allow(dead_code)]
enum ReplacementType {
    /// Content persisted to disk (file path recorded).
    Persisted(String),
    /// Content truncated in-place.
    Truncated,
    /// Content cleared by microcompact.
    Cleared,
}

impl ContentReplacementState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record that a tool result was persisted to disk.
    pub fn mark_persisted(&mut self, tool_use_id: &str, path: &str) {
        self.replacements.insert(
            tool_use_id.to_string(),
            ReplacementType::Persisted(path.to_string()),
        );
    }

    /// Record that a tool result was truncated.
    pub fn mark_truncated(&mut self, tool_use_id: &str) {
        self.replacements
            .insert(tool_use_id.to_string(), ReplacementType::Truncated);
    }

    /// Record that a tool result was cleared by microcompact.
    pub fn mark_cleared(&mut self, tool_use_id: &str) {
        self.replacements
            .insert(tool_use_id.to_string(), ReplacementType::Cleared);
    }

    /// Check if a tool result has already been replaced.
    pub fn is_replaced(&self, tool_use_id: &str) -> bool {
        self.replacements.contains_key(tool_use_id)
    }

    /// Number of tracked replacements.
    pub fn len(&self) -> usize {
        self.replacements.len()
    }

    /// Whether any replacements have been tracked.
    pub fn is_empty(&self) -> bool {
        self.replacements.is_empty()
    }
}

/// Maximum number of recent files to track for file-change detection.
const POST_COMPACT_MAX_FILES: usize = 5;

/// Snip compaction: early threshold factor. Fires at threshold * SNIP_FACTOR
/// before full compaction at threshold * 1.0.
const SNIP_THRESHOLD_FACTOR: f32 = 0.85;

/// Minimum tokens per continuation to consider productive. 3+ continuations
/// below this threshold trigger diminishing returns detection.
const DIMINISHING_RETURNS_THRESHOLD: u32 = 50;
const DIMINISHING_RETURNS_COUNT: u32 = 5;

/// Token budget auto-continuation: stop when this fraction of budget is used.
const TOKEN_BUDGET_COMPLETION_THRESHOLD: f32 = 0.90;

/// A recently-read file tracked for external change detection.
#[derive(Debug, Clone)]
struct RecentFile {
    path: String,
    /// File modification time at the point we read it (epoch secs).
    mtime_secs: u64,
}

/// Tool_use/tool_result pairing repair marker.
const SYNTHETIC_TOOL_RESULT: &str = "[Tool result unavailable — context was compacted]";

// ---------------------------------------------------------------------------
// Agent
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
    config: AgentConfig,
    provider: Arc<dyn Provider>,
    tools: Vec<Arc<dyn Tool>>,
    observer: Arc<dyn Observer>,
    system_prompt: String,
    /// Step-level ideas re-read from disk before each API call. Mutable at
    /// runtime — messages can amend step ideas mid-session.
    step_ideas: Mutex<Vec<StepIdeaSpec>>,
    /// Step-level events whose ideas contribute to `step_ideas`. Used to
    /// emit a truthful `EventFired` pill per actual firing at step start.
    step_events: Mutex<Vec<StepEventMeta>>,
    idea_store: Option<Arc<dyn IdeaStore>>,
    chat_stream: Option<crate::chat_stream::ChatStreamSender>,
    /// Receiver for notifications from background agents. Drained between steps.
    notification_rx: Option<Arc<Mutex<NotificationReceiver>>>,
    /// Cancellation signal. When set to true, the agent loop exits at the next
    /// iteration boundary. Used for interrupt propagation from parent agents.
    cancel_token: Arc<std::sync::atomic::AtomicBool>,
    /// Prior conversation history (for forked sessions).
    history: Vec<Message>,
    /// Optional event-driven pattern dispatcher (wired by the orchestrator).
    ///
    /// When present, the compaction pipeline fires `context:budget:exceeded`
    /// via this dispatcher. If an enabled event handles the pattern (returns
    /// `true`), compaction is delegated to the event's tool_calls (e.g.
    /// `transcript.replace_middle`). When absent or no event handles the
    /// pattern, context pressure is reduced by snip/microcompact only.
    pattern_dispatcher: Option<Arc<dyn crate::tool_registry::PatternDispatcher>>,
    /// Pattern detectors run at each tool-call and step boundary.
    ///
    /// Each detector inspects the current [`DetectionContext`] and returns
    /// zero or more [`DetectedPattern`] values. The agent loop fires each
    /// pattern through `pattern_dispatcher` (or logs it when no dispatcher
    /// is wired). Detectors do not author LLM-facing content — that is the
    /// event's job.
    detectors: Vec<Arc<dyn crate::detector::PatternDetector>>,
    /// Per-turn refresh context assembled from `session:execution_start`
    /// events. Injected as a system message AFTER the user message on every
    /// LLM request within this spawn. Set once per spawn — lifetime matches
    /// `session:execution_start` (once per turn). Empty string = no injection.
    execution_context: String,
    /// Source for step-boundary user-message injection. When set, the agent
    /// loop claims any pending messages for `config.session_id` at each step
    /// boundary (right before `StepStart`) and appends them as `Role::User`
    /// entries so the model sees them on the next LLM round-trip.
    pending_source: Option<Arc<dyn PendingMessageSource>>,
    /// Watermark: the `pending_messages.id` that was consumed when this turn
    /// started. Step-boundary injection only claims rows with `id > watermark`
    /// so the main drain loop's claim (for the NEXT turn) is never stolen.
    last_pending_id: Option<i64>,
}

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
    ///
    /// When set, the compaction pipeline fires `context:budget:exceeded` via
    /// this dispatcher. If an enabled event handles the pattern, compaction is
    /// performed durably via `transcript.replace_middle`. When absent, context
    /// pressure is handled by the structural snip/microcompact passes only.
    pub fn with_pattern_dispatcher(
        mut self,
        dispatcher: Arc<dyn crate::tool_registry::PatternDispatcher>,
    ) -> Self {
        self.pattern_dispatcher = Some(dispatcher);
        self
    }

    /// Attach pattern detectors that run at each tool-call and step boundary.
    ///
    /// Detectors return [`DetectedPattern`] values that the agent loop fires
    /// through the `pattern_dispatcher`. When no dispatcher is wired, detected
    /// patterns are logged via `tracing::warn`. Detectors do not author
    /// LLM-facing content — that is the event's job.
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

    /// Attach metadata for events that fire every step. At each `StepStart`
    /// the agent emits a `ChatStreamEvent::EventFired` per entry so the UI
    /// renders the pill at the truthful firing location.
    pub fn with_step_events(mut self, events: Vec<StepEventMeta>) -> Self {
        self.step_events = Mutex::new(events);
        self
    }

    /// Attach a pending message source for step-boundary injection.
    ///
    /// When set, the agent drains any new `pending_messages` rows queued for
    /// this session (with `id > last_pending_id`) at each step boundary, right
    /// before `StepStart` is emitted. Rows are appended as `Role::User`
    /// entries and a `UserInjected` event is emitted for each one.
    pub fn with_pending_source(
        mut self,
        source: Arc<dyn PendingMessageSource>,
        starting_pending_id: Option<i64>,
    ) -> Self {
        self.pending_source = Some(source);
        self.last_pending_id = starting_pending_id;
        self
    }

    /// Emit a chat stream event if a sender is attached.
    fn emit(&self, event: crate::chat_stream::ChatStreamEvent) {
        if let Some(ref tx) = self.chat_stream {
            tx.send(event);
        }
    }

    /// Run all registered detectors against `ctx` and fire each returned pattern.
    ///
    /// Fires patterns through `pattern_dispatcher` when one is wired, or logs
    /// them via `tracing::warn` as a fallback. Pattern dispatch is fire-and-forget:
    /// failures are logged but do not halt the agent loop.
    async fn run_detectors(&self, ctx: &crate::detector::DetectionContext<'_>) {
        if self.detectors.is_empty() {
            return;
        }

        // Extract owned data needed for dispatch before entering the pattern loop,
        // so we hold no borrow on ctx during the dispatcher await.
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
        let mut messages = vec![Message {
            role: Role::System,
            content: MessageContent::text(&self.system_prompt),
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
        // Initialized from `self.last_pending_id` (set by the caller via
        // `with_pending_source`) so we never re-claim the row that triggered
        // this turn in the first place.
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
            // Needed after any compaction path that may drop half of a use/result pair.
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
            // Only route on first step (tool-use steps need the strong model)
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
            // and per-iteration context as system messages at the end so they
            // are the freshest context the model sees before generating.
            //   execution_context → per-turn (session:execution_start), same
            //     content across every iteration within this spawn
            //   step_ctx          → per-iteration (session:step_start), fresh
            //     each LLM call
            // Neither is persisted in `messages` — they're rebuilt per request.
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
            // for this session while this turn was already running. Each
            // injected message is appended to `messages` as Role::User and
            // a UserInjected event is emitted so the UI can render the split
            // transcript. Semantics match tool_result: the model sees the
            // injected content on the NEXT LLM round-trip; the step counter
            // continues without reset.
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

            // Emit the StepStart divider first, then the per-step EventFired
            // pills. UI reads: the "Step N" divider opens the step, and the
            // event pills that follow belong to that step (context injected
            // for this iteration). DB persistence mirrors emission order.
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
                    if Self::is_context_length_error(&err_str)
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
                            // Tombstone any partial output the frontend received
                            // from this failed streaming attempt.
                            self.emit(crate::chat_stream::ChatStreamEvent::Tombstone {
                                step: iterations,
                                reason: "context too long — emergency compaction".into(),
                            });
                            self.emit(crate::chat_stream::ChatStreamEvent::Status {
                                message: "Emergency context compaction...".into(),
                            });
                            // Structural cleanup: snip → microcompact.
                            // Full compaction is handled by context:budget:exceeded via
                            // transcript.replace_middle in the event-driven path.
                            let freed = Self::snip_compact(
                                &mut messages,
                                self.config.compact_preserve_head,
                                self.config.compact_preserve_tail,
                            );
                            if freed > 0 {
                                self.emit(crate::chat_stream::ChatStreamEvent::SnipCompacted {
                                    tokens_freed: freed,
                                });
                            }
                            let cleared = Self::microcompact(
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
                        // Tombstone any partial output from the failed attempts.
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
                            if Self::is_context_length_error(&err_str) {
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

            // TextDelta events are always emitted during streaming in
            // try_streaming_with_tools — no need to re-emit here.

            self.emit(crate::chat_stream::ChatStreamEvent::StepComplete {
                step: iterations,
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
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
                        // Add assistant response + injected messages to continue.
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
                        // Token budget auto-continuation: if budget set and not exhausted,
                        // inject nudge message and keep going.
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
                assistant_parts.push(ContentPart::Text { text: text.clone() });
            }
            for tc in &response.tool_calls {
                assistant_parts.push(ContentPart::ToolUse {
                    id: tc.id.clone(),
                    name: tc.name.clone(),
                    input: tc.arguments.clone(),
                });
                // ToolStart events are emitted during streaming in
                // try_streaming_with_tools — no need to re-emit here.
            }

            messages.push(Message {
                role: Role::Assistant,
                content: MessageContent::Parts(assistant_parts),
            });

            // --- before_tool + Execute tools ---
            // Three outcomes: streaming pre-executed, streaming halted, or legacy path.
            let mut all_results: Vec<ToolExecResult> = Vec::new();
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
                StreamingToolOutcome::NoTools => {
                    // No tools in this response — nothing to execute.
                }
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
                                // Push what we have so far, then break out.
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
                            input_preview: Self::format_tool_input(&name, &input_args),
                            output_preview: tr.output.chars().take(500).collect(),
                            duration_ms,
                        });

                        // Emit DelegateComplete for agents(action=delegate) so the
                        // frontend can show the subagent outcome and duration.
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

                // Try disk persistence first — model retains access via file read.
                if let Some(dir) = self.resolve_persist_dir(&mut persist_dir_created) {
                    match Self::persist_tool_result(dir, &r.id, &r.output).await {
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
                r.output = Self::truncate_result(&r.output, self.config.max_tool_result_chars);
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
                Self::enforce_result_budget(&mut processed, self.config.max_tool_results_per_step);
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

            // --- Budget pressure injection into last tool result (Hermes pattern) ---
            // Inject warnings into the last tool result JSON instead of as separate
            // system messages. Avoids breaking message structure. Two tiers: 70% and 90%.
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
                    && Self::is_file_read_tool(&r.name)
                    && let Some(path) = Self::extract_file_path_from_result(&r.output)
                {
                    // Dedup by path (keep most recent).
                    recent_files.retain(|f| f.path != path);
                    let mtime_secs = std::fs::metadata(&path)
                        .and_then(|m| m.modified())
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    recent_files.push(RecentFile { path, mtime_secs });
                    // Keep only the most recent N files.
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

            // --- Tool batch summary (compact digest for large outputs) ---
            let total_output_chars: usize = processed.iter().map(|r| r.output.len()).sum();
            if total_output_chars > 5000 {
                let summary = Self::build_tool_batch_summary(&processed);
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

            // --- Detect file changes since last read (mid-step enrichment) ---
            let file_change_msgs = Self::detect_file_changes(&recent_files).await;
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
                let injected = Self::inject_enrichments(&mut messages, attachments, &self.config);
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
            cost_usd: 0.0, // Calculated by orchestrator layer
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
    // Compaction pipeline — extracted from run() for clarity
    // -----------------------------------------------------------------------

    /// Run the 4-stage context compaction pipeline:
    ///   Stage 0: Snip — remove entire old API rounds (no API call, ~free)
    ///   Stage 1: Microcompact — clear old tool results by name, keep recent N
    ///   Stage 1.5: Context collapse — remove stale system msgs + truncate long tool results
    ///   Stage 2: Full compact — LLM-based structured summary + restoration
    ///
    /// Returns (optional transition, estimated_tokens after compaction).
    async fn run_compaction_pipeline(
        &self,
        messages: &mut Vec<Message>,
        tracker: &mut ContextTracker,
        has_attempted_reactive_compact: &mut bool,
        iterations: u32,
        active_model: &str,
    ) -> (Option<LoopTransition>, u32) {
        let mut transition: Option<LoopTransition> = None;

        let estimated_tokens = if tracker.estimated_context_tokens() > 0 {
            tracker.estimated_context_tokens()
        } else {
            Self::estimate_tokens_from_messages(messages)
        };

        let full_threshold =
            (self.config.context_window as f32 * self.config.compact_threshold) as u32;
        let snip_threshold = (self.config.context_window as f32
            * self.config.compact_threshold
            * SNIP_THRESHOLD_FACTOR) as u32;
        let protected = self.config.compact_preserve_head + self.config.compact_preserve_tail;

        // --- Stage 0: Snip ---
        if estimated_tokens > snip_threshold && messages.len() > protected {
            let freed = Self::snip_compact(
                messages,
                self.config.compact_preserve_head,
                self.config.compact_preserve_tail,
            );
            if freed > 0 {
                debug!(
                    agent = %self.config.name,
                    tokens_freed = freed,
                    "snip compaction freed tokens"
                );
                self.emit(crate::chat_stream::ChatStreamEvent::SnipCompacted {
                    tokens_freed: freed,
                });
                transition = Some(LoopTransition::SnipCompacted {
                    tokens_freed: freed,
                });
            }
        }

        // Re-estimate after snip.
        let estimated_tokens = if transition.is_some() {
            Self::estimate_tokens_from_messages(messages)
        } else {
            estimated_tokens
        };

        // --- Stage 1: Microcompact ---
        if estimated_tokens > snip_threshold && messages.len() > protected {
            let cleared = Self::microcompact(
                messages,
                self.config.compact_preserve_tail,
                MICROCOMPACT_KEEP_RECENT,
            );
            if cleared > 0 {
                self.emit(crate::chat_stream::ChatStreamEvent::MicroCompacted {
                    cleared: cleared as u32,
                });
            }
        }

        // Re-estimate after microcompact.
        let mut estimated_tokens = Self::estimate_tokens_from_messages(messages);

        // --- Stage 1.5: Context collapse — deterministic drain before expensive LLM compact ---
        if estimated_tokens > full_threshold && messages.len() > protected {
            let collapsed = Self::context_collapse(
                messages,
                self.config.compact_preserve_head,
                self.config.compact_preserve_tail,
            );
            if collapsed > 0 {
                info!(
                    agent = %self.config.name,
                    tokens_freed = collapsed,
                    "context collapse: removed low-value content"
                );
                self.emit(crate::chat_stream::ChatStreamEvent::ContextCollapsed {
                    tokens_freed: collapsed,
                });
                estimated_tokens = Self::estimate_tokens_from_messages(messages);
                transition = Some(LoopTransition::ContextCollapsed {
                    tokens_freed: collapsed,
                });
            }
        }

        // --- Stage 2: Event-driven compaction ---
        // Fire `context:budget:exceeded` via the pattern dispatcher. If a
        // configured event handles it (e.g. spawns a compactor session and calls
        // transcript.replace_middle), compaction is performed durably. If no
        // event handles it, or the dispatcher is absent, skip — structural
        // passes (snip/microcompact) have already reduced pressure above.
        if estimated_tokens > full_threshold
            && tracker.compactions < MAX_COMPACTIONS_PER_RUN
            && messages.len() > protected
        {
            info!(
                agent = %self.config.name,
                estimated_tokens,
                threshold = full_threshold,
                compaction = tracker.compactions + 1,
                "context approaching limit, compacting"
            );
            self.emit(crate::chat_stream::ChatStreamEvent::Status {
                message: "Compacting context...".into(),
            });

            // Build transcript preview (last 2000 chars) for trigger_args.
            let transcript_preview: String = {
                let full = Self::build_compaction_transcript(messages);
                let len = full.len();
                if len > 2000 {
                    full[len - 2000..].to_string()
                } else {
                    full
                }
            };
            let trigger_args = serde_json::json!({
                "estimated_tokens": estimated_tokens,
                "threshold": full_threshold,
                "session_id": self.config.session_id,
                "transcript_preview": transcript_preview,
            });
            let ctx = crate::tool_registry::ExecutionContext {
                session_id: self.config.session_id.clone(),
                agent_id: self.config.agent_id.clone().unwrap_or_default(),
                ..Default::default()
            };

            // Try event-driven delegation first.
            let event_handled = if let Some(ref dispatcher) = self.pattern_dispatcher {
                dispatcher
                    .dispatch("context:budget:exceeded", &ctx, &trigger_args)
                    .await
            } else {
                false
            };

            if event_handled {
                info!(
                    agent = %self.config.name,
                    "context:budget:exceeded handled by event — skipping inline compaction"
                );
                tracker.compactions += 1;
                *has_attempted_reactive_compact = false;
                transition = Some(LoopTransition::ContextCompacted);

                if let Some(ref sf) = self.config.session_file {
                    Self::save_session(messages, tracker, iterations, active_model, sf).await;
                }
            }
        }

        (transition, estimated_tokens)
    }

    // -----------------------------------------------------------------------
    // Step context
    // -----------------------------------------------------------------------

    /// Build step context from snapshotted idea content.
    ///
    /// Content is read from the `StepIdeaSpec.content` field, which is
    /// populated at session start. This prevents mid-flight context drift
    /// when files are edited during a running session.
    async fn build_step_context(&self) -> String {
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

    // -----------------------------------------------------------------------
    // Streaming provider call with early tool execution
    // -----------------------------------------------------------------------

    /// Call the provider using streaming and start tool execution during the stream.
    ///
    /// Tools begin executing as their input JSON completes (on `ToolUseComplete`
    /// stream events), overlapping tool latency with LLM generation latency.
    /// Each tool runs through `before_tool` before starting. If a hook halts,
    /// remaining tools are discarded and the halt is propagated.
    ///
    /// Includes retry logic for transient errors (exponential backoff).
    async fn call_streaming_with_tools(
        &self,
        request: &ChatRequest,
    ) -> anyhow::Result<(ChatResponse, StreamingToolOutcome)> {
        let mut last_error = None;

        for attempt in 0..=self.config.max_retries {
            match self.try_streaming_with_tools(request).await {
                Ok(result) => return Ok(result),
                Err(e) => {
                    let err_str = e.to_string();
                    if Self::is_context_length_error(&err_str) {
                        return Err(e);
                    }
                    if !Self::is_retryable_error(&err_str) {
                        return Err(e);
                    }
                    if attempt < self.config.max_retries {
                        let delay = self.config.retry_base_delay_ms * 2u64.pow(attempt);
                        warn!(
                            agent = %self.config.name,
                            attempt = attempt + 1,
                            max = self.config.max_retries,
                            delay_ms = delay,
                            error = %err_str,
                            "streaming: retrying after transient error"
                        );
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                    }
                    last_error = Some(e);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| anyhow::anyhow!("all retries exhausted")))
    }

    /// Single streaming attempt — spawns the provider stream, processes events,
    /// and starts tool execution concurrently during the stream.
    async fn try_streaming_with_tools(
        &self,
        request: &ChatRequest,
    ) -> anyhow::Result<(ChatResponse, StreamingToolOutcome)> {
        use crate::streaming_executor::StreamingToolExecutor;
        use crate::traits::StreamEvent;

        let (tx, mut rx) = mpsc::channel::<StreamEvent>(64);
        let provider = self.provider.clone();
        let req = request.clone();

        // Spawn the streaming call — events flow through the channel while we
        // process them and start tools concurrently.
        let stream_handle = tokio::spawn(async move { provider.chat_stream(&req, tx).await });

        let mut executor = StreamingToolExecutor::new(self.tools.clone());
        let mut response: Option<ChatResponse> = None;
        let mut halt_reason: Option<(String, Vec<ContentPart>)> = None;
        let mut tools_started = 0u32;

        while let Some(event) = rx.recv().await {
            match event {
                StreamEvent::TextDelta(text) => {
                    self.emit(crate::chat_stream::ChatStreamEvent::TextDelta { text });
                }
                StreamEvent::ToolUseStart { ref id, ref name } => {
                    self.emit(crate::chat_stream::ChatStreamEvent::ToolStart {
                        tool_use_id: id.clone(),
                        tool_name: name.clone(),
                    });
                }
                StreamEvent::ToolUseComplete {
                    id,
                    name,
                    arguments,
                } => {
                    if halt_reason.is_none() {
                        match self.observer.before_tool(&name, &arguments).await {
                            LoopAction::Halt(reason) => {
                                let parts = vec![ContentPart::ToolResult {
                                    tool_use_id: id,
                                    content: format!("Blocked by middleware: {reason}"),
                                    is_error: true,
                                }];
                                executor.discard();
                                halt_reason = Some((reason, parts));
                            }
                            LoopAction::Inject(_) | LoopAction::Continue => {
                                // Emit DelegateStart for agents(action=delegate) calls so
                                // the frontend can track subagent activity.
                                if name == "agents" {
                                    let worker = arguments
                                        .get("to")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("subagent")
                                        .to_string();
                                    let subject = arguments
                                        .get("prompt")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.chars().take(120).collect::<String>())
                                        .unwrap_or_else(|| "delegated task".to_string());
                                    self.emit(crate::chat_stream::ChatStreamEvent::DelegateStart {
                                        worker_name: worker,
                                        task_subject: subject,
                                    });
                                }
                                executor.add_tool(id, name, arguments).await;
                                tools_started += 1;
                            }
                        }
                    }
                }
                StreamEvent::ToolUseInput(_) | StreamEvent::Usage(_) => {}
                StreamEvent::MessageComplete(resp) => {
                    response = Some(resp);
                }
            }
        }

        // Wait for the streaming task to complete.
        match stream_handle.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                executor.discard();
                return Err(e);
            }
            Err(join_err) => {
                executor.discard();
                return Err(anyhow::anyhow!("streaming task panicked: {join_err}"));
            }
        }

        let response = response
            .ok_or_else(|| anyhow::anyhow!("streaming: no MessageComplete event received"))?;

        if let Some((reason, parts)) = halt_reason {
            return Ok((
                response,
                StreamingToolOutcome::Halted {
                    reason,
                    tool_result_parts: parts,
                },
            ));
        }

        if tools_started == 0 {
            return Ok((response, StreamingToolOutcome::NoTools));
        }

        // Await all tool executions that started during streaming.
        let completed = executor.finish_all().await;
        let all_results = completed
            .into_iter()
            .map(|c| {
                let result: Result<ToolResult, anyhow::Error> = Ok(if c.result.is_error {
                    ToolResult::error(c.result.output)
                } else {
                    ToolResult::success(c.result.output)
                });
                (c.id, c.name, c.input, result, c.duration_ms)
            })
            .collect();

        Ok((response, StreamingToolOutcome::Executed(all_results)))
    }

    // -----------------------------------------------------------------------
    // Tool result persistence
    // -----------------------------------------------------------------------

    /// Resolve or create the persist directory. Returns a reference to avoid cloning PathBuf.
    fn resolve_persist_dir<'a>(&self, created: &'a mut Option<PathBuf>) -> Option<&'a Path> {
        if created.is_some() {
            return created.as_deref();
        }
        let dir = self.config.persist_dir.clone().unwrap_or_else(|| {
            std::env::temp_dir().join("aeqi-tool-results").join(format!(
                "{}-{}",
                self.config.name,
                std::process::id()
            ))
        });
        if std::fs::create_dir_all(&dir).is_ok() {
            *created = Some(dir);
            created.as_deref()
        } else {
            None
        }
    }

    /// Persist a tool result to disk and return a reference message with preview.
    async fn persist_tool_result(
        dir: &Path,
        tool_use_id: &str,
        content: &str,
    ) -> anyhow::Result<String> {
        let path = dir.join(format!("{tool_use_id}.txt"));

        tokio::fs::write(&path, content).await?;

        let preview = Self::generate_preview(content, PERSIST_PREVIEW_SIZE);

        Ok(format!(
            "<persisted-output>\n\
             Output too large ({} chars). Full output saved to: {}\n\
             Use the file read tool to access it if needed.\n\n\
             Preview (first ~{PERSIST_PREVIEW_SIZE} chars):\n\
             {preview}\n\
             </persisted-output>",
            content.len(),
            path.display(),
        ))
    }

    /// Generate a preview of content, cutting at a newline boundary when possible.
    fn generate_preview(content: &str, max_bytes: usize) -> String {
        if content.len() <= max_bytes {
            return content.to_string();
        }

        let truncated = &content[..max_bytes.min(content.len())];
        let last_newline = truncated.rfind('\n');

        // Cut at a newline if one exists in the back half.
        let cut_point = match last_newline {
            Some(pos) if pos > max_bytes / 2 => pos,
            _ => max_bytes,
        };

        // Find safe UTF-8 boundary.
        let safe_end = content
            .char_indices()
            .take_while(|(i, _)| *i < cut_point)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(0);

        format!("{}...", &content[..safe_end])
    }

    // -----------------------------------------------------------------------
    // Tool result truncation
    // -----------------------------------------------------------------------

    /// Truncate a tool result with head (40%) + tail (40%) preview.
    fn truncate_result(output: &str, max_chars: usize) -> String {
        if output.len() <= max_chars {
            return output.to_string();
        }

        let head_size = max_chars * 2 / 5;
        let tail_size = max_chars * 2 / 5;
        let omitted = output.len() - head_size - tail_size;

        let head_end = output
            .char_indices()
            .take_while(|(i, _)| *i < head_size)
            .last()
            .map(|(i, c)| i + c.len_utf8())
            .unwrap_or(0);

        let tail_start = output
            .char_indices()
            .rev()
            .take_while(|(i, _)| output.len() - *i <= tail_size)
            .last()
            .map(|(i, _)| i)
            .unwrap_or(output.len());

        format!(
            "{}\n\n[... {} characters truncated ...]\n\n{}",
            &output[..head_end],
            omitted,
            &output[tail_start..]
        )
    }

    /// Enforce aggregate character budget across all tool results in a step.
    /// Returns per-result truncation records (id, name, original_bytes,
    /// new_bytes) for every result this function truncated — the caller emits
    /// a ToolSummarized event per record so the user sees aggregate-budget
    /// truncations in the transcript.
    fn enforce_result_budget(
        results: &mut [ProcessedToolResult],
        max_chars: usize,
    ) -> Vec<(String, String, u64, u64)> {
        let total: usize = results.iter().map(|r| r.output.len()).sum();
        if total <= max_chars {
            return Vec::new();
        }

        let mut indices: Vec<usize> = (0..results.len()).collect();
        indices.sort_by(|a, b| results[*b].output.len().cmp(&results[*a].output.len()));

        let mut truncated = Vec::new();
        let mut current_total = total;
        for idx in indices {
            if current_total <= max_chars {
                break;
            }
            if results[idx].is_error {
                continue;
            }
            let old_len = results[idx].output.len();
            let overage = current_total - max_chars;
            let target_len = old_len.saturating_sub(overage).max(500);
            if target_len < old_len {
                results[idx].output = Self::truncate_result(&results[idx].output, target_len);
                let new_len = results[idx].output.len();
                current_total -= old_len - new_len;
                truncated.push((
                    results[idx].id.clone(),
                    results[idx].name.clone(),
                    old_len as u64,
                    new_len as u64,
                ));
            }
        }
        truncated
    }

    // -----------------------------------------------------------------------
    // Mid-step context enrichment
    // -----------------------------------------------------------------------

    /// Apply token budgets to enrichment attachments and inject as system messages.
    ///
    /// Attachments arrive sorted by priority (lower = higher priority).
    /// Each attachment has its own max_tokens budget. We also enforce a global
    /// enrichment budget (5% of context_window) to prevent enrichments from
    /// consuming too much of the model's capacity.
    fn inject_enrichments(
        messages: &mut Vec<Message>,
        attachments: Vec<ContextAttachment>,
        config: &AgentConfig,
    ) -> Vec<(String, u32)> {
        let global_budget = (config.context_window as usize) / 20; // 5% of window
        let mut total_tokens = 0usize;
        let mut injected: Vec<(String, u32)> = Vec::new();

        for att in &attachments {
            let att_tokens = att.content.len() / CHARS_PER_TOKEN;
            let capped = att_tokens.min(att.max_tokens as usize);

            if total_tokens + capped > global_budget {
                debug!(
                    source = %att.source,
                    "enrichment dropped — global budget exhausted"
                );
                continue;
            }

            let content = if att_tokens > att.max_tokens as usize {
                // Truncate to budget
                let max_chars = att.max_tokens as usize * CHARS_PER_TOKEN;
                format!(
                    "# {} (enrichment)\n{}",
                    att.source,
                    &att.content[..att.content.len().min(max_chars)]
                )
            } else {
                format!("# {} (enrichment)\n{}", att.source, att.content)
            };

            messages.push(Message {
                role: Role::System,
                content: MessageContent::text(content),
            });
            total_tokens += capped;
            injected.push((att.source.clone(), capped as u32));
        }

        if total_tokens > 0 {
            debug!(
                injected = attachments.len(),
                total_tokens, "mid-step enrichments injected"
            );
        }

        injected
    }

    // -----------------------------------------------------------------------
    // Tool batch summary
    // -----------------------------------------------------------------------

    /// Build a compact summary line for a batch of tool results.
    /// Groups by tool name, counts calls, and sums output sizes.
    /// Example: `[Tool batch: read_file(3 calls, 12KB), grep(2 calls, 8KB)]`
    fn build_tool_batch_summary(results: &[ProcessedToolResult]) -> String {
        use std::collections::BTreeMap;
        let mut groups: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        for r in results {
            let entry = groups.entry(r.name.as_str()).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += r.output.len();
        }
        let parts: Vec<String> = groups
            .iter()
            .map(|(name, (count, bytes))| {
                let kb = (*bytes + 512) / 1024; // round to nearest KB
                if kb > 0 {
                    format!("{name}({count} calls, {kb}KB)")
                } else {
                    format!("{name}({count} calls, {bytes}B)")
                }
            })
            .collect();
        format!("[Tool batch: {}]", parts.join(", "))
    }

    // -----------------------------------------------------------------------
    // File tracking for post-compact restoration
    // -----------------------------------------------------------------------

    fn is_file_read_tool(name: &str) -> bool {
        matches!(
            name.to_lowercase().as_str(),
            "read" | "file_read" | "cat" | "readfile"
        )
    }

    fn extract_file_path_from_result(output: &str) -> Option<String> {
        // Common pattern: first line is the file path or "Contents of /path/to/file:"
        let first_line = output.lines().next()?;
        if first_line.contains('/') {
            // Strip common prefixes like "Contents of " or line number prefixes
            let cleaned = first_line
                .trim_start_matches("Contents of ")
                .trim_end_matches(':')
                .trim();
            if cleaned.starts_with('/') || cleaned.starts_with("./") {
                return Some(cleaned.to_string());
            }
        }
        None
    }

    /// Detect files that changed externally since we last read them.
    /// Returns system messages with change notifications for injection between steps.
    async fn detect_file_changes(recent_files: &[RecentFile]) -> Vec<(String, Message)> {
        let mut changes = Vec::new();

        for file in recent_files {
            if file.mtime_secs == 0 {
                continue; // No mtime recorded — skip.
            }

            let current_mtime = match tokio::fs::metadata(&file.path).await {
                Ok(meta) => meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0),
                Err(_) => continue, // File deleted or inaccessible — skip silently.
            };

            if current_mtime > file.mtime_secs {
                // File was modified externally.
                let notice = format!(
                    "<system-reminder>\nFile modified externally: {}\n\
                     The file has changed since you last read it. \
                     Re-read it before making edits to avoid overwriting external changes.\n\
                     </system-reminder>",
                    file.path
                );
                changes.push((
                    file.path.clone(),
                    Message {
                        role: Role::User,
                        content: MessageContent::text(notice),
                    },
                ));
            }
        }

        changes
    }

    // -----------------------------------------------------------------------
    // Conversation repair
    // -----------------------------------------------------------------------

    /// Ensure every tool_use has a matching tool_result and vice versa.
    /// Prevents API 400 errors after compaction drops messages.
    fn repair_tool_pairing(messages: &mut Vec<Message>) {
        // Collect all tool_use IDs from assistant messages.
        let mut tool_use_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        // Collect all tool_result IDs from tool messages.
        let mut tool_result_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        for msg in messages.iter() {
            if let MessageContent::Parts(parts) = &msg.content {
                for part in parts {
                    match part {
                        ContentPart::ToolUse { id, .. } => {
                            tool_use_ids.insert(id.clone());
                        }
                        ContentPart::ToolResult { tool_use_id, .. } => {
                            tool_result_ids.insert(tool_use_id.clone());
                        }
                        _ => {}
                    }
                }
            }
        }

        // Find dangling tool_uses (no matching result).
        let dangling: Vec<String> = tool_use_ids.difference(&tool_result_ids).cloned().collect();

        // Find orphan tool_results (no matching use).
        let orphans: Vec<String> = tool_result_ids.difference(&tool_use_ids).cloned().collect();

        if dangling.is_empty() && orphans.is_empty() {
            return;
        }

        // Add synthetic results for dangling tool_uses.
        if !dangling.is_empty() {
            debug!(
                count = dangling.len(),
                "injecting synthetic tool_results for dangling tool_uses"
            );
            let synthetic_parts: Vec<ContentPart> = dangling
                .iter()
                .map(|id| ContentPart::ToolResult {
                    tool_use_id: id.clone(),
                    content: SYNTHETIC_TOOL_RESULT.to_string(),
                    is_error: true,
                })
                .collect();

            // Find the last assistant message and insert results after it.
            if let Some(pos) = messages.iter().rposition(|m| m.role == Role::Assistant) {
                let insert_at = pos + 1;
                messages.insert(
                    insert_at.min(messages.len()),
                    Message {
                        role: Role::Tool,
                        content: MessageContent::Parts(synthetic_parts),
                    },
                );
            }
        }

        // Strip orphan tool_results.
        if !orphans.is_empty() {
            debug!(count = orphans.len(), "stripping orphan tool_results");
            let orphan_set: std::collections::HashSet<&str> =
                orphans.iter().map(|s| s.as_str()).collect();

            for msg in messages.iter_mut() {
                if msg.role != Role::Tool {
                    continue;
                }
                if let MessageContent::Parts(ref mut parts) = msg.content {
                    parts.retain(|p| {
                        if let ContentPart::ToolResult { tool_use_id, .. } = p {
                            !orphan_set.contains(tool_use_id.as_str())
                        } else {
                            true
                        }
                    });
                }
            }

            // Remove empty tool messages.
            messages.retain(|m| {
                if m.role == Role::Tool
                    && let MessageContent::Parts(parts) = &m.content
                {
                    return !parts.is_empty();
                }
                true
            });
        }
    }

    // -----------------------------------------------------------------------
    // Multi-stage context compaction
    // -----------------------------------------------------------------------

    fn estimate_tokens_from_messages(messages: &[Message]) -> u32 {
        let mut total_tokens: usize = 0;

        for msg in messages {
            match &msg.content {
                MessageContent::Text(t) => {
                    total_tokens += t.len() / CHARS_PER_TOKEN;
                }
                MessageContent::Parts(parts) => {
                    for part in parts {
                        match part {
                            ContentPart::Text { text } => {
                                total_tokens += text.len() / CHARS_PER_TOKEN;
                            }
                            ContentPart::ToolUse { input, name, .. } => {
                                // ToolUse inputs are JSON — structured content.
                                let chars = name.len() + input.to_string().len();
                                total_tokens += chars / CHARS_PER_TOKEN_STRUCTURED;
                            }
                            ContentPart::ToolResult { content, .. } => {
                                // Tool results are often JSON, code, or structured output.
                                total_tokens += content.len() / CHARS_PER_TOKEN_STRUCTURED;
                            }
                        }
                    }
                }
            }
        }

        total_tokens as u32
    }

    /// Snip compaction: remove entire old API rounds (assistant + tool messages)
    /// from the compactable window. No API call — purely token estimation.
    /// Returns estimated tokens freed.
    fn snip_compact(
        messages: &mut Vec<Message>,
        preserve_head: usize,
        preserve_tail: usize,
    ) -> u32 {
        if messages.len() <= preserve_head + preserve_tail {
            return 0;
        }
        let window_start = preserve_head;
        let window_end = messages.len().saturating_sub(preserve_tail);
        if window_start >= window_end {
            return 0;
        }

        // Find "API rounds" — sequences of (Assistant, Tool) messages.
        // Remove the oldest rounds first (from window_start forward).
        let mut remove_count = 0;
        let mut tokens_freed: u32 = 0;
        let mut i = window_start;

        // Remove at most half the window to avoid over-snipping.
        let max_remove = (window_end - window_start) / 2;

        while i < window_end && remove_count < max_remove {
            // A round starts with an Assistant message.
            if messages[i].role != Role::Assistant {
                i += 1;
                continue;
            }

            // Count the round: Assistant + following Tool messages.
            let round_start = i;
            let mut round_end = i + 1;
            while round_end < window_end && messages[round_end].role == Role::Tool {
                round_end += 1;
            }

            // Estimate tokens in this round.
            let round_tokens =
                Self::estimate_tokens_from_messages(&messages[round_start..round_end]);
            tokens_freed += round_tokens;
            remove_count += round_end - round_start;
            let _next = round_end; // consumed by break

            // Stop after removing one full round — snip is conservative.
            break;
        }

        if remove_count > 0 {
            // Remove the snipped messages.
            messages.drain(window_start..window_start + remove_count);
        }

        tokens_freed
    }

    /// Microcompact: clear old tool results by tool name, keeping the N most recent.
    /// More targeted than the old digest — only clears results from compactable tools
    /// (read, shell, grep, glob, web_search, web_fetch, edit, write).
    fn microcompact(messages: &mut [Message], preserve_tail: usize, keep_recent: usize) -> usize {
        if messages.len() <= preserve_tail {
            return 0;
        }
        let cutoff = messages.len() - preserve_tail;

        // Collect all compactable tool_use IDs and their associated tool_result IDs.
        // We need to match tool_use names to tool_result IDs.
        let mut compactable_ids: Vec<String> = Vec::new();

        // Pass 1: find tool_use blocks with compactable tool names.
        for msg in messages[..cutoff].iter() {
            if let MessageContent::Parts(parts) = &msg.content {
                for part in parts {
                    if let ContentPart::ToolUse { id, name, .. } = part {
                        let lower = name.to_lowercase();
                        if COMPACTABLE_TOOLS.iter().any(|t| lower.contains(t)) {
                            compactable_ids.push(id.clone());
                        }
                    }
                }
            }
        }

        if compactable_ids.len() <= keep_recent {
            return 0; // Nothing to clear.
        }

        // Keep the most recent N, clear the rest.
        let clear_set: std::collections::HashSet<&str> = compactable_ids
            [..compactable_ids.len() - keep_recent]
            .iter()
            .map(|s| s.as_str())
            .collect();

        if clear_set.is_empty() {
            return 0;
        }

        // Pass 2: clear tool_result content for the IDs to clear.
        let mut cleared = 0usize;
        for msg in messages[..cutoff].iter_mut() {
            if msg.role != Role::Tool {
                continue;
            }
            if let MessageContent::Parts(ref mut parts) = msg.content {
                for part in parts.iter_mut() {
                    if let ContentPart::ToolResult {
                        tool_use_id,
                        content,
                        ..
                    } = part
                        && clear_set.contains(tool_use_id.as_str())
                        && *content != MICROCOMPACT_CLEARED
                    {
                        *content = MICROCOMPACT_CLEARED.to_string();
                        cleared += 1;
                    }
                }
            }
        }

        if cleared > 0 {
            debug!(
                cleared,
                total = compactable_ids.len(),
                kept = keep_recent,
                "microcompact: cleared old tool results"
            );
        }
        cleared
    }

    /// Context collapse: cheap, deterministic drain of low-value content from the
    /// compactable window. Removes stale system messages and truncates long tool
    /// results to head+tail previews. No LLM call — purely structural.
    /// Returns estimated tokens freed.
    fn context_collapse(
        messages: &mut Vec<Message>,
        preserve_head: usize,
        preserve_tail: usize,
    ) -> u32 {
        let len = messages.len();
        if len <= preserve_head + preserve_tail {
            return 0;
        }

        let start = preserve_head;
        let mut freed: u32 = 0;

        // Pass 1: Remove stale system messages in the middle.
        // These are step-context injections, post-compact summaries, file restoration
        // messages from previous compactions — all stale by now.
        let mut i = start;
        loop {
            let end = messages.len().saturating_sub(preserve_tail);
            if i >= end {
                break;
            }
            if messages[i].role == Role::System {
                let chars = match &messages[i].content {
                    MessageContent::Text(t) => t.len(),
                    MessageContent::Parts(parts) => parts
                        .iter()
                        .map(|p| match p {
                            ContentPart::Text { text } => text.len(),
                            ContentPart::ToolUse { input, name, .. } => {
                                name.len() + input.to_string().len()
                            }
                            ContentPart::ToolResult { content, .. } => content.len(),
                        })
                        .sum(),
                };
                freed += (chars / CHARS_PER_TOKEN) as u32;
                messages.remove(i);
                // Don't increment i — next element shifted into current position.
            } else {
                i += 1;
            }
        }

        // Pass 2: Truncate long tool results (>2K chars) to head+tail preview.
        let end = messages.len().saturating_sub(preserve_tail);
        for msg in messages[start..end].iter_mut() {
            if msg.role != Role::Tool {
                continue;
            }
            if let MessageContent::Parts(ref mut parts) = msg.content {
                for part in parts.iter_mut() {
                    if let ContentPart::ToolResult { content, .. } = part
                        && content.len() > 2000
                    {
                        let original_len = content.len();
                        let head: String = content.chars().take(500).collect();
                        let tail: String = content
                            .chars()
                            .rev()
                            .take(500)
                            .collect::<Vec<_>>()
                            .into_iter()
                            .rev()
                            .collect();
                        *content = format!(
                            "{head}\n\n[... {} chars collapsed ...]\n\n{tail}",
                            original_len - 1000
                        );
                        let saved = original_len.saturating_sub(content.len());
                        freed += (saved / CHARS_PER_TOKEN) as u32;
                    }
                }
            }
            // Also handle plain Text tool messages.
            if let MessageContent::Text(ref mut text) = msg.content
                && text.len() > 2000
            {
                let original_len = text.len();
                let head: String = text.chars().take(500).collect();
                let tail: String = text
                    .chars()
                    .rev()
                    .take(500)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                *text = format!(
                    "{head}\n\n[... {} chars collapsed ...]\n\n{tail}",
                    original_len - 1000
                );
                let saved = original_len.saturating_sub(text.len());
                freed += (saved / CHARS_PER_TOKEN) as u32;
            }
        }

        freed
    }

    fn build_compaction_transcript(messages: &[Message]) -> String {
        // Larger budget — the structured summarizer needs detail to produce
        // a good 9-section summary. 16K chars ≈ 4K tokens of input.
        const MAX_TRANSCRIPT: usize = 16_000;
        const MAX_TEXT_BLOCK: usize = 500;
        const MAX_TOOL_RESULT: usize = 300;

        let mut transcript = String::with_capacity(MAX_TRANSCRIPT);

        for msg in messages {
            if transcript.len() >= MAX_TRANSCRIPT {
                break;
            }

            let role = match msg.role {
                Role::User => "User",
                Role::Assistant => "Assistant",
                Role::System => "System",
                Role::Tool => "Tool",
            };

            let text = match &msg.content {
                MessageContent::Text(t) => {
                    if t.len() > MAX_TEXT_BLOCK {
                        format!("{}...", &t[..MAX_TEXT_BLOCK])
                    } else {
                        t.clone()
                    }
                }
                MessageContent::Parts(parts) => parts
                    .iter()
                    .map(|p| match p {
                        ContentPart::Text { text } => {
                            if text.len() > MAX_TEXT_BLOCK {
                                format!("{}...", &text[..MAX_TEXT_BLOCK])
                            } else {
                                text.clone()
                            }
                        }
                        ContentPart::ToolUse { name, input, .. } => {
                            // Include tool name + key input fields for context.
                            let input_preview = if let Some(obj) = input.as_object() {
                                obj.iter()
                                    .take(3)
                                    .map(|(k, v)| {
                                        let vs = v.to_string();
                                        if vs.len() > 80 {
                                            format!("{k}={:.80}...", vs)
                                        } else {
                                            format!("{k}={vs}")
                                        }
                                    })
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            } else {
                                String::new()
                            };
                            format!("[tool:{name}({input_preview})]")
                        }
                        ContentPart::ToolResult {
                            content, is_error, ..
                        } => {
                            let prefix = if *is_error { "ERROR: " } else { "" };
                            if content.len() > MAX_TOOL_RESULT {
                                format!("{prefix}{}...", &content[..MAX_TOOL_RESULT])
                            } else {
                                format!("{prefix}{content}")
                            }
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" | "),
            };

            if !text.is_empty() {
                let entry = format!("{role}: {text}\n");
                if transcript.len() + entry.len() > MAX_TRANSCRIPT {
                    break;
                }
                transcript.push_str(&entry);
            }
        }

        transcript
    }

    // -----------------------------------------------------------------------
    // Error classification
    // -----------------------------------------------------------------------

    fn is_retryable_error(error: &str) -> bool {
        let lower = error.to_lowercase();
        lower.contains("rate")
            || lower.contains("429")
            || lower.contains("overloaded")
            || lower.contains("503")
            || lower.contains("529")
            || lower.contains("timeout")
            || lower.contains("timed out")
            || lower.contains("connection")
            || lower.contains("server error")
            || lower.contains("500 ")
            || lower.contains("502")
    }

    fn is_context_length_error(error: &str) -> bool {
        let lower = error.to_lowercase();
        lower.contains("context length")
            || lower.contains("token limit")
            || lower.contains("prompt is too long")
            || lower.contains("maximum context")
            || (lower.contains("too long") && lower.contains("token"))
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// Format tool input args into a human-readable preview string.
    /// E.g., shell: "ls -la /home/..." → "ls -la /home/..."
    ///       read_file: {"file_path": "/foo/bar.rs"} → "/foo/bar.rs"
    fn format_tool_input(tool_name: &str, args: &serde_json::Value) -> String {
        let obj = args.as_object();
        match tool_name {
            "shell" | "bash" => obj
                .and_then(|o| o.get("command").or(o.get("cmd")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .chars()
                .take(200)
                .collect(),
            "read" | "read_file" | "readfile" | "cat" => obj
                .and_then(|o| o.get("file_path").or(o.get("path")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            "write" | "write_file" | "filewrite" => obj
                .and_then(|o| o.get("file_path").or(o.get("path")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            "edit" | "edit_file" | "fileedit" => obj
                .and_then(|o| o.get("file_path").or(o.get("path")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            "grep" => {
                let pattern = obj
                    .and_then(|o| o.get("pattern"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let path = obj
                    .and_then(|o| o.get("path"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(".");
                format!("{pattern} in {path}")
            }
            "glob" => obj
                .and_then(|o| o.get("pattern"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            "web_search" | "websearch" => obj
                .and_then(|o| o.get("query").or(o.get("q")))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            "web_fetch" | "webfetch" => obj
                .and_then(|o| o.get("url"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            _ => {
                // Generic: show first string value, truncated
                obj.and_then(|o| {
                    o.values()
                        .find_map(|v| v.as_str().map(|s| s.chars().take(150).collect()))
                })
                .unwrap_or_default()
            }
        }
    }

    // -----------------------------------------------------------------------
    // Session persistence
    // -----------------------------------------------------------------------

    /// Save a session checkpoint to the configured session file.
    async fn save_session(
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
            Err(_) => None, // File doesn't exist — normal case.
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truncate_result_below_limit() {
        let output = "short output";
        let result = Agent::truncate_result(output, 100);
        assert_eq!(result, output);
    }

    #[test]
    fn test_truncate_result_above_limit() {
        let output = "a".repeat(10_000);
        let result = Agent::truncate_result(&output, 1000);
        assert!(result.len() < output.len());
        assert!(result.contains("characters truncated"));
        assert!(result.starts_with("aaaa"));
        assert!(result.ends_with("aaaa"));
    }

    #[test]
    fn test_truncate_result_utf8_safe() {
        let output = "🦀".repeat(5000);
        let result = Agent::truncate_result(&output, 1000);
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
        Agent::enforce_result_budget(&mut results, 1000);
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
        Agent::enforce_result_budget(&mut results, 5000);
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
        Agent::enforce_result_budget(&mut results, 100);
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
        let tokens = Agent::estimate_tokens_from_messages(&messages);
        assert_eq!(tokens, 200);
    }

    #[test]
    fn test_estimate_tokens_structured_content() {
        // Tool results use CHARS_PER_TOKEN_STRUCTURED (3), not 4.
        // 300 chars of tool output → 100 tokens (not 75).
        let messages = vec![Message {
            role: Role::Assistant,
            content: MessageContent::Parts(vec![ContentPart::ToolResult {
                tool_use_id: "x".into(),
                content: "a".repeat(300),
                is_error: false,
            }]),
        }];
        let tokens = Agent::estimate_tokens_from_messages(&messages);
        assert_eq!(tokens, 100); // 300 / 3, not 300 / 4
    }

    #[test]
    fn test_is_retryable_error() {
        assert!(Agent::is_retryable_error("rate limit exceeded"));
        assert!(Agent::is_retryable_error("HTTP 429 Too Many Requests"));
        assert!(Agent::is_retryable_error("server is overloaded"));
        assert!(Agent::is_retryable_error("connection reset"));
        assert!(Agent::is_retryable_error("request timed out"));
        assert!(!Agent::is_retryable_error("invalid API key"));
        assert!(!Agent::is_retryable_error("malformed request body"));
    }

    #[test]
    fn test_is_context_length_error() {
        assert!(Agent::is_context_length_error(
            "request exceeds maximum context length"
        ));
        assert!(Agent::is_context_length_error("token limit reached"));
        assert!(Agent::is_context_length_error("prompt is too long"));
        assert!(!Agent::is_context_length_error("network timeout"));
        assert!(!Agent::is_context_length_error("rate limited"));
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
        let content = "hello world";
        let preview = Agent::generate_preview(content, 100);
        assert_eq!(preview, "hello world");
    }

    #[test]
    fn test_generate_preview_cuts_at_newline() {
        let content = "line1\nline2\nline3\nline4\nline5";
        let preview = Agent::generate_preview(content, 20);
        // Should cut at a newline boundary, not mid-line.
        assert!(preview.ends_with("..."));
        assert!(!preview.contains("line5"));
    }

    #[test]
    fn test_microcompact() {
        let mut messages = vec![
            Message {
                role: Role::System,
                content: MessageContent::text("system"),
            },
            // Old assistant + tool round with compactable tool.
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
            // Recent assistant + tool round with compactable tool.
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

        // keep_recent=1 means only the most recent compactable tool is kept.
        Agent::microcompact(&mut messages, 0, 1);

        // First tool result (t1) should be cleared.
        if let MessageContent::Parts(parts) = &messages[2].content
            && let ContentPart::ToolResult { content, .. } = &parts[0]
        {
            assert_eq!(content, "[Old tool result content cleared]");
        }

        // Second tool result (t2, most recent) should be preserved.
        if let MessageContent::Parts(parts) = &messages[4].content
            && let ContentPart::ToolResult { content, .. } = &parts[0]
        {
            assert_eq!(content.len(), 1000, "recent result should be preserved");
        }
    }

    #[test]
    fn test_snip_compact() {
        let mut messages = vec![
            Message {
                role: Role::System,
                content: MessageContent::text("system prompt"),
            },
            Message {
                role: Role::User,
                content: MessageContent::text("user request"),
            },
            // Old round to snip.
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
            // Recent round to preserve.
            Message {
                role: Role::Assistant,
                content: MessageContent::text("recent work"),
            },
        ];

        let freed = Agent::snip_compact(&mut messages, 2, 1);
        assert!(freed > 0, "should have freed tokens");
        // Head (2) + tail (1) preserved, middle snipped.
        assert_eq!(
            messages.len(),
            3,
            "should have 3 messages after snip (was 5)"
        );
        // Head preserved.
        assert_eq!(messages[0].role, Role::System);
        assert_eq!(messages[1].role, Role::User);
        // Tail preserved.
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
