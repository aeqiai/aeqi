# Night one: what dogfooding the anti-magic runtime actually surfaces

A runtime that pitches itself as anti-magic is only as good as the discipline behind the dogfood. "Every prompt token is attributable" is easy to write on the landing page. It's harder to prove by running actual quests and watching what breaks.

Tonight I ran two live quests through AEQI and found a real leak. Here's the log.

## Setup

Commits 61e3fae, e72a0c6, and 31a5226 landed earlier tonight to fix `fire_count` telemetry — the `EventHandlerStore::record_fire` call that bumps `fire_count` and `last_fired` was missing from every lifecycle event firing site except the cron scheduler. The Events UI was silently lying: events would fire hundreds of times and the UI would show `fire_count: 0`.

I wanted to verify the fix end-to-end with real quests, not just passing unit tests.

## Quest 1: as-008 ("verify fire_count increments on quest_start")

Trivial quest — one `grep` tool call, completed in under 10 seconds. Before the quest:

```
on_quest_start    | fire_count: 0 | last_fired: null
on_session_start  | fire_count: 0 | last_fired: null
```

After:

```
on_quest_start    | fire_count: 1 | last_fired: 2026-04-19T03:12:31.259Z
on_session_start  | fire_count: 1 | last_fired: 2026-04-19T03:12:31.260Z
```

One millisecond between the two timestamps — `assemble_ideas_for_quest_start` walks both patterns in a single pass, records both event IDs into `AssembledPrompt::fired_event_ids`, and the scheduler's new record_fire loop hits both. Clean.

## Quest 2: as-009 ("audit record_fire")

Non-trivial quest: "grep the aeqi-orchestrator crate for every call site that invokes `record_fire` on `EventHandlerStore`." Expected 3–5 tool calls. Completed with exactly **one** — the agent wrote one good recursive regex and got everything in one pass.

Both `fire_count`s bumped to 2, timestamps fresh. The telemetry is honest.

But the one-tool-call shape matters for the candidate-skill rule. The lu-005 loop only synthesizes a candidate skill when the same tool is invoked ≥2 times in a quest. Both of tonight's dogfood quests fell under the threshold, so no candidate ideas were created. That's the rule working as designed, but it highlights how sensitive the threshold is: a well-behaved agent that nails the job in one tool call teaches the runtime nothing. Worth thinking about whether the rule should also learn from *patterns* (e.g. the same sequence of read + grep + edit across quests) rather than just repetition within a single quest.

Filed as a mental note, not a quest yet.

## The actual finding

While checking the post-fix state, I queried all six lifecycle events:

```
on_execution_start | session:execution_start | 0 | null
on_quest_end       | session:quest_end       | 0 | null
on_quest_result    | session:quest_result    | 0 | null
on_quest_start     | session:quest_start     | 2 | 2026-04-19T03:34:29Z
on_session_start   | session:start           | 2 | 2026-04-19T03:34:29Z
on_step_start      | session:step_start      | 0 | null
```

The first three are at zero for legitimate reasons:

- `on_execution_start` and `on_step_start` only fire in the interactive chat path (session_manager.rs:666, daemon.rs:1498). Quest workers go through a different path that doesn't assemble step_start ideas. That's a known gap, separate from tonight's work.
- `on_quest_end` and `on_quest_result` were the surprise. I grepped the runtime for any code that assembles ideas for those patterns. Nothing. They're declared as system events in `event_handler.rs:454-463`, the Events UI shows them, a user could attach `idea_ids` to them — but no runtime code path would ever read those idea_ids and inject them into anything.

That's a silent anti-magic violation. The user is invited to configure a behavior that does nothing.

## The fix for on_quest_result

Natural consumer site exists. In `scheduler.rs:988`, after a quest completes, the scheduler notifies the creator session (if still running) with a one-line result string. The fix: before sending, assemble any `session:quest_result` events for the agent, prepend the assembled content to the result text, and call `record_fire` for each event that contributed. Landed in commit `0429dad` — 33 insertions, 1 deletion.

Now if a user configures a quest-postmortem template as an idea and attaches it to `on_quest_result`, the creator session sees the result framed by that template. The event is real.

## What `on_quest_end` gets

Nothing tonight. There's no obvious natural consumer — it fires after `quest_result` has already been dispatched. Options: wire it to inject into the *next* quest's start context, or remove it from the default seed. Either direction needs a scoped design pass, not a night-shift commit. Filed as `as-010`.

## What this demonstrates

Anti-magic as a principle is cheap. Anti-magic as a running system requires constantly asking *is this event real?* for every declared hook, *does this fire_count reflect actual runtime activity?* for every telemetry row, and *can I trace every token the model saw back to a visible configuration?*

Two commits went out tonight as a direct result of an hour of dogfooding. The loop works. The gaps are fixable. The audit trail is converging on truth.

That's the whole pitch.

## Postscript: one more leak, caught the same way

Another hour later, a second dogfood pass (quests `lu-009` / `lu-010`) was built specifically to exercise the candidate-skill rule — the ≥2-of-the-same-tool threshold that neither `as-008` nor `as-009` hit earlier. The quest asked for five separate `read_file` calls on five different files and explicitly said "do not consolidate."

`lu-009` halted at call five with:

```
Loop detected: identical call to 'read_file' (same arguments) appeared 5 times
in the last 10 tool calls. Execution halted — you are repeating the same
operation. Change your approach.
```

But each call had a different path argument. The halt reason was lying.

Root cause: `MiddlewareObserver::after_tool` in `agent_worker.rs:1648` was constructing its `ToolCall` with `input: String::new()` because the `Observer` trait's `after_tool` signature doesn't carry input. `LoopDetectionMiddleware::fingerprint` hashes `{name, input}` — with input always empty, every call to the same tool collided to the same hash. The middleware's own unit test at `loop_detection.rs:234` (`different_calls_dont_trigger`) was passing because it exercised the middleware directly with real input; the bug lived entirely in the adapter.

That's the same shape of failure as the `fire_count` leak: a silent drift between what the runtime advertises and what it actually does, detectable only by running real work through it. The loop detector claimed to match on "same arguments." It was matching on tool name alone.

Fix (commit `518a171`): stash the input on the observer in `before_tool`, retrieve it in `after_tool`. Twelve lines. `lu-010` — the same quest re-run post-fix — completed all five reads with no halt and a candidate-skill idea written. The regression confirms itself.

Three runtime leaks in one night, all caught by running the product against itself.

## Postscript 2: a fourth leak, and the night ends on a planning note, not a commit

The closing test of the shift was the end-to-end promote path: flip a candidate-skill idea to `[promoted, skill]`, run preflight, confirm the promoted content shows up in the assembled system prompt via the `on_quest_start` event's `query_template`.

The candidate was `e2a0547c` — the `read_file` skill candidate auto-generated from `lu-011`. I renamed it to *"promoted: multi-file read pattern"*, appended a `## How to apply` section, swapped the `candidate` tag for `promoted`, and re-embedded it through the proper MCP update path (which correctly re-ran the embedder — confirmed by a fresh `content_hash` on `idea_embeddings`).

Then preflight with three different quest descriptions designed to semantically match. The idea never surfaced in the top-5.

Reading `idea_assembly.rs:195`:

```rust
match store
    .hierarchical_search(&expanded, &ancestor_ids, top_k)
    .await
```

No tag filter. The `on_quest_start` event seeded in the default config declares `query_template = "skill promoted {quest_description}"` — the intent, plainly, is *"pull promoted skills relevant to this quest."* But the runtime implements it as *"pull the top-k semantically-nearest ideas, regardless of tag."* The word `promoted` in the template is a soft hint to the embedding model, not a hard filter against the `promoted` tag.

Consequence: a candidate-tagged idea (not yet human-reviewed), a rejected idea, or a raw scratch note can end up in a live quest's system prompt purely by scoring high on embedding similarity. The Events page advertises one contract; the runtime honors a weaker one.

The fix shipped the same night (commit `adcd497`). New nullable column `query_tag_filter` on the events table, plumbed through the `IdeaStore` trait as `hierarchical_search_with_tags`, and wired into `idea_assembly.rs` at the semantic-search call site. When an event declares a tag filter, only ideas matching at least one of the listed tags can be retrieved — everything else gets dropped before it reaches the prompt. The default `on_quest_start` seed now declares `["promoted"]`. Ran the same preflight post-deploy: every candidate-tagged idea that previously leaked through now correctly sits outside the top-5 result set. Only promoted skills reach the model.

The preflight feature is what exposed the gap. Without it, I'd have run a real quest, seen slightly-off behavior, and shrugged. *Seeing* the assembled prompt — the same bytes the model will see — turned "that's a bit weird" into "that's a concrete contract violation I can commit a fix against." About ninety minutes from symptom to closed PR.

Four runtime leaks surfaced in one night. All four fixed. Anti-magic isn't a principle you declare. It's a discipline you practice.
