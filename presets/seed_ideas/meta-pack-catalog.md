---
name: meta:pack-catalog
tags: [meta, pack-infrastructure]
description: Current contents of aeqi's default seed pack. Queryable via ideas search to avoid duplicate imports. Should be regenerated/updated whenever the pack changes.
---

# Seed Pack Catalog (vanilla install)

Updated: 2026-05-30

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

## Skill (7)

- `create-idea` — store tagged knowledge.
- `create-quest` — convert actionable work to a quest with a worktree.
- `create-event` — wire pattern-triggered automation.
- `spawn-subagent` — hire persistent sub or ephemeral session.
- `evolve-identity` — amend your baseline identity.
- `manage-tools` — allow/deny scope merging.
- `design-agent-team` — choose an agent-team topology and translate it
  into roles, agents, ideas, quests, and events.

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

## Pack infrastructure (5, meta)

- `meta:content-taxonomy` — 5 category map.
- `meta:evaluation-criteria` — import checklist.
- `meta:pack-catalog` — this file.
- `meta:placeholder-providers` — TOML registry for custom idea assembly
  placeholders.
- `meta:mcp-servers` — TOML registry for opt-in MCP server bootstrap.

## Agent-team baseline packages (5)

- `meta:pack:agent-team-baselines` — package index for harness-style
  team topologies translated into aeqi primitives.
- `meta:pack:deep-research` — fan-out/fan-in research lanes plus
  synthesis and evidence review.
- `meta:pack:software-delivery` — implementation pipeline, targeted
  review lanes, release evidence, and rollback policy.
- `meta:pack:content-campaign` — campaign brief, research, copy,
  visual planning, distribution, QA, and experiment logging.
- `meta:pack:data-operations` — data contract, schema, ETL, validation,
  monitoring, and incident follow-up.

## Integration and channel packs (6)

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
- `meta:pack:notion` — twelve native tools across pages / databases /
  blocks / users backed by T1.9's `oauth2` lifecycle. Per-workspace
  scoping (`ScopeHint::User` keyed by Notion `workspace_id`);
  refresh-on-401 retry; rate-limit reason code (`Retry-After`-aware);
  cursor-based pagination capped at 200 results; block-append chunked
  transparently at Notion's 100-children-per-call ceiling;
  heterogeneous property shapes passed through verbatim. Pinned to
  `Notion-Version: 2022-06-28`. Crate `aeqi-pack-notion`, default-on
  feature `notion` on `aeqi-orchestrator`.
- `meta:pack:slack` — fourteen native tools across channels /
  messages / reactions / users / search backed by T1.9's `oauth2`
  lifecycle. Per-workspace scoping (`ScopeHint::User`, scope_id =
  Slack workspace_id); refresh-on-401 retry; rate-limit reason code
  (HTTP 429 + `Retry-After` honoured); cursor-based pagination capped
  at 200 results; `ok=false` envelope translated to clean
  `slack_error`. Crate `aeqi-pack-slack`, default-on feature `slack`
  on `aeqi-orchestrator`.
- `meta:pack:etsy` — five native seller tools across shops /
  listings / orders / draft-listing creation backed by T1.9's `oauth2`
  lifecycle. TRUST-scoped storefront credential (`ScopeHint::Trust`);
  refresh-on-401 retry; Etsy `x-api-key` sourced from credential
  metadata; write surface is draft-only in V1 so agents can prepare
  commerce work without publishing products. Crate `aeqi-pack-etsy`,
  registered by the MCP Apps proxy integration catalog.
- `meta:pack:wecom` — planned WeCom / Enterprise WeChat messaging
  integration. First target is callback mode for self-built enterprise
  apps: encrypted inbound callbacks, immediate ACK, async agent session,
  proactive `message/send`, multi-corp routing, dedupe, TRUST-scoped
  service-account credentials, and role/app grants. Not callable yet;
  surfaced only through the MCP Apps planned/roadmap catalog until a
  real pack and credential lifecycle ship.

## Known gaps (things we should NOT re-import if encountered)

- None of the current content ideas duplicate each other; every idea has
  a clean category.
- `identity` + `acting` principles currently live inline in
  `vanilla-assistant` — if an external source offers principles, merge
  into that agent's identity OR promote to a dedicated principle idea,
  don't add a third co-owner.

## Candidate expansion areas

- More skills: code review, commit messages, debugging, incident
  response.
- More personas: reviewer, researcher, planner, security auditor.
- More rituals: weekly review, standup, end-of-sprint retro.
- Principle category: seeded with Karpathy-inspired pair in β; future
  additions (Zettelkasten, reflection-principles) earn their slot
  case-by-case.
- Domain packs: language/stack-specific (Rust, TypeScript, DevOps).
- Additional package cards: legal review, finance ops, customer support,
  security audit, education/course production.
- Messaging app packs: WeCom Callback first for company-grade WeChat,
  personal Weixin later as a user-scoped device-session channel.

## Invariants (what must stay true of the pack)

- Every tag referenced in a seeded idea's frontmatter has a matching
  `meta:tag-policy:<tag>` in `tag-policies/` — otherwise retrieval
  defaults silently apply.
- Every persona with JSON output format has a downstream consumer
  (reflector → ideas_store_many, consolidator → ideas_store_many +
  archival walk). Orphan personas shouldn't land.
- Every `create-X` skill matches a live tool in the `ToolRegistry`. A
  skill teaching a tool that doesn't exist is cargo-culting.
