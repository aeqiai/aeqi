//! Event Matcher — no-op. Session events inject ideas via assemble_ideas.
//! Scheduled events spawn sessions via schedule_timer.rs.
//! This module exists only for the `event_idea_ids` helper.

use crate::event_handler::Event;

/// Collect idea IDs from an event's idea_ids array.
pub fn event_idea_ids(event: &Event) -> Vec<String> {
    event.idea_ids.iter().filter(|id| !id.is_empty()).cloned().collect()
}
