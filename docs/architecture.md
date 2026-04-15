# AEQI Architecture

AEQI is an agent runtime and orchestration engine in Rust. 10 crates.

## Four Primitives

| Primitive | Purpose | Storage |
|-----------|---------|---------|
| **Agent** | Persistent identity in a tree (`parent_id` hierarchy) | `aeqi.db` |
| **Idea** | Knowledge store -- identity, instructions, memories | `ideas.db` |
| **Quest** | Unit of work with dependencies and outcomes | `aeqi.db` |
| **Event** | Reaction rule -- when pattern X fires, run idea Z | `aeqi.db` |

Plus **Activity** as infrastructure (audit log, costs -- not a primitive) in `aeqi.db`.

## Two Orthogonal Concepts

```
Quest = WHAT needs to be done (persistent, trackable, assignable)
Session = HOW it's being done (execution transcript, agent loop, tools)
```

- Quest can exist without a session (queued, unstarted)
- Quest can have multiple sessions (retries, handoffs)
- Session can exist without a quest (ad-hoc chat, exploration)

## Sessions -- The Universal Execution Model

Every execution is a session. `SessionManager.spawn_session()` is the single entry point.

| Context | Type | Behavior |
|---------|------|----------|
| `parent_id` set | delegation | Child of another session |
| `quest_id` set | quest | Executing tracked work |
| `auto_close: false` | perpetual | Accepts follow-up messages |
| Default | session | Runs to completion |

## Agent Identity

Agents are persistent identities in SQLite (`agents` table):

- `id` (UUID) -- stable identity, idea scope key
- `name` -- display label
- `parent_id` -- position in the agent tree
- `model` -- preferred model (inheritable)
- `capabilities` -- permissions

Ideas attached to the agent provide its instructions, personality, expertise, and accumulated knowledge. There is no separate identity struct.

## Ideas -- Three Activation Modes

| Mode | How | Use case |
|------|-----|----------|
| `injection_mode` set | Always in context | Identity, system prompt, expertise, instructions |
| Referenced by event | Loaded on event fire | Automated behaviors, scheduled work |
| Neither | Semantic search recall | Accumulated knowledge, memories, learned facts |

Ideas are stored in `ideas.db` with SQLite FTS5 full-text search and optional vector embeddings for hybrid retrieval.

- **Knowledge graph** -- typed edges (caused_by, supports, contradicts, supersedes) with strength weights
- **Hybrid search** -- BM25 keyword + vector cosine similarity + graph boost + MMR reranking
- **Temporal decay** -- exponential with configurable halflife, evergreen tag exempt

Idea searches walk the agent tree upward: an agent sees its own ideas, its parent's, and ancestors' up to root.

## Events -- Autonomous Operations

Events define when agents act autonomously. Types: schedule (cron/interval), pattern (quest_completed, etc.), once (fire-at-time), webhook (HTTP with HMAC).

Events are tree-scoped: they can fire on the agent itself (`self`), its direct children, or all descendants.

When an event fires, it creates a quest loaded with the referenced idea.

## Entry Points

All converge to `spawn_session`:

| Entry | How |
|-------|-----|
| Web chat | `spawn_session(agent, message, provider)` |
| Delegation | `delegate` tool --> `spawn_session` with parent_id |
| Quest execution | Patrol loop --> `spawn_session` with quest_id |
| Event fire | Creates quest --> patrol spawns session |
| Telegram/Discord/Slack | Gate --> quest or direct session |

## Daemon Patrol Loop

1. Reap completed sessions
2. Assign ready quests --> spawn sessions
3. Fire due events
4. Persist activity (costs, decisions)
5. Detect timeouts, handle blocked quests
6. Flush idea writes

## Event Streaming

13 `ChatStreamEvent` types forwarded to the frontend:

TurnStart, TextDelta, ToolStart, ToolComplete, TurnComplete, Status, DelegateStart, DelegateComplete, IdeaActivity, Compacted, ToolProgress, Complete, Error.

## Crates

| Crate | Purpose |
|-------|---------|
| aeqi-core | Agent loop, config, traits, streaming executor |
| aeqi-orchestrator | Daemon, sessions, events, delegation, middleware |
| aeqi-tools | Shell, file, web, delegate |
| aeqi-providers | OpenRouter, Anthropic, Ollama |
| aeqi-ideas | SQLite + FTS5 + vector, hierarchical scoping, knowledge graph |
| aeqi-quests | Quest DAG, dependency inference, status machine |
| aeqi-web | Axum REST + WebSocket API |
| aeqi-gates | Telegram, Discord, Slack bridges |
| aeqi-graph | Code intelligence (symbol graph, call chains) |
| aeqi-cli | CLI, TUI, MCP server |
| aeqi-hosting | Multi-tenant platform, bubblewrap sandboxing |
