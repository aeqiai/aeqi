# aeqi-indexer — handoff

Built autonomously on 2026-05-04 across ~35 ticks via /loop heartbeat. Replaces
the TheGraph subgraph at `~/projects/aeqi-graph` with a self-hosted Rust
indexer: SQLite + alloy + axum + async-graphql.

**Status:** feature-complete for the v2 demo. 10 contract types covered,
10 mock contracts + live-tested against real aeqi-core (Phases 7–11).
33/33 unit tests green, 42 commits on `indexer-build` branch (as of TICK 33).
Full multi-sig flow indexed across arbitrary block ranges (Phase 11).
Every demo-critical aeqi-core module is shipped: TRUST + Role + Governance
+ Token + Vesting + Funding + Budget + Fund + Factory admin.

**What's NOT in v1:** Foundation module (pure scaffolding — no domain
events). Unifutures + UnifuturesPositionManager + Uniswap modules
(derivative + DEX integrations, niche). All can be added later via the
"How to add a new event type" recipe at the bottom.

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

### Multi-sig variant (cross-block flow)

Same setup as steps 0–2 above. Then in step 3, run the multi-sig script
with two anvil keys (deployer + cosigner):

```bash
cd /home/claudedev/projects/aeqi-core-deploy-fix
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
COSIGNER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
FACTORY_ADDRESS=<factory-from-step-1> \
  forge script scripts/foundry/CreateMultiSigTrust.s.sol \
  --rpc-url http://127.0.0.1:8545 --broadcast --skip-simulation
```

Phase A (deployer broadcast, block N): `replaceTemplate` + `registerTRUST`
with `declaredSigners=[deployer, cosigner]`. `trustStatus = REGISTERED`,
NO auto-create — cosigner hasn't signed.
Phase B (cosigner broadcast, block N+M): `approveTRUST(trustId, ipfsCid)`.
Last signer signs → `trustStatus = APPROVED` + auto-creates the TRUST.

After 12+ confirmation blocks, query the TRUST:

```bash
curl -s -X POST http://127.0.0.1:8500/graphql \
  -H 'content-type: application/json' \
  --data '{"query":"{ trust(address: \"<trust-from-stdout>\") { trustId templateId ipfsCid signersCount valueConfigsCount createdBlock } trustSigners(trustAddress: \"<trust>\") { signerAddress hasSigned addedBlock } }"}' | jq
```

Expected: full TRUST row with `signersCount=2`, both signers with
`hasSigned=true`. Pre-create lookup via `trustById(trustId)` works too —
returns the row with `address: null` between Phase A and Phase B.

---

## Cross-block ordering semantics

The indexer tolerates arbitrary tx-grouping of TRUST creation events. Four
ordering fixes layer:

| Fix | Tick | Problem | Solution |
|---|---|---|---|
| Intra-fetch priority sort | 21 | Real `registerTRUST` emits SignerAdded → Registered → Created in one tx; handlers that look up trust by id ran before Created populated it | Sort logs within each block by topic0 priority (Created → Registered → others) before the dispatch loop |
| Per-block delta-fetch loop | 22 | `TrustCreated` registers the trust as watched, but the trust's own `TRUST_ModuleAdded` events fired in the SAME block weren't in the filter | Per-block dispatch loops; each iteration re-reads `watched_addresses` and fetches logs from the delta until no new addresses |
| `trust_signers` schema v2 | 24 | Multi-sig flow: SignerAdded fires in tx N (registration); TrustCreated only in tx N+M (approval). v1 PK `(trust_address, signer)` required address known | PK `(trust_id, signer)` with `trust_address` as backfilled helper; `insert_trust_created` UPDATEs trust_signers' address when the trust lands |
| `trusts` schema v2 | 25 | Same root cause: TRUSTRegisteredEvent metadata (template, ipfs, counts) fires in tx N before Created in tx N+M; v1 update_trust_registered did UPDATE which missed | PK `(trust_id)` with address/creator/created_* all NULLable; both Created and Registered handlers UPSERT on `trust_id` |

Together these mean: **the indexer is correct for any tx-grouping of TRUST
creation events on real aeqi-core**. Single-tx single-signer (Phase 8)
and multi-tx multi-sig (Phase 11) flows both produce a complete row.

Schema v2 design rationale: `trust_id` is the on-chain stable identity;
`address` is a runtime artifact emitted only by the Created event. Keying
on `address` (v1) tied the row's existence to a specific event ordering.
Keying on `trust_id` (v2) lets either Created or Registered land first
and merge via UPSERT.

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

## Schema (30 migrations, all idempotent)

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
| `019_trust_signers_v2` | `trust_signers` | **schema v2** — PK on `(trust_id, signer_address)` so signers can land before TrustCreated (multi-sig flow) |
| `020_trusts_v2` | `trusts` | **schema v2** — PK on `trust_id`, address `UNIQUE` NULLable so Registered metadata can land before Created |
| `021_factory_admin_events` | `factory_admin_events` | AdminsAdded/AdminsRemoved audit log (one row per address) |
| `022_fundings` | `fundings` | Funding round lifecycle (Created → Active → Finalized/Removed) |
| `023_funding_exits` | `funding_exits` | Funding_ExitExecuted audit log |
| `024_budgets` | `budgets` | Budget lifecycle (Created/Frozen/Active/Removed) |
| `025_budget_movements` | `budget_movements` | Budget Deposit + Consume audit log (amount + counterparty + asset) |
| `026_factory_config` | `factory_config` | Per-factory snapshot of beacon + partner IPFS CID (UPSERT pattern) |
| `027_fund_navs` | `fund_navs` | Fund NAV checkpoints (time-series valuation) |
| `028_fund_flows` | `fund_flows` | Fund deposit/redemption/carry requests with lifecycle (requested/claimed/cancelled) |
| `029_fund_positions` | `fund_positions` | Fund investment positions with open/closed lifecycle |
| `030_fund_position_interactions` | `fund_position_interactions` | Audit log of Fund position management actions |

---

## GraphQL surface (25 queries)

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

  # Funding module (fundraising rounds)
  fundingsForModule(moduleAddress: String!): [Funding!]!
  fundingExits(moduleAddress: String!): [FundingExit!]!

  # Budget module (role-scoped treasury)
  budgetsForModule(moduleAddress: String!): [Budget!]!
  budgetMovements(moduleAddress: String!, budgetId: String!): [BudgetMovement!]!

  # Fund module (LP/GP fund vehicle)
  fundNavs(moduleAddress: String!): [FundNav!]!
  fundFlows(moduleAddress: String!): [FundFlow!]!
  fundPositions(moduleAddress: String!): [FundPosition!]!
  fundPositionInteractions(moduleAddress: String!, positionId: String!): [FundPositionInteraction!]!

  # Factory admin
  templatesForFactory(factoryAddress: String!): [Template!]!
  factoryAdminEvents(factoryAddress: String!): [FactoryAdminEvent!]!
  factoryConfig(factoryAddress: String!): FactoryConfig

  # Multi-sig pre-create lookup (TRUST exists by trust_id, address NULL)
  trustById(trustId: String!): Trust
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
| `MockToken.sol` | ERC20 Transfer (mint/burn via zero address) | TICK 18 |
| `MockVesting.sol` | Vesting lifecycle (Created→Activated→Contributed→Claimed→Removed) | TICK 19 |
| `MockFunding.sol` | Funding round lifecycle + ExitExecuted | TICK 28 |
| `MockBudget.sol` | Budget lifecycle + Deposit/Consume movements | TICK 29 |
| `MockFund.sol` | Fund NAV + flow lifecycle + position lifecycle + interactions | TICK 33 |

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
| **Treasury** | `trust(address)` + `trustModules(trustAddress)` + `tokenHolders(tokenAddress)` per Token module (cap-table view) |
| **Ownership** | `rolesForModule(moduleAddress)` + `roleAssignments(moduleAddress, roleId)` per Role module |
| **Governance** | `proposalsForModule(moduleAddress)` + `votesForProposal(moduleAddress, proposalId)` |
| **Roles tab** | `rolesForModule` returns all roles; replay `roleAssignments` for each to compute current occupant |
| **Permissions tab** | `permissionsEvents(trustAddress, entityId)` audit log; frontend computes effective flags by replaying granted/revoked/set semantics |
| **Vesting tab** | `vestingPositions(moduleAddress)` for the lifecycle list; `vestingContributions(moduleAddress, positionId)` + `vestingClaims(moduleAddress, positionId)` for per-position audit |
| **Fundraising tab** | `fundingsForModule(moduleAddress)` for round list; `fundingExits(moduleAddress)` for the exit audit log |
| **Budgets tab** | `budgetsForModule(moduleAddress)` for the role-scoped budgets; `budgetMovements(moduleAddress, budgetId)` for deposits + consumes per budget |
| **Fund / NAV tab** | `fundNavs(moduleAddress)` for valuation timeline; `fundFlows(moduleAddress)` for LP deposit/redemption/carry pipeline; `fundPositions(moduleAddress)` for portfolio composition |
| **Admin / Templates** | `templatesForFactory(factoryAddress)` + `factoryAdminEvents(factoryAddress)` + `factoryConfig(factoryAddress)` for ops surface |

Field naming uses snake_case in SQLite and store, but async-graphql converts
to camelCase automatically — so apps/ui sees `trustAddress`, `voteStart`,
`createdBlock`, `accountAddress`, etc.

---

## Open work

### Already-known gaps (non-blocking for v1)

- **All demo-critical modules SHIPPED** as of TICK 33: Token + Vesting +
  Funding + Budget + Fund. Foundation skipped (pure scaffolding —
  nothing to index). Unifutures + UnifuturesPositionManager + Uniswap
  remain unported — derivative/DEX niche; each is a ~30-min mechanical
  port via the recipe at the bottom of this doc.
- **Token_Transfer high-frequency.** Will need filtering or sampling
  strategy on Base mainnet — straight per-transfer audit log will balloon.
  Fine on Anvil for v1 demo.
- **eth_call backfill** for non-event state (current treasury balance,
  module-level configuration, vesting position metadata beyond positionId).
  Currently zero. Pattern needed: periodic snapshot job that calls view
  functions on watched addresses.
- **WebSocket log subscription.** Currently HTTP polling every 2s; alloy
  supports WSS via `ProviderBuilder::connect_pubsub` — drop-in upgrade
  for tighter latency.
- **Reorg handling tested only at the parent_hash mismatch detection level.**
  Never seen a reorg in the wild on Anvil. Sepolia/mainnet test would be
  the real validation.
- **Single-chain.** Indexer assumes one RPC. Multi-chain support would need
  per-chain DBs OR a `chain_id` column on every entity table.
- **Governance ProposalCreated dynamic arrays NOT stored** (targets, values,
  signatures, calldatas). ipfs_cid is the v1 demo handle. To execute
  proposals, frontend or a separate decoder needs to pull the full payload.
- **Permissions audit log doesn't compute effective flags.** Frontend job
  to replay granted/revoked/set into a current bitmask. Could be added as
  a derived materialized view or a GraphQL resolver method.
- **`PRAGMA foreign_keys = OFF`** in `store::open`. The schema v1→v2
  migrations DROP+recreate `trusts` and `trust_signers`; SQLite flagged
  the older tables' FKs to `trusts(address)` as mismatched at commit time
  even when address became `UNIQUE`. FKs are advisory in this indexer
  (we never violate them); disabling enforcement is the simplest fix.
  If migrating to Postgres later, the FK semantics will need re-evaluation.

### Original blockers (RESOLVED in Phase 7-C, TICK 20)

- **aeqi-core deploy script drift** — was the original blocker that
  pinned the indexer to mocks. RESOLVED in a sister worktree at
  `/home/claudedev/projects/aeqi-core-deploy-fix` on branch
  `deploy-fix-2026-05-04`. Beacon constructor now takes
  `defaultDelegatedSource`; Factory.initialize() is zero-arg; module
  impls register via `Factory.replaceImplementations(...)` (gated by
  `onlySourceOwner` on the Beacon side). Live-tested against real
  aeqi-core in Phases 8 + 9 + 11. The 9 mock contracts emit
  byte-identical signatures so they remain useful for fast smoke tests
  without spinning up the full deploy chain. Two scripts in the
  deploy-fix worktree exercise the real contracts end-to-end:
  `scripts/foundry/Deploy.s.sol` (initial deploy) and
  `scripts/foundry/CreateTrust.s.sol` (single-sig TRUST creation;
  `CreateMultiSigTrust.s.sol` for the 2-of-2 approval flow).

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
│   │   ├── decode.rs              # sol! blocks: Factory, TRUST, Role, Governance, Token, Vesting, Funding, Budget, Fund
│   │   ├── store.rs               # SQLite: migrations + insert/get fns + Row structs
│   │   └── api.rs                 # async-graphql Schema + axum router
├── test-contracts/                # Mock* contracts for live-test smokes
│   ├── MockFactory.sol
│   ├── MockTRUST.sol
│   ├── MockRole.sol
│   ├── MockGovernance.sol
│   ├── MockToken.sol
│   ├── MockVesting.sol
│   ├── MockFunding.sol
│   ├── MockBudget.sol
│   └── MockFund.sol
└── docs/
    ├── HANDOFF.md                 # this file — pickup doc
    ├── CHANGELOG.md               # phase summary (Keep a Changelog lite)
    ├── DEPLOY.md                  # production-hardening notes (sketch)
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
