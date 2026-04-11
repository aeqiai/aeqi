//! Global Scheduler — the single event-driven worker pool.
//!
//! Push-based dispatch: **event → schedule → reap → query → spawn**
//!
//! No patrol timers as primary dispatch. The daemon owns one Scheduler.
//! The Scheduler owns the running workers. Agent properties (workdir, model,
//! budget, concurrency) live on the agent tree in AgentRegistry.
//!
//! Three dispatch paths (all trigger the same schedule() cycle):
//! 1. **ActivityLog broadcast** — `quest_created` / `quest_completed` events
//!    push through a `tokio::broadcast` channel for sub-millisecond dispatch.
//! 2. **Completion channel** — workers report completion via `mpsc` channel,
//!    immediately triggering re-scheduling for dependent tasks.
//! 3. **Safety-net patrol** — 60-second timer catches anything missed.
//!
//! ```text
//! Scheduler
//! ├── event_rx   ← ActivityLog broadcast (quest_created, quest_completed)
//! ├── completion_rx ← worker finished (CompletionEvent)
//! ├── patrol     ← 60s safety net
//! ├── reap()     → clean finished workers, handle timeouts
//! ├── ready()    → query tasks WHERE status=pending AND deps met AND agent not maxed
//! └── spawn()    → tokio::spawn worker for each ready task
//! ```

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::{Mutex, mpsc};
use tracing::{debug, info, warn};

use crate::agent_registry::AgentRegistry;
use crate::agent_worker::AgentWorker;
use crate::escalation::{EscalationPolicy, EscalationTracker};
use crate::activity_log::{EventFilter, ActivityLog};
use crate::activity::{ActivityStream, Activity};
use crate::metrics::AEQIMetrics;
use crate::middleware::{
    ClarificationMiddleware, ContextBudgetMiddleware, ContextCompressionMiddleware,
    CostTrackingMiddleware, GraphGuardrailsMiddleware, GuardrailsMiddleware,
    IdeaRefreshMiddleware, LoopDetectionMiddleware, MiddlewareChain, SafetyNetMiddleware,
};
use crate::session_manager::SessionManager;
use crate::session_store::SessionStore;
use crate::trigger::TriggerStore;
use aeqi_core::traits::{Channel, IdeaStore, Provider, Tool};

/// A running worker with age tracking for timeout detection.
struct TrackedWorker {
    handle: tokio::task::JoinHandle<()>,
    quest_id: String,
    agent_id: String,
    agent_name: String,
    started_at: Instant,
    timeout_secs: u64,
}

/// Configuration for the scheduler.
pub struct SchedulerConfig {
    /// Global max concurrent workers.
    pub max_workers: u32,
    /// Default worker timeout (overridden by agent-level setting).
    pub default_timeout_secs: u64,
    /// Default per-worker budget.
    pub worker_max_budget_usd: f64,
    /// Global daily budget cap (replaces CostLedger daily budget).
    pub daily_budget_usd: f64,
    /// Directories to search for prompt files.
    pub prompt_dirs: Vec<PathBuf>,
    /// Shared primer injected into ALL agents.
    pub shared_primer: Option<String>,
    /// Model for post-execution reflection.
    pub reflect_model: String,
    /// Enable adaptive retry with failure analysis.
    pub adaptive_retry: bool,
    /// Model for failure analysis.
    pub failure_analysis_model: String,
    /// Max task retries before auto-cancel.
    pub max_task_retries: u32,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            max_workers: 4,
            default_timeout_secs: 3600,
            worker_max_budget_usd: 5.0,
            daily_budget_usd: 50.0,
            prompt_dirs: Vec::new(),
            shared_primer: None,
            reflect_model: String::new(),
            adaptive_retry: false,
            failure_analysis_model: String::new(),
            max_task_retries: 3,
        }
    }
}

/// Worker completion event — sent via channel when a worker finishes.
#[derive(Debug)]
pub struct CompletionEvent {
    pub quest_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub outcome: String,
    pub cost_usd: f64,
}

/// The global scheduler — one pool, event-driven, no project scoping.
pub struct Scheduler {
    pub config: SchedulerConfig,

    // Core services
    pub agent_registry: Arc<AgentRegistry>,
    pub provider: Arc<dyn Provider>,
    pub tools: Vec<Arc<dyn Tool>>,
    pub metrics: Arc<AEQIMetrics>,
    pub activity_stream: Arc<ActivityStream>,

    // Optional services
    pub idea_store: Option<Arc<dyn IdeaStore>>,
    pub reflect_provider: Option<Arc<dyn Provider>>,
    pub activity_log: Arc<ActivityLog>,
    pub session_store: Option<Arc<SessionStore>>,
    pub session_manager: Option<Arc<SessionManager>>,
    pub trigger_store: Option<Arc<TriggerStore>>,
    pub gate_channels: Vec<Arc<dyn Channel>>,

    // Runtime state
    running: Mutex<Vec<TrackedWorker>>,
    #[allow(dead_code)]
    escalation_tracker: Mutex<EscalationTracker>,

    // Event-driven dispatch channels
    /// Broadcast receiver for ActivityLog events (quest_created, quest_completed, etc.)
    event_rx: Mutex<tokio::sync::broadcast::Receiver<serde_json::Value>>,
    /// Worker completion channel — sender cloned into each spawned worker.
    completion_tx: mpsc::UnboundedSender<CompletionEvent>,
    /// Worker completion channel — receiver owned by the scheduler loop.
    completion_rx: Mutex<mpsc::UnboundedReceiver<CompletionEvent>>,
}

impl Scheduler {
    pub fn new(
        config: SchedulerConfig,
        agent_registry: Arc<AgentRegistry>,
        provider: Arc<dyn Provider>,
        tools: Vec<Arc<dyn Tool>>,
        metrics: Arc<AEQIMetrics>,
        activity_stream: Arc<ActivityStream>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        // Subscribe to the ActivityLog broadcast for push-based dispatch.
        let event_rx = activity_log.subscribe();
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            config,
            agent_registry,
            provider,
            tools,
            metrics,
            activity_stream,
            idea_store: None,
            reflect_provider: None,
            activity_log,
            session_store: None,
            session_manager: None,
            trigger_store: None,
            gate_channels: Vec::new(),
            running: Mutex::new(Vec::new()),
            escalation_tracker: Mutex::new(EscalationTracker::new(EscalationPolicy {
                max_retries: 4,
                cooldown_secs: 300,
                escalate_model: None,
            })),
            event_rx: Mutex::new(event_rx),
            completion_tx,
            completion_rx: Mutex::new(completion_rx),
        }
    }

    // -----------------------------------------------------------------------
    // Main loop
    // -----------------------------------------------------------------------

    /// Run the scheduler loop. Blocks until shutdown.
    ///
    /// Event-driven: wakes immediately on ActivityLog broadcasts (quest_created,
    /// quest_completed) and worker completion signals.
    /// A 60-second patrol timer acts as a safety net.
    pub async fn run(&self, shutdown: Arc<tokio::sync::Notify>) {
        info!(
            max_workers = self.config.max_workers,
            "scheduler started (event-driven)"
        );
        let mut patrol = tokio::time::interval(Duration::from_secs(60));
        // The first tick completes immediately — run an initial schedule cycle.
        patrol.tick().await;
        if let Err(e) = self.schedule().await {
            warn!(error = %e, "initial schedule cycle failed");
        }

        let mut event_rx = self.event_rx.lock().await;
        let mut completion_rx = self.completion_rx.lock().await;

        loop {
            tokio::select! {
                // Event-driven: wake immediately on relevant ActivityLog events.
                result = event_rx.recv() => {
                    match result {
                        Ok(event) => {
                            let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            match event_type {
                                "quest_created" | "quest_completed" => {
                                    debug!(event_type, "event-driven dispatch triggered");
                                    if let Err(e) = self.schedule().await {
                                        warn!(error = %e, "schedule cycle failed (event-driven)");
                                    }
                                }
                                _ => {} // Ignore non-scheduling events.
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!(skipped = n, "scheduler event receiver lagged");
                            // Catch up by running a schedule cycle.
                            if let Err(e) = self.schedule().await {
                                warn!(error = %e, "schedule cycle failed (lag recovery)");
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            info!("event broadcast channel closed, scheduler stopping");
                            self.shutdown().await;
                            return;
                        }
                    }
                }
                // Worker completion: immediately check for newly ready tasks.
                Some(completion) = completion_rx.recv() => {
                    debug!(
                        quest_id = %completion.quest_id,
                        agent = %completion.agent_name,
                        outcome = %completion.outcome,
                        "worker completion received"
                    );
                    if let Err(e) = self.schedule().await {
                        warn!(error = %e, "schedule cycle failed (completion)");
                    }
                }
                // Safety net patrol (60s) — catch anything missed.
                _ = patrol.tick() => {
                    if let Err(e) = self.schedule().await {
                        warn!(error = %e, "schedule cycle failed (patrol)");
                    }
                }
                _ = shutdown.notified() => {
                    info!("scheduler shutting down");
                    self.shutdown().await;
                    return;
                }
            }
        }
    }

    /// One scheduling cycle: reap → query → spawn.
    pub async fn schedule(&self) -> Result<()> {
        let cycle_start = Instant::now();

        // Phase 1: Reap finished workers + handle timeouts.
        self.reap().await;

        // Phase 2: Get ready tasks.
        let ready = self.agent_registry.ready_tasks().await?;
        if ready.is_empty() {
            return Ok(());
        }

        // Phase 3: Build concurrency map (agent_id -> running count).
        let running = self.running.lock().await;
        let total_running = running.len();
        let mut agent_counts: HashMap<String, u32> = HashMap::new();
        for w in running.iter() {
            *agent_counts.entry(w.agent_id.clone()).or_default() += 1;
        }
        drop(running);

        // Phase 4: Spawn workers for tasks we can run.
        let mut spawned = 0u32;
        for task in &ready {
            // Global worker limit.
            if total_running as u32 + spawned >= self.config.max_workers {
                debug!(
                    running = total_running,
                    max = self.config.max_workers,
                    "global worker limit reached"
                );
                break;
            }

            let agent_id = match &task.agent_id {
                Some(id) => id.clone(),
                None => {
                    warn!(task = %task.id, "quest has no agent_id, skipping");
                    continue;
                }
            };

            // Per-agent concurrency limit.
            let max_concurrent = self
                .agent_registry
                .get_max_concurrent(&agent_id)
                .await
                .unwrap_or(1);
            let current = agent_counts.get(&agent_id).copied().unwrap_or(0);
            if current >= max_concurrent {
                debug!(
                    agent = %agent_id,
                    running = current,
                    max = max_concurrent,
                    "agent at max concurrency"
                );
                continue;
            }

            // Budget check via ActivityLog.
            let daily_cost = self.activity_log.daily_cost().await.unwrap_or(0.0);
            if daily_cost >= self.config.daily_budget_usd {
                debug!(
                    agent = %agent_id,
                    daily_cost,
                    budget = self.config.daily_budget_usd,
                    "global budget exhausted"
                );
                continue;
            }

            // Phase 5: Expertise routing — check if a sibling agent has a better track record.
            // Only reroute if the assigned agent has siblings and expertise data exists.
            if let Ok(expertise) = self.activity_log.query_expertise().await
                && let Ok(Some(assigned)) = self.agent_registry.get(&agent_id).await
            {
                // Find sibling agents (same parent) that could handle this task.
                if let Some(ref parent_id) = assigned.parent_id
                    && let Ok(siblings) = self.agent_registry.get_children(parent_id).await
                {
                    let mut best_agent: Option<(String, f64)> = None;
                    for sibling in &siblings {
                        if sibling.id == agent_id {
                            continue;
                        }
                        // Check if sibling is under concurrency limit.
                        let sib_max = self
                            .agent_registry
                            .get_max_concurrent(&sibling.id)
                            .await
                            .unwrap_or(1);
                        let sib_current = agent_counts.get(&sibling.id).copied().unwrap_or(0);
                        if sib_current >= sib_max {
                            continue;
                        }
                        // Check expertise score.
                        if let Some(score) = expertise.iter().find(|s| {
                            s.get("agent").and_then(|a| a.as_str()) == Some(&sibling.name)
                        }) {
                            let rate = score
                                .get("success_rate")
                                .and_then(|r| r.as_f64())
                                .unwrap_or(0.0);
                            if best_agent
                                .as_ref()
                                .is_none_or(|(_, best_rate)| rate > *best_rate)
                            {
                                best_agent = Some((sibling.id.clone(), rate));
                            }
                        }
                    }
                    // Reassign if a sibling has a significantly better track record.
                    if let Some((better_id, better_rate)) = best_agent {
                        let own_rate = expertise
                            .iter()
                            .find(|s| {
                                s.get("agent").and_then(|a| a.as_str()) == Some(&assigned.name)
                            })
                            .and_then(|s| s.get("success_rate").and_then(|r| r.as_f64()))
                            .unwrap_or(0.0);
                        if better_rate > own_rate + 0.2 {
                            debug!(
                                task = %task.id,
                                from = %agent_id,
                                to = %better_id,
                                own_rate,
                                better_rate,
                                "expertise routing: reassigning to better agent"
                            );
                            // TODO: Update task.agent_id in AgentRegistry to the better agent.
                            // For now just log — full reassignment needs agent_registry.update_task().
                        }
                    }
                }
            }

            // Spawn.
            self.spawn_worker(task).await;
            *agent_counts.entry(agent_id).or_default() += 1;
            spawned += 1;
        }

        if spawned > 0 {
            info!(
                spawned,
                ready = ready.len(),
                elapsed_ms = cycle_start.elapsed().as_millis(),
                "schedule cycle"
            );
        }

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Reap
    // -----------------------------------------------------------------------

    async fn reap(&self) {
        let mut running = self.running.lock().await;
        let mut timed_out = Vec::new();

        running.retain(|w| {
            if w.handle.is_finished() {
                return false;
            }
            if w.started_at.elapsed() > std::time::Duration::from_secs(w.timeout_secs) {
                w.handle.abort();
                timed_out.push((w.quest_id.clone(), w.agent_name.clone(), w.timeout_secs));
                return false;
            }
            true
        });
        drop(running);

        // Handle timed-out workers.
        for (quest_id, agent_name, timeout) in timed_out {
            warn!(task = %quest_id, agent = %agent_name, timeout, "worker timed out");

            let _ = self
                .activity_log
                .emit(
                    "decision",
                    None,
                    None,
                    Some(&quest_id),
                    &serde_json::json!({
                        "decision_type": "WorkerTimedOut",
                        "reasoning": format!("Timed out after {timeout}s"),
                    }),
                )
                .await;

            // Reset task to pending.
            if let Err(e) = self
                .agent_registry
                .update_task_status(&quest_id, aeqi_quests::QuestStatus::Pending)
                .await
            {
                warn!(task = %quest_id, error = %e, "failed to reset timed-out task");
            }

            // Emit event so the broadcast channel triggers re-scheduling.
            let _ = self
                .activity_log
                .emit(
                    "quest_created",
                    None,
                    None,
                    Some(&quest_id),
                    &serde_json::json!({
                        "reason": "worker_timed_out_reset",
                    }),
                )
                .await;
        }
    }

    // -----------------------------------------------------------------------
    // Spawn
    // -----------------------------------------------------------------------

    async fn spawn_worker(&self, task: &aeqi_quests::Quest) {
        let agent_id = match &task.agent_id {
            Some(id) => id.clone(),
            None => return,
        };

        let agent = match self.agent_registry.get(&agent_id).await {
            Ok(Some(a)) => a,
            Ok(None) => {
                warn!(agent_id = %agent_id, "agent not found for task");
                return;
            }
            Err(e) => {
                warn!(agent_id = %agent_id, error = %e, "failed to load agent");
                return;
            }
        };

        // Resolve inherited properties.
        let workdir = self
            .agent_registry
            .resolve_workdir(&agent_id)
            .await
            .ok()
            .flatten();
        let execution_mode = self
            .agent_registry
            .resolve_execution_mode(&agent_id)
            .await
            .unwrap_or_else(|_| "agent".to_string());
        let timeout = self
            .agent_registry
            .resolve_worker_timeout(&agent_id)
            .await
            .unwrap_or(self.config.default_timeout_secs);

        // Mark task as in-progress.
        if let Err(e) = self
            .agent_registry
            .update_task_status(&task.id.0, aeqi_quests::QuestStatus::InProgress)
            .await
        {
            warn!(task = %task.id, error = %e, "failed to mark task in-progress");
            return;
        }

        let worker_name = format!(
            "{}:{}:{}",
            agent.name,
            task.id,
            chrono::Utc::now().timestamp()
        );

        // Assemble prompts from ancestor chain + task.
        let task_prompts: Vec<aeqi_core::PromptEntry> = task
            .skill
            .as_ref()
            .and_then(|skill_name| {
                load_prompt(skill_name, &self.config.prompt_dirs)
                    .map(|prompt| vec![aeqi_core::PromptEntry::task_prepend(prompt)])
            })
            .unwrap_or_default();
        let assembled = crate::prompt_assembly::assemble_prompts(
            &self.agent_registry,
            self.idea_store.as_ref(),
            &agent_id,
            &task_prompts,
        )
        .await;

        // Pass assembled prompt string directly to AgentWorker.
        let system_prompt = assembled.full_system_prompt();

        // Build the AgentWorker.
        let mut worker = match execution_mode.as_str() {
            "claude_code" => {
                let cwd = workdir
                    .clone()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| PathBuf::from("."));
                let budget = agent
                    .budget_usd
                    .unwrap_or(self.config.worker_max_budget_usd);
                AgentWorker::new_claude_code(
                    agent.name.clone(),
                    worker_name.clone(),
                    "global".to_string(),
                    cwd,
                    budget,
                    system_prompt.clone(),
                    self.activity_log.clone(),
                )
            }
            _ => {
                let model = self
                    .agent_registry
                    .resolve_model(&agent_id, "anthropic/claude-sonnet-4-6")
                    .await;
                AgentWorker::new(
                    agent.name.clone(),
                    worker_name.clone(),
                    "global".to_string(),
                    self.provider.clone(),
                    self.tools.clone(),
                    system_prompt,
                    model,
                    self.activity_log.clone(),
                )
            }
        };

        // Inject agent registry for quest tree context.
        worker = worker.with_agent_registry(self.agent_registry.clone());

        // Inject persistent agent identity.
        worker = worker.with_persistent_agent(agent_id.clone());

        // Inject idea store.
        if let Some(ref mem) = self.idea_store {
            worker = worker.with_idea_store(mem.clone());
        }

        // Inject reflection provider.
        if let Some(ref provider) = self.reflect_provider {
            worker = worker.with_reflect(provider.clone(), self.config.reflect_model.clone());
        }

        // Inject working directory.
        if let Some(ref wd) = workdir {
            worker = worker.with_project_dir(PathBuf::from(wd));
        }

        // Prompt is now assembled via assemble_prompts() above.

        // Inject tools for persistent agents.
        if let crate::agent_worker::WorkerExecution::Agent { ref mut tools, .. } = worker.execution
        {
            // Trigger management tool.
            if agent
                .capabilities
                .iter()
                .any(|c| c == "events_manage" || c == "manage_triggers")
                && let Some(ref ts) = self.trigger_store
            {
                tools.push(Arc::new(crate::tools::TriggerManageTool::new(
                    ts.clone(),
                    agent_id.clone(),
                )));
            }

            // Transcript search tool.
            if let Some(ref ss) = self.session_store {
                tools.push(Arc::new(crate::tools::TranscriptSearchTool::new(
                    ss.clone(),
                )));
            }
        }

        // Build middleware chain.
        let budget = agent
            .budget_usd
            .unwrap_or(self.config.worker_max_budget_usd);
        let chain = MiddlewareChain::new(vec![
            Box::new(LoopDetectionMiddleware::new()),
            Box::new(CostTrackingMiddleware::new(budget)),
            Box::new(ContextBudgetMiddleware::new(200)),
            Box::new(GraphGuardrailsMiddleware::new(
                &dirs::home_dir().unwrap_or_default().join(".aeqi"),
            )),
            Box::new(GuardrailsMiddleware::with_defaults()),
            Box::new(ContextCompressionMiddleware::new()),
            Box::new(IdeaRefreshMiddleware::new()),
            Box::new(ClarificationMiddleware::new()),
            Box::new(SafetyNetMiddleware::new()),
        ]);
        worker.set_middleware(chain);

        // Inject event broadcaster.
        worker.set_broadcaster(self.activity_stream.clone());

        // Inject session store.
        if let Some(ref ss) = self.session_store {
            worker.session_store = Some(ss.clone());
        }

        // Inject blackboard.
        worker = worker.with_max_task_retries(self.config.max_task_retries);

        // Build completion callback — updates AgentRegistry task status.
        let cb_registry = self.agent_registry.clone();
        let cb_quest_id = task.id.0.clone();
        worker.on_complete = Some(Box::new(move |status, outcome| {
            let registry = cb_registry;
            let quest_id = cb_quest_id;
            tokio::spawn(async move {
                match status {
                    aeqi_quests::QuestStatus::Done
                    | aeqi_quests::QuestStatus::Blocked
                    | aeqi_quests::QuestStatus::Cancelled => {
                        let _ = registry.update_task_status(&quest_id, status).await;
                    }
                    aeqi_quests::QuestStatus::Pending => {
                        let _ = registry
                            .update_task(&quest_id, |t| {
                                t.status = aeqi_quests::QuestStatus::Pending;
                                t.retry_count += 1;
                            })
                            .await;
                    }
                    _ => {
                        let _ = registry.update_task_status(&quest_id, status).await;
                    }
                }
                if let Some(record) = outcome {
                    let _ = registry
                        .update_task(&quest_id, |t| {
                            t.set_task_outcome(&record);
                        })
                        .await;
                }
            });
        }));

        // Assign the task to the worker.
        worker.assign(task);

        // Spawn the worker as a background task.
        let quest_id = task.id.0.clone();
        let agent_name = agent.name.clone();
        let agent_id_clone = agent_id.clone();
        let registry = self.agent_registry.clone();
        let spawn_activity_log = self.activity_log.clone();
        let activity_stream = self.activity_stream.clone();
        let completion_tx = self.completion_tx.clone();
        let session_manager = self.session_manager.clone();

        let handle = tokio::spawn(async move {
            let result = worker.execute().await;

            // The on_complete callback already updated task status in AgentRegistry.
            // Here we handle cost recording, expertise, and event broadcasting.
            let (outcome_status, cost_usd, steps) = match result {
                Ok((_task_outcome, runtime_exec, cost, steps)) => {
                    // Record cost as an event in the unified ActivityLog.
                    let _ = spawn_activity_log
                        .emit(
                            "cost",
                            Some(&agent_id_clone),
                            None,
                            Some(&quest_id),
                            &serde_json::json!({
                                "project": "global",
                                "agent_name": agent_name,
                                "cost_usd": cost,
                                "steps": steps,
                            }),
                        )
                        .await;
                    let status = match runtime_exec.outcome.status {
                        crate::runtime::RuntimeOutcomeStatus::Done => "done",
                        crate::runtime::RuntimeOutcomeStatus::Blocked => "blocked",
                        crate::runtime::RuntimeOutcomeStatus::Handoff
                        | crate::runtime::RuntimeOutcomeStatus::Failed => "retry",
                    };
                    (status, cost, steps)
                }
                Err(e) => {
                    warn!(task = %quest_id, error = %e, "worker execution failed");
                    ("error", 0.0, 0)
                }
            };

            // Record task completion in unified activity log.
            let _ = spawn_activity_log
                .emit(
                    "quest_completed",
                    Some(&agent_id_clone),
                    None,
                    Some(&quest_id),
                    &serde_json::json!({
                        "agent_name": agent_name,
                        "outcome": outcome_status,
                        "cost_usd": cost_usd,
                        "steps": steps,
                    }),
                )
                .await;

            // Session resolution: notify creator session of task completion.
            if let Some(ref sm) = session_manager
                && let Ok(events) = spawn_activity_log
                    .query(
                        &EventFilter {
                            event_type: Some("quest_created".to_string()),
                            quest_id: Some(quest_id.clone()),
                            ..Default::default()
                        },
                        1,
                        0,
                    )
                    .await
                && let Some(creation_event) = events.first()
                && let Some(creator_session_id) = creation_event
                    .content
                    .get("creator_session_id")
                    .and_then(|v| v.as_str())
            {
                if sm.is_running(creator_session_id).await {
                    let result_text = format!(
                        "Quest {} completed ({}): {}",
                        quest_id, outcome_status, agent_name,
                    );
                    // Fire-and-forget: inject result into creator session.
                    let _ = sm.send_streaming(creator_session_id, &result_text).await;
                    debug!(
                        task = %quest_id,
                        creator_session = %creator_session_id,
                        "session resolution: notified creator session"
                    );
                } else {
                    debug!(
                        task = %quest_id,
                        creator_session = %creator_session_id,
                        "session resolution: creator session gone, cascade handles it"
                    );
                }
            }

            let _ = registry.record_session(&agent_id_clone, 0).await;

            activity_stream.publish(Activity::QuestCompleted {
                quest_id: quest_id.clone(),
                outcome: outcome_status.to_string(),
                confidence: 0.0,
                cost_usd,
                steps,
                duration_ms: 0,
                runtime: None,
            });

            info!(
                task = %quest_id,
                agent = %agent_name,
                outcome = %outcome_status,
                cost_usd,
                "worker completed"
            );

            // Send completion event for immediate re-scheduling.
            // The quest_completed event broadcast from emit() above also triggers
            // the scheduler, but the completion channel is a direct, guaranteed path.
            let _ = completion_tx.send(CompletionEvent {
                quest_id: quest_id.clone(),
                agent_id: agent_id_clone.clone(),
                agent_name: agent_name.to_string(),
                outcome: outcome_status.to_string(),
                cost_usd,
            });
        });

        // Track the running worker.
        self.running.lock().await.push(TrackedWorker {
            handle,
            quest_id: task.id.0.clone(),
            agent_id,
            agent_name: agent.name.clone(),
            started_at: Instant::now(),
            timeout_secs: timeout,
        });

        info!(
            task = %task.id,
            agent = %agent.name,
            timeout,
            "worker spawned"
        );
    }

    // -----------------------------------------------------------------------
    // Status & queries
    // -----------------------------------------------------------------------

    /// Number of currently running workers.
    pub async fn active_count(&self) -> usize {
        self.running.lock().await.len()
    }

    /// Running worker counts per agent.
    pub async fn agent_counts(&self) -> HashMap<String, u32> {
        let running = self.running.lock().await;
        let mut counts = HashMap::new();
        for w in running.iter() {
            *counts.entry(w.agent_name.clone()).or_default() += 1;
        }
        counts
    }

    /// Get status of all running workers.
    pub async fn worker_status(&self) -> Vec<serde_json::Value> {
        let running = self.running.lock().await;
        running
            .iter()
            .map(|w| {
                serde_json::json!({
                    "quest_id": w.quest_id,
                    "agent_id": w.agent_id,
                    "agent_name": w.agent_name,
                    "running_secs": w.started_at.elapsed().as_secs(),
                    "timeout_secs": w.timeout_secs,
                })
            })
            .collect()
    }

    // -----------------------------------------------------------------------
    // Shutdown
    // -----------------------------------------------------------------------

    async fn shutdown(&self) {
        let mut running = self.running.lock().await;
        info!(workers = running.len(), "aborting running workers");
        for w in running.drain(..) {
            w.handle.abort();
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Load a prompt from prompt directories.
fn load_prompt(prompt_name: &str, prompt_dirs: &[PathBuf]) -> Option<String> {
    for dir in prompt_dirs {
        let path = dir.join(format!("{prompt_name}.md"));
        if let Ok(prompt) = aeqi_tools::Prompt::load(&path) {
            let mut text = prompt.body;
            if !prompt.tools.is_empty() || !prompt.deny.is_empty() {
                text.push_str("\n\n## Tool Restrictions");
                if !prompt.tools.is_empty() {
                    text.push_str(&format!(
                        "\nYou may ONLY use these tools: {}",
                        prompt.tools.join(", ")
                    ));
                }
                if !prompt.deny.is_empty() {
                    text.push_str(&format!("\nYou must NOT use: {}", prompt.deny.join(", ")));
                }
            }
            return Some(text);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scheduler_config_defaults() {
        let config = SchedulerConfig::default();
        assert_eq!(config.max_workers, 4);
        assert_eq!(config.default_timeout_secs, 3600);
        assert_eq!(config.worker_max_budget_usd, 5.0);
        assert!((config.daily_budget_usd - 50.0).abs() < 0.01);
    }
}
