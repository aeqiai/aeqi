# Contributing

Solo dev repo. These notes exist so a future Claude session (or the author six months from now) can get up to speed without archaeology.

Security issues — see [SECURITY.md](SECURITY.md) for private disclosure rather than a public issue.

## Repo Layout

```
aeqi/
  aeqi-cli/          # CLI binary (separate crate at root, not in crates/)
  crates/            # Rust workspace members
    aeqi-core/       # Agent loop, config, compaction, streaming executor, traits
    aeqi-orchestrator/ # Daemon, sessions, events, delegation, middleware, budgets
    aeqi-ideas/      # SQLite+FTS5, vector search, hybrid ranking, knowledge graph
    aeqi-quests/     # Quest DAG, dependency inference, status machine
    aeqi-providers/  # OpenRouter, Anthropic, Ollama + cost estimation
    aeqi-tools/      # Shell, file I/O, git, grep, glob, delegate tools
    aeqi-web/        # Axum REST API + WebSocket + embedded SPA
    aeqi-gates/      # Telegram, Discord, Slack bridges
    aeqi-graph/      # Code intelligence: parsing, community detection, impact analysis
    aeqi-hosting/    # Multi-tenant platform, bubblewrap sandboxing
    aeqi-test-support/ # Shared test helpers
  apps/
    ui/              # React 19 + Vite + TypeScript dashboard (see apps/ui/README.md)
  scripts/
    deploy.sh        # Restarts aeqi-runtime.service (:8400) + aeqi-platform.service (:8443)
  config/
    aeqi.example.toml
  docs/              # User-facing documentation
```

## Dev Setup

```bash
cp config/aeqi.example.toml config/aeqi.toml   # local only, not committed
npm run ui:install
cargo build
```

One-time init:

```bash
aeqi setup         # generates config, creates root agent
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi start         # daemon + dashboard on :8400
```

## Common Commands

| Area | Command |
|------|---------|
| Rust build | `cargo build` |
| Rust tests | `cargo test --workspace` |
| Rust lint | `cargo clippy --workspace -- -D warnings` |
| Rust format | `cargo fmt --all` |
| UI dev server | `npm run ui:dev` (proxies `/api` to `:8400`) |
| UI build | `npm run ui:build` |
| UI type check | `cd apps/ui && npx tsc --noEmit` |
| UI format check | `cd apps/ui && npx prettier --check "src/**/*.{ts,tsx,css}"` |

## Pre-Commit Gate

All of these must pass before every commit (enforced by the pre-commit hook):

```bash
cargo fmt
cargo clippy --workspace -- -D warnings
cargo test --workspace
cd apps/ui && npx tsc --noEmit && npx prettier --check "src/**/*.{ts,tsx,css}"
```

## Deploy

```bash
./scripts/deploy.sh
```

Restarts both `aeqi-runtime.service` (port 8400) and `aeqi-platform.service` (port 8443).

## Commit Messages

Lightweight Conventional Commits:

```
<type>(<scope>): <short imperative summary>

<optional body — the "why", not the "what">
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `style(ui)`, `chore`.
Common scopes: `ui`, `ideas`, `quests`, `events`, `agents`, `deploy`, `meta`.
Summary under 70 characters.

## Coding Standards

See [CLAUDE.md](CLAUDE.md) for the full list. Short version:

- Zero warnings, zero clippy lints, no dead code, no backward-compat shims
- `spawn_blocking` for all SQLite ops in async context
- Frontend: Prettier enforced (double quotes, trailing commas, 100 width)
- No `#[allow(dead_code)]` without a comment justifying it

## Four Primitives (ground truth)

- **Agent** — persistent identity in a parent-child tree. DB is source of truth, no agent definition files on disk.
- **Idea** — unified knowledge store. Replaces system prompts, skills, memories. Tags, not categories. Secret redaction runs before persist (`crates/aeqi-ideas/src/redact.rs`).
- **Quest** — structured work unit with DAG dependencies, atomic checkout, and status machine.
- **Event** — reaction rule (schedule / pattern / once / webhook). 6 session lifecycle events ship as globals.

Context is assembled explicitly through events referencing ideas — no silent LLM injection.
