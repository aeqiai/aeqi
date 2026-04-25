//! Context assembly types.
//!
//! An agent's context is assembled by walking events, pulling referenced
//! ideas, and concatenating their content. Inheritance scope controls
//! whether an idea reaches descendants; tool restrictions merge across
//! the assembled set.

use serde::{Deserialize, Serialize};

/// Who inherits an idea when assembling a descendant's context.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptScope {
    /// Only the agent that owns this idea.
    #[default]
    #[serde(rename = "self")]
    SelfOnly,
    /// All descendants in the agent tree.
    Descendants,
}

/// Tool allow/deny lists.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolRestrictions {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deny: Vec<String>,
}

/// (T1.11) Provider-neutral cache-control marker carried on assembled
/// prompt segments. Substrate code emits these on segments; each provider
/// impl decides what to do with them — Anthropic emits the corresponding
/// `cache_control: {type: "ephemeral"}` annotation, others strip them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CacheControl {
    /// Mark this segment as an Anthropic-style ephemeral cache breakpoint.
    Ephemeral,
}

/// (T1.11) One assembled segment of the system prompt: idea content plus
/// optional cache marker. The flat `AssembledContext::system` string is
/// still the canonical join of every segment's `content`; the parallel
/// segment vec is what providers consult when they want to emit per-block
/// cache_control annotations.
#[derive(Debug, Clone, Default)]
pub struct AssembledPromptSegment {
    pub content: String,
    pub cache_control: Option<CacheControl>,
}

impl AssembledPromptSegment {
    /// Plain segment with no cache marker (the pre-T1.11 default for every
    /// idea content block).
    pub fn plain(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            cache_control: None,
        }
    }

    /// Segment with an `Ephemeral` cache breakpoint applied. Substrate
    /// helpers use this when a tag policy votes `cache_breakpoint=true`.
    pub fn ephemeral(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            cache_control: Some(CacheControl::Ephemeral),
        }
    }
}

/// The result of assembling ideas for an agent + task: one concatenated
/// system text plus merged tool restrictions.
#[derive(Debug, Clone, Default)]
pub struct AssembledContext {
    /// Concatenated idea content, joined with `---` separators.
    pub system: String,
    /// Merged tool restrictions (intersection of allows, union of denies).
    pub tools: ToolRestrictions,
    /// IDs of events whose idea_ids or query_template produced at least one
    /// idea that reached the assembled context. Runtime callers persist these
    /// via `EventHandlerStore::record_fire` so the Events UI can show the
    /// real fire count; preflight callers ignore this field.
    pub fired_event_ids: Vec<String>,
    /// (T1.11) Per-idea segments mirroring `system`. Always populated by
    /// the assembler so providers that opt into cache_control annotations
    /// can rebuild their request body from the segments instead of the
    /// flat string. Empty when the assembler had nothing to emit (matches
    /// the pre-T1.11 behaviour where `system` was empty).
    pub segments: Vec<AssembledPromptSegment>,
}
