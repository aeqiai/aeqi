//! Lifecycle handler trait.
//!
//! Each lifecycle (static_secret, oauth2, device_session, github_app,
//! service_account) implements this trait. The substrate stores rows; the
//! lifecycle owns the policy for "what does it mean to validate / resolve /
//! refresh / revoke / bootstrap a row of this kind".

use anyhow::Result;
use async_trait::async_trait;

use super::types::{
    BootstrapHandle, CredentialBootstrapContext, CredentialResolveContext, RefreshResult,
    UsableCredential,
};

/// One credential lifecycle plugin.
///
/// Methods that mutate the row (refresh, revoke, bootstrap) take a
/// `CredentialStore` reference via the resolve/bootstrap context — but to
/// keep the trait object-safe and avoid recursive crate dependencies the
/// store reference is threaded as a generic parameter via the `Resolver`
/// runtime path rather than baked into this trait. Each handler only needs
/// to read the row, decode the blob, and (for refresh) hand back a new
/// `RefreshResult` containing the rewritten blob — the resolver writes it.
#[async_trait]
pub trait CredentialLifecycle: Send + Sync {
    /// Stable kind string written into the `lifecycle_kind` column.
    fn kind(&self) -> &'static str;

    /// Validate that the (decrypted) blob + metadata are well-formed for this
    /// lifecycle. Called on every `insert` / `update` write to catch shape
    /// regressions before they hit a tool.
    fn validate(&self, blob: &[u8], metadata: &serde_json::Value) -> Result<()>;

    /// Return a ready-to-use credential. Must NOT perform external IO unless
    /// strictly necessary (e.g. github_app must mint a token; oauth2 may
    /// silently refresh if expired). Idempotent under the existing row.
    async fn resolve(&self, ctx: &CredentialResolveContext<'_>) -> Result<UsableCredential>;

    /// Trigger an out-of-band refresh. Called by the on-401 retry path or the
    /// operator. Returns a `RefreshResult`; `Refreshed(new)` includes the
    /// new blob and metadata the resolver should persist.
    async fn refresh(&self, ctx: &CredentialResolveContext<'_>) -> Result<RefreshResult>;

    /// Revoke. The store deletes the row after this completes. The handler
    /// is responsible for any provider-side revocation (e.g. POST to the
    /// revocation endpoint for OAuth2).
    async fn revoke(&self, ctx: &CredentialResolveContext<'_>) -> Result<()>;

    /// One-time bootstrap (initial setup). The handler returns the blob +
    /// metadata + expiry the store should insert; the store wraps the
    /// returned values into a row and returns a `BootstrapHandle`.
    async fn bootstrap(&self, ctx: &CredentialBootstrapContext<'_>) -> Result<BootstrappedRow>;
}

/// Output of `bootstrap()` — what the store needs to write a fresh row.
#[derive(Debug, Clone)]
pub struct BootstrappedRow {
    /// The decrypted blob (will be encrypted by the store).
    pub plaintext_blob: Vec<u8>,
    /// Non-secret metadata.
    pub metadata: serde_json::Value,
    /// Expiry, if applicable.
    pub expires_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Optional human-facing instructions surfaced through `BootstrapHandle`.
    pub instructions: Option<String>,
}

impl BootstrappedRow {
    pub fn into_handle(self, credential_id: String) -> (BootstrapHandle, Self) {
        let handle = BootstrapHandle {
            credential_id,
            instructions: self.instructions.clone(),
        };
        (handle, self)
    }
}
