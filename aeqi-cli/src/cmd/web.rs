use anyhow::Result;
use std::path::PathBuf;

use crate::cli::WebAction;
use crate::helpers::load_config_with_agents;

pub async fn cmd_web(config_path: &Option<PathBuf>, action: WebAction) -> Result<()> {
    match action {
        WebAction::Start { bind } => {
            let (mut config, _) = load_config_with_agents(config_path)?;

            if let Some(bind) = bind {
                config.web.bind = bind;
            }

            aeqi_web::server::start(&config).await
        }
    }
}
