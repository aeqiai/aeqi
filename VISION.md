# AEQI

An unopinionated agent orchestration kernel.

## One sentence

A tree of agents that grows from conversation, remembers everything,
acts autonomously, and reshapes itself from within.

## The insight

Every agent system hits the same wall: the framework decides what agents
are before the intelligence does. Departments are a type. Skills are a type.
Projects are a type. The schema calcifies before the system learns what
it needs to be.

Remove the types. One primitive: the agent. A node in a tree with a name,
prompts, and a position. Everything else — departments, teams, specialists,
reviewers, entire companies — is a pattern that emerges from how agents
arrange themselves and what their prompts say.

The system has no schema for what you're building. It has a tree that can
become anything.

## Four tables

```
agents     who        — a node in the tree
tasks      what       — a unit of work
events     happened   — immutable log
memories   known      — searchable knowledge
```

One field type appears everywhere:

```
prompts    how        — ordered instructions on agents, tasks, triggers
```

No departments table. No skills table. No projects table. No workflows
table. No roles table. Four tables and a JSON array. That's the entire
operating system.

## The tree

```
root (the user's single chat window)
├── shadow (personal assistant)
│   ├── engineer (code)
│   ├── reviewer (quality)
│   └── researcher (analysis)
└── ops (infrastructure)
    ├── monitor (triggers on events)
    └── deployer (CI/CD automation)
```

This tree wasn't designed. It was grown. The user said "I need help with
code" and the root agent spawned an engineer. "Review my PRs" and the
engineer spawned a reviewer. "Watch for errors" and a monitor appeared
with event triggers.

The same kernel handles a solo developer with one agent and an organization
with hundreds. No migration. The tree just grows.

## Inheritance

Everything walks the tree. Set a budget on a parent, every descendant is
constrained. Set a working directory on a project agent, every child knows
where to work. Write a prompt on the root, every agent in the tree inherits it.

Model, budget, workdir, timeout, prompts — resolved by walking parent_id
from leaf to root. Set once, inherited everywhere. Override at any node.

Memory searches walk upward: an agent sees its own memories, its parent's,
its grandparent's, up to root. Shared memories propagate sideways between
siblings. Context flows through the tree like thought through a nervous system.

## Prompts, not code

Skills don't exist. Templates don't exist. System prompts, primers, personas,
role definitions — none of these are distinct concepts. They're all entries
in a prompts[] array with a position (system/prepend/append) and a scope
(self/descendants).

A "skill" is prompts loaded onto a task. A "template" is prompts loaded
onto a new agent. A "primer" is prompts on an ancestor with scope=descendants.
The files on disk are presets. The primitive is the prompt.

This means the AI writes its own skills. It writes its own templates. It
writes prompts for agents that don't exist yet, spawns them, and the new
agents start working immediately. No deployment. No configuration. No
human in the loop unless you want one.

## Events, not stores

Everything that happens is one row in one table. A message, a decision,
a cost, a dispatch, a task completion — all events. The audit log is a
query. The cost report is a query. The session transcript is a query.
Expertise scores are a query.

One write path. One table. One query language. The system is its own
observability layer.

## The loop

```
wake → reap → query → spawn
```

Event-driven. Zero latency between intent and execution. A task is created,
the scheduler wakes, a worker spawns. The worker completes, the scheduler
wakes again. No polling. No timers. No 30-second patrol cycles.

Workers are ephemeral. Identity is persistent. Each task gets a fresh
execution context loaded with the agent's accumulated prompts, memories,
and tool access. The agent doesn't remember the session. It remembers
everything important — because it chose what to store in memory.

## Self-modification

Agents can:
- Spawn child agents with arbitrary prompts
- Rewrite their own and their children's prompts
- Create triggers (cron, event, webhook) that fire autonomously
- Delegate tasks to any agent in the tree
- Store memories visible to themselves, descendants, or siblings
- Query the event log to reflect on what happened and why
- Modify the tree structure — reparent, retire, activate agents

The root agent is the admin. There is no separate admin interface.
The system modifies itself through the same conversation the user has.
An agent that can read events, write prompts, and spawn agents is an
agent that can redesign itself.

## Constraints

The architecture enables runaway intelligence. The configuration constrains it.

- **Budget** — USD limits per agent, inherited down the tree
- **Autonomy** — readonly / supervised / full
- **Concurrency** — max parallel workers per agent
- **Approval queue** — require human sign-off before acting
- **Timeout** — hard abort after configurable duration
- **Tool restrictions** — allow/deny lists per prompt entry

Fast engine. Good brakes. The user decides how much rope to give.

## The product

User signs up. Gets one agent. Starts talking.

"Help me with my codebase" — the agent sets its workdir, starts learning.

"Review my PRs automatically" — it spawns a reviewer, creates a webhook trigger.

"Build me an engineering team" — it creates a subtree of specialists with
prompts, budgets, and triggers. The team starts working.

"That reviewer is too strict" — the user talks to the root agent, which
rewrites the reviewer's prompts. Behavior changes immediately.

No setup wizard. No YAML files. No dashboard configuration. The conversation
IS the configuration. The conversation IS the product.

One person with one agent scales to an organization with hundreds. Same code.
Same database. Same four tables. The tree grows, intelligence compounds,
and the system becomes whatever the user needs it to be.

## What this is

A kernel for machine intelligence that:

- Starts from nothing and grows from conversation
- Has no opinion about structure — structure emerges
- Stores everything that happens and everything it learns
- Modifies itself through the same interface the user sees
- Compounds — each session makes every future session smarter
- Scales from one agent to thousands with zero architectural change

Four tables. One loop. A tree that thinks.
