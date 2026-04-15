# Changelog: Claude Code Runtime Parity — 2026-04-15

Source analysis docs used as map:
- `docs/claude-code-vs-aeqi-deep-comparison-2026-04-15.md`
- `docs/agent-loop-parity.md`

Every claim in those docs was verified against `/home/claudedev/aeqi` source before implementation.

---

## 1. Bash-only sibling error cascade

**Problem:** When concurrent tools run during streaming, any tool error — including harmless read/grep failures — cancelled all sibling tools via the `sibling_errored` AtomicBool flag. Claude Code only cascades from bash/shell tools because they have implicit dependency chains; read failures are independent queries that shouldn't kill siblings.

**What changed:**

- `crates/aeqi-core/src/traits/tool.rs` — Added `fn cascades_error_to_siblings(&self) -> bool` to the `Tool` trait, default `false`.
- `crates/aeqi-core/src/streaming_executor.rs` — Added `cascades_error: bool` field to `TrackedTool`. Executor now only sets `sibling_errored` when the erroring tool has `cascades_error == true`. Updated tests: new `CascadingErrorTool` test struct, new `test_cascading_error_cancels_siblings` and `test_non_cascading_error_does_not_cancel_siblings`.
- `crates/aeqi-tools/src/shell.rs` — `ShellTool` returns `true` for `cascades_error_to_siblings()`. Also added `is_concurrent_safe() -> false` (was missing — shell commands should not run concurrently).
- `crates/aeqi-orchestrator/src/tools.rs` — `SandboxedShellTool` returns `true` for `cascades_error_to_siblings()` and `false` for `is_concurrent_safe()`.

**Risk:** Low. Default is `false` (no cascade), so all existing non-shell tools are unaffected. Only shell tools opt in.

**Test coverage:** 7 streaming_executor tests pass including the 2 new ones.

---

## 2. Conversation repair at all compaction boundaries

**Problem:** `repair_tool_pairing()` only ran after `ContextCompacted` transitions. But `ReactiveCompact` (emergency compaction after 413 error) also modifies messages destructively via snip→micro→full compact, and can break tool_use/tool_result pairing. The `ContextLengthRecovery` variant was defined but never assigned anywhere.

**What changed:**

- `crates/aeqi-core/src/agent.rs` — The match pattern for `repair_tool_pairing` now includes `ContextCompacted | ReactiveCompact | SnipCompacted { .. } | FallbackModelSwitch`. Removed unused `ContextLengthRecovery` enum variant.

**Risk:** Low. `repair_tool_pairing` is idempotent — calling it when no dangling pairs exist is a no-op (early return at line 2502). Running it on more transitions is strictly safer.

**Concern to review:** Is `FallbackModelSwitch` actually needed? When fallback triggers, `call_streaming_with_tools` returned `Err`, so no messages were committed from the failed attempt. I included it for defense-in-depth. If you prefer precision over caution, remove it from the match.

---

## 3. Streaming fallback tombstoning

**Problem:** When `call_streaming_with_tools` fails after partial streaming, the frontend has already received `TextDelta` and `ToolStart` events. The backend discards the response, but the frontend doesn't know to discard its partial rendering. Claude Code solves this with tombstoning.

**What changed:**

- `crates/aeqi-core/src/chat_stream.rs` — New `ChatStreamEvent::Tombstone { step: u32, reason: String }` variant.
- `crates/aeqi-core/src/agent.rs` — Tombstone emitted before reactive compact (line ~953) and before fallback model switch (line ~996).
- `aeqi-cli/src/tui/mod.rs` — On `Tombstone`: clears streaming text, pushes status message, resets to `AgentState::Thinking`.
- `crates/aeqi-orchestrator/src/session_manager.rs` — `send_and_collect()` clears accumulated `text` on `Tombstone` so only the final successful attempt's text is returned.
- `apps/ui/src/components/AgentSessionView.tsx` — On `Tombstone`: splices segments back to last step boundary, clears `fullText`, re-renders.

**Risk:** Medium. The Tombstone event is new — any `match` on `ChatStreamEvent` that doesn't have a wildcard arm will fail to compile. I found and fixed all match sites (tui/mod.rs and session_manager.rs had explicit matches; AgentSessionView.tsx had a switch/case). The session_manager.rs match already had a `_ => {}` wildcard but I added an explicit `Tombstone` arm for correct text clearing.

**Concern to review:** The web UI tombstone handler does `segments.splice(lastStep)` which removes everything from the last step marker onward. If a step boundary was never emitted (no `StepStart` before the tombstone), it clears all segments. This matches the intended behavior (discard everything from the failed attempt) but verify it doesn't break multi-step rendering.

---

## 4. Error event emission from agent loop

**Problem:** The agent loop never emitted `ChatStreamEvent::Error` — errors were only logged and reported to `observer.on_error()`. The CLI TUI emitted its own Error events from the outer shell, but the loop itself was silent to stream subscribers.

**What changed:**

- `crates/aeqi-core/src/agent.rs` — Added `self.emit(ChatStreamEvent::Error { message, recoverable: false })` right before `observer.on_error()`, after all automatic recovery (reactive compact + fallback model) is exhausted.

**Risk:** Very low. The Error event was already defined and handled by all frontends. This just makes the loop emit it at the right time.

---

## 5. Live delegation via `agents(action=delegate)`

**Problem:** `delegate.rs` implements direct child-session spawning, but `build_orchestration_tools()` wires `AgentsTool` (hire/retire/list/self only), not `DelegateTool`. The runtime couldn't delegate work in-session. This was identified as a meaningful product gap — Claude Code's subagent tool is truly first-class at runtime.

**What changed:**

- `crates/aeqi-orchestrator/src/tools.rs`:
  - `AgentsTool` struct gains 4 new fields: `session_manager`, `provider`, `session_id`, `project_name`.
  - New `with_delegation()` builder method.
  - New `action_delegate()` method (~80 lines). Routes `to=subagent` or `to=self` to direct child session spawn via `SessionManager.spawn_session()`. Routes other agent names to quest creation on the target agent (with labels including `creator_session_id`).
  - `agents` tool spec updated: `action` enum gains `"delegate"`, new properties `to`, `prompt`, `skill`.
  - New `DelegationContext` struct holding the dependencies for session spawning.
  - `build_orchestration_tools()` gains a `delegation: Option<DelegationContext>` parameter and calls `agents_tool.with_delegation(ctx)` when provided.

- `crates/aeqi-orchestrator/src/session_manager.rs`:
  - `SessionManager` struct gains `self_ref: OnceLock<Weak<SessionManager>>` field.
  - New `set_self_ref(self: &Arc<Self>)` method stores a weak self-reference.
  - `spawn_session()` constructs `DelegationContext` from the weak self-ref and passes it to `build_orchestration_tools`.

- `aeqi-cli/src/cmd/daemon.rs`:
  - Calls `session_manager.set_self_ref()` immediately after `Arc::new(session_manager)`.

**Risk:** Medium.
- The `OnceLock<Weak<Self>>` pattern is safe but unusual. `set_self_ref` must be called once after Arc creation. If not called, delegation gracefully degrades (the agents tool just won't have the delegate action's session-spawn path — quest creation still works).
- `build_orchestration_tools` now takes 8 params instead of 7. Only one call site (session_manager.rs), already updated.
- The `delegate` action's `session_id` is `None` at construction time because the DB session hasn't been created yet. This means `creator_session_id` in quest_created events will be `null` for tool-initiated quests. The IPC path (`ipc/quests.rs:208`) already correctly includes it. Fixing this requires restructuring tool construction to happen after session creation — a larger change.

**Concern to review:** The `action_delegate` code duplicates some logic from `delegate.rs`. I chose this over wiring `DelegateTool` directly because both tools use `name() -> "agents"` and can't coexist in the tool pool. An alternative would be to refactor `DelegateTool` into a library function that both `AgentsTool.action_delegate()` and `DelegateTool.execute()` call. That dedup can happen in a follow-up.

---

## 6. creator_session_id in QuestsTool events

**Problem:** `QuestsTool.action_create()` emitted `quest_created` with `session_id: None` and no `creator_session_id` in the JSON payload. `scheduler.rs:775-813` tries to read `creator_session_id` from that event to route completion notifications back. So tool-created quests never got their completions routed back to the originating session.

**What changed:**

- `crates/aeqi-orchestrator/src/tools.rs`:
  - `QuestsTool` struct gains `session_id: Option<String>` field and `with_session_id()` builder.
  - `action_create()` now passes `self.session_id.as_deref()` as the session_id arg to `activity_log.emit()`, and includes `"creator_session_id": self.session_id` in the JSON payload.

**Risk:** Low. The `session_id` defaults to `None` (same as before). When populated, it enables the scheduler's completion routing. The field is not yet populated at construction time (same chicken-and-egg as change #5).

---

## Files touched

| File | Lines changed | What |
|------|--------------|------|
| `crates/aeqi-core/src/traits/tool.rs` | +8 | New trait method |
| `crates/aeqi-core/src/streaming_executor.rs` | +88 -14 | Cascade flag, new tests |
| `crates/aeqi-core/src/agent.rs` | +28 -6 | Repair match, tombstone, error event |
| `crates/aeqi-core/src/chat_stream.rs` | +7 | Tombstone variant |
| `crates/aeqi-tools/src/shell.rs` | +8 | Cascade + concurrent_safe overrides |
| `crates/aeqi-orchestrator/src/tools.rs` | +224 -12 | Delegation, session_id, DelegationContext |
| `crates/aeqi-orchestrator/src/session_manager.rs` | +29 | self_ref, DelegationContext wiring, tombstone handling |
| `aeqi-cli/src/cmd/daemon.rs` | +1 | set_self_ref call |
| `aeqi-cli/src/tui/mod.rs` | +10 | Tombstone handler |
| `apps/ui/src/components/AgentSessionView.tsx` | +9 | Tombstone handler |

## Checks

- `cargo fmt` — clean
- `cargo clippy --workspace -- -D warnings` — 0 warnings
- `cargo test --workspace` — 772 passed, 0 failed
- `npx tsc --noEmit` (apps/ui) — clean

## What was NOT done

These were identified as high-value in the comparison docs but not implemented:

1. **Prompt cache boundary** (stable prefix + dynamic tail) — Largest architectural change. Requires restructuring how system_prompt is built in session_manager.rs and how provider requests are assembled. High impact on latency/cost.
2. **Mode-specific tool surfaces** — explore/plan/implement/background/coordinator modes with different tool sets per subagent type.
3. **Context collapse** — Persistent structured log as cheap drain before full compact.
4. **Attachment-first dynamic context** — Move memory refresh, file-change notices, execution ideas out of system prompt into attachment-style messages.
5. **Worktree isolation for delegates** — git worktree create/cleanup in spawn_session for parallel delegate safety.
6. **Tool-batch summaries** — Cheap model summarizes tool results to reduce context pressure.
7. **Shell-command stop hooks** — User-configurable post-turn validation (ShellHookObserver).
