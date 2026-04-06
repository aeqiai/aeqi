# AEQI Architecture

AEQI is an agent runtime and orchestration engine in Rust. 10 crates, 619 tests.

## Two Orthogonal Concepts

```
Task = WHAT needs to be done (persistent, trackable, assignable)
Session = HOW it's being done (execution transcript, agent loop, tools)
```

A Task is a Jira issue. A Session is a terminal window.

- Task can exist without a session (queued, unstarted)
- Task can have multiple sessions (retries, handoffs)
- Session can exist without a task (ad-hoc chat, exploration)
- Session references `task_id` when executing task work
- Task references `session_id` of its current execution

## Sessions — The Universal Execution Model

Every execution is a session. `SessionManager.spawn_session()` is the single entry point:

```rust
session_manager.spawn_session(
    agent_id,
    prompt,
    provider,
    SpawnOptions::new()
        .with_parent(parent_session_id)
        .with_task(task_id)
        .with_skill("architecture-audit")
        .with_project(project_id)
        .with_name("Review PR #42")
)
```

`auto_close: true` (default) = session closes when agent finishes.
`auto_close: false` = session stays open for follow-up messages.

### Session Types (derived from context, not declared)

| Context | Type | Behavior |
|---------|------|----------|
| `parent_id` set | delegation | Child of another session |
| `task_id` set | task | Executing tracked work |
| `auto_close: false` | perpetual | Accepts follow-up messages |
| Default | session | Runs to completion |

### Session Hierarchy

Sessions form a tree via `parent_id`. Children visible in parent's UI.

### Operations on Sessions

| Operation | Method |
|-----------|--------|
| Spawn | `session_manager.spawn_session(agent, prompt, provider, opts)` |
| Send message | `session_manager.send(session_id, message)` |
| Stream events | `session_manager.send_streaming(session_id, message)` |
| Close | `session_manager.close(session_id)` |
| List children | `session_store.list_children(parent_id)` |

## Skills — Spawn-Time Context Injection

Skills are TOML files (`projects/shared/skills/*.toml`):

```toml
[skill]
name = "architecture-audit"
description = "Find structural problems"
model = "anthropic/claude-sonnet-4.6"

[tools]
allow = ["read_file", "grep", "glob", "shell"]

[prompt]
system = "You are a systems architecture auditor..."
```

When injected via `SpawnOptions.with_skill()`:
- Skill prompt appended to agent identity
- Tools filtered by allow/deny policy
- Model overridden if specified
- Multiple skills stack: `.with_skill("a").with_skill("b")`

## Entry Points

All converge to `spawn_session`:

| Entry | How |
|-------|-----|
| Web chat | `spawn_session(agent, message, provider, SpawnOptions::interactive())` |
| Delegation | `aeqi_delegate` tool → `spawn_session(opts.with_parent(id))` |
| Task execution | Patrol loop → `spawn_session(opts.with_task(id))` |
| Trigger/cron | Creates task → patrol spawns session |
| Telegram/Discord | MessageRouter → task or direct session |

## Tasks — Tracked Work Items

Persistent work units with status, priority, dependencies, acceptance criteria, checkpoints, retry logic, and escalation chains.

Tasks live in `.tasks/*.jsonl` (git-native). The patrol loop finds ready tasks and spawns sessions.

| Need | Use |
|------|-----|
| "Do this right now" | Spawn session directly |
| "This needs to get done" | Create task (patrol assigns) |
| "Track retries and priority" | Task |
| "Just run a prompt" | Session |

## Agent Identity

Agents are persistent identities in SQLite (`agents` table):

- `id` (UUID) — stable identity, memory scope key
- `name` — display label
- `system_prompt` — personality + instructions
- `project` / `project_id` — project scope
- `department_id` — team membership
- `model` — preferred model
- `capabilities` — permissions

## Memory — Three-Tier Hierarchical Recall

```
Agent scope      → entity_id = agent UUID
Department scope → entity_id = department UUID
Project scope    → entity_id = project UUID
```

`hierarchical_search` queries all three tiers, deduplicates, returns top-k.

## Project Identity

Projects have stable UUIDs (auto-generated, persisted in `project_ids.json`). Names are display labels — renaming preserves all data.

## Event Streaming

13 `ChatStreamEvent` types, all forwarded to the frontend:

TurnStart, TextDelta, ToolStart, ToolComplete, TurnComplete, Status, DelegateStart, DelegateComplete, MemoryActivity, Compacted, ToolProgress, Complete, Error.

Tool events persist to session store — visible on page reload.

## Web UI

Sessions page shows: sidebar (permanent, active work, spawned work, closed), session header (agent, model, status), spawned sessions bar (inline children with live timers), interleaved message timeline (text → tools → text with expandable output), duration/cost/tokens per response.

## Daemon Patrol Loop (30s)

1. Assign ready tasks → spawn sessions
2. Detect timeouts, handle blocked tasks
3. Fire due triggers
4. Persist cost ledger
5. Reap dead sessions
6. Flush memory writes

## Crates

| Crate | Purpose |
|-------|---------|
| aeqi-core | Agent loop, config, identity, traits, streaming executor |
| aeqi-orchestrator | Daemon, sessions, tasks, delegation, memory routing |
| aeqi-tools | Shell, file, web, skills |
| aeqi-providers | OpenRouter, Anthropic, Ollama |
| aeqi-insights | SQLite + FTS5, vector search, hierarchical scoping |
| aeqi-tasks | Task DAG, JSONL persistence, status machine |
| aeqi-web | Axum REST + WebSocket API |
| aeqi-gates | Telegram, Discord, Slack bridges |
| aeqi-graph | Code intelligence (symbol graph, call chains) |
| aeqi-cli | CLI, MCP server, TUI |
