---
name: orchestrate-runtime-events
tags: [skill, meta, event, events, runtime, ideas, evergreen]
description: Design runtime events that load context, run rituals, recover from failures, and keep automation inspectable.
---

# How to orchestrate runtime events

Runtime events are the automation layer of aeqi. They should make sessions
smarter and routines more reliable without hiding control from the Director.
Create an event only when a pattern should predictably load context, run a
ritual, handle a guardrail, or recover from a known failure.

## Good event shapes

- `session:start`: assemble identity, standing rules, and current snapshot.
- `session:execution_start`: load recent decisions, preferences, and active
  work for every fresh turn.
- `session:step_start`: add procedural context before tool-heavy work.
- `session:quest_start`: assemble requirements, ownership, and completion
  criteria.
- `session:quest_end`: run reflection, store durable learnings, and update
  snapshots.
- `session:quest_result`: search for follow-up work and reusable evidence.
- `schedule:<cron>`: run an agreed review, digest, sweep, or consolidation.
- Middleware signals: react to `shell:command_failed`, `loop:detected`,
  `guardrail:violation`, or `context:budget:exceeded`.

## Design rules

- Prefer context-loading tool calls before side-effecting tool calls.
- Give every event a narrow name and a visible purpose.
- Use cooldowns for noisy patterns.
- Keep cron events agent-scoped; schedules cannot be global.
- If an event writes ideas or quests, make the output schema explicit.
- Avoid surprise automation. The Director should be able to inspect,
  disable, and understand every event.

## Event review

During weekly review, check:

- Which events fired?
- Did they help the agent make a better decision?
- Did they create stale or duplicate ideas?
- Did they run too often?
- Should the event be disabled, narrowed, or promoted into a package?

