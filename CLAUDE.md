# aeqi

Unopinionated agent runtime. Four primitives: **agents**, **ideas**, **quests**, **events**.

This file is conventions for AI-pair-programming agents (e.g. Claude Code) working
in this repo. Human contributors should start at [README.md](README.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Development Standards

### Before every commit

```
cargo fmt
cargo clippy --workspace -- -D warnings
cargo test --workspace
cd apps/ui && npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}"
```

All must pass before merge. The pre-commit hook only enforces the UI subset
when `apps/ui` files are staged; Rust checks remain a manual/CI responsibility.

### Code quality

- Zero warnings, zero clippy lints, zero unused variables
- No backward compatibility aliases, stubs, or dead code
- No comments about removed code
- No `#[allow(dead_code)]` unless justified
- Use `spawn_blocking` for all SQLite operations in async context

### Frontend

- Prettier enforced (double quotes, trailing commas, 100 width)
- Components extracted to own files (no 500-line monoliths)
- Path-based routing: `/agents/:id/:tab/:itemId`
- Reuse `asv-sidebar` / `asv-main` pattern for split layouts
- Design system: `apps/ui/src/styles/primitives.css` for tokens

### Architecture

- Events = pattern + tool_calls (Vec<ToolCall>). 7 lifecycle seeds:
  session:start, session:quest_start, session:quest_end, session:quest_result,
  session:step_start, session:stopped, context:budget:exceeded. session:start
  fires once at session birth (like a system prompt); session:execution_start
  fires every spawn (resume or fresh).
- ToolRegistry unifies LLM-fired and event-fired tool calls with CallerKind
  (Llm/Event/System) ACLs.
- Middleware detectors fire patterns (loop:detected, guardrail:violation,
  graph_guardrail:high_impact, shell:command_failed); events own the response
  via tool_calls; DEFAULT_HANDLERS preserve old behavior as fallback.
- Compaction-as-delegation: context:budget:exceeded fires session.spawn
  (lightweight ephemeral compactor session) + transcript.replace_middle.
  Current session_id preserved. Inline compaction pipeline is fallback when no
  PatternDispatcher.
- Legacy event fields (idea_ids, query_template, query_top_k, query_tag_filter)
  remain as fallback when tool_calls is empty.
- Ideas have tags (Vec<String>), no category field
- Quest owns worktree. Session owns nothing. Execution owns one turn.
- Every execution is ephemeral: one turn per spawn. The agent task exits on
  Complete. The next user/transport/scheduler trigger INSERTs into
  `pending_messages`, a fresh spawn starts. No parked agents, no mpsc input
  channels.
- Every execution in bwrap (when available)
- Auto-commit at end of turn in quest worktrees
- Tools configurable per agent via tool_deny

### Deploy

```
./scripts/deploy.sh
```
