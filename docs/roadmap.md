# Roadmap

This document connects the AEQI vision to the current codebase.

## Current Reality

AEQI already has meaningful foundations:

- a Rust workspace with a daemon, API, idea store, quest storage, and orchestration logic
- a native agent loop
- a web UI
- quest DAGs, activity tracking, budgets, and events
- provider abstraction and room for multiple model backends

What it does not yet have is full product coherence around the north star.

The main gap is not "missing ideas." The main gap is turning existing subsystems into one disciplined product architecture.

The vocabulary baseline for that discipline is the
[AEQI Primitive Contract](primitive-contract.md): a TRUST is the shared AI
workspace and runtime for one mission; Roles, Agents, Quests, Ideas, Events,
Sessions, and Apps/Tools are the first-class surfaces inside it.

The extension baseline is [extension-plane.md](extension-plane.md): a
TRUST-scoped capability registry, typed event triggers, namespace grants, and
owner-token cleanup for anything installable or callable.

The installer baseline is [app-installer.md](app-installer.md): locked
manifests, preview, lockfiles, drift detection, namespace ownership, and audit
for installable apps/packages without arbitrary plugin code execution.

The observability baseline is [operate-console.md](operate-console.md): a
TRUST-scoped console and correlation spine for sessions, quests, event
invocations, tool calls, queues, capabilities, and runtime health.

The current public agent-runtime bar is captured in
[agent-runtime-bar.md](agent-runtime-bar.md). AEQI should not win by copying a
personal assistant or chat gateway. It should win by making durable work,
memory, eventing, permissions, and evidence part of one runtime contract.

## Phase 1: Native Runtime Excellence

Goal: make AEQI's native execution path good enough to be the center of gravity.

Focus areas:

- runtime contract for quests, steps, tool calls, artifacts, verification, and outcomes
- read-only Operate Console over sessions, activity, event invocations, queues,
  and capability health
- locked package preview for existing repo-backed blueprints and agent
  templates
- repo-aware coding loop with stronger inspect-edit-verify-recover behavior
- better checkpointing and resumability
- stronger context packing and quest scoping
- deterministic verification and evidence capture
- eval harness for real repository quests

Exit criteria:

- AEQI-native can complete a meaningful set of coding and repo-operation quests reliably
- cost and latency are visible and controllable
- failures are inspectable instead of mysterious

## Phase 2: Work OS Cohesion

Goal: unify notes, quests, projects, orgs, and memory into one operator-facing model.

Focus areas:

- ideas as directives, not just stored knowledge
- mission dashboards tied directly to execution state
- stronger agent tree model for human and agent roles
- better idea surfacing in the UI
- approvals and intervention flows integrated into the main operator experience

Exit criteria:

- a user can move from idea to plan to execution without leaving AEQI
- ownership, status, and blockers are visible in one place
- the system feels like a coherent work OS rather than a set of features

## Phase 3: Metrics and Reality Loops

Goal: make AEQI optimize for actual outcomes, not merely internal activity.

Focus areas:

- domain-specific metrics models
- watchdogs and KPI tracking
- mission scorecards
- feedback loops from external systems
- result-based verification layers

Examples:

- software delivery: test health, deploy status, regression rates
- content/marketing: publish cadence, conversion or engagement proxies
- trading/ops: PnL, drawdown, uptime, incident rates

Exit criteria:

- AEQI can explain whether a mission is succeeding in real terms
- operator dashboards show outcome health, not just quest counts

## Phase 4: Enterprise and Model Independence

Goal: make AEQI deployable where vendor-hosted coding agents are unacceptable.

Focus areas:

- clean model routing across hosted, cheap, and local backends
- policy enforcement and tool boundaries
- stronger audit and data controls
- deployment modes for on-prem and regulated environments
- operational hardening for service management, readiness, and recovery

Exit criteria:

- AEQI can be positioned credibly for regulated or private environments
- model cost and model choice become a policy decision, not an architectural limitation

## Phase 5: Autonomous Organization Builder

Goal: let AEQI turn large, ambiguous goals into real operating systems.

Focus areas:

- automatic org and role synthesis
- durable planning and reprioritization
- multi-project coordination
- richer idea composition
- long-horizon strategy review and adaptation

This is the phase where prompts like "build this business" or "run this operation" become meaningful.

## Immediate Next Steps

The next practical moves should be:

1. Make the new-user path boringly reliable: one install/build lane, one local
   demo lane, one first quest, and one command that verifies the path in an
   isolated home directory.
2. Keep the primitive contract enforced across code, docs, UI, MCP, and
   onboarding.
3. Ship the read-only runtime capability registry over existing tools, MCP
   servers, and event rows.
4. Ship the read-only Operate Console summary and timeline before mutating
   recovery controls.
5. Add locked package preview and stable manifest hashing for the default
   blueprint before any public package store.
6. Build an eval suite for coding and repo quests.
7. Tighten the native coding loop before expanding more surface area.
8. Keep shaping the UI around ideas, work, agent tree, and operator control.
9. Make metrics and outcome tracking a first-class part of the control plane.

## Decision Rule

When choosing what to build next, prefer work that strengthens one of these:

- native runtime quality
- control-plane coherence
- model independence
- enterprise deployability
- outcome measurement

If a feature does not strengthen one of those pillars, it is probably not on the critical path.
