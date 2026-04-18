# Context Injection Model

How an agent's input context is assembled when it wakes on a quest.

---

## 1. The two context channels

An agent sees context through exactly two paths:

**System prompt** (static for the session lifetime):
- Assembled from the agent ancestor chain by walking events that match the target pattern (e.g. `session:start`) and pulling their referenced ideas
- Walk order: root ancestor → ... → parent → self → task ideas; each idea's `scope` (`self` vs `descendants`) controls whether an ancestor's idea reaches the target agent
- Tool allow/deny lists on activated ideas merge into the session's tool restrictions (intersection of allows, union of denies)
- This is the agent's identity, inherited instructions, and role definition

**User message** (the first message in the conversation — the "quest context"):
- Built by `AgentWorker::execute()` at spawn time
- This is where all dynamic, quest-specific context lives

Everything in this document concerns the **user message** — the quest context payload that tells the agent what to do, what's happened, and what it needs to know.

---

## 2. What gets injected automatically

The quest context is assembled in layers. Each layer has a token budget. Layers are ordered from most important to least important so that truncation removes the least valuable context first (from the bottom).

### Layer 1: Quest Identity (always injected, ~200 tokens)

```
## Quest: sg-001 — Build auth module

Implement JWT-based authentication with refresh token rotation.

Quest ID: sg-001
Priority: high
Agent: engineer
```

Source: `quest.name`, `quest.description`, `quest.id`, `quest.priority`, `quest.agent_id`

### Layer 2: Acceptance Criteria (if defined, ~200 tokens)

```
## Acceptance Criteria

- JWT access tokens expire in 15 minutes
- Refresh tokens stored in httponly cookies
- Token rotation on every refresh
- Rate limiting on auth endpoints

Verify your work meets these criteria before marking as DONE.
```

Source: `quest.acceptance_criteria`

### Layer 3: Quest Tree Context (new — the core of this design)

This is the layer that doesn't exist yet. It answers: what has happened around this quest in the tree?

```
## Quest Tree

sg-001  Build auth module [IN_PROGRESS] ← you are here
├── sg-001.1  Design token schema [DONE] "Chose JWT with RS256, schema in auth/types.ts"
├── sg-001.2  Implement login endpoint [DONE] "POST /auth/login returns access+refresh pair"
├── sg-001.3  Implement refresh endpoint [PENDING]
└── sg-001.4  Add rate limiting [PENDING]
```

What gets included:

| Relationship | Included? | Detail level |
|---|---|---|
| **Self** | Always | Full description, status |
| **Children** | Always | ID, name, status, outcome_summary (one line) |
| **Parent** | Always | ID, name, status, description (truncated to 200 chars) |
| **Siblings** | Done siblings only | ID, name, outcome_summary (one line) |
| **Grandchildren** | Never auto-injected | Agent uses `recall` if needed |
| **Grandparent+** | Never auto-injected | Already in system prompt via ancestor prompts |

The rule: **one level down (children), one level up (parent), one level sideways (done siblings)**. No deeper. This keeps the tree context bounded regardless of tree depth.

### Layer 4: Previous Attempts / Checkpoints (if retry, budget-controlled)

```
## Previous Attempts

### Attempt 1 (by engineer:sg-001:1743900000, 12 turns, $0.0847)
Implemented basic JWT signing but hit a dependency conflict with jsonwebtoken 9.x.
The auth middleware compiles but refresh rotation is not wired up.

### Attempt 2 (by engineer:sg-001:1743910000, 8 turns, $0.0523)
Resolved dependency conflict. Login endpoint works. Failed on refresh —
the cookie domain config is wrong for local dev.

Review the above before starting. Skip work that's already done.
```

Source: `quest.checkpoints` array, formatted by `ContextBudget::budget_checkpoints()`.
Already implemented. Recent attempts shown verbatim, old ones summarized to one line each.

### Layer 5: External Checkpoint (git state, if exists)

```
## External Checkpoint (git state capture)

**Branch:** `feat/auth-module`
**Last commit:** `a3f2c91`
**Captured at:** 2026-04-05T18:32:00Z

**Modified files (3):**
- `src/auth/middleware.rs`
- `src/auth/tokens.rs`
- `Cargo.toml`

**Worker's last notes:**
Refresh rotation logic is in tokens.rs but untested.

Verify the current state of these files before building on them.
The previous worker may have been interrupted.
```

Source: `AgentCheckpoint::as_context()`. Already implemented.

### Layer 6: Resume Brief (audit trail + dispatches)

```
## Resume Brief

### Audit trail
- 2026-04-05 17:45:00 UTC [WorkerFailed] Dependency conflict with jsonwebtoken 9.x
- 2026-04-05 18:30:00 UTC [WorkerHandoff] Cookie domain misconfiguration

### Control plane
- DELEGATE_REQUEST from shadow → engineer: "Handle the auth module"
- DELEGATE_RESPONSE from engineer → shadow: "Login endpoint done, refresh WIP"

Use this to avoid repeating earlier failures or redundant work.
```

Source: `build_resume_brief()` — queries EventStore for decisions and dispatches. Already implemented.

### Layer 7: Dynamic Idea Recall (~30 results, auto-queried)

```
## Dynamic Recall
- [engineer] auth-jwt-pattern: Use RS256 for JWT signing, store public key in /auth/keys
- [global] project-stack: Rust backend with Axum, React frontend
- [engineer] auth-cookie-policy: Set cookie domain to `.localhost` for local dev
```

Source: `IdeaStore::search()` via QueryPlanner. Already implemented. Searches both domain-scoped and entity-scoped ideas using the quest context as the query.

---

## 3. Quest tree formatting — the new layer

### The query

One SQL query fetches everything needed for Layer 3:

```sql
-- Given quest_id = 'sg-001':

-- 1. Self (already have from quest_snapshot)

-- 2. Parent quest (by ID prefix)
SELECT id, name, status, description, metadata
FROM quests WHERE id = :parent_id;

-- 3. Children
SELECT id, name, status, metadata
FROM quests WHERE id LIKE :quest_id || '.%'
  AND id NOT LIKE :quest_id || '.%.%'  -- direct children only, not grandchildren
ORDER BY id ASC;

-- 4. Siblings (done only, same parent prefix)
SELECT id, name, status, metadata
FROM quests WHERE id LIKE :parent_id || '.%'
  AND id NOT LIKE :parent_id || '.%.%'  -- direct children of parent only
  AND id != :quest_id
  AND status = 'done'
ORDER BY id ASC;
```

The hierarchical quest IDs (`sg-001`, `sg-001.1`, `sg-001.1.3`) make tree queries trivial with LIKE patterns. No recursive CTEs needed.

### Rendering

```rust
fn render_quest_tree(
    self_quest: &Quest,
    parent: Option<&Quest>,
    children: &[Quest],
    done_siblings: &[Quest],
) -> String {
    let mut out = String::from("## Quest Tree\n\n");

    // Parent context (if exists)
    if let Some(p) = parent {
        let desc = truncate(&p.description, 200);
        out += &format!(
            "{} {} [{}]{}\n",
            p.id, p.name, p.status,
            if desc.is_empty() { String::new() } else { format!(" — {desc}") }
        );
    }

    // Self
    out += &format!("  {} {} [{}] <-- current quest\n", self_quest.id, self_quest.name, self_quest.status);

    // Done siblings (before self in tree order)
    for sib in done_siblings {
        let summary = sib.outcome_summary().unwrap_or_default();
        let line = if summary.is_empty() {
            format!("  {} {} [DONE]\n", sib.id, sib.name)
        } else {
            format!("  {} {} [DONE] \"{}\"\n", sib.id, sib.name, truncate(&summary, 120))
        };
        out += &line;
    }

    // Children
    for child in children {
        let prefix = if child == children.last().unwrap() { "└──" } else { "├──" };
        let summary = child.outcome_summary().unwrap_or_default();
        let status_str = child.status.to_string().to_uppercase();
        let line = if summary.is_empty() || child.status != QuestStatus::Done {
            format!("    {prefix} {} {} [{status_str}]\n", child.id, child.name)
        } else {
            format!("    {prefix} {} {} [{status_str}] \"{}\"\n", child.id, child.name, truncate(&summary, 120))
        };
        out += &line;
    }

    out
}
```

### Token budget for tree context

| Component | Max tokens | Strategy when exceeded |
|---|---|---|
| Parent | 100 | Truncate description |
| Self | 100 | Always fits |
| Children (up to 20) | 50 each, 1000 total | Truncate outcome summaries, then omit oldest done children |
| Done siblings (up to 10) | 50 each, 500 total | Truncate outcome summaries, then omit oldest |
| **Total Layer 3** | **~1700** | Hard cap, prioritize children over siblings |

If there are more than 20 children or 10 done siblings, the rendering function keeps the most recent N and adds a count line:

```
    ... and 12 more completed children (use recall for details)
```

---

## 4. The six scenarios resolved

### Scenario 1: Fresh quest, no history

Agent wakes on `sg-001: Build auth module` for the first time.

**Injected:**
- Layer 1: Quest identity (name, description, priority)
- Layer 2: Acceptance criteria (if defined)
- Layer 3: Quest tree — parent quest context + any done siblings showing what's already been built
- Layer 7: Dynamic memory recall (searches memories relevant to "build auth module")

**Not injected (nothing to inject):**
- Layers 4-6: No checkpoints, no checkpoint file, no resume brief (first attempt)

Total: ~500-2000 tokens depending on memory recall results. Clean, focused.

### Scenario 2: Quest with completed children

Agent wakes on `sg-001` which has children sg-001.1 (Done) and sg-001.2 (Done).

**Injected:**
```
## Quest Tree

sg-001  Build auth module [IN_PROGRESS] <-- current quest
    ├── sg-001.1  Design token schema [DONE] "Chose JWT with RS256, schema in auth/types.ts"
    └── sg-001.2  Implement login endpoint [DONE] "POST /auth/login works, tests pass"
```

Children's `outcome_summary()` (the one-line summary from `QuestOutcomeRecord`) is injected directly. Grandchildren are NOT injected — the child's outcome summary should capture what matters. If the agent needs detail on a grandchild, it calls `recall`.

**Why this works:** The outcome summary is written by the agent that completed the child quest. That agent had full context on what it did. The summary is the distilled result. Injecting grandchildren would add noise without adding signal for 95% of cases.

### Scenario 3: Resumed session

Session-847 was working on sg-001, created sg-001.3, stopped with HANDOFF. sg-001.3 completes. Session-847 resumes.

**This is the hardest case.** There are two sub-cases:

#### 3a: Stateless resume (new worker, no conversation history)

AEQI workers are ephemeral. "Resume" means a new worker spawns on the same quest. The new worker gets the full context injection as described above, which now includes:

- Layer 3: Quest tree showing sg-001.3 as Done with its outcome
- Layer 4: Checkpoint from Session-847's prior work (what it did before handoff)
- Layer 5: External checkpoint (git state when Session-847 stopped)
- Layer 6: Resume brief (audit trail showing the handoff event)

The new worker never had a conversation, so there's no "re-injection" problem. It starts fresh with complete context.

#### 3b: Stateful resume (persistent session, conversation continues)

For persistent sessions (via `SessionManager`), the agent's conversation history is already in memory. When the session resumes after sg-001.3 completes, inject a **delta message** — a new user message appended to the existing conversation:

```
## Child Quest Completed

sg-001.3 "Implement refresh endpoint" completed:
  Status: DONE
  Summary: "Refresh rotation implemented with cookie-based storage. Tests pass."
  
Updated quest tree:
  sg-001.1 Design token schema [DONE]
  sg-001.2 Implement login endpoint [DONE]
  sg-001.3 Implement refresh endpoint [DONE] <-- just completed
  sg-001.4 Add rate limiting [PENDING]
```

**What's NOT re-injected:** The original quest description, acceptance criteria, parent context, memory recall. The agent already has all of that in its conversation history.

**How we avoid re-injection:** The delta message only contains:
1. What changed since the session last acted (completed child quest + its outcome)
2. The updated quest tree snapshot (compact, ~200 tokens)

This is implemented as a new `SessionInput` variant injected via the session's `input_tx` channel when the scheduler detects a child completion for a handed-off parent.

### Scenario 4: Quest with many siblings

Agent wakes on sg-001.5. Siblings sg-001.1 through sg-001.4 are all Done.

**Injected in Layer 3:**
```
## Quest Tree

sg-001  Build auth module [IN_PROGRESS]
  sg-001.1  Design token schema [DONE] "JWT with RS256"
  sg-001.2  Implement login endpoint [DONE] "POST /auth/login"
  sg-001.3  Implement refresh endpoint [DONE] "Cookie-based refresh rotation"
  sg-001.4  Add rate limiting [DONE] "Token bucket at 100 req/min on /auth/*"
  sg-001.5  Write integration tests [IN_PROGRESS] <-- current quest
```

Only done siblings are shown. In-progress or pending siblings are omitted because:
1. Their state is incomplete and would be misleading
2. The current agent shouldn't need to coordinate with parallel work — that's the parent's job
3. If coordination IS needed, it happens through shared memory (recall/remember)

**When there are 15+ done siblings:** Show the 8 most recent, summarize the rest:

```
  ... 7 earlier siblings completed (token-schema, login, signup, logout, password-reset, ...)
  sg-001.8  Session management [DONE] "Redis-backed sessions with sliding expiry"
  ...
```

### Scenario 5: Deep tree

`sg-001 -> sg-001.1 -> sg-001.1.1 -> sg-001.1.1.1`

Agent wakes on the leaf `sg-001.1.1.1`.

**Injected:**
- System prompt: Contains inherited prompts from ALL ancestors (root -> sg-001's agent -> sg-001.1's agent -> ...) via `assemble_prompts()`. This is already implemented.
- Layer 1: Quest identity for sg-001.1.1.1
- Layer 3: Quest tree with ONE level up (parent sg-001.1.1) and its done children (siblings of sg-001.1.1.1)

**NOT injected:**
- Grandparent sg-001.1 or great-grandparent sg-001: Their prompts are already in the system prompt via inheritance. Their quest descriptions are not relevant at this depth — the parent's description should provide sufficient scoping.

**Why only one level up works:** Each quest's description should capture the relevant context from its parent. When sg-001.1.1 was created, it was created with a description that incorporated what the creating agent knew about sg-001.1. Context flows DOWN through quest descriptions at creation time, not UP through injection at execution time.

If the leaf agent needs broader context, it calls `recall`, which searches the full memory tree (entity memories for self, then ancestor agents' memories, up to root). The memory system already walks the agent tree for scoping.

### Scenario 6: Failed/retried quest

Quest sg-001.2 failed twice (2 checkpoints), now on attempt 3.

**Injected (Layer 4):**
```
## Previous Attempts

### Attempt 1 (by engineer:sg-001.2:1743900000, 12 turns, $0.0847)
Implemented basic JWT signing but hit a dependency conflict with jsonwebtoken 9.x.
The auth middleware compiles but refresh rotation is not wired up.

### Attempt 2 (by engineer:sg-001.2:1743910000, 8 turns, $0.0523)
Resolved dependency conflict. Login endpoint works. Failed on refresh —
the cookie domain config is wrong for local dev.

Review the above before starting. Skip work that's already done.
```

**Also injected (Layer 5, external checkpoint):**
```
## External Checkpoint (git state capture)
**Branch:** `feat/auth-module`
**Last commit:** `a3f2c91`
**Modified files (3):** src/auth/middleware.rs, src/auth/tokens.rs, Cargo.toml
**Worker's last notes:** Cookie domain issue — needs `.localhost` for local dev
```

**Also injected (Layer 6, resume brief):**
```
## Resume Brief
### Audit trail
- 2026-04-05 17:45 [WorkerFailed] jsonwebtoken 9.x dep conflict
- 2026-04-05 18:30 [WorkerFailed] Cookie domain misconfigured
```

**Formatting for usefulness, not noise:**
- The `ContextBudget::budget_checkpoints()` function already handles this well: recent attempts shown in full, old ones collapsed to single lines
- The external checkpoint (git state) provides ground truth independent of the agent's self-report
- The resume brief gives the decision audit trail so the agent knows WHY previous attempts failed, not just WHAT they tried
- Combined, these three layers give the agent a clear picture: what was tried, what failed, where the code is now

**When there are 10+ retries** (pathological case):
- Most recent 3-5 checkpoints shown verbatim (configurable via `max_checkpoint_count`)
- Older ones collapsed to one-line summaries
- Total budget: 8000 chars (~2000 tokens) for all checkpoint content
- If still over budget, oldest summaries are dropped entirely

---

## 5. Token budget allocation

Total budget for the quest context user message: ~4000 tokens (16,000 chars).
This leaves the vast majority of the context window for the system prompt (agent identity, inherited instructions) and the actual work conversation.

| Layer | Budget (chars) | Budget (approx tokens) |
|---|---|---|
| 1. Quest Identity | 800 | 200 |
| 2. Acceptance Criteria | 800 | 200 |
| 3. Quest Tree | 6800 | 1700 |
| 4. Previous Attempts | 8000 | 2000 |
| 5. External Checkpoint | 2000 | 500 |
| 6. Resume Brief | 4000 | 1000 |
| 7. Dynamic Recall | 6000 | 1500 |
| **Subtotal** | **28400** | **~7100** |
| **Applied total cap** | **16000** | **~4000** |

When the total exceeds the cap, layers are truncated bottom-up:
1. Dynamic Recall results reduced (fewer results)
2. Resume Brief truncated
3. External Checkpoint truncated
4. Previous Attempts reduced (fewer verbatim, more summarized)
5. Quest Tree children/siblings reduced
6. Quest Identity and Acceptance Criteria are never truncated

This is implemented as a budget-aware rendering pipeline, not a flat string truncation.

---

## 6. What the agent must recall manually

Anything beyond the one-level tree window requires the agent to call `recall`:

- Grandchild quest details (child's children)
- Non-done sibling details (in-progress or pending siblings)
- Ancestor quest descriptions (grandparent and above)
- Cross-project knowledge
- Historical session transcripts
- Code graph context (what files are related to this quest)

The agent has 4 tools for this: `create_quest`, `close_quest`, `recall`, `remember`.
The `recall` tool searches the idea store, which includes:
- Domain ideas (workspace-level knowledge)
- Entity ideas (this agent's personal knowledge across sessions)
- Shared ideas (sibling-visible, from `remember` with scope=shared)

---

## 7. Exact prompt structure

Here is the complete text an agent sees when it wakes on a retried quest with children:

### System prompt (assembled by `assemble_prompts`):

```
[Root agent primer — inherited, scope=descendants]
You are part of the AEQI agent system. Follow quest instructions precisely.
Report outcomes clearly.

---

[Parent agent primer — inherited, scope=descendants]  
This is the auth-service project. Stack: Rust + Axum. Repo: /home/dev/auth-service.

---

[Self agent system prompt — scope=self]
You are an engineer agent. You write production code, tests, and documentation.
When done, use close_quest with a clear summary of what you built.
When blocked, use close_quest with status=blocked and explain what you need.
When creating sub-quests, use create_quest with clear descriptions.

---

## Dynamic Idea Recall
- [engineer] auth-jwt-pattern: Use RS256 for JWT signing, public key at /auth/keys
- [global] rust-axum-patterns: Use extractors for auth, tower middleware for rate limiting
- [engineer] cookie-policy: Set domain=.localhost for local dev, secure=true in prod
```

### First user message (the quest context):

```
## Quest: sg-001.2 — Implement login endpoint

Build the POST /auth/login endpoint that validates credentials and returns
a JWT access token + refresh token pair.

Quest ID: sg-001.2
Priority: high

## Acceptance Criteria

- Returns 200 with { access_token, refresh_token } on valid credentials
- Returns 401 with error message on invalid credentials
- Access token expires in 15 minutes
- Refresh token stored as httponly cookie
- Passwords verified with argon2

## Quest Tree

sg-001  Build auth module [IN_PROGRESS]
  sg-001.1  Design token schema [DONE] "JWT with RS256, schema in auth/types.ts"
  sg-001.2  Implement login endpoint [IN_PROGRESS] <-- current quest (attempt 3)
    ├── sg-001.2.1  Implement credential validation [DONE] "Argon2 verify in auth/password.rs"
    └── sg-001.2.2  Implement token generation [DONE] "RS256 signing in auth/tokens.rs"
  sg-001.3  Implement refresh endpoint [PENDING]
  sg-001.4  Add rate limiting [PENDING]

## Previous Attempts

### Attempt 1 (by engineer:sg-001.2:1743900000, 12 turns, $0.0847)
Implemented basic JWT signing but hit a dependency conflict with jsonwebtoken 9.x.
The auth middleware compiles but the endpoint handler is incomplete.

### Attempt 2 (by engineer:sg-001.2:1743910000, 8 turns, $0.0523)
Resolved dependency conflict by pinning jsonwebtoken to 8.3. Login endpoint
returns tokens but cookie domain is wrong for local dev. Tests fail on
refresh token extraction.

Review the above before starting. Skip work that's already done.

## External Checkpoint (git state capture)

**Branch:** `feat/auth-login`
**Last commit:** `a3f2c91`
**Captured at:** 2026-04-05T18:32:00Z

**Modified files (4):**
- `src/auth/handler.rs`
- `src/auth/tokens.rs`
- `src/auth/password.rs`
- `Cargo.toml`

**Worker's last notes:**
Login handler compiles. Cookie domain needs to be `.localhost` for local dev.
The test in tests/auth_test.rs is the one that fails.

Verify the current state of these files before building on them.
The previous worker may have been interrupted.

## Resume Brief

### Audit trail
- 2026-04-05 17:45:00 UTC [WorkerFailed] Dependency conflict with jsonwebtoken 9.x
- 2026-04-05 18:30:00 UTC [WorkerHandoff] Cookie domain misconfiguration, tests failing

Use this to avoid repeating earlier failures or redundant work.
```

---

## 8. Implementation plan

### New function: `build_quest_tree_context`

Location: `crates/aeqi-orchestrator/src/agent_worker.rs` (or a new `quest_context.rs` module)

```rust
async fn build_quest_tree_context(
    registry: &AgentRegistry,
    quest: &Quest,
) -> String {
    let mut out = String::from("## Quest Tree\n\n");

    // 1. Get parent quest (parse parent ID from quest.id)
    let parent_id = quest.id.parent();
    let parent = if let Some(ref pid) = parent_id {
        registry.get_quest(&pid.0).await.ok().flatten()
    } else {
        None
    };

    // 2. Get children (quests whose ID starts with "{quest.id}." but no further dots)
    let children = registry.list_quests_by_prefix(&quest.id.0).await
        .unwrap_or_default()
        .into_iter()
        .filter(|q| q.id.0.starts_with(&format!("{}.", quest.id.0))
            && !q.id.0[quest.id.0.len()+1..].contains('.'))
        .collect::<Vec<_>>();

    // 3. Get done siblings
    let done_siblings = if let Some(ref pid) = parent_id {
        registry.list_quests_by_prefix(&pid.0).await
            .unwrap_or_default()
            .into_iter()
            .filter(|q| q.id != quest.id
                && q.id.0.starts_with(&format!("{}.", pid.0))
                && !q.id.0[pid.0.len()+1..].contains('.')
                && q.status == QuestStatus::Done)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };

    // 4. Render (with truncation budgets)
    render_quest_tree(&quest, parent.as_ref(), &children, &done_siblings)
}
```

### New method on AgentRegistry: `list_quests_by_prefix`

```rust
pub async fn list_quests_by_prefix(&self, prefix: &str) -> Result<Vec<Quest>> {
    let db = self.db.lock().await;
    let pattern = format!("{prefix}.%");
    let mut stmt = db.prepare(
        "SELECT * FROM quests WHERE id LIKE ?1 ORDER BY id ASC"
    )?;
    let quests = stmt.query_map(params![pattern], |row| Ok(row_to_quest(row)))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(quests)
}
```

### Integration point in `AgentWorker::execute()`

Insert between the current quest description building (line ~519) and the resume brief (line ~549):

```rust
// After building basic quest_context from quest snapshot...

// Layer 3: Quest tree context
let tree_context = build_quest_tree_context(&self.agent_registry, &quest).await;
if !tree_context.is_empty() {
    quest_context.push_str(&tree_context);
}
```

### Delta injection for resumed sessions

Add a method to `SessionManager`:

```rust
pub async fn inject_child_completion(
    &self,
    parent_quest_id: &str,
    completed_child: &Quest,
    updated_tree_snapshot: &str,
) {
    // Find the running session for this parent quest
    if let Some(session) = self.find_session_for_quest(parent_quest_id) {
        let delta = format!(
            "## Child Quest Completed\n\n\
             {} \"{}\" completed:\n  \
             Status: DONE\n  \
             Summary: \"{}\"\n\n\
             Updated quest tree:\n{}",
            completed_child.id,
            completed_child.name,
            completed_child.outcome_summary().unwrap_or_default(),
            updated_tree_snapshot,
        );
        let _ = session.input_tx.send(SessionInput::text(&delta));
    }
}
```

This gets called from the scheduler's `reap()` when a child quest completes and the parent quest is in HANDOFF state with a live session.
