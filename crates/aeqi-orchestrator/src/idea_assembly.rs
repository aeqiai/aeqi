//! Idea assembly — event-driven prompt construction.
//!
//! Walks the agent ancestor chain, collects ideas activated by the
//! target event pattern, and concatenates their content into a single
//! system prompt. Tool restrictions from each idea merge across the set
//! (intersection of allows, union of denies). Scope controls whether an
//! ancestor's idea reaches the target agent.

use std::collections::HashSet;
use std::sync::Arc;

use aeqi_core::prompt::{AssembledPrompt, PromptScope, ToolRestrictions};
use aeqi_core::traits::{Idea, IdeaStore};

use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;

/// Assemble the full prompt for an agent + task combination.
///
/// Order: root ancestor → ... → parent → self → task ideas.
/// Within each level, ideas are ordered as referenced by their events.
pub async fn assemble_ideas(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
) -> AssembledPrompt {
    assemble_ideas_for_pattern(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        "session:start",
    )
    .await
}

/// Like `assemble_ideas` but for an arbitrary event pattern.
pub async fn assemble_ideas_for_pattern(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    event_pattern: &str,
) -> AssembledPrompt {
    // get_ancestors returns [self, parent, grandparent, ..., root].
    // We want root-first ordering.
    let ancestors = registry.get_ancestors(agent_id).await.unwrap_or_default();

    let mut parts: Vec<String> = Vec::new();
    let mut allow_sets: Vec<Vec<String>> = Vec::new();
    let mut deny_all: Vec<String> = Vec::new();
    let mut collected_idea_ids: HashSet<String> = HashSet::new();

    // Walk from root to self (reverse of get_ancestors order).
    for (depth, agent) in ancestors.iter().rev().enumerate() {
        let is_self = depth == ancestors.len() - 1;

        let events_for_agent = event_store
            .get_events_for_pattern(&agent.id, event_pattern)
            .await;

        let mut event_idea_ids: Vec<String> = Vec::new();
        for event in &events_for_agent {
            for idea_id in &event.idea_ids {
                if !idea_id.is_empty() && collected_idea_ids.insert(idea_id.clone()) {
                    event_idea_ids.push(idea_id.clone());
                }
            }
        }

        if let Some(store) = idea_store
            && !event_idea_ids.is_empty()
        {
            match store.get_by_ids(&event_idea_ids).await {
                Ok(ideas) => {
                    for idea in ideas {
                        append_idea(&idea, is_self, &mut parts, &mut allow_sets, &mut deny_all);
                    }
                }
                Err(e) => {
                    tracing::warn!(agent = %agent.id, error = %e, "failed to fetch event-referenced ideas");
                }
            }
        }
    }

    // Task ideas always apply to the target agent.
    if let Some(store) = idea_store
        && !task_idea_ids.is_empty()
    {
        let task_ids: Vec<String> = task_idea_ids
            .iter()
            .filter(|id| !id.is_empty() && collected_idea_ids.insert((*id).clone()))
            .cloned()
            .collect();
        if !task_ids.is_empty() {
            match store.get_by_ids(&task_ids).await {
                Ok(ideas) => {
                    for idea in ideas {
                        append_idea(&idea, true, &mut parts, &mut allow_sets, &mut deny_all);
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to fetch task ideas");
                }
            }
        }
    }

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
        system: parts.join("\n\n---\n\n"),
        tools: ToolRestrictions {
            allow: merged_allow,
            deny: deny_all,
        },
    }
}

/// Append a single idea to the output buffers, checking scope rules.
fn append_idea(
    idea: &Idea,
    is_self: bool,
    parts: &mut Vec<String>,
    allow_sets: &mut Vec<Vec<String>>,
    deny_all: &mut Vec<String>,
) {
    let include = match idea.scope() {
        PromptScope::Descendants => true,
        PromptScope::SelfOnly => is_self,
    };
    if !include || idea.content.is_empty() {
        return;
    }
    parts.push(idea.content.clone());
    if let Some(tools) = idea.tool_restrictions() {
        if !tools.allow.is_empty() {
            allow_sets.push(tools.allow);
        }
        deny_all.extend(tools.deny);
    }
}
