# Unify events, middleware, and compaction around tool calls

Status: proposed
Date: 2026-04-19

## The thesis

AEQI has four primitives: **agents, ideas, quests, events**. Everything the LLM sees must trace back to one of them via a visible, configured path. Any string that appears in the model's context without that provenance is "magic" and must be killed.

Three concepts in the current runtime violate this: **middleware** (authors content silently), **event fields** like `query_template` / `idea_ids` / `query_tag_filter` (runtime-native strings baked into the event row), and **compaction** (a hardcoded taxonomy that collapses the transcript opaquely inside the same session).

This doc proposes one unifying move: **events fire tool calls.** The same tool registry the LLM uses. Nothing else.

## Vocabulary

Retire these words when describing AEQI:

- ~~prompt~~ / ~~prompt body~~ / ~~system prompt~~ / ~~prompt template~~ → **idea**, **user input**, **tool result**
- ~~hook~~ → **tool call** (fired by an event)
- ~~middleware action~~ / ~~injection~~ → **tool call** (fired by a pattern match)
- ~~query template~~ → **tool call to `ideas.search`**

What remains:

- **Idea** — a named piece of content, owned by an agent (or global), assembled into context by events.
- **Event** — `(pattern, tool_calls, cooldown_secs)`. When the pattern matches, runtime fires each tool call.
- **Tool call** — `(tool_name, args)`. Same registry the LLM uses.
- **Quest** — an agent's run of work.
- **Agent** — tree node that owns ideas and runs quests.

## Event shape (final)

```rust
pub struct Event {
    pub name: String,
    pub pattern: Pattern,          // "session:start", "message:received", regex, etc.
    pub tool_calls: Vec<ToolCall>, // fired in order when pattern matches
    pub cooldown_secs: Option<u64>,
}

pub struct ToolCall {
    pub tool: String,              // e.g. "ideas.search", "ideas.assemble", "session.spawn"
    pub args: serde_json::Value,
}
```

No `idea_ids`. No `query_template`. No `query_tag_filter`. No `query_top_k`. Those become args on a `ideas.search` or `ideas.assemble` tool call.

Example — current `session:start` seeds an idea plus runs a semantic search with a tag filter. After the move:

```json
{
  "name": "session:start",
  "pattern": "session:start",
  "tool_calls": [
    { "tool": "ideas.assemble", "args": { "names": ["session:primer"] } },
    { "tool": "ideas.search",   "args": { "query": "{user_input}", "tags": ["promoted"], "top_k": 5 } }
  ]
}
```

Operator reads the event row and sees exactly what will run. No hidden fields, no string interpolation buried in Rust.

## The three moves, in order

### Move 1 — Unify tool invocation

Today there are two execution paths: the LLM fires tools through one registry, and the runtime fires hardcoded logic (middleware, event handlers, compaction) through direct Rust calls.

Collapse to one: a single `ToolRegistry` where every tool is a `(name, schema, executor)` entry. Runtime-fired tool calls and LLM-fired tool calls share the executor. Results land on the transcript the same way. Nothing a tool call does is invisible.

New tools needed to cover what middleware + event handlers currently do directly:

- `ideas.assemble` — fetch ideas by name and add them to context.
- `ideas.search` — semantic + tag search, add results to context.
- `session.spawn` — start a new session (for compaction-as-delegation).
- `session.status` — emit a `ChatStreamEvent::Status` message on the transcript (replaces the silent inject + manual emit pattern).
- `transcript.inject` — add a message to the current session's transcript (replaces the various `LoopAction::Inject` sites).

Existing tools (shell, idea CRUD, quest CRUD, etc.) already go through the registry — no change.

### Move 2 — Middleware becomes detector-only

Middleware today does two things: detects a condition (loop, guardrail violation, shell hook trigger, context budget exceeded) and authors content (the injected string / system message).

Split those. Middleware stays as a detector: it fires a pattern. Everything else (what content appears, what tool runs, what the user sees) lives in the event's `tool_calls`.

Concretely:

- `LoopDetectionMiddleware` → fires pattern `loop:detected`. An event configured with pattern `loop:detected` owns the response tool calls.
- `GuardrailsMiddleware` → fires pattern `guardrail:<rule>:violated`. Event owns the response.
- `ShellHooksMiddleware` → fires pattern `shell:pre`/`shell:post`. Event fires the configured tool calls.
- `GraphGuardrailsMiddleware` → fires pattern `graph:guardrail:<rule>:violated`. Event owns the response.
- `ContextBudgetMiddleware` → fires pattern `context:budget:exceeded`. Event owns the response (which in Move 3 becomes compaction-as-delegation).

Middleware files shrink to pure detection logic. Operator configures response through events. Content is always editable.

### Move 3 — Compaction as delegation

Compaction today: run a canned LLM call inside the current session, replace the transcript with the result, keep going. The taxonomy lives in a `DEFAULT_COMPACT_PROMPT` const (now seeded as the `session:compact-prompt` idea, but still stitched in-session).

Compaction as delegation:

1. Pattern `context:budget:exceeded` fires on the current session (session **A**).
2. Event's tool calls run:
   - `session.spawn` with `{ kind: "compactor", instructions_idea: "session:compactor-instructions", transcript: <current transcript> }` → session **B** runs the compaction work and returns its output.
   - `session.spawn` with `{ kind: "continuation", seed_idea: "session:continuation-primer", payload: <B's output> }` → session **C** continues the original work.
3. Session A's transcript ends with a visible handoff: "compacted → session B, continuing as session C". User sees the seam.

Two wins:
- The compactor is a **real agent run**. Its instructions are an idea. It can use tools (search prior sessions, pull context, consult other agents). Compaction strategies become pluggable by swapping the instructions idea.
- Continuation is **a new session** with a clean transcript seeded from B's output. Transparent "where did my context go" — it's literally a different session ID, linked by parent_session.

Bare CLI and tests still work: if no `session:compact-prompt` idea is configured, falls back to the const `DEFAULT_COMPACT_PROMPT` inside the current session (today's behavior).

## What this deletes

- `ORDER_IDEA_REFRESH`, `IdeaRefreshMiddleware` — already gone (leak #24).
- Content-authoring in all remaining middleware — becomes detector-only.
- `query_template` / `query_tag_filter` / `query_top_k` / `idea_ids` columns on the events table — become args in `tool_calls`.
- `LoopAction::Inject(msgs)` and `MiddlewareAction::Inject(Vec<String>)` — replaced by the `transcript.inject` tool, so injection is always a tool call with a visible result.
- `DEFAULT_COMPACT_PROMPT` stitching logic in `summarize_context` — replaced by Move 3's delegation flow (const stays as bootstrap fallback).

## What this adds

- `ToolCall` as a first-class, serializable value on events.
- `ideas.assemble`, `ideas.search`, `session.spawn`, `session.status`, `transcript.inject` tools in the registry.
- A `session:compactor-instructions` idea and `session:continuation-primer` idea, both seeded with insert-if-absent semantics.
- Edit events UI (the last missing CRUD face — currently read/create/delete/test-trigger only).

## Migration order and reversibility

Each step is independently deployable. Nothing in step N+1 depends on step N being fully deleted — old and new paths coexist until the old path is empty.

1. **Add the new tools** (`ideas.assemble`, `ideas.search`, `transcript.inject`, `session.status`, `session.spawn`). Old paths keep working.
2. **Add `tool_calls: Vec<ToolCall>` column to events**, nullable. Existing events keep their `idea_ids` / `query_template` fields; new events can use either. Event handler fires `tool_calls` if present, else falls back to old fields.
3. **Migrate seeded lifecycle events** one at a time: rewrite each seed to use `tool_calls` instead of old fields. Verify behavior. Remove old fields from that seed's row.
4. **Migrate middleware** one at a time: change each middleware to fire a pattern instead of authoring content. Add a corresponding event with `tool_calls` that produce the same content. Delete the content-authoring code from the middleware.
5. **Drop old event columns** once no seed or middleware writes to them.
6. **Compaction-as-delegation**: add the two instructions ideas, add a `context:budget:exceeded` event with `session.spawn` tool calls, wire `summarize_context` to prefer delegation when the event exists.
7. **Edit events UI**: fill the gap in the CRUD surface.

Rollback at any step is a revert of that step's commit — nothing is destructively rewritten until step 5.

## Vocabulary cleanup (housekeeping)

These renames happen alongside Move 1:

- `compact_prompt_template` field → `compaction_instructions_template` (or drop the field entirely once Move 3 is live).
- `session:compact-prompt` idea name → `session:compactor-instructions`.
- `IdeaRefreshMiddleware` → deleted (already done).
- Any remaining doc/comment references to "prompt" in runtime code → rewritten per `feedback_no_prompt_vocabulary`.

## Open questions

- **Tool call composition.** If an event fires three tool calls, do they run sequentially, share a scratchpad, or is each independent? Proposed default: sequential, each tool's result appears in context before the next runs.
- **Pattern language.** Today patterns are strings with a few magic names (`session:start`, etc.). Do we need regex, globs, or structured matchers? Start with strings; revisit if needed.
- **Tool call args templating.** The example above uses `{user_input}` as a placeholder. Decide: do args support templating (simple string substitution) or does the runtime pass context separately? Proposed: args are raw JSON, context values (user input, transcript, session id) passed as a separate `context` param the tool can read.
- **Backpressure on event-fired tool calls.** If `session:start` fires five tool calls and three take 2s each, the user waits. Need a story for parallel vs sequential and for soft timeouts.

## Non-goals

- Changing the idea graph or edge model.
- Changing the agent tree or quest model.
- Renaming any primitive.
- Adding new primitives.
