# click-to-DAO troubleshooting catalog

**Status:** Living document. Updated 2026-05-04 from incidents during the autonomous-push session.

**Companion docs:**
- [`click-to-dao-smoke-test.md`](./click-to-dao-smoke-test.md) — happy-path smoke recipe
- [`aeqi-entity-aa-design.md`](./aeqi-entity-aa-design.md) — what TRUST is and registerTRUST does
- [`aeqi-economy-plan.md`](./aeqi-economy-plan.md) — sequencing context

## How to use this catalog

When `smoke_dao_bridge` or a real Company-creation hits a revert, look up the **selector** in § 1. If it's a chain-state issue (factory empty, indexer behind), § 2 covers diagnostics. Recovery recipes are in § 3.

## 1. Custom error selectors

| Selector | Error Name | When It Fires | Typical Cause | See |
|---|---|---|---|---|
| `0x269dea0a` | `BeaconProxy_ImplementationNotFound` | registerTRUST calls Factory, which delegates to Beacon for module impls | Factory deployed but `replaceImplementations` for module impls never ran | § 3.1 |
| `0x6dba49c0` | `Factory_ModuleInitializationFailed` | registerTRUST instantiates a module via Factory.instantiate() | module's `initialize(bytes calldata config)` reverts (tuple-shape mismatch, bad config encoding, incomplete state) | § 3.2 |
| `0x2974757d` | `Factory_TemplateDoesNotExist` | registerTRUST looks up `templateId` in registry | templateId never registered via RegisterTemplates.s.sol, or wrong templateId passed from platform | § 3.3 |
| `0xfea9fc98` | `Factory_BeaconIsNotInitialized` | Factory tries to read Beacon address or call it | Beacon contract deployed but Factory never called `setBeacon()` | § 3.4 |
| `0xaea5306b` | `Factory_InvalidValueConfig` | registerTRUST encodes value-config slot in ABI | Encoded value-config slice has wrong field count, wrong sizes, or wrong padding | § 3.5 |

**Decoding error data:**

When a custom error fires, the tx revert data encodes the error selector (first 4 bytes) + ABI-encoded arguments. Most errors carry a `moduleId` (bytes32 keccak256 hash, e.g., `0xa0a8be0a...` for role) or `templateId` (also bytes32). Use:

```bash
# Extract revert reason from tx receipt
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["<tx_hash>"],"id":1}' \
  http://127.0.0.1:8545 | jq '.result.revertReason'

# Or trace the call to see the exact revert point
cast call <factory> "getImplementation(bytes32)(address)" $(cast keccak "role") \
  --rpc-url http://127.0.0.1:8545
# Expected: 0xnon-zero address. If 0x0, replaceImplementations never ran.
```

## 2. Chain-state diagnostics

### "registerTRUST reverts" — start here

Use this step-by-step walk when any registerTRUST call fails.

**Step 1 — verify factory bytecode exists:**

```bash
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["<factory>","latest"],"id":1}' \
  http://127.0.0.1:8545 | jq '.result' | head -c 80
```

Expected: `0x6080...` (long hex bytecode, at least 100 chars). If you see `0x` or `0x0`, the factory was deleted (anvil reset) or deployment failed. Go to § 3.1.

**Step 2 — verify templates registered:**

```bash
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ templatesForFactory(factoryAddress: \"<factory_lowercase>\") { templateId } }"}' \
  http://127.0.0.1:8500/graphql | jq '.data.templatesForFactory | length'
```

Expected: 4 or 5 (4 canonical: Foundation, Entity, Venture, Fund; plus 0-1 legacy if both registered). If 0, templates were never registered. Go to § 3.3.

**Step 3 — verify module implementations registered:**

```bash
# Check if all 8 module impls are in the Factory's Beacon
cast call <factory> "getImplementation(bytes32)(address)" $(cast keccak "role") \
  --rpc-url http://127.0.0.1:8545
```

Expected: `0x<non-zero-address>`. If `0x0000...`, Beacon has no implementation for that module. Go to § 3.1.

**Step 4 — test smoke against a known-good template:**

```bash
# Try to create a Company via the smoke tool
AEQI_SMOKE_TEMPLATE_SLUG=entity AEQI_SMOKE_FUNDING_PRIVATE_KEY=<dev_key> \
  /home/claudedev/aeqi-platform/target/release/smoke_dao_bridge

# Or manually via the platform
curl -X POST https://app.aeqi.ai/api/start/entity \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Diagnostic Company"}' | jq .
```

Watch the logs for the registerTRUST call:

```bash
sudo journalctl -u aeqi-platform.service -f --since '30 sec ago' \
  | grep -iE "registerTRUST|ipfs|provision|trust_address|revert"
```

### "Indexer not seeing templates" diagnostic

When `templatesForFactory` returns empty even though registerTemplates.s.sol ran successfully on-chain:

**Step 1 — check the indexer is watching the right factory:**

```bash
# Check indexer config
sudo systemctl cat aeqi-indexer-anvil.service | grep -i "factory\|env"
# or
ps aux | grep aeqi-indexer | grep -v grep
```

Expected: The service should show `AEQI_FACTORY_ADDRESS=<factory>` matching your `/etc/aeqi/secrets.env` AEQI_CHAIN_ANVIL_FACTORY.

**Step 2 — check indexer block height vs. chain:**

```bash
# Get indexer's latest block
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"query":"{ indexerStatus { latestBlock } }"}' \
  http://127.0.0.1:8500/graphql | jq '.data.indexerStatus.latestBlock'

# Get chain's latest block
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://127.0.0.1:8545 | jq '.result | tonumber'
```

Expected: Indexer latestBlock ≥ chain latestBlock (or within 1-2 blocks). If indexer is way behind (e.g., block 100 vs chain 600), it hasn't caught up. Go to § 3.3 recovery.

**Step 3 — check register transaction actually mined:**

```bash
# Look in aeqi-indexer logs for the registerTemplates.s.sol transactions
sudo journalctl -u aeqi-indexer-anvil.service -n 50 | grep -i "template\|register" | tail -10

# Or manually check if the Factory emitted TemplateRegistered events
cast logs "event TemplateRegistered(bytes32 indexed templateId)" \
  --from-block 0 --to-block latest \
  --rpc-url http://127.0.0.1:8545 | head -20
```

Expected: At least 4 logs (one per canonical template). If none, registerTemplates.s.sol was never broadcast (or reverted). Go to § 3.3 recovery.

### "Anvil reset / chain reconciliation" detection

When a parallel autonomous worker or manual re-run restarts anvil mid-flight:

**Detection signs:**

- `eth_blockNumber` returns a much lower number than it did 5 minutes ago
- `eth_getCode(<factory>)` returns `0x` (empty) when you know it should have bytecode
- `ps -p $(pgrep anvil) -o pid,lstart` shows a recent timestamp (within the last 5 min)

**Recovery:** Go to § 3.1.

## 3. Recovery recipes

### 3.1 — BeaconProxy_ImplementationNotFound (selector 0x269dea0a)

**Root cause:** Factory was deployed but `replaceImplementations` for module impls wasn't run, or was interrupted mid-flight.

**Full recovery sequence:**

1. **Kill any stuck forge processes:**

   ```bash
   pkill -f "forge script"
   sleep 2
   ```

2. **Kill stale indexer processes (optional but recommended):**

   ```bash
   pkill -f "aeqi-indexer" || true
   sleep 2
   ```

3. **Run a fresh Deploy.s.sol with --slow flag** (critical for avoiding nonce races):

   ```bash
   cd /home/claudedev/aeqi/contracts
   PRIVATE_KEY=<dev_key> forge script scripts/foundry/Deploy.s.sol \
     --slow --broadcast --rpc-url http://127.0.0.1:8545
   ```

   Watch for "Broadcasting transaction X / 8" to completion (Beacon, TRUST impl, 8 modules, replaceImplementations). The output will show a new factory address (e.g., `0x84ea74...`). Copy it.

4. **Update /etc/aeqi/secrets.env:**

   ```bash
   sudo nano /etc/aeqi/secrets.env
   # Change AEQI_CHAIN_ANVIL_FACTORY=0x<old> to 0x<new>
   ```

5. **Respawn indexer with fresh DB:**

   ```bash
   sudo systemctl stop aeqi-indexer-anvil.service aeqi-indexer.service || true
   sudo rm -rf /var/lib/aeqi/indexer_db*  # wipe stale DB
   sleep 2
   sudo systemctl start aeqi-indexer-anvil.service
   sleep 10
   ```

6. **Restart aeqi-platform:**

   ```bash
   sudo systemctl restart aeqi-platform.service
   sleep 5
   ```

7. **Register templates against the new factory:**

   ```bash
   cd /home/claudedev/aeqi/contracts
   PRIVATE_KEY=<dev_key> FACTORY_ADDRESS=<new_addr> \
     forge script scripts/foundry/RegisterBlueprints.s.sol \
     --slow --broadcast --rpc-url http://127.0.0.1:8545
   ```

   You should see "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" in the output.

8. **Verify recovery:**

   ```bash
   # Poll indexer for templates
   curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"query":"{ templatesForFactory(factoryAddress: \"<new_factory_lowercase>\") { templateId } }"}' \
     http://127.0.0.1:8500/graphql | jq '.data.templatesForFactory | length'
   # Expected: 4 or 5
   
   # Try the smoke test
   AEQI_SMOKE_TEMPLATE_SLUG=entity AEQI_SMOKE_FUNDING_PRIVATE_KEY=<dev_key> \
     /home/claudedev/aeqi-platform/target/release/smoke_dao_bridge
   ```

### 3.2 — Factory_ModuleInitializationFailed (selector 0x6dba49c0)

**Root cause:** A module's `initialize(bytes calldata config)` reverted when Factory called it during registerTRUST. Most common: tuple-shape mismatch between the encoder (dao_provisioner.rs or RegisterTemplates.s.sol) and the module's actual expected ABI.

**Diagnostics:**

1. **Identify which module by moduleId field:**

   Decode the revert data. The error payload includes moduleId (bytes32). Map it:
   - `keccak256("role")` → Role module
   - `keccak256("treasury")` → Treasury module
   - `keccak256("approval")` → Approval module
   - etc.

2. **Check the module's initialize signature:**

   ```bash
   # Read the module's initialize() in aeqi-core
   cat /home/claudedev/aeqi-core/src/modules/Role.sol | grep -A 20 "function initialize"
   
   # Compare to the encoder in dao_provisioner.rs
   grep -A 30 "encode_role_dao_config\|encode.*init" \
     /home/claudedev/aeqi-platform/crates/dao-provisioner/src/lib.rs
   ```

3. **Check TestConfigs or encoder for tuple shape:**

   The encoder must produce a bytes calldata that ABI-decodes into exactly the tuple shape the module expects (e.g., `struct RoleConfig { address[] members; bytes32[] roleIds; ... }`). Off-by-one field or wrong type = revert.

**Recovery:**

- **Option A: Fix the encoder** (if aeqi-platform is wrong):

  Edit `/home/claudedev/aeqi-platform/crates/dao-provisioner/src/lib.rs`, fix the tuple shape, rebuild:

  ```bash
  cd /home/claudedev/aeqi-platform
  cargo check -p aeqi-dao-provisioner
  cargo test -p aeqi-dao-provisioner
  # Once green, deploy via /ship
  ```

- **Option B: Fix the module** (if aeqi-core module signature changed):

  Edit the module in aeqi-core, rebuild, run RegisterBlueprints against the new factory:

  ```bash
  cd /home/claudedev/aeqi-core
  cargo test -p aeqi-contracts
  cd /home/claudedev/aeqi/contracts
  # Deploy fresh + register
  ```

### 3.3 — Factory_TemplateDoesNotExist (selector 0x2974757d) or empty indexer

**Root cause:** registerTRUST was called with a templateId that isn't registered in the Factory, OR RegisterBlueprints.s.sol never ran, OR the indexer is lagged.

**Recovery:**

1. **Verify templates are in the Factory (on-chain check):**

   ```bash
   cast logs "event TemplateRegistered(bytes32 indexed templateId)" \
     --from-block 0 --to-block latest \
     --rpc-url http://127.0.0.1:8545 | wc -l
   # Expected: ≥ 4 lines
   ```

   If 0, templates were never registered.

2. **Re-run RegisterBlueprints.s.sol:**

   ```bash
   cd /home/claudedev/aeqi/contracts
   PRIVATE_KEY=<dev_key> FACTORY_ADDRESS=<factory> \
     forge script scripts/foundry/RegisterBlueprints.s.sol \
     --slow --broadcast --rpc-url http://127.0.0.1:8545
   ```

3. **Wait for indexer to catch up (if it was lagged):**

   ```bash
   # Check current block
   curl -sS -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     http://127.0.0.1:8545 | jq '.result | tonumber' > /tmp/chain_block.txt
   
   # Poll indexer until it reaches that block
   until [ "$(curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"query":"{ indexerStatus { latestBlock } }"}' \
     http://127.0.0.1:8500/graphql | jq '.data.indexerStatus.latestBlock')" \
     -ge "$(cat /tmp/chain_block.txt)" ]; do
     echo "Indexer catching up..."
     sleep 2
   done
   echo "Indexer synced."
   ```

4. **Verify templates are now visible:**

   ```bash
   curl -sS -X POST -H 'Content-Type: application/json' \
     -d '{"query":"{ templatesForFactory(factoryAddress: \"<factory_lowercase>\") { templateId } }"}' \
     http://127.0.0.1:8500/graphql | jq '.data.templatesForFactory'
   ```

### 3.4 — Factory_BeaconIsNotInitialized (selector 0xfea9fc98)

**Root cause:** Beacon contract was deployed but never wired to the Factory (Factory.setBeacon() was never called).

**Recovery:**

This should not happen if Deploy.s.sol ran to completion. If you see this:

1. **Check Deploy.s.sol logs:**

   ```bash
   ls -lt /home/claudedev/aeqi/contracts/broadcast/Deploy.s.sol/31337/ | head -3
   jq '.transactions[] | select(.functionName == "setBeacon")' \
     /home/claudedev/aeqi/contracts/broadcast/Deploy.s.sol/31337/run-latest.json
   ```

   If `setBeacon` doesn't appear, Deploy.s.sol was interrupted. Go to § 3.1 full recovery.

2. **Alternatively, manually call setBeacon (if you know the Beacon address):**

   ```bash
   # Extract Beacon address from deploy logs
   BEACON=$(jq -r '.transactions[] | select(.contractName == "Beacon") | .contractAddress' \
     /home/claudedev/aeqi/contracts/broadcast/Deploy.s.sol/31337/run-latest.json | head -1)
   
   # Call Factory.setBeacon()
   cast send <factory> "setBeacon(address)()" "$BEACON" \
     --private-key <dev_key> \
     --rpc-url http://127.0.0.1:8545
   ```

### 3.5 — Factory_InvalidValueConfig (selector 0xaea5306b)

**Root cause:** The encoded value-config slot in registerTRUST's request has the wrong tuple shape — field count mismatch, field types wrong, or padding errors.

**Recovery:**

This is similar to § 3.2. Check the encoder in dao_provisioner.rs for how value-config (reward distribution, treasury limits, etc.) is encoded, and ensure it matches the Factory's expected ABI tuple. Fix the encoder, redeploy aeqi-platform, and retry.

## 4. Multi-process pitfalls

### Forge processes racing on the same dev key

When two `forge script` processes run concurrently against the same anvil + same deployer key, both try to use the same nonce. One wins, the other gets a nonce conflict or deadlock. **Symptom:** `ps -p <pid> -o stat,wchan,pcpu,etime` shows:

```
Sl futex_wait_queue  0.4%  5m
Sl futex_wait_queue  0.4%  5m
```

Both zombies, broadcast file untouched for >5 min.

**Prevention & recovery:**

```bash
# Kill all stuck forge processes
pkill -f "forge script"

# Run the next one with --slow flag (forces sequential nonce)
PRIVATE_KEY=<dev_key> forge script Deploy.s.sol \
  --slow --broadcast --rpc-url http://127.0.0.1:8545
```

The `--slow` flag is critical. Without it, forge tries to parallelize nonce allocation and hits the race condition.

### Multiple indexer instances on different ports

Old indexer from a prior session (e.g., `:8500` on aeqi-indexer.service) may coexist with a new one (`:8501` on aeqi-indexer-anvil.service). Both consuming RAM. **Detection:**

```bash
pgrep -af aeqi-indexer | wc -l
# If > 1, you have duplicates
```

**Cleanup:**

```bash
# Kill the old instance (usually the one on :8500)
kill <old_pid>

# Verify the new one on the intended port is live
curl -sS http://127.0.0.1:8501/graphql -X POST -d '{"query":"{ indexerStatus { latestBlock } }"}' | jq .
```

### Concurrent chain reconciliations

If a parallel autonomous Claude session is running and restarts anvil + deploys contracts mid-flight, the running aeqi-platform may be pointing at a stale factory address. **Detection:**

```bash
# Check platform's factory config
sudo grep AEQI_CHAIN_ANVIL_FACTORY /etc/aeqi/secrets.env

# Verify that factory still has bytecode
curl -sS -X POST -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_getCode","params":["<that_factory>","latest"],"id":1}' \
  http://127.0.0.1:8545 | jq '.result' | head -c 20
# If 0x or 0x0, factory is stale
```

**Recovery:** Go to § 3.1 and run full recovery with the new factory address. Contact the other session to coordinate timing.

## 5. Known debt and open issues

**TRUST contract size 25065 > 24576 (EIP-170 limit):**

Anvil and Sepolia ignore the EIP-170 contract size limit. Mainnet enforces it. The TRUST contract is currently 25065 bytes — over the 24576 limit. This will cause deployment to fail on mainnet.

- **Action:** Contracts team must refactor TRUST.sol before any mainnet deploy (remove dead code, inline helpers, split logic, etc.).
- **Timeline:** Before mainnet; not blocking testnet work.
- **Tracking:** See aeqi-core issues for active refactoring PRs.

**Role module init still reverts on empty configs:**

During autonomous push 2026-05-04, RegisterBlueprints with 4 canonical templates occasionally hits Factory_ModuleInitializationFailed for the Role module. The issue is intermittent — likely a race between config encoding and tuple-shape expectations.

- **Diagnosis:** Run `cast call <factory> "getImplementation(bytes32)(address)" $(cast keccak "role")` to verify the impl is registered, then manually test the Role module's initialize() with sample config data.
- **Fix:** See § 3.2 diagnostics for the resolution path.

**Indexer "Address already in use (os error 98)" spurious log:**

After respawning the indexer service twice in quick succession, the log shows "Address already in use (os error 98)" immediately after "poll loop starting". The indexer continues and appears to work normally.

- **Cause:** The old process's socket wasn't fully released by the OS before the new one tried to bind.
- **Mitigation:** Add a small `sleep 2` between `systemctl stop` and `systemctl start` when respawning.

---

**Last updated:** 2026-05-04T23:48Z  
**Session:** autonomous-push; Wave 7Y (Subagent Y)

