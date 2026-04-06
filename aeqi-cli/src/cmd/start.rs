use anyhow::Result;
use std::path::PathBuf;

use crate::cli::{DaemonAction, WebAction};

/// Run daemon and web server concurrently in a single process.
pub(crate) async fn cmd_start(config_path: &Option<PathBuf>, bind: Option<String>) -> Result<()> {
    println!("Starting AEQI (daemon + web)...\n");

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
