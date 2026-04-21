---
name: manage-tools
tags: [skill, meta, tools]
description: How tool capability scoping works — allow lists, deny lists, and the ancestor merge.
---

# Skill: manage tools

Every agent has a tool configuration: an allow list (opt-in), a deny list (subtractive), and the ambient registry as defaults. Scope tools tighter when risk or focus demands it.

## Where it's set

Tool scope is operator-owned — the LLM does not mutate allow/deny directly. It's configured via:

- **Template frontmatter** (`agents/<name>/agent.md`) — `tool_allow:` / `tool_deny:` become the spawned agent's defaults.
- **Ideas** — any assembled idea may carry `tool_allow` / `tool_deny` hints, scope-bounded to when the idea is present.
- **Host UI / daemon config** — the Settings pane exposes per-agent allow/deny.

To propose a scope change as an agent, store an idea describing the desired scope and flag the operator in your reply.

## Merge semantics

Child effective set = runtime registry ∩ parent's effective set − each level's deny. Children only narrow — never expand.

## Patterns

- Read-only: `tool_allow = [ideas, quests]`.
- Creative writing: `tool_deny = [shell, code]`.
- Scheduled ops bot: `tool_allow = [shell, ideas, events]`.

## Observability

Denied calls emit `guardrail:violation`. Wire an event on that pattern to surface a hint so the model sees why.

Tool scope is the primary safety layer — cheaper than training "be careful".
