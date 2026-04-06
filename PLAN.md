# AEQI Architecture Plan

## The Primitives

```
4 tables:   agents, tasks, events, memories
1 field:    prompts[] (ordered array on agents, tasks, triggers)
1 tree:     parent_id on agents
1 loop:     wake → reap → query → spawn
1 database: aeqi.db
```

Every entity has `name` (for humans) and `prompts[]` (for the model).
Everything that happened is an event. Everything that's known is a memory.
Everything else is a query over these four tables.

```
aeqi.db
  agents    — the tree (name, prompts, model, workdir, budget, concurrency)
  tasks     — work queue (name, prompts, status, agent_id)
  events    — immutable log (type, agent_id, session_id, task_id, content)
  memories  — mutable knowledge (key, content, scope, entity_id, embedding)
```

### What collapses

| Old concept | Becomes |
|---|---|
| system_prompt | agent.prompts entry, position='system' |
| shared_primer | root agent.prompts entry, scope='descendants' |
| project_primer | project agent.prompts entry, scope='descendants' |
| skill (TOML) | prompts[] preset loaded into task.prompts or trigger.prompts |
| agent template | prompts[] preset loaded into agent.prompts at spawn |
| Identity struct | gone — prompts[] replaces persona/memory/skill_prompt/knowledge |
| task.description | task.prompts entry, position='prepend' |
| task.skill | task.prompts entry, position='append' with tools metadata |
| task.subject | task.name |
| trigger.skill | trigger.prompts |
| AGENTS.md / KNOWLEDGE.md | project agent.prompts entries, scope='descendants' |
| audit log | events WHERE type='decision' |
| cost ledger | events WHERE type='cost' |
| expertise ledger | events WHERE type='task_completed', derived via query |
| session store | events WHERE type='message' |
| dispatch bus | events WHERE type='dispatch' |
| notes / blackboard | memories WHERE scope='shared' |
| event broadcaster | live tail of events table + tokio broadcast channel |

### Prompt assembly

One query builds the full prompt for any agent + task combination:

```sql
-- Collect all prompts: agent ancestors (deepest first) + agent self + task
WITH RECURSIVE ancestors(id, depth) AS (
    SELECT id, 0 FROM agents WHERE id = ?1
    UNION ALL
    SELECT a.parent_id, ancestors.depth + 1
    FROM agents a JOIN ancestors ON a.id = ancestors.id
    WHERE a.parent_id IS NOT NULL
)
SELECT p.value, p.position, p.scope, p.tools, a.depth, 'agent' as source
FROM ancestors a, json_each(a.prompts) AS p
WHERE p.scope = 'descendants' OR (p.scope = 'self' AND a.depth = 0)
UNION ALL
SELECT p.value, p.position, p.scope, p.tools, -1, 'task'
FROM json_each(?2) AS p   -- ?2 = task.prompts JSON
ORDER BY position, depth DESC;
```

Root primer → parent prompts → self prompts → task prompts. Grouped by position
(system, prepend, append). That's the entire prompt construction.

### Prompt entry schema

```json
{
  "content": "You are a code reviewer...",
  "position": "system|prepend|append",
  "scope": "self|descendants",
  "tools": { "allow": ["shell", "file"], "deny": ["git_push"] }
}
```

---

## Phase 1 — Remove legacy code

Delete `company.rs`, `registry.rs`. Remove mod/use/re-exports from `lib.rs`.

Every `Arc<CompanyRegistry>` — remove the field and all code touching it.
Every `Option<Arc<AgentRegistry>>` or `Option<Arc<Scheduler>>` that is always
populated — make non-optional, delete the if-let/else fallback branches.

Rewrite tests that construct CompanyRegistry/Company/WorkerPool to use
AgentRegistry from a tempdir. Delete tests that only test the old path.
If `worker_pool.rs` has no remaining callers, delete it too.

**Verification:** `cargo test --workspace` all green, zero references to
CompanyRegistry/Company remain.

---

## Phase 2 — Fix Scheduler gaps

### 2a. Model resolution
Add `resolve_model()` to AgentRegistry — walks ancestor chain, falls back to
config default. Replace hardcoded `"anthropic/claude-sonnet-4-6"` in
`scheduler.rs spawn_worker()`.

### 2b. Remove TaskBoard shim
Refactor AgentWorker to accept a task completion callback instead of
`Arc<Mutex<TaskBoard>>`:

```rust
type TaskCallback = Box<dyn FnOnce(TaskStatus, Option<TaskOutcomeRecord>) + Send>;
```

Scheduler passes a closure that calls `agent_registry.update_task_status()`.
Delete `create_temp_task_board()`.

### 2c. Port WorkerPool features
Only features enabled in current config (check `aeqi.toml` flags):

- Verification pipeline (`verification_enabled`)
- Preflight assessment (`preflight_enabled`)
- Adaptive retry + failure analysis (`adaptive_retry`)
- Escalation depth tracking via task labels

Extract as standalone functions/modules, call from Scheduler.

**Verification:** Scheduler handles full worker lifecycle without WorkerPool.

---

## Phase 3 — Collapse prompts

### 3a. Add prompts column

```sql
ALTER TABLE agents ADD COLUMN prompts TEXT DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN prompts TEXT DEFAULT '[]';
-- triggers already have a prompts-like field (skill) — replace with prompts
```

### 3b. Migrate agent identity to prompts

For every agent in the registry:
- `system_prompt` → prompts entry `{content, position: "system", scope: "self"}`
- Delete `system_prompt` column (or stop reading it)

At daemon startup:
- `shared_primer` from config → root agent.prompts entry `{scope: "descendants", position: "prepend"}`
- `project_primer` → project agent.prompts entry `{scope: "descendants", position: "prepend"}`
- AGENTS.md / KNOWLEDGE.md → project agent.prompts entries `{scope: "descendants", position: "append"}`

### 3c. Migrate task description + skill to prompts

- `task.description` → task.prompts entry `{position: "prepend"}`
- `task.skill` → load TOML, inject as task.prompts entry `{position: "append", tools: {...}}`
- Delete `description` and `skill` columns (or stop reading them)
- Rename `task.subject` → `task.name`

### 3d. Migrate trigger skill to prompts

- `trigger.skill` → load TOML at fire time, inject as prompts into the created task
- Add `prompts` column to triggers table
- Delete `skill` column

### 3e. Delete Identity struct

The `Identity` struct in aeqi-core has fields: `persona`, `memory`, `skill_prompt`,
`knowledge`. All replaced by prompts[]. The struct becomes unnecessary.

- AgentWorker takes `Vec<PromptEntry>` instead of `Identity`
- `with_primers()` goes away — primers are just prompts on ancestor agents
- `load_skill_prompt()` returns `Vec<PromptEntry>` instead of `String`
- Template parser writes prompts[] instead of system_prompt

### 3f. Prompt assembly in Scheduler

Replace all the string concatenation in `create_worker()` / `spawn_worker()` with
one function:

```rust
fn assemble_prompts(
    agent_registry: &AgentRegistry,
    agent_id: &str,
    task_prompts: &[PromptEntry],
) -> AssembledPrompt {
    // 1. Walk ancestors, collect prompts with scope='descendants'
    // 2. Collect agent's own prompts with scope='self'
    // 3. Append task prompts
    // 4. Group by position (system, prepend, append)
    // 5. Concatenate within each group (deepest ancestor first)
    // 6. Extract merged tool restrictions
}
```

**Verification:** All prompt construction goes through `assemble_prompts()`.
Skill loading, primer injection, identity building — all deleted.

---

## Phase 4 — Unify event stores

### 4a. Create events table

Add to `AgentRegistry::open()`:

```sql
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    agent_id TEXT,
    session_id TEXT,
    task_id TEXT,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_agent ON events(agent_id);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_task ON events(task_id);
CREATE INDEX idx_events_created ON events(created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS events_fts
    USING fts5(content, content=events, content_rowid=rowid);
```

Create `EventStore` struct wrapping the shared db connection:

```rust
impl EventStore {
    fn emit(type, agent_id, session_id, task_id, content) -> Result<String>
    fn query(type, filters, limit, offset) -> Result<Vec<Event>>
    fn query_sum(type, json_field, filters) -> Result<f64>
    fn tail(type, since_id) -> Result<Vec<Event>>
    fn search(query_text) -> Result<Vec<Event>>    // FTS5
    fn update(event_id, content_patch) -> Result<()>
}
```

### 4b. Migrate simple stores (low risk)

**Audit log** → `event_store.emit("decision", ...)`
- Delete `audit.rs`
- `audit_log.record(event)` → `event_store.emit("decision", ...)`

**Cost ledger** → `event_store.emit("cost", ...)`
- Delete `cost_ledger.rs`
- Budget check = `event_store.query_sum("cost", "$.cost_usd", {today})`

**Expertise ledger** → derived from `events WHERE type='task_completed'`
- Delete `expertise.rs`
- Best-agent = aggregate task_completed events by agent + domain

### 4c. Migrate session store (medium risk)

- `session_store.append(msg)` → `event_store.emit("message", ...)`
- `session_store.search(query)` → `event_store.search(query)` (FTS5)
- `session_store.recent(session, limit)` → `event_store.query("message", {session_id}, limit)`
- Sessions metadata (id, agent_id, status, type) stays as a table — it's about event streams, not events
- Summarization operates on `events WHERE type='message' AND session_id=X`
- Delete `session_store.rs` after all callers migrated

### 4d. Migrate dispatch bus (medium-high risk)

Dispatches are events with status tracking:

```json
{
  "type": "dispatch",
  "content": {
    "kind": "delegate_request",
    "from": "agent_id", "to": "agent_id",
    "status": "pending",
    "ack_required": true,
    "idempotency_key": "...",
    "payload": { ... }
  }
}
```

- `dispatch_bus.send()` → `event_store.emit("dispatch", ...)`
- `dispatch_bus.read(agent)` → `event_store.query("dispatch", {to=agent, status=pending})`
- `dispatch_bus.acknowledge(id)` → `event_store.update(id, {status: "acked"})`
- Retry = query unacked dispatches older than 60s
- Dead letter = count retries, move to status=dead after N
- Delete `message.rs`

### 4e. Merge Notes into Memory

Add columns to memories table:

```sql
ALTER TABLE memories ADD COLUMN scope TEXT DEFAULT 'entity';   -- 'entity'|'shared'
ALTER TABLE memories ADD COLUMN visibility TEXT;                 -- JSON
ALTER TABLE memories ADD COLUMN ttl_hours INTEGER;
```

- `notes.post()` → `memory.store()` with scope='shared'
- `notes.query_scoped()` → memory search with scope='shared' + visibility filter
- Delete `notes.rs`

### 4f. Event broadcaster

The tokio broadcast channel stays for real-time in-process subscribers.
Every `publish(event)` also calls `event_store.emit(...)`. The broadcaster
becomes a thin wrapper: persist + broadcast.

**Verification after Phase 4:** Four tables, one database, zero separate .db files.

---

## Phase 5 — Wire expertise routing

In `Scheduler::schedule()`, before spawning:

```sql
SELECT agent_id,
       SUM(CASE WHEN json_extract(content,'$.outcome')='done' THEN 1 ELSE 0 END) as wins,
       COUNT(*) as total
FROM events
WHERE type='task_completed'
  AND agent_id IN (active agents with matching capabilities)
GROUP BY agent_id
ORDER BY wins DESC
```

If a better agent exists and is under its concurrency limit, reassign.
Fall back to default assignee if no data.

---

## Phase 6 — Root agent bootstrap

Create a prompts preset file (`presets/bootstrap.json`) that teaches the root
agent to interpret org descriptions and call spawn/configure/delegate tools.

User says: "I need a backend team with 3 engineers and a reviewer"
Root agent: spawns parent agent "backend", spawns 4 children, sets prompts/models/workdirs,
creates triggers for code review events.

This is a prompts[] preset, not a "skill" — skills don't exist as a concept anymore.

---

## Phase 7 — Sibling memory + agent conversations

### 7a. Shared scope memory
When an agent searches memory, also include memories from siblings (same parent_id)
that have `scope='shared'`. Same ancestor walk, extended one step sideways.

### 7b. Agent-to-agent sessions
Implement back-and-forth between agents via shared session.
Use events table with `type='message'` and a session_id linking both agents.
The dispatch bus (now events) handles delivery. Sessions handle history.

---

## Invariants

After all phases:

- **4 tables**: agents, tasks, events, memories
- **1 field type**: prompts[] on agents, tasks, triggers
- **1 database**: aeqi.db (+ memories.db for embeddings)
- **1 scheduler**: event-driven, global, wake → reap → query → spawn
- **0 separate concept files**: no company.rs, registry.rs, worker_pool.rs,
  audit.rs, cost_ledger.rs, expertise.rs, notes.rs, session_store.rs,
  skill loader, identity struct, primer injection
- **0 separate .db files**: no audit.db, expertise.db, notes.db, sessions.db
- `cargo clippy --workspace && cargo test --workspace` all green
- Fewer total lines of code than we started with

## Execution order

Phases 1-2 are prerequisites. After that:
- Phase 3 (prompts) and Phase 4 (events) are independent — can be done in either order
- Phase 5 depends on Phase 4 (expertise routing queries the events table)
- Phase 6 depends on Phase 3 (bootstrap preset uses prompts[])
- Phase 7 depends on Phase 4 (agent conversations use events)

Recommended: 1 → 2 → 3 → 4 → 5 → 6 → 7

Each phase is independently shippable. The system works after any phase.
