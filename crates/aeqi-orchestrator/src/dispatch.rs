//! Dispatch config holder.
//!
//! The legacy event-driven `Scheduler::schedule` + `AgentWorker` worker pool
//! has been retired in favor of the unified rail: [`crate::quest_enqueuer::QuestEnqueuer`]
//! walks ready quests and enqueues them into `pending_messages`; the
//! [`crate::queue_executor::QueueExecutor`] drains the queue via
//! `SessionManager::spawn_session`. Live-execution status reporting is served
//! by [`crate::execution_registry::ExecutionRegistry`].
//!
//! What remains in this module is the configuration surface — admission
//! caps (max_workers, max_task_retries, daily budget, per-worker budget)
//! read by the enqueuer at tick time, plus the failure-classifier knobs
//! (`adaptive_retry`, `failure_analysis_model`) that the
//! [`crate::queue_executor::QueueExecutor`] reads on quest completion.

/// Configuration shared by [`crate::quest_enqueuer::QuestEnqueuer`] and the
/// IPC status endpoints. Held by [`Dispatcher`] so `CommandContext` has a
/// single place to read it from.
pub struct DispatchConfig {
    /// Global max concurrent workers (admission cap for the enqueuer).
    pub max_workers: u32,
    /// Default per-worker timeout — currently informational; session
    /// lifetime is bounded by the agent's iteration/budget limits.
    pub default_timeout_secs: u64,
    /// Default per-worker budget in USD. Forwarded into `QueuedMessage::quest`.
    pub worker_max_budget_usd: f64,
    /// Global daily budget cap — enqueuer refuses new work once the
    /// ActivityLog daily cost reaches it.
    pub daily_budget_usd: f64,
    /// Enable adaptive retry with failure analysis.
    pub adaptive_retry: bool,
    /// Model for failure analysis.
    pub failure_analysis_model: String,
    /// Max task retries before auto-cancel.
    pub max_task_retries: u32,
}

impl Default for DispatchConfig {
    fn default() -> Self {
        Self {
            max_workers: 4,
            default_timeout_secs: 3600,
            worker_max_budget_usd: 5.0,
            daily_budget_usd: 50.0,
            adaptive_retry: false,
            failure_analysis_model: String::new(),
            max_task_retries: 3,
        }
    }
}

/// Thin config holder. The legacy scheduler's runtime state (`running: Vec<TrackedWorker>`,
/// event broadcast receiver, completion channel) is gone — `QuestEnqueuer`
/// owns dispatch and `ExecutionRegistry` owns live-execution metadata.
pub struct Dispatcher {
    pub config: DispatchConfig,
}

impl Dispatcher {
    pub fn new(config: DispatchConfig) -> Self {
        Self { config }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dispatch_config_defaults() {
        let config = DispatchConfig::default();
        assert_eq!(config.max_workers, 4);
        assert_eq!(config.default_timeout_secs, 3600);
        assert_eq!(config.worker_max_budget_usd, 5.0);
        assert!((config.daily_budget_usd - 50.0).abs() < 0.01);
    }
}
