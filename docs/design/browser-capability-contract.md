# AEQI Browser Capability Contract

Status: first execution slice.

AEQI should treat browser control as a governed execution capability, not as a
manual operator habit or a blanket dependency on one browser binary. The first
native surface is the `browser` MCP tool. Agents can inspect the contract with
`browser(action="capabilities")` and can now run one-shot Playwright captures
with `browser(action="open", ...)` or `browser(action="screenshot", ...)`.
Mutating browser actions remain disabled until persistent sessions, artifact
review, and stop controls are wired end to end.

## Product Decision

Browser work belongs inside quests. A browser session must have an owning
`quest_id`, actor attribution, role context, and replayable evidence. That keeps
web interaction aligned with AEQI's primitives: Quests own the work, Events
record action history, Ideas capture durable findings, Apps/Credentials provide
scoped secrets, and Roles decide authority.

This is not a replacement for Playwright tests. Playwright remains the default
backend for deterministic UI QA, visual validation, and the first browser MCP
execution slice. Agent-oriented browser backends can be piloted behind the same
contract once the evidence and authorization path is stable.

## Backend Order

1. `playwright` is the default backend for local deterministic execution,
   screenshots, and app verification.
2. `agent-browser` is the pilot backend for agent-native page state and session
   continuity.
3. `cloakbrowser` is an optional backend for blocked workflows only. It must not
   become the global default because patched browser binaries expand the
   maintenance, trust, and policy surface.

## Required Controls

- Every mutable session requires a `quest_id`.
- Every action records actor, role, backend, target URL or selector, timestamp,
  and result.
- Credentials resolve through AEQI credential scopes; agents do not receive raw
  secrets.
- Screenshots, accessibility snapshots, DOM snapshots, and network summaries are
  stored as quest evidence.
- Human takeover and stop controls are available before high-risk actions.
- Browser sessions are disposable by default; long-lived profile reuse must be
  explicit and scoped.

## MCP Shape

Current actions:

- `capabilities`
- `policy`
- `status`
- `open`
- `screenshot`

`open` and `screenshot` require:

- `quest_id`
- `url`
- `agent_id`, unless the MCP context already supplies one

The action opens the URL through Playwright, captures a PNG screenshot, captures
a compact JSON snapshot, and stores both through the existing `files_upload`
path as agent-scoped Drive/Idea evidence.

Planned mutable/session actions:

- `click`
- `type`
- `select`
- `wait`
- `extract`
- `close`

The current implementation returns `status: "playwright_capture_enabled"` for
read actions and rejects mutating page actions with a clear error. The next
slice should introduce durable browser session records and an activity event per
browser action before exposing click/type/select to agents.
