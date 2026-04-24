# Overnight 2026-04-23 → 2026-04-24 — what shipped

Luca — you slept, I worked. Everything below is live on `app.aeqi.ai` +
`aeqi.ai`. Main is at commit `2235ecd`. Current live bundle:
`index-Dgq2-8TB.js`. All deploys passed smoke.

## Headline

**Session refactor is done, 7/7 commits shipped.** Every execution is
ephemeral now. `SessionType::Perpetual` is deleted. The ghost panel bug
you hit is structurally impossible. Plus a bunch of other things you'll
notice.

## What's new users would see

- **Footer reads `v0.8.0`** (wired off `package.json` via Vite define —
  future bumps are a one-liner).
- **New landing changelog entry + blog post** at
  https://aeqi.ai/changelog and https://aeqi.ai/blog/every-execution-is-ephemeral
  (3 short paragraphs in the existing voice).
- **Sidebar dots.** Open sessions show a small quiet 4px muted dot.
  Actually-streaming sessions show the full 7px accent `<ThinkingDot>`
  pulse. No more universal pulsing. The `<ThinkingDot>` primitive is the
  single source of "agent is thinking" across rail + panel.
- **Composer ↑ history.** Arrow-up reaches *all* prior user messages in
  the current session (pulled from the DB), not just this browser
  session.
- **Mid-turn messages.** Send while the agent is working — it lands at
  the next `StepStart`, same way a `tool_result` would. Transcript
  splits cleanly into two assistant entries around an inline user
  bubble, step counter continues (Step N → N+1, no reset), continuation
  entry's trail reads "Continuing from step N".
- **WhatsApp / Telegram messaging tools.** Agents can now `whatsapp_reply`
  / `whatsapp_react` / `telegram_reply` / `telegram_react` — quoted
  replies and emoji reactions, not just plain text.
- **luca-wa subagent.** New child of Luca Eich root
  (id `968890b5-80af-4ca9-88dd-4311990e2550`, model `claude-sonnet-4.6`).
  Owns WhatsApp wholesale — channel binding, the 3 existing sessions,
  the 4 channel-session rows all rekeyed to luca-wa. Telegram stayed
  with Luca Eich as you asked. Persona idea
  `whatsapp-persona-luca` gets injected every step via the event
  `inject-whatsapp-persona-per-step` — so the voice (no capitalization,
  short+sweet, reply/react when it fits) stays consistent across every
  LLM call.

## Code quality — UI

**New primitives.** `<Select>`, `<Popover>`, `<Combobox>`, `<Menu>` — all
in `apps/ui/src/components/ui/`, all with Storybook stories, all sharing
graphite tokens + the same chevron shape. Migrated callsites:

- `AgentEventsTab` scope-select → `<Select>`
- `ToolCallRow` floating suggestions → `<Popover>`
- `IdeaCanvas` scope-select → `<Select>`, kebab menu → `<Menu>`
- `AgentQuestsTab` scope-select → `<Select>`
- `ModelPicker` → `<Combobox>` (426 lines → 225)
- Raw `<select>` + hand-rolled popover patterns eliminated at 7+ sites.

`.scope-select` CSS rule deleted (unused).

**AgentIdeasTab.tsx:** 1047 lines → `AgentIdeasTab.tsx` 305 line shell +
4 sub-views in `apps/ui/src/components/ideas/` (list, canvas, graph,
primitive-head + shared types).

## Code quality — Rust

- **`agent.rs` 3900 lines → 5 modules** under `crates/aeqi-core/src/agent/`:
  `mod.rs` (2350 — the irreducible `run()` loop + Agent struct), plus
  `compaction.rs`, `streaming.rs`, `step_context.rs`, `tool_result.rs`.
- **`tools.rs` 2268 lines → 6 files** under
  `crates/aeqi-orchestrator/src/tools/`: per-tool files (`agents.rs`,
  `ideas.rs`, `quests.rs`, `events.rs`), factory/misc in `mod.rs`, the
  OpenRouter usage collector extracted.
- **`auth.rs` 1152 lines → 4 files** under
  `crates/aeqi-web/src/routes/auth/` — split by provider
  (local/google/github + the shared `mod.rs`).
- **Vocabulary rename** (stale "prompt" → proper names, per the
  no-prompt-vocabulary rule in CLAUDE.md):
  `AgentPromptConfig` → `AgentSystemConfig`,
  `AssembledPrompt` → `AssembledContext`,
  `SynthesizedPrompt` → `GraphSummary`,
  `Agent::run(prompt)` → `Agent::run(input)`,
  `without_initial_prompt_record` → `without_initial_message_record`,
  `analysis_prompt()` → `analysis_request()`, and ~15 related comment
  updates.

## Session refactor — 7 commits

1. `refactor(agent): delete inline compaction fallback` — all context
   pressure now flows through `context:budget:exceeded` →
   `transcript.replace_middle` → durable `session_messages` rows with
   `summarized=1`. No more RAM-only compaction.
2. `refactor(daemon): route web session_send through pending_messages
   rail` — deleted the `is_active → inject_input` shortcut. One rail
   for all triggers (web, gateways, scheduler, events, quests).
3. `refactor(core): delete SessionType::Perpetual + parking loop +
   input_sender plumbing` — the big one. `ExecutionRegistry::is_active`
   is truthful now.
4. `feat(agent): step-boundary user-message injection` — new
   `ChatStreamEvent::UserInjected`, new `PendingMessageSource` trait,
   new `session_store.claim_pending_for_session(session_id, since_id)`.
   At each `StepStart`, the agent claims any pending rows for the
   current session arrived after the turn started and appends them as
   `User` messages. Same shape the model sees as a `tool_result`.
5. `feat(ui): handle UserInjected — split assistant turn at step
   boundary` — reducer returns a discriminated `{kind: "next" | "split"}`,
   useWebSocketChat commits the pre-split state, pushes the user
   bubble, and reinitializes with a carried `stepOffset`. LiveTrail
   says "Continuing from step N". Also deleted the `lazyStreaming` /
   `isAwaitingInputComplete` band-aids (the root cause is gone).
6. `feat(agents): AgentConfig::can_self_delegate + session.spawn gate` —
   DB column + migration + gate in `session_spawn`. Transport-owning
   agents (Luca Eich, luca-wa) auto-backfilled to `true`. Default
   `false` for everyone else.
7. `chore: session refactor cleanup + tests + CLAUDE.md` — 4 new
   integration tests, stragglers cleaned from ARCHITECTURE.md /
   docs/agent-loop-parity.md / agent_registry.rs comments, CLAUDE.md
   updated ("Every execution is ephemeral: one turn per spawn…").

Tagged `v0.8.0` on origin.

## What's still open

From the code-quality audit at `docs/code-quality-audit-2026-04-23.md`:

- `session_store.rs` (2614 lines) — 4 separable concerns
- `agent_registry.rs` (3067 lines) — ConnectionPool, migrations, CRUD,
  ancestry, visibility
- `daemon.rs` (2328 lines) — struct, IPC loop, patrol, config, signals
- `event_handler.rs` (1926 lines) — persistence vs dispatcher
- `config.rs` (2067 lines) — 4 independent sub-config groups
- `message_router.rs` (1506 lines) — routing, quest creation, channel reg
- Crate moves: `ConnectionPool` → `aeqi-core`, `WorkerContext` /
  `Middleware` trait → `aeqi-core`, `idea_assembly` → `aeqi-ideas`
- More `<select>` migrations that I skipped for visual-regression safety
  (`AgentQuestsTab:301,315,638`, `TestTriggerPanel:158` — listed in the
  audit with reasons).

## Known notes / things you should know

- **Isolation footgun.** Several Sonnet agents initially ignored the
  worktree isolation and wrote into the main checkout via absolute
  paths. I stopped them mid-flight, salvaged the work from main, and
  added a loud "no absolute paths" warning to every subsequent agent
  prompt. Later agents respected it. Memory updated.
- **`node_modules/vite` got nuked** at some point by a worktree cleanup
  side-effect. `npm ci` restored it. If any future deploy fails with
  `vite: not found`, `cd apps/ui && npm ci` fixes it.
- **`inject-whatsapp-persona-per-step` event fires on every step** of
  every luca-wa session — might be overkill; if the persona bloats the
  context window, reduce to first-step-only or move the persona content
  to a session-start assembly. Haven't measured, flagging it.
- **`"prompt_name"` JSON key in MCP response** was renamed to `"name"`
  in the vocabulary pass. If an external MCP client relies on the old
  key, it'll break — internal greps confirmed no known consumers, but
  worth knowing.
- **Stashes** — three of them on main. `stash@{1}` and `stash@{2}` are
  other agents' in-flight WIP (security_middleware, etc.) that were
  here when I started — not mine to resolve. `stash@{0}` is incidental
  drift from the isolation-bug recovery; safe to drop.

## Deployments

- `aeqi-runtime.service` — latest main (`2235ecd`), running on :8400.
- `aeqi-platform.service` — latest main, serving UI + proxying to
  runtimes.
- `aeqi.ai` landing — deployed via `~/aeqi-landing/deploy.sh`, rsynced
  to `/var/www/aeqi-ai/`.

All three services `active`. All smoke checks green on each deploy.

## If you want to know where I spent budget

Sonnet agents, roughly descending: agent.rs split, tools.rs split,
AgentIdeasTab split, WA/TG tool implementation, session-refactor
commits 1-7 (7 agents), UI primitives Select+Popover, Combobox, Menu,
auth routes split, vocabulary rename, landing changelog.

---

Stop when you want to. Ping me if anything's off.
