# Claude Code vs AEQI: Deep Runtime Comparison

Scope: compare the uploaded Claude Code snapshot in `/home/claudedev/src` against AEQI's current runtime in `/home/claudedev/aeqi`, with emphasis on the agent loop, context injection, delegation/subagents, wakeups, tool surfacing, persistence, and orchestration shape.

This document complements `docs/agent-loop-parity.md`. That earlier doc is mostly loop-parity focused. This one is broader and reflects the current code paths.

## Executive Summary

Claude Code and AEQI solve overlapping problems with very different centers of gravity.

- Claude Code is built around one highly optimized conversational loop. It keeps a cached prompt prefix stable, moves volatile state into attachments, injects wakeups as hidden messages, and treats subagents as first-class tool calls inside the same runtime.
- AEQI is built around a control plane. It has a native agent loop, but the system's real strength is the scheduler, quest DAG, worker execution, DB-backed sessions, event handlers, checkpoints, and persistent audit trail.

The short version:

- If the goal is "best single-session agent UX", Claude Code is ahead.
- If the goal is "durable multi-agent operating system with resumability and auditability", AEQI already has primitives Claude Code does not.
- AEQI should copy Claude Code's prompt-caching discipline, attachment-first dynamic context model, and first-class delegation UX.
- AEQI should not copy Claude Code's overall architecture wholesale. The scheduler/quest split is an advantage, not a defect.

## Source Map

Claude Code files inspected:

- `src/constants/prompts.ts`
- `src/context.ts`
- `src/services/api/claude.ts`
- `src/utils/api.ts`
- `src/query.ts`
- `src/utils/attachments.ts`
- `src/tools.ts`
- `src/constants/tools.ts`
- `src/tools/AgentTool/AgentTool.tsx`
- `src/tools/AgentTool/runAgent.ts`
- `src/cli/print.ts`

AEQI files inspected:

- `crates/aeqi-core/src/agent.rs`
- `crates/aeqi-core/src/traits/observer.rs`
- `crates/aeqi-core/src/chat_stream.rs`
- `crates/aeqi-orchestrator/src/session_manager.rs`
- `crates/aeqi-orchestrator/src/tools.rs`
- `crates/aeqi-orchestrator/src/delegate.rs`
- `crates/aeqi-orchestrator/src/scheduler.rs`
- `crates/aeqi-orchestrator/src/agent_worker.rs`
- `crates/aeqi-orchestrator/src/schedule_timer.rs`
- `crates/aeqi-orchestrator/src/event_handler.rs`
- `crates/aeqi-orchestrator/src/agent_registry.rs`

## 1. Core Architectural Shape

### Claude Code

Claude Code is fundamentally a single interactive loop with a lot of support machinery around it.

- The main loop is `src/query.ts`.
- Prompt construction is centralized in `src/constants/prompts.ts`, `src/context.ts`, and `src/services/api/claude.ts`.
- Dynamic, invalidation-prone state is pushed into attachment messages in `src/utils/attachments.ts`.
- Wakeups are injected as hidden prompts (`<tick>`, cron prompts, queued notifications) rather than routed through a separate scheduler plane.
- Subagents run by reusing the same query loop through `src/tools/AgentTool/runAgent.ts`.

Result: the product feels like one living conversation that can branch, sleep, wake, and delegate.

### AEQI

AEQI is split across three planes:

1. Native chat/session loop in `crates/aeqi-core/src/agent.rs`
2. Session lifecycle and tool injection in `crates/aeqi-orchestrator/src/session_manager.rs`
3. Quest scheduling/execution in `crates/aeqi-orchestrator/src/scheduler.rs` and `crates/aeqi-orchestrator/src/agent_worker.rs`

Result: AEQI behaves more like an operating system:

- sessions are DB-backed
- quests are durable
- workers are tracked
- retries/checkpoints are explicit
- event handlers and schedule timers can wake agents without needing one giant live loop

Assessment:

- Claude Code is better integrated.
- AEQI is better structured for persistence, audit, and long-lived automation.

## 2. Context Assembly: Static vs Dynamic

### Claude Code's model

Claude Code has a very deliberate split between stable prompt material and dynamic prompt material.

- `src/constants/prompts.ts` builds the system prompt and inserts `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`
- `src/services/api/claude.ts` and `src/utils/api.ts` preserve that split when turning prompts into API blocks
- `src/context.ts` injects system context and user context, including git status, current date, and CLAUDE.md-derived content
- `src/utils/attachments.ts` carries many volatile deltas as messages instead of mutating the cached prompt prefix

Important design idea: Claude Code optimizes for prompt-cache stability. The prompt is treated as a cacheable artifact with a hot static prefix and a small dynamic tail.

### AEQI's model

AEQI has richer domain/task structure, but weaker cache discipline.

- Session system prompt is assembled at spawn in `session_manager.rs:393-426`
- Session prompts/skills are appended directly into the system prompt in `session_manager.rs:609-640`
- Initial memory is injected by mutating the first system message in `agent.rs:1906-1944`
- Step context is snapshotted and inserted as a system message before each call in `agent.rs:891-904` and `agent.rs:1858-1900`
- Worker task context is constructed as the first user message in `agent_worker.rs:557-606`
- Dynamic recall is appended into the system prompt in `agent_worker.rs:618-699`
- Observer attachments are injected later in `agent.rs:1669-1673`

Assessment:

- AEQI's task-context model is stronger for structured work.
- Claude Code's static/dynamic split is much better for latency and cache reuse.
- AEQI currently mixes static identity, dynamic memory, and step-time context more freely than Claude Code.

Recommendation:

- Keep AEQI's quest-context layering.
- Copy Claude Code's prompt boundary pattern.
- Move volatile material out of the base system prompt where possible.

## 3. What Gets Injected, and When

### Claude Code

Claude Code injects context at several distinct moments:

- session start: system prompt plus user/system context
- pre-call: compacted history, summaries, prompt cache-aware prompt blocks
- post-tools: attachment deltas, tool summaries, queued notifications
- wakeup: `<tick>` or scheduled prompt injection
- subagent spawn: filtered tool set, filtered context, hook payloads, MCP state

It is very deliberate about not over-injecting large mutable blobs into the cached prefix.

### AEQI

AEQI injects context through four channels:

1. System prompt assembled at spawn
2. First user message / task context
3. Per-step system insertions:
   - `<step-context>` in `agent.rs:895-903`
   - `<execution-context>` in `agent.rs:1238-1247`
4. Mid-loop enrichments:
   - updated memory recall in `agent.rs:1599-1645`
   - file change reminders in `agent.rs:1658-1667`
   - observer attachments in `agent.rs:1669-1673`
   - background notifications in `agent.rs:1675-1693`

Assessment:

- AEQI already has an attachment/enrichment concept via `Observer::collect_attachments()` in `traits/observer.rs:124-129`.
- Claude Code uses that pattern more aggressively and more consistently.
- AEQI still puts too much dynamic material into the system prompt itself.

## 4. Tool Surface and Tool Injection

### Claude Code

Claude Code treats tool surfacing as a first-class runtime design problem.

- `src/tools.ts` builds the tool pool
- `src/constants/tools.ts` defines mode-specific allow/deny sets
- `assembleToolPool()` sorts tools for stable ordering and prompt-cache friendliness
- subagents get different tool surfaces depending on mode, backgrounding, coordinator mode, in-process teammates, and async status

This is a big reason the agent loop stays coherent across many execution modes.

### AEQI

AEQI injects tools in `session_manager.rs:527-590`:

- shell/file/grep/glob
- orchestration tools from `tools.rs:1650-1703`
- optional ideas tool
- optional prompt-based filtering via `session_manager.rs:613-635`
- per-agent deny filtering via `session_manager.rs:593-598`

Assessment:

- AEQI has basic tool filtering.
- Claude Code has runtime mode-specific tool design.
- AEQI does not yet have an equally explicit "tool surface by agent mode" model.

Specific gap:

- `crates/aeqi-orchestrator/src/delegate.rs` implements a direct delegation tool, but `build_orchestration_tools()` currently wires in `tools.rs::AgentsTool`, not `delegate.rs::DelegateTool`.
- The live runtime `agents` tool in `tools.rs:406-476` supports only `hire`, `retire`, `list`, and `self`.
- The direct delegation path in `delegate.rs:26-419` exists, but it is not what the session tool pool exposes today.

This is a meaningful product gap because Claude Code's subagent tool is truly first-class at runtime.

## 5. Main Agent Loop

### Where they are similar

Both systems:

- stream model output
- start tools during streaming
- support context compaction
- auto-continue on some truncation scenarios
- drain notifications/enrichments between steps

AEQI's streaming implementation is in `agent.rs:1958-2121`.
Claude Code's is in `src/query.ts` with `StreamingToolExecutor`.

### Where Claude Code is better

Claude Code is more polished on loop hygiene:

- prompt-cache-aware prompt construction
- more explicit recoverable error handling
- context collapse as a cheap drain before expensive compaction
- richer fallback/tombstoning behavior
- better subagent orchestration inside the same runtime
- tool-use summaries after tool batches

### Where AEQI is better

AEQI's loop has several strengths Claude Code does not match:

- hierarchical memory injection at start via `inject_initial_memory()` in `agent.rs:1906-1944`
- mid-loop memory recall after tool output in `agent.rs:1599-1645`
- persistent session checkpointing and resume in `agent.rs:751-779` and `agent.rs:1705-1708`
- explicit repair of broken tool pairings in `agent.rs:2496-2550`
- budget pressure injection into tool results in `agent.rs:1531-1557`
- file change detection and re-read reminders in `agent.rs:1658-1667`

Net:

- Claude Code wins on runtime polish.
- AEQI wins on memory richness and resumability.

## 6. Task Context vs Conversational Context

This is one of the deepest philosophical differences.

### Claude Code

Claude Code is conversation-first.

- It preserves the conversation and keeps re-shaping it through compaction, summaries, and attachments.
- Task state is implicit in the conversation plus tool outputs plus attachment deltas.

### AEQI

AEQI is task-first.

- `agent_worker.rs:557-606` creates explicit task context
- `build_quest_tree_context()` in `agent_worker.rs:1758+` injects structural quest-tree state
- `build_resume_brief()` in `agent_worker.rs:308-384` injects audit history and child outcomes
- external checkpoints and git state are carried across attempts

Assessment:

- For durable project execution, AEQI's task-first context model is stronger.
- For interactive fluidity, Claude Code's conversation-first model is smoother.
- AEQI should preserve its task-context model and import Claude Code's cache/attachment discipline around it.

## 7. Delegation and Subagents

### Claude Code

Claude Code's `AgentTool` is deeply integrated:

- spawn sync or async agents
- background active agents mid-flight
- filter tools per subagent type
- support worktree isolation and remote isolation
- preload hooks, skills, MCP state
- run the same main query loop inside subagents
- return progress/results into the parent loop as part of the same interaction model

Key files:

- `src/tools/AgentTool/AgentTool.tsx`
- `src/tools/AgentTool/runAgent.ts`
- `src/constants/tools.ts`

### AEQI

AEQI has two delegation stories:

1. Durable quest delegation through `QuestsTool` and the scheduler
2. Direct child-session spawning through `SessionManager.spawn_session()`

The durable path is very strong:

- quests are persisted
- workers are scheduled with budgets/concurrency
- run records and outcomes are stored
- checkpoints survive retries

The immediate path is incomplete in product terms:

- `delegate.rs` can spawn child sessions directly via `SessionManager.spawn_session()`
- but the runtime tool pool currently does not expose that tool

Assessment:

- Claude Code has better in-loop delegation UX.
- AEQI has better durable task execution semantics.

Recommendation:

- AEQI should make direct delegation a first-class runtime tool.
- It should keep quest-backed delegation as the durable default for meaningful work.
- The right model is likely dual-path:
  - direct child sessions for short-lived exploratory subagents
  - quest-backed workers for tracked implementation work

## 8. Isolation and Worktrees

Claude Code supports worktree/remote isolation directly in its subagent tooling.

AEQI now has stronger isolation primitives than the older parity notes suggest:

- `session_manager.rs:441-525` creates or reuses a `QuestSandbox`
- child quests can fork from parent quest branches
- interactive no-quest sessions can receive ephemeral sandboxes
- sandboxed shell/file tools are scoped to the effective worktree

Assessment:

- AEQI does have worktree isolation primitives.
- The gap is not "no isolation exists".
- The real gap is that isolation is not yet surfaced as a polished, first-class delegation UX the way Claude Code does.

## 9. Wakeups, Sleep, and Autonomous Scheduling

### Claude Code

Claude Code's wake model is message-injection based.

- proactive ticks are scheduled in `src/cli/print.ts`
- the model receives `<tick>` prompts
- the prompt teaches the model to call `SleepTool` when idle
- cron and notification wakeups are injected back into the same loop

This keeps autonomy inside one conversational runtime.

### AEQI

AEQI has multiple wake paths:

- perpetual session wait on `input_tx` in `agent.rs:1197-1274`
- event-driven quest scheduler in `scheduler.rs:176-251`
- schedule timer that spawns sessions in `schedule_timer.rs:39-127`
- event handlers that attach ideas for `session:start`, `session:quest_result`, `session:step_start`, etc. in `event_handler.rs:363-400`

Assessment:

- Claude Code's model is better for "one agent stays alive and self-directs".
- AEQI's model is better for "the system has durable triggers and explicit control-plane wakeups".

Recommendation:

- Do not replace AEQI's scheduler with tick injection.
- If desired, add a Claude-style proactive mode only for interactive perpetual sessions.
- Keep quest scheduling/event handling as the durable automation backbone.

## 10. Persistence, Audit, and Resume

This is the category where AEQI is ahead.

AEQI has:

- DB-backed sessions in `session_manager.rs`
- quest records in `agent_registry.rs`
- worker runtime sessions and outcomes in `agent_worker.rs`
- explicit checkpoints and git-state capture in `agent_worker.rs`
- run records and activity log integration in `scheduler.rs`

Claude Code has solid session-side recovery, but it is still centered on a conversational transcript and sidechains rather than on a durable task database.

Assessment:

- For long-running productized orchestration, AEQI's persistence model is stronger.
- Claude Code's advantage is not durability; it is runtime ergonomics.

## 11. Non-Obvious AEQI Gaps Exposed by the Comparison

### Gap 1: Direct delegation implementation exists, but runtime wiring does not

Evidence:

- `delegate.rs` implements direct child-session spawning
- `build_orchestration_tools()` wires `AgentsTool`, not `DelegateTool`
- runtime `agents` schema does not expose delegation

Impact:

- AEQI cannot currently match Claude Code's live subagent invocation model in practice, even though part of the code exists.

### Gap 2: Completion routing looks partially wired

Evidence:

- `scheduler.rs:775-813` tries to notify `creator_session_id` on quest completion
- `tools.rs:662-749` emits `quest_created` without `creator_session_id`
- `message_router.rs:376-389` also emits `quest_created` without `creator_session_id`
- `agent_registry.rs:1461-1482` initializes `creator_session_id` to `None`

Impact:

- AEQI's "delegate and get result back into the originating session" story is not yet as tight as Claude Code's sidechain-to-parent result flow.

### Gap 3: No cache-boundary discipline yet

Impact:

- dynamic memory and prompt amendments can churn the system prompt more than necessary
- AEQI leaves latency and prompt-cache savings on the table

### Gap 4: Tool-surface design is less mode-aware

Impact:

- harder to create strongly typed subagent roles with intentionally constrained capabilities
- weaker guardrails than Claude Code's explicit allow/deny sets per agent mode

## 12. What AEQI Should Copy First

### P0

1. Introduce a prompt-cache boundary
   - Add a stable static prefix and a dynamic tail at the provider/request layer.
   - Keep identity/persona/tool docs stable.
   - Move volatile items to attachments or late system messages.

2. Make direct delegation first-class
   - Either wire `delegate.rs` into the runtime tool pool or merge its behavior into `tools.rs::AgentsTool`.
   - Support short-lived child sessions from the live agent loop.

3. Tighten result-return paths
   - Persist and propagate creator session identity explicitly.
   - Make response modes real product behavior, not just labels.

### P1

1. Add explicit mode-specific tool surfaces
   - explore/research
   - planning
   - implementation
   - async background worker
   - coordinator

2. Shift more dynamic context to attachments
   - memory refresh
   - file-change notices
   - execution ideas
   - completion notifications
   - schedule/event deltas

3. Add tool-batch summaries
   - cheap summarizer after heavy tool rounds
   - especially useful for long sessions and subagent-heavy interactions

### P2

1. Add proactive interactive mode
   - only for perpetual sessions
   - use hidden wake messages, not a second scheduler
   - keep the quest scheduler separate

2. Add stronger prompt/environment self-description for interactive sessions
   - current date
   - git status snapshot
   - working directory snapshot
   - important workspace instructions

## 13. What AEQI Should Not Copy

1. Do not collapse the scheduler/quest system into a single loop.
   AEQI's separation is an asset.

2. Do not abandon explicit quest/task context in favor of pure conversational state.
   AEQI's quest tree, resume brief, and checkpoint model is better for serious work.

3. Do not make subagents purely ephemeral.
   Claude Code's immediacy is great, but AEQI's durable worker model is more valuable for tracked execution.

## Bottom Line

Claude Code is the better reference for:

- prompt-cache-aware context assembly
- dynamic attachment design
- first-class subagent UX
- integrated wake/sleep behavior
- runtime polish inside one live conversation

AEQI is already stronger in:

- persistent orchestration
- durable task graphs
- auditability
- retries/checkpoints
- hierarchical memory and task-state injection

The best move is not to turn AEQI into Claude Code.

The best move is to keep AEQI's durable orchestration spine and import Claude Code's runtime ergonomics:

- cached prompt prefix
- attachment-first dynamic context
- real direct delegation
- clearer subagent modes
- tighter result-return paths
