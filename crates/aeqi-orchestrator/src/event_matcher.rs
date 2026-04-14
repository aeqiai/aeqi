//! Event Matcher — matches lifecycle activities against agent-registered
//! events. Lifecycle events are CONTEXT INJECTION ONLY — they inject ideas
//! into the agent's prompt via assemble_ideas. They never create quests.
//!
//! Only scheduled events (schedule:*) create quests, handled by schedule_timer.rs.

use crate::event_handler::Event;

/// Match an activity against registered events.
///
/// Lifecycle events are context injection only — they inject ideas into
/// the agent's prompt via assemble_ideas at session start. They NEVER
/// create quests or trigger workers. This function is a no-op.
///
/// Only scheduled events (schedule:*) create quests, and those are
/// handled by schedule_timer.rs, not this function.
pub async fn match_activity(
    _activity_type: &str,
    _agent_id: Option<&str>,
    _quest_id: Option<&str>,
    _payload: &serde_json::Value,
) {
    // No-op. Lifecycle events don't create quests.
}

/// Collect idea IDs from an event's idea_ids array.
pub fn event_idea_ids(event: &Event) -> Vec<String> {
    event.idea_ids.iter().filter(|id| !id.is_empty()).cloned().collect()
}
