# Runtime Extension Plane

This document defines the AEQI-native extension plane: how a TRUST discovers,
authorizes, invokes, observes, and removes capabilities without turning AEQI
into a generic worker/function/trigger framework.

It builds on [primitive-contract.md](primitive-contract.md). The public product
ontology remains TRUST-first. The extension plane is infrastructure under
**Apps / Tools** and **Events**.

The locked install lifecycle for app and package manifests is defined in
[app-installer.md](app-installer.md).

## Goal

Make every runtime capability visible through one live registry:

- what exists
- who owns it
- what schema it accepts and returns
- who may call it
- what TRUST, role, agent, app, package, or MCP server installed it
- whether it is healthy
- how to remove it without leaving stale registrations
- which events or sessions used it

The iii lesson to copy is the live capability plane. The iii ontology to reject
is making Worker / Function / Trigger the public product model.

## Non-Goals

- Do not rename TRUST, Roles, Agents, Quests, Ideas, Events, Sessions, or
  Apps/Tools.
- Do not replace the existing `ToolRegistry`, MCP registry, event store, or
  blueprint installer in one pass.
- Do not allow arbitrary code execution from package manifests.
- Do not make the UI mutate raw SQLite/Postgres state directly.
- Do not expose cross-tenant capability metadata in hosted runtimes.

## Current Substrate

AEQI already has the pieces needed for a first slice:

- `ToolRegistry` maps tool names to implementations and enforces
  `CallerKind::{Llm, Event, System}` plus per-agent `tool_deny`.
- `ExecutionContext` carries session, agent, role, stream, and credential
  context outside operator-writable JSON args.
- `PatternDispatcher` lets detectors fire event patterns whose `tool_calls`
  run through the tool registry.
- MCP servers register namespaced tools through `McpRegistry`, refresh on
  `notifications/tools/list_changed`, and expose per-server caller-kind ACLs.
- Events already model pattern-driven tool call execution.
- Blueprints already install agents, roles, ideas, quests, and events with
  preview expectations.

The gap is that these surfaces do not yet report into one canonical capability
registry with owner, schema, health, lifecycle, and cleanup semantics.

The operator-facing view of those health, lifecycle, and usage records is the
[Operate Console](operate-console.md).

## Core Records

### Capability Descriptor

Every callable, installable, triggerable, or observable capability should
project into this shape.

```rust
pub struct CapabilityDescriptor {
    pub id: String,
    pub kind: CapabilityKind,
    pub namespace: String,
    pub name: String,
    pub owner: CapabilityOwner,
    pub status: CapabilityStatus,
    pub trust_scope: TrustScope,
    pub caller_kinds: Vec<CallerKind>,
    pub input_schema: Option<serde_json::Value>,
    pub output_schema: Option<serde_json::Value>,
    pub permissions: Vec<PermissionNeed>,
    pub credential_needs: Vec<CredentialNeed>,
    pub source: CapabilitySource,
    pub version: Option<String>,
    pub health: Option<CapabilityHealth>,
}
```

Initial `CapabilityKind` values:

| Kind                 | Meaning                                                | Existing source                   |
| -------------------- | ------------------------------------------------------ | --------------------------------- |
| `tool`               | Callable tool in `ToolRegistry`                        | core tools, pack tools, MCP tools |
| `mcp_server`         | Installed MCP server and its transport health          | `McpRegistry`                     |
| `event_trigger_type` | Event source type that can bind patterns to tool calls | event system                      |
| `event_handler`      | Concrete enabled event row                             | event store                       |
| `agent`              | Persistent worker identity                             | agent registry                    |
| `role`               | Authority chair and occupancy                          | role store                        |
| `quest_api`          | Quest CRUD/search/workflow surface                     | quest tools/API                   |
| `idea_api`           | Idea CRUD/search/graph surface                         | idea tools/API                    |
| `code_graph`         | Indexed repository graph and query surface             | code graph index                  |
| `app`                | Trust-scoped app integration or package                | Apps page / future installer      |

### Capability Owner

Capabilities must not be anonymous. Cleanup and security depend on owner
identity.

```rust
pub enum CapabilityOwner {
    RuntimeBuiltin { module: String },
    Trust { trust_id: String },
    Role { trust_id: String, role_id: String },
    Agent { trust_id: String, agent_id: String },
    App { trust_id: String, app_id: String },
    Package { trust_id: String, package_id: String, install_id: String },
    McpServer { trust_id: String, server_name: String },
}
```

The first implementation can serialize this as JSON. Do not begin with a
polymorphic table migration unless a concrete store needs it.

### Owner Token

Every mutating registration receives an owner token minted by the runtime.
The token is not a bearer secret for external clients; it is an internal
compare-and-release handle.

```rust
pub struct RegistrationToken {
    pub owner: CapabilityOwner,
    pub namespace: String,
    pub generation: u64,
    pub issued_at_ms: i64,
}
```

Rules:

- Registration creates or updates only within namespaces granted to the owner.
- Deregistration removes only rows matching the same owner and generation, or a
  newer explicit takeover grant.
- Restart/reload cleanup compares owner and generation before deleting anything.
- Cross-owner overwrites fail by default.
- Namespace takeover requires an audited policy event.

This avoids the process-global scope trap: a concurrent registration cannot be
accidentally captured into another app, package, or worker's cleanup set.

### Namespace Grants

Names carry authority. A package cannot register `mcp:github:*` or
`runtime:*` just because it knows the string.

```rust
pub struct NamespaceGrant {
    pub trust_id: String,
    pub namespace: String,
    pub owner: CapabilityOwner,
    pub allowed_kinds: Vec<CapabilityKind>,
    pub expires_at_ms: Option<i64>,
    pub granted_by: ActorRef,
    pub reason: String,
}
```

Examples:

- `runtime:*` belongs to builtins only.
- `mcp:<server>:*` belongs to the configured MCP server.
- `app:<app_id>:*` belongs to a trust-scoped app.
- `pkg:<package_id>:*` belongs to a package install.
- `agent:<agent_id>:*` belongs to an agent only for agent-local capabilities.

## Typed Event Triggers

Events remain a product surface. Typed trigger registration is the extension
contract underneath it.

### Trigger Type Descriptor

```rust
pub struct EventTriggerTypeDescriptor {
    pub id: String,
    pub owner: CapabilityOwner,
    pub display_name: String,
    pub description: String,
    pub event_schema: serde_json::Value,
    pub binding_schema: serde_json::Value,
    pub caller_kinds: Vec<CallerKind>,
    pub namespace: String,
}
```

Built-in trigger types should cover:

| Trigger type           | Fires when                                           |
| ---------------------- | ---------------------------------------------------- |
| `schedule`             | Cron/interval/time-based schedule is due             |
| `webhook`              | Authenticated HTTP webhook arrives                   |
| `session.lifecycle`    | `session:start`, `session:quest_start`, etc.         |
| `quest.lifecycle`      | Quest created, assigned, blocked, completed, retried |
| `idea.lifecycle`       | Idea stored, linked, superseded, corrected           |
| `tool.lifecycle`       | Tool call starts, succeeds, fails, or exceeds policy |
| `code.lifecycle`       | Code graph index starts, completes, or changes       |
| `deployment.lifecycle` | Build/deploy/health transition occurs                |

External apps/packages can register additional trigger types only in their
granted namespace.

### Trigger Binding

An event row becomes a binding between a trigger type, match config, and
tool calls.

```rust
pub struct EventBinding {
    pub id: String,
    pub trigger_type: String,
    pub pattern: String,
    pub config: serde_json::Value,
    pub tool_calls: Vec<ToolCall>,
    pub owner: CapabilityOwner,
    pub enabled: bool,
}
```

Compatibility rule: existing event rows with plain `pattern` continue to work.
The typed trigger fields can be additive at first:

- `trigger_type = "session.lifecycle"` for existing `session:*` patterns
- `trigger_type = "schedule"` for cron/interval rows
- `trigger_type = "webhook"` for webhook rows

## Registry API Surface

First runtime/API shape:

| Function/API                   | Use                                                   |
| ------------------------------ | ----------------------------------------------------- |
| `runtime.capabilities.list`    | List visible descriptors for current TRUST and actor. |
| `runtime.capabilities.info`    | Fetch one descriptor plus health and owner metadata.  |
| `runtime.capabilities.changed` | Event pattern fired after registry changes.           |
| `runtime.trigger_types.list`   | List known trigger types and schemas.                 |
| `runtime.namespaces.list`      | List namespace grants visible to the actor.           |

MCP should expose the same read-only tools early. Mutating registration can
wait until owner-token and namespace rules are tested.

## Lifecycle

1. Runtime boots builtins and registers builtin descriptors.
2. MCP registry installs configured servers and registers `mcp_server` plus
   `tool` descriptors.
3. Pack crates register tool descriptors.
4. Event store projects enabled events into `event_handler` descriptors.
5. Blueprint/package/app install follows [app-installer.md](app-installer.md):
   preview, lock, owner token, namespace grant, then capability registration.
6. Registry emits `runtime.capabilities.changed`.
7. Operate Console and agents consume the same registry.
8. On unload/reload/disconnect, cleanup removes only matching owner-token
   registrations.

## Security Rules

- Registry reads are actor-scoped. Hosted users see only capabilities for
  authorized TRUSTs.
- Schemas are public to authorized actors; secrets and resolved credentials are
  never included.
- Tool args may contain user/operator data and must be redacted in logs.
- Event trigger configs must validate against trigger type schemas before they
  can be enabled.
- Any mutating console action must write an audit/activity row.
- `CallerKind::System` is never granted to third-party packages by default.
- Cross-owner namespace takeover requires explicit role authority and an audit
  reason.
- Package manifests declare permission and credential needs; install preview
  shows them before anything is enabled.

## First Shippable Slice

Do not start by building a full plugin runtime. Ship a read-only registry over
existing surfaces.

1. Add a `CapabilityDescriptor` type in a runtime-facing crate.
2. Project existing `ToolRegistry::all_tools()` into `tool` descriptors.
3. Project `McpRegistry::snapshot()` plus server health into `mcp_server` and
   `tool` descriptors.
4. Project event rows into `event_handler` descriptors.
5. Expose `runtime.capabilities.list/info` through HTTP and MCP.
6. Add `runtime.capabilities.changed` as a pattern emitted on tool/MCP/event
   registry refresh.
7. Add an Operate Console read-only page later; do not block the backend
   contract on UI.

Acceptance:

- The same current TRUST shows the same capability list through HTTP and MCP.
- Tool descriptors include name, schema, caller kinds, source, and owner.
- MCP tools keep their `mcp:<server>:<tool>` namespace.
- Event handlers report pattern, enabled state, owner, and tool call count.
- No secrets appear in descriptors.
- Isolation tests prove hosted users cannot read another TRUST's registry.

## Second Slice

Add typed event trigger registration without external plugin code execution:

1. Add builtin trigger type descriptors for session, quest, idea, schedule,
   webhook, tool, code, and deployment lifecycle.
2. Add optional `trigger_type` and `config` fields to event rows.
3. Validate new/edited events against the trigger type schema.
4. Backfill existing lifecycle events with `trigger_type`.
5. Expose `runtime.trigger_types.list` through HTTP/MCP.
6. Update event editor UI to show trigger-specific schema help.

## Third Slice

Add owner-token and namespace enforcement for installable apps/packages, using
the locked installer contract:

1. Define namespace grants and owner-token records.
2. Make package/blueprint install preview show namespaces, capabilities,
   tool calls, permissions, and credential needs.
3. Register package/app-owned descriptors using owner tokens.
4. Add compare-and-release cleanup.
5. Add audited namespace takeover for explicit migrations.

## Verification Ladder

For any implementation slice:

- Unit test descriptor projection for builtins, MCP tools, and event rows.
- Contract test HTTP and MCP return equivalent descriptor sets for one TRUST.
- Isolation test denies capability listing for unauthorized TRUSTs.
- Redaction test proves credentials and secret args never appear in descriptors
  or logs.
- Namespace test blocks cross-owner overwrite.
- Reload test proves owner-token cleanup removes stale owned descriptors only.
- Event validation test rejects trigger config that violates schema.

## Rollback

Read-only registry slices are rollback-safe: remove the endpoint/tool and leave
underlying tools/events/MCP unchanged.

Typed trigger fields must be additive until one release has shipped with
backfill. Keep existing pattern-only events working until the new fields are
fully populated and verified.

Owner-token enforcement should start in warn-only mode for builtins and current
MCP servers, then become hard-fail for new package/app registrations.
