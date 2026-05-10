use anyhow::Result;
use std::path::PathBuf;

use crate::cli::TrustAction;

pub(crate) async fn cmd_trust(_config_path: &Option<PathBuf>, action: TrustAction) -> Result<()> {
    match action {
        TrustAction::Derive { entity_id, json } => {
            let binding = aeqi_trust::TrustBinding::new(entity_id);
            if json {
                println!("{}", serde_json::to_string_pretty(&binding)?);
            } else {
                println!("entity_id: {}", binding.entity_id);
                println!("trust_id: {}", binding.trust_id);
                if let Some(addr) = binding.trust_address.as_deref() {
                    println!("trust_address: {}", addr);
                }
                if let Some(addr) = binding.authority_address.as_deref() {
                    println!("authority_address: {}", addr);
                }
            }
            Ok(())
        }
    }
}
