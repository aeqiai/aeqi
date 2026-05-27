# AEQI Browser Capability Contract

Status: first contract slice.

AEQI should treat browser control as a governed execution capability, not as a
manual operator habit or a blanket dependency on one browser binary. The first
native surface is the `browser` MCP tool. It is deliberately read-only today:
agents can inspect the contract with `browser(action="capabilities")`, but
mutable browser actions remain disabled until session storage, artifacts, and
role checks are wired end to end.

## Product Decision

Browser work belongs inside quests. A browser session must have an owning
`quest_id`, actor attribution, role context, and replayable evidence. That keeps
web interaction aligned with AEQI's primitives: Quests own the work, Events
record action history, Ideas capture durable findings, Apps/Credentials provide
scoped secrets, and Roles decide authority.

This is not a replacement for Playwright tests. Playwright remains the default
backend for deterministic UI QA and visual validation. Agent-oriented browser
backends can be piloted behind the same contract once the evidence and
authorization path is stable.

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

Current read-only actions:

- `capabilities`
- `policy`
- `status`

Planned mutable actions:

- `open`
- `click`
- `type`
- `select`
- `wait`
- `screenshot`
- `snapshot`
- `extract`
- `close`

The current implementation returns `status: "contract_only"` for read actions
and rejects mutable actions with a clear error. The next slice should create a
local Playwright-backed session runner that emits event rows and screenshot
artifacts before exposing any destructive web action to agents.
