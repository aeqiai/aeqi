---
name: create-quest
tags: [skill, meta, quest]
description: How to convert actionable work into an AEQI quest with its own worktree.
---

# Skill: create a quest

Quests are AEQI's unit of work. Each quest owns a git worktree, runs in a sandbox, and closes with a result. If a task needs code changes, multiple steps, or more than one turn — make it a quest.

## Tool

```
quests(action='create',
       agent='<agent-name-or-id>',        // optional; defaults to yourself
       subject='<short verb-phrase title>',
       description='<what, why, acceptance criteria>',
       priority='low'|'normal'|'high'|'critical',
       idea_ids=['<id>', ...])            // optional, attach context
```

Omit `agent` to assign to yourself. Pass another agent's name or id to delegate.

## What makes a good quest

- Subject is a verb phrase. "Fix the daemon startup race", not "Startup".
- Description specifies acceptance — how will you know it's done?
- Scope is one worktree's worth. If it spans many projects, split it.
- Priority = urgency, not importance. High = blocking a human.

## Other actions

- `quests(action='list'|'show'|'update'|'close'|'cancel', quest_id=..., ...)`.
- Close with `result='<summary>'`. Cancel with `reason='...'`.

## When NOT to create a quest

Single tool calls, one-line answers, pure-knowledge asks. Just do them.

## Example

User: "The signup page breaks on iOS Safari — the email field overflows the container. Fix it."

This is work-shaped (multi-file diff, needs a worktree, needs verification). Create a quest rather than editing in-session:

```
quests(action='create',
       subject='Fix signup email field overflow on iOS Safari',
       description='On iOS Safari the email input in apps/ui/src/pages/SignupPage.tsx overflows its container because the input inherits min-width: auto from flex. Fix with min-width: 0 on the input. Acceptance: field renders inside the card on iPhone 14 Safari at 390px width; no regressions on desktop.',
       priority='high')
```

After the quest closes with a diff, verify by loading Storybook at that breakpoint — closing `result='...'` should state how you verified, not just "done".
