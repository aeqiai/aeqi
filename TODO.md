# AEQI — Remaining Work

Current state: skeleton is correct. Agents, quests, events in aeqi.db.
Prompts[] field exists. Scheduler runs one loop. 564 tests pass.

What remains: collapse 3,673 lines of separate stores into the four
primitives, delete legacy types, fix naming.

---

## 1. Collapse stores into EventStore

Each store becomes a query. Delete the file after migrating all callers.

### audit.rs (345 lines) → events WHERE type='decision'
- `audit_log.record(event)` → `event_store.emit("decision", agent_id, None, quest_id, content)`
- Callers: agent_worker.rs, scheduler.rs, daemon.rs
- Delete audit.rs, remove audit.db

### expertise.rs (342 lines) → events WHERE type='quest_completed'  
- `expertise.record(record)` → already emitted as event by scheduler
- Expertise queries = `event_store.query("quest_completed", {agent_id})` with aggregation
- Callers: scheduler.rs
- Delete expertise.rs, remove expertise.db

### notes.rs (1,111 lines) → memories WHERE scope='shared'
- Add to insights table: `scope TEXT DEFAULT 'entity'`, `visibility TEXT`, `ttl_hours INTEGER`
- `notes.post()` → `insight_store.store()` with scope='shared'
- `notes.query_scoped()` → insight search with visibility filter
- Callers: scheduler.rs, agent_worker.rs, daemon.rs
- Delete notes.rs, remove bb.db

### session_store.rs (1,249 lines) → events WHERE type='message'
- `session_store.append(msg)` → `event_store.emit("message", agent_id, session_id, None, content)`
- `session_store.search(query)` → `event_store.search(query)` (FTS5 already on events)
- `session_store.recent(session, limit)` → `event_store.query("message", {session_id}, limit)`
- Sessions metadata table (id, agent_id, status, type) stays — it describes streams, not events
- Summarization queries events WHERE type='message' AND session_id=X
- Callers: daemon.rs, agent_worker.rs, message_router.rs, session_manager.rs, tools.rs, vfs.rs
- Delete session_store.rs, remove conv.db

### message.rs dispatch (626 lines) → events WHERE type='dispatch'
- `dispatch_bus.send(d)` → `event_store.emit("dispatch", agent_id, None, None, {kind, from, to, status, payload})`
- `dispatch_bus.read(agent)` → `event_store.query("dispatch", {to=agent, status=pending})`
- `dispatch_bus.acknowledge(id)` → `event_store.update(id, {status: "acked"})`
- Retry = query unacked older than 60s
- Dead letter = status=dead after N retries
- Callers: everywhere — scheduler, daemon, agent_worker, delegate, message_router
- Delete message.rs or reduce to thin wrapper over EventStore

---

## 2. Delete legacy types

### Identity struct (aeqi-core/src/identity.rs, 317 lines)
- All fields replaced by prompts[] entries
- Remove Identity from agent_worker.rs, session_manager.rs, scheduler.rs
- Delete identity.rs

### Skill structs (aeqi-tools/src/skill.rs)
- Skill, SkillMeta, SkillPrompt, SkillVerification, SkillExecution
- Skills are prompts[] entries on quests/triggers
- Skill TOML files on disk become preset files that load into prompts[]
- Delete skill.rs, remove SynthesizedSkill from aeqi-graph

### CompanyConfig / DepartmentConfig / TeamConfig (aeqi-core/src/config.rs)
- Companies are agents with workdir. Departments are parent agents. Teams are subtrees.
- Config should define agents to spawn at startup, not structural types
- Replace `[[companies]]` with `[[agents]]` in config schema
- Delete the three struct definitions

---

## 3. Fix naming

### Task → Quest (Rust code — remaining references)
- executor.rs: TaskOutcome → QuestOutcome (16 refs)
- agent_worker.rs: TaskOutcome refs (18 refs)
- expertise.rs: TaskOutcomeKind (9 refs) — file deleted in step 1 anyway
- agent_registry.rs: task_id in approvals table (1 ref)
- lib.rs: TaskOutcome re-export (1 ref)

### task_id → quest_id (Rust code)
- approvals table column
- Parameter names in agent_registry.rs functions
- Event content JSON fields

---

## 4. Consolidate databases

After steps 1-3, the only databases should be:
- **aeqi.db** — agents, quests, quest_sequences, events, sessions, triggers, budget_policies, approvals
- **insights.db** — insights, memory_edges, memory_embeddings (kept separate for vector search performance)
- **codegraph/{name}.db** — code graph per repo (infrastructure, not a primitive)

Everything else (audit.db, expertise.db, bb.db, conv.db) deleted.

---

## 5. Wire graph to triggers

Code graph should re-index on git events automatically:
- Create a default trigger on repo-bound agents: event=git_commit, skill=reindex
- The "skill" is a prompts[] preset that tells the agent to run graph indexing
- aeqi-graph crate stays as infrastructure, called by tools

---

## 6. Middleware cleanup

Three middleware layers should become prompts[] instead of code:
- **Guardrails** (allow/deny tool lists) → already in prompts[].tools field
- **GraphGuardrails** → prompts[].tools metadata from code graph analysis
- **Clarification** → system prompt instruction: "if the quest is unclear, respond with status=blocked"

Keep as code: ContextCompression, ContextBudget, CostTracking, LoopDetection, MemoryRefresh, SafetyNet.

---

## 7. API + CLI cleanup

### Web routes (aeqi-web)
- Delete: /companies, /departments, /skills, /pipelines
- Rename: /tasks → /quests
- Keep: /agents, /quests, /events, /insights, /sessions, /triggers

### CLI flags (aeqi-cli)
- Replace --company/--project with --agent
- Delete: skill, pipeline, team subcommands if they exist
- Rename: task → quest in all subcommands

---

## Order

1 → 2 → 3 can be parallelized (independent files).
4 is a consequence of 1.
5, 6, 7 are independent of each other, depend on 1-3 being done.

Each step is independently shippable. Tests must pass after each.
