# Solana Company Handover

This doc captures the current state and the next plan for the Solana company MVP.
It is the working handoff for the company/indexer/runtime question set.

## Current Read

The important product decision is now clear:

- `aeqi` should own the source-available company kernel, self-host runtime, protocol client, indexer, and the code/idea surfaces needed to operate a company locally.
- `aeqi-platform` should own hosted auth, billing, invite gating, provisioning policy, and any SaaS-specific wrapper around the same company kernel.

That means the company primitive itself should not be platform-only. It must be runnable by self-host users and reusable by the hosted product.

## What Exists Now

- The runtime repo already has an MCP server entrypoint: `aeqi mcp`.
- The MCP surface already exposes:
  - `ideas`
  - `quests`
  - `agents`
  - `events`
  - `code`
- The MCP server now prefers the local daemon socket when present, so local/self-host runs are usable even if hosted auth env vars exist.
- The runtime repo now includes a dedicated `aeqi-company` crate with deterministic company identity derivation and a binding type.
- The runtime CLI now exposes `aeqi company derive --entity-id <ENTITY>` for inspecting the canonical binding.
- The code graph crate exists and can index/search/inspect repository structure.
- The ideas store exists and already provides search, graph, and recall behavior.
- The Solana company/provisioning work currently lives in the platform-side code path and needs to be normalized into the source-available company kernel if Solana remains the canonical chain.

## What This Means For MVP

The MVP is not "support every chain path." The MVP is:

1. sign up or authenticate
2. provision or connect a wallet
3. create a company
4. confirm the company on-chain or through the indexer
5. land the user in the company workspace

Everything else is optional until this path is reliable.

## Ownership Boundary

### `aeqi`

Owns:

- company program and protocol types
- company client / shared protocol surface
- indexer
- search / code graph / ideas / runtime operator surfaces
- self-host docs and smoke tests

### `aeqi-platform`

Owns:

- hosted auth and sessions
- billing / paywall / invite gating
- hosted wallet provisioning or custody
- deployment and observability
- SaaS-only admin and fleet control

## Step-By-Step Plan

1. Freeze the boundary and stop moving company logic between repos.
2. Map the current Solana flow end to end from signup to company confirmation.
3. Lock the company contract:
   - company ID derivation
   - wallet model
   - confirmation source
   - fields persisted in runtime/platform state
4. Move or share the protocol surface into `aeqi` so self-host users can run it directly.
5. Keep the platform thin and policy-driven.
6. Keep MCP usable locally as the operator interface for search, ideas, and code graph.
7. Build exactly one smoke path and verify it before expanding scope.
8. Remove or quarantine any alternate onboarding or chain path that does not feed the canonical MVP.

## Open Decisions

- Should Solana remain the canonical chain for the MVP company kernel? Yes.
- Should the company indexer be a separate service or a CLI/server mode inside `aeqi`?
- Should hosted users get embedded wallet provisioning by default, or should wallet connect be the default and embedded custody be optional?
- Should hosted onboarding be invite-only first, or paid-first?

## Next Work

The next useful implementation task is to map the current Solana company path in code and mark the exact boundary where the shared company kernel should live. After that, we can cut the repo around one stable flow instead of continuing to branch the protocol.

## Expected Outcome

If we execute this plan successfully, AEQI ends up with:

- one source-available company kernel in `aeqi`
- the kernel starts with `aeqi-company`
- one hosted wrapper in `aeqi-platform`
- one company creation flow that works for both self-host and hosted users
- one read model for company state, backed by the indexer
- one local operator surface through MCP for ideas, search, and code graph

That gives us a company system that can be run by a user themselves or sold as a hosted product without splitting the protocol into separate products.
