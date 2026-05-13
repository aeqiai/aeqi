# Solana Protocol Benchmark

This document distills what `aeqi-solana` should learn from respected
open-source Solana programs. The goal is not to copy their product surfaces. It
is to raise AEQI into a professional DAO framework: reliable protocol state,
strong authority checks, first-party clients, reproducible releases, and a
developer experience that makes the safe path the fast path.

## Benchmark Set

| Project | Why it matters | What AEQI should absorb |
| --- | --- | --- |
| [Squads v4](https://github.com/Squads-Protocol/v4) | Focused multisig execution program with SDKs, security policy, and audit posture. | Deterministic proposal/execution state, transaction/batch indexes, stale-state invalidation, verifiable release records, and independent recovery tooling. |
| [SPL Governance / Realms](https://docs.realms.today/developer-resources/spl-governance) | Canonical Solana DAO governance model for realms, proposals, treasuries, token voting, and voter plugins. | Treat governance config as a first-class account graph. Make voter weight plugins explicit, snapshot semantics deterministic, and managed-instruction execution auditable. |
| [Metaplex Token Metadata](https://github.com/metaplex-foundation/mpl-token-metadata) | De facto metadata standard with PDA conventions, first-party TS/Rust clients, BPF tests, TS tests, docs, and security reporting. | Publish exact PDA/client contracts, maintain generated clients, and test both program behavior and client ergonomics. |
| [Drift protocol-v2](https://github.com/drift-labs/protocol-v2) | Large production Solana protocol exposing programs, TypeScript SDK, examples, devcontainer, docs, and security surface in one repo. | Pin the contributor environment, make SDK/docs part of the repo contract, and provide integration examples for real app builders. |
| [Marinade liquid staking](https://github.com/marinade-finance/liquid-staking-program) | Long-lived mainnet protocol with public audit history and backend design documentation. | Keep protocol design and audit history close to code. Record external review dates, audited commits, and remediation state. |
| [Mango v4](https://github.com/blockworks-foundation/mango-v4) | Complex Solana program with TypeScript/Python clients and clear license/feature separation for CPI/client use. | Split program, CPI, and client features deliberately so other builders can depend on AEQI without pulling unnecessary code or license risk. |
| [marginfi v2](https://docs.marginfi.com/mfi-v2) | Open-sourced lending protocol with public instruction docs, audits, fuzz tests, and `solana-verify` deployment verification. | Document every instruction, publish fuzz/property tests, and make executable-hash verification a normal release step. |
| [Jito Restaking](https://github.com/jito-foundation/restaking) | Modern staking/restaking framework with TypeScript SDKs and formal audit artifacts. | Treat SDKs as core protocol surface, not a post-hoc convenience. Package reusable account builders and typed clients from day one. |
| [Pyth Crosschain](https://github.com/pyth-network/pyth-crosschain) | Multi-package protocol monorepo with explicit release automation, toolchain setup, and package templates. | Use reproducible tooling, package templates, generated docs, and release automation that scales across programs, SDKs, services, and CLIs. |

## AEQI Target Standard

### 1. Protocol State

AEQI should feel closer to Squads and SPL Governance than to a pile of module
handlers. Every critical workflow needs an explicit state machine:

- company/TRUST lifecycle: `Creating -> Finalized -> Paused -> Retired`
- proposal lifecycle: `Draft -> Active -> Succeeded -> Queued -> Executed`
- module lifecycle: `Registered -> Initialized -> Finalized -> Upgraded`
- funding lifecycle: `Pending -> Activated -> Settled -> Finalized`

Each state transition should have:

- one canonical authority rule
- one canonical PDA/account rule
- one event
- one regression test for invalid prior state
- one test for stale or mismatched accounts

### 2. Governance And Execution

AEQI governance must become deterministic enough for auditors and app builders.
The minimum bar:

- proposal stores vote-start slot and all supply/role snapshots needed for
  settlement
- execution uses stored state, not caller-provided settlement values
- managed instruction/action payloads have a stable digest
- queued execution has expiry, replay protection, and stale-config invalidation
- role voting cannot inflate through delegation, reassignment, or transfer
- token voting has a checkpoint or explicitly documented Token-2022 snapshot
  strategy before it is treated as production governance

### 3. Developer Surface

Every respected benchmark makes integration easier than raw Anchor calls. AEQI
needs a first-party client package before it should ask outside builders to use
the framework.

Target SDK shape:

```text
sdk/aeqi/
  src/index.ts
  src/programs.ts
  src/pda.ts
  src/accounts.ts
  src/errors.ts
  src/instructions/
  src/transactions/
  src/rpc/
  idl/
```

The SDK should expose:

- PDA helpers for every account seed
- typed instruction builders
- transaction builders for common workflows
- account fetch/decode helpers
- stable error mapping
- localnet fixtures for tests
- examples for create company, create proposal, vote, execute, mint, fund, and
  treasury flows

### 4. Testing And Verification

Current integration coverage is useful, but the benchmark set says the next
layer is property/fuzz and client-contract testing.

Required test ladder:

- Rust unit tests for pure domain rules
- Anchor integration tests for every instruction
- adversarial tests for account substitution, signer mismatch, stale state,
  replay, overflow, underflow, and paused/finalized gates
- SDK-backed tests that never call raw `.methods().accounts().rpc()`
- fuzz/property tests for accounting, voting, vesting, fund NAV, bonding curves,
  and liquidity-pool math
- generated IDL/client diff check in CI

### 5. Release And Audit Discipline

AEQI should adopt marginfi/Squads-style verifiability as a release gate:

- pinned Rust/Solana/Anchor/Node toolchain
- lockfiles committed
- `anchor build` artifacts uploaded from CI
- IDL hash and executable hash recorded
- `solana-verify` command and image recorded
- deployed program hash compared to local deterministic hash
- upgrade authority or immutability state recorded
- audit scope, audited commit, remediation commits, and accepted risks recorded

`docs/release-checklist.md`, `docs/deployments.md`, `docs/verifiable-build.md`,
and `audits/README.md` are the beginning of that system. They should become
release-blocking artifacts, not informational notes.

## Architecture Decisions For AEQI

### Keep Modular Programs, Add A Canonical SDK Boundary

The multi-program architecture is a valid differentiator: AEQI is not just a
multisig; it is a company runtime. The weak point is not modularity. The weak
point is that raw Anchor tests and direct PDA derivation are still the primary
client surface. Keep the module system, but force every module through the same
SDK conventions.

### Make TRUST The Policy Root

Every module mutator should either:

- prove it is safe without TRUST state, or
- load the canonical TRUST account and enforce finalized/paused/authority state.

If a global pause exists but high-risk module instructions do not read it, the
pause is aspirational. A DAO framework needs emergency controls that actually
compose across treasury, token, funding, governance, vesting, and market flows.

### Prefer Explicit Extension Points Over Hidden Flexibility

SPL Governance and Realms show the value of explicit voter plugins and realm
config. AEQI should use the same principle:

- voter weight plugins are typed strategy accounts
- module upgrades are recorded as typed upgrade records
- workflow templates are versioned artifacts
- integrations are declared capabilities, not implicit remaining accounts

### Treat Examples As Product

The benchmark repos make builders productive with SDK docs, examples, scripts,
and local environments. AEQI needs examples that prove the product promise:

- founder creates company from template
- agent proposes work
- role-holders vote
- treasury allocates budget
- funding round activates
- tokens vest
- proposal executes a real module action

Each example should be executable in localnet and backed by the SDK.

## Ranked Implementation Backlog

1. Create `sdk/aeqi` with PDA helpers, typed account fetchers, generated IDLs,
   and transaction builders for the core company/proposal/vote/execute flow.
2. Freeze governance settlement semantics: proposal status enum, stored
   snapshots, action digest, queued execution, and stale-config invalidation.
3. Enforce TRUST paused/finalized state in high-risk module mutators.
4. Add `security_txt` metadata to every shipped program.
5. Add SDK-backed integration tests and stop repeating PDA derivations in test
   files.
6. Add fuzz/property tests for governance weights, role delegation, vesting,
   funding, NAV/carry, bonding curves, and liquidity pools.
7. Pin toolchains with `rust-toolchain.toml`, Node version, Solana CLI version,
   Anchor version, and CI setup.
8. Add generated IDL/client diff checks to CI.
9. Publish a contributor devcontainer or Nix/mise setup for repeatable local
   development.
10. Convert release docs into a generated release manifest under
    `releases/<version>/manifest.json`.

## What Would Make AEQI Stand Out

The benchmark protocols are strong in single domains: multisig, governance,
metadata, lending, staking, oracle, perps. AEQI can win by making company
formation and operation feel like a coherent protocol:

- company templates compile into real module/account graphs
- roles, governance, treasury, funding, vesting, and tokens share one policy
  root
- SDK workflows are company-level, not program-level
- agents can safely act through typed proposals and budgets
- verifiable releases make the protocol credible to serious builders

The creative leap is a "company OS" SDK: developers should call
`createCompany`, `proposeAction`, `assignRole`, `openFundingRound`,
`allocateBudget`, and `executeApprovedAction`, while the SDK handles the
underlying module graph, PDAs, instructions, and verification metadata.
