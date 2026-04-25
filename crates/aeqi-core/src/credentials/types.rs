//! Public types for the credential substrate.
//!
//! These types are shared across the lifecycle handlers, the store, and the
//! tool-resolution path. They avoid leaking lifecycle-specific shapes into
//! callers — every lifecycle decodes its own JSON blob, but the surface
//! (scopes, needs, resolved credential, refresh result) is uniform.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Stable reason codes returned on credential resolution failure or surfaced
/// by `aeqi doctor`. Closed enum — agents and the UI consume these strings as
/// a public contract, so add cases by extending the enum, never by inventing
/// new strings out-of-band.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialReasonCode {
    /// Credential present, fresh, ready for use.
    Ok,
    /// No credential row matched the requested scope + provider + name.
    MissingCredential,
    /// Credential exists but is past its expiry and refresh either was not
    /// attempted or did not yield a fresh blob.
    Expired,
    /// Refresh attempted (cooperative or on-401) and failed.
    RefreshFailed,
    /// Provider-side revocation detected (e.g. 401 with `invalid_grant`).
    RevokedByProvider,
    /// Stored `lifecycle_kind` doesn't match a registered handler.
    UnsupportedLifecycle,
    /// Resolved row exists but its scope_hint doesn't match the caller's
    /// requested scope (e.g. caller wanted `agent` but only a `global` row
    /// exists and the lookup chose strict matching).
    ScopeMismatch,
    /// Resolved row points at another row by id (template references) but
    /// that target row does not exist.
    UnresolvedRef,
}

impl CredentialReasonCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::MissingCredential => "missing_credential",
            Self::Expired => "expired",
            Self::RefreshFailed => "refresh_failed",
            Self::RevokedByProvider => "revoked_by_provider",
            Self::UnsupportedLifecycle => "unsupported_lifecycle",
            Self::ScopeMismatch => "scope_mismatch",
            Self::UnresolvedRef => "unresolved_ref",
        }
    }
}

impl std::fmt::Display for CredentialReasonCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Where a credential is bound. The `id` field of the matching row stores the
/// scope kind + scope id, so the substrate lookup is `(kind, id, provider,
/// name)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    /// Workspace-wide. `scope_id == ""`.
    Global,
    /// Bound to a single agent (most-specific default for tools).
    Agent,
    /// Bound to a human user (multi-tenant case; aeqi runs single-tenant
    /// today but the column carries forward).
    User,
    /// Bound to a transport channel (e.g. WhatsApp Baileys session).
    Channel,
    /// Bound to a third-party installation (e.g. GitHub App installation_id).
    Installation,
}

impl ScopeKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Agent => "agent",
            Self::User => "user",
            Self::Channel => "channel",
            Self::Installation => "installation",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "global" => Some(Self::Global),
            "agent" => Some(Self::Agent),
            "user" => Some(Self::User),
            "channel" => Some(Self::Channel),
            "installation" => Some(Self::Installation),
            _ => None,
        }
    }
}

/// Hint a tool gives when declaring `required_credentials()` so the runtime
/// knows which scope to prefer when more than one matching row exists.
///
/// The default lookup walks `Agent → Global` (most-specific first).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScopeHint {
    /// Resolve agent-scoped first, fall back to global.
    Agent,
    /// Resolve user-scoped first, fall back to global.
    User,
    /// Resolve global-only (e.g. LLM provider keys today).
    Global,
    /// Resolve channel-scoped (caller supplies `scope_id`).
    Channel,
    /// Resolve installation-scoped (caller supplies `scope_id`).
    Installation,
}

/// What a tool declares it needs from the credential substrate.
#[derive(Debug, Clone)]
pub struct CredentialNeed {
    /// Provider key (`google`, `github`, `openrouter`, `whatsapp_baileys`,
    /// `telegram`, ...). Static — uniquely identifies the third-party.
    pub provider: &'static str,
    /// Logical credential name within the provider — e.g. `oauth_token`,
    /// `app_jwt`, `OPENROUTER_API_KEY`. Multiple credentials per provider
    /// per scope are allowed (a provider can hold both an OAuth token and
    /// a service-account key, for instance).
    pub name: &'static str,
    /// Where to look for the credential row.
    pub scope_hint: ScopeHint,
    /// For `oauth2` lifecycle: required scopes. Used by `bootstrap` to
    /// build the consent URL and by `resolve` to validate that the
    /// stored token covers the request.
    pub oauth_scopes: Vec<&'static str>,
    /// If true, a missing credential is not an error — the tool runs in a
    /// degraded mode. Resolution returns `None` rather than an error.
    pub optional: bool,
}

impl CredentialNeed {
    /// Build a need with no OAuth scopes (suitable for non-OAuth lifecycles).
    pub fn new(provider: &'static str, name: &'static str, scope_hint: ScopeHint) -> Self {
        Self {
            provider,
            name,
            scope_hint,
            oauth_scopes: Vec::new(),
            optional: false,
        }
    }

    pub fn with_scopes(mut self, scopes: Vec<&'static str>) -> Self {
        self.oauth_scopes = scopes;
        self
    }

    pub fn optional(mut self) -> Self {
        self.optional = true;
        self
    }
}

/// Context the runtime gives a lifecycle handler when asking it to resolve,
/// refresh, or revoke a credential. Holds the row plus a reference to the
/// store so the handler can persist mutations (refreshed token blobs).
pub struct CredentialResolveContext<'a> {
    pub row: &'a CredentialRow,
    /// Decrypted blob — passed in pre-decrypted so handlers don't all
    /// re-implement the cipher.
    pub plaintext: &'a [u8],
    /// Read-back access to the metadata JSON object on the row.
    pub metadata: &'a serde_json::Value,
    /// HTTP client for handlers that need to call out (token endpoints,
    /// installation endpoints). `None` in tests; handlers fall back gracefully.
    pub http: Option<&'a reqwest::Client>,
}

/// Context for the one-time bootstrap path.
pub struct CredentialBootstrapContext<'a> {
    pub provider: &'a str,
    pub scope_kind: ScopeKind,
    pub scope_id: &'a str,
    /// Configuration the caller passes into bootstrap — opaque to the
    /// substrate; each lifecycle parses what it needs.
    pub config: &'a serde_json::Value,
    pub http: Option<&'a reqwest::Client>,
}

/// One row from the `credentials` table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialRow {
    pub id: String,
    pub scope_kind: ScopeKind,
    pub scope_id: String,
    pub provider: String,
    pub name: String,
    pub lifecycle_kind: String,
    /// Encrypted blob — opaque ciphertext + nonce, decoded by `CredentialCipher`.
    pub encrypted_blob: Vec<u8>,
    pub metadata: serde_json::Value,
    pub expires_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub last_refreshed_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Ready-to-use credential returned to the tool. The shape is deliberately
/// narrow — every lifecycle collapses to "headers / token strings / blob"
/// at the boundary so tools don't carry lifecycle-specific code.
#[derive(Debug, Clone)]
pub struct UsableCredential {
    pub id: String,
    pub provider: String,
    pub name: String,
    /// HTTP headers ready to drop into a request (`Authorization: Bearer ...`,
    /// `X-Api-Key: ...`, etc.). For non-HTTP credentials this is empty.
    pub headers: Vec<(String, String)>,
    /// Plain bearer / api-key string for tools that don't speak HTTP
    /// directly (Baileys session blob, etc.). For OAuth2 this is the
    /// access_token; for static_secret this is the secret.
    pub bearer: Option<String>,
    /// Raw decrypted blob — for lifecycles whose tools need the full
    /// JSON shape (device_session writing the full Baileys auth_state,
    /// service_account JSON key file). Most tools should prefer `headers`
    /// or `bearer`.
    pub raw: Vec<u8>,
    pub metadata: serde_json::Value,
}

/// Outcome of a refresh attempt.
#[derive(Debug, Clone)]
pub enum RefreshResult {
    /// Refresh succeeded — store has been updated and the new credential
    /// is ready.
    Refreshed(UsableCredential),
    /// Refresh not needed (e.g. token still valid; no-op for static_secret).
    NotNeeded,
    /// Refresh attempted but failed with a non-recoverable error
    /// (refresh_token revoked, network error after retries, etc.). Caller
    /// surfaces the reason code.
    Failed(CredentialReasonCode, String),
}

/// Handle returned by `bootstrap()`. The runtime stores the new credential
/// row and surfaces this to the operator (e.g. UI flows, CLI prompts).
#[derive(Debug, Clone)]
pub struct BootstrapHandle {
    /// id of the freshly inserted credential row.
    pub credential_id: String,
    /// Optional human-facing instruction the operator must complete out of
    /// band (e.g. "Visit https://... to authorize").
    pub instructions: Option<String>,
}
