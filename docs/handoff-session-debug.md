# Session Debug — Investigation & Fix Plan

## Issue 1: All sessions named "Permanent Session"

### Root Cause

Legacy migration at `session_store.rs:348-353`:
```sql
INSERT OR IGNORE INTO sessions (id, agent_id, session_type, name, status, created_at, closed_at)
SELECT id, agent_id, 'perpetual', 'Permanent Session', status, created_at, closed_at
FROM agent_sessions WHERE id NOT IN (SELECT id FROM sessions);
```

All sessions migrated from the old `agent_sessions` table get hardcoded name "Permanent Session". New sessions created via `create_session()` also don't get meaningful names — they receive whatever the caller passes (typically "web" or the session type).

### `first_message` is never stored

The `sessions` table has no `first_message` column. The frontend `SessionInfo` type expects it, and the API returns it as empty/null. The `sessionLabel()` function on the frontend falls through to `s.id.slice(0, 8)` for every session.

### Fix Plan

**Backend** (`session_store.rs`):

1. Add a `first_message` column to the sessions table:
```sql
ALTER TABLE sessions ADD COLUMN first_message TEXT DEFAULT '';
```
Add this to the migration block (around line 330).

2. In `record_by_session()` (line ~1020), when recording the first user message for a session, also update the session's `first_message`:
```rust
// After inserting the message, check if this is the first user message
if role == "user" {
    let _ = db.execute(
        "UPDATE sessions SET first_message = ?1 WHERE id = ?2 AND (first_message IS NULL OR first_message = '')",
        rusqlite::params![&content[..content.len().min(200)], session_id],
    );
}
```

3. In `list_sessions()` (line ~876), include `first_message` in the SELECT and the Session struct.

4. Auto-generate a display name from the first message. In the same update, derive a name:
```rust
// Derive name from first ~6 words of first message
let name = content.split_whitespace().take(6).collect::<Vec<_>>().join(" ");
let _ = db.execute(
    "UPDATE sessions SET name = ?1 WHERE id = ?2 AND (name = 'Permanent Session' OR name = '' OR name IS NULL)",
    rusqlite::params![&name, session_id],
);
```

**Frontend** (`AgentSessionView.tsx`):

The `sessionLabel()` function already handles this correctly — it checks `s.name`, then `s.first_message`, then falls back to ID. Once the backend populates these fields, the frontend will display them.

**Migration for existing sessions:**

Run a one-time migration that populates `first_message` from the first user message in `session_messages`:
```sql
UPDATE sessions SET first_message = (
    SELECT SUBSTR(content, 1, 200) FROM session_messages
    WHERE session_messages.session_id = sessions.id
    AND role = 'user' AND event_type = 'message'
    ORDER BY created_at ASC LIMIT 1
) WHERE first_message IS NULL OR first_message = '';

UPDATE sessions SET name = (
    SELECT GROUP_CONCAT(word, ' ') FROM (
        SELECT SUBSTR(content, 1, INSTR(content || ' ', ' ') - 1) as word
        FROM session_messages
        WHERE session_messages.session_id = sessions.id
        AND role = 'user' AND event_type = 'message'
        ORDER BY created_at ASC LIMIT 1
    )
) WHERE name = 'Permanent Session' OR name = '' OR name IS NULL;
```

(The name derivation via SQL is ugly — better to do it in Rust during the migration.)

---

## Issue 2: Agent session debug (session 7e8b5751)

### What happened

User prompt: "i want to see how good you are compared to claude code. lets develop aeqi itself"

The agent (running on deepseek-v3.2) spent 25 steps:
- Read orchestrator source files (8 read_file calls)
- Ran `aeqi setup` — created disk-based agent templates (leader, researcher, reviewer)
- Tried `aeqi chat --agent leader` — failed because the CLI tries to connect to the daemon's IPC socket, but the agent IS the daemon
- Got stuck debugging the socket connection

### Issues

1. **Wrong mental model**: The agent used CLI commands (`aeqi setup`, `aeqi chat`) instead of API tools. On the hosted platform, agents should be created via `agents_hire` tool, not via disk templates. The agent doesn't have visibility into which tools are available for agent management.

2. **Missing ideas tool**: The agent's tool list shows shell, read_file, write_file, edit_file, grep, glob, agents, quests, events, code, web — but no ideas/memory tool. This means agents can't store or recall knowledge.

3. **`aeqi setup` writes disk files**: The setup command creates `agents/leader/agent.md` etc. on disk. These are for self-hosted CLI mode. The hosted platform reads agents from the DB registry, not disk. The disk templates are ignored by the running daemon.

4. **Recursive CLI issue**: Running `aeqi chat` from inside an agent session tries to open an IPC connection to the daemon — but the agent IS running inside the daemon. This creates a circular dependency. The agent should use the `agents_delegate` tool instead.

5. **No completion recorded**: The 25-step execution didn't record an `assistant_complete` event. It may have timed out or been interrupted. Only the first trivial "ewrwerwe" message has a completion record (1 step, $0.0008).

### Fix Plan

1. **Register the ideas tool**: Ensure `ideas_store`, `ideas_recall`, `ideas_graph` are in the tool set for all agents.

2. **System prompt guidance**: Agent system prompts should mention "You are running inside the AEQI platform. Use your tools (agents, quests, events, ideas) to manage the system. Do NOT use CLI commands like `aeqi setup` or `aeqi chat`."

3. **Block recursive CLI**: Either remove shell access to `aeqi` binary, or have the binary detect it's inside a session and refuse.

---

## Files Referenced

- `crates/aeqi-orchestrator/src/session_store.rs` — session creation, listing, migration
- `crates/aeqi-orchestrator/src/ipc/sessions.rs` — session API handlers
- `apps/ui/src/components/AgentSessionView.tsx` — `sessionLabel()` function, `SessionInfo` type
