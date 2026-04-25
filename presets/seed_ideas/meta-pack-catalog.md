---
name: meta:pack-catalog
tags: [meta, pack-infrastructure]
description: Current contents of aeqi's default seed pack. Queryable via ideas search to avoid duplicate imports. Should be regenerated/updated whenever the pack changes.
---

# Seed Pack Catalog (vanilla install)

Updated: 2026-04-24

## Identity (1)

- `vanilla-assistant` — baseline aeqi agent; describes 4 primitives +
  operating principles + acting rules (think first, minimum sufficient,
  surgical scope, define-done).

## Persona (4)

- `meta:reflector-template` — post-quest fact extraction (JSON out).
- `meta:daily-reflector-template` — 24h digest + insight promotion.
- `meta:weekly-consolidator-template` — Sunday cold-cluster distillation.
- `meta:consolidator-template` — per-tag threshold consolidation (exactly
  one item out per firing).

## Skill (6)

- `create-idea` — store tagged knowledge.
- `create-quest` — convert actionable work to a quest with a worktree.
- `create-event` — wire pattern-triggered automation.
- `spawn-subagent` — hire persistent sub or ephemeral session.
- `evolve-identity` — amend your baseline identity.
- `manage-tools` — allow/deny scope merging.

## Ritual (2 markdown templates + runtime-seeded lifecycle events)

Markdown event templates (copy-per-agent; schedule:* cannot be global):

- `meta:event-template:daily-digest` → per-agent `schedule:0 0 * * *`.
- `meta:event-template:weekly-consolidate` → per-agent `schedule:0 0 * * 0`.

Runtime-seeded (by `seed_lifecycle_events`, not markdown — 8 lifecycle +
4 middleware + 2 memory-stack rows):

- 8 lifecycle patterns: `session:start`, `session:quest_start`,
  `session:quest_end`, `session:quest_result`, `session:step_start`,
  `session:stopped`, `session:execution_start`,
  `context:budget:exceeded`.
- 4 middleware patterns: `loop:detected`, `guardrail:violation`,
  `shell:command_failed`, `graph_guardrail:high_impact`.
- 2 memory-stack events: `on_reflect_after_quest`,
  `on_inject_recent_context`.

## Principle (2)

- `meta:behavior-principles` — four decision heuristics (think first,
  minimum sufficient, surgical scope, define done). Karpathy-inspired,
  rewritten in aeqi voice. Extended companion to `vanilla-assistant`'s
  `## Acting` section; identity stays terse, depth lives here.
- `meta:coding-examples` — six anti-pattern → right-approach pairs,
  one per common drift (hidden assumptions, multiple interpretations,
  over-abstraction, speculative features, drive-by refactoring,
  reproduce-before-fix). Cite-able from reflections.

Outstanding candidate principle imports: Zettelkasten atomic-notes rule.

## Tag policies (10, meta)

- `fact`, `decision`, `preference`, `procedure`, `skill`, `evergreen`,
  `reflection`, `source:session`, `meta`, `identity` [added α].

## Pack infrastructure (3, meta)

- `meta:content-taxonomy` — 5 category map.
- `meta:evaluation-criteria` — import checklist.
- `meta:pack-catalog` — this file.

## Wisdom packs (2)

- `meta:pack:google-workspace` — eleven native tools (Gmail / Calendar /
  Meet) backed by T1.9's `oauth2` lifecycle. Per-agent scoping;
  refresh-on-401 retry at the framework level. Crate
  `aeqi-pack-google-workspace`, default-on feature
  `google-workspace` on `aeqi-orchestrator`.
- `meta:pack:github` — sixteen native tools across issues / PRs /
  files / releases / search backed by T1.9's `github_app` lifecycle
  (preferred) or `oauth2` lifecycle. Per-installation scoping;
  refresh-on-401 retry; rate-limit reason code; pagination capped at
  200 results. Crate `aeqi-pack-github`, default-on feature `github`
  on `aeqi-orchestrator`.

## Known gaps (things we should NOT re-import if encountered)

- None of the current content ideas duplicate each other; every idea has
  a clean category.
- `identity` + `acting` principles currently live inline in
  `vanilla-assistant` — if an external source offers principles, merge
  into that agent's identity OR promote to a dedicated principle idea,
  don't add a third co-owner.

## Candidate expansion areas

- More skills: code review, commit messages, debugging, incident
  response, research, planning.
- More personas: reviewer, researcher, planner, security auditor.
- More rituals: weekly review, standup, end-of-sprint retro.
- Principle category: seeded with Karpathy-inspired pair in β; future
  additions (Zettelkasten, reflection-principles) earn their slot
  case-by-case.
- Domain packs: language/stack-specific (Rust, TypeScript, DevOps).

## Invariants (what must stay true of the pack)

- Every tag referenced in a seeded idea's frontmatter has a matching
  `meta:tag-policy:<tag>` in `tag-policies/` — otherwise retrieval
  defaults silently apply.
- Every persona with JSON output format has a downstream consumer
  (reflector → ideas_store_many, consolidator → ideas_store_many +
  archival walk). Orphan personas shouldn't land.
- Every `create-X` skill matches a live tool in the `ToolRegistry`. A
  skill teaching a tool that doesn't exist is cargo-culting.
