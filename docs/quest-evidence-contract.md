# Quest Evidence Contract

Status: draft  
Date: 2026-05-13  
Quest: 67-102

## Purpose

A quest is not complete because an agent stopped writing. A quest is complete
when a future operator or agent can understand what changed, why it is credible,
and what should happen next without replaying the full transcript.

This contract defines the evidence every meaningful quest should leave behind.
It is the first runtime contract needed for the Company Kernel release: company
work must become operating truth.

## Current Surface

The current durable quest outcome is `QuestOutcomeRecord`:

```text
kind        done | blocked | handoff | failed | cancelled
summary     human-readable result
reason      optional explanation, blocker, or failure reason
next_action optional follow-up instruction
```

This exists in:

- `crates/aeqi-quests/src/quest.rs`
- `crates/aeqi-orchestrator/src/executor.rs`
- `apps/ui/src/lib/types.ts`
- `crates/aeqi-orchestrator/src/ipc/quests.rs`
- `crates/aeqi-web/src/routes/quests.rs`

That shape is useful, but it is not yet enough evidence for high-company
operation. The missing parts are artifact identity, verification, residual risk,
and rollback/recovery guidance.

## Minimum Evidence

Every substantial quest outcome should answer these questions:

| Field           | Required when                                                            | Meaning                                                                 |
| --------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `kind`          | always                                                                   | Terminal state: done, blocked, handoff, failed, or cancelled.           |
| `summary`       | always                                                                   | What happened in one operator-readable paragraph.                       |
| `decision`      | work changed direction, behavior, or scope                               | The decision made, including the reason when it matters.                |
| `artifacts`     | files, configs, docs, deploys, or external systems changed               | What changed and where to inspect it.                                   |
| `verification`  | any quest marked done                                                    | Commands, checks, screenshots, deploy probes, or manual validation run. |
| `residual_risk` | any quest marked done, failed, or handoff                                | Known risk, missing coverage, unverified assumptions, or dirty state.   |
| `next_action`   | blocked, handoff, failed, or follow-up needed                            | The next concrete action.                                               |
| `rollback`      | shipped config, deploy, migration, payment, auth, or destructive changes | How to reverse or contain the change.                                   |

The existing `kind`, `summary`, `reason`, and `next_action` fields remain the
minimum wire contract. The evidence fields above are the target contract for the
next schema/API/UI pass.

## Outcome Kinds

### `done`

Use when the quest reached the requested target state.

Required evidence:

- `summary`
- `artifacts`
- `verification`
- `residual_risk`
- `rollback` when the change is operationally reversible or risky

### `blocked`

Use when progress cannot continue without input, credentials, access, a product
choice, or an external condition.

Required evidence:

- `summary` of work completed before the block
- `reason` describing the blocker
- `next_action` phrased as the smallest unblocker
- `artifacts` when partial work exists

### `handoff`

Use when useful work was done but another execution must continue it.

Required evidence:

- `summary`
- `artifacts`
- `verification` already run
- `residual_risk`
- `next_action` for the next agent

### `failed`

Use when the quest attempted execution and did not reach a useful handoff state.

Required evidence:

- `summary`
- `reason`
- `verification` or command/error that proved failure
- `residual_risk`
- `next_action` if recovery is known

### `cancelled`

Use when the quest is intentionally stopped.

Required evidence:

- `summary`
- `reason`
- `rollback` or cleanup state when work had started

## Artifact Format

Artifacts should be specific enough to inspect.

Good artifact entries:

- `docs/quest-evidence-contract.md`
- `crates/aeqi-quests/src/quest.rs::QuestOutcomeRecord`
- `commit 638e36e1`
- `systemd service aeqi-platform.service`
- `https://github.com/aeqi-ai/aeqi/pull/new/docs/quest-evidence-contract`

Weak artifact entries:

- `docs`
- `the backend`
- `fixed stuff`
- `deployment`

## Verification Format

Verification should name what was run and what it proved.

Good verification entries:

- `git diff --check` passed, proving no whitespace errors in the patch.
- `npx prettier --check docs/quest-evidence-contract.md docs/README.md`
  passed, proving the edited docs match repository formatting.
- `cargo test -p aeqi-quests quest_outcome_summary` passed, proving outcome
  summary behavior still matches the contract.

Weak verification entries:

- `tested`
- `looks good`
- `ran checks`
- `should work`

## Residual Risk

`residual_risk` is required even when the answer is "none known". This prevents
silent uncertainty from being mistaken for confidence.

Examples:

- `none known; docs-only change`
- `UI rendering not checked; no UI files changed`
- `cargo test --workspace not run because this patch only changes docs`
- `deploy not run; branch intentionally left for /ship`

## Current Gap Audit

Current implementation:

- stores terminal outcome as `QuestOutcomeRecord`
- exposes outcome through IPC and web close paths
- mirrors outcome into legacy metadata for older quest stores
- renders the same shape in the UI TypeScript types
- dispatches `session:quest_end` after IPC/web quest close

Gaps:

- no first-class fields for `decision`, `artifacts`, `verification`,
  `residual_risk`, or `rollback`
- no validation that `done` quests include verification evidence
- no visible UI pattern for evidence beyond summary/reason/next action
- no release-note generator that can consume structured evidence
- no dedicated migration path for existing outcome records

## Next Implementation Step

Add a backward-compatible evidence payload to `QuestOutcomeRecord`:

```text
evidence: {
  decision?: string,
  artifacts: EvidenceArtifact[],
  verification: EvidenceCheck[],
  residual_risk?: string,
  rollback?: string
}
```

The first code patch should:

1. Add typed Rust and TypeScript evidence structs with serde defaults.
2. Preserve existing `kind`, `summary`, `reason`, and `next_action`.
3. Accept old outcome records without evidence.
4. Add unit tests for old records and new evidence-rich records.
5. Surface evidence in the quest detail UI only after the storage/API contract
   is stable.

## Rollback

This draft is documentation-only. Rollback is a normal revert of this file, the
docs index link, and the comments added to the current outcome type.
