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

## Phase 1: Native Runtime Excellence

Goal: make AEQI's native execution path good enough to be the center of gravity.

Focus areas:

- runtime contract for quests, steps, tool calls, artifacts, verification, and outcomes
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

1. Define the native runtime contract in code and docs.
2. Build an eval suite for coding and repo quests.
3. Tighten the native coding loop before expanding more surface area.
4. Keep shaping the UI around ideas, work, agent tree, and operator control.
5. Make metrics and outcome tracking a first-class part of the control plane.

## Decision Rule

When choosing what to build next, prefer work that strengthens one of these:

- native runtime quality
- control-plane coherence
- model independence
- enterprise deployability
- outcome measurement

If a feature does not strengthen one of those pillars, it is probably not on the critical path.
