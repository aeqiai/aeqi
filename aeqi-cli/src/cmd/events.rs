//! Operator CLI for event handlers.
//!
//! `install-defaults` backfills the two standard schedule events
//! (`daily-digest`, `weekly-consolidate`) on every existing agent.
//! `AgentRegistry::install_default_scheduled_events` already runs per-agent
//! at spawn, but agents that predate that hook need this retroactive
//! installer. Dispatched via the daemon so writes go through the same
//! code path as the live runtime and the unique-name index enforces
//! idempotency across repeated runs.

use anyhow::Result;
use std::path::PathBuf;

use crate::cli::EventsAction;
use crate::helpers::daemon_ipc_request;

pub(crate) async fn cmd_events(config_path: &Option<PathBuf>, action: EventsAction) -> Result<()> {
    match action {
        EventsAction::InstallDefaults { agents, dry_run } => {
            cmd_events_install_defaults(config_path, agents, dry_run).await
        }
    }
}

async fn cmd_events_install_defaults(
    config_path: &Option<PathBuf>,
    agents: Vec<String>,
    dry_run: bool,
) -> Result<()> {
    let mut req = serde_json::json!({
        "cmd": "install_default_events",
        "dry_run": dry_run,
    });
    if !agents.is_empty() {
        req["agent_names"] = serde_json::Value::Array(
            agents
                .iter()
                .map(|s| serde_json::Value::String(s.clone()))
                .collect(),
        );
    }

    let resp = daemon_ipc_request(config_path, &req).await?;

    if !resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let err = resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        anyhow::bail!("install_default_events failed: {err}");
    }

    let installed = resp.get("installed").and_then(|v| v.as_u64()).unwrap_or(0);
    let skipped = resp
        .get("skipped_existing")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let targeted = resp.get("agents").and_then(|v| v.as_u64()).unwrap_or(0);

    let prefix = if dry_run { "[dry-run] " } else { "" };
    println!(
        "{prefix}install-defaults: {targeted} agent(s) targeted, {installed} event(s) installed, {skipped} already present",
    );

    // Per-agent detail, if the daemon returned a breakdown.
    if let Some(rows) = resp.get("details").and_then(|v| v.as_array()) {
        for row in rows {
            let name = row.get("name").and_then(|v| v.as_str()).unwrap_or("?");
            let id = row.get("id").and_then(|v| v.as_str()).unwrap_or("?");
            let created = row.get("installed").and_then(|v| v.as_u64()).unwrap_or(0);
            let skip = row
                .get("skipped_existing")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            println!("  {prefix}{name} ({id}): +{created} installed, {skip} existing");
        }
    }

    Ok(())
}
