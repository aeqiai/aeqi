//! Idea assembly — event-driven prompt construction.
//!
//! Walks the agent ancestor chain, collects ideas activated by
//! `session:start` events, appends task prompts, groups by
//! position, and returns an `AssembledPrompt`.
//!
//! Events reference ideas via `idea_ids`. No inline content or fallback paths.

use std::collections::HashSet;
use std::sync::Arc;

use aeqi_core::prompt::{
    AssembledPrompt, PromptEntry, PromptPosition, PromptScope, ToolRestrictions,
};
use aeqi_core::traits::IdeaStore;

use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;

/// Assemble the full prompt for an agent + task combination.
///
/// Order: root ancestor → ... → parent → self → task prompts.
/// Within each level, entries are ordered as stored.
/// Entries grouped by position (system, prepend, append) and concatenated.
///
/// Idea collection via events:
/// `session:start` events on each ancestor contribute their
/// referenced `idea_ids` ideas.
pub async fn assemble_ideas(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_prompts: &[PromptEntry],
) -> AssembledPrompt {
    // get_ancestors returns [self, parent, grandparent, ..., root].
    // We want root-first ordering.
    let ancestors = registry.get_ancestors(agent_id).await.unwrap_or_default();

    let mut system_parts: Vec<String> = Vec::new();
    let mut prepend_parts: Vec<String> = Vec::new();
    let mut append_parts: Vec<String> = Vec::new();
    let mut allow_sets: Vec<Vec<String>> = Vec::new();
    let mut deny_all: Vec<String> = Vec::new();

    // Track all idea IDs already collected via events to avoid duplicates
    // when falling back to injection_mode.
    let mut collected_idea_ids: HashSet<String> = HashSet::new();

    // Walk from root to self (reverse of get_ancestors order).
    for (depth, agent) in ancestors.iter().rev().enumerate() {
        let is_self = depth == ancestors.len() - 1;

        // --- Phase 1: Event-based idea activation ---
        // Get `session:start` events for this ancestor.
        let session_start_events = event_store
            .get_events_for_pattern(&agent.id, "session:start")
            .await;

        // Collect idea_ids from events (only from the agent itself).
        let mut event_idea_ids: Vec<String> = Vec::new();

        for event in &session_start_events {
            // Without scope, events only apply to the owning agent.
            if !is_self {
                continue;
            }

            // Collect referenced idea IDs from event.idea_ids.
            for idea_id in &event.idea_ids {
                if !idea_id.is_empty() && !collected_idea_ids.contains(idea_id) {
                    event_idea_ids.push(idea_id.clone());
                    collected_idea_ids.insert(idea_id.clone());
                }
            }
        }

        // Bulk-fetch ideas referenced by events.
        if let Some(store) = idea_store
            && !event_idea_ids.is_empty()
        {
            match store.get_by_ids(&event_idea_ids).await {
                Ok(ideas) => {
                    for idea in ideas {
                        if idea.content.is_empty() {
                            continue;
                        }
                        let entry = idea.to_prompt_entry();
                        append_entry(
                            &entry,
                            is_self,
                            &mut system_parts,
                            &mut prepend_parts,
                            &mut append_parts,
                            &mut allow_sets,
                            &mut deny_all,
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(agent = %agent.id, error = %e, "failed to fetch event-referenced ideas");
                }
            }
        }

        // No fallback. Events are the only activation mechanism.
        // injection_mode ideas are migrated to events on daemon startup.
    }

    // Append task prompts (always included).
    for entry in task_prompts {
        if entry.content.is_empty() {
            continue;
        }
        match entry.position {
            PromptPosition::System => system_parts.push(entry.content.clone()),
            PromptPosition::Prepend => prepend_parts.push(entry.content.clone()),
            PromptPosition::Append => append_parts.push(entry.content.clone()),
        }
        if let Some(ref tools) = entry.tools {
            if !tools.allow.is_empty() {
                allow_sets.push(tools.allow.clone());
            }
            deny_all.extend(tools.deny.iter().cloned());
        }
    }

    // Merge tool restrictions: intersection of allows, union of denies.
    let merged_allow = if allow_sets.is_empty() {
        Vec::new()
    } else {
        let mut iter = allow_sets.into_iter();
        let first = iter.next().unwrap();
        iter.fold(first, |acc, set| {
            acc.into_iter().filter(|item| set.contains(item)).collect()
        })
    };
    deny_all.sort();
    deny_all.dedup();

    AssembledPrompt {
        system: system_parts.join("\n\n"),
        prepend: prepend_parts.join("\n\n---\n\n"),
        append: append_parts.join("\n\n---\n\n"),
        tools: ToolRestrictions {
            allow: merged_allow,
            deny: deny_all,
        },
    }
}

/// Apply a single PromptEntry to the output buffers, checking scope rules.
fn append_entry(
    entry: &PromptEntry,
    is_self: bool,
    system_parts: &mut Vec<String>,
    prepend_parts: &mut Vec<String>,
    append_parts: &mut Vec<String>,
    allow_sets: &mut Vec<Vec<String>>,
    deny_all: &mut Vec<String>,
) {
    // Scope check: descendants-scoped entries from ancestors, self-scoped only from self.
    let include = match entry.scope {
        PromptScope::Descendants => true, // ancestors propagate; self also includes its own descendants-scoped
        PromptScope::SelfOnly => is_self, // only the target agent's own entries
    };

    if !include {
        return;
    }

    if entry.content.is_empty() {
        return;
    }

    match entry.position {
        PromptPosition::System => system_parts.push(entry.content.clone()),
        PromptPosition::Prepend => prepend_parts.push(entry.content.clone()),
        PromptPosition::Append => append_parts.push(entry.content.clone()),
    }

    // Collect tool restrictions.
    if let Some(ref tools) = entry.tools {
        if !tools.allow.is_empty() {
            allow_sets.push(tools.allow.clone());
        }
        deny_all.extend(tools.deny.iter().cloned());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::prompt::{PromptPosition, PromptScope};

    #[test]
    fn empty_ideas_produce_empty_assembly() {
        let result = AssembledPrompt::default();
        assert!(result.full_system_prompt().is_empty());
    }

    #[test]
    fn full_system_prompt_concatenates_all_parts() {
        let mut prompt = AssembledPrompt::default();
        prompt.prepend = "Primer content".to_string();
        prompt.system = "You are an agent.".to_string();
        prompt.append = "Extra instructions.".to_string();
        let full = prompt.full_system_prompt();
        assert!(full.contains("Primer content"));
        assert!(full.contains("You are an agent."));
        assert!(full.contains("Extra instructions."));
        // Prepend comes before system, system before append.
        assert!(full.find("Primer").unwrap() < full.find("agent").unwrap());
        assert!(full.find("agent").unwrap() < full.find("Extra").unwrap());
    }

    #[test]
    fn inject_prepend_appends_with_separator() {
        let mut prompt = AssembledPrompt::default();
        prompt.inject_prepend("First");
        prompt.inject_prepend("Second");
        assert!(prompt.prepend.contains("First"));
        assert!(prompt.prepend.contains("Second"));
        assert!(prompt.prepend.contains("---"));
    }

    #[test]
    fn prompt_entry_constructors() {
        let sys = PromptEntry::system("test");
        assert_eq!(sys.position, PromptPosition::System);
        assert_eq!(sys.scope, PromptScope::SelfOnly);

        let primer = PromptEntry::primer("shared context");
        assert_eq!(primer.position, PromptPosition::Prepend);
        assert_eq!(primer.scope, PromptScope::Descendants);
    }
}
