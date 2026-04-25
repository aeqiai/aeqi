---
name: meta:pack:google-workspace
tags: [meta, pack-infrastructure, integration]
description: Native Gmail / Calendar / Meet tools (W1). Eleven tools backed by T1.9's oauth2 lifecycle, scoped per agent — separate Workspace credentials per agent. The first wisdom-pack content built on the credential substrate.
---

# pack:google-workspace

Crate: `aeqi-pack-google-workspace`
Feature: `aeqi-orchestrator` default feature `google-workspace`
Branch: `pack/google-workspace`

## What's in the pack

Eleven native tools, all per-agent-scoped (`ScopeHint::Agent`):

### Gmail (5)
- `gmail.search(query, max_results?)` — search the agent's mailbox using
  Gmail search syntax. Returns id / from / subject / snippet / timestamp /
  thread_id per match.
- `gmail.read(message_id)` — full body (plain text + HTML) plus
  attachment metadata for one message.
- `gmail.send(to, cc?, bcc?, subject, body, reply_to_thread_id?)` —
  RFC 5322 send. Returns the new message_id and threadId.
- `gmail.label(message_id, add_labels?, remove_labels?)` — apply / remove
  labels by id (INBOX, UNREAD, custom Label_123).
- `gmail.archive(message_id)` — remove the INBOX label (Gmail's
  archive semantic).

### Calendar (4)
- `calendar.list_events(time_min, time_max, calendar_id?)` — RFC3339 time
  window query, default calendar `primary`.
- `calendar.create_event(title, start, end, attendees?, description?, location?, conferencing_meet?, calendar_id?)`
  — set `conferencing_meet=true` to attach a Google Meet via
  `conferenceData.createRequest`. Returns event_id and the Meet link
  when one is provisioned.
- `calendar.update_event(event_id, …)` — PATCH semantics. Only the fields
  passed are sent; Calendar preserves the rest.
- `calendar.delete_event(event_id, calendar_id?)` — irreversible.

### Meet (2)
- `meet.create(topic, duration_minutes?, attendees?)` — implementation
  detail: posts a calendar event with `conferenceData.createRequest`,
  returns the Meet join link. Google's first-party Meet API is too
  limited to handle this directly on consumer accounts.
- `meet.list_active()` — currently-running meetings (calendar events
  spanning "now" with a Meet conference link).

## OAuth scopes

Each tool declares the narrowest scope it needs. The bootstrap consent
flow requests the union of declared scopes for whatever tools the agent
is enabling.

| Tool | Scope |
|---|---|
| `gmail.search`, `gmail.read` | `https://www.googleapis.com/auth/gmail.readonly` |
| `gmail.send`, `gmail.label`, `gmail.archive` | `https://www.googleapis.com/auth/gmail.modify` |
| `calendar.list_events` | `https://www.googleapis.com/auth/calendar.readonly` |
| `calendar.create_event` / `update_event` / `delete_event` | `https://www.googleapis.com/auth/calendar` |
| `meet.create` / `list_active` | `https://www.googleapis.com/auth/calendar` |

`gmail.modify` covers `gmail.readonly`; `calendar` covers
`calendar.readonly` and `calendar.events`. The pack honours that
hierarchy in `scope_satisfied()` so a wider stored scope satisfies a
narrower required scope without re-requesting consent.

## Per-agent isolation

Every credential need declares `ScopeHint::Agent` — the substrate
resolves to a row keyed by `(scope_kind=agent, scope_id=<agent_id>,
provider=google, name=oauth_token)`. Two agents using `gmail.read` look
up two different rows, see two different mailboxes. The bootstrap UI
surfaces per-agent connections.

## Refresh-on-401

Tools surface a `reason_code=auth_expired` marker in `ToolResult.data`
on 401, including the `credential_id`. `ToolRegistry::invoke` catches
the marker, calls `CredentialResolver::refresh_by_id`, and retries the
tool exactly once. If the second attempt also returns auth_expired
(refresh actually failed), the result is surfaced verbatim — the
framework guarantees at-most-one retry.

## Setup

1. Bootstrap an OAuth2 row via the substrate's bootstrap path:
   ```
   provider: "google"
   name:     "oauth_token"
   scope_kind: "agent"
   scope_id:   "<your-agent-id>"
   lifecycle_kind: "oauth2"
   ```
2. Provider config (in the bootstrap `provider` field):
   - `auth_url`: `https://accounts.google.com/o/oauth2/v2/auth`
   - `token_url`: `https://oauth2.googleapis.com/token`
   - `revoke_url`: `https://oauth2.googleapis.com/revoke`
   - `client_id`: from your Google Cloud OAuth client (Desktop app)
   - `redirect_uri`: `http://localhost:<port>/callback` (PKCE loopback)
   - `scopes`: union of declared scopes for the tools you're enabling
3. Run consent → exchange code → row inserts → tools begin resolving.

The pack does NOT hardcode any OAuth client_id / client_secret — the
operator supplies one at bootstrap time.

## Tests

Fifteen tests in `crates/aeqi-pack-google-workspace/tests/google_workspace.rs`.
Mock Google endpoints via axum on OS-assigned ports — no real network
calls. Covers each tool's request shape, refresh-on-401 (success and
failure), per-agent isolation, and scope mismatch.
