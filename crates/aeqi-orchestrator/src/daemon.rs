use anyhow::Result;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::activity::{Activity, ActivityStream};
use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::gateway_manager::GatewayManager;
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

pub fn quest_snapshot(quest: &aeqi_quests::Quest) -> serde_json::Value {
    serde_json::json!({
        "id": quest.id.0,
        "subject": quest.name,
        "status": quest.status.to_string(),
        "runtime": quest.runtime(),
        "outcome": quest.quest_outcome(),
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

pub async fn find_quest_snapshot(
    agent_registry: &Arc<AgentRegistry>,
    quest_id: &str,
) -> Option<serde_json::Value> {
    agent_registry
        .get_task(quest_id)
        .await
        .ok()
        .flatten()
        .map(|t| quest_snapshot(&t))
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
    idea_store: Option<Arc<dyn aeqi_core::traits::IdeaStore>>,
    daily_budget_usd: f64,
    project_budgets: std::collections::HashMap<String, f64>,
    prompt_loader: Option<Arc<crate::prompt_loader::PromptLoader>>,
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
}

/// The Daemon: background process that runs the scheduler patrol loop
/// and event system.
pub struct Daemon {
    pub metrics: Arc<AEQIMetrics>,
    pub activity_log: Arc<ActivityLog>,
    pub session_store: Option<Arc<SessionStore>>,
    pub shared_primer: Option<String>,
    pub project_primer: Option<String>,
    pub patrol_interval_secs: u64,
    pub background_automation_enabled: bool,
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
    /// Shared idea store.
    pub idea_store: Option<Arc<dyn aeqi_core::traits::IdeaStore>>,
    /// Gateway manager for session output delivery.
    pub gateway_manager: Arc<GatewayManager>,
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
            shared_primer: None,
            project_primer: None,
            patrol_interval_secs: 30,
            background_automation_enabled: true,
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
            idea_store: None,
            gateway_manager: Arc::new(GatewayManager::new()),
        }
    }

    pub fn set_background_automation_enabled(&mut self, enabled: bool) {
        self.background_automation_enabled = enabled;
    }

    // Scheduled events create quests via schedule_timer. Delegation via direct session spawning.

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

        // Migrate injection_mode ideas to event-based activation.
        self.run_injection_mode_migration().await;

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

        // Crash recovery: prune orphaned worktrees from crashed executions.
        self.cleanup_orphaned_worktrees().await;

        // Cross-DB orphan cleanup: close sessions for deleted agents.
        if let Err(e) = self.agent_registry.cleanup_orphaned_sessions().await {
            warn!(error = %e, "orphan cleanup failed");
        }

        // Purge legacy lifecycle: events (replaced by session: events).
        {
            let db = self.agent_registry.db();
            let conn = db.lock().await;
            let purged = conn
                .execute("DELETE FROM events WHERE pattern LIKE 'lifecycle:%'", [])
                .unwrap_or(0);
            if purged > 0 {
                info!(count = purged, "purged legacy lifecycle: events");
            }
        }

        info!("daemon started");

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

    /// Spawn background listeners for event handlers and execution event buffering.
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

    /// Event matcher — no-op. Lifecycle events are context injection only.
    /// Scheduled events create quests via schedule_timer, not here.
    fn spawn_event_matcher(&self) {
        // No-op. All event-driven quest creation is in schedule_timer.rs.
    }

    /// Spawn the ScheduleTimer — fires schedule-type events by spawning sessions.
    fn spawn_schedule_timer(&self) {
        let Some(ref ehs) = self.event_handler_store else {
            return;
        };
        let timer = crate::schedule_timer::ScheduleTimer::new(
            ehs.clone(),
            self.agent_registry.clone(),
            self.activity_log.clone(),
            self.session_manager.clone(),
            self.default_provider.clone(),
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
        // Set restrictive permissions on the socket directory.
        #[cfg(unix)]
        if let Some(parent) = sock_path.parent() {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
        match tokio::net::UnixListener::bind(sock_path) {
            Ok(listener) => {
                // Restrict socket to owner only.
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ =
                        std::fs::set_permissions(sock_path, std::fs::Permissions::from_mode(0o600));
                }
                let ipc_ctx = Arc::new(IpcContext {
                    metrics: self.metrics.clone(),
                    activity_log: self.activity_log.clone(),
                    session_store: self.session_store.clone(),
                    idea_store: self.idea_store.clone(),
                    daily_budget_usd: self.daily_budget_usd,
                    project_budgets: self.project_budgets.clone(),
                    prompt_loader: self.prompt_loader.clone(),
                    event_handler_store: self.event_handler_store.clone(),
                });
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
                let gateway_manager = self.gateway_manager.clone();
                info!(path = %sock_path.display(), "IPC socket listening");
                tokio::spawn(async move {
                    Self::socket_accept_loop(
                        listener,
                        ipc_ctx,
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
                        gateway_manager,
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

    /// Load persisted state from disk.
    async fn load_persisted_state(&self) {
        // Cost entries and events are stored in ActivityLog (SQLite) — no load needed.
    }

    /// Migrate injection_mode ideas to event-based activation (idempotent).
    ///
    /// Runs once at daemon startup. For each agent with injection_mode ideas,
    /// creates or updates an `on_session_start` event referencing those idea IDs.
    async fn run_injection_mode_migration(&self) {
        let event_store = match self.event_handler_store.as_ref() {
            Some(s) => s,
            None => return,
        };

        let idea_store = match self
            .message_router
            .as_ref()
            .and_then(|mr| mr.idea_store.as_ref())
        {
            Some(s) => s,
            None => return,
        };

        match crate::event_handler::migrate_injection_mode_to_events(
            idea_store.as_ref(),
            event_store,
        )
        .await
        {
            Ok(count) if count > 0 => {
                info!(
                    count,
                    "migrated injection_mode ideas to event-based activation"
                );
            }
            Err(e) => {
                warn!(error = %e, "injection_mode migration failed");
            }
            _ => {}
        }
    }

    /// Prune orphaned worktrees from crashed executions.
    /// Scans the worktree directory, cross-references with open quests,
    /// and removes worktrees that don't belong to any active quest.
    async fn cleanup_orphaned_worktrees(&self) {
        let worktree_base = dirs::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
            .join(".aeqi")
            .join("worktrees");

        let entries = match std::fs::read_dir(&worktree_base) {
            Ok(entries) => entries,
            Err(_) => return, // Directory doesn't exist yet, nothing to clean.
        };

        let mut orphan_count = 0;
        for entry in entries.flatten() {
            let dir_name = entry.file_name().to_string_lossy().to_string();
            // Check if this worktree belongs to an open quest.
            let quest = self.agent_registry.get_task(&dir_name).await.ok().flatten();
            let is_open = quest.as_ref().is_some_and(|q| {
                !matches!(
                    q.status,
                    aeqi_quests::QuestStatus::Done | aeqi_quests::QuestStatus::Cancelled
                )
            });

            if !is_open {
                // Orphan — remove worktree.
                let path = entry.path();
                if let Err(e) = std::fs::remove_dir_all(&path) {
                    warn!(path = %path.display(), error = %e, "failed to remove orphaned worktree");
                } else {
                    orphan_count += 1;
                }
            }
        }

        if orphan_count > 0 {
            info!(count = orphan_count, "cleaned up orphaned worktrees");
            // Also prune git worktree references.
            let _ = std::process::Command::new("git")
                .args(["worktree", "prune"])
                .output();
        }
    }

    /// Run one patrol iteration: config reload, persistence, metrics, pruning.
    async fn run_patrol_iteration(&mut self) {
        // 1. Patrol cycle: unified scheduler handles reap -> query -> spawn.
        if let Err(e) = self.scheduler.schedule().await {
            warn!(error = %e, "scheduler cycle failed");
        }

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
                match mem.store(&w.name, &w.content, &w.tags, None).await {
                    Ok(id) => debug!(
                        project = %w.project,
                        id = %id,
                        name = %w.name,
                        "debounced write persisted"
                    ),
                    Err(e) => warn!(
                        project = %w.project,
                        name = %w.name,
                        "debounced write failed: {e}"
                    ),
                }
            } else {
                debug!(
                    project = %w.project,
                    name = %w.name,
                    "no idea store available — write dropped"
                );
            }
        }
    }

    /// The main patrol loop: event-driven with a safety-net patrol timer.
    ///
    /// Primary dispatch is push-based via ActivityLog broadcast: when quest_created
    /// or quest_completed events arrive, schedule() runs immediately (sub-ms).
    /// The full patrol iteration (metrics, pruning, etc.) runs on a
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
        gateway_manager: Arc<GatewayManager>,
    ) {
        loop {
            if !running.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            match listener.accept().await {
                Ok((stream, _)) => {
                    let ipc_ctx = ipc_ctx.clone();
                    let agent_registry = agent_registry.clone();
                    let message_router = message_router.clone();
                    let activity_buffer = activity_buffer.clone();
                    let readiness = readiness.clone();
                    let default_provider = default_provider.clone();
                    let default_model = default_model.clone();
                    let session_manager = session_manager.clone();
                    let activity_stream = activity_stream.clone();
                    let scheduler = scheduler.clone();
                    let gateway_manager = gateway_manager.clone();
                    tokio::spawn(async move {
                        if let Err(e) = Self::handle_socket_connection(
                            stream,
                            ipc_ctx,
                            agent_registry,
                            message_router,
                            activity_buffer,
                            readiness,
                            default_provider,
                            default_model,
                            session_manager,
                            activity_stream,
                            scheduler,
                            gateway_manager,
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
        agent_registry: Arc<AgentRegistry>,
        message_router: Option<Arc<MessageRouter>>,
        activity_buffer: Arc<Mutex<ActivityBuffer>>,
        readiness: ReadinessContext,
        default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
        default_model: String,
        session_manager: Arc<SessionManager>,
        _activity_stream: Arc<ActivityStream>,
        scheduler: Arc<Scheduler>,
        gateway_manager: Arc<GatewayManager>,
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
                event_handler_store: ipc_ctx.event_handler_store.clone(),
                agent_registry: agent_registry.clone(),
                idea_store: ipc_ctx.idea_store.clone(),
                message_router: message_router.clone(),
                activity_buffer: activity_buffer.clone(),
                default_provider: default_provider.clone(),
                default_model: default_model.clone(),
                session_manager: session_manager.clone(),
                scheduler: scheduler.clone(),
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

                "metrics" => {
                    crate::ipc::status::handle_metrics(&ctx, &request, &allowed_companies).await
                }
                "cost" => crate::ipc::status::handle_cost(&ctx, &request, &allowed_companies).await,
                "activity" | "audit" => {
                    crate::ipc::status::handle_activity(&ctx, &request, &allowed_companies).await
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

                "quests" => {
                    crate::ipc::quests::handle_quests(&ctx, &request, &allowed_companies).await
                }
                "create_quest" => {
                    crate::ipc::quests::handle_create_quest(&ctx, &request, &allowed_companies)
                        .await
                }
                "get_quest" => {
                    crate::ipc::quests::handle_get_quest(&ctx, &request, &allowed_companies).await
                }
                "update_quest" => {
                    crate::ipc::quests::handle_update_quest(&ctx, &request, &allowed_companies)
                        .await
                }
                "close_quest" => {
                    crate::ipc::quests::handle_close_quest(&ctx, &request, &allowed_companies).await
                }

                "post_notes" => {
                    crate::ipc::chat::handle_post_notes(&ctx, &request, &allowed_companies).await
                }
                "chat" => crate::ipc::chat::handle_chat(&ctx, &request, &allowed_companies).await,
                "session_message" => {
                    match crate::ipc::chat::handle_session_message(
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
                "agent_set_model" => {
                    let id = request_field(&request, "id").unwrap_or("");
                    let model = request_field(&request, "model").unwrap_or("");
                    if id.is_empty() {
                        serde_json::json!({"ok": false, "error": "id required"})
                    } else {
                        match agent_registry.set_model(id, model).await {
                            Ok(()) => serde_json::json!({"ok": true}),
                            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                        }
                    }
                }
                "agent_set_tool_deny" => {
                    let id = request_field(&request, "id").unwrap_or("");
                    let tool_deny: Vec<String> = request
                        .get("tool_deny")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    if id.is_empty() {
                        serde_json::json!({"ok": false, "error": "id required"})
                    } else {
                        match agent_registry.set_tool_deny(id, &tool_deny).await {
                            Ok(()) => serde_json::json!({"ok": true}),
                            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                        }
                    }
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

                "seed_ideas" => {
                    crate::ipc::prompts::handle_seed_ideas(&ctx, &request, &allowed_companies).await
                }
                "list_ideas" => {
                    crate::ipc::ideas::handle_list_ideas(&ctx, &request, &allowed_companies).await
                }
                "store_idea" => {
                    crate::ipc::ideas::handle_store_idea(&ctx, &request, &allowed_companies).await
                }
                "update_idea" => {
                    crate::ipc::ideas::handle_update_idea(&ctx, &request, &allowed_companies).await
                }
                "delete_idea" => {
                    crate::ipc::ideas::handle_delete_idea(&ctx, &request, &allowed_companies).await
                }
                "search_ideas" => {
                    crate::ipc::ideas::handle_search_ideas(&ctx, &request, &allowed_companies).await
                }

                "list_events" => {
                    crate::ipc::events::handle_list_events(&ctx, &request, &allowed_companies).await
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
                "trigger_event" => {
                    crate::ipc::events::handle_trigger_event(&ctx, &request, &allowed_companies)
                        .await
                }

                "list_sessions" => {
                    crate::ipc::sessions::handle_list_sessions(&ctx, &request, &allowed_companies)
                        .await
                }
                "list_channel_sessions" => {
                    crate::ipc::sessions::handle_list_channel_sessions(
                        &ctx,
                        &request,
                        &allowed_companies,
                    )
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

                "session_fork" => {
                    let session_id = request_field(&request, "session_id").unwrap_or("");
                    let message_id = request
                        .get("message_id")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    if session_id.is_empty() || message_id == 0 {
                        serde_json::json!({"ok": false, "error": "session_id and message_id required"})
                    } else if let Some(ref ss) = ipc_ctx.session_store {
                        match ss.fork_session(session_id, message_id).await {
                            Ok(new_id) => serde_json::json!({"ok": true, "session_id": new_id}),
                            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                        }
                    } else {
                        serde_json::json!({"ok": false, "error": "session store not available"})
                    }
                }

                "session_cancel" => {
                    let session_id = request_field(&request, "session_id").unwrap_or("");
                    if session_id.is_empty() {
                        serde_json::json!({"ok": false, "error": "session_id required"})
                    } else {
                        let cancelled = session_manager.cancel_session(session_id).await;
                        serde_json::json!({"ok": true, "cancelled": cancelled})
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

                        // Resolve web sender identity (anonymous — no auth context yet).
                        let web_sender_id: Option<String> = if let Some(ref cs) = session_store {
                            cs.resolve_sender("web", "anonymous", "Web User", None, None, None)
                                .await
                                .ok()
                                .map(|s| s.id)
                        } else {
                            None
                        };

                        // Resolve store_session_id: use explicit session_id_hint, or find/create one.
                        let store_session_id: Option<String> = if let Some(ref sid) =
                            session_id_hint
                        {
                            // Verify session exists; record user message with sender identity.
                            if let Some(ref cs) = session_store {
                                let _ = cs
                                    .record_event_by_session_with_sender(
                                        sid,
                                        "message",
                                        "user",
                                        message,
                                        Some("web"),
                                        None,
                                        web_sender_id.as_deref(),
                                        Some("web"),
                                    )
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
                                    .record_event_by_session_with_sender(
                                        sid,
                                        "message",
                                        "user",
                                        message,
                                        Some("web"),
                                        None,
                                        web_sender_id.as_deref(),
                                        Some("web"),
                                    )
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

                        // Resolve agent sender for identity-aware response recording.
                        let agent_sender_id: Option<String> = if let Some(ref cs) = session_store {
                            let agent_uuid = agent_id_direct.as_deref().unwrap_or(&agent_hint);
                            cs.resolve_sender("agent", agent_uuid, &agent_hint, None, None, None)
                                .await
                                .ok()
                                .map(|s| s.id)
                        } else {
                            None
                        };

                        // Check if session is already running in memory.
                        if !resolved_session_id.is_empty()
                            && session_manager.is_running(&resolved_session_id).await
                        {
                            // Activate persistent gateways (e.g. Telegram) for this session.
                            if let Some(stream_sender) = session_manager
                                .get_stream_sender(&resolved_session_id)
                                .await
                            {
                                gateway_manager
                                    .activate_persistent(&resolved_session_id, &stream_sender)
                                    .await;
                            }
                            // Assemble session:execution_start ideas for this agent.
                            let exec_ideas: Option<String> = if let Some(ref ehs) =
                                ipc_ctx.event_handler_store
                            {
                                let agent_uuid = agent_id_direct.as_deref().unwrap_or(&agent_hint);
                                let exec_events = ehs
                                    .get_events_for_pattern(agent_uuid, "session:execution_start")
                                    .await;
                                let mut idea_ids: Vec<String> = Vec::new();
                                for ev in &exec_events {
                                    idea_ids.extend(
                                        ev.idea_ids.iter().filter(|id| !id.is_empty()).cloned(),
                                    );
                                }
                                if !idea_ids.is_empty() {
                                    if let Some(ref store) = ipc_ctx.idea_store {
                                        if let Ok(ideas) = store.get_by_ids(&idea_ids).await {
                                            let ctx = ideas
                                                .iter()
                                                .map(|i| format!("## {}\n{}", i.name, i.content))
                                                .collect::<Vec<_>>()
                                                .join("\n\n");
                                            if !ctx.is_empty() { Some(ctx) } else { None }
                                        } else {
                                            None
                                        }
                                    } else {
                                        None
                                    }
                                } else {
                                    None
                                }
                            } else {
                                None
                            };

                            // Ensure GatewayManager dispatcher is running for recording.
                            // This guarantees responses are recorded even if the WebSocket disconnects.
                            if let Some(stream_sender) = session_manager
                                .get_stream_sender(&resolved_session_id)
                                .await
                            {
                                gateway_manager
                                    .ensure_dispatcher(&resolved_session_id, &stream_sender)
                                    .await;
                            }

                            if stream_mode {
                                match session_manager
                                    .send_streaming_with_ideas(
                                        &resolved_session_id,
                                        message,
                                        exec_ideas.clone(),
                                    )
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
                                                                    let _ = cs.record_event_by_session_with_sender(
                                                                        usid, "message", "assistant", &text, Some("web"),
                                                                        None, agent_sender_id.as_deref(), Some("web"),
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
                                                                    let _ = cs.record_event_by_session_with_sender(
                                                                        usid, "message", "assistant", &text, Some("web"),
                                                                        None, agent_sender_id.as_deref(), Some("web"),
                                                                    ).await;
                                                                }
                                                            prompt_tokens = *pt;
                                                            completion_tokens = *ct;
                                                            iterations = *it;
                                                            // Auto-commit worktree changes at end of turn.
                                                            session_manager.auto_commit(&resolved_session_id, *it).await;
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
                                            && store_session_id.is_none()
                                        {
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
                                                    .record_event_by_session_with_sender(
                                                        usid,
                                                        "message",
                                                        "assistant",
                                                        &resp.text,
                                                        Some("web"),
                                                        None,
                                                        agent_sender_id.as_deref(),
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
                                crate::session_manager::SpawnOptions::interactive()
                                    .with_transport("web".to_string());
                            spawn_opts.extra_prompts = extra_prompts;
                            if let Some(ref sid) = web_sender_id {
                                spawn_opts = spawn_opts.with_sender_id(sid.clone());
                            }
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

                                    // Activate persistent gateways + ensure dispatcher for recording.
                                    gateway_manager
                                        .activate_persistent(&session_id, &spawned.stream_sender)
                                        .await;
                                    gateway_manager
                                        .ensure_dispatcher(&session_id, &spawned.stream_sender)
                                        .await;

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
                                                                    .record_event_by_session_with_sender(
                                                                        usid, "message", "assistant",
                                                                        &step_text, Some("web"),
                                                                        None, agent_sender_id.as_deref(), Some("web"),
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
                                                                    .record_event_by_session_with_sender(
                                                                        usid, "message", "assistant",
                                                                        &step_text, Some("web"),
                                                                        None, agent_sender_id.as_deref(), Some("web"),
                                                                    )
                                                                    .await;
                                                            }
                                                            step_text.clear();
                                                        }
                                                        prompt_tokens = *pt;
                                                        completion_tokens = *ct;
                                                        iterations = *it;
                                                        // Auto-commit worktree changes at end of turn.
                                                        session_manager
                                                            .auto_commit(&session_id, *it)
                                                            .await;
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
                                        && store_session_id.is_none()
                                        && !full_text.is_empty()
                                    {
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

                // Canonical idea commands.
                "ideas" | "memories" => {
                    crate::ipc::ideas::handle_ideas_search(&ctx, &request, &allowed_companies).await
                }
                "idea_profile" | "memory_profile" => {
                    crate::ipc::ideas::handle_idea_profile(&ctx, &request, &allowed_companies).await
                }
                "idea_graph" | "memory_graph" => {
                    crate::ipc::ideas::handle_idea_graph(&ctx, &request, &allowed_companies).await
                }
                "idea_prefix" | "memory_prefix" => {
                    crate::ipc::ideas::handle_idea_prefix(&ctx, &request, &allowed_companies).await
                }
                "company_knowledge" => {
                    crate::ipc::ideas::handle_company_knowledge(&ctx, &request, &allowed_companies)
                        .await
                }
                "channel_knowledge" => {
                    crate::ipc::ideas::handle_channel_knowledge(&ctx, &request, &allowed_companies)
                        .await
                }
                "knowledge_store" => {
                    crate::ipc::ideas::handle_knowledge_store(&ctx, &request, &allowed_companies)
                        .await
                }
                "knowledge_delete" => {
                    crate::ipc::ideas::handle_knowledge_delete(&ctx, &request, &allowed_companies)
                        .await
                }
                "ideas_by_ids" => {
                    let ids: Vec<String> = request
                        .get("ids")
                        .and_then(|v| v.as_array())
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                .collect()
                        })
                        .unwrap_or_default();
                    if let Some(ref store) = ctx.idea_store {
                        match store.get_by_ids(&ids).await {
                            Ok(ideas) => {
                                let items: Vec<serde_json::Value> = ideas
                                    .iter()
                                    .map(|i| {
                                        serde_json::json!({
                                            "id": i.id,
                                            "name": i.name,
                                            "content": i.content,
                                            "tags": i.tags,
                                        })
                                    })
                                    .collect();
                                serde_json::json!({"ok": true, "ideas": items})
                            }
                            Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
                        }
                    } else {
                        serde_json::json!({"ok": false, "error": "no idea store"})
                    }
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

pub fn readiness_response(
    mut worker_limits: Vec<(String, u32)>,
    budget_status: (f64, f64, f64),
    readiness: &ReadinessContext,
) -> serde_json::Value {
    let (spent, budget, remaining) = budget_status;
    worker_limits.sort_by(|a, b| a.0.cmp(&b.0));

    let registered_owners: Vec<String> =
        worker_limits.iter().map(|(name, _)| name.clone()).collect();
    let max_workers: u32 = worker_limits.iter().map(|(_, workers)| *workers).sum();

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

    serde_json::json!({
        "ok": true,
        "ready": blocking_reasons.is_empty(),
        "configured_projects": readiness.configured_projects,
        "configured_advisors": readiness.configured_advisors,
        "registered_owners": registered_owners,
        "registered_owner_count": registered_owners.len(),
        "max_workers": max_workers,
        "cost_today_usd": spent,
        "daily_budget_usd": budget,
        "budget_remaining_usd": remaining,
        "skipped_projects": readiness.skipped_projects.clone(),
        "skipped_advisors": readiness.skipped_advisors.clone(),
        "blocking_reasons": blocking_reasons,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        Activity, ActivityBuffer, ReadinessContext, readiness_response, resolve_web_chat_id,
    };
    use crate::session_store::{agency_chat_id, named_channel_chat_id, project_chat_id};

    #[test]
    fn readiness_blocks_when_owner_registration_is_incomplete() {
        let response = readiness_response(
            vec![("alpha".to_string(), 2)],
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
    fn readiness_blocks_when_budget_is_exhausted() {
        let response = readiness_response(
            vec![("alpha".to_string(), 2)],
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
