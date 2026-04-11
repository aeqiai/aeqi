---
title: "AEQI External Audit Revision"
document_type: "external_audit"
author: "External Guidance Consultancy"
date: "2026-04-11"
status: "final"
supersedes:
  - "docs/external-audit-2026-04-11.md"
audit_basis:
  repo: "/home/claudedev/aeqi"
  branch: "main"
  commit: "6323f1f"
  mode: "local_worktree"
  note: "This revision audits the current local main worktree, not an older subagent worktree or an earlier snapshot."
audience:
  - "Founder"
  - "Claude"
  - "Implementation Agent"
stance: "direct"
---

# AEQI External Audit Revision

## Scope

This document supersedes the earlier external audit because that earlier version mixed valid architectural concerns with findings that were already resolved in the current local `main` worktree.

This revision is intentionally narrower:

- it withdraws stale findings
- it keeps only findings that are still materially unresolved
- it is based on the current local `main` worktree at commit `6323f1f`

## Bottom Line

The earlier audit was stale in part.

Several previously flagged issues are already resolved in the current code.

However, not everything is resolved. There are still a small number of real architectural inconsistencies that should not be hand-waved away.

The correct conclusion is:

- AEQI is materially cleaner than the stale audit implied
- the main architecture is now strong
- a few important cleanup items are still outstanding

## Withdrawn Findings From The Earlier Audit

The following findings should be considered withdrawn for the current local `main` worktree.

### 1. Founder host runtime as a shared-root exception

Withdrawn.

The founder company now runs on a dedicated host runtime path rather than the old shared-root fallback model.

### 2. New agents still being created with inline-only prompts

Withdrawn.

The current runtime write path now materializes prompt records and stores `prompt_ids` when agents are created, instead of relying on later migration.

### 3. Prompt source metadata missing from the prompt store

Withdrawn.

The prompt store now includes source metadata and managed sync fields. The store is no longer just a blind bucket of prompt text.

### 4. Running sessions drifting because step prompts are reread from disk every turn

Withdrawn.

Current step prompt handling is snapshotted at session start. That specific mid-flight drift complaint is no longer current.

### 5. Platform request routing still depending on the old shared-root host path

Withdrawn.

The control-plane routing model is now placement-first in the active path.

## Current Positive Assessment

These parts are genuinely in good shape now.

### 1. Placement architecture

The platform is now visibly moving around a first-class placement model:

- sandbox
- VPS
- dedicated host runtime

That is the correct control-plane abstraction.

### 2. Founder/operator runtime model

The founder path is now much closer to true self-host parity:

- dedicated runtime
- dedicated state dir
- dedicated service
- no need for shared-root row filtering as the primary model

### 3. Prompt write-path direction

The runtime now behaves much more like a real prompt store:

- newly created agents write prompt IDs
- prompt updates refresh prompt IDs
- prompt imports have managed source metadata

This is a real improvement, not cosmetic cleanup.

## Remaining Findings

## Finding 1: `agent.toml` is still alive in active tooling

This remains unresolved.

The runtime contract is `agent.md`, but active tooling still uses or accepts `agent.toml`:

- `aeqi setup` still writes starter agents as `agent.toml`
- the migration command still describes migration into `agent.toml`
- the TUI still scans for both `agent.md` and `agent.toml`

Why this matters:

- self-hosted onboarding is still conceptually split
- the product still teaches two competing template formats
- new users can still create starter assets that are inconsistent with the canonical runtime path

Judgment:

This is one of the clearest unresolved architecture defects.

### Required fix

1. Make `aeqi setup` emit `agent.md`
2. Make migration commands emit `agent.md`
3. Remove `agent.toml` fallback from the TUI
4. Remove `agent.toml` language from any remaining docs and comments

## Finding 2: skills and prompts still resolve through more than one live path

This remains unresolved.

The system is improved, but still not single-path:

- session manager uses the prompt loader and DB-first logic
- scheduler still loads raw prompt files from `prompt_dirs`
- VFS still has a `cwd/skills` fallback

Why this matters:

- different subsystems can still observe different skill sets
- prompt-store improvements do not fully matter if another subsystem can bypass them
- debugging runtime behavior remains harder than it should be

Judgment:

This is the next major architecture cleanup target.

### Required fix

1. Route scheduler skill loading through the same loader/catalog model
2. Remove `cwd/skills` fallback from VFS
3. Ensure status/session/scheduler/VFS all see one skill universe

## Finding 3: prompt assembly still keeps a transitional dual-store model

This remains unresolved, although it is now a controlled transitional issue rather than a chaotic one.

Prompt assembly still has compatibility logic between the newer prompt/idea path and older fallback resolution behavior.

Why this matters:

- final source-of-truth is still not singular
- architecture remains partially transitional

Judgment:

This is acceptable short term. It is not the final clean state.

### Required fix

Pick one final authoritative runtime prompt source and remove the compatibility branch once migration is complete.

## Finding 4: trial expiry is a wind-down pass, not yet a full lifecycle retirement model

This remains unresolved.

The system now stops expired sandbox runtimes and marks them expired. That is useful. But it is still not the full lifecycle described in the product vision.

What is still missing:

- retention policy
- retirement/deletion policy for expired tenant state
- explicit deprovision path for sandbox data
- clearer lifecycle states for operators

Judgment:

This is partially implemented, not complete.

## Finding 5: legacy hosting shadow fields still exist in the platform schema

This remains unresolved, but the severity is lower than before.

The active model now routes through `runtime_placements`, which is good. But the `companies` table still carries historical hosting shadow columns and legacy backfill logic.

That means the data model is cleaner in behavior than in schema.

Judgment:

This is migration baggage, not an active conceptual failure. But it should still be retired.

### Required fix

1. finish migration tooling
2. stop relying on schema shadow fields except for one-time migration support
3. remove or fully deprecate the legacy columns from the active model

## Things I Specifically Do Not Like

This section is intentionally blunt.

1. I do not like any active code path that still creates or consumes `agent.toml`
2. I do not like scheduler and VFS bypassing the managed prompt path
3. I do not like compatibility layers staying around without a removal plan
4. I do not like self-hosted onboarding that still disagrees with the runtime contract

These are not "vision" problems. They are cleanup discipline problems.

## Recommended Next Sequence

1. Remove `agent.toml` from active tooling
2. Unify scheduler and VFS onto the same prompt/skill loader
3. Collapse prompt assembly to one authoritative runtime prompt source
4. Finish trial lifecycle retirement
5. Retire legacy hosting shadow schema

## Final Assessment

The stale audit overstated the amount of unresolved architecture debt.

The current local `main` worktree is significantly better than that earlier document implied.

But it would still be inaccurate to say that every important finding has been resolved.

The honest current assessment is:

- major architecture direction: good
- placement model: good
- founder host-runtime model: good
- prompt-store direction: much improved
- full logical cleanup: not finished

The remaining work is now concentrated and clear. That is a good position to be in.
