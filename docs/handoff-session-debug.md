# Session Debug & Agent Architecture — Investigation & Handoff

## Terminology Note

The four primitives are **Agents, Events, Quests, Ideas**. "Prompts" no longer
exist as a separate concept — they ARE ideas. An idea can be an agent's identity,
a shared instruction, a memory, or learned knowledge. The `prompt_ids` field on
agents references ideas from the idea store. If you see "prompt" in the code,
it's legacy naming that should be migrated to "idea".

---

## Issue 1: All sessions named "Permanent Session"

### Root Cause

Legacy migration at `session_store.rs:348-353`:
```sql
INSERT OR IGNORE INTO sessions (id, agent_id, session_type, name, status, ...)
SELECT id, agent_id, 'perpetual', 'Permanent Session', status, ...
FROM agent_sessions WHERE id NOT IN (SELECT id FROM sessions);
```

All sessions migrated from the old `agent_sessions` table get hardcoded name
"Permanent Session". New sessions also get generic names — the caller passes
the session type as the name (e.g., "web").

### `first_message` doesn't exist

The `sessions` table has no `first_message` column. The frontend expects it,
the API returns empty. The `sessionLabel()` function falls through to the ID.

### Fix

**Backend** (`session_store.rs`):

1. Add `first_message TEXT DEFAULT ''` column to sessions table (migration).

2. In `record_by_session()`, when recording the first user message, also update
   the session's `first_message` and derive a display `name`:
```rust
if role == "user" {
    let name = content.split_whitespace().take(6).collect::<Vec<_>>().join(" ");
    let _ = db.execute(
        "UPDATE sessions SET first_message = ?1, name = CASE WHEN name IN ('Permanent Session', 'web', '') OR name IS NULL THEN ?2 ELSE name END WHERE id = ?3 AND (first_message IS NULL OR first_message = '')",
        rusqlite::params![&content[..content.len().min(200)], &name, session_id],
    );
}
```

3. Include `first_message` in `list_sessions()` SELECT and Session struct.

4. Backfill migration for existing sessions (populate from session_messages).

**Frontend**: Already handled — `sessionLabel()` checks `s.name` → `s.first_message` → ID.

---

## Issue 2: Agent has no ideas, missing tools, uses CLI instead

### Investigation (agent df0e9c24, session 7e8b5751)

**Agent config:**
```
id:           df0e9c24-73f3-4aec-b48d-2f4ed2b9ec1f
name:         luca-eich
template:     company
model:        None (falls back to default — deepseek-v3.2)
prompt_ids:   ['d37beadc-...']  ← one idea: the company identity
capabilities: []                ← empty
```

**System prompt:** "You are the lead agent for luca-eich. You coordinate all
work... delegate to specialist child agents... maintain situational awareness
through memory."

The prompt tells the agent to "delegate" and "use memory" — but:
- **Ideas tool is missing** from the tool set. Zero ideas in the store.
  The agent literally cannot store or recall anything.
- **Seeding never ran** for this company. The archetype packs we created
  exist in the platform DB but were never seeded to this tenant's runtime.
- The agent defaulted to shell commands (`aeqi setup`, `aeqi chat`) because
  it couldn't find the right tools.

### What `capabilities` is

The `capabilities` field on an agent controls which **tool categories** the agent
has access to. It's an allowlist. For example:
- `["spawn_agents"]` — agent can hire/retire other agents
- `["shell"]` — agent can run shell commands
- Empty `[]` — agent gets the default tool set

This field is NOT about what the agent is good at — it's a permission gate for
tool access. An agent with empty capabilities gets whatever the default tool
registration provides. The question is: does the default include ideas tools?

### Root causes

1. **Ideas tools not registered**: The tool assembly logic (in `helpers.rs` or
   `session_manager.rs`) doesn't include ideas_store/ideas_recall/ideas_graph.
   Investigate where tools are assembled per agent session and add idea tools.

2. **Template seeding failed silently**: `seed_company_templates()` runs async
   after sandbox spawn. If the runtime wasn't ready yet, the HTTP POST fails
   and the error is logged but not retried. The company ends up with zero
   ideas seeded.

3. **prompt_ids → idea lookup**: The agent has `prompt_ids: ['d37beadc-...']`
   but the ideas store has 0 entries. This means the prompt was injected
   directly into the agent at creation time (stored inline in the registry),
   NOT resolved from the idea store. The idea store is completely empty.

4. **Model falls back to deepseek-v3.2**: With `model: None`, the agent uses
   whatever the runtime's default is. Deepseek-v3.2 is weaker at tool use
   than Claude or GPT-4. It explored via shell instead of using tools.

### Fix Plan

1. **Register idea tools** in the default tool set. Find where tools are
   assembled (likely `helpers.rs` `build_tools()` or `session_manager.rs`)
   and add ideas_store, ideas_recall, ideas_graph.

2. **Retry seeding**: Add retry logic to `seed_company_templates()` — if the
   runtime POST fails, retry after 5s, up to 3 attempts.

3. **Seed on first session**: As a fallback, check if the company has been
   seeded when the first session starts. If not, seed then.

4. **System prompt should list tools**: Add to the company agent template:
   "You have these tools available: agents (hire, delegate), quests (create,
   update, close), events (triggers), ideas (store, recall), shell, files,
   web. Use them directly — do NOT use CLI commands."

5. **Set a default model**: The company agent should have an explicit model
   set, not fall back to whatever the runtime default is.

---

## Issue 3: Legacy naming still in codebase

The rename from "insights/prompts" to "ideas" is done on the frontend and
landing page, but the backend still has mixed terminology:

- `prompt_ids` field on agents → should be `idea_ids`
- `prompts` in API responses → should be `ideas`
- `seed_ideas` endpoint exists ✓ (already renamed)
- `ideas_store`, `ideas_recall` tool names exist ✓
- `insights.db` file → should be `ideas.db`
- Various Rust structs: `StepPromptSpec`, `step_prompts` → `StepIdeaSpec`, `step_ideas`

This is a large rename (similar to the turn→step rename we did). Should be
a dedicated session with search-and-replace across all crates.

---

## Files Referenced

- `crates/aeqi-orchestrator/src/session_store.rs` — session creation, listing, migration
- `crates/aeqi-orchestrator/src/session_manager.rs` — tool assembly, session spawn
- `crates/aeqi-orchestrator/src/ipc/sessions.rs` — session API handlers
- `aeqi-cli/src/helpers.rs` — tool registration (`build_tools()`)
- `crates/aeqi-core/src/agent.rs` — `step_prompts` (should be `step_ideas`)
- `apps/ui/src/components/AgentSessionView.tsx` — `sessionLabel()`, `SessionInfo`
- `aeqi-platform/src/server.rs` — `seed_company_templates()`, `seed_specific_pack()`
