# Quest ↔ Idea unification

**Branch:** `quest-idea-unification`
**Status:** Plan locked. Ready to execute.
**Owner:** TBD (currently CTO/founder; can hand off WS-1/2/3 to executors).

## Decision

A quest is editorial knowledge wrapped in execution lifecycle. Stop carrying both
on the quest. **Quest references one idea by FK; idea owns the editorial body;
quest owns the lifecycle.** The four W-primitives finally become orthogonal.

```
Idea = WHAT-the-spec-says     (knowledge — name + content + tags + scope)
Quest = HOW-the-work-runs      (lifecycle — status + priority + worktree + outcome)
Agent = WHO does it            (owner)
Event = WHEN it triggers       (clock + transport)
```

A quest body becomes literally an embedded `<IdeaCanvas>` rendering the linked
idea. Same Apple-Notes editing surface in both places. Wiki links flow across
primitives for free.

## Schema (target state)

### `ideas` (unchanged)

```sql
CREATE TABLE ideas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'self',
    agent_id TEXT,
    session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    -- … existing rich-idea columns (status, access_count, confidence, etc.)
);
```

Idea is the canonical source of "spec content."

### `quests` (refactored)

```sql
CREATE TABLE quests (
    id TEXT PRIMARY KEY,
    idea_id TEXT NOT NULL,                -- FK → ideas.id (app-enforced)
    agent_id TEXT,                        -- can match idea.agent_id, can diverge
    scope TEXT NOT NULL DEFAULT 'self',   -- can match idea.scope, can diverge
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'normal',
    depends_on TEXT NOT NULL DEFAULT '[]',
    worktree_branch TEXT,
    worktree_path TEXT,
    outcome TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    checkpoints TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT,
    closed_at TEXT,
    closed_reason TEXT,
    creator_session_id TEXT
);
CREATE INDEX idx_quests_idea ON quests(idea_id);
```

Columns dropped: **`subject`, `description`, `acceptance_criteria`, `labels`,
`idea_ids`** (5 fields, all editorial-shaped).

### Cross-database note

Ideas live in `aeqi.db`; quests live in `sessions.db`. SQLite can't enforce FK
across attached DBs without a `ATTACH DATABASE` dance. **Integrity is
application-side**:

- `delete_idea(id)` checks `SELECT 1 FROM quests WHERE idea_id = ?` first; blocks
  with `IdeaInUseError(quest_ids)` if any reference.
- `create_quest(...)` validates `idea_id` exists in `ideas` before insert.
- `get_quest(id)` joins via two reads (sessions.db quest, then aeqi.db idea); a
  small in-mem cache + the existing idea-by-id lookup keeps it cheap.

## API surface

### `POST /quests` — accepts both flows

```jsonc
// Flow A: create new idea + new quest atomically
{
    "idea": { "name": "...", "content": "...", "scope": "self", "agent_id": "..." },
    "status": "pending",
    "priority": "normal",
    "scope": "self",
    "depends_on": []
}

// Flow B: wrap existing idea
{
    "idea_id": "idea-abc",
    "status": "pending",
    "priority": "normal",
    "scope": "self"
}
```

Response: `{ ok: true, quest: {…}, idea: {…} }` — both records inline so the UI
can route immediately without a follow-up fetch.

### `PUT /quests/:id` — drops content fields

Only accepts `status / priority / depends_on / scope / agent_id / outcome /
worktree_path / worktree_branch / metadata`. Editorial changes go through the
idea API.

### `GET /quests/:id` — joins idea inline

```jsonc
{
    "id": "quest-xyz",
    "idea_id": "idea-abc",
    "idea": { "id": "idea-abc", "name": "...", "content": "...", "tags": [...] },
    "status": "in_progress",
    // … rest of quest fields
}
```

### `DELETE /ideas/:id` — gains pre-flight check

Returns `409 Conflict` with `{ error: "in_use", quest_ids: [...] }` if any
quest references the idea. Frontend surfaces "This idea is referenced by 3
quests. Detach or delete those first."

## Migration playbook

**Phases are reversible until phase 3.** Take a backup before phase 1.

### Phase 1 — additive (safe, deployable)

1. Backup `aeqi.db` and `sessions.db`.
2. Add nullable column: `ALTER TABLE quests ADD COLUMN idea_id TEXT`.
3. Backfill: for each quest, insert a new row into `ideas` (name = quest.subject,
   content = quest.description + '\n\n## Acceptance\n' + acceptance_criteria,
   tags = quest.labels split, scope = quest.scope, agent_id = quest.agent_id),
   then `UPDATE quests SET idea_id = ? WHERE id = ?`.
4. Verify: `SELECT COUNT(*) FROM quests WHERE idea_id IS NULL` → should be 0.
5. Add index: `CREATE INDEX idx_quests_idea ON quests(idea_id)`.

**Rollback:** drop the new idea rows (they have a synthetic `created_at` matching
the migration timestamp, easy to identify), drop the column, restore from backup
if anything went wrong.

### Phase 2 — cutover (API + UI flip)

1. Deploy backend that:
   - Reads `quest.idea_id` and joins idea on `GET /quests/:id`.
   - Accepts new `POST /quests` shape (both flows).
   - On `PUT /quests/:id`, ignores legacy content fields if sent (warn-and-drop,
     so old clients don't break).
   - Implements idea-delete pre-flight check.
2. Deploy frontend that:
   - New quest creation uses combobox (existing-idea picker + create-new
     fallback).
   - Quest detail body renders `<IdeaCanvas idea={linkedIdea} />`.
   - Quest detail saves go through idea API for content, quest API for lifecycle.
   - Idea detail gains `+ Track as quest` action.
3. Smoke: create new quest with new idea, edit body, check idea exists; create
   new quest from existing idea, check no duplicate idea created; delete idea
   that has quest, check 409.

### Phase 3 — cleanup (irreversible)

1. Drop columns from `quests`: `subject`, `description`, `acceptance_criteria`,
   `labels`, `idea_ids`.
2. SQLite `ALTER TABLE DROP COLUMN` requires the table-rebuild dance —
   create-new-table + INSERT-SELECT + DROP-old + RENAME. One-shot script.
3. Make `quests.idea_id NOT NULL` (deferred from phase 1 because of intermediate
   nulls during migration).
4. Drop the legacy `quests.idea_ids` JSON array — `[[wiki-links]]` inside the
   idea body now carry the cross-references.

## Frontend changes

### New components / changes

- **`<MarkdownEditor>` primitive** — already extracted in spirit (IdeaCanvas
  body); promote to `components/ui/` so both surfaces import the same React
  component. Title input + textarea/render toggle + ideasIndex prop for wiki
  link resolution.
- **`<NewQuestModal>` (refactor)** — subject input becomes combobox, results
  show existing ideas (with `· N quests` annotation), bottom row offers
  "+ Create new idea". Two-path submission.
- **`<QuestDetail>` body** — replace `<textarea>` description with
  `<IdeaCanvas idea={linkedIdea} />`. Header keeps canonical toolbar
  (Status / Priority / Scope / Cancel-Save when dirty).
- **Idea detail `+ Track as quest`** — secondary button in the detail
  toolbar's right cluster. Opens NewQuestModal pre-filled with idea_id.
- **Shared-spec badge** — small badge in quest detail when the linked idea
  has multiple quests: `Shared spec · 3 quests`.
- **Idea delete UX** — when user deletes idea referenced by quests, surface
  the conflict with quest links: "Used by [3 quests]. Delete those first?"

### Open UX questions (resolved)

- Editing the body inside quest detail edits the underlying idea? **YES.**
  Add the `Shared spec · N quests` badge so the user knows the edit ripples.
  Strict-read-only mode is a future setting if anyone asks.
- `+ New` from idea detail header? **Stays as-is** (creates a new idea).
  `+ Track as quest` is a separate button for the promote flow.
- Quest title in the header on scroll? **Skip for MVP.** Body title is one
  scroll up; deferred until corpus shows it's needed.

## Workstreams

| WS | Owner | Description | Acceptance |
| -- | ----- | ----------- | ---------- |
| WS-1 | backend | Schema migration phase 1 (additive, backfill) | Every existing quest has a non-null `idea_id`; corresponding idea rows exist with content concatenated from subject+description+acceptance_criteria; `cargo test` green |
| WS-2 | backend | API surface — `POST /quests` two-flow, `GET /quests/:id` joined, `DELETE /ideas/:id` pre-flight, `PUT /quests/:id` content-field allowlist | Integration tests cover both flow A and B; idea-delete-with-quest returns 409 with quest_ids; legacy clients sending subject/description on PUT get warn-logged, ignored |
| WS-3 | frontend | Types + agentDataStore — Quest type drops content fields, gains `idea_id` and inline `idea`; store fetches idea alongside quest | tsc green; existing quest-list / quest-detail render still works |
| WS-4 | frontend | Quest detail rewrite — body becomes `<IdeaCanvas>`, header keeps canonical toolbar, save state mirrors Idea detail | Quest detail looks visually like Idea detail; editing body autosaves to idea endpoint; status/priority/scope still in header |
| WS-5 | frontend | New-quest modal refactor — combobox over agent's ideas + create-new fallback | "Create new" path creates idea+quest; "Use existing" path creates only quest pointing at existing idea_id |
| WS-6 | frontend | Idea detail `+ Track as quest` action | Click → opens NewQuestModal pre-filled; saves create only the quest record |
| WS-7 | polish | Shared-spec badge, idea-delete conflict UI, edge case: linked idea unavailable | Visible badge when quest count > 1; conflict modal lists referencing quests; placeholder when idea row missing |
| WS-8 | cleanup | Schema migration phase 3 (drop columns, NOT NULL, drop idea_ids[]) | New schema matches the canonical shape; backfill artifacts removed |

WS-1 → WS-2 → (WS-3 ‖ WS-4) → (WS-5 ‖ WS-6) → WS-7 → WS-8. WS-3 and WS-4 can run
in parallel after WS-2; same for WS-5/6 after WS-4.

## Acceptance criteria (full system)

- Create quest with new idea: idea exists, quest exists, both linked.
- Create quest from existing idea: quest exists, no duplicate idea.
- Edit quest body: idea content updates, quest's `updated_at` ticks.
- Edit quest status: quest record updates, idea unchanged.
- Wiki-link inside quest body resolves to a sibling idea (same engine as ideas).
- Idea referenced by quest: delete blocked, conflict UI surfaces quest links.
- Idea NOT referenced by quest: delete works, no orphans.
- Promote idea → quest: existing idea unchanged, new quest record created.
- Shared-spec badge appears when the linked idea has >1 referencing quest.
- Existing data after migration: every old quest's body is readable in the new
  shape (subject → idea name, description+acceptance → idea content,
  labels → idea tags).

## Risks / mitigations

- **Cross-DB FK can't be enforced.** App-side validation only. Mitigated by
  centralizing all writes through the same handlers (no raw SQL from random
  code paths). Tests check the validation, not the DB constraint.
- **Migration of corrupt rows.** Quests with NULL subject or NULL description
  exist in older fixtures. Migration script defaults missing fields to
  empty strings + logs a warning per row.
- **Phase 2 deploy with old clients.** Old UI sends subject/description on PUT;
  we warn-and-drop those fields server-side rather than rejecting, so clients
  don't break mid-rollout. Drop the warn-and-drop after phase 3.
- **Multi-quest body edits surprise users.** Mitigated by the `Shared spec ·
  N quests` badge + the combobox annotation `auth-pattern · 3 quests`.

## What I'm doing first

Tonight: this brief is committed to `quest-idea-unification` branch.
Tomorrow: WS-1 (schema migration phase 1) — additive only, no UI yet, fully
reversible. Once that's green and deployed, WS-2 follows, then UI in parallel.
