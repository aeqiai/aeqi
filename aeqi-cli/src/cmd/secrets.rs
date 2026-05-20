use aeqi_core::SecretStore;
use aeqi_core::credentials::{
    CredentialCipher, CredentialInsert, CredentialKey, CredentialStore, CredentialUpdate, ScopeKind,
};
use anyhow::{Context, Result};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::cli::SecretsAction;
use crate::helpers::load_config;

pub(crate) async fn cmd_secrets(
    config_path: &Option<PathBuf>,
    action: SecretsAction,
) -> Result<()> {
    let loaded = load_config(config_path).ok();
    let data_dir = loaded
        .as_ref()
        .map(|(config, _)| config.data_dir())
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".aeqi"));
    let store_path = if let Some((config, _)) = &loaded {
        config
            .security
            .secret_store
            .as_ref()
            .map(PathBuf::from)
            .unwrap_or_else(|| data_dir.join("secrets"))
    } else {
        data_dir.join("secrets")
    };
    let store = SecretStore::open(&store_path)?;

    match action {
        SecretsAction::Set { name, value } => {
            store.set(&name, &value)?;
            upsert_global_static_secret(&data_dir, &store_path, &name, &value).await?;
            println!("Secret '{name}' stored.");
        }
        SecretsAction::Get { name } => println!("{}", store.get(&name)?),
        SecretsAction::List => {
            let names = store.list()?;
            if names.is_empty() {
                println!("No secrets stored.");
            } else {
                for n in names {
                    println!("  {n}");
                }
            }
        }
        SecretsAction::Delete { name } => {
            store.delete(&name)?;
            println!("Secret '{name}' deleted.");
        }
    }
    Ok(())
}

async fn upsert_global_static_secret(
    data_dir: &std::path::Path,
    store_path: &std::path::Path,
    name: &str,
    value: &str,
) -> Result<()> {
    std::fs::create_dir_all(data_dir)
        .with_context(|| format!("failed to create data dir: {}", data_dir.display()))?;
    let db_path = data_dir.join("aeqi.db");
    let conn = Connection::open(&db_path)
        .with_context(|| format!("failed to open credentials DB: {}", db_path.display()))?;
    CredentialStore::initialize_schema(&conn)?;
    let cipher = CredentialCipher::open(store_path)
        .with_context(|| format!("failed to open credential cipher: {}", store_path.display()))?;
    let store = CredentialStore::new(Arc::new(Mutex::new(conn)), cipher);
    let key = CredentialKey {
        scope_kind: ScopeKind::Global,
        scope_id: String::new(),
        provider: "legacy".to_string(),
        name: name.to_string(),
    };
    if let Some(existing) = store.find(&key).await? {
        store
            .update(
                &existing.id,
                CredentialUpdate {
                    plaintext_blob: Some(value.as_bytes().to_vec()),
                    metadata: Some(serde_json::json!({"source": "aeqi_secrets_set"})),
                    expires_at: Some(None),
                    bump_last_refreshed: true,
                    bump_last_used: false,
                },
            )
            .await?;
    } else {
        store
            .insert(CredentialInsert {
                scope_kind: ScopeKind::Global,
                scope_id: String::new(),
                provider: "legacy".to_string(),
                name: name.to_string(),
                lifecycle_kind: "static_secret".to_string(),
                plaintext_blob: value.as_bytes().to_vec(),
                metadata: serde_json::json!({"source": "aeqi_secrets_set"}),
                expires_at: None,
            })
            .await?;
    }
    Ok(())
}
