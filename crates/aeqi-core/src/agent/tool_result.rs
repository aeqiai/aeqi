//! Tool outcome persistence, truncation, enrichment injection, and file tracking.

use std::path::{Path, PathBuf};

use tracing::debug;

use crate::traits::{ContextAttachment, Message, MessageContent, Role, ToolResult};

use super::AgentConfig;
use super::compaction::CHARS_PER_TOKEN;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/// Intermediate tool result during processing.
pub(crate) struct ProcessedToolResult {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) output: String,
    pub(crate) is_error: bool,
}

/// A completed tool result: (id, name, input_args, result, duration_ms).
pub(crate) type ToolExecResult = (
    String,
    String,
    serde_json::Value,
    Result<ToolResult, anyhow::Error>,
    u64,
);

/// Preview size for persisted tool results (bytes).
const PERSIST_PREVIEW_SIZE: usize = 2000;

// ---------------------------------------------------------------------------
// ContentReplacementState
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// A recently-read file tracked for external change detection.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub(crate) struct RecentFile {
    pub(crate) path: String,
    /// File modification time at the point we read it (epoch secs).
    pub(crate) mtime_secs: u64,
}

// ---------------------------------------------------------------------------
// Disk persistence
// ---------------------------------------------------------------------------

/// Persist a tool result to disk and return a reference message with preview.
pub(crate) async fn persist_tool_result(
    dir: &Path,
    tool_use_id: &str,
    content: &str,
) -> anyhow::Result<String> {
    let path = dir.join(format!("{tool_use_id}.txt"));

    tokio::fs::write(&path, content).await?;

    let preview = generate_preview(content, PERSIST_PREVIEW_SIZE);

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
pub(crate) fn generate_preview(content: &str, max_bytes: usize) -> String {
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

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

/// Truncate a tool result with head (40%) + tail (40%) preview.
pub(crate) fn truncate_result(output: &str, max_chars: usize) -> String {
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
pub(crate) fn enforce_result_budget(
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
            results[idx].output = truncate_result(&results[idx].output, target_len);
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

// ---------------------------------------------------------------------------
// Persist dir resolution (free function called from Agent via resolve_persist_dir)
// ---------------------------------------------------------------------------

/// Resolve or create the persist directory given the agent config.
/// Returns `Some(path)` if the directory exists or was created successfully.
pub(crate) fn resolve_persist_dir_path(
    config: &AgentConfig,
    created: &mut Option<PathBuf>,
) -> Option<PathBuf> {
    if created.is_some() {
        return created.clone();
    }
    let dir = config.persist_dir.clone().unwrap_or_else(|| {
        std::env::temp_dir().join("aeqi-tool-results").join(format!(
            "{}-{}",
            config.name,
            std::process::id()
        ))
    });
    if std::fs::create_dir_all(&dir).is_ok() {
        *created = Some(dir.clone());
        Some(dir)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Mid-step context enrichment
// ---------------------------------------------------------------------------

/// Apply token budgets to enrichment attachments and inject as system messages.
///
/// Attachments arrive sorted by priority (lower = higher priority).
/// Each attachment has its own max_tokens budget. We also enforce a global
/// enrichment budget (5% of context_window) to prevent enrichments from
/// consuming too much of the model's capacity.
pub(crate) fn inject_enrichments(
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

// ---------------------------------------------------------------------------
// Tool batch summary
// ---------------------------------------------------------------------------

/// Build a compact summary line for a batch of tool results.
/// Groups by tool name, counts calls, and sums output sizes.
/// Example: `[Tool batch: read_file(3 calls, 12KB), grep(2 calls, 8KB)]`
pub(crate) fn build_tool_batch_summary(results: &[ProcessedToolResult]) -> String {
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

// ---------------------------------------------------------------------------
// File tracking for post-compact restoration
// ---------------------------------------------------------------------------

pub(crate) fn is_file_read_tool(name: &str) -> bool {
    matches!(
        name.to_lowercase().as_str(),
        "read" | "file_read" | "cat" | "readfile"
    )
}

pub(crate) fn extract_file_path_from_result(output: &str) -> Option<String> {
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
pub(crate) async fn detect_file_changes(recent_files: &[RecentFile]) -> Vec<(String, Message)> {
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

// ---------------------------------------------------------------------------
// Tool input formatter
// ---------------------------------------------------------------------------

/// Format tool input args into a human-readable preview string.
/// E.g., shell: "ls -la /home/..." → "ls -la /home/..."
///       read_file: {"file_path": "/foo/bar.rs"} → "/foo/bar.rs"
pub(crate) fn format_tool_input(tool_name: &str, args: &serde_json::Value) -> String {
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
