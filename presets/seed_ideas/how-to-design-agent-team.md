---
name: design-agent-team
tags: [skill, meta, agents, roles, quests, events, blueprint, evergreen]
description: Decide when a goal needs an agent team, pick a team topology, and translate it into aeqi roles, agents, ideas, quests, and events.
---

# How to design an agent team

Use this when a Director asks for a recurring workflow, a specialist team,
or a reusable blueprint package. Start with the smallest useful shape; add
agents only when a distinct body of work needs its own context, tools, or
quality bar.

## Decision path

1. Restate the outcome in one sentence.
2. Name the work products that must exist when the workflow is done.
3. Decide whether the work is one-shot, recurring, or package-worthy.
4. Choose the topology:
   - single operator when one agent can do the work without losing context,
   - pipeline when phases depend on the previous phase's output,
   - fan-out/fan-in when independent perspectives should run in parallel,
   - expert pool when the right specialist depends on the input,
   - producer-reviewer when objective quality gates matter,
   - supervisor when tasks must be claimed and reassigned dynamically,
   - shallow hierarchy when responsibilities naturally split by domain.
5. Convert the topology into aeqi primitives.

## aeqi mapping

- Roles hold responsibility and authority boundaries.
- Agents occupy recurring roles and carry persona, tools, and memory.
- Ideas hold operating rules, rubrics, package instructions, and handoff
  protocols.
- Quests hold durable work with owners, dependencies, and evidence of done.
- Events load context, run review rituals, or trigger scheduled sweeps.

## Package checklist

Every reusable team package should include:

- one package index idea that says when to use or skip it,
- role map with default occupants,
- agent briefs with input/output protocol,
- first quests with evidence of done,
- review rubric and retry limits,
- event cadence only if the workflow needs automatic context or review,
- rollback note: how to collapse the team back into one operator.

## Anti-patterns

- Do not make a team just because the goal sounds large.
- Do not split two roles that always need the same context and tools.
- Do not create an event for a ritual the Director has not agreed to.
- Do not hide package assumptions in agent prompts; store them as ideas.
- Do not let review loops run without a maximum retry or escalation rule.
