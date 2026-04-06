# AEQI Platform Architecture — Deploy, Multi-Tenant SaaS, and Open-Source Kernel

## The Situation We Found

### What existed
AEQI already had most of the infrastructure for a production platform, but the pieces weren't connected:

- **aeqi-platform (aeqi-cloud)** — A Rust/Axum control plane that spawns Docker containers per tenant, manages ports (8401-8500), enforces resource limits (512MB RAM, 512 CPU shares), runs health checks, and drops all Linux capabilities. Production-grade container orchestration already working.
- **aeqi-daemon** — An agent orchestration engine with a registry, scheduler (10 concurrent workers), trigger system, session management, and IPC socket. Agents for riftdecks, entity-legal, and unifutures already registered.
- **23+ systemd services** — aeqi-app, riftdecks, entity-legal, gacha-agency, algostaking (18 services across dev/prod), all running behind nginx reverse proxy with SSL.
- **Nginx** — 20+ site configs, Let's Encrypt SSL, WebSocket proxying, rate limiting, static asset caching.

### What was missing
One thing: **the bridge between "git push" and "code goes live."**

Every deploy was manual SSH → git pull → npm run build → systemctl restart. No CI/CD, no webhooks, no way to verify what version is running. Pushes to GitHub did nothing on the server.

## What We Built (2026-04-06)

### 1. Deploy Registry
`~/.aeqi/deploy/registry.toml` — a TOML file that maps every project to its build and deploy config:

```toml
[projects.aeqi-app]
path = "/home/claudedev/aeqi-app"
repo = "aeqi-app"
service = "aeqi-app"
build = "npm run build"
health = "http://127.0.0.1:3300/api/health"
port = 3300
```

Seven projects registered: aeqi-app, aeqi-landing, entity-legal, riftdecks, gacha-agency, algostaking-app, unifutures.

### 2. Universal Deploy Script
`~/.aeqi/deploy/deploy.sh` (aliased as `aeqi-deploy`) — handles any project:

```
git pull → detect lockfile changes → npm install → build → systemctl restart → health check
```

Logs every deploy to `~/.aeqi/deploy/logs/`. Handles static sites (rsync to /var/www/) and service-backed apps (systemctl restart). Works for any project in the registry.

### 3. Health Endpoint
`/api/health` on aeqi-app returns:
```json
{"status":"ok","commit":"46564b26","built":"2026-04-06T14:29:15.460Z","uptime":30,"node":"v20.20.0"}
```

This is how we verify a deploy actually landed. The commit hash and build timestamp prove what's running.

### 4. GitHub Webhook Handler
Added to aeqi-platform at `/api/webhooks/deploy`:
- Verifies GitHub HMAC-SHA256 signatures
- Only triggers on pushes to main/master
- Matches repo name to the deploy registry
- Spawns deploy in background, returns 200 immediately
- Logs success/failure to systemd journal

**Result: git push → 65 seconds → live in production. Zero manual steps.**

## Concerns

### Immediate
- **Disk is 96% full** (83GB remaining on 2TB). This is the most urgent infrastructure issue. A full disk will take down everything — builds, containers, databases.
- **Swap pressure** — 3.9GB/4GB swap used. Under heavy load, the system will thrash.
- **Only aeqi-app has the webhook configured.** Other repos need the same webhook added in GitHub settings (same URL, same secret).

### Architectural
- **Single server** — everything runs on one box. One bad deploy can affect all services. No redundancy.
- **No rollback** — the deploy script builds in-place. If a build succeeds but the app crashes at runtime, there's no automatic rollback to the previous version.
- **No build isolation** — builds run on the same machine as production. A memory-heavy build can starve running services.
- **SQLite for everything** — aeqi-platform and aeqi-daemon both use SQLite. Fine for now, but multi-server deployment requires a shared database.

## The Vision: Multi-Tenant SaaS + Open-Source Kernel

### The Two Products

**1. AEQI Open-Source Kernel**
The core AEQI runtime — agent orchestration, tools, memory, sessions — is open source. Anyone can self-host it. They clone the repo, run the daemon, and get their own agent platform. They can build custom agents, connect their own tools, and run everything on their own infrastructure.

This is the dashboard people self-host. It's the local experience. No vendor lock-in.

**2. AEQI Platform (the SaaS)**
For users who don't want to manage infrastructure, AEQI Platform hosts it for them. Each customer gets:

- **A fenced environment** — a Docker container running the AEQI runtime, with isolated storage, its own port, and resource limits. No cross-tenant data access.
- **Agent execution** — agents run inside the container with access to the customer's tools and data only.
- **Persistent storage** — bind-mounted at `/var/lib/aeqi/containers/{company}/`, surviving container restarts.
- **A subdomain or custom domain** — nginx dynamically routes `{company}.aeqi.ai` to the right container port.

This is already partially built. The `ContainerManager` in aeqi-platform creates containers, allocates ports, runs health checks, and enforces security policies. The missing pieces are:

### What's Missing for Full Multi-Tenant SaaS

**A. Dynamic Nginx Configuration**
Currently, each site has a hand-written nginx config. For multi-tenant, nginx needs to route dynamically based on subdomain:

```
{company}.aeqi.ai → 127.0.0.1:{allocated_port}
```

Options:
- **Template-based**: aeqi-platform generates an nginx config file per tenant and reloads nginx
- **Lua/OpenResty**: nginx resolves the port at request time by querying aeqi-platform
- **Traefik/Caddy**: replace nginx with a proxy that supports dynamic backends natively

Recommendation: Start with template-based (simplest, nginx stays). Switch to Traefik when the tenant count exceeds what nginx reload can handle (~100+ tenants).

**B. Custom Domain Support**
Tenants want `agents.theircompany.com` pointing to their container. This requires:
- DNS verification (CNAME to aeqi.ai)
- Automatic SSL via Let's Encrypt / ACME
- nginx SNI routing

**C. Container Image Updates**
When the AEQI runtime gets a new release:
1. Build new `aeqi-runtime:latest` image
2. Rolling restart: stop container → pull new image → start container
3. Health check before marking complete

The ContainerManager already handles create/start/stop. Adding rolling updates is straightforward.

**D. Per-Tenant Git Deployments**
For customers who build apps on the platform (like Vercel):
1. Customer pushes to their repo
2. AEQI builds a container image from their code
3. Deploys to their allocated slot
4. Routes their domain to it

This is Phase 3. It reuses the exact same webhook → deploy pattern we built today, but targets containers instead of systemd services.

### The Fencing Model

```
┌─────────────────────────────────────────────────────┐
│                  AEQI Platform                       │
│              (aeqi-cloud, port 8443)                 │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Tenant A │  │ Tenant B │  │ Tenant C │   ...     │
│  │ :8401    │  │ :8402    │  │ :8403    │          │
│  │          │  │          │  │          │          │
│  │ Runtime  │  │ Runtime  │  │ Runtime  │          │
│  │ Agents   │  │ Agents   │  │ Agents   │          │
│  │ Storage  │  │ Storage  │  │ Storage  │          │
│  │ Tools    │  │ Tools    │  │ Tools    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│       │              │              │               │
│       └──────────────┼──────────────┘               │
│                      │                              │
│              /var/lib/aeqi/containers/              │
│              ├── tenant-a/                          │
│              ├── tenant-b/                          │
│              └── tenant-c/                          │
└─────────────────────────────────────────────────────┘
```

Each tenant container is:
- **Read-only root filesystem** — no writes to the OS layer
- **All capabilities dropped** — CAP_DROP=ALL
- **No privilege escalation** — no-new-privileges security option
- **Resource-limited** — 512MB RAM, 512 CPU shares (configurable per plan)
- **Network-isolated** — custom Docker bridge, DNS hardened
- **Storage-isolated** — bind mount to `/var/lib/aeqi/containers/{company}/`
- **tmpfs /tmp** — ephemeral scratch space

This is already implemented and running (`aeqi-co-test-company` on port 8401).

### The Path: Single Server → Kubernetes

**Phase 1 (Now) — Single Server, Systemd + Docker**
- Own projects: systemd services, deployed via webhook + deploy script
- Tenant containers: Docker, managed by aeqi-platform
- Capacity: ~100 tenants (port range 8401-8500)
- Works today. No new infrastructure needed.

**Phase 2 (Scale) — Single Server, Container-Only**
- Migrate own projects (aeqi-app, riftdecks, etc.) into containers too
- Everything is a container, managed by aeqi-platform
- Unified monitoring, logging, resource management
- Deploy script targets container restart instead of systemctl

**Phase 3 (Multi-Server) — Kubernetes**
- aeqi-platform becomes a k8s operator
- Each tenant gets a namespace or pod
- Container definitions translate directly to k8s manifests
- Horizontal scaling, multi-region, rolling updates
- The deploy webhook stays the same — it just calls k8s API instead of Docker API

The architecture is designed so that **nothing changes conceptually** between phases. A "tenant" is always a fenced runtime with storage, agents, and a network endpoint. The backing infrastructure swaps out underneath.

## How It Should Work (End State)

### For us (AEQI team)
```
git push → GitHub webhook → aeqi-platform → deploy → live in 60s
```
All our projects (aeqi-app, riftdecks, entity-legal, unifutures, algostaking, gacha-agency) auto-deploy on push. No SSH, no manual builds. The deploy registry is the source of truth.

### For customers (self-hosted)
```
git clone aeqi/runtime → configure → run daemon → open dashboard
```
Full agent platform on their own hardware. Open source kernel, no platform dependency.

### For customers (hosted on AEQI Platform)
```
sign up → create company → container spawns → agents run → data stays fenced
```
Managed infrastructure. Their agents, their data, our operations. They get a dashboard at `{company}.aeqi.ai` backed by an isolated container with persistent storage.

### For customers (building apps on AEQI)
```
connect repo → push code → AEQI builds + deploys → live at their domain
```
Vercel-like experience powered by the same webhook + deploy infrastructure. Their app runs in a container, served by AEQI's proxy layer. They edit code, push, it's live.

## Summary

The deploy system built today solves the immediate problem (manual deploys) and establishes the pattern for everything else. The webhook handler, deploy registry, and health verification are the primitives that scale from "my own websites" to "hosting customer apps."

The multi-tenant container infrastructure already exists in aeqi-platform. The fencing (security, isolation, resource limits) is already implemented. What remains is dynamic routing (nginx config generation), custom domains (ACME/SSL automation), and the self-service UI for customers to manage their environments.

AEQI is not just using CI/CD. AEQI is the CI/CD.
