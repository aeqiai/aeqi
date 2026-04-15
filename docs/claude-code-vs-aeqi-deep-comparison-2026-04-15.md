## Claude Code Handoff Prompt

```text
You are working in a local workspace with two codebases:

- Claude Code source snapshot: `/home/claudedev/src`
- AEQI source: `/home/claudedev/aeqi`

Start with this research document and use its exact path references:
`/home/claudedev/aeqi/docs/claude-code-vs-aeqi-deep-comparison-2026-04-15.md`

Also read:
`/home/claudedev/aeqi/docs/agent-loop-parity.md`

Your job is to use the Claude Code source snapshot to materially improve AEQI.

Do not treat the docs as gospel. Use them as a map, then verify the important claims directly in code in both `/home/claudedev/src` and `/home/claudedev/aeqi`.

Focus on the highest-leverage runtime and orchestration improvements surfaced by the comparison, especially:
- stable prompt prefix vs dynamic tail
- attachment-first mutable context instead of prompt churn
- live delegation wiring
- delegated result-return semantics
- subagent mode/tool-surface shaping
- approval brokering and permission architecture
- unified wakeup/notification queue semantics
- compaction layering and reinjection contracts
- transcript repair / resume correctness
- canonical checkpoint / handoff / blocked-state resume artifacts
- lifecycle event wiring
- remote/bridge/coordinator separation where relevant

What I want from you:

1. Read the comparison docs and inspect the referenced code paths.
2. Produce a ranked implementation roadmap for AEQI:
   - quick wins
   - medium-sized architectural improvements
   - deeper structural changes
3. For each item, name the exact AEQI files/modules to change and the Claude Code files that inspired it.
4. Identify which improvements should be copied directly, which should be adapted to AEQI’s architecture, and which should not be copied.
5. Then start implementing the highest-value items that are low-to-medium risk and can be completed cleanly in this repo.
6. Do not stop at planning if implementation is feasible.
7. Run relevant tests/checks for the code you change.
8. Preserve AEQI’s strengths: scheduler, quests, sessions, checkpoints, activity log, auditability, and long-running orchestration. Do not collapse AEQI into a Claude Code-style single conversational monolith.

Important guidance:

- AEQI should copy Claude Code’s runtime discipline, not its whole architecture.
- Keep AEQI’s control-plane spine.
- Favor explicit, durable state over implicit transcript magic where AEQI is already stronger.
- Where Claude Code has better runtime ergonomics, import the pattern in an AEQI-native way.
- If you find that the docs missed something important in the source, extend the analysis and use that to guide implementation.

Expected output style:
- First: concise findings and a ranked implementation plan with exact file touchpoints.
- Second: implement the top tranche of changes.
- Third: summarize what changed, what was verified, what remains, and what should be done next.

Begin by opening:
- `/home/claudedev/aeqi/docs/claude-code-vs-aeqi-deep-comparison-2026-04-15.md`
- `/home/claudedev/aeqi/docs/agent-loop-parity.md`

Then inspect both codebases and get to work.
```

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

## 14. Whole-Source Tree Map of Claude Code

The uploaded tree is large, but it is organized around runtime boundaries more than around user-facing features.

### Bootstrap and process entry

- `src/entrypoints/cli.tsx` is the real process entrypoint. It fast-paths `--version`, prompt dumping, daemon/bridge/background modes, and worktree/tmux setup before loading the full app.
- `src/main.tsx` is the interactive bootstrap. It performs trust/config/auth setup, plugin and skill loading, session restore, command registration, tool/model selection, and app state wiring.
- `src/entrypoints/init.ts` handles the global initialization path after trust is established.
- `src/entrypoints/sdk/*` and `src/entrypoints/agentSdkTypes.ts` define the external protocol and typed surface for SDK consumers.

### Shell / UI runtime

- `src/cli/print.ts` is the main REPL/headless runtime shell around the agent loop.
- `src/commands.ts` and `src/commands/*` are the slash-command surface.
- `src/components/*`, `src/screens/*`, `src/ink/*`, `src/hooks/*`, and `src/keybindings/*` are the terminal UI/input layer.
- `src/outputStyles/*` controls answer-shaping and rendering conventions.

### Agent loop core

- `src/query.ts` is the heart of the runtime.
- `src/services/api/claude.ts` is the request/response transport integration for the model.
- `src/constants/prompts.ts`, `src/context.ts`, and `src/utils/api.ts` build the prompt and apply cache-aware context injection.
- `src/utils/attachments.ts` is the mutable per-turn context stream.
- `src/services/tools/StreamingToolExecutor.ts` is the concurrent in-stream tool runner.

### Tools and delegation

- `src/tools.ts` and `src/constants/tools.ts` define the built-in tool universe and the mode-specific filtered surfaces.
- `src/tools/AgentTool/*` is the main subagent subsystem.
- The rest of `src/tools/*` is the capability plane: shell, files, search, web, plan, worktree, MCP, cron, tasking, messaging, sleep, and feature-gated tools.

### Tasks and background execution

- `src/Task.ts` and `src/tasks/types.ts` define the shared task model.
- `src/tasks/LocalShellTask/*` manages shell command task lifecycles.
- `src/tasks/LocalAgentTask/*` manages local subagent lifecycle, progress, and notifications.
- `src/tasks/RemoteAgentTask/*` manages cloud/remote agent tasks.
- `src/tasks/InProcessTeammateTask/*` manages same-process teammate execution.
- `src/tasks/DreamTask/*` is the background memory/dream subsystem.

### Cross-cutting services

- `src/services/mcp/*` manages MCP discovery, config, auth, policy, resources, and notifications.
- `src/services/compact/*` owns auto-compact, reactive compact, snip, context collapse, and related cleanup.
- `src/services/analytics/*`, `src/services/oauth/*`, `src/services/policyLimits/*`, `src/services/remoteManagedSettings/*`, `src/services/settingsSync/*`, and `src/services/lsp/*` are the operational control-plane services.
- `src/services/toolUseSummary/*`, `src/services/SessionMemory/*`, `src/services/PromptSuggestion/*`, and related services provide quality-of-life runtime layers around the loop.

### Remote and special modes

- `src/bridge/*` is a substantial remote-control subsystem, not just a transport shim.
- `src/remote/RemoteSessionManager.ts` manages live remote sessions.
- `src/server/createDirectConnectSession.ts` is the direct-connect session bootstrap path.
- `src/coordinator/coordinatorMode.ts` defines the multi-worker coordinator role and worker-facing tool surface.

### State and persistence

- `src/bootstrap/state.ts` is the process/session state spine.
- `src/state/*` is the UI/app state store.
- `src/utils/sessionStorage.ts` is the durable transcript and sidechain persistence layer.
- `src/utils/filePersistence/*` and `src/utils/task/*` persist task output and related runtime artifacts.

## 15. Claude Code Main-Session Control Flow

For a normal interactive turn, the control flow is roughly:

1. Process bootstrap happens in `entrypoints/cli.tsx` and `main.tsx`.
2. `cli/print.ts` runs the interactive/headless shell and assembles the current tool pool.
3. Prompt construction happens through:
   - `constants/prompts.ts`
   - `context.ts`
   - `utils/api.ts`
4. `query.ts` receives:
   - the system prompt
   - user/system context
   - current messages
   - tool pool
5. Before each model call, `query.ts` performs:
   - tool-result budget replacement
   - snip compaction
   - microcompact
   - context collapse
   - autocompact if needed
6. `services/api/claude.ts` turns the prompt/messages into API blocks, preserving the cache boundary.
7. The model streams output and `StreamingToolExecutor` starts tool execution as soon as tool-use blocks become executable.
8. After tools complete, `query.ts`:
   - records tool results
   - produces or schedules tool-use summaries
   - drains queued attachments/notifications
   - decides whether to continue, compact, recover, or stop
9. `cli/print.ts` handles command queues, proactive ticks, cron wakeups, and task-notification reinjection for future turns.

Design implication:

- Claude Code treats a turn as a conversation state transition plus a runtime reconciliation pass.
- The loop is not just “call model, run tools.” It is “repair context, preserve cache, stream tools, reconcile side systems, then continue.”

## 16. Claude Code Subagent Control Flow

For a subagent invocation:

1. Parent model calls `AgentTool`.
2. `AgentTool.call()` decides which orchestration path to use:
   - sync local subagent
   - async/background local subagent
   - teammate
   - fork
   - worktree-isolated
   - remote-isolated
3. `runAgent.ts` constructs the child runtime envelope:
   - filtered tool set
   - filtered or inherited system/user context
   - permission mode override
   - hook context
   - skills
   - agent-specific MCP configuration
4. The child runs the same `query()` loop.
5. Completion flows back differently by mode:
   - sync child returns `tool_result` directly
   - async child becomes a task and emits notifications on completion
   - remote child returns launch metadata immediately and later re-enters via task notification
6. `messageQueueManager.ts` and `cli/print.ts` route completion notifications back into the parent session as hidden/system-originated queue entries.

Design implication:

- Claude Code unifies “subagent” and “task” into one user-facing mental model.
- Sync/async/remote/worktree differences are runtime envelope differences, not product-surface differences.

## 17. Product Strengths Outside the Agent Loop

Claude Code is strong not only because of `query.ts`, but because the surrounding product systems are unusually mature.

### Startup and latency discipline

- `main.tsx` front-loads expensive independent work before the UI loop.
- `startupProfiler.ts` captures startup checkpoints.
- plugin loading is cache-first where possible.

### Permissions as product infrastructure

- `permissionSetup.ts` builds an effective permission context from CLI flags, settings, extra directories, and mode gates.
- `permissions.ts` classifies dangerous rules and resolves runtime allow/deny/ask decisions.
- this is deeper than a yes/no prompt system; it is a full policy layer.

### Durable transcripts and sidechains

- `utils/sessionStorage.ts` treats transcripts as a first-class product primitive.
- subagents, resume, remote sessions, and compaction all have dedicated persistence semantics.

### MCP and extension surface

- MCP is deeply integrated through `services/mcp/*`.
- plugins and skills are treated as first-class runtime extension systems, not as late add-ons.

### Bridge / remote-control infrastructure

- `bridge/*` and `remote/*` show that Claude Code is designed as a remotely operable system, not just a local CLI.
- the bridge stack includes heartbeats, capacity wakeups, trust, auth, reconnectability, and crash recovery.

### Observability

- session/plugin/bridge/startup telemetry are first-class.
- many subsystems are explicitly built to fail soft and remain observable.

## 18. Concrete AEQI Improvement Agenda

The most valuable changes are not speculative. They map directly to AEQI files.

### Tier 1: high-leverage product parity

1. Add a stable prompt prefix and dynamic tail.
   - Primary touchpoints:
   - `crates/aeqi-orchestrator/src/session_manager.rs`
   - `crates/aeqi-core/src/agent.rs`
   - provider request assembly

2. Make direct delegation truly live in the runtime.
   - Primary touchpoints:
   - `crates/aeqi-orchestrator/src/tools.rs`
   - `crates/aeqi-orchestrator/src/delegate.rs`
   - `crates/aeqi-orchestrator/src/session_manager.rs`

3. Fix completion return paths.
   - Primary touchpoints:
   - `crates/aeqi-orchestrator/src/scheduler.rs`
   - `crates/aeqi-orchestrator/src/tools.rs`
   - `crates/aeqi-orchestrator/src/message_router.rs`
   - `crates/aeqi-orchestrator/src/agent_registry.rs`

### Tier 2: runtime ergonomics

1. Add explicit subagent flavors with dedicated tool surfaces.
   - `explore`
   - `plan`
   - `implement`
   - `background`
   - `coordinator`
   - `remote`

2. Shift more mutable context into attachments/enrichments rather than mutating `system_prompt`.
   - Primary touchpoints:
   - `crates/aeqi-core/src/traits/observer.rs`
   - `crates/aeqi-core/src/agent.rs`
   - `crates/aeqi-orchestrator/src/agent_worker.rs`

3. Add tool-batch summaries and cleaner notification reinjection.
   - Primary touchpoints:
   - `crates/aeqi-core/src/agent.rs`
   - `crates/aeqi-core/src/chat_stream.rs`
   - `crates/aeqi-orchestrator/src/session_manager.rs`

4. Add an explicit approval broker and distinguish blind async agents from promptable async agents.
   - Primary touchpoints:
   - `crates/aeqi-orchestrator/src/middleware/guardrails.rs`
   - `crates/aeqi-orchestrator/src/session_manager.rs`
   - `crates/aeqi-core/src/agent.rs`
   - CLI / UI permission surfaces

5. Add a unified wakeup queue for interactive sessions without replacing the scheduler.
   - Primary touchpoints:
   - `crates/aeqi-core/src/agent.rs`
   - `crates/aeqi-orchestrator/src/message_router.rs`
   - `crates/aeqi-orchestrator/src/session_store.rs`

### Tier 3: outer-product maturity

1. Improve startup/performance instrumentation.
2. Harden plugin/extension and MCP loading paths.
3. Expand transcript/session persistence semantics for sidechains, resume, and queue audit.
4. Improve policy/permission productization around tools and delegation.
5. Wire hook execution into the actual runtime lifecycle rather than leaving it as a mostly standalone subsystem.

## 19. Final Synthesis

The most important thing learned from this source drop is not a single algorithm.

It is the product pattern:

- Claude Code is a conversation engine wrapped in a large amount of operational machinery.
- Its best ideas are about runtime discipline:
  - cache-stable prompt prefix
  - attachment-first mutable context
  - role-shaped subagent envelopes
  - transcript integrity under failure
  - queue-based re-entry for async work
- AEQI's best ideas are about durable orchestration:
  - quests
  - scheduler
  - checkpoints
  - audit trail
  - persistent sessions

So the right synthesis for AEQI is:

- keep the durable orchestrator
- import Claude Code's runtime ergonomics
- do not replace the scheduler with a conversational monolith
- do not replace explicit task context with pure transcript state

If AEQI executes only five things from this comparison, they should be:

1. stable prompt prefix + dynamic tail
2. direct live delegation wired into the runtime
3. explicit result-return semantics for delegated work
4. mode-shaped subagent tool envelopes
5. attachment-first mutable context instead of prompt churn

## 20. Claude Code's Permission System Is Runtime Architecture

The deeper permission read changed the comparison materially.

Claude Code does not treat permissions as a single allow/deny step. It treats them as a runtime architecture spanning tool surfacing, mode transitions, agent typing, approval routing, and reporting.

### Startup permission context is already policy compilation

- `src/utils/permissions/permissionSetup.ts:872-1033` compiles the effective `ToolPermissionContext` from:
  - CLI `allowedTools` / `disallowedTools`
  - base-tool presets
  - settings and disk rules
  - extra working directories
  - mode gates like `bypassPermissions` and `auto`
- `permissionSetup.ts:930-976` explicitly detects:
  - overly broad shell permissions
  - dangerous auto-mode permissions
- `permissionSetup.ts:978-1025` validates and folds in additional working directories before the session starts.

This matters because the runtime is not deciding permissions from scratch on every tool call. It starts from a compiled policy state.

### Bypass is not absolute

- `src/utils/permissions/permissions.ts:1071-1155` shows the rule-based subset that still applies even in bypass-oriented flows:
  - deny rules
  - ask rules
  - tool-specific `checkPermissions`
  - safety checks for sensitive paths
- The critical invariant is that some checks are deliberately bypass-immune.

That is a better model than a global YOLO flag. It preserves hard boundaries even in permissive modes.

### Auto mode is a mode transition, not just a prompt setting

- `permissions.ts:518-956` shows auto mode as a staged pipeline:
  - preserve non-classifier-approvable safety checks
  - optionally reject PowerShell early
  - fast-path actions that would already pass in `acceptEdits`
  - fast-path allowlisted safe tools
  - only then run the classifier
- `permissions.ts:818-875` handles classifier failure modes explicitly:
  - transcript too long
  - classifier unavailable
  - fail-open vs fail-closed behavior
- `permissions.ts:878-1057` tracks denials across a session and aborts headless sessions after repeated blocked actions.

This is much more mature than "if autonomous then let it run." Claude Code explicitly models when auto should degrade to manual review and when headless execution should just stop.

### Tool surface is narrowed before call-time permission checks

- `src/tools/AgentTool/agentToolUtils.ts:70-115` removes disallowed tools based on agent type and async status.
- `agentToolUtils.ts:122-220` resolves tool specs into a concrete tool pool, including agent-type metadata and disallowed tool filtering.
- `src/tools/AgentTool/runAgent.ts:436-462` distinguishes:
  - async agents that cannot show prompts
  - async agents that can show prompts after automated checks

This is a key product lesson: call-time permission checks are not enough. Claude Code shapes the action space before the model acts, then still checks tool use at execution time.

### Approval routing is brokered across frontends

- `src/hooks/useCanUseTool.tsx:93-167` shows the approval broker behavior:
  - automated checks before dialog for background agents
  - coordinator/swarm delegation of some permission decisions
  - interactive fallback only when automation cannot decide
  - bridge and channel callbacks as approval surfaces
- `src/services/mcp/channelNotification.ts:175-257` gates inbound channel permissions through capability, runtime gate, auth, org policy, session opt-in, and allowlist.
- `src/remote/RemoteSessionManager.ts` shows the same permission story extended to remote sessions.
- `src/QueryEngine.ts:243-270` does not implement policy itself; it only records denials for SDK reporting.

This is another important design clue: permissions are not just local UI. They are a pluggable approval broker spanning terminal UI, bridge mode, channel integrations, and remote sessions.

### AEQI implications

AEQI should copy the shape, not the exact policies:

- keep hard-deny and safety-check semantics separate from softer "ask" semantics
- distinguish blind async workers from promptable background workers
- shape tool surfaces before middleware sees a call
- centralize approval brokering instead of leaving `ask` behavior implicit in middleware

Right now AEQI has pieces of this in `middleware/guardrails.rs`, but Claude Code is doing more than guardrails. It is coordinating tool surface, mode, and approval transport as one system.

## 21. Transcript, Queue, and Hook Invariants Are Part of the Loop

The transcript and queue subsystems are not support code. They are part of Claude Code's agent-loop correctness model.

### Transcript storage is append-only, but replay is repair-first

- `src/utils/sessionStorage.ts` writes append-only JSONL, but the read path is not naive replay.
- `sessionStorage.ts:549-606` and nearby write-queue logic serialize writes per file and track pending/in-flight work so flush is meaningful.
- `sessionStorage.ts:1128-1254` keeps agent sidechains separate from the main session transcript.
- `sessionStorage.ts:3472+`, `3616+`, and `3704+` repair old or compacted transcript topology during load.

This is subtle but important. Claude Code's persistence model is not "the JSONL is the truth." The JSONL plus its replay repairs are the truth.

### Queue operations are audited and prioritized

- `src/utils/messageQueueManager.ts:41-61` defines a single module-level command queue.
- `messageQueueManager.ts:49-50` and `151-192` make priority explicit: `now > next > later`, FIFO within a priority.
- `messageQueueManager.ts:128-149` defaults task notifications to `later` so user input is not starved.
- `messageQueueManager.ts:28-37` records queue operations to transcript storage.

That means Claude Code has a durable explanation for why a command was enqueued, drained, or skipped. The queue is part of the session history, not just UI state.

### Notifications are not treated like user input

- The queue differentiates user-editable commands from task notifications.
- `src/query.ts:1547-1630` drains queued commands into attachment-style re-entry inputs rather than naively splicing them into the raw conversation.
- `src/cli/print.ts` only emits terminal `task_notification` SDK events for terminal notifications, not every internal progress ping.

This keeps wakeups structured and keeps the user input buffer clean.

### Tombstones are a correctness tool

- `src/query.ts:713-730` tombstones partial assistant states on fallback.
- `src/utils/sessionStorage.ts:863+` removes tombstoned messages with a fast tail-path and a bounded slow-path rewrite.

This is a strong pattern worth copying. Claude Code assumes streaming can fail mid-structure and provides a first-class way to remove orphaned state before it poisons resume or future tool-result matching.

### Hooks are session-scoped runtime state

- `src/utils/hooks/sessionHooks.ts:48-61` uses a `Map` so hook mutation does not churn store listeners under concurrency.
- `sessionHooks.ts:93-115` defines in-memory function hooks that are not persisted to settings.
- `src/utils/hooks/hookHelpers.ts:41-82` uses `SyntheticOutputTool` plus a function hook to enforce structured output at stop time.

This is not just extensibility. It is runtime loop control. Hooks can validate, halt, inject, or enforce structure without mutating the base prompt.

### AEQI implications

AEQI already has durable sessions, summaries, and traces in `session_store.rs`, which is stronger than Claude Code in some ways. But it should import several specific runtime invariants:

- wakeups should be logged as first-class events, not only observed indirectly
- interactive notifications should stay separate from user-authored input
- delegated or background sidechains should have explicit persistence semantics
- hook results should prefer structured enrichments over plain chat text
- compaction/resume should normalize old topology on load, not only at write time

In short: Claude Code's queue and transcript layers are doing loop hygiene work that AEQI currently spreads across several separate mechanisms.

## 22. Direct AEQI Outer-System Comparison

The more direct comparison is now clearer.

### Where AEQI is already stronger

- `crates/aeqi-orchestrator/src/session_store.rs` persists:
  - sessions
  - session messages
  - session summaries
  - session traces
  - senders / gateways
- `session_store.rs:560-596`, `609-633`, and `1359-1434` show that transcript search, summary management, and execution traces are all first-class persisted primitives.
- `crates/aeqi-orchestrator/src/message_router.rs:287-307` records typed thread events, not just free-form messages.
- `message_router.rs:334-392` and `426-469` show a durable chat-to-quest and quest-to-chat bridge.
- `crates/aeqi-orchestrator/src/scheduler.rs` uses:
  - `ActivityLog` broadcast wakeups
  - a direct worker completion channel
  - a patrol loop
- `crates/aeqi-core/src/streaming_executor.rs:1-297` already has deterministic ordered tool draining plus sibling-cancellation behavior during streaming.

This is not a weaker version of Claude Code. It is a different, more control-plane-heavy system.

### Where AEQI is weaker

- Delegation is not surfaced as cleanly as the codebase suggests it should be.
  - `crates/aeqi-orchestrator/src/delegate.rs` is strong.
  - the runtime tool pool still surfaces `AgentsTool` via `tools.rs:1650+`.
- AEQI has multiple wakeup paths instead of one unified interactive queue:
  - `input_rx` in `aeqi-core/src/agent.rs:1197-1274`
  - `pending_tasks` and `task_notify` in `message_router.rs`
  - `ActivityLog` broadcast and completion channels in `scheduler.rs`
- `crates/aeqi-orchestrator/src/middleware/guardrails.rs:1-227` is useful, but it is not a full approval broker.
  - ask-tier calls pass in autonomous mode
  - supervised mode injects caution text rather than opening a richer approval workflow
- `crates/aeqi-core/src/shell_hooks.rs` exists and is reasonably complete, but it is not yet clearly integrated into the main lifecycle in the way Claude Code's hook stack is.
- `session_manager.rs` still builds a larger monolithic `system_prompt` and appends prompt material directly, which is less cache-stable than Claude Code's static-prefix / dynamic-tail boundary.

### The most useful synthesis

The correct takeaway is not "AEQI needs to look more like Claude Code everywhere."

The correct takeaway is:

- keep AEQI's durable session store, message router, scheduler, and trace model
- import Claude Code's local runtime invariants for:
  - tool-surface shaping
  - approval brokering
  - wakeup queue semantics
  - transcript repair
  - structured hook enforcement

That is the real merge of strengths:

- Claude Code contributes runtime discipline
- AEQI contributes durable orchestration

If AEQI tries to copy Claude Code too literally, it risks losing the very thing that makes it strategically stronger: explicit, auditable, long-running orchestration outside a single conversation loop.

## 23. Compaction Is a Layered Runtime-Control Stack, Not One Feature

The deeper compaction pass surfaced something important that the earlier sections only hinted at:

Claude Code does not have "a compaction system." It has multiple distinct context-control mechanisms with different costs, different durability semantics, and different recovery roles.

### The main loop stages context reduction in a deliberate order

- `src/query.ts:396-460` runs:
  - snip first
  - microcompact second
  - context collapse third
  - autocompact last
- The comments in `query.ts` are unusually explicit about why:
  - snip frees history before the threshold check
  - microcompact prunes tool-result weight before summary compaction
  - context collapse runs before autocompact so a cheaper projection can avoid a full summary

This is a strong design pattern.

Claude Code does not jump straight from "too many tokens" to "summarize the conversation." It uses a cost ladder:

- remove unnecessary bulk
- clear stale tool-result weight
- project a thinner view
- summarize only if the cheaper steps are insufficient

AEQI should copy that separation. Right now its context-management story is stronger on durable orchestration than on layered token-pressure response.

### Overflow recovery is separate from proactive compaction

- `src/query.ts:1065-1110` handles prompt-too-long recovery after a real failure.
- The recovery path is not the same as the proactive path:
  - first drain staged context collapses
  - then try reactive compact
  - only then surface the error
- Media-size failures use a related but different path, because collapse cannot strip images.

That distinction matters. Claude Code separates:

- proactive shaping before the request
- reactive repair after a hard API rejection

This avoids overpaying the summarization cost on every turn while still giving the loop a recovery path when estimation was wrong or inputs changed unexpectedly.

### Summary compact, session-memory compact, microcompact, and context collapse do different jobs

- `src/services/compact/compact.ts:387-713` is the full summary path:
  - build a summary prompt
  - run pre-compact hooks
  - retry prompt-too-long by truncating head groups
  - produce a boundary + summary + preserved tail + reinjected attachments/hooks
- `src/services/compact/sessionMemoryCompact.ts:324-600` is a faster variant that uses extracted session memory instead of full resummarization.
- `src/services/compact/microCompact.ts:130-211` is not summarization at all. It prunes or clears old tool-result bulk.
- `src/services/compact/apiMicrocompact.ts:63+` shows there is also an API-layer cache-editing flavor of that pruning.

So the real Claude Code pattern is:

- summary compaction for long-term transcript reduction
- memory-based compaction for fast-path reuse
- microcompact for tool-result pruning
- collapse for projected view reduction without rewriting the visible transcript

That is much more disciplined than a single "compress context" switch.

### Compaction is a durability contract, not just a prompt rewrite

- `src/services/compact/compact.ts:520-719` rebuilds the post-compact tail in a stable order:
  - compact boundary
  - summary
  - preserved tail
  - attachments
  - hooks
- The reinjection helpers are budgeted and type-specific:
  - files in `compact.ts:1415+`
  - invoked skills in `compact.ts:1494+`
  - plan mode in `compact.ts:1542+`
  - async agents in `compact.ts:1568+`
- `src/services/compact/postCompactCleanup.ts:31+` then clears invalidated runtime caches after the new compacted state is committed.

This is a major product lesson.

Claude Code assumes that if context is compacted, the loop must still remember the live operational state that would otherwise be lost:

- which files were attached
- which skills were invoked
- whether plan mode is active
- which async agents are still running
- which deferred tool schemas or MCP instructions matter

AEQI should explicitly model this same post-compaction reinjection contract rather than relying on prompt assembly to rediscover that state later.

### Transcript replay repairs compacted topology on load

- `src/utils/sessionStorage.ts:3520+`, `3616+`, and `3704+` repair preserved compact segments and snip removals during transcript load.
- The loader does not blindly trust append order. It:
  - relinks preserved segments
  - rewires anchors and parent pointers
  - prunes old history only when the preserved segment is still walkable
  - ignores older boundary formats that do not carry enough metadata for safe replay
- `sessionStorage.ts:1408+` also guards against duplicate post-compact re-recording by treating already-recorded messages as a prefix.

This is easy to underestimate, but it is one of Claude Code's more sophisticated loop invariants.

Compaction is not complete when the summary is written. It is only complete when future resume and replay can reconstruct a correct message graph.

AEQI is already stronger than Claude Code in explicit session persistence, but Claude Code is stronger in transcript-topology repair after in-loop rewriting.

### The prompt boundary is part of compaction correctness

- `src/utils/api.ts:321-449` splits the system prompt at `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`.
- `appendSystemContext()` appends volatile system context as a dynamic tail.
- `prependUserContext()` injects CLAUDE.md/date/meta reminders as synthetic user-side context rather than mutating the cacheable prefix.
- `src/context.ts:116-155` memoizes user/system context and explicitly clears it after compaction.
- `src/services/api/claude.ts:3213+` turns that split into cache-controlled API blocks.

This is one of the clearest places where prompt architecture and compaction architecture meet.

Because the cached prefix stays stable, compaction mostly has to manage the mutable tail and attachment state. That reduces churn, improves cache reuse, and makes compaction semantics more predictable.

AEQI should treat "stable prefix vs dynamic tail" as a foundational runtime boundary, not as an optimization to add later.

## 24. Plugin, Skill, and MCP Loading Is Startup Architecture, Not Just Extensibility

The extension pass exposed another major product lesson:

Claude Code's extensibility story is not one generic plugin loader. It is a staged startup architecture with different registries, different freshness rules, and different policy boundaries.

### Startup is optimized around cache-only discovery

- `src/main.tsx:279+` logs plugin telemetry by calling `loadAllPluginsCacheOnly()`.
- `src/main.tsx:1909-1934` registers built-in plugins and bundled skills before `getCommands(preSetupCwd)`.
- The comment there is blunt: if registration happens later, the memoized command list misses them for the whole session.

This shows Claude Code treating extension discovery as startup architecture, not as a later convenience feature.

The key pattern is:

- make startup use cache-only discovery
- make explicit refresh paths do full-fidelity loading
- register zero-I/O built-ins before command memoization begins

That is better than trying to make every extension source equally fresh at all times.

### Plugin loading has separate cache-only and full-refresh modes

- `src/utils/plugins/pluginLoader.ts:3096-3175` defines:
  - `loadAllPlugins()` for full refresh
  - `loadAllPluginsCacheOnly()` for startup-safe loading
- The comments explain the invariants:
  - cache-only must never satisfy a fresh-source caller
  - full refresh can warm the cache-only memoization
  - startup consumers should not block on git clones
- `assemblePluginLoadResult()` loads marketplace and session-only plugins in parallel, merges session/marketplace/builtin sources, then runs `verifyAndDemote()`.

The architecture is careful about freshness.

Claude Code does not pretend "loaded once" and "fresh from source" are the same thing. It gives them separate call paths and separate caching rules.

AEQI should use the same distinction anywhere tools, agents, or integrations can come from durable install state, user-local state, and live-refresh state.

### Commands, skills, and plugins are intentionally separate registries

- `src/skills/loadSkillsDir.ts:638-923` loads skills from multiple scopes, dedups by file identity, and keeps conditional skills separate until their path filters match.
- `src/utils/skills/skillChangeDetector.ts:89-247` invalidates caches when dynamic skills change.
- `src/commands.ts:353-586` is the merge point for:
  - bundled skills
  - built-in plugin skills
  - filesystem skills
  - workflows
  - plugin commands
  - plugin skills
  - core slash commands

This is a more nuanced design than "plugins provide commands."

Claude Code distinguishes:

- shipped capabilities
- user/project skills
- installed marketplace plugins
- runtime-discovered skills
- MCP-provided tools/resources

That separation prevents one source from polluting the semantics of another and makes caching/policy decisions much cleaner.

### MCP is not loaded through the generic command path

- `src/services/mcp/config.ts:1071-1258` merges plugin MCP servers with user/project/local config and enterprise policy.
- `src/utils/plugins/mcpPluginIntegration.ts:341-589` resolves plugin MCP config, injects plugin-root variables, resolves user config/env substitutions, and namespaces server keys as `plugin:name:server`.
- `src/services/mcp/client.ts:2226-2408` then connects to servers and incrementally emits tools, commands, skills, and resources.
- `src/services/mcp/useManageMCPConnections.ts:143-856` consumes that incrementally in interactive mode.
- `src/main.tsx:2404+` prefetches configured MCP resources before headless execution.

This is another strong separation-of-concerns choice.

MCP is not just another slash-command source. It is its own discovery, connection, auth, and incremental-delivery pipeline.

That is exactly the right shape for AEQI if it wants a clean connector story:

- config resolution
- policy enforcement
- connection lifecycle
- surfaced tool/resource registry

should be separate layers.

### Policy sits upstream of execution

- `src/utils/plugins/pluginStartupCheck.ts:39+` and `performStartupChecks.tsx:24+` run trust and seed-marketplace checks before normal plugin use.
- `src/utils/plugins/pluginPolicy.ts:17+` is intentionally narrow: managed settings block/allow decisions stay at the policy edge.

That is the right model.

Claude Code does not rely on execution-time cleanup to make extension loading safe. It filters and demotes before the runtime sees those capabilities.

AEQI should follow that same pattern for plugins, MCP servers, and agent-surface extensions.

## 25. Bridge, Remote Session Sharing, and Coordinator Mode Are Separate Axes

The remote-architecture pass clarified something that is easy to flatten incorrectly:

Claude Code does not have one remote mode. It has multiple connectivity shapes that solve different recovery problems.

### There are three connectivity stories, not one

- `src/bridge/replBridge.ts` is the environment-based bridge path with environment registration, session reuse, pointer persistence, polling, and reconnect/re-dispatch.
- `src/bridge/remoteBridgeCore.ts:1-29` is the env-less bridge core that removes the Environments API layer but still does session creation, bridge credential fetch, transport setup, and token-refresh rebuilds.
- `src/remote/RemoteSessionManager.ts:95+` is for attaching to an already-existing remote session and relaying user input / permission responses.
- `src/server/createDirectConnectSession.ts:26+` and `src/server/directConnectManager.ts:40+` implement a much thinner direct-connect path.

So the product actually has:

- a durable bridge runtime
- an attach-to-existing-session client
- a simple direct-connect mode

Those are different operational contracts, not variants of the same code path.

### Crash resume is a real data structure, not a convenience flag

- `src/bridge/bridgePointer.ts` persists `{sessionId, environmentId}` per working directory, uses mtime refresh, and expires pointers after a bounded window.
- The bridge code uses that pointer to resolve `--continue` and recover from process churn separately from network churn.

This is another place where Claude Code is stronger than it first appears.

Remote continuity is not only a socket problem. It is:

- process resume
- session resume
- backend re-dispatch
- transport reconnect

handled at separate layers.

AEQI should explicitly preserve that distinction if it expands remote or multi-client session attachment.

### Auth repair is part of orchestration, not just transport

- `src/bridge/bridgeMain.ts:141+` keeps sessions alive with heartbeats, refresh, and reconnect-on-auth-failure.
- `src/bridge/jwtUtils.ts` proactively refreshes credentials before expiry and can force re-dispatch on auth churn.
- `src/bridge/sessionIngressAuth.ts` selects auth sources narrowly.
- `src/bridge/trustedDevice.ts` adds a rollout-gated trusted-device token path.

This matters because Claude Code treats auth expiry as a session-liveness issue, not a transport exception to bubble upward.

AEQI's equivalent lesson is not "copy the JWT code." It is:

- give transport/auth/session-resume separate state machines
- do not let auth repair logic leak across the whole runtime

### Remote session sharing is adapted into the local UX

- `src/services/mcp/channelNotification.ts` and `src/remote/remotePermissionBridge.ts` show permission and notification events being mapped into local surfaces.
- `src/remote/sdkMessageAdapter.ts` normalizes remote SDK messages into local message shapes.
- `src/remote/useRemoteSession.ts` filters echoed user UUIDs, tracks background tasks, and maps remote permission prompts into the local confirmation flow.

That is a subtle but high-value pattern.

Claude Code does not require remote sessions to invent a completely different UX grammar. It normalizes remote events into the same local loop semantics wherever possible.

If AEQI grows channel, bridge, or multi-client surfaces, it should do the same:

- remote messages should adapt into local session semantics
- not create a second parallel UX model

### Coordinator mode is independent of transport

- `src/coordinator/coordinatorMode.ts:36-88` shows coordinator mode as a prompt/tool-surface overlay driven by env state.
- `matchSessionMode()` preserves mode across resume by flipping process state to match the stored session mode.
- `getCoordinatorUserContext()` only injects coordinator-specific worker capability context when the mode is active.

This is one of the cleanest Claude Code design choices.

Coordinator behavior is not entangled with remote transport. It is a role overlay.

AEQI should preserve the same separation:

- transport decides where the session runs
- orchestration mode decides how that session delegates and reasons

## 26. AEQI Already Has a Real Control Plane, but Several Surfaces Are Only Half-Live

The deeper AEQI pass made the comparison sharper in both directions.

AEQI is not missing a control plane. In several places it already has a better one than Claude Code. But some of its most promising surfaces are still only partially activated.

### The good news: the substrate is already strong

- `crates/aeqi-orchestrator/src/runtime.rs:7-210` defines:
  - phases
  - session status
  - outcome status
  - artifacts
  - contract parsing with legacy-text fallback
- `crates/aeqi-core/src/checkpoint.rs:14+` and `crates/aeqi-orchestrator/src/checkpoint.rs:47-192` together give AEQI both shadow-git rollback and external git-observed checkpoint capture.
- `crates/aeqi-orchestrator/src/activity_log.rs:38-88` is not just audit storage. It is a broadcastable event bus backed by immutable SQLite records.
- `crates/aeqi-orchestrator/src/event_handler.rs:355+` seeds lifecycle events as data with attached ideas.
- `crates/aeqi-orchestrator/src/daemon.rs:382-440` does real consistency work on startup:
  - migrations
  - stale quest reset
  - orphaned worktree cleanup
  - orphaned session cleanup
  - schedule timer / IPC / activity services
- `crates/aeqi-orchestrator/src/session_manager.rs:350-820` is a credible universal spawn path for new sessions.

That is a substantial architecture. It means AEQI can absorb ideas from Claude Code without abandoning its strongest foundations.

### The bad news: some important abstractions are present but not fully wired

- `crates/aeqi-orchestrator/src/agent_worker.rs:296+` has `save_checkpoint()` as a no-op.
- `crates/aeqi-orchestrator/src/daemon.rs:521+` leaves `spawn_event_matcher()` as a no-op with the comment that lifecycle events are context injection only.
- `crates/aeqi-orchestrator/src/middleware/guardrails.rs:160-226` is still mostly substring classification with autonomous-mode pass-through for `Ask`.
- `schedule_timer.rs:39-240` is useful, but it is still a coarse polling loop with a simple parser.

These are not cosmetic gaps.

They mean AEQI sometimes advertises richer lifecycle or persistence semantics than the runtime fully delivers today.

### AEQI's persistence story is powerful, but split across multiple concepts

Right now there are at least three overlapping notions of durable state:

- shadow-git rollback in `aeqi-core/src/checkpoint.rs`
- externally observed git snapshots in `aeqi-orchestrator/src/checkpoint.rs`
- runtime/session/outcome state in `runtime.rs`, `session_store.rs`, and worker/scheduler records

Each of those is defensible on its own. The problem is the handoff boundary between them.

Claude Code's weakness is that it lacks AEQI's durable orchestrator.

AEQI's weakness is that it sometimes has multiple durable stories for the same session without one explicit "this is the canonical resume artifact for this state transition" contract.

The clearest place to fix that is around:

- `Blocked`
- `Handoff`
- delegated quest completion
- operator review/resume

### Session spawn and policy injection are already the right place to evolve

- `session_manager.rs:350-430` already does:
  - agent resolution
  - ancestor lookup
  - idea assembly
  - prompt construction
  - workdir resolution
- `agent_worker.rs:632+` already builds a serious middleware chain:
  - loop detection
  - cost tracking
  - context budget
  - graph guardrails
  - guardrails
  - context compression
  - idea refresh
  - clarification
  - safety net

So the right AEQI move is not to bolt new architecture onto the side.

It is to sharpen the existing core surfaces:

- make prompt assembly cache-stable
- make approvals brokered instead of textual
- make lifecycle events live instead of seed-only
- make checkpoints canonical instead of parallel
- make delegation the primary runtime path instead of a side implementation

### The most important interpretation change

After reading more of both systems, the comparison is now even clearer:

- Claude Code is more complete at local runtime hygiene
- AEQI is more ambitious and often stronger at durable orchestration

So AEQI should not feel architecturally behind.

It should feel partially unfinished in a few high-leverage runtime seams:

- delegation surfacing
- canonical resume artifacts
- approval brokering
- unified wakeups
- prompt boundary discipline
- live lifecycle dispatch

Those are fixable without changing the basic AEQI shape.

## 27. Updated Synthesis

The deeper sweep changes the advice in one important way.

Earlier, the main recommendation was:

- keep AEQI's orchestrator
- import Claude Code's runtime ergonomics

That is still right, but it needs one sharper refinement:

AEQI should copy Claude Code's separation discipline.

The most valuable Claude Code patterns are not individual features. They are boundaries:

- stable prompt prefix vs dynamic tail
- summary compaction vs microcompact vs collapse
- cache-only startup load vs explicit refresh
- plugin registry vs skill registry vs MCP registry
- transport reconnect vs backend re-dispatch vs process resume
- async blind worker vs promptable background worker vs interactive main thread

AEQI already has its own strong boundaries:

- scheduler vs worker
- session store vs activity log
- quests vs chats
- middleware vs agent runtime
- external checkpoints vs session traces

The opportunity is to make those boundaries line up more cleanly with runtime behavior.

If AEQI does that, it does not become "more like Claude Code."

It becomes a stronger system than Claude Code in the places that matter for long-running multi-agent orchestration, while also acquiring the runtime sharpness that currently makes Claude Code feel more production-hardened turn to turn.
