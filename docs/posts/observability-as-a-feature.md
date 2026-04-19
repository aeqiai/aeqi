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
