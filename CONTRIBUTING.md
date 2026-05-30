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
- Node.js 22+ and npm (for the `apps/ui` dashboard; see `.nvmrc`)
- `bubblewrap` (`bwrap`) on Linux if you want to test sandboxing locally

Clone and build:

```bash
git clone https://github.com/aeqi-ai/aeqi
cd aeqi
scripts/setup-contributor.sh
```

The contributor setup helper verifies Rust, Node.js 22+, and npm, installs UI
dependencies with `npm ci`, builds the UI, then runs `cargo build`. It
deliberately does not run `aeqi setup`, create `.env` files, write secrets,
install services, or create runtime state inside the source checkout.

If your shell is on an older Node, the helper will try `nvm use` from `.nvmrc`
when nvm is installed. For Rust-only work, run
`scripts/setup-contributor.sh --rust-only`. If you are using the source-built
binary before installing it, run commands as `target/debug/aeqi ...` from the
checkout.

First-run init, no API key required. This writes config, seeds a starter
orchestrator agent, and generates a stable dashboard secret:

```bash
ollama pull llama3.1:8b
aeqi setup --runtime ollama_agent
aeqi paths
aeqi doctor --strict
aeqi start
```

For a cloud provider runtime instead, run `aeqi setup`, set
`OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY` with `aeqi secrets set`, then run
`aeqi doctor --strict` before launching.

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
  aeqi-hosting            Local/self-host runtime placement helpers
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

| Area                          | Command                                        |
| ----------------------------- | ---------------------------------------------- |
| Build everything              | `cargo build --workspace`                      |
| Run all Rust tests            | `cargo test --workspace`                       |
| Lint Rust (strict)            | `scripts/rust-strict-lints.sh`                 |
| Format Rust                   | `cargo fmt --all`                              |
| UI dev server                 | `npm run ui:dev` (proxies `/api` to `:8400`)   |
| UI production build           | `npm run ui:build`                             |
| UI type + format check        | `npm --prefix apps/ui run check`               |
| UI full verify                | `npm --prefix apps/ui run verify`              |
| UI design-system audit        | `npm --prefix apps/ui run design-system:audit` |
| UI visual route probe         | `npm run visual:route -- --url /admin`         |
| UI tests                      | `npm --prefix apps/ui test`                    |
| Public surface scan           | `scripts/public-surface-scan.sh`               |

## Pre-commit Hook

The repo ships tracked hooks under `scripts/git-hooks/`. Install them once per
checkout:

```bash
scripts/install-git-hooks.sh
```

The pre-commit hook runs Rust formatting only when staged Rust files change and
runs UI checks only when staged files under `apps/ui/` change, so unrelated
commits stay fast.

The full Rust suite (`scripts/rust-strict-lints.sh`, `test --workspace`) is enforced in CI on every push and pull request. The strict lint script runs `cargo fmt --all --check` plus `cargo clippy --workspace --all-targets --all-features -- -D warnings`, so test/example and feature-gated Rust code are covered. CI also runs `scripts/public-surface-scan.sh`, which blocks internal notes, local workstation paths, private deployment runbooks, and license wording drift from entering the public tree.

## Pre-push Hook

The installed pre-push hook invokes `scripts/ci-local.sh prepush`, which mirrors
the CI fast path: `scripts/public-surface-scan.sh`, `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets --all-features -- -D warnings`, `cargo
+nightly udeps --workspace --all-targets`, `cargo build --workspace`, the
existing-DB runtime startup smoke, and the apps/ui typecheck + prettier check.
Cached run is 2-3 min.

Modes:

- `scripts/ci-local.sh --plan` — machine-readable local/CI tier contract, including CI-only gates
- `scripts/ci-local.sh prepush` — fast pre-push subset
- `scripts/ci-local.sh full` or `FULL=1 scripts/ci-local.sh` — also runs `cargo test --workspace`, `npm --prefix apps/ui run verify`, `smoke-fresh-install.sh`, and `smoke-quickstart-readme.sh`
- `SKIP_UI=1`, `SKIP_UDEPS=1` — local escape hatches when the toolchain is broken

Bypass for genuine emergencies: `git push --no-verify`. If you're tempted to use it, the email you'll get afterwards usually means you shouldn't have.

## UI Visual QA

For UI changes that affect layout, navigation, dense tables, forms, modals,
admin/operator pages, onboarding, settings, or launch-critical flows, capture a
route screenshot before shipping. The probe is intentionally operator-grade, not
a blanket CI gate:

```bash
npm run visual:route -- --url /admin --expect-text "Admin"
```

The script writes a PNG screenshot plus a JSON report with final URL, response
status, body-text sample, console errors, request failures, and assertion
results. It is cheap by default; inspect the image only when the change needs
visual judgment.

Authentication is optional. Pass `--no-auth` for public/login routes, `AEQI_TOKEN`
or `--token` to seed an existing session JWT, or set `AEQI_WEB_SECRET`,
`AEQI_USER_ID`, and `AEQI_EMAIL` to mint a short-lived JWT locally.

## Pull Requests

1. Fork the repo and create a topic branch from `main`.
2. Make your changes. Keep the diff focused — one concern per PR.
3. Run the local checks above and make sure they pass.
4. Push and open a PR against `main`.
5. CI must be green before merge.

If your change touches public behavior, please update the relevant docs under `docs/` and any examples in the README.

Do not commit local operator notes, private deployment scripts, UX walk output,
or production incident logs. Keep those in ignored paths such as `.private/`,
`.observations/`, `notes/`, or local untracked scripts.

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
