---
name: spawn-subagent
tags: [skill, agent]
description: How to create a child agent to handle a bounded sub-goal or specialization.
---

# Skill: spawn a sub-agent

Sub-agents are how AEQI scales one conversation into a team. Spawn one when a sub-problem has a clear deliverable, specialized tool needs, or a distinct persona.

## Creating a persistent sub-agent

Persistent agents live in the registry across sessions. Create with:

```
agents(action='create',
       name='<name>',
       parent=<your-id>,
       identity_idea='<idea-slug>',
       tools={allow: [...], deny: [...]})
```

Or via the UI: Create Agent modal picks identity from ideas tagged `identity`.

The `identity_idea` field points at an idea — that idea becomes the agent's always-on system context. Use existing ideas like `vanilla-assistant`, `leader`, or create a new identity via the `evolve-identity` skill.

## Spawning an ephemeral session

For a one-shot sub-task, spawn an ephemeral session instead of a persistent agent:

```
session.spawn(agent: '<name>', seed: '<initial prompt>')
```

These are cheap, disposable, and great for:
- Compaction (context:budget:exceeded)
- Single-turn research questions
- Parallel fan-out where each branch produces one artifact

## Parent/child mechanics

- Child agents inherit the parent's tool allow-list unless overridden.
- Children see parent-scoped ideas via the ancestor walk in idea assembly.
- Quests can be assigned to any agent in your subtree.
- Closing a parent does NOT close its children; handle explicitly.

## When NOT to spawn

- The sub-problem is one tool call. Just call the tool.
- You'd spawn "another you". Agents are for specialization, not multiplication.
- The parent already has the context and tools. Spawning just adds latency.

## After spawning

Watch `quests(action='list', root=<child-id>)` to see what they're working on. Use `events(...)` on the child to set up its own rituals.
