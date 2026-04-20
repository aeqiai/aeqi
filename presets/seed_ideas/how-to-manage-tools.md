---
name: manage-tools
tags: [skill, tools]
description: How to configure per-agent tool allow/deny lists — the capability scoping layer.
---

# Skill: manage tools

Every agent has a tool configuration. By default they inherit the runtime's ambient tools (ideas, quests, agents, events, shell, file_edit, ...). Scope them tighter when risk or focus demands it.

## Shapes

On agent creation or update:

```
agents(action='update', id=<id>,
       tool_allow=['ideas.*', 'quests.*'],     # opt-in list (narrow)
       tool_deny=['shell.*', 'file_edit.*'])    # deny-list (subtractive)
```

Wildcards: `ideas.*` matches `ideas.search`, `ideas.store`, `ideas.assemble`.

## Allow vs deny

- **`tool_allow`** is an allowlist. Non-empty allow = ONLY those tools available. Use when you want a tightly-scoped agent (e.g. research-only, no side effects).
- **`tool_deny`** subtracts from whatever's allowed. Use for targeted removal (e.g. a production-facing agent with shell denied).
- Both can apply. Allow is evaluated first; deny trims from the result.

## Merge semantics up the ancestor chain

A child agent's effective tool set is:

1. Runtime defaults (all registered tools)
2. Intersected with parent allow (if any), minus parent deny
3. Intersected with own allow (if any), minus own deny

So children can only *narrow* from the parent — never expand.

## Patterns

**Read-only agent:**
```
tool_allow=['ideas.search', 'quests.list', 'quests.get', 'agents.get', 'events.list']
```

**Creative writing agent (no runtime mutations):**
```
tool_deny=['shell.*', 'file_edit.*', 'quests.create', 'quests.close']
```

**Ops bot (scheduled, narrow tool set):**
```
tool_allow=['shell.run', 'ideas.store', 'events.emit']
```

## Observability

Denied tool calls fire `guardrail:violation` events. Connect that pattern to `transcript.inject` to let the LLM see why a call was rejected, or to `session.spawn` to escalate.

## Principle

Tool scope is the primary safety layer. It's cheaper and more legible than training an agent to "be careful" with omnipotent capabilities.
