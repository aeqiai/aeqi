use anyhow::Result;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::activity::{Activity, ActivityStream};
use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::dispatch::Dispatcher;
use crate::gateway_manager::GatewayManager;
use crate::message_router::MessageRouter;
use crate::metrics::AEQIMetrics;
use crate::progress_tracker::ProgressTracker;
use crate::scope_visibility;
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
    skill_loader: Option<Arc<crate::skill_loader::SkillLoader>>,
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
    stream_registry: Arc<crate::stream_registry::StreamRegistry>,
    execution_registry: Arc<crate::execution_registry::ExecutionRegistry>,
    channel_spawner: Option<Arc<dyn crate::channel_registry::ChannelSpawner>>,
    // ── Round 3 additions (Agent W — write-path wiring) ──────────────────
    /// Shared policy cache used by the idea store dispatch. Initialised
    /// in `spawn_ipc_listener` alongside the embed queue so every IPC
    /// request sees the same cache generation.
    tag_policy_cache: Arc<aeqi_ideas::tag_policy::TagPolicyCache>,
    /// Sender side of the async embedding queue. The worker is spawned
    /// once per daemon boot and owns the receiver.
    embed_queue: Arc<aeqi_ideas::embed_worker::EmbedQueue>,
    // ── Round 3 retrieval-side additions (Agent R) ──────────────────────
    embedder: Option<Arc<dyn aeqi_core::traits::Embedder>>,
    recall_cache: Arc<aeqi_ideas::RecallCache>,
    // ── Round 6 additions (event-chain reflection loop) ────────────────
    /// Daemon-level pattern dispatcher. Built once at startup once the
    /// event store, agent registry, and session store are all available.
    /// Handed to every CommandContext so IPC handlers can fire patterns
    /// like `ideas:threshold_reached` outside a live session.
    pattern_dispatcher: Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
    // ── T1.9.1 (Move B.4) credentials substrate handle ─────────────────
    credentials: Option<Arc<aeqi_core::credentials::CredentialStore>>,
}

/// The Daemon: background process that runs the scheduler patrol loop
/// and event system.
pub struct Daemon {
    pub metrics: Arc<AEQIMetrics>,
    pub activity_log: Arc<ActivityLog>,
    pub session_store: Option<Arc<SessionStore>>,
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
    /// Global dispatch config holder (admission caps, retry policy).
    pub dispatcher: Arc<Dispatcher>,
    /// Unified prompt loader.
    pub skill_loader: Option<Arc<crate::skill_loader::SkillLoader>>,
    /// Event handler store (the fourth primitive).
    pub event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
    /// Shared idea store.
    pub idea_store: Option<Arc<dyn aeqi_core::traits::IdeaStore>>,
    /// Gateway manager for session output delivery.
    pub gateway_manager: Arc<GatewayManager>,
    /// Per-session broadcast bus for streaming agent events to IPC/WS clients.
    /// Lives longer than any single execution: the IPC handler subscribes
    /// *before* it enqueues a pending message, and the queue executor
    /// publishes through this same registry so the subscriber sees the
    /// events even though enqueue and execute are decoupled.
    pub stream_registry: Arc<crate::stream_registry::StreamRegistry>,
    /// Per-execution handles — cancel tokens and sandbox pointers for the
    /// live `agent.run()` tasks. Short-lived: the queue executor inserts
    /// on spawn and removes on join. IPC stop / auto-commit read from here.
    pub execution_registry: Arc<crate::execution_registry::ExecutionRegistry>,
    /// Brings a newly-persisted channel row live without waiting for a
    /// daemon restart. Populated by the CLI at startup; `None` leaves the
    /// old "spawn-on-boot" behavior intact.
    pub channel_spawner: Option<Arc<dyn crate::channel_registry::ChannelSpawner>>,
    // ── Round 3 retrieval-side additions (Agent R) ──────────────────────
    /// Embedder used by the daemon search path. `None` → BM25-only.
    pub embedder: Option<Arc<dyn aeqi_core::traits::Embedder>>,
    /// Daemon-wide recall cache; shared by every IPC handler via the
    /// CommandContext clone.
    pub recall_cache: Arc<aeqi_ideas::RecallCache>,
    /// Daemon-level pattern dispatcher. Built once on `run()` so it can be
    /// shared by every code path that needs to fire `session:quest_end` /
    /// `ideas:threshold_reached` outside a live session: the IPC handlers
    /// (`CommandContext`), the autonomous worker's quest-finalize path
    /// (`QueueExecutor`), and the IPC quests handler. Wiring it once here
    /// avoids three independently-built registries with subtly different
    /// capability flags.
    pub pattern_dispatcher: Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
    /// T1.9.1 — Move B.4: Substrate handle wired through to IPC handlers
    /// so `channels.create` writes the inbound token to the credentials
    /// table instead of the channel row's config blob.
    pub credentials: Option<Arc<aeqi_core::credentials::CredentialStore>>,
}

impl Daemon {
    pub fn new(
        metrics: Arc<AEQIMetrics>,
        dispatcher: Arc<Dispatcher>,
        agent_registry: Arc<AgentRegistry>,
        activity_log: Arc<ActivityLog>,
    ) -> Self {
        Self {
            metrics,
            activity_log,
            session_store: None,
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
            dispatcher,
            skill_loader: None,
            event_handler_store: None,
            idea_store: None,
            gateway_manager: Arc::new(GatewayManager::new()),
            stream_registry: Arc::new(crate::stream_registry::StreamRegistry::new()),
            execution_registry: Arc::new(crate::execution_registry::ExecutionRegistry::new()),
            channel_spawner: None,
            // ── Round 3 retrieval-side additions (Agent R) ──────────────
            embedder: None,
            recall_cache: Arc::new(aeqi_ideas::RecallCache::default()),
            pattern_dispatcher: None,
            credentials: None,
        }
    }

    pub fn set_channel_spawner(
        &mut self,
        spawner: Arc<dyn crate::channel_registry::ChannelSpawner>,
    ) {
        self.channel_spawner = Some(spawner);
    }

    /// T1.9.1 — wire the credentials substrate handle into the daemon so
    /// IPC handlers (notably `channels.create`) and gateway spawners can
    /// route token reads / writes through the canonical store.
    pub fn set_credentials(&mut self, credentials: Arc<aeqi_core::credentials::CredentialStore>) {
        self.credentials = Some(credentials);
    }

    // ── Round 3 retrieval-side additions (Agent R) ──────────────────────
    /// Attach the embedder used by the daemon's search path. Expected to
    /// be the same instance passed to `SqliteIdeas::with_embedder` so
    /// query embedding and stored embeddings come from the same model.
    pub fn set_embedder(&mut self, embedder: Arc<dyn aeqi_core::traits::Embedder>) {
        self.embedder = Some(embedder);
    }

    /// Replace the recall cache — used by tests that want to inspect
    /// invalidation from outside. Production callers leave the default.
    pub fn set_recall_cache(&mut self, cache: Arc<aeqi_ideas::RecallCache>) {
        self.recall_cache = cache;
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

        // Build the daemon-level pattern dispatcher up-front so every
        // background-task construction site below can clone it: the IPC
        // listener (for `CommandContext`), the queue recovery / quest
        // enqueuer paths (for `QueueExecutor::pattern_dispatcher`), and the
        // gateway listener path. Three independently-built dispatchers
        // would mean three runtime registries with subtly different
        // capability flags — building it once avoids that drift.
        if self.pattern_dispatcher.is_none() {
            self.pattern_dispatcher = build_daemon_pattern_dispatcher(
                self.event_handler_store.clone(),
                self.session_store.clone(),
                self.idea_store.clone(),
                self.agent_registry.clone(),
                self.default_provider.clone(),
                self.default_model.clone(),
            );
        }

        self.spawn_signal_handlers();
        self.spawn_activity_buffer();
        self.spawn_event_matcher();
        self.spawn_schedule_timer();
        self.spawn_ipc_listener();
        // ── Round 3 retrieval-side additions (Agent R) ──────────────────
        self.spawn_co_retrieval_decay_patrol();
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

        // Crash recovery: prune orphaned worktrees from crashed executions.
        self.cleanup_orphaned_worktrees().await;

        // Queue recovery: drop `running` pending_messages rows left behind by
        // a crashed daemon (agent runs have side effects so replaying is
        // usually wrong), then resume drain for any session that still has
        // queued work. Requires both session_store and default_provider.
        if let (Some(ss), Some(prov)) = (self.session_store.clone(), self.default_provider.clone())
        {
            let executor: Arc<dyn crate::session_queue::SessionExecutor> =
                Arc::new(crate::queue_executor::QueueExecutor {
                    session_manager: self.session_manager.clone(),
                    agent_registry: self.agent_registry.clone(),
                    stream_registry: self.stream_registry.clone(),
                    execution_registry: self.execution_registry.clone(),
                    provider: prov,
                    activity_log: Some(self.activity_log.clone()),
                    session_store: Some(ss.clone()),
                    idea_store: self.idea_store.clone(),
                    adaptive_retry: self.dispatcher.config.adaptive_retry,
                    failure_analysis_model: self.dispatcher.config.failure_analysis_model.clone(),
                    extra_tools: Vec::new(),
                    pattern_dispatcher: self.pattern_dispatcher.clone(),
                });
            if let Err(e) = crate::session_queue::recover_on_boot(ss, executor).await {
                warn!(error = %e, "session_queue::recover_on_boot failed");
            }
        }

        // Cross-DB orphan cleanup: close sessions for deleted agents.
        if let Err(e) = self.agent_registry.cleanup_orphaned_sessions().await {
            warn!(error = %e, "orphan cleanup failed");
        }

        // Drop legacy lifecycle:* events and per-agent system events that
        // shadow globals. See `purge_redundant_system_events` for details.
        {
            let db = self.agent_registry.db();
            let conn = db.lock().await;
            match crate::event_handler::purge_redundant_system_events(&conn) {
                Ok((legacy, shadows)) => {
                    if legacy > 0 {
                        info!(count = legacy, "purged legacy lifecycle: events");
                    }
                    if shadows > 0 {
                        info!(
                            count = shadows,
                            "purged per-agent system events redundant with globals"
                        );
                    }
                }
                Err(e) => warn!(error = %e, "event cleanup failed"),
            }
        }

        // Unified rail: QuestEnqueuer drains ready quests into pending_messages;
        // QueueExecutor spawns sessions via SessionManager::spawn_session. The
        // legacy `Scheduler::schedule` worker pool has been retired.
        if let (Some(ss), Some(prov)) = (self.session_store.clone(), self.default_provider.clone())
        {
            let executor: Arc<dyn crate::session_queue::SessionExecutor> =
                Arc::new(crate::queue_executor::QueueExecutor {
                    session_manager: self.session_manager.clone(),
                    agent_registry: self.agent_registry.clone(),
                    stream_registry: self.stream_registry.clone(),
                    execution_registry: self.execution_registry.clone(),
                    provider: prov,
                    activity_log: Some(self.activity_log.clone()),
                    session_store: Some(ss.clone()),
                    idea_store: self.idea_store.clone(),
                    adaptive_retry: self.dispatcher.config.adaptive_retry,
                    failure_analysis_model: self.dispatcher.config.failure_analysis_model.clone(),
                    extra_tools: Vec::new(),
                    pattern_dispatcher: self.pattern_dispatcher.clone(),
                });
            let config = crate::dispatch::DispatchConfig {
                max_workers: self.dispatcher.config.max_workers,
                default_timeout_secs: self.dispatcher.config.default_timeout_secs,
                worker_max_budget_usd: self.dispatcher.config.worker_max_budget_usd,
                daily_budget_usd: self.dispatcher.config.daily_budget_usd,
                adaptive_retry: self.dispatcher.config.adaptive_retry,
                failure_analysis_model: self.dispatcher.config.failure_analysis_model.clone(),
                max_task_retries: self.dispatcher.config.max_task_retries,
            };
            let enqueuer = Arc::new(crate::quest_enqueuer::QuestEnqueuer::new(
                self.agent_registry.clone(),
                self.activity_log.clone(),
                ss,
                executor,
                config,
            ));
            let shutdown = self.shutdown_notify.clone();
            tokio::spawn(async move {
                enqueuer.run(shutdown).await;
            });
            info!("quest enqueuer launched");
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
            self.execution_registry.clone(),
            self.default_provider.clone(),
        );
        let shutdown = self.shutdown_notify.clone();
        tokio::spawn(async move {
            timer.run(shutdown).await;
        });
    }

    /// Spawn the co-retrieval decay patrol — every 6 hours, decay edges
    /// that haven't been reinforced in the last 14 days. Keeps the
    /// co-retrieval graph from growing unbounded while preserving
    /// recently-used pairs.
    fn spawn_co_retrieval_decay_patrol(&self) {
        let Some(store) = self.idea_store.clone() else {
            return;
        };
        let shutdown = self.shutdown_notify.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(6 * 3600));
            // Skip the immediate tick so startup doesn't trigger a write.
            interval.tick().await;
            loop {
                tokio::select! {
                    _ = shutdown.notified() => break,
                    _ = interval.tick() => {
                        match store.decay_co_retrieval_older_than(14).await {
                            Ok(n) if n > 0 => {
                                info!(touched = n, "co-retrieval decay patrol ran");
                            }
                            Ok(_) => {}
                            Err(e) => {
                                warn!(error = %e, "co-retrieval decay patrol failed");
                            }
                        }
                    }
                }
            }
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
                // ── Round 3 (Agent W): write-path wiring ─────────────────
                // 1. TagPolicyCache is shared across every IPC request so
                //    invalidations land in one place.
                // 2. EmbedQueue is a cheap Arc; the worker takes the rx
                //    side below and runs for the daemon's lifetime.
                //    When no embedder is configured, `run_no_op` drains
                //    the queue so enqueue never blocks.
                //
                //    N.B. Agent R will add the embedder + decay patrol
                //    fields here in the same IpcContext block. Leave a
                //    vertical gap below the embed_queue line so their
                //    merge is trivial.
                let tag_policy_cache = aeqi_ideas::tag_policy::default_cache();
                let (embed_queue, embed_rx) = aeqi_ideas::embed_worker::EmbedQueue::channel(1024);
                let embed_queue = Arc::new(embed_queue);

                // Spawn the embedding worker. Agent R replaces this with
                // `run(rx, idea_store.clone(), embedder)` when the embedder
                // is wired into the daemon. Until then the no-op worker
                // drains the queue so enqueue never blocks.
                tokio::spawn(aeqi_ideas::embed_worker::run_no_op(embed_rx));

                // ── Round 6 wiring: daemon-level pattern dispatcher ─────
                //
                // Reuse the daemon-level dispatcher built once in `run()`.
                // It satisfies every code path that needs to fire patterns
                // outside a live session (IPC handlers, queue-finalize,
                // gateway). Building it locally would create a second
                // registry with the same provider closure — wasteful and
                // a source of drift if capability flags ever diverge.
                let pattern_dispatcher = self.pattern_dispatcher.clone();

                let ipc_ctx = Arc::new(IpcContext {
                    metrics: self.metrics.clone(),
                    activity_log: self.activity_log.clone(),
                    session_store: self.session_store.clone(),
                    idea_store: self.idea_store.clone(),
                    daily_budget_usd: self.daily_budget_usd,
                    skill_loader: self.skill_loader.clone(),
                    event_handler_store: self.event_handler_store.clone(),
                    stream_registry: self.stream_registry.clone(),
                    execution_registry: self.execution_registry.clone(),
                    channel_spawner: self.channel_spawner.clone(),
                    tag_policy_cache,
                    embed_queue,
                    // ── Round 3 retrieval-side additions (Agent R) ──────
                    embedder: self.embedder.clone(),
                    recall_cache: self.recall_cache.clone(),
                    // ── Round 6 additions ──────────────────────────────
                    pattern_dispatcher,
                    // ── T1.9.1 Move B.4: substrate handle ──────────────
                    credentials: self.credentials.clone(),
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
                let dispatcher = self.dispatcher.clone();
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
                        dispatcher,
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
        // Quest dispatch is owned by `QuestEnqueuer` — no schedule() call here.
        // This iteration is housekeeping only.

        // Check for config reload signal (SIGHUP).
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
    }

    /// Handle SIGHUP config reload: apply budgets, patrol interval.
    async fn apply_config_reload(&mut self) {
        info!("config reload requested (SIGHUP received)");
        match aeqi_core::config::AEQIConfig::discover() {
            Ok((new_config, path)) => {
                self.daily_budget_usd = new_config.security.max_cost_per_day_usd;

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
                match mem
                    .store(&w.name, &w.content, &w.tags, w.agent_id.as_deref())
                    .await
                {
                    Ok(id) => debug!(
                        agent_id = ?w.agent_id,
                        id = %id,
                        name = %w.name,
                        "debounced write persisted"
                    ),
                    Err(e) => warn!(
                        agent_id = ?w.agent_id,
                        name = %w.name,
                        "debounced write failed: {e}"
                    ),
                }
            } else {
                debug!(
                    agent_id = ?w.agent_id,
                    name = %w.name,
                    "no idea store available — write dropped"
                );
            }
        }
    }

    /// The main patrol loop: housekeeping on a 60s timer. Quest dispatch is
    /// owned by `QuestEnqueuer`, which subscribes to the same broadcast and
    /// runs its own event/patrol loop independently.
    async fn run_patrol_loop(&mut self) {
        let mut event_rx = self.activity_log.subscribe();
        let mut patrol = tokio::time::interval(std::time::Duration::from_secs(60));
        self.run_patrol_iteration().await;

        while self.running.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::select! {
                // Drain the broadcast so lag doesn't accumulate; actual
                // scheduling fanout lives in QuestEnqueuer.
                result = event_rx.recv() => {
                    match result {
                        Ok(_) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                            warn!(skipped = n, "daemon event receiver lagged");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                            info!("event broadcast channel closed");
                            break;
                        }
                    }
                }
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
        dispatcher: Arc<Dispatcher>,
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
                    let dispatcher = dispatcher.clone();
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
                            dispatcher,
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
        dispatcher: Arc<Dispatcher>,
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
            let allowed_roots: Option<Vec<String>> = request
                .get("allowed_roots")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                });

            // Pre-check: if request has a `project` param, validate against scope.
            if let Some(denied) = crate::ipc::tenancy::check_project(&allowed_roots, &request) {
                let _ = writer.write_all(denied.to_string().as_bytes()).await;
                let _ = writer.write_all(b"\n").await;
                let _ = writer.flush().await;
                continue;
            }

            // Pre-check: validate write operations against tenant scope.
            // Commands that use `name` to identify an agent (which maps to root agent name).
            if allowed_roots.is_some() {
                let name_field = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let needs_name_check =
                    matches!(cmd, "save_agent_file" | "agent_identity" | "agent_info");
                if needs_name_check
                    && !name_field.is_empty()
                    && !crate::ipc::tenancy::is_allowed(&allowed_roots, name_field)
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
                dispatcher: dispatcher.clone(),
                daily_budget_usd: ipc_ctx.daily_budget_usd,
                skill_loader: ipc_ctx.skill_loader.clone(),
                execution_registry: ipc_ctx.execution_registry.clone(),
                stream_registry: ipc_ctx.stream_registry.clone(),
                channel_spawner: ipc_ctx.channel_spawner.clone(),
                // ── Round 3 additions (Agent W) ────────────────────────
                tag_policy_cache: ipc_ctx.tag_policy_cache.clone(),
                embed_queue: ipc_ctx.embed_queue.clone(),
                // ── Round 3 retrieval-side additions (Agent R) ──────────
                embedder: ipc_ctx.embedder.clone(),
                recall_cache: ipc_ctx.recall_cache.clone(),
                // ── Round 6 additions ──────────────────────────────────
                pattern_dispatcher: ipc_ctx.pattern_dispatcher.clone(),
                // ── T1.9.1 Move B.4 ────────────────────────────────────
                credentials: ipc_ctx.credentials.clone(),
            };

            let response = match cmd {
                "ping" => crate::ipc::status::handle_ping(&ctx, &request, &allowed_roots).await,
                "status" => crate::ipc::status::handle_status(&ctx, &request, &allowed_roots).await,
                "readiness" => {
                    crate::ipc::status::handle_readiness(&ctx, &request, &allowed_roots, &readiness)
                        .await
                }

                "worker_progress" => {
                    crate::ipc::status::handle_worker_progress(&ctx, &request, &allowed_roots).await
                }
                "worker_events" => {
                    crate::ipc::status::handle_worker_events(&ctx, &request, &allowed_roots).await
                }
                "roots" => crate::ipc::roots::handle_roots(&ctx, &request, &allowed_roots).await,

                "create_root" => {
                    crate::ipc::roots::handle_create_root(&ctx, &request, &allowed_roots).await
                }
                "update_root" => {
                    crate::ipc::roots::handle_update_root(&ctx, &request, &allowed_roots).await
                }

                "metrics" => {
                    crate::ipc::status::handle_metrics(&ctx, &request, &allowed_roots).await
                }
                "cost" => crate::ipc::status::handle_cost(&ctx, &request, &allowed_roots).await,
                "activity" | "audit" => {
                    crate::ipc::status::handle_activity(&ctx, &request, &allowed_roots).await
                }
                "expertise" => {
                    crate::ipc::status::handle_expertise(&ctx, &request, &allowed_roots).await
                }
                "rate_limit" => {
                    crate::ipc::status::handle_rate_limit(&ctx, &request, &allowed_roots).await
                }
                "skills" => crate::ipc::status::handle_skills(&ctx, &request, &allowed_roots).await,
                "pipelines" => {
                    crate::ipc::status::handle_pipelines(&ctx, &request, &allowed_roots).await
                }
                "files_list" => {
                    crate::ipc::files::handle_files_list(&ctx, &request, &allowed_roots).await
                }
                "files_upload" => {
                    crate::ipc::files::handle_files_upload(&ctx, &request, &allowed_roots).await
                }
                "files_read" => {
                    crate::ipc::files::handle_files_read(&ctx, &request, &allowed_roots).await
                }
                "files_delete" => {
                    crate::ipc::files::handle_files_delete(&ctx, &request, &allowed_roots).await
                }

                "channels_list" => {
                    crate::ipc::channels::handle_channels_list(&ctx, &request, &allowed_roots).await
                }
                "channels_upsert" => {
                    crate::ipc::channels::handle_channels_upsert(&ctx, &request, &allowed_roots)
                        .await
                }
                "channels_delete" => {
                    crate::ipc::channels::handle_channels_delete(&ctx, &request, &allowed_roots)
                        .await
                }
                "channels_set_enabled" => {
                    crate::ipc::channels::handle_channels_set_enabled(
                        &ctx,
                        &request,
                        &allowed_roots,
                    )
                    .await
                }
                "channels_set_allowed_chats" => {
                    crate::ipc::channels::handle_channels_set_allowed_chats(
                        &ctx,
                        &request,
                        &allowed_roots,
                    )
                    .await
                }
                "channels_baileys_status" => {
                    crate::ipc::channels::handle_channels_baileys_status(
                        &ctx,
                        &request,
                        &allowed_roots,
                    )
                    .await
                }
                "channels_baileys_logout" => {
                    crate::ipc::channels::handle_channels_baileys_logout(
                        &ctx,
                        &request,
                        &allowed_roots,
                    )
                    .await
                }

                "quests" => crate::ipc::quests::handle_quests(&ctx, &request, &allowed_roots).await,
                "create_quest" => {
                    crate::ipc::quests::handle_create_quest(&ctx, &request, &allowed_roots).await
                }
                "get_quest" => {
                    crate::ipc::quests::handle_get_quest(&ctx, &request, &allowed_roots).await
                }
                "update_quest" => {
                    crate::ipc::quests::handle_update_quest(&ctx, &request, &allowed_roots).await
                }
                "close_quest" => {
                    crate::ipc::quests::handle_close_quest(&ctx, &request, &allowed_roots).await
                }
                "quest_traces" => {
                    crate::ipc::quests::handle_quest_traces(&ctx, &request, &allowed_roots).await
                }
                "quest_preflight" => {
                    crate::ipc::quests::handle_quest_preflight(&ctx, &request).await
                }

                "chat" => crate::ipc::chat::handle_chat(&ctx, &request, &allowed_roots).await,
                "session_message" => {
                    match crate::ipc::chat::handle_session_message(&ctx, &request, &allowed_roots)
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
                    crate::ipc::chat::handle_chat_poll(&ctx, &request, &allowed_roots).await
                }
                "chat_history" => {
                    crate::ipc::chat::handle_chat_history(&ctx, &request, &allowed_roots).await
                }
                "chat_timeline" => {
                    crate::ipc::chat::handle_chat_timeline(&ctx, &request, &allowed_roots).await
                }
                "chat_channels" => {
                    crate::ipc::chat::handle_chat_channels(&ctx, &request, &allowed_roots).await
                }

                "agents_registry" => {
                    crate::ipc::agents::handle_agents_registry(&ctx, &request, &allowed_roots).await
                }
                "agent_children" => {
                    crate::ipc::agents::handle_agent_children(&ctx, &request, &allowed_roots).await
                }
                "agent_spawn" => {
                    crate::ipc::agents::handle_agent_spawn(&ctx, &request, &allowed_roots).await
                }
                "agent_set_status" => {
                    crate::ipc::agents::handle_agent_set_status(&ctx, &request, &allowed_roots)
                        .await
                }
                "agent_delete" => {
                    crate::ipc::agents::handle_agent_delete(&ctx, &request, &allowed_roots).await
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
                    crate::ipc::agents::handle_agent_info(&ctx, &request, &allowed_roots).await
                }
                "agent_identity" => {
                    crate::ipc::agents::handle_agent_identity(&ctx, &request, &allowed_roots).await
                }
                "save_agent_file" => {
                    crate::ipc::agents::handle_save_agent_file(&ctx, &request, &allowed_roots).await
                }
                "budget_policies" => {
                    crate::ipc::agents::handle_budget_policies(&ctx, &request, &allowed_roots).await
                }
                "create_budget_policy" => {
                    crate::ipc::agents::handle_create_budget_policy(&ctx, &request, &allowed_roots)
                        .await
                }
                "set_can_ask_director" => {
                    crate::ipc::agents::handle_set_can_ask_director(&ctx, &request, &allowed_roots)
                        .await
                }
                "inbox" => crate::ipc::inbox::handle_inbox(&ctx, &request, &allowed_roots).await,
                "answer_inbox" => {
                    crate::ipc::inbox::handle_answer_inbox(&ctx, &request, &allowed_roots).await
                }

                "seed_ideas" => {
                    crate::ipc::seed::handle_seed_ideas(&ctx, &request, &allowed_roots).await
                }

                "list_templates" => {
                    crate::ipc::templates::handle_list_templates(&ctx, &request, &allowed_roots)
                        .await
                }
                "template_detail" => {
                    crate::ipc::templates::handle_template_detail(&ctx, &request, &allowed_roots)
                        .await
                }
                "spawn_template" => {
                    crate::ipc::templates::handle_spawn_template(&ctx, &request, &allowed_roots)
                        .await
                }
                "list_ideas" => {
                    crate::ipc::ideas::handle_list_ideas(&ctx, &request, &allowed_roots).await
                }
                // "knowledge_store" is the pre-Apr18 MCP alias kept here so stale
                // long-running MCP binaries (spawned by older claude-code sessions)
                // don't hard-fail against the renamed command.
                "store_idea" | "knowledge_store" => {
                    crate::ipc::ideas::handle_store_idea(&ctx, &request, &allowed_roots).await
                }
                "update_idea" => {
                    crate::ipc::ideas::handle_update_idea(&ctx, &request, &allowed_roots).await
                }
                "delete_idea" | "knowledge_delete" => {
                    crate::ipc::ideas::handle_delete_idea(&ctx, &request, &allowed_roots).await
                }
                "search_ideas" => {
                    crate::ipc::ideas::handle_search_ideas(&ctx, &request, &allowed_roots).await
                }
                "link_idea" => {
                    crate::ipc::ideas::handle_link_idea(&ctx, &request, &allowed_roots).await
                }
                "feedback_idea" => {
                    crate::ipc::ideas::handle_feedback_idea(&ctx, &request, &allowed_roots).await
                }
                "walk_ideas" => {
                    crate::ipc::ideas::handle_walk_ideas(&ctx, &request, &allowed_roots).await
                }

                "list_events" => {
                    crate::ipc::events::handle_list_events(&ctx, &request, &allowed_roots).await
                }
                "get_event" => {
                    crate::ipc::events::handle_get_event(&ctx, &request, &allowed_roots).await
                }
                "create_event" => {
                    crate::ipc::events::handle_create_event(&ctx, &request, &allowed_roots).await
                }
                "update_event" => {
                    crate::ipc::events::handle_update_event(&ctx, &request, &allowed_roots).await
                }
                "delete_event" => {
                    crate::ipc::events::handle_delete_event(&ctx, &request, &allowed_roots).await
                }
                "trigger_event" => {
                    crate::ipc::events::handle_trigger_event(&ctx, &request, &allowed_roots).await
                }
                "trace_events" => {
                    crate::ipc::events::handle_trace_events(&ctx, &request, &allowed_roots).await
                }
                "list_tools" => crate::ipc::events::handle_list_tools(&request).await,
                "install_default_events" => {
                    crate::ipc::events::handle_install_default_events(
                        &ctx,
                        &request,
                        &allowed_roots,
                    )
                    .await
                }

                "list_sessions" => {
                    crate::ipc::sessions::handle_list_sessions(&ctx, &request, &allowed_roots).await
                }
                "list_channel_sessions" => {
                    crate::ipc::sessions::handle_list_channel_sessions(
                        &ctx,
                        &request,
                        &allowed_roots,
                    )
                    .await
                }
                "sessions" => {
                    crate::ipc::sessions::handle_sessions(&ctx, &request, &allowed_roots).await
                }
                "create_session" => {
                    crate::ipc::sessions::handle_create_session(&ctx, &request, &allowed_roots)
                        .await
                }
                "close_session" => {
                    crate::ipc::sessions::handle_close_session(&ctx, &request, &allowed_roots).await
                }
                "session_messages" => {
                    match crate::ipc::sessions::handle_session_messages(
                        &ctx,
                        &request,
                        &allowed_roots,
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
                        &allowed_roots,
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
                        let cancelled = ipc_ctx.execution_registry.cancel(session_id).await;
                        if cancelled {
                            let sender = ipc_ctx.stream_registry.get_or_create(session_id).await;
                            sender.send(aeqi_core::ChatStreamEvent::Status {
                                message: "session stopped by user".to_string(),
                            });

                            // Fire session:stopped lifecycle events for the
                            // session's agent. Pre-persist event_fired rows +
                            // record_fire, then broadcast with prepersisted=true
                            // so the WS handler does not double-write.
                            if let (Some(ss), Some(ehs)) = (
                                ipc_ctx.session_store.as_ref(),
                                ipc_ctx.event_handler_store.as_ref(),
                            ) && let Ok(Some(session)) = ss.get_session(session_id).await
                                && let Some(agent_id) = session.agent_id.as_deref()
                            {
                                let (stopped_clause, stopped_params) =
                                    scope_visibility::visibility_sql_clause(
                                        &agent_registry,
                                        agent_id,
                                    )
                                    .await
                                    .unwrap_or_else(|_| (String::new(), Vec::new()));
                                let events = if stopped_clause.is_empty() {
                                    Vec::new()
                                } else {
                                    ehs.get_events_for_pattern_visible(
                                        &stopped_clause,
                                        &stopped_params,
                                        "session:stopped",
                                    )
                                    .await
                                };
                                for event in events {
                                    let metadata = serde_json::json!({
                                        "event_id": event.id,
                                        "event_name": event.name,
                                        "pattern": event.pattern,
                                        "idea_ids": event.idea_ids,
                                        "scope": event.scope.as_str(),
                                    });
                                    let _ = ss
                                        .record_event_by_session(
                                            session_id,
                                            "event_fired",
                                            "system",
                                            "",
                                            Some("web"),
                                            Some(&metadata),
                                        )
                                        .await;
                                    if let Err(e) = ehs.record_fire(&event.id, 0.0).await {
                                        tracing::warn!(event = %event.id, error = %e, "failed to record session:stopped fire");
                                    }
                                    sender.send(aeqi_core::ChatStreamEvent::EventFired {
                                        event_id: event.id,
                                        event_name: event.name,
                                        pattern: event.pattern,
                                        idea_ids: event.idea_ids,
                                        prepersisted: true,
                                    });
                                }
                            }
                        }
                        serde_json::json!({"ok": true, "cancelled": cancelled})
                    }
                }

                "session_is_active" => {
                    let session_id = request_field(&request, "session_id").unwrap_or("");
                    let active = if session_id.is_empty() {
                        false
                    } else {
                        ipc_ctx.execution_registry.is_active(session_id).await
                    };
                    serde_json::json!({"ok": true, "active": active})
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

                    // Tenancy check: verify agent belongs to an allowed root agent.
                    let send_allowed = if allowed_roots.is_none() {
                        true
                    } else if let Some(ref aid) = agent_id_direct {
                        crate::ipc::tenancy::check_agent_access(
                            &agent_registry,
                            &allowed_roots,
                            aid,
                        )
                        .await
                    } else {
                        match agent_registry.resolve_by_hint(&agent_hint).await {
                            Ok(Some(agent)) => {
                                crate::ipc::tenancy::check_agent_access(
                                    &agent_registry,
                                    &allowed_roots,
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

                        // Resolve store_session_id: use explicit session_id_hint,
                        // find existing active session, or generate a fresh UUID.
                        //
                        // Row creation AND user-message recording both happen inside
                        // spawn_session so `session_is_new=true` on a brand-new session
                        // and `session:start` fires. They also ensure the event_fired
                        // rows sort BEFORE the user-message row in the timeline.
                        let store_session_id: Option<String> = if let Some(ref sid) =
                            session_id_hint
                        {
                            Some(sid.clone())
                        } else if let Some(ref cs) = session_store {
                            let agent_uuid = if let Some(ref aid) = agent_id_direct {
                                Some(aid.clone())
                            } else {
                                match agent_registry.resolve_by_hint(&agent_hint).await {
                                    Ok(Some(agent)) => Some(agent.id),
                                    _ => None,
                                }
                            };
                            if let Some(ref uuid) = agent_uuid {
                                // Widen the lookup past the first row — sub-agents accumulate
                                // `task` sessions from quest runs, and latching onto one of
                                // those landed every web chat into a quest queue that was
                                // either already running or never drained. Only reuse
                                // `interactive` sessions for web chat; otherwise mint a fresh
                                // one.
                                match cs.list_sessions(Some(uuid), 20).await {
                                    Ok(sessions) => sessions
                                        .iter()
                                        .find(|s| {
                                            s.status == "active" && s.session_type == "interactive"
                                        })
                                        .map(|s| s.id.clone())
                                        .or_else(|| Some(::uuid::Uuid::new_v4().to_string())),
                                    Err(_) => Some(::uuid::Uuid::new_v4().to_string()),
                                }
                            } else {
                                None
                            }
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

                        let build_input_content = |base: &str| {
                            let mut content = base.to_string();
                            if let Some(files) = request.get("files").and_then(|v| v.as_array())
                                && !files.is_empty()
                            {
                                content.push_str("\n\n---\n## Attached Files\n");
                                for file in files {
                                    let name = file
                                        .get("name")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("attachment");
                                    let body =
                                        file.get("content").and_then(|v| v.as_str()).unwrap_or("");
                                    content
                                        .push_str(&format!("\n### {name}\n```text\n{body}\n```\n"));
                                }
                            }
                            content
                        };

                        // All messages go through pending_messages rail — enqueue
                        // and drain via the per-session claim loop. The IPC handler
                        // subscribes to the StreamRegistry sender *before* enqueueing
                        // so no events are missed.
                        let deps = match (
                            resolved_session_id.is_empty(),
                            default_provider.as_ref().cloned(),
                            session_store.as_ref().cloned(),
                        ) {
                            (true, _, _) => Err("failed to resolve session"),
                            (_, None, _) => Err("no provider available"),
                            (_, _, None) => Err("no session store"),
                            (false, Some(p), Some(s)) => Ok((p, s)),
                        };

                        match deps {
                            Err(msg) => serde_json::json!({"ok": false, "error": msg}),
                            Ok((provider, ss)) => {
                                let sender = ipc_ctx
                                    .stream_registry
                                    .get_or_create(&resolved_session_id)
                                    .await;
                                let mut rx = sender.subscribe();

                                gateway_manager
                                    .activate_persistent(&resolved_session_id, &sender)
                                    .await;
                                gateway_manager
                                    .ensure_dispatcher(&resolved_session_id, &sender)
                                    .await;

                                let executor: Arc<dyn crate::session_queue::SessionExecutor> =
                                    Arc::new(crate::queue_executor::QueueExecutor {
                                        session_manager: session_manager.clone(),
                                        agent_registry: agent_registry.clone(),
                                        stream_registry: ipc_ctx.stream_registry.clone(),
                                        execution_registry: ipc_ctx.execution_registry.clone(),
                                        provider,
                                        activity_log: Some(ipc_ctx.activity_log.clone()),
                                        session_store: ipc_ctx.session_store.clone(),
                                        idea_store: ipc_ctx.idea_store.clone(),
                                        adaptive_retry: dispatcher.config.adaptive_retry,
                                        failure_analysis_model: dispatcher
                                            .config
                                            .failure_analysis_model
                                            .clone(),
                                        extra_tools: Vec::new(),
                                        pattern_dispatcher: ipc_ctx.pattern_dispatcher.clone(),
                                    });
                                let queued = crate::queue_executor::QueuedMessage::chat(
                                    agent_id_direct
                                        .clone()
                                        .unwrap_or_else(|| agent_hint.clone()),
                                    build_input_content(message),
                                    web_sender_id.clone(),
                                    Some("web".to_string()),
                                );
                                let payload = queued
                                    .to_payload()
                                    .expect("QueuedMessage serialization is infallible");

                                if let Err(e) = crate::session_queue::enqueue(
                                    ss,
                                    executor,
                                    &resolved_session_id,
                                    &payload,
                                )
                                .await
                                {
                                    serde_json::json!({"ok": false, "error": e.to_string()})
                                } else {
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
                                                        if let Some(ref cs) = session_store {
                                                            let meta = serde_json::json!({
                                                                "step": step,
                                                                "model": model,
                                                            });
                                                            let _ = cs
                                                                .record_event_by_session(
                                                                    &resolved_session_id,
                                                                    "step_start",
                                                                    "system",
                                                                    &format!("Step {step}"),
                                                                    Some("session"),
                                                                    Some(&meta),
                                                                )
                                                                .await;
                                                        }
                                                    }
                                                    aeqi_core::ChatStreamEvent::EventFired {
                                                        event_id,
                                                        event_name,
                                                        pattern,
                                                        idea_ids,
                                                        prepersisted,
                                                    } => {
                                                        if !*prepersisted {
                                                            if let Some(ref cs) = session_store {
                                                                let metadata = serde_json::json!({
                                                                    "event_id": event_id,
                                                                    "event_name": event_name,
                                                                    "pattern": pattern,
                                                                    "idea_ids": idea_ids,
                                                                });
                                                                let _ = cs
                                                                    .record_event_by_session(
                                                                        &resolved_session_id,
                                                                        "event_fired",
                                                                        "system",
                                                                        "",
                                                                        Some("web"),
                                                                        Some(&metadata),
                                                                    )
                                                                    .await;
                                                            }
                                                            if let Some(ref ehs) =
                                                                ipc_ctx.event_handler_store
                                                                && let Err(e) = ehs
                                                                    .record_fire(event_id, 0.0)
                                                                    .await
                                                            {
                                                                tracing::warn!(event = %event_id, error = %e, "failed to record event fire");
                                                            }
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
                                                        if let Some(ref cs) = session_store {
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
                                                                    &resolved_session_id,
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
                                                        cache_creation_input_tokens,
                                                        cache_read_input_tokens,
                                                        ..
                                                    } => {
                                                        if !step_text.is_empty() {
                                                            if let Some(ref cs) = session_store {
                                                                // (T1.11) When the provider reports
                                                                // non-zero prompt-cache token counts,
                                                                // surface them in the recorded
                                                                // message's metadata so operators
                                                                // can see the cache hit rate per
                                                                // step. Zero values omit the keys
                                                                // so historical rows stay clean.
                                                                let metadata =
                                                                    if *cache_creation_input_tokens
                                                                        > 0
                                                                        || *cache_read_input_tokens
                                                                            > 0
                                                                    {
                                                                        Some(serde_json::json!({
                                                                            "cache_creation_input_tokens": *cache_creation_input_tokens,
                                                                            "cache_read_input_tokens": *cache_read_input_tokens,
                                                                        }))
                                                                    } else {
                                                                        None
                                                                    };
                                                                let _ = cs
                                                                        .record_event_by_session_with_sender(
                                                                            &resolved_session_id,
                                                                            "message",
                                                                            "assistant",
                                                                            &step_text,
                                                                            Some("web"),
                                                                            metadata.as_ref(),
                                                                            agent_sender_id.as_deref(),
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
                                                        if !step_text.is_empty() {
                                                            if let Some(ref cs) = session_store {
                                                                let _ = cs
                                                                        .record_event_by_session_with_sender(
                                                                            &resolved_session_id,
                                                                            "message",
                                                                            "assistant",
                                                                            &step_text,
                                                                            Some("web"),
                                                                            None,
                                                                            agent_sender_id.as_deref(),
                                                                            Some("web"),
                                                                        )
                                                                        .await;
                                                            }
                                                            step_text.clear();
                                                        }
                                                        prompt_tokens = *pt;
                                                        completion_tokens = *ct;
                                                        iterations = *it;
                                                        ipc_ctx
                                                            .execution_registry
                                                            .auto_commit(&resolved_session_id, *it)
                                                            .await;
                                                        break;
                                                    }
                                                    _ => {}
                                                }
                                            }
                                            Ok(Err(
                                                tokio::sync::broadcast::error::RecvError::Lagged(n),
                                            )) => {
                                                warn!(
                                                    session_id = %resolved_session_id,
                                                    lagged = n, "stream subscriber lagged"
                                                );
                                            }
                                            Ok(Err(_)) => break,
                                            Err(_) => {
                                                full_text =
                                                    "Session response timed out".to_string();
                                                break;
                                            }
                                        }
                                    }

                                    let cost_usd = aeqi_providers::estimate_cost(
                                        &default_model,
                                        prompt_tokens,
                                        completion_tokens,
                                    );
                                    let duration_ms = request_started.elapsed().as_millis() as u64;
                                    record_assistant_complete(
                                        &session_store,
                                        Some(resolved_session_id.as_str()),
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

                                    if stream_mode {
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
                                    } else {
                                        serde_json::json!({
                                            "ok": true,
                                            "text": full_text,
                                            "chat_id": chat_id,
                                            "session_id": resolved_session_id,
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
                            }
                        }
                    }
                }

                "session_subscribe" => {
                    let session_id = request_field(&request, "session_id").unwrap_or("");
                    crate::ipc::session_stream::handle_subscribe(
                        &ipc_ctx.execution_registry,
                        &ipc_ctx.stream_registry,
                        session_id,
                        &mut writer,
                    )
                    .await?;
                    serde_json::Value::Null
                }

                "idea_profile" => {
                    crate::ipc::ideas::handle_idea_profile(&ctx, &request, &allowed_roots).await
                }
                "idea_graph" => {
                    crate::ipc::ideas::handle_idea_graph(&ctx, &request, &allowed_roots).await
                }
                "idea_prefix" => {
                    crate::ipc::ideas::handle_idea_prefix(&ctx, &request, &allowed_roots).await
                }
                "idea_edges" => {
                    crate::ipc::ideas::handle_idea_edges(&ctx, &request, &allowed_roots).await
                }
                "idea_references" => {
                    crate::ipc::ideas::handle_idea_references(&ctx, &request, &allowed_roots).await
                }
                "add_idea_edge" => {
                    crate::ipc::ideas::handle_add_idea_edge(&ctx, &request, &allowed_roots).await
                }
                "remove_idea_edge" => {
                    crate::ipc::ideas::handle_remove_idea_edge(&ctx, &request, &allowed_roots).await
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
                    crate::ipc::vfs::handle_vfs_list(&ctx, &request, &allowed_roots).await
                }
                "vfs_read" => {
                    crate::ipc::vfs::handle_vfs_read(&ctx, &request, &allowed_roots).await
                }
                "vfs_search" => {
                    crate::ipc::vfs::handle_vfs_search(&ctx, &request, &allowed_roots).await
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

// ── Round 6: daemon-level pattern dispatcher ─────────────────────────────
//
// Build an `EventPatternDispatcher` at daemon scope so IPC handlers can fire
// patterns (like `ideas:threshold_reached`) outside any live session. Returns
// `None` when the event store is missing — IPC callers then downgrade to a
// log-only trigger.
//
// The spawn closure mirrors `SessionManager`'s compaction spawn: a tool-less
// `aeqi_core::Agent` that runs the persona's instructions idea as its system
// prompt and returns `result.text` as a plain string. The seeded events then
// pipe that text through `ideas.store_many` for persistence.
pub fn build_daemon_pattern_dispatcher(
    event_handler_store: Option<Arc<crate::event_handler::EventHandlerStore>>,
    session_store: Option<Arc<SessionStore>>,
    idea_store: Option<Arc<dyn aeqi_core::traits::IdeaStore>>,
    agent_registry: Arc<AgentRegistry>,
    provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    default_model: String,
) -> Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>> {
    use crate::runtime_tools::{SpawnFn, SpawnRequest, build_runtime_registry_full};

    let event_store = event_handler_store?;

    // spawn_fn for the dispatcher's registry. Same shape as SessionManager's
    // compaction spawn — runs a tool-less Agent with the persona's
    // instructions idea as its system prompt and returns the final text.
    let spawn_model = default_model.clone();
    let spawn_provider = provider.clone();
    let spawn_idea_store = idea_store.clone();
    let dispatcher_spawn_fn: SpawnFn = Arc::new(move |req: SpawnRequest| {
        let model = spawn_model.clone();
        let provider_opt = spawn_provider.clone();
        let idea_store_opt = spawn_idea_store.clone();
        Box::pin(async move {
            let provider = provider_opt.ok_or_else(|| {
                anyhow::anyhow!("session.spawn (daemon-dispatcher): no provider configured")
            })?;
            let system_prompt = if let Some(ref idea_name) = req.instructions_idea {
                if let Some(ref is) = idea_store_opt
                    && let Ok(Some(idea)) = is.get_by_name(idea_name, None).await
                {
                    idea.content
                } else {
                    "You are a reflection assistant. Output a JSON array of ideas.".to_string()
                }
            } else {
                "You are a reflection assistant. Output a JSON array of ideas.".to_string()
            };
            let seed = req.seed_content.unwrap_or_default();
            let context_window = aeqi_providers::context_window_for_model(&model);
            let parent = &req.parent_session_id;
            let config = aeqi_core::AgentConfig {
                model,
                max_iterations: 10,
                name: format!("reflector:{}", &parent[..8.min(parent.len())]),
                context_window,
                ..Default::default()
            };
            let observer: Arc<dyn aeqi_core::traits::Observer> =
                Arc::new(aeqi_core::traits::LogObserver);
            let tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = Vec::new();
            let agent = aeqi_core::Agent::new(config, provider, tools, observer, system_prompt);
            let result = agent.run(&seed).await?;
            Ok(result.text)
        })
    });

    // T1.1: wire a `TagPolicyCache` so `ideas.store_many` can enforce the
    // per-tag `max_items_per_call` blast-radius cap. The IPC-level handler
    // owns its own cache (created in `spawn_ipc_listener`); both caches
    // load from the same DB on stale TTL so divergence is bounded by the
    // 60s default TTL. Sharing one cache would require lifting it onto the
    // daemon, which is a larger surface change for no behavioural win.
    let tag_policy_cache = aeqi_ideas::tag_policy::default_cache();
    let registry = build_runtime_registry_full(
        idea_store.clone(),
        session_store.clone(),
        Some(dispatcher_spawn_fn),
        // IPC-level dispatcher fires events that are never originated by a
        // specific agent's LLM loop — they come from threshold bookkeeping
        // or scheduled cron. The self-delegation gate exists to stop LLMs
        // from recursively spawning themselves; there is no LLM involved
        // here. Grant the capability so session.spawn can actually run.
        true,
        Some(tag_policy_cache),
    );

    let dispatcher = Arc::new(crate::idea_assembly::EventPatternDispatcher {
        event_store,
        registry: Arc::new(registry),
        agent_registry,
        session_store,
        idea_store,
    });
    Some(dispatcher as Arc<dyn aeqi_core::tool_registry::PatternDispatcher>)
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
