# React Query And Zustand Migration Plan

## Goal

Move the AEQI UI toward a professional server-state architecture:

```txt
Backend/database = source of truth
React Query = cached backend state
Zustand = local UI/client workflow state
Components = consumers of typed hooks
```

Do not remove Zustand. Shrink it to local state only.

## Current Problem

AEQI currently stores backend data in Zustand, especially:

```txt
apps/ui/src/store/daemon.ts
apps/ui/src/store/agentData.ts
apps/ui/src/store/inbox.ts
```

This makes the UI manually handle caching, loading state, errors, mutation reconciliation, stale data, and refetch timing. React Query is already installed and provided in `apps/ui/src/main.tsx`, but server data is not yet using it consistently.

## Target Ownership

React Query owns backend-refetchable data:

```txt
agents
entities
quests
ideas
events
channels
inbox
billing
integrations
credentials
session lists
historical session messages
dashboard/status/cost
```

Zustand owns browser-only workflow state:

```txt
active entity
selected tab/view
sidebar state
modal state
composer drafts
pending outgoing messages
streaming websocket buffers
auth token/mode for now
local optimistic overlays only when needed
```

Use this rule:

```txt
If the backend can refetch it, it belongs in React Query.
If it only exists in browser/UI workflow, it belongs in Zustand.
```

## Phase 0: Guardrails

Keep all network calls going through:

```txt
apps/ui/src/api/client.ts
```

Enforce no direct fetches:

```bash
rg "fetch\\(" apps/ui/src
```

Expected allowed result:

```txt
apps/ui/src/api/client.ts
```

Do not introduce new broad API responses like:

```ts
request<Record<string, unknown>>
```

Prefer explicit response DTOs.

## Phase 1: Zero-Warning Lint Baseline

Fix existing React hook warnings in:

```txt
apps/ui/src/components/events/EventDetail.tsx
apps/ui/src/pages/BlueprintDetailPage.tsx
apps/ui/src/pages/LoginPage.tsx
```

Acceptance:

```bash
npm --prefix apps/ui run lint
```

Then move toward:

```bash
eslint src/ --max-warnings=0
```

## Phase 2: Query Folder And Key Conventions

Create:

```txt
apps/ui/src/queries/
```

Initial files:

```txt
apps/ui/src/queries/keys.ts
apps/ui/src/queries/ideas.ts
apps/ui/src/queries/events.ts
apps/ui/src/queries/channels.ts
```

Query keys must be centralized and stable:

```ts
export const ideaKeys = {
  all: ["ideas"] as const,
  byAgent: (agentId: string) => ["ideas", "agent", agentId] as const,
  graph: (agentId?: string) => ["ideas", "graph", agentId ?? "global"] as const,
};
```

Do not define query keys inside components.

## Phase 3: Domain API Clients

Create domain clients:

```txt
apps/ui/src/api/ideas.ts
apps/ui/src/api/events.ts
apps/ui/src/api/channels.ts
```

They should use:

```ts
import { apiRequest } from "@/api/client";
```

Keep `apps/ui/src/lib/api.ts` as a temporary compatibility layer while migrating call sites.

## Phase 4: Migrate `agentData.ts` First

Current store:

```txt
apps/ui/src/store/agentData.ts
```

Move these server-state responsibilities to React Query:

```txt
eventsByAgent
channelsByAgent
ideasByAgent
loadEvents
loadChannels
loadIdeas
patchEvent
removeEvent
patchChannel
removeChannel
patchIdea
removeIdea
addIdea
```

Create hooks:

```txt
useAgentEvents(agentId)
useAgentChannels(agentId)
useAgentIdeas(agentId)
useUpdateEventMutation(agentId)
useDeleteEventMutation(agentId)
useUpdateChannelMutation(agentId)
useDeleteChannelMutation(agentId)
useUpdateIdeaMutation(agentId)
useDeleteIdeaMutation(agentId)
useCreateIdeaMutation(agentId)
```

Acceptance:

```txt
AgentEventsTab no longer uses useAgentDataStore for server data.
AgentChannelsTab no longer uses useAgentDataStore for server data.
Idea surfaces no longer use useAgentDataStore for server data.
agentData.ts is deleted or reduced to local-only state.
```

## Phase 5: Mutation Policy

Use this consistently:

```txt
Simple mutation with obvious result:
  optimistic cache update + invalidate

Complex backend side effect:
  invalidate/refetch
```

Recommended invalidations:

```txt
create/update/delete idea:
  ["ideas", "agent", agentId]
  ["ideas", "graph", agentId]

create/update/delete event:
  ["events", "agent", agentId]
  activity stream if reflected there

create/update/delete channel:
  ["channels", "agent", agentId]
```

Do not patch Zustand arrays after API writes.

## Phase 6: Migrate `daemon.ts`

Move server fields out of:

```txt
apps/ui/src/store/daemon.ts
```

Map them to query hooks:

```txt
status      -> useStatus()
dashboard   -> useDashboard()
cost        -> useCost()
entities    -> useEntities()
agents      -> useAgents()
quests      -> useQuests()
events      -> useActivityStream()
```

Keep Zustand only for:

```txt
wsConnected
workerEvents
runtime overlay state
```

## Phase 7: Inbox

React Query owns fetched inbox items:

```txt
useInbox()
useAnswerInboxMutation()
```

Zustand may keep only local dismissed IDs if needed.

After answering:

```txt
invalidate ["inbox"]
invalidate session messages for the answered session
```

## Phase 8: Sessions And Chat

Do not force websocket streaming into React Query.

React Query owns:

```txt
session list
session children
historical messages
loaded previous pages
```

Zustand owns:

```txt
active stream buffer
pending outgoing messages
composer drafts
selected session
temporary websocket chunks
```

When a stream completes, invalidate or update the durable message query.

## Phase 9: Types And DTOs

Short term: replace broad responses and casts:

```txt
Record<string, unknown>
as unknown as Quest[]
```

with explicit DTOs.

High-priority DTOs:

```txt
Agent
Quest
Idea
AgentEvent
ChannelEntry
InboxItem
SessionMessage
BillingOverview
IntegrationCatalogEntry
CredentialView
```

Medium-term target:

```txt
Rust route DTOs -> generated schema/types -> typed API clients -> typed React Query hooks
```

Possible Rust options:

```txt
utoipa/OpenAPI
schemars + codegen
ts-rs-style generated types
```

## Phase 10: Final Enforcement

Add CI checks or scripts:

```bash
rg "fetch\\(" apps/ui/src
rg "request<Record<string, unknown>>" apps/ui/src
rg "as unknown as" apps/ui/src
```

Expected:

```txt
fetch( only in api/client.ts, plus documented exceptions
request<Record<string, unknown>> near zero or zero
as unknown as absent from server-data flows
```

Run:

```bash
npm --prefix apps/ui run check
npm --prefix apps/ui run lint -- --max-warnings=0
npm --prefix apps/ui run test
```

## Recommended First PR

Do this first:

```txt
Fix current lint warnings.
Create api/ideas.ts, api/events.ts, api/channels.ts.
Create queries/ideas.ts, queries/events.ts, queries/channels.ts.
Migrate AgentEventsTab, AgentChannelsTab, and idea consumers off agentData.ts.
Delete or shrink agentData.ts.
```

Acceptance:

```txt
npm --prefix apps/ui run check passes.
npm --prefix apps/ui run lint has 0 warnings.
npm --prefix apps/ui run test passes.
rg "fetch\\(" apps/ui/src only returns api/client.ts.
agentData.ts no longer owns events/channels/ideas server state.
```
