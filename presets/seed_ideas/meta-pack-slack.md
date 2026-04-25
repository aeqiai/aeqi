---
name: meta:pack:slack
tags: [meta, pack-infrastructure, integration]
description: Native Slack tools (W3). Fourteen tools across channels / messages / reactions / users / search backed by T1.9's oauth2 lifecycle. Per-workspace scoping — each Slack workspace install carries its own bot token row.
---

# pack:slack

Crate: `aeqi-pack-slack`
Feature: `aeqi-orchestrator` default feature `slack`
Branch: `pack/slack`

## What's in the pack

Fourteen native tools across five categories, all per-workspace-scoped
(`ScopeHint::User`, `scope_id` = Slack workspace_id).

### Channels (4)

- `slack.channels.list(types?, exclude_archived?)` — list channels.
  `types` is a comma-separated subset of
  `public_channel | private_channel | mpim | im` (default
  `public_channel`); `exclude_archived` defaults to true. Pagination
  caps at 200 results; result sets `truncated=true` when more pages
  remain.
- `slack.channels.info(channel)` — single channel metadata.
- `slack.channels.create(name, is_private?)` — open a new channel.
  Slack normalises the name (lowercase + hyphens). `is_private` defaults
  to false.
- `slack.channels.archive(channel)` — archive a channel by id. Slack
  rejects archiving #general and surfaces the upstream error verbatim.

### Messages (4)

- `slack.messages.post(channel, text, blocks?, thread_ts?)` — post a
  message. Pass plain `text` (always required as a notification
  fallback) and optionally a Block Kit `blocks` array (dispatched as
  JSON when present) and `thread_ts` (reply in-thread).
- `slack.messages.update(channel, ts, text?, blocks?)` — edit a
  previously posted message. At least one of `text` / `blocks` must be
  provided.
- `slack.messages.delete(channel, ts)` — delete a message by `(channel,
  ts)`. Bots can only delete their own posts unless granted
  `chat:write.customize`.
- `slack.messages.history(channel, oldest?, latest?)` — read recent
  messages newest-first. Pagination caps at 200.

### Reactions (2)

- `slack.reactions.add(channel, ts, name)` — add an emoji reaction.
  `name` is the shortcode without colons (the tool tolerates and strips
  leading/trailing colons).
- `slack.reactions.remove(channel, ts, name)` — remove an emoji
  reaction.

### Users (3)

- `slack.users.list(include_deleted?)` — list workspace members.
  `include_deleted` defaults to false; the tool also strips deleted
  members locally before returning. Pagination caps at 200.
- `slack.users.info(user)` — single user metadata. Returns id / name /
  real_name / is_bot / is_admin / tz / email / display_name / title.
- `slack.users.lookup_by_email(email)` — find a user by email. Requires
  the additional `users:read.email` scope.

### Search (1)

- `slack.search.messages(query, max_results?)` — message search using
  Slack's syntax (e.g. `in:#general from:@alice has:link`). `max_results`
  clamps to 100. Slack's search is a paid-plan feature; free workspaces
  return `ok=false / error="paid_only"` and the tool surfaces a clean
  error with the upstream string in `data.slack_error`.

## OAuth scopes

Each tool declares the narrowest scope it requires. The bootstrap flow
asks for the union of declared scopes for the tools the agent enables.

| Tool                         | Scope(s) |
|------------------------------|----------|
| `slack.channels.list`        | `channels:read` (+ `groups:read` / `mpim:read` / `im:read` for non-public types) |
| `slack.channels.info`        | `channels:read` |
| `slack.channels.create`      | `channels:manage` |
| `slack.channels.archive`     | `channels:manage` |
| `slack.messages.post`        | `chat:write` |
| `slack.messages.update`      | `chat:write` |
| `slack.messages.delete`      | `chat:write` |
| `slack.messages.history`     | `channels:history` (+ `groups:read` for private) |
| `slack.reactions.add`        | `reactions:write` |
| `slack.reactions.remove`     | `reactions:write` |
| `slack.users.list`           | `users:read` |
| `slack.users.info`           | `users:read` |
| `slack.users.lookup_by_email`| `users:read`, `users:read.email` |
| `slack.search.messages`      | `search:read` (paid plan) |

## Per-workspace scoping

Each Slack workspace gets its own credential row keyed by
`(scope_kind=user, scope_id=<workspace_id>, provider=slack,
name=bot_token)`. The pack chose `ScopeHint::User` because the
substrate's `User` axis is the per-tenant identifier aeqi already has —
the orchestrator passes the workspace_id through `ResolutionScope.user_id`
the same way it would pass a Slack user identifier.

Two workspaces, two rows, two distinct bot tokens. The bootstrap UI
surfaces a connection per workspace; tools dispatching against
workspace A never see workspace B's channels.

## Lifecycle — oauth2

Slack uses a standard OAuth2 + bot token flow. Bootstrap a row via the
substrate:

```
provider:        "slack"
name:            "bot_token"
scope_kind:      "user"
scope_id:        "<workspace_id>"   (Slack `team_id`, e.g. T0123ABCD)
lifecycle_kind:  "oauth2"
plaintext_blob: { access_token: "xoxb-...", refresh_token: "xoxe-...", token_type: "Bearer", scope: "..." }
metadata: {
    "provider_kind": "slack",
    "auth_url":      "https://slack.com/oauth/v2/authorize",
    "token_url":     "https://slack.com/api/oauth.v2.access",
    "client_id":     "<your slack app client_id>",
    "scopes":        ["chat:write", "channels:read", ...],
    "redirect_uri":  "<your callback>"
}
```

Refresh-on-401 is handled by the framework: tools surface
`reason_code=auth_expired` (and the credential_id) on a 401 or on the
canonical "dead token" Slack error markers (`invalid_auth`,
`token_expired`, `token_revoked`, `not_authed`); `ToolRegistry::invoke`
catches the marker, calls `CredentialResolver::refresh_by_id`, and
retries the tool exactly once with the rotated bot token.

The pack does NOT hardcode any OAuth client_id / secret — the operator
supplies one at bootstrap time.

## Slack quirks the pack handles

1. **`ok` envelope.** Every Slack method returns HTTP 200 with
   `{ok: true|false, ...}`. The api client treats `ok=false` as a
   logical error and translates the upstream `error` string through
   `SlackApiError`. Auth-related errors (`invalid_auth`, `token_expired`,
   `token_revoked`, `not_authed`) collapse onto `AuthExpired` so the
   substrate refreshes once. `ratelimited` collapses onto
   `RateLimited`. Everything else surfaces as `slack_error` with the
   string preserved in `data.slack_error`.
2. **Rate limits.** A 429 (or the body marker above) maps to
   `reason_code=rate_limited` with the `Retry-After` seconds when
   present — distinct from `auth_expired` so the dispatch boundary
   does not waste a refresh round trip.
3. **Cursor pagination.** Every list endpoint walks
   `response_metadata.next_cursor` up to a hard cap of 200 results
   (matching W2's pagination cap). Results expose `truncated=true`
   when more pages remained.
4. **Form vs JSON dispatch.** Most write methods accept either
   `application/x-www-form-urlencoded` or JSON. The pack uses form
   encoding for plain string args (uniform with curl-style examples)
   and switches to JSON only when the payload includes Block Kit
   `blocks` arrays that don't survive form encoding.
5. **Search is premium-only.** `slack.search.messages` returns
   `ok=false / error="paid_only"` (or `not_authed` / `missing_scope`)
   on free workspaces. The tool surfaces a clean error with the
   upstream string so the agent can fall back gracefully.

## Setup

1. Register a Slack app at api.slack.com/apps with the bot scopes listed
   above. Capture the `client_id` and `client_secret`.
2. Install the app to each Slack workspace you want aeqi to operate
   against. The OAuth callback yields a bot token (`xoxb-...`) and a
   `team_id` — that's the `workspace_id` aeqi keys credentials by.
3. Bootstrap an `oauth2` row per workspace via the substrate. Each row
   stores its own access_token + refresh_token; the lifecycle handles
   rotation on 401.

## Tests

Sixteen integration cases in `crates/aeqi-pack-slack/tests/slack.rs`
plus two unit tests in `src/api.rs`. Mock Slack endpoints via axum on
OS-assigned ports — no real network calls. Covers each tool's request
shape, refresh-on-401 retry (oauth2 lifecycle), per-workspace
isolation, missing-credential, cursor-based pagination (200-item cap +
truncated flag), HTTP 429 rate-limit → `rate_limited` reason code,
and `ok=false` body translation (paid_only + users_not_found).
