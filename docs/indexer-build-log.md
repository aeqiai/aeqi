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
TICK: 17 (PHASE 5 ✓ HANDOFF.md — TOMORROW-USER CAN PICK THIS UP COLD)
PHASE: 5 ✓ DELIVERABLE COMPLETE | docs/HANDOFF.md covers boot, schema,
       architecture, test contracts, apps/ui wire-up, open work,
       per-event recipe. 23/23 tests green; 21 commits.
       | next: pick a module (Token most demo-relevant) OR wire apps/ui
               OR fix aeqi-core deploy script to test against real contracts
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

PIVOT (locked TICK 5): Build indexer against ABIs first; live deploy is separate problem.
NEXT ACTION (Phase 6 — extend or integrate):
  Phase 5 (HANDOFF.md) is DONE. The deliverable is complete.

  Three high-leverage next moves remain. Pick one per tick:

  PATH A — Token module (financial demo surface):
    Highest demo value next module. Token.module ABI has Token_TokenCreated
    + Token_Transfer. Token_Transfer is high-frequency — for v1 indexer
    just persist all of them; sampling can come later. Add cap_table query
    that aggregates current balances per holder.

  PATH B — apps/ui glue (real integration, biggest user-visible win):
    Add a feature flag `VITE_INDEXER_URL` to apps/ui. Pick ONE tab
    (Ownership is simplest — rolesForModule + roleAssignments) and
    rewrite its data layer to query our indexer instead of the subgraph.
    See HANDOFF.md "apps/ui integration sketch" for per-tab mapping.
    NB: this requires editing aeqi/apps/ui in a SEPARATE worktree.

  PATH C — fix aeqi-core deploy script drift (unblocks real-contract test):
    The 3-arg Beacon.setImplementation signature was the original blocker.
    Fix scripts/foundry/Deploy.s.sol so deploy works against current
    aeqi-core contracts. Then re-test the indexer against the real
    Factory + TRUST + module deployments instead of mocks. Mocks emit
    byte-identical signatures so this is a deploy-side fix, not an
    indexer-side fix — but it would close the original loop.

  LEVERAGE PRIORITY:
    Path A = breadth (more demo content)
    Path B = depth (real user-visible win)
    Path C = correctness (proves the indexer against real contracts)
    Pick based on what's most valuable to the user when they wake up.
    My read: PATH A first (more visible), PATH C second (validation),
    PATH B in tomorrow's session (needs more user input on UI design).
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
