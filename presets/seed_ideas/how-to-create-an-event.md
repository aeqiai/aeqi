---
name: create-event
tags: [skill, meta, event]
description: How to configure pattern-triggered automation — the "when" primitive.
---

# Skill: create an event

Events are AEQI's automation layer. An event has a pattern (when) and, when fired, either surfaces attached ideas or runs pre-configured tool calls. Patterns cover the session lifecycle, cron schedules, middleware signals, and custom webhooks.

## Tool

```
events(action='create',
       name='<descriptive name>',
       pattern='session:start',          // or use 'schedule'/'event_pattern' shorthands
       idea_ids=['<id>', ...],           // attach ideas surfaced when pattern fires
       cooldown_secs=0)
```

Shorthands: `schedule='0 9 * * *'` expands to `pattern='schedule:0 9 * * *'`. `event_pattern='quest_start'` expands to `pattern='session:quest_start'`.

## Pattern vocabulary

Lifecycle seeds: `session:start` (once per session), `session:execution_start` (every turn), `session:quest_start`, `session:quest_end`, `session:quest_result`, `session:step_start`, `session:stopped`, `context:budget:exceeded`.

Other: `schedule:<cron>`, `webhook:<token>`, middleware signals (`loop:detected`, `guardrail:violation`, `shell:command_failed`).

## Other actions

- `events(action='list')` — show this agent's events.
- `events(action='enable'|'disable', event_id=...)`.
- `events(action='delete', event_id=...)`.

## Tip

Attach `idea_ids` to have ideas assemble into the session context when the pattern fires. That's how you wire a recurring ritual (e.g. a weekly-review checklist on `schedule:0 9 * * 1`).

## Example

User: "Every time a quest ends, run the reflector and save the facts it extracts."

This is a pattern-triggered automation — `session:quest_end` plus a `session.spawn` tool_call that runs the reflector persona. One row, no `idea_ids` (the persona is passed as `instructions_idea`, not assembled into the parent session):

```
events(action='create',
       name='reflect-after-quest',
       pattern='session:quest_end',
       tool_calls=[{
         "tool": "session.spawn",
         "args": {
           "kind": "compactor",
           "instructions_idea": "meta:reflector-template",
           "seed_content": "{quest_transcript}",
           "parent_session": "{session_id}"
         }
       }],
       cooldown_secs=0)
```

Realistic gotcha: `schedule:*` patterns are rejected at the global scope — the scheduler needs an agent to fire against. For cron-based rituals, pass `agent_id=<your-id>` explicitly.
