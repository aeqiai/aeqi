# ECC Comparison Lessons

This note captures the May 27, 2026 comparison between AEQI and
`github.com/affaan-m/ECC` at ECC commit `928076c`.

## Summary

ECC is a harness distribution and operator pack. Its strongest ideas are
surface-area discipline: explicit catalogs, adapter matrices, selective
installation, hook profiles, session snapshots, and automated checks that keep
docs from drifting away from the repo.

AEQI is a native runtime and work operating system. Its strongest ideas are
durable primitives: agents, ideas, quests, events, sessions, MCP tools, code
graph, and actor-aware control. AEQI should not copy ECC's broad command/skill
pack directly. The better lesson is to make AEQI's own runtime surface more
visible, measurable, and checkable.

## High-Value ECC Patterns To Adapt

| ECC pattern | Why it matters | AEQI adaptation |
| --- | --- | --- |
| Generated catalog checks | ECC scans agents, commands, skills, docs, and plugin metadata so public counts do not drift. | Keep a generated AEQI repo surface catalog and check it in CI before marketing or docs claim new surface area. |
| Selective install manifests | ECC can explain what was requested, resolved, installed, transformed, and owned. | Use the same shape for future AEQI installable tool packs, local runtime profiles, and MCP/client config bundles. |
| Session adapter contract | ECC normalizes harness-specific sessions into one JSON snapshot. | Add stable export contracts for AEQI session, worker, tool, cost, quest, and artifact status so UI, CLI, MCP, and hosted platform consume the same shape. |
| Hook profiles and disabled-hook controls | ECC treats hooks as useful but potentially expensive/global. | AEQI hooks and lifecycle automations should expose explicit minimal, standard, and strict profiles instead of hidden always-on behavior. |
| Harness adapter compliance matrix | ECC does not pretend one client is the whole world. | AEQI MCP/client support should keep a public compatibility matrix for Codex, Claude Code, Cursor, OpenCode, hosted HTTP, and local stdio. |
| Continuous learning promotion gates | ECC separates observation, proposal, verification, promotion, and rollback. | AEQI ideas/evolution should preserve this staged shape when turning session lessons into durable instructions, skills, or product changes. |
| Security scanners as repo policy | ECC has supply-chain and hook-safety checks around its harness assets. | AEQI should extend public-surface scanning into MCP/tool-pack safety checks, secret-path checks, and install-profile policy. |

## What AEQI Should Not Copy

- Do not import ECC's whole agent, command, skill, or rules catalog. AEQI needs
  runtime-native packs with typed authorization and audit trails, not a broad
  prompt bundle.
- Do not make harness-specific files the source of truth. AEQI's source of
  truth remains the runtime database, actor model, quest ledger, ideas graph,
  and code graph.
- Do not over-index on hook automation before observability is solid. Hooks
  should be profile-gated and inspectable because they mutate operator
  behavior globally.
- Do not treat public README badges or catalog counts as proof. AEQI should
  tie surface claims to generated artifacts and verification evidence.

## Immediate AEQI Improvement

This comparison adds `scripts/repo-surface-catalog.mjs` plus
`docs/repo-surface-catalog.json`. The catalog records tracked repo surface
counts and file lists for Rust packages, runtime crates, tool packs, docs,
design docs, scripts, workflows, apps, packages, and seeded agents.

Use:

```bash
npm run surface:catalog
npm run surface:catalog:write
npm run surface:catalog:check
```

The catalog is intentionally small and repo-native. It gives AEQI a first
machine-checkable surface artifact without changing runtime behavior.

## Follow-Up Backlog

1. Add a compatibility matrix for MCP/client transports and make it checkable
   from smoke tests where possible.
2. Define `aeqi.session.v1` as a stable status snapshot for session, workers,
   active tools, quest linkage, costs, validation evidence, and remaining risk.
3. Design install-profile manifests for optional AEQI packs and client config
   bundles before adding more ad hoc install flags.
4. Add hook/lifecycle profiles for minimal, standard, and strict operator
   automation.
5. Extend public-surface scanning into install profiles, MCP tool manifests,
   and secret-path policy.
