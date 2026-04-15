# AEQI Consistency Audit — Definitive Report

The four primitives are **A**gents, **E**vents, **Q**uests, **I**deas.
Every API, DB column, struct, CSS class, and variable should speak this language.
This report documents every place that doesn't.

---

## 1. NAMING INCONSISTENCIES

### 1a. "memory" used to mean "idea" — HIGH (100+ occurrences)

The idea store was originally called "memory." This is the largest naming debt.

**Backend:**
- `MemoryConfig` struct in config.rs
- `/memories` API endpoint (aeqi-web/src/routes/memory.rs) — entire route module
- `handle_memories()` IPC handler (aeqi-orchestrator/src/ipc/memory.rs)
- `MemoryRelation`, `MemoryEdge`, `MemoryProvenance`, `MemoryAge` structs (aeqi-ideas/src/graph.rs)
- `SimilarMemory` struct (aeqi-ideas/src/dedup.rs)
- `ParsedMemory` struct (aeqi-ideas/src/obsidian.rs)
- JSON responses return `"memories"` array

**Frontend:**
- `getMemories()`, `getMemoryGraph()`, `getMemoryProfile()` API functions
- `MemoryEntry` interface (types.ts) — used everywhere for ideas
- `MemoryGraph` component (MemoryGraph.tsx)
- CSS classes: `memory-list`, `memory-entry`, `memory-header`, `memory-key`,
  `memory-tags`, `memory-tag`, `memory-content`, `memory-meta`,
  `memory-graph-canvas`, `memory-graph-container`
- `MemoryActivity` WebSocket event type

**Target:** All → "idea" / "ideas" / `IdeaEntry` / `getIdeas()` / `/ideas` etc.

### 1b. "prompt" used to mean "idea" — MEDIUM (~73 occurrences)

Ideas that get injected into agent context are called "prompts."

**Backend:**
- `prompt_ids` field on Agent struct → `idea_ids`
- `StepPromptSpec` struct → `StepIdeaSpec`
- `step_prompts` field → `step_ideas`
- `with_step_prompts()` method → `with_step_ideas()`
- `store_prompt()` on IdeaStore → `store_idea()`
- `get_prompts_for_chain()` → `get_ideas_for_chain()`
- `PromptLoader`, `PromptFileEntry` modules → `IdeaLoader`, etc.
- `prompt_assembly.rs` module → `idea_assembly.rs`
- `ipc/prompts.rs` module

**Frontend:**
- `prompt_ids` in Agent type and AgentPage display

### 1c. "audit" used to mean "event" — HIGH

The activity/event stream is called "audit" in the API.

**Backend:**
- `/audit` endpoint (aeqi-web/src/routes/dashboard.rs)
- `handle_audit()` IPC handler
- `AuditEntry` struct

**Frontend:**
- `getAudit()`, `getAuditForQuest()` API functions
- `AuditEntry` interface and component
- `auditToTimeline()` helper
- CSS classes: `audit-entry-*`, `audit-quest-id`

**Target:** All → "event" / `EventEntry` / `getEvents()` / `/events`

### 1d. "insight" remnants — LOW (~20 occurrences)

Mostly in migration code and comments.

- `insights.db` default path (aeqi-ideas/src/sqlite.rs, aeqi-cli daemon.rs)
- Category mapping `"insight" → "insights"` (aeqi-ideas/src/hierarchy.rs)
- CSS: `ctx-insight-key`, `ctx-insight-content` (ContextView.tsx)
- Color mapping `insight: "var(--success)"` (IdeasPage.tsx)

### 1e. "task" used to mean "quest" — MEDIUM

Properly deprecated in most places but still present.

- `task_outcome()`, `set_task_outcome()` methods (aeqi-quests/src/quest.rs)
- `task_id` DB columns with `#[serde(alias)]` compat (session_store, ideas sqlite)
- `task_snapshot()`, `find_task_snapshot()` (daemon.rs)
- Frontend: `task_id` deprecated field with fallback `quest_id || task_id`

### 1f. "worker" used where "agent" should be — MEDIUM

Checkpoints and the worker events API expose "worker" user-facing.

- `worker: String` field on Checkpoint struct (quest.rs)
- `/worker/events` API endpoint
- `getWorkerEvents()` frontend API function
- `cp.worker` displayed in CheckpointTimeline.tsx

**Target:** `worker` → `agent` in user-facing APIs and UI

---

## 2. API CONTRACT MISMATCHES

### 2a. Agent fields — backend has but doesn't send

Frontend `Agent` type expects (types.ts:21-25):
- `budget_usd` — NOT sent
- `execution_mode` — NOT sent
- `workdir` — NOT sent
- `quest_prefix` — NOT sent
- `worker_timeout_secs` — NOT sent

Backend Agent struct HAS these fields (agent_registry.rs:44-101) but the IPC
handler (ipc/agents.rs:57-76) intentionally omits them from the JSON response.

### 2b. Session fields — don't exist in backend

Frontend `SessionInfo` expects:
- `first_message` — NOT a column, NOT sent
- `last_active` — NOT sent
- `message_count` — NOT sent

Backend Session struct (session_store.rs:23-33) has none of these.

### 2c. WebSocket events — frontend doesn't handle all

Backend emits but frontend ignores:
- `ToolProgress` — incremental tool output (e.g., shell stdout)
- `StepComplete` — step finished with token counts

Frontend handles but backend doesn't emit:
- `ToolCall` — dead code in the switch statement

---

## 3. DEAD CODE

### 3a. Safe to delete immediately

| File | Lines | What |
|------|-------|------|
| `apps/ui/src/components/SessionRail.tsx` | 92 | Replaced by session tabs. Never imported. |
| `apps/ui/src/styles/session-rail.css` | 135 | CSS for deleted component. |
| `chat store threads` (store/chat.ts) | ~40 | `threads`, `getOrCreateThread()`, `updateThread()` — never called. Only `selectedAgent` is used. |
| Dead `ToolCall` case (AgentSessionView.tsx) | 2 | WS event variant that doesn't exist in backend. |

### 3b. Stub pages (delete if not planned)

| Page | Route | What it shows |
|------|-------|---------------|
| SessionsPage.tsx | `/sessions` | "Coming soon" empty state |
| AppsPage.tsx | `/apps` | "Coming soon" empty state |
| DrivePage.tsx | `/drive` | "Coming soon" empty state |
| TreasuryPage.tsx | `/treasury` | "Coming soon" empty state |
| MarketPage.tsx | `/market` | "Coming soon" empty state |

### 3c. Unused Rust modules (aspirational, not integrated)

| Module | What it does | Size |
|--------|-------------|------|
| `sanitize.rs` (aeqi-core) | Prompt injection detection | ~11KB |
| `shell_hooks.rs` (aeqi-core) | Lifecycle shell hooks | ~5KB |

Both are well-written but never called from anywhere. Keep if planned for near-term.

### 3d. Type alias

`pub type CompanyConfig = AgentSpawnConfig;` (aeqi-core/src/lib.rs:33) — verify if used.

---

## 4. STRUCTURAL ISSUES

### 4a. IdeasTool conditionally registered

`tools.rs:1691`: IdeasTool only added if `memory_for_agent` is `Some`. If the
ideas DB fails to open (or company never seeded), the tool is silently skipped.
Agents have no way to store or recall knowledge.

### 4b. Host companies never seeded

`admin_promote_company_to_host()` starts the systemd unit but doesn't call
`seed_company_templates()`. Host companies start with zero ideas, zero agents
(except the inline company agent).

### 4c. Seeding has no retry

`seed_company_templates()` runs async after sandbox spawn. If the runtime HTTP
server isn't ready, the POST fails. Warning logged, never retried. The company
ends up empty.

### 4d. Session names are meaningless

All sessions named "Permanent Session" (migration default) or "web" (caller
passes session type as name). `first_message` doesn't exist as a column.

### 4e. `capabilities` field is dead weight

`capabilities: Vec<String>` on Agent struct is never read in the tool assembly
pipeline. Tool gating is done through idea/prompt frontmatter (`tool_allow`,
`tool_deny`), not through capabilities. The field exists in the DB and API but
has no effect.

---

## 5. EXECUTION PLAN

### Phase 1: Quick wins (1 hour)
- Delete SessionRail + CSS
- Delete dead chat store methods
- Remove `ToolCall` dead code from WS handler
- Handle `ToolProgress` and `StepComplete` in frontend

### Phase 2: Session naming (2 hours)
- Add `first_message` column to sessions table
- Populate on first user message
- Derive session name from first message
- Backfill existing sessions

### Phase 3: API contracts (2 hours)
- Send agent operational fields in registry response
- Send session `first_message`, `last_active`, `message_count`
- Or: remove unused fields from frontend types

### Phase 4: memory→idea rename (4 hours)
- Backend: MemoryConfig, /memories endpoint, IPC handlers, graph structs
- Frontend: getMemories→getIdeas, MemoryEntry→IdeaEntry, MemoryGraph→IdeaGraph
- CSS: memory-* → idea-*
- DB: insights.db → ideas.db path

### Phase 5: prompt→idea rename (2 hours)
- Backend: prompt_ids→idea_ids, StepPromptSpec→StepIdeaSpec, step_prompts→step_ideas
- Modules: prompt_assembly→idea_assembly, prompt_loader→idea_loader
- DB column migration: agents.prompt_ids → agents.idea_ids

### Phase 6: audit→event rename (2 hours)
- Backend: /audit→/events endpoint, AuditEntry→EventEntry, handle_audit→handle_events
- Frontend: getAudit→getEvents, AuditEntry component+type
- CSS: audit-* → event-*

### Phase 7: task→quest cleanup (1 hour)
- Remove deprecated task_id aliases (keep serde(alias) for DB compat)
- task_outcome→quest_outcome, task_snapshot→quest_snapshot

### Phase 8: worker→agent in user-facing API (1 hour)
- /worker/events → /activity (or /agent-activity)
- Checkpoint.worker → Checkpoint.agent_name
- Frontend: getWorkerEvents, cp.worker references

### Phase 9: Structural fixes (4 hours)
- Seed host companies on promotion
- Add retry to seeding pipeline
- Wire capabilities into tool filtering (or remove the field)
- Ensure IdeasTool always registers (fallback to empty store, not None)

---

## Summary

| Category | Occurrences | Severity |
|----------|-------------|----------|
| memory→idea | 100+ | HIGH |
| audit→event | 30+ | HIGH |
| prompt→idea | 73 | MEDIUM |
| task→quest | 20+ | MEDIUM |
| worker→agent | 15+ | MEDIUM |
| insight remnants | 20 | LOW |
| Dead code | 5 files + stubs | LOW |
| API mismatches | 8 fields | MEDIUM |
| Structural gaps | 5 issues | HIGH |

Total estimated effort: ~19 hours of focused work across 9 phases.
