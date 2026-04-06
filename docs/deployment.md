# Deployment

AEQI ships as a single static binary with the dashboard UI embedded via `rust-embed`. SQLite is the only storage dependency. Inter-process communication between the daemon and web server uses a Unix domain socket under `data_dir`.

## Architecture

```
                  +-----------------------+
   browser  --->  |  reverse proxy (TLS)  |
                  +-----------+-----------+
                              |
                  +-----------v-----------+
                  |       aeqi start      |
                  |  (daemon + web + UI)  |
                  +-----------+-----------+
                              |
                  +-----------v-----------+
                  |    ~/.aeqi/aeqi.db    |
                  |    ~/.aeqi/ipc.sock   |
                  +-----------------------+
```

`aeqi start` launches the daemon and web server in a single process. The web server serves both the API (`/api`) and the embedded dashboard UI (all other routes). No separate frontend build or hosting is required.

For production environments that need independent service management (e.g., restart the web layer without interrupting running workers), run them separately:

```
aeqi daemon start   # orchestration, workers, background jobs
aeqi web start      # HTTP API + embedded UI
```

## Production Deployment

### Build

The deploy script at `scripts/deploy.sh` handles the full build:

1. Builds the dashboard UI (`apps/ui`) via npm
2. Compiles the release binary with the UI embedded
3. Restarts systemd services

Run it manually or wire it into your CI:

```bash
./scripts/deploy.sh            # build + restart
./scripts/deploy.sh --no-restart  # build only
```

### systemd -- Single Service

For most deployments, a single service is simplest:

```ini
[Unit]
Description=AEQI
After=network.target

[Service]
ExecStart=/usr/local/bin/aeqi start
User=aeqi
Environment=AEQI_CONFIG=/home/aeqi/config/aeqi.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### systemd -- Split Services

If you need to restart the daemon and web server independently:

```ini
# /etc/systemd/system/aeqi-daemon.service
[Unit]
Description=AEQI Daemon
After=network.target

[Service]
ExecStart=/usr/local/bin/aeqi daemon start
User=aeqi
Environment=AEQI_CONFIG=/home/aeqi/config/aeqi.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/aeqi-web.service
[Unit]
Description=AEQI Web
After=aeqi-daemon.service
Requires=aeqi-daemon.service

[Service]
ExecStart=/usr/local/bin/aeqi web start
User=aeqi
Environment=AEQI_CONFIG=/home/aeqi/config/aeqi.toml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Reverse Proxy

AEQI binds to `0.0.0.0:8400` by default (configurable via `[web].bind`). Put nginx or Caddy in front for TLS termination.

### Caddy

```
aeqi.example.com {
    reverse_proxy localhost:8400
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name aeqi.example.com;

    ssl_certificate     /etc/ssl/certs/aeqi.pem;
    ssl_certificate_key /etc/ssl/private/aeqi.key;

    location / {
        proxy_pass http://127.0.0.1:8400;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `Connection: upgrade` headers are required for WebSocket support on the dashboard.

## Docker

A multi-stage `Dockerfile` and `docker-compose.yml` are included in the repo root.

### docker-compose

```bash
# Place your config at ./config/aeqi.toml, then:
docker compose up -d
```

This builds the image (UI + Rust binary), exposes port 8400, mounts `./config` for configuration, and creates a named volume for `~/.aeqi` data.

### Manual docker build

```bash
docker build -t aeqi .
docker run -d \
  -p 8400:8400 \
  -v ./config:/home/aeqi/config \
  -v aeqi-data:/home/aeqi/.aeqi \
  -e AEQI_CONFIG=/home/aeqi/config/aeqi.toml \
  aeqi
```

The container runs `aeqi start` by default (daemon + web in one process).

## Configuration

Copy `config/aeqi.example.toml` to `config/aeqi.toml` and edit it. Key sections:

| Section | Purpose |
|---|---|
| `[aeqi]` | Instance name, data directory |
| `[providers.*]` | LLM provider API keys and default models |
| `[security]` | Autonomy level, cost limits |
| `[web]` | Bind address, CORS, auth secret |
| `[repos]` | Repository paths agents can access |
| `[[companies]]` | Project definitions, worker limits, execution mode |

### Secrets and environment variables

API keys support `${ENV_VAR}` interpolation in the TOML file. For sensitive values, use AEQI's built-in encrypted secrets store:

```bash
aeqi secrets set OPENROUTER_API_KEY
aeqi secrets set AEQI_WEB_SECRET
```

Point the config at the right file with `AEQI_CONFIG=/path/to/aeqi.toml` or `--config`.

### Embedded UI override

The dashboard is embedded in the binary at compile time. To override it at runtime (useful during frontend development), set:

```toml
[web]
ui_dist_dir = "/absolute/path/to/apps/ui/dist"
```

This is optional and not needed for production.

## Updating

1. Pull the latest source.
2. Run `./scripts/deploy.sh` (builds UI, compiles binary, restarts services).
3. SQLite migrations run automatically on startup.

For Docker deployments:

```bash
docker compose build
docker compose up -d
```
