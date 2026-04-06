# AEQI v2 — Clean-Sheet Design

## Design Principles

1. **Everything is a session.** No workers, no dispatch bus, no patrol for spawning. `spawn_session()` is the only way work runs.
2. **Tasks are Jira issues.** They exist independently of execution. Sessions execute them.
3. **Agents are identities.** Persistent, with memory, personality, capabilities. Not ephemeral.
4. **Skills are composable context.** Injected at spawn time. Stack. Override models and tools.
5. **Permissions are explicit.** Every tool use is authorized. Users and agents have different trust levels.
6. **Events are the nervous system.** One broadcast, all subscribers see everything. No separate event types per subsystem.
7. **Configuration is declarative.** TOML for structure, hooks for automation, skills for behavior. No Rust required to customize.
8. **UUIDs for identity, names for display.** Always. No exceptions.

## The Session

```rust
pub struct Session {
    pub id: Uuid,
    pub agent_id: Uuid,
    pub parent_id: Option<Uuid>,
    pub task_id: Option<Uuid>,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub auto_close: bool,
    pub skills: Vec<String>,
    pub status: SessionStatus,      // Active, Completed, Failed, Cancelled
    pub created_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
}
```

One table. One concept. Every execution creates one. Parent-child via `parent_id`. Task linkage via `task_id`. Skills recorded for reproducibility.

### Spawning

```rust
session_manager.spawn(SpawnRequest {
    agent_id: "uuid",
    prompt: "do this",
    skills: vec!["architecture-audit", "rust-expertise"],
    parent_id: Some(my_session_id),
    task_id: Some(task_id),
    auto_close: true,
    worktree: true,           // git worktree isolation
    permission_level: PermissionLevel::Standard,
})
```

One function. Everything is a parameter. No enum types. No special modes.

### Messages

Sessions contain an ordered event log — not just "user" and "assistant" messages:

```rust
pub enum SessionEvent {
    Message { role: Role, content: String },
    ToolCall { tool: String, input: Value, id: String },
    ToolResult { id: String, output: String, success: bool, duration_ms: u64 },
    Status { text: String },
    DelegateSpawn { child_session_id: Uuid, agent_id: Uuid, prompt_preview: String },
    DelegateComplete { child_session_id: Uuid, outcome: String },
    Compaction { from_events: usize, to_events: usize },
    Error { message: String, recoverable: bool },
}
```

This IS the transcript. No separate "conversations" table + "tool_events" table + "segments" reconstruction. One ordered log. The frontend renders it directly.

## The Task

```rust
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid,
    pub subject: String,
    pub description: String,
    pub status: TaskStatus,         // Open, InProgress, Done, Blocked, Cancelled
    pub priority: Priority,
    pub created_by: Uuid,           // agent or user UUID
    pub assigned_to: Option<Uuid>,  // agent UUID
    pub session_id: Option<Uuid>,   // current execution session
    pub depends_on: Vec<Uuid>,
    pub skills: Vec<String>,        // skills to use when executing
    pub acceptance_criteria: Option<String>,
    pub checkpoints: Vec<Checkpoint>,
    pub retry_count: u32,
    pub max_retries: u32,
    pub created_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
}
```

SQLite, not JSONL. Queryable. Indexed. No prefix-based IDs — pure UUIDs. The `created_by` field is always a UUID (agent or user — both are entities in the system).

### Task Execution

When the patrol finds a ready task:

```rust
session_manager.spawn(SpawnRequest {
    agent_id: task.assigned_to.unwrap(),
    prompt: &task.description,
    skills: task.skills.clone(),
    task_id: Some(task.id),
    auto_close: true,
    worktree: task.needs_isolation(),
    permission_level: PermissionLevel::Worker,
})
```

Same `spawn()`. Task linked via `task_id`. When session completes, patrol reads result and updates task status.

## The Agent

```rust
pub struct Agent {
    pub id: Uuid,
    pub name: String,
    pub display_name: Option<String>,
    pub project_id: Option<Uuid>,
    pub department_id: Option<Uuid>,
    pub system_prompt: String,
    pub model: Option<String>,
    pub capabilities: Vec<Capability>,
    pub permission_level: PermissionLevel,
    pub status: AgentStatus,
    pub created_at: DateTime<Utc>,
}
```

Agents are first-class entities. They have:
- Memory (scoped by agent UUID, department UUID, project UUID)
- Sessions (current + historical)
- Tasks (assigned to them)
- Capabilities (what they're allowed to do)

### Users are Agents

A human user IS an agent entry. Same table. Same UUID. `capabilities: [human]` distinguishes them. When a user creates a task, `created_by` is their agent UUID. When they chat, a session is spawned with their agent UUID.

This eliminates the "origin" concept — everything is agent-to-agent.

## Permissions

```rust
pub enum PermissionLevel {
    Unrestricted,   // Human user in interactive mode
    Standard,       // Web chat agents, delegated work
    Worker,         // Background task execution
    ReadOnly,       // Review, audit, exploration only
    Custom(PermissionPolicy),
}

pub struct PermissionPolicy {
    pub allow_tools: Option<Vec<String>>,    // whitelist (None = all)
    pub deny_tools: Vec<String>,             // blacklist
    pub allow_shell: ShellPolicy,            // All, ReadOnly, None
    pub allow_write: bool,                   // file write/edit
    pub allow_network: bool,                 // web fetch/search
    pub allow_delegate: bool,                // can spawn child sessions
    pub max_cost_usd: Option<f64>,           // per-session budget
    pub hooks: Vec<Hook>,                    // pre/post tool hooks
}
```

Every session has a permission level. Skills can restrict permissions further (intersection, not union). A skill that says `tools.allow = ["read_file", "grep"]` overrides the session's broader policy.

### Hook System

```toml
# aeqi.toml
[[hooks]]
event = "pre_tool_use"
tool = "shell"
command = "scripts/validate-shell.sh"
decision = "ask"  # block | allow | ask

[[hooks]]
event = "post_tool_use"
tool = "edit_file"
command = "scripts/lint-on-save.sh"

[[hooks]]
event = "session_start"
command = "scripts/setup-env.sh"
```

Hooks are shell commands. Exit code 0 = allow, 2 = block. JSON stdout for rich decisions. Runs in parallel when possible. Errors logged, don't crash the session.

## The Skill

```toml
[skill]
name = "architecture-audit"
description = "Find structural problems"
model = "anthropic/claude-sonnet-4.6"
permission_level = "read_only"

[tools]
allow = ["read_file", "grep", "glob", "shell"]

[prompt]
system = "You are a systems architecture auditor..."
user_prefix = "Audit the following subsystem: "
```

Skills are:
- Spawn-time parameters on any session
- Stackable (multiple skills per session)
- Tool-restricting (intersection of all skill policies)
- Model-overriding (last skill wins)
- Permission-setting (most restrictive wins)

Skills are NOT agents. They're context templates that modify how an agent behaves in a specific session.

## Events — One Stream

```rust
pub enum Event {
    // Session lifecycle
    SessionSpawned { session_id, agent_id, parent_id, skills },
    SessionCompleted { session_id, outcome, duration_ms, cost_usd },
    SessionFailed { session_id, error },

    // Execution
    TurnStart { session_id, turn, model },
    TextDelta { session_id, text },
    ToolStart { session_id, tool, input_preview },
    ToolComplete { session_id, tool, input_preview, output_preview, success, duration_ms },
    TurnComplete { session_id, turn, prompt_tokens, completion_tokens },
    Status { session_id, message },

    // Delegation
    DelegateSpawn { parent_session_id, child_session_id, agent_id },
    DelegateComplete { parent_session_id, child_session_id, outcome },

    // Memory
    MemoryStored { agent_id, scope, key },
    MemoryRecalled { agent_id, scope, count },

    // Tasks
    TaskCreated { task_id, project_id, created_by },
    TaskAssigned { task_id, agent_id },
    TaskCompleted { task_id, session_id, outcome },
    TaskBlocked { task_id, reason },

    // Permissions
    PermissionRequested { session_id, tool, input_preview },
    PermissionGranted { session_id, tool, source },
    PermissionDenied { session_id, tool, reason },

    // System
    Compacted { session_id, from_events, to_events },
    BudgetWarning { session_id, spent_usd, limit_usd },
}
```

One broadcast channel. Every subscriber sees everything (filtered by what they care about). The web frontend, CLI TUI, Telegram bridge, audit log — all subscribe to the same stream. No separate `ChatStreamEvent` vs `ExecutionEvent`.

## Context Management

Three levels, like Claude Code but integrated with AEQI's session model:

### Level 1: Micro-compact (per-turn)
Clear old tool results by name. Keep recent N. Already implemented in AEQI.

### Level 2: Snip (per-turn)
Remove entire old turn pairs. Already implemented.

### Level 3: Full compact (threshold-triggered)
LLM summarization. Already implemented. Add: persistent compact log (Claude Code's "context collapse") so compaction decisions survive across messages in perpetual sessions.

### Level 4: Reactive (error-triggered)
On prompt-too-long API error: emergency compact + retry. Already implemented.

## Worktree Isolation

When `spawn(SpawnRequest { worktree: true, ... })`:

1. `git worktree add .worktrees/{session_id} -b session/{session_id}`
2. Set session's workdir to the worktree path
3. All file tools scoped to worktree
4. On session close: if changes exist, leave worktree (user reviews). If no changes, auto-remove.

Child sessions with `worktree: true` get their OWN worktree branched from the parent's. Parallel sessions can't conflict.

## MCP Client

AEQI should be both an MCP server (expose tools to Claude Code) AND an MCP client (consume external MCP servers):

```toml
# aeqi.toml
[[mcp_servers]]
name = "postgres"
transport = "stdio"
command = "mcp-postgres"
args = ["--connection-string", "${DATABASE_URL}"]

[[mcp_servers]]
name = "slack"
transport = "sse"
url = "https://slack.mcp.example.com"
auth = "oauth"
```

MCP tools automatically available to all sessions. Namespaced as `mcp__{server}__{tool}`.

## Web UI

The web UI renders the event stream directly. No "message" reconstruction. No "segments" array. The session's event log IS the transcript:

```
[TextDelta] "Let me look into this..."
[ToolStart] shell: ls -la /home/...
[ToolComplete] shell: (output preview) ✓ 340ms
[TextDelta] "Based on what I found..."
[DelegateSpawn] → child session abc-123 (skill: architecture-audit)
[DelegateComplete] ← child session abc-123: "Found 3 issues..."
[TextDelta] "Here's the summary..."
```

Each event type has its own React component. No translation layer. The event IS the UI.

## Crate Structure (Simplified)

```
aeqi-core       Agent loop, config, identity, traits
aeqi-session    SessionManager, SessionStore, spawn logic
aeqi-task       Task DAG, status machine
aeqi-insights     SQLite + FTS5 + vector, three-tier scoping
aeqi-tools      Built-in tools, skill loader, MCP client
aeqi-providers  OpenRouter, Anthropic, Ollama
aeqi-web        Axum REST + WebSocket
aeqi-gates      Telegram, Discord, Slack
aeqi-graph      Code intelligence
aeqi-cli        CLI, TUI, MCP server
```

Key change: `aeqi-orchestrator` splits into `aeqi-session` (session management) and `aeqi-task` (task management). No more 4000-line daemon.rs. The daemon is just the event loop that wires everything together.

## What This Beats Claude Code On

| Axis | Claude Code | AEQI v2 |
|------|-------------|---------|
| Multi-agent | Recursive subagents (ephemeral) | Persistent agents with identity, memory, departments |
| Task tracking | Simple task list tool | Full DAG with deps, priority, retries, escalation |
| Memory | None | Three-tier hierarchical with vector search |
| Delegation | Agent tool spawns child | spawn() with skills, worktree, permissions, parent chain |
| Permissions | Multi-source rules | Same + per-session policies + skill intersection + hooks |
| Hooks | settings.json shell hooks | Same + TOML config + per-project + per-skill |
| Context management | 5-level compaction | Same levels + persistent compact log |
| Worktree | Transparent isolation | Same + per-delegation worktrees |
| MCP | Client only | Client AND server |
| UI | Terminal (React/Ink) | Web dashboard + terminal TUI + API |
| Events | Terminal rendering | Universal broadcast (web, CLI, Telegram, audit) |
| Skills | Forked agents with frontmatter | Composable, stackable, spawn-time injection |
| Session model | Ephemeral per-query | Persistent, hierarchical, UUID-addressed |
| Cost | Per-session tracking | Per-project budgets with enforcement |
| Triggers | None | Schedule + event triggers with skills |
