# Quick Start

Get AEQI running locally with the daemon, web server, and dashboard.

This quickstart is for the source-available runtime in this repository. The
hosted SaaS control plane is separate.

## Install

### Option A: Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/aeqi-ai/aeqi/main/scripts/install.sh | sh
```

### Option B: Build from Source

Requires Rust from `rust-toolchain.toml` and Node.js 22+ for the embedded
dashboard assets.

```bash
git clone https://github.com/aeqi-ai/aeqi.git
cd aeqi
npm --prefix apps/ui ci
npm --prefix apps/ui run build
cargo build --release -p aeqi
```

The binary is at `target/release/aeqi`.

## Setup

Run setup. It is non-interactive: it detects your environment (workspace if you're inside a git repo, otherwise `~/.aeqi/`), writes a starter `aeqi.toml`, generates a stable dashboard secret in `[web].auth_secret`, and seeds an `assistant` orchestrator agent under `agents/`.

```bash
aeqi setup
```

Setup prints the dashboard URL and the generated secret — copy the secret; you'll paste it on the dashboard sign-in screen. Runtime SQLite databases are created in `~/.aeqi/` on first daemon boot. No external database is required for the local runtime.

Set your provider key (one of):

```bash
aeqi secrets set OPENROUTER_API_KEY <key>
# or
aeqi secrets set ANTHROPIC_API_KEY <key>
# or run an Ollama server locally and re-run `aeqi setup --runtime ollama_agent`
```

For a no-key local demo, use Ollama from the start:

```bash
ollama pull llama3.1:8b
aeqi setup --runtime ollama_agent
aeqi doctor --strict
aeqi start
```

Verify before launching:

```bash
aeqi doctor --strict
```

## Start

A single command runs the daemon, web server, and embedded dashboard:

```bash
aeqi start
```

`start` prints a readiness summary: dashboard URL, daemon status, provider readiness, and ideas DB path. The UI is embedded in the binary via rust-embed — no Node.js or npm needed.

## Open Dashboard

Navigate to `http://127.0.0.1:8400` and paste the secret printed by `aeqi setup` (also stored in `~/.aeqi/aeqi.toml` under `[web].auth_secret`). To rotate it later, edit that field directly and restart `aeqi start`.

This default is a single-operator dashboard secret, not hosted SaaS account
auth. To run multiple local dashboard users, configure `[web.auth] mode =
"accounts"` with OAuth/SMTP settings in `aeqi.toml`; hosted billing and fleet
account management remain outside this repository.

## Development

For contributors working on the frontend:

```bash
npm run ui:install
npm run ui:build
```

For hot-reload during UI development:

```bash
npm run ui:dev
```

This serves the frontend on `http://127.0.0.1:5173` and proxies `/api/*` to AEQI on `:8400`.

For persistent private servers, continue with [self-hosting.md](self-hosting.md)
and [deployment.md](deployment.md).
