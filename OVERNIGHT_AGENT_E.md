# Stream E — Seed Ideas + Proactive Baseline

Branch: `overnight/e-seed-ideas`
Deadline: 07:00 CEST 2026-04-21
Status: shipped

## What shipped

1. **Seven preset idea files** at `presets/seed_ideas/*.md` — frontmatter `{name, tags, description}` + markdown body. Each is discoverable via `ideas(action='search', tags=['skill'])`.
2. **Preset seeder module** `crates/aeqi-orchestrator/src/preset_seeder.rs` — locates the preset dir, inserts-if-absent into the global idea store, purges the magical-loli junk pack.
3. **First-boot wiring** in `aeqi-cli/src/cmd/daemon.rs` (line 387-410) — runs after `seed_lifecycle_events`. Silent success when no new rows; warns on errors.
4. **Standalone CLI command** `aeqi seed [--reset-identities]` — idempotent re-seed without the daemon; `--reset-identities` purges test junk first.
5. **Proactive baseline** — both the global `session:start` idea content and `agents/leader/agent.md` now direct the agent through the four-primitive workflow (search → capture → quest → automate → delegate → evolve), with explicit skill references.
6. **Magical-loli purge** — wired into `aeqi seed --reset-identities`. Already ran against the dev DB (5 ideas cleared in a prior iteration; re-running is a clean no-op).

## Seed idea library

| File | Name (slug) | Summary |
|------|-------------|---------|
| `vanilla-identity-assistant.md` | `vanilla-assistant` | Baseline identity: four primitives + five operating principles + proactive-voice contract. |
| `how-to-create-an-idea.md` | `create-idea` | Tool shape, good-slug conventions, tag taxonomy, when-to-store vs not. |
| `how-to-create-a-quest.md` | `create-quest` | Tool + CLI shapes, quest quality rubric, assign-vs-do, close semantics. |
| `how-to-create-an-event.md` | `create-event` | Pattern vocabulary (lifecycle + schedule + middleware + webhook), tool-call shapes, global-vs-scoped, worked cron example. |
| `how-to-spawn-a-subagent.md` | `spawn-subagent` | Persistent vs ephemeral, parent/child mechanics, when-not-to-spawn. |
| `how-to-manage-tools.md` | `manage-tools` | Allow/deny semantics, ancestor merge, three practical scopes, observability hook. |
| `how-to-evolve-identity.md` | `evolve-identity` | Four moves (amend/add/fork/retire), signals-to-evolve, anti-patterns. |

All tagged with `skill` (except vanilla which is `identity, assistant, evergreen`) so the starter library surfaces via `ideas(action='search', tags=['skill'])`.

## Loader wiring

| File:line | What |
|-----------|------|
| `crates/aeqi-orchestrator/src/lib.rs:38` | `pub mod preset_seeder;` |
| `crates/aeqi-orchestrator/src/event_handler.rs:88` | `db` field → `pub(crate)` so seeder can reach the pool. |
| `crates/aeqi-orchestrator/src/event_handler.rs:674` | `session:start` idea_content rewritten for proactive 6-step workflow with explicit skill pointers. |
| `crates/aeqi-orchestrator/src/preset_seeder.rs` | New module: `locate_presets_dir`, `seed_preset_ideas`, `purge_test_identity_ideas` + 4 tests. |
| `aeqi-cli/src/cmd/daemon.rs:387-411` | Daemon boot calls `preset_seeder::seed_preset_ideas` after lifecycle events. |
| `aeqi-cli/src/cli.rs:218-223` | New `Seed { reset_identities }` subcommand variant. |
| `aeqi-cli/src/main.rs:132-134` | Match arm wires to `cmd::seed::cmd_seed`. |
| `aeqi-cli/src/cmd/mod.rs:22` | `pub(crate) mod seed;`. |
| `aeqi-cli/src/cmd/seed.rs` | New module: opens registry + store, optionally purges, always seeds, prints summary. |
| `agents/leader/agent.md` | Appends a "Proactive workflow" section naming the six skills by slug. |

## Identity baseline changes

- **Default `session:start` idea**: replaced a passive description of the primitives with an imperative "Be proactive" block that calls out each of the six skills by slug and tells the agent to search `tags=['skill']` before assuming. Still graceful when the skills aren't in the DB — the text is useful on its own.
- **Leader agent**: appended a six-step proactive workflow section. Leader still opens with its original orchestrator voice; the new section is additive guidance.
- **No persistent agent's `identity_idea` was changed** — agents can opt into `vanilla-assistant` by setting their identity_idea to that slug, but existing agents continue with their current identity. Vanilla-assistant is a library starting point, not an automatic upgrade.

## Purge outcome

- Junk-match heuristics in `preset_seeder::purge_test_identity_ideas`:
  - Name substrings: `magical`, `loli`, `isekai`, `anime-isekai`, `magical-transformation`, `session-start-magical`.
  - Content substrings: `magical loli`, `Magical Loli`, `isekai assistant`, `Magical Transformation Protocol`.
  - Junk tags: `isekai`, `loli`.
- Dev DB ran clean on invocation; previously-run purge had cleared 5 ideas (`anime-isekai-assistant-identity`, `automatic-magical-transformation-protocol`, `anime-isekai-loli-assistant-identity`, `session-start-magical-transformation`, `reasonable-step-style-magical`). Re-running `aeqi seed --reset-identities` is now idempotent: 0 purged, 0 inserted, 7 already present.
- Operator can force-rerun the purge on any DB via `aeqi seed --reset-identities`.

## Tests

Added to `crates/aeqi-orchestrator/src/preset_seeder.rs`:

- `seed_one_file_inserts_new_idea_with_tags` — fresh insert + idempotent second call + tag count.
- `seed_one_file_skips_empty_body` — empty-body guard.
- `seed_preset_ideas_handles_missing_dir` — no presets dir = Ok(vec![]), not Err. Uses `AEQI_PRESETS_DIR` sentinel.
- `purge_matches_magical_loli_pack_and_leaves_clean_ideas` — seeds 4 ideas (1 clean + 3 junk via name/content/tag), verifies each heuristic matches, asserts the clean one survives.

## Status suite

All four pre-commit gates passed on `overnight/e-seed-ideas`:

```
cargo fmt --all                               # clean
cargo clippy --workspace -- -D warnings       # clean
cargo test --workspace                        # all green (orchestrator: 317 tests, 4 new)
cd apps/ui && npx tsc --noEmit                # clean
cd apps/ui && npx prettier --check "src/**"   # clean
```

End-to-end smoke:

```
cargo build --bin aeqi
./target/debug/aeqi seed                      # "7 already present"
./target/debug/aeqi seed --reset-identities   # "No test identity ideas found to purge." + "7 already present"
```

## Graceful degradation

- If `presets/seed_ideas/` is missing (e.g. binary installed to `/usr/local/bin/` without the share dir), `locate_presets_dir` returns `None`, the seeder returns `Ok(vec![])`, and the daemon boots normally without a warning.
- If a single markdown file fails to parse, it's logged as `warn!` with the reason; other files still seed.
- If an agent's `session:start` event references a preset idea that doesn't exist, `ideas.assemble` returns an empty result and the agent still starts — the idea_content fallback in the event seed carries the full proactive instruction set inline.

## Vision anchor

The user-facing loop: spawn AEQI → it greets with the proactive preamble → user states a goal → agent searches skills → acts via quests/events/spawns instead of chatting. The six skill ideas give the agent its own how-to library, so "how do I create an event?" has a concrete, correct answer in the DB rather than hallucination.

— Stream E
