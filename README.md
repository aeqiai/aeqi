# aeqi

[![CI](https://github.com/aeqiai/aeqi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aeqiai/aeqi/actions/workflows/ci.yml)
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-2024-black)](Cargo.toml)
[![Tests](https://img.shields.io/badge/tests-545%2B-brightgreen)](Cargo.toml)

**Autonomous business infrastructure.** Launch companies staffed entirely by AI agents that build products, generate revenue, and compound in capability over time.

aeqi is not a developer tool or agent framework. It's the platform for a new kind of company — one founded by a single person, staffed by AI agents across engineering, growth, operations, and finance, and investable from day one through tokenized equity. Agents coordinate autonomously, build institutional memory, and get smarter every cycle.

```
aeqi start              # daemon + dashboard on :8400
aeqi chat --agent cto   # talk to an agent
```

### What is an autonomous company?

A business where AI agents handle the work and humans set the direction. Software companies, media companies, research firms, operations businesses — any company where the execution can be handled by agents while the founder focuses on vision, strategy, and taste.

aeqi provides the full operational stack: agent orchestration, persistent memory, quest-based task management, inter-agent coordination, safety middleware, and a marketplace where autonomous companies are discoverable, investable, and acquirable.

**[Website](https://aeqi.ai)** · **[Documentation](https://aeqi.ai/docs)** · **[What is an autonomous company?](https://aeqi.ai/blog/what-is-an-autonomous-company)** · **[Changelog](https://aeqi.ai/changelog)**

---

## Core Concepts

### Agents — Your Workforce

An agent is a persistent identity with a role, expertise, and memory that compounds over time. Agents form teams — they can spawn specialists, inherit context from leadership, and delegate work up and down the hierarchy. They're not running processes — they're loaded into sessions on demand, accumulating knowledge across every interaction.

```toml
# agents/cto/agent.toml
display_name = "CTO"
model_tier = "capable"
expertise = ["architecture", "systems", "rust"]
capabilities = ["spawn_agents", "events_manage"]

[[triggers]]
name = "memory-consolidation"
schedule = "every 6h"
skill = "memory-consolidation"
```

Agents declare a `model_tier` (capable, balanced, fast, cheapest) instead of hardcoding a model. One config change updates all agents:

```toml
[models]
capable = "anthropic/claude-sonnet-4-6"
balanced = "anthropic/claude-sonnet-4-6"
fast = "anthropic/claude-haiku-4-5"
```

### Memory — Institutional Knowledge

Every agent has three memory scopes:

| Scope | What it stores | Lifetime |
|-------|---------------|----------|
| **Entity** | Agent-specific knowledge (per UUID) | Permanent |
| **Domain** | Project-level facts and procedures | Permanent |
| **System** | Cross-project knowledge | Permanent |

Memory is backed by SQLite with FTS5 full-text search and optional vector embeddings for hybrid retrieval. A query planner generates typed queries (fact, procedure, preference, context) from quest context. Memories decay over time -- older facts rank lower unless reinforced.

Agents can build semantic knowledge graphs through `memory_edges` -- relationships like "mentions", "requires", "contradicts" between facts.

### Triggers — Autonomous Operations

Triggers define *when* an agent acts — making the company self-operating:

| Type | Example | How it works |
|------|---------|-------------|
| **Schedule** | `0 9 * * *` or `every 1h` | Cron expression or interval |
| **Event** | `quest_completed`, `dispatch_received` | Pattern match on runtime events with cooldown |
| **Once** | `2026-04-15T09:00:00Z` | Fire once at a specific time, auto-disable |
| **Webhook** | `POST /api/webhooks/:id` | External HTTP trigger with optional HMAC-SHA256 signing |

When a trigger fires, it creates an agent-bound quest that loads the associated skill.

### Skills — Agent Capabilities

Skills define *what* an agent does — its playbook for a given task. A skill is a TOML file with a system prompt and tool restrictions:

```toml
[skill]
name = "code-review"
description = "Review code changes for quality and correctness"

[tools]
allow = ["shell", "read_file", "grep", "glob", "delegate"]

[prompt]
system = """Review the code changes. Check for..."""
```

Skills are composable -- agents load the right skill per quest. Tool restrictions are enforced: a skill that only allows `read_file` cannot execute shell commands, even if the agent tries.

### Delegation — Agent Coordination

One tool for all inter-agent interaction:

```
delegate(to, prompt, response_mode, create_quest, skill)
```

| `to` | What happens |
|------|-------------|
| Agent name | Quest delegation to a persistent agent |
| `"subagent"` | Spawn an ephemeral worker |

| Response mode | Where the result goes |
|--------------|----------------------|
| `origin` | Back into the calling session |
| `async` | Fresh session for the sender |
| `none` | Fire and forget |

Delegation spawns a child session directly. The delegate tool creates a session linked to the calling session via `parent_id`, and routes responses back on completion.

### Quests — The Work

Quests are structured objectives that agents pick up, decompose, and ship. Created by triggers, delegation, or direct assignment.

```
Pending → InProgress → Done
                    → Blocked (escalate via agent tree)
                    → Failed (adaptive retry with LLM failure analysis)
```

Quests have atomic checkout (`locked_by`/`locked_at`) to prevent concurrent execution. State transitions are validated. Retry logic supports adaptive analysis: the system uses an LLM to classify failures as external blockers, missing context, or budget exhaustion, and routes accordingly.

---

## Runtime — Under the Hood

### The Daemon

`aeqi daemon start` runs the orchestration plane. Every 30 seconds:

1. **Reap** -- collect completed sessions
2. **Query** -- gather ready quests and running agent counts
3. **Spawn** -- enforce per-agent `max_concurrent`, spawn sessions for ready quests
4. **Fire triggers** -- schedule, once, and event-driven
5. **Housekeeping** -- persist state, prune expired entries, flush memory writes

Per-agent concurrency is enforced globally -- an agent with `max_concurrent=1` cannot get two workers even if quests exist in different projects.

### Middleware Chain

Every agent execution runs through 9 composable safety layers:

| Order | Layer | What it does |
|-------|-------|-------------|
| 200 | **Guardrails** | Block dangerous commands (`rm -rf`, `DROP TABLE`, force push) |
| 210 | **Graph Guardrails** | Blast radius analysis on code changes |
| 300 | **Loop Detection** | MD5 hash sliding window -- warn at 3 repeats, kill at 5 |
| 350 | **Context Compression** | Compact history at 50% context window, preserve first/last |
| 400 | **Context Budget** | Cap enrichment at ~200 lines per attachment |
| 600 | **Cost Tracking** | Per-quest and per-scope budget enforcement |
| 50 | **Memory Refresh** | Re-search memory every N tool calls |
| 800 | **Clarification** | Structured questions routed via agent tree |
| 900 | **Safety Net** | Detect and preserve partial work (git diffs, file edits) on failure |

Middleware hooks fire at 8 points: `on_start`, `before_model`, `after_model`, `before_tool`, `after_tool`, `after_turn`, `on_complete`, `on_error`.

### Budget Policies

Per-scope budget enforcement with auto-pause:

```
scope_type: agent | project | global
window: daily | monthly | lifetime
amount_usd: 50.0
warn_pct: 0.8
hard_stop: true
```

When a hard stop triggers, the scope is paused and an approval is created. Cost tracking captures per-call token breakdown (input, output, cached) with model and provider attribution.

### Approval Queue

Human-in-the-loop governance for autonomous agents:

```
GET  /api/approvals              -- list pending
POST /api/approvals/:id/resolve  -- approve or reject
```

Types: `permission` (dangerous action), `clarification` (agent question), `budget` (spend limit hit). Integrates with the middleware chain.

### Memory

Persistent insight store with hybrid search (SQLite FTS5 + vector embeddings):

- **Knowledge graph** — typed edges (caused_by, supports, contradicts, supersedes) with strength weights
- **Hybrid search** — BM25 keyword + vector cosine similarity + graph boost + MMR reranking
- **Temporal decay** — exponential with configurable halflife, evergreen category exempt
- **Obsidian export** — `aeqi memory export --vault <path>` dumps memories as markdown with `[[wikilinks]]` for graph visualization

### Inter-Agent Messaging

Reliable agent-to-agent communication via the event store:

- Idempotency keys prevent duplicate execution
- ACK tracking with automatic retry (60s threshold, max 3 retries)
- Dead-letter detection for undeliverable messages
- Persisted as events in `aeqi.db` across daemon restarts

### Expertise Routing

Agents are scored empirically using Wilson score lower-bound confidence on historical outcomes per domain. The system learns which agents are best at which types of work.

---

## Quick Start

### Install (pre-built binary)

```bash
curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | sh
```

### Or build from source

```bash
git clone https://github.com/aeqiai/aeqi && cd aeqi
cargo build --release
```

### Or Docker

```bash
git clone https://github.com/aeqiai/aeqi && cd aeqi
cp config/aeqi.example.toml config/aeqi.toml
# Edit config/aeqi.toml with your provider key
docker compose up
```

### Get started

```bash
aeqi setup                         # generates config, creates agents
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi start                         # daemon + dashboard on localhost:8400
```

The dashboard, API, and daemon all run from a single binary. SQLite databases are created automatically in `~/.aeqi/`. No external dependencies.

### CLI

```bash
aeqi start                     # daemon + web server + embedded dashboard
aeqi chat --agent cto          # interactive TUI chat
aeqi agent spawn agents/cto/   # create a persistent agent from template
aeqi agent registry            # list all registered agents
aeqi trigger create ...        # schedule, event, or webhook trigger
aeqi assign -r myproject "quest description"
aeqi monitor                   # live terminal dashboard
```

---

## Architecture

```
CHAT SESSION (CLI / Telegram / Slack / Web)
    User message → Agent session (identity + memory + tools + inherited context)
    → Agent loop: LLM → tool calls → LLM → ... → response
    → Transcript persisted (FTS5 searchable by agent and quest)

ASYNC QUEST (trigger / delegation / webhook)
    Quest created → Worker loads agent identity + skill + memory
    → Middleware chain wraps execution (9 layers)
    → Agent loop: LLM → tool calls → LLM → ... → outcome
    → DONE: response routed back | BLOCKED: escalate | FAILED: adaptive retry
```

### Crates

| Crate | Purpose |
|-------|---------|
| `aeqi-cli` | CLI binary, daemon, TUI chat |
| `aeqi-orchestrator` | Daemon, sessions, triggers, delegation, middleware, approvals, budget |
| `aeqi-core` | Agent loop, config, identity, compaction, streaming executor, traits |
| `aeqi-web` | Axum REST API + WebSocket streaming + SPA |
| `aeqi-insights` | SQLite+FTS5, vector search, hybrid ranking, query planning, knowledge graph |
| `aeqi-quests` | Quest DAG, dependency inference, status machine |
| `aeqi-providers` | OpenRouter, Anthropic, Ollama + cost estimation |
| `aeqi-gates` | Telegram, Discord, Slack channels |
| `aeqi-tools` | Shell, file I/O, git, grep, glob, delegate, skills |
| `aeqi-graph` | Code intelligence: Rust/TS/Solidity parsing, community detection, impact analysis |

### Storage

All state lives in `~/.aeqi/`:

| File | What |
|------|------|
| `aeqi.db` | Agent registry, quests, events, sessions, triggers, budget policies, approvals |
| `insights.db` | Entity, domain, and system memories + knowledge graph + vector embeddings |
| `codegraph/*.db` | Code graph per repository (symbol graph, call chains) |
| `ipc.sock` | Unix IPC socket |

---

## Extending AEQI

**Add a skill** -- drop a `.toml` in `projects/shared/skills/` or `projects/{name}/skills/`.

**Add a trigger** -- in agent template TOML, via CLI (`aeqi trigger create`), or at runtime through the `events_manage` tool.

**Add a tool** -- implement the `Tool` trait, wire into the builder.

**Add a provider** -- implement the `Provider` trait for any LLM API.

**Add a channel** -- implement the `Channel` trait for Telegram, Discord, Slack, or any platform.

**Add middleware** -- implement the `Middleware` trait with ordered hook points, add to the chain.

**Add an agent** -- create a directory under `agents/` with an `agent.toml`, then spawn via `aeqi agent spawn <name>`. Agents can also spawn children at runtime through the delegate tool.

---

## Development

```bash
cargo test              # 545+ tests
cargo clippy -- -D warnings
cargo fmt --check
```

Pre-push hook runs all three automatically.

## Docs

- [Architecture](docs/architecture.md) — system map, crates, primitives, agent loop
- [Design v2](docs/design-v2.md) — clean-sheet design: sessions, quests, skills, events
- [Project Setup](docs/project-setup.md) — projects, agents, skills, memory, quests
- [Context Injection](docs/context-injection.md) — how agent input context is assembled
- [Deployment](docs/deployment.md) — production topology, Docker, systemd
- [Quick Start](docs/quickstart.md) — local setup for daemon, API, and UI
- [Platform Architecture](docs/platform-architecture.md) — multi-tenant SaaS and open-source kernel
- [Agent Loop Parity](docs/agent-loop-parity.md) — comparison with Claude Code's agent loop
- [UI Design](docs/ui-design.md) — operator UI principles
- [Vision](docs/vision.md) — product north star and design principles
- [Roadmap](docs/roadmap.md) — phases from current state to long-term product

## License

[Business Source License 1.1](LICENSE) — source-available, self-hostable, converts to Apache 2.0 on April 5, 2030. Free for individuals and small teams. See [aeqi.ai/pricing](https://aeqi.ai/pricing) for hosted plans.
