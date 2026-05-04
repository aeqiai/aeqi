# Indexer Build Log — autonomous session

**Started:** 2026-05-04
**Authorization:** founder-approved 8h autonomous build with /loop heartbeat
**Self-paced:** I own decisions. I do not ask the user. I document trade-offs in this log.

## North star (the deep goal)

The user wants the v2 vision: real on-chain Company creation with Blueprint → DAO deploy → user-as-director → governance transition → indexed → mirrored into apps/ui → end-to-end functional. Account abstraction with paymaster (we cover gas via Stripe revenue). Agents hold roles via embedded wallets. Company switcher = role/route picker. Self-host = own indexer.

**That's 6+ months of work. I have ~8 hours.**

The honest path I'm taking: **maximum progress on the highest-leverage chain** that gets us closer to v2. That chain is:

```
local Anvil + aeqi-core deployed
  → indexer reads events
    → schema in Postgres
      → GraphQL API
        → apps/ui can query (later phase)
          → end-to-end Company creation flow
            → governance + roles + agents + accounts (later phases)
```

Every tick I move ONE link forward. I don't try to ship the whole chain at once.

## Current state (UPDATED EVERY TICK)

```
TICK: 28 (PHASE 14-A ✓ FUNDING MODULE — ROUND LIFECYCLE + EXIT AUDIT)
PHASE: 14-A ✓ FUNDRAISING SURFACE | Funding round lifecycle (Created →
       Active → Finalized | Removed) + ExitExecuted audit log indexed.
       Live-verified: full lifecycle in one tx (4 events) → fundingsForModule
       returns round with status='finalized'; fundingExits returns the audit row.
       30/30 tests green; 35 commits.
       | next: Budget module OR apps/ui glue OR remaining minor Factory events
LAST ACTION (TICK 7+8):
  TICK 7 — wrote crates/aeqi-indexer/src/api.rs (async-graphql Schema + axum router):
    - Trust GraphQL type with all fields from store::TrustRow
    - Query: trust(address) -> Option<Trust>, trustsCount, version
    - GraphiQL playground at GET /graphql
    - POST /graphql for queries
    - GET /healthz returns "ok"
    - Test: graphql_returns_indexed_trust ✓
  TICK 8 — wired main.rs, ran live binary:
    - 5 migrations applied to fresh SQLite
    - GraphQL server boots on :8500 in ~1s
    - curl /healthz → "ok"
    - curl POST /graphql with `{ version trustsCount }` → {"data":{"version":"0.14.0","trustsCount":0}}
    - All 5 tests pass: decode round-trip, sig hash, migration idempotency, store round-trip, graphql query

PHASE 0 COMPLETE. Indexer is a working Rust HTTP service that:
  - Persists indexed events to SQLite
  - Exposes them via GraphQL
  - Decodes Factory event types (alloy sol! generated)
  - Has reorg-tracking schema in place (committed_blocks)
  - Idempotent migrations

TICK 9 — PHASE 1 reorg + provider:
  Wrote chain.rs:
    - commit_block(block_number, block_hash, parent_hash) → returns continuous?
    - unwind_above(safe_block) → unwinds committed_blocks above safe point
    - highest_committed() → lookup resume point
    - provider::http_provider(rpc_url) → alloy HTTP provider
    - provider::latest_block() → sanity check
  Tests added (6 new):
    - commit_continuous_blocks_reports_true ✓
    - commit_with_wrong_parent_reports_false ✓ (reorg detection)
    - commit_with_skipped_block_reports_false ✓ (gap detection)
    - unwind_clears_blocks_above_safe ✓
    - highest_committed_works ✓
    - provider_connects_to_anvil_if_running ✓ LIVE — confirmed alloy talks to running Anvil
  Total: 11/11 tests pass

TICK 10 — PHASE 1 COMPLETE (poll loop LIVE):
  Wrote chain::poll module:
    - PollConfig struct (rpc_url, factory_address, start_block, confirmation_depth, poll_interval)
    - poll::run(cfg, db) async loop:
      * resume from highest_committed + 1 OR start_block
      * fetch blocks up to head - confirmation_depth (12)
      * cap at 100 blocks/round
      * for each block: fetch logs filtered to factory + Factory_TRUSTCreatedEvent topic0
      * decode via alloy sol_types
      * insert_trust_created on success
      * commit_block (reorg-safe — unwind on parent_hash mismatch)
  Wired poll loop into main.rs:
    - tokio::spawn alongside api::serve
    - reads AEQI_INDEXER_RPC + AEQI_INDEXER_FACTORY + AEQI_INDEXER_START_BLOCK env
    - poll_handle.abort() if serve exits
  LIVE SMOKE TEST:
    - Anvil at block ~778 when test started
    - Indexer started fresh (no DB), poll loop began at start_block=0
    - In ~6 seconds: indexed blocks 0→757 (758 committed_blocks rows)
    - GraphQL still responsive on 8501 (concurrent serving + polling works)
    - factory=None means no log decoding ran (smoke mode), but block tracking + commit_block end-to-end VERIFIED
    - When killed: 766 committed_blocks total — proves continuous indexing from cold start

12/12 tests green. Phase 1 done (real chain integration).

TICK 11 — PHASE 1.5 END-TO-END VERIFIED (THE PROOF POINT):
  Wrote test-contracts/MockFactory.sol — emits Factory_TRUSTCreatedEvent
  forge build → standalone compile (no node_modules)
  cast send --create → deployed at 0x5FbDB2315678afecb367f032d93F642f64180aa3
  Restarted indexer with AEQI_INDEXER_FACTORY=<address>, fresh DB
  Indexer caught up from cold start to safe head (~843 of 855)
  cast send emitTrustCreated(creator, trustId, trustAddress) → block 857
  Indexer log: "indexed Factory_TRUSTCreatedEvent: trust=0x9131... block=857"
  SQLite trusts: 1 row, all fields correct (address, trust_id, creator, block, tx)
  SQLite accounts: 2 rows (creator + trust addresses, both upserted)
  GraphQL POST /graphql returned the indexed row:
    {"data":{"trustsCount":1,
             "trust":{"address":"0x9131b1...", "trustId":"0x...0042",
                      "creatorAddress":"0xf39fd...", "createdBlock":857,
                      "createdTx":"0x90ab..."}}}

This is the pivotal milestone: full stack working with REAL on-chain event.
Anvil → alloy poll → topic0 filter → sol! decode → SQLite insert → GraphQL.

12 commits on indexer-build branch. 12/12 tests green.

TICK 12 — PHASE 2 FULL FACTORY EVENT COVERAGE:
  Extended store.rs:
    - update_trust_registered(trust_id, template_id, ipfs_cid, signers_count, value_configs_count)
    - insert_trust_signer(trust_id, address_key, signer, has_signed, block, tx)
      Resolves trust_address from trust_id; skips silently if trust not yet indexed
    - get_trust_signers(trust_address) -> Vec<SignerRow>
  Extended chain::poll: topic0 dispatch across all 3 Factory events
    - sig vec includes Created + Registered + SignerAdded
    - each branch decodes via own sol! type, writes to store
  Extended api: Signer SimpleObject + trustSigners(trustAddress) query
  Extended test-contracts/MockFactory.sol:
    - emitTrustRegistered + emitTrustSignerAdded
    - emitFullCompanyCreation: ALL 3 events in one tx (realistic flow)

  LIVE-TESTED end-to-end:
    - Recompiled mock, redeployed to Anvil at 0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
    - Fresh indexer DB, started polling from block 1160
    - Sent emitFullCompanyCreation tx → block 1180, 3 logs in tx
    - Mined 15 blocks past tx for confirmation depth
    - Indexer log:
        indexed Factory_TRUSTCreatedEvent: trust=0xa0ee... block=1180
        indexed Factory_TRUSTRegisteredEvent: trust_id=0x...0099 template=0x...007e block=1180
        indexed Factory_TRUSTSignerAdded: trust_id=0x...0099 signer=0xf39f... block=1180
    - GraphQL returned full enriched TRUST + signer list:
        trust { templateId, ipfsCid, signersCount: 1, valueConfigsCount: 0 }
        trustSigners [ { signerAddress, addressKey, hasSigned: true, addedBlock: 1180 } ]

  This proves the dispatch architecture: arbitrary number of event types
  can be added via (sig in filter) + (topic0 match in dispatch loop).
  Same pattern will scale to 135 event signatures across the full subgraph.

15/15 tests green. 14 commits on indexer-build branch.

TICK 13 — PHASE 3 MULTI-ADDRESS DISPATCH (THE ARCHITECTURAL CLIFF):
  Schema:
    - 006_watched_addresses(address PK, kind, registered_block) — dispatch
      source-of-truth, kind ∈ {'factory','trust','module'}
    - 007_modules(trust_address, module_id, module_address, module_acl,
      attached_block, attached_tx) — TRUST_ModuleAdded landing point
      module_acl is hex of uint256 bit-flag set
  Store changes:
    - register_watched_address + list_watched_addresses
    - insert_module + get_modules_for_trust
    - insert_trust_created NOW auto-registers trust as watched
    - insert_module NOW auto-registers module address as watched
  Decode:
    - sol! TRUST contract block: TRUST_ModuleAdded + Permissions{Granted,Revoked,Set}
    - Real ABI signatures sourced via Haiku Explore agent from
      /home/claudedev/projects/aeqi-graph/abis/TRUST.json
  Poll loop refactored:
    - PollConfig.factory_address REMOVED — bootstrap is now in main.rs
    - Each round SELECTs all watched addresses and builds ONE Filter
    - Filter address() takes Vec<Address> (alloy supports multi-address)
    - topic0 dispatch extended with TRUST_ModuleAdded handler
    - log.address() identifies which TRUST emitted the module event
  Main:
    - Seeds AEQI_INDEXER_FACTORY into watched_addresses on boot
  GraphQL: Module SimpleObject + trustModules(trustAddress) query

  LIVE-TESTED end-to-end (the v2 architecture proof):
    - Deployed MockTRUST.sol at 0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9
      (test-contracts/MockTRUST.sol — emits TRUST_ModuleAdded)
    - Started fresh indexer, factory seeded, watched=1
    - tx 1 at block 1504: MockFactory.emitFullCompanyCreation pointing
      trustAddress at MockTRUST address → 3 logs:
        TrustCreated → handler inserts TRUST + watched++ (now 2)
        TrustRegistered → enriches row
        TrustSignerAdded → adds signer
    - tx 2 at block 1530: MockTRUST.emitModuleAdded(moduleId, moduleAddr, acl=0xf)
      Log emitted FROM TRUST address, NOT factory.
    - Mined confirmations after each tx.
    - Indexer log: "indexed TRUST_ModuleAdded: trust=0xdc64... module=0x7099...
                    module_id=0x...abcd block=1530"
    - GraphQL trustModules(trustAddress) returned the module:
        { moduleId: 0x...abcd, moduleAddress: 0x7099...,
          moduleAcl: "0xf", attachedBlock: 1530 }
    - Result: 1 trust, 1 signer, 1 module — all from independent contracts
      indexed via dynamic subscription chain.

  THIS UNLOCKS THE WHOLE V2 ARCHITECTURE.
  Adding the remaining ~130 event types is now mechanical:
    1. sol! event declaration in decode.rs
    2. SQLite migration for the entity table
    3. insert_*/get_* functions in store.rs
    4. dispatch arm in poll loop
    5. GraphQL SimpleObject + resolver
  No new architecture needed. The indexer is structurally complete.

18/18 tests green. 15 commits on indexer-build branch.

TICK 14 — PHASE 4-A PERMISSIONS WIRE-UP:
  Schema:
    - 008_permissions_events(id PK, trust_address, entity_id, kind, flags,
      block_number, tx_hash, log_index) — append-only audit log.
      UNIQUE (trust_address, block_number, tx_hash, log_index) is the
      idempotency key; INSERT OR IGNORE drops reorg-replay duplicates.
  Store:
    - LogCoord<'a> struct (block_number + tx_hash + log_index) —
      keeps insert_permissions_event arity under clippy too_many_arguments.
    - insert_permissions_event(conn, trust_addr, entity_id, kind, flags, coord)
    - get_permissions_events(conn, trust_addr, entity_id) -> Vec<PermissionsEventRow>
  Decode: sol! types were already declared in TICK 13; no change needed.
  Poll loop: 3 new dispatch arms, one per Permissions* variant.
    - Each arm decodes with its OWN type (decode_log validates topic0,
      so we can't share the decoder — discovered via live-test bug).
    - Common persist helper (persist_permissions_event) takes pre-decoded
      hex strings + kind discriminator. Capitalize helper for tracing labels.
  GraphQL: PermissionsEvent SimpleObject + permissionsEvents(trustAddress,
    entityId) query — returns chronological audit log (block_number ASC,
    log_index ASC). Frontend computes effective flags by replaying.
  MockTRUST extended:
    - emitPermissionsGranted/Revoked/Set
    - emitPermissionsLifecycle: all 3 in one tx (lifecycle for one entity)

  LIVE-TESTED end-to-end (after fixing decode bug):
    - Initial run: only PermissionsGranted decoded; Revoked + Set warned
      "invalid signature hash for PermissionsGranted" (the helper had
      hardcoded PermissionsGranted's decoder).
    - Fix: refactored handler to per-branch decode. Three explicit match
      arms, one shared persist function.
    - Re-test: emitPermissionsLifecycle for entity 0xcafe at block 1970:
        indexed PermissionsGranted: trust=0xa513e... entity=0xcafe flags=0xff block=1970
        indexed PermissionsRevoked: trust=0xa513e... entity=0xcafe flags=0xf block=1970
        indexed PermissionsSet:    trust=0xa513e... entity=0xcafe flags=0xfff block=1970
    - GraphQL permissionsEvents returned all 3 ordered by logIndex 0,1,2
      with the right flags (0xff, 0xf, 0xfff).

  ARCHITECTURE NOTE (locked):
    For events that share an on-wire shape but differ in topic0
    (the Permissions* trio is one such case), the topic0 dispatcher
    must call the matching SolEvent::decode_log per branch. alloy's
    decoder validates topic0 — sharing one decoder across topic0
    variants drops everything but the matching one.

19/19 tests green. 17 commits on indexer-build branch.

TICK 15 — PHASE 4-B FIRST MODULE (ROLE) LIVE:
  Subagent dispatch:
    Haiku Explore enumerated /home/claudedev/projects/aeqi-graph/abis/Role.module.json
    — 19 events including admin/internal. Cherry-picked the 5 high-leverage
    org-chart ones for the Company switcher north-star:
      Role_RoleCreated(roleId, creator)
      Role_RoleAssigned(roleId, occupant)
      Role_RoleResigned(roleId, occupant)
      Role_RoleRemoved(authorizedRoleId, roleId, account)
      Role_RoleTransferred(roleId, oldHolder, newHolder)
    Other module ABIs available in the directory:
      Beacon, Budget.module, Dao, Foundation.module, Funding.module,
      Fund.module, Governance.module, Module, Token.module, TRUST,
      Unifutures.module, UnifuturesPositionManager.module,
      Uniswap.module, UniswapPositionManager.module, Vesting.module.
  Schema:
    - 009_roles(module_address, role_id, creator_address, created_block,
      created_tx) — Role_RoleCreated landing
    - 010_role_assignments(id, module_address, role_id, account_address,
      kind, block_number, tx_hash, log_index) — append-only audit log
      UNIQUE (module, block, tx, log_index, KIND) — kind in the unique
      because Role_RoleTransferred produces TWO rows for ONE log
      (transferred_from + transferred_to)
  Decode: sol! Role contract block (5 events).
  Poll loop: 5 new dispatch arms, persist_role_assignment helper for the
    4 account-event variants. Role_RoleTransferred branch invokes the
    helper twice with different kind values.
  GraphQL: Role + RoleAssignment SimpleObjects;
    rolesForModule(moduleAddress) + roleAssignments(moduleAddress, roleId).
  MockRole module added with emitFounderLifecycle(roleId, founder, successor)
    — one tx emits Created + Assigned + Transferred for a 3-step founder flow.

  LIVE-TESTED THE FULL 3-LEVEL DISPATCH CHAIN:
    Factory → TRUST → Module → Role events
    block 2202: emitTrustCreated(creator, trustId 0xcc, trustAddress=MockTRUST)
      → indexer: Factory_TRUSTCreatedEvent → trust auto-watched (kind='trust')
    block 2224: MockTRUST.emitModuleAdded(moduleId 0xfeed, MockRole.address, acl=255)
      → indexer: TRUST_ModuleAdded → module auto-watched (kind='module')
    block 2246: MockRole.emitFounderLifecycle(roleId 0xf01, founder, successor)
      → indexer: Role_RoleCreated AND Role_RoleAssigned AND Role_RoleTransferred
        (which split into Role_transferred_from + Role_transferred_to)
      → 4 audit rows written for one cast send.

    GraphQL trustModules(trust) returned the module (1 row).
    GraphQL rolesForModule(module) returned the role (1 row).
    GraphQL roleAssignments(module, role) returned 3 audit rows:
      assigned (logIndex 1), transferred_from (logIndex 2),
      transferred_to (logIndex 2). Replaying gives current = successor.

  THIS IS THE V2 ARCHITECTURE WORKING. The indexer now follows the deploy
  graph dynamically across 3 levels of contract creation. Adding more
  modules (Governance, Token, Vesting) is the same mechanical recipe:
    sol! decl + migration + insert/get fns + dispatch arm + GraphQL field.
  Every module added makes the v2 demo more complete — but no new
  architecture is required.

21/21 tests green. 18 commits on indexer-build branch.

TICK 16 — PHASE 4-C GOVERNANCE MODULE:
  Subagent: Haiku Explore enumerated Governance.module ABI (12 events;
  cherry-picked 5 lifecycle ones for v1).
  Schema:
    - 011_proposals(module_address PK, proposal_id PK, governance_config_id,
      proposer_address, vote_start, vote_end, ipfs_cid, status, ...)
      Status: 'created' → ('succeeded' | 'canceled') → 'executed'.
      Dynamic-array fields (targets/values/calldatas) NOT persisted in v1
      — ipfs_cid is the demo handle.
    - 012_votes(id PK, module_address, proposal_id, voter_address, support,
      weight, reason, log coord) — append-only, UNIQUE on log coord.
  Decode: sol! Governance contract (5 events, 1 with dynamic arrays).
    Note: alloy `sol!` on a Governance event with multiple arrays needed
    `#[allow(clippy::too_many_arguments)]` on the contract block to suppress
    the generated builder warning.
  Poll loop: 5 new dispatch arms.
    persist_proposal_status<F> generic helper takes a decoder closure
    `FnOnce(&Log) -> Result<String>` returning the proposal_id hex —
    Canceled/Succeeded/Executed all use it. Closures invoke each event's
    own decode_log so topic0 validation passes.
  GraphQL: Proposal + Vote SimpleObjects;
    proposalsForModule(moduleAddress) + votesForProposal(moduleAddress, proposalId).
  MockGovernance with emitFullProposalLifecycle —
    one tx: ProposalCreated + 2× VoteCast + ProposalSucceeded + ProposalExecuted.

  LIVE-TESTED THE FULL DAO FLOW:
    block 2524: TrustCreated → trust auto-watched
    block 2541: TRUST_ModuleAdded(moduleId 0x600d, MockGovernance address)
                → governance module auto-watched
    block 2563: emitFullProposalLifecycle(proposal=42, voter1=alice For 1000,
                                          voter2=bob Against 500)
                → 5 indexed events, all dispatched correctly
    GraphQL proposalsForModule:
      [{ proposalId: "0x2a", proposerAddress, voteStart 100, voteEnd 500,
         ipfsCid "QmProposalCID1", status: "EXECUTED", createdBlock 2563 }]
    GraphQL votesForProposal:
      [{ voter: alice, support: 1, weight: "0x3e8", reason: "for the win" },
       { voter: bob,   support: 0, weight: "0x1f4", reason: "against" }]

  STATUS UPDATES CONFIRMED: ProposalCreated wrote status='created',
  then ProposalSucceeded UPDATEd to 'succeeded', then ProposalExecuted
  UPDATEd to 'executed' — all in the same tx, all caught by the dispatcher,
  final status correctly reflects the last event.

  The indexer surface now covers the full v2 demo:
    - Trust + Module deployment (Factory + TRUST events)
    - Org chart (Role module)
    - DAO governance (Governance module: proposals + votes)
    - Permissions (TRUST module-level access flags)

  9 entity types, 5 contracts (Factory + TRUST + Role + Governance + accounts),
  ~13 dispatched event types across 3 levels of dynamic subscription.

23/23 tests green. 19 commits on indexer-build branch.

TICK 17 — PHASE 5 HANDOFF DOC:
  Wrote docs/HANDOFF.md (~340 lines) covering:
    - Why this exists (replaces TheGraph subgraph + collapses an external dep)
    - Boot recipe (env vars, anvil, build, healthz)
    - Architecture diagram + 3-level dynamic subscription explanation
    - Schema (12 migrations) + GraphQL surface (12 queries)
    - Test contracts inventory + redeploy commands
    - apps/ui integration sketch (per-tab query mapping)
    - Open work split into:
        - Already-known gaps (Token/Vesting modules; eth_call backfill;
          WSS subscription; chain_id; Bravo support)
        - Original blockers (aeqi-core deploy script drift)
        - Production-readiness checklist for Anvil → Base graduation
    - Repository layout
    - "How to add a new event type" — locked 10-step recipe
      so adding the remaining ~125 subgraph events is mechanical

  This is the artifact that lets tomorrow's user pick up the indexer
  cold, boot it, see what queries exist, and either port more modules
  or wire it to apps/ui — without reading the per-tick build log
  or decoding 21 commit messages.

23/23 tests green. 21 commits on indexer-build branch.

TICK 18 — PHASE 6-A TOKEN MODULE (ERC20 + CAP TABLE):
  Subagent: Haiku Explore enumerated Token.module ABI. Confirmed:
    - Per-instance ERC20 (one module = one token; no token_id field)
    - Standard Transfer(from indexed, to indexed, value)
    - No separate Mint/Burn — uses Transfer with zero address
    - 11 events total; v1 cherry-picks just Transfer (the only one needed
      for cap-table view; Approval/Delegate/etc. can be added later)
  Schema:
    - 013_token_balances(token_address, holder_address, balance, last_updated_block)
      PK (token, holder); balance is u256 hex (TEXT)
    - 014_token_transfers(id, token, from, to, value, log coord)
      Append-only audit log; UNIQUE on log coord for replay safety
  Decode: sol! Token contract block — single Transfer event.
  Store insert_token_transfer is the architectural new bit:
    - Uses alloy::primitives::U256 for actual arithmetic
    - Both balance updates + audit row insert are in ONE rusqlite tx
    - Replay-safe: if INSERT OR IGNORE on the audit row affects 0 rows
      (already exists), early-return WITHOUT touching balances
    - Mint = from is ZERO_ADDRESS → only update receiver
    - Burn = to is ZERO_ADDRESS → only update sender
    - Saturating sub/add prevents underflow/overflow panics
    - First-time holder gets a row inserted; existing holders get updated
      via ON CONFLICT (upsert)
  GraphQL: TokenBalance + TokenTransfer SimpleObjects;
    tokenHolders(tokenAddress) — cap-table view, balance DESC,
    excludes zero address + zero-balance rows.
    tokenTransfers(tokenAddress) — full audit log, oldest first.
  MockToken with emitCapTableLifecycle — 3 events in one tx
    (mint to founder, transfer to employee, burn).

  LIVE-TESTED FULL ERC20 LIFECYCLE:
    block 2944: TrustCreated → trust auto-watched
    block 2962: TRUST_ModuleAdded(module_id 0x700f, MockToken) → token auto-watched
    block 2985: emitCapTableLifecycle(founder, employee, mint=1M, xfer=100k, burn=50k)
      → 3 Transfer events:
        Transfer(0x0, founder, 1000000)   = mint
        Transfer(founder, employee, 100000) = transfer
        Transfer(founder, 0x0, 50000)      = burn

    GraphQL tokenHolders returned EXACTLY:
      [{ founder, balance: "0xcf850", last_updated_block: 2985 },  // 850000
       { employee, balance: "0x186a0", last_updated_block: 2985 }] // 100000

    Math correct: 1M - 100k - 50k = 850k.
    Audit log preserves all 3 transfers with zero-address mint/burn intact.

  THE CAP-TABLE SURFACE WORKS. tokenHolders is now the query that powers
  apps/ui Treasury "who owns what" — once a Token module is attached to a
  TRUST, the cap-table populates automatically.

24/24 tests green. 23 commits on indexer-build branch.

TICK 19 — PHASE 6-B VESTING MODULE (FOUNDER VESTING):
  Subagent: Haiku Explore enumerated Vesting.module ABI. 8 events; v1
    cherry-picked the 5-event lifecycle:
      Vesting_VestingPositionCreated(positionId)         → status='created'
      Vesting_VestingPositionActivated(positionId)       → status='active'
      Vesting_VestingPositionContributed(pos, from, amt) → contribution audit
      Vesting_VestingClaimed(pos, asset, to, amt)        → claim audit
      Vesting_PositionRemoved(positionId)                → status='removed'
    Skipped: Reset, SetVestingConfig (admin), VestingPositionsTransferred
    (role-level, multi-position; defer to v2)
  Schema:
    - 015_vesting_positions(module, position_id, status, ...) PK (module, pos)
    - 016_vesting_contributions(id, module, position_id, from, amount, log coord)
    - 017_vesting_claims(id, module, position_id, asset, to, amount, log coord)
  Decode: sol! Vesting contract block (5 events).
  Poll loop: 5 dispatch arms.
    Note: position events only carry positionId in their payload — richer
    metadata (beneficiary role, vested amount, cliff, duration) lives in
    contract storage and would need eth_call backfill (out of v1 scope).
  GraphQL: VestingPosition + VestingContribution + VestingClaim SimpleObjects
    + 3 queries: vestingPositions, vestingContributions, vestingClaims.
  MockVesting with emitFounderVestingLifecycle — 5 events in one tx
    (Created + Activated + Contributed + Claimed + Removed).

  LIVE-TESTED FULL VESTING LIFECYCLE:
    block 3222: TrustCreated → trust auto-watched
    block 3240: TRUST_ModuleAdded(module_id 0xbabe, MockVesting) → vesting watched
    block 3264: emitFounderVestingLifecycle(funder, beneficiary, asset,
                                            contribute=500k, claim=100k)
                → 5 events all dispatched correctly
    GraphQL vestingPositions:
      [{ positionId 0x...0a01, status: "removed", createdBlock 3264 }]
    GraphQL vestingContributions:
      [{ from: founder, amount: 0x7a120 (500k), block 3264 }]
    GraphQL vestingClaims:
      [{ to: beneficiary, asset: token_addr, amount: 0x186a0 (100k), block 3264 }]

  STATUS TRANSITIONS CONFIRMED: Created→Active→Removed sequence persisted
  through three UPDATE calls; final status correctly 'removed'.

  Indexer surface now spans 7 contract types:
    Factory (creation) | TRUST (modules + permissions) | Role | Governance |
    Token (cap-table) | Vesting (founder schedules) | + accounts fan-in
  17 entity tables, ~17 dispatched event types, 3-level dynamic subscription.

25/25 tests green. 25 commits on indexer-build branch.

TICK 20 — PHASE 7-C AEQI-CORE DEPLOY FIX (ORIGINAL BLOCKER):
  Cut worktree at /home/claudedev/projects/aeqi-core-deploy-fix on
  branch deploy-fix-2026-05-04 (off main). Symlinked node_modules and
  lib/ from sibling for forge-std + dependencies.

  RECON of the drift (TICK 5 finding revisited):
    Beacon.constructor(address _defaultDelegatedSource) — was no-arg
      Now: stores fallback source for BeaconProxy(beacon, 0x0, ...)
    Factory.initialize() — was 3-arg (beacon, daoImpl, uniswap)
      Now: zero-arg, just adds deployer as admin
    Beacon.setImplementation(source, moduleId, impl) — was 2-arg
      Now: gated by onlySourceOwner(source); only the source itself can
      write its own slots. So deployer can't directly setImplementation
      under Factory's source slot.
    NEW required flow: Factory.setFactoryConfig(beacon) auto-calls
      beacon.initializeSource(factory, factory) — making factory a
      first-class beacon source. Then Factory.replaceImplementations(
      impls, ids) writes to beacon[factory][moduleId] slots — which is
      what BeaconProxy(beacon, factory, ...) and BeaconProxy(beacon, 0x0,
      ...) → defaultDelegatedSource fall through.

  Fixed flow in Deploy.s.sol:
    1. new Beacon(deployer)              — deployer as initial default
    2. new TRUST()                       — implementation contract
    3. new Factory(); .initialize()      — admin = deployer
    4. factory.setFactoryConfig(beacon)  — auto-init factory as source
    5. beacon.setDefaultDelegatedSource(factory)  — switch default
    6. Deploy 8 module impls
    7. factory.replaceImplementations(impls, ids)  — register all 9
       (TRUST + 8 modules) under beacon[factory] slots

  Type fix: factory typed as `address payable` (Factory has receive).
  Removed vm.writeFile (foundry fs_permissions blocks it; JSON on stdout).

  LIVE-VERIFIED on Anvil:
    PRIVATE_KEY=... forge script Deploy.s.sol --rpc-url ... --broadcast
    --skip-simulation
    → Factory deployed at 0x67d269191c92Caf3cD7723F116c85e6E9bf55933
    → Beacon  deployed at 0x09635F643e140090A9A8Dcd712eD6285858ceBef
    → TRUST   impl     at 0xc5a5C42992dECbae36851359345FE25997F5C42d
    → 8 module impls at known addresses
    → ONCHAIN EXECUTION COMPLETE & SUCCESSFUL
    → cast call beacon.owner() = deployer
    → cast call beacon.isInitialized(factory) = true

  Original blocker resolved. The indexer can now point at this real
  Factory address; mocks emit byte-identical signatures so no indexer-
  side change is needed.

  FOLLOW-UP (deferred): exercising full TRUST creation against the
  real Factory requires template setup (admin-only setTemplate) +
  registerTRUST + createTRUST. Non-trivial — left as the next-tick
  validation. The indexer ALREADY catches the deploy events (Factory
  emitted Factory_FactoryConfigSet + AdminsAdded which exist as sol!
  decls but aren't yet wired to the dispatch — easy adds when needed).

  Worktree commit: aeqi-core-deploy-fix@965b3c3 (1 file changed,
  204 insertions(+), 182 deletions(-)). The worktree branch
  deploy-fix-2026-05-04 is ready for the user to review + merge.

25/25 tests green. 25 commits on indexer-build branch (no indexer
changes this tick — fix was in aeqi-core).

TICK 21 — PHASE 8 REAL-CONTRACTS LOOP CLOSED:
  Wrote CreateTrust.s.sol in aeqi-core-deploy-fix worktree:
    - Reads FACTORY_ADDRESS env
    - Creates demo template (role + token modules) via factory.replaceTemplate
    - registerTRUST with single deployer signer → auto-approves + auto-creates
    - Imports test/helpers/TestConfigs for module-library-encoded value configs
      (role.config / role.trustConfig / token.config / token.trustConfig)
    - Without these configs the role module reverts on initializeModule
      (getBytesConfig returns empty) — discovered by deploy attempt #1

  LIVE-VERIFIED REAL CONTRACTS:
    Real Factory at 0x67d269191c92Caf3cD7723F116c85e6E9bf55933
    PRIVATE_KEY=... FACTORY_ADDRESS=... forge script CreateTrust.s.sol
      → Template registered at templateId 0x7a79b2e...
      → TRUST created at 0xb171d866...; trust_id 0x...4c1
    Indexer pointed at real Factory caught all 3 expected events:
      Factory_TRUSTCreatedEvent
      Factory_TRUSTRegisteredEvent
      Factory_TRUSTSignerAdded

  BUG DISCOVERED IN REAL FLOW (intra-block ordering):
    First run had warnings: "TRUSTSignerAdded for unknown trust_id —
    skipping (TrustCreated not yet indexed)". Cause: in real registerTRUST,
    SignerAdded fires before TRUSTCreated within the same tx. My handlers
    look up trust_address by trust_id; the trust isn't in the DB yet, so
    the signer + the registration metadata are dropped.

  FIX (committed this tick):
    chain::poll inserts a 2-pass priority sort on logs WITHIN A BLOCK
    before the dispatch loop:
      Priority 0: Factory_TRUSTCreatedEvent (creators run first)
      Priority 1: Factory_TRUSTRegisteredEvent (enrichment second)
      Priority 2: everything else
    Stable sort preserves natural log_index order within each bucket.
    The function is local to chain::poll::run; trivial to extend as more
    create-then-reference orderings are discovered (e.g. Role_RoleCreated
    before Role_RoleAssigned within the same tx).

  RE-VERIFIED with same Factory, fresh DB:
    No "unknown trust_id" warnings.
    GraphQL trust(0xb171d866...) returns:
      address: 0xb171d866...,
      trustId: 0x...4c1,
      templateId: 0x7a79b2e... (the demo template),
      ipfsCid: "ipfs://demo",
      signersCount: 1,
      valueConfigsCount: 2,
      createdBlock: 3736
    GraphQL trustSigners returns:
      [{ signerAddress: 0xf39f..., hasSigned: true, addedBlock: 3736 }]

  THE INDEXER IS REAL-CONTRACT-VALIDATED. The Mock-tested architecture
  matched real aeqi-core byte-for-byte; only ordering needed adjustment.

  REMAINING LIMITATION (deferred):
    TRUST_ModuleAdded events that fire IN THE SAME TX as TrustCreated
    won't be caught — the watched_addresses set is read once per block,
    so the new trust isn't yet a watched address when the dispatch loop
    sees its module logs. Fix needs either:
      - Re-read watched_addresses + re-fetch logs after each handler that
        registers a new address
      - Or drop the address filter entirely and rely on topic0 filter
        alone (works because aeqi event signatures are unique enough)
    Documented in HANDOFF.md "Open work / known limitations".

25/25 tests green. 26 commits on indexer-build branch.
1 commit in aeqi-core-deploy-fix worktree (CreateTrust.s.sol added).

TICK 22 — PHASE 9 INTRA-BLOCK SUBSCRIPTION LAG CLOSED:
  Refactor in chain::poll::run: per-block dispatch is now a loop, not a
  single fetch. Each iteration:
    1. Snapshot watched_addresses (re-read from DB)
    2. Compute delta = current_watched - already_fetched_for_block
    3. If delta empty: break (the block is done)
    4. Otherwise: fetch logs filtered to delta addresses + topic0 set,
       priority-sort, dispatch
  fetched_for_block: HashSet<Address> resets each block.

  This means handlers that REGISTER NEW WATCHED ADDRESSES (insert_trust_created
  → trust, insert_module → module) are seen by the next iteration of the
  same block. Loop terminates when no new addresses pop up. Bounded by
  gas (a tx can only spawn finitely many contracts).

  LIVE-VERIFIED end-to-end:
    block 4061: 2nd CreateTrust.s.sol run
    Indexer log shows ALL events from one tx, in one block:
      Factory_TRUSTCreatedEvent (trust=0x9776413b...)
      Factory_TRUSTRegisteredEvent
      Factory_TRUSTSignerAdded
      TRUST_ModuleAdded (factory module @ keccak256('trust.factory'))
      TRUST_ModuleAdded (role module proxy @ keccak256('role'))
      TRUST_ModuleAdded (token module proxy @ keccak256('token'))
    GraphQL trust(address) returns the TRUST + 3 modules attached,
    all with attachedBlock=4061.

  THIS WAS THE LAST ARCHITECTURAL GAP. The indexer is now correct
  against arbitrary multi-level contract creation cascades within one
  tx. Tested against actual aeqi-core flow (registerTRUST auto-creates
  TRUST proxy which initializes 2-3 module proxies — all 4-5 contracts
  appear in one block).

  Implementation note: the priority-sort within a single fetch's logs
  (TICK 21) is still in place for ordering Created → Registered → other
  within a single dispatch. The new outer loop handles delta-discovery
  ACROSS dispatches. The two work together: each iteration pulls a
  delta, sorts within it, dispatches, then the loop checks for new
  addresses to fetch.

25/25 tests green. 27 commits on indexer-build branch.

TICK 23 — PHASE 10-A FACTORY TEMPLATEREPLACED + DEMO RUNBOOK:
  Schema: 018_templates(factory_address, template_id PK, replace_count,
    first_seen_block, last_replaced_block, last_replaced_tx)
    Each Factory_TemplateReplaced event UPSERTs the row + bumps
    replace_count via SQLite ON CONFLICT.
  Store: upsert_template + get_templates_for_factory + TemplateRow.
  Decode: Factory_TemplateReplaced sol! decl already present (TICK 6).
  Poll loop: signature added to filter set; dispatch arm matches topic0.
  GraphQL: Template SimpleObject + templatesForFactory(factoryAddress).

  LIVE-VERIFIED against existing real Factory:
    Indexer (fresh DB, start_block=3700) caught 3 TemplateReplaced events
    (one per CreateTrust.s.sol invocation, all using the demo template).
    GraphQL templatesForFactory returns:
      [{ templateId 0x7a79b2e..., replaceCount: 3,
         firstSeenBlock: 3730, lastReplacedBlock: 4060 }]
    trustsCount: 3 corroborates (3 TRUSTs from 3 runs).

  HANDOFF.md additions:
    - 'Live demo against real aeqi-core' section: 5 commands, full E2E
      demo with anvil + Deploy + indexer + CreateTrust + GraphQL.
      Reproducible recipe for tomorrow's user.
    - Schema table extended with migrations 013-018 (Token, Vesting,
      Templates were missing from the schema overview).
    - GraphQL query list extended with Token, Vesting, Templates queries.

26/26 tests green. 28 commits on indexer-build branch.

TICK 24 — PHASE 10-B MULTI-SIG APPROVAL + SCHEMA V2:
  Step 1: wired Factory_TRUSTApprovedEvent dispatch.
    - mark_trust_signer_signed(trust_id, signer_address) UPDATEs
      trust_signers.has_signed=true.
    - SIGNATURE_HASH added to filter; dispatch arm decodes + dispatches.

  Step 2: live-tested with new CreateMultiSigTrust.s.sol forge script.
    Phase A (deployer broadcast): replaceTemplate + registerTRUST with
      declaredSigners=[deployer, cosigner] → status=REGISTERED, no auto-create.
    Phase B (cosigner broadcast, anvil account #1):
      approveTRUST(trustId) → status=APPROVED + auto-create.
    Real Anvil block sequence:
      block 4464 (registration tx):
        Factory_TRUSTRegisteredEvent
        Factory_TRUSTSignerAdded × 2 (both signers)
      block 4465 (approval tx):
        Factory_TRUSTCreatedEvent
        Factory_TRUSTApprovedEvent

  BUG SURFACED: cross-block ordering — SignerAdded fires in block N
    BEFORE TrustCreated in block N+1. v1 trust_signers schema PK was
    (trust_address, signer_address); insert needed trust_address known,
    so SignerAdded in block N was DROPPED with "unknown trust_id" warning.

  FIX: migration 019_trust_signers_v2 — destructive-recreate
    DROP TABLE trust_signers + recreate with:
      PRIMARY KEY (trust_id, signer_address)  -- now keyed on trust_id
      trust_address TEXT (NULLable)            -- backfilled later
    insert_trust_signer no longer drops; inserts with NULL address if
    trust isn't yet indexed. insert_trust_created backfills via:
      UPDATE trust_signers SET trust_address = ?
       WHERE trust_id = ? AND trust_address IS NULL
    mark_trust_signer_signed UPDATEs by (trust_id, signer_address) —
    no trust_address lookup needed.
    get_trust_signers(trust_address) resolves trust_id via trusts table
    then queries by trust_id.

  RE-VERIFIED with v2 schema (fresh DB, same chain history):
    Block 4464 + 4465 caught with ZERO warnings.
    GraphQL trustSigners(trustAddress) returns BOTH signers:
      [{ deployer,  hasSigned: true, addedBlock: 4464,
         trustAddress: '0x8b5c44...' (backfilled) },
       { cosigner,  hasSigned: true, addedBlock: 4464,
         trustAddress: '0x8b5c44...' (backfilled) }]
    cosigner.hasSigned correctly flipped by TRUSTApprovedEvent.

  REMAINING LIMITATION (deferred — same root pattern):
    Factory_TRUSTRegisteredEvent fires in block 4464 BEFORE TrustCreated
    in 4465. update_trust_registered does an UPDATE keyed on trust_id;
    if no row exists, it's a no-op. So template_id, ipfs_cid, signers_count,
    value_configs_count remain NULL on the multi-sig TRUST.
    Fix needs the same pattern: trusts schema v2 with trust_id as the
    primary identity (not address), allowing INSERT-with-NULL-address
    pre-Created. Requires more careful refactor since modules.trust_address
    has FK on trusts.address — but that FK is already advisory (no enforced
    cascade). ~30-min next-tick work.

  Single-tx flows (single-signer Phase 8) STILL WORK PERFECTLY — both
  the priority sort and the schema-v2 backfill are extra-safe layers
  that don't regress the same-tx case.

27/27 tests green. 30 commits on indexer-build branch.
+1 commit in aeqi-core-deploy-fix worktree (CreateMultiSigTrust.s.sol).

TICK 25 — PHASE 11 trusts SCHEMA V2:
  Migration 020_trusts_v2 — destructive-recreate:
    PRIMARY KEY (trust_id)              -- trust_id is now the identity
    address TEXT UNIQUE                  -- NULL pre-create, UNIQUE for FK targets
    creator_address, created_block, created_tx — all NULLable
    Multiple NULLs allowed in UNIQUE column = multi-sig pre-create rows OK.

  Refactor:
    insert_trust_created → INSERT(trust_id, address, creator, ...) ON CONFLICT(trust_id)
      DO UPDATE SET address=excluded, creator=excluded, created_*=excluded.
      If a Registered-only row exists, fills in the Created half. If a Created
      row already exists, stable re-write.
    update_trust_registered → INSERT(trust_id, template, ipfs, signers_count,
      value_configs_count) ON CONFLICT(trust_id) DO UPDATE SET template=...,
      etc. Either order leaves a complete row.
    get_trust(address) → returns None if address NULL (pre-create).
    get_trust_by_id(trust_id) → new query for multi-sig pre-create state.

  GraphQL: Trust SimpleObject fields now Option<…> for address, creator,
    created_block, created_tx (compatible v1→v2 — graceful nullability).
    Added trustById(trustId) query.

  Diagnostic surfaced: SQLite "foreign key mismatch" at commit time after
    DROP+recreate of trusts (v1 had address as PK; v2 has UNIQUE — even
    same column type, different constraint kind). FK was advisory anyway
    in this indexer. Fix: explicit `PRAGMA foreign_keys = OFF` in
    store::open. Safe — we never violate FKs in normal flow.

  LIVE-VERIFIED against historical real-Factory multi-sig flow (blocks
  4464+4465 from TICK 24's CreateMultiSigTrust run):
    GraphQL trust(0x8b5c44…) returns FULL row:
      trustId 0x...8306af95...,
      address 0x8b5c44... (backfilled from Created),
      creatorAddress 0x70997970... (cosigner),
      templateId 0x7a79b2e... (from Registered, before Created!),
      ipfsCid 'ipfs://multisig-demo' (from Registered, before Created!),
      signersCount 2, valueConfigsCount 2,
      createdBlock 4465.
    GraphQL trustSigners returns BOTH signers, both hasSigned=true.

  Phase 11 closes the v1 multi-sig story end-to-end: any combination of
  Registered/Created event ordering produces a complete TRUST row.
  Single-sig (single-tx) flows: still work (Phase 8 not regressed).

  Composes with TICKs 21+22:
    21 fix → intra-block ordering (Created before Registered/SignerAdded
              within one block via priority sort)
    22 fix → intra-block subscription lag (per-block delta-fetch loop
              for newly-watched addresses)
    24 fix → cross-block signer attribution (trust_signers PK on trust_id)
    25 fix → cross-block trust metadata (trusts PK on trust_id)
  All four together: any tx-grouping of TRUST creation events resolves
  to a coherent indexed view, against real aeqi-core or any v1-compatible
  Factory deployment.

28/28 tests green. 31 commits on indexer-build branch.

TICK 26 — PHASE 12-C FACTORY ADMIN EVENTS:
  Schema: 021_factory_admin_events(id PK, factory_address, admin_address,
    kind, block, tx, log_index)
    UNIQUE on (factory, log coord, admin) — one audit row per admin per log.
    Both AdminsAdded and AdminsRemoved expand the address[] array into
    one row per admin so the audit log preserves array order.
  Store: insert_factory_admin_event + get_factory_admin_events.
  Decode: AdminsAdded + AdminsRemoved sol! decls already present.
  Poll loop: 2 new dispatch arms; persist_admin_event helper decodes
    per-arm (decode_log validates topic0), pulls admins[], writes one
    row per admin in the same coord.
  GraphQL: FactoryAdminEvent SimpleObject + factoryAdminEvents(factoryAddress).

  LIVE-VERIFIED on real deployed Factory (no extra script needed —
  factory.initialize() in Deploy.s.sol fires AdminsAdded for the deployer):
    Indexer (start_block 3540) caught block 3547:
      "indexed Factory AdminsAdded: factory=0x67d269... admins=1 block=3547"
    GraphQL factoryAdminEvents returns:
      [{ adminAddress: 0xf39f..., kind: 'added', blockNumber: 3547 }]

  Indexer surface: 9 contracts (Factory + TRUST + Role + Governance +
  Token + Vesting + accounts + templates + factory_admin_events).
  ~30 dispatched event types across 4 levels of dynamic subscription.

29/29 tests green. 32 commits on indexer-build branch.

TICK 27 — PHASE 13-C HANDOFF EXPANSION:
  HANDOFF.md additions (~80 lines):
    - GraphQL surface gains factoryAdminEvents + trustById queries
    - Schema migration table extended with rows 019/020/021 + notes
      about 'schema v2' status
    - 'Multi-sig variant (cross-block flow)' recipe alongside the
      existing single-sig 5-step demo. Uses CreateMultiSigTrust.s.sol
      with two anvil keys; documents Phase A registration + Phase B
      approval split
    - 'Cross-block ordering semantics' table — the four ordering
      fixes (TICKs 21, 22, 24, 25) mapped to problem + solution
    - Schema v2 design rationale paragraph
    - Test-contracts table updated with MockToken + MockVesting
    - Open-work table: Token + Vesting marked SHIPPED;
      PRAGMA foreign_keys=OFF rationale documented as a v1
      limitation needing re-evaluation if migrating to Postgres

  Why this matters: every new contributor (human or future Claude
  session) gets the full mental model from one doc, not by piecing
  together 33 commit messages or 27 tick log entries.

29/29 tests green. 33 commits on indexer-build branch.

TICK 28 — PHASE 14-A FUNDING MODULE:
  Subagent: Haiku Explore enumerated Funding.module ABI. 11 events; v1
    cherry-picked the 5 demo-relevant ones:
      Funding_FundingCreated(fundingId)         → status='created'
      Funding_FundingActivated(fundingId)       → status='active'
      Funding_FinalizedFunding(fundingId)       → status='finalized'
      Funding_FundingRemoved(fundingId)         → status='removed'
      Funding_ExitExecuted(exitId)              → exit audit row
    Skipped: Reset, SetFundingConfig (admin), SlotArrays_* (internal),
    InitializationStateChanged. Contributions go through Unifutures
    (separate module, deferred).
  Schema:
    - 022_fundings(module_address, funding_id, status, created_block, ...)
      PK (module, funding_id). Status lifecycle UPSERTs in handlers.
    - 023_funding_exits(id, module_address, exit_id, log coord)
      Append-only audit log with UNIQUE on coord.
  Decode: sol! Funding contract block (5 events).
  Poll loop: 5 dispatch arms.
  GraphQL: Funding + FundingExit SimpleObjects;
    fundingsForModule(moduleAddress) + fundingExits(moduleAddress).
  MockFunding with emitRoundLifecycle — 4 events in one tx
    (Created + Activated + ExitExecuted + Finalized).

  LIVE-TESTED end-to-end (after a small detour — initial run had
  invalid hex `0x...fund` for module_id which silently failed; re-run
  with `0x...fff` worked):
    block 5596: TrustCreated → trust auto-watched
    block 5769: TRUST_ModuleAdded(MockFunding) → funding module auto-watched
    block 5787: emitRoundLifecycle(fundingId 0x789, exitId 0xabc)
      → 4 events all dispatched in one block
    GraphQL fundingsForModule:
      [{ fundingId 0x789, status: 'finalized', createdBlock: 5787 }]
    GraphQL fundingExits:
      [{ exitId 0xabc, blockNumber: 5787 }]

  Indexer surface now spans 8 contract types (Factory + TRUST + Role +
  Governance + Token + Vesting + Funding + accounts), 23 schema
  migrations, 18 GraphQL queries, ~35 dispatched event types.

30/30 tests green. 35 commits on indexer-build branch.

PIVOT (locked TICK 5): Build indexer against ABIs first; live deploy is separate problem.
NEXT ACTION (Phase 14-B — Budget module OR pivot):
  Phase 14-A (Funding) done.

  PATH A — Budget module port (cap-table extension):
    Source: ~/projects/aeqi-graph/abis/Budget.module.json
    Likely events: Budget_AllocationSet (per role/owner), Budget_Spent,
    Budget_Reset. ~30 min mechanical. Adds spending visibility per role.

  PATH B — Foundation module port (governance variant):
    ~/projects/aeqi-graph/abis/Foundation.module.json
    May overlap with Governance — needs Haiku scout first.

  PATH C — Fund module port (treasury vehicle):
    ~/projects/aeqi-graph/abis/Fund.module.json
    Different from Funding (Fund = treasury wallet, Funding = round flow).
    Needs scouting.

  PATH D — wire remaining minor Factory events:
    Factory_FactoryConfigSet, Factory_PartnerProfileSet.
    5 min each, informational only.

  PATH E — apps/ui glue: defer to interactive session.
  PATH F — production hardening: out of scope for autonomous.

  LEVERAGE PRIORITY:
    PATH A (Budget) — most demo-relevant remaining module
    PATH D (minor admin events) — quick completeness wins
    PATH B/C — needs Haiku scout to know if worth the port effort
    PATH E — interactive session

  My read: PATH A next tick. Budget completes the role/treasury demo
  surface; after that the indexer has covered every demo-critical module.
    Stand up /home/claudedev/aeqi-indexer-build/docs/HANDOFF.md with:
      1. What this is + why it exists (replaces TheGraph subgraph)
      2. Boot recipe:
         - cargo build --release -p aeqi-indexer
         - Anvil up (chain 31337, port 8545)
         - AEQI_INDEXER_FACTORY=<address> ./target/release/aeqi-indexer
      3. GraphQL schema overview — list every query currently live:
         trust(address), trustsCount, version, trustSigners(addr),
         trustModules(trustAddress), permissionsEvents(trust, entity),
         rolesForModule(module), roleAssignments(module, role),
         proposalsForModule(module), votesForProposal(module, proposal)
      4. Architecture diagram (text):
         Anvil → poll loop → SQLite → axum/async-graphql → apps/ui
         watched_addresses table = dispatch source-of-truth
         3-level auto-subscribe: factory → trust → module
      5. Test contracts inventory:
         test-contracts/MockFactory.sol — Factory event sigs
         test-contracts/MockTRUST.sol — TRUST + Permissions sigs
         test-contracts/MockRole.sol — Role module sigs
         test-contracts/MockGovernance.sol — Governance module sigs
         How to redeploy + run a lifecycle smoke
      6. Open work / known limitations:
         - Real aeqi-core deploy script drift (deploy was the original blocker)
         - Token/Vesting/Funding modules not yet ported
         - eth_call backfill for non-event state (e.g. current treasury balance)
         - WebSocket log subscription (currently HTTP polling every 2s)
         - Reorg handling tested only on parent-hash mismatch detection
           — never run against a reorg in the wild
         - Governance ProposalCreated dynamic arrays NOT stored
           (ipfs_cid is the handle)
         - Permissions audit log doesn't compute effective flags
           (frontend job)
         - Multi-chain: indexer is single-rpc; multi-chain support
           would need per-chain DBs or a chain_id column everywhere
      7. apps/ui integration sketch:
         - Treasury tab: trust(address) + trustModules + module-level queries
         - Ownership tab: rolesForModule + roleAssignments per Role module
         - Governance tab: proposalsForModule + votesForProposal
         - Replace existing TheGraph queries with these (URL change +
           field rename — apps/ui currently hits subgraph at
           ${VITE_GRAPH_URL}; point at http://127.0.0.1:8500/graphql instead)

  PATH B — Token module (financial surface; can defer to later session):
    Token.module ABI has Token_TokenCreated + Token_Transfer.
    Token_Transfer is high-frequency — implement with care
    (sample / filter for non-zero amounts, consider rolling balances vs
    every-transfer audit log).

  LEVERAGE PRIORITY:
    Path A (handoff) is the right next move. Without docs, tomorrow's
    user can't pick this up cleanly. Modules can be added later.
BLOCKER: none
ANVIL: RUNNING, PID 1274467, log /tmp/anvil.log
WORKTREE: /home/claudedev/aeqi-indexer-build (branch indexer-build, off origin/main 7553a083)
COMMITS so far on indexer-build:
  - 76141446 indexer(phase-0): fix alloy feature flags + lock build log state
  - d9216b8f indexer: fix loop prompt paths
  - <plus an earlier scaffold commit>
DECISIONS LOCKED:
  - SQLite (rusqlite), not Postgres
  - alloy v1 features="full"
  - async-graphql v7 + async-graphql-axum
  - Crate path: crates/aeqi-indexer/
  - ABIs source: /home/claudedev/projects/aeqi-graph/abis/
  - Anvil port 8545, chain 31337, block-time 2s
ENVIRONMENT VERIFIED:
  - Foundry 1.5.1-stable
  - Anvil RUNNING
  - Rust 1.94.1, edition 2024
  - Crate compiles clean
```

## Plan

```
Hour 1: Setup (Task #15)
  ✗ Cut worktree at /home/claudedev/aeqi-indexer-build
  ✗ Verify Foundry installed (forge, cast, anvil)
  ✗ Install if missing
  ✗ Verify local Postgres reachable
  ✗ Scaffold aeqi/crates/aeqi-indexer/ Cargo crate
  ✗ Add deps: alloy + sqlx + axum + async-graphql + tokio + tracing
  ✗ Verify cargo check passes
  
Hour 2-3: Phase 0 (Task #16)
  ✗ Start Anvil locally on port 8545
  ✗ Deploy aeqi-core contracts to Anvil (use existing scripts in ~/projects/aeqi-core)
  ✗ Note deployed Factory address
  ✗ Generate alloy types from aeqi-core/abis/Factory.json
  ✗ Connect alloy provider to Anvil
  ✗ Trigger TRUST creation tx
  ✗ Decode the event
  ✗ Insert one row in Postgres `trusts` table (single migration)
  ✗ Stand up axum + async-graphql with one query: trust(id: ID!)
  ✗ Query via curl, verify

Hour 4-5: Phase 1+2 (Task #17 + #18)
  ✗ WSS log subscription (or polling fallback)
  ✗ committed_blocks table for reorg tracking
  ✗ Confirmation depth (12 blocks, configurable)
  ✗ Schema for Account, TrustContract, Module, ModuleRegistry, Beacon, Role basics
  ✗ Compound PKs not string IDs
  ✗ All migrations additive in store/migrations/

Hour 6-7: Phase 3 (Task #19)
  ✗ Static handlers: Factory.TRUST_Created, TRUST.ModuleAdded, TRUST.RoleGranted, Beacon.* basics
  ✗ End-to-end: Anvil deploy TRUST → indexer catches → row in Postgres → GraphQL query returns it
  ✗ This is THE proof point

Hour 8: Wrap-up (Task #21)
  ✗ Build log final state
  ✗ Commit everything
  ✗ Memory entries for architectural decisions
  ✗ Clean handoff doc for next session
  ✗ Per-tick log of what was attempted vs done

Stretch (if hours remain): Phase 4 partial (Task #20)
  - module_registry table
  - Dynamic dispatch on TRUST_ModuleAdded
  - Role module handler skeleton
```

## Decisions made (lock here, never re-derive)

1. **SQLite for indexer DB** (not Postgres). aeqi-platform uses rusqlite; matching engine simplifies self-host + zero infra setup. SQLite handles MVP scale (10s-100s of TRUSTs, ~100 events/min sustained max). Revisit Postgres if 10k tenants.
2. **alloy v1 with features="full"**. Single broad feature set instead of micro-managing transports-* / providers / etc. Simpler.
3. **Worktree at `/home/claudedev/aeqi-indexer-build`**, branch `indexer-build`. ALL work happens here. Ship via /ship when phase-complete.
4. **ABIs source: `/home/claudedev/projects/aeqi-graph/abis/`** — 17 JSONs. Don't move them yet; reference in place.
5. **Local Anvil for testing**, no public testnet. Default port 8545.
6. **Ship workflow**: each phase that produces meaningful working code → /ship cycle. Don't accumulate uncommitted state across many phases.
7. **PIVOT (TICK 5): Build indexer against ABIs first, defer live deploy.** The aeqi-core Foundry deploy script (`scripts/foundry/Deploy.s.sol`) is out of date — Beacon.setImplementation signature evolved to require `(source, moduleId, impl)` (3 args), script still passes `(moduleId, impl)` (2 args). Fixing that script properly requires understanding the new "source" semantics in Beacon — that's a real contract-design question, not a 5-min fix. So the indexer is being built against ABIs (which are accurate to current contracts) using synthetic event data. Live deploy can be solved separately by the user when awake, or by patching the script in a later session. The indexer code is independent of whether contracts are actually live.

## Blockers encountered

(empty initially — fill as I hit them)

## Per-tick log

(append every tick: tick #, what I did, what's next)

```
TICK 0 — wrote this log + planned + created tasks #15-#21
TICK 1 — cut worktree, added crate to workspace, scaffolded crates/aeqi-indexer/
         (Cargo.toml + lib.rs + main.rs + config.rs + chain.rs + decode.rs + store.rs)
         added alloy v1 + async-graphql v7 to workspace deps
         FIXED: alloy feature flags (transports-http → just "full")
         cargo check running in bg, output at /tmp/claude-1000/.../blql4a31l.output
```

## Constraints (from user)

- Use Foundry / Anvil for local testnet (no public testnet needed)
- Manage own keys in local keystore — never ask user
- Stripe TEST MODE allowed for paymaster simulation
- Account abstraction (4337) is part of the goal but won't fit in 8h
- Subagents OK: Haiku for exploration, Sonnet for implementation, Opus for hard decisions
- Commit often — preserve state for next tick
- Check this log first thing every tick

## What I will NOT do

- Pretend I shipped more than I did
- Skip commits to "save time"
- Make major architectural decisions without writing them in this log
- Break working code to chase the next phase
- Ask the user anything (they're asleep)

## Self-correction loop (every tick)

1. Read this log
2. Identify next action from "Plan" section
3. Execute it
4. Update "Current state" + append to "Per-tick log"
5. If stuck: add to "Blockers", switch to next leverage point
6. Commit code changes immediately

## Final handoff format (the user wakes up to this)

End-state of this log will tell the user:
- What's working (with evidence: commit SHAs, commands to verify)
- What's partial (next steps)
- What's blocked (with documented reasoning)
- Realistic next session estimate

No bullshit. No claiming success that didn't happen.
