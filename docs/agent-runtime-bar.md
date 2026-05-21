# Agent Runtime Bar

AEQI should be easier to start, harder to misconfigure, and more useful as a
system of record than the current public agent runtimes.

This document is a product bar, not a feature checklist. The comparison set will
change. The standard should not.

## Current Comparator Shape

Public docs and READMEs for [Hermes Agent](https://github.com/NousResearch/hermes-agent)
and [OpenClaw](https://github.com/openclaw/openclaw) show the 2026 baseline:

- One-command install or onboarding is table stakes.
- A memorable first conversation is not enough; users expect persistent memory,
  skills, model choice, and scheduled or always-on work.
- Messaging channels and remote operation make the agent feel present outside a
  terminal.
- Security defaults, doctor commands, update paths, and sandbox language are
  part of the product, not only operator docs.
- Contributors expect the source checkout to bootstrap itself and to explain
  when runtime state is separate from source state.

AEQI already has stronger foundations for durable work: agents, ideas, quests,
events, MCP, code graph context, a Rust daemon, embedded dashboard, SQLite
state, and hosted/self-hosted boundaries. The gap is making the first hour feel
as coherent as the architecture.

## How AEQI Should Win

AEQI should be the agent runtime where intent becomes auditable work:

- `ideas` preserve durable context and decisions.
- `quests` preserve ownership, status, dependencies, evidence, and outcomes.
- `events` wake the system through schedules, hooks, and lifecycle patterns.
- `agents` execute with identity, instructions, tools, budgets, and hierarchy.
- MCP makes the runtime usable from external coding agents and editors without
  moving the system of record into a vendor transcript.

The product promise is not "a chat bot that can use tools." The promise is a
runtime that can remember, assign, execute, verify, and explain work.

## Required New-User Bar

A first-time operator or contributor should be able to answer these questions in
under ten minutes:

1. Am I using hosted TRUST, local demo, self-hosted runtime, or source checkout?
2. Where is runtime state: home-scoped `~/.aeqi` or workspace-local config?
3. Which command proves the runtime is healthy?
4. Which command creates the first durable quest?
5. Which command verifies the whole first-run path without touching my real
   home directory?

The repo already has the right verification hook:

```bash
scripts/smoke-fresh-install.sh
```

The docs should keep pointing new contributors toward that smoke path instead
of asking them to infer success from a list of build commands.

## Near-Term Product Direction

Prioritize the work that turns AEQI's primitives into an obvious first success:

- Keep source setup and runtime setup visibly separate in README, quickstart,
  and contributor docs.
- Make `doctor --strict` name the exact next command for each optional or
  blocking issue.
- Make the first quest create a durable artifact the operator can reopen from
  CLI or dashboard.
- Make MCP setup verification a first-class onboarding lane, not an advanced
  appendix.
- Keep dashboard first-run focused on paths, configured runtime, provider
  readiness, agent list, and the first quest.

The strongest version of AEQI is not the broadest assistant. It is the runtime
where an operator can see what the agents know, what they own, what they did,
what they verified, and what should happen next.
