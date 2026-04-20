# aeqi

[![CI](https://github.com/aeqiai/aeqi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aeqiai/aeqi/actions/workflows/ci.yml)
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-2024-black)](Cargo.toml)

**An agent runtime built on four primitives.** A tree of agents that grows from conversation, remembers everything, acts autonomously, and reshapes itself from within.

```
aeqi start    # daemon + dashboard on :8400
aeqi chat     # talk to your root agent
```

**[Website](https://aeqi.ai)** -- **[Documentation](https://aeqi.ai/docs)** -- **[Changelog](https://aeqi.ai/changelog)**

---

## Four Primitives

```
Agent tree (root agent = workspace)
 ├── Agent has Ideas
 ├── Agent has Events
 └── Agent does Quests
```

### Agent -- persistent identity in a tree

An agent is a node with a name, a model, and a position in a parent-child hierarchy (`parent_id`). Agents inherit configuration from ancestors: model, budget, workdir, timeout, ideas. Set once on a parent, inherited by every descendant. Override at any node.

Agents are stored in the database. There are no agent definition files on disk -- the DB is the source of truth. Agents spawn children at runtime through the delegate tool.

### Idea -- unified knowledge store

An idea is a piece of knowledge attached to an agent. Ideas replace what were previously separate concepts (system prompts, skills, memories, knowledge docs). Ideas don't carry positioning metadata — activation is decided by events, and scope (`self` vs `descendants`) controls inheritance through the agent tree.

| Mechanism | How it fires | Use case |
|-----------|--------------|----------|
| **Event-activated** | An event references the idea by id; assembling context walks matching events and pulls their ideas in | Identity, instructions, expertise, per-lifecycle-phase guidance |
| **Recalled** | Semantic search over the idea store | Retrieved on demand via hybrid search (BM25 + vector + graph) |

A "skill" is an idea an event activates. A "memory" is an idea no event references. A "system prompt" is the concatenation of every idea activated by `session:start`. Same primitive, different usage.

### Quest -- unit of work

A quest is a structured objective with status, dependencies, and outcomes. Created by events, delegation, or direct assignment.

```
Pending --> InProgress --> Done
                      --> Blocked (escalate via agent tree)
                      --> Failed (adaptive retry with LLM failure analysis)
```

Quests have atomic checkout (`locked_by`/`locked_at`), dependency DAGs, acceptance criteria, checkpoints, and retry logic. State transitions are validated.

### Event -- reaction rule

An event defines *when* an agent acts: when pattern X fires on agent Y's scope, run idea Z. Events replace triggers.

| Type | Example |
|------|---------|
| **Schedule** | `0 9 * * *` or `every 1h` |
| **Pattern** | `quest_completed`, `dispatch_received` |
| **Once** | Fire at a specific time, auto-disable |
| **Webhook** | `POST /api/webhooks/:id` with optional HMAC-SHA256 |

Events either belong to a specific agent or are **global** (`agent_id IS NULL`) — global events fire for every agent. The six session lifecycle events (`session:start`, `session:quest_start`, `session:quest_end`, `session:quest_result`, `session:step_start`, `session:stopped`) ship as globals that point at shared seed ideas, so every agent inherits them for free.

### Activity (infrastructure)

Activity is the audit log and cost ledger. Not a primitive -- infrastructure for observability. Every action, cost, and decision is recorded as an activity entry.

---

## Architecture

```
CHAT SESSION (CLI / Web / Telegram / Discord / Slack)
    User message --> Agent session (ideas + tools + inherited context)
    --> Agent loop: LLM --> tool calls --> LLM --> ... --> response
    --> Transcript persisted (FTS5 searchable by agent and quest)

ASYNC QUEST (event / delegation / webhook)
    Quest created --> Worker loads agent ideas + tools
    --> Middleware chain wraps execution (9 layers)
    --> Agent loop: LLM --> tool calls --> LLM --> ... --> outcome
    --> DONE: response routed back | BLOCKED: escalate | FAILED: adaptive retry
```

### The Daemon

`aeqi daemon start` runs the orchestration plane:

1. **Reap** -- collect completed sessions
2. **Query** -- gather ready quests and running agent counts
3. **Spawn** -- enforce per-agent `max_concurrent`, spawn sessions for ready quests
4. **Fire events** -- schedule, once, and pattern-driven
5. **Housekeeping** -- persist state, prune expired entries, flush idea writes

### Middleware Chain

9 composable safety layers wrapping every agent execution:

| Order | Layer | Purpose |
|-------|-------|---------|
| 50 | Memory Refresh | Re-search ideas every N tool calls |
| 200 | Guardrails | Block dangerous commands |
| 210 | Graph Guardrails | Blast radius analysis on code changes |
| 300 | Loop Detection | MD5 sliding window -- warn at 3, kill at 5 |
| 350 | Context Compression | Compact history at 50% context window |
| 400 | Context Budget | Cap enrichment at ~200 lines per attachment |
| 600 | Cost Tracking | Per-quest and per-scope budget enforcement |
| 800 | Clarification | Structured questions routed via agent tree |
| 900 | Safety Net | Preserve partial work on failure |

### Delegation

One tool for all inter-agent interaction:

```
delegate(to, prompt, response_mode, create_quest)
```

Delegation spawns a child session linked via `parent_id`. Response modes: `origin` (back to caller), `async` (fresh session for sender), `none` (fire and forget).

### Sandboxing

Tenant environments run in bubblewrap sandboxes with read-only root filesystems, dropped capabilities, no privilege escalation, resource limits, and isolated storage.

### Crates

| Crate | Purpose |
|-------|---------|
| `aeqi-cli` | CLI binary, daemon, TUI chat, MCP server |
| `aeqi-orchestrator` | Daemon, sessions, events, delegation, middleware, approvals, budget |
| `aeqi-core` | Agent loop, config, compaction, streaming executor, traits |
| `aeqi-web` | Axum REST API + WebSocket streaming + SPA |
| `aeqi-ideas` | SQLite+FTS5, vector search, hybrid ranking, query planning, knowledge graph |
| `aeqi-quests` | Quest DAG, dependency inference, status machine |
| `aeqi-providers` | OpenRouter, Anthropic, Ollama + cost estimation |
| `aeqi-gates` | Telegram, Discord, Slack bridges |
| `aeqi-tools` | Shell, file I/O, git, grep, glob, delegate |
| `aeqi-graph` | Code intelligence: Rust/TS/Solidity parsing, community detection, impact analysis |
| `aeqi-hosting` | Multi-tenant platform, bubblewrap sandboxing |

### Storage

All state lives in `~/.aeqi/`:

| File | Contents |
|------|----------|
| `aeqi.db` | Agent registry, quests, events, budget policies, approvals, activity |
| `sessions.db` | Session journal and transcripts (FTS5) |
| `ideas.db` | Ideas + knowledge graph + vector embeddings |
| `accounts.db` | Web UI accounts and auth (when `aeqi-web` is enabled) |
| `codegraph/*.db` | Code graph per repository |
| `ipc.sock` | Unix IPC socket |

---

## Quick Start

### Install

```bash
curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | sh
```

### Build from source

```bash
git clone https://github.com/aeqiai/aeqi && cd aeqi
cargo build --release
```

### Run

```bash
aeqi setup                         # generates config, creates agents
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi start                         # daemon + dashboard on localhost:8400
```

The dashboard, API, and daemon all run from a single binary. SQLite databases are created automatically in `~/.aeqi/`. No external dependencies.

### CLI

```bash
aeqi start                     # daemon + web server + embedded dashboard
aeqi chat                      # interactive TUI chat (auto-selects root agent)
aeqi agent list                # list all registered agents
aeqi event create ...          # schedule, pattern, or webhook event
aeqi assign "quest description"
aeqi monitor                   # live terminal dashboard
```

---

## Extending

**Add an idea** -- store via the API or MCP tools. Reference the idea from an event (e.g. `session:start`) to make it part of the agent's permanent context.

**Add an event** -- via CLI (`aeqi event create`), API, or at runtime through the `events_manage` tool.

**Add a tool** -- implement the `Tool` trait, wire into the builder.

**Add a provider** -- implement the `Provider` trait for any LLM API.

**Add a gate** -- implement the `Channel` trait for Telegram, Discord, Slack, or any platform.

**Add middleware** -- implement the `Middleware` trait with ordered hook points, add to the chain.

---

## Development

```bash
cargo test              # full test suite
cargo clippy -- -D warnings
cargo fmt --check
```

Pre-push hook runs all three automatically.

## Contributing

- [CONTRIBUTING.md](CONTRIBUTING.md) -- setup, commit conventions, PR flow
- [SECURITY.md](SECURITY.md) -- private vulnerability disclosure
- Issue and PR templates live in `.github/`

## Docs

- [Architecture](docs/architecture.md) -- system map, crates, primitives, agent loop
- [Context Injection](docs/context-injection.md) -- how agent input context is assembled
- [Deployment](docs/deployment.md) -- production topology, systemd, reverse proxy
- [Quick Start](docs/quickstart.md) -- local setup for daemon, API, and UI
- [Platform Architecture](docs/platform-architecture.md) -- multi-tenant SaaS and open-source kernel
- [Agent Loop Parity](docs/agent-loop-parity.md) -- comparison with Claude Code's agent loop
- [UI Design](docs/ui-design.md) -- operator UI principles
- [Vision](docs/vision.md) -- product north star and design principles
- [Roadmap](docs/roadmap.md) -- phases from current state to long-term product

## License

[Business Source License 1.1](LICENSE) -- source-available, self-hostable, converts to Apache 2.0 on April 5, 2030. Free for individuals and small teams. See [aeqi.ai/pricing](https://aeqi.ai/pricing) for hosted plans.
