//! Quest tree context — parent/sibling/child snippet injected into the prompt.
//!
//! Extracted from `agent_worker` so `spawn_session` (and QueueExecutor, once
//! Phase 3 lands) can assemble the same context without pulling in worker
//! state.
//!
//! Visibility rule: one up (parent), one down (children), sideways (siblings).
//! - Parent: truncated description (first 200 chars).
//! - Children: status + outcome summary (one line each).
//! - Done siblings: outcome summary so agent knows what's been built.
//! - In-progress/pending siblings: status only.
//! - No grandparents, no grandchildren.
//!
//! Token budget: ~1700 tokens. Descriptions truncated to 200 chars, outcome
//! summaries to 100 chars. If >10 siblings, show top 5 done + top 3 active.

use aeqi_quests::{Quest, QuestStatus};

use crate::agent_registry::AgentRegistry;

pub async fn build_quest_tree_context(quest: &Quest, registry: &AgentRegistry) -> String {
    let quest_id = &quest.id;

    let parent = if let Some(ref pid) = quest_id.parent() {
        match registry.get_task(&pid.0).await {
            Ok(Some(p)) => Some(p),
            _ => None,
        }
    } else {
        None
    };

    let children = registry
        .list_tasks_by_prefix(&quest_id.0)
        .await
        .unwrap_or_default();

    let siblings = if let Some(ref pid) = quest_id.parent() {
        registry
            .list_tasks_by_prefix(&pid.0)
            .await
            .unwrap_or_default()
            .into_iter()
            .filter(|q| q.id != *quest_id)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    let mut done_siblings: Vec<&Quest> = siblings
        .iter()
        .filter(|q| q.status == QuestStatus::Done)
        .collect();
    let mut active_siblings: Vec<&Quest> = siblings
        .iter()
        .filter(|q| !q.is_closed() && q.status != QuestStatus::Done)
        .collect();

    done_siblings.sort_by(|a, b| a.id.0.cmp(&b.id.0));
    active_siblings.sort_by(|a, b| a.id.0.cmp(&b.id.0));

    let done_capped = siblings.len() > 10;
    let done_overflow = if done_capped && done_siblings.len() > 5 {
        let overflow = done_siblings.len() - 5;
        done_siblings.truncate(5);
        overflow
    } else {
        0
    };

    let active_capped = siblings.len() > 10;
    let active_overflow = if active_capped && active_siblings.len() > 3 {
        let overflow = active_siblings.len() - 3;
        active_siblings.truncate(3);
        overflow
    } else {
        0
    };

    if parent.is_none() && children.is_empty() && siblings.is_empty() {
        return String::new();
    }

    let mut out = String::from("\n## Quest Tree\n\n");

    if let Some(ref p) = parent {
        let desc = truncate_str(&p.description, 200);
        out.push_str(&format!("Parent: {} [{}] — {}\n", p.id, p.status, p.name));
        if !desc.is_empty() {
            out.push_str(&format!("  Description: {}\n", desc));
        }
        out.push('\n');
    }

    if !done_siblings.is_empty() {
        out.push_str("Siblings (done):\n");
        for sib in &done_siblings {
            let summary = sib
                .outcome_summary()
                .map(|s| format!(" → \"{}\"", truncate_str(&s, 100)))
                .unwrap_or_default();
            out.push_str(&format!("  {} [done] — {}{}\n", sib.id, sib.name, summary));
        }
        if done_overflow > 0 {
            out.push_str(&format!(
                "  ... and {} more done siblings (use recall for details)\n",
                done_overflow
            ));
        }
        out.push('\n');
    }

    if !active_siblings.is_empty() {
        out.push_str("Siblings (active):\n");
        for sib in &active_siblings {
            out.push_str(&format!("  {} [{}] — {}\n", sib.id, sib.status, sib.name));
        }
        if active_overflow > 0 {
            out.push_str(&format!(
                "  ... and {} more active siblings\n",
                active_overflow
            ));
        }
        out.push('\n');
    }

    out.push_str(&format!(
        "You: {} [{}] — {}\n\n",
        quest.id, quest.status, quest.name
    ));

    if !children.is_empty() {
        out.push_str("Children:\n");
        for child in &children {
            let summary = if child.status == QuestStatus::Done {
                child
                    .outcome_summary()
                    .map(|s| format!(" → \"{}\"", truncate_str(&s, 100)))
                    .unwrap_or_default()
            } else {
                String::new()
            };
            out.push_str(&format!(
                "  {} [{}] — {}{}\n",
                child.id, child.status, child.name, summary
            ));
        }
        out.push('\n');
    }

    out
}

fn truncate_str(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.len() <= max_chars {
        s.to_string()
    } else {
        let mut end = max_chars;
        while !s.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}...", &s[..end])
    }
}
