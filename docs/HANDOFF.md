# aeqi-indexer — handoff

Built autonomously on 2026-05-04 across ~17 ticks via /loop heartbeat. Replaces
the TheGraph subgraph at `~/projects/aeqi-graph` with a self-hosted Rust
indexer: SQLite + alloy + axum + async-graphql.

**Status:** structurally complete, 5 contracts mocked + live-tested,
23/23 unit tests green, 20 commits on `indexer-build` branch.

---

## Why this exists

The original v2 plan was: real on-chain Company creation → Blueprint deploys
DAO on Anvil → user-as-director → governance transition → events indexed →
mirrored into apps/ui. The "events indexed" link was a TheGraph subgraph
sitting in a sibling repo, with deploy + cluster ops we don't own.

This indexer collapses that link into a Rust binary that runs alongside
aeqi-platform. Same data surface, ours to deploy, queryable via GraphQL
on a port we control. No external service.

---

## Boot recipe

```bash
# 1. Start Anvil (chain 31337, port 8545)
anvil --block-time 2

# 2. Deploy Factory (use real aeqi-core when its deploy script is fixed,
#    or one of the test-contracts/Mock* for smoke testing)
forge create test-contracts/MockFactory.sol:MockFactory \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# Note the contractAddress

# 3. Build + boot the indexer
cd /home/claudedev/aeqi-indexer-build
cargo build --release -p aeqi-indexer
AEQI_INDEXER_DB=./aeqi-indexer.db \
AEQI_INDEXER_PORT=8500 \
AEQI_INDEXER_RPC=http://127.0.0.1:8545 \
AEQI_INDEXER_FACTORY=<address-from-step-2> \
AEQI_INDEXER_START_BLOCK=0 \
./target/release/aeqi-indexer

# 4. Health check
curl http://127.0.0.1:8500/healthz                        # → "ok"
curl http://127.0.0.1:8500/graphql                        # → GraphiQL playground
curl -X POST http://127.0.0.1:8500/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"{ version trustsCount }"}'
```

Env vars:

| Var | Default | Notes |
|---|---|---|
| `AEQI_INDEXER_DB` | `./aeqi-indexer.db` | SQLite file path |
| `AEQI_INDEXER_PORT` | `8500` | HTTP port for GraphQL + healthz |
| `AEQI_INDEXER_RPC` | `http://127.0.0.1:8545` | JSON-RPC endpoint |
| `AEQI_INDEXER_FACTORY` | (none) | Factory contract address. Required to bootstrap; written into `watched_addresses(kind='factory')` on boot. |
| `AEQI_INDEXER_START_BLOCK` | `0` | First block to index. Use the deploy block of Factory to skip irrelevant history. |

---

## Live demo against real aeqi-core (5 min, end-to-end)

Reproducible smoke for the whole stack. Anvil + real aeqi-core + indexer + GraphQL.

```bash
# 0. Anvil up (separate terminal)
anvil --block-time 2

# 1. Deploy real aeqi-core via the fixed deploy script
cd /home/claudedev/projects/aeqi-core-deploy-fix
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script scripts/foundry/Deploy.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast --skip-simulation
# Note the Factory address from stdout (e.g. 0x67d269191c92Caf3cD7723F116c85e6E9bf55933)

# 2. Boot the indexer pointed at the real Factory
cd /home/claudedev/aeqi-indexer-build
AEQI_INDEXER_FACTORY=<factory-from-step-1> \
AEQI_INDEXER_START_BLOCK=<deploy-block-from-step-1> \
./target/release/aeqi-indexer

# 3. Create a real TRUST against the deployed Factory (separate terminal)
cd /home/claudedev/projects/aeqi-core-deploy-fix
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
FACTORY_ADDRESS=<factory-from-step-1> \
  forge script scripts/foundry/CreateTrust.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast --skip-simulation
# Note the TRUST address from stdout

# 4. Mine 12+ confirmation blocks
for i in {1..15}; do
  curl -s -X POST http://127.0.0.1:8545 -H 'content-type: application/json' \
    --data '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}' > /dev/null
done

# 5. Query the indexer to see the full TRUST + modules graph
curl -s -X POST http://127.0.0.1:8500/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"{ trust(address: \"<trust-from-step-3>\") { trustId templateId signersCount valueConfigsCount } trustModules(trustAddress: \"<trust-from-step-3>\") { moduleId moduleAddress } templatesForFactory(factoryAddress: \"<factory-from-step-1>\") { templateId replaceCount } }"}' | jq
```

What you should see:
- Indexer log streams `Factory_TemplateReplaced` → `Factory_TRUSTCreatedEvent` →
  `Factory_TRUSTRegisteredEvent` → `Factory_TRUSTSignerAdded` →
  3 × `TRUST_ModuleAdded` (factory + role + token) — all in one block.
- GraphQL returns the TRUST with `signersCount=1`, `valueConfigsCount=2`,
  3 modules attached.

This is the loop that was broken pre-Phase 7 (deploy script drift) and
fully closed at Phase 9 (intra-block multi-level cascade). It exercises
all 4 layers of dispatch (Factory → TRUST proxy → 3 module proxies)
against actual aeqi-core contracts in one tx.

---

## Architecture

```
Anvil → poll loop (every 2s)
         │
         ├─ SELECT addresses FROM watched_addresses
         ├─ get_logs(filter = addresses × topic0_set)
         │
         ├─ for each log:
         │    topic0 dispatch → handler
         │      handler may register more watched addresses
         │      (TrustCreated → trust, ModuleAdded → module)
         │
         └─ commit_block (parent_hash chain validation)

GraphQL (axum + async-graphql) ←─ SQLite ←─ handlers
```

**Three-level dynamic subscription** is the architectural backbone:

1. Boot writes `factory_address` into `watched_addresses` (kind `factory`).
2. `Factory_TRUSTCreatedEvent` handler writes `trust_address` into
   `watched_addresses` (kind `trust`).
3. `TRUST_ModuleAdded` handler writes `module_address` into
   `watched_addresses` (kind `module`).
4. Each round re-reads `watched_addresses` and rebuilds the filter — every
   newly-deployed contract is auto-subscribed without a recompile or restart.

**Reorg safety:** every committed block writes `(block_number, block_hash,
parent_hash)` to `committed_blocks`. Each new block validates its
`parent_hash` against the previous; on mismatch the loop unwinds via
`unwind_above(safe_block)` and re-derives `from` on the next iteration.
Confirmation depth is 12 blocks (configurable in code, not env yet).

**Idempotency:** every persist function uses `INSERT OR IGNORE` /
`INSERT OR REPLACE`, and the audit-log tables (permissions_events,
role_assignments, votes) have `UNIQUE (..., log_index)` constraints.
Replays from reorg recovery don't double-insert.

---

## Schema (12 migrations, all idempotent)

| Migration | Table | Purpose |
|---|---|---|
| `001_meta` | `schema_migrations` | Migration tracker |
| `002_committed_blocks` | `committed_blocks` | Reorg-safe block tracking |
| `003_accounts` | `accounts` | Universal address fan-in |
| `004_trusts` | `trusts` | TRUST contract metadata |
| `005_trust_signers` | `trust_signers` | TRUST signer authorizations |
| `006_watched_addresses` | `watched_addresses` | Dispatch source-of-truth |
| `007_modules` | `modules` | TRUST_ModuleAdded landing |
| `008_permissions_events` | `permissions_events` | TRUST permissions audit log |
| `009_roles` | `roles` | Role module: Role_RoleCreated landing |
| `010_role_assignments` | `role_assignments` | Role assignment audit log |
| `011_proposals` | `proposals` | Governance proposals + status |
| `012_votes` | `votes` | Vote cast audit log |
| `013_token_balances` | `token_balances` | ERC20 cap-table (atomic balance updates) |
| `014_token_transfers` | `token_transfers` | Token Transfer audit log |
| `015_vesting_positions` | `vesting_positions` | Vesting lifecycle |
| `016_vesting_contributions` | `vesting_contributions` | Vesting funder deposits |
| `017_vesting_claims` | `vesting_claims` | Vesting beneficiary withdrawals |
| `018_templates` | `templates` | Factory templates (TemplateReplaced upserts) |

---

## GraphQL surface (12 queries)

```graphql
type Query {
  # System
  version: String!
  trustsCount: Int!

  # Trust + Factory events
  trust(address: String!): Trust
  trustSigners(trustAddress: String!): [Signer!]!
  trustModules(trustAddress: String!): [Module!]!

  # TRUST permissions
  permissionsEvents(trustAddress: String!, entityId: String!): [PermissionsEvent!]!

  # Role module
  rolesForModule(moduleAddress: String!): [Role!]!
  roleAssignments(moduleAddress: String!, roleId: String!): [RoleAssignment!]!

  # Governance module
  proposalsForModule(moduleAddress: String!): [Proposal!]!
  votesForProposal(moduleAddress: String!, proposalId: String!): [Vote!]!

  # Token module (ERC20)
  tokenHolders(tokenAddress: String!): [TokenBalance!]!
  tokenTransfers(tokenAddress: String!): [TokenTransfer!]!

  # Vesting module
  vestingPositions(moduleAddress: String!): [VestingPosition!]!
  vestingContributions(moduleAddress: String!, positionId: String!): [VestingContribution!]!
  vestingClaims(moduleAddress: String!, positionId: String!): [VestingClaim!]!

  # Factory admin
  templatesForFactory(factoryAddress: String!): [Template!]!
}
```

All audit-log queries return ordered (oldest first by `block_number, log_index`)
except `proposalsForModule` which returns newest first.

GraphiQL playground is live at `GET /graphql` for interactive exploration.

---

## Test contracts (test-contracts/)

| File | Mocks | Used by |
|---|---|---|
| `MockFactory.sol` | Factory event signatures | TICK 11 + 12 + every test since |
| `MockTRUST.sol` | TRUST_ModuleAdded + Permissions{Granted,Revoked,Set} | TICK 13 + 14 |
| `MockRole.sol` | Role module 5 events incl. emitFounderLifecycle | TICK 15 |
| `MockGovernance.sol` | Governance module 5 events incl. emitFullProposalLifecycle | TICK 16 |

To rebuild + redeploy a mock:

```bash
cp test-contracts/MockX.sol /tmp/mock-factory-build/src/MockX.sol
cd /tmp/mock-factory-build && forge build
BYTECODE=$(jq -r '.bytecode.object' out/MockX.sol/MockX.json)
cast send --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --create "$BYTECODE"
```

`/tmp/mock-factory-build/` is a standalone forge project (no aeqi-core
node_modules deps); rebuilding is fast.

---

## apps/ui integration sketch

The apps/ui frontend currently queries TheGraph subgraph at `${VITE_GRAPH_URL}`.
Pointing it at this indexer is mostly a URL change + field rename:

```typescript
// Before:
const GRAPH_URL = import.meta.env.VITE_GRAPH_URL;
// After:
const GRAPH_URL = import.meta.env.VITE_INDEXER_URL ?? 'http://127.0.0.1:8500/graphql';
```

Per-tab mapping:

| Tab | Indexer queries |
|---|---|
| **Treasury** | `trust(address)` + `trustModules(trustAddress)` (Token modules' balances need eth_call backfill — not yet built) |
| **Ownership** | `rolesForModule(moduleAddress)` + `roleAssignments(moduleAddress, roleId)` per Role module |
| **Governance** | `proposalsForModule(moduleAddress)` + `votesForProposal(moduleAddress, proposalId)` |
| **Roles tab** | `rolesForModule` returns all roles; replay `roleAssignments` for each to compute current occupant |
| **Permissions tab** | `permissionsEvents(trustAddress, entityId)` audit log; frontend computes effective flags by replaying granted/revoked/set semantics |

Field naming uses snake_case in SQLite and store, but async-graphql converts
to camelCase automatically — so apps/ui sees `trustAddress`, `voteStart`,
`createdBlock`, `accountAddress`, etc.

---

## Open work

### Already-known gaps (non-blocking for v1)

- **Token + Vesting + Funding + Budget modules not yet ported.** Each is a
  ~30-min mechanical port: sol! decl + migration + store fns + dispatch arms +
  GraphQL fields + Mock contract. The pattern is locked (see TICKs 14–16).
- **Token_Transfer high-frequency.** Will need filtering or sampling
  strategy — straight per-transfer audit log will balloon.
- **eth_call backfill** for non-event state (current treasury balance,
  module-level configuration, etc.). Currently zero. Pattern needed:
  periodic snapshot job that calls view functions on watched addresses.
- **WebSocket log subscription.** Currently HTTP polling every 2s; alloy
  supports WSS via `ProviderBuilder::connect_pubsub` — drop-in upgrade
  for tighter latency.
- **Reorg handling tested only at the parent_hash mismatch detection level.**
  Never seen a reorg in the wild on Anvil. Sepolia/mainnet test would be
  the real validation.
- **Single-chain.** Indexer assumes one RPC. Multi-chain support would need
  per-chain DBs OR a `chain_id` column on every entity table.
- **Governance ProposalCreated dynamic arrays NOT stored.** ipfs_cid is the
  v1 demo handle. To execute proposals, frontend or a separate decoder needs
  to pull the full payload.
- **Permissions audit log doesn't compute effective flags.** Frontend job
  to replay granted/revoked/set into a current bitmask. Could be added as
  a derived materialized view or a GraphQL resolver method.

### Original blockers (still open)

- **aeqi-core deploy script drift** (TICK 5 pivot): the real
  `~/projects/aeqi-core/scripts/foundry/Deploy.s.sol` calls
  `Beacon.setImplementation(bytes32, address)` but contracts now require
  `(address source, bytes32 moduleId, address impl)` — 3 args. Until
  fixed, the indexer runs against MockFactory/MockTRUST/MockRole/MockGovernance.
  These mocks emit byte-identical event signatures so swapping in the real
  contracts is purely a deploy concern, not an indexer concern.

### Production-readiness checklist (when graduating from Anvil to Base)

- [ ] WebSocket log subscription
- [ ] Drop polling-mode fallback
- [ ] Add `chain_id` to every table OR per-chain DBs
- [ ] eth_call backfill for non-event state
- [ ] Run against a real reorg on Sepolia first
- [ ] Add Prometheus / OpenTelemetry metrics on the poll loop
- [ ] Add a systemd unit (mirror aeqi-platform.service pattern)
- [ ] Health endpoint surfaces lag (head_block - highest_committed)
- [ ] Token_Transfer filtering strategy decided + implemented

---

## Repository layout

```
aeqi-indexer-build/
├── crates/aeqi-indexer/
│   ├── Cargo.toml                 # alloy v1, async-graphql v7, rusqlite
│   ├── src/
│   │   ├── lib.rs                 # module declarations
│   │   ├── main.rs                # binary entry: env parse + db open + spawn poll/serve
│   │   ├── chain.rs               # alloy provider + reorg + poll loop + dispatch
│   │   ├── decode.rs              # sol! contract blocks (Factory, TRUST, Role, Governance)
│   │   ├── store.rs               # SQLite: migrations + insert/get fns + Row structs
│   │   └── api.rs                 # async-graphql Schema + axum router
├── test-contracts/                # Mock* contracts for live-test smokes
│   ├── MockFactory.sol
│   ├── MockTRUST.sol
│   ├── MockRole.sol
│   └── MockGovernance.sol
└── docs/
    ├── HANDOFF.md                 # this file
    ├── indexer-build-log.md       # full per-tick build log
    ├── indexer-loop-prompt.md     # /loop heartbeat metaprompt
    ├── aeqi-indexer-spec.md       # original architectural spec
    └── aeqi-graph-survey.md       # subgraph entity inventory (135 events catalogued)
```

---

## How to add a new event type (the locked recipe)

The dispatch architecture is mechanical now. To wire up another event:

1. **Find the ABI** — usually `~/projects/aeqi-graph/abis/<Module>.json`.
2. **Add sol! decl** in `crates/aeqi-indexer/src/decode.rs`. New `contract`
   block per module, or extend an existing one.
3. **Add migration** in `crates/aeqi-indexer/src/store.rs` MIGRATIONS array
   (numbered, idempotent, `IF NOT EXISTS` everywhere).
4. **Add store fns**: `insert_*` (and `get_*` for the GraphQL resolver).
   Use `LogCoord<'a>` if 6+ args. Audit logs use `INSERT OR IGNORE` on
   `UNIQUE (..., log_index)`.
5. **Add SIGNATURE_HASH to the `sigs` vec** in `chain::poll::run`.
6. **Add dispatch arm** matching `topic0 == Some(...::SIGNATURE_HASH)`.
   Decode with the arm's own type (`decode_log` validates topic0 — sharing
   decoders across variants drops everything but the matching one).
7. **Add GraphQL** SimpleObject + `From<store::Row>` impl + resolver method
   on `Query` in `api.rs`.
8. **Extend or add a Mock contract** in `test-contracts/`, redeploy, fire
   a smoke event, verify GraphQL returns it.
9. **Run** `cargo test -p aeqi-indexer --release` and
   `cargo clippy -p aeqi-indexer --release -- -D warnings`. Both must be green.
10. **Commit + push** to `indexer-build`. When ready: rebase + ff merge to main.

Average time per event type: ~15 min once you have the rhythm.
