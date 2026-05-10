# aeqi

[![CI](https://github.com/aeqi-ai/aeqi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aeqi-ai/aeqi/actions/workflows/ci.yml)
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue.svg)](LICENSE)
[![Rust 2024](https://img.shields.io/badge/Rust-2024-black)](Cargo.toml)

AEQI is a source-available agent runtime for running persistent agents, their
knowledge, their work queues, and their event handlers from one local or
self-hosted binary. The runtime is built around four primitives: agents, ideas,
quests, and events.

The repository contains the Rust runtime, CLI, daemon, HTTP/WebSocket server,
embedded React dashboard, provider integrations, tool packs, tests, release
workflows, and supporting docs for the runtime. The active protocol work lives
under `projects/aeqi-solana`.

## Status and License

AEQI is under active development. Treat the runtime interfaces as usable but not
yet a compatibility commitment unless a file, command, or API is explicitly
covered by tests or release notes.

The licensed work is published under the [Business Source License 1.1](LICENSE).
The additional use grant permits production use except for offering AEQI to
third parties on a hosted or embedded basis in a way that competes with the
licensor's paid versions. The change license is Apache 2.0 on April 5, 2030.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `aeqi-cli/` | `aeqi` binary: CLI, daemon entrypoint, setup, doctor, TUI chat, and web startup |
| `crates/` | Rust workspace crates for the runtime, orchestration, storage, providers, tools, web API, MCP, graph indexing, wallets, and integration packs |
| `apps/ui/` | React/Vite dashboard embedded into the release binary by default |
| `bridges/` | Node bridge package for channel gateway work |
| `config/` | Example runtime configuration |
| `docs/` | User, architecture, security, and design documentation |
| `agents/` | Historical starter agent presets and notes about the database-backed agent model |
| `presets/` | Bootstrap and blueprint seed data used by setup and starter flows |
| `packages/` | Shared TypeScript packages used by the UI |
| `projects/aeqi-solana/` | Solana program workspace and indexer work |
| `scripts/` | Install, smoke-test, security, dependency, and public-surface scripts |
| `.github/` | CI, release workflow, issue templates, and repository policy files |
| `deploy/` | Example systemd units for deployable services |

Ignored local artifacts such as `target/`, `node_modules/`, `.aeqi/`,
`.observations/`, `notes/`, and `tmp/` are intentionally outside the public
source surface.

## Quick Start

Install the latest published binary for Linux amd64 or macOS arm64:

```bash
curl -fsSL https://raw.githubusercontent.com/aeqi-ai/aeqi/main/scripts/install.sh | sh
```

Or build from source:

```bash
git clone https://github.com/aeqi-ai/aeqi.git
cd aeqi
cargo build --release -p aeqi
```

Initialize a runtime and verify it:

```bash
aeqi setup
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi doctor --strict
aeqi start
```

`aeqi setup` is non-interactive. In a workspace it writes `config/aeqi.toml`;
outside a workspace it writes under `~/.aeqi/`. It also writes starter agent
files, creates a secrets directory, and prints a dashboard secret. `aeqi start`
runs the daemon and web server in one process and serves the dashboard on the
configured bind address, defaulting to port `8400`.

For a local no-provider-key walkthrough, use the Ollama path in
[docs/local-demo.md](docs/local-demo.md).

## CLI Surface

The CLI command definitions live in [aeqi-cli/src/cli.rs](aeqi-cli/src/cli.rs).
Common commands:

| Command | Use |
| --- | --- |
| `aeqi setup` | Write starter config, agents, and dashboard secret |
| `aeqi doctor --strict` | Validate config, agents, provider readiness, and local state |
| `aeqi start` | Start the daemon and embedded dashboard together |
| `aeqi chat` | Open the interactive terminal chat client |
| `aeqi run "<prompt>"` | Run a one-shot agent prompt |
| `aeqi agent list` | List discovered and registered agents |
| `aeqi assign "subject" --root <ROOT>` | Assign a quest to a root agent |
| `aeqi events install-defaults` | Install the standard schedule events on existing agents |
| `aeqi monitor` | Show a consolidated operator monitor view |
| `aeqi graph index --root <ROOT>` | Index a repository into the code graph |
| `aeqi trust derive --entity-id <ENTITY>` | Derive the canonical trust identity for a company or entity |
| `aeqi mcp` | Run the MCP server |

Run `aeqi <command> --help` for the exact flags supported by a local build.

## Runtime Model

AEQI models runtime state with four primitives:

| Primitive | Runtime role |
| --- | --- |
| Agent | Persistent identity in a parent/child tree, with inherited configuration and runtime context |
| Idea | Stored knowledge used for identity, instructions, skills, memory, and retrieval |
| Quest | Structured work item with status, dependencies, assignment, retries, and outcomes |
| Event | Rule that fires on a schedule, pattern, one-time trigger, or webhook and connects runtime activity to ideas or tools |

The daemon coordinates sessions, queued work, event firing, provider calls,
middleware, tool execution, and persistence. The web server exposes the local
dashboard and API over Axum and WebSocket routes, with the UI embedded into the
binary when built with the default `aeqi-web` feature set.

## Workspace Crates

| Crate | Purpose |
| --- | --- |
| `aeqi` | CLI, daemon, and web entrypoint |
| `aeqi-core` | Core types, traits, config, credentials, checkpoints, and execution abstractions |
| `aeqi-orchestrator` | Agent registry, daemon, sessions, events, delegation, middleware, tools, roles, and IPC |
| `aeqi-ideas` | SQLite-backed idea store, FTS, vector search, deduplication, tags, and graph edges |
| `aeqi-quests` | Quest model, DAG handling, dependency inference, and query helpers |
| `aeqi-providers` | OpenRouter, Anthropic, and Ollama provider clients with cost estimation |
| `aeqi-tools` | Built-in shell, file, git, grep, glob, web, prompt, and messaging tools |
| `aeqi-web` | HTTP API, WebSocket server, auth helpers, embedded UI serving, and route layer |
| `aeqi-gates` | Telegram, Discord, Slack, and channel gateway abstractions |
| `aeqi-graph` | Code graph indexing for Rust, TypeScript, and Solidity |
| `aeqi-hosting` | Hosting provider traits and local/managed placement helpers |
| `aeqi-mcp` | MCP integration for exposing runtime capabilities to external clients |
| `aeqi-trust` | Trust kernel primitives for company identity and trust binding |
| `aeqi-wallets` | Wallet custody, signing, passkey, and session-key primitives |
| `aeqi-inference` | OpenAI-compatible inference router and billing lanes |
| `aeqi-ipfs` | Kubo HTTP API client for IPFS storage |
| `aeqi-architect` | Blueprint generator for turning a brief into runtime starter data |
| `aeqi-pack-*` | GitHub, Google Workspace, Notion, and Slack tool packs |
| `aeqi-test-support` | Shared test harnesses and fixtures |

## Storage

By default, runtime data lives under `~/.aeqi`:

| Path | Contents |
| --- | --- |
| `aeqi.db` | Agents, ideas, events, roles, credentials, budgets, entities, and template state |
| `sessions.db` | Sessions, messages, activity, runs, quests, and journal state |
| `accounts.db` | Local web account data when account auth is enabled |
| `codegraph/*.db` | Per-root code graph indexes |
| `rm.sock` | Local daemon IPC socket |
| `secrets/` | Encrypted local secret files used by legacy and migration paths |

## Development

Install frontend dependencies when working on the dashboard:

```bash
npm --prefix apps/ui ci
```

Core checks:

```bash
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
npm --prefix apps/ui run check
npm --prefix apps/ui test
scripts/public-surface-scan.sh
```

The CI workflow runs the public-surface scan, Rust format, clippy, build, tests,
UI checks, UI tests, release smoke tests, and documentation generation. The
quality-gates workflow also runs dependency and security checks.

## Public Surface Rules

This repository is intended to be readable as a public, source-available runtime
repo. Keep public files free of local workstation paths, internal runbooks,
private deployment URLs, incident notes, and license wording drift. The guard for
that is [scripts/public-surface-scan.sh](scripts/public-surface-scan.sh).

Use [CONTRIBUTING.md](CONTRIBUTING.md) for contribution workflow and
[SECURITY.md](SECURITY.md) for private vulnerability disclosure.
