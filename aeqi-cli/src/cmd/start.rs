use anyhow::Result;
use std::path::PathBuf;

use crate::cli::{DaemonAction, WebAction};
use crate::helpers::load_config_with_agents;

/// Run daemon and web server concurrently in a single process.
pub(crate) async fn cmd_start(config_path: &Option<PathBuf>, bind: Option<String>) -> Result<()> {
    println!("Starting AEQI (daemon + web)...");
    print_readiness(config_path, bind.as_deref());

    let web_action = WebAction::Start { bind };

    tokio::select! {
        result = super::daemon::cmd_daemon(config_path, DaemonAction::Start) => result,
        result = async {
            // Brief delay for daemon to bind the IPC socket before
            // the web server starts accepting requests.
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            super::web::cmd_web(config_path, web_action).await
        } => result,
    }
}

/// Print a one-shot readiness summary so users see the dashboard URL,
/// daemon mode, and which providers will actually work — instead of just
/// a couple of WARN lines from the underlying tracing subscriber.
fn print_readiness(config_path: &Option<PathBuf>, bind_override: Option<&str>) {
    let Ok((config, _path)) = load_config_with_agents(config_path) else {
        println!("(skipping readiness summary: config not loaded)");
        return;
    };

    let bind = bind_override.unwrap_or(&config.web.bind).to_string();
    let url = bind_to_url(&bind);
    println!("  Web UI:   {url}");
    println!(
        "  Daemon:   running ({} agent(s) configured)",
        config.agents.len()
    );

    let provider_status = describe_providers(&config);
    println!("  Provider: {provider_status}");

    let mut idea_db = config.data_dir().join("aeqi.db");
    if idea_db.is_relative() {
        idea_db = std::env::current_dir().unwrap_or_default().join(&idea_db);
    }
    if idea_db.exists() {
        println!("  Ideas:    aeqi.db at {}", idea_db.display());
    } else {
        println!(
            "  Ideas:    aeqi.db will be created at {} on first write",
            idea_db.display()
        );
    }

    if config.web.auth_secret.as_deref().unwrap_or("").is_empty() {
        println!(
            "  Auth:     ephemeral secret (sign-ins won't survive restart). Run `aeqi setup` to persist one."
        );
    } else {
        println!("  Auth:     persistent secret from config");
    }
    println!();
}

fn bind_to_url(bind: &str) -> String {
    let (host, port) = bind.rsplit_once(':').unwrap_or(("localhost", "8400"));
    let host = match host {
        "0.0.0.0" | "[::]" | "::" | "" => "localhost",
        other => other,
    };
    format!("http://{host}:{port}")
}

fn describe_providers(config: &aeqi_core::AEQIConfig) -> String {
    let mut configured = Vec::new();
    let mut missing_keys = Vec::new();
    if let Some(ref or) = config.providers.openrouter {
        if or.api_key.is_empty() {
            missing_keys.push("OPENROUTER_API_KEY");
        } else {
            configured.push("openrouter");
        }
    }
    if let Some(ref a) = config.providers.anthropic {
        if a.api_key.is_empty() {
            missing_keys.push("ANTHROPIC_API_KEY");
        } else {
            configured.push("anthropic");
        }
    }
    if config.providers.ollama.is_some() {
        configured.push("ollama");
    }
    if configured.is_empty() && missing_keys.is_empty() {
        return "no providers configured (chat disabled until [providers.*] is set)".to_string();
    }
    let mut parts = Vec::new();
    if !configured.is_empty() {
        parts.push(format!("ready: {}", configured.join(", ")));
    }
    if !missing_keys.is_empty() {
        parts.push(format!(
            "missing key(s) {}: chat disabled for those providers until configured via `aeqi secrets set <NAME> <value>`",
            missing_keys.join(", ")
        ));
    }
    parts.join(" | ")
}
