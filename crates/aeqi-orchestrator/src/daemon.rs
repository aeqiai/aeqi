use anyhow::Result;
use chrono::Utc;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::agent_registry::AgentRegistry;
use crate::activity_log::{ActivityLog, Dispatch, DispatchHealth};
use crate::trigger::TriggerStore;
use crate::activity::{ActivityStream, Activity};
use crate::message_router::MessageRouter;
use crate::metrics::AEQIMetrics;
use crate::progress_tracker::ProgressTracker;
use crate::scheduler::Scheduler;
use crate::session_manager::SessionManager;
use crate::session_store::{SessionStore, agency_chat_id, named_channel_chat_id, project_chat_id};


const MAX_EVENT_BUFFER_LEN: usize = 512;

#[derive(Debug, Clone, Default)]
pub struct ReadinessContext {
    pub configured_projects: usize,
    pub configured_advisors: usize,
    pub skipped_projects: Vec<String>,
    pub skipped_advisors: Vec<String>,
}

#[derive(Debug, Clone)]
struct BufferedActivity {
    cursor: u64,
    event: Activity,
}

#[derive(Debug, Clone)]
pub struct EventReadResult {
    pub events: Vec<Activity>,
    pub next_cursor: u64,
    pub oldest_cursor: u64,
    pub reset: bool,
}

#[derive(Debug, Default)]
pub struct ActivityBuffer {
    next_cursor: u64,
    events: Vec<BufferedActivity>,
}

impl ActivityBuffer {
    fn push(&mut self, event: Activity) {
        let cursor = self.next_cursor;
        self.next_cursor = self.next_cursor.saturating_add(1);
        self.events.push(BufferedActivity { cursor, event });

        let overflow = self.events.len().saturating_sub(MAX_EVENT_BUFFER_LEN);
        if overflow > 0 {
            self.events.drain(..overflow);
        }
    }

    pub fn read_since(&self, cursor: Option<u64>) -> EventReadResult {
        let oldest_cursor = self
            .events
            .first()
            .map(|event| event.cursor)
            .unwrap_or(self.next_cursor);
        let requested_cursor = cursor.unwrap_or(oldest_cursor);
        let reset = requested_cursor < oldest_cursor;
        let effective_cursor = if reset {
            oldest_cursor
        } else {
            requested_cursor.min(self.next_cursor)
        };

        let events = self
            .events
            .iter()
            .filter(|event| event.cursor >= effective_cursor)
            .map(|event| event.event.clone())
            .collect();

        EventReadResult {
            events,
            next_cursor: self.next_cursor,
            oldest_cursor,
            reset,
        }
    }
}

pub fn request_field<'a>(request: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    request
        .get(key)
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
}

async fn record_assistant_complete(
    session_store: &Option<Arc<SessionStore>>,
    session_id: Option<&str>,
    prompt_tokens: u32,
    completion_tokens: u32,
    cost_usd: f64,
    iterations: u32,
    duration_ms: u64,
) {
    let Some(cs) = session_store.as_ref() else {
        return;
    };
    let Some(sid) = session_id else {
        return;
    };
    let meta = serde_json::json!({
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd": cost_usd,
        "iterations": iterations,
        "duration_ms": duration_ms,
    });
    let _ = cs
        .record_event_by_session(
            sid,
            "assistant_complete",
            "system",
            "",
            Some("web"),
            Some(&meta),
        )
        .await;
}

pub fn resolve_web_chat_id(
    explicit_chat_id: Option<i64>,
    project_hint: Option<&str>,
    channel_name: Option<&str>,
) -> i64 {
    if let Some(chat_id) = explicit_chat_id {
        return chat_id;
    }

    if let Some(project) = project_hint {
        return project_chat_id(project);
    }

    if let Some(name) = channel_name {
        if name.eq_ignore_ascii_case("aeqi") {
            return agency_chat_id();
        }
        return named_channel_chat_id(name);
    }

    agency_chat_id()
}

pub fn task_snapshot(task: &aeqi_quests::Quest) -> serde_json::Value {
    serde_json::json!({
        "id": task.id.0,
        "subject": task.name,
        "status": task.status.to_string(),
        "runtime": task.runtime(),
        "outcome": task.task_outcome(),
    })
}

pub fn merge_timeline_metadata(
    metadata: Option<&serde_json::Value>,
    task: Option<serde_json::Value>,
) -> Option<serde_json::Value> {
    match (metadata.cloned(), task) {
        (None, None) => None,
        (Some(mut metadata), Some(task)) => {
            if let Some(object) = metadata.as_object_mut() {
                object.insert("task".to_string(), task);
                Some(metadata)
            } else {
                Some(serde_json::json!({
                    "raw": metadata,
                    "task": task,
                }))
            }
        }
        (Some(metadata), None) => Some(metadata),
        (None, Some(task)) => Some(serde_json::json!({ "task": task })),
    }
}

pub async fn find_task_snapshot(
    agent_registry: &Arc<AgentRegistry>,
    quest_id: &str,
) -> Option<serde_json::Value> {
    agent_registry
        .get_task(quest_id)
        .await
        .ok()
        .flatten()
        .map(|t| task_snapshot(&t))
}

pub fn attach_chat_id(mut payload: serde_json::Value, chat_id: i64) -> serde_json::Value {
    payload["chat_id"] = serde_json::json!(chat_id);
    payload
}

/// Context struct bundling shared service references for IPC handlers.
/// Avoids passing many individual parameters to socket_accept_loop / handle_socket_connection.
struct IpcContext {
    metrics: Arc<AEQIMetrics>,
    activity_log: Arc<ActivityLog>,
    session_store: Option<Arc<SessionStore>>,
    leader_agent_name: String,
    daily_budget_usd: f64,
    project_budgets: std::collections::HashMap<String, f64>,
    prompt_loader: Option<Arc<crate::prompt_loader::PromptLoader>>,
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
}

/// The Daemon: background process that runs the scheduler patrol loop
/// and trigger system.
pub struct Daemon {
    pub metrics: Arc<AEQIMetrics>,
    pub activity_log: Arc<ActivityLog>,
    pub session_store: Option<Arc<SessionStore>>,
    pub leader_agent_name: String,
    pub shared_primer: Option<String>,
    pub project_primer: Option<String>,
    pub patrol_interval_secs: u64,
    pub background_automation_enabled: bool,
    pub trigger_store: Option<Arc<crate::trigger::TriggerStore>>,
    pub agent_registry: Arc<AgentRegistry>,
    pub message_router: Option<Arc<MessageRouter>>,
    pub write_queue: Arc<std::sync::Mutex<aeqi_ideas::debounce::WriteQueue>>,
    pub activity_stream: Arc<ActivityStream>,
    pub default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    pub default_model: String,
    activity_buffer: Arc<Mutex<ActivityBuffer>>,
    pub session_manager: Arc<SessionManager>,
    pub pid_file: Option<PathBuf>,
    pub socket_path: Option<PathBuf>,
    session_tracker_shutdown: Option<Arc<tokio::sync::Notify>>,
    running: Arc<std::sync::atomic::AtomicBool>,
    config_reloaded: Arc<std::sync::atomic::AtomicBool>,
    shutdown_notify: Arc<tokio::sync::Notify>,
    readiness: ReadinessContext,
    /// Global daily budget cap.
    pub daily_budget_usd: f64,
    /// Per-project budget caps.
    pub project_budgets: std::collections::HashMap<String, f64>,
    /// Global scheduler for the unified schedule() loop.
    pub scheduler: Arc<Scheduler>,
    /// Unified prompt loader.
    pub prompt_loader: Option<Arc<crate::prompt_loader::PromptLoader>>,
    /// Event handler store (the fourth primitive).
    pub event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
}

impl Daemon {
    pub fn new(
        metrics: Arc<AEQIMetrics>,
        scheduler: Arc<Scheduler>,
        agent_registry: Arc<AgentRegistry>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            metrics,
            activity_log,
            session_store: None,
            leader_agent_name: String::new(),
            shared_primer: None,
            project_primer: None,
            patrol_interval_secs: 30,
            background_automation_enabled: true,
            trigger_store: None,
            agent_registry,
            message_router: None,
            write_queue: Arc::new(std::sync::Mutex::new(
                aeqi_ideas::debounce::WriteQueue::default(),
            )),
            activity_stream: Arc::new(ActivityStream::new()),
            default_provider: None,
            default_model: String::new(),
            activity_buffer: Arc::new(Mutex::new(ActivityBuffer::default())),
            session_manager: Arc::new(SessionManager::new()),
            pid_file: None,
            socket_path: None,
            session_tracker_shutdown: None,
            running: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            config_reloaded: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            shutdown_notify: Arc::new(tokio::sync::Notify::new()),
            readiness: ReadinessContext::default(),
            daily_budget_usd: 50.0,
            project_budgets: std::collections::HashMap::new(),
            scheduler,
            prompt_loader: None,
            event_handler_store: None,
        }
    }

    pub fn set_background_automation_enabled(&mut self, enabled: bool) {
        self.background_automation_enabled = enabled;
    }

    // fire_trigger, consume_agent_dispatches, process_agent_dispatches — DELETED.
    // Trigger firing replaced by EventMatcher. Dispatch consumption replaced by direct delegation.

    /// Start the session tracker in a dedicated tokio::spawn.
    /// Returns the shutdown Notify so it can be stopped later.
    pub fn start_session_tracker(&mut self, tracker: ProgressTracker) {
        let shutdown = Arc::new(tokio::sync::Notify::new());
        let shutdown_clone = shutdown.clone();
        tokio::spawn(async move {
            tracker.run(shutdown_clone).await;
        });
        self.session_tracker_shutdown = Some(shutdown);
        info!("session tracker launched");
    }

    /// Stop the session tracker if running.
    pub fn stop_session_tracker(&mut self) {
        if let Some(notify) = self.session_tracker_shutdown.take() {
            notify.notify_waiters();
            info!("session tracker stopped");
        }
    }

    /// Set the trigger store for agent-owned triggers.
    pub fn set_trigger_store(&mut self, store: Arc<crate::trigger::TriggerStore>) {
        self.trigger_store = Some(store);
    }

    /// Set a PID file path (written on start, removed on stop).
    pub fn set_pid_file(&mut self, path: PathBuf) {
        self.pid_file = Some(path);
    }

    /// Set a Unix socket path for IPC.
    pub fn set_socket_path(&mut self, path: PathBuf) {
        self.socket_path = Some(path);
    }

    pub fn set_readiness_context(
        &mut self,
        configured_projects: usize,
        configured_advisors: usize,
        skipped_projects: Vec<String>,
        skipped_advisors: Vec<String>,
    ) {
        self.readiness = ReadinessContext {
            configured_projects,
            configured_advisors,
            skipped_projects,
            skipped_advisors,
        };
    }

    /// Write PID file.
    fn write_pid_file(&self) -> Result<()> {
        if let Some(ref path) = self.pid_file {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(path, std::process::id().to_string())?;
        }
        Ok(())
    }

    /// Remove PID file.
    fn remove_pid_file(&self) {
        if let Some(ref path) = self.pid_file {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Check if a daemon is already running by reading the PID file.
    pub fn is_running_from_pid(pid_path: &Path) -> bool {
        if let Ok(content) = std::fs::read_to_string(pid_path)
            && let Ok(pid) = content.trim().parse::<u32>()
        {
            // Check if process exists.
            return Path::new(&format!("/proc/{pid}")).exists();
        }
        false
    }

    /// Start the daemon loop with graceful shutdown on Ctrl+C.
    /// Main daemon entry point. Spawns background services, then runs the patrol loop.
    pub async fn run(&mut self) -> Result<()> {
        self.running
            .store(true, std::sync::atomic::Ordering::SeqCst);

        self.write_pid_file()?;

        self.spawn_signal_handlers();
        self.spawn_activity_buffer();
        self.spawn_event_matcher();
        self.spawn_schedule_timer();
        self.spawn_ipc_listener();
        self.load_persisted_state().await;

        // Crash recovery: reset stale in_progress quests from previous run.
        match self.agent_registry.reset_stale_in_progress().await {
            Ok(count) if count > 0 => {
                info!(count, "reset stale in_progress quests from previous run");
            }
            Err(e) => {
                warn!(error = %e, "failed to reset stale quests");
            }
            _ => {}
        }

        info!(triggers = self.trigger_store.is_some(), "daemon started");

        self.run_patrol_loop().await;

        self.stop_session_tracker();
        self.remove_pid_file();
        self.remove_socket_file();
        info!("daemon stopped");
        Ok(())
    }

    /// Spawn OS signal handlers: Ctrl+C, SIGHUP (config reload), SIGTERM (graceful shutdown).
    fn spawn_signal_handlers(&self) {
        let running = self.running.clone();
        let shutdown_notify = self.shutdown_notify.clone();
        tokio::spawn(async move {
            if let Ok(()) = tokio::signal::ctrl_c().await {
                info!("received Ctrl+C, shutting down...");
                running.store(false, std::sync::atomic::Ordering::SeqCst);
                shutdown_notify.notify_waiters();
            }
        });

        #[cfg(unix)]
        {
            let config_reloaded = self.config_reloaded.clone();
            tokio::spawn(async move {
                let mut signal =
                    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup()) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::error!("failed to register SIGHUP handler: {e}");
                            return;
                        }
                    };
                loop {
                    signal.recv().await;
                    info!("received SIGHUP, flagging config reload");
                    config_reloaded.store(true, std::sync::atomic::Ordering::SeqCst);
                }
            });
        }

        #[cfg(unix)]
        {
            let running = self.running.clone();
            let shutdown_notify = self.shutdown_notify.clone();
            tokio::spawn(async move {
                let mut signal =
                    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::error!("failed to register SIGTERM handler: {e}");
                            return;
                        }
                    };
                signal.recv().await;
                info!("received SIGTERM, shutting down...");
                running.store(false, std::sync::atomic::Ordering::SeqCst);
                shutdown_notify.notify_waiters();
            });
        }
    }

    /// Spawn background listeners for event triggers and execution event buffering.
    fn spawn_activity_buffer(&self) {
        // Activity buffer — collects activities for the dashboard API.
        {
            let activity_buffer = self.activity_buffer.clone();
            let mut rx = self.activity_stream.subscribe();
            tokio::spawn(async move {
                loop {
                    match rx.recv().await {
                        Ok(event) => {
                            let mut buffer = activity_buffer.lock().await;
                            buffer.push(event);
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!(
                                skipped = n,
                                "event buffer subscriber lagged — events dropped"
                            );
                            continue;
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }
    }

    /// Spawn the EventMatcher — subscribes to activity stream and fires event handlers.
    fn spawn_event_matcher(&self) {
        let Some(ref ehs) = self.event_handler_store else {
            return;
        };
        let matcher = Arc::new(crate::event_matcher::EventMatcher::new(
            ehs.clone(),
            self.agent_registry.clone(),
            self.activity_log.clone(),
        ));
        let mut rx = self.activity_log.subscribe();

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event_json) => {
                        let event_type = event_json
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let agent_id = event_json.get("agent_id").and_then(|v| v.as_str());
                        let quest_id = event_json.get("quest_id").and_then(|v| v.as_str());

                        matcher
                            .match_activity(event_type, agent_id, quest_id, &event_json)
                            .await;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(skipped = n, "event matcher lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        });
        info!("event matcher spawned");
    }

    /// Spawn the ScheduleTimer — fires schedule-type events at precise times.
    fn spawn_schedule_timer(&self) {
        let Some(ref ehs) = self.event_handler_store else {
            return;
        };
        let timer = crate::schedule_timer::ScheduleTimer::new(
            ehs.clone(),
            self.agent_registry.clone(),
            self.activity_log.clone(),
        );
        let shutdown = self.shutdown_notify.clone();
        tokio::spawn(async move {
            timer.run(shutdown).await;
        });
    }

    /// Bind the Unix socket for IPC queries (if configured).
    #[cfg(unix)]
    fn spawn_ipc_listener(&self) {
        let Some(ref sock_path) = self.socket_path else {
            return;
        };
        let _ = std::fs::remove_file(sock_path);
        if let Some(parent) = sock_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match tokio::net::UnixListener::bind(sock_path) {
            Ok(listener) => {
                let ipc_ctx = Arc::new(IpcContext {
                    metrics: self.metrics.clone(),
                    activity_log: self.activity_log.clone(),
                    session_store: self.session_store.clone(),
                    leader_agent_name: self.leader_agent_name.clone(),
                    daily_budget_usd: self.daily_budget_usd,
                    project_budgets: self.project_budgets.clone(),
                    prompt_loader: self.prompt_loader.clone(),
                    event_handler_store: self.event_handler_store.clone(),
                });
                let dispatch_es = self.activity_log.clone();
                let trigger_store = self.trigger_store.clone();
                let agent_registry = self.agent_registry.clone();
                let message_router = self.message_router.clone();
                let activity_buffer = self.activity_buffer.clone();
                let running = self.running.clone();
                let readiness = self.readiness.clone();
                let default_provider = self.default_provider.clone();
                let default_model = self.default_model.clone();
                let session_manager = self.session_manager.clone();
                let activity_stream = self.activity_stream.clone();
                let scheduler = self.scheduler.clone();
                info!(path = %sock_path.display(), "IPC socket listening");
                tokio::spawn(async move {
                    Self::socket_accept_loop(
                        listener,
                        ipc_ctx,
                        dispatch_es,
                        trigger_store,
                        agent_registry,
                        message_router,
                        activity_buffer,
                        running,
                        readiness,
                        default_provider,
                        default_model,
                        session_manager,
                        activity_stream,
                        scheduler,
                    )
                    .await;
                });
            }
            Err(e) => {
                warn!(error = %e, path = %sock_path.display(), "failed to bind IPC socket");
            }
        }
    }

    #[cfg(not(unix))]
    fn spawn_ipc_listener(&self) {
        // IPC over Unix sockets is not supported on non-unix platforms.
    }

    /// Load persisted state (dispatch bus, cost ledger) from disk.
    async fn load_persisted_state(&self) {
        match self.activity_log.load_dispatches().await {
            Ok(n) if n > 0 => info!(count = n, "loaded persisted dispatches"),
            Ok(_) => {}
            Err(e) => warn!(error = %e, "failed to load dispatch bus"),
        }
        // Cost entries are now stored in ActivityLog (SQLite) — no JSONL load needed.
    }

    /// Run one patrol iteration: triggers, config reload, persistence, metrics, pruning.
    async fn run_patrol_iteration(&mut self) {
        // 1. Patrol cycle: unified scheduler handles reap -> query -> spawn.
        if let Err(e) = self.scheduler.schedule().await {
            warn!(error = %e, "scheduler cycle failed");
        }

        // Dispatch consumption and trigger firing are now handled by
        // EventMatcher and ScheduleTimer (spawned as background tasks).

        // 2. Check for config reload signal (SIGHUP).
        if self
            .config_reloaded
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            self.apply_config_reload().await;
        }

        // 4. Update daily cost gauge.
        let spent = self.activity_log.daily_cost().await.unwrap_or(0.0);
        self.metrics.daily_cost_usd.set(spent);

        // 5. Prune old cost events (older than 7 days).
        let cutoff = chrono::Utc::now() - chrono::Duration::days(7);
        if let Err(e) = self.activity_log.prune("cost", &cutoff).await {
            warn!(error = %e, "failed to prune old cost events");
        }

        // 8. Flush debounced memory writes to project memory stores.
        self.flush_debounced_writes().await;

        // 10. Reap dead sessions (agent loops that exited on their own).
        self.session_manager.reap_dead().await;
    }

    /// Handle SIGHUP config reload: apply budgets, patrol interval.
    async fn apply_config_reload(&mut self) {
        info!("config reload requested (SIGHUP received)");
        match aeqi_core::config::AEQIConfig::discover() {
            Ok((new_config, path)) => {
                self.daily_budget_usd = new_config.security.max_cost_per_day_usd;

                for pcfg in &new_config.agent_spawns {
                    if let Some(budget) = pcfg.max_cost_per_day_usd {
                        self.project_budgets.insert(pcfg.name.clone(), budget);
                    }
                }

                if let Some(interval) = new_config.aeqi.patrol_interval_secs {
                    self.patrol_interval_secs = interval;
                }

                info!(path = %path.display(), "config reloaded and applied via SIGHUP");
            }
            Err(e) => {
                warn!(error = %e, "failed to reload config, keeping current");
            }
        }
    }

    /// Drain the debounced write queue and persist entries to project memory stores.
    async fn flush_debounced_writes(&self) {
        let ready = match self.write_queue.lock() {
            Ok(mut wq) => wq.drain_ready(chrono::Utc::now()),
            Err(_) => Vec::new(),
        };
        if ready.is_empty() {
            return;
        }

        info!(count = ready.len(), "flushing debounced memory writes");
        let Some(ref engine) = self.message_router else {
            return;
        };
        for w in &ready {
            if let Some(mem) = engine.idea_store.as_ref() {
                let category = match w.category.as_str() {
                    "fact" => aeqi_core::traits::IdeaCategory::Fact,
                    "procedure" => aeqi_core::traits::IdeaCategory::Procedure,
                    "preference" => aeqi_core::traits::IdeaCategory::Preference,
                    "context" => aeqi_core::traits::IdeaCategory::Context,
                    _ => aeqi_core::traits::IdeaCategory::Fact,
                };
                match mem.store(&w.key, &w.content, category, None).await {
                    Ok(id) => debug!(
                        project = %w.project,
                        id = %id,
                        key = %w.key,
                        "debounced write persisted"
                    ),
                    Err(e) => warn!(
                        project = %w.project,
                        key = %w.key,
                        "debounced write failed: {e}"
                    ),
                }
            } else {
                debug!(
                    project = %w.project,
                    key = %w.key,
                    "no idea store available — write dropped"
                );
            }
        }
    }

    /// The main patrol loop: event-driven with a safety-net patrol timer.
    ///
    /// Primary dispatch is push-based via ActivityLog broadcast: when quest_created
    /// or quest_completed events arrive, schedule() runs immediately (sub-ms).
    /// The full patrol iteration (triggers, metrics, pruning, etc.) runs on a
    /// 60-second timer as housekeeping.
    async fn run_patrol_loop(&mut self) {
        let mut event_rx = self.activity_log.subscribe();
        let mut patrol = tokio::time::interval(std::time::Duration::from_secs(60));
        // Run an initial full patrol iteration on startup.
        self.run_patrol_iteration().await;

        while self.running.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::select! {
                // Event-driven: wake immediately on scheduling-relevant events.
                result = event_rx.recv() => {
                    match result {
                        Ok(event) => {
                            let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
                            match event_type {
                                "quest_created" | "quest_completed" => {
                                    debug!(event_type, "event-driven patrol dispatch");
                                    if let Err(e) = self.scheduler.schedule().await {
                                        warn!(error = %e, "schedule cycle failed (event-driven)");
                                    }
                                }
                                _ => {} // Ignore non-scheduling events.
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!(skipped = n, "daemon event receiver lagged");
                            if let Err(e) = self.scheduler.schedule().await {
                                warn!(error = %e, "schedule cycle failed (lag recovery)");
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            info!("event broadcast channel closed");
                            break;
                        }
                    }
                }
                // Safety-net patrol (60s): full housekeeping iteration.
                _ = patrol.tick() => {
                    self.run_patrol_iteration().await;
                }
                _ = self.shutdown_notify.notified() => break,
            }
        }
    }

    /// Remove Unix socket file.
    fn remove_socket_file(&self) {
        if let Some(ref path) = self.socket_path {
            let _ = std::fs::remove_file(path);
        }
    }

    /// Accept loop for Unix socket IPC connections.
    #[cfg(unix)]
    #[allow(clippy::too_many_arguments)]
    async fn socket_accept_loop(
        listener: tokio::net::UnixListener,
        ipc_ctx: Arc<IpcContext>,
        dispatch_es: Arc<ActivityLog>,
        trigger_store: Option<Arc<TriggerStore>>,
        agent_registry: Arc<AgentRegistry>,
        message_router: Option<Arc<MessageRouter>>,
        activity_buffer: Arc<Mutex<ActivityBuffer>>,
        running: Arc<std::sync::atomic::AtomicBool>,
        readiness: ReadinessContext,
        default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
        default_model: String,
        session_manager: Arc<SessionManager>,
        activity_stream: Arc<ActivityStream>,
        scheduler: Arc<Scheduler>,
    ) {
        loop {
            if !running.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            match listener.accept().await {
                Ok((stream, _)) => {
                    let ipc_ctx = ipc_ctx.clone();
                    let dispatch_es = dispatch_es.clone();
                    let trigger_store = trigger_store.clone();
                    let agent_registry = agent_registry.clone();
                    let message_router = message_router.clone();
                    let activity_buffer = activity_buffer.clone();
                    let readiness = readiness.clone();
                    let default_provider = default_provider.clone();
                    let default_model = default_model.clone();
                    let session_manager = session_manager.clone();
                    let activity_stream = activity_stream.clone();
                    let scheduler = scheduler.clone();
                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_socket_connection(
                            stream,
                            ipc_ctx,
                            dispatch_es,
                            trigger_store,
                            agent_registry,
                            message_router,
                            activity_buffer,
                            readiness,
                            default_provider,
                            default_model,
                            session_manager,
                            activity_stream,
                            scheduler,
                        )
                        .await
                        {
                            debug!(error = %e, "IPC connection error");
                        }
                    });
                }
                Err(e) => {
                    warn!(error = %e, "IPC accept error");
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    }

    /// Handle a single IPC connection. Protocol: one JSON line in, one JSON line out.
    #[cfg(unix)]
    #[allow(clippy::too_many_arguments)]
    async fn handle_socket_connection(
        stream: tokio::net::UnixStream,
        ipc_ctx: Arc<IpcContext>,
        dispatch_es: Arc<ActivityLog>,
        trigger_store: Option<Arc<TriggerStore>>,
        agent_registry: Arc<AgentRegistry>,
        message_router: Option<Arc<MessageRouter>>,
        activity_buffer: Arc<Mutex<ActivityBuffer>>,
        readiness: ReadinessContext,
        default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
        default_model: String,
        session_manager: Arc<SessionManager>,
        _activity_stream: Arc<ActivityStream>,
        scheduler: Arc<Scheduler>,
    ) -> Result<()> {
        const MAX_IPC_LINE_BYTES: usize = 10 * 1024 * 1024; // 10 MB
        let (reader, mut writer) = stream.into_split();
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();

        loop {
            line.clear();
            let n = buf_reader.read_line(&mut line).await?;
            if n == 0 {
                break; // EOF
            }
            if n > MAX_IPC_LINE_BYTES {
                let resp = serde_json::json!({"ok": false, "error": "request too large"});
                writer.write_all(resp.to_string().as_bytes()).await?;
                writer.write_all(b"\n").await?;
                continue;
            }
            let line = line.trim_end();
            let request: serde_json::Value = serde_json::from_str(line)
                .unwrap_or_else(|_| serde_json::json!({"cmd": "unknown"}));

            let cmd = request
                .get("cmd")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");

            // Extract tenancy scope from IPC params (injected by web layer).
            let allowed_companies: Option<Vec<String>> = request
                .get("allowed_companies")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                });

            // Pre-check: if request has a `project` or `company` param, validate against scope.
            if let Some(denied) = crate::ipc::tenancy::check_project(&allowed_companies, &request) {
                let _ = writer.write_all(denied.to_string().as_bytes()).await;
                let _ = writer.write_all(b"\n").await;
                let _ = writer.flush().await;
                continue;
            }

            // Pre-check: validate write operations against tenant scope.
            // Commands that use `name` to identify an agent (which maps to company name).
            if allowed_companies.is_some() {
                let name_field = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let needs_name_check =
                    matches!(cmd, "save_agent_file" | "agent_identity" | "agent_info");
                if needs_name_check
                    && !name_field.is_empty()
                    && !crate::ipc::tenancy::is_allowed(&allowed_companies, name_field)
                {
                    let denied = serde_json::json!({"ok": false, "error": "access denied"});
                    let _ = writer.write_all(denied.to_string().as_bytes()).await;
                    let _ = writer.write_all(b"\n").await;
                    let _ = writer.flush().await;
                    continue;
                }
            }

            let ctx = crate::ipc::CommandContext {
                metrics: ipc_ctx.metrics.clone(),
                activity_log: ipc_ctx.activity_log.clone(),
                session_store: ipc_ctx.session_store.clone(),
                dispatch_es: dispatch_es.clone(),
                trigger_store: trigger_store.clone(),
                event_handler_store: ipc_ctx.event_handler_store.clone(),
                agent_registry: agent_registry.clone(),
                message_router: message_router.clone(),
                activity_buffer: activity_buffer.clone(),
                default_provider: default_provider.clone(),
                default_model: default_model.clone(),
                session_manager: session_manager.clone(),
                scheduler: scheduler.clone(),
                leader_agent_name: ipc_ctx.leader_agent_name.clone(),
                daily_budget_usd: ipc_ctx.daily_budget_usd,
                project_budgets: ipc_ctx.project_budgets.clone(),
                prompt_loader: ipc_ctx.prompt_loader.clone(),
            };

            let response = match cmd {
                "ping" => crate::ipc::status::handle_ping(&ctx, &request, &allowed_companies).await,
                "status" => {
                    crate::ipc::status::handle_status(&ctx, &request, &allowed_companies).await
                }
                "readiness" => {
                    crate::ipc::status::handle_readiness(
                        &ctx,
                        &request,
                        &allowed_companies,
                        &readiness,
                    )
                    .await
                }

                "worker_progress" => {
                    crate::ipc::status::handle_worker_progress(&ctx, &request, &allowed_companies)
                        .await
                }
                "worker_events" => {
                    crate::ipc::status::handle_worker_events(&ctx, &request, &allowed_companies)
                        .await
                }
                "companies" => {
                    crate::ipc::companies::handle_companies(&ctx, &request, &allowed_companies)
                        .await
                }

                "create_company" => {
                    crate::ipc::companies::handle_create_company(&ctx, &request, &allowed_companies)
                        .await
                }
                "update_company" => {
                    crate::ipc::companies::handle_update_company(&ctx, &request, &allowed_companies)
                        .await
                }

                "mail" => crate::ipc::status::handle_mail(&ctx, &request, &allowed_companies).await,
                "dispatches" => {
                    crate::ipc::status::handle_dispatches(&ctx, &request, &allowed_companies).await
                }
                "metrics" => {
                    crate::ipc::status::handle_metrics(&ctx, &request, &allowed_companies).await
                }
                "cost" => crate::ipc::status::handle_cost(&ctx, &request, &allowed_companies).await,
                "audit" => {
                    crate::ipc::status::handle_audit(&ctx, &request, &allowed_companies).await
                }
                "expertise" => {
                    crate::ipc::status::handle_expertise(&ctx, &request, &allowed_companies).await
                }
                "rate_limit" => {
                    crate::ipc::status::handle_rate_limit(&ctx, &request, &allowed_companies).await
                }
                "skills" => {
                    crate::ipc::status::handle_skills(&ctx, &request, &allowed_companies).await
                }
                "pipelines" => {
                    crate::ipc::status::handle_pipelines(&ctx, &request, &allowed_companies).await
                }
                "triggers" => {
                    crate::ipc::status::handle_triggers(&ctx, &request, &allowed_companies).await
                }
                "webhook_fire" => {
                    crate::ipc::status::handle_webhook_fire(&ctx, &request, &allowed_companies)
                        .await
                }

                "notes" => {
                    crate::ipc::notes::handle_notes(&ctx, &request, &allowed_companies).await
                }
                "get_notes" => {
                    crate::ipc::notes::handle_get_notes(&ctx, &request, &allowed_companies).await
                }
                "claim_notes" => {
                    crate::ipc::notes::handle_claim_notes(&ctx, &request, &allowed_companies).await
                }
                "release_notes" => {
                    crate::ipc::notes::handle_release_notes(&ctx, &request, &allowed_companies)
                        .await
                }
                "delete_notes" => {
                    crate::ipc::notes::handle_delete_notes(&ctx, &request, &allowed_companies).await
                }
                "check_claim" => {
                    crate::ipc::notes::handle_check_claim(&ctx, &request, &allowed_companies).await
                }

                "quests" | "tasks" => {
                    crate::ipc::quests::handle_quests(&ctx, &request, &allowed_companies).await
                }
                "create_quest" | "create_task" => {
                    crate::ipc::quests::handle_create_quest(&ctx, &request, &allowed_companies)
                        .await
                }
                "close_quest" | "close_task" => {
                    crate::ipc::quests::handle_close_quest(&ctx, &request, &allowed_companies).await
                }

                "post_notes" => {
                    crate::ipc::chat::handle_post_notes(&ctx, &request, &allowed_companies).await
                }
                "chat" => crate::ipc::chat::handle_chat(&ctx, &request, &allowed_companies).await,
                "chat_full" => {
                    match crate::ipc::chat::handle_chat_full(&ctx, &request, &allowed_companies)
                        .await
                    {
                        Some(resp) => resp,
                        None => {
                            let _ = writer
                                .write_all(
                                    serde_json::json!({"ok": false, "error": "access denied"})
                                        .to_string()
                                        .as_bytes(),
                                )
                                .await;
                            let _ = writer.write_all(b"\n").await;
                            let _ = writer.flush().await;
                            continue;
                        }
                    }
                }
                "chat_poll" => {
                    crate::ipc::chat::handle_chat_poll(&ctx, &request, &allowed_companies).await
                }
                "chat_history" => {
                    crate::ipc::chat::handle_chat_history(&ctx, &request, &allowed_companies).await
                }
                "chat_timeline" => {
                    crate::ipc::chat::handle_chat_timeline(&ctx, &request, &allowed_companies).await
                }
                "chat_channels" => {
                    crate::ipc::chat::handle_chat_channels(&ctx, &request, &allowed_companies).await
                }

                "agents_registry" => {
                    crate::ipc::agents::handle_agents_registry(&ctx, &request, &allowed_companies)
                        .await
                }
                "agent_children" => {
                    crate::ipc::agents::handle_agent_children(&ctx, &request, &allowed_companies)
                        .await
                }
                "agent_spawn" => {
                    crate::ipc::agents::handle_agent_spawn(&ctx, &request, &allowed_companies).await
                }
                "agent_set_status" => {
                    crate::ipc::agents::handle_agent_set_status(&ctx, &request, &allowed_companies)
                        .await
                }
                "agent_info" => {
                    crate::ipc::agents::handle_agent_info(&ctx, &request, &allowed_companies).await
                }
                "agent_identity" => {
                    crate::ipc::agents::handle_agent_identity(&ctx, &request, &allowed_companies)
                        .await
                }
                "save_agent_file" => {
                    crate::ipc::agents::handle_save_agent_file(&ctx, &request, &allowed_companies)
                        .await
                }
                "budget_policies" => {
                    crate::ipc::agents::handle_budget_policies(&ctx, &request, &allowed_companies)
                        .await
                }
                "create_budget_policy" => {
                    crate::ipc::agents::handle_create_budget_policy(
                        &ctx,
                        &request,
                        &allowed_companies,
                    )
                    .await
                }
                "approvals" => {
                    crate::ipc::agents::handle_approvals(&ctx, &request, &allowed_companies).await
                }
                "resolve_approval" => {
                    crate::ipc::agents::handle_resolve_approval(&ctx, &request, &allowed_companies)
                        .await
                }

                "list_prompts" => {
                    crate::ipc::prompts::handle_list_prompts(&ctx, &request, &allowed_companies)
                        .await
                }
                "get_prompt" => {
                    crate::ipc::prompts::handle_get_prompt(&ctx, &request, &allowed_companies).await
                }
                "create_prompt" => {
                    crate::ipc::prompts::handle_create_prompt(&ctx, &request, &allowed_companies)
                        .await
                }
                "update_prompt" => {
                    crate::ipc::prompts::handle_update_prompt(&ctx, &request, &allowed_companies)
                        .await
                }
                "delete_prompt" => {
                    crate::ipc::prompts::handle_delete_prompt(&ctx, &request, &allowed_companies)
                        .await
                }

                "import_prompts" => {
                    crate::ipc::prompts::handle_import_prompts(&ctx, &request, &allowed_companies)
                        .await
                }
                "seed_ideas" => {
                    crate::ipc::prompts::handle_seed_ideas(&ctx, &request, &allowed_companies)
                        .await
                }

                "list_events" => {
                    crate::ipc::events::handle_list_events(&ctx, &request, &allowed_companies)
                        .await
                }
                "create_event" => {
                    crate::ipc::events::handle_create_event(&ctx, &request, &allowed_companies)
                        .await
                }
                "update_event" => {
                    crate::ipc::events::handle_update_event(&ctx, &request, &allowed_companies)
                        .await
                }
                "delete_event" => {
                    crate::ipc::events::handle_delete_event(&ctx, &request, &allowed_companies)
                        .await
                }

                "list_sessions" => {
                    crate::ipc::sessions::handle_list_sessions(&ctx, &request, &allowed_companies)
                        .await
                }
                "sessions" => {
                    crate::ipc::sessions::handle_sessions(&ctx, &request, &allowed_companies).await
                }
                "create_session" => {
                    crate::ipc::sessions::handle_create_session(&ctx, &request, &allowed_companies)
                        .await
                }
                "close_session" => {
                    crate::ipc::sessions::handle_close_session(&ctx, &request, &allowed_companies)
                        .await
                }
                "session_messages" => {
                    match crate::ipc::sessions::handle_session_messages(
                        &ctx,
                        &request,
                        &allowed_companies,
                    )
                    .await
                    {
                        Some(resp) => resp,
                        None => {
                            let _ = writer
                                .write_all(
                                    serde_json::json!({"ok": false, "error": "access denied"})
                                        .to_string()
                                        .as_bytes(),
                                )
                                .await;
                            let _ = writer.write_all(b"\n").await;
                            let _ = writer.flush().await;
                            continue;
                        }
                    }
                }
                "session_children" => {
                    match crate::ipc::sessions::handle_session_children(
                        &ctx,
                        &request,
                        &allowed_companies,
                    )
                    .await
                    {
                        Some(resp) => resp,
                        None => {
                            let _ = writer
                                .write_all(
                                    serde_json::json!({"ok": false, "error": "access denied"})
                                        .to_string()
                                        .as_bytes(),
                                )
                                .await;
                            let _ = writer.write_all(b"\n").await;
                            let _ = writer.flush().await;
                            continue;
                        }
                    }
                }

                // session_send stays inline — it writes directly to `writer` for streaming.
                "session_send" => {
                    let message = request_field(&request, "message").unwrap_or("");
                    let agent_hint = request_field(&request, "agent")
                        .map(|s| s.to_lowercase())
                        .unwrap_or_else(|| "assistant".to_string());
                    let agent_id_direct =
                        request_field(&request, "agent_id").map(|s| s.to_string());
                    let session_id_hint =
                        request_field(&request, "session_id").map(|s| s.to_string());
                    let stream_mode = request
                        .get("stream")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);

                    // Tenancy check: verify agent belongs to allowed company.
                    let send_allowed = if allowed_companies.is_none() {
                        true
                    } else if let Some(ref aid) = agent_id_direct {
                        crate::ipc::tenancy::check_agent_access(
                            &agent_registry,
                            &allowed_companies,
                            aid,
                        )
                        .await
                    } else {
                        match agent_registry.resolve_by_hint(&agent_hint).await {
                            Ok(Some(agent)) => {
                                crate::ipc::tenancy::check_agent_access(
                                    &agent_registry,
                                    &allowed_companies,
                                    &agent.id,
                                )
                                .await
                            }
                            _ => false,
                        }
                    };

                    if message.is_empty() {
                        serde_json::json!({"ok": false, "error": "message is required"})
                    } else if !send_allowed {
                        serde_json::json!({"ok": false, "error": "access denied"})
                    } else {
                        let session_store = ipc_ctx.session_store.clone();
                        let request_started = std::time::Instant::now();

                        // Resolve store_session_id: use explicit session_id_hint, or find/create one.
                        let store_session_id: Option<String> = if let Some(ref sid) =
                            session_id_hint
                        {
                            // Verify session exists; record user message.
                            if let Some(ref cs) = session_store {
                                let _ = cs
                                    .record_by_session(sid, "user", message, Some("web"))
                                    .await;
                            }
                            Some(sid.clone())
                        } else if let Some(ref cs) = session_store {
                            // Find or create a session for this agent.
                            let agent_uuid = if let Some(ref aid) = agent_id_direct {
                                Some(aid.clone())
                            } else {
                                match agent_registry.resolve_by_hint(&agent_hint).await {
                                    Ok(Some(agent)) => Some(agent.id),
                                    _ => None,
                                }
                            };
                            let usid = if let Some(ref uuid) = agent_uuid {
                                // Try to find existing active session.
                                match cs.list_sessions(Some(uuid), 1).await {
                                    Ok(sessions) => {
                                        if let Some(s) =
                                            sessions.first().filter(|s| s.status == "active")
                                        {
                                            Some(s.id.clone())
                                        } else {
                                            // Create a new session.
                                            cs.create_session(uuid, "web", &agent_hint, None, None)
                                                .await
                                                .ok()
                                        }
                                    }
                                    Err(_) => cs
                                        .create_session(uuid, "web", &agent_hint, None, None)
                                        .await
                                        .ok(),
                                }
                            } else {
                                None
                            };
                            if let Some(ref sid) = usid {
                                let _ = cs
                                    .record_by_session(sid, "user", message, Some("web"))
                                    .await;
                            }
                            usid
                        } else {
                            None
                        };

                        // Legacy chat_id for backward-compatible JSON responses.
                        let chat_id = named_channel_chat_id(
                            agent_id_direct.as_deref().unwrap_or(&agent_hint),
                        );

                        // resolved_session_id reuses store_session_id (already resolved above).
                        let resolved_session_id = store_session_id.clone().unwrap_or_default();

                        // Check if session is already running in memory.
                        if !resolved_session_id.is_empty()
                            && session_manager.is_running(&resolved_session_id).await
                        {
                            if stream_mode {
                                match session_manager
                                    .send_streaming(&resolved_session_id, message)
                                    .await
                                {
                                    Ok(mut rx) => {
                                        let mut text = String::new();
                                        let mut iterations = 0u32;
                                        let mut prompt_tokens = 0u32;
                                        let mut completion_tokens = 0u32;

                                        loop {
                                            match tokio::time::timeout(
                                                std::time::Duration::from_secs(300),
                                                rx.recv(),
                                            )
                                            .await
                                            {
                                                Ok(Ok(event)) => {
                                                    if let Ok(ev_bytes) = serde_json::to_vec(&event) {
                                                        let mut bytes = ev_bytes;
                                                        bytes.push(b'\n');
                                                        let _ = writer.write_all(&bytes).await;
                                                    }

                                                    match &event {
                                                        aeqi_core::ChatStreamEvent::StepStart { step, model } => {
                                                            if let (Some(cs), Some(usid)) = (&session_store, &store_session_id) {
                                                                let meta = serde_json::json!({
                                                                    "step": step,
                                                                    "model": model,
                                                                });
                                                                let _ = cs.record_event_by_session(
                                                                    usid, "step_start", "system",
                                                                    &format!("Step {step}"), Some("session"), Some(&meta),
                                                                ).await;
                                                            }
                                                        }
                                                        aeqi_core::ChatStreamEvent::TextDelta { text: delta } => {
                                                            text.push_str(delta);
                                                        }
                                                        aeqi_core::ChatStreamEvent::ToolComplete {
                                                            tool_use_id,
                                                            tool_name,
                                                            success,
                                                            input_preview,
                                                            output_preview,
                                                            duration_ms,
                                                        } => {
                                                            if let (Some(cs), Some(usid)) = (&session_store, &store_session_id) {
                                                                let meta = serde_json::json!({
                                                                    "tool_use_id": tool_use_id,
                                                                    "tool_name": tool_name,
                                                                    "success": success,
                                                                    "input_preview": input_preview,
                                                                    "output_preview": output_preview,
                                                                    "duration_ms": duration_ms,
                                                                });
                                                                let _ = cs.record_event_by_session(
                                                                    usid, "tool_complete", "system",
                                                                    tool_name, Some("session"), Some(&meta),
                                                                ).await;
                                                            }
                                                        }
                                                        aeqi_core::ChatStreamEvent::StepComplete { .. } => {
                                                            if !text.is_empty()
                                                                && let (Some(cs), Some(usid)) = (&session_store, &store_session_id) {
                                                                    let _ = cs.record_by_session(
                                                                        usid, "assistant", &text, Some("web"),
                                                                    ).await;
                                                                    text.clear();
                                                                }
                                                        }
                                                        aeqi_core::ChatStreamEvent::Complete {
                                                            total_prompt_tokens: pt,
                                                            total_completion_tokens: ct,
                                                            iterations: it,
                                                            ..
                                                        } => {
                                                            if !text.is_empty()
                                                                && let (Some(cs), Some(usid)) = (&session_store, &store_session_id) {
                                                                    let _ = cs.record_by_session(
                                                                        usid, "assistant", &text, Some("web"),
                                                                    ).await;
                                                                }
                                                            prompt_tokens = *pt;
                                                            completion_tokens = *ct;
                                                            iterations = *it;
                                                            break;
                                                        }
                                                        _ => {}
                                                    }
                                                }
                                                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                                                    warn!(session_id = %resolved_session_id, lagged = n, "stream subscriber lagged");
                                                }
                                                Ok(Err(_)) => break,
                                                Err(_) => {
                                                    text = "Session response timed out".to_string();
                                                    break;
                                                }
                                            }
                                        }

                                        // Text already flushed per-step in StepComplete/Complete handlers above.
                                        if let Some(ref cs) = session_store
                                            && store_session_id.is_none() {
                                                let _ = cs
                                                    .record_with_source(
                                                        chat_id,
                                                        "assistant",
                                                        &text,
                                                        Some("web"),
                                                    )
                                                    .await;
                                            }

                                        let cost_usd = aeqi_providers::estimate_cost(
                                            &default_model,
                                            prompt_tokens,
                                            completion_tokens,
                                        );
                                        let duration_ms =
                                            request_started.elapsed().as_millis() as u64;
                                        record_assistant_complete(
                                            &session_store,
                                            store_session_id
                                                .as_deref()
                                                .or(Some(resolved_session_id.as_str())),
                                            prompt_tokens,
                                            completion_tokens,
                                            cost_usd,
                                            iterations,
                                            duration_ms,
                                        )
                                        .await;
                                        let _ = ipc_ctx
                                            .activity_log
                                            .record_cost(
                                                &agent_hint,
                                                &resolved_session_id,
                                                &agent_hint,
                                                cost_usd,
                                                iterations,
                                            )
                                            .await;
                                        let done = serde_json::json!({
                                            "done": true,
                                            "type": "Complete",
                                            "session_id": resolved_session_id,
                                            "store_session_id": store_session_id,
                                            "iterations": iterations,
                                            "prompt_tokens": prompt_tokens,
                                            "completion_tokens": completion_tokens,
                                            "cost_usd": cost_usd,
                                            "duration_ms": duration_ms,
                                        });
                                        let mut bytes =
                                            serde_json::to_vec(&done).unwrap_or_default();
                                        bytes.push(b'\n');
                                        let _ = writer.write_all(&bytes).await;
                                        serde_json::Value::Null
                                    }
                                    Err(e) => {
                                        serde_json::json!({"ok": false, "error": e.to_string()})
                                    }
                                }
                            } else {
                                match session_manager.send(&resolved_session_id, message).await {
                                    Ok(resp) => {
                                        if let Some(ref cs) = session_store {
                                            if let Some(ref usid) = store_session_id {
                                                let _ = cs
                                                    .record_by_session(
                                                        usid,
                                                        "assistant",
                                                        &resp.text,
                                                        Some("web"),
                                                    )
                                                    .await;
                                            } else {
                                                let _ = cs
                                                    .record_with_source(
                                                        chat_id,
                                                        "assistant",
                                                        &resp.text,
                                                        Some("web"),
                                                    )
                                                    .await;
                                            }
                                        }
                                        let cost_usd = aeqi_providers::estimate_cost(
                                            &default_model,
                                            resp.prompt_tokens,
                                            resp.completion_tokens,
                                        );
                                        let duration_ms =
                                            request_started.elapsed().as_millis() as u64;
                                        record_assistant_complete(
                                            &session_store,
                                            store_session_id
                                                .as_deref()
                                                .or(Some(resolved_session_id.as_str())),
                                            resp.prompt_tokens,
                                            resp.completion_tokens,
                                            cost_usd,
                                            resp.iterations,
                                            duration_ms,
                                        )
                                        .await;
                                        let _ = ipc_ctx
                                            .activity_log
                                            .record_cost(
                                                &agent_hint,
                                                &resolved_session_id,
                                                &agent_hint,
                                                cost_usd,
                                                resp.iterations,
                                            )
                                            .await;
                                        serde_json::json!({
                                            "ok": true,
                                            "text": resp.text,
                                            "chat_id": chat_id,
                                            "session_id": resolved_session_id,
                                            "store_session_id": store_session_id,
                                            "iterations": resp.iterations,
                                            "prompt_tokens": resp.prompt_tokens,
                                            "completion_tokens": resp.completion_tokens,
                                            "cost_usd": cost_usd,
                                            "duration_ms": duration_ms,
                                        })
                                    }
                                    Err(e) => {
                                        serde_json::json!({"ok": false, "error": e.to_string()})
                                    }
                                }
                            }
                        } else if let Some(ref provider) = default_provider {
                            let agent_id_or_hint =
                                agent_id_direct.as_deref().unwrap_or(&agent_hint);

                            let extra_prompts: Vec<aeqi_core::PromptEntry> = request
                                .get("extra_prompts")
                                .and_then(|v| serde_json::from_value(v.clone()).ok())
                                .unwrap_or_default();

                            let mut spawn_opts =
                                crate::session_manager::SpawnOptions::interactive();
                            spawn_opts.extra_prompts = extra_prompts;
                            if let Some(ref sid) = store_session_id {
                                spawn_opts = spawn_opts
                                    .with_session_id(sid.clone())
                                    .without_initial_prompt_record();
                            }

                            match session_manager
                                .spawn_session(
                                    agent_id_or_hint,
                                    message,
                                    provider.clone(),
                                    spawn_opts,
                                )
                                .await
                            {
                                Ok(spawned) => {
                                    let session_id = spawned.session_id.clone();

                                    let mut rx = spawned.stream_sender.subscribe();
                                    let mut step_text = String::new();
                                    let mut full_text = String::new();
                                    let mut iterations = 0u32;
                                    let mut prompt_tokens = 0u32;
                                    let mut completion_tokens = 0u32;

                                    loop {
                                        match tokio::time::timeout(
                                            std::time::Duration::from_secs(300),
                                            rx.recv(),
                                        )
                                        .await
                                        {
                                            Ok(Ok(event)) => {
                                                if stream_mode
                                                    && let Ok(ev_bytes) = serde_json::to_vec(&event)
                                                {
                                                    let mut bytes = ev_bytes;
                                                    bytes.push(b'\n');
                                                    let _ = writer.write_all(&bytes).await;
                                                }

                                                match &event {
                                                    aeqi_core::ChatStreamEvent::StepStart {
                                                        step,
                                                        model,
                                                    } => {
                                                        if let (Some(cs), Some(usid)) =
                                                            (&session_store, &store_session_id)
                                                        {
                                                            let meta = serde_json::json!({
                                                                "step": step,
                                                                "model": model,
                                                            });
                                                            let _ = cs
                                                                .record_event_by_session(
                                                                    usid,
                                                                    "step_start",
                                                                    "system",
                                                                    &format!("Step {step}"),
                                                                    Some("session"),
                                                                    Some(&meta),
                                                                )
                                                                .await;
                                                        }
                                                    }
                                                    aeqi_core::ChatStreamEvent::TextDelta {
                                                        text: delta,
                                                    } => {
                                                        step_text.push_str(delta);
                                                        full_text.push_str(delta);
                                                    }
                                                    aeqi_core::ChatStreamEvent::ToolComplete {
                                                        tool_use_id,
                                                        tool_name,
                                                        success,
                                                        input_preview,
                                                        output_preview,
                                                        duration_ms,
                                                    } => {
                                                        if let (Some(cs), Some(usid)) =
                                                            (&session_store, &store_session_id)
                                                        {
                                                            let meta = serde_json::json!({
                                                                "tool_use_id": tool_use_id,
                                                                "tool_name": tool_name,
                                                                "success": success,
                                                                "input_preview": input_preview,
                                                                "output_preview": output_preview,
                                                                "duration_ms": duration_ms,
                                                            });
                                                            let _ = cs
                                                                .record_event_by_session(
                                                                    usid,
                                                                    "tool_complete",
                                                                    "system",
                                                                    tool_name,
                                                                    Some("session"),
                                                                    Some(&meta),
                                                                )
                                                                .await;
                                                        }
                                                    }
                                                    aeqi_core::ChatStreamEvent::StepComplete {
                                                        ..
                                                    } => {
                                                        // Flush accumulated text as an assistant message per-step.
                                                        if !step_text.is_empty() {
                                                            if let (Some(cs), Some(usid)) =
                                                                (&session_store, &store_session_id)
                                                            {
                                                                let _ = cs
                                                                    .record_by_session(
                                                                        usid,
                                                                        "assistant",
                                                                        &step_text,
                                                                        Some("web"),
                                                                    )
                                                                    .await;
                                                            }
                                                            step_text.clear();
                                                        }
                                                    }
                                                    aeqi_core::ChatStreamEvent::Complete {
                                                        total_prompt_tokens: pt,
                                                        total_completion_tokens: ct,
                                                        iterations: it,
                                                        ..
                                                    } => {
                                                        // Flush any remaining text from the final step.
                                                        if !step_text.is_empty() {
                                                            if let (Some(cs), Some(usid)) =
                                                                (&session_store, &store_session_id)
                                                            {
                                                                let _ = cs
                                                                    .record_by_session(
                                                                        usid,
                                                                        "assistant",
                                                                        &step_text,
                                                                        Some("web"),
                                                                    )
                                                                    .await;
                                                            }
                                                            step_text.clear();
                                                        }
                                                        prompt_tokens = *pt;
                                                        completion_tokens = *ct;
                                                        iterations = *it;
                                                        break;
                                                    }
                                                    _ => {}
                                                }
                                            }
                                            Ok(Err(_)) => break,
                                            Err(_) => {
                                                let timeout_text =
                                                    "Session response timed out".to_string();
                                                step_text = timeout_text.clone();
                                                full_text = timeout_text;
                                                break;
                                            }
                                        }
                                    }

                                    // Text already flushed per-step above.
                                    if let Some(ref cs) = session_store
                                        && store_session_id.is_none() && !full_text.is_empty() {
                                            let _ = cs
                                                .record_with_source(
                                                    chat_id,
                                                    "assistant",
                                                    &full_text,
                                                    Some("web"),
                                                )
                                                .await;
                                        }

                                    let cost_usd = aeqi_providers::estimate_cost(
                                        &default_model,
                                        prompt_tokens,
                                        completion_tokens,
                                    );
                                    let duration_ms = request_started.elapsed().as_millis() as u64;
                                    record_assistant_complete(
                                        &session_store,
                                        store_session_id.as_deref().or(Some(session_id.as_str())),
                                        prompt_tokens,
                                        completion_tokens,
                                        cost_usd,
                                        iterations,
                                        duration_ms,
                                    )
                                    .await;
                                    let _ = ipc_ctx
                                        .activity_log
                                        .record_cost(
                                            &agent_hint,
                                            &session_id,
                                            &agent_hint,
                                            cost_usd,
                                            iterations,
                                        )
                                        .await;

                                    if stream_mode {
                                        let done = serde_json::json!({
                                            "done": true,
                                            "type": "Complete",
                                            "session_id": session_id,
                                            "store_session_id": store_session_id,
                                            "iterations": iterations,
                                            "prompt_tokens": prompt_tokens,
                                            "completion_tokens": completion_tokens,
                                            "cost_usd": cost_usd,
                                            "duration_ms": duration_ms,
                                        });
                                        let mut bytes =
                                            serde_json::to_vec(&done).unwrap_or_default();
                                        bytes.push(b'\n');
                                        let _ = writer.write_all(&bytes).await;
                                        serde_json::Value::Null
                                    } else {
                                        serde_json::json!({
                                            "ok": true,
                                            "text": full_text,
                                            "chat_id": chat_id,
                                            "session_id": session_id,
                                            "store_session_id": store_session_id,
                                            "iterations": iterations,
                                            "prompt_tokens": prompt_tokens,
                                            "completion_tokens": completion_tokens,
                                            "model": default_model,
                                            "cost_usd": cost_usd,
                                            "duration_ms": duration_ms,
                                        })
                                    }
                                }
                                Err(e) => {
                                    serde_json::json!({"ok": false, "error": e.to_string()})
                                }
                            }
                        } else {
                            serde_json::json!({"ok": false, "error": "no provider available"})
                        }
                    }
                }

                "memories" => {
                    crate::ipc::memory::handle_memories(&ctx, &request, &allowed_companies).await
                }
                "memory_profile" => {
                    crate::ipc::memory::handle_memory_profile(&ctx, &request, &allowed_companies)
                        .await
                }
                "memory_graph" => {
                    crate::ipc::memory::handle_memory_graph(&ctx, &request, &allowed_companies)
                        .await
                }
                "memory_prefix" => {
                    crate::ipc::memory::handle_memory_prefix(&ctx, &request, &allowed_companies)
                        .await
                }
                "company_knowledge" => {
                    crate::ipc::memory::handle_company_knowledge(&ctx, &request, &allowed_companies)
                        .await
                }
                "channel_knowledge" => {
                    crate::ipc::memory::handle_channel_knowledge(&ctx, &request, &allowed_companies)
                        .await
                }
                "knowledge_store" => {
                    crate::ipc::memory::handle_knowledge_store(&ctx, &request, &allowed_companies)
                        .await
                }
                "knowledge_delete" => {
                    crate::ipc::memory::handle_knowledge_delete(&ctx, &request, &allowed_companies)
                        .await
                }

                "vfs_list" => {
                    crate::ipc::vfs::handle_vfs_list(&ctx, &request, &allowed_companies).await
                }
                "vfs_read" => {
                    crate::ipc::vfs::handle_vfs_read(&ctx, &request, &allowed_companies).await
                }
                "vfs_search" => {
                    crate::ipc::vfs::handle_vfs_search(&ctx, &request, &allowed_companies).await
                }

                _ => serde_json::json!({"ok": false, "error": format!("unknown command: {cmd}")}),
            };

            // Skip writing if response is null (already streamed inline).
            if !response.is_null() {
                let mut resp_bytes = serde_json::to_vec(&response)?;
                resp_bytes.push(b'\n');
                writer.write_all(&resp_bytes).await?;
            }
        }

        Ok(())
    }

    pub fn stop(&self) {
        self.running
            .store(false, std::sync::atomic::Ordering::SeqCst);
        self.shutdown_notify.notify_waiters();
    }

    /// Check if daemon is running.
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::SeqCst)
    }
}

pub fn dispatch_state(dispatch: &Dispatch, overdue_cutoff: chrono::DateTime<Utc>) -> &'static str {
    if dispatch.requires_ack && dispatch.retry_count >= dispatch.max_retries {
        "dead_letter"
    } else if dispatch.requires_ack && dispatch.read && dispatch.timestamp < overdue_cutoff {
        "overdue_ack"
    } else if dispatch.requires_ack && dispatch.read {
        "awaiting_ack"
    } else if dispatch.requires_ack && !dispatch.read && dispatch.retry_count > 0 {
        "retrying_delivery"
    } else if !dispatch.read {
        "unread"
    } else {
        "handled"
    }
}

pub fn dispatch_summary_json(
    dispatch: &Dispatch,
    overdue_cutoff: chrono::DateTime<Utc>,
) -> serde_json::Value {
    serde_json::json!({
        "id": dispatch.id,
        "from": dispatch.from,
        "to": dispatch.to,
        "subject": dispatch.kind.subject_tag(),
        "body": dispatch.kind.body_text(),
        "timestamp": dispatch.timestamp.to_rfc3339(),
        "first_sent_at": dispatch.first_sent_at.to_rfc3339(),
        "read": dispatch.read,
        "requires_ack": dispatch.requires_ack,
        "retry_count": dispatch.retry_count,
        "max_retries": dispatch.max_retries,
        "state": dispatch_state(dispatch, overdue_cutoff),
        "age_seconds": (Utc::now() - dispatch.timestamp).num_seconds().max(0),
        "delivery_seconds": (Utc::now() - dispatch.first_sent_at).num_seconds().max(0),
    })
}

pub fn readiness_response(
    leader_agent_name: &str,
    mut worker_limits: Vec<(String, u32)>,
    dispatch_health: DispatchHealth,
    budget_status: (f64, f64, f64),
    readiness: &ReadinessContext,
) -> serde_json::Value {
    let (spent, budget, remaining) = budget_status;
    worker_limits.sort_by(|a, b| a.0.cmp(&b.0));

    let managed_owners: Vec<(String, u32)> = worker_limits
        .into_iter()
        .filter(|(name, _)| name != leader_agent_name)
        .collect();
    let registered_owners: Vec<String> = managed_owners
        .iter()
        .map(|(name, _)| name.clone())
        .collect();
    let max_workers: u32 = managed_owners.iter().map(|(_, workers)| *workers).sum();

    let mut blocking_reasons = Vec::new();
    if readiness.configured_projects + readiness.configured_advisors == 0 {
        blocking_reasons.push("no projects or advisor agents are configured".to_string());
    }
    if registered_owners.is_empty() {
        blocking_reasons.push("no projects or advisor agents were registered".to_string());
    }
    if !readiness.skipped_projects.is_empty() {
        blocking_reasons.push(format!(
            "{} configured project(s) were skipped because their directories were missing",
            readiness.skipped_projects.len()
        ));
    }
    if !readiness.skipped_advisors.is_empty() {
        blocking_reasons.push(format!(
            "{} advisor agent(s) were skipped because their directories were missing",
            readiness.skipped_advisors.len()
        ));
    }
    if max_workers == 0 {
        blocking_reasons
            .push("registered projects and advisors expose zero worker capacity".to_string());
    }
    if remaining <= 0.0 {
        blocking_reasons.push(format!(
            "daily budget exhausted (${spent:.2} spent of ${budget:.2})"
        ));
    }

    let mut warnings = Vec::new();
    if dispatch_health.overdue_ack > 0 {
        warnings.push(format!(
            "{} dispatch(es) are overdue for acknowledgment",
            dispatch_health.overdue_ack
        ));
    }
    if dispatch_health.dead_letters > 0 {
        warnings.push(format!(
            "{} dispatch(es) are in dead-letter state",
            dispatch_health.dead_letters
        ));
    }
    if dispatch_health.retrying_delivery > 0 {
        warnings.push(format!(
            "{} dispatch(es) are retrying delivery",
            dispatch_health.retrying_delivery
        ));
    }

    serde_json::json!({
        "ok": true,
        "ready": blocking_reasons.is_empty(),
        "leader_agent": leader_agent_name,
        "configured_projects": readiness.configured_projects,
        "configured_advisors": readiness.configured_advisors,
        "registered_owners": registered_owners,
        "registered_owner_count": managed_owners.len(),
        "max_workers": max_workers,
        "dispatch_health": {
            "unread": dispatch_health.unread,
            "awaiting_ack": dispatch_health.awaiting_ack,
            "retrying_delivery": dispatch_health.retrying_delivery,
            "overdue_ack": dispatch_health.overdue_ack,
            "dead_letters": dispatch_health.dead_letters,
        },
        "cost_today_usd": spent,
        "daily_budget_usd": budget,
        "budget_remaining_usd": remaining,
        "skipped_projects": readiness.skipped_projects.clone(),
        "skipped_advisors": readiness.skipped_advisors.clone(),
        "blocking_reasons": blocking_reasons,
        "warnings": warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        DispatchHealth, ActivityBuffer, Activity, ReadinessContext, readiness_response,
        resolve_web_chat_id,
    };
    use crate::session_store::{agency_chat_id, named_channel_chat_id, project_chat_id};

    #[test]
    fn readiness_blocks_when_owner_registration_is_incomplete() {
        let response = readiness_response(
            "leader",
            vec![("leader".to_string(), 1), ("alpha".to_string(), 2)],
            DispatchHealth::default(),
            (2.5, 50.0, 47.5),
            &ReadinessContext {
                configured_projects: 2,
                configured_advisors: 0,
                skipped_projects: vec!["beta".to_string()],
                skipped_advisors: Vec::new(),
            },
        );

        assert_eq!(response["ready"], serde_json::json!(false));
        assert_eq!(response["registered_owner_count"], serde_json::json!(1));
        assert_eq!(response["max_workers"], serde_json::json!(2));
        assert_eq!(response["skipped_projects"], serde_json::json!(["beta"]));
        assert!(
            response["blocking_reasons"]
                .as_array()
                .expect("blocking_reasons array")
                .iter()
                .any(|reason| reason.as_str().is_some_and(|text| text.contains("skipped")))
        );
    }

    #[test]
    fn readiness_surfaces_dispatch_warnings_without_blocking() {
        let response = readiness_response(
            "leader",
            vec![("leader".to_string(), 1), ("alpha".to_string(), 2)],
            DispatchHealth {
                unread: 0,
                awaiting_ack: 1,
                retrying_delivery: 1,
                overdue_ack: 1,
                dead_letters: 1,
            },
            (3.0, 50.0, 47.0),
            &ReadinessContext {
                configured_projects: 1,
                configured_advisors: 0,
                skipped_projects: Vec::new(),
                skipped_advisors: Vec::new(),
            },
        );

        assert_eq!(response["ready"], serde_json::json!(true));
        assert_eq!(
            response["warnings"].as_array().map(|items| items.len()),
            Some(3)
        );
    }

    #[test]
    fn readiness_blocks_when_budget_is_exhausted() {
        let response = readiness_response(
            "leader",
            vec![("leader".to_string(), 1), ("alpha".to_string(), 2)],
            DispatchHealth::default(),
            (50.0, 50.0, 0.0),
            &ReadinessContext {
                configured_projects: 1,
                configured_advisors: 0,
                skipped_projects: Vec::new(),
                skipped_advisors: Vec::new(),
            },
        );

        assert_eq!(response["ready"], serde_json::json!(false));
        assert!(
            response["blocking_reasons"]
                .as_array()
                .expect("blocking_reasons array")
                .iter()
                .any(|reason| reason
                    .as_str()
                    .is_some_and(|text| text.contains("budget exhausted")))
        );
    }

    #[test]
    fn activity_buffer_supports_independent_cursors() {
        let mut buffer = ActivityBuffer::default();
        buffer.push(Activity::QuestStarted {
            quest_id: "t-1".into(),
            agent: "engineer".into(),
            project: "aeqi".into(),
            runtime_session: None,
        });
        buffer.push(Activity::QuestCompleted {
            quest_id: "t-1".into(),
            outcome: "done".into(),
            confidence: 1.0,
            cost_usd: 0.1,
            steps: 2,
            duration_ms: 100,
            runtime: None,
        });

        let client_a = buffer.read_since(Some(0));
        let client_b = buffer.read_since(Some(0));
        assert_eq!(client_a.events.len(), 2);
        assert_eq!(client_b.events.len(), 2);
        assert_eq!(client_a.next_cursor, 2);
        assert_eq!(client_b.next_cursor, 2);

        buffer.push(Activity::Progress {
            quest_id: "t-2".into(),
            steps: 1,
            cost_usd: 0.05,
            last_tool: Some("shell".into()),
        });

        let client_a_next = buffer.read_since(Some(client_a.next_cursor));
        let client_b_still_old = buffer.read_since(Some(0));
        assert_eq!(client_a_next.events.len(), 1);
        assert_eq!(client_b_still_old.events.len(), 3);
    }

    #[test]
    fn activity_buffer_flags_cursor_resets_after_truncation() {
        let mut buffer = ActivityBuffer::default();
        for i in 0..(super::MAX_EVENT_BUFFER_LEN + 5) {
            buffer.push(Activity::Progress {
                quest_id: format!("t-{i}"),
                steps: i as u32,
                cost_usd: i as f64,
                last_tool: None,
            });
        }

        let snapshot = buffer.read_since(Some(0));
        assert!(snapshot.reset);
        assert_eq!(snapshot.events.len(), super::MAX_EVENT_BUFFER_LEN);
        assert!(snapshot.oldest_cursor > 0);
    }

    #[test]
    fn web_chat_resolution_prefers_scoped_channels() {
        assert_eq!(
            resolve_web_chat_id(None, Some("alpha"), Some("alpha")),
            project_chat_id("alpha")
        );
        assert_eq!(
            resolve_web_chat_id(None, None, Some("ops")),
            named_channel_chat_id("ops")
        );
    }

    #[test]
    fn web_chat_resolution_uses_global_fallback() {
        assert_eq!(
            resolve_web_chat_id(None, None, Some("aeqi")),
            agency_chat_id()
        );
        assert_eq!(resolve_web_chat_id(None, None, None), agency_chat_id());
    }
}
