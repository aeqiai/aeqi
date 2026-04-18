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

Remove the types. Four primitives: agents, ideas, quests, events.
Everything else -- departments, teams, specialists, reviewers, entire
companies -- is a pattern that emerges from how agents arrange themselves
and what their ideas say.

The system has no schema for what you're building. It has a tree that can
become anything.

## Four primitives

```
agents     who        -- a node in the tree
ideas      known      -- knowledge, identity, instructions, memories
quests     what       -- a unit of work
events     when       -- reaction rules that fire autonomously
```

Plus activity as infrastructure (audit log, costs -- not a primitive).

No departments table. No skills table. No projects table. No workflows
table. No roles table. Four primitives. That's the entire operating system.

## The tree

```
root (the user's single chat window)
+-- shadow (personal assistant)
|   +-- engineer (code)
|   +-- reviewer (quality)
|   +-- researcher (analysis)
+-- ops (infrastructure)
    +-- monitor (events on patterns)
    +-- deployer (CI/CD automation)
```

This tree wasn't designed. It was grown. The user said "I need help with
code" and the root agent spawned an engineer. "Review my PRs" and the
engineer spawned a reviewer. "Watch for errors" and a monitor appeared
with event rules.

The same kernel handles a solo developer with one agent and an organization
with hundreds. No migration. The tree just grows.

## Inheritance

Everything walks the tree. Set a budget on a parent, every descendant is
constrained. Set a working directory on an agent, every child knows where
to work. Attach an idea to the root, every agent in the tree inherits it.

Model, budget, workdir, timeout, ideas -- resolved by walking parent_id
from leaf to root. Set once, inherited everywhere. Override at any node.

Idea searches walk upward: an agent sees its own ideas, its parent's,
its grandparent's, up to root. Shared ideas propagate sideways between
siblings. Context flows through the tree like thought through a nervous system.

## Ideas, not code

Skills don't exist as a separate concept. Templates don't exist. System
prompts, primers, personas, role definitions -- none of these are distinct
types. They're all ideas, and activation is decided by events:

- An idea referenced by a `session:start` event = always in context (identity, instructions)
- An idea referenced by any other event = loaded when that event fires
- An idea no event references = recalled via semantic search on demand

A "skill" is an idea an event activates on a quest. A "template" is ideas
loaded onto a new agent. A "primer" is an idea on an ancestor with
inheritance=descendants. The primitive is the idea; the event decides
when it fires.

This means the AI writes its own instructions. It creates ideas for agents
that don't exist yet, spawns them, and the new agents start working
immediately. No deployment. No configuration. No human in the loop unless
you want one.

## Events, not triggers

Events define when agents act autonomously. A schedule, a pattern match,
a webhook -- all events. An event belongs to a specific agent or is
**global** (agent_id IS NULL) -- globals fire for every agent, which is
how the six session lifecycle events ship: one row per phase, shared by
every agent in the tree.

When an event fires, its referenced ideas are concatenated into the
session's system prompt (in walk order: root ancestor → ... → self →
task ideas) and the scheduler spawns a worker. The loop continues.

## Activity, not stores

Everything that happens is one row in one table. A decision, a cost,
a quest completion -- all activity entries. The audit log is a query.
The cost report is a query. Expertise scores are a query.

One write path. One table. One query language. The system is its own
observability layer.

## The loop

```
wake --> reap --> query --> spawn
```

Event-driven. A quest is created, the scheduler wakes, a worker spawns.
The worker completes, the scheduler wakes again.

Workers are ephemeral. Identity is persistent. Each quest gets a fresh
execution context loaded with the agent's accumulated ideas and tool
access. The agent doesn't remember the session. It remembers everything
important -- because it chose what to store as ideas.

## Self-modification

Agents can:
- Spawn child agents with arbitrary ideas
- Rewrite their own and their children's ideas
- Create events (schedule, pattern, webhook) that fire autonomously
- Delegate quests to any agent in the tree
- Store ideas visible to themselves, descendants, or siblings
- Query activity to reflect on what happened and why
- Modify the tree structure -- reparent, retire, activate agents

The root agent is the admin. There is no separate admin interface.
The system modifies itself through the same conversation the user has.

## Constraints

The architecture enables runaway intelligence. The configuration constrains it.

- **Budget** -- USD limits per agent, inherited down the tree
- **Autonomy** -- readonly / supervised / full
- **Concurrency** -- max parallel workers per agent
- **Approval queue** -- require human sign-off before acting
- **Timeout** -- hard abort after configurable duration
- **Tool restrictions** -- allow/deny lists per idea

Fast engine. Good brakes. The user decides how much rope to give.

## The product

User signs up. Gets one agent. Starts talking.

"Help me with my codebase" -- the agent sets its workdir, starts learning.

"Review my PRs automatically" -- it spawns a reviewer, creates a webhook event.

"Build me an engineering team" -- it creates a subtree of specialists with
ideas, budgets, and events. The team starts working.

"That reviewer is too strict" -- the user talks to the root agent, which
rewrites the reviewer's ideas. Behavior changes immediately.

No setup wizard. No YAML files. No dashboard configuration. The conversation
IS the configuration. The conversation IS the product.

One person with one agent scales to an organization with hundreds. Same code.
Same database. Same four primitives. The tree grows, intelligence compounds,
and the system becomes whatever the user needs it to be.

## What this is

A kernel for machine intelligence that:

- Starts from nothing and grows from conversation
- Has no opinion about structure -- structure emerges
- Stores everything that happens and everything it learns
- Modifies itself through the same interface the user sees
- Compounds -- each session makes every future session smarter
- Scales from one agent to thousands with zero architectural change

Four primitives. One loop. A tree that thinks.
