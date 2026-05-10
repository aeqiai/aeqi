# aeqi

[![CI](https://github.com/aeqi-ai/aeqi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aeqi-ai/aeqi/actions/workflows/ci.yml)
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust-2024-black)](Cargo.toml)

**A source-available agent runtime built on four primitives.** A tree of agents that grows from context, remembers everything, acts autonomously, and reshapes itself from within.

```
aeqi start    # daemon + dashboard on :8400
aeqi chat     # talk to your root agent
```

**[Website](https://aeqi.ai)** -- **[Documentation](https://aeqi.ai/docs)** -- **[Changelog](https://aeqi.ai/changelog)**

---

## Four Primitives

```
Agent tree (root agent = company)
 ├── Agent has Ideas
 ├── Agent has Events
 └── Agent does Quests
```

### Agent -- persistent identity in a tree

An agent is a node with a name, a model, and a position in a parent-child hierarchy (`parent_id`). Agents inherit configuration from ancestors: model, budget, workdir, timeout, ideas. Set once on a parent, inherited by every descendant. Override at any node.

Agents live in the agent registry (`~/.aeqi/aeqi.db`) — the DB is the runtime source of truth. Starter agents can be seeded during setup; once loaded, agents spawn children at runtime through the delegate tool.

### Idea -- unified knowledge store

An idea is a piece of knowledge attached to an agent. Ideas replace what were previously separate concepts (system prompts, skills, memories, knowledge docs). Ideas don't carry positioning metadata — activation is decided by events, and scope (`self` vs `descendants`) controls inheritance through the agent tree.

| Mechanism | How it fires | Use case |
|-----------|--------------|----------|
| **Event-activated** | An event references the idea by id; assembling context walks matching events and pulls their ideas in | Identity, instructions, expertise, per-lifecycle-phase guidance |
| **Recalled** | Semantic search over the idea store | Retrieved on demand via hybrid search (BM25 + vector + graph) |

A "skill" is an idea an event activates. A "memory" is an idea no event references. The session's persistent context is the concatenation of every idea activated by `session:start` plus whatever execution-scoped context is injected later. Same primitive, different usage.

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
SESSION / EXECUTION
    User input --> Agent session (ideas + tools + inherited context)
    --> Execution: LLM --> tool calls --> step --> LLM --> ... --> response
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
| `aeqi-cli` | CLI binary, daemon, TUI chat |
| `aeqi-orchestrator` | Daemon, sessions, events, delegation, middleware, approvals, budget |
| `aeqi-core` | Agent loop, config, compaction, streaming executor, traits |
| `aeqi-web` | Axum REST API + WebSocket streaming + SPA |
| `aeqi-ideas` | SQLite+FTS5, vector search, hybrid ranking, query planning, knowledge graph |
| `aeqi-quests` | Quest DAG, dependency inference, status machine |
| `aeqi-providers` | OpenRouter, Anthropic, Ollama + cost estimation |
| `aeqi-gates` | Telegram, Discord, Slack bridges |
| `aeqi-tools` | Shell, file I/O, git, grep, glob, delegate |
| `aeqi-graph` | Code intelligence: Rust/TS/Solidity parsing, community detection, impact analysis |
| `aeqi-hosting` | Local/self-host runtime placement helpers |
| `aeqi-mcp` | MCP server exposing primitives to external clients |
| `aeqi-wallets` | Per-agent wallet keys, signing, on-chain identity |
| `aeqi-pack-github` | Tool pack: GitHub repos, issues, releases, search |
| `aeqi-pack-google-workspace` | Tool pack: Gmail, Calendar, Drive |
| `aeqi-pack-notion` | Tool pack: Notion pages and databases |
| `aeqi-pack-slack` | Tool pack: Slack messaging and search |
| `aeqi-test-support` | Shared test fixtures and harness helpers |

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
curl -fsSL https://raw.githubusercontent.com/aeqi-ai/aeqi/main/scripts/install.sh | sh
```

### Build from source

```bash
git clone https://github.com/aeqi-ai/aeqi && cd aeqi
cargo build --release
```

### Run

```bash
aeqi setup                                  # writes config, seed agents, and a dashboard secret
aeqi secrets set OPENROUTER_API_KEY <key>   # or ANTHROPIC_API_KEY / use --runtime ollama_agent
aeqi doctor --strict                        # verify everything is wired up
aeqi start                                  # daemon + dashboard on localhost:8400
```

`aeqi setup` is non-interactive. It detects whether you're inside a workspace (any of `config/`, `agents/`, `Cargo.toml`, `.git`) and otherwise lays everything down under `~/.aeqi/`. It also generates a stable `[web].auth_secret` and prints it — paste that secret on the dashboard sign-in screen. The dashboard, API, and daemon all run from a single binary; SQLite databases are created automatically in `~/.aeqi/`. No external dependencies.

### CLI

```bash
aeqi start                              # daemon + web server + embedded dashboard
aeqi chat                               # interactive TUI chat (auto-selects root agent)
aeqi agent list                         # list all registered agents
aeqi assign "subject" --root <ROOT>     # assign a quest to a root agent
aeqi events install-defaults            # seed daily-digest + weekly-consolidate on every agent
aeqi monitor                            # live terminal dashboard
aeqi doctor                             # diagnostics; --fix to repair, --strict to fail-on-warn
```

### Platform Chat

For hosted/platform chat, use one account API key. The key identifies you; the CLI then selects the company, optional acting role, and target agent for the session.

```bash
AEQI_API_KEY=ak_account_xxxxx aeqi chat
```

Non-interactive selection is available when you already know the ids:

```bash
aeqi chat \
  --api-key ak_account_xxxxx \
  --api-url https://cloud.aeqi.ai \
  --entity <company_id> \
  --role <role_id> \
  --agent <agent_id_or_name>
```

All other event types (schedule, pattern, webhook) are created via the API or the `events_manage` tool from inside a session; there is no `aeqi event create` subcommand today.

---

## Extending

**Add an idea** -- store via the API or MCP tools. Reference the idea from an event (e.g. `session:start`) to make it part of the agent's permanent context.

**Add an event** -- via the API or at runtime through the `events_manage` tool. The CLI ships `aeqi events install-defaults` for the standard digest/consolidate schedules; ad-hoc events are managed through the dashboard or programmatically.

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

Start at [docs/README.md](docs/README.md) for the full index. Highlights:

- [Quick Start](docs/quickstart.md) -- local setup for daemon, API, and UI
- [Local Demo](docs/local-demo.md) -- end-to-end walkthrough with no API key (uses Ollama)
- [Architecture](docs/architecture.md) -- system map, crates, primitives, agent loop
- [Vision](docs/vision.md) -- product north star and design principles
- [Deployment](docs/deployment.md) -- production topology, systemd, reverse proxy
- [Roadmap](docs/roadmap.md) -- phases from current state to long-term product

## Vocabulary

aeqi has four runtime primitives — **agents**, **ideas**, **quests**, **events**. Two further nouns appear in code and docs and are worth disambiguating:

| You'll see | Means | Where it lives |
|---|---|---|
| `agent` | A persistent identity in the agent tree | `[[agents]]` in `aeqi.toml`, `agents/<name>/agent.md` on disk, `aeqi.db` at runtime |
| `project` | A repo-bound worker pool the orchestrator can dispatch quests to | `[[projects]]` in `aeqi.toml` |
| `company` | Runtime identity that scopes agents, quests, ideas, events, sessions, and credentials | `aeqi.db` and dashboard routes |
| `agent_spawn` | Internal Rust field name for the same thing as `project` | Rust API only — never write it in `aeqi.toml` for new configs |

The canonical TOML key is `[[projects]]`. The legacy `[[agent_spawns]]` parses as an alias for back-compat; the older `[[companies]]` is no longer recognised. Pick `[[projects]]` for new work.

## License

[Business Source License 1.1](LICENSE) -- source-available, self-hostable, and free for production use as long as you are not offering aeqi to third parties as a hosted or embedded service that competes with our paid offerings. Converts to Apache 2.0 on April 5, 2030. See [aeqi.ai/pricing](https://aeqi.ai/pricing) for managed plans.

**In plain English:**

- **Allowed:** clone, modify, self-host, and run aeqi inside your team or company. Internal productivity use is fine. Forks for your own deployment are fine.
- **Not allowed without a commercial license:** offering aeqi to third parties as a hosted or embedded service that competes with our paid offerings (e.g. running a public "aeqi cloud").
- **Automatic:** on April 5, 2030 the license converts to Apache 2.0 and the above restriction lifts.

The license text in `LICENSE` is authoritative — this summary is for orientation, not legal advice.
