//! Event Matcher — subscribes to activity stream, matches against
//! registered events, and fires handlers by creating sessions.
//!
//! This replaces the hardcoded trigger listener and parts of the
//! patrol loop. Events are the behavior primitive.

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

    /// Match an activity against all registered events and fire matching handlers.
    ///
    /// Called by the daemon's activity stream subscriber on every activity emission.
    pub async fn match_activity(
        &self,
        activity_type: &str,
        agent_id: Option<&str>,
        quest_id: Option<&str>,
        payload: &serde_json::Value,
    ) {
        // Map activity types to event patterns.
        let event_pattern = match activity_type {
            "quest_created" | "execution.quest_started" => "lifecycle:quest_received",
            "execution.quest_completed" | "quest_completed" => "lifecycle:quest_completed",
            "execution.quest_failed" => "lifecycle:quest_failed",
            "quest.delegated" => "lifecycle:quest_received",
            "budget_exceeded" => "lifecycle:budget_exceeded",
            "session_start" => "lifecycle:session_start",
            "session_end" => "lifecycle:session_end",
            "execution.blocked" => "lifecycle:quest_blocked",
            "idea_received" => "lifecycle:idea_received",
            "child_added" => "lifecycle:child_added",
            "child_removed" => "lifecycle:child_removed",
            _ => return, // Skip unhandled activity types.
        };

        let Some(source_agent_id) = agent_id else {
            return;
        };

        // Find all enabled events that match this pattern.
        let events = match self.event_store.list_enabled().await {
            Ok(events) => events,
            Err(e) => {
                warn!(error = %e, "failed to load events for matching");
                return;
            }
        };

        // Get the source agent's ancestor chain for scope resolution.
        let ancestors = self
            .agent_registry
            .get_ancestor_ids(source_agent_id)
            .await
            .unwrap_or_else(|_| vec![source_agent_id.to_string()]);

        let now = Utc::now();

        for event in &events {
            // Pattern match.
            if !event.pattern.starts_with(event_pattern)
                && event.pattern != event_pattern
            {
                continue;
            }

            if !event.enabled {
                continue;
            }

            // Scope match: does this event's owner see the source agent?
            let scope_match = match event.scope.as_str() {
                "self" => event.agent_id == source_agent_id,
                "children" => {
                    // Event owner is the parent of the source agent.
                    ancestors
                        .get(1)
                        .is_some_and(|parent_id| *parent_id == event.agent_id)
                }
                "descendants" => {
                    // Event owner is any ancestor of the source agent (except self).
                    ancestors
                        .iter()
                        .skip(1)
                        .any(|ancestor_id| *ancestor_id == event.agent_id)
                }
                _ => false,
            };

            if !scope_match {
                continue;
            }

            // Cooldown check.
            if event.cooldown_secs > 0 {
                let cooldowns = self.cooldowns.read().await;
                if let Some(last) = cooldowns.get(&event.id) {
                    let elapsed = (now - *last).num_seconds();
                    if elapsed < event.cooldown_secs as i64 {
                        debug!(
                            event = %event.name,
                            cooldown_remaining = event.cooldown_secs as i64 - elapsed,
                            "event skipped (cooldown)"
                        );
                        continue;
                    }
                }
            }

            // Chain depth check (prevent infinite loops).
            if let Some(quest_id) = quest_id {
                let depth = self.chain_depth(quest_id).await;
                if depth >= 5 {
                    warn!(
                        event = %event.name,
                        quest_id = %quest_id,
                        depth,
                        "event skipped (chain depth limit reached)"
                    );
                    continue;
                }
            }

            // Fire the event.
            self.fire(event, source_agent_id, quest_id, payload).await;
        }
    }

    /// Fire a matched event: advance-before-execute, create quest, record.
    async fn fire(
        &self,
        event: &Event,
        source_agent_id: &str,
        quest_id: Option<&str>,
        _payload: &serde_json::Value,
    ) {
        // Advance-before-execute (at-most-once semantics).
        if let Err(e) = self.event_store.advance_before_execute(&event.id).await {
            warn!(event = %event.name, error = %e, "failed to advance event");
            return;
        }

        // Update cooldown.
        self.cooldowns
            .write()
            .await
            .insert(event.id.clone(), Utc::now());

        // Build quest description from event content or referenced idea.
        let description = event
            .content
            .clone()
            .unwrap_or_else(|| format!("Event '{}' fired on pattern '{}'", event.name, event.pattern));

        // Determine chain depth label.
        let depth = if let Some(qid) = quest_id {
            self.chain_depth(qid).await + 1
        } else {
            0
        };

        let mut labels = vec![
            format!("event:{}", event.name),
            format!("event_id:{}", event.id),
            format!("chain_depth:{depth}"),
        ];
        if let Some(qid) = quest_id {
            labels.push(format!("triggered_by_quest:{qid}"));
        }

        // Create quest on the event's owning agent.
        match self
            .agent_registry
            .create_task(
                &event.agent_id,
                &format!("[event:{}] {}", event.name, event.pattern),
                &description,
                &[],
                &labels,
            )
            .await
        {
            Ok(quest) => {
                // Emit activity for audit.
                let _ = self
                    .activity_log
                    .emit(
                        "event.fired",
                        Some(&event.agent_id),
                        None,
                        Some(&quest.id.0),
                        &serde_json::json!({
                            "event_name": event.name,
                            "event_pattern": event.pattern,
                            "source_agent": source_agent_id,
                        }),
                    )
                    .await;

                let _ = self.event_store.record_fire(&event.id, 0.0).await;

                info!(
                    event = %event.name,
                    agent = %event.agent_id,
                    quest_id = %quest.id,
                    chain_depth = depth,
                    "event fired → quest created"
                );
            }
            Err(e) => {
                warn!(
                    event = %event.name,
                    agent = %event.agent_id,
                    error = %e,
                    "failed to create quest from event"
                );
            }
        }
    }

    /// Get the chain depth of a quest (how many event-triggered quests deep).
    async fn chain_depth(&self, quest_id: &str) -> u32 {
        // Check quest labels for chain_depth:N.
        match self.agent_registry.get_task(quest_id).await {
            Ok(Some(quest)) => {
                for label in &quest.labels {
                    if let Some(depth_str) = label.strip_prefix("chain_depth:") {
                        return depth_str.parse().unwrap_or(0);
                    }
                }
                0
            }
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn setup() -> (EventMatcher, Arc<AgentRegistry>, Arc<EventHandlerStore>) {
        let dir = tempfile::tempdir().unwrap();
        let reg = Arc::new(AgentRegistry::open(dir.path()).unwrap());
        let ehs = Arc::new(EventHandlerStore::new(reg.db()));
        let al = Arc::new(ActivityLog::new(reg.db()));
        let matcher = EventMatcher::new(ehs.clone(), reg.clone(), al);
        (matcher, reg, ehs)
    }

    #[tokio::test]
    async fn self_scope_matches_own_agent() {
        let (matcher, reg, ehs) = setup().await;
        let agent = reg.spawn("shadow", None, "t", "Test.", None, None, &[]).await.unwrap();

        ehs.create(&crate::event_handler::NewEvent {
            agent_id: agent.id.clone(),
            name: "on-complete".into(),
            pattern: "lifecycle:quest_completed".into(),
            scope: "self".into(),
            idea_id: None,
            content: Some("Review work".into()),
            cooldown_secs: 0,
            max_budget_usd: None,
            webhook_secret: None,
            system: false,
        }).await.unwrap();

        // Should fire — agent's own event
        matcher.match_activity(
            "execution.quest_completed",
            Some(&agent.id),
            None,
            &serde_json::json!({}),
        ).await;

        // Check a quest was created for the agent
        let tasks = reg.list_tasks(None, Some(&agent.id)).await.unwrap();
        assert!(!tasks.is_empty(), "event should have created a quest");
    }

    #[tokio::test]
    async fn self_scope_does_not_match_other_agent() {
        let (matcher, reg, ehs) = setup().await;
        let agent_a = reg.spawn("shadow", None, "t", "A.", None, None, &[]).await.unwrap();
        let agent_b = reg.spawn("cto", None, "t", "B.", None, None, &[]).await.unwrap();

        ehs.create(&crate::event_handler::NewEvent {
            agent_id: agent_a.id.clone(),
            name: "on-complete".into(),
            pattern: "lifecycle:quest_completed".into(),
            scope: "self".into(),
            idea_id: None,
            content: Some("Review".into()),
            cooldown_secs: 0,
            max_budget_usd: None,
            webhook_secret: None,
            system: false,
        }).await.unwrap();

        // Agent B completes — A's self-scoped event should NOT fire
        matcher.match_activity(
            "execution.quest_completed",
            Some(&agent_b.id),
            None,
            &serde_json::json!({}),
        ).await;

        let tasks = reg.list_tasks(None, Some(&agent_a.id)).await.unwrap();
        assert!(tasks.is_empty(), "self-scoped event should not fire for other agent");
    }

    #[tokio::test]
    async fn children_scope_matches_child() {
        let (matcher, reg, ehs) = setup().await;
        let parent = reg.spawn("cto", None, "t", "Parent.", None, None, &[]).await.unwrap();
        let child = reg.spawn("impl", None, "t", "Child.", Some(&parent.id), None, &[]).await.unwrap();

        ehs.create(&crate::event_handler::NewEvent {
            agent_id: parent.id.clone(),
            name: "child-done".into(),
            pattern: "lifecycle:quest_completed".into(),
            scope: "children".into(),
            idea_id: None,
            content: Some("Review child work".into()),
            cooldown_secs: 0,
            max_budget_usd: None,
            webhook_secret: None,
            system: false,
        }).await.unwrap();

        // Child completes — parent's children-scoped event should fire
        matcher.match_activity(
            "execution.quest_completed",
            Some(&child.id),
            None,
            &serde_json::json!({}),
        ).await;

        let tasks = reg.list_tasks(None, Some(&parent.id)).await.unwrap();
        assert!(!tasks.is_empty(), "children-scoped event should fire for child");
    }

    #[tokio::test]
    async fn unmatched_pattern_does_not_fire() {
        let (matcher, reg, ehs) = setup().await;
        let agent = reg.spawn("shadow", None, "t", "Test.", None, None, &[]).await.unwrap();

        ehs.create(&crate::event_handler::NewEvent {
            agent_id: agent.id.clone(),
            name: "on-fail".into(),
            pattern: "lifecycle:quest_failed".into(),
            scope: "self".into(),
            idea_id: None,
            content: Some("Handle failure".into()),
            cooldown_secs: 0,
            max_budget_usd: None,
            webhook_secret: None,
            system: false,
        }).await.unwrap();

        // Quest completed, not failed — should not fire
        matcher.match_activity(
            "execution.quest_completed",
            Some(&agent.id),
            None,
            &serde_json::json!({}),
        ).await;

        let tasks = reg.list_tasks(None, Some(&agent.id)).await.unwrap();
        let fail_tasks: Vec<_> = tasks.iter().filter(|t| t.name.contains("on-fail")).collect();
        assert!(fail_tasks.is_empty(), "quest_failed event should not fire on quest_completed");
    }
}
