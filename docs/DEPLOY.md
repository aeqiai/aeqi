# aeqi-indexer — production deployment notes

This doc is a **thinking aid**, not a runbook. The v1 indexer is built for
local Anvil + the v2 cap-table demo. Graduating to a Base mainnet deployment
needs the items below. None of them are written; this is the design space
for whoever picks up production-hardening work.

The HANDOFF.md "Production-readiness checklist" lists the same items
tersely; this doc unpacks each into "what changes, where, and what's the
acceptance criterion."

---

## 1. systemd unit (parity with aeqi-platform.service)

The indexer should mirror the existing aeqi-platform deploy topology —
one user-mode systemd unit per node, journald for logs, restart-on-failure.

```ini
# /etc/systemd/system/aeqi-indexer.service
[Unit]
Description=aeqi-indexer (chain → GraphQL)
After=network-online.target
Requires=network-online.target

[Service]
Type=simple
User=aeqi
Group=aeqi
WorkingDirectory=/var/lib/aeqi-indexer
ExecStart=/usr/local/bin/aeqi-indexer
Environment=AEQI_INDEXER_DB=/var/lib/aeqi-indexer/aeqi-indexer.db
Environment=AEQI_INDEXER_PORT=8500
Environment=AEQI_INDEXER_RPC=http://127.0.0.1:8545
EnvironmentFile=-/etc/aeqi-indexer/secrets.env  # AEQI_INDEXER_FACTORY,
                                                 # AEQI_INDEXER_START_BLOCK
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

# Hardening (mirror aeqi-platform.service)
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/aeqi-indexer
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Acceptance: `systemctl restart aeqi-indexer` recovers cleanly; `journalctl
-u aeqi-indexer -f` streams the poll loop logs; the service auto-restarts
within 5s on RPC outage.

---

## 2. Reverse proxy (TLS + path mount)

The indexer serves on `:8500` plain HTTP. Frontend deployments need TLS
and path-mounting under the existing app domain. Nginx snippet:

```nginx
# /etc/nginx/sites-enabled/aeqi-indexer
location /indexer/ {
    rewrite ^/indexer(/.*)$ $1 break;
    proxy_pass http://127.0.0.1:8500;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;

    # GraphiQL playground at GET /indexer/graphql works through this
    # because the proxy strips the prefix; the Schema fetches at
    # /graphql relative to the page.

    # CORS for frontend callsites
    add_header Access-Control-Allow-Origin "https://app.aeqi.ai" always;
    add_header Access-Control-Allow-Methods "GET, POST, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type" always;
    if ($request_method = OPTIONS) {
        return 204;
    }
}
```

Acceptance: `curl https://app.aeqi.ai/indexer/healthz` returns "ok";
GraphiQL playground loads at `https://app.aeqi.ai/indexer/graphql` and
its Schema fetch works.

---

## 3. WebSocket log subscription (drop polling)

The current 2s HTTP polling has tail latency proportional to the poll
interval. alloy supports `eth_subscribe("logs", ...)` via WSS:

```rust
// crates/aeqi-indexer/src/chain.rs (sketch)
use alloy::providers::ProviderBuilder;
use alloy::providers::WsConnect;

let provider = ProviderBuilder::new()
    .connect_pubsub(WsConnect::new(rpc_url))
    .await?;

let filter = Filter::new()
    .from_block(BlockNumberOrTag::Latest)
    .event_signature(sigs);

let mut stream = provider.subscribe_logs(&filter).await?.into_stream();
while let Some(log) = stream.next().await {
    // dispatch (same as HTTP path) + commit_block (same)
}
```

Open questions:
- **Catch-up**: WSS subscriptions are head-only. On boot or reconnect, run
  the existing HTTP poll loop from `highest_committed + 1` to current head,
  THEN switch to WSS for the live tail. Two code paths share the dispatch
  helper.
- **Reconnect**: handle `Stream::Err` with exponential backoff + reset
  `from = highest_committed + 1`.
- **Multi-address dispatch**: `subscribe_logs(filter)` filter is fixed at
  subscription time. For dynamic `watched_addresses`, subscribe to a wide
  topic0 filter (no address filter) on Base — the topic0 set is unique to
  aeqi sigs except ERC20 Transfer (which we want anyway for Token modules).
  Trade-off: extra noise on Base from random ERC20 Transfers; needs an
  in-handler address-watching check.

Acceptance: indexer catches a TrustCreated event within 1s of the tx
landing in a block (vs current 2-12s polling latency).

---

## 4. eth_call backfill for non-event state

The indexer currently sees only on-chain events. Some demo data is in
contract storage and must be fetched via view calls:

| Need | Source | Fetch via |
|---|---|---|
| Current treasury balance per token | `Token.balanceOf(treasury)` | eth_call on Token module |
| Vesting position metadata (beneficiary, cliff, duration) | `Vesting.getPosition(positionId)` | eth_call on Vesting module |
| Module ACL flags resolved | `TRUST.getPermissions(entityId)` | eth_call on TRUST |
| Governance voting power | `Governance.getVotes(account, block)` | eth_call (historical block) |

Pattern: a periodic snapshot job that walks `watched_addresses` of each
kind, calls the relevant view function, and UPSERTs into a snapshot table.

Implementation sketch:
```rust
// crates/aeqi-indexer/src/snapshot.rs (NEW)
pub async fn snapshot_token_balances(provider, db) -> Result<()> {
    let tokens: Vec<Address> = list_token_modules(&db.lock().await)?;
    for token in tokens {
        let holders: Vec<Address> = list_token_holders(&db.lock().await, &token)?;
        for holder in holders {
            // alloy `Token::balanceOf(holder)` → returns U256
            // UPSERT into token_balance_snapshots (token, holder, block, balance)
        }
    }
    Ok(())
}
```

Acceptance: a scheduled tokio task (every N blocks) refreshes the snapshot
tables; GraphQL adds `currentBalance` resolver on `TokenBalance`.

---

## 5. Multi-chain expansion

Indexer currently single-chain. To run against multiple Base + L2 chains:

Two paths:
- **Per-chain DB + per-chain indexer process**: simplest, mirrors
  per-tenant aeqi-host pattern. Each process gets its own
  `AEQI_INDEXER_RPC` + `AEQI_INDEXER_DB`. systemd templated unit:
  `aeqi-indexer@base.service`, `aeqi-indexer@arbitrum.service`.
- **Single DB + chain_id column**: every entity table gets `chain_id INTEGER
  NOT NULL`, every PK extended with chain_id, every GraphQL query gains a
  `chainId` arg. More invasive; useful only if cross-chain queries matter.

Recommendation: per-chain DB. The compositional model (multiple instances
of the same artifact) is cleaner and matches how aeqi-platform handles
per-tenant isolation already.

Acceptance: two indexer processes run side-by-side on the same host
without conflict; apps/ui chooses which `VITE_INDEXER_URL_<chain>` to query.

---

## 6. Prometheus / OpenTelemetry metrics

Operational visibility. The metrics that matter most:

```
aeqi_indexer_head_block             # current Anvil/Base head
aeqi_indexer_committed_block        # highest_committed
aeqi_indexer_lag_blocks             # head - committed (if > confirmation_depth, alert)
aeqi_indexer_dispatch_latency_ms    # histogram per event type
aeqi_indexer_decode_failures_total  # by event type
aeqi_indexer_reorg_unwinds_total
aeqi_indexer_db_size_bytes
aeqi_indexer_graphql_request_duration_ms  # by query name
```

Crate: `prometheus` or `metrics` + `metrics-exporter-prometheus`. Expose
on a separate port (`:8501`) so the metrics scrape doesn't share the
GraphQL listener.

Acceptance: `curl localhost:8501/metrics` returns a valid Prometheus
exposition; Grafana panel showing `aeqi_indexer_lag_blocks` over time
exists in the existing aeqi-platform dashboard.

---

## 7. Health endpoint surfaces lag

Currently `/healthz` returns "ok" unconditionally. Should fail (HTTP 503)
when:
- `head - highest_committed > 2 * confirmation_depth` (poll loop fell behind)
- Last successful commit > 5 minutes ago (poll loop stalled)

That makes it usable as a load-balancer healthcheck and a systemd
`Restart=on-failure` trigger.

Acceptance: `curl http://localhost:8500/healthz` returns 503 when the
poll loop is stuck for 5+ minutes (verified by stopping anvil and
waiting); 200 otherwise.

---

## 8. Token_Transfer filtering on Base mainnet

On Anvil, Token Transfers are scoped to the mock Token modules we deploy.
On Base mainnet, the same `Transfer(address,address,uint256)` topic0 is
emitted by every ERC20 contract — millions of events per day.

The filtering options:
- **Watched-only**: rely on `watched_addresses` filter to reject non-aeqi
  Transfers. This is the v1 design and works correctly. Requires the
  multi-address filter at the subscription level (current architecture).
- **Sample**: index only every Nth Transfer. Loses precision; not
  recommended.
- **Contract-allowlist**: same as watched-only but explicit about which
  Token modules to track.

Recommendation: watched-only. The current architecture already does this
via `watched_addresses`. The only adjustment: ensure the WSS subscription
filter (Section 3) also includes the `address` filter, not just topic0.

---

## Out of scope

- Authentication on the GraphQL endpoint. v1 assumes the indexer is on a
  trusted network or behind a reverse proxy that handles auth. If the
  indexer needs to face the public internet directly, add an
  `AEQI_INDEXER_AUTH_TOKEN` env + a middleware layer.
- Write API: indexer is read-only by design. There is no plan to accept
  user-driven mutations via GraphQL.
- Replication / read replicas: SQLite is single-writer; if write
  throughput becomes a concern (it won't on the polling/dispatch model),
  the answer is per-chain instances, not WAL-mode replication.
