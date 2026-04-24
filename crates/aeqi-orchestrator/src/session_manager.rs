//! Session Manager — builds and spawns single-shot agent runs.
//!
//! A session is *not* an in-memory entity. It is persisted state (transcript,
//! metadata) in `SessionStore` plus, while one run is executing, a live
//! `ExecutionHandle` in `ExecutionRegistry`. This module's job is assembly:
//! given an agent hint + a user message, build the agent, wire its tools
//! and sandbox, and spawn the tokio task that runs `agent.run()` to
//! completion. The caller (the queue executor) owns the returned join
//! handle and the lifecycle of the execution entry.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use aeqi_core::AgentResult;
use aeqi_core::chat_stream::{ChatStreamEvent, ChatStreamSender};
use aeqi_core::tool_registry::{ExecutionContext, ToolRegistry};
use aeqi_core::traits::{IdeaStore, Provider};

use crate::activity::ActivityStream;
use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;
use crate::idea_assembly::ToolDispatch;
use crate::runtime_tools::{SpawnFn, SpawnRequest, build_runtime_registry_with_spawn_and_caps};
use crate::sandbox::{QuestSandbox, SandboxConfig};
use crate::scope_visibility;
use crate::session_store::SessionStore;
use crate::skill_loader::SkillLoader;

/// What kind of session to spawn.
/// Options for spawning a session. Every field is optional context —
/// spawn_session works with just agent_id + input + provider.
pub struct SpawnOptions {
    /// Existing session id to bind the running agent loop to.
    pub session_id: Option<String>,
    /// Project scope (for workdir, memory, tools).
    pub project_id: Option<String>,
    /// Parent session (for delegation chains).
    pub parent_id: Option<String>,
    /// Quest being executed (links session to quest).
    pub quest_id: Option<String>,
    /// Skills to inject into this session (name + tool filter). Multiple allowed.
    pub skills: Vec<String>,
    /// Close session automatically when agent.run() completes.
    /// Default: true. Set false for persistent/interactive sessions.
    pub auto_close: bool,
    /// Record the initial user message into the session store.
    pub record_initial_message: bool,
    /// Label for the session (shown in UI sidebar).
    pub name: Option<String>,
    /// Sender identity for the initial message (who started this session).
    pub sender_id: Option<String>,
    /// Transport that originated this session (e.g. "web", "telegram", "ipc").
    pub transport: Option<String>,
    /// Pre-existing broadcast sender to use instead of minting a fresh one.
    /// When the queue-driven executor runs a spawn, the IPC handler has
    /// already subscribed to a `StreamRegistry` sender for this session_id;
    /// passing that same sender here ensures events reach the subscriber.
    pub stream_sender: Option<ChatStreamSender>,
    /// Per-run budget ceiling in USD. When `quest_id` is set, the universal
    /// middleware chain is attached and `CostTrackingMiddleware` enforces
    /// this value. Left `None` for non-quest sessions (chat/interactive) —
    /// they don't run the middleware chain.
    pub task_budget_usd: Option<f64>,
    /// Channel-specific tools to inject into this session's tool registry.
    /// Used by channel gateway spawners to make reply/react tools available
    /// only to sessions bound to a particular channel (e.g. WhatsApp or Telegram).
    pub extra_tools: Vec<Arc<dyn aeqi_core::traits::Tool>>,
    /// The `pending_messages.id` that triggered this turn, used as the
    /// watermark for step-boundary injection. Only rows with id strictly
    /// greater than this value are eligible for mid-turn injection — the
    /// drain loop already consumed the starting row.
    ///
    /// When `None`, step-boundary injection is disabled for this session
    /// (e.g. internal / direct spawns that bypass the queue).
    pub starting_pending_id: Option<i64>,
}

impl Default for SpawnOptions {
    fn default() -> Self {
        Self {
            session_id: None,
            project_id: None,
            parent_id: None,
            quest_id: None,
            skills: Vec::new(),
            auto_close: true,
            record_initial_message: true,
            name: None,
            sender_id: None,
            transport: None,
            stream_sender: None,
            task_budget_usd: None,
            extra_tools: Vec::new(),
            starting_pending_id: None,
        }
    }
}

impl SpawnOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn interactive() -> Self {
        Self {
            auto_close: false,
            ..Default::default()
        }
    }

    pub fn with_project(mut self, id: impl Into<String>) -> Self {
        self.project_id = Some(id.into());
        self
    }

    pub fn with_parent(mut self, id: impl Into<String>) -> Self {
        self.parent_id = Some(id.into());
        self
    }

    pub fn with_quest(mut self, id: impl Into<String>) -> Self {
        self.quest_id = Some(id.into());
        self
    }

    pub fn with_skill(mut self, name: impl Into<String>) -> Self {
        self.skills.push(name.into());
        self
    }

    pub fn with_skills(mut self, names: Vec<String>) -> Self {
        self.skills.extend(names);
        self
    }

    pub fn with_name(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }

    pub fn with_session_id(mut self, id: impl Into<String>) -> Self {
        self.session_id = Some(id.into());
        self
    }

    pub fn without_initial_message_record(mut self) -> Self {
        self.record_initial_message = false;
        self
    }

    pub fn with_sender_id(mut self, id: impl Into<String>) -> Self {
        self.sender_id = Some(id.into());
        self
    }

    pub fn with_transport(mut self, transport: impl Into<String>) -> Self {
        self.transport = Some(transport.into());
        self
    }

    pub fn with_stream_sender(mut self, sender: ChatStreamSender) -> Self {
        self.stream_sender = Some(sender);
        self
    }

    pub fn with_budget(mut self, usd: f64) -> Self {
        self.task_budget_usd = Some(usd);
        self
    }

    /// Append channel-specific tools (e.g. whatsapp_reply, telegram_react) to
    /// this session's tool registry. Called by channel gateway spawners so only
    /// sessions bound to a given channel receive its messaging tools.
    pub fn with_extra_tools(mut self, tools: Vec<Arc<dyn aeqi_core::traits::Tool>>) -> Self {
        self.extra_tools.extend(tools);
        self
    }

    /// Set the starting watermark for step-boundary injection. Pass the
    /// `pending_messages.id` of the claim that triggered this turn so the
    /// agent loop only injects rows that arrived AFTER this turn started.
    pub fn with_starting_pending_id(mut self, id: i64) -> Self {
        self.starting_pending_id = Some(id);
        self
    }

    fn session_type_str(&self) -> &str {
        if self.parent_id.is_some() {
            "delegation"
        } else if self.quest_id.is_some() {
            "task"
        } else if !self.auto_close {
            "interactive"
        } else {
            "async"
        }
    }
}

/// Returned from `spawn_session` — the caller owns the execution lifecycle
/// and tears down the sandbox after the join handle resolves.
pub struct SpawnedSession {
    pub session_id: String,
    pub agent_id: String,
    pub agent_name: String,
    pub correlation_id: String,
    pub stream_sender: ChatStreamSender,
    pub cancel_token: Arc<std::sync::atomic::AtomicBool>,
    pub sandbox: Option<Arc<QuestSandbox>>,
    /// The agent task's join handle. Caller must `.await` it.
    pub join_handle: tokio::task::JoinHandle<anyhow::Result<AgentResult>>,
    /// Events that fired during session creation itself (e.g. session:start
    /// ideas being injected). The broadcast channel has no subscribers at
    /// the moment these fire, so the caller must forward them to its wire
    /// after it subscribes. The same events are also persisted to the DB.
    pub initial_events: Vec<ChatStreamEvent>,
}

/// Builds agents and launches single-shot runs. Stateless w.r.t. sessions —
/// lifecycle state lives in `SessionStore` (durable) and `ExecutionRegistry`
/// (transient, held by the caller during the run).
pub struct SessionManager {
    /// Per-session execution lock. spawn_session acquires the entry for
    /// its session_id, guaranteeing at most one agent run per session at
    /// any time. This is a belt-and-suspenders guard alongside the
    /// DB-backed `pending_messages` claim lease — both enforce per-session
    /// FIFO, but the lock also protects direct `spawn_session` callers
    /// that bypass the queue (tests, internal utilities).
    execution_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    // Dependencies for spawn_session (injected via configure()).
    agent_registry: Option<Arc<AgentRegistry>>,
    session_store: Option<Arc<SessionStore>>,
    default_model: String,
    activity_stream: Option<Arc<ActivityStream>>,
    activity_log: Option<Arc<ActivityLog>>,
    idea_store: Option<Arc<dyn IdeaStore>>,
    default_project: String,
    /// Sandbox configuration. When set, sessions are sandboxed in git worktrees.
    sandbox_config: Option<SandboxConfig>,
    /// Unified prompt file loader.
    skill_loader: Option<Arc<SkillLoader>>,
    /// Event handler store for event-driven idea assembly.
    event_store: Option<Arc<EventHandlerStore>>,
    /// Data directory for graph DB fallback.
    data_dir: Option<PathBuf>,
    /// Default provider for ephemeral sessions (compactor, continuation).
    /// Set via `set_default_provider`. Used by `spawn_ephemeral_session`.
    default_provider: Option<Arc<dyn Provider>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            execution_locks: Mutex::new(HashMap::new()),
            agent_registry: None,
            session_store: None,
            default_model: String::new(),
            activity_stream: None,
            activity_log: None,
            idea_store: None,
            default_project: String::new(),
            sandbox_config: None,
            skill_loader: None,
            event_store: None,
            data_dir: None,
            default_provider: None,
        }
    }

    /// Acquire (or create) the per-session execution lock handle. Callers
    /// must `.lock().await` on the returned Arc to actually serialize; the
    /// handle is released when the guard is dropped.
    async fn execution_lock_handle(&self, session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.execution_locks.lock().await;
        locks
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    /// Inject dependencies that aren't available at construction time.
    #[allow(clippy::too_many_arguments)]
    pub fn configure(
        &mut self,
        agent_registry: Arc<AgentRegistry>,
        session_store: Arc<SessionStore>,
        default_model: String,
        activity_stream: Option<Arc<ActivityStream>>,
        activity_log: Arc<ActivityLog>,
        idea_store: Option<Arc<dyn IdeaStore>>,
        default_project: String,
    ) {
        self.agent_registry = Some(agent_registry);
        self.session_store = Some(session_store);
        self.default_model = default_model;
        self.activity_stream = activity_stream;
        self.activity_log = Some(activity_log);
        self.idea_store = idea_store;
        self.default_project = default_project;
    }

    /// Enable session sandboxing. When set, each session gets a git worktree
    /// and shell commands run inside bubblewrap.
    pub fn set_sandbox_config(&mut self, config: SandboxConfig) {
        self.sandbox_config = Some(config);
    }

    /// Set the unified prompt loader.
    pub fn set_skill_loader(&mut self, loader: Arc<SkillLoader>) {
        self.skill_loader = Some(loader);
    }

    /// Set the event handler store for event-driven idea assembly.
    pub fn set_event_store(&mut self, store: Arc<EventHandlerStore>) {
        self.event_store = Some(store);
    }

    /// Set the data directory for graph DB fallback.
    pub fn set_data_dir(&mut self, dir: PathBuf) {
        self.data_dir = Some(dir);
    }

    /// Set the default LLM provider. Used by `spawn_ephemeral_session` and
    /// the `session.spawn` SpawnFn closure to run compactor / continuation
    /// sessions without requiring the caller to pass a provider each time.
    pub fn set_default_provider(&mut self, provider: Arc<dyn Provider>) {
        self.default_provider = Some(provider);
    }

    /// Run a one-shot lightweight session: no worktree, no sandbox, no event
    /// replay. The agent gets `system_prompt` as its system message and
    /// `seed_content` as the user input. Returns the final LLM response text.
    ///
    /// Used by `session.spawn` compactor kind. Also usable for any context
    /// where a fire-and-forget single-call delegation is needed.
    pub async fn spawn_ephemeral_session(
        &self,
        system_prompt: String,
        seed_content: String,
        parent_session_id: String,
    ) -> anyhow::Result<String> {
        let provider = self
            .default_provider
            .clone()
            .ok_or_else(|| anyhow::anyhow!("spawn_ephemeral_session: no default provider set"))?;

        let model = self.default_model.clone();
        let context_window = aeqi_providers::context_window_for_model(&model);

        let config = aeqi_core::AgentConfig {
            model,
            max_iterations: 10,
            name: format!(
                "ephemeral:{}",
                &parent_session_id[..8.min(parent_session_id.len())]
            ),
            context_window,
            ..Default::default()
        };

        let observer: Arc<dyn aeqi_core::traits::Observer> =
            Arc::new(aeqi_core::traits::LogObserver);

        // Minimal tool set — ephemeral sessions get no shell or file tools.
        let tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = Vec::new();

        let agent = aeqi_core::Agent::new(config, provider, tools, observer, system_prompt);

        let result = agent.run(&seed_content).await?;
        Ok(result.text)
    }

    /// Spawn a new agent session — the universal executor.
    ///
    /// Resolves agent, builds identity + tools, creates DB session, spawns
    /// the agent loop as a background task, and registers the running session.
    pub async fn spawn_session(
        &self,
        agent_id_or_hint: &str,
        input: &str,
        provider: Arc<dyn Provider>,
        opts: SpawnOptions,
    ) -> anyhow::Result<SpawnedSession> {
        let _project_id = opts.project_id.as_deref();
        let agent_registry = self
            .agent_registry
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("session manager not configured (no agent_registry)"))?;
        let activity_log = self
            .activity_log
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("session manager not configured (no activity_log)"))?;

        // 1. Resolve agent from agent_registry by UUID (or by name via resolve_by_hint).
        let agent_opt = if uuid::Uuid::parse_str(agent_id_or_hint).is_ok() {
            agent_registry.get(agent_id_or_hint).await.ok().flatten()
        } else {
            agent_registry
                .resolve_by_hint(agent_id_or_hint)
                .await
                .ok()
                .flatten()
        };

        let (agent_name, agent_uuid) = match agent_opt {
            Some(ref agent) => (agent.name.clone(), Some(agent.id.clone())),
            None => (agent_id_or_hint.to_string(), None),
        };
        // Resolve self-delegation capability from the agent record.
        // Agents without a DB record (e.g. bare-CLI runs) default to false.
        let agent_can_self_delegate = agent_opt
            .as_ref()
            .map(|a| a.can_self_delegate)
            .unwrap_or(false);

        // Pre-generate the session_id so it can be:
        //   (a) used as the key for the per-session execution lock
        //   (b) set in AgentConfig before the DB session row is created
        //       (the compaction pipeline dispatches on the real session_id).
        // When `opts.session_id` is Some, we reuse it; otherwise mint a fresh UUID.
        let pregenerated_session_id = opts
            .session_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        // Acquire the per-session execution lock before doing any state-dependent
        // work (history load, agent construction, run). Two rapid-fire spawn_session
        // calls for the same session_id now serialize here — the second waits until
        // the first's agent.run() has completed and the guard has been dropped.
        // The guard is moved into the tokio::spawn task that runs the agent so it
        // lives for the full execution, not just spawn_session's sync prefix.
        let exec_lock = self.execution_lock_handle(&pregenerated_session_id).await;
        let exec_guard = exec_lock.lock_owned().await;

        // Resolve ancestor IDs for hierarchical memory search.
        let ancestor_ids: Vec<String> = if let Some(ref id) = agent_uuid {
            agent_registry
                .get_ancestor_ids(id)
                .await
                .unwrap_or_else(|_| vec![id.clone()])
        } else {
            Vec::new()
        };

        // 2. Assemble context from ancestor chain.
        //    Event-driven: events define which ideas activate at session start.
        let event_store = self
            .event_store
            .clone()
            .unwrap_or_else(|| Arc::new(EventHandlerStore::new(agent_registry.db())));
        let mut execution_context: String = String::new();
        let mut system_prompt = if let Some(ref id) = agent_uuid {
            // Build a runtime tool registry so event tool_calls can execute.
            // The session_id is not yet known at this point (created in step 9),
            // so we use a temporary placeholder; tools that need session_id
            // (e.g. transcript.inject) must be called after session creation.
            let session_store_for_reg = self.session_store.clone();

            // Build a SpawnFn closure that captures the minimal state needed to
            // run an ephemeral session. We capture cloned fields directly to
            // avoid needing Arc<Self> at this call site.
            let eph_model = self.default_model.clone();
            let eph_provider = self.default_provider.clone();
            let eph_idea_store = self.idea_store.clone();

            let spawn_fn: SpawnFn = Arc::new(move |req: SpawnRequest| {
                let model = eph_model.clone();
                let provider_opt = eph_provider.clone();
                let idea_store_opt = eph_idea_store.clone();
                Box::pin(async move {
                    let provider = provider_opt.ok_or_else(|| {
                        anyhow::anyhow!("session.spawn: no default provider configured")
                    })?;

                    let system_prompt = if let Some(ref idea_name) = req.instructions_idea {
                        // Try to load the instructions idea from the idea store.
                        if let Some(ref is) = idea_store_opt
                            && let Ok(Some(idea)) = is.get_by_name(idea_name, None).await
                        {
                            idea.content
                        } else {
                            format!(
                                "You are an AEQI agent running as a {kind} session.",
                                kind = req.kind
                            )
                        }
                    } else {
                        format!(
                            "You are an AEQI agent running as a {kind} session.",
                            kind = req.kind
                        )
                    };

                    let seed = req.seed_content.unwrap_or_default();
                    let context_window = aeqi_providers::context_window_for_model(&model);
                    let config = aeqi_core::AgentConfig {
                        model,
                        max_iterations: 10,
                        name: format!(
                            "ephemeral:{}",
                            &req.parent_session_id[..8.min(req.parent_session_id.len())]
                        ),
                        context_window,
                        ..Default::default()
                    };
                    let observer: Arc<dyn aeqi_core::traits::Observer> =
                        Arc::new(aeqi_core::traits::LogObserver);
                    let tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = Vec::new();
                    let agent =
                        aeqi_core::Agent::new(config, provider, tools, observer, system_prompt);
                    let result = agent.run(&seed).await?;
                    Ok(result.text)
                })
            });
            let runtime_reg: ToolRegistry = build_runtime_registry_with_spawn_and_caps(
                self.idea_store.clone(),
                session_store_for_reg,
                Some(spawn_fn),
                agent_can_self_delegate,
            );
            let exec_ctx = ExecutionContext {
                session_id: String::new(), // filled in after DB create
                agent_id: id.clone(),
                ..Default::default()
            };
            let dispatch = ToolDispatch {
                registry: &runtime_reg,
                ctx: &exec_ctx,
                session_store: None,
            };
            let assembled = crate::idea_assembly::assemble_ideas(
                agent_registry,
                self.idea_store.as_ref(),
                &event_store,
                id,
                &[],
                Some(&dispatch),
            )
            .await;
            // `record_fire` / `event_fired` row writes are owned by the
            // lifecycle-event pre-persist block below (for session:start and
            // session:execution_start) and by the daemon WS handler (for
            // in-run events like session:step_start). Firing again here would
            // double-count fire_count and total_cost_usd.
            let _ = &assembled.fired_event_ids;

            // Per-turn refresh context from `session:execution_start` events.
            // Assembled here (reusing the same registry + dispatch) and stored
            // in the outer `execution_context` binding so the agent can inject
            // it as a system message after the user prompt on every LLM
            // request within this spawn. Ephemeral: rebuilt each spawn.
            let exec_assembled = crate::idea_assembly::assemble_execution_context(
                agent_registry,
                self.idea_store.as_ref(),
                &event_store,
                id,
                Some(&dispatch),
            )
            .await;
            let _ = &exec_assembled.fired_event_ids;
            execution_context = exec_assembled.system;

            // Safety net: if assembly returned empty, use a sensible default.
            if assembled.system.trim().is_empty() {
                "You are a helpful AI agent.".to_string()
            } else {
                assembled.system
            }
        } else {
            "You are a helpful AI agent.".to_string()
        };

        // 3. Resolve workdir — use agent registry or fall back to cwd.
        let workdir = {
            if let Some(ref id) = agent_uuid {
                if let Ok(Some(wd)) = agent_registry.resolve_workdir(id).await {
                    PathBuf::from(wd)
                } else {
                    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/tmp"))
                }
            } else {
                std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/tmp"))
            }
        };

        // 3.5. Create or reuse quest sandbox (git worktree).
        //
        // If executing a quest that already has a worktree, reattach to it.
        // Otherwise create a new worktree. The quest owns the worktree —
        // it persists across session retries until the quest completes.
        // Interactive sessions (no quest) get ephemeral worktrees.
        let sandbox: Option<Arc<QuestSandbox>> = if let Some(ref sandbox_cfg) = self.sandbox_config
        {
            // Determine sandbox identity: quest_id if available, otherwise ephemeral UUID.
            let sandbox_id = opts
                .quest_id
                .clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

            // Check if quest already has a worktree we can reuse.
            let existing_worktree = if let Some(ref qid) = opts.quest_id {
                agent_registry
                    .get_task(qid)
                    .await
                    .ok()
                    .flatten()
                    .and_then(|q| q.worktree_path.clone())
                    .map(PathBuf::from)
                    .filter(|p| p.exists())
            } else {
                None
            };

            let sb_result = if let Some(existing_path) = existing_worktree {
                QuestSandbox::open_existing(
                    &sandbox_id,
                    existing_path,
                    sandbox_cfg.repo_root.clone(),
                    sandbox_cfg.enable_bwrap,
                )
            } else {
                // For child quests, fork from parent quest's branch instead of HEAD.
                let mut cfg = sandbox_cfg.clone();
                if let Some(ref qid) = opts.quest_id {
                    let quest_id = aeqi_quests::QuestId(qid.clone());
                    if let Some(parent_id) = quest_id.parent()
                        && let Ok(Some(parent_quest)) = agent_registry.get_task(&parent_id.0).await
                        && let Some(ref parent_branch) = parent_quest.worktree_branch
                    {
                        cfg.base_ref = parent_branch.clone();
                        tracing::info!(
                            quest = %qid, parent = %parent_id.0,
                            base = %parent_branch, "forking from parent quest branch"
                        );
                    }
                }
                QuestSandbox::create(&sandbox_id, &cfg).await
            };

            match sb_result {
                Ok(sb) => {
                    // Save worktree path back to quest if this is a new worktree.
                    if let Some(ref qid) = opts.quest_id {
                        let wt_path = sb.worktree_path.to_string_lossy().to_string();
                        let branch = sb.branch_name.clone();
                        let _ = agent_registry
                            .update_task(qid, |q| {
                                if q.worktree_path.is_none() {
                                    q.worktree_path = Some(wt_path);
                                    q.worktree_branch = Some(branch);
                                }
                            })
                            .await;
                    }
                    Some(Arc::new(sb))
                }
                Err(e) => {
                    warn!(error = %e, "failed to create quest sandbox — falling back to unsandboxed");
                    None
                }
            }
        } else {
            None
        };

        // Effective workdir: worktree path if sandboxed, otherwise the resolved workdir.
        let effective_workdir = sandbox
            .as_ref()
            .map(|s| s.worktree_path.clone())
            .unwrap_or_else(|| workdir.clone());

        // 4. Create or reuse chat stream sender so file tools can emit FileChanged
        // events. When the caller pre-supplies one (queue-driven executor path,
        // where the IPC handler has already subscribed to a `StreamRegistry`
        // sender), use it so events reach the subscriber. Otherwise mint a fresh
        // one and rely on the caller to subscribe via `SpawnedSession`.
        let stream_sender = if let Some(s) = opts.stream_sender.clone() {
            s
        } else {
            let (s, _initial_rx) = ChatStreamSender::new(256);
            s
        };

        // 4. Build tools.
        let mut tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = Vec::new();

        // Shell: sandboxed or unsandboxed.
        if let Some(ref sb) = sandbox {
            tools.push(Arc::new(crate::tools::SandboxedShellTool::new(sb.clone())));
        } else {
            tools.push(Arc::new(aeqi_tools::ShellTool::new(
                effective_workdir.clone(),
            )));
        }

        // File tools: scoped to effective_workdir (worktree in sandbox mode).
        tools.push(Arc::new(aeqi_tools::FileReadTool::new(
            effective_workdir.clone(),
        )));
        tools.push(Arc::new(
            aeqi_tools::FileWriteTool::new(effective_workdir.clone())
                .with_chat_stream(stream_sender.clone()),
        ));
        tools.push(Arc::new(
            aeqi_tools::FileEditTool::new(effective_workdir.clone())
                .with_chat_stream(stream_sender.clone()),
        ));
        tools.push(Arc::new(aeqi_tools::GrepTool::new(
            effective_workdir.clone(),
        )));
        tools.push(Arc::new(aeqi_tools::GlobTool::new(
            effective_workdir.clone(),
        )));

        // Network tools now provided by the consolidated WebTool
        // via build_orchestration_tools().

        // 5. Resolve idea store — single shared backend.
        let idea_store_for_agent: Option<Arc<dyn IdeaStore>> = self.idea_store.clone();

        // Resolve graph DB path.
        // Prefer data_dir/codegraph/{project}.db when a project is set,
        // fall back to data_dir/codegraph/code.db, then $HOME/.aeqi/codegraph/.
        let graph_db_path = {
            let base_dir = self
                .data_dir
                .clone()
                .or_else(|| {
                    std::env::var("HOME")
                        .ok()
                        .map(|h| PathBuf::from(h).join(".aeqi"))
                })
                .unwrap_or_else(|| PathBuf::from("/tmp"));
            let graph_dir = base_dir.join("codegraph");
            let _ = std::fs::create_dir_all(&graph_dir);
            let path = if self.default_project.is_empty() {
                graph_dir.join("code.db")
            } else {
                graph_dir.join(format!("{}.db", self.default_project))
            };
            Some(path)
        };

        // Determine session_id placeholder for delegate tool wiring (filled in after DB create).
        let is_interactive = !opts.auto_close;

        // Build orchestration tools (agents, quests, events, code, ideas)
        if let Some(agent_id) = agent_uuid.clone() {
            let orch_tools = crate::tools::build_orchestration_tools(
                agent_id,
                activity_log.clone(),
                None,
                idea_store_for_agent.clone(),
                graph_db_path,
                self.session_store.clone(),
                agent_registry.clone(),
            );
            tools.extend(orch_tools);
        } else {
            warn!(agent = %agent_name, "skipping orchestration tools: unresolved agent id");
        }

        // Filter tools based on agent's tool_deny list.
        if let Some(ref agent) = agent_opt
            && !agent.tool_deny.is_empty()
        {
            tools.retain(|t| !agent.tool_deny.contains(&t.spec().name));
        }

        // Inject caller-supplied channel-specific tools (e.g. whatsapp_reply,
        // telegram_react). These are appended after the deny-list filter so
        // they are subject to tool_deny like any other tool.
        for t in opts.extra_tools.iter() {
            if agent_opt
                .as_ref()
                .map(|a| a.tool_deny.contains(&t.spec().name))
                .unwrap_or(false)
            {
                continue;
            }
            tools.push(t.clone());
        }

        // 5b. Discover all available prompts via unified SkillLoader.
        let all_prompts: Arc<Vec<aeqi_tools::Prompt>> = if let Some(ref loader) = self.skill_loader
        {
            loader.all().await
        } else {
            // No skill_loader configured — return empty. No ad-hoc disk scanning.
            Arc::new(Vec::new())
        };

        // 5c. Apply session prompts — resolve from DB first, disk fallback.
        let mut session_prompt_parts: Vec<String> = Vec::new();
        let mut step_idea_specs: Vec<aeqi_core::StepIdeaSpec> = Vec::new();

        for prompt_name in &opts.skills {
            // Disk fallback (for prompts not yet imported).
            if let Some(p) = all_prompts.iter().find(|s| s.name == *prompt_name) {
                session_prompt_parts.push(p.system_prompt(""));
                tools.retain(|t| p.is_tool_allowed(t.name()));
                if let Some(ref path) = p.source_path {
                    let snapshotted = if p.allow_shell {
                        aeqi_core::frontmatter::expand_shell_commands(&p.body)
                    } else {
                        p.body.clone()
                    };
                    step_idea_specs.push(aeqi_core::StepIdeaSpec {
                        path: path.clone(),
                        allow_shell: p.allow_shell,
                        name: p.name.clone(),
                        content: Some(snapshotted),
                    });
                }
                debug!(prompt = %prompt_name, source = "disk", "session prompt applied (fallback)");
            } else {
                warn!(prompt = %prompt_name, "session prompt not found — skipping");
            }
        }

        if !session_prompt_parts.is_empty() {
            let prompt_context = session_prompt_parts.join("\n\n---\n\n");
            system_prompt = format!("{system_prompt}\n\n---\n\n{prompt_context}");
        }

        // 6. Build AgentConfig.
        let model = self.default_model.clone();
        let context_window = aeqi_providers::context_window_for_model(&model);
        let max_iterations = if is_interactive { 200 } else { 50 };

        // Load the compaction prompt template from the seeded global idea
        // `session:compact-prompt`. Falls back to `DEFAULT_COMPACT_PROMPT`
        // inside the agent when the lookup returns `None` (e.g. idea_store
        // unavailable, or the seed hasn't run yet on a freshly wiped DB).
        let compact_prompt_template = if let Some(is) = &self.idea_store {
            is.get_by_name("session:compact-prompt", None)
                .await
                .ok()
                .flatten()
                .map(|i| i.content)
        } else {
            None
        };

        let agent_config = aeqi_core::AgentConfig {
            model,
            max_iterations,
            name: agent_name.clone(),
            context_window,
            agent_id: agent_uuid.clone(),
            ancestor_ids: ancestor_ids.clone(),
            compact_prompt_template,
            session_id: pregenerated_session_id.clone(),
            can_self_delegate: agent_can_self_delegate,
            ..Default::default()
        };

        // 7. Create Agent with ChatStreamSender, attach memory.
        //
        // Quest-backed sessions get the universal middleware chain wrapped
        // around `LogObserver`; chat/interactive sessions run a bare
        // `LogObserver`. Wiring here (rather than inside AgentWorker) is the
        // Phase 2 unification point — once QuestEnqueuer lands in Phase 3,
        // every quest run flows through here and the scheduler's parallel
        // middleware attachment goes away.
        let base_observer: Arc<dyn aeqi_core::traits::Observer> =
            Arc::new(aeqi_core::traits::LogObserver);
        let observer: Arc<dyn aeqi_core::traits::Observer> = if opts.quest_id.is_some() {
            let budget = opts.task_budget_usd.unwrap_or(5.0);
            let chain = crate::middleware::build_universal_chain(
                budget,
                self.idea_store.as_ref(),
                agent_uuid.as_deref(),
            )
            .await;
            let mut worker_ctx = crate::middleware::WorkerContext::new(
                opts.quest_id.clone().unwrap_or_default(),
                input.chars().take(500).collect::<String>(),
                &agent_name,
                &self.default_project,
            );
            // Signal to ContextCompressionMiddleware that the agent loop
            // handles compaction directly — middleware defers.
            worker_ctx.agent_compaction_active = true;
            worker_ctx.model = self.default_model.clone();
            worker_ctx.session_id = pregenerated_session_id.clone();
            worker_ctx.registry = Some(Arc::new(crate::runtime_tools::build_runtime_registry(
                self.idea_store.clone(),
                self.session_store.clone(),
            )));
            Arc::new(crate::middleware::MiddlewareObserver::new(
                Arc::new(chain),
                worker_ctx,
                base_observer,
            ))
        } else {
            base_observer
        };

        // Load session:step_start ideas as step context (injected every LLM call).
        //
        // `record_fire` is NOT called here — step_start events fire per LLM
        // step, not once per session. The Agent emits `EventFired` at each
        // `StepStart`, and the daemon stream reader records the fire when
        // the pill flows through. That keeps the fire count truthful.
        let mut step_event_metas: Vec<aeqi_core::StepEventMeta> = Vec::new();
        if let Some(idea_store) = &self.idea_store {
            let viewer_id = agent_uuid.as_deref().unwrap_or("");
            let (step_clause, step_params) =
                scope_visibility::visibility_sql_clause(agent_registry, viewer_id)
                    .await
                    .unwrap_or_else(|_| (String::new(), Vec::new()));
            let step_events = if step_clause.is_empty() {
                Vec::new()
            } else {
                event_store
                    .get_events_for_pattern_visible(
                        &step_clause,
                        &step_params,
                        "session:step_start",
                    )
                    .await
            };
            let mut step_idea_ids: Vec<String> = Vec::new();
            for ev in &step_events {
                step_idea_ids.extend(ev.idea_ids.iter().filter(|id| !id.is_empty()).cloned());
            }
            if !step_idea_ids.is_empty()
                && let Ok(ideas) = idea_store.get_by_ids(&step_idea_ids).await
            {
                for idea in &ideas {
                    step_idea_specs.push(aeqi_core::StepIdeaSpec {
                        path: std::path::PathBuf::from(&idea.name),
                        allow_shell: false,
                        name: idea.name.clone(),
                        content: Some(idea.content.clone()),
                    });
                }
            }
            for ev in &step_events {
                if ev.idea_ids.iter().any(|id| !id.is_empty()) {
                    step_event_metas.push(aeqi_core::StepEventMeta {
                        event_id: ev.id.clone(),
                        event_name: ev.name.clone(),
                        pattern: ev.pattern.clone(),
                        idea_ids: ev.idea_ids.clone(),
                    });
                }
            }
        }

        let mut agent =
            aeqi_core::Agent::new(agent_config, provider, tools, observer, system_prompt)
                .with_chat_stream(stream_sender.clone())
                .with_step_ideas(step_idea_specs)
                .with_step_events(step_event_metas)
                .with_execution_context(execution_context);

        if let Some(ref mem) = idea_store_for_agent {
            agent = agent.with_idea_store(mem.clone());
        }

        // Wire step-boundary injection when the session was started from the
        // pending_messages queue. The claim id from the drain loop is the
        // watermark: only rows with id > watermark are eligible for injection.
        if let (Some(ss), Some(pending_id)) = (&self.session_store, opts.starting_pending_id) {
            let src: std::sync::Arc<dyn aeqi_core::PendingMessageSource> = ss.clone();
            agent = agent.with_pending_source(src, Some(pending_id));
        }

        // Wire EventPatternDispatcher so the compaction pipeline can delegate
        // via the `context:budget:exceeded` event. Requires both event_store
        // and a provider so session.spawn (used by the compaction event) can run.
        if let Some(ref ehs) = self.event_store {
            // Build a spawn_fn for the dispatcher's registry — same closure as
            // the one used during session assembly, capturing the provider and
            // idea_store.
            let eph_model_d = self.default_model.clone();
            let eph_provider_d = self.default_provider.clone();
            let eph_idea_store_d = self.idea_store.clone();
            let dispatcher_spawn_fn: SpawnFn = Arc::new(move |req: SpawnRequest| {
                let model = eph_model_d.clone();
                let provider_opt = eph_provider_d.clone();
                let idea_store_opt = eph_idea_store_d.clone();
                Box::pin(async move {
                    let provider = provider_opt.ok_or_else(|| {
                        anyhow::anyhow!("session.spawn (compaction): no provider configured")
                    })?;
                    let system_prompt = if let Some(ref idea_name) = req.instructions_idea {
                        if let Some(ref is) = idea_store_opt
                            && let Ok(Some(idea)) = is.get_by_name(idea_name, None).await
                        {
                            idea.content
                        } else {
                            "You are a context compaction assistant. Summarize the provided transcript.".to_string()
                        }
                    } else {
                        "You are a context compaction assistant. Summarize the provided transcript."
                            .to_string()
                    };
                    let seed = req.seed_content.unwrap_or_default();
                    let context_window = aeqi_providers::context_window_for_model(&model);
                    let config = aeqi_core::AgentConfig {
                        model,
                        max_iterations: 10,
                        name: format!(
                            "compactor:{}",
                            &req.parent_session_id[..8.min(req.parent_session_id.len())]
                        ),
                        context_window,
                        ..Default::default()
                    };
                    let observer: Arc<dyn aeqi_core::traits::Observer> =
                        Arc::new(aeqi_core::traits::LogObserver);
                    let tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = Vec::new();
                    let agent =
                        aeqi_core::Agent::new(config, provider, tools, observer, system_prompt);
                    let result = agent.run(&seed).await?;
                    Ok(result.text)
                })
            });
            let runtime_reg_for_dispatcher = build_runtime_registry_with_spawn_and_caps(
                self.idea_store.clone(),
                self.session_store.clone(),
                Some(dispatcher_spawn_fn),
                agent_can_self_delegate,
            );
            let dispatcher = std::sync::Arc::new(crate::idea_assembly::EventPatternDispatcher {
                event_store: ehs.clone(),
                registry: std::sync::Arc::new(runtime_reg_for_dispatcher),
                agent_registry: agent_registry.clone(),
                session_store: self.session_store.clone(),
            });
            agent = agent.with_pattern_dispatcher(dispatcher);
        }

        let mut agent = agent;

        // 7.5. Load forked session history if the session already has messages.
        let mut session_resumed = false;
        if let Some(ref sid) = opts.session_id
            && let Some(ref ss) = self.session_store
            && let Ok(timeline) = ss.timeline_by_session(sid, 500).await
        {
            let mut history = Vec::new();
            for event in &timeline {
                let role = match event.role.as_str() {
                    "user" | "User" => aeqi_core::Role::User,
                    "assistant" => aeqi_core::Role::Assistant,
                    _ => continue,
                };
                if event.event_type != "message" || event.content.trim().is_empty() {
                    continue;
                }
                history.push(aeqi_core::Message {
                    role,
                    content: aeqi_core::MessageContent::text(&event.content),
                });
            }
            if !history.is_empty() {
                tracing::info!(session_id = %sid, messages = history.len(), "loading forked session history");
                stream_sender.send(aeqi_core::ChatStreamEvent::Status {
                    message: format!(
                        "session fork: loaded {} prior messages from session {sid}",
                        history.len()
                    ),
                });
                agent = agent.with_history(history);
                session_resumed = true;
            }
        }

        // 8. Single-shot only: sessions are persisted state, never kept alive.
        // Each user message spawns a run-to-completion execution via the
        // per-session queue; no perpetual input channel.
        let cancel_token = agent.cancel_token();

        // 9. Create session in DB.
        let parent_id = opts.parent_id.as_deref();
        let quest_id = opts.quest_id.as_deref();
        let session_type_str = opts.session_type_str();

        // Use the pre-generated session_id (set in AgentConfig at step 6 so the
        // compaction pipeline can refer to the correct session). For pre-assigned
        // session_ids (from channel_sessions), ensure the DB row exists.
        //
        // `is_first_execution` tracks whether this is the first spawn on this
        // session — used to gate `session:start` (once-per-session system-prompt
        // equivalent). Row existence alone is not enough: a session can be
        // pre-created by a separate `create_session` IPC call before any
        // execution runs, so we also check for prior `event_fired` rows.
        let mut is_first_execution = false;
        let session_id = {
            let sid = pregenerated_session_id.clone();
            if let Some(ref ss) = self.session_store {
                let aid = agent_uuid.as_deref().unwrap_or("");
                let session_name = opts.name.as_deref().unwrap_or(&agent_name);
                if ss.get_session(&sid).await.ok().flatten().is_none() {
                    is_first_execution = true;
                    let _ = ss
                        .create_session_with_id(
                            &sid,
                            aid,
                            session_type_str,
                            session_name,
                            parent_id,
                            quest_id,
                        )
                        .await;
                } else {
                    is_first_execution = !ss.has_prior_execution(&sid).await;
                }
            }
            sid
        };
        let _ = session_resumed; // informational; gating uses is_first_execution

        // 9.5. Fire lifecycle events for this spawn and pre-persist their
        // `event_fired` rows BEFORE the user-message row so the UI timeline
        // renders them in semantic order:
        //
        //   session:start (once per session) →
        //   session:execution_start (every spawn) →
        //   user message →
        //   session:step_start (per LLM iteration, emitted by agent.run,
        //   rendered below the step divider in the UI)
        //
        // We persist here (rather than letting the daemon observe EventFired
        // and persist in its WS handler) for two reasons:
        //   1. The event_fired row must sort BEFORE the user-message row by
        //      `session_messages.id` — the timeline orders by id ASC.
        //   2. The broadcast channel may have no subscribers yet, so a
        //      non-persisted wire emission would be lost.
        //
        // Each emitted ChatStreamEvent carries `prepersisted: true` so the
        // daemon's wire-observer skips its own row-write and record_fire
        // calls, avoiding double persistence and double fire-count.
        //
        // `session:step_start` is NOT batched — the Agent emits EventFired
        // per StepEventMeta at its true firing point inside the run loop.
        // Helper: pre-persist `event_fired` rows for a given pattern and
        // build EventFired stream events. Returns the list of stream events
        // so the caller can flush them to subscribers in the desired order.
        //
        // Visibility clause is precomputed for the session's agent so parent-scoped
        // events (e.g. scope=children set by a parent) fire correctly for this agent.
        let (fire_clause, fire_params) = if let Some(aid) = agent_uuid.as_deref() {
            scope_visibility::visibility_sql_clause(agent_registry, aid)
                .await
                .unwrap_or_else(|_| (String::new(), Vec::new()))
        } else {
            (String::new(), Vec::new())
        };
        let fire_pattern = async |pattern: &str,
                                  _aid: &str,
                                  seen: &mut std::collections::HashSet<String>|
               -> Vec<ChatStreamEvent> {
            let events = if fire_clause.is_empty() {
                Vec::new()
            } else {
                event_store
                    .get_events_for_pattern_visible(&fire_clause, &fire_params, pattern)
                    .await
            };
            let mut out: Vec<ChatStreamEvent> = Vec::new();
            for event in events {
                if !seen.insert(event.id.clone()) {
                    continue;
                }
                if let Some(ref ss) = self.session_store {
                    let metadata = serde_json::json!({
                        "event_id": event.id,
                        "event_name": event.name,
                        "pattern": event.pattern,
                        "idea_ids": event.idea_ids,
                        "scope": event.scope.as_str(),
                    });
                    let _ = ss
                        .record_event_by_session(
                            &session_id,
                            "event_fired",
                            "system",
                            "",
                            Some("web"),
                            Some(&metadata),
                        )
                        .await;
                }
                if let Err(e) = event_store.record_fire(&event.id, 0.0).await {
                    tracing::warn!(event = %event.id, error = %e, "failed to record event fire");
                }
                out.push(ChatStreamEvent::EventFired {
                    event_id: event.id,
                    event_name: event.name,
                    pattern: event.pattern,
                    idea_ids: event.idea_ids,
                    prepersisted: true,
                });
            }
            out
        };

        let mut initial_events: Vec<ChatStreamEvent> = Vec::new();
        let mut seen_event_ids: std::collections::HashSet<String> =
            std::collections::HashSet::new();

        // Fire lifecycle events BEFORE the user message — canonical AI shape
        // is context-before-input: the model loads state first, then reads
        // the request. `session:start` is session-scoped (once at birth),
        // `session:execution_start` is turn-scoped (every spawn).
        if let Some(aid) = agent_uuid.as_deref() {
            if is_first_execution {
                initial_events
                    .extend(fire_pattern("session:start", aid, &mut seen_event_ids).await);
            }
            initial_events
                .extend(fire_pattern("session:execution_start", aid, &mut seen_event_ids).await);
        }

        // 10. Record initial user message into the session store.
        if opts.record_initial_message
            && let Some(ref ss) = self.session_store
        {
            let _ = ss
                .record_event_by_session_with_sender(
                    &session_id,
                    "message",
                    "user",
                    input,
                    Some(session_type_str),
                    None,
                    opts.sender_id.as_deref(),
                    opts.transport.as_deref(),
                )
                .await;
        }

        // 11. Spawn via tokio::spawn.
        let input_owned = input.to_string();
        let ss_clone = self.session_store.clone();
        let sid_clone = session_id.clone();
        let is_interactive_spawn = is_interactive;
        let al_clone = activity_log.clone();
        let agent_id_clone = agent_uuid.clone().unwrap_or_default();
        let agent_name_clone = agent_name.clone();
        let spawn_transport = opts.transport.clone();

        let join_handle = tokio::spawn(async move {
            // Hold the per-session execution lock for the entire agent.run().
            // Dropped when this task completes, unblocking the next queued
            // spawn_session call for the same session_id.
            let _exec_guard = exec_guard;
            let result = agent.run(&input_owned).await;
            // On completion, record result and close session (unless Interactive — those
            // stay open until explicitly closed).
            if !is_interactive_spawn && let (Some(ss), Ok(r)) = (&ss_clone, &result) {
                // Resolve agent sender for identity-aware recording.
                let agent_sender = ss
                    .resolve_sender(
                        "agent",
                        &agent_id_clone,
                        &agent_name_clone,
                        None,
                        None,
                        None,
                    )
                    .await
                    .ok();
                let sender_id = agent_sender.as_ref().map(|s| s.id.as_str());
                let transport = spawn_transport.as_deref().unwrap_or("internal");
                let _ = ss
                    .record_event_by_session_with_sender(
                        &sid_clone,
                        "message",
                        "assistant",
                        &r.text,
                        Some("session"),
                        None,
                        sender_id,
                        Some(transport),
                    )
                    .await;
                let _ = ss.close_session(&sid_clone).await;
            }
            let _ = al_clone
                .emit(
                    "session_end",
                    Some(&agent_id_clone),
                    Some(&sid_clone),
                    None,
                    &serde_json::json!({}),
                )
                .await;
            result
        });

        // 12. Generate correlation ID for distributed tracing.
        let correlation_id = uuid::Uuid::new_v4().to_string();
        let agent_id_for_session = agent_uuid.unwrap_or_default();

        let _ = activity_log
            .emit(
                "session_start",
                Some(&agent_id_for_session),
                Some(&session_id),
                None,
                &serde_json::json!({"agent_name": agent_name, "session_type": session_type_str}),
            )
            .await;

        info!(
            session_id = %session_id,
            correlation_id = %correlation_id,
            agent = %agent_name,
            session_type = session_type_str,
            auto_close = opts.auto_close,
            "spawn_session: session spawned"
        );

        // 13. Return the spawned-session handle. The caller is responsible
        // for registering this with the `ExecutionRegistry`, awaiting the
        // join handle, and tearing down the sandbox afterwards.
        Ok(SpawnedSession {
            session_id,
            agent_id: agent_id_for_session,
            agent_name,
            correlation_id,
            stream_sender,
            cancel_token,
            sandbox,
            join_handle,
            initial_events,
        })
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}
