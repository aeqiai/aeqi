# Quick Start

Get AEQI running locally with the daemon, web server, and dashboard.

## Install

### Option A: Install Script

```bash
curl -fsSL https://raw.githubusercontent.com/aeqiai/aeqi/main/scripts/install.sh | sh
```

### Option B: Build from Source

Requires Rust stable.

```bash
git clone https://github.com/aeqiai/aeqi.git
cd aeqi
cargo build --release
```

The binary is at `target/release/aeqi`.

## Setup

Run setup. It is non-interactive: it detects your environment (workspace if you're inside a git repo, otherwise `~/.aeqi/`), writes a starter `aeqi.toml`, generates a stable dashboard secret in `[web].auth_secret`, and seeds three starter agents (`leader`, `researcher`, `reviewer`) under `agents/`.

```bash
aeqi setup
```

Setup prints the dashboard URL and the generated secret — copy the secret; you'll paste it on the dashboard sign-in screen. SQLite databases are created in `~/.aeqi/` on first daemon boot. No external database required.

Set your provider key (one of):

```bash
aeqi secrets set OPENROUTER_API_KEY <key>
# or
aeqi secrets set ANTHROPIC_API_KEY <key>
# or run an Ollama server locally and re-run `aeqi setup --runtime ollama_agent`
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
