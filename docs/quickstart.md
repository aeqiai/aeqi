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

Run the setup wizard. It auto-detects your environment: if you're inside a git repo it configures the current workspace, otherwise it writes config to `~/.aeqi/`.

```bash
aeqi setup
```

You'll be prompted for provider keys and basic settings. SQLite databases are created automatically in `~/.aeqi/` -- no external database required.

Set the dashboard auth secret:

```bash
export AEQI_WEB_SECRET=change-me
```

## Start

A single command runs the daemon, web server, and embedded dashboard:

```bash
aeqi start
```

The UI is embedded in the binary via rust-embed. No Node.js or npm needed.

## Open Dashboard

Navigate to `http://127.0.0.1:8400` and authenticate with your `AEQI_WEB_SECRET`.

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
