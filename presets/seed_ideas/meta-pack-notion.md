---
name: meta:pack:notion
tags: [meta, pack-infrastructure, integration]
description: Native Notion tools (W4). Twelve tools across pages / databases / blocks / users backed by T1.9's oauth2 lifecycle. Per-workspace scoping — each Notion workspace install carries its own credential row.
---

# pack:notion

Crate: `aeqi-pack-notion`
Feature: `aeqi-orchestrator` default feature `notion`
Branch: `pack/notion`

## What's in the pack

Twelve native tools across four categories, all per-workspace-scoped
(`ScopeHint::User` with `scope_id=<workspace_id>`):

### Pages (5)

- `notion.pages.search(query?, filter_object?)` — search the workspace
  for pages and databases the integration has access to. Optional
  `filter_object` ∈ `page | database` constrains the result. Pagination
  caps at 200; `truncated=true` when more cursors remained.
- `notion.pages.get(page_id)` — page metadata + immediate children
  blocks (cap 200, `truncated=true` when more existed). Drill deeper
  via `notion.blocks.get`.
- `notion.pages.create(parent, properties, children?)` — new page.
  `parent` is Notion's parent shape; `properties` matches the database
  schema when the parent is a database. Returns id + url.
- `notion.pages.update(page_id, properties?, archived?)` — PATCH page
  properties and/or `archived` flag. At least one must be set.
- `notion.pages.append_blocks(block_id, children)` — append block
  children. Notion caps each call at 100; oversized arrays are
  **chunked transparently** into sequential calls and the response
  surfaces `chunks` so callers can reason about partial failure if a
  later chunk hits a rate limit.

### Databases (3)

- `notion.databases.query(database_id, filter?, sorts?)` — filtered +
  sorted query. Each row's heterogeneous `properties` is passed through
  verbatim. Pagination caps at 200.
- `notion.databases.get_schema(database_id)` — read the database's
  schema (column name → property-type config), title, parent.
- `notion.databases.create_row(database_id, properties, children?)` —
  new database entry. The pack injects the `{database_id: ...}` parent
  shape automatically; the caller passes only properties + optional
  child blocks.

### Blocks (3)

- `notion.blocks.get(block_id)` — read a block + its immediate children
  (cap 200, `truncated=true`). Pages are blocks too; this is the
  drill-down API.
- `notion.blocks.update(block_id, patch)` — edit block content. `patch`
  is Notion's heterogeneous block-update shape (e.g.
  `{paragraph: {rich_text: [...]}}`) and is passed through verbatim.
- `notion.blocks.delete(block_id)` — archive (soft-delete) a block.

### Users (1)

- `notion.users.list()` — workspace members + integration bots.
  Pagination caps at 200; returns id / name / type (person | bot) /
  avatar_url plus the type-specific `person` or `bot` envelope.

## OAuth scopes

Notion's OAuth grants are workspace-wide today — no granular scopes
(no `read:pages`, `write:pages`, etc.). The bot installs to a
workspace and gets access to whatever pages the user shared with it.
`required_credentials()` declares `provider="notion"` with an empty
`oauth_scopes` list, matching the W2 GitHub pack's convention for
"no specific scope to validate".

## Per-workspace scoping

`ScopeHint::User` resolves a row keyed by
`(scope_kind=user, scope_id=<workspace_id>, provider=notion,
name=oauth_token)`. Two workspaces look up two different rows and so
see two distinct bot tokens. The bootstrap UI surfaces per-workspace
connections — the operator installs the integration once per Notion
workspace, and aeqi keys the credential by the `workspace_id` returned
in the OAuth token response.

## API base + version

- Base: `https://api.notion.com/v1/<endpoint>`
- Header: `Notion-Version: 2022-06-28` — pinned at the well-documented
  release that has been stable since launch. Bumping is a deliberate
  code change.
- Header: `Authorization: Bearer <token>` — bot integration token.
- Header: `Content-Type: application/json` for POST / PATCH.

## Lifecycle — oauth2

The substrate's `oauth2` lifecycle handles the token refresh path on
401 transparently. The Notion bot token is bound to the workspace at
install time; the lifecycle handles refresh against Notion's token
endpoint exactly the same way as Google Workspace and GitHub OAuth.

## Refresh-on-401

Tools surface a `reason_code=auth_expired` marker in `ToolResult.data`
on 401, including the `credential_id`. `ToolRegistry::invoke` catches
the marker, calls `CredentialResolver::refresh_by_id`, and retries the
tool exactly once.

## Rate limiting

Notion documents an average rate of 3 requests/second per integration.
429 responses map to `reason_code=rate_limited` (with the upstream
`Retry-After` seconds when present) — distinct from `auth_expired` so
the dispatch boundary does not waste a refresh round trip. The agent
should back off until `retry_after` elapses.

## Pagination

Every list / search / database-query endpoint follows Notion's
`next_cursor` / `has_more` envelope. The pack walks the chain up to a
hard cap of 200 results and surfaces `truncated=true` when more
cursors remained — same vocabulary as W2 / W3.

## Block-append chunking

Notion caps `blocks.children.append` at 100 children per call.
`notion.pages.append_blocks` chunks oversized arrays transparently
into sequential PATCH calls (rather than surfacing an error and
asking the caller to chunk). The response surfaces `chunks` and
`appended` so callers can reason about partial failure if a later
chunk hits a rate limit.

## Property pass-through

Notion's database properties are heterogeneous (title vs rich_text vs
relation vs select vs multi_select vs date vs people vs formula vs
...). The pack does **not** flatten these into a typed Rust shape —
every tool returns `properties` as `serde_json::Value` exactly as
Notion served it. The agent introspects directly. This matches the
plan's "don't try to deserialize properties JSON into typed Rust
structs" rule.

## Setup

1. Register a public Notion integration at
   <https://www.notion.so/my-integrations>. Capture the `client_id` /
   `client_secret`.
2. Run the OAuth consent flow against the operator's Notion workspace —
   Notion redirects with a one-time code; the substrate exchanges it
   for a bot token + `workspace_id`.
3. Bootstrap the credential row via the substrate:
   ```
   provider:        "notion"
   name:            "oauth_token"
   scope_kind:      "user"
   scope_id:        "<workspace_id>"
   lifecycle_kind:  "oauth2"
   blob: {
       "access_token":  "<notion bot token>",
       "refresh_token": "<refresh token>",
       "token_type":    "Bearer",
       "scope":         ""
   }
   metadata: {
       "provider_kind": "notion",
       "auth_url":      "https://api.notion.com/v1/oauth/authorize",
       "token_url":     "https://api.notion.com/v1/oauth/token",
       "client_id":     "<integration client id>",
       "scopes":        [],
       "redirect_uri":  "https://your-app.example.com/callback"
   }
   ```
4. Tools begin resolving immediately for that workspace — share the
   relevant pages / databases with the integration via the Notion UI
   so it has read/write access.

The pack does NOT hardcode any OAuth client_id / client_secret — the
operator supplies one at bootstrap time.

## Tests

Sixteen integration cases in `crates/aeqi-pack-notion/tests/notion.rs`
plus eight unit tests in `src/api.rs` and `src/pages.rs`. Mock Notion
endpoints via axum on OS-assigned ports — no real network calls.
Covers each tool's request shape, refresh-on-401 retry, per-workspace
isolation, missing-credential, cursor-based pagination (cap +
truncated flag), 429 rate-limit reason code, heterogeneous property
pass-through, block-append chunking (>100 children → 3 PATCH calls),
and the `Notion-Version` header pinning.
