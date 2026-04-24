---
name: meta:event-template:daily-digest
tags: [meta, template, event-template]
description: Template for a per-agent daily-digest event that fires the daily reflector at midnight. Copy this per-agent — global schedule:* events are rejected by the runtime.
---

# Event template: `daily-digest`

Schedule-based events must be per-agent in the current runtime (a global
`schedule:*` row is rejected because the scheduler needs an agent to fire
against). To activate daily reflection for an agent, create one of these rows
pointing at the agent:

```
events(action='create',
       agent_id='<agent-id>',
       name='daily-digest',
       pattern='schedule:0 0 * * *',
       tool_calls=[{
         "tool": "session.spawn",
         "args": {
           "kind": "compactor",
           "instructions_idea": "meta:daily-reflector-template",
           "seed_content": "Review the last 24 hours of ideas for agent {agent_id}.",
           "parent_session": "{session_id}"
         }
       }])
```

## What it does

Once per day at midnight, the scheduler fires a `schedule:0 0 * * *` pattern
for the owning agent. The event spawns a one-shot compactor session running
`meta:daily-reflector-template`, which reviews the last 24 h of ideas,
promotes stable ones to `evergreen`, and flags contradictions.

## Follow-up (R5)

The runtime will expose a hook in `AgentRegistry::spawn` that auto-installs
this template (and `weekly-consolidate`) on every newly-hired agent. Until
then, operators opt in explicitly.
