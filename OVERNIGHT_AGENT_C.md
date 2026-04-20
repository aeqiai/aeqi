# Stream C — Template Store Backend (handover)

**Branch:** `overnight/c-templates-backend`
**Status:** ready for D to consume; 6/6 template tests green; `cargo test --workspace` green at branch HEAD.
**Deadline met:** yes — delivered end-to-end (schema + 3 canonical JSONs + IPC + HTTP + handler + tests).

## API shapes (frozen for Stream D)

All responses follow the standard `{ ok: bool, ... }` envelope used elsewhere in AEQI.

### `GET /api/templates`
List the installed template catalog. Reads `presets/templates/*.json` on every
call (no caching, so Stream E / ops can drop new templates in without a
restart).

```jsonc
{
  "ok": true,
  "templates": [
    {
      "slug": "solo-founder",
      "name": "Solo Founder",
      "tagline": "One builder. One breathing company.",
      "description": "...",
      "root": {
        "name": "founder",
        "display_name": "Founder",
        "model": "anthropic/claude-sonnet-4.6",
        "color": "#3fae8c"
      },
      "agent_count": 1,   // root + seed_agents
      "event_count": 2,
      "idea_count": 4,
      "quest_count": 2
    }
    // ...
  ]
}
```

### `GET /api/templates/{slug}`
Full template detail, including every seed. This is what the "preview" pane in
the modal should render from.

```jsonc
{
  "ok": true,
  "template": {
    "slug": "solo-founder",
    "name": "Solo Founder",
    "tagline": "...",
    "description": "...",
    "root": { "name": "...", "display_name": "...", "model": "...", "color": "...", "avatar": null, "system_prompt": "..." },
    "seed_agents": [ { "owner": "root", "name": "...", ... } ],
    "seed_events": [ { "owner": "root", "name": "...", "pattern": "...", "cooldown_secs": 0, ... } ],
    "seed_ideas":  [ { "owner": "root", "name": "...", "content": "...", "tags": ["identity"] } ],
    "seed_quests": [ { "owner": "root", "subject": "...", "description": "...", "labels": [] } ]
  }
}
```

404 (`"code": "not_found"`) when slug is missing.

### `POST /api/templates/spawn`

Request:
```jsonc
{
  "template": "solo-founder",      // required; slug from the catalog
  "display_name": "My New Studio"  // optional; overrides template.root.display_name
}
```

Success response:
```jsonc
{
  "ok": true,
  "root_agent_id": "uuid",
  "root_agent_name": "founder",
  "spawned_agents": [
    { "id": "uuid-root", "name": "founder" },
    { "id": "uuid-child", "name": "editor" }
  ],
  "created_events": 2,
  "created_ideas": 4,
  "created_quests": 2,
  "warnings": [],                  // best-effort seeds; D may surface these softly
  "template": { "slug": "solo-founder", "name": "Solo Founder" }
}
```

Error response:
- `"code": "not_found"` + 404 when slug is missing.
- `"code": "conflict"` + 409 when an active agent with `template.root.name` already exists. D should catch this and offer to pick a different template or retire the existing one.
- Plain `{ok:false, error}` with 200 otherwise (unrecoverable — show a toast).

`warnings` is non-fatal — the spawn succeeded but one or more seeds could not
attach. Stream D should render them subtly (e.g. collapsed "3 warnings" chip
on the success modal) but still navigate to the new root agent.

## Template slugs shipping tonight

- `solo-founder` — single builder agent, weekly review event, 4 ideas (identity + brand + discovery + review), 2 seed quests.
- `studio` — 3 agents (Creative Director, Editor, Distribution), publishing cadence events, 4 ideas, 3 seed quests.
- `small-business` — 2 agents (Assistant, Web Publisher), weekly check-in + intake events, 4 ideas, 2 seed quests.

## Schema contract (on disk, under `presets/templates/*.json`)

```jsonc
{
  "slug": "unique-kebab-case",
  "name": "Human Name",
  "tagline": "One-line hook",
  "description": "Longer blurb",
  "root": {
    "name": "agent-name",               // becomes agent.name (unique per install)
    "display_name": "Display",
    "model": "anthropic/claude-sonnet-4.6",
    "color": "#3fae8c",
    "avatar": "/avatars/founder.svg",
    "system_prompt": "Persona body..."
  },
  "seed_agents": [ { "owner": "root", "name": "...", "display_name": "...", "model": "...", "color": "...", "system_prompt": "..." } ],
  "seed_events": [ { "owner": "root"|"<agent name>", "name": "...", "pattern": "session:start|schedule:...|...", "cooldown_secs": 0, "query_template": "...", "query_top_k": 5, "query_tag_filter": ["..."], "tool_calls": [] } ],
  "seed_ideas":  [ { "owner": "root"|"<agent name>", "name": "...", "content": "...", "tags": ["identity"] } ],
  "seed_quests": [ { "owner": "root"|"<agent name>", "subject": "...", "description": "...", "labels": [] } ]
}
```

Notes:
- `owner` resolves to the root agent OR any seed_agent by name (case-sensitive). Unknown owner → warning, seed skipped.
- `system_prompt` is persisted as an idea tagged `["identity", "evergreen"]` owned by that agent. No separate persona table. This plugs cleanly into the runtime's existing `assemble_ideas_for_pattern(session:start)` path so new agents get their persona on first breath.
- Seed idea tags default to `["fact"]` when omitted.
- Events require `agent_id`; `schedule:*` cannot be global (runtime constraint, enforced on create).
- Quests are created via `create_task_v2` so quest IDs follow the agent's `quest_prefix`.

## Files touched

- `presets/templates/solo-founder.json`
- `presets/templates/studio.json`
- `presets/templates/small-business.json`
- `crates/aeqi-orchestrator/src/ipc/templates.rs` (schema + load + spawn + 3 handlers + 6 tests)
- `crates/aeqi-orchestrator/src/ipc/mod.rs` (`pub mod templates;`)
- `crates/aeqi-orchestrator/src/daemon.rs` (wires `list_templates`, `template_detail`, `spawn_template` IPC commands)
- `crates/aeqi-orchestrator/src/agent_registry.rs` (adds `set_visual_identity` helper)
- `crates/aeqi-web/src/routes/templates.rs` (3 HTTP routes)
- `crates/aeqi-web/src/routes/mod.rs` (`mod templates;` + merge)

## Test status

`cargo test -p aeqi-orchestrator --lib ipc::templates` — 6/6 green:
- `load_templates_skips_non_json_and_bad_json`
- `spawn_template_creates_root_and_seeds_atomically`
- `spawn_template_tolerates_missing_idea_store`
- `spawn_template_warns_on_unknown_owner`
- `spawn_template_applies_override_display_name`
- `load_shipped_canonical_templates_parse_cleanly` — guards the three shipped JSONs against accidental breakage.

`cargo fmt` / `cargo clippy --workspace -- -D warnings` / `npx tsc --noEmit` / `npx prettier --check` all clean.

## Things Stream D should know

- The endpoint is idempotent **only** in the failure case: if the root name already exists you get 409 without mutating anything. There is no "merge into existing company" mode — by design.
- Ordering inside `spawn_template` is: root → seed_agents → seed_ideas (so identity ideas exist before events could reference them later) → seed_events → seed_quests. Tests pin this sequence.
- If the idea store is unavailable the spawn still succeeds; agents + events + quests land. Warning surfaced in `warnings[]`.
- The endpoint is behind the normal `Scope` extractor, so multi-tenant scoping flows through unchanged.
- Template dir override: `AEQI_TEMPLATES_DIR` env var (tests use it; ops can too).

## What I did NOT do (out of scope tonight)

- No pagination for `GET /api/templates` — catalog is tiny, load all.
- No nested seed_agents (grandchildren). Every seed_agent is a direct child of root.
- No in-place reload (e.g. hot-swapping a template JSON while the daemon runs) — reads from disk per call, so it already works; no fs-watcher.
- No auth-gated template authoring endpoints (upload / delete). Templates are on-disk artifacts managed by ops.

— Stream C, 2026-04-21 02:xx CEST
