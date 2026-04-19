//! Prompt assembly types.
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

/// The result of assembling ideas for an agent + task: one concatenated
/// system prompt plus merged tool restrictions.
#[derive(Debug, Clone, Default)]
pub struct AssembledPrompt {
    /// Concatenated idea content, joined with `---` separators.
    pub system: String,
    /// Merged tool restrictions (intersection of allows, union of denies).
    pub tools: ToolRestrictions,
    /// IDs of events whose idea_ids or query_template produced at least one
    /// idea that reached the system prompt. Runtime callers persist these
    /// via `EventHandlerStore::record_fire` so the Events UI can show the
    /// real fire count; preflight callers ignore this field.
    pub fired_event_ids: Vec<String>,
}
