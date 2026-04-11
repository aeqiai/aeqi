//! Schedule Timer — fires schedule-type events at precise times.
//!
//! Replaces the patrol loop's trigger checking with a dedicated timer
//! that sleeps until the next schedule is due.

use std::sync::Arc;
use chrono::Utc;
use tracing::{info, warn};

use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;
use crate::activity_log::ActivityLog;

/// Runs schedule-type events without polling.
pub struct ScheduleTimer {
    event_store: Arc<EventHandlerStore>,
    agent_registry: Arc<AgentRegistry>,
    activity_log: Arc<ActivityLog>,
}

impl ScheduleTimer {
    pub fn new(
        event_store: Arc<EventHandlerStore>,
        agent_registry: Arc<AgentRegistry>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            event_store,
            agent_registry,
            activity_log,
        }
    }

    /// Run the schedule timer loop. Call in a tokio::spawn.
    pub async fn run(self, shutdown: Arc<tokio::sync::Notify>) {
        info!("schedule timer started");
        loop {
            // Query all schedule events.
            let schedules = match self.event_store.list_by_pattern_prefix("schedule:").await {
                Ok(s) => s,
                Err(e) => {
                    warn!(error = %e, "failed to load schedule events");
                    Vec::new()
                }
            };

            // Check each schedule and fire if due.
            for event in &schedules {
                let expr = event.pattern.strip_prefix("schedule:").unwrap_or("");
                if expr.is_empty() {
                    continue;
                }

                if is_schedule_due(expr, event.last_fired.as_ref()) {
                    self.fire_schedule(event).await;
                }
            }

            // Sleep until next check. For precision, we could compute the
            // exact next fire time, but 30s resolution is good enough for now
            // and much simpler than per-schedule timers.
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
        // Advance-before-execute.
        if let Err(e) = self.event_store.advance_before_execute(&event.id).await {
            warn!(event = %event.name, error = %e, "failed to advance schedule event");
            return;
        }

        let description = event
            .content
            .clone()
            .unwrap_or_else(|| format!("Scheduled event: {}", event.name));

        let labels = vec![
            format!("event:{}", event.name),
            format!("event_id:{}", event.id),
            "chain_depth:0".to_string(),
        ];

        match self
            .agent_registry
            .create_task(
                &event.agent_id,
                &format!("[schedule:{}] {}", event.pattern, event.name),
                &description,
                None,
                &labels,
            )
            .await
        {
            Ok(quest) => {
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
                            "schedule": true,
                        }),
                    )
                    .await;

                let _ = self.event_store.record_fire(&event.id, 0.0).await;

                info!(
                    event = %event.name,
                    agent = %event.agent_id,
                    quest_id = %quest.id,
                    "schedule event fired → quest created"
                );
            }
            Err(e) => {
                warn!(event = %event.name, error = %e, "failed to create quest from schedule");
            }
        }
    }
}

/// Check if a schedule expression is due to fire.
fn is_schedule_due(expr: &str, last_fired: Option<&chrono::DateTime<Utc>>) -> bool {
    let now = Utc::now();

    // Interval format: "every 1h", "every 30m", "every 2d"
    if expr.starts_with("every ") {
        let interval_str = &expr[6..];
        if let Some(duration) = parse_interval(interval_str) {
            return match last_fired {
                None => true, // Never fired → fire immediately.
                Some(last) => (now - *last) >= duration,
            };
        }
    }

    // Cron format: "0 9 * * *" (minute hour day month weekday)
    if let Some(cron) = parse_simple_cron(expr) {
        // Don't re-fire within the same minute.
        if let Some(last) = last_fired {
            if (now - *last).num_seconds() < 60 {
                return false;
            }
        }
        return cron.matches_now();
    }

    false
}

/// Parse "1h", "30m", "2d" into a chrono::Duration.
fn parse_interval(s: &str) -> Option<chrono::Duration> {
    let s = s.trim();
    if s.is_empty() {
        return None;
    }
    let (num_str, unit) = s.split_at(s.len() - 1);
    let num: i64 = num_str.parse().ok()?;
    match unit {
        "s" => Some(chrono::Duration::seconds(num.max(60))), // Min 60s
        "m" => Some(chrono::Duration::minutes(num)),
        "h" => Some(chrono::Duration::hours(num)),
        "d" => Some(chrono::Duration::days(num)),
        _ => None,
    }
}

/// Simple 5-field cron matcher.
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
        self.minute.matches(now.format("%M").to_string().parse().unwrap_or(0))
            && self.hour.matches(now.format("%H").to_string().parse().unwrap_or(0))
            && self.day.matches(now.format("%d").to_string().parse().unwrap_or(0))
            && self.month.matches(now.format("%m").to_string().parse().unwrap_or(0))
            && self.weekday.matches(now.format("%u").to_string().parse().unwrap_or(0) % 7)
    }
}

impl CronField {
    fn matches(&self, value: u32) -> bool {
        match self {
            CronField::Any => true,
            CronField::Exact(v) => value == *v,
            CronField::Step(s) => *s > 0 && value % *s == 0,
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
