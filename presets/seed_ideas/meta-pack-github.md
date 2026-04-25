---
name: meta:pack:github
tags: [meta, pack-infrastructure, integration]
description: Native GitHub tools (W2). Sixteen tools across issues / PRs / files / releases / search backed by T1.9's github_app lifecycle (preferred) or oauth2 lifecycle. Per-installation scoping — each GitHub App installation or PAT carries its own credential row.
---

# pack:github

Crate: `aeqi-pack-github`
Feature: `aeqi-orchestrator` default feature `github`
Branch: `pack/github`

## What's in the pack

Sixteen native tools across five categories, all per-installation-scoped
(`ScopeHint::Installation`):

### Issues (5)

- `github.issues.list(owner, repo, state?, labels?, since?)` — list
  issues. Returns number / title / state / user / labels / html_url /
  comments / updated_at per match. Pagination caps at 200 results;
  result sets `truncated=true` when GitHub had more pages.
- `github.issues.get(owner, repo, number)` — full body + labels +
  assignees + comments_count.
- `github.issues.create(owner, repo, title, body?, labels?, assignees?)`
  — open a new issue. Returns the new issue number + html_url.
- `github.issues.comment(owner, repo, number, body)` — post a comment
  on an issue. Returns comment_id.
- `github.issues.close(owner, repo, number, state_reason?)` — PATCH the
  issue to `state=closed`. Optional `state_reason` ∈
  `completed | not_planned | reopened`.

### Pull requests (5)

- `github.prs.list(owner, repo, state?, base?, head?)` — list PRs.
  Pagination caps at 200.
- `github.prs.get(owner, repo, number)` — full body + head + base +
  mergeable + mergeable_state + draft + diff stats.
- `github.prs.create(owner, repo, title, head, base, body?)` — open a
  PR. Returns PR number + html_url.
- `github.prs.comment(owner, repo, number, body)` — post a
  conversation-tab comment. Routed through the issues-comments
  endpoint (every PR is also an issue with the same number).
- `github.prs.review(owner, repo, number, event, body?, comments?)` —
  submit a review. `event` ∈ `APPROVE | REQUEST_CHANGES | COMMENT`.

### Files (2)

- `github.files.read(owner, repo, path, ref?)` — single file. Returns
  decoded content (UTF-8 best-effort), sha, size. Optional `ref`
  selects a branch / tag / commit.
- `github.files.list(owner, repo, path?, ref?)` — directory listing
  (empty `path` lists the repo root). Returns name / type / size /
  sha / path per entry.

### Releases (2)

- `github.releases.list(owner, repo)` — list releases. Pagination caps
  at 200.
- `github.releases.create(owner, repo, tag_name, name?, body?, draft?, prerelease?)`
  — create a release on an existing tag.

### Search (2)

- `github.search.repos(query, max_results?)` — repository search.
- `github.search.issues(query, max_results?)` — issue+PR search.
  Returns mixed results with `is_pr` to disambiguate.

`max_results` clamps to 100 (GitHub's per-page limit).

## OAuth scopes / GitHub App permissions

Each tool declares the narrowest permission it needs. The bootstrap
flow requests the union of declared permissions for the tools the
agent enables.

| Tool category | GitHub App permission | OAuth scope |
|---|---|---|
| `github.issues.*` | `Issues: Read & write` | `repo` |
| `github.prs.*` | `Pull requests: Read & write` (+ `Issues: Read & write` for `prs.comment`) | `repo` |
| `github.files.*` | `Contents: Read` | `repo` (or `public_repo` for public-only) |
| `github.releases.list` | `Contents: Read` | `repo` |
| `github.releases.create` | `Contents: Read & write` | `repo` |
| `github.search.repos` | `Metadata: Read` | (none required for public repos) |
| `github.search.issues` | `Issues: Read` + `Pull requests: Read` | `repo` |

Plus `Metadata: Read` on every install (GitHub mandates it to surface
the repo list).

## Lifecycle choice — github_app preferred

Two lifecycles both work; the credential row's `lifecycle_kind` is the
only difference at the call site.

- **`github_app`** (recommended) — JWT-signed installation tokens.
  Bootstrap: install the GitHub App on a repo / org, capture
  `installation_id`. Lifecycle mints a 50-minute installation token on
  resolve, caches it in the row, refreshes on 401 by re-minting from
  the App's private key. Per-installation scoping (`scope_kind=installation`).
- **`oauth2`** — user-PAT-equivalent. Bootstrap: standard OAuth flow
  with `repo` scope. Lifecycle handles token refresh on 401. Same
  per-installation scoping (operators install once per account/org and
  the row carries the user's identity inside the access token).

The pack chose `ScopeHint::Installation` because that's the canonical
GitHub axis: aeqi may need separate credentials for `aeqiai/aeqi`
(installation A) vs `myorg/my-private-app` (installation B). Per-agent
scoping (à la W1) is layered above by passing `installation_id` on
the resolution scope; the substrate's lookup walks the
`(scope_kind=installation, scope_id=<installation_id>, provider=github,
name=installation_token)` key.

## Per-installation isolation

`ScopeHint::Installation` resolves to a row keyed by
`(scope_kind=installation, scope_id=<installation_id>,
provider=github, name=installation_token)`. Two installations using
`github.issues.list` look up two different rows, see two different
permission scopes. The bootstrap UI surfaces per-installation
connections.

## Refresh-on-401

Tools surface a `reason_code=auth_expired` marker in `ToolResult.data`
on 401, including the `credential_id`. `ToolRegistry::invoke` catches
the marker, calls `CredentialResolver::refresh_by_id`, and retries the
tool exactly once. For the `github_app` lifecycle this re-mints the
installation token from the App's private key; for `oauth2` it POSTs
the refresh_token to GitHub's token endpoint.

## Rate limiting

A 403 with `X-RateLimit-Remaining: 0` is mapped to
`reason_code=rate_limited` (with the upstream `X-RateLimit-Reset`
epoch when present) — distinct from `auth_expired` so the dispatch
boundary does not waste a refresh round trip. The agent should back
off until `reset_at`.

## Pagination

List endpoints follow GitHub's `Link: <...>; rel="next"` chain up to
a hard cap of 200 results (two pages × `per_page=100`). Result
payloads expose `truncated=true` when the cap is hit.

## Setup

### GitHub App (recommended)

1. Create a GitHub App with the permissions listed above. Generate a
   private key (PEM) and capture the App's numeric `app_id`.
2. Install the App on the org / repo you want aeqi to operate against.
   Capture the `installation_id` from the install URL.
3. Bootstrap a `github_app` row via the substrate:
   ```
   provider:        "github"
   name:            "installation_token"
   scope_kind:      "installation"
   scope_id:        "<installation_id>"
   lifecycle_kind:  "github_app"
   config: {
       "app_id":          "<numeric app id>",
       "private_key_pem": "-----BEGIN RSA PRIVATE KEY-----\n...\n",
       "installation_id": "<installation_id>",
       "api_base":        "https://api.github.com"
   }
   ```
4. Tools begin resolving immediately — no consent flow needed beyond
   the App install.

### OAuth (PAT-equivalent fallback)

1. Register an OAuth app on github.com with `repo` scope (and
   `public_repo` if you only need public-repo access).
2. Bootstrap an `oauth2` row via the substrate; the operator runs
   the consent flow, the row stores `access_token` + `refresh_token`.

The pack does NOT hardcode any OAuth client_id / private key — the
operator supplies one at bootstrap time.

## Tests

Twenty cases in `crates/aeqi-pack-github/tests/github.rs` plus four
unit tests in `src/api.rs`. Mock GitHub endpoints via axum on
OS-assigned ports — no real network calls. Covers each tool's
request shape, refresh-on-401 retry, per-installation isolation,
missing-credential, pagination via Link headers (cap + truncated
flag), rate-limit reason code, and the `github_app` JWT-mint path
end-to-end.
