//! Event-driven quest→queue dispatcher.
//!
//! The unified rail's admission head: instead of owning a worker pool that
//! spawns `AgentWorker` tasks directly (the retired scheduler path),
//! `QuestEnqueuer` walks the ready-quest list and inserts one row per quest
//! into the shared `pending_messages` queue, letting
//! [`crate::queue_executor::QueueExecutor`] pick it up via the normal
//! per-session claim loop. The middleware chain is attached downstream
//! inside `SessionManager::spawn_session`, so `QuestEnqueuer` is responsible
//! only for:
//!
//! 1. **Readiness** — ask `AgentRegistry::ready_tasks` for quests whose
//!    dependencies are satisfied and that are currently `Pending`.
//! 2. **Concurrency + budget admission** — enforce the per-agent max
//!    concurrency and the global daily budget cap so we don't flood the
//!    queue.
//! 3. **Retry budget** — refuse to enqueue when `retry_count >= max_retries`.
//! 4. **In-progress flip** — mark the quest `InProgress` before enqueueing so
//!    the next `ready_tasks` call doesn't return it again.
//! 5. **Enqueue** — build a [`QueuedMessage::quest`] payload, wrap it in a
//!    fresh per-quest session, and hand it to `session_queue::enqueue`.
//!
//! Primary dispatch is event-driven via the `ActivityLog` broadcast channel:
//! `quest_created` and `quest_completed` both wake the enqueuer. A 60-second
//! patrol tick runs as a safety net for missed signals (daemon lag, lost
//! broadcast subscribers).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::{Mutex, Notify};
use tracing::{debug, info, warn};

use crate::activity_log::{ActivityLog, EventFilter};
use crate::agent_registry::AgentRegistry;
use crate::dispatch::DispatchConfig;
use crate::queue_executor::QueuedMessage;
use crate::session_queue::{SessionExecutor, enqueue as queue_enqueue};
use crate::session_store::SessionStore;

/// Admission head of the unified rail. Walks ready quests, admits them
/// under per-agent concurrency and global daily-budget gates, and enqueues
/// one [`QueuedMessage::quest`] per quest into `pending_messages`. The
/// [`crate::queue_executor::QueueExecutor`] the caller supplied then drains
/// the queue through `spawn_session`.
pub struct QuestEnqueuer {
    pub agent_registry: Arc<AgentRegistry>,
    pub activity_log: Arc<ActivityLog>,
    pub session_store: Arc<SessionStore>,
    pub executor: Arc<dyn SessionExecutor>,
    pub config: DispatchConfig,
    event_rx: Mutex<tokio::sync::broadcast::Receiver<serde_json::Value>>,
}

impl QuestEnqueuer {
    pub fn new(
        agent_registry: Arc<AgentRegistry>,
        activity_log: Arc<ActivityLog>,
        session_store: Arc<SessionStore>,
        executor: Arc<dyn SessionExecutor>,
        config: DispatchConfig,
    ) -> Self {
        let event_rx = activity_log.subscribe();
        Self {
            agent_registry,
            activity_log,
            session_store,
            executor,
            config,
            event_rx: Mutex::new(event_rx),
        }
    }

    /// Drive the enqueuer loop until `shutdown` fires. Three wakeup paths:
    /// the broadcast channel (sub-ms dispatch on quest_created/completed),
    /// a 60-second safety-net patrol, and the shutdown notify.
    pub async fn run(&self, shutdown: Arc<Notify>) {
        info!("quest enqueuer started (event-driven, unified rail)");
        let mut patrol = tokio::time::interval(Duration::from_secs(60));
        patrol.tick().await;
        if let Err(e) = self.tick().await {
            warn!(error = %e, "initial tick failed");
        }

        let mut event_rx = self.event_rx.lock().await;
        loop {
            tokio::select! {
                result = event_rx.recv() => {
                    match result {
                        Ok(event) => {
                            let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            if matches!(event_type, "quest_created" | "quest_completed") {
                                debug!(event_type, "event-driven enqueue triggered");
                                if let Err(e) = self.tick().await {
                                    warn!(error = %e, "enqueue tick failed (event-driven)");
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!(skipped = n, "quest enqueuer lagged; running catch-up tick");
                            if let Err(e) = self.tick().await {
                                warn!(error = %e, "enqueue tick failed (lag recovery)");
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            info!("event broadcast closed, quest enqueuer stopping");
                            return;
                        }
                    }
                }
                _ = patrol.tick() => {
                    if let Err(e) = self.tick().await {
                        warn!(error = %e, "enqueue tick failed (patrol)");
                    }
                }
                _ = shutdown.notified() => {
                    info!("quest enqueuer shutting down");
                    return;
                }
            }
        }
    }

    /// One admission cycle: list ready tasks, apply gates, flip status, enqueue.
    ///
    /// Idempotent under concurrent ticks: the `update_task_status` call to
    /// `InProgress` is the commit point — whichever tick wins that
    /// transaction gets the quest; the loser's next `ready_tasks` call
    /// excludes the already-in-progress row.
    pub async fn tick(&self) -> Result<()> {
        let cycle_start = Instant::now();

        let ready = self.agent_registry.ready_tasks().await?;
        if ready.is_empty() {
            return Ok(());
        }

        // Concurrency accounting: count quests currently `in_progress` per
        // agent. These are quests the enqueuer previously flipped before
        // enqueueing — whether they're still sitting in `pending_messages`
        // or actively running doesn't matter for the admission decision.
        let per_agent_in_flight = self
            .agent_registry
            .in_progress_counts_by_agent()
            .await
            .unwrap_or_default();
        let total_in_flight: u32 = per_agent_in_flight.values().sum();

        let daily_cost = self.activity_log.daily_cost().await.unwrap_or(0.0);
        if daily_cost >= self.config.daily_budget_usd {
            debug!(
                daily_cost,
                budget = self.config.daily_budget_usd,
                "global daily budget exhausted — skipping enqueue cycle"
            );
            return Ok(());
        }

        let mut per_agent: HashMap<String, u32> = per_agent_in_flight;
        let mut enqueued = 0u32;

        for task in &ready {
            if total_in_flight + enqueued >= self.config.max_workers {
                debug!(
                    in_flight = total_in_flight + enqueued,
                    max = self.config.max_workers,
                    "global worker cap reached"
                );
                break;
            }

            let agent_id = match &task.agent_id {
                Some(id) => id.clone(),
                None => {
                    warn!(task = %task.id, "quest has no agent_id; skipping");
                    continue;
                }
            };

            // Retry budget — don't enqueue quests that have blown through
            // `max_task_retries`; mark them Cancelled so the user sees the
            // terminal state rather than seeing them resurrected forever.
            if task.retry_count >= self.config.max_task_retries {
                warn!(
                    task = %task.id,
                    retries = task.retry_count,
                    cap = self.config.max_task_retries,
                    "quest exceeded retry budget — cancelling"
                );
                let _ = self
                    .agent_registry
                    .update_task_status(&task.id.0, aeqi_quests::QuestStatus::Cancelled)
                    .await;
                continue;
            }

            // Per-agent concurrency cap — walk the agent tree via
            // `get_max_concurrent`, which resolves inherited limits.
            let max_concurrent = self
                .agent_registry
                .get_max_concurrent(&agent_id)
                .await
                .unwrap_or(1);
            let current = per_agent.get(&agent_id).copied().unwrap_or(0);
            if current >= max_concurrent {
                debug!(
                    agent = %agent_id,
                    running = current,
                    max = max_concurrent,
                    "agent at max concurrency"
                );
                continue;
            }

            // Resolve per-agent budget override, falling back to global cap.
            let agent = match self.agent_registry.get(&agent_id).await {
                Ok(Some(a)) => a,
                Ok(None) => {
                    warn!(agent_id = %agent_id, task = %task.id, "agent not found; skipping");
                    continue;
                }
                Err(e) => {
                    warn!(agent_id = %agent_id, task = %task.id, error = %e, "agent lookup failed");
                    continue;
                }
            };
            let budget = agent
                .budget_usd
                .unwrap_or(self.config.worker_max_budget_usd);

            // Commit point: flip to InProgress before enqueue. If enqueue
            // fails we reset below so the quest returns to ready on next tick.
            if let Err(e) = self
                .agent_registry
                .update_task_status(&task.id.0, aeqi_quests::QuestStatus::InProgress)
                .await
            {
                warn!(task = %task.id, error = %e, "failed to mark in-progress");
                continue;
            }

            // Resolve creator session from the quest_created event so the
            // completion rail can re-enqueue the result text into that
            // session's queue — which is where session:quest_result fires.
            let creator_session_id = self.lookup_creator_session(&task.id.0).await.ok().flatten();

            // Mint a fresh per-quest session id. Each quest run is its own
            // session row so the UI sidebar surfaces it independently.
            let session_id = uuid::Uuid::new_v4().to_string();
            let payload = QueuedMessage::quest(
                agent_id.clone(),
                task.description.clone(),
                task.id.0.clone(),
                creator_session_id,
                Some(budget),
            );
            let body = match payload.to_payload() {
                Ok(b) => b,
                Err(e) => {
                    warn!(task = %task.id, error = %e, "payload serialize failed; rolling back");
                    let _ = self
                        .agent_registry
                        .update_task_status(&task.id.0, aeqi_quests::QuestStatus::Pending)
                        .await;
                    continue;
                }
            };

            match queue_enqueue(
                self.session_store.clone(),
                self.executor.clone(),
                &session_id,
                &body,
            )
            .await
            {
                Ok(row_id) => {
                    info!(
                        task = %task.id,
                        agent = %agent.name,
                        session = %session_id,
                        row = row_id,
                        budget_usd = budget,
                        "quest enqueued"
                    );
                    *per_agent.entry(agent_id).or_default() += 1;
                    enqueued += 1;
                }
                Err(e) => {
                    warn!(task = %task.id, error = %e, "enqueue failed; rolling back status");
                    let _ = self
                        .agent_registry
                        .update_task_status(&task.id.0, aeqi_quests::QuestStatus::Pending)
                        .await;
                }
            }
        }

        if enqueued > 0 {
            info!(
                enqueued,
                ready = ready.len(),
                elapsed_ms = cycle_start.elapsed().as_millis(),
                "quest enqueue cycle"
            );
        }

        Ok(())
    }

    async fn lookup_creator_session(&self, quest_id: &str) -> Result<Option<String>> {
        let events = self
            .activity_log
            .query(
                &EventFilter {
                    event_type: Some("quest_created".to_string()),
                    quest_id: Some(quest_id.to_string()),
                    ..Default::default()
                },
                1,
                0,
            )
            .await?;
        Ok(events
            .first()
            .and_then(|e| e.content.get("creator_session_id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queue_executor::QueuedMessage;
    use crate::session_store::{PendingClaim, SessionStore};
    use async_trait::async_trait;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct RecordingExecutor {
        calls: Arc<AtomicUsize>,
        last_payload: Arc<Mutex<Option<QueuedMessage>>>,
    }

    #[async_trait]
    impl SessionExecutor for RecordingExecutor {
        async fn execute(&self, _session_id: &str, claim: &PendingClaim) -> Result<()> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let parsed = QueuedMessage::from_payload(&claim.payload)?;
            *self.last_payload.lock().await = Some(parsed);
            Ok(())
        }
    }

    async fn wait_for(counter: &AtomicUsize, target: usize) {
        for _ in 0..50 {
            if counter.load(Ordering::SeqCst) >= target {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    #[tokio::test]
    async fn tick_enqueues_ready_quest_and_flips_status() {
        let dir = tempfile::tempdir().unwrap();
        let reg = Arc::new(AgentRegistry::open(dir.path()).unwrap());
        let session_store = Arc::new(SessionStore::new(reg.sessions_db()));
        let activity_log = Arc::new(ActivityLog::new(reg.sessions_db()));

        let agent = reg.spawn("worker", None, None).await.unwrap();
        let quest = reg
            .create_task(&agent.id, "subj", "desc", &[], &[])
            .await
            .unwrap();

        let calls = Arc::new(AtomicUsize::new(0));
        let last_payload: Arc<Mutex<Option<QueuedMessage>>> = Arc::new(Mutex::new(None));
        let executor: Arc<dyn SessionExecutor> = Arc::new(RecordingExecutor {
            calls: calls.clone(),
            last_payload: last_payload.clone(),
        });

        let enqueuer = QuestEnqueuer::new(
            reg.clone(),
            activity_log,
            session_store,
            executor,
            DispatchConfig::default(),
        );

        enqueuer.tick().await.unwrap();

        let got = reg.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(got.status, aeqi_quests::QuestStatus::InProgress);

        wait_for(&calls, 1).await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let payload = last_payload.lock().await.clone().unwrap();
        assert!(payload.is_quest());
        assert_eq!(payload.quest_id.as_deref(), Some(quest.id.0.as_str()));
        assert_eq!(payload.agent_hint, agent.id);
    }

    #[tokio::test]
    async fn tick_cancels_quest_over_retry_budget() {
        let dir = tempfile::tempdir().unwrap();
        let reg = Arc::new(AgentRegistry::open(dir.path()).unwrap());
        let session_store = Arc::new(SessionStore::new(reg.sessions_db()));
        let activity_log = Arc::new(ActivityLog::new(reg.sessions_db()));

        let agent = reg.spawn("worker", None, None).await.unwrap();
        let quest = reg
            .create_task(&agent.id, "subj", "desc", &[], &[])
            .await
            .unwrap();

        for _ in 0..4 {
            reg.finalize_quest(&quest.id.0, aeqi_quests::QuestStatus::Pending, true)
                .await
                .unwrap();
        }
        let pre = reg.get_task(&quest.id.0).await.unwrap().unwrap();
        assert!(pre.retry_count >= 3);

        let calls = Arc::new(AtomicUsize::new(0));
        struct NullExec(Arc<AtomicUsize>);
        #[async_trait]
        impl SessionExecutor for NullExec {
            async fn execute(&self, _sid: &str, _claim: &PendingClaim) -> Result<()> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        }
        let executor: Arc<dyn SessionExecutor> = Arc::new(NullExec(calls.clone()));

        let enqueuer = QuestEnqueuer::new(
            reg.clone(),
            activity_log,
            session_store,
            executor,
            DispatchConfig::default(),
        );

        enqueuer.tick().await.unwrap();

        let got = reg.get_task(&quest.id.0).await.unwrap().unwrap();
        assert_eq!(got.status, aeqi_quests::QuestStatus::Cancelled);
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(
            calls.load(Ordering::SeqCst),
            0,
            "no enqueue should occur for over-budget quest"
        );
    }

    #[tokio::test]
    async fn tick_respects_global_daily_budget() {
        let dir = tempfile::tempdir().unwrap();
        let reg = Arc::new(AgentRegistry::open(dir.path()).unwrap());
        let session_store = Arc::new(SessionStore::new(reg.sessions_db()));
        let activity_log = Arc::new(ActivityLog::new(reg.sessions_db()));

        let agent = reg.spawn("worker", None, None).await.unwrap();
        reg.create_task(&agent.id, "s", "d", &[], &[])
            .await
            .unwrap();

        activity_log
            .emit(
                "cost",
                None,
                None,
                None,
                &serde_json::json!({"cost_usd": 100.0}),
            )
            .await
            .unwrap();

        let calls = Arc::new(AtomicUsize::new(0));
        struct NullExec(Arc<AtomicUsize>);
        #[async_trait]
        impl SessionExecutor for NullExec {
            async fn execute(&self, _sid: &str, _claim: &PendingClaim) -> Result<()> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }
        }
        let executor: Arc<dyn SessionExecutor> = Arc::new(NullExec(calls.clone()));

        let config = DispatchConfig {
            daily_budget_usd: 10.0,
            ..DispatchConfig::default()
        };
        let enqueuer =
            QuestEnqueuer::new(reg.clone(), activity_log, session_store, executor, config);

        enqueuer.tick().await.unwrap();
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }
}
