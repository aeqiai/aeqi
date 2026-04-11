---
title: "AEQI External Audit"
document_type: "external_audit"
author: "External Guidance Consultancy"
date: "2026-04-11"
status: "final"
audience:
  - "Founder"
  - "Implementation Agent"
  - "Claude"
scope:
  - "platform control plane"
  - "runtime topology"
  - "prompt/skill/template architecture"
  - "self-hosted surface"
stance: "direct"
---

# AEQI External Audit

## Executive Summary

AEQI now has a strong architectural core:

- one runtime concept
- one placement concept
- a real distinction between sandbox, VPS, and dedicated host runtime
- a founder/operator path that is now much closer to true self-host parity

The system is materially better than it was.

However, it is not yet correct to say that the architecture is fully clean or that every important concept has been implemented to completion.

The biggest remaining issue is not raw capability. It is model drift:

- old and new agent template formats still coexist in tooling
- skills/prompts still resolve through multiple loaders and fallback paths
- runtime prompt assembly still has compatibility layers that keep more than one source of truth alive
- trial expiry is implemented as wind-down, not yet full lifecycle retirement
- the platform still carries legacy company hosting shadow columns as migration baggage

The system is now credible. It is not yet fully production-grade in the strict architectural sense.

## Architectural Judgment

The correct north star remains:

1. The platform decides which runtime a company reaches.
2. The runtime owns company state.
3. Files are authoring assets.
4. The database is runtime state.
5. There should be one active story for templates, prompts, and skills.

That model is good. The remaining work is mostly about removing parallel stories that still survive in the codebase.

## What Is Already Strong

### 1. Placement Model

The control plane now routes through `runtime_placements` instead of treating host/container/VPS state as ad hoc conditionals.

This is the right direction. It makes the placement model explicit and inspectable.

### 2. Dedicated Host Runtime

The founder company is no longer relying on the old shared-root runtime model.

The dedicated host runtime approach is the right final direction:

- dedicated service
- dedicated state dir
- dedicated runtime DB
- direct host execution semantics

This is the single most important architecture improvement already completed.

### 3. Prompt Write Path

New agents now materialize prompt records at creation time instead of writing only inline prompts and waiting for later migration.

That was a real structural defect. Fixing it was necessary.

### 4. Prompt Source Metadata

Prompt records now have source metadata and managed sync behavior.

This is the first real step toward a usable authoring layer vs runtime layer split.

## Findings

## P0: Active Concept Drift Still Exists In Tooling

### Finding 1: `agent.toml` is still alive in active tooling

This is one of the clearest remaining architectural failures.

The runtime contract is `agent.md`, but the tooling is still split:

- `aeqi setup` still writes `agent.toml`
- the agent migration command still talks about `agent.toml`
- the TUI still accepts both `agent.md` and `agent.toml`

Concrete references:

- `aeqi-cli/src/cmd/setup.rs`
- `aeqi-cli/src/cmd/agent.rs`
- `aeqi-cli/src/tui/mod.rs`
- `crates/aeqi-core/src/config.rs`

Why this matters:

- self-hosted onboarding is inconsistent
- the codebase teaches two competing mental models
- any system with two template formats will drift again

Judgment:

This should be removed aggressively. Keep one canonical template format only: `agent.md`.

### Finding 2: the self-hosted starter flow is still partially broken

Because `aeqi setup` still writes `agent.toml`, a fresh local user can still generate starter agents that the runtime does not load natively.

That is not a cosmetic issue. It directly damages the open-source/self-hosted story.

Judgment:

This should be treated as a real product bug, not a documentation mismatch.

## P1: Skills And Prompts Still Have Multiple Live Resolution Paths

### Finding 3: skill loading is still not unified

The runtime still has multiple live ways to find skills/prompts:

- session manager uses the prompt loader and DB-first lookup
- scheduler still loads raw `.md` files from `prompt_dirs`
- VFS still has a `cwd/skills` fallback

Concrete references:

- `crates/aeqi-orchestrator/src/session_manager.rs`
- `crates/aeqi-orchestrator/src/scheduler.rs`
- `crates/aeqi-orchestrator/src/vfs.rs`
- `crates/aeqi-orchestrator/src/prompt_loader.rs`

Why this matters:

- two users can see different skill universes depending on which subsystem is used
- DB-backed prompt hygiene does not help if another subsystem still reads disk directly
- debugging becomes ambiguous because "what prompt actually ran" depends on the path

Judgment:

This is the next major cleanup target.

The correct end state is:

- one loader
- one source registry
- one sync path into runtime records
- no raw ad hoc skill scanning in side subsystems

### Finding 4: prompt assembly still has a compatibility dual-store

Prompt assembly still prefers `ideas.db` and then falls back to `prompt_ids` in `agents.db`.

Concrete reference:

- `crates/aeqi-orchestrator/src/prompt_assembly.rs`

This is understandable as a transitional layer. It is also still a split source-of-truth model.

Judgment:

Acceptable for migration. Not acceptable as the final architecture.

## P1: SaaS Lifecycle Is Improved But Not Finished

### Finding 5: trial expiry is a wind-down pass, not a full retirement lifecycle

The new trial-expiry task is useful and worth keeping. But it currently:

- marks the subscription as expired
- stops sandbox runtimes
- marks placement status as expired

Concrete reference:

- `aeqi-platform/src/server.rs`

What it does not yet do:

- explicit retirement/deletion policy for sandbox state
- retention window handling
- cleanup of per-tenant filesystem data
- operator-visible lifecycle states beyond basic expiration

Judgment:

This is good operational progress, but it is not the final SaaS lifecycle model you described.

## P1: The Platform Still Carries Legacy Hosting Baggage

### Finding 6: `companies` still contains legacy hosting shadow fields

The live path is much cleaner now, but the platform schema still includes and backfills legacy columns such as:

- `container_id`
- `container_port`
- `is_host`
- `hosting_type`
- `vps_server_id`
- `vps_ip`
- `vps_server_type`

Concrete reference:

- `aeqi-platform/src/users.rs`

This is currently migration baggage more than runtime truth, which is an improvement. But the data model is still carrying historical duplication.

Judgment:

This is acceptable only temporarily. The final state should make `runtime_placements` authoritative and remove these columns from the active model entirely.

## P2: Documentation Is Still Not Fully Internally Consistent

### Finding 7: several docs still describe outdated infrastructure or outdated paths

Examples:

- the platform architecture doc still speaks in container-first terms where the live implementation is bubblewrap sandbox plus dedicated host runtime
- some docs in the repo remain under active churn and are not yet internally aligned

Concrete reference:

- `docs/platform-architecture.md`

Judgment:

This matters because AEQI is concept-heavy. If the docs teach the wrong abstractions, implementation drift returns.

## What I Like

There are several things here that are genuinely strong.

### 1. The product concept is unusually coherent now

The correct mental model is visible:

- open source/self-hosted AEQI
- managed sandbox AEQI
- VPS AEQI
- dedicated host-runtime AEQI

That is not four products. It is one runtime in four placements.

That is the right shape.

### 2. The founder/operator path is strategically important

The dedicated host-runtime company is a meaningful differentiator.

It gives the founder a cloud-managed identity while still preserving direct host-runtime semantics. That is much stronger than a fake shared-root special case.

### 3. The runtime is no longer just UI theater

The session, prompt, tool, memory, and agent model is substantive enough that cleanup effort is worthwhile. This is not a superficial wrapper around LLM calls.

## What I Do Not Like

This is the blunt version.

1. I do not like any place where `agent.toml` still exists in active tooling.
2. I do not like any subsystem that still reads skills/prompts directly from disk in parallel with the managed prompt path.
3. I do not like the continued existence of active compatibility fallbacks as a long-term strategy.
4. I do not like self-hosted onboarding paths that can still create assets the runtime does not natively want.
5. I do not like migration baggage surviving without a defined retirement plan.

None of these are “vision” problems. They are cleanup and discipline problems.

## Recommended Next Sequence

This is the order I would use.

### Phase 1: Remove Template Format Drift

1. Make `aeqi setup` write `agent.md`, not `agent.toml`.
2. Make migration commands target `agent.md`.
3. Remove `agent.toml` fallback from the TUI.
4. Remove `agent.toml` references from the remaining docs.

Acceptance criterion:

There is exactly one active agent template format in the product.

### Phase 2: Unify Skill Resolution

1. Route scheduler skill loading through the same prompt loader / managed prompt path.
2. Remove the `cwd/skills` fallback from VFS.
3. Ensure status, session manager, scheduler, and any UI explorer all read from the same catalog.

Acceptance criterion:

Every subsystem resolves the same skill universe from the same source model.

### Phase 3: Finish Prompt Store Consolidation

1. Continue migrating active prompt/skill/template assets into managed runtime records.
2. Remove the remaining old fallback paths when migration is complete.
3. Decide whether `ideas.db` or the prompt store is the actual long-term authoritative execution store, then collapse to one.

Acceptance criterion:

Prompt assembly has one authoritative runtime source.

### Phase 4: Finish SaaS Lifecycle

1. Add retention policy for expired sandboxes.
2. Add full deprovision / retire path.
3. Make lifecycle state explicit in operator surfaces.

Acceptance criterion:

Trial companies do not just stop. They move through a defined retirement lifecycle.

### Phase 5: Delete Legacy Hosting Shadow Schema

1. Stop relying on legacy backfill except for offline migration support.
2. Add a migration step that rewrites old installations cleanly.
3. Remove old hosting columns from the active platform model.

Acceptance criterion:

`runtime_placements` is the only real hosting truth.

## Production-Grade Definition

I would call AEQI production-grade, powerful, logical, and genuinely impressive when all of the following are true:

1. one canonical agent template format
2. one canonical skill/prompt resolution path
3. one authoritative runtime prompt source
4. one placement source of truth
5. one complete lifecycle for sandbox, VPS, and host runtimes
6. self-hosted onboarding that matches the runtime model exactly
7. documentation that teaches the same architecture the code actually runs

AEQI is now much closer to that bar.

It is not there yet.

## Final Assessment

The concept is strong enough to justify this cleanup effort.

The architecture is no longer muddled at the top level. The remaining risk is lower-level duplication:

- duplicate formats
- duplicate loaders
- duplicate compatibility layers

If those are removed systematically, AEQI becomes not just ambitious, but logically clean.

That is the real threshold between “interesting system” and “exceptional system.”
