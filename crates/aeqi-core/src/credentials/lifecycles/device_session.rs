//! `device_session` lifecycle — Baileys-shaped paired sessions.
//!
//! The blob is whatever the device library writes (Baileys' `auth_state.json`
//! equivalent — Noise keys, Signal pre-keys, registration creds). The
//! substrate stores it encrypted; the channel gateway hands the plaintext
//! back to the bridge process to use directly.
//!
//! Refresh: paired sessions can't be silently refreshed — the device
//! re-pairs out of band by displaying a fresh QR / pairing code in the UI.
//! `refresh()` therefore reports `Failed(refresh_failed, ...)` so the
//! operator knows to re-bootstrap. Revoke: deletes the row + (caller-side)
//! logs out the device.

use anyhow::Result;
use async_trait::async_trait;

use crate::credentials::lifecycle::{BootstrappedRow, CredentialLifecycle};
use crate::credentials::types::{
    CredentialBootstrapContext, CredentialReasonCode, CredentialResolveContext, RefreshResult,
    UsableCredential,
};

pub struct DeviceSessionLifecycle;

impl Default for DeviceSessionLifecycle {
    fn default() -> Self {
        Self
    }
}

#[async_trait]
impl CredentialLifecycle for DeviceSessionLifecycle {
    fn kind(&self) -> &'static str {
        "device_session"
    }

    fn validate(&self, blob: &[u8], _metadata: &serde_json::Value) -> Result<()> {
        if blob.is_empty() {
            anyhow::bail!("device_session blob must be non-empty");
        }
        // Soft schema check — must be parseable JSON. Bridges (Baileys)
        // serialise their state as JSON; if a future bridge wants binary
        // it can subclass.
        let _: serde_json::Value = serde_json::from_slice(blob)
            .map_err(|e| anyhow::anyhow!("device_session blob must be JSON: {e}"))?;
        Ok(())
    }

    async fn resolve(&self, ctx: &CredentialResolveContext<'_>) -> Result<UsableCredential> {
        Ok(UsableCredential {
            id: ctx.row.id.clone(),
            provider: ctx.row.provider.clone(),
            name: ctx.row.name.clone(),
            headers: vec![],
            bearer: None,
            raw: ctx.plaintext.to_vec(),
            metadata: ctx.metadata.clone(),
        })
    }

    async fn refresh(&self, _ctx: &CredentialResolveContext<'_>) -> Result<RefreshResult> {
        // Paired devices can't be silently refreshed.
        Ok(RefreshResult::Failed(
            CredentialReasonCode::RefreshFailed,
            "device_session needs out-of-band re-pair".into(),
        ))
    }

    async fn revoke(&self, _ctx: &CredentialResolveContext<'_>) -> Result<()> {
        // The bridge handles its own logout when the row is deleted.
        Ok(())
    }

    async fn bootstrap(&self, ctx: &CredentialBootstrapContext<'_>) -> Result<BootstrappedRow> {
        // Bootstrap config: { "blob": <JSON>, "metadata": <JSON> }.
        // The QR + pairing UX lives in the channel gateway; bootstrap is
        // the storage layer ack: the gateway hands the freshly-paired blob
        // here and we encrypt + store it.
        let blob = ctx
            .config
            .get("blob")
            .ok_or_else(|| anyhow::anyhow!("device_session bootstrap requires 'blob'"))?;
        let plaintext_blob = serde_json::to_vec(blob)?;
        let metadata = ctx
            .config
            .get("metadata")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(BootstrappedRow {
            plaintext_blob,
            metadata,
            expires_at: None,
            instructions: Some(
                "Scan the QR code shown by the channel gateway to complete pairing.".into(),
            ),
        })
    }
}
