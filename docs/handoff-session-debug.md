# Session Debug & Agent Architecture — Full Investigation

## Terminology

The four primitives are **Agents, Events, Quests, Ideas**. "Prompts" no longer
exist as a separate concept — they ARE ideas. An idea can be an agent's identity,
a shared instruction, a memory, or learned knowledge. The `prompt_ids` field on
agents references ideas from the idea store. If you see "prompt" in the code,
it's legacy naming that should be migrated to "idea".

---

## Issue 1: All sessions named "Permanent Session"

### Root Cause

Legacy migration at `session_store.rs:348-353` hardcodes "Permanent Session" for
all migrated sessions. New sessions get generic names like "web". The `first_message`
column doesn't exist in the sessions table at all.

### Fix

**Backend** (`crates/aeqi-orchestrator/src/session_store.rs`):

1. Add `first_message TEXT DEFAULT ''` column (ALTER TABLE migration)
2. In `record_by_session()`, on first user message, populate `first_message`
   (truncated to 200 chars) and derive `name` from first ~6 words
3. Include `first_message` in `list_sessions()` SELECT and Session struct
4. Backfill existing sessions from `session_messages` table

**Frontend**: Already handled — `sessionLabel()` in AgentSessionView.tsx checks
`s.name` → `s.first_message` → `s.id`. Once backend populates, it works.

---

## Issue 2: Agent has no ideas tool — complete root cause analysis

### The Tool Registration Chain

Tools are assembled in `session_manager.rs:432-496` (function `spawn_session`):

```
1. Base tools (always):
   ShellTool, FileReadTool, FileWriteTool, FileEditTool, GrepTool, GlobTool

2. Orchestration tools (build_orchestration_tools in tools.rs:1653-1701):
   AgentsTool    — always
   QuestsTool    — always
   EventsTool    — always
   CodeTool      — always
   IdeasTool     — CONDITIONAL: only if memory_for_agent is Some (line 1691)
   WebTool       — always

3. Tool filtering:
   Each idea/prompt can define tool_allow and tool_deny lists.
   tools.retain(|t| p.is_tool_allowed(t.name()))
```

### Why IdeasTool was missing

**The IdeasTool IS defined** (`tools.rs:479-628`) as a unified tool with actions:
store, search, delete. It replaces the old ideas_store/ideas_recall/ideas_graph
as separate tools.

**But it's conditionally registered** at `tools.rs:1691`:
```rust
if let Some(memory) = memory_for_agent {
    tools.push(Arc::new(IdeasTool::new(memory, activity_log.clone())));
} else {
    warn!("no memory backend — ideas tool skipped");
}
```

For luca-eich, `memory_for_agent` was None because the ideas DB was never
initialized for this company. The tool was silently skipped with a warning log.

### Why the ideas DB is empty

**Host companies don't get seeded.** The seeding pipeline:

```
signup_handler (server.rs:667-689)
  → spawns sandbox
  → seed_company_templates()    ← only for SANDBOX companies
  → seed_specific_pack()        ← only if template param set

admin_promote_company_to_host (server.rs)
  → starts systemd unit
  → DOES NOT call seed_company_templates()  ← THE GAP
```

luca-eich is a host-provisioned company. Its runtime started clean — empty ideas
DB, empty agent registry (except the inline company agent). The archetype packs
exist in the platform DB but were never POSTed to this runtime.

### The seeding endpoint

When seeding DOES run, the chain is:
```
Platform: POST http://127.0.0.1:{port}/api/ideas/seed
  payload: { cmd: "seed_ideas", ideas: [...], agents: [...] }

Runtime: crates/aeqi-web/src/routes/memory.rs handles the POST
  → IdeaStore::store() for each idea
  → AgentRegistry::spawn() for each agent in the agents array

DB: crates/aeqi-ideas/src/sqlite.rs
  → ideas.db (was insights.db)
  → table: ideas (id, key, content, category, agent_id, scope,
    injection_mode, inheritance, tool_allow, tool_deny, ...)
```

### Timing vulnerability

Even for sandbox companies, `seed_company_templates()` runs async after sandbox
spawn. If the runtime HTTP server isn't ready yet, the POST fails with a
connection error. Logged as warning, never retried.

### Fix Plan

1. **Seed host companies**: In `admin_promote_company_to_host()`, call
   `seed_company_templates()` after the host runtime starts.

2. **Seed on first session** (fallback): In `spawn_session()`, if the ideas
   DB is empty and the company hasn't been seeded, trigger seeding.

3. **Retry seeding**: Add retry logic (3 attempts, 5s delay) to
   `seed_company_templates()` for when the runtime isn't ready yet.

4. **Manual seed endpoint**: Add an admin API to re-trigger seeding for
   a specific company: `POST /admin/companies/{name}/seed`.

---

## Issue 3: What `capabilities` actually is

The `capabilities` field on an agent is **not** used for tool gating in the
current codebase. Tool gating is done through **idea/prompt frontmatter**:

```yaml
---
tools: [shell, read_file]    # allow-list
deny: [write_file]           # deny-list
---
```

Applied in `session_manager.rs:514-519`:
```rust
tools.retain(|t| p.is_tool_allowed(t.name()));
```

The `capabilities` field on the Agent struct exists but is effectively unused
in the tool assembly pipeline. It may have been intended for future use
(e.g., `spawn_agents` permission) but currently has no effect on what tools
an agent receives.

**Recommendation**: Either wire capabilities into tool filtering, or remove
the field to avoid confusion. Currently it's dead weight.

---

## Issue 4: Agent used CLI instead of tools (session 7e8b5751)

### What happened

Agent (deepseek-v3.2) was asked to explore AEQI. It ran `aeqi setup` via shell
(creating disk-based agent templates) then tried `aeqi chat --agent leader`
(which failed — recursive daemon connection).

### Why

1. **No ideas tool** → couldn't store/recall knowledge
2. **System prompt says "delegate"** but doesn't mention available tools
3. **Model (deepseek-v3.2)** is weaker at structured tool use — defaulted to
   shell exploration
4. **Disk templates are irrelevant** on hosted platform — agents come from DB registry

### Fix

1. Register ideas tool (fix the memory backend initialization)
2. System prompt should explicitly list available tools:
   "You have: agents (hire, delegate), quests (create, update, close),
   events (triggers), ideas (store, search), code (search, graph),
   web (fetch, search), shell, files. Use these tools directly."
3. Set explicit model on company agents (not None → default)
4. Consider blocking `aeqi` CLI from shell on hosted platform

---

## Issue 5: Legacy naming — prompt → idea rename scope

### Inventory

~280 occurrences across 18 Rust files. Key targets:

**Structs to rename:**
- `StepPromptSpec` → `StepIdeaSpec` (aeqi-core/src/agent.rs)
- `Prompt` → `IdeaSpec` (aeqi-tools/src/prompt.rs — the entire struct)

**Fields to rename:**
- `prompt_ids` → `idea_ids` (config.rs, agent_registry.rs, API responses)
- `step_prompts` → `step_ideas` (agent.rs — field, mutex, all references)
- `prompt_assembly` → `idea_assembly` (orchestrator module)
- `prompt_loader` → `idea_loader` (orchestrator module)

**Methods to rename:**
- `build_step_context` → already renamed from `build_turn_context` but still
  references "prompt" internally
- `with_step_prompts` → `with_step_ideas`
- `store_prompt()` on IdeaStore trait → `store_idea()`
- `get_prompts_for_chain()` → `get_ideas_for_chain()`
- `resolve_prompts()` in session_manager → `resolve_ideas()`

**Files by occurrence count:**
- agent.rs: ~45
- prompt.rs (aeqi-tools): ~40
- session_manager.rs: ~30
- prompt_assembly.rs: ~25
- prompt_loader.rs: ~20
- tools.rs: ~15
- config.rs: ~8
- sqlite.rs: ~10 (insights.db → ideas.db)
- 10 other files: 1-5 each

**DB/files:**
- `insights.db` default path → `ideas.db`
- `ipc/prompts.rs` module → `ipc/ideas.rs` (already partially done?)

### Execution

Same approach as the turn→step rename: targeted sed across crates/, then
cargo check to catch anything missed. One focused session, ~1 hour.

---

## Files Referenced

| File | What | Lines |
|------|------|-------|
| `crates/aeqi-orchestrator/src/session_manager.rs` | Tool assembly, session spawn | 432-496, 514-519 |
| `crates/aeqi-orchestrator/src/tools.rs` | IdeasTool definition, build_orchestration_tools | 479-628, 1653-1701 |
| `crates/aeqi-core/src/traits/idea.rs` | IdeaStore trait | 148-294 |
| `crates/aeqi-ideas/src/sqlite.rs` | Ideas DB, storage | full file |
| `crates/aeqi-orchestrator/src/session_store.rs` | Session creation, listing, migration | 348-353, 876-906 |
| `crates/aeqi-orchestrator/src/ipc/sessions.rs` | Session API handlers | 9-65 |
| `crates/aeqi-tools/src/prompt.rs` | Prompt struct (→ IdeaSpec) | full file |
| `crates/aeqi-core/src/agent.rs` | step_prompts, StepPromptSpec | 577-680, 1814-1851 |
| `aeqi-platform/src/server.rs` | seed_company_templates, signup_handler | 667-689, 3100-3195 |
| `apps/ui/src/components/AgentSessionView.tsx` | sessionLabel(), SessionInfo | 505-530 |
