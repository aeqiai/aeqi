//! `pack:notion` — native Notion tools backed by T1.9's `oauth2`
//! lifecycle.
//!
//! Twelve tools across four categories, all per-workspace-scoped
//! (`ScopeHint::User` with `scope_id=<workspace_id>`):
//!
//! | Category   | Tools |
//! | ---------- | ----- |
//! | Pages      | `notion.pages.search` / `.get` / `.create` / `.update` / `.append_blocks` |
//! | Databases  | `notion.databases.query` / `.get_schema` / `.create_row` |
//! | Blocks     | `notion.blocks.get` / `.update` / `.delete` |
//! | Users      | `notion.users.list` |
//!
//! ## Lifecycle
//!
//! Notion grants a workspace-wide bot token through OAuth2. The substrate's
//! `oauth2` lifecycle handles the token refresh path on 401 transparently —
//! the bot token is bound to the workspace at install time. There are **no
//! granular OAuth scopes** today: the install picks up whatever the user
//! shares with the integration. `required_credentials()` therefore declares
//! an empty `oauth_scopes` list (matching the W2 GitHub pack's convention
//! for "no specific scope to validate").
//!
//! ## Per-workspace scoping
//!
//! `ScopeHint::User` resolves a row keyed by
//! `(scope_kind=user, scope_id=<workspace_id>, provider=notion,
//! name=oauth_token)`. Two workspaces look up two different rows and so
//! see two distinct bot tokens — the operator installs the integration
//! once per Notion workspace and aeqi keys the credential by the
//! `workspace_id` returned in the OAuth token response.
//!
//! ## Notion-Version
//!
//! Every request carries `Notion-Version: 2022-06-28`. Pinned at the
//! well-documented release that has been stable since launch. Bumping
//! the value is a deliberate code change so every tool can be reviewed
//! against any new shape.
//!
//! ## Pagination
//!
//! Every list / search / database-query endpoint follows Notion's
//! `next_cursor` / `has_more` envelope. The pack walks the chain up to
//! a hard cap of 200 results and surfaces `truncated=true` when more
//! cursors remained — same vocabulary as W2 / W3.
//!
//! ## Block-append chunking
//!
//! Notion caps `blocks.children.append` at 100 children per call. The
//! `notion.pages.append_blocks` tool transparently chunks oversized
//! arrays into multiple sequential calls (rather than surfacing an
//! error and asking the caller to chunk). The response surfaces the
//! number of chunks issued so the caller can reason about partial
//! failure if a later chunk hits a rate limit.
//!
//! ## Property pass-through
//!
//! Notion's database properties are heterogeneous (title vs rich_text vs
//! relation vs select vs multi_select vs date vs ...). The pack does
//! **not** flatten these into a typed Rust shape — it passes the raw
//! `properties` JSON object through verbatim so the agent can introspect
//! its own database's structure. Tools that read pages / database rows
//! return `properties` as `serde_json::Value` exactly as Notion served it.
//!
//! ## Refresh-on-401
//!
//! Tools surface a `reason_code=auth_expired` marker in `ToolResult.data`
//! on 401, including the `credential_id`. `ToolRegistry::invoke` catches
//! the marker, calls `CredentialResolver::refresh_by_id`, and retries the
//! tool exactly once. For Notion this re-runs the OAuth refresh against
//! the workspace's stored `refresh_token`.
//!
//! ## Rate limiting
//!
//! Notion documents an average rate of 3 requests/second per integration.
//! 429 responses are mapped to `reason_code=rate_limited` (with the
//! upstream `Retry-After` seconds when present) — distinct from
//! `auth_expired` so the dispatch boundary does not waste a refresh
//! round trip.

pub mod api;
pub mod blocks;
pub mod databases;
pub mod pages;
pub mod users;

pub use api::{
    API_BASE, APPEND_BLOCK_CHUNK, NOTION_VERSION, NotionApiClient, NotionApiError, PAGINATION_CAP,
};

/// Stable provider key used by every tool's `CredentialNeed`.
pub const PROVIDER: &str = "notion";

/// Stable credential name. Notion ships one OAuth bot token per workspace;
/// multi-account future work would extend this with a suffix
/// (e.g. `oauth_token:work` / `oauth_token:personal`).
pub const CREDENTIAL_NAME: &str = "oauth_token";

/// Every tool this pack ships, ready to register on a `ToolRegistry`.
/// Wired from `aeqi-orchestrator::tools::register_notion_pack` when the
/// `notion` feature is enabled.
pub fn all_tools() -> Vec<std::sync::Arc<dyn aeqi_core::traits::Tool>> {
    let mut tools = Vec::new();
    tools.extend(pages::all_tools());
    tools.extend(databases::all_tools());
    tools.extend(blocks::all_tools());
    tools.extend(users::all_tools());
    tools
}
