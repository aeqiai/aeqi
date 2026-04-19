# Observability as a feature: closing AEQI's last silent telemetry leak

AEQI's whole pitch is anti-magic: every prompt token reaching an LLM must be attributable to a user-configured event with a visible `query_template`, or a visible transcript event. If you can read the row, you can point at the reason.

That's load-bearing for trust. It's also load-bearing for the Events UI — which claims to show `fire_count` and `last_fired` per configured event. For months, that number was a lie.

## The leak

The runtime has six lifecycle events configured globally:

- `session:start`
- `session:quest_start`
- `session:execution_start`
- `session:step_start`
- `session:quest_end`
- `session:quest_result`

Each fires at a specific moment and injects ideas into the model's context. The `record_fire` helper on `EventHandlerStore` bumps `fire_count` and stamps `last_fired` with the wall clock. Simple enough.

The problem: `record_fire` was only called from one place — `schedule_timer.rs:122`, the cron-style scheduler that fires *scheduled* events. The six lifecycle events never went through that path. They fired through `idea_assembly.rs`, which walks the agent ancestor chain, pulls events matching the current pattern, and merges their `idea_ids` + `query_template` results into the assembled system prompt.

Legitimate firings. Zero telemetry.

Result: the Events page in the UI would show `fire_count: 0` for `on_quest_start` even after that event had fired on a hundred quests. The runtime knew it was using the event. The UI insisted the event was dormant. Anyone trying to audit *why the model said what it said* would look at the Events page, conclude the event hadn't contributed, and go hunting for a ghost.

That is exactly the failure mode AEQI exists to prevent.

## The fix, in three commits

The landed diff is small. What made it slow was figuring out which call sites could legitimately attribute a firing without double-counting, and which ones were pure visualization and should be left alone.

**Commit 1 (`61e3fae`): thread `fired_event_ids` through the assembly result.**

`AssembledPrompt` now carries a third field alongside `system` and `tools`:

```rust
pub struct AssembledPrompt {
    pub system: String,
    pub tools: ToolRestrictions,
    pub fired_event_ids: Vec<String>,
}
```

Inside `assemble_ideas_for_patterns`, each event that contributes at least one idea to the final prompt (either via its static `idea_ids` or via semantic-search results from its `query_template`) records its ID. The scheduler's quest-start path then loops over that vec and calls `event_store.record_fire(event_id, 0.0).await` for each. One cost argument, zero dollars because we don't know per-event cost at this granularity — fire counts and last-fired timestamps are the load-bearing signal.

Regression coverage sits in `idea_assembly.rs:463`: the existing promoted-skills test now also asserts that `assembled.fired_event_ids.contains(&event.id)` when a matching query_template injects content, and stays empty when no event matches.

**Commit 2 (`e72a0c6`): extend to the non-quest paths.**

Three more sites needed the same wiring:

- `session_manager.rs:394` — interactive sessions that assemble `session:start` outside the quest scheduler.
- `session_manager.rs:666` — per-LLM-call `session:step_start` events, which load ideas as step context via a raw `get_events_for_pattern` call (no `assemble_ideas` indirection). Each event that actually contributes a non-empty idea ID now records a fire.
- `daemon.rs:1498` — `session:execution_start` events, fired per user message. Same pattern — per-event `record_fire` in the loop that already emits the `EventFired` visualization rows.

One site explicitly did *not* get the wiring: `ipc/events.rs:221`, the test-trigger endpoint the UI calls when a user clicks "Test trigger" on an event. That's a preview — the same code path as `handle_quest_preflight` — and bumping `fire_count` on a dry-run would poison the telemetry.

**Commit 3 (`31a5226`): make it legible in the UI.**

With accurate numbers flowing, the Events page got a small polish:

- The event detail panel used to hide the stats row when `fire_count === 0`, leaving operators unable to distinguish "dormant" from "the UI dropped state". It now always renders the row, with a muted "Never fired" when the count is zero.
- The sidebar list previously showed `${idea_ids.length} ideas` as meta. It now prefers `${fire_count} fires` when the event has fired at least once, falling back to the idea count for dormant events. Operators can now scan which events are hot without clicking into each one.

## Why this matters more than it looks

A feature nobody audits is the same as no feature. The value of the Events page is the operator being able to answer *why did the model just inject that skill?* in under five seconds. If `fire_count` is wrong, the audit trail is broken, and the whole anti-magic architecture collapses into vibes.

A runtime that's "observable by design" has to treat its own telemetry as part of the contract. When `record_fire` isn't called on a path that legitimately fires, that's a bug of the same severity as an SQL injection — it breaks the invariants the user is relying on.

Three small commits. Six lifecycle events now honest about their own runtime. Next quest that runs will update `last_fired` to within a second. The UI now tells the truth.

## End-to-end verification

Before deploy:

```
$ sqlite3 ~/.aeqi/aeqi.db "SELECT name, fire_count, last_fired FROM events
  WHERE pattern LIKE 'session:%' ORDER BY pattern;"
on_execution_start|0|
on_quest_end|0|
on_quest_result|0|
on_quest_start|0|
on_session_start|0|
on_step_start|0|
```

After one test quest:

```
on_quest_start|1|2026-04-19T03:12:31.259609402+00:00
on_session_start|1|2026-04-19T03:12:31.260169121+00:00
```

The loop closes. The UI stops lying. Ship it.

## Postscript: four more leaks the newly-honest audit trail found

Fixing `fire_count` wasn't the endgame. It was the instrument. Once the Events page could be trusted, the zeros it kept showing on specific rows became testable hypotheses instead of noise.

The same night, four more leaks surfaced — each one the same architectural shape (an advertised event whose semantics drift from what the runtime actually does):

- **`on_quest_result` had no consumer.** Declared as a system event, rendered by the UI, invited user configuration — nothing in the runtime read its `idea_ids`. Wired to `scheduler.rs:999` so that when a quest completes, `session:quest_result` events assemble and prepend to the result text streamed to the creator session. Commit `0429dad`.
- **Loop-detection middleware fingerprinted only the tool name, not arguments.** `MiddlewareObserver::after_tool` constructed its `ToolCall` with an empty `input` field because the `Observer` trait's signature didn't carry one. Five different `read_file` calls hashed to the same fingerprint and the middleware halted with "identical call ... same arguments" — a halt message that was itself lying. The bug lived entirely in the adapter, not the middleware; the middleware's own unit tests passed because they exercised it directly. Commit `518a171`.
- **`on_quest_start`'s `query_template` retrieved the top-k semantically-nearest ideas regardless of tag.** The default seed declared `query_template = "skill promoted {quest_description}"` — intent clearly "pull promoted skills relevant to this quest" — but the runtime ran a bare semantic search. The word `promoted` was a soft hint to the embedding model, not a hard filter against the `promoted` tag. Candidate-tagged and rejected ideas could leak into prompts purely on embedding similarity. Fix: a new nullable `query_tag_filter` column on events, a tag-aware `hierarchical_search_with_tags` trait method, and a default-seed declaration of `["promoted"]`. Commit `adcd497`.
- **`on_quest_end` had no consumer either — the last advertised-but-dead event.** Users could attach ideas to it and the runtime would never assemble them. The natural injection point turned out to be the `quests(action=close)` tool itself: the worker calling close IS the quest ending. `QuestsTool::action_close` now assembles `session:quest_end` ideas in the worker's ancestry, `record_fire`s each contributing event, and prepends the assembled content to the close-tool's success message — so a user-configured postmortem or reflection template actually reaches the model at the natural quest-closing moment. Commit `a91f2c9`. Regression test at `idea_assembly.rs::quest_end_static_idea_ids_surface_in_assembly` pins the read-side.

Five anti-magic leaks in one shift. Every one was invisible until telemetry was honest about itself. That's the whole argument for observability-as-a-feature: fix the instrument first, then use it.
