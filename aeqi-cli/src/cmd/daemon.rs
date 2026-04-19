use aeqi_core::SecretStore;
use aeqi_orchestrator::{
    AEQIMetrics, ActivityLog, AgentRouter, Daemon, GatewayManager, Scheduler, SchedulerConfig,
    SessionManager, SessionStore,
};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

use crate::cli::DaemonAction;
use crate::helpers::{
    build_provider_for_project, build_provider_for_runtime, build_tools, daemon_ipc_request,
    get_api_key, load_config, load_config_with_agents, open_ideas, pid_file_path,
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
            let root_agent_name = config
                .root_agent()
                .map(|a| a.name.clone())
                .unwrap_or_default();

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

            // Build agent router for message classification.
            let classifier_api_key = get_api_key(&config).unwrap_or_default();
            let agent_router = Arc::new(tokio::sync::Mutex::new(AgentRouter::new(
                classifier_api_key.clone(),
                config.team.router_cooldown_secs,
            )));

            // Pre-create task notify so the completion listener and root agent project share it.
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

            // Create the unified ActivityLog using the sessions DB (journal).
            let activity_log = Arc::new(ActivityLog::new(agent_reg.sessions_db()));
            info!("activity log initialized (sessions.db)");

            // Create the SessionStore using the sessions DB (journal).
            let session_store: Option<Arc<SessionStore>> = {
                let ss = Arc::new(SessionStore::new(agent_reg.sessions_db()));
                info!("session store initialized (sessions.db)");
                Some(ss)
            };

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
                    default_agent_name: root_agent_name.clone(),
                    default_project: sm_default_project.clone(),
                    pending_tasks: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
                    task_notify: fa_task_notify.clone(),
                    idea_store: shared_idea_store.clone(),
                })
            });

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
            // Spawn root agents in the registry and build the
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
                            .spawn(&project_cfg.name, None, None, project_cfg.model.as_deref())
                            .await
                        {
                            Ok(a) => a,
                            Err(e) => {
                                warn!(
                                    project = %project_cfg.name,
                                    error = %e,
                                    "failed to spawn root agent, skipping"
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
                        "failed to set operational fields on root agent"
                    );
                } else {
                    info!(
                        project = %project_cfg.name,
                        agent_id = %agent.id,
                        "root agent registered in agent registry"
                    );
                }
            }

            // Also register advisor agents the same way.
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
                            .spawn(&agent_cfg.name, None, None, agent_cfg.model.as_deref())
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

            // Agent identity prompts are now managed via ideas.db — prompt store import removed.

            // Build the global Scheduler.
            let scheduler_config = SchedulerConfig {
                max_workers: total_max_workers.max(4),
                default_timeout_secs: 3600,
                worker_max_budget_usd: config
                    .agent_spawns
                    .first()
                    .and_then(|c| c.max_budget_usd)
                    .unwrap_or(5.0),
                reflect_model: config
                    .default_model_for_provider(aeqi_core::config::ProviderKind::OpenRouter),
                adaptive_retry: config.orchestrator.adaptive_retry,
                failure_analysis_model: config.orchestrator.failure_analysis_model.clone(),
                max_task_retries: config.orchestrator.max_task_retries,
                daily_budget_usd,
            };

            // Build a default provider for the scheduler. Prefer the first configured
            // root agent, but fall back to the runtime's default provider so dynamically
            // created root agents can still execute sessions.
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
                .map(|c| config.model_for_project(&c.name))
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

            // Build tools against the first configured agent_spawn's repo, or
            // fall back to the daemon's current working directory. Shipping
            // workers with an empty tool set leaves the LLM unable to read or
            // write files — the exact kind of opinionated-runtime leak Track E
            // hunts for.
            let scheduler_tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = {
                let workdir = config
                    .agent_spawns
                    .first()
                    .map(|first| config.resolve_repo(&first.repo))
                    .unwrap_or_else(|| {
                        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
                    });
                build_tools(&workdir)
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
                );
                session_manager.set_data_dir(config.data_dir());
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
            if let Some(ref ss) = session_store {
                daemon.gateway_manager =
                    Arc::new(GatewayManager::new().with_session_store(ss.clone()));
            }
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

            // Set up event handler store (the fourth primitive).
            let event_handler_store =
                Arc::new(aeqi_orchestrator::EventHandlerStore::new(agent_reg.db()));

            // Wire event store into session manager for event-driven idea assembly.
            if let Some(sm) = Arc::get_mut(&mut daemon.session_manager) {
                sm.set_event_store(event_handler_store.clone());
            }

            // Seed the 8 global lifecycle events (agent_id NULL). Every agent
            // inherits them through the event store's global-fallback queries.
            // Refreshes tool_calls on every boot so code is the source of truth.
            if let Err(e) = aeqi_orchestrator::event_handler::create_default_lifecycle_events(
                &event_handler_store,
            )
            .await
            {
                warn!(error = %e, "failed to seed global lifecycle events");
            }

            // Seed the 4 middleware patterns (loop:detected, guardrail:violation,
            // graph_guardrail:high_impact, shell:command_failed) as operator-visible
            // events. Idempotent — skips patterns that already have a global row.
            match aeqi_orchestrator::event_handler::seed_lifecycle_events(&event_handler_store)
                .await
            {
                Ok(n) if n > 0 => {
                    info!(n, "seeded {n} lifecycle+middleware events");
                }
                Err(e) => {
                    warn!(error = %e, "failed to seed middleware events");
                }
                _ => {}
            }

            let event_count = event_handler_store.count_enabled().await.unwrap_or(0);
            println!("Events: {event_count} enabled");
            daemon.event_handler_store = Some(event_handler_store);
            daemon.idea_store = shared_idea_store.clone();

            daemon.set_readiness_context(
                config.agent_spawns.len(),
                advisor_agents.len(),
                skipped_projects,
                skipped_advisors,
            );
            daemon.set_background_automation_enabled(background_automation_enabled);
            daemon.set_pid_file(pid_path);
            daemon.set_socket_path(socket_path.clone());

            info!(total_max_workers, "global scheduler initialized");

            let channel_store = Arc::new(aeqi_orchestrator::ChannelStore::new(agent_reg.db()));

            let spawn_ctx = crate::cmd::channel_gateways::SpawnContext {
                session_manager: daemon.session_manager.clone(),
                agent_registry: agent_reg.clone(),
                default_provider: daemon.default_provider.clone(),
                session_store: daemon.session_store.clone(),
                gateway_manager: daemon.gateway_manager.clone(),
            };
            let mut gateway_count = 0u32;
            match channel_store.list_enabled().await {
                Ok(channels) => {
                    for ch in channels {
                        if crate::cmd::channel_gateways::dispatch(ch, &spawn_ctx) {
                            gateway_count += 1;
                        }
                    }
                }
                Err(e) => {
                    warn!(error = %e, "failed to list channels");
                }
            }

            // Legacy fallback: if [channels.telegram] is configured in aeqi.toml,
            // start a single gateway bound to the root agent.
            if gateway_count == 0
                && let Some(ref tg_config) = config.channels.telegram
            {
                let secret_store_path = config
                    .security
                    .secret_store
                    .as_ref()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| config.data_dir().join("secrets"));
                match SecretStore::open(&secret_store_path) {
                    Ok(secret_store) => {
                        match secret_store.get(&tg_config.token_secret) {
                            Ok(token) if !token.is_empty() => {
                                // Resolve root agent for legacy binding.
                                let root_agent_id = match agent_reg.get_root_agent().await {
                                    Ok(Some(a)) => a.id,
                                    _ => {
                                        // Fall back to first configured root agent.
                                        config
                                            .agent_spawns
                                            .first()
                                            .map(|c| c.name.clone())
                                            .unwrap_or_else(|| "root".to_string())
                                    }
                                };
                                crate::cmd::channel_gateways::telegram::spawn_legacy_telegram_gateway(
                                    root_agent_id,
                                    token,
                                    tg_config.allowed_chats.clone(),
                                    spawn_ctx.clone(),
                                );
                            }
                            _ => {
                                info!(
                                    "Telegram token not found in secret store, skipping legacy gateway"
                                );
                            }
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "failed to open secret store for legacy Telegram");
                    }
                }
            }
            // ── Auto-index code graphs on startup ──
            // Trigger incremental indexing for each configured project repo
            // in a background task so it doesn't block daemon startup.
            {
                let graph_dir = config.data_dir().join("codegraph");
                let _ = std::fs::create_dir_all(&graph_dir);
                for project_cfg in &config.agent_spawns {
                    let repo_path = config.resolve_repo(&project_cfg.repo);
                    let db_path = graph_dir.join(format!("{}.db", project_cfg.name));
                    let project_name = project_cfg.name.clone();
                    tokio::spawn(async move {
                        match tokio::task::spawn_blocking(move || {
                            let store = aeqi_graph::GraphStore::open(&db_path)?;
                            let indexer = aeqi_graph::Indexer::new();
                            indexer.index_incremental(&repo_path, &store)
                        })
                        .await
                        {
                            Ok(Ok(result)) => {
                                info!(
                                    project = %project_name,
                                    files = result.files_parsed,
                                    nodes = result.nodes,
                                    edges = result.edges,
                                    "code graph auto-indexed on startup"
                                );
                            }
                            Ok(Err(e)) => {
                                warn!(
                                    project = %project_name,
                                    error = %e,
                                    "code graph auto-index failed"
                                );
                            }
                            Err(e) => {
                                warn!(
                                    project = %project_name,
                                    error = %e,
                                    "code graph auto-index task panicked"
                                );
                            }
                        }
                    });
                }
            }

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
