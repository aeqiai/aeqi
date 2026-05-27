# Runtime / Platform Separation

AEQI has two products that should share vocabulary without sharing ownership.

- `aeqi` is the source-available runtime: CLI, daemon, API, embedded dashboard,
  primitives, local/self-host execution, and company-scoped state.
- `aeqi-platform` is the hosted control plane: accounts, billing, hosted auth,
  provisioning, placement, domains, upgrades, observability, and fleet
  lifecycle.

The separation rule:

> The runtime owns execution. The platform owns operated infrastructure.

## Runtime Ownership

The runtime owns:

- companies as runtime identities
- agents, roles, events, quests, ideas, sessions, tools, and execution
- runtime-local credentials and integration state
- SQLite schema and migrations for runtime data
- the embedded dashboard for local/self-host operation
- stable HTTP, WebSocket, IPC, and MCP contracts

The runtime must not require:

- SaaS accounts
- billing plans
- waitlists
- hosted placement records
- platform user/session tables
- platform-owned OAuth or payment products

Per [primitive-contract.md](primitive-contract.md), TRUST is the product root.
Company remains a runtime/API-adjacent term for business-shaped entities; it is
not a hosted-only concept.

## Platform Ownership

The hosted platform owns:

- hosted human accounts, sessions, passkeys, and hosted OAuth
- memberships and account-derived access policy
- billing, plans, invoices, subscriptions, and usage products
- runtime placement, provisioning, restart, upgrade, and rollback
- public domains, routing, reverse proxying, and fleet health
- hosted admin and support tooling

The platform may mount runtime pages, proxy runtime APIs, and provision runtime
instances. It must not redefine the runtime primitives.

## Self-Host Reality

A self-hoster of this repository gets a runtime, not the hosted SaaS control
plane. That is a feature of the boundary:

- local/company runtime execution works without a hosted AEQI account
- optional runtime-local web accounts can be enabled with `[web.auth] mode =
"accounts"`; those users live in `accounts.db` and are not hosted AEQI SaaS
  accounts
- runtime data is owned by the runtime operator
- hosted billing, account lifecycle, public domains, and fleet placement belong
  to `aeqi-platform`
- docs must not imply this repository starts the full hosted platform

## Boundary Contract

Platform-to-runtime interaction should use explicit contracts:

- released runtime binaries and UI assets
- versioned blueprint/catalog artifacts
- HTTP/WebSocket/API routes
- IPC or MCP only where an API is intentionally local
- version and health endpoints
- migration and schema metadata exposed by the runtime

Platform-to-runtime interaction should not use:

- sibling source-tree paths
- direct runtime SQLite mutation
- assumptions about private runtime table layout
- build scripts that require a developer workstation path
- platform user IDs as runtime ontology

The platform can pass a caller identity or access context to the runtime, but
that context is an authorization adapter, not a new runtime primitive.

## UI Shape

Shared runtime pages should work in both local and hosted modes:

- companies
- company overview/settings
- agents
- roles
- events
- quests
- ideas
- sessions
- integrations that belong to a company runtime

Platform-only pages should stay outside the local runtime shell:

- account
- billing
- hosted security
- hosted domains
- deployments
- infrastructure
- admin

The clean shape is separate shells over shared company pages:

- `RuntimeLayout`: local/self-host operator shell
- `PlatformLayout`: hosted account and fleet shell
- shared company pages below either shell

## Artifact Boundary

Hosted deployments should consume runtime release artifacts instead of a local
checkout:

- `aeqi` binary
- embedded or external UI dist
- blueprint catalog
- OpenAPI or JSON schema definitions where applicable
- migration manifest
- checksum and version metadata

`aeqi-platform` should pin the runtime version it deploys and should verify the
runtime's reported version and health after placement.

## Database Boundary

Runtime databases are runtime-owned. Platform databases are platform-owned.

Allowed:

- platform stores placement rows that point to runtime instances
- platform stores account, billing, and membership state
- runtime stores company, agent, role, quest, event, idea, and session state
- runtime exposes APIs for state the platform needs to read or mutate

Forbidden:

- platform patching runtime SQLite rows behind the runtime's back
- runtime reading platform account/billing tables directly
- shared table names that imply shared ownership
- hidden migration dependencies across repositories

## Implementation Roadmap

1. Publish the runtime contract in docs and tests.
2. Add runtime version/health/schema endpoints that the platform can rely on.
3. Package blueprint/catalog data as an artifact consumed by both runtime and
   platform.
4. Replace platform local-path runtime builds with pinned release artifacts.
5. Replace any direct runtime DB mutation with runtime API calls.
6. Keep shared dashboard pages, but split runtime and platform shells.
7. Add CI checks that block local workstation paths, production incident notes,
   and internal deployment data from the public runtime repository.

The goal is not two disconnected products. The goal is a clean kernel and a
clean hosted operator plane.
