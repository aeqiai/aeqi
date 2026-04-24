---
name: meta:event-template:weekly-consolidate
tags: [meta, template, event-template]
description: Template for a per-agent weekly-consolidate event that fires the weekly consolidator every Sunday at midnight.
---

# Event template: `weekly-consolidate`

Like the daily digest, schedule events must be per-agent. Copy this template
per agent:

```
events(action='create',
       agent_id='<agent-id>',
       name='weekly-consolidate',
       pattern='schedule:0 0 * * 0',
       tool_calls=[{
         "tool": "session.spawn",
         "args": {
           "kind": "compactor",
           "instructions_idea": "meta:weekly-consolidator-template",
           "seed_content": "Consolidate cold ideas older than 7 days for agent {agent_id}.",
           "parent_session": "{session_id}"
         }
       }])
```

## What it does

Every Sunday at midnight the scheduler fires `schedule:0 0 * * 0`. The
event spawns a one-shot compactor running `meta:weekly-consolidator-template`
which clusters cold ideas by tag, distills each cluster into a meta-idea, and
archives originals via `distilled_into` edges.

## Follow-up (R5)

Same as `daily-digest` — a future `AgentRegistry::spawn` hook will auto-install
this template on every new agent.
