//! Session Manager — holds running agent sessions in memory.
//!
//! Each running session is a spawned `Agent::run()` task with a perpetual input
//! channel. Messages are injected via `input_tx`, responses collected via
//! `ChatStreamSender` broadcast. Sessions persist until explicitly closed (which
//! drops the input channel, causing the agent loop to exit).
//!
//! Two kinds of sessions:
//! - **Permanent**: one per agent, always alive, IS the agent's identity
//! - **Spawned**: created by triggers, prompts, or users — persistent until closed

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};
use tracing::{debug, info, warn};

use aeqi_core::AgentResult;
use aeqi_core::chat_stream::{ChatStreamEvent, ChatStreamSender};
use aeqi_core::traits::{IdeaStore, Provider};

use crate::activity::ActivityStream;
use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;
use crate::prompt_loader::PromptLoader;
use crate::sandbox::{QuestDiff, QuestSandbox, SandboxConfig};
use crate::session_store::SessionStore;

/// A running agent session — the in-memory handle to a live agent loop.
pub struct RunningSession {
    pub session_id: String,
    pub agent_id: String,
    pub agent_name: String,
    /// Correlation ID for distributed tracing. Propagated to child sessions
    /// (delegations) and included in all structured log spans.
    pub correlation_id: String,
    pub input_tx: mpsc::UnboundedSender<aeqi_core::SessionInput>,
    pub stream_sender: ChatStreamSender,
    pub cancel_token: Arc<std::sync::atomic::AtomicBool>,
    pub join_handle: tokio::task::JoinHandle<anyhow::Result<AgentResult>>,
    pub chat_id: i64,
    /// Session sandbox (git worktree + optional bwrap). None if unsandboxed.
    pub sandbox: Option<Arc<QuestSandbox>>,
}

impl RunningSession {
    /// Send a message and wait for the agent's response.
    ///
    /// Subscribes to the stream, pushes the message, collects TextDelta events
    /// until a Complete event arrives. Returns the accumulated response text
    /// and token counts.
    pub async fn send_and_wait(&self, message: &str) -> anyhow::Result<SessionResponse> {
        // Subscribe BEFORE pushing so we don't miss events.
        let mut rx = self.stream_sender.subscribe();

        // Push message into the agent loop.
        self.input_tx
            .send(aeqi_core::SessionInput::text(message))
            .map_err(|_| anyhow::anyhow!("session closed — agent loop exited"))?;

        // Collect response.
        let mut text = String::new();
        let mut iterations = 0u32;
        let mut prompt_tokens = 0u32;
        let mut completion_tokens = 0u32;

        loop {
            match tokio::time::timeout(std::time::Duration::from_secs(300), rx.recv()).await {
                Ok(Ok(event)) => match event {
                    ChatStreamEvent::TextDelta { text: delta } => {
                        text.push_str(&delta);
                    }
                    ChatStreamEvent::Complete {
                        total_prompt_tokens,
                        total_completion_tokens,
                        iterations: iters,
                        ..
                    } => {
                        prompt_tokens = total_prompt_tokens;
                        completion_tokens = total_completion_tokens;
                        iterations = iters;
                        break;
                    }
                    _ => {
                        // StepStart, ToolStart, ToolComplete, etc. — skip.
                    }
                },
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(n))) => {
                    warn!(lagged = n, "stream subscriber lagged — some events lost");
                }
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                    // Agent loop ended without a Complete event.
                    break;
                }
                Err(_) => {
                    return Err(anyhow::anyhow!("session response timed out (300s)"));
                }
            }
        }

        Ok(SessionResponse {
            text,
            iterations,
            prompt_tokens,
            completion_tokens,
        })
    }

    /// Check if the agent loop is still running.
    pub fn is_alive(&self) -> bool {
        !self.join_handle.is_finished()
    }
}

/// Response from a session send.
pub struct SessionResponse {
    pub text: String,
    pub iterations: u32,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

/// What kind of session to spawn.
/// Options for spawning a session. Every field is optional context —
/// spawn_session works with just agent_id + prompt + provider.
pub struct SpawnOptions {
    /// Existing session id to bind the running agent loop to.
    pub session_id: Option<String>,
    /// Project scope (for workdir, memory, tools).
    pub project_id: Option<String>,
    /// Parent session (for delegation chains).
    pub parent_id: Option<String>,
    /// Quest being executed (links session to quest).
    pub quest_id: Option<String>,
    /// Session prompts to inject (prompt + tool filter). Multiple allowed.
    pub skills: Vec<String>,
    /// Extra prompt entries injected at session creation time (from UI, delegation, etc).
    pub extra_prompts: Vec<aeqi_core::PromptEntry>,
    /// Close session automatically when agent.run() completes.
    /// Default: true. Set false for persistent/interactive sessions.
    pub auto_close: bool,
    /// Record the initial prompt into the session store.
    pub record_initial_prompt: bool,
    /// Label for the session (shown in UI sidebar).
    pub name: Option<String>,
    /// Sender identity for the initial prompt (who started this session).
    pub sender_id: Option<String>,
    /// Transport that originated this session (e.g. "web", "telegram", "ipc").
    pub transport: Option<String>,
}

impl Default for SpawnOptions {
    fn default() -> Self {
        Self {
            session_id: None,
            project_id: None,
            parent_id: None,
            quest_id: None,
            skills: Vec::new(),
            extra_prompts: Vec::new(),
            auto_close: true,
            record_initial_prompt: true,
            name: None,
            sender_id: None,
            transport: None,
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

    pub fn without_initial_prompt_record(mut self) -> Self {
        self.record_initial_prompt = false;
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

    pub fn with_extra_prompts(mut self, prompts: Vec<aeqi_core::PromptEntry>) -> Self {
        self.extra_prompts.extend(prompts);
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

/// Returned from `spawn_session` — the caller uses this to subscribe to events.
pub struct SpawnedSession {
    pub session_id: String,
    pub correlation_id: String,
    pub stream_sender: ChatStreamSender,
}

/// Manages all running agent sessions in the daemon.
pub struct SessionManager {
    sessions: Mutex<HashMap<String, RunningSession>>,
    // Dependencies for spawn_session (injected via configure()).
    agent_registry: Option<Arc<AgentRegistry>>,
    session_store: Option<Arc<SessionStore>>,
    default_model: String,
    activity_stream: Option<Arc<ActivityStream>>,
    activity_log: Option<Arc<ActivityLog>>,
    shared_primer: Option<String>,
    project_primer: Option<String>,
    idea_store: Option<Arc<dyn IdeaStore>>,
    default_project: String,
    /// Sandbox configuration. When set, sessions are sandboxed in git worktrees.
    sandbox_config: Option<SandboxConfig>,
    /// Unified prompt file loader.
    prompt_loader: Option<Arc<PromptLoader>>,
    /// Event handler store for event-driven idea assembly.
    event_store: Option<Arc<EventHandlerStore>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            agent_registry: None,
            session_store: None,
            default_model: String::new(),
            activity_stream: None,
            activity_log: None,
            shared_primer: None,
            project_primer: None,
            idea_store: None,
            default_project: String::new(),
            sandbox_config: None,
            prompt_loader: None,
            event_store: None,
        }
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
        shared_primer: Option<String>,
        project_primer: Option<String>,
    ) {
        self.shared_primer = shared_primer;
        self.project_primer = project_primer;
        self.agent_registry = Some(agent_registry);
        self.session_store = Some(session_store);
        self.default_model = default_model;
        self.activity_stream = activity_stream;
        self.activity_log = Some(activity_log);
        self.idea_store = idea_store;
        self.default_project = default_project;
    }

    /// Set primers directly without going through configure().
    /// Call after `configure()` to override, or standalone.
    pub fn set_primers(&mut self, shared_primer: Option<String>, project_primer: Option<String>) {
        self.shared_primer = shared_primer;
        self.project_primer = project_primer;
    }

    /// Enable session sandboxing. When set, each session gets a git worktree
    /// and shell commands run inside bubblewrap.
    pub fn set_sandbox_config(&mut self, config: SandboxConfig) {
        self.sandbox_config = Some(config);
    }

    /// Set the unified prompt loader.
    pub fn set_prompt_loader(&mut self, loader: Arc<PromptLoader>) {
        self.prompt_loader = Some(loader);
    }

    /// Set the event handler store for event-driven idea assembly.
    pub fn set_event_store(&mut self, store: Arc<EventHandlerStore>) {
        self.event_store = Some(store);
    }

    /// Spawn a new agent session — the universal executor.
    ///
    /// Resolves agent, builds identity + tools, creates DB session, spawns
    /// the agent loop as a background task, and registers the running session.
    pub async fn spawn_session(
        &self,
        agent_id_or_hint: &str,
        prompt: &str,
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

        // Resolve ancestor IDs for hierarchical memory search.
        let ancestor_ids: Vec<String> = if let Some(ref id) = agent_uuid {
            agent_registry
                .get_ancestor_ids(id)
                .await
                .unwrap_or_else(|_| vec![id.clone()])
        } else {
            Vec::new()
        };

        // 2. Assemble prompts from ancestor chain + extra session prompts.
        //    Event-driven: events define which ideas activate at session start.
        //    Falls back to injection_mode ideas during migration.
        let event_store = self
            .event_store
            .clone()
            .unwrap_or_else(|| Arc::new(EventHandlerStore::new(agent_registry.db())));
        let mut system_prompt = if let Some(ref id) = agent_uuid {
            let assembled = crate::idea_assembly::assemble_ideas(
                agent_registry,
                self.idea_store.as_ref(),
                &event_store,
                id,
                &opts.extra_prompts,
            )
            .await;
            let full = assembled.full_system_prompt();
            // Safety net: if assembly returned empty, use a sensible default.
            if full.trim().is_empty() {
                "You are a helpful AI agent.".to_string()
            } else {
                full
            }
        } else {
            // Unknown agent (no UUID) — use default + primers.
            let mut parts = vec!["You are a helpful AI agent.".to_string()];
            if let Some(ref sp) = self.shared_primer {
                parts.push(sp.clone());
            }
            if let Some(ref pp) = self.project_primer {
                parts.push(pp.clone());
            }
            parts.join("\n\n---\n\n")
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
        tools.push(Arc::new(aeqi_tools::FileWriteTool::new(
            effective_workdir.clone(),
        )));
        tools.push(Arc::new(aeqi_tools::FileEditTool::new(
            effective_workdir.clone(),
        )));
        tools.push(Arc::new(aeqi_tools::GrepTool::new(
            effective_workdir.clone(),
        )));
        tools.push(Arc::new(aeqi_tools::GlobTool::new(
            effective_workdir.clone(),
        )));

        // Network tools now provided by the consolidated WebTool
        // via build_orchestration_tools().

        // 5. Resolve memory — single shared idea store.
        let memory_for_agent: Option<Arc<dyn IdeaStore>> = self.idea_store.clone();

        // Resolve graph DB path.
        let graph_project = if self.default_project.is_empty() {
            None
        } else {
            Some(self.default_project.as_str())
        };
        let graph_db_path = graph_project.and_then(|c| {
            let data_dir = std::env::var("HOME")
                .map(|h| PathBuf::from(h).join(".aeqi"))
                .unwrap_or_else(|_| PathBuf::from("/tmp"));
            let path = data_dir.join("codegraph").join(format!("{c}.db"));
            path.exists().then_some(path)
        });

        // Determine session_id placeholder for delegate tool wiring (filled in after DB create).
        let is_interactive = !opts.auto_close;

        // Build orchestration tools (delegate, memory, notes, graph, etc.)
        {
            let orch_tools = crate::tools::build_orchestration_tools(
                agent_name.clone(),
                activity_log.clone(),
                None,
                memory_for_agent.clone(),
                graph_db_path,
                self.session_store.clone(),
                agent_registry.clone(),
            );
            tools.extend(orch_tools);
        }

        // Note: transcript search is now part of the consolidated CodeTool,
        // which is created inside build_orchestration_tools above.

        // 5b. Discover all available prompts via unified PromptLoader.
        let all_prompts: Arc<Vec<aeqi_tools::Prompt>> = if let Some(ref loader) = self.prompt_loader
        {
            loader.all().await
        } else {
            // No prompt_loader configured — return empty. No ad-hoc disk scanning.
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
        let session_type = if is_interactive {
            aeqi_core::SessionType::Perpetual
        } else {
            aeqi_core::SessionType::Async
        };
        let max_iterations = if is_interactive { 200 } else { 50 };

        let agent_config = aeqi_core::AgentConfig {
            model,
            max_iterations,
            name: agent_name.clone(),
            context_window,
            agent_id: agent_uuid.clone(),
            ancestor_ids: ancestor_ids.clone(),
            session_type,
            ..Default::default()
        };

        // 7. Create Agent with ChatStreamSender, attach memory.
        let observer: Arc<dyn aeqi_core::traits::Observer> =
            Arc::new(aeqi_core::traits::LogObserver);

        let (stream_sender, _initial_rx) = ChatStreamSender::new(256);

        // Load session:step_start ideas as step context (injected every LLM call).
        if let (Some(ehs), Some(idea_store)) = (&self.event_store, &self.idea_store) {
            let step_events = ehs
                .get_events_for_pattern(agent_uuid.as_deref().unwrap_or(""), "session:step_start")
                .await;
            let mut step_idea_ids: Vec<String> = Vec::new();
            for ev in &step_events {
                step_idea_ids.extend(ev.idea_ids.iter().filter(|id| !id.is_empty()).cloned());
            }
            if !step_idea_ids.is_empty()
                && let Ok(ideas) = idea_store.get_by_ids(&step_idea_ids).await
            {
                for idea in &ideas {
                    step_idea_specs.push(aeqi_core::StepIdeaSpec {
                        path: std::path::PathBuf::from(&idea.key),
                        allow_shell: false,
                        name: idea.key.clone(),
                        content: Some(idea.content.clone()),
                    });
                }
            }
        }

        let mut agent =
            aeqi_core::Agent::new(agent_config, provider, tools, observer, system_prompt)
                .with_chat_stream(stream_sender.clone())
                .with_step_ideas(step_idea_specs);

        if let Some(ref mem) = memory_for_agent {
            agent = agent.with_memory(mem.clone());
        }

        // 7.5. Load forked session history if the session already has messages.
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
                agent = agent.with_history(history);
            }
        }

        // 8. If Interactive, create perpetual input channel.
        let (agent, input_tx, cancel_token) = if is_interactive {
            let cancel = agent.cancel_token();
            let (agent, tx) = agent.with_perpetual_input();
            (agent, tx, cancel)
        } else {
            let cancel = agent.cancel_token();
            let (tx, _rx) = mpsc::unbounded_channel();
            (agent, tx, cancel)
        };

        // 9. Create session in DB.
        let parent_id = opts.parent_id.as_deref();
        let quest_id = opts.quest_id.as_deref();
        let session_type_str = opts.session_type_str();

        let session_id = if let Some(existing_id) = opts.session_id.clone() {
            // Pre-assigned session_id (e.g. from channel_sessions). Ensure a
            // `sessions` table record exists so the UI can list it.
            if let Some(ref ss) = self.session_store
                && ss.get_session(&existing_id).await.ok().flatten().is_none()
            {
                let aid = agent_uuid.as_deref().unwrap_or("");
                let display_name = opts.name.as_deref().unwrap_or(&agent_name);
                let _ = ss
                    .create_session_with_id(
                        &existing_id,
                        aid,
                        session_type_str,
                        display_name,
                        parent_id,
                        quest_id,
                    )
                    .await;
            }
            existing_id
        } else if let Some(ref ss) = self.session_store {
            let aid = agent_uuid.as_deref().unwrap_or("");
            let display_name = opts.name.as_deref().unwrap_or(&agent_name);
            ss.create_session(aid, session_type_str, display_name, parent_id, quest_id)
                .await
                .unwrap_or_else(|_| uuid::Uuid::new_v4().to_string())
        } else {
            uuid::Uuid::new_v4().to_string()
        };

        // 10. Record prompt as user message (with sender identity when available).
        if opts.record_initial_prompt
            && let Some(ref ss) = self.session_store
        {
            let _ = ss
                .record_event_by_session_with_sender(
                    &session_id,
                    "message",
                    "user",
                    prompt,
                    Some(session_type_str),
                    None,
                    opts.sender_id.as_deref(),
                    opts.transport.as_deref(),
                )
                .await;
        }

        // 11. Spawn via tokio::spawn.
        let prompt_owned = prompt.to_string();
        let ss_clone = self.session_store.clone();
        let sid_clone = session_id.clone();
        let is_interactive_spawn = is_interactive;
        let al_clone = activity_log.clone();
        let agent_id_clone = agent_uuid.clone().unwrap_or_default();
        let agent_name_clone = agent_name.clone();
        let spawn_transport = opts.transport.clone();

        let join_handle = tokio::spawn(async move {
            let result = agent.run(&prompt_owned).await;
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

        // 13. Register RunningSession.
        let agent_id_for_session = agent_uuid.unwrap_or_default();
        let running = RunningSession {
            session_id: session_id.clone(),
            agent_id: agent_id_for_session.clone(),
            agent_name: agent_name.clone(),
            correlation_id: correlation_id.clone(),
            input_tx,
            stream_sender: stream_sender.clone(),
            cancel_token,
            join_handle,
            chat_id: 0,
            sandbox,
        };
        self.register(running).await;

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

        // 14. Return SpawnedSession.
        Ok(SpawnedSession {
            session_id,
            correlation_id,
            stream_sender,
        })
    }

    /// Register a running session.
    pub async fn register(&self, session: RunningSession) {
        let session_id = session.session_id.clone();
        let agent_name = session.agent_name.clone();
        info!(session_id = %session_id, agent = %agent_name, "session registered");
        self.sessions.lock().await.insert(session_id, session);
    }

    /// Get a reference to a running session for sending messages.
    /// Returns None if session doesn't exist or agent loop has exited.
    pub async fn get(&self, session_id: &str) -> Option<()> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(session_id)
            .and_then(|s| if s.is_alive() { Some(()) } else { None })
    }

    /// Send a message to a running session and wait for the response.
    pub async fn send(&self, session_id: &str, message: &str) -> anyhow::Result<SessionResponse> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("session '{}' not running", session_id))?;

        if !session.is_alive() {
            return Err(anyhow::anyhow!(
                "session '{}' agent loop has exited",
                session_id
            ));
        }

        session.send_and_wait(message).await
    }

    /// Subscribe to a session's stream for real-time events.
    pub async fn subscribe(
        &self,
        session_id: &str,
    ) -> Option<tokio::sync::broadcast::Receiver<ChatStreamEvent>> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(session_id)
            .map(|s| s.stream_sender.subscribe())
    }

    /// Inject a message into a running session without waiting for the response.
    /// Returns a broadcast receiver for streaming events. The caller reads events
    /// from the receiver until Complete arrives.
    pub async fn send_streaming(
        &self,
        session_id: &str,
        message: &str,
    ) -> anyhow::Result<tokio::sync::broadcast::Receiver<ChatStreamEvent>> {
        self.send_streaming_with_ideas(session_id, message, None)
            .await
    }

    pub async fn send_streaming_with_ideas(
        &self,
        session_id: &str,
        message: &str,
        execution_ideas: Option<String>,
    ) -> anyhow::Result<tokio::sync::broadcast::Receiver<ChatStreamEvent>> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| anyhow::anyhow!("session '{}' not running", session_id))?;

        if !session.is_alive() {
            return Err(anyhow::anyhow!(
                "session '{}' agent loop has exited",
                session_id
            ));
        }

        let rx = session.stream_sender.subscribe();

        let mut input = aeqi_core::SessionInput::text(message);
        input.execution_ideas = execution_ideas;
        session
            .input_tx
            .send(input)
            .map_err(|_| anyhow::anyhow!("session closed — agent loop exited"))?;

        Ok(rx)
    }

    /// Remove and shut down a session. Drops input_tx which causes the agent
    /// loop to exit at the next await point.
    ///
    /// If the session has a sandbox, extracts the diff before tearing down.
    /// Returns the diff if there were changes, or None.
    pub async fn close(&self, session_id: &str) -> bool {
        let removed = self.sessions.lock().await.remove(session_id);
        if let Some(session) = removed {
            info!(
                session_id = %session_id,
                agent = %session.agent_name,
                "session closed — dropping input channel"
            );
            // Drop input_tx — agent loop sees None from recv() and exits.
            drop(session.input_tx);
            // Cancel token as backup.
            session
                .cancel_token
                .store(true, std::sync::atomic::Ordering::Relaxed);

            // Tear down sandbox (worktree cleanup).
            // For now, auto-discard changes. A future API can expose
            // close_with_finalize() for commit/merge workflows.
            if let Some(ref sandbox) = session.sandbox
                && let Err(e) = sandbox.teardown().await
            {
                warn!(session_id = %session_id, error = %e, "sandbox teardown failed");
            }

            true
        } else {
            debug!(session_id = %session_id, "close: session not found (already stopped?)");
            false
        }
    }

    /// Close a session and extract the sandbox diff before teardown.
    /// Returns Some(diff) if the session had a sandbox with changes, None otherwise.
    pub async fn close_with_diff(&self, session_id: &str) -> Option<QuestDiff> {
        let removed = self.sessions.lock().await.remove(session_id);
        if let Some(session) = removed {
            info!(
                session_id = %session_id,
                agent = %session.agent_name,
                "session closed with diff extraction"
            );

            drop(session.input_tx);
            session
                .cancel_token
                .store(true, std::sync::atomic::Ordering::Relaxed);

            // Wait briefly for agent loop to finish.
            let _ =
                tokio::time::timeout(std::time::Duration::from_secs(5), session.join_handle).await;

            // Extract diff from sandbox.
            if let Some(ref sandbox) = session.sandbox {
                match sandbox.extract_diff().await {
                    Ok(d) if !d.files_changed.is_empty() => return Some(d),
                    Ok(_) => {
                        // No changes — tear down immediately.
                        let _ = sandbox.teardown().await;
                    }
                    Err(e) => {
                        warn!(session_id = %session_id, error = %e, "failed to extract diff");
                        let _ = sandbox.teardown().await;
                    }
                }
            }
            None
        } else {
            None
        }
    }

    /// Reap dead sessions (agent loops that exited on their own).
    pub async fn reap_dead(&self) {
        let mut sessions = self.sessions.lock().await;
        let dead: Vec<String> = sessions
            .iter()
            .filter(|(_, s)| !s.is_alive())
            .map(|(id, _)| id.clone())
            .collect();

        for id in &dead {
            sessions.remove(id);
        }

        if !dead.is_empty() {
            info!(count = dead.len(), "reaped dead sessions: {:?}", dead);
        }
    }

    /// List all running session IDs.
    pub async fn list_running(&self) -> Vec<String> {
        self.sessions.lock().await.keys().cloned().collect()
    }

    /// Check if a session is running.
    pub async fn is_running(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().await;
        sessions.get(session_id).is_some_and(|s| s.is_alive())
    }

    /// Auto-commit changes in a session's quest worktree after a turn completes.
    pub async fn auto_commit(&self, session_id: &str, turn: u32) {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(session_id)
            && let Some(ref sb) = session.sandbox
        {
            sb.auto_commit(turn).await;
        }
    }

    /// Cancel a running session's current execution.
    pub async fn cancel_session(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get(session_id) {
            session
                .cancel_token
                .store(true, std::sync::atomic::Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    /// Get the broadcast stream sender for a running session.
    /// Returns None if the session doesn't exist or is no longer alive.
    pub async fn get_stream_sender(&self, session_id: &str) -> Option<ChatStreamSender> {
        let sessions = self.sessions.lock().await;
        sessions
            .get(session_id)
            .filter(|s| s.is_alive())
            .map(|s| s.stream_sender.clone())
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}
