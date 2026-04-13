# Runtime / Platform Separation

This document defines the clean split between:

- the open-source AEQI runtime
- the hosted AEQI platform

The core rule is simple:

- the runtime owns AEQI execution
- the platform owns accounts and operated infrastructure

The critical semantic rule is also simple:

- `Company` is a kernel primitive
- it should not be renamed away to `Workspace`

If AEQI is company-native intelligence infrastructure, the runtime should say that plainly.

## Correct Product Split

### AEQI Runtime

The open-source runtime is:

- a local or self-hosted dashboard for one or more companies
- the place where agents, events, quests, ideas, sessions, tools, and execution live
- the substrate where company-scoped intelligence runs

It may support:

- no auth
- simple local auth
- operator-managed auth

It should not require:

- SaaS accounts
- billing
- plans
- waitlists
- hosted placement state
- account-level API products

### AEQI Platform

The hosted platform is:

- the control plane above one or more AEQI runtimes
- the owner of accounts, memberships, billing, auth, provisioning, domains, placement, upgrades, and lifecycle
- the operator shell above the runtime

Its job is not to redefine AEQI.
Its job is to make AEQI runtimes manageable and commercial.

## Key UI Principle

Do not make one shell pretend to be both products.

The separation is not:

- runtime uses `Workspace`
- platform uses `Company`

The separation is:

- both runtime and platform operate on companies
- only the platform owns account/control-plane surfaces

That means:

- a company switcher is legitimate in the runtime shell
- `X-Company` scoping is legitimate in both runtime and platform
- `CompanyPage` is a real runtime page, not a SaaS-only page
- `AccountPage` is a platform page

## Current Status

The first separation cut is in place.

Shipped:

- backend bootstrap explicitly reports `app_mode: runtime` from the open-source runtime [auth.rs](/home/claudedev/aeqi/crates/aeqi-web/src/routes/auth.rs:128)
- backend bootstrap explicitly reports `app_mode: platform` from the hosted control plane [server.rs](/home/claudedev/aeqi-platform/src/server.rs:408)
- the shared UI now renders a mode-aware route tree so platform-only pages stay out of the runtime shell [App.tsx](/home/claudedev/aeqi/apps/ui/src/App.tsx:62)
- company routes now stay available in both runtime and platform mode, and legacy `/workspace` redirects to `/company` [App.tsx](/home/claudedev/aeqi/apps/ui/src/App.tsx:72)
- the left navigation now treats company selection/settings as runtime-native instead of replacing them with `Workspace` terminology [AppLayout.tsx](/home/claudedev/aeqi/apps/ui/src/components/AppLayout.tsx:71)
- generic API requests, websocket connections, and chat streaming now carry the selected company in both modes [api.ts](/home/claudedev/aeqi/apps/ui/src/lib/api.ts:46) [useDaemonSocket.ts](/home/claudedev/aeqi/apps/ui/src/hooks/useDaemonSocket.ts:26) [useWebSocket.ts](/home/claudedev/aeqi/apps/ui/src/hooks/useWebSocket.ts:84) [AgentSessionView.tsx](/home/claudedev/aeqi/apps/ui/src/components/AgentSessionView.tsx:1003)
- the shared company page now drops hosted account API key assumptions when running in self-hosted/runtime mode [CompanyPage.tsx](/home/claudedev/aeqi/apps/ui/src/pages/CompanyPage.tsx:69)

Still deferred:

- removing account/control-plane assumptions from more shared pages
- eliminating direct platform mutation of runtime DB internals
- isolating account-derived access policy behind adapters instead of letting it leak into core runtime semantics
- adding an explicit local operator layer for advanced multi-runtime self-hosting

## Open-Source Dashboard

The open-source runtime should ship with a dashboard, and that dashboard should be company-native.

Its navigation should be company-scoped:

- Home
- Companies
- Company
- Agents
- Events
- Quests
- Ideas
- Sessions

If local auth exists, a minimal local profile page is acceptable.
That is still different from a SaaS account page.

`Company` in the runtime means:

- company identity
- company configuration
- company-scoped API/runtime credentials
- company execution defaults

It does not mean:

- billing
- plan management
- hosted ownership model

## Hosted Dashboard

The hosted platform should have its own shell above the company runtime views.

Its navigation should include control-plane concerns:

- Account
- Billing
- Security
- Domains
- Deployments
- Infrastructure

Inside a selected company/runtime, the platform can mount shared AEQI pages:

- Company
- Agents
- Events
- Quests
- Ideas
- Sessions

That gives you two levels:

- platform shell: which account/runtime/company am I operating?
- runtime shell: what is happening inside this company?

## Mental Model

Use this hierarchy:

1. Platform Account
2. Company
3. AEQI primitives inside that company

For self-hosted runtime mode:

1. Local runtime
2. Company
3. AEQI primitives inside that company

No account layer is required there.

## Self-Hosted Multi-Company

Yes, self-hosted users should be able to have multiple companies in one runtime.

That is not a violation of the model.
That is the model.

The hosted service is still justified because most users do not want to operate:

- auth and memberships
- billing and plans
- provisioning
- placement
- domains
- upgrades and rollback
- monitoring and recovery

The hosted value is operator leverage, not semantic ownership of `Company`.

## What Must Move Out Of The Runtime

The runtime should keep `Company`.
What should move out are platform-business concerns.

### 1. Accounts and Memberships

The runtime should not own the platform account model.

Target state:

- runtime owns companies and AEQI execution
- platform owns accounts, memberships, and identity relationships

### 2. Billing, Waitlists, OAuth, and Account API Products

These are SaaS concerns.

Target state:

- runtime does not need billing, subscriptions, waitlists, or hosted account API key semantics
- platform owns those surfaces entirely

### 3. Placement and Direct Runtime DB Mutation

The host runtime manager currently edits runtime SQLite state directly [host.rs](/home/claudedev/aeqi-platform/src/host.rs:304).

That weakens the substrate.

Target state:

- platform interacts with runtimes through explicit APIs / IPC contracts
- platform does not patch runtime DB internals behind the runtime's back

### 4. Account-Derived Access Policy in Core Semantics

Company scoping is part of the runtime model.
Account-derived access policy is not.

Target state:

- runtime keeps company identity and company CRUD
- hosted adapters/proxies can still enforce which companies an account may access
- access policy does not redefine the ontology

## UI Architecture

You want shared company pages and separate shells.

### Shared Pages

These should work in both products:

- company
- companies
- agents
- events
- quests
- ideas
- sessions

### Runtime Shell

This shell is for the open-source product.

It should own:

- company navigation
- runtime-local settings
- local auth/profile if needed

### Platform Shell

This shell is for the hosted SaaS.

It should own:

- account navigation
- billing/security/admin surfaces
- runtime placement/lifecycle views

The platform shell can mount shared company pages underneath it.

## Recommended Implementation Strategy

### Phase 1: Separate by Mode, Not by Repo

Do this first.

- keep the shared React codebase
- expose explicit app modes: `runtime`, `platform`, later `operator`
- return mode and capabilities from backend bootstrap
- render different shells based on mode

This is the lowest-risk path.

### Phase 2: Split Shells While Keeping Company Pages Shared

Replace the single-shell route model with:

- `RuntimeLayout`
- `PlatformLayout`

Move:

- `AccountPage` to platform-only
- company navigation into both products where relevant
- platform control-plane pages out of the runtime shell

### Phase 3: Introduce a Company Adapter Boundary

Create one client-side interface for the selected company:

- current company id
- display name
- runtime endpoint
- auth capabilities

In runtime mode:

- adapter resolves to a locally selected company

In platform mode:

- adapter resolves through the selected hosted company/runtime context

This lets shared pages stop caring whether they are local or hosted.

### Phase 4: Remove Platform Assumptions From Shared APIs and Pages

Do not deprecate `Company`.
Deprecate platform leakage.

Do this in order:

1. keep `company` as the public runtime term
2. remove hosted account assumptions from shared pages
3. move account/billing/provisioning semantics fully into platform contracts
4. keep runtime provisioning APIs company-generic: initialize company, seed ideas, spawn agents

### Phase 5: Add an Operator Layer for Advanced Self-Hosting

Long term:

- the runtime stays company-native
- the platform stays the commercial operator plane
- an optional local operator layer can manage many runtimes for advanced self-hosters

## Concrete Changes Needed

### In `apps/ui`

1. Keep company routes and company scoping in runtime mode.
2. Keep account pages platform-only.
3. Continue splitting runtime/company pages from platform/account pages.
4. Remove remaining `Workspace` terminology from the product shell.
5. Make shared pages explicitly branch only when account semantics are truly required.

### In `aeqi-orchestrator`

1. Keep `company` as the kernel identity.
2. Avoid introducing account/billing/hosted business concepts into runtime contracts.
3. Keep provisioning APIs company-centric and generic.
4. Move hosted access-policy helpers behind adapters instead of letting them redefine runtime semantics.

### In `aeqi-platform`

1. Treat the runtime as an external substrate, not a DB you patch directly.
2. Keep all account, billing, invite, OAuth, API product, secret management, and placement logic here.
3. Own route-to-runtime and company selection concerns here when operating hosted deployments.
4. Expose platform bootstrap metadata so the UI can choose the correct shell.

## Product Outcome

If you do this correctly:

- the open-source AEQI runtime stays faithful to the company-native ontology
- the hosted platform has a justified reason to exist
- self-hosting stays real instead of crippled
- the kernel becomes more foundational because it stops absorbing SaaS semantics

That is the right differentiation:

- open-source AEQI: company-native agent runtime
- hosted AEQI Platform: operator and commercial control plane
