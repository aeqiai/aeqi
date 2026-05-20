# aeqi

[![CI](https://github.com/aeqi-ai/aeqi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/aeqi-ai/aeqi/actions/workflows/ci.yml)
[![Quality Gates](https://github.com/aeqi-ai/aeqi/actions/workflows/quality-gates.yml/badge.svg?branch=main)](https://github.com/aeqi-ai/aeqi/actions/workflows/quality-gates.yml)
[![Release](https://github.com/aeqi-ai/aeqi/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/aeqi-ai/aeqi/actions/workflows/release.yml)
[![License: BSL 1.1](https://img.shields.io/badge/license-BSL%201.1-blue.svg)](LICENSE)
[![Rust 2024](https://img.shields.io/badge/Rust-2024-black)](Cargo.toml)
[![GitHub stars](https://img.shields.io/github/stars/aeqi-ai/aeqi?style=social)](https://github.com/aeqi-ai/aeqi/stargazers)

aeqi is a source-available agent runtime and CLI for running persistent AI
workers, their memory, their work queues, and their event handlers.

You can use the same `aeqi` binary in two modes:

- as a client for an existing hosted TRUST, where the runtime is managed by the
  platform and the CLI/MCP bridge connects you to it.
- as a self-hosted runtime, where `aeqi start` runs the daemon, API, dashboard,
  MCP server, local SQLite state, and event loop yourself.

The runtime is built around four primitives:

| Primitive  | Meaning                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------ |
| **Agents** | Persistent workers with identity, instructions, tools, budgets, and parent/child structure |
| **Ideas**  | Durable memory, notes, instructions, skill records, and retrievable knowledge              |
| **Quests** | Structured work items with assignment, status, dependency, retry, and outcome state        |
| **Events** | Schedules, webhooks, triggers, and runtime hooks that wake agents up                       |

This repository contains the runtime kernel, CLI, daemon, HTTP/WebSocket server,
embedded React dashboard, MCP server, provider integrations, tool packs, tests,
release workflows, and source-available protocol work under
[`projects/aeqi-solana`](projects/aeqi-solana/).

## What Is True Today

| Area            | Current state                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| License         | Business Source License 1.1; source-available today, Apache 2.0 change license on April 5, 2030                                  |
| Install path    | Published binaries for Linux amd64 and macOS arm64; source builds with Rust 2024                                                 |
| Runtime storage | Local SQLite databases under the configured data directory, usually `~/.aeqi`                                                    |
| Dashboard       | Embedded into the `aeqi` binary; no separate frontend host is required for normal use                                            |
| Providers       | OpenRouter, Anthropic, and local Ollama paths exist in the runtime                                                               |
| Self-hosting    | Single-binary/systemd is the recommended path; Docker Compose exists for configured runtime deployments                          |
| Hosted platform | Separate product boundary; this repo's CLI can connect to hosted TRUSTs, but accounts, billing, and fleet placement live outside this repo |
| Protocol work   | Solana trust work is active under `projects/aeqi-solana`; it is not required to run the local runtime                            |

aeqi is under active development. Interfaces are usable, but they are not a
compatibility promise unless covered by tests, release notes, or explicit docs.

## Quick Start

Install the latest published binary:

```bash
curl -fsSL https://raw.githubusercontent.com/aeqi-ai/aeqi/main/scripts/install.sh | sh
```

Or build from source:

```bash
git clone https://github.com/aeqi-ai/aeqi.git
cd aeqi
npm --prefix apps/ui ci
npm --prefix apps/ui run build
cargo build --release -p aeqi
```

Then choose the path you are using.

### Fastest local demo, no API key

Use this when you want to see the local runtime and dashboard before creating a
cloud inference account:

```bash
ollama pull llama3.1:8b
aeqi setup --runtime ollama_agent
aeqi doctor --strict
aeqi start
```

Open `http://127.0.0.1:8400` and sign in with the dashboard secret printed by
`aeqi setup`. If `doctor --strict` reports Ollama as optional/unhealthy, start
Ollama and pull the configured model, then run `aeqi doctor --strict` again.

### Existing hosted TRUST

Use this path when you already have an aeqi account and TRUST. The CLI is
the terminal client; it does not run the hosted runtime on your machine.

```bash
export AEQI_API_KEY=ak_account_xxxxx
export AEQI_API_URL=https://app.aeqi.ai

aeqi chat
```

`aeqi chat` authenticates as your account, lets you select the TRUST
when needed, and opens an interactive session with an agent in that runtime.
From there you can talk to existing agents, create quests, or use the runtime's
memory and work ledger.

For Codex, Claude Code, editors, or other MCP-aware clients, run `aeqi mcp` as a
stdio MCP server:

```json
{
  "mcpServers": {
    "aeqi": {
      "command": "aeqi",
      "args": ["mcp"],
      "env": {
        "AEQI_SECRET_KEY": "sk_trust_xxxxx",
        "AEQI_API_KEY": "ak_account_xxxxx",
        "AEQI_API_URL": "https://app.aeqi.ai"
      }
    }
  }
}
```

In this shape the editor or coding agent is the client, `aeqi mcp` is the tool
bridge, and the hosted TRUST runtime remains the system of record for agents,
ideas, quests, events, and code intelligence. To delegate to an existing agent,
use the MCP `agents`, `quests`, and `ideas` tools. To create a persistent new
agent, use `agents(action="hire", ...)` or the CLI's local `aeqi agent spawn`
flow when working against a self-hosted runtime.

### Self-hosted runtime

Use this path when you want to run the runtime from this repository yourself:

```bash
aeqi setup
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi doctor --strict
aeqi start
```

`aeqi setup` is non-interactive. It writes config, creates a data directory,
seeds starter runtime state, creates a secrets directory, and prints the
dashboard secret. `aeqi start` runs the daemon, HTTP/WebSocket server, and
embedded dashboard in one process, defaulting to `http://127.0.0.1:8400`.

The default dashboard auth mode is single-operator secret auth. Multi-user
account auth exists in the runtime, but a self-host operator must configure
`[web.auth] mode = "accounts"` plus OAuth/SMTP settings intentionally. Hosted
account lifecycle, billing, public domains, and fleet placement are not in this
repository; those belong to `aeqi-platform`.

For a no-cloud-provider walkthrough, use the Ollama path in
[`docs/local-demo.md`](docs/local-demo.md).

Read [`docs/mcp-setup.md`](docs/mcp-setup.md) for the full hosted and
self-hosted MCP setup matrix.

## Self-Host Paths

Use the binary path first unless you specifically need a container image.

| Path                    | Best for                                                                           | Notes                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `aeqi start`            | local evaluation, one-user servers, private runtime hosts                          | Fastest path; one process, embedded UI, local SQLite                                     |
| systemd + reverse proxy | persistent VPS or home-lab deployment                                              | Recommended production shape for this repo                                               |
| Docker Compose          | operators who already provide `config/aeqi.toml` and want an image-managed runtime | Builds from this repo and mounts `/home/aeqi/.aeqi`; it is not the hosted platform stack |
| `aeqi-platform`         | hosted SaaS control plane, account/billing/fleet runtime placement                 | Separate repository and database contract                                                |

Read [`docs/self-hosting.md`](docs/self-hosting.md) for the honest operator
checklist and [`docs/deployment.md`](docs/deployment.md) for systemd and reverse
proxy examples.

## CLI Surface

Run `aeqi <command> --help` for exact flags. Common commands:

| Command                                  | Use                                                                |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `aeqi setup`                             | Write starter config, agents, and dashboard secret                 |
| `aeqi doctor --strict`                   | Validate config, provider readiness, and local state before launch |
| `aeqi start`                             | Start daemon, API, WebSocket server, and dashboard together        |
| `aeqi chat`                              | Open the terminal chat client for local or hosted runtimes         |
| `aeqi run "<prompt>"`                    | Run a one-shot agent prompt                                        |
| `aeqi agent list`                        | List discovered and registered agents in a local runtime           |
| `aeqi agent spawn`                       | Create a persistent local runtime agent                            |
| `aeqi assign "subject" --root <ROOT>`    | Assign a quest to a root agent                                     |
| `aeqi events install-defaults`           | Install the standard schedule events on existing agents            |
| `aeqi monitor`                           | Show an operator monitor view                                      |
| `aeqi graph index --root <ROOT>`         | Index a repository into the code graph                             |
| `aeqi trust derive --entity-id <ENTITY>` | Derive the canonical TRUST identity for a runtime entity id        |
| `aeqi mcp`                               | Run the stdio MCP bridge for local or hosted runtimes              |

## Runtime Model

When self-hosting, the daemon coordinates sessions, queued work, event firing,
provider calls, middleware, tool execution, and persistence. The web server
exposes the local dashboard and API through Axum and WebSocket routes. The UI is
embedded into the release binary by default.

When connecting to a hosted TRUST, the same primitives live in the managed
runtime. The local CLI process is a client and transport: `aeqi chat` opens
terminal sessions, and `aeqi mcp` exposes the runtime tools to MCP-aware
clients.

Default runtime data lives under `~/.aeqi`:

| Path             | Contents                                                                         |
| ---------------- | -------------------------------------------------------------------------------- |
| `aeqi.db`        | Agents, ideas, events, roles, credentials, budgets, entities, and template state |
| `sessions.db`    | Sessions, messages, activity, runs, quests, and journal state                    |
| `accounts.db`    | Local web account data when account auth is enabled                              |
| `codegraph/*.db` | Per-root code graph indexes                                                      |
| `rm.sock`        | Local daemon IPC socket                                                          |
| `secrets/`       | Encrypted local secret files                                                     |

## Repository Layout

| Path                    | Purpose                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `aeqi-cli/`             | `aeqi` binary: CLI, daemon entrypoint, setup, doctor, TUI chat, and web startup                  |
| `crates/`               | Runtime, orchestration, storage, provider, tool, web, MCP, graph, wallet, and integration crates |
| `apps/ui/`              | React/Vite dashboard embedded into the release binary                                            |
| `packages/`             | Shared TypeScript packages used by the UI                                                        |
| `config/`               | Example runtime configuration                                                                    |
| `docs/`                 | User, operator, architecture, security, and design docs                                          |
| `presets/`              | Bootstrap and blueprint seed data                                                                |
| `projects/aeqi-solana/` | Solana program workspace and indexer work                                                        |
| `scripts/`              | Install, smoke-test, security, dependency, and public-surface scripts                            |
| `.github/`              | CI, release workflows, issue templates, and repository policy files                              |
| `deploy/`               | Reference service units for adjacent protocol services                                           |

Ignored local artifacts such as `target/`, `node_modules/`, `.aeqi/`,
`.observations/`, `notes/`, and `tmp/` are intentionally outside the public
source surface.

## Development

Install frontend dependencies when working on the dashboard:

```bash
npm --prefix apps/ui ci
```

Core checks:

```bash
scripts/rust-strict-lints.sh
cargo test --workspace
npm --prefix apps/ui run check
npm --prefix apps/ui run lint
npm --prefix apps/ui test
scripts/public-surface-scan.sh
```

For route-level UI visual QA:

```bash
npm run visual:route -- --url /admin --expect-text "Admin"
```

For local worktree/deploy triage:

```bash
npm run dev:triage
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the contributor workflow and
[`docs/development-workflow.md`](docs/development-workflow.md) for deploy
routing notes. See [`SECURITY.md`](SECURITY.md) for private vulnerability
disclosure.

## Public Repo Hygiene

This is a public source-available runtime repo. Keep public files free of local
workstation paths, private deployment runbooks, incident notes, hidden hosted
service assumptions, and license wording drift. The guard for that is
[`scripts/public-surface-scan.sh`](scripts/public-surface-scan.sh).

Useful starting points:

- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/quickstart.md`](docs/quickstart.md) — first local runtime
- [`docs/mcp-setup.md`](docs/mcp-setup.md) — hosted and self-hosted MCP client setup
- [`docs/self-hosting.md`](docs/self-hosting.md) — self-host operator checklist
- [`docs/runtime-platform-separation.md`](docs/runtime-platform-separation.md) — runtime vs hosted platform boundary
- [`docs/security/configuration.md`](docs/security/configuration.md) — security configuration
- [`docs/roadmap.md`](docs/roadmap.md) — current roadmap

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=aeqi-ai/aeqi&type=Date)](https://www.star-history.com/#aeqi-ai/aeqi&Date)
