# VPS Dogfood Run — 2026-05-04

**VPS**: cx23, nbg1, server_id=129140270, IP=91.98.67.97  
**Runtime**: aeqi 0.15.0  
**Tier used**: cx23 (trial/non-company), EUR 0.0076/hr  
**Total uptime**: ~6 minutes  
**Estimated cost**: < EUR 0.001  

---

## Timing breakdown

| Event | Wall time (UTC) | Elapsed from create |
|-------|-----------------|---------------------|
| Admin spawn-test call | 22:12:14Z | t=0 |
| Hetzner create_server API response | 22:12:14Z | +0.15s |
| VPS status = `running` | 22:12:30Z | +16s |
| Health check passed (GET /api/health) | 22:13:08Z | +54s |
| Root agent creation attempted | 22:13:08Z | +54s |
| Agent spawn (manual, with workaround) | 22:15:28Z | +134s |
| First message sent | 22:17:02Z | ~+168s |
| Agent response received | 22:17:16Z | +302s |
| VPS destroyed | 22:18:19Z | +365s |

---

## What worked

1. **Hetzner provisioning path is fast.** cx23 in nbg1: API call returns 150ms; server transitions `starting`→`running` in 16 seconds; cloud-init + aeqi binary download + service start completes in 54s total. This is excellent — under 1 minute to a health-checked runtime.

2. **Cloud-init script is correct.** The aeqi.toml is written correctly with `[web.auth] mode = "none"`, the correct entity_id as agent name, and the right OpenRouter key and data dir. systemd unit fires and stays up.

3. **Agent works end-to-end once manually unblocked.** After injecting `X-Forwarded-For: 1.2.3.4` to bypass the rate-limiter bug, agent spawn and response work correctly. deepseek/deepseek-v3.2 responded with a coherent capability summary.

4. **Admin spawn-test endpoint fires correctly.** Background task launch, tier mapping, and Hetzner integration are all wired correctly from the admin API perspective.

5. **Hetzner delete API works cleanly.** Server gone within seconds, confirmed `not_found` on next poll.

---

## What failed (bugs blocking real users)

### P0 Bug 1 — `aeqi-web` rate limiter 500s on ALL API calls

**File**: `/home/claudedev/aeqi/crates/aeqi-web/src/server.rs` line 233  
**Symptom**: Every API call except `/api/health` returns HTTP 500 `Unable To Extract Key!`  
**Root cause**: `axum::serve(listener, app).await?` must be `axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?`. Without `ConnectInfo`, `tower_governor`'s `SmartIpKeyExtractor` cannot extract the peer address and throws `GovernorError::UnableToExtractKey`.  
**Affected**: ALL VPS runtimes AND sandbox runtimes. The sandbox runtimes work around this only because the platform's `internal_runtime_client()` already injects `X-Forwarded-For: 127.0.0.1`. Remote VPS runtimes have no such workaround from outside.  
**Impact**: A new user who lands directly on their VPS's port 8400 (or whose platform calls don't go through `internal_runtime_client`) sees nothing but 500s.

**Fix**:
```rust
// crates/aeqi-web/src/server.rs
use std::net::SocketAddr;
// ...
axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
```

### P0 Bug 2 — `VpsManager::ensure_root_exists` calls wrong endpoint AND uses wrong HTTP client

**File**: `/home/claudedev/aeqi-platform/src/vps.rs` lines 170 and 200  
**Symptom**: `VpsManager::spawn()` fails with `VPS runtime agent list failed with status 500`, then the whole spawn task errors out. Placement lands in `status=failed`.

Two sub-bugs:
1. `GET /api/agents` fails because `self.http` is a plain `reqwest::Client` without `X-Forwarded-For` header (Bug 1 above hits it).
2. `POST /api/agents` (line 200) returns 405 Method Not Allowed — the runtime's agents route has no POST at that path. The correct endpoint is `POST /api/agents/spawn`.

**Fix**:
```rust
// vps.rs: use internal_runtime_client() equivalent (or inject X-Forwarded-For)
// AND change POST endpoint from /api/agents to /api/agents/spawn
// AND the body field name is irrelevant for spawn (name goes in JSON body)
```

The clean fix: extract a `platform_http_client()` in `vps.rs` that mirrors `internal_runtime_client()` (injects `X-Forwarded-For: <cloud_server_ip>`), and change the POST target to `/api/agents/spawn`.

### P1 — Placement stays in `status=failed` after ensure_root_exists failure

When `ensure_root_exists` fails, `set_runtime_placement_status(&entity_for_task, "failed")` is called — but the VPS itself is healthy and running (the Hetzner server is up, aeqi is up, health passes). The platform marks the placement as failed while the VPS keeps billing.

This means: operator must manually call `set_placement_vps()` or delete the Hetzner server. There's no automated cleanup or retry path when `ensure_root_exists` fails post-health-check.

**Fix**: After health check, attempt `set_placement_vps()` even if `ensure_root_exists` fails. Degrade gracefully (warning, not failure). Or wrap `ensure_root_exists` in a retry loop (3 attempts, 5s apart).

### P1 — IPC timeout on first session_send

**Symptom**: First `POST /api/sessions/send` returns `{"error":"IPC request timed out after 10s"}` when the agent hasn't been run yet (cold start).  
**Root cause**: The quest enqueuer needs to start the agent's first execution. On a cold VPS with no prior activity, the first spawn takes >10s.  
**Impact**: The HTTP call returns an error to the caller even though the quest was successfully created and will complete. The caller (and any UI showing this) treats it as a failure.  
**Observation**: Messages are still stored and the agent does respond ~14s later. But the HTTP client gets a 502 with error body.

### P2 — No Steward/greeting agent created

The VPS runtime starts empty (no agents). The `ensure_root_exists` call is the only thing that creates a root agent. There's no Steward agent, no welcome message, no pre-seeded Company structure. The new-user experience on a fresh VPS is a blank slate — 8 global lifecycle ideas (procedures, not visible content), 0 agents until `ensure_root_exists`, 0 quests, 0 sessions.

For comparison, the platform's sandbox flow calls `seed_root_templates()` (via `admin_promote_to_host`) which seeds Blueprint agents, events, and templates. The VPS path skips this entirely.

**Recommendation**: After VPS `ensure_root_exists` succeeds, call the platform's `seed_root_templates()` for the entity (or a new `seed_vps_templates()` helper that uses the VPS's remote address).

### P3 — `admin_vps_spawn_test` requires pre-existing sandbox placement

The admin endpoint for VPS testing requires a `placement_type=sandbox` row to exist before calling. This is correct for the production flow (paid upgrade from trial), but it means the test path requires manual DB insertion. An `admin_vps_spawn_fresh` endpoint that creates the placement + VPS in one call would be more ergonomic for dogfood testing.

---

## Cost

- 1 × cx23 server, nbg1, ~6 minutes
- Hourly rate: EUR 0.0076160
- Estimated charge: EUR 0.00076 (less than 0.1 cent)
- Billing period minimum may be 1 hour; check Hetzner invoice. Actual charge on invoice will be the hourly minimum.

---

## Recommendations before real users see this flow

**Priority 1 (blocks all VPS users):**
1. Fix `aeqi-web/src/server.rs` to use `into_make_service_with_connect_info::<SocketAddr>()` — this unblocks all API calls on VPS runtimes.
2. Fix `vps.rs::ensure_root_exists` to use a client with `X-Forwarded-For` header AND change POST target to `/api/agents/spawn`.

**Priority 2 (bad UX but not blocking):**
3. Make `VpsManager::spawn` tolerate `ensure_root_exists` failure — log warning, set placement to `vps/ready` anyway. VPS is healthy; root agent can be created on first real request.
4. Increase IPC timeout for first session_send on cold-start agents, or queue the response async and return `{ "ok": true, "status": "queued" }` instead of a 10s timeout error.

**Priority 3 (UX gap):**
5. Seed VPS Company with at minimum a Steward agent after provisioning, mirroring the sandbox `seed_root_templates()` path. A new user arriving at an empty company sees nothing.
6. Add admin endpoint `POST /api/admin/vps/spawn-fresh` that creates a test placement + VPS in one call (removes need for manual DB manipulation in dogfood runs).

---

## Surprising positives

- **aeqi binary download speed**: cloud-init fetches from GitHub releases and installs in under 40s on a fresh cx23. No issues with the URL.
- **The agent's first response is coherent and correct**: capability description, formatting, and completeness are all production-quality.
- **Hetzner API reliability**: zero rate-limit hits, all calls responded in < 200ms, delete was instant.
- **No orphan resources**: VPS confirmed deleted, DB row cleaned up, no dangling billables.
