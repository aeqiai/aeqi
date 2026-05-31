# EVM To Solana Essence Map

This document is the semantic map from the historical EVM design to the
canonical Solana implementation. It preserves the essence of the EVM system
where that essence still matters, but it does not preserve EVM mechanics for
their own sake.

`docs/solana-protocol-benchmark.md` defines the external quality bar. This
document defines the internal translation contract: what the old EVM
architecture meant, where that meaning now lives on Solana, and which EVM-shaped
assumptions must be removed.

The EVM contracts are the semantic source:

- `~/projects/aeqi-core/contracts/core/COMPANY.sol`
- `~/projects/aeqi-core/contracts/core/Factory.sol`
- `~/projects/aeqi-core/contracts/core/Module.sol`
- `~/projects/aeqi-core/contracts/modules/*.module.sol`
- `~/projects/aeqi-core/contracts/managers/*.module.sol`

## Purpose

Use this document when making Solana protocol, SDK, template, release, or audit
decisions. It answers one question:

```text
What did the EVM mechanism mean as company-OS behavior, and what is the
Solana-native way to preserve that behavior?
```

The answer is almost never "copy the EVM shape." Preserve semantics, not
implementation tricks.

## Non-Goals

- Do not recreate proxies, beacons, delegatecall, storage slots, calldata
  dispatch, ERC-4337 mechanics, or EVM deployment flows just because the first
  version used them.
- Do not turn AEQI into a generic multisig, DAO voting UI, treasury wrapper, or
  token-launch template.
- Do not keep historical module names if a Solana-native account, PDA, signer,
  or program-ID model expresses the same invariant more clearly.

When an EVM mechanism conflicts with a clearer Solana-native account, PDA,
signer, or program-ID model, the Solana-native model wins.

## Thesis

AEQI is not a generic DAO, multisig, token-voting app, or treasury wrapper. It
is an institution compiler.

The core idea is:

```text
template + signers + module graph + ACL graph + configs
  -> COMPANY
  -> roles, governance, treasury, capital formation, vesting, execution
  -> a company that can operate through humans and agents
```

Solana best practices are the floor. The EVM AEQI thesis is the ceiling.

## Translation Principle

The EVM system was valuable because it modeled a company as a compiled,
auditable institution:

- factory-born company runtime
- one COMPANY policy root
- declared signers and metadata
- versioned template and module graph
- explicit ACL edges
- role hierarchy with labor and authority
- budgets, vesting, funding, funds, and token ownership in one lifecycle
- governance that executes company actions through policy
- agents constrained by roles, budgets, and approved actions

Solana should preserve those semantics with Solana-native accounts, PDAs,
constraints, CPI boundaries, signer rules, typed events, and first-party SDK
builders.

## Essence Matrix

| EVM primitive                        | Original insight                                                                                                                                                                       | Solana state today                                                                                                                                                                                                                                                                          | Verdict                                                  | Target                                                                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPANY` policy root                  | A company is a policy root, module registry, config store, asset holder, and execution gateway. Module access flows through `hasCOMPANYAccess`; actions execute through `COMPANY.execute`. | `aeqi_company` stores module registry/config/paused state, but several module mutators still treat COMPANY as unchecked namespace or do not enforce paused/finalized state.                                                                                                                     | Preserved conceptually, diluted operationally.           | COMPANY remains the policy root. Modules may move into separate Solana programs and accounts, but high-risk mutations must either load canonical COMPANY state or document why they are safe without it. |
| Factory as institution compiler      | `Factory` registers a COMPANY request with declared signers, waits for approvals, applies user/template configs, deploys modules, wires ACLs, finalizes, and marks the institution live. | `aeqi_factory.instantiate_template` validates provider-published module implementations, registers module slots, replays template ACL edges, and finalizes the COMPANY. Docs/SDK still need to make this the default company-level flow.                                                      | Meaningfully preserved in protocol, underexposed in SDK. | Make `createCompany` the canonical SDK flow: signers, metadata, template, configs, module graph, ACL graph, lifecycle events, and post-create verification.                                          |
| Creation-mode bootstrap              | EVM modules can bypass normal ACL while the factory is building the institution, then the COMPANY finalization gate closes that bootstrap mode.                                          | Solana has init/finalize language and finalized state, but the bootstrap boundary is not consistently enforced across modules.                                                                                                                                                              | Important semantic risk.                                 | Define creation mode as a state machine: only factory/template authorities can mutate during bootstrap; after finalize, normal COMPANY/role/governance policy must own mutation.                       |
| Module ACL graph                     | Modules have both COMPANY-level ACL flags and module-to-module ACL edges. Authority is not just user -> program; it is module -> module capability routing.                              | Solana templates now persist ACL edge specs and `instantiate_template` replays them into COMPANY `ModuleAclEdge` PDAs during bootstrap. SDK graph rendering and denial tests are still missing.                                                                                               | Preserved in protocol, missing as a product primitive.   | Publish an ACL graph model: which module may call/mutate which module, with SDK helpers and tests for allowed/denied edges.                                                                          |
| Two-phase module lifecycle           | Factory deploys/registers all modules first, then finalizes after ACLs/configs exist, so modules can resolve each other safely.                                                        | README documents two-phase init/finalize; several module `finalize` functions are still skeletal or light.                                                                                                                                                                                  | Preserved as architecture, incomplete as implementation. | Each module needs meaningful `finalize`: decode config, validate dependencies, write canonical module state, and reject malformed templates.                                                         |
| Versioned storage and upgrade intent | EVM uses SlotArrays plus beacon/source delegation to isolate storage, bind module IDs to implementations, and keep module data evolvable.                                              | Solana maps this to PDA namespaces, account versions, IDLs, program IDs, indexed accounts, provider-published implementation records, and per-COMPANY adopted module versions. Factory templates now require active implementation records before a COMPANY can be compiled from a module spec. | Active implementation work.                              | Keep Solana program upgrade authority separate from AEQI module selection. Providers publish executable implementation records; each COMPANY pulls the version it wants for each module slot.          |
| Typed config bus                     | EVM factory/COMPANY move typed config values and indexed IDs through the module graph before finalization.                                                                               | Solana configs exist in program accounts and docs, but the template config schema is not yet treated as a typed product boundary.                                                                                                                                                           | Partly preserved.                                        | Template configs need schemas, validation, compatibility notes, and SDK encoders. Unknown or malformed config must fail before finalize.                                                             |
| Role DAG as operating hierarchy      | Roles encode company structure: parent chain, hierarchy, statuses, assignments, delegation, checkpoints, and metadata. This is not just auth.                                          | Solana role supports role types, parent walk, assignment, transfer, resignation, delegation checkpoints. Assignment invitation/application lifecycle is missing.                                                                                                                            | Strongly preserved, missing human workflow states.       | Add role assignment lifecycle: invited, applied, accepted, rejected, revoked. Keep role actions tied to status, metadata, budgets, and vesting.                                                      |
| Roles create budgets and vesting     | EVM `RoleRequest` can include budget and vesting requests. A role can instantiate operating budget and compensation logic together.                                                    | Solana has separate role, budget, and vesting modules, but the company-level workflow is not yet a single typed operation.                                                                                                                                                                  | Concept preserved by modules, missing composition.       | SDK transaction builders should create role + optional budget + optional vesting as one company-level workflow.                                                                                      |
| Budget graph over treasury           | EVM budgets are scoped allocations nested by source budget and role, so spending is an institutional graph over treasury assets.                                                       | Solana has budget and treasury modules, but budget spend is not yet clearly tied to vault movement, parent-budget depletion, or COMPANY pause.                                                                                                                                                | Preserved as modules, missing policy composition.        | Budget spend/freeze/unfreeze must load COMPANY, enforce parent budget constraints, and connect accounting to treasury movement or approved execution.                                                  |
| Governance as company action router  | EVM governance hashes proposals over target calls and executes through `COMPANY.execute`, so successful proposals operate the company.                                                   | Solana governance has proposal/vote/execute state, but execution remains less explicit than the EVM action-router model.                                                                                                                                                                    | Partly preserved, needs tightening.                      | Proposal should store action digest and execute typed module actions through COMPANY policy. Settlement must use stored snapshots, not caller-supplied inputs.                                         |
| Role-bound vesting/economic rights   | EVM vesting consumes budgets, activates with roles, and ties contribution, time, FDV, and non-transferable vesting rights to the institution.                                          | Solana vesting has cliff/duration, contribution, FDV milestone, and claims, but factory/template role allocation is not end-to-end yet.                                                                                                                                                     | Preserved as primitives, missing workflow.               | Template-driven founder/worker vesting should be created with roles and budgets, with activation/removal states and authority tests.                                                                 |
| Account abstraction and passkeys     | EVM COMPANY is an ERC-4337 account with passkey/EOA/multisig signer surfaces. Identity is part of the company primitive.                                                                 | Solana README names native fee payer/session keys/secp256r1 passkey precompile as rationale, but implementation/docs do not yet define the signer/session-key model.                                                                                                                        | Insight identified, not implemented.                     | Define Solana identity model: passkey signer, session key, agent authority, recovery path, and how each maps to COMPANY/role/governance permissions.                                                   |
| Native capital formation             | Unifutures, Funding, Fund, Token, Vesting, and Budget make capital formation part of the company OS, not an integration afterthought.                                                  | Solana has these programs and tests, but docs still explain them as modules more than as a coherent capital lifecycle.                                                                                                                                                                      | Preserved in scope, underexpressed as product.           | Define capital lifecycle workflows: open round, commit/buy, vest, budget, fund NAV/carry, exit, governance action. SDK examples should prove them end to end.                                        |
| Managers/position orchestration      | EVM managers coordinate external positions and protocol primitives while assets remain controlled by COMPANY.                                                                            | Solana has direct Unifutures/Fund/Funding modules but no clear manager/position orchestration layer yet.                                                                                                                                                                                    | Missing or deferred.                                     | Decide whether Solana needs manager programs or SDK-managed orchestration. Preserve the rule: assets and permissions stay anchored to COMPANY.                                                         |
| Metadata as institutional memory     | EVM carries IPFS CIDs through COMPANY registration, templates, approvals, roles, and proposals.                                                                                          | Solana uses fixed CID fields in places, but metadata is not yet treated as a universal institutional memory layer.                                                                                                                                                                          | Partly preserved.                                        | Standardize metadata fields and SDK encoding for company, template, role assignment, proposal, funding, and audit records.                                                                           |

## System Map

The Solana implementation should read as this product system:

```text
Template
  -> Factory
  -> COMPANY
  -> Module registry + ACL graph + typed configs
  -> Role DAG + governance + token/cap table
  -> Treasury + budget + vesting + funding + fund/unifutures
  -> Typed proposals and approved actions
  -> Scoped human and agent execution
```

The SDK should expose this as company-level workflows. The programs should make
the workflows enforceable. The indexer should make the lifecycle inspectable.

## What Must Stay Different From Existing Solana DAOs

AEQI can use Squads-level release discipline and Realms-level governance
professionalism without becoming either.

The differentiators are:

- **Company-level compilation.** Builders should not assemble raw programs.
  They should compile a company from a template.
- **One policy root.** Roles, treasury, funding, vesting, and execution share a
  COMPANY root.
- **Module graph, not app pages.** Every module declares capabilities and ACL
  edges; the graph is inspectable and testable.
- **Capital and labor in one system.** Budgets, vesting, token allocation,
  funding rounds, exits, and governance are not separate products.
- **Agent-safe execution.** Agents act through typed roles, budgets, and
  governance-approved actions, not broad API keys.
- **Institutional memory.** Metadata and audit/release records are first-class
  protocol objects, not off-chain notes only.

## Solana Translation Rules

### 1. COMPANY Is Mandatory For High-Risk Mutation

Any instruction that changes assets, permissions, roles, governance, funding,
vesting, budgets, fund accounting, or executable actions should load the typed
COMPANY account unless it has a narrow reason not to.

It must enforce:

- correct COMPANY PDA
- correct owning program or cross-program seed relation
- not paused
- finalized/live state where creation mode should be closed
- caller/module/role authority

If a module does not load COMPANY for a mutator, the code or docs must state the
reason. "The caller passed a company id" is not enough.

### 2. SDK Names Must Be Company-Level

Expose program-level helpers for experts, but make the default SDK company
language:

```text
createCompany
approveCompanyCreation
instantiateTemplate
assignRole
inviteRoleHolder
openFundingRound
allocateBudget
createProposal
voteOnProposal
executeApprovedAction
```

The SDK should hide raw PDA choreography for normal builders.

### 3. Templates Are Versioned Products

Templates should not be anonymous blobs. Each template needs:

- template id
- version
- module list
- module ACL graph
- config schema
- required signers
- metadata hash
- compatibility notes
- migration path

### 4. Proposal Actions Need Typed Digests

Governance proposals should store a digest over:

- target module/program
- action kind
- accounts
- instruction data
- config version
- expiry/queue window

Execution should verify that digest before dispatch.

### 5. Role Assignment Is A Workflow

The EVM role module models both top-down invitation and bottom-up application.
Solana should preserve this because it is company behavior, not just security.

Target states:

```text
None -> Invited -> Accepted -> Occupied
None -> Applied -> Accepted -> Occupied
Invited -> Rejected
Applied -> Rejected
Invited/Applied -> Revoked
Occupied -> Resigned/Removed
```

### 6. Capital Lifecycle Must Be End-To-End

AEQI's capital stack should be documented and tested as one flow:

```text
template -> company -> role/cap table -> funding request -> Unifutures primitive
  -> token allocation -> vesting -> treasury/fund accounting -> governance action
```

This is the part most DAO frameworks do not have.

## Concepts To Drop

- EVM deployment mechanics as architecture.
- Proxy/beacon language where a Solana program ID, release manifest, IDL, and
  account version model is clearer.
- Storage-slot vocabulary in public Solana docs.
- Generic token DAO language that hides the company runtime.
- "Module exists" as a success condition. The success condition is an enforced
  company workflow.

## Concepts To Keep

- COMPANY as the company policy root.
- Factory as the institution compiler.
- Template-driven module graph and config graph.
- Creation-mode bootstrap followed by explicit finalization.
- Dual ACL semantics: company-level capability flags plus module-to-module
  authority edges.
- Role DAG as operating hierarchy, not just access control.
- Role requests that can bind labor, budget, and vesting.
- Governance proposals as typed company actions.
- Capital formation as native company lifecycle.
- Metadata as institutional memory.

## Auditor Questions

An auditor should be able to answer:

- Which account is the policy root for this company?
- Is this instruction allowed before finalize, after finalize, or both?
- Does this mutator enforce pause/finalized state?
- Which role, module, signer, or governance decision authorizes this mutation?
- Can a module mutate another module without an explicit ACL edge?
- Can a proposal execute a different action than the one voted on?
- Are vote totals, role totals, and config versions snapshotted or caller
  supplied?
- Can budget accounting diverge from treasury movement?
- Can vesting claims happen without the role/economic state intended by the
  template?
- Does the indexer project all emitted company lifecycle events needed to audit
  the institution?

## Relationship To Other Docs

- `docs/solana-protocol-benchmark.md` defines the external engineering floor.
- This document defines the AEQI semantic translation contract.
- `docs/solana-working-identity.md` defines day-to-day protocol engineering
  posture.
- `docs/aeqi-template.md` should instantiate these rules for the canonical
  company template.
- `docs/release-checklist.md` should verify that shipped commits still satisfy
  this translation contract.
- `audits/README.md` should point auditors here before reviewing programs.

## Implementation Backlog

1. **Write SDK package skeleton.** Start with PDA helpers and company-level
   transaction builders for `createCompany`, `assignRole`, `createProposal`,
   `vote`, and `executeApprovedAction`.
2. **Make COMPANY live/paused state universal.** Add typed COMPANY enforcement to
   high-risk module mutators.
3. **Define module ACL graph docs and tests.** Every template should have a
   rendered module ACL graph and denial tests for invalid edges.
4. **Finish module finalizers.** Remove skeletal finalizers; decode and validate
   module configs.
5. **Add role assignment lifecycle.** Preserve invited/applied/accepted/rejected
   workflows from EVM.
6. **Harden governance action execution.** Store action digests, status enum,
   snapshots, queue windows, and dispatch through COMPANY policy.
7. **Define signer/session-key model.** Specify passkey, session key, agent key,
   recovery, and revocation semantics.
8. **Add capital lifecycle examples.** SDK-backed localnet examples for funding,
   vesting, budget, fund, and governance execution.
9. **Standardize metadata.** Consistent metadata hash fields and schemas for
   templates, companies, role assignments, proposals, funding rounds, and
   releases.
10. **Generate release manifest.** Combine deployment IDs, hashes, IDLs, audit
    state, template versions, and SDK version into one release artifact.

## Definition Of Done

AEQI has preserved its essence on Solana when a builder can:

1. choose a template,
2. declare signers and metadata,
3. create a company,
4. inspect its module ACL graph,
5. assign roles with budgets and vesting,
6. open a funding workflow,
7. propose and vote on a company action,
8. execute it through COMPANY policy,
9. verify the deployed programs and SDK version,
10. hand the system to agents with scoped roles and session keys.

That is the product. The programs are the machinery underneath it.
