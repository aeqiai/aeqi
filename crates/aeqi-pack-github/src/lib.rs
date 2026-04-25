//! `pack:github` — native GitHub tools backed by T1.9's `github_app`
//! lifecycle (preferred for org/team usage) or `oauth2` lifecycle
//! (user-PAT-equivalent for solo accounts).
//!
//! Sixteen tools across five categories, all per-installation-scoped
//! (`ScopeHint::Installation`):
//!
//! | Category | Tools |
//! | -------- | ----- |
//! | Issues   | `github.issues.list` / `.get` / `.create` / `.comment` / `.close` |
//! | PRs      | `github.prs.list` / `.get` / `.create` / `.comment` / `.review` |
//! | Files    | `github.files.read` / `.list` |
//! | Releases | `github.releases.list` / `.create` |
//! | Search   | `github.search.repos` / `.search.issues` |
//!
//! ## Lifecycle choice
//!
//! - `github_app` is the recommended path for any aeqi installation that
//!   wants per-installation credential scoping (different orgs / repos
//!   in different installations). Bootstrap requires `app_id`,
//!   `private_key_pem`, and an `installation_id` captured from the
//!   GitHub App install flow. Lifecycle handles minting + caching the
//!   short-lived installation token; the substrate refreshes on 401.
//! - `oauth2` is the fallback for individual users who already have a
//!   PAT-shaped flow set up (e.g. via `gh auth login` style consent).
//!   Same tool surface; the credential row's `lifecycle_kind` is the
//!   only difference.
//!
//! Both lifecycles populate `UsableCredential.headers` with an
//! `Authorization` header — `Bearer <token>` for OAuth and the canonical
//! installation token shape for `github_app`. The tools read whichever
//! header the lifecycle wrote, falling back to `token <bearer>` (GitHub
//! accepts either `Bearer` or `token` for installation tokens).
//!
//! ## Auth header semantics
//!
//! GitHub historically required `Authorization: token <token>` for
//! installation tokens; recent docs accept `Authorization: Bearer
//! <token>` for both PATs and installation tokens. We honour whatever
//! the lifecycle put on `UsableCredential.headers` and fall back to
//! `token <bearer>` only when no header was set — that matches the
//! GitHub App docs verbatim and avoids breaking older Enterprise
//! deployments.
//!
//! ## Permissions
//!
//! Each tool declares its narrowest permission set via
//! `required_credentials()` — the bootstrap flow requests the union of
//! declared permissions for the tools the agent enables. See
//! `meta:pack:github` in the seed pack for the full mapping.
//!
//! ## Pagination
//!
//! List endpoints follow the Link-header `rel="next"` chain up to a
//! cap of 200 results (2 pages × 100 per page) to bound runtime. The
//! cap is documented per-tool and surfaced in `ToolResult.data.truncated`.

pub mod api;
pub mod files;
pub mod issues;
pub mod prs;
pub mod releases;
pub mod search;

pub use api::{API_BASE, GithubApiClient, GithubApiError};

/// Stable provider key used by every tool's `CredentialNeed`.
pub const PROVIDER: &str = "github";

/// Stable credential name. Both lifecycles use this single row name —
/// `github_app` stores its `(app_id, private_key_pem, installation_id)`
/// blob here; `oauth2` stores its `(access_token, refresh_token)` blob.
pub const CREDENTIAL_NAME: &str = "installation_token";

/// Every tool this pack ships, ready to register on a `ToolRegistry`.
/// Wired from `aeqi-orchestrator::tools::register_github_pack` when the
/// `github` feature is enabled.
pub fn all_tools() -> Vec<std::sync::Arc<dyn aeqi_core::traits::Tool>> {
    let mut tools = Vec::new();
    tools.extend(issues::all_tools());
    tools.extend(prs::all_tools());
    tools.extend(files::all_tools());
    tools.extend(releases::all_tools());
    tools.extend(search::all_tools());
    tools
}
