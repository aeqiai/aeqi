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

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::{Mutex, mpsc};
use tracing::{debug, info, warn};

use crate::agent_registry::AgentRegistry;
use crate::agent_worker::AgentWorker;
// escalation module still exists but EscalationTracker is no longer used here.
use crate::activity::{Activity, ActivityStream};
use crate::activity_log::{ActivityLog, EventFilter};
use crate::metrics::AEQIMetrics;
use crate::middleware::{
    ClarificationMiddleware, ContextBudgetMiddleware, ContextCompressionMiddleware,
    CostTrackingMiddleware, GraphGuardrailsMiddleware, GuardrailsMiddleware, IdeaRefreshMiddleware,
    LoopDetectionMiddleware, MiddlewareChain, SafetyNetMiddleware, ShellHookMiddleware,
};
use crate::sandbox::{QuestSandbox, SandboxConfig};
use crate::session_manager::SessionManager;
use crate::session_store::SessionStore;
use aeqi_core::traits::{Channel, IdeaStore, Provider, Tool};

/// A running worker with age tracking for timeout detection.
struct TrackedWorker {
    handle: tokio::task::JoinHandle<()>,
    quest_id: String,
    agent_id: String,
    agent_name: String,
    started_at: Instant,
    timeout_secs: u64,
    /// The quest sandbox (worktree) for this worker, if any.
    /// Held here so we can tear down orphaned sandboxes on timeout/abort.
    sandbox: Option<Arc<QuestSandbox>>,
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
    pub gate_channels: Vec<Arc<dyn Channel>>,

    /// Sandbox configuration for quest worktree isolation.
    /// When set, each spawned quest gets its own git worktree.
    pub sandbox_config: Option<SandboxConfig>,

    // Runtime state
    running: Mutex<Vec<TrackedWorker>>,
    /// Last time stale worktrees were pruned.
    last_prune: Mutex<Instant>,

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
            gate_channels: Vec::new(),
            sandbox_config: None,
            running: Mutex::new(Vec::new()),
            last_prune: Mutex::new(Instant::now()),
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
        let mut timed_out: Vec<(String, String, u64, Option<Arc<QuestSandbox>>)> = Vec::new();

        running.retain_mut(|w| {
            if w.handle.is_finished() {
                return false;
            }
            if w.started_at.elapsed() > std::time::Duration::from_secs(w.timeout_secs) {
                w.handle.abort();
                timed_out.push((
                    w.quest_id.clone(),
                    w.agent_name.clone(),
                    w.timeout_secs,
                    w.sandbox.take(),
                ));
                return false;
            }
            true
        });
        drop(running);

        // Handle timed-out workers.
        for (quest_id, agent_name, timeout, sandbox) in &timed_out {
            warn!(task = %quest_id, agent = %agent_name, timeout, "worker timed out");

            // Auto-commit any work in progress before tearing down the sandbox.
            // This preserves partial progress from timed-out quests.
            if let Some(sb) = sandbox {
                let _ = sb.auto_commit(0).await;
                if let Err(e) = sb.teardown().await {
                    warn!(task = %quest_id, error = %e, "failed to tear down sandbox for timed-out worker");
                }
            }

            let _ = self
                .activity_log
                .emit(
                    "decision",
                    None,
                    None,
                    Some(quest_id.as_str()),
                    &serde_json::json!({
                        "decision_type": "WorkerTimedOut",
                        "reasoning": format!("Timed out after {timeout}s"),
                    }),
                )
                .await;

            // Reset task to pending.
            if let Err(e) = self
                .agent_registry
                .update_task_status(quest_id, aeqi_quests::QuestStatus::Pending)
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
                    Some(quest_id.as_str()),
                    &serde_json::json!({
                        "reason": "worker_timed_out_reset",
                    }),
                )
                .await;
        }

        // Periodically prune stale worktrees (every 5 minutes).
        if self.sandbox_config.is_some() {
            let mut last_prune = self.last_prune.lock().await;
            if last_prune.elapsed() > Duration::from_secs(300) {
                *last_prune = Instant::now();
                drop(last_prune);
                self.prune_stale_worktrees().await;
            }
        }
    }

    /// Prune stale worktrees that have no corresponding running quest.
    /// Called periodically from the reap/schedule cycle.
    async fn prune_stale_worktrees(&self) {
        let Some(ref sandbox_cfg) = self.sandbox_config else {
            return;
        };

        // Collect active quest IDs from running workers.
        let running = self.running.lock().await;
        let active_ids: HashSet<String> = running.iter().map(|w| w.quest_id.clone()).collect();
        drop(running);

        // Use running worker IDs as the active set — any worktree not owned
        // by a running worker is stale and safe to prune.
        let all_active = active_ids;

        match crate::sandbox::prune_stale_worktrees(
            &sandbox_cfg.repo_root,
            &sandbox_cfg.worktree_base,
            &all_active,
        )
        .await
        {
            Ok(pruned) if !pruned.is_empty() => {
                info!(count = pruned.len(), "pruned stale worktrees");
            }
            Err(e) => {
                warn!(error = %e, "failed to prune stale worktrees");
            }
            _ => {}
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

        // Assemble prompt from ancestor chain + quest ideas.
        let event_store = crate::event_handler::EventHandlerStore::new(self.agent_registry.db());
        let task_ids = ordered_unique_idea_ids(&task.idea_ids);
        let assembled = crate::idea_assembly::assemble_ideas(
            &self.agent_registry,
            self.idea_store.as_ref(),
            &event_store,
            &agent_id,
            &task_ids,
        )
        .await;
        let system_prompt = assembled.system;

        // Create or reuse a quest sandbox (git worktree) for isolation.
        // Each quest gets its own worktree so parallel quests never conflict.
        let sandbox: Option<Arc<QuestSandbox>> = if let Some(ref sandbox_cfg) = self.sandbox_config
        {
            // Check if quest already has a worktree we can reuse (from a previous attempt).
            let existing_worktree = task
                .worktree_path
                .as_ref()
                .map(PathBuf::from)
                .filter(|p| p.exists());

            let sb_result = if let Some(existing_path) = existing_worktree {
                QuestSandbox::open_existing(
                    &task.id.0,
                    existing_path,
                    sandbox_cfg.repo_root.clone(),
                    sandbox_cfg.enable_bwrap,
                )
            } else {
                // For child quests, fork from parent quest's branch instead of HEAD.
                let mut cfg = sandbox_cfg.clone();
                if let Some(parent_id) = task.id.parent()
                    && let Ok(Some(parent_quest)) = self.agent_registry.get_task(&parent_id.0).await
                    && let Some(ref parent_branch) = parent_quest.worktree_branch
                {
                    cfg.base_ref = parent_branch.clone();
                    info!(
                        quest = %task.id, parent = %parent_id.0,
                        base = %parent_branch, "forking from parent quest branch"
                    );
                }
                QuestSandbox::create(&task.id.0, &cfg).await
            };

            match sb_result {
                Ok(sb) => {
                    // Save worktree path and branch back to quest record.
                    let wt_path = sb.worktree_path.to_string_lossy().to_string();
                    let branch = sb.branch_name.clone();
                    let _ = self
                        .agent_registry
                        .update_task(&task.id.0, |q| {
                            if q.worktree_path.is_none() {
                                q.worktree_path = Some(wt_path);
                                q.worktree_branch = Some(branch);
                            }
                        })
                        .await;
                    Some(Arc::new(sb))
                }
                Err(e) => {
                    warn!(
                        task = %task.id,
                        error = %e,
                        "failed to create quest sandbox — falling back to unsandboxed"
                    );
                    None
                }
            }
        } else {
            None
        };

        // Effective working directory: worktree path if sandboxed, otherwise agent workdir.
        let effective_workdir = sandbox
            .as_ref()
            .map(|s| s.worktree_path.clone())
            .or_else(|| workdir.clone().map(PathBuf::from));

        // Build the AgentWorker.
        let mut worker = match execution_mode.as_str() {
            "claude_code" => {
                let cwd = effective_workdir
                    .clone()
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

        // Inject working directory (worktree path when sandboxed).
        if let Some(ref wd) = effective_workdir {
            worker = worker.with_project_dir(wd.clone());
        }

        // Inject tools for persistent agents.
        if let crate::agent_worker::WorkerExecution::Agent { ref mut tools, .. } = worker.execution
        {
            // Events management tool — always available for persistent agents.
            {
                let ehs = Arc::new(crate::event_handler::EventHandlerStore::new(
                    self.agent_registry.db(),
                ));
                tools.push(Arc::new(crate::tools::EventsTool::new(
                    ehs,
                    agent_id.clone(),
                )));
            }

            // Code tool (transcript search + graph + usage).
            if let Some(ref ss) = self.session_store {
                tools.push(Arc::new(crate::tools::CodeTool::new(
                    None, // graph DB path — resolved per-session in session_manager
                    Some(ss.clone()),
                    None, // api_key not needed for worker transcript search
                )));
            }
        }

        // Build middleware chain.
        let budget = agent
            .budget_usd
            .unwrap_or(self.config.worker_max_budget_usd);
        let mut layers: Vec<Box<dyn crate::middleware::Middleware>> = vec![
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
        ];

        // Add shell hook middleware if hook ideas exist for this agent.
        if let Some(ref store) = self.idea_store {
            let shell_hooks = ShellHookMiddleware::from_idea_store(store, Some(&agent_id)).await;
            if shell_hooks.has_hooks() {
                layers.push(Box::new(shell_hooks));
            }
        }

        let chain = MiddlewareChain::new(layers);
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
                            t.set_quest_outcome(&record);
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
        let worker_sandbox = sandbox.clone();

        let handle = tokio::spawn(async move {
            // Create a run record for this execution.
            let run_id = registry
                .create_run(None, Some(&quest_id), &agent_id_clone, None)
                .await
                .ok();

            let result = worker.execute().await;

            // The on_complete callback already updated task status in AgentRegistry.
            // Here we handle cost recording, expertise, and event broadcasting.
            let (outcome_status, cost_usd, steps) = match result {
                Ok((_quest_outcome, runtime_exec, cost, steps)) => {
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

            // Complete the run record.
            if let Some(ref rid) = run_id {
                let _ = registry
                    .complete_run(rid, outcome_status, cost_usd, steps, None)
                    .await;
            }

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

            // Session resolution: notify creator session and emit quest_result event.
            if let Ok(events) = spawn_activity_log
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
                // Emit quest_result event — fires session:quest_result event handlers.
                let _ = spawn_activity_log
                    .emit(
                        "quest_result",
                        Some(&agent_id_clone),
                        Some(creator_session_id),
                        Some(&quest_id),
                        &serde_json::json!({
                            "quest_id": quest_id,
                            "agent_name": agent_name,
                            "outcome": outcome_status,
                            "cost_usd": cost_usd,
                            "steps": steps,
                            "creator_session_id": creator_session_id,
                        }),
                    )
                    .await;

                // Inject result text into creator session if still running.
                if let Some(ref sm) = session_manager {
                    if sm.is_running(creator_session_id).await {
                        let result_text = format!(
                            "Quest {} completed ({}): {}",
                            quest_id, outcome_status, agent_name,
                        );
                        let _ = sm.send_streaming(creator_session_id, &result_text).await;
                        debug!(
                            task = %quest_id,
                            creator_session = %creator_session_id,
                            "quest_result: notified creator session"
                        );
                    } else {
                        debug!(
                            task = %quest_id,
                            creator_session = %creator_session_id,
                            "quest_result: creator session gone, event emitted for later retrieval"
                        );
                    }
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

            // Sandbox lifecycle: auto-commit work, tear down on terminal outcomes.
            if let Some(ref sb) = worker_sandbox {
                // Always auto-commit to snapshot progress.
                let _ = sb.auto_commit(0).await;

                match outcome_status {
                    // Quest completed successfully — tear down the worktree.
                    // The branch can be merged later from the quest record.
                    "done" | "error" => {
                        if let Err(e) = sb.teardown().await {
                            warn!(
                                task = %quest_id,
                                error = %e,
                                "failed to tear down sandbox after completion"
                            );
                        }
                    }
                    // Blocked/retry — keep the worktree for the next attempt.
                    // The worktree_path is stored on the quest record so a future
                    // worker can reattach via open_existing().
                    _ => {
                        debug!(
                            task = %quest_id,
                            outcome = %outcome_status,
                            "preserving sandbox for retry/resume"
                        );
                    }
                }
            }

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
            sandbox: None,
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

fn ordered_unique_idea_ids(idea_ids: &[String]) -> Vec<String> {
    let mut ordered = Vec::new();
    let mut seen = HashSet::new();

    for idea_id in idea_ids {
        if idea_id.is_empty() {
            continue;
        }
        if seen.insert(idea_id.clone()) {
            ordered.push(idea_id.clone());
        }
    }

    ordered
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

    #[test]
    fn ordered_unique_idea_ids_dedupes_and_preserves_order() {
        let ordered = ordered_unique_idea_ids(&[
            "idea-b".to_string(),
            "idea-a".to_string(),
            "idea-b".to_string(),
            "".to_string(),
        ]);
        assert_eq!(ordered, vec!["idea-b".to_string(), "idea-a".to_string()]);
    }
}
