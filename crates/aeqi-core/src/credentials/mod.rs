//! Credential lifecycle substrate (T1.9).
//!
//! Generalises aeqi's credential storage from "name → blob" into "credentials
//! with declared lifecycles, scoped per-agent / per-user / global / channel
//! / installation". One [`CredentialStore`] backs the runtime; lifecycle
//! handlers ([`CredentialLifecycle`]) own the policy for refresh / revoke /
//! bootstrap; [`CredentialResolver`] is the entry point tools use to turn a
//! [`CredentialNeed`] into a [`UsableCredential`].
//!
//! Five built-in lifecycles ship in T1.9:
//!
//! * [`lifecycles::StaticSecretLifecycle`] — wraps the legacy `SecretStore`
//!   shape (LLM keys, bot tokens).
//! * [`lifecycles::OAuth2Lifecycle`] — PKCE + loopback callback + refresh.
//! * [`lifecycles::DeviceSessionLifecycle`] — Baileys-shaped paired sessions.
//! * [`lifecycles::GithubAppLifecycle`] — JWT-signed installation tokens.
//! * [`lifecycles::ServiceAccountLifecycle`] — GCP service-account JSON.

pub mod cipher;
pub mod lifecycle;
pub mod lifecycles;
pub mod resolve;
pub mod store;
pub mod types;

pub use cipher::{CredentialCipher, default_store_path};
pub use lifecycle::{BootstrappedRow, CredentialLifecycle};
pub use resolve::{CredentialResolveError, CredentialResolver, ResolutionScope};
pub use store::{
    CredentialDb, CredentialInsert, CredentialKey, CredentialStore, CredentialUpdate,
    read_global_legacy_blob_sync,
};
pub use types::{
    BootstrapHandle, CredentialBootstrapContext, CredentialNeed, CredentialReasonCode,
    CredentialResolveContext, CredentialRow, RefreshResult, ScopeHint, ScopeKind, UsableCredential,
};
