use anyhow::Result;
use std::path::PathBuf;

use crate::cli::CompanyAction;

pub(crate) async fn cmd_company(
    _config_path: &Option<PathBuf>,
    action: CompanyAction,
) -> Result<()> {
    match action {
        CompanyAction::Derive { company_id, json } => {
            let derived = aeqi_company::CompanyId::from_company_id(&company_id);
            if json {
                let payload = serde_json::json!({
                    "company_id": company_id,
                    "derived": derived.to_hex(),
                });
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!("company_id: {}", company_id);
                println!("derived:  {}", derived.to_hex());
            }
            Ok(())
        }
    }
}
