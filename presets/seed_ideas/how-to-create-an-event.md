---
name: create-event
tags: [skill, event]
description: How to configure pattern-triggered tool calls — the "when" primitive.
---

# Skill: create an event

Events are AEQI's automation layer. An event is a pattern + a list of tool calls. When the pattern fires (session lifecycle, schedule, webhook, middleware signal), the tool calls execute — possibly assembling ideas into a prompt, spawning sub-agents, or injecting context.

## Tool

```
events(action='create',
       agent_id=<id or null for global>,
       name='<descriptive name>',
       pattern='<pattern>',
       tool_calls=[{tool: '<name>', args: {...}}])
```

## Pattern vocabulary

Session lifecycle:
- `session:start` — fires once at session birth (like a system prompt)
- `session:execution_start` — every turn (resume or fresh)
- `session:quest_start` — quest is assigned
- `session:quest_end` — quest is being closed
- `session:quest_result` — a delegated quest returned
- `session:step_start` — each step within a turn
- `session:stopped` — user cancelled a running turn
- `context:budget:exceeded` — token budget tripped (delegate compaction here)

Schedules (cron):
- `schedule:0 9 * * *` — every day at 09:00
- `schedule:*/15 * * * *` — every 15 minutes

Middleware signals:
- `loop:detected` — same tool called with identical args N times
- `guardrail:violation` — denied tool call
- `graph_guardrail:high_impact` — code graph flagged a risky change
- `shell:command_failed` — sandboxed shell exited non-zero

Custom:
- `webhook:<token>` — external HTTP trigger
- `agent:<name>:<signal>` — emitted by other agents via `events(action='emit', ...)`

## Tool call shapes

Most common:

```
{tool: 'ideas.assemble', args: {names: ['idea-slug-1', 'idea-slug-2']}}
{tool: 'ideas.search', args: {query: '<templated>', tags: ['promoted'], top_k: 5}}
{tool: 'transcript.inject', args: {role: 'system', content: '...'}}
{tool: 'session.spawn', args: {agent: '<name>', seed: '...'}}
```

Placeholders like `{quest_description}`, `{tool_name}`, `{session_id}` are substituted from trigger_args at fire time.

## Global vs agent-scoped

- `agent_id=NULL` — applies to all agents as a default. Used for lifecycle seeds.
- `agent_id=<id>` — only that agent fires. Agent-specific rituals go here.

Agent-scoped events take precedence over global when both match a pattern.

## Minimal example

Schedule a daily standup:

```
events(action='create',
       agent_id=null,
       name='morning_standup',
       pattern='schedule:0 9 * * *',
       tool_calls=[
         {tool: 'session.spawn',
          args: {agent: 'leader',
                 seed: 'What happened yesterday, what are you doing today, where are you blocked?'}}])
```
