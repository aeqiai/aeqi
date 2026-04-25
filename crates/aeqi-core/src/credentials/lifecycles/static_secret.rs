//! `static_secret` lifecycle — the legacy SecretStore shape.
//!
//! Blob = raw secret bytes (UTF-8 string for API keys, bot tokens). No
//! refresh, no bootstrap external IO; bootstrap simply takes the value the
//! caller hands in via the bootstrap config.

use anyhow::{Context, Result};
use async_trait::async_trait;

use crate::credentials::lifecycle::{BootstrappedRow, CredentialLifecycle};
use crate::credentials::types::{
    CredentialBootstrapContext, CredentialResolveContext, RefreshResult, UsableCredential,
};

pub struct StaticSecretLifecycle;

impl Default for StaticSecretLifecycle {
    fn default() -> Self {
        Self
    }
}

#[async_trait]
impl CredentialLifecycle for StaticSecretLifecycle {
    fn kind(&self) -> &'static str {
        "static_secret"
    }

    fn validate(&self, blob: &[u8], _metadata: &serde_json::Value) -> Result<()> {
        if blob.is_empty() {
            anyhow::bail!("static_secret blob must be non-empty");
        }
        Ok(())
    }

    async fn resolve(&self, ctx: &CredentialResolveContext<'_>) -> Result<UsableCredential> {
        let value = std::str::from_utf8(ctx.plaintext)
            .context("static_secret blob is not valid UTF-8")?
            .to_string();
        Ok(UsableCredential {
            id: ctx.row.id.clone(),
            provider: ctx.row.provider.clone(),
            name: ctx.row.name.clone(),
            headers: vec![],
            bearer: Some(value.clone()),
            raw: ctx.plaintext.to_vec(),
            metadata: ctx.metadata.clone(),
        })
    }

    async fn refresh(&self, _ctx: &CredentialResolveContext<'_>) -> Result<RefreshResult> {
        Ok(RefreshResult::NotNeeded)
    }

    async fn revoke(&self, _ctx: &CredentialResolveContext<'_>) -> Result<()> {
        // Provider-side revocation is N/A for static secrets — caller deletes
        // the row.
        Ok(())
    }

    async fn bootstrap(&self, ctx: &CredentialBootstrapContext<'_>) -> Result<BootstrappedRow> {
        // Bootstrap config: { "value": "<secret>" }
        let value = ctx
            .config
            .get("value")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("static_secret bootstrap requires 'value'"))?;
        if value.is_empty() {
            anyhow::bail!("static_secret 'value' must be non-empty");
        }
        Ok(BootstrappedRow {
            plaintext_blob: value.as_bytes().to_vec(),
            metadata: serde_json::json!({}),
            expires_at: None,
            instructions: None,
        })
    }
}
