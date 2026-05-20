# Self-Hosting

This document is intentionally conservative. It describes what this repository
actually ships today.

`aeqi` is the source-available runtime: one binary, local runtime databases,
embedded dashboard, API/WebSocket server, MCP server, and agent execution.

`aeqi-platform` is separate: hosted accounts, billing, provisioning, domains,
fleet runtime placement, and hosted admin operations. Do not expect this repo to
stand up the hosted SaaS control plane.

## Recommended Path

Use the binary path first:

```bash
curl -fsSL https://raw.githubusercontent.com/aeqi-ai/aeqi/main/scripts/install.sh | sh
aeqi setup
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi doctor --strict
aeqi start
```

Open `http://127.0.0.1:8400` and use the dashboard secret printed by
`aeqi setup`.

For a private server, run the same binary under systemd and put Caddy or nginx
in front for TLS. See [deployment.md](deployment.md).

## Authentication Model

The default self-host path uses `mode = "secret"` dashboard auth. `aeqi setup`
generates `[web].auth_secret`, prints it once, and stores it in the runtime
config. Anyone with that secret can sign in as the local operator, so treat it
like a password.

For persistent servers, set `AEQI_WEB_SECRET` in the service environment or
store a reviewed `[web].auth_secret` in `aeqi.toml`. `AEQI_WEB_SECRET` wins over
the config file. Do not commit either value.

Multi-user local dashboard auth is available through `[web.auth] mode =
"accounts"`, backed by `accounts.db`. It requires explicit OAuth and/or SMTP
configuration. The hosted AEQI account system, billing, public domains, and
runtime fleet placement are part of `aeqi-platform`, not this repository.

## Data Model

The runtime stores local state in SQLite databases under the configured data
directory, usually `~/.aeqi`.

Important files:

| Path          | Contents                                                                |
| ------------- | ----------------------------------------------------------------------- |
| `aeqi.db`     | agents, ideas, events, roles, credentials, budgets, entities, templates |
| `sessions.db` | sessions, messages, runs, quests, journal state                         |
| `accounts.db` | local web account state when account auth is enabled                    |
| `secrets/`    | encrypted local secrets                                                 |

Back up the whole data directory. Do not mutate the SQLite files behind the
runtime while it is running.

## Docker Compose

The root `docker-compose.yml` is a configured-runtime convenience. It builds the
runtime image from this repository, maps port `8400`, mounts `./config` at
`/home/aeqi/config`, and stores runtime data in the `aeqi-data` volume.

It is not a one-command hosted platform installer. Before starting it, provide a
runtime config at `config/aeqi.toml`. For provider and web secrets, either copy
`.env.example` to `.env` for Compose interpolation or set the variables in your
shell.

```bash
cp config/aeqi.example.toml config/aeqi.toml
# edit config/aeqi.toml for your provider and web settings
docker compose up --build
```

For most users, `aeqi setup && aeqi start` is still simpler and more transparent.

## Production Checklist

- Run as a dedicated Unix user.
- Keep the data directory outside the application checkout.
- Set provider secrets with `aeqi secrets set ...` or environment-variable
  interpolation in config.
- Put TLS in front with Caddy, nginx, or another reverse proxy.
- Preserve WebSocket upgrade headers.
- Back up the full runtime data directory.
- Run `aeqi doctor --strict` after config changes and before restarts.
- Pin release versions in serious deployments.
- Watch service logs after upgrades.

## What Not To Assume

- This repo does not include hosted billing, hosted account management, or fleet
  provisioning.
- Docker Compose here does not create a multi-tenant SaaS platform.
- The Solana trust workspace is active protocol work, but it is not required to
  start the local runtime.
- The BSL license is source-available; it is not OSI-approved.
