# as-011: wiring `session:execution_start` + `session:step_start` into quest workers

Filed from the 2026-04-19 dogfood pass as leak #6 in the seven-leaks tally.
Interactive chat sessions fire all four lifecycle patterns; quest workers
only fire `session:start` + `session:quest_start`. A user who attaches an
idea to `on_step_start` expecting per-LLM-call injection gets zero firings
on every quest.

## What's already there

The underlying primitive **exists**. `aeqi-core::Agent` already has a
`step_ideas: Mutex<Vec<StepIdeaSpec>>` slot and a `build_step_context()`
helper that prepends the snapshotted content to every `ChatRequest`. The
interactive path at `session_manager.rs:670-698` is the working prototype:

1. `get_events_for_pattern(agent, "session:step_start")`
2. Collect `idea_ids`, `idea_store.get_by_ids(...)`, snapshot content into
   `StepIdeaSpec { content: Some(...), ... }`
3. `Agent::new(...).with_step_ideas(specs)`
4. `record_fire` per contributing event

Same machinery needs to apply to `AgentWorker`. The architectural question
isn't "how do we inject step context into a worker" — it's "*where* in the
worker's lifetime does `step_start` fire, and does `execution_start` map
to a worker-run at all?"

## Semantic question 1 — `session:execution_start`

In interactive chat, an "execution" is a user message. The pattern fires
once per user turn (`daemon.rs:1490-1520`). In a quest worker, there is
**one and only one** "turn" — the worker receives the quest's
`task_context` and runs until `EndTurn`. No further user messages arrive.

Two readings:

- **(EA)** A worker-run IS an execution. Fire `session:execution_start`
  once before `agent.run()`, fold its assembled system text into the
  worker's system prompt.
- **(EB)** A worker-run is *not* an execution. Executions only exist for
  interactive sessions. For quests, `quest_start` already fires at the
  same conceptual boundary. Fire nothing, document the asymmetry.

**Recommendation: EA.** The pattern's name is about when it fires ("before
an execution begins"), not about what kind of session it fires inside.
Collapsing it to "only interactive" bakes a session-type distinction into
a global pattern — exactly the kind of hidden rule AEQI's anti-magic
principle forbids. Cost: one extra assembly pass per worker. Benefit: a
user who attaches an idea to `on_execution_start` expecting it to run
before every LLM-facing execution gets what they asked for.

## Semantic question 2 — `session:step_start` fire_count

Once `step_ideas` is wired into the worker, `build_step_context()` runs
before **every** `ChatRequest`. A 20-iteration agent loop hits it 20
times. What does `fire_count` count?

- **(SA)** Per session — bump once when the worker assembles its step
  specs at construction. Matches how `session_manager.rs` does it today.
  `fire_count` ends up meaning "number of sessions that attached this
  event."
- **(SB)** Per LLM call — bump inside `build_step_context()` every time
  the content is actually prepended. Matches the literal name. Requires
  threading `EventHandlerStore` into `aeqi-core::Agent` (new dependency
  edge) or a callback hook the core fires and the orchestrator handles.

**Recommendation: SA.** SB sounds more faithful but introduces a
core→orchestrator dependency that breaks the current layering (core
doesn't know about `EventHandlerStore`). The cost/benefit is lopsided —
per-session granularity already lets operators answer "is this event
wired?" and "when was it last used?", which is the load-bearing question.
Per-LLM-call granularity is interesting telemetry but belongs in a
separate histogram metric (task #102), not in `fire_count`.

This matches task #102's existing framing. Closing #102 as "per session"
unlocks this fix.

## Where in the worker to wire it

Three candidates:

- **(WA)** In `scheduler.rs::spawn_worker`, next to the existing
  `assemble_ideas_for_quest_start` call (scheduler.rs:601). Same shape,
  same assembly walk, same `record_fire` pattern. Builder-setter on
  `AgentWorker` (`with_step_ideas(Vec<StepIdeaSpec>)`) that stashes the
  vec until `execute_agent` passes it to `Agent::new(...).with_step_ideas()`.
- **(WB)** Inside `AgentWorker::execute_agent` itself, taking an injected
  `Arc<EventHandlerStore>` at worker construction. Hides the detail from
  the scheduler but grows `AgentWorker`'s field set.
- **(WC)** A new helper `assemble_step_ideas_for_worker(...)` in
  `idea_assembly.rs` that returns `(Vec<StepIdeaSpec>, Vec<fired_event_ids>)`
  — scheduler calls it, passes specs through `AgentWorker`, calls
  `record_fire` per returned id.

**Recommendation: WC.** Keeps assembly-side logic in `idea_assembly.rs`
where the other `assemble_*` helpers live. Scheduler remains the
record_fire owner (same pattern as the existing `fired_event_ids`
loop at scheduler.rs:610-614). `AgentWorker` gains one pure builder
method that stores specs verbatim.

## Shape of the diff

```rust
// idea_assembly.rs (new helper)
pub async fn assemble_step_ideas_for_worker(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
) -> (Vec<aeqi_core::StepIdeaSpec>, Vec<String>) { ... }

// scheduler.rs::spawn_worker — next to the quest_start block
let (step_specs, step_fire_ids) = assemble_step_ideas_for_worker(
    &self.agent_registry, self.idea_store.as_ref(), &event_store, &agent_id,
).await;
for event_id in &step_fire_ids {
    let _ = event_store.record_fire(event_id, 0.0).await;
}

// Also: one assemble_ideas_for_pattern call for "session:execution_start"
// with context { quest_description }, fold result.system into system_prompt,
// record_fire its fired_event_ids.

// AgentWorker — new setter
pub fn with_step_ideas(mut self, specs: Vec<aeqi_core::StepIdeaSpec>) -> Self {
    self.step_ideas = specs;
    self
}

// AgentWorker::execute_agent — after `Agent::new(...)`
let agent = Agent::new(...).with_step_ideas(self.step_ideas.clone());
```

Three changed files, one new helper, ~60 added lines.

## Regression coverage

Add to `idea_assembly.rs` tests:

- `assemble_step_ideas_for_worker_returns_content_and_fire_ids` —
  seed a `session:step_start` event with a static `idea_ids`, assert
  both `StepIdeaSpec.content` matches and `fire_ids` contains the event.
- `assemble_step_ideas_for_worker_empty_when_no_matching_events` —
  no events, returns `(vec![], vec![])`, no panic.

Optional integration test: start a worker with a mock provider that
records every `ChatRequest`, assert the step content appears in every
request's system portion after the first.

## Out of scope

- `StepIdeaSpec.path` is currently required but lied to (interactive
  path passes `PathBuf::from(&idea.name)`). A proper enum variant for
  store-sourced vs file-sourced ideas is a follow-up. For this fix, do
  the same lie; add a `// TODO(as-012)` marker.
- Per-LLM-call fire_count histogram (task #102).

## Decision

- **EA** — fire `session:execution_start` once per worker run, before
  `agent.run()`.
- **SA** — `session:step_start` fire_count bumps once per worker (=
  session), not per LLM call.
- **WC** — new `assemble_step_ideas_for_worker` helper in
  `idea_assembly.rs`, scheduler remains `record_fire` owner,
  `AgentWorker` gains a pure `with_step_ideas` setter.

Estimated effort: one evening. Closes leak #6 and converts the
seven-leaks tally's one deferred item into shippable work.
