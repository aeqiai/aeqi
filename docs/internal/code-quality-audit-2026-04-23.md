# Code quality audit — 2026-04-23

## File length offenders (top 15)

| File | Lines | Verdict |
|------|-------|---------|
| `crates/aeqi-core/src/agent.rs` | 4320 | should split — agent loop, streaming executor, compaction pipeline, and step-context builder are four near-independent concerns sharing one type |
| `crates/aeqi-orchestrator/src/agent_registry.rs` | 3067 | should split — ConnectionPool, schema migrations, Agent CRUD, ancestry queries, and visibility logic are distinct layers |
| `crates/aeqi-ideas/src/sqlite.rs` | 2688 | legitimately big — dense SQLite BM25 + vector hybrid search with careful correctness requirements; splitting would fragment the query pipeline |
| `crates/aeqi-orchestrator/src/session_store.rs` | 2614 | should split — schema DDL, pending-queue ops, message recording, and timeline queries are four fully separable concerns |
| `crates/aeqi-orchestrator/src/daemon.rs` | 2328 | should split — Daemon struct, IPC accept loop, patrol loop, config reload, and signal handling are near-independent; signals and patrol can each be their own module |
| `crates/aeqi-orchestrator/src/tools.rs` | 2268 | should split — `AgentsTool`, `IdeasTool`, `QuestsTool`, and OpenRouter usage collection are three unrelated LLM-invocable tools plus a utility, each 500+ lines |
| `crates/aeqi-core/src/config.rs` | 2067 | can split — provider configs, model tiers, channels config, and budget config are independent sub-structs that have grown together |
| `crates/aeqi-orchestrator/src/event_handler.rs` | 1926 | should split — EventHandlerStore persistence and the dispatcher/scheduler logic are two distinct responsibilities |
| `crates/aeqi-orchestrator/src/idea_assembly.rs` | 1684 | legitimately big — event/pattern dispatch tightly coupled with assembly; tests are 40% of the file, consider a `tests/` module |
| `crates/aeqi-orchestrator/src/message_router.rs` | 1506 | should split — incoming-message routing, quest creation heuristics, and channel registration each stand alone |
| `crates/aeqi-orchestrator/src/session_manager.rs` | 1301 | can split — `SessionOptions` builder, session spawn logic, and history replay are separable phases |
| `crates/aeqi-web/src/routes/auth.rs` | 1152 | should split — login/signup, Google OAuth, GitHub OAuth, email verification, and invite codes are five independent route handlers sharing only `AppState` |
| `crates/aeqi-orchestrator/src/sandbox.rs` | 1011 | legitimately big — bwrap sandbox construction is inherently complex; argument builder and runtime state could be a small separate file |
| `crates/aeqi-orchestrator/src/ipc/templates.rs` | 802 | can split — template rendering helpers and the IPC command dispatcher are separable |
| `apps/ui/src/components/AgentIdeasTab.tsx` | 1047 | should split — list view, canvas editor, and graph view are three components hand-inlined into one file |

## Naming sniff (top 10)

| file:line | Current | Suggested | Why |
|-----------|---------|-----------|-----|
| `crates/aeqi-core/src/agent.rs:939` | `run(&self, prompt: &str)` | `run(&self, input: &str)` | stale — aeqi's vocabulary is agents/ideas/quests/events; "prompt" here means the user turn text, not an LLM prompt document |
| `crates/aeqi-core/src/config.rs:401` | `AgentPromptConfig` | `AgentSystemConfig` | stale — this struct holds the agent's system text; calling it a "prompt" conflicts with `aeqi_tools::Prompt` (the skill file type) |
| `crates/aeqi-core/src/prompt.rs:34` | `AssembledPrompt` | `AssembledContext` | stale — this is the result of assembling ideas into an agent's context window, not a user-facing prompt |
| `crates/aeqi-orchestrator/src/session_manager.rs:137` | `without_initial_prompt_record` | `without_initial_message_record` | stale — "prompt" means LLM-input here; the flag controls whether the first user message is written to the transcript |
| `crates/aeqi-graph/src/analysis/synthesis.rs:8` | `SynthesizedPrompt` | `SynthesizedContext` or `GraphSummary` | stale — synthesizes a knowledge document from a code graph community, nothing to do with prompts |
| `crates/aeqi-orchestrator/src/failure_analysis.rs:187` | `analysis_prompt(...)` | `analysis_request(...)` | stale — builds the LLM input string for failure classification; caller vocabulary is analysis, not prompts |
| `crates/aeqi-graph/src/extract/types.rs:316` | `fn process(config, name)` | `fn verify_param_types(config, name)` | vague — function body tests type resolution; `process` gives no hint of what it processes |
| `crates/aeqi-web/src/routes/helpers.rs:15` | `let val` | `let json_value` | abbreviation — loses the type information that `serde_json::Value` provides |
| `crates/aeqi-graph/src/parser/rust.rs:202` | `let ret` | `let return_type` | abbreviation — obscures that this is the parsed return type of an AST node |
| `crates/aeqi-core/src/tool_registry.rs:317,324,332,339,352` | `let res` (×5) | `let result` | abbreviation — repetitive in test helpers |

## Crate ownership moves (top 5)

**1. `aeqi-orchestrator/src/tools.rs` → split: `AgentsTool`/`IdeasTool`/`QuestsTool` to `aeqi-tools`**
These are LLM-invocable tools implementing the `Tool` trait — exactly `aeqi-tools`' stated purpose. They currently live in `aeqi-orchestrator` because they need `AgentRegistry`, `IdeaStore`, and `QuestBoard` at construction time, but so do the `runtime_tools/` already there. Extracting them into `aeqi-tools` with dependency injection would keep orchestrator as the wiring layer and tools as the leaf implementations.

**2. `aeqi-orchestrator/src/idea_assembly.rs` → `aeqi-ideas` (or a new `aeqi-context` crate)**
Idea assembly is the act of querying an `IdeaStore` and concatenating results — logically a capability of the ideas domain, not the orchestrator. The only orchestrator-specific tie is `EventPatternDispatcher`; that block could stay in orchestrator while the pure assembly functions move to `aeqi-ideas`.

**3. `aeqi-orchestrator/src/agent_registry.rs` (`ConnectionPool`) → `aeqi-core` or extracted crate**
`ConnectionPool` is a generic SQLite connection pool with zero orchestration logic. It is used by both `AgentRegistry` and `SessionStore`. Moving it to `aeqi-core` (or a tiny `aeqi-sqlite` crate) would break the circular feeling of session storage depending on the agent registry crate just for a pool type.

**4. `aeqi-orchestrator/src/middleware/mod.rs` (`WorkerContext`, `MiddlewareChain`) → `aeqi-core`**
`WorkerContext` and `Middleware` are the core abstractions for every agent execution step. They have no orchestrator-specific dependencies yet live inside the orchestrator. Agents in `aeqi-core` construct execution contexts; the trait definitions belong there.

**5. `aeqi-graph/src/analysis/synthesis.rs` (`SynthesizedPrompt`) → rename + remove public re-export from `aeqi-graph::lib`**
`SynthesizedPrompt` is only used internally in graph analysis tests. Its public re-export from `aeqi_graph::lib` leaks "prompt" vocabulary into the public API. Rename to `GraphSummary` and restrict visibility.

## UI primitives to extract

The component library (`apps/ui/src/components/ui/`) has: Button, Badge, Card, Input, Modal, Panel, Tabs, Textarea, Tooltip, Spinner, TagList, ProgressBar, DataState, EmptyState, ErrorBoundary, DetailField, HeroStats, IconButton, ThinkingDot, TokenTable. It is missing:

**Missing: `<Select>` / native `<select>` wrapper.** Raw `<select>` appears in at least 7 places — `AgentEventsTab.tsx:397`, `AgentQuestsTab.tsx:301,315,638,650`, `IdeaCanvas.tsx:505`, `TestTriggerPanel.tsx:158` — each with ad-hoc class names. A `<Select>` primitive wrapping the native element with consistent styling and aria would eliminate this scatter.

**Missing: `<Combobox>` / searchable picker.** `ModelPicker.tsx` (426 lines) hand-rolls a full searchable combobox: open/close state, outside-click dismissal, keyboard navigation, filtered list, scroll-into-view — all from scratch. `TagsEditor.tsx` implements a second independent combobox. A shared `<Combobox>` primitive replaces both.

**Missing: `<Popover>`.** At least three components build identical floating-panel patterns with `position: absolute`, `zIndex: 20`, `boxShadow: var(--shadow-popover)`, and `useRef` + `mousedown` outside-click logic: `ModelPicker.tsx:148–157`, `EventEditor.tsx:232–243`, `ToolCallRow.tsx:85–96`, `IdeaCanvas.tsx:552–592`. A `<Popover>` (or headless `usePopover` hook) would consolidate this duplicated code.

**Missing: `<Menu>` / action list.** `IdeaCanvas.tsx:593` builds a `role="menu"` / `role="menuitem"` pattern manually with a kebab trigger and confirmation state. No `<Menu>` primitive exists.

**Missing: `<Toolbar>` / `<ActionGroup>`.** `AgentPage.tsx`, `AgentIdeasTab.tsx`, and `AgentQuestsTab.tsx` each render rows of icon buttons with hover tooltips directly, without a shared container. Spacing, gap, and active-state styles diverge.

## Recommended next actions (priority order)

1. **Split `aeqi-core/src/agent.rs`** — extract `run_compaction_pipeline`, `build_step_context`, `call_streaming_with_tools`, and `persist_tool_result` into their own files under `aeqi-core/src/`; highest-leverage (4320 lines).
2. **Rename prompt-vocabulary types** — `AssembledPrompt` → `AssembledContext`, `AgentPromptConfig` → `AgentSystemConfig`, `SynthesizedPrompt` → `GraphSummary`, `Agent::run(prompt)` → `Agent::run(input)`, `without_initial_prompt_record` → `without_initial_message_record`; search-and-replace safe.
3. **Split `aeqi-orchestrator/src/tools.rs`** — move `AgentsTool`, `IdeasTool`, `QuestsTool` into separate files (or to `aeqi-tools`); reduces orchestrator's scope.
4. **Split `aeqi-web/src/routes/auth.rs`** — split by auth provider (local, Google, GitHub) into `auth/local.rs`, `auth/google.rs`, `auth/github.rs`.
5. **Extract `<Select>`, `<Combobox>`, `<Popover>` UI primitives** — implement once in `components/ui/`, then replace the 7+ raw `<select>` sites and the duplicated popover/combobox code.
6. **Split `aeqi-orchestrator/src/agent_registry.rs`** — extract `ConnectionPool` to a shared location and separate ancestry/visibility queries from basic CRUD.
7. **Move `WorkerContext` and `Middleware` trait to `aeqi-core`** — gives `aeqi-core` a complete picture of what an agent execution step looks like.
