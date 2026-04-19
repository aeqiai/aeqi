# ADR-0003: Drop Legacy Event Columns

**Status:** Proposed (scheduled for v0.7.0 after seeder lands — task #124)
**Date:** 2026-04-19
**Supersedes:** N/A
**Related:** docs/design/unify-events-and-tool-calls.md, task #124 (seeder), task #126 (this ADR + migrations)

---

## Context

Events originally expressed "inject these ideas and run this query" through
four first-class columns on the `events` table:

| Column | Type | Purpose |
|---|---|---|
| `idea_ids` | `TEXT NOT NULL DEFAULT '[]'` | JSON array of idea UUIDs to inject verbatim |
| `query_template` | `TEXT` | Semantic search query with `{placeholder}` expansion |
| `query_top_k` | `INTEGER` | Top-k limit for the semantic search |
| `query_tag_filter` | `TEXT` | JSON string array restricting search to tagged ideas |

The tool-calls unification shipped on 2026-04-19
(docs/design/unify-events-and-tool-calls.md, Phase 2-3) replaced this with
`tool_calls: Vec<ToolCall>`, where the same behavior is expressed as named
tool calls:

```rust
// Legacy: inject idea + semantic search with tag filter
//   idea_ids: ["<uuid>"]
//   query_template: "skill promoted {quest_description}"
//   query_top_k: 5
//   query_tag_filter: ["promoted"]
//
// New: equivalent tool_calls
ToolCall { tool: "ideas.assemble", args: { "names": ["session:quest-start"] } }
ToolCall { tool: "ideas.search",   args: { "query": "skill promoted {quest_description}", "tags": ["promoted"], "top_k": 5 } }
```

Both paths currently coexist. In `idea_assembly.rs`, the dispatch gate is:

```rust
// Phase-2: dispatch tool_calls for events that have opted in.
// When tool_dispatch is Some, run the tools and append their output to parts.
// When tool_dispatch is None, warn and skip (Phase-1 fallback).
for event in &events_for_agent {
    if !event.tool_calls.is_empty() {
        // ... dispatch via ToolRegistry ...
        // Either dispatched or warned — skip legacy path either way.
        continue;
    }
    // Legacy path: static idea_ids.
    for idea_id in &event.idea_ids {
        if !idea_id.is_empty() && collected_idea_ids.insert(idea_id.clone()) {
            event_idea_ids.push(idea_id.clone());
        }
    }
}

// Dynamic query_template expansion → semantic search.
// Skip events that have opted into the new tool_calls path.
if let Some(store) = idea_store {
    for event in &events_for_agent {
        if !event.tool_calls.is_empty() {
            continue;
        }
        let Some(template) = event.query_template.as_deref() else {
            continue;
        };
        let expanded = expand_template(template, context);
        // ... hierarchical_search_with_tags ...
    }
}
```

The lifecycle seeder (`create_default_lifecycle_events` in `event_handler.rs`)
already writes both `tool_calls` and the legacy columns side by side for all 8
system events so that a revert to pre-unification code still works. The seeder
comment says:

> On every boot, both this *and* the legacy fields are written so rollback
> is a code revert (Phase 5 will drop the legacy columns).

A second legacy path exists in `daemon.rs` around `session:execution_start`,
which reads `ev.idea_ids` directly (not going through `assemble_ideas`). It
was not migrated in Phase 2-3 because `on_execution_start` ships with empty
`tool_calls` by design.

The four legacy columns are also surfaced in:
- `apps/ui/src/components/EventEditor.tsx` — the query fields section
- `apps/ui/src/lib/types.ts` — the `Event` TypeScript interface

## Decision

Drop the four legacy columns in v0.7.0, **after** task #124 (lifecycle event
seeder) has been shipped for at least one release cycle (v0.6.x), guaranteeing
every live install has `tool_calls` populated for all 8 system events.

A boot-time one-shot converter (migration 0001) runs in v0.6.x to also
backfill `tool_calls` for any user-created events that were configured only
via legacy columns. The DROP migration (0002) is committed but gated — it
must not run until the converter has been in the field.

## Migration plan

### v0.6.0 — current release

Legacy columns remain. The lifecycle seeder (task #124) populates `tool_calls`
for the 8 system events. Events with only legacy data continue to work via the
fallback code in `idea_assembly.rs` and `daemon.rs`.

### v0.6.x — converter migration (0001_convert_legacy_events.sql / Rust)

A boot-time one-shot migration:

1. Find every event where `tool_calls` is `'[]'` or NULL **and** at least one
   of `idea_ids`, `query_template` is non-empty.
2. Build the equivalent `tool_calls` JSON:
   - If `idea_ids` is non-empty → prepend an `ideas.assemble` call with `names`
     equal to the names resolved from the idea IDs (best-effort; falls back to
     IDs if names are unavailable).
   - If `query_template` is non-empty → append an `ideas.search` call with
     `query`, `top_k` (from `query_top_k`, default 5), and `tags` (from
     `query_tag_filter`).
3. Write the new `tool_calls` to the row. Idempotent — rows that already have
   `tool_calls` are untouched.
4. Log a count of rows converted.

Because SQLite lacks the procedural control needed to look up idea names from
IDs during a pure SQL migration, the converter is implemented as a Rust
function. The `.sql` file is a stub that marks the migration applied-in-code.
See `0001_convert_legacy_events.sql`.

### v0.7.0 — DROP migration (0002_drop_legacy_event_columns.sql.disabled)

Drops the four columns using `DROP COLUMN` (available since SQLite 3.35.0;
AEQI bundles SQLite 3.46.0 via `rusqlite = { features = ["bundled"] }`).

This migration file is committed with a `.disabled` extension so the migration
runner does not pick it up. Before applying:

1. Confirm task #124 seeder shipped in v0.6.x.
2. Confirm the converter migration ran on all target installs.
3. Rename the file to remove `.disabled`, wire into the migration runner,
   delete the fallback code in `idea_assembly.rs`, `daemon.rs`, and the legacy
   field sections in `EventEditor.tsx` / `types.ts`.

## Rollback

Downgrading from v0.7.0 to v0.6.x is **not supported** after the DROP
migration applies — the columns are gone. Operators who want to preserve the
rollback option must stay on v0.6.x until confident. If a rollback is required
after v0.7.0 is deployed, restore from a database backup taken before the
upgrade.

## Consequences

- `idea_assembly.rs` loses the legacy `idea_ids` path (~30 lines in
  `assemble_ideas_for_patterns`), the `query_template` expansion block
  (~50 lines), and the `expand_template` helper once no callers remain.
- `daemon.rs` loses the `session:execution_start` legacy `ev.idea_ids` read
  path (~40 lines).
- `event_handler.rs` loses the `idea_ids`, `query_template`, `query_top_k`,
  `query_tag_filter` fields from `Event` and `NewEvent`, the related
  serialisation in `row_to_event`, and the legacy columns from `INSERT` /
  `UPDATE` statements.
- `EventEditor.tsx` loses the legacy query field section (idea IDs textarea,
  query template input, top-k input, tag filter input).
- `apps/ui/src/lib/types.ts` loses the four optional legacy fields from the
  `Event` type.
- `ensure_event_columns` in `agent_registry.rs` loses the four `ALTER TABLE`
  guards — they add columns that no longer exist on the target schema.
- Schema becomes "one way to express what an event does" — the anti-magic
  principle applied to event storage.

## Alternatives considered

- **Keep forever:** continues to double the code paths and document a
  two-track system that is confusing to new contributors. Rejected.
- **Drop in v0.6.0 without converter:** breaks any install where a user
  configured an event using only legacy columns before the unification.
  Rejected.
- **Deprecate with log warnings but never drop:** same as "keep forever" in
  practice. The fallback code remains, the documentation burden remains, and
  future contributors have to understand both paths. Rejected.
- **12-step table rebuild instead of DROP COLUMN:** unnecessary — SQLite 3.35+
  supports `DROP COLUMN` natively, and AEQI bundles 3.46.0. Rejected in favour
  of the simpler form.
