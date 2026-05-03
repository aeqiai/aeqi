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
TICK: 12 (PHASE 2 ✓ FULL FACTORY COVERAGE — 3 EVENTS, 1 TX, ALL QUERYABLE)
PHASE: 2 ✓ TOPIC0 DISPATCH WORKING | one tx emits Created+Registered+SignerAdded;
       all 3 indexed + queryable via single GraphQL call. 15/15 tests green.
       | next: Phase 3 (multi-address dispatch — watched_addresses + per-TRUST sub)
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

PIVOT (locked TICK 5): Build indexer against ABIs first; live deploy is separate problem.
NEXT ACTION (Phase 3 — multi-address dispatch):
  Phase 2 (Factory completeness) is DONE.

  The architectural cliff: TRUST + module events come from CONTRACT ADDRESSES
  THAT DON'T EXIST until Factory emits TrustCreated. The poll loop currently
  hard-codes a single factory_address. To watch n+1 contracts dynamically,
  the design needs:

  1. Add migration 006_watched_addresses:
       CREATE TABLE watched_addresses (
         address TEXT PRIMARY KEY,
         kind TEXT NOT NULL,            -- 'factory' | 'trust' | 'module'
         registered_block INTEGER NOT NULL
       );
     Seed factory address on indexer boot.

  2. Refactor poll loop:
     - Each round: SELECT addresses FROM watched_addresses
     - Build a single Filter with .address(addresses) (alloy supports Vec<Address>)
     - All registered events flow through the same topic0 dispatch
     - Inside TrustCreated handler: also insert trust address into watched_addresses
       (so the next round picks it up for its events)

  3. Add sol! definitions for TRUST events:
     - TRUST_ModuleAdded(bytes32 indexed moduleId, address indexed implementation)
     - TRUST_RoleGranted(bytes32 indexed roleId, address indexed account)
     - TRUST_RoleRevoked(bytes32 indexed roleId, address indexed account)
     - TRUST_ProposalCreated(uint256 indexed proposalId, ...)

  4. Add migrations + handlers for the resulting entities:
     - 007_modules (module_id, trust_address, implementation, attached_block)
     - 008_role_assignments (role_id, trust_address, account, granted_block)
     - 009_proposals (proposal_id, trust_address, status, created_block)

  5. Live test: deploy MockTRUST that emits ModuleAdded + RoleGranted, set
     factory address, send TrustCreated → indexer should auto-subscribe to
     that TRUST address → next round catches its module/role events.

  STRETCH (Phase 4): Module-level events (Role.module, Governance.module).
  Module addresses come from TRUST_ModuleAdded — same dispatch chain extends:
  module added → insert into watched_addresses (kind='module') → next round
  catches Role_RoleCreated etc.

  Once Phase 3 is shipped, the indexer is structurally complete.
  Adding the remaining 130+ event types is then mechanical: sol! decl +
  migration + insert/update fn + dispatch arm. No new architecture.
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
