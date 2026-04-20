# Overnight Sprint — Agent A handover

Branch: `overnight/a-arch-purge` (based on `main` @ `89bfdbe`)
Worktree used for landing the commit: `/home/claudedev/aeqi-arch-purge/`

## Commits

| hash      | message                                                                              |
| --------- | ------------------------------------------------------------------------------------ |
| `727d29c` | docs: add ARCHITECTURE.md + strip WHAT-comments from agent_registry tests            |

## Files touched

| kind                        | count | paths                                                                 |
| --------------------------- | ----- | --------------------------------------------------------------------- |
| new engineering reference   | 1     | `ARCHITECTURE.md` (23 KB, 10 sections, 3 mermaid diagrams)            |
| purge (comment hygiene)     | 1     | `crates/aeqi-orchestrator/src/agent_registry.rs` (-21 / +2 lines)     |

### ARCHITECTURE.md table of contents

1. Four primitives (agents, events, quests, ideas) — table + mermaid
2. Session lifecycle — birth → spawn → stop, sequence diagram, lifecycle seed patterns
3. Event firing path — pattern match → ToolRegistry → tool_calls → context injection
4. Idea assembly / injection lifecycle — priority ordering, budgeting, three scopes
5. Tool-call ACL path — `CallerKind` (Llm / Event / System), precedence, sequence diagram
6. Channels — WhatsApp Baileys, Telegram, Twilio, inbound + outbound flow
7. Data stores — `sessions.db`, `aeqi.db`, worktrees, codegraph/*.db (repo-root `agents.db` flagged as 0-byte stub)
8. Per-tenant / per-company isolation — three layers (systemd slice → systemd-run transient unit → bwrap sandbox)
9. Where-to-look reference table — file:line pointers for every core concept
10. Design invariants

Every claim in ARCHITECTURE.md is anchored to a concrete file:line in the codebase. The
doc was authored against the codebase as it stands at `89bfdbe`.

### agent_registry.rs purge — what was stripped

- Line 214 (was): `// PromptRecord — DELETED. All knowledge/instructions are ideas now.` — dead comment about a struct that was retired; "no comments about removed code" per CLAUDE.md.
- Line 233 (was): `/// A lightweight SQLite connection pool.\n///` — orphaned leading doc line; the struct it described had already been deleted, leaving the comment floating above `RunRecord`.
- 15 test-body `// xxx.` one-liners that just restated what the following `let` / `assert` did (e.g. `// Full name match.` above `resolve_by_hint("analyst")`).
- 2 comments rewritten to WHY-style:
    - `// Filter by parent IS NULL (root agents).` → `// parent IS NULL = root agents only`
    - `// Verify that the paused agent still exists in the full list.` → `// Paused != deleted — still retrievable via get().`

## Functions >250 lines — flagged for main-loop review, NOT auto-broken

| file                                                      | line | fn / item                              | length      |
| --------------------------------------------------------- | ---- | -------------------------------------- | ----------- |
| `crates/aeqi-core/src/agent.rs`                           |  939 | `pub async fn run`                     | ~1141 lines |
| `crates/aeqi-orchestrator/src/daemon.rs`                  |  960 | `async fn handle_socket_connection`    | ~1013 lines |
| `crates/aeqi-orchestrator/src/session_manager.rs`         |  351 | `pub async fn spawn_session`           |  ~899 lines |
| `crates/aeqi-orchestrator/src/event_handler.rs`           |  668 | `fn create_default_lifecycle_events`   |  ~287 lines |
| `crates/aeqi-orchestrator/src/queue_executor.rs`          |  167 | `pub async fn execute`                 |  ~266 lines |

All five are authored hot-paths that have accreted inline control flow over time. Safe
candidates for extraction but each one touches a lot of test surface; leaving that call
to main-loop.

## Test status at completion

Run in isolated worktree at `/home/claudedev/aeqi-arch-purge/` (see caveat below).

- `cargo fmt --all -- --check` — clean
- `cargo clippy --workspace -- -D warnings` — clean
- `cargo test --workspace` — **920+ passed, 0 failed, 1 ignored**
- `cd apps/ui && npx tsc --noEmit` — clean
- `cd apps/ui && npx prettier --check "src/**/*.{ts,tsx,css}"` — clean

Pre-commit hook (`.husky/pre-commit`) is scoped to only fire when `apps/ui/` files are
staged — my commit was rust+docs only so the hook was a deliberate no-op. This matches
how the hook is intended to work for backend-only commits.

## Blockers / caveats

### 1. Sprint co-tenancy in `/home/claudedev/aeqi/` caused file races

Streams B/C/D/E were all running concurrently in the **same primary working tree**
(`/home/claudedev/aeqi/`) based on the background-agent logs. Their edits to
`agent_registry.rs` (e.g. Stream E adding `set_visual_identity`) were racing with mine,
with overwrites happening mid-edit. To get a clean commit, I had to add a separate
worktree at `/home/claudedev/aeqi-arch-purge/` and land the commit there.

Recommendation: future overnight sprints should give each stream its own
`git worktree add` directory up front instead of letting them share one cwd.

### 2. Fresh worktrees need dependency fixup to compile/test

The `aeqi-web` crate uses `rust_embed::Embed` pointed at `../../apps/ui/dist` — a
fresh `git worktree add` doesn't have that folder until the UI is built. Symlinking
it from the main worktree is the fastest workaround; a long-term fix is a build.rs
or feature flag so the crate compiles without a pre-built UI.

Same issue for `bridges/baileys/node_modules` — the `aeqi-gates::bridge` test needs
it to spawn `node bridges/baileys/src/bridge.mjs`. Currently symlinked from main.

### 3. Purge yield was modest

The priority crate files listed in the brief (`daemon.rs`, `session_manager.rs`,
`idea_assembly.rs`, `event_handler.rs`, `aeqi-core/src/agent.rs`) are already
well-commented in WHY-style — previous hygiene passes have clearly done the heavy
lifting. Every comment I read in those files told me *why* a thing was happening
rather than *what* the next line of code was doing. No low-hanging fruit there.

Substantial purge yield was in the `agent_registry.rs` test section, where test
bodies had copy-pasted `// Do X.` markers for every block. That was straightforward
mechanical work.

### 4. One flaky-looking test that is actually environmental

`aeqi_gates::bridge::tests::ping_roundtrip_and_ready_event` panics with
`bridge did not emit ready_bridge event` if `bridges/baileys/node_modules` is missing
in the working tree (because `node bridge.mjs` fails to resolve the `baileys` import
and exits before emitting `ready_bridge`). The test has a `script.exists()` skip
guard but no `node_modules` guard. Worth a follow-up to extend the skip condition.
Not a regression — pure environment fragility.

### 5. Things I did NOT do

- `apps/ui/` was explicitly out of scope (other streams own it).
- `aeqi-web`, `aeqi-gates` crates — not on the priority list, skipped.
- No rewrites of >250-line functions. Flagged only, per brief.
- No push to origin. Branch is local only at `overnight/a-arch-purge`.

## Handover for merge

The branch contains one commit off `main`. Merging is a fast-forward. No conflicts
expected with other stream branches (no files overlap):

- Stream A: `ARCHITECTURE.md` (new), `agent_registry.rs` (comment strips only in
  lines 211-234 and the test section at 2682-2840 of main).
- Stream C/D/E touch `agent_registry.rs` at lines 1184+ (adds `set_visual_identity`) —
  different region, clean three-way merge.
