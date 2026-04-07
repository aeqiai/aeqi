# Project Setup

> **Quick start:** Run `aeqi setup` -- it auto-detects whether you're in a workspace (git repo with `config/` and `agents/` dirs) or a fresh install, and creates all necessary structure. Fresh installs write to `~/.aeqi/` automatically. This document covers advanced/manual project configuration.

A **project** is an agent in the AEQI tree that represents a codebase or work scope. Each project has:

- A git repository (working directory)
- Quest store (tracked work items)
- Memory (scoped by project agent UUID)
- Primer (inherited prompts injected into every descendant agent's context)
- Child agents (the team that works on this project)

## Creating a Project

### 1. Add to config

In `config/aeqi.toml`:

```toml
[[companies]]
name = "myproject"
prefix = "mp"
repo = "/home/user/myproject"
model = "xiaomi/mimo-v2-pro"
max_workers = 3
max_turns = 25
execution_mode = "agent"
worker_timeout_secs = 1800
primer = """
MyProject -- a Next.js web application with PostgreSQL backend.

Stack: Next.js 14 App Router, PostgreSQL 16, Prisma ORM, Redis sessions.
Deployed on Vercel (frontend) + Railway (API).

Key patterns:
- All API routes in app/api/ use middleware for auth
- Database migrations in prisma/migrations/
- Shared types in lib/types.ts
- JWT auth with 24h expiry, refresh tokens in httpOnly cookies
"""
```

The `primer` on a company is inherited by all agents working in that scope. Put architecture, stack, conventions, and domain knowledge here.

### 2. Assign a team

Child agents are spawned under the project agent:

```bash
aeqi agent spawn cto --parent myproject
aeqi agent spawn engineer --parent myproject
aeqi agent spawn reviewer --parent myproject
```

Agent names refer to agent templates defined in the `agents/` directory. Child agents inherit the project's prompts, workdir, model, and budget constraints.

### 3. Run diagnostics

```bash
aeqi doctor         # Check all projects
aeqi doctor --fix   # Auto-create missing directories/files
```

## Shared Primer

The root agent's prompts are inherited by every agent in the tree. Use the root's prompts for global rules, tool usage instructions, and cross-cutting standards.

```toml
[aeqi]
name = "emperor-system"
data_dir = "~/.aeqi"

shared_primer = """
# AEQI

## For Every Task
1. `aeqi_recall(project, query)` -- gate-enforced before any edit
2. Load a workflow skill
3. Follow the loaded workflow step by step

## Rules
- No comments except `///` on public APIs
- DRY. Extract at two, refactor at three
- Worktrees only. Never edit dev/master
"""
```

## Agent Setup

Agents are persistent identities stored in a SQLite registry. They are defined as template files on disk and spawned into the registry.

### Agent template format

Each agent lives in `agents/<name>/agent.toml`:

```toml
display_name = "CTO"
model_tier = "capable"           # resolved via [models] in aeqi.toml
max_workers = 2
max_turns = 30
expertise = ["architecture", "systems", "rust"]
capabilities = ["spawn_agents", "manage_triggers"]
color = "#00BFFF"
avatar = "gear"

[[triggers]]
name = "memory-consolidation"
schedule = "every 6h"
skill = "memory-consolidation"

[prompt]
system = """
You are CTO -- the technology executive. You own architecture, engineering
quality, and technical strategy. Implementation is delegated.

# Competencies
- Architecture -- system design, service boundaries, data flow
- Engineering quality -- code review, testing strategy, tech debt
- Systems programming -- Rust, async, memory, performance

# How You Operate
1. Assess scope -- quick fix or architectural change?
2. Check landscape -- what exists, what can be reused?
3. Design solution -- options with trade-offs, recommend one
4. Delegate implementation -- break into tasks, dispatch
5. Review ruthlessly -- spec compliance first, quality second
"""
```

### Spawning agents

```bash
# Spawn from template directory name
aeqi agent spawn cto

# Spawn with project scope
aeqi agent spawn cto --parent myproject

# List all agents in registry
aeqi agent registry

# Show agent details
aeqi agent show cto

# Retire (preserves memory)
aeqi agent retire cto

# Reactivate
aeqi agent activate cto
```

Spawned agents get a stable UUID in the registry. The UUID is the entity ID for memory scoping -- memories accumulate across sessions.

### Model tiers

Agents declare `model_tier` instead of hardcoding model names:

- `capable` -- architecture, security, complex decisions
- `balanced` -- standard work, review, implementation
- `fast` -- simple queries, formatting
- `cheapest` -- health checks, memory consolidation

The `[models]` config in `aeqi.toml` resolves tiers to actual model strings.

### Shipped agents

| Agent | Directory | Function |
|-------|-----------|----------|
| Shadow | `shadow/` | Personal assistant, default identity |
| CEO | `ceo/` | Strategic coordination |
| CTO | `cto/` | Architecture, engineering |
| CPO | `cpo/` | Product, UX |
| CFO | `cfo/` | Financial ops, trading, risk |
| COO | `coo/` | Deployment, reliability |
| GC | `gc/` | Legal, compliance |
| CISO | `ciso/` | Security, threat modeling |

## Memory

Centralized SQLite database with FTS5 full-text search and vector similarity. Memory is scoped by agent entity ID and walks the agent tree for inheritance.

```bash
# Store a memory
aeqi remember "auth-flow" "Login uses JWT with 24h expiry" --project myproject

# Search memories
aeqi recall "how does authentication work?" --project myproject
```

Hybrid search: BM25 keyword matching + cosine vector similarity + temporal decay (30-day half-life). Results ranked by configurable weights (`vector_weight`, `keyword_weight`).

Agent-specific memories are scoped by the agent's stable UUID (entity ID), so each persistent agent accumulates its own knowledge across sessions. Memory searches walk upward through the agent tree: an agent sees its own memories, its parent's, and ancestors' up to root.

## Skills

TOML-defined specialized behaviors in `projects/shared/skills/` or project-specific skill directories:

```toml
[skill]
name = "reviewer"
description = "Code review specialist"

[tools]
allow = ["shell", "file_read", "list_dir"]
deny = ["file_write"]

[prompt]
system = """
You are a code review specialist. Focus on:
- Security vulnerabilities (OWASP top 10)
- Performance anti-patterns
- Type safety gaps
- Missing test coverage
"""
```

Skills are injected at session spawn time. Multiple skills can stack -- tool restrictions are intersected (most restrictive wins).

## Quests

Tracked work items with status, priority, dependencies, acceptance criteria, checkpoints, and retry logic.

```bash
# Create a quest
aeqi assign "Fix login bug" --project myproject --priority high

# Check ready (unblocked) quests
aeqi ready --project myproject

# Show all open quests
aeqi quests --project myproject

# Close a quest
aeqi close sg-001 --reason "fixed in commit abc123"
```

Quest IDs are hierarchical: `sg-001` (parent) -> `sg-001.1` (child) -> `sg-001.1.1` (grandchild).

## Context Layering

When a worker executes, its context is built from these layers:

```
1. Root agent prompts             (scope=descendants, inherited down the tree)
2. Parent agent prompts           (scope=descendants, project-level context)
3. Agent system prompt            (scope=self, from agent.toml)
4. Task prompts                   (quest description + skill prompts)
5. Dynamic recall                 (hybrid search from memory, entity-scoped)
6. Quest tree context             (parent, children, done siblings)
7. Checkpoints / resume brief     (prior attempts, git state, audit trail)
```

Prompt assembly walks the agent tree from root to leaf, collecting all prompts with `scope=descendants`, then appends the agent's own prompts and task prompts.

## Budget Control

Per-scope budget enforcement with auto-pause:

```toml
# In aeqi.toml
[security]
max_cost_per_day_usd = 10.0    # Global cap
```

The scheduler checks budget before spawning any session. Budget status visible via `aeqi daemon query cost`.
