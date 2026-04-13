use aeqi_core::SecretStore;
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
use tracing::{info, warn};

use crate::cli::DaemonAction;
use crate::helpers::{
    build_project_tools, build_provider_for_project, build_provider_for_runtime, build_tools,
    daemon_ipc_request,
    get_api_key, load_config,
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
                    leader_name: leader_name.clone(),
                    default_project: sm_default_project.clone(),
                    pending_tasks: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
                    task_notify: fa_task_notify.clone(),
                    idea_store: shared_idea_store.clone(),
                })
            });

            // Register the leader agent — build orchestration tools for it.
            // Optional — daemon runs fine without a leader agent configured.
            if let Some(leader_cfg) = config.leader_agent().cloned() {
                let fa_workdir = leader_cfg
                    .default_repo
                    .as_ref()
                    .map(|r| config.resolve_repo(r))
                    .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

                let mut fa_tools: Vec<Arc<dyn aeqi_core::traits::Tool>> =
                    build_project_tools(&fa_workdir, None);
                let fa_memory: Option<Arc<dyn aeqi_core::traits::IdeaStore>> =
                    shared_idea_store.clone();
                let orch_tools = build_orchestration_tools(
                    leader_name.clone(),
                    activity_log.clone(),
                    get_api_key(&config).ok(),
                    fa_memory,
                    None, // graph DB resolved per-session, not at daemon init
                    None, // session_store
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
                                None,
                                project_cfg.model.as_deref(),
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
                                None,
                                agent_cfg.model.as_deref(),
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
            // Primers are now seeded via ideas.db — prompt store import removed.
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

            // Set up event handler store (the fourth primitive).
            let event_handler_store = Arc::new(aeqi_orchestrator::EventHandlerStore::new(agent_reg.db()));

            // Wire event store into session manager for event-driven idea assembly.
            if let Some(sm) = Arc::get_mut(&mut daemon.session_manager) {
                sm.set_event_store(event_handler_store.clone());
            }

            // Seed default lifecycle events for existing agents that have none.
            // create_default_lifecycle_events is idempotent — only runs if 0 events exist.
            if let Ok(agents) = agent_reg.list_active().await {
                for agent in &agents {
                    let existing = event_handler_store.list_for_agent(&agent.id).await.unwrap_or_default();
                    if existing.is_empty() {
                        if let Err(e) = aeqi_orchestrator::event_handler::create_default_lifecycle_events(
                            &event_handler_store,
                            &agent.id,
                        ).await {
                            warn!(agent = %agent.name, error = %e, "failed to seed lifecycle events");
                        } else {
                            info!(agent = %agent.name, "seeded default lifecycle events");
                        }
                    }
                }
            }

            // Seed lifecycle events for all active agents that don't have the full set.
            if let Ok(agents) = agent_reg.list_active().await {
                for agent in &agents {
                    let existing = event_handler_store.list_for_agent(&agent.id).await.unwrap_or_default();
                    if existing.len() < 12 {
                        let _ = aeqi_orchestrator::event_handler::create_default_lifecycle_events(
                            &event_handler_store,
                            &agent.id,
                        ).await;
                    }
                }
            }

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

            info!(total_max_workers, "global scheduler initialized");

            // ── Agent-driven Telegram gateways ──
            // Scan all agents' ideas for `channel:telegram` configs.
            // Each config contains {token, allowed_chats} and binds a poller
            // to that agent.
            let mut tg_gateway_count = 0u32;
            if let Some(ref idea_store) = shared_idea_store {
                match idea_store.search_by_prefix("channel:telegram", 100) {
                    Ok(ideas) => {
                        for idea in ideas {
                            let Some(ref owner_agent_id) = idea.agent_id else {
                                warn!(key = %idea.key, "channel:telegram idea has no agent_id, skipping");
                                continue;
                            };
                            let tg_cfg: serde_json::Value = match serde_json::from_str(&idea.content) {
                                Ok(v) => v,
                                Err(e) => {
                                    warn!(key = %idea.key, error = %e, "invalid JSON in channel:telegram idea");
                                    continue;
                                }
                            };
                            let token = match tg_cfg.get("token").and_then(|v| v.as_str()) {
                                Some(t) if !t.is_empty() => t.to_string(),
                                _ => {
                                    warn!(key = %idea.key, "channel:telegram idea missing token");
                                    continue;
                                }
                            };
                            let allowed_chats: Vec<i64> = tg_cfg
                                .get("allowed_chats")
                                .and_then(|v| v.as_array())
                                .map(|arr| arr.iter().filter_map(|v| v.as_i64()).collect())
                                .unwrap_or_default();

                            let agent_id = owner_agent_id.clone();
                            let tg_channel = Arc::new(TelegramChannel::new(token, allowed_chats.clone()));
                            let sm = daemon.session_manager.clone();
                            let ar = agent_reg.clone();
                            let provider = daemon.default_provider.clone();

                            tokio::spawn(start_agent_telegram_gateway(
                                agent_id.clone(),
                                allowed_chats,
                                sm,
                                ar,
                                provider,
                                tg_channel,
                            ));
                            tg_gateway_count += 1;
                            info!(agent_id = %agent_id, "started agent telegram gateway from idea");
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "failed to scan ideas for channel:telegram configs");
                    }
                }
            }

            // Legacy fallback: if [channels.telegram] is configured in aeqi.toml,
            // start a single gateway bound to the root agent.
            if tg_gateway_count == 0 {
                if let Some(ref tg_config) = config.channels.telegram {
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
                                            // Fall back to first company agent.
                                            config
                                                .agent_spawns
                                                .first()
                                                .map(|c| c.name.clone())
                                                .unwrap_or_else(|| "root".to_string())
                                        }
                                    };
                                    let allowed_chats = tg_config.allowed_chats.clone();
                                    let tg_channel = Arc::new(TelegramChannel::new(
                                        token,
                                        allowed_chats.clone(),
                                    ));
                                    let sm = daemon.session_manager.clone();
                                    let ar = agent_reg.clone();
                                    let provider = daemon.default_provider.clone();

                                    tokio::spawn(start_agent_telegram_gateway(
                                        root_agent_id.clone(),
                                        allowed_chats,
                                        sm,
                                        ar,
                                        provider,
                                        tg_channel,
                                    ));
                                    info!(
                                        agent_id = %root_agent_id,
                                        "started legacy telegram gateway from [channels.telegram]"
                                    );
                                }
                                _ => {
                                    info!("Telegram token not found in secret store, skipping legacy gateway");
                                }
                            }
                        }
                        Err(e) => {
                            warn!(error = %e, "failed to open secret store for legacy Telegram");
                        }
                    }
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

/// Agent-driven Telegram gateway.
///
/// Starts a poller for the given TelegramChannel, routes incoming messages
/// through the session_manager bound to the specified agent_id. Each
/// (agent_id, chat_id) pair gets a persistent session.
async fn start_agent_telegram_gateway(
    agent_id: String,
    allowed_chats: Vec<i64>,
    session_manager: Arc<SessionManager>,
    agent_registry: Arc<aeqi_orchestrator::agent_registry::AgentRegistry>,
    default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    tg_channel: Arc<TelegramChannel>,
) {
    let mut rx = match Channel::start(tg_channel.as_ref()).await {
        Ok(rx) => rx,
        Err(e) => {
            warn!(agent_id = %agent_id, error = %e, "failed to start telegram poller");
            return;
        }
    };

    info!(agent_id = %agent_id, "telegram gateway polling started");

    while let Some(msg) = rx.recv().await {
        let chat_id = msg
            .metadata
            .get("chat_id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if chat_id == 0 {
            continue;
        }
        let message_id = msg
            .metadata
            .get("message_id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Whitelist check.
        if !allowed_chats.is_empty() && !allowed_chats.contains(&chat_id) {
            continue;
        }

        let user_text = msg.text;
        if user_text.is_empty() {
            continue;
        }

        // Get or create session for this (agent, chat) pair.
        let channel_key = format!("telegram:{}:{}", agent_id, chat_id);
        let session_id = match agent_registry
            .get_or_create_channel_session(&channel_key, &agent_id)
            .await
        {
            Ok(sid) => sid,
            Err(e) => {
                warn!(error = %e, channel_key = %channel_key, "failed to resolve channel session");
                continue;
            }
        };

        // Route through session_manager.
        let tg = tg_channel.clone();
        let sm = session_manager.clone();
        let provider = default_provider.clone();
        let aid = agent_id.clone();

        tokio::spawn(async move {
            let _ = tg.send_typing(chat_id).await;

            if sm.is_running(&session_id).await {
                // Session already alive -- inject message and wait for response.
                match sm.send(&session_id, &user_text).await {
                    Ok(response) => {
                        let out = aeqi_core::traits::OutgoingMessage {
                            channel: "telegram".to_string(),
                            recipient: String::new(),
                            text: response.text,
                            metadata: serde_json::json!({ "chat_id": chat_id }),
                        };
                        if let Err(e) = tg.send(out).await {
                            warn!(error = %e, "failed to send telegram reply");
                        }
                        if message_id > 0 {
                            let _ = tg.react(chat_id, message_id, "\u{1f44d}").await;
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, session_id = %session_id, "session send failed");
                        let out = aeqi_core::traits::OutgoingMessage {
                            channel: "telegram".to_string(),
                            recipient: String::new(),
                            text: format!("Error: {}", e),
                            metadata: serde_json::json!({ "chat_id": chat_id }),
                        };
                        let _ = tg.send(out).await;
                    }
                }
            } else {
                // No running session -- spawn a new interactive session.
                let Some(provider) = provider else {
                    let out = aeqi_core::traits::OutgoingMessage {
                        channel: "telegram".to_string(),
                        recipient: String::new(),
                        text: "No provider configured.".to_string(),
                        metadata: serde_json::json!({ "chat_id": chat_id }),
                    };
                    let _ = tg.send(out).await;
                    return;
                };

                let opts = aeqi_orchestrator::session_manager::SpawnOptions::interactive()
                    .with_session_id(session_id.clone())
                    .with_name(format!("telegram:{}", chat_id));

                match sm.spawn_session(&aid, &user_text, provider, opts).await {
                    Ok(spawned) => {
                        info!(
                            session_id = %spawned.session_id,
                            agent_id = %aid,
                            "spawned telegram session"
                        );
                        // Collect the response from the initial prompt via the stream.
                        let mut stream_rx = spawned.stream_sender.subscribe();
                        let mut text = String::new();
                        loop {
                            match tokio::time::timeout(
                                std::time::Duration::from_secs(300),
                                stream_rx.recv(),
                            )
                            .await
                            {
                                Ok(Ok(aeqi_core::ChatStreamEvent::TextDelta {
                                    text: delta,
                                })) => {
                                    text.push_str(&delta);
                                }
                                Ok(Ok(aeqi_core::ChatStreamEvent::Complete { .. })) => {
                                    break;
                                }
                                Ok(Ok(_)) => {
                                    // StepStart, ToolComplete, etc. -- skip.
                                }
                                Ok(Err(
                                    tokio::sync::broadcast::error::RecvError::Lagged(n),
                                )) => {
                                    warn!(
                                        lagged = n,
                                        "telegram stream subscriber lagged"
                                    );
                                }
                                Ok(Err(_)) | Err(_) => {
                                    // Channel closed or timeout.
                                    break;
                                }
                            }
                        }

                        if !text.is_empty() {
                            let out = aeqi_core::traits::OutgoingMessage {
                                channel: "telegram".to_string(),
                                recipient: String::new(),
                                text,
                                metadata: serde_json::json!({ "chat_id": chat_id }),
                            };
                            if let Err(e) = tg.send(out).await {
                                warn!(error = %e, "failed to send telegram reply");
                            }
                        }
                        if message_id > 0 {
                            let _ = tg.react(chat_id, message_id, "\u{1f44d}").await;
                        }
                    }
                    Err(e) => {
                        warn!(error = %e, "failed to spawn session for telegram");
                        let out = aeqi_core::traits::OutgoingMessage {
                            channel: "telegram".to_string(),
                            recipient: String::new(),
                            text: format!("Error: {}", e),
                            metadata: serde_json::json!({ "chat_id": chat_id }),
                        };
                        let _ = tg.send(out).await;
                    }
                }
            }
        });
    }
}
