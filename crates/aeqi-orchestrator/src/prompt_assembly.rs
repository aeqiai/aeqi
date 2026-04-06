//! Prompt assembly — one function replaces all prompt string concatenation.
//!
//! Walks the agent ancestor chain, collects `prompts[]` entries from each,
//! appends task prompts, groups by position, and returns an `AssembledPrompt`.

use aeqi_core::prompt::{
    AssembledPrompt, PromptEntry, PromptPosition, PromptScope, ToolRestrictions,
};

use crate::agent_registry::AgentRegistry;

/// Assemble the full prompt for an agent + task combination.
///
/// Order: root ancestor → ... → parent → self → task prompts.
/// Within each level, entries are ordered as stored in the `prompts[]` array.
/// Entries grouped by position (system, prepend, append) and concatenated.
pub async fn assemble_prompts(
    registry: &AgentRegistry,
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

    // Walk from root to self (reverse of get_ancestors order).
    for (depth, agent) in ancestors.iter().rev().enumerate() {
        let is_self = depth == ancestors.len() - 1;

        for entry in &agent.prompts {
            // Scope check: descendants-scoped entries from ancestors, self-scoped only from self.
            let include = match entry.scope {
                PromptScope::Descendants => !is_self, // ancestors propagate to descendants
                PromptScope::SelfOnly => is_self,     // only the target agent's own entries
            };
            // Exception: descendants-scoped entries on self also apply to self.
            let include = include || (is_self && entry.scope == PromptScope::Descendants);

            if !include {
                continue;
            }

            if entry.content.is_empty() {
                continue;
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

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::prompt::{PromptPosition, PromptScope};

    #[test]
    fn empty_prompts_produce_empty_assembly() {
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
