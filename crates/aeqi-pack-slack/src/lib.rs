//! `pack:slack` — native Slack tools backed by T1.9's `oauth2`
//! lifecycle (Slack uses the standard OAuth2 + bot-token flow).
//!
//! Fourteen tools across five categories, all per-workspace-scoped
//! (`ScopeHint::User` with the Slack workspace_id as `scope_id`):
//!
//! | Category   | Tools |
//! | ---------- | ----- |
//! | Channels   | `slack.channels.list` / `.info` / `.create` / `.archive` |
//! | Messages   | `slack.messages.post` / `.update` / `.delete` / `.history` |
//! | Reactions  | `slack.reactions.add` / `.remove` |
//! | Users      | `slack.users.list` / `.info` / `.lookup_by_email` |
//! | Search     | `slack.search.messages` |
//!
//! ## Per-workspace scoping
//!
//! Slack issues a bot token per workspace install. The substrate stores
//! one row per workspace, keyed by
//! `(scope_kind=user, scope_id=<workspace_id>, provider=slack,
//! name=bot_token)`. The pack uses `ScopeHint::User` because the
//! credential substrate's `User` axis maps directly to "workspace
//! identity" for Slack — every install belongs to one Slack team and
//! every tool dispatches against that team. Two workspaces, two rows,
//! two distinct credentials.
//!
//! ## OAuth scopes
//!
//! Each tool declares the narrowest scope subset it requires via
//! `required_credentials()`. The bootstrap flow asks for the union; the
//! seed (`meta:pack:slack`) lists the full table. Note that
//! `search:read` is gated to paid Slack plans — `slack.search.messages`
//! surfaces a clean error from the Slack response when the workspace is
//! free-tier.
//!
//! ## API surface
//!
//! Slack's Web API lives at `https://slack.com/api/<method>`. Most
//! methods accept either `application/x-www-form-urlencoded` or JSON;
//! we use form encoding for plain string args (keeps shapes uniform
//! with curl-style examples in the seed) and JSON for tools that pass
//! arrays / blocks. Every response is HTTP 200 wrapping a JSON envelope
//! `{ ok: true|false, ... }` — `ok=false` is a logical error and
//! translated through the same `reason_code` path the substrate already
//! uses for HTTP-level failures.
//!
//! ## Pagination
//!
//! Slack uses `cursor`-based pagination; every list endpoint returns a
//! `response_metadata.next_cursor` field. The pack walks cursors up to
//! a hard cap of 200 results (matching W2's pagination cap) and surfaces
//! `truncated=true` on the result `data` when more pages were available.
//!
//! ## Refresh-on-401 / rate limits
//!
//! Slack returns `401 Unauthorized` with body `{ok: false, error:
//! "invalid_auth"}` on dead tokens. The api client maps both the HTTP
//! status and the body marker onto `SlackApiError::AuthExpired` so the
//! framework's `ToolRegistry::invoke` can refresh the OAuth2 row and
//! retry exactly once.
//!
//! Slack rate-limits per-method per-tier; an over-quota call returns
//! `429 Too Many Requests` with a `Retry-After` header. The api client
//! maps that onto `SlackApiError::RateLimited` carrying the retry-after
//! seconds when present — distinct `reason_code=rate_limited` so the
//! dispatch boundary does not waste a refresh round trip.

pub mod api;
pub mod channels;
pub mod messages;
pub mod reactions;
pub mod search;
pub mod users;

pub use api::{API_BASE, SlackApiClient, SlackApiError};

/// Stable provider key used by every tool's `CredentialNeed`.
pub const PROVIDER: &str = "slack";

/// Stable credential name. The OAuth2 row stores Slack's
/// `xoxb-…` bot token as `access_token`.
pub const CREDENTIAL_NAME: &str = "bot_token";

/// Every tool this pack ships, ready to register on a `ToolRegistry`.
/// Wired from `aeqi-orchestrator::tools` when the `slack` feature is
/// enabled.
pub fn all_tools() -> Vec<std::sync::Arc<dyn aeqi_core::traits::Tool>> {
    let mut tools = Vec::new();
    tools.extend(channels::all_tools());
    tools.extend(messages::all_tools());
    tools.extend(reactions::all_tools());
    tools.extend(users::all_tools());
    tools.extend(search::all_tools());
    tools
}
