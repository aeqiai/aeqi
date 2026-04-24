---
name: spawn-subagent
tags: [skill, meta, agent]
description: How to create a child agent to handle a bounded sub-goal or specialization.
---

# Skill: spawn a sub-agent

Sub-agents scale one conversation into a team. Spawn one when a sub-problem has a clear deliverable, a distinct persona, or a specialized tool footprint.

## Persistent sub-agent — `agents.hire`

```
agents(action='hire',
       template='<template-dir-name>',     // e.g. 'leader', 'researcher', 'reviewer'
       parent_id='<your-agent-id>')        // defaults to caller
```

Templates live as `agents/<name>/agent.md` — a markdown file with frontmatter (name, role, runtime) plus the system content. The template defines the agent's identity at hire time; tools are inherited from the parent unless narrowed (see `manage-tools`).

After hiring, the new agent appears in `agents(action='list')` and you can delegate via `quests(action='create', agent='<new-agent-name>', ...)`.

## Ephemeral session — `session.spawn` (event tool)

For a one-shot sub-task fired from an event: `{tool: 'session.spawn', args: {agent: '<name>', seed: '<initial prompt>'}}`. Cheap, disposable — great for compaction (`context:budget:exceeded`) or single-turn research.

## Parent/child mechanics

- Children inherit the parent's tool allow-list; can only narrow.
- Assign work via `quests(action='create', agent='<child>', ...)`.
- Retire with `agents(action='retire', agent='<name>')`.

## When NOT to spawn

The sub-problem is one tool call. You'd spawn "another you". The parent already has the context. Use sub-agents for specialization, not multiplication.

## Example

Operator: "Stand up a reviewer who audits every quest diff before it lands."

Reviewer is a distinct persona (narrower tool scope, different identity), persistent (runs for every future quest), and delegated to via quests. Hire it:

```
agents(action='hire',
       template='reviewer',
       parent_id='<your-agent-id>')
// returns the new agent's name + id
```

Then wire delegation — on `session:quest_end`, create a review quest against the new agent:

```
events(action='create',
       name='route-diffs-to-reviewer',
       pattern='session:quest_end',
       tool_calls=[{
         "tool": "quests.create",
         "args": {
           "agent": "reviewer",
           "subject": "Review diff from {quest_id}",
           "description": "Check the quest worktree diff for regressions. Approve or request changes.",
           "priority": "normal"
         }
       }])
```

Contrast with an ephemeral case: compaction at `context:budget:exceeded` fires `session.spawn` (one-shot, no hire) — that's spawn-not-hire, and the child is gone after one turn.
