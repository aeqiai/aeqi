use aeqi_core::SecretStore;
use aeqi_core::config::TelegramChatRouteConfig;
use aeqi_core::traits::Channel;
use aeqi_gates::TelegramChannel;
use aeqi_orchestrator::tools::build_orchestration_tools;
use aeqi_orchestrator::{
    AEQIMetrics, AgentRouter, CompanyRecord, Daemon, ActivityLog, Scheduler, SchedulerConfig,
    SessionManager, SessionStore,
};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use crate::cli::DaemonAction;
use crate::helpers::{
    build_project_tools, build_provider_for_project, build_provider_for_runtime, build_tools,
    daemon_ipc_request,
    find_agent_dir, find_project_dir, get_api_key, handle_fast_lane, load_config,
    load_config_with_agents, open_ideas, pid_file_path,
};
use crate::service::{install_user_service, render_user_service, uninstall_user_service};

pub(crate) async fn cmd_daemon(config_path: &Option<PathBuf>, action: DaemonAction) -> Result<()> {
    match action {
        DaemonAction::Start => {
            let (config, _) = load_config_with_agents(config_path)?;

            // Check if already running.
            // In sandboxed environments (bwrap --unshare-pid), PID namespace
            // isolation means /proc/{pid} always exists for PID 1. Detect
            // this by checking if we ARE PID 1 (containerized) — if so,
            // always remove stale PID files since systemd-run manages exclusivity.
            let pid_path = pid_file_path(&config);
            let in_sandbox = std::process::id() <= 2; // PID 1 or 2 = inside namespace
            if pid_path.exists() {
                if in_sandbox {
                    let _ = std::fs::remove_file(&pid_path);
                } else if Daemon::is_running_from_pid(&pid_path) {
                    anyhow::bail!(
                        "daemon is already running (PID file: {})",
                        pid_path.display()
                    );
                } else {
                    let _ = std::fs::remove_file(&pid_path);
                }
            }

            let _data_dir = config.data_dir();
            let activity_stream = Arc::new(aeqi_orchestrator::ActivityStream::new());
            let daily_budget_usd = config.security.max_cost_per_day_usd;
            let leader_name = config
                .leader_agent()
                .map(|a| a.name.clone())
                .unwrap_or_else(|| "leader".to_string());

            let background_automation_enabled = config.orchestrator.background_automation_enabled;
            let advisor_agents = config.advisor_agents();
            let mut skipped_projects = Vec::new();
            let mut skipped_advisors = Vec::new();

            // Collect per-project budget ceilings from config.
            let mut project_budgets = std::collections::HashMap::new();
            for project_cfg in &config.agent_spawns {
                if let Some(budget) = project_cfg.max_cost_per_day_usd {
                    project_budgets.insert(project_cfg.name.clone(), budget);
                }
            }

            // Build channels map for the leader agent.
            let channels: Arc<RwLock<HashMap<String, Arc<dyn aeqi_core::traits::Channel>>>> =
                Arc::new(RwLock::new(HashMap::new()));

            // Build agent router for message classification.
            let classifier_api_key = get_api_key(&config).unwrap_or_default();
            let agent_router = Arc::new(tokio::sync::Mutex::new(AgentRouter::new(
                classifier_api_key.clone(),
                config.team.router_cooldown_secs,
            )));

            // Pre-create task notify so the completion listener and leader agent project share it.
            let fa_task_notify: Arc<tokio::sync::Notify> = Arc::new(tokio::sync::Notify::new());

            // Open a single insights DB for the entire daemon.
            let shared_idea_store: Option<Arc<dyn aeqi_core::traits::IdeaStore>> =
                match open_ideas(&config) {
                    Ok(mem) => {
                        info!("idea store initialized (single DB)");
                        Some(Arc::new(mem) as Arc<dyn aeqi_core::traits::IdeaStore>)
                    }
                    Err(e) => {
                        warn!("failed to open idea store: {e}");
                        None
                    }
                };

            let sm_default_project = config
                .agent_spawns
                .first()
                .map(|c| c.name.clone())
                .unwrap_or_default();

            // Open AgentRegistry — required for daemon operation.
            let agent_reg: Arc<aeqi_orchestrator::agent_registry::AgentRegistry> =
                match aeqi_orchestrator::agent_registry::AgentRegistry::open(&config.data_dir()) {
                    Ok(ar) => Arc::new(ar),
                    Err(e) => {
                        anyhow::bail!("failed to open agent registry: {e}");
                    }
                };

            // Create the unified ActivityLog sharing the AgentRegistry DB.
            let activity_log = Arc::new(ActivityLog::new(agent_reg.db()));
            activity_log.set_activity_stream(activity_stream.clone());
            info!("activity log initialized (unified)");

            // Create the SessionStore sharing the AgentRegistry DB (tables
            // already created by AgentRegistry::open -> SessionStore::create_tables).
            let session_store: Option<Arc<SessionStore>> = {
                let ss = Arc::new(SessionStore::new(agent_reg.db()));
                info!("session store initialized (unified)");
                Some(ss)
            };

            // Shared slot for the Scheduler — populated after the scheduler is built,
            // but readable by the telegram message loop for fast-lane commands.
            let shared_scheduler: Arc<std::sync::RwLock<Option<Arc<Scheduler>>>> =
                Arc::new(std::sync::RwLock::new(None));

            // Build the unified MessageRouter.
            let council_advisors: Arc<Vec<aeqi_core::config::PeerAgentConfig>> =
                Arc::new(config.advisor_agents().into_iter().cloned().collect());
            let auto_council_enabled = config.team.max_background_cost_usd > 0.0;
            let message_router = session_store.as_ref().map(|cs| {
                Arc::new(aeqi_orchestrator::MessageRouter {
                    conversations: cs.clone(),
                    agent_registry: agent_reg.clone(),
                    activity_log: activity_log.clone(),
                    agent_router: agent_router.clone(),
                    council_advisors: council_advisors.clone(),
                    auto_council_enabled,
                    leader_name: leader_name.clone(),
                    default_project: sm_default_project.clone(),
                    pending_tasks: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
                    task_notify: fa_task_notify.clone(),
                    idea_store: shared_idea_store.clone(),
                })
            });

            // Shared queue for proactive Telegram messages (morning brief, completion notifications).
            let pending_telegram_messages: Arc<std::sync::Mutex<Vec<(i64, String)>>> =
                Arc::new(std::sync::Mutex::new(Vec::new()));

            // Wire Telegram if configured (single SecretStore open for all bot tokens).
            let mut advisor_bots: HashMap<String, Arc<TelegramChannel>> = HashMap::new();
            if let Some(ref tg_config) = config.channels.telegram {
                let secret_store_path = config
                    .security
                    .secret_store
                    .as_ref()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| config.data_dir().join("secrets"));
                match SecretStore::open(&secret_store_path) {
                    Ok(secret_store) => {
                        // Load advisor Telegram bots (send-only, no polling).
                        for agent_cfg in &advisor_agents {
                            if let Some(ref token_key) = agent_cfg.telegram_token_secret
                                && let Ok(token) = secret_store.get(token_key)
                                && !token.is_empty()
                            {
                                advisor_bots.insert(
                                    agent_cfg.name.clone(),
                                    Arc::new(TelegramChannel::new(
                                        token,
                                        tg_config.allowed_chats.clone(),
                                    )),
                                );
                                info!(agent = %agent_cfg.name, "advisor telegram bot loaded");
                            }
                        }

                        // Load lead bot and start polling.
                        match secret_store.get(&tg_config.token_secret) {
                            Ok(token) if !token.is_empty() => {
                                let tg = Arc::new(TelegramChannel::new(
                                    token,
                                    tg_config.allowed_chats.clone(),
                                ));
                                channels.write().await.insert(
                                    "telegram".to_string(),
                                    tg.clone() as Arc<dyn aeqi_core::traits::Channel>,
                                );

                                // Start polling and route incoming messages through the shared chat engine.
                                match Channel::start(tg.as_ref()).await {
                                    Ok(mut rx) => {
                                        let tg_reply = tg.clone();
                                        match message_router.clone() {
                                            Some(engine) => {
                                                let advisor_bots_outer = advisor_bots.clone();
                                                let debounce_ms = tg_config.debounce_window_ms;
                                                let ptm = pending_telegram_messages.clone();
                                                let eb = activity_stream.clone();
                                                let default_chat = tg_config
                                                    .main_chat_id
                                                    .or_else(|| {
                                                        tg_config.allowed_chats.first().copied()
                                                    })
                                                    .unwrap_or(0);
                                                let telegram_routes = Arc::new(
                                                    tg_config
                                                        .routes
                                                        .iter()
                                                        .cloned()
                                                        .map(|route| (route.chat_id, route))
                                                        .collect(),
                                                );
                                                let tg_scheduler = shared_scheduler.clone();
                                                tokio::spawn(async move {
                                                    telegram_message_loop(
                                                        &mut rx,
                                                        engine,
                                                        tg_reply,
                                                        advisor_bots_outer,
                                                        debounce_ms,
                                                        ptm,
                                                        eb,
                                                        default_chat,
                                                        telegram_routes,
                                                        tg_scheduler,
                                                    )
                                                    .await;
                                                });
                                                info!("Telegram channel active");
                                            }
                                            None => {
                                                warn!(
                                                    "chat engine not initialized; telegram polling disabled"
                                                );
                                            }
                                        }
                                    }
                                    Err(e) => {
                                        warn!(error = %e, "failed to start Telegram polling")
                                    }
                                }
                            }
                            _ => {
                                info!("Telegram token not found in secret store, skipping");
                            }
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "failed to open secret store for Telegram");
                    }
                }
            }

            // Register the leader agent — build orchestration tools for it.
            // Optional — daemon runs fine without a leader agent configured.
            if let Some(leader_cfg) = config.leader_agent().cloned() {
                let fa_agent_dir = find_agent_dir(&leader_name)
                    .unwrap_or_else(|_| PathBuf::from("agents/aurelia"));
                let fa_tasks_dir = fa_agent_dir.join(".tasks");
                std::fs::create_dir_all(&fa_tasks_dir).ok();
                let fa_prefix = leader_cfg.prefix.clone();
                let fa_workdir = leader_cfg
                    .default_repo
                    .as_ref()
                    .map(|r| config.resolve_repo(r))
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

                let mut fa_tools: Vec<Arc<dyn aeqi_core::traits::Tool>> =
                    build_project_tools(&fa_workdir, &fa_tasks_dir, &fa_prefix, None);
                let fa_memory: Option<Arc<dyn aeqi_core::traits::IdeaStore>> =
                    shared_idea_store.clone();
                let default_project = config
                    .agent_spawns
                    .first()
                    .map(|c| c.name.clone())
                    .unwrap_or_default();
                let project_name = config.agent_spawns.first().map(|c| c.name.clone());
                let orch_tools = build_orchestration_tools(
                    leader_name.clone(),
                    default_project.clone(),
                    project_name,
                    activity_log.clone(),
                    channels.clone(),
                    get_api_key(&config).ok(),
                    fa_memory,
                    None,          // graph DB resolved per-session, not at daemon init
                    None,          // session_id resolved per-session, not at daemon init
                    None,          // provider — workers don't need direct session spawning
                    None,          // session_store
                    None,          // session_manager
                    String::new(), // default_model
                    agent_reg.clone(),
                );
                fa_tools.extend(orch_tools);
            } else {
                warn!("no leader agent configured — daemon will run without one");
            }

            println!("AEQI daemon starting...");
            println!("Press Ctrl+C to stop.\n");

            let socket_path = config.data_dir().join("rm.sock");
            println!("PID file: {}", pid_path.display());
            println!("IPC socket: {}", socket_path.display());

            // Reconcile TOML agent configs with DB agents.
            // PeerAgentConfig (TOML) and Agent (DB) are dual systems.
            // This lightweight sync ensures TOML model changes propagate to DB.
            for peer in &config.agents {
                if let Ok(Some(agent)) = agent_reg.get_active_by_name(&peer.name).await
                    && let Some(ref model) = peer.model
                    && agent.model.as_deref() != Some(model)
                {
                    let _ = agent_reg.update_model(&agent.id, model).await;
                }
            }

            // -----------------------------------------------------------
            // Spawn companies as agents in the registry and build the
            // global Scheduler.
            // -----------------------------------------------------------
            let total_max_workers: u32 = config.agent_spawns.iter().map(|c| c.max_workers).sum();

            for project_cfg in &config.agent_spawns {
                let repo_path = config.resolve_repo(&project_cfg.repo);
                // Upsert: reuse existing active agent or spawn a new one.
                let agent = match agent_reg.get_active_by_name(&project_cfg.name).await {
                    Ok(Some(existing)) => existing,
                    _ => {
                        match agent_reg
                            .spawn(
                                &project_cfg.name,
                                None,
                                "company",
                                &format!("Agent for {} repository", project_cfg.name),
                                None, // parent_id — top-level
                                project_cfg.model.as_deref(),
                                &[],
                            )
                            .await
                        {
                            Ok(a) => a,
                            Err(e) => {
                                warn!(
                                    project = %project_cfg.name,
                                    error = %e,
                                    "failed to spawn agent for company, skipping"
                                );
                                skipped_projects.push(project_cfg.name.clone());
                                continue;
                            }
                        }
                    }
                };

                if let Err(e) = agent_reg
                    .update_agent_ops(
                        &agent.id,
                        Some(repo_path.to_str().unwrap_or_default()),
                        project_cfg.max_cost_per_day_usd,
                        Some(match project_cfg.execution_mode {
                            aeqi_core::config::ExecutionMode::Agent => "agent",
                            aeqi_core::config::ExecutionMode::ClaudeCode => "claude_code",
                        }),
                        Some(&project_cfg.prefix),
                        Some(project_cfg.worker_timeout_secs),
                    )
                    .await
                {
                    warn!(
                        project = %project_cfg.name,
                        error = %e,
                        "failed to set operational fields on company agent"
                    );
                } else {
                    info!(
                        project = %project_cfg.name,
                        agent_id = %agent.id,
                        "company agent registered in agent registry"
                    );
                }

                // Sync company identity to the companies table.
                let exec_mode = match project_cfg.execution_mode {
                    aeqi_core::config::ExecutionMode::Agent => "agent",
                    aeqi_core::config::ExecutionMode::ClaudeCode => "claude_code",
                };
                let now = chrono::Utc::now().to_rfc3339();
                let _ = agent_reg
                    .upsert_company_from_toml(&CompanyRecord {
                        name: project_cfg.name.clone(),
                        display_name: None,
                        prefix: project_cfg.prefix.clone(),
                        tagline: None,
                        logo_url: None,
                        primer: project_cfg.primer.clone(),
                        repo: Some(repo_path.to_string_lossy().to_string()),
                        model: project_cfg.model.clone(),
                        max_workers: project_cfg.max_workers,
                        execution_mode: exec_mode.to_string(),
                        worker_timeout_secs: project_cfg.worker_timeout_secs,
                        worktree_root: project_cfg.worktree_root.clone(),
                        max_steps: project_cfg.max_steps,
                        max_budget_usd: project_cfg.max_budget_usd,
                        max_cost_per_day_usd: project_cfg.max_cost_per_day_usd,
                        source: "toml".to_string(),
                        agent_id: Some(agent.id.clone()),
                        created_at: now.clone(),
                        updated_at: now,
                    })
                    .await;
            }

            // Also register advisor + leader agents the same way.
            for agent_cfg in &advisor_agents {
                let agent_workdir = agent_cfg
                    .default_repo
                    .as_ref()
                    .map(|r| config.resolve_repo(r))
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
                let agent = match agent_reg.get_active_by_name(&agent_cfg.name).await {
                    Ok(Some(existing)) => existing,
                    _ => {
                        match agent_reg
                            .spawn(
                                &agent_cfg.name,
                                None,
                                "advisor",
                                &format!("Advisor agent: {}", agent_cfg.name),
                                None,
                                agent_cfg.model.as_deref(),
                                &[],
                            )
                            .await
                        {
                            Ok(a) => a,
                            Err(e) => {
                                warn!(
                                    agent = %agent_cfg.name,
                                    error = %e,
                                    "failed to spawn advisor agent in registry"
                                );
                                skipped_advisors.push(agent_cfg.name.clone());
                                continue;
                            }
                        }
                    }
                };
                let _ = agent_reg
                    .update_agent_ops(
                        &agent.id,
                        Some(agent_workdir.to_str().unwrap_or_default()),
                        agent_cfg.max_budget_usd,
                        None,
                        Some(&agent_cfg.prefix),
                        Some(300), // 5 min advisor timeout
                    )
                    .await;
            }

            // Import agent identity prompts into the prompt store as managed prompts.
            // This makes the DB authoritative — .md files are import format only.
            // If the .md content changed since last import, the prompt is updated.
            for agent_cfg in &advisor_agents {
                if agent_reg.get_active_by_name(&agent_cfg.name).await.ok().flatten().is_some() {
                    if let Some(ref prompt_cfg) = agent_cfg.prompt {
                        let identity_content = &prompt_cfg.system;
                        if !identity_content.is_empty() {
                            let source_ref = format!("agent:{}", agent_cfg.name);
                            let _ = agent_reg
                                .upsert_managed_prompt(
                                    &format!("{}-identity", agent_cfg.name),
                                    identity_content,
                                    &["identity".to_string()],
                                    "system",
                                    "self",
                                    &[],
                                    &[],
                                    "agent-template",
                                    &source_ref,
                                )
                                .await;
                        }
                    }
                }
            }

            // Build the global Scheduler.
            let scheduler_config = SchedulerConfig {
                max_workers: total_max_workers.max(4),
                default_timeout_secs: 3600,
                worker_max_budget_usd: config
                    .agent_spawns
                    .first()
                    .and_then(|c| c.max_budget_usd)
                    .unwrap_or(5.0),
                prompt_dirs: {
                    let mut dirs = Vec::new();
                    for project_cfg in &config.agent_spawns {
                        if let Ok(d) = find_project_dir(&project_cfg.name) {
                            dirs.push(d.join("skills"));
                            if let Some(parent) = d.parent() {
                                dirs.push(parent.join("shared").join("skills"));
                            }
                        }
                    }
                    dirs
                },
                shared_primer: config.shared_primer.clone(),
                reflect_model: config
                    .default_model_for_provider(aeqi_core::config::ProviderKind::OpenRouter),
                adaptive_retry: config.orchestrator.adaptive_retry,
                failure_analysis_model: config.orchestrator.failure_analysis_model.clone(),
                max_task_retries: config.orchestrator.max_task_retries,
                daily_budget_usd,
            };

            // Build a default provider for the scheduler. Prefer the first configured
            // company, but fall back to the runtime's default provider so dynamically
            // created root-runtime companies can still execute sessions.
            let default_provider: Option<Arc<dyn aeqi_core::traits::Provider>> =
                if let Some(first) = config.agent_spawns.first() {
                    match build_provider_for_project(&config, &first.name) {
                        Ok(p) => Some(p),
                        Err(e) => {
                            warn!(error = %e, "failed to build default session provider");
                            None
                        }
                    }
                } else if let Some(provider_kind) = config.default_provider_kind() {
                    let model = config.default_model_for_provider(provider_kind);
                    match build_provider_for_runtime(&config, provider_kind, Some(&model)) {
                        Ok(p) => Some(p),
                        Err(e) => {
                            warn!(error = %e, "failed to build runtime default provider");
                            None
                        }
                    }
                } else {
                    None
                };
            let default_model = config
                .agent_spawns
                .first()
                .map(|c| config.model_for_company(&c.name))
                .or_else(|| {
                    config
                        .default_provider_kind()
                        .map(|provider_kind| config.default_model_for_provider(provider_kind))
                })
                .unwrap_or_default();

            let scheduler_provider: Arc<dyn aeqi_core::traits::Provider> = if let Some(first) =
                config.agent_spawns.first()
            {
                match build_provider_for_project(&config, &first.name) {
                    Ok(p) => p,
                    Err(e) => {
                        warn!(error = %e, "scheduler: failed to build provider, using default");
                        match default_provider.clone() {
                            Some(p) => p,
                            None => {
                                warn!(
                                    "no provider available — scheduler will not process agent tasks"
                                );
                                Arc::new(aeqi_providers::noop::NoopProvider)
                            }
                        }
                    }
                }
            } else {
                match default_provider.clone() {
                    Some(p) => p,
                    None => {
                        warn!("no provider available — scheduler will not process agent tasks");
                        Arc::new(aeqi_providers::noop::NoopProvider)
                    }
                }
            };

            // Collect base tools for the scheduler (union of project tools).
            let scheduler_tools: Vec<Arc<dyn aeqi_core::traits::Tool>> =
                if let Some(first) = config.agent_spawns.first() {
                    let workdir = config.resolve_repo(&first.repo);
                    build_tools(&workdir)
                } else {
                    Vec::new()
                };

            let metrics = Arc::new(AEQIMetrics::new());

            // Create and configure SessionManager BEFORE sharing it with scheduler.
            let mut session_manager = SessionManager::new();
            if let Some(ref ss) = session_store {
                let sm_default_project = config
                    .agent_spawns
                    .first()
                    .map(|c| c.name.clone())
                    .unwrap_or_default();
                session_manager.configure(
                    agent_reg.clone(),
                    ss.clone(),
                    default_model.clone(),
                    Some(activity_stream.clone()),
                    activity_log.clone(),
                    shared_idea_store.clone(),
                    sm_default_project,
                    config.shared_primer.clone(),
                    config.agent_spawns.first().and_then(|c| c.primer.clone()),
                );
                info!("session manager configured for spawn_session");
            }
            let session_manager = Arc::new(session_manager);

            let scheduler = Scheduler::new(
                scheduler_config,
                agent_reg.clone(),
                scheduler_provider,
                scheduler_tools,
                metrics.clone(),
                activity_stream.clone(),
                activity_log.clone(),
            );

            // Wire optional services into the scheduler.
            let scheduler = {
                let mut s = scheduler;
                s.session_store = session_store.clone();
                let trigger_store = Arc::new(agent_reg.trigger_store());
                s.trigger_store = Some(trigger_store.clone());
                // Wire memory for the scheduler (shared single store).
                s.idea_store = shared_idea_store.clone();
                // Wire session manager for session resolution on task completion.
                s.session_manager = Some(session_manager.clone());
                Arc::new(s)
            };

            // Construct the daemon — use the shared session_manager.
            let mut daemon =
                Daemon::new(metrics, scheduler.clone(), agent_reg.clone(), activity_log);
            daemon.session_manager = session_manager;
            daemon.session_store = session_store.clone();
            daemon.leader_agent_name = leader_name.clone();
            // Import primers into prompt store (DB-first — primers are just prompts
            // with position=prepend, scope=descendants).
            if let Some(ref primer_text) = config.shared_primer {
                let _ = agent_reg
                    .create_prompt_full(
                        "shared-primer",
                        primer_text,
                        &["primer".to_string(), "shared".to_string()],
                        "prepend",
                        "descendants",
                        &[],
                        &[],
                    )
                    .await;
            }
            if let Some(ref project_primer) = config.agent_spawns.first().and_then(|c| c.primer.clone()) {
                let project_name = config.agent_spawns.first().map(|c| c.name.as_str()).unwrap_or("default");
                let _ = agent_reg
                    .create_prompt_full(
                        &format!("{project_name}-primer"),
                        project_primer,
                        &["primer".to_string(), project_name.to_string()],
                        "prepend",
                        "descendants",
                        &[],
                        &[],
                    )
                    .await;
            }
            // Still set in-memory primers for backward compat during migration.
            daemon.shared_primer = config.shared_primer.clone();
            daemon.project_primer = config.agent_spawns.first().and_then(|c| c.primer.clone());
            daemon.activity_stream = activity_stream;
            daemon.message_router = message_router;
            daemon.default_provider = default_provider;
            daemon.default_model = default_model;
            daemon.daily_budget_usd = daily_budget_usd;
            daemon.project_budgets = project_budgets;

            // Prompt loader for session-time skill resolution (disk fallback).
            // No auto-import — ideas come from the platform's global template store.
            let prompt_loader = Arc::new(aeqi_orchestrator::PromptLoader::from_cwd());
            daemon.prompt_loader = Some(prompt_loader.clone());
            if let Some(sm) = Arc::get_mut(&mut daemon.session_manager) {
                sm.set_prompt_loader(prompt_loader);
            }

            // Set up trigger store (legacy — being replaced by events).
            let trigger_store = Arc::new(agent_reg.trigger_store());
            let trigger_count = trigger_store.count_enabled().await.unwrap_or(0);
            println!("Triggers: {trigger_count} enabled (legacy)");
            daemon.set_trigger_store(trigger_store.clone());

            // Set up event handler store (the fourth primitive).
            let event_handler_store = Arc::new(aeqi_orchestrator::EventHandlerStore::new(agent_reg.db()));
            let event_count = event_handler_store.count_enabled().await.unwrap_or(0);
            println!("Events: {event_count} enabled");
            daemon.event_handler_store = Some(event_handler_store);

            daemon.set_readiness_context(
                config.agent_spawns.len(),
                advisor_agents.len(),
                skipped_projects,
                skipped_advisors,
            );
            daemon.set_background_automation_enabled(background_automation_enabled);
            daemon.set_pid_file(pid_path);
            daemon.set_socket_path(socket_path.clone());

            // Publish the scheduler into the shared slot so the
            // telegram message loop can use it for fast-lane commands.
            if let Ok(mut guard) = shared_scheduler.write() {
                *guard = Some(scheduler);
            }

            info!(total_max_workers, "global scheduler initialized");

            // SessionManager was already configured before Arc::new() above.
            daemon.run().await?;
        }

        DaemonAction::Install { start, force } => {
            let (_, path) = load_config(config_path)?;
            let (unit_path, warnings) = install_user_service(&path, start, force)?;
            println!("Installed daemon service: {}", unit_path.display());
            for warning in warnings {
                println!("[WARN] {warning}");
            }
            if start {
                println!("Requested service start for aeqi.service");
            } else {
                println!("Run `systemctl --user start aeqi.service` to start it.");
            }
        }

        DaemonAction::PrintService => {
            let (_, path) = load_config(config_path)?;
            println!("{}", render_user_service(&path)?);
        }

        DaemonAction::Stop => {
            let (config, _) = load_config(config_path)?;
            let pid_path = pid_file_path(&config);

            if !pid_path.exists() {
                println!("No daemon running (no PID file).");
                return Ok(());
            }

            let pid_str = std::fs::read_to_string(&pid_path)?;
            let pid: u32 = pid_str.trim().parse().context("invalid PID file")?;

            // Send SIGTERM.
            #[cfg(unix)]
            {
                use std::process::Command;
                let status = Command::new("kill").arg(pid.to_string()).status()?;
                if status.success() {
                    println!("Sent SIGTERM to daemon (PID {pid}).");
                    // Wait briefly for PID file cleanup.
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    if pid_path.exists() {
                        let _ = std::fs::remove_file(&pid_path);
                    }
                } else {
                    println!("Failed to stop daemon (PID {pid}).");
                }
            }
            #[cfg(not(unix))]
            {
                println!(
                    "Daemon stop not supported on this platform. Remove {} manually.",
                    pid_path.display()
                );
            }
        }

        DaemonAction::Uninstall { stop } => {
            let (unit_path, warnings) = uninstall_user_service(stop)?;
            match unit_path {
                Some(path) => println!("Removed daemon service: {}", path.display()),
                None => println!("Daemon service file was not installed."),
            }
            for warning in warnings {
                println!("[WARN] {warning}");
            }
        }

        DaemonAction::Status => {
            let (config, _) = load_config(config_path)?;
            let pid_path = pid_file_path(&config);

            if Daemon::is_running_from_pid(&pid_path) {
                let pid = std::fs::read_to_string(&pid_path)?.trim().to_string();
                println!("Daemon: RUNNING (PID {pid})");
            } else {
                println!("Daemon: NOT RUNNING");
                if pid_path.exists() {
                    println!(
                        "  (stale PID file: {} — run `aeqi daemon stop` to clean up)",
                        pid_path.display()
                    );
                }
            }

            // Also show project summary.
            crate::cmd::status::cmd_status(config_path).await?;
        }

        DaemonAction::Query { cmd } => {
            let response =
                daemon_ipc_request(config_path, &serde_json::json!({ "cmd": cmd })).await?;
            println!("{}", serde_json::to_string_pretty(&response)?);
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn telegram_message_loop(
    rx: &mut tokio::sync::mpsc::Receiver<aeqi_core::traits::IncomingMessage>,
    engine: Arc<aeqi_orchestrator::MessageRouter>,
    tg_reply: Arc<TelegramChannel>,
    _advisor_bots: HashMap<String, Arc<TelegramChannel>>,
    debounce_ms: u64,
    pending_telegram_messages: Arc<std::sync::Mutex<Vec<(i64, String)>>>,
    activity_stream: Arc<aeqi_orchestrator::ActivityStream>,
    default_chat_id: i64,
    telegram_routes: Arc<HashMap<i64, TelegramChatRouteConfig>>,
    shared_scheduler: Arc<std::sync::RwLock<Option<Arc<Scheduler>>>>,
) {
    struct BufferedMsg {
        text: String,
        sender: String,
        message_id: i64,
    }

    // Completion listener: polls MessageRouter for completed tasks, delivers via Telegram.
    // Also drains proactive messages (morning brief, completion notifications) from the daemon.
    {
        let engine_cl = engine.clone();
        let tg_deliver = tg_reply.clone();
        let notify = engine.task_notify.clone();
        let ptm = pending_telegram_messages.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = notify.notified() => {}
                    _ = tokio::time::sleep(std::time::Duration::from_secs(30)) => {}
                }

                // Drain and deliver proactive messages from the daemon (morning brief, etc.).
                {
                    let messages: Vec<(i64, String)> = if let Ok(mut queue) = ptm.lock() {
                        queue.drain(..).collect()
                    } else {
                        Vec::new()
                    };
                    for (chat_id, text) in messages {
                        let out = aeqi_core::traits::OutgoingMessage {
                            channel: "telegram".to_string(),
                            recipient: String::new(),
                            text,
                            metadata: serde_json::json!({ "chat_id": chat_id }),
                        };
                        if let Err(e) = tg_deliver.send(out).await {
                            warn!(error = %e, "failed to deliver proactive telegram message");
                        }
                    }
                }

                // Check for slow tasks (> 2min) and send progress.
                for (_qid, chat_id, message_id, _source) in engine_cl.get_slow_tasks().await {
                    if message_id > 0 {
                        let _ = tg_deliver.react(chat_id, message_id, "\u{23f3}").await;
                    }
                    let _ = tg_deliver.send_typing(chat_id).await;
                }

                // Check for completed tasks and deliver replies.
                for completion in engine_cl.check_completions().await {
                    let emoji = match completion.status {
                        aeqi_orchestrator::message_router::CompletionStatus::Done => "\u{1f44d}",
                        aeqi_orchestrator::message_router::CompletionStatus::Blocked => "\u{2753}",
                        aeqi_orchestrator::message_router::CompletionStatus::Cancelled => {
                            "\u{274c}"
                        }
                        aeqi_orchestrator::message_router::CompletionStatus::TimedOut => {
                            "\u{1f622}"
                        }
                    };
                    let out = aeqi_core::traits::OutgoingMessage {
                        channel: "telegram".to_string(),
                        recipient: String::new(),
                        text: completion.text,
                        metadata: serde_json::json!({ "chat_id": completion.chat_id }),
                    };
                    if let Err(e) = tg_deliver.send(out).await {
                        warn!(error = %e, "failed to deliver telegram reply");
                    }
                    if completion.message_id > 0 {
                        let _ = tg_deliver
                            .react(completion.chat_id, completion.message_id, emoji)
                            .await;
                    }
                }
            }
        });
    }

    // Proactive completion notifier: sends Telegram notifications for non-user-initiated tasks
    // (cron jobs, watchdog tasks, proactive engine tasks) when they complete.
    if default_chat_id != 0 {
        let tg_notify = tg_reply.clone();
        let engine_pending = engine.clone();
        let mut event_rx = activity_stream.subscribe();
        tokio::spawn(async move {
            loop {
                match event_rx.recv().await {
                    Ok(aeqi_orchestrator::Activity::QuestCompleted {
                        quest_id,
                        outcome,
                        cost_usd,
                        ..
                    }) => {
                        // Only notify for tasks NOT originated from a user chat message.
                        let is_user_task = {
                            let pending = engine_pending.pending_tasks.lock().await;
                            pending.contains_key(&quest_id)
                        };
                        if !is_user_task {
                            let summary = if outcome.len() > 80 {
                                format!("{}...", &outcome[..77])
                            } else {
                                outcome
                            };
                            let text = format!(
                                "\u{2713} Task {} completed: {} [${:.2}]",
                                quest_id, summary, cost_usd
                            );
                            let out = aeqi_core::traits::OutgoingMessage {
                                channel: "telegram".to_string(),
                                recipient: String::new(),
                                text,
                                metadata: serde_json::json!({ "chat_id": default_chat_id }),
                            };
                            if let Err(e) = tg_notify.send(out).await {
                                warn!(error = %e, "failed to send proactive completion notification");
                            }
                        }
                    }
                    Ok(_) => {} // Ignore other event types.
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!(missed = n, "proactive notifier lagged behind event stream");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    let debounce_window = std::time::Duration::from_millis(debounce_ms);
    let mut chat_buffers: HashMap<i64, Vec<BufferedMsg>> = HashMap::new();
    let mut chat_deadlines: HashMap<i64, tokio::time::Instant> = HashMap::new();

    loop {
        let next_flush = chat_deadlines.values().min().cloned();

        tokio::select! {
            biased;

            msg = rx.recv() => {
                let Some(msg) = msg else { break; };
                let chat_id = msg.metadata.get("chat_id")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                let message_id = msg.metadata.get("message_id")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);

                chat_buffers.entry(chat_id).or_default().push(BufferedMsg {
                    text: msg.text,
                    sender: msg.sender,
                    message_id,
                });

                let deadline = tokio::time::Instant::now() + debounce_window;
                chat_deadlines.insert(chat_id, deadline);
            }

            _ = async {
                match next_flush {
                    Some(d) => tokio::time::sleep_until(d).await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                let now = tokio::time::Instant::now();
                let expired: Vec<i64> = chat_deadlines.iter()
                    .filter(|(_, d)| **d <= now)
                    .map(|(id, _)| *id)
                    .collect();

                for chat_id in expired {
                    chat_deadlines.remove(&chat_id);
                    let Some(messages) = chat_buffers.remove(&chat_id) else { continue; };
                    if messages.is_empty() { continue; }

                    let msg_count = messages.len();
                    let last_message_id = messages.last().map(|m| m.message_id).unwrap_or(0);
                    let sender = messages.last().map(|m| m.sender.clone()).unwrap_or_default();

                    if msg_count > 1 {
                        info!(chat_id, count = msg_count, "coalesced messages");
                    }

                    let user_text = if messages.len() == 1 {
                        messages.into_iter().next().unwrap().text
                    } else {
                        messages.iter().enumerate()
                            .map(|(i, m)| format!("[{}]: {}", i + 1, m.text))
                            .collect::<Vec<_>>()
                            .join("\n")
                    };
                    let message_id = last_message_id;
                    let route = resolve_telegram_route(&telegram_routes, chat_id);
                    let project_hint = route.as_ref().and_then(|route| route.project.clone());
                    let channel_name = route.as_ref().and_then(|route| route.name.clone());

                    // === Fast-Lane ===
                    if user_text.starts_with("/status")
                        || user_text.starts_with("/help")
                        || user_text.starts_with("/cost")
                    {
                        let tg_fast = tg_reply.clone();
                        let fast_engine = engine.clone();
                        let fast_text = user_text.clone();
                        let fast_sender = sender.clone();
                        let fast_project = project_hint.clone();
                        let fast_channel = channel_name.clone();
                        let fast_scheduler = shared_scheduler.read().ok().and_then(|g| g.clone());
                        tokio::spawn(async move {
                            let reply = if let Some(ref sched) = fast_scheduler {
                                handle_fast_lane(&fast_text, sched).await
                            } else {
                                "Scheduler not yet initialized.".to_string()
                            };
                            let chat_msg = aeqi_orchestrator::message_router::IncomingMessage {
                                message: fast_text,
                                chat_id,
                                sender: fast_sender,
                                source: aeqi_orchestrator::message_router::MessageSource::Telegram {
                                    message_id,
                                },
                                project_hint: fast_project,
                                channel_name: fast_channel,
                                agent_id: None,
                            };
                            fast_engine.record_exchange(&chat_msg, &reply).await;
                            let out = aeqi_core::traits::OutgoingMessage {
                                channel: "telegram".to_string(),
                                recipient: String::new(),
                                text: reply,
                                metadata: serde_json::json!({ "chat_id": chat_id }),
                            };
                            if let Err(e) = tg_fast.send(out).await {
                                warn!(error = %e, "failed to send fast-lane reply");
                            }
                            if message_id > 0 {
                                let _ = tg_fast.react(chat_id, message_id, "\u{26a1}").await;
                            }
                        });
                        continue;
                    }

                    // === Quick intent check ===
                    let chat_msg = aeqi_orchestrator::message_router::IncomingMessage {
                        message: user_text.clone(),
                        chat_id,
                        sender: sender.clone(),
                        source: aeqi_orchestrator::message_router::MessageSource::Telegram { message_id },
                        project_hint: project_hint.clone(),
                        channel_name: channel_name.clone(),
                        agent_id: None,
                    };

                    if let Some(response) = engine.handle_message(&chat_msg).await {
                        // Intent matched (create task, close task, etc.) — send reply directly.
                        let tg_intent = tg_reply.clone();
                        tokio::spawn(async move {
                            let out = aeqi_core::traits::OutgoingMessage {
                                channel: "telegram".to_string(),
                                recipient: String::new(),
                                text: response.context.clone(),
                                metadata: serde_json::json!({ "chat_id": chat_id }),
                            };
                            let _ = tg_intent.send(out).await;
                            if message_id > 0 {
                                let _ = tg_intent.react(chat_id, message_id, "\u{2705}").await;
                            }
                        });
                        continue;
                    }

                    // === Full pipeline: unified chat task ===
                    let engine2 = engine.clone();
                    let tg2 = tg_reply.clone();

                    tokio::spawn(async move {
                        let _ = tg2.send_typing(chat_id).await;
                        let chat_msg = aeqi_orchestrator::message_router::IncomingMessage {
                            message: user_text,
                            chat_id,
                            sender,
                            source: aeqi_orchestrator::message_router::MessageSource::Telegram { message_id },
                            project_hint,
                            channel_name,
                            agent_id: None,
                        };

                        match engine2.handle_message_full(&chat_msg, None).await {
                            Ok(handle) => {
                                info!(task = %handle.quest_id, "telegram message -> task created");
                            }
                            Err(e) => {
                                warn!(error = %e, "failed to process telegram message");
                                let out = aeqi_core::traits::OutgoingMessage {
                                    channel: "telegram".to_string(),
                                    recipient: String::new(),
                                    text: format!("Error: {}", e),
                                    metadata: serde_json::json!({ "chat_id": chat_id }),
                                };
                                let _ = tg2.send(out).await;
                            }
                        }
                    });
                }
            }
        }
    }
}

fn resolve_telegram_route(
    routes: &HashMap<i64, TelegramChatRouteConfig>,
    chat_id: i64,
) -> Option<TelegramChatRouteConfig> {
    let route = routes.get(&chat_id).cloned()?;
    Some(route)
}
