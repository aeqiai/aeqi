# Contributing to aeqi

Thanks for your interest in contributing. aeqi is an agent runtime built on four primitives — agents, ideas, quests, events — and the project welcomes contributions ranging from typo fixes to new providers, gates, and tools.

## Reporting Security Issues

Please do **not** open a public issue for security vulnerabilities. Follow the disclosure process in [SECURITY.md](SECURITY.md).

## Ways to Contribute

- **Bug reports.** Open an issue with reproduction steps and the version you're on.
- **Feature requests.** Open an issue describing the use case before opening a PR for non-trivial work.
- **Pull requests.** Fixes, docs improvements, new providers / gates / tools, and test coverage are all welcome.
- **Documentation.** Clarifying examples and fixing broken links are always appreciated.

## Development Setup

Prerequisites:

- Rust (stable, 2024 edition — see `rust-toolchain.toml` if present)
- Node.js 20+ and npm (for the `apps/ui` dashboard)
- `bubblewrap` (`bwrap`) on Linux if you want to test sandboxing locally

Clone and build:

```bash
git clone https://github.com/aeqiai/aeqi
cd aeqi
cp config/aeqi.example.toml config/aeqi.toml   # local only, not committed
npm run ui:install
cargo build
```

First-run init:

```bash
aeqi setup                                # generates config, creates root agent
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi start                                # daemon + dashboard on :8400
```

## Project Layout

```
aeqi-cli/                  CLI binary (entry point)
crates/
  aeqi-core                Agent loop, config, compaction, streaming executor
  aeqi-orchestrator        Daemon, sessions, events, delegation, middleware, budgets
  aeqi-ideas              Ideas store, FTS5, vector search, hybrid ranking, graph
  aeqi-quests             Quest DAG, dependency inference, status machine
  aeqi-providers          OpenRouter, Anthropic, Ollama + cost estimation
  aeqi-tools              Shell, file I/O, git, grep, glob, delegate
  aeqi-web                Axum REST API + WebSocket + embedded SPA
  aeqi-gates              Telegram, Discord, Slack bridges
  aeqi-graph              Code intelligence, parsing, community detection
  aeqi-hosting            Multi-tenant platform, bubblewrap sandboxing
  aeqi-mcp                MCP server exposing primitives to external clients
  aeqi-wallets            Per-agent wallet keys, signing
  aeqi-pack-*             Optional tool packs (GitHub, Slack, Notion, Workspace)
  aeqi-test-support       Shared test helpers
apps/ui/                   React + Vite dashboard
config/                    Example configs
docs/                      User-facing documentation
scripts/                   Install, deploy, and operator scripts
```

## Common Commands

| Area | Command |
| --- | --- |
| Build everything | `cargo build --workspace` |
| Run all Rust tests | `cargo test --workspace` |
| Lint Rust (warnings = errors) | `cargo clippy --workspace -- -D warnings` |
| Format Rust | `cargo fmt --all` |
| UI dev server | `npm run ui:dev` (proxies `/api` to `:8400`) |
| UI production build | `npm run ui:build` |
| UI type check | `npm --prefix apps/ui run check` |
| UI tests | `npm --prefix apps/ui test` |

## Pre-commit Hook

The repo ships a husky-managed pre-commit hook in `.husky/pre-commit`. It runs UI checks (typecheck, lint, vitest) **only when files under `apps/ui/` are staged**, so Rust-only commits stay fast.

The full Rust suite (`fmt`, `clippy -- -D warnings`, `test --workspace`) is enforced in CI on every push and pull request — please run these locally before opening a PR.

To install the hooks after cloning:

```bash
npm install   # at the repo root, runs husky's install script
```

## Pull Requests

1. Fork the repo and create a topic branch from `main`.
2. Make your changes. Keep the diff focused — one concern per PR.
3. Run the local checks above and make sure they pass.
4. Push and open a PR against `main`.
5. CI must be green before merge.

If your change touches public behavior, please update the relevant docs under `docs/` and any examples in the README.

## Commit Messages

We use lightweight Conventional Commits:

```
<type>(<scope>): <short imperative summary>

<optional body — explain the why, not the what>
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style(ui)`.
Common scopes: `ui`, `ideas`, `quests`, `events`, `agents`, `providers`, `gates`, `web`, `core`.

Keep the summary under 70 characters.

## Coding Standards

- Zero clippy lints, zero warnings on `cargo build`.
- No `#[allow(dead_code)]` without a justifying comment.
- Use `spawn_blocking` for SQLite operations in async contexts.
- No backward-compatibility aliases or stubs — delete dead code rather than commenting it out.
- Frontend: Prettier-enforced (double quotes, trailing commas, 100-column wrap).

## Adding a Provider, Gate, or Tool

- **Provider** — implement `Provider` in `crates/aeqi-providers`, wire into the registry, add cost-estimation rows.
- **Gate** — implement `Channel` in `crates/aeqi-gates` for any messaging platform.
- **Tool** — implement `Tool` and register it on the orchestrator's `ToolRegistry` with a `CallerKind` ACL.
- **Middleware** — implement `Middleware` with ordered hook points and add to the chain.

Each new component should ship with at least one integration test and an example config snippet.

## Releasing

Releases are cut from `main` and published as GitHub Releases. Per-release commit detail and binaries live there.

## Questions

Open an issue or start a discussion. We're happy to help new contributors get oriented.
