# Company Setup

> **Quick start:** Run `aeqi setup` -- it auto-detects whether you're in a workspace (git repo with `config/` and `agents/` dirs) or a fresh install, and creates all necessary structure. Fresh installs write to `~/.aeqi/` automatically. This document covers advanced/manual project configuration.

A **company** is an isolated operating unit in AEQI. Each company has its own:

- Git repository (working directory)
- Task store (`.tasks/` -- JSONL task DAG)
- Memory database (centralized SQLite + FTS5 + vector search, scoped by company name)
- Primer (inline in `aeqi.toml` -- injected into every agent's context)
- Departments (org chart hierarchy with lead agents)
- Worker pool (concurrent AEQI workers)
- Checkpoints (`.aeqi/checkpoints/` -- worker work-in-progress)

## Creating a Company

### 1. Add to config

In `config/aeqi.toml`:

```toml
[[companies]]
name = "mycompany"
prefix = "mc"                                    # Task ID prefix (mc-001, mc-002, ...)
repo = "/home/user/mycompany"                    # Git repo path (absolute)
model = "xiaomi/mimo-v2-pro"                     # LLM model for workers
max_workers = 3                                  # Max concurrent workers
execution_mode = "agent"                         # native AEQI worker runtime
worker_timeout_secs = 1800                       # 30 min timeout for hung workers
worktree_root = "/home/user/worktrees"           # Git worktree root (optional)
max_turns = 25                                   # Max agentic turns per worker
primer = """
MyCompany -- a Next.js web application with PostgreSQL backend.

Stack: Next.js 14 App Router, PostgreSQL 16, Prisma ORM, Redis sessions.
Deployed on Vercel (frontend) + Railway (API).

Key patterns:
- All API routes in app/api/ use middleware for auth
- Database migrations in prisma/migrations/
- Shared types in lib/types.ts
- JWT auth with 24h expiry, refresh tokens in httpOnly cookies
"""
```

The `primer` field is the company's knowledge brief. It is injected into every agent's context when working on this company. Put architecture, stack, conventions, and domain knowledge here.

### 2. Add departments (optional)

Departments define org chart structure within a company. Each department has a lead agent and member agents.

```toml
[[companies.departments]]
name = "engineering"
lead = "engineer"
agents = ["engineer", "reviewer"]
description = "Core application, API, infrastructure"

[[companies.departments]]
name = "product"
lead = "designer"
agents = ["designer"]
description = "Frontend, UX, design system"
```

### 3. Assign a team

Each company has a team with a leader and a set of agents:

```toml
team.leader = "engineer"
team.agents = ["engineer", "reviewer"]
```

Agent names here refer to agent templates defined in the `agents/` directory (see Agent Setup below).

### 4. Run diagnostics

```bash
aeqi doctor         # Check all companies
aeqi doctor --fix   # Auto-create missing directories/files
```

## Shared Primer

The `shared_primer` field in the `[aeqi]` section is injected into every agent across all companies. Use it for global rules, tool usage instructions, and cross-cutting standards.

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
avatar = "⚙"

[faces]
greeting = "(⌐■_■)"
thinking = "(¬_¬ )"
working = "(╯°□°)╯"
error = "(ಠ_ಠ)"
complete = "(⌐■_■)b"
idle = "(-_-)"

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

# Spawn with company scope
aeqi agent spawn cto --company mycompany

# List all agents in registry
aeqi agent registry

# List agents for a specific company
aeqi agent registry --company mycompany

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

Centralized SQLite database with FTS5 full-text search and vector similarity. Memory is scoped by company name and agent entity ID.

```bash
# Store a memory
aeqi remember "auth-flow" "Login uses JWT with 24h expiry" --company mycompany

# Search memories
aeqi recall "how does authentication work?" --company mycompany
```

Hybrid search: BM25 keyword matching + cosine vector similarity + temporal decay (30-day half-life). Results ranked by configurable weights (`vector_weight`, `keyword_weight`).

Agent-specific memories are scoped by the agent's stable UUID (entity ID), so each persistent agent accumulates its own knowledge across sessions.

## Skills

TOML-defined specialized behaviors in `projects/shared/skills/` or company-specific skill directories:

```toml
[skill]
name = "reviewer"
description = "Code review specialist"
phase = "autonomous"

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

```bash
# List skills
aeqi skill list --company mycompany

# Run a skill
aeqi skill run reviewer --company mycompany --prompt "the auth module"
```

## Tasks

Each company's tasks are JSONL files in `.tasks/`:

```bash
# Create a task
aeqi assign "Fix login bug" --company mycompany --priority high

# Check ready (unblocked) tasks
aeqi ready --company mycompany

# Show all open tasks
aeqi tasks --company mycompany

# Close a task
aeqi close mc-001 --reason "fixed in commit abc123"

# Mark done (also triggers cleanup)
aeqi done mc-001
```

Task IDs are hierarchical: `mc-001` (parent) -> `mc-001.1` (child) -> `mc-001.1.1` (grandchild).

## Context Layering

When a worker executes, its system prompt is built from these layers (in order):

```
1. Shared primer              (from [aeqi].shared_primer)
2. Company primer             (from [[companies]].primer)
3. Agent system prompt        (from agent.toml [prompt].system)
4. Worker protocol            (output format: DONE/BLOCKED/FAILED)
5. Checkpoint context         (max 8k chars, 5 most recent)
6. Memory recall              (hybrid search from SQLite, entity-scoped)
7. Task context               (subject, description, resume brief)
```

The `ContextBudget` system enforces per-layer character limits and truncates at newline boundaries. Total budget defaults to ~120k chars. Configurable via `[context_budget]` in `aeqi.toml`.

## Budget Control

Per-company budgets can be configured alongside the global daily cap:

```toml
# In aeqi.toml
[security]
max_cost_per_day_usd = 10.0    # Global cap

# Per-company (in [[companies]] block)
[[companies]]
name = "mycompany"
max_cost_per_day_usd = 5.0     # Company-specific cap
```

The worker pool checks budget before spawning any worker. Budget status visible via `aeqi daemon query cost`.

## CLI Flag Reference

All company-scoped commands use `--company` (short: `-r`). The old `--project` flag is accepted as a backward-compatible alias.

```bash
aeqi assign "task" --company mycompany
aeqi ready --company mycompany
aeqi recall "query" --company mycompany
aeqi remember "key" "content" --company mycompany
aeqi skill run name --company mycompany
aeqi monitor --company mycompany
aeqi audit --company mycompany
aeqi notes list --company mycompany
aeqi graph index --company mycompany
aeqi chat --company mycompany
```
