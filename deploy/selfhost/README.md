# Self-Host Deployment

This directory is the starting point for operating the AEQI runtime from this
repository on a single host.

The runtime deployment is one `aeqi start` process: daemon, HTTP API,
WebSocket API, embedded dashboard, local SQLite state, and MCP runtime bridge.
It does not install `aeqi-platform`, hosted accounts, billing, public domains,
or fleet placement.

Recommended first pass:

```bash
curl -fsSL https://raw.githubusercontent.com/aeqi-ai/aeqi/main/scripts/install.sh | sh
sudo useradd --system --home /var/lib/aeqi --shell /usr/sbin/nologin aeqi
sudo install -d -o aeqi -g aeqi /var/lib/aeqi /var/lib/aeqi/config /etc/aeqi
sudo -u aeqi env AEQI_CONFIG=/var/lib/aeqi/config/aeqi.toml aeqi setup
sudo install -m 600 -o root -g root runtime.env.example /etc/aeqi/runtime.env
```

Edit `/etc/aeqi/runtime.env`, set `AEQI_WEB_SECRET`, and add one provider key
or configure Ollama in `/var/lib/aeqi/config/aeqi.toml`. Then install the
systemd unit:

```bash
sudo install -m 644 aeqi.service /etc/systemd/system/aeqi.service
sudo systemctl daemon-reload
sudo systemctl enable --now aeqi
sudo systemctl status aeqi
```

Put Caddy, nginx, or another TLS reverse proxy in front of `127.0.0.1:8400`.
Preserve WebSocket upgrade headers.
