//! Context compaction helpers: token estimation, snip/microcompact/context-collapse,
//! the 4-stage compaction pipeline, conversation repair, and error classification.

use tracing::{debug, info};

use crate::traits::{ContentPart, Message, MessageContent, Role};

use super::Agent;
use super::LoopTransition;
use super::step_context::ContextTracker;

// ---------------------------------------------------------------------------
// Per-stage compaction telemetry
// ---------------------------------------------------------------------------

/// Per-stage outcome of one run through [`Agent::run_compaction_pipeline`].
///
/// Each stage's slot is `None` when the stage did not fire (didn't run, or
/// ran but freed nothing) and `Some(stats)` when it did real work. Replaces
/// the prior `(Option<LoopTransition>, u32)` tuple-return so per-stage detail
/// is preserved instead of collapsing to "did anything fire?". Tunable
/// thresholds become observable thresholds.
///
/// The loop reads [`CompactionReport::dominant_transition`] to keep the
/// historical "last-stage-wins" semantics for the `transition` variable
/// (event_delegation > collapse > snip — microcompact has no
/// `LoopTransition` variant, matching the prior behaviour where it fired
/// silently).
#[derive(Debug, Clone, Default)]
pub struct CompactionReport {
    pub snip: Option<SnipStats>,
    pub microcompact: Option<MicrocompactStats>,
    pub collapse: Option<CollapseStats>,
    pub event_delegation: Option<EventDelegationStats>,
}

#[derive(Debug, Clone, Copy)]
pub struct SnipStats {
    pub tokens_freed: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct MicrocompactStats {
    pub tools_cleared: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct CollapseStats {
    pub tokens_freed: u32,
}

#[derive(Debug, Clone, Copy)]
pub struct EventDelegationStats {
    pub handled: bool,
}

impl CompactionReport {
    /// True if any stage fired meaningful work this pass.
    pub fn any_stage_fired(&self) -> bool {
        self.snip.is_some()
            || self.microcompact.is_some()
            || self.collapse.is_some()
            || self.event_delegation.is_some()
    }

    /// The single [`LoopTransition`] the outer loop should observe, matching
    /// the previous "later stage wins" priority: `event_delegation` beats
    /// `collapse` beats `snip`. Microcompact has no associated
    /// `LoopTransition` variant (it emits only a
    /// `ChatStreamEvent::MicroCompacted` side effect), so a microcompact-only
    /// pass returns `None` here, matching the prior code.
    pub fn dominant_transition(&self) -> Option<LoopTransition> {
        if let Some(ed) = self.event_delegation
            && ed.handled
        {
            return Some(LoopTransition::ContextCompacted);
        }
        if let Some(c) = self.collapse {
            return Some(LoopTransition::ContextCollapsed {
                tokens_freed: c.tokens_freed,
            });
        }
        if let Some(s) = self.snip {
            return Some(LoopTransition::SnipCompacted {
                tokens_freed: s.tokens_freed,
            });
        }
        None
    }
}

// ---------------------------------------------------------------------------
// Constants consumed by compaction
// ---------------------------------------------------------------------------

/// Default characters-per-token estimate for plain text.
pub(crate) const CHARS_PER_TOKEN: usize = 4;

/// Characters-per-token for structured content (JSON tool results, code).
pub(crate) const CHARS_PER_TOKEN_STRUCTURED: usize = 3;

/// Maximum compaction attempts per agent run to prevent infinite loops.
pub(crate) const MAX_COMPACTIONS_PER_RUN: u32 = 3;

/// Microcompact: keep the N most recent compactable tool results.
pub(crate) const MICROCOMPACT_KEEP_RECENT: usize = 5;

/// Tool names whose results can be cleared by microcompact.
pub(crate) const COMPACTABLE_TOOLS: &[&str] = &[
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
pub(crate) const MICROCOMPACT_CLEARED: &str = "[Old tool result content cleared]";

/// Maximum number of recent files to track for file-change detection.
pub(crate) const POST_COMPACT_MAX_FILES: usize = 5;

/// Snip compaction: early threshold factor. Fires at threshold * SNIP_FACTOR
/// before full compaction at threshold * 1.0.
pub(crate) const SNIP_THRESHOLD_FACTOR: f32 = 0.85;

/// Minimum tokens per continuation to consider productive. 3+ continuations
/// below this threshold trigger diminishing returns detection.
pub(crate) const DIMINISHING_RETURNS_THRESHOLD: u32 = 50;
pub(crate) const DIMINISHING_RETURNS_COUNT: u32 = 5;

/// Token budget auto-continuation: stop when this fraction of budget is used.
pub(crate) const TOKEN_BUDGET_COMPLETION_THRESHOLD: f32 = 0.90;

/// Tool_use/tool_result pairing repair marker.
pub(crate) const SYNTHETIC_TOOL_RESULT: &str = "[Tool result unavailable — context was compacted]";

// ---------------------------------------------------------------------------
// Scaled summary budget — quest 67-180.4, deliverable 7
// ---------------------------------------------------------------------------
//
// The compactor's output budget (max_tokens) is sized proportionally to the
// transcript being compressed. Too small and the summary gets truncated mid-
// sentence and the resumed agent runs on rubble; too large and the LLM
// happily generates a 4k-token wall of text for a 200-char tail.
//
// Formula: `summary_max_tokens = clamp(input_chars / 4 / RATIO, MIN, MAX)`
//
// CHARS_PER_TOKEN ≈ 4 (matches `CHARS_PER_TOKEN`) so dividing input chars by 4
// approximates the token count of the input. Dividing again by RATIO targets
// the compression factor.

/// Target compression factor — output budget = input_tokens / RATIO.
/// `RATIO = 8` aims at ~8× compression as the default (e.g. an 8k-token
/// transcript yields a 1k-token summary).
pub const SUMMARY_BUDGET_RATIO: usize = 8;

/// Minimum tokens the compactor is allowed for its summary. Floors out the
/// formula so even a tiny input still gets a usable summary instead of a
/// 50-token snippet.
pub const SUMMARY_BUDGET_MIN: u32 = 256;

/// Maximum tokens the compactor is allowed for its summary. Caps the formula
/// so a giant input doesn't authorize a runaway LLM call.
pub const SUMMARY_BUDGET_MAX: u32 = 1_024;

/// Compute the `max_tokens` budget for a compactor session given the input
/// character count. Pure function — testable without any LLM/runtime context.
///
/// Sized so:
/// - A short input (under ~8KB) gets the [`SUMMARY_BUDGET_MIN`] floor.
/// - A medium input scales linearly at the `SUMMARY_BUDGET_RATIO` factor.
/// - A huge input is capped at [`SUMMARY_BUDGET_MAX`].
pub fn compute_summary_max_tokens(input_chars: usize) -> u32 {
    let input_tokens = input_chars / CHARS_PER_TOKEN;
    let proposed = (input_tokens / SUMMARY_BUDGET_RATIO) as u32;
    proposed.clamp(SUMMARY_BUDGET_MIN, SUMMARY_BUDGET_MAX)
}

// ---------------------------------------------------------------------------
// Deterministic fallback summary — quest 67-180.4, deliverable 10
// ---------------------------------------------------------------------------
//
// When the LLM compactor returns empty/missing/garbage output (rate limit,
// upstream error, model refused), the agent loop must not resume on rubble.
// The fallback summary is a deterministic head+tail snip of the input
// transcript, labelled clearly so the resumed agent knows the LLM compactor
// failed and the structural fallback ran instead.

/// Minimum useful length (in chars) for an LLM-generated summary. Output
/// below this threshold is treated as a compactor failure and the fallback
/// summary takes over. 64 chars is shorter than any sensible 9-section
/// summary header — anything below this is empty / garbage / a one-line
/// "okay" from a refusing model.
pub const FALLBACK_MIN_SUMMARY_CHARS: usize = 64;

/// Per-section cap (in chars) on the deterministic fallback. Head + tail
/// total stays bounded — far below `MAX_TRANSCRIPT` in
/// [`build_compaction_transcript`] — so the fallback can be safely substituted
/// into `transcript.replace_middle` without re-bloating the context window.
const FALLBACK_SECTION_CHARS: usize = 1_500;

/// Build a deterministic head+tail snip of a transcript preview, prefixed
/// with a header that tells the resumed agent the LLM compactor failed and
/// this is the structural fallback. Pure function — no LLM, no I/O.
///
/// The header is intentionally explicit so when the operator reads a session
/// later they can see the LLM compactor missed at this seam without grepping
/// logs. Returns a Markdown body suitable as `replacement_content` for
/// `transcript.replace_middle`.
pub fn fallback_summary(transcript_preview: &str) -> String {
    let trimmed = transcript_preview.trim();
    if trimmed.is_empty() {
        return concat!(
            "# Context Summary (deterministic fallback — LLM compactor failed)\n\n",
            "_No transcript preview was available at compaction time._\n\n",
            "The previous turns could not be summarised by the compactor LLM and ",
            "no transcript snippet was provided as a structural fallback. ",
            "Treat this section as background reference only; resume from the ",
            "latest user message that follows."
        )
        .to_string();
    }

    let total = trimmed.chars().count();
    if total <= FALLBACK_SECTION_CHARS * 2 {
        // Small enough to include verbatim — no middle to truncate.
        return format!(
            "# Context Summary (deterministic fallback — LLM compactor failed)\n\n\
             _The LLM compactor returned no usable summary. The transcript tail is included verbatim below._\n\n\
             ```\n{trimmed}\n```"
        );
    }

    let head: String = trimmed.chars().take(FALLBACK_SECTION_CHARS).collect();
    let tail: String = trimmed
        .chars()
        .rev()
        .take(FALLBACK_SECTION_CHARS)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let truncated = total.saturating_sub(FALLBACK_SECTION_CHARS * 2);

    format!(
        "# Context Summary (deterministic fallback — LLM compactor failed)\n\n\
         _The LLM compactor returned no usable summary. A structural head + tail snip \
         of the recent transcript is included below as background reference. \
         {truncated} characters from the middle were elided._\n\n\
         ## Head\n\n```\n{head}\n```\n\n\
         ## Tail\n\n```\n{tail}\n```"
    )
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

pub(crate) fn estimate_tokens_from_messages(messages: &[Message]) -> u32 {
    let mut total_tokens: usize = 0;

    for msg in messages {
        match &msg.content {
            MessageContent::Text(t) => {
                total_tokens += t.len() / CHARS_PER_TOKEN;
            }
            MessageContent::Parts(parts) => {
                for part in parts {
                    match part {
                        ContentPart::Text { text, .. } => {
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

// ---------------------------------------------------------------------------
// Token-aware preserve windows (quest 67-180.3)
// ---------------------------------------------------------------------------

/// Convert a token budget into a (head, tail) message-count pair suitable for
/// passing to [`snip_compact`] / [`context_collapse`].
///
/// Walks the messages from each end accumulating estimated tokens until the
/// budget is hit. The returned counts ARE clamped to `floor_head` / `floor_tail`
/// (so a too-tight token budget still preserves at least N messages on each
/// side — the agent loop relied on this in the fixed-count era and the safety
/// floor preserves that contract).
///
/// **Tool-pair boundary respect:** the tail walk extends BACKWARD past any
/// `Role::Tool` message until it lands on an `Assistant` boundary, ensuring
/// the tail never starts mid-pair. Splitting a tool_use (assistant) from its
/// matching tool_result (tool) at the compaction boundary forces
/// `repair_tool_pairing` to insert synthetic results — preferable to fix at
/// the cut, not the patch.
///
/// Returns `(head_count, tail_count)` such that the compactable window is
/// `messages[head_count .. len - tail_count]`.
pub(crate) fn token_aware_preserve_counts(
    messages: &[Message],
    head_token_budget: u32,
    tail_token_budget: u32,
    floor_head: usize,
    floor_tail: usize,
) -> (usize, usize) {
    let len = messages.len();
    if len == 0 {
        return (0, 0);
    }

    // Head: walk forward, sum tokens, stop when next message would overflow.
    let mut head_count = 0usize;
    let mut head_tokens: u32 = 0;
    while head_count < len {
        let msg_tokens = estimate_tokens_from_messages(&messages[head_count..head_count + 1]);
        if head_count >= floor_head && head_tokens + msg_tokens > head_token_budget {
            break;
        }
        head_tokens = head_tokens.saturating_add(msg_tokens);
        head_count += 1;
        if head_count >= len {
            break;
        }
    }

    // Tail: walk backward, sum tokens, stop when next-older message overflows.
    let mut tail_count = 0usize;
    let mut tail_tokens: u32 = 0;
    while tail_count < len {
        let idx = len - 1 - tail_count;
        let msg_tokens = estimate_tokens_from_messages(&messages[idx..idx + 1]);
        if tail_count >= floor_tail && tail_tokens + msg_tokens > tail_token_budget {
            break;
        }
        tail_tokens = tail_tokens.saturating_add(msg_tokens);
        tail_count += 1;
        if tail_count >= len {
            break;
        }
    }

    // Tool-pair boundary respect on the tail. The oldest message currently
    // IN the tail is `messages[len - tail_count]`. If that message is a
    // `Role::Tool` (a tool_result), its matching tool_use lives in the
    // older `Role::Assistant` message — which the current cut leaves in
    // the head. Extend the tail backward one message at a time until the
    // oldest tail message is NOT a Tool — i.e., the boundary lands
    // between API rounds, not inside one.
    while tail_count < len && head_count + tail_count < len {
        let tail_start = len - tail_count;
        if tail_start == 0 {
            break;
        }
        // The oldest message currently in the tail.
        if messages[tail_start].role == Role::Tool {
            tail_count += 1;
        } else {
            break;
        }
    }

    // Floors first; then make sure head + tail don't claim the same window.
    let head_count = head_count.max(floor_head).min(len);
    let tail_count = tail_count
        .max(floor_tail)
        .min(len.saturating_sub(head_count));
    (head_count, tail_count)
}

/// Token-budgeted slice of a transcript string. Returns the trailing
/// `budget_tokens * CHARS_PER_TOKEN_STRUCTURED`-worth of chars (rounded down),
/// or the full string if it's shorter. Used by the compaction-event trigger
/// to send a meaningful preview to the compactor LLM instead of the previous
/// fixed last-2000-chars window.
pub(crate) fn token_budgeted_tail(transcript: &str, budget_tokens: u32) -> &str {
    let budget_chars = (budget_tokens as usize).saturating_mul(CHARS_PER_TOKEN_STRUCTURED);
    if transcript.len() <= budget_chars {
        return transcript;
    }
    // Walk back from the end to a char boundary so UTF-8 isn't sliced
    // mid-codepoint. Avoids the "byte index X is not a char boundary" panic
    // on transcripts that happen to contain multibyte chars at the cut.
    let mut cut = transcript.len() - budget_chars;
    while cut < transcript.len() && !transcript.is_char_boundary(cut) {
        cut += 1;
    }
    &transcript[cut..]
}

// ---------------------------------------------------------------------------
// Snip compaction
// ---------------------------------------------------------------------------

/// Snip compaction: remove entire old API rounds (assistant + tool messages)
/// from the compactable window. No API call — purely token estimation.
/// Returns estimated tokens freed.
pub(crate) fn snip_compact(
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
        let round_tokens = estimate_tokens_from_messages(&messages[round_start..round_end]);
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

// ---------------------------------------------------------------------------
// Microcompact
// ---------------------------------------------------------------------------

/// Microcompact: clear old tool results by tool name, keeping the N most recent.
/// More targeted than the old digest — only clears results from compactable tools
/// (read, shell, grep, glob, web_search, web_fetch, edit, write).
pub(crate) fn microcompact(
    messages: &mut [Message],
    preserve_tail: usize,
    keep_recent: usize,
) -> usize {
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

// ---------------------------------------------------------------------------
// Context collapse
// ---------------------------------------------------------------------------

/// Context collapse: cheap, deterministic drain of low-value content from the
/// compactable window. Removes stale system messages and truncates long tool
/// results to head+tail previews. No LLM call — purely structural.
/// Returns estimated tokens freed.
pub(crate) fn context_collapse(
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
                        ContentPart::Text { text, .. } => text.len(),
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

// ---------------------------------------------------------------------------
// Compaction transcript builder
// ---------------------------------------------------------------------------

pub(crate) fn build_compaction_transcript(messages: &[Message]) -> String {
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
                    ContentPart::Text { text, .. } => {
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

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

pub(crate) fn is_retryable_error(error: &str) -> bool {
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

pub(crate) fn is_context_length_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("context length")
        || lower.contains("token limit")
        || lower.contains("prompt is too long")
        || lower.contains("maximum context")
        || (lower.contains("too long") && lower.contains("token"))
}

// ---------------------------------------------------------------------------
// Agent methods: compaction pipeline + conversation repair
// ---------------------------------------------------------------------------

impl Agent {
    /// Run the 4-stage context compaction pipeline:
    ///   Stage 0: Snip — remove entire old API rounds (no API call, ~free)
    ///   Stage 1: Microcompact — clear old tool results by name, keep recent N
    ///   Stage 1.5: Context collapse — remove stale system msgs + truncate long tool results
    ///   Stage 2: Full compact — event-driven structured summary + restoration
    ///
    /// Returns (per-stage compaction report, estimated_tokens after compaction).
    pub(super) async fn run_compaction_pipeline(
        &self,
        messages: &mut Vec<Message>,
        tracker: &mut ContextTracker,
        has_attempted_reactive_compact: &mut bool,
        iterations: u32,
        active_model: &str,
    ) -> (CompactionReport, u32) {
        let mut report = CompactionReport::default();

        let estimated_tokens = if tracker.estimated_context_tokens() > 0 {
            tracker.estimated_context_tokens()
        } else {
            estimate_tokens_from_messages(messages)
        };

        let full_threshold =
            (self.config.context_window as f32 * self.config.compact_threshold) as u32;
        let snip_threshold = (self.config.context_window as f32
            * self.config.compact_threshold
            * SNIP_THRESHOLD_FACTOR) as u32;
        let protected = self.config.compact_preserve_head + self.config.compact_preserve_tail;

        // --- Stage 0: Snip ---
        if estimated_tokens > snip_threshold && messages.len() > protected {
            let freed = snip_compact(
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
                report.snip = Some(SnipStats {
                    tokens_freed: freed,
                });
            }
        }

        // Re-estimate after snip.
        let estimated_tokens = if report.snip.is_some() {
            estimate_tokens_from_messages(messages)
        } else {
            estimated_tokens
        };

        // --- Stage 1: Microcompact ---
        if estimated_tokens > snip_threshold && messages.len() > protected {
            let cleared = microcompact(
                messages,
                self.config.compact_preserve_tail,
                MICROCOMPACT_KEEP_RECENT,
            );
            if cleared > 0 {
                self.emit(crate::chat_stream::ChatStreamEvent::MicroCompacted {
                    cleared: cleared as u32,
                });
                report.microcompact = Some(MicrocompactStats {
                    tools_cleared: cleared as u32,
                });
            }
        }

        // Re-estimate after microcompact.
        let mut estimated_tokens = estimate_tokens_from_messages(messages);

        // --- Stage 1.5: Context collapse ---
        if estimated_tokens > full_threshold && messages.len() > protected {
            let collapsed = context_collapse(
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
                estimated_tokens = estimate_tokens_from_messages(messages);
                report.collapse = Some(CollapseStats {
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

            // Token-budgeted preview (quest 67-180.3). Replaces the previous
            // fixed last-2000-chars window so the compactor LLM always sees a
            // meaningful tail — a single large tool_result could previously
            // consume the entire preview and leave the LLM with no recent
            // assistant context. `token_budgeted_tail` also walks back to a
            // UTF-8 boundary so the slice is safe on transcripts containing
            // multibyte chars.
            let transcript_preview: String = {
                let full = build_compaction_transcript(messages);
                token_budgeted_tail(&full, self.config.compact_preview_tokens).to_string()
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
                report.event_delegation = Some(EventDelegationStats { handled: true });

                if let Some(ref sf) = self.config.session_file {
                    super::Agent::save_session(messages, tracker, iterations, active_model, sf)
                        .await;
                }
            }
        }

        (report, estimated_tokens)
    }

    /// Ensure every tool_use has a matching tool_result and vice versa.
    /// Prevents API 400 errors after compaction drops messages.
    pub(super) fn repair_tool_pairing(messages: &mut Vec<Message>) {
        let mut tool_use_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
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

        let dangling: Vec<String> = tool_use_ids.difference(&tool_result_ids).cloned().collect();
        let orphans: Vec<String> = tool_result_ids.difference(&tool_use_ids).cloned().collect();

        if dangling.is_empty() && orphans.is_empty() {
            return;
        }

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
}

// ---------------------------------------------------------------------------
// Tests for quest 67-180.4 helpers
// ---------------------------------------------------------------------------

#[cfg(test)]
mod budget_and_fallback_tests {
    use super::*;

    #[test]
    fn compute_summary_max_tokens_floors_at_min_for_small_input() {
        // 100 chars ≈ 25 input tokens, / 8 = 3 → clamps up to MIN.
        assert_eq!(compute_summary_max_tokens(100), SUMMARY_BUDGET_MIN);
        // Zero input still gives the floor — the compactor must always have
        // budget for at least the wrapper header.
        assert_eq!(compute_summary_max_tokens(0), SUMMARY_BUDGET_MIN);
    }

    #[test]
    fn compute_summary_max_tokens_scales_linearly_in_band() {
        // 32_000 chars ≈ 8000 input tokens, / 8 = 1000 → in-band, no clamp.
        let budget = compute_summary_max_tokens(32_000);
        assert_eq!(budget, 1_000);
        assert!(budget > SUMMARY_BUDGET_MIN && budget < SUMMARY_BUDGET_MAX);
    }

    #[test]
    fn compute_summary_max_tokens_caps_at_max_for_huge_input() {
        // 1_000_000 chars ≈ 250_000 input tokens, / 8 = 31_250 → clamps to MAX.
        assert_eq!(compute_summary_max_tokens(1_000_000), SUMMARY_BUDGET_MAX);
    }

    #[test]
    fn fallback_summary_includes_header_marker_for_empty_input() {
        let summary = fallback_summary("");
        assert!(summary.contains("deterministic fallback"));
        assert!(summary.contains("LLM compactor failed"));
        // Operator-readable: the header is recognisable in raw transcripts.
        assert!(summary.starts_with("# Context Summary"));
    }

    #[test]
    fn fallback_summary_includes_short_transcript_verbatim() {
        let preview = "User: did you finish?\nAssistant: yes, shipped v0.1.";
        let summary = fallback_summary(preview);
        assert!(summary.contains("deterministic fallback"));
        assert!(summary.contains("shipped v0.1"));
        // Short enough → no head/tail split, single fenced block.
        assert!(!summary.contains("## Head"));
        assert!(!summary.contains("## Tail"));
    }

    #[test]
    fn fallback_summary_head_tail_snips_large_transcript() {
        // Build a transcript larger than 2 * FALLBACK_SECTION_CHARS so the
        // function takes the head/tail branch.
        let big = "A".repeat(5_000) + &"Z".repeat(5_000);
        let summary = fallback_summary(&big);
        assert!(summary.contains("deterministic fallback"));
        assert!(summary.contains("## Head"));
        assert!(summary.contains("## Tail"));
        // Head must contain only A's; tail must contain only Z's.
        let head_marker = summary.find("## Head").unwrap();
        let tail_marker = summary.find("## Tail").unwrap();
        let head_section = &summary[head_marker..tail_marker];
        let tail_section = &summary[tail_marker..];
        assert!(head_section.contains("AAAAA"));
        assert!(tail_section.contains("ZZZZZ"));
        assert!(!head_section.contains('Z'));
        // Truncated-middle character count is reported.
        assert!(summary.contains("characters from the middle were elided"));
    }
}
