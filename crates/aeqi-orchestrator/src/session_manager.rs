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
use crate::agent_registry::{AgentRegistry, InferenceCapability};
use crate::event_handler::EventHandlerStore;
use crate::idea_assembly::ToolDispatch;
use crate::runtime_tools::{SpawnFn, SpawnRequest, build_runtime_registry_with_spawn_and_caps};
use crate::sandbox::{QuestSandbox, SandboxConfig};
use crate::scope_visibility;
use crate::session_store::SessionStore;
use crate::skill_loader::SkillLoader;

fn enforce_inference_capability(
    agent_name: &str,
    capability: Option<&InferenceCapability>,
    provider: &dyn Provider,
    model: &str,
) -> anyhow::Result<()> {
    if let Some(capability) = capability {
        capability
            .allows_request(provider.name(), model)
            .map_err(|e| anyhow::anyhow!("agent '{agent_name}' {e}"))?;
    }
    Ok(())
}

/// Pick the model for a `session.spawn` call. When `kind == "compactor"` and
/// the agent declared a `compactor_model` override, use it; otherwise fall
/// back to the agent's primary model. The override applies ONLY to compactor
/// spawns — continuation spawns inherit the primary model so the resumed
/// agent runs on the same capability tier.
///
/// Quest 67-180.4, deliverable 9.
fn resolve_spawn_model(
    kind: &str,
    primary_model: &str,
    compactor_override: Option<&str>,
) -> String {
    match (kind, compactor_override) {
        ("compactor", Some(m)) if !m.trim().is_empty() => m.to_string(),
        _ => primary_model.to_string(),
    }
}

/// Compute the `max_tokens` budget for a spawned session. Compactor spawns
/// get the scaled summary budget so the LLM has proportional output room;
/// other kinds keep the default budget so existing call patterns are
/// unchanged.
///
/// Quest 67-180.4, deliverable 7.
fn resolve_spawn_max_tokens(kind: &str, input_chars: usize) -> u32 {
    if kind == "compactor" {
        aeqi_core::agent::compaction::compute_summary_max_tokens(input_chars)
    } else {
        // Inherit the AgentConfig default for non-compactor spawns. The
        // default ships at 4096; surfacing the constant here keeps the call
        // sites honest if the default ever changes.
        aeqi_core::AgentConfig::default().max_tokens
    }
}

/// Log a warning when the agent declared a `compactor_provider` hint that
/// disagrees with the provider actually serving the spawn. The runtime has
/// no provider factory today (one `default_provider` Arc per orchestrator),
/// so the hint is recorded for audit but does NOT route. Operators see a
/// warning at fire time so they can spot the mismatch instead of silently
/// running on the wrong provider.
///
/// Quest 67-180.4, deliverable 9 (audit half).
fn warn_on_provider_hint_mismatch(
    kind: &str,
    agent_name: &str,
    compactor_provider_hint: Option<&str>,
    active_provider: &dyn Provider,
) {
    if kind != "compactor" {
        return;
    }
    let Some(hint) = compactor_provider_hint else {
        return;
    };
    let hint = hint.trim();
    if hint.is_empty() {
        return;
    }
    let active_name = active_provider.name();
    if !hint.eq_ignore_ascii_case(active_name) {
        warn!(
            agent = %agent_name,
            declared_provider = %hint,
            active_provider = %active_name,
            "compactor_provider hint differs from active provider; \
             runtime has no provider factory — spawn proceeds on the active provider"
        );
    }
}

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
    /// `from_kind` for the initial message row. Default `None` keeps the
    /// existing role-based shape (web chat, role-addressed delivery →
    /// `from_kind` left NULL and backfilled by the boot migration as
    /// `"user"`). Set to `"system"` for runtime-originated spawns
    /// (cron / schedule / autonomous loops) so the inbox UI does NOT
    /// attribute the seed prompt to the founder.
    pub from_kind: Option<String>,
    /// `from_id` for the initial message row. Pairs with `from_kind`.
    /// `None` for system rows; populated for user / agent / role rows.
    pub from_id: Option<String>,
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
            from_kind: None,
            from_id: None,
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

    /// Override the `from_kind` written on the initial message row. Use
    /// `"system"` for runtime-originated spawns (cron / schedule / etc.)
    /// so the inbox UI renders them as system events rather than
    /// attributing them to the viewing user. Default behaviour (None)
    /// keeps every existing call site on the role-based shape.
    pub fn with_from_kind(mut self, kind: impl Into<String>) -> Self {
        self.from_kind = Some(kind.into());
        self
    }

    /// Pair with `with_from_kind` when the initial message is from a
    /// real principal (user / agent / role). Leave unset for `system`
    /// rows.
    pub fn with_from_id(mut self, id: impl Into<String>) -> Self {
        self.from_id = Some(id.into());
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
    /// Optional MCP registry handle. When set, every session adds a fresh
    /// snapshot of the registered MCP tools to its tool list at spawn time
    /// — so a `tools/list_changed` notification or a server reconnect
    /// surfaces in subsequent sessions without restarting the daemon.
    mcp_registry: Option<Arc<aeqi_mcp::McpRegistry>>,
    /// (T1.11) Optional tag-policy cache. When set, idea assembly decorates
    /// segments whose tag-policy votes `cache_breakpoint=true` with an
    /// `Ephemeral` cache marker so the Anthropic provider can apply
    /// `cache_control` annotations on the wire. `None` preserves the
    /// pre-T1.11 behaviour (no markers emitted).
    tag_policy_cache: Option<Arc<aeqi_ideas::tag_policy::TagPolicyCache>>,
    /// Per-session cooldown cache for compactor LLM failures (quest 67-180.4,
    /// deliverable 10). Shared across every session spawned by this manager
    /// so a compactor that failed in one turn keeps the cooldown across
    /// subsequent turns of the same session.
    compactor_cooldown: Arc<crate::idea_assembly::CompactorCooldown>,
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
            mcp_registry: None,
            tag_policy_cache: None,
            compactor_cooldown: Arc::new(crate::idea_assembly::CompactorCooldown::new()),
        }
    }

    /// (T1.11) Wire a `TagPolicyCache` so prompt assembly emits cache
    /// breakpoints on segments tagged `cache_breakpoint=true`. Calling this
    /// is optional — the daemon plumbs the same cache it already uses for
    /// `ideas.store_many` so seed-side opt-ins (`identity`, `evergreen`)
    /// take effect end-to-end.
    pub fn set_tag_policy_cache(&mut self, cache: Arc<aeqi_ideas::tag_policy::TagPolicyCache>) {
        self.tag_policy_cache = Some(cache);
    }

    /// Wire an MCP registry so each spawned session receives the latest
    /// MCP tool snapshot. `None` disables MCP integration; the daemon
    /// path that calls this is gated on whether `meta:mcp-servers` had
    /// any non-empty entries.
    pub fn set_mcp_registry(&mut self, registry: Arc<aeqi_mcp::McpRegistry>) {
        self.mcp_registry = Some(registry);
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
        // Resolve director-asking capability from the agent record.
        // Same posture as self-delegation: off by default for agents that
        // exist in the DB without it set, off entirely for bare-CLI
        // ephemeral runs that have no DB record.
        let agent_can_ask_director = agent_opt
            .as_ref()
            .map(|a| a.can_ask_director)
            .unwrap_or(false);
        let agent_inference_cap = agent_opt.as_ref().and_then(|a| a.inference_cap.clone());
        // Per-agent compactor overrides (quest 67-180.4, deliverable 9). The
        // model override flows into the SpawnFn closures below and replaces
        // `session_model` when `req.kind == "compactor"`. The provider hint is
        // captured for the audit log; provider-name routing is deferred until
        // the runtime grows a provider factory, but operators see a warning
        // when their declared hint diverges from the active provider.
        let agent_compactor_model = agent_opt.as_ref().and_then(|a| a.compactor_model.clone());
        let agent_compactor_provider = agent_opt
            .as_ref()
            .and_then(|a| a.compactor_provider.clone());
        let session_model = if let Some(ref id) = agent_uuid {
            agent_registry.resolve_model(id, &self.default_model).await
        } else {
            self.default_model.clone()
        };
        enforce_inference_capability(
            &agent_name,
            agent_inference_cap.as_ref(),
            provider.as_ref(),
            &session_model,
        )?;

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
        // (T1.11) Captured alongside the flat `system_prompt` so the agent can
        // re-emit the per-segment cache_control markers on the wire.
        let mut system_prompt_segments: Vec<aeqi_core::AssembledPromptSegment> = Vec::new();
        let mut system_prompt = if let Some(ref id) = agent_uuid {
            // Build a runtime tool registry so event tool_calls can execute.
            // The session_id is not yet known at this point (created in step 9),
            // so we use a temporary placeholder; tools that need session_id
            // (e.g. transcript.inject) must be called after session creation.
            let session_store_for_reg = self.session_store.clone();

            // Build a SpawnFn closure that captures the minimal state needed to
            // run an ephemeral session. We capture cloned fields directly to
            // avoid needing Arc<Self> at this call site.
            let eph_model = session_model.clone();
            let eph_provider = self.default_provider.clone();
            let eph_idea_store = self.idea_store.clone();
            let eph_capability = agent_inference_cap.clone();
            let eph_agent_name = agent_name.clone();
            let eph_compactor_model = agent_compactor_model.clone();
            let eph_compactor_provider = agent_compactor_provider.clone();

            let spawn_fn: SpawnFn = Arc::new(move |req: SpawnRequest| {
                let primary_model = eph_model.clone();
                let provider_opt = eph_provider.clone();
                let idea_store_opt = eph_idea_store.clone();
                let capability = eph_capability.clone();
                let agent_name = eph_agent_name.clone();
                let compactor_model_override = eph_compactor_model.clone();
                let compactor_provider_hint = eph_compactor_provider.clone();
                Box::pin(async move {
                    let provider = provider_opt.ok_or_else(|| {
                        anyhow::anyhow!("session.spawn: no default provider configured")
                    })?;

                    // Deliverable 9: compactor model override. The override
                    // applies ONLY when `kind == "compactor"`; continuation
                    // spawns inherit the agent's primary model.
                    let model = resolve_spawn_model(
                        &req.kind,
                        &primary_model,
                        compactor_model_override.as_deref(),
                    );
                    warn_on_provider_hint_mismatch(
                        &req.kind,
                        &agent_name,
                        compactor_provider_hint.as_deref(),
                        provider.as_ref(),
                    );
                    enforce_inference_capability(
                        &agent_name,
                        capability.as_ref(),
                        provider.as_ref(),
                        &model,
                    )?;

                    let system_prompt = if let Some(ref idea_name) = req.instructions_idea {
                        // Try to load the instructions idea from the idea store.
                        if let Some(ref is) = idea_store_opt
                            && let Ok(Some(idea)) = is.get_by_name(idea_name, None).await
                        {
                            idea.content
                        } else {
                            format!(
                                "You are an aeqi agent running as a {kind} session.",
                                kind = req.kind
                            )
                        }
                    } else {
                        format!(
                            "You are an aeqi agent running as a {kind} session.",
                            kind = req.kind
                        )
                    };

                    let seed = req.seed_content.unwrap_or_default();
                    let context_window = aeqi_providers::context_window_for_model(&model);
                    let max_tokens = resolve_spawn_max_tokens(&req.kind, seed.len());
                    let config = aeqi_core::AgentConfig {
                        model,
                        max_iterations: 10,
                        max_tokens,
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
            let assembled = crate::idea_assembly::assemble_ideas_with_cache(
                agent_registry,
                self.idea_store.as_ref(),
                &event_store,
                id,
                &[],
                Some(&dispatch),
                self.tag_policy_cache.as_ref(),
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
            let exec_assembled = crate::idea_assembly::assemble_execution_context_with_cache(
                agent_registry,
                self.idea_store.as_ref(),
                &event_store,
                id,
                Some(&dispatch),
                self.tag_policy_cache.as_ref(),
            )
            .await;
            let _ = &exec_assembled.fired_event_ids;
            execution_context = exec_assembled.system;

            // (T1.11) Capture segments for the agent so per-segment
            // cache_control markers reach the provider boundary.
            system_prompt_segments = assembled.segments;

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

        // Build the per-session pattern dispatcher up-front so we can hand
        // it to both `build_orchestration_tools` (so `quests(action='close')`
        // fires `session:quest_end` end-to-end) and the agent itself (for
        // compaction-as-delegation via `context:budget:exceeded`). Same
        // dispatcher serves both roles — building it twice would duplicate
        // the runtime registry for no win.
        let pattern_dispatcher: Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>> =
            if let Some(ref ehs) = self.event_store {
                let eph_model_d = session_model.clone();
                let eph_provider_d = self.default_provider.clone();
                let eph_idea_store_d = self.idea_store.clone();
                let eph_capability_d = agent_inference_cap.clone();
                let eph_agent_name_d = agent_name.clone();
                let eph_compactor_model_d = agent_compactor_model.clone();
                let eph_compactor_provider_d = agent_compactor_provider.clone();
                let dispatcher_spawn_fn: SpawnFn = Arc::new(move |req: SpawnRequest| {
                    let primary_model = eph_model_d.clone();
                    let provider_opt = eph_provider_d.clone();
                    let idea_store_opt = eph_idea_store_d.clone();
                    let capability = eph_capability_d.clone();
                    let agent_name = eph_agent_name_d.clone();
                    let compactor_model_override = eph_compactor_model_d.clone();
                    let compactor_provider_hint = eph_compactor_provider_d.clone();
                    Box::pin(async move {
                        let provider = provider_opt.ok_or_else(|| {
                            anyhow::anyhow!(
                                "session.spawn (per-session dispatcher): no provider configured"
                            )
                        })?;
                        // Deliverable 9: compactor model override + provider
                        // hint. Same gate flow as the spawn-time closure
                        // above so the dispatcher path is enforced too.
                        let model = resolve_spawn_model(
                            &req.kind,
                            &primary_model,
                            compactor_model_override.as_deref(),
                        );
                        warn_on_provider_hint_mismatch(
                            &req.kind,
                            &agent_name,
                            compactor_provider_hint.as_deref(),
                            provider.as_ref(),
                        );
                        enforce_inference_capability(
                            &agent_name,
                            capability.as_ref(),
                            provider.as_ref(),
                            &model,
                        )?;
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
                        let max_tokens = resolve_spawn_max_tokens(&req.kind, seed.len());
                        let parent = &req.parent_session_id;
                        let config = aeqi_core::AgentConfig {
                            model,
                            max_iterations: 10,
                            max_tokens,
                            name: format!("compactor:{}", &parent[..8.min(parent.len())]),
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
                let dispatcher = Arc::new(crate::idea_assembly::EventPatternDispatcher {
                    event_store: ehs.clone(),
                    registry: Arc::new(runtime_reg_for_dispatcher),
                    agent_registry: agent_registry.clone(),
                    session_store: self.session_store.clone(),
                    idea_store: self.idea_store.clone(),
                    compactor_cooldown: Some(self.compactor_cooldown.clone()),
                });
                Some(dispatcher as Arc<dyn aeqi_core::tool_registry::PatternDispatcher>)
            } else {
                None
            };

        // Build orchestration tools (agents, quests, events, code, ideas)
        if let Some(agent_id) = agent_uuid.clone() {
            let orch_tools = crate::tools::build_orchestration_tools(
                agent_id,
                pregenerated_session_id.clone(),
                opts.transport.clone(),
                activity_log.clone(),
                None,
                idea_store_for_agent.clone(),
                graph_db_path,
                self.session_store.clone(),
                agent_registry.clone(),
                pattern_dispatcher.clone(),
            );
            tools.extend(orch_tools);
        } else {
            warn!(agent = %agent_name, "skipping orchestration tools: unresolved agent id");
        }

        if opts.transport.is_some() {
            let transport = opts.transport.as_deref().unwrap_or("unknown");
            let channel_key = agent_registry
                .get_channel_session_key_for_session(&pregenerated_session_id)
                .await
                .ok()
                .flatten()
                .map(|key| key.as_key())
                .unwrap_or_else(|| "none".to_string());
            system_prompt = format!(
                "{system_prompt}\n\n---\n\nRuntime context:\n\
                 - Current session id: {pregenerated_session_id}\n\
                 - Current transport: {transport}\n\
                 - Current channel session key: {channel_key}\n\
                 Use the `session.info` tool when you need authoritative agent, session, \
                 channel, whitelist, or transport metadata. Do not infer the active \
                 transport from config files or process names when runtime metadata is present."
            );
        }

        // `question.ask` — director-inbox tool. Capability-gated; off-by-default.
        //
        // Wave-3 delegation: ask_fn now routes through message_to internally.
        // It calls message_to(target=user, payload_kind=decision_request), then
        // stamps awaiting_at on the resulting DM session so the legacy inbox
        // query continues to surface it (until Wave-4 unifies the inbox query).
        //
        // The closure captures the SessionStore, ActivityLog, optional pattern
        // dispatcher, plus the session_id and agent_id at registry-build time
        // so the LLM cannot influence inbox routing through args.
        if let (Some(ss), Some(agent_id)) = (self.session_store.clone(), agent_uuid.clone()) {
            let session_id_for_ask = pregenerated_session_id.clone();
            let activity_log_for_ask = activity_log.clone();
            let dispatcher_for_ask = pattern_dispatcher.clone();
            let agent_id_for_ask = agent_id.clone();
            let agent_name_for_ask = agent_name.clone();
            // Capture trust_id + agent_registry so the closure can resolve
            // the owning user at execution time.
            let entity_id_for_ask = agent_opt.as_ref().and_then(|a| a.trust_id.clone());
            let agent_registry_for_ask = agent_registry.clone();
            let ask_fn: crate::runtime_tools::AskFn =
                Arc::new(move |req: crate::runtime_tools::AskRequest| {
                    let ss = ss.clone();
                    let activity_log = activity_log_for_ask.clone();
                    let dispatcher = dispatcher_for_ask.clone();
                    let session_id = session_id_for_ask.clone();
                    let agent_id = agent_id_for_ask.clone();
                    let agent_name = agent_name_for_ask.clone();
                    let trust_id = entity_id_for_ask.clone();
                    let agent_registry = agent_registry_for_ask.clone();
                    Box::pin(async move {
                        // 1. Resolve the owning user for this agent's entity.
                        //    Fall back to a plain transcript record on the current
                        //    session when the entity or owner is not set (bare-CLI,
                        //    test, legacy runs).
                        let owner_user_id: Option<String> = if let Some(ref eid) = trust_id {
                            let db = agent_registry.db();
                            let conn = db.lock().await;
                            let eid_clone = eid.clone();
                            tokio::task::block_in_place(|| {
                                use rusqlite::OptionalExtension;
                                conn.query_row(
                                    "SELECT owner_user_id FROM entities WHERE id = ?1",
                                    rusqlite::params![eid_clone],
                                    |row| row.get::<_, Option<String>>(0),
                                )
                                .optional()
                                .ok()
                                .flatten()
                                .flatten()
                            })
                        } else {
                            None
                        };

                        // 2. Route via message_to: if we have a user target, create
                        //    the DM session and append there. Otherwise fall back to
                        //    recording on the current session (legacy path).
                        let inbox_session_id = if let Some(user_id) = owner_user_id {
                            let dm_name = format!("dm:agent:{}:user:{}", agent_id, user_id);
                            let (sid, _created) = ss
                                .find_or_create_dm_session(
                                    "agent_user_dm",
                                    &dm_name,
                                    "agent",
                                    &agent_id,
                                    "user",
                                    &user_id,
                                )
                                .await
                                .map_err(|e| {
                                    anyhow::anyhow!("question.ask: find_or_create_dm: {e}")
                                })?;
                            ss.append_message_from(
                                &sid,
                                "assistant",
                                &req.prompt,
                                "agent",
                                Some(&agent_id),
                                Some("decision_request"),
                            )
                            .await
                            .map_err(|e| {
                                anyhow::anyhow!("question.ask: failed to record DM message: {e}")
                            })?;
                            sid
                        } else {
                            // Legacy: append to the current session directly.
                            ss.record_event_by_session(
                                &session_id,
                                "message",
                                "assistant",
                                &req.prompt,
                                Some("question.ask"),
                                Some(&serde_json::json!({"subject": req.subject})),
                            )
                            .await
                            .map_err(|e| {
                                anyhow::anyhow!("question.ask: failed to record message: {e}")
                            })?;
                            session_id.clone()
                        };

                        // 3. Stamp awaiting_at on the inbox session (DM or current).
                        ss.set_awaiting(&inbox_session_id, &req.subject)
                            .await
                            .map_err(|e| {
                                anyhow::anyhow!("question.ask: failed to set awaiting: {e}")
                            })?;

                        // 4. Activity-log emit so downstream observers (UI
                        //    timeline, audit log) see the ask.
                        let _ = activity_log
                            .emit(
                                "question_awaiting",
                                Some(&agent_id),
                                Some(&inbox_session_id),
                                None,
                                &serde_json::json!({"subject": req.subject}),
                            )
                            .await;

                        // 5. Best-effort pattern dispatch. Operators can wire
                        //    `question:awaiting` events to fire side effects
                        //    (telegram ping, consolidation, …).
                        //    Fire-and-forget — intentional asymmetry with
                        //    `session:quest_end` (queue_executor.rs ~line 492)
                        //    which IS awaited because reflection-on-completion
                        //    must finish before the session closes. For
                        //    `question:awaiting` the trade-off flips: a slow
                        //    operator-configured event chain (telegram ping
                        //    with retry, consolidation) shouldn't block the
                        //    agent's return-from-tool path. The pattern fires
                        //    for notification side-effects, not control flow.
                        if let Some(dispatcher) = dispatcher {
                            let prompt_preview: String = req.prompt.chars().take(200).collect();
                            let trigger_args = serde_json::json!({
                                "session_id": inbox_session_id,
                                "agent_id": agent_id,
                                "agent_name": agent_name,
                                "subject": req.subject,
                                "prompt_preview": prompt_preview,
                            });
                            let ctx = aeqi_core::tool_registry::ExecutionContext {
                                session_id: inbox_session_id.clone(),
                                agent_id: agent_id.clone(),
                                ..Default::default()
                            };
                            tokio::spawn(async move {
                                let _ = dispatcher
                                    .dispatch("question:awaiting", &ctx, &trigger_args)
                                    .await;
                            });
                        }
                        Ok(())
                    })
                });
            tools.push(Arc::new(crate::runtime_tools::QuestionAskTool::new(
                ask_fn,
                agent_can_ask_director,
            )));
        }

        // `message_to` — universal outbound-message tool. LLM-only.
        // The closure captures the SessionStore + calling agent_id so the LLM
        // cannot influence routing via args. No capability gate: every agent
        // can send messages to other participants.
        if let (Some(ss), Some(agent_id)) = (self.session_store.clone(), agent_uuid.clone()) {
            let message_to_fn: crate::runtime_tools::MessageToFn =
                Arc::new(move |req: crate::runtime_tools::MessageToRequest| {
                    let ss = ss.clone();
                    let from_agent_id = agent_id.clone();
                    Box::pin(async move {
                        use crate::runtime_tools::MessageToResult;

                        let (session_id, msg_id) = match req.target_kind.as_str() {
                            "session" => {
                                let mid = ss
                                    .append_message_from(
                                        &req.target_id,
                                        "assistant",
                                        &req.body,
                                        "agent",
                                        Some(&from_agent_id),
                                        req.payload_kind.as_deref(),
                                    )
                                    .await
                                    .map_err(|e| anyhow::anyhow!("message_to(session): {e}"))?;
                                (req.target_id.clone(), mid)
                            }
                            "agent" => {
                                let dm_name =
                                    format!("dm:agent:{}:agent:{}", from_agent_id, req.target_id);
                                let (sid, _created) = ss
                                    .find_or_create_dm_session(
                                        "agent_agent_dm",
                                        &dm_name,
                                        "agent",
                                        &from_agent_id,
                                        "agent",
                                        &req.target_id,
                                    )
                                    .await
                                    .map_err(|e| {
                                        anyhow::anyhow!("message_to(agent) find_or_create: {e}")
                                    })?;
                                let mid = ss
                                    .append_message_from(
                                        &sid,
                                        "assistant",
                                        &req.body,
                                        "agent",
                                        Some(&from_agent_id),
                                        req.payload_kind.as_deref(),
                                    )
                                    .await
                                    .map_err(|e| {
                                        anyhow::anyhow!("message_to(agent) append: {e}")
                                    })?;
                                (sid, mid)
                            }
                            "user" => {
                                let dm_name =
                                    format!("dm:agent:{}:user:{}", from_agent_id, req.target_id);
                                let (sid, _created) = ss
                                    .find_or_create_dm_session(
                                        "agent_user_dm",
                                        &dm_name,
                                        "agent",
                                        &from_agent_id,
                                        "user",
                                        &req.target_id,
                                    )
                                    .await
                                    .map_err(|e| {
                                        anyhow::anyhow!("message_to(user) find_or_create: {e}")
                                    })?;
                                let mid = ss
                                    .append_message_from(
                                        &sid,
                                        "assistant",
                                        &req.body,
                                        "agent",
                                        Some(&from_agent_id),
                                        req.payload_kind.as_deref(),
                                    )
                                    .await
                                    .map_err(|e| anyhow::anyhow!("message_to(user) append: {e}"))?;
                                (sid, mid)
                            }
                            other => {
                                return Err(anyhow::anyhow!(
                                    "message_to: unsupported target_kind '{other}' in this context"
                                ));
                            }
                        };

                        Ok(MessageToResult {
                            session_id,
                            message_id: msg_id,
                        })
                    })
                });
            // Replace the stub with the wired tool (the stub was registered in
            // build_runtime_registry_full for spec-only contexts; push the real
            // one now so session_manager's registry wins).
            tools.retain(|t| t.name() != "message_to");
            tools.push(Arc::new(crate::runtime_tools::MessageToTool::new(
                message_to_fn,
            )));
        }

        // T1.10 — append MCP-discovered tools. Snapshot is captured at
        // session spawn time so a server that reconnects or pushes
        // `tools/list_changed` will surface in the next session.
        if let Some(ref mcp) = self.mcp_registry {
            let snap = mcp.snapshot().await;
            for tool in snap.tools {
                tools.push(tool);
            }
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
        let model = session_model.clone();
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
            worker_ctx.model = session_model.clone();
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

        // session:step_start fires per LLM step. The Agent emits `EventFired`
        // at each `StepStart` for any wired step events; per-step content
        // injection should flow through `tool_calls` on those events
        // (dispatched via the standard PatternDispatcher path).
        let step_event_metas: Vec<aeqi_core::StepEventMeta> = Vec::new();

        let mut agent =
            aeqi_core::Agent::new(agent_config, provider, tools, observer, system_prompt)
                .with_chat_stream(stream_sender.clone())
                .with_step_ideas(step_idea_specs)
                .with_step_events(step_event_metas)
                .with_execution_context(execution_context)
                .with_system_prompt_segments(system_prompt_segments);

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

        // Reuse the per-session pattern dispatcher built up-front (see the
        // `pattern_dispatcher` binding above the `build_orchestration_tools`
        // call) so the compaction pipeline can delegate via the
        // `context:budget:exceeded` event. Building it twice would duplicate
        // the runtime registry for no win.
        if let Some(ref dispatcher) = pattern_dispatcher {
            agent = agent.with_pattern_dispatcher(dispatcher.clone());
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
            // Cron / schedule / autonomous-loop spawns set
            // `from_kind = "system"` via SpawnOptions so the row is NOT
            // attributed to the viewing user in the inbox UI. Default
            // remains role="user" (web chat, role-addressed, telegram,
            // etc.).
            let initial_role = match opts.from_kind.as_deref() {
                Some("system") => "system",
                _ => "user",
            };
            let _ = ss
                .record_event_by_session_with_full_identity(
                    &session_id,
                    "message",
                    initial_role,
                    input,
                    Some(session_type_str),
                    None,
                    opts.sender_id.as_deref(),
                    opts.transport.as_deref(),
                    opts.from_kind.as_deref(),
                    opts.from_id.as_deref(),
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
            if let Ok(r) = &result
                && crate::llm_health::is_empty_completion_failure_result(r)
            {
                let stop_reason = format!("{:?}", r.stop_reason);
                let agent_for_event =
                    (!agent_id_clone.is_empty()).then_some(agent_id_clone.as_str());
                let _ = al_clone
                    .emit(
                        crate::llm_health::EMPTY_COMPLETION_EVENT,
                        agent_for_event,
                        Some(&sid_clone),
                        None,
                        &serde_json::json!({
                            "model": r.model.as_str(),
                            "prompt_tokens": r.total_prompt_tokens,
                            "completion_tokens": r.total_completion_tokens,
                            "iterations": r.iterations,
                            "stop_reason": stop_reason,
                            "transport": spawn_transport.as_deref().unwrap_or("internal"),
                        }),
                    )
                    .await;
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::{ChatRequest, ChatResponse};
    use async_trait::async_trait;

    struct NamedProvider(&'static str);

    #[async_trait]
    impl Provider for NamedProvider {
        async fn chat(&self, _request: &ChatRequest) -> anyhow::Result<ChatResponse> {
            unreachable!("capability checks do not call provider.chat")
        }

        fn name(&self) -> &str {
            self.0
        }

        async fn health_check(&self) -> anyhow::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn no_inference_capability_allows_any_provider_model() {
        let provider = NamedProvider("openrouter");

        enforce_inference_capability("agent", None, &provider, "anthropic/claude-sonnet-4.6")
            .unwrap();
    }

    #[test]
    fn inference_capability_blocks_session_spawn_request() {
        let provider = NamedProvider("openrouter");
        let cap = InferenceCapability {
            allowed_providers: Some(vec!["anthropic".to_string()]),
            allowed_models: Some(vec!["anthropic/claude-sonnet-4.6".to_string()]),
            max_cost_per_call_usd: None,
        };

        let err = enforce_inference_capability(
            "agent",
            Some(&cap),
            &provider,
            "anthropic/claude-sonnet-4.6",
        )
        .unwrap_err();

        assert!(err.to_string().contains("inference capability violation"));
    }

    // ── Quest 67-180.4 deliverable 9: compactor model override ──────────────────

    #[test]
    fn resolve_spawn_model_uses_compactor_override_for_compactor_kind() {
        let model = resolve_spawn_model(
            "compactor",
            "anthropic/claude-sonnet-4.6",
            Some("anthropic/claude-haiku-4.5"),
        );
        assert_eq!(model, "anthropic/claude-haiku-4.5");
    }

    #[test]
    fn resolve_spawn_model_ignores_override_for_continuation_kind() {
        let model = resolve_spawn_model(
            "continuation",
            "anthropic/claude-sonnet-4.6",
            Some("anthropic/claude-haiku-4.5"),
        );
        assert_eq!(model, "anthropic/claude-sonnet-4.6");
    }

    #[test]
    fn resolve_spawn_model_falls_back_to_primary_when_override_unset() {
        let model = resolve_spawn_model("compactor", "anthropic/claude-sonnet-4.6", None);
        assert_eq!(model, "anthropic/claude-sonnet-4.6");
    }

    #[test]
    fn resolve_spawn_model_treats_empty_override_as_unset() {
        // Operator clearing the field via API may leave an empty string;
        // treat that as "use primary".
        let model = resolve_spawn_model("compactor", "anthropic/claude-sonnet-4.6", Some("   "));
        assert_eq!(model, "anthropic/claude-sonnet-4.6");
    }

    // ── Quest 67-180.4 deliverable 7: scaled summary budget ─────────────────────

    #[test]
    fn resolve_spawn_max_tokens_scales_for_compactor() {
        // For compactor kind, the formula in compaction::compute_summary_max_tokens
        // is `clamp(input_chars / 4 / 8, MIN, MAX)`. 32_000 chars → 1000.
        let mt = resolve_spawn_max_tokens("compactor", 32_000);
        assert_eq!(mt, 1_000);
    }

    #[test]
    fn resolve_spawn_max_tokens_floors_for_tiny_compactor_input() {
        let mt = resolve_spawn_max_tokens("compactor", 16);
        assert_eq!(mt, aeqi_core::agent::compaction::SUMMARY_BUDGET_MIN);
    }

    #[test]
    fn resolve_spawn_max_tokens_caps_for_huge_compactor_input() {
        let mt = resolve_spawn_max_tokens("compactor", 5_000_000);
        assert_eq!(mt, aeqi_core::agent::compaction::SUMMARY_BUDGET_MAX);
    }

    #[test]
    fn resolve_spawn_max_tokens_uses_default_for_non_compactor() {
        let mt = resolve_spawn_max_tokens("continuation", 32_000);
        assert_eq!(mt, aeqi_core::AgentConfig::default().max_tokens);
    }
}
