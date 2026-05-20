# Deployment

AEQI runtime deployment is simple by design: one binary, embedded dashboard,
local runtime databases, and an HTTP/WebSocket API.

This document covers the runtime in this repository. Hosted accounts, billing,
fleet provisioning, and managed placement belong to `aeqi-platform`.

## Architecture

```
                  +-----------------------+
   browser  --->  |  reverse proxy (TLS)  |
                  +-----------+-----------+
                              |
                  +-----------v-----------+
                  |       aeqi start      |
                  |  daemon + API + UI    |
                  +-----------+-----------+
                              |
                  +-----------v-----------+
                  |   runtime data dir    |
                  |  SQLite + secrets     |
                  +-----------------------+
```

`aeqi start` launches the daemon and web server in a single process. The web
server serves both `/api` and the embedded dashboard UI. No separate frontend
host is required.

## Build Or Install

Install a published binary:

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
install -m 755 target/release/aeqi /usr/local/bin/aeqi
```

## First Runtime

```bash
aeqi setup
aeqi secrets set OPENROUTER_API_KEY <key>
aeqi doctor --strict
aeqi start
```

`aeqi setup` writes config and prints the dashboard secret. Keep that secret
private.

## systemd

For most servers, run the single process under systemd:

```ini
[Unit]
Description=AEQI runtime
After=network.target

[Service]
Type=simple
User=aeqi
Group=aeqi
Environment=AEQI_CONFIG=/var/lib/aeqi/config/aeqi.toml
ExecStart=/usr/local/bin/aeqi start
Restart=on-failure
RestartSec=5
WorkingDirectory=/var/lib/aeqi
ReadWritePaths=/var/lib/aeqi

[Install]
WantedBy=multi-user.target
```

Create the user and directories:

```bash
sudo useradd --system --home /var/lib/aeqi --shell /usr/sbin/nologin aeqi
sudo install -d -o aeqi -g aeqi /var/lib/aeqi /var/lib/aeqi/config
```

Run `aeqi setup` once as the same user, or copy a reviewed config into
`/var/lib/aeqi/config/aeqi.toml`.

## Reverse Proxy

AEQI binds to the address in `[web].bind`, commonly `127.0.0.1:8400` behind a
TLS reverse proxy.

### Caddy

```caddy
aeqi.example.com {
    reverse_proxy 127.0.0.1:8400
}
```

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name aeqi.example.com;
    client_max_body_size 50m;

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

The `Upgrade` and `Connection` headers are required for dashboard WebSocket
traffic.

## Docker Compose

The root Compose file is a runtime convenience, not a hosted platform stack.
Provide `config/aeqi.toml` before starting it:

```bash
cp config/aeqi.example.toml config/aeqi.toml
# edit config/aeqi.toml
docker compose up --build
```

The container maps port `8400` and stores runtime data in the `aeqi-data`
volume.

## Updating

For binary installs:

1. Install or build the new `aeqi` binary.
2. Run `aeqi doctor --strict` with the deployed config.
3. Restart the service.
4. Check logs and open the dashboard.

SQLite runtime migrations run automatically on startup.
