//! Event Matcher — matches lifecycle activities against agent-registered
//! events. Lifecycle events are CONTEXT INJECTION ONLY — they inject ideas
//! into the agent's prompt via assemble_ideas. They never create quests.
//!
//! Only scheduled events (schedule:*) create quests, handled by schedule_timer.rs.

use std::collections::HashMap;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use crate::agent_registry::AgentRegistry;
use crate::event_handler::{Event, EventHandlerStore};
use crate::activity_log::ActivityLog;

/// Tracks cooldowns per event handler (in-memory, lost on restart).
pub struct EventMatcher {
    event_store: Arc<EventHandlerStore>,
    agent_registry: Arc<AgentRegistry>,
    activity_log: Arc<ActivityLog>,
    cooldowns: RwLock<HashMap<String, DateTime<Utc>>>,
}

impl EventMatcher {
    pub fn new(
        event_store: Arc<EventHandlerStore>,
        agent_registry: Arc<AgentRegistry>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            event_store,
            agent_registry,
            activity_log,
            cooldowns: RwLock::new(HashMap::new()),
        }
    }

    /// Match an activity against registered events.
    ///
    /// Lifecycle events are context injection only — they inject ideas into
    /// the agent's prompt via assemble_ideas at session start. They NEVER
    /// create quests or trigger workers. This function is a no-op.
    ///
    /// Only scheduled events (schedule:*) create quests, and those are
    /// handled by schedule_timer.rs, not this function.
    pub async fn match_activity(
        &self,
        _activity_type: &str,
        _agent_id: Option<&str>,
        _quest_id: Option<&str>,
        _payload: &serde_json::Value,
    ) {
        // No-op. Lifecycle events don't create quests.
    }
}

/// Collect idea IDs from an event's idea_ids array.
pub fn event_idea_ids(event: &Event) -> Vec<String> {
    event.idea_ids.iter().filter(|id| !id.is_empty()).cloned().collect()
}
