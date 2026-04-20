---
name: create-quest
tags: [skill, quest]
description: How to convert actionable work into an AEQI quest with its own worktree.
---

# Skill: create a quest

Quests are AEQI's unit of work. Each quest owns a git worktree, collects a diff, and closes with a summary. If a task needs code changes, multiple steps, or will take more than one turn to complete — make it a quest.

## Tool

```
quests(action='create',
       root='<root-agent-id>',
       subject='<short title>',
       description='<what, why, acceptance criteria>',
       priority='high'|'normal'|'low')
```

Or via CLI:

```
aeqi assign '<subject>' --root <root> --description '<body>' --priority normal
```

## What makes a good quest

- **Subject is a verb phrase.** "Fix the daemon startup race", not "Startup".
- **Description specifies acceptance.** How will you know it's done? What file or behavior changes?
- **Scope is one worktree's worth.** If the answer is "touches five projects", split it.
- **Priority reflects urgency, not importance.** High = blocking a human. Normal = default.

## Assigning vs doing

- If the current agent owns the problem and can finish it in-session: just do it, no quest.
- If another agent is a better owner: create the quest under their root.
- If the work spans multiple sessions: always a quest — the worktree + diff persistence matters.

## After creation

The quest flows through the dispatcher. The assignee gets a `session:quest_start` event and begins work inside its worktree. You can follow progress via `quests(action='list')` and `quests(action='get', id=...)`.

## Closing

The assignee closes with `quests(action='close', id=..., status='completed'|'blocked', summary='...')`. If you need to intervene, use `quests(action='reassign', id=..., to=...)`.
