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

## Example

You hired a `researcher` sub-agent that only needs to read — it shouldn't run shell, open quests, or mutate ideas. As an agent, you can't set its allow/deny directly (that's operator-owned), so propose the scope via a tagged idea and flag the operator.

Store the proposal:

```
ideas(action='store',
      name='scope-proposal-researcher-read-only',
      content='Proposed tool scope for the researcher agent:\n\ntool_allow = [ideas.search, ideas.get, web.fetch]\ntool_deny = [shell, code, quests.create, ideas.store, ideas.update, ideas.delete]\n\nRationale: the researcher only ingests and summarises. No writes, no shell. If it needs to persist a finding, it should propose the idea and let its parent approve before storing.',
      tags=['meta', 'tool-scope', 'proposal'],
      agent_id='<researcher-id>')
```

Then in your reply, tell the operator the proposal exists and where to apply it (template frontmatter at `agents/researcher/agent.md`, or the Settings pane).

When the scope lands, a wrong tool call will fire `guardrail:violation`. If you see one in the transcript, wire an event that surfaces "you tried X but your scope is Y" back to the model — the violation is information, not just a block.
