use anyhow::Result;
use std::path::PathBuf;

use crate::cli::TrustAction;

pub(crate) async fn cmd_trust(_config_path: &Option<PathBuf>, action: TrustAction) -> Result<()> {
    match action {
        TrustAction::Derive { trust_id, json } => {
            let derived = aeqi_trust::TrustId::from_trust_id(&trust_id);
            if json {
                let payload = serde_json::json!({
                    "trust_id": trust_id,
                    "derived": derived.to_hex(),
                });
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!("trust_id: {}", trust_id);
                println!("derived:  {}", derived.to_hex());
            }
            Ok(())
        }
    }
}
