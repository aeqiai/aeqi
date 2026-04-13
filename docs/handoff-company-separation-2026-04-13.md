# Handoff: Company-Native Runtime / Platform Separation

Date: 2026-04-13

This handoff captures the current state of the runtime/platform separation work, the decisions that are now considered settled, what shipped, and what Claude should do next.

## Current Position

The key semantic decision is now explicit:

- `Company` is a kernel primitive
- it should not be renamed to `Workspace`

The correct separation is not:

- runtime = workspace
- platform = company

The correct separation is:

- runtime owns `Company` plus AEQI execution state
- platform owns `Account`, memberships, billing, placement, and operated infrastructure

This means:

- self-hosted/runtime mode can legitimately have multiple companies
- company selection is real in both runtime and platform mode
- `CompanyPage` is a runtime-native page, not a SaaS-only page
- `AccountPage` remains platform-only

## What Shipped

### 1. Explicit app mode bootstrap

The backend bootstrap contract now reports app mode explicitly:

- runtime returns `app_mode: "runtime"` in [crates/aeqi-web/src/routes/auth.rs](/home/claudedev/aeqi/crates/aeqi-web/src/routes/auth.rs:128)
- platform returns `app_mode: "platform"` in [aeqi-platform/src/server.rs](/home/claudedev/aeqi-platform/src/server.rs:408)

This is the UI switch for runtime-vs-platform shell behavior.

### 2. Mode-aware UI shell without sacrificing company semantics

The shared UI route tree now branches by app mode in [apps/ui/src/App.tsx](/home/claudedev/aeqi/apps/ui/src/App.tsx:1), but company routes remain available in both modes:

- `/company` works in runtime and platform mode
- `/companies` works in runtime and platform mode
- legacy `/workspace` redirects to `/company`
- `AccountPage` remains platform-only
- treasury/drive/apps/market remain platform-only

The sidebar and command palette were corrected to be company-first again in:

- [apps/ui/src/components/AppLayout.tsx](/home/claudedev/aeqi/apps/ui/src/components/AppLayout.tsx:1)
- [apps/ui/src/components/CommandPalette.tsx](/home/claudedev/aeqi/apps/ui/src/components/CommandPalette.tsx:1)
- [apps/ui/src/components/WorkspaceSwitcher.tsx](/home/claudedev/aeqi/apps/ui/src/components/WorkspaceSwitcher.tsx:1)

### 3. Company scoping restored to shared transport paths

The earlier workspace-style cut incorrectly suppressed company scoping in runtime mode.
That has been corrected.

The selected company is now sent in both runtime and platform mode through:

- generic API client [apps/ui/src/lib/api.ts](/home/claudedev/aeqi/apps/ui/src/lib/api.ts:1)
- daemon websocket [apps/ui/src/hooks/useDaemonSocket.ts](/home/claudedev/aeqi/apps/ui/src/hooks/useDaemonSocket.ts:1)
- event websocket [apps/ui/src/hooks/useWebSocket.ts](/home/claudedev/aeqi/apps/ui/src/hooks/useWebSocket.ts:1)
- chat stream [apps/ui/src/components/AgentSessionView.tsx](/home/claudedev/aeqi/apps/ui/src/components/AgentSessionView.tsx:1)

### 4. Company page is now mode-aware

[apps/ui/src/pages/CompanyPage.tsx](/home/claudedev/aeqi/apps/ui/src/pages/CompanyPage.tsx:1) now treats company runtime keys correctly:

- in platform mode it still references the account `ak_` key
- in runtime mode it drops that assumption and treats company keys as the company-level runtime credentials

### 5. Architecture doc rewritten around company-native doctrine

[docs/runtime-platform-separation.md](/home/claudedev/aeqi/docs/runtime-platform-separation.md:1) now reflects the actual model:

- keep `Company` in the runtime
- move platform-business concepts out
- keep company pages shared
- keep account/control-plane surfaces platform-only

## Verification

Passed:

- `npm run build` in `/home/claudedev/aeqi/apps/ui`

I did not rerun Rust tests in this pass because the code changes here were UI/docs only.

## What Is Still Left

### 1. Remove direct runtime DB mutation from platform

This is the biggest remaining separation violation.

[aeqi-platform/src/host.rs](/home/claudedev/aeqi-platform/src/host.rs:304) still contains:

- `configure_runtime_state(company_name)`

That function opens the runtime SQLite DB directly and mutates runtime-owned tables.

This is architecturally wrong even if it currently works.

Target state:

- each runtime owns its own DB completely
- the platform never opens or patches runtime DB internals
- initialization happens through runtime APIs / IPC contracts only

### 2. Move toward clean-start + runtime pull/init

The preferred model is now:

1. platform creates runtime
2. runtime boots cleanly with minimal bootstrap identity/config
3. runtime pulls or accepts a typed initialization payload
4. runtime creates its own company state
5. runtime installs ideas/events/agents/templates itself

This should replace push-style state patching.

### 3. Keep runtime DB as live source of truth, add global pull store for reusable artifacts

The agreed direction is:

- runtime DB owns all live mutable company state
- a global store can hold reusable templates and packs

Good candidates for global pull/install:

- company templates
- agent templates
- event definitions/templates
- idea packs

These should be pulled into the runtime and materialized locally.

The global store should not act like the runtime's live authority.

### 4. Pull hosted access policy out of core daemon semantics

The runtime still has hosted-style access policy wired through:

- [crates/aeqi-orchestrator/src/daemon.rs](/home/claudedev/aeqi/crates/aeqi-orchestrator/src/daemon.rs:929)
- [crates/aeqi-orchestrator/src/ipc/tenancy.rs](/home/claudedev/aeqi/crates/aeqi-orchestrator/src/ipc/tenancy.rs:1)

`allowed_companies` is not wrong functionally, but it is still a platform-shaped access policy leaking into the kernel dispatch path.

Target state:

- runtime keeps company identity and company CRUD
- hosted adapters/proxies can still enforce which companies an account may access
- core daemon semantics should not be defined around account-derived allowlists

### 5. Finish shell cleanup

The product language is mostly corrected, but there is still compatibility residue:

- file/component names like `NewWorkspacePage` and `WorkspaceSwitcher`
- the legacy `/workspace` redirect

This is cleanup, not a semantic blocker.

### 6. Split shells more cleanly later

The current UI is mode-aware but still largely one branched shell.

Longer term it should become:

- `RuntimeLayout`
- `PlatformLayout`

Shared pages can stay shared.
The outer shell should become less conditional over time.

## Event Model Thoughts

The current conceptual direction from the founder discussion is:

- agents should reference events by ID
- multiple agents can use the same event
- an event is a reusable definition
- the event is the combination of trigger type plus idea references and reaction semantics

The likely clean shape is:

- `Agent` owns `event_ids` or `event_bindings`
- `Event` owns trigger/match/idea/action definition
- `Quest` owns live state created when an event fires

Important nuance:

- event definition state should live on the event
- event invocation/runtime state should not live on the event itself
- if per-agent variation is needed, use bindings rather than mutating the shared event definition

Likely eventual pattern:

```ts
Agent {
  id
  event_bindings: [{ event_id, enabled, extra_idea_ids }]
}

Event {
  id
  trigger
  filters
  idea_ids
  action
}
```

## Recommended Next Steps For Claude

Do these in order.

### Step 1. Eliminate `configure_runtime_state()`

In `aeqi-platform`:

- remove direct runtime DB mutation from [src/host.rs](/home/claudedev/aeqi-platform/src/host.rs:304)
- replace it with an explicit runtime initialization flow

Likely shape:

- new runtime IPC/API command to initialize or reconcile a company
- platform calls that command after runtime health succeeds
- runtime persists its own company repo/workdir state internally

### Step 2. Formalize bootstrap/install contract

Define a typed install/init payload for runtime pull/setup:

- company identity
- template/pack ids
- seed ideas
- seed agents
- seed events

The runtime should own the write path.

### Step 3. Design the global store manifest

Define versioned pull/install manifests for:

- company templates
- agent templates
- event packs
- idea packs

Also record local provenance:

- source
- version
- installed_at
- updated_from

### Step 4. Extract hosted tenancy policy behind adapters

Stop threading `allowed_companies` so deep through daemon core dispatch.

Move toward:

- runtime-native company operations in the core
- hosted access policy at the API/adapter/proxy boundary

### Step 5. Continue UI shell split

Keep the current semantics, then later:

- rename leftover workspace-oriented component/file names
- introduce clearer `RuntimeLayout` / `PlatformLayout`
- keep shared company pages shared

## Summary Judgment

The system is in a better state than before:

- the UI now matches the ontology better
- the company/runtime/platform split is clearer
- the doctrine is now written down

The biggest unresolved issue is no longer philosophy.
It is infrastructure rigor:

- runtime-owned DB
- runtime-owned initialization
- platform as orchestrator, not storage mutator

That is the next bar.
