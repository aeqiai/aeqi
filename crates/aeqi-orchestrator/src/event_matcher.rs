//! Event helpers. Session events inject ideas via assemble_ideas.
//! Scheduled events spawn sessions via schedule_timer.rs.

use crate::event_handler::Event;

/// Collect unique non-empty idea IDs from an event.
pub fn event_idea_ids(event: &Event) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    event
        .idea_ids
        .iter()
        .filter(|id| !id.is_empty() && seen.insert(id.as_str().to_owned()))
        .map(|id| id.to_string())
        .collect()
}
