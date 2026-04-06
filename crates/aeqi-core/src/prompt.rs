//! Prompt entry types for the unified prompts[] system.
//!
//! Every agent, task, and trigger carries an ordered `Vec<PromptEntry>`.
//! Prompt assembly walks the agent tree (ancestors → self → task) and
//! concatenates entries grouped by position (system, prepend, append).

use serde::{Deserialize, Serialize};

/// A single entry in the prompts[] array.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptEntry {
    /// The prompt text content.
    pub content: String,
    /// Where this entry goes in the assembled prompt.
    #[serde(default)]
    pub position: PromptPosition,
    /// Who inherits this entry.
    #[serde(default)]
    pub scope: PromptScope,
    /// Optional tool restrictions applied when this entry is active.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<ToolRestrictions>,
}

impl PromptEntry {
    /// Create a system-position, self-scoped prompt entry.
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            position: PromptPosition::System,
            scope: PromptScope::SelfOnly,
            tools: None,
        }
    }

    /// Create a prepend-position entry scoped to descendants.
    pub fn primer(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            position: PromptPosition::Prepend,
            scope: PromptScope::Descendants,
            tools: None,
        }
    }

    /// Create an append-position, self-scoped entry (e.g. task description).
    pub fn task_prepend(content: impl Into<String>) -> Self {
        Self {
            content: content.into(),
            position: PromptPosition::Prepend,
            scope: PromptScope::SelfOnly,
            tools: None,
        }
    }

    /// Create a skill entry with tool restrictions.
    pub fn skill(content: impl Into<String>, tools: ToolRestrictions) -> Self {
        Self {
            content: content.into(),
            position: PromptPosition::Append,
            scope: PromptScope::SelfOnly,
            tools: Some(tools),
        }
    }
}

/// Where a prompt entry appears in the assembled prompt.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptPosition {
    /// Part of the system prompt.
    #[default]
    System,
    /// Prepended before the main system prompt.
    Prepend,
    /// Appended after the main system prompt.
    Append,
}

/// Who inherits this prompt entry.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptScope {
    /// Only the agent that owns this entry.
    #[default]
    #[serde(rename = "self")]
    SelfOnly,
    /// All descendants in the agent tree.
    Descendants,
}

/// Tool allow/deny lists attached to a prompt entry.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ToolRestrictions {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub allow: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub deny: Vec<String>,
}

/// The result of assembling all prompt entries for an agent + task.
#[derive(Debug, Clone, Default)]
pub struct AssembledPrompt {
    /// Concatenated system-position entries.
    pub system: String,
    /// Concatenated prepend-position entries (inserted before system in context).
    pub prepend: String,
    /// Concatenated append-position entries (inserted after system in context).
    pub append: String,
    /// Merged tool restrictions (intersection of allows, union of denies).
    pub tools: ToolRestrictions,
}

impl AssembledPrompt {
    /// Build the full system prompt string: prepend + system + append.
    pub fn full_system_prompt(&self) -> String {
        let mut parts = Vec::new();
        if !self.prepend.is_empty() {
            parts.push(self.prepend.as_str());
        }
        if !self.system.is_empty() {
            parts.push(self.system.as_str());
        }
        if !self.append.is_empty() {
            parts.push(self.append.as_str());
        }
        parts.join("\n\n---\n\n")
    }

    /// Inject dynamic content (e.g., memory recall) as a prepend entry.
    pub fn inject_prepend(&mut self, content: &str) {
        if content.is_empty() {
            return;
        }
        if self.prepend.is_empty() {
            self.prepend = content.to_string();
        } else {
            self.prepend.push_str("\n\n---\n\n");
            self.prepend.push_str(content);
        }
    }

    /// Inject dynamic content as an append entry.
    pub fn inject_append(&mut self, content: &str) {
        if content.is_empty() {
            return;
        }
        if self.append.is_empty() {
            self.append = content.to_string();
        } else {
            self.append.push_str("\n\n---\n\n");
            self.append.push_str(content);
        }
    }
}
