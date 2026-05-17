//! Schedule Timer — fires schedule-type events by spawning sessions.
//!
//! The agent decides what to do — create quests, run tasks, etc.
//! Events inject ideas. The runtime just spawns the session.

use chrono::Utc;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;
use crate::execution_registry::{ExecutionHandle, ExecutionRegistry};
use crate::session_manager::{SessionManager, SpawnOptions};

/// Runs schedule-type events without polling.
pub struct ScheduleTimer {
    event_store: Arc<EventHandlerStore>,
    activity_log: Arc<ActivityLog>,
    session_manager: Arc<SessionManager>,
    execution_registry: Arc<ExecutionRegistry>,
    default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    empty_completion_cooldowns: Arc<Mutex<HashMap<String, chrono::DateTime<Utc>>>>,
}

impl ScheduleTimer {
    pub fn new(
        event_store: Arc<EventHandlerStore>,
        _agent_registry: Arc<AgentRegistry>,
        activity_log: Arc<ActivityLog>,
        session_manager: Arc<SessionManager>,
        execution_registry: Arc<ExecutionRegistry>,
        default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    ) -> Self {
        Self {
            event_store,
            activity_log,
            session_manager,
            execution_registry,
            default_provider,
            empty_completion_cooldowns: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Run the schedule timer loop. Call in a tokio::spawn.
    pub async fn run(self, shutdown: Arc<tokio::sync::Notify>) {
        info!("schedule timer started");
        loop {
            let schedules = match self.event_store.list_by_pattern_prefix("schedule:").await {
                Ok(s) => s,
                Err(e) => {
                    warn!(error = %e, "failed to load schedule events");
                    Vec::new()
                }
            };

            for event in &schedules {
                let expr = event.pattern.strip_prefix("schedule:").unwrap_or("");
                if expr.is_empty() {
                    continue;
                }

                if self.is_empty_completion_cooling_down(&event.id).await {
                    continue;
                }

                if is_schedule_due(expr, event.last_fired.as_ref()) {
                    self.fire_schedule(event).await;
                }
            }

            tokio::select! {
                _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {},
                _ = shutdown.notified() => {
                    info!("schedule timer shutting down");
                    return;
                }
            }
        }
    }

    async fn fire_schedule(&self, event: &crate::event_handler::Event) {
        // Schedule events need a concrete agent to spawn a session on — globals
        // (agent_id IS NULL) have no target and are skipped here.
        let Some(agent_id) = event.agent_id.as_deref() else {
            warn!(event = %event.name, "global schedule event has no target agent, skipping");
            return;
        };

        if let Err(e) = self.event_store.advance_before_execute(&event.id).await {
            warn!(event = %event.name, error = %e, "failed to advance schedule event");
            return;
        }

        let Some(ref provider) = self.default_provider else {
            warn!(event = %event.name, "no provider configured, skipping schedule");
            return;
        };

        let input = format!(
            "Scheduled event '{}' fired. Check your injected context and decide what to do.",
            event.name
        );

        let mut opts = SpawnOptions::interactive()
            .with_name(format!("schedule:{}", event.name))
            .with_transport("schedule".to_string())
            // Cron-fired prompts are runtime-originated, not user-typed.
            // `from_kind="system"` (no `from_id`) makes the inbox UI
            // render the seed row as a system event instead of
            // attributing it to whichever user happens to be viewing
            // the session.
            .with_from_kind("system".to_string());
        opts.auto_close = true;

        match self
            .session_manager
            .spawn_session(agent_id, &input, provider.clone(), opts)
            .await
        {
            Ok(spawned) => {
                let _ = self
                    .activity_log
                    .emit(
                        "event.fired",
                        Some(agent_id),
                        None,
                        None,
                        &serde_json::json!({
                            "event_name": event.name,
                            "event_pattern": event.pattern,
                            "session_id": spawned.session_id,
                            "schedule": true,
                        }),
                    )
                    .await;

                let _ = self.event_store.record_fire(&event.id, 0.0).await;

                info!(
                    event = %event.name,
                    agent = %agent_id,
                    session_id = %spawned.session_id,
                    "schedule event fired → session spawned"
                );

                // Register the execution so IPC status/cancel can see it, and
                // drive the join in a detached task so it clears itself from
                // the registry when the run completes.
                let exec_reg = self.execution_registry.clone();
                let activity_log = self.activity_log.clone();
                let cooldowns = self.empty_completion_cooldowns.clone();
                let sandbox = spawned.sandbox.clone();
                let event_id = event.id.clone();
                let event_name = event.name.clone();
                let event_pattern = event.pattern.clone();
                let event_cooldown_secs = event.cooldown_secs;
                let agent_id_for_cooldown = spawned.agent_id.clone();
                exec_reg
                    .register(ExecutionHandle {
                        session_id: spawned.session_id.clone(),
                        agent_id: spawned.agent_id.clone(),
                        agent_name: spawned.agent_name.clone(),
                        correlation_id: spawned.correlation_id.clone(),
                        cancel_token: spawned.cancel_token.clone(),
                        sandbox: sandbox.clone(),
                        quest_id: None,
                        started_at: std::time::Instant::now(),
                    })
                    .await;
                for event in spawned.initial_events {
                    spawned.stream_sender.send(event);
                }
                let sid = spawned.session_id.clone();
                tokio::spawn(async move {
                    let join_result = spawned.join_handle.await;
                    if let Ok(Ok(ref result)) = join_result
                        && crate::llm_health::is_empty_completion_failure_result(result)
                    {
                        let cooldown_secs = empty_completion_cooldown_secs(event_cooldown_secs);
                        let until = Utc::now() + chrono::Duration::seconds(cooldown_secs as i64);
                        cooldowns.lock().await.insert(event_id.clone(), until);
                        let stop_reason = format!("{:?}", result.stop_reason);
                        let _ = activity_log
                            .emit(
                                "schedule.empty_completion_cooldown",
                                Some(&agent_id_for_cooldown),
                                Some(&sid),
                                None,
                                &serde_json::json!({
                                    "event_id": event_id,
                                    "event_name": event_name,
                                    "event_pattern": event_pattern,
                                    "cooldown_secs": cooldown_secs,
                                    "cooldown_until": until.to_rfc3339(),
                                    "model": result.model.as_str(),
                                    "prompt_tokens": result.total_prompt_tokens,
                                    "completion_tokens": result.total_completion_tokens,
                                    "iterations": result.iterations,
                                    "stop_reason": stop_reason,
                                }),
                            )
                            .await;
                    }
                    exec_reg.unregister(&sid).await;
                    drop(sandbox);
                });
            }
            Err(e) => {
                warn!(event = %event.name, error = %e, "failed to spawn session from schedule");
            }
        }
    }

    async fn is_empty_completion_cooling_down(&self, event_id: &str) -> bool {
        let now = Utc::now();
        let mut cooldowns = self.empty_completion_cooldowns.lock().await;
        if cooldowns
            .get(event_id)
            .is_some_and(|cooldown_until| *cooldown_until > now)
        {
            return true;
        }
        cooldowns.remove(event_id);
        false
    }
}

// ── Schedule parsing ─────────────────────────────────────────────────

fn is_schedule_due(expr: &str, last_fired: Option<&chrono::DateTime<Utc>>) -> bool {
    let now = Utc::now();

    // Interval format: "every 1h", "every 30m", "every 2d"
    if let Some(interval_str) = expr.strip_prefix("every ")
        && let Some(duration) = parse_interval(interval_str)
    {
        return match last_fired {
            None => true,
            Some(last) => (now - *last) >= duration,
        };
    }

    // Cron format: "0 9 * * *" (minute hour day month weekday)
    if let Some(cron) = parse_simple_cron(expr) {
        if let Some(last) = last_fired
            && (now - *last).num_seconds() < 60
        {
            return false;
        }
        return cron.matches_now();
    }

    false
}

fn empty_completion_cooldown_secs(configured_cooldown_secs: u64) -> u64 {
    configured_cooldown_secs.max(crate::llm_health::EMPTY_COMPLETION_SCHEDULE_COOLDOWN_SECS)
}

fn parse_interval(s: &str) -> Option<chrono::Duration> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: i64 = num_str.parse().ok()?;
    match unit {
        "s" => Some(chrono::Duration::seconds(num.max(60))),
        "m" => Some(chrono::Duration::minutes(num)),
        "h" => Some(chrono::Duration::hours(num)),
        "d" => Some(chrono::Duration::days(num)),
        _ => None,
    }
}

struct CronMatcher {
    minute: CronField,
    hour: CronField,
    day: CronField,
    month: CronField,
    weekday: CronField,
}

enum CronField {
    Any,
    Exact(u32),
    Step(u32),
}

impl CronMatcher {
    fn matches_now(&self) -> bool {
        let now = Utc::now();
        self.minute
            .matches(now.format("%M").to_string().parse().unwrap_or(0))
            && self
                .hour
                .matches(now.format("%H").to_string().parse().unwrap_or(0))
            && self
                .day
                .matches(now.format("%d").to_string().parse().unwrap_or(0))
            && self
                .month
                .matches(now.format("%m").to_string().parse().unwrap_or(0))
            && self
                .weekday
                .matches(now.format("%u").to_string().parse().unwrap_or(0) % 7)
    }
}

impl CronField {
    fn matches(&self, value: u32) -> bool {
        match self {
            CronField::Any => true,
            CronField::Exact(v) => value == *v,
            CronField::Step(s) => *s > 0 && value.is_multiple_of(*s),
        }
    }
}

fn parse_cron_field(s: &str) -> CronField {
    if s == "*" {
        CronField::Any
    } else if let Some(step) = s.strip_prefix("*/") {
        CronField::Step(step.parse().unwrap_or(1))
    } else {
        CronField::Exact(s.parse().unwrap_or(0))
    }
}

fn parse_simple_cron(expr: &str) -> Option<CronMatcher> {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != 5 {
        return None;
    }
    Some(CronMatcher {
        minute: parse_cron_field(parts[0]),
        hour: parse_cron_field(parts[1]),
        day: parse_cron_field(parts[2]),
        month: parse_cron_field(parts[3]),
        weekday: parse_cron_field(parts[4]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_interval_hours() {
        let d = parse_interval("1h").unwrap();
        assert_eq!(d.num_hours(), 1);
    }

    #[test]
    fn parse_interval_minutes() {
        let d = parse_interval("30m").unwrap();
        assert_eq!(d.num_minutes(), 30);
    }

    #[test]
    fn parse_interval_seconds_minimum_60() {
        let d = parse_interval("5s").unwrap();
        assert_eq!(d.num_seconds(), 60);
    }

    #[test]
    fn interval_never_fired_is_due() {
        assert!(is_schedule_due("every 1h", None));
    }

    #[test]
    fn interval_recently_fired_not_due() {
        let last = Utc::now() - chrono::Duration::minutes(10);
        assert!(!is_schedule_due("every 1h", Some(&last)));
    }

    #[test]
    fn interval_long_ago_is_due() {
        let last = Utc::now() - chrono::Duration::hours(2);
        assert!(is_schedule_due("every 1h", Some(&last)));
    }

    #[test]
    fn cron_field_any_matches_all() {
        assert!(CronField::Any.matches(0));
        assert!(CronField::Any.matches(59));
    }

    #[test]
    fn cron_field_exact() {
        assert!(CronField::Exact(9).matches(9));
        assert!(!CronField::Exact(9).matches(10));
    }

    #[test]
    fn cron_field_step() {
        assert!(CronField::Step(5).matches(0));
        assert!(CronField::Step(5).matches(15));
        assert!(!CronField::Step(5).matches(7));
    }

    #[test]
    fn unknown_pattern_not_due() {
        assert!(!is_schedule_due("garbage", None));
    }

    #[test]
    fn empty_completion_cooldown_uses_default_when_event_has_no_cooldown() {
        assert_eq!(
            empty_completion_cooldown_secs(0),
            crate::llm_health::EMPTY_COMPLETION_SCHEDULE_COOLDOWN_SECS
        );
    }

    #[test]
    fn empty_completion_cooldown_preserves_longer_event_cooldown() {
        let configured = crate::llm_health::EMPTY_COMPLETION_SCHEDULE_COOLDOWN_SECS + 60;
        assert_eq!(empty_completion_cooldown_secs(configured), configured);
    }
}
