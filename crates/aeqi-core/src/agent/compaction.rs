//! Context compaction helpers: token estimation, snip/microcompact/context-collapse,
//! the 4-stage compaction pipeline, conversation repair, and error classification.

use tracing::{debug, info};

use crate::traits::{ContentPart, Message, MessageContent, Role};

use super::Agent;
use super::LoopTransition;
use super::step_context::ContextTracker;

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
    /// Returns (optional transition, estimated_tokens after compaction).
    pub(super) async fn run_compaction_pipeline(
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
                transition = Some(LoopTransition::SnipCompacted {
                    tokens_freed: freed,
                });
            }
        }

        // Re-estimate after snip.
        let estimated_tokens = if transition.is_some() {
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

            let transcript_preview: String = {
                let full = build_compaction_transcript(messages);
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
                    super::Agent::save_session(messages, tracker, iterations, active_model, sf)
                        .await;
                }
            }
        }

        (transition, estimated_tokens)
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
