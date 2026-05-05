# click-to-DAO smoke test recipe

**Status:** Decided 2026-05-04. The end-to-end recipe to verify the click→DAO bridge from "+ New Company" through registerTRUST + IPFS pin + indexer reads.

**Companion docs:**
- [`aeqi-entity-aa-design.md`](./aeqi-entity-aa-design.md) — what TRUST is and what registerTRUST does
- [`aeqi-economy-plan.md`](./aeqi-economy-plan.md) — sequencing context
- [`aeqi-platform/CLAUDE.md`](../aeqi-platform/CLAUDE.md) — operational diagnostics

## What this verifies

When a user (or agent) creates a Company via `/start/<slug>` or via `POST /api/companies/create` (x402), the platform:

1. Mints an entity_id (UUID)
2. Spawns the per-tenant runtime
3. Generates an operating agreement Markdown + per-role descriptions
4. Pins them to local kubo (IPFS)
5. Constructs a TRUSTConfigRequest with populated RoleRequest[] + RoleTypeConfig[] + ipfsCid (the pinned CID)
6. Calls Factory.registerTRUST on the configured chain
7. Polls the local aeqi-indexer for the resulting TRUST address
8. Writes (trust_id, trust_address, creator_address) onto the runtime_placement row

The recipe walks each link in the chain so a tester can identify exactly where a break is, if any.

## Pre-flight checklist

Before running the smoke, verify all infrastructure is live:

```bash
# 1. anvil running on :8545 with the chain we expect
ss -ltnp | grep ":8545"
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  http://127.0.0.1:8545
# expect: "result": "0x7a69" (31337 in decimal)

# 2. aeqi-ipfs.service running, kubo healthy
systemctl is-active aeqi-ipfs.service
curl -sS -X POST http://127.0.0.1:5001/api/v0/version | jq .Version
# expect: "0.32.1" or later

# 3. Factory contract has bytecode
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["<factory_addr>","latest"],"id":1}' \
  http://127.0.0.1:8545 | jq .result | head -c 60
# expect: long hex string starting with 0x (not 0x0)

# 4. Templates registered (5 expected)
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ blueprintsForFactory(factoryAddress: \"<factory_addr>\") { templateId } }"}' \
  http://127.0.0.1:8500/graphql | jq .
# expect: data.blueprintsForFactory array with 5 entries

# 5. aeqi-platform.service active + bridge enabled
systemctl is-active aeqi-platform.service
sudo journalctl -u aeqi-platform.service -n 10 | grep -i "DAO bridge"
# expect: "DAO bridge ENABLED"

# 6. /etc/aeqi/secrets.env has matching chain config
sudo grep "^AEQI_CHAIN" /etc/aeqi/secrets.env
# expect: AEQI_CHAIN_ANVIL_FACTORY, AEQI_CHAIN_ANVIL_RPC, AEQI_CHAIN_ANVIL_INDEXER_URL all set
```

If any of these fail, document the failure and refer to "Recovery recipes" below.

## Smoke test 1 — bare metal: hit the endpoint directly

The fastest smoke test bypasses the UI and exercises the full bridge path. No UI build or browser required.

**Step 1: Mint a JWT for an authenticated user**

If you have a user account already logged into the system, extract their JWT from the browser's `Authorization` header. Otherwise, use the JWT minting script (if available in your version):

```bash
JWT=$(node /home/claudedev/aeqi/scripts/_mint-jwt.mjs <user_email>) 2>/dev/null || \
  JWT="<paste-jwt-from-browser-console-localStorage.getItem('jwt')>"
```

Verify the JWT is non-empty:

```bash
echo $JWT | head -c 30
# expect: output like "eyJhbGciOiJIUzI1NiIsInR5..." (JWT format)
```

**Step 2: Spawn a Company via the blueprint path**

```bash
curl -X POST https://app.aeqi.ai/api/start/solo-founder \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Smoke Test Co","tier":"company"}' \
  | jq .
```

Expected response (201 Created):

```json
{
  "ok": true,
  "entity_id": "<uuid>",
  "display_name": "Smoke Test Co",
  "created_at": "2026-05-04T23:15:00Z"
}
```

**Step 3: Watch the logs for bridge progression**

The dao_provisioner runs in `tokio::spawn` — it doesn't block the response. The entity is created immediately, but provisioning happens asynchronously. Watch the platform logs:

```bash
sudo journalctl -u aeqi-platform.service -f --since '1 min ago' \
  | grep -iE "ipfs|provision|registerTRUST|trust_address"
```

Expected log lines (in order, within ~30 seconds):

1. `pinned role description: cid=Qm<hash1>` — per-role Markdown files pinned
2. `pinned operating agreement: cid=Qm<hash2>` — top-level agreement pinned
3. `registerTRUST tx broadcast: tx_hash=0x<hash>` — transaction sent to RPC
4. `registerTRUST mined; polling indexer` — receipt confirmed on chain
5. `on-chain TRUST created: trust_address=0x<addr>` — indexer poll succeeded

If you see steps 1-5 complete, the bridge is healthy end-to-end.

## Smoke test 2 — UI path: /start/<slug>

Verify the UI-driven path exercises the same bridge:

1. Navigate to `https://app.aeqi.ai/start/solo-founder` in a browser (logged in)
2. Fill in the form: display name = "UI Smoke Test", tier = "company"
3. Click "+ Create Company"
4. Verify redirect to `/<entity_id>/overview`
5. Check the Treasury / Ownership / Governance tabs render data (Treasury should show $0 USDC, Governance should show Roles + approval state)

This path exercises the same `provision_dao` function; logs match Smoke test 1.

## Smoke test 3 — x402 endpoint (post-WS-7 implementation)

**Note:** Only valid after WS-7 ships the `POST /api/companies/create` endpoint.

```bash
# Requires a USDC authorization signature (EIP-3009).
# For now, test with the unauthenticated endpoint once WS-7 lands.
curl -X POST https://app.aeqi.ai/api/companies/create \
  -H "Content-Type: application/json" \
  -d '{
    "blueprint_slug": "solo-founder",
    "display_name": "x402 Smoke Test",
    "owner_address": "0x<user_address>",
    "signature": "0x<eip3009_sig>"
  }' \
  | jq .
```

Expected response: 402 Payment Required, with redirect URL or direct settlement info. Full flow requires Coinbase x402 facilitator integration (WS-7 Phase 1).

## Indexer verification

After any of the smoke tests, verify the indexer caught the new TRUST:

```bash
# Get a count of TRUSTs (canonical field — verified against live indexer 2026-05-05)
# Indexer-anvil service listens on :8501, NOT :8500 (8500 = legacy aeqi-indexer.service)
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ trustsCount }"}' \
  http://127.0.0.1:8501/graphql | jq .data.trustsCount

# Query the specific TRUST by address (from logs or entity record)
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ trust(address: \"<trust_addr>\") { templateId ipfsCid } }"}' \
  http://127.0.0.1:8501/graphql | jq .data
```

Expected output:

```json
{
  "trust": {
    "templateId": "0x<hash>",
    "ipfsCid": "Qm<hash>"
  }
}
```

If `trustsCount` did not increment after the company creation, the on-chain bridge is broken — see `click-to-dao-troubleshooting.md` § 1 for revert error decoding.

**Wrong field names that do NOT exist (confirmed 2026-05-05):** `blueprintsCount`, `blueprintByAddress`, `trusts`. Use `trustsCount` and `trust(address: "...")` respectively.

**Indexer port note:** `aeqi-indexer-anvil.service` uses `AEQI_INDEXER_PORT=8501`. The old `aeqi-indexer.service` (retired) used `:8500`. Use `:8501` for all indexer-anvil queries. If you're unsure: `systemctl --user cat aeqi-indexer-anvil.service | grep PORT`.

The rolesCount field is not exposed on the `trust` query — use `rolesForTrust(trustAddress: "...")` for per-TRUST role listings.

## IPFS verification

The CIDs returned should resolve via the local gateway:

```bash
# Fetch the operating agreement
curl -sS http://127.0.0.1:8085/ipfs/Qm<agreement_cid>

# Fetch a role description
curl -sS http://127.0.0.1:8085/ipfs/Qm<role_cid>

# Both should return Markdown text, not 404
```

If the CID is missing from logs or gateway returns 404, kubo may have restarted or the pin failed. Check "Recovery recipes" below.

## Common failures + recovery recipes

### Symptom: registerTRUST tx broadcast never appears in logs

**Diagnostics:**

1. Verify the user has a primary custodial wallet:
   ```bash
   sqlite3 /var/lib/aeqi/wallets.db \
     "SELECT id, user_id, is_primary FROM wallets WHERE user_id = '<user_id>' LIMIT 5"
   ```
   If empty or no `is_primary=1` row, the wallet setup is incomplete.

2. Check for wallet-lookup errors in the platform log:
   ```bash
   sudo journalctl -u aeqi-platform.service -n 50 | grep -iE "lookup.*wallet|no primary"
   ```

**Recovery:**

Wallets are created at signup. If missing, re-trigger signup or manually insert a test wallet (requires decrypt access to the KEK). For testing, check that the user completed signup via `/siwe` and has a confirmed address.

### Symptom: IPFS pin fails (logs show "pin role description to IPFS" error)

**Diagnostics:**

1. Check kubo is healthy:
   ```bash
   curl -sS -X POST http://127.0.0.1:5001/api/v0/version
   ```
   If fails, kubo is down.

2. Check disk space (kubo stores the blockstore locally):
   ```bash
   df -h /var/lib/kubo/blocks
   # expect: > 100MB available
   ```

3. Check kubo daemon logs:
   ```bash
   sudo journalctl -u aeqi-ipfs.service -n 30
   ```

**Recovery:**

```bash
# Restart kubo
sudo systemctl restart aeqi-ipfs.service

# Verify it came back
curl -sS -X POST http://127.0.0.1:5001/api/v0/version | jq .Version

# Retry the smoke test
```

### Symptom: Indexer poll times out (logs: "indexer poll timed out after 60s")

**Diagnostics:**

1. Check the indexer is catching blocks:
   ```bash
   curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"query":"{ indexerStatus { latestBlock } }"}' \
     http://127.0.0.1:8500/graphql | jq .data.indexerStatus
   ```
   Compare `latestBlock` to the current block on anvil:
   ```bash
   curl -sS -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     http://127.0.0.1:8545 | jq '.result | tonumber'
   ```

2. If indexer is behind, check its logs:
   ```bash
   sudo journalctl -u aeqi-indexer-anvil.service -n 30
   # or
   sudo journalctl -u aeqi-indexer.service -n 30
   ```

**Recovery:**

Indexer lag is common if the RPC or indexer service is under load. The poll retries every 2 seconds for 60 seconds. If still behind:

```bash
# Check if the indexer needs to be restarted
sudo systemctl restart aeqi-indexer-anvil.service

# Wait 10s for it to sync
sleep 10

# Check status again
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ indexerStatus { latestBlock } }"}' \
  http://127.0.0.1:8500/graphql | jq .
```

If indexer is still stuck, check for RPC errors in its logs — the RPC may have failed or be rate-limiting.

### Symptom: registerTRUST tx reverts on-chain

**Diagnostics:**

1. Check the tx receipt and revert reason:
   ```bash
   curl -sS -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["<tx_hash>"],"id":1}' \
     http://127.0.0.1:8545 | jq '.result | {status, logs}'
   ```
   If `status: "0x0"`, the tx reverted.

2. Decode the revert reason (requires ABI):
   ```bash
   # Most common: Factory not initialized, or templateId not found
   echo "Check the logs for transaction revert reason"
   ```

**Recovery:**

1. Verify the Factory is properly initialized:
   ```bash
   curl -sS -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"<factory_addr>","data":"0x<selector_for_owner>"},"latest"],"id":1}' \
     http://127.0.0.1:8545
   ```

2. Verify templates are registered:
   ```bash
   curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"query":"{ blueprintsForFactory(factoryAddress: \"<factory_addr>\") { templateId } }"}' \
     http://127.0.0.1:8500/graphql | jq '.data.blueprintsForFactory | length'
   ```
   If 0, templates are missing. Re-run RegisterBlueprints:

   ```bash
   cd /home/claudedev/aeqi/contracts
   PRIVATE_KEY=<deployer_key> FACTORY_ADDRESS=<factory_addr> \
     forge script scripts/foundry/RegisterBlueprints.s.sol \
     --rpc-url http://127.0.0.1:8545 --broadcast
   ```

### Symptom: Anvil chain reset, Factory address stale

**Recovery:**

1. Check the current Factory address in `/etc/aeqi/secrets.env`:
   ```bash
   sudo grep "AEQI_CHAIN_ANVIL_FACTORY" /etc/aeqi/secrets.env
   ```

2. If anvil was restarted, find the new Factory address in the deploy logs:
   ```bash
   ls -lt /home/claudedev/aeqi/contracts/broadcast/ | head -5
   # Read the latest deployment JSON
   jq '.transactions[] | select(.functionName == "<Factory>" or .contractName == "Factory")' \
     /home/claudedev/aeqi/contracts/broadcast/Deploy.s.sol/31337/run-latest.json
   ```

3. Update `/etc/aeqi/secrets.env` with the new Factory address:
   ```bash
   sudo nano /etc/aeqi/secrets.env
   # Update AEQI_CHAIN_ANVIL_FACTORY=0x<new_addr>
   ```

4. Restart the platform:
   ```bash
   sudo systemctl restart aeqi-platform.service
   ```

5. Re-register templates against the new Factory:
   ```bash
   cd /home/claudedev/aeqi/contracts
   PRIVATE_KEY=<deployer_key> FACTORY_ADDRESS=<new_addr> \
     forge script scripts/foundry/RegisterBlueprints.s.sol \
     --rpc-url http://127.0.0.1:8545 --broadcast
   ```

6. Verify indexer is watching the new Factory:
   ```bash
   sudo systemctl restart aeqi-indexer-anvil.service
   sleep 5
   curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"query":"{ blueprintsForFactory(factoryAddress: \"<new_addr>\") { templateId } }"}' \
     http://127.0.0.1:8500/graphql | jq .
   ```

## Reference: minimum viable bridge config

The smallest configuration that runs the bridge end-to-end:

- **1 anvil instance**: chain 31337, `--block-time 2`, mounted at `http://127.0.0.1:8545`
- **1 kubo daemon**: IPFS node at `127.0.0.1:5001` (API), `127.0.0.1:8085` (HTTP gateway)
- **1 aeqi-indexer**: GraphQL service at `http://127.0.0.1:8500/graphql` or `http://127.0.0.1:8501/graphql`
- **1 aeqi-platform**: control plane at `https://app.aeqi.ai` with `/etc/aeqi/secrets.env` containing:
  - `AEQI_CHAIN_ANVIL_FACTORY=<factory_addr>`
  - `AEQI_CHAIN_ANVIL_RPC=http://127.0.0.1:8545`
  - `AEQI_CHAIN_ANVIL_INDEXER_URL=http://127.0.0.1:8500/graphql`
- **Factory contract**: deployed + initialized on anvil
- **5 templates**: registered via RegisterBlueprints.s.sol (solo-founder, joint, agent, etc.)

All can run on a single host. For scale, separate hosts run separate aeqi-indexer instances per chain.

## OSS deploys

When a user runs `aeqi platform start` on their own host, the same recipe applies but pointed at their own infrastructure:

```bash
export AEQI_CHAIN_ANVIL_FACTORY="0x<your_factory>"
export AEQI_CHAIN_ANVIL_RPC="http://127.0.0.1:8545"  # or your RPC
export AEQI_CHAIN_ANVIL_INDEXER_URL="http://127.0.0.1:8500/graphql"  # or your indexer
```

The recipe steps are identical. Environment conventions:

- If running anvil locally, default `AEQI_CHAIN_ANVIL_RPC=http://127.0.0.1:8545`
- If running aeqi-indexer-anvil.service locally, default indexer GraphQL at `http://127.0.0.1:8500/graphql` or (sandbox-mode) `http://127.0.0.1:8501/graphql`
- Kubo gateway defaults to `http://127.0.0.1:8085`

## Decision authority

This recipe is reference documentation — extend as new failure modes emerge during dogfooding. Do not gate production deploys on running this recipe; it's for diagnostic and onboarding use.
