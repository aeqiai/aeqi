# AGENTS.md

Context for AI coding agents (Claude Code, Codex, Cursor, Aider) working in this repo.

## What this repo is

AEQI is a Rust agent runtime. Four primitives: agents, ideas, quests, events.
Rust workspace (`crates/`) + React UI (`apps/ui/`). SQLite with FTS5 + vector hybrid search.
MCP server exposed as `mcp__aeqi__*` tools when the daemon is running.

## Before you commit

```bash
cargo fmt
cargo clippy --workspace -- -D warnings
cargo test --workspace
cd apps/ui && npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}"
```

All four must pass. The pre-commit hook enforces this.

## Key invariants

- Ideas have `tags: Vec<String>`. There is no `category` field.
- Events carry `pattern + idea_ids + query_template` — they are the only mechanism for context activation. No silent LLM injection.
- Quest owns its worktree. Session owns nothing.
- All SQLite calls in async code use `spawn_blocking`.
- Secret redaction runs before persisting ideas: `crates/aeqi-ideas/src/redact.rs`.
- Deploy: `./scripts/deploy.sh` (restarts two systemd services, not just one).

## Where things live

| What | Where |
|------|-------|
| Agent loop | `crates/aeqi-core/` |
| Daemon + middleware | `crates/aeqi-orchestrator/` |
| Ideas / search | `crates/aeqi-ideas/` |
| Quests | `crates/aeqi-quests/` |
| REST API | `crates/aeqi-web/` |
| CLI binary | `aeqi-cli/` |
| React dashboard | `apps/ui/` |
| Design tokens | `apps/ui/src/styles/primitives.css` |

## MCP tools (when daemon is running)

```
mcp__aeqi__ideas    -- search and store knowledge
mcp__aeqi__quests   -- list and manage work items
mcp__aeqi__agents   -- get agent context and assembled ideas
mcp__aeqi__events   -- list configured events
mcp__aeqi__code     -- code intelligence queries
```

## Coding standards

See [CLAUDE.md](CLAUDE.md). Zero warnings, zero clippy lints, no dead code.
