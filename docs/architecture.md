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
Session = the persistent runtime context
Execution = HOW it's being done right now (agent loop, tools, steps)
```

- Quest can exist without a session (queued, unstarted)
- Quest can have multiple sessions (retries, handoffs)
- Session can exist without a quest (ad-hoc chat, exploration)

## Sessions -- The Universal Runtime Model

Every live run is an execution inside a session. `SessionManager.spawn_session()` is the single entry point.

| Context | Type | Behavior |
|---------|------|----------|
| `parent_id` set | delegation | Child of another session |
| `quest_id` set | quest | Executing tracked work |
| `auto_close: false` | perpetual | Accepts follow-up input mid-execution |
| Default | session | Runs to completion |

## Agent Identity

Agents are persistent identities in SQLite (`agents` table):

- `id` (UUID) -- stable identity, idea scope key
- `name` -- display label
- `parent_id` -- position in the agent tree
- `model` -- preferred model (inheritable)
- `capabilities` -- permissions

Ideas attached to the agent provide its instructions, personality, expertise, and accumulated knowledge. There is no separate identity struct.

## Ideas -- Two Activation Modes

| Mode | How | Use case |
|------|-----|----------|
| Referenced by event | Loaded on event fire | Identity, system prompt, lifecycle guidance, scheduled behaviors |
| Not referenced | Semantic search recall | Accumulated knowledge, memories, learned facts |

Ideas carry no positioning metadata. Activation is decided entirely by events: the `session:start` event references the ideas that should always be in an agent's context, `session:quest_start` references ideas for the quest-opening phase, and so on. Scope (`self` vs `descendants`) on each idea controls whether an ancestor's idea reaches the target agent.

Ideas are stored in `ideas.db` with SQLite FTS5 full-text search and optional vector embeddings for hybrid retrieval.

- **Knowledge graph** -- typed edges (caused_by, supports, contradicts, supersedes) with strength weights
- **Hybrid search** -- BM25 keyword + vector cosine similarity + graph boost + MMR reranking
- **Temporal decay** -- exponential with configurable halflife, evergreen tag exempt

Idea searches walk the agent tree upward: an agent sees its own ideas, its parent's, and ancestors' up to root.

## Events -- Autonomous Operations

Events define when agents act autonomously. Types: schedule (cron/interval), pattern (quest_completed, etc.), once (fire-at-time), webhook (HTTP with HMAC).

Events belong to a specific agent (row with `agent_id` set) or are **global** (`agent_id IS NULL`). Global events fire for every agent — that is how the six session lifecycle events ship: one row per phase, shared by every agent in the tree. Per-agent events handle everything else.

When an event fires, it activates its referenced ideas; those ideas are concatenated (in walk order: root ancestor → … → self → task ideas) into the system prompt, and their tool allow/deny lists merge into the session's tool restrictions.

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
