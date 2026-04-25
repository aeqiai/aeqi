//! `pack:google-workspace` — Gmail / Calendar / Meet tools backed by T1.9's
//! `oauth2` credential lifecycle.
//!
//! Eleven tools, all per-agent-scoped (`ScopeHint::Agent`):
//!
//! | Tool                         | Scope                                                 |
//! | ---------------------------- | ----------------------------------------------------- |
//! | `gmail.search`, `gmail.read` | `https://www.googleapis.com/auth/gmail.readonly`      |
//! | `gmail.send`, `gmail.label`, | `https://www.googleapis.com/auth/gmail.modify`        |
//! | `gmail.archive`              |                                                       |
//! | `calendar.list_events`       | `https://www.googleapis.com/auth/calendar.readonly`   |
//! | `calendar.create_event`,     | `https://www.googleapis.com/auth/calendar`            |
//! | `calendar.update_event`,     |                                                       |
//! | `calendar.delete_event`      |                                                       |
//! | `meet.create`,               | `https://www.googleapis.com/auth/calendar`            |
//! | `meet.list_active`           |                                                       |
//!
//! Tools declare their narrowest scope via `Tool::required_credentials()`;
//! the bootstrap consent flow requests the union of declared scopes.
//!
//! Refresh-on-401 is implemented at the framework level: tools surface a
//! `reason_code=auth_expired` marker (with `credential_id`) on 401, the
//! tool registry refreshes the credential and retries exactly once.

pub mod api;
pub mod calendar;
pub mod gmail;
pub mod meet;

pub use api::{CALENDAR_BASE, GMAIL_BASE, GoogleApiClient, GoogleApiError, scope_satisfied};

/// Every tool this pack ships, ready to register on a `ToolRegistry`. Wired
/// from `aeqi-orchestrator::tools::register_google_workspace_pack` when the
/// `google-workspace` feature is enabled.
pub fn all_tools() -> Vec<std::sync::Arc<dyn aeqi_core::traits::Tool>> {
    let mut tools = Vec::new();
    tools.extend(gmail::all_tools());
    tools.extend(calendar::all_tools());
    tools.extend(meet::all_tools());
    tools
}

/// Stable provider key used by every tool's `CredentialNeed`. Surfaced for
/// the bootstrap UI / CLI flow so it can target this pack's row.
pub const PROVIDER: &str = "google";

/// Stable credential name. Per-pack convention: one OAuth2 row per agent
/// per provider; multi-account future work would extend this with a
/// suffix (e.g. `oauth_token:work` / `oauth_token:personal`).
pub const CREDENTIAL_NAME: &str = "oauth_token";
