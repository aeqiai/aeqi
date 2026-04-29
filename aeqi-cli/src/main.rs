mod cli;
mod cmd;
mod helpers;
mod service;
#[allow(clippy::collapsible_if)]
mod tui;

use anyhow::Result;
use clap::Parser;
use cli::Commands;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "aeqi", version, about = "AEQI — Multi-Agent Orchestration")]
struct Cli {
    #[arg(short, long)]
    config: Option<PathBuf>,

    #[arg(long, default_value = "info")]
    log_level: String,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(&cli.log_level)),
        )
        .with_target(false)
        .init();

    match cli.command {
        None => cmd::chat::cmd_chat(&cli.config).await,
        Some(Commands::Run {
            prompt,
            root,
            model,
            max_iterations,
        }) => {
            cmd::run::cmd_run(
                &cli.config,
                &prompt,
                root.as_deref(),
                model.as_deref(),
                max_iterations,
            )
            .await
        }
        Some(Commands::Start { bind, entity_id }) => {
            if let Some(eid) = entity_id.as_ref() {
                // Surface to the daemon process so its agent_registry can
                // honor the platform-supplied entity_id when minting the
                // entity row on first boot.
                // SAFETY: set_var is single-threaded (we're pre-tokio-spawn).
                unsafe {
                    std::env::set_var("AEQI_ENTITY_ID", eid);
                }
            }
            cmd::start::cmd_start(&cli.config, bind).await
        }
        Some(Commands::Init) => cmd::init::cmd_init().await,
        Some(Commands::Setup {
            runtime,
            service,
            force,
        }) => cmd::setup::cmd_setup(&runtime, service, force).await,
        Some(Commands::Secrets { action }) => cmd::secrets::cmd_secrets(&cli.config, action).await,
        Some(Commands::Doctor { fix, strict }) => {
            cmd::doctor::cmd_doctor(&cli.config, fix, strict).await
        }
        Some(Commands::Status) => cmd::status::cmd_status(&cli.config).await,
        Some(Commands::Monitor {
            root,
            watch,
            interval_secs,
            json,
        }) => {
            cmd::monitor::cmd_monitor(&cli.config, root.as_deref(), watch, interval_secs, json)
                .await
        }
        Some(Commands::Assign {
            subject,
            root,
            description,
            priority,
        }) => {
            cmd::quests::cmd_assign(
                &cli.config,
                &subject,
                &root,
                &description,
                priority.as_deref(),
            )
            .await
        }
        Some(Commands::Ready { root }) => {
            cmd::quests::cmd_ready(&cli.config, root.as_deref()).await
        }
        Some(Commands::Quests { root, all }) => {
            cmd::quests::cmd_quests(&cli.config, root.as_deref(), all).await
        }
        Some(Commands::Close { id, reason }) => {
            cmd::quests::cmd_close(&cli.config, &id, &reason).await
        }
        Some(Commands::Daemon { action }) => cmd::daemon::cmd_daemon(&cli.config, action).await,
        Some(Commands::Ideas { action }) => cmd::ideas::cmd_ideas(&cli.config, action).await,
        Some(Commands::Events { action }) => cmd::events::cmd_events(&cli.config, action).await,
        Some(Commands::Pipeline { action }) => {
            cmd::pipeline::cmd_pipeline(&cli.config, action).await
        }
        Some(Commands::Prompt { action }) => cmd::prompt::cmd_prompt(&cli.config, action).await,
        Some(Commands::Operation { action }) => {
            cmd::operation::cmd_operation(&cli.config, action).await
        }
        Some(Commands::Hooks { action }) => cmd::hooks::cmd_hooks(action).await,
        Some(Commands::Hook { worker, quest_id }) => {
            cmd::quests::cmd_hook(&cli.config, &worker, &quest_id).await
        }
        Some(Commands::Done { quest_id, reason }) => {
            cmd::quests::cmd_done(&cli.config, &quest_id, &reason).await
        }
        Some(Commands::Team { root }) => cmd::team::cmd_team(&cli.config, root.as_deref()).await,
        Some(Commands::Config { action }) => cmd::config::cmd_config(&cli.config, action).await,
        Some(Commands::Agent { action }) => cmd::agent::cmd_agent(&cli.config, action).await,
        Some(Commands::Audit { root, quest, last }) => {
            cmd::audit::cmd_audit(&cli.config, root.as_deref(), quest.as_deref(), last).await
        }
        Some(Commands::Deps { root, apply }) => {
            cmd::deps::cmd_deps(&cli.config, &root, apply).await
        }
        Some(Commands::Web { action }) => cmd::web::cmd_web(&cli.config, action).await,
        Some(Commands::Graph { action }) => cmd::graph::cmd_graph(&cli.config, action).await,
        Some(Commands::Chat { agent, root }) => {
            tui::run(&cli.config, agent.as_deref(), root.as_deref()).await
        }
        Some(Commands::Primer) => cmd::primer::cmd_primer(&cli.config),
        Some(Commands::Mcp) => cmd::mcp::cmd_mcp(&cli.config).map(|_| ()),
        Some(Commands::Seed) => cmd::seed::cmd_seed(&cli.config).await,
    }
}
