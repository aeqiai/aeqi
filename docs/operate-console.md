# Operate Console

The Operate Console is the TRUST-scoped control plane for inspecting live work.
It should make AEQI feel like a runtime you can operate, not a set of disconnected
agent screens.

It builds on [primitive-contract.md](primitive-contract.md) and
[extension-plane.md](extension-plane.md). The console does not introduce a new
public primitive. It is the operator surface over Sessions, Quests, Events,
Apps/Tools, Activity, queues, and runtime health.

## Goal

Give an operator one place to answer:

- what is running now
- why it started
- which agent, role, quest, event, or tool owns it
- what it called
- what failed
- what is queued or stuck
- what evidence was produced
- whether the issue is user action, model/tool failure, event configuration,
  queue pressure, credential failure, or runtime health

The iii lesson to copy is the always-live operations view. The AEQI version must
be TRUST-first and evidence-first: every row should connect back to the work,
authority, memory, and tool surface that caused it.

## Current Substrate

AEQI already has most of the read model:

| Existing surface                 | Current source                                                             | Operate use                                              |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------- |
| Sessions                         | `sessions`, `session_messages`, `session_traces`                           | run list, transcript context, execution trace            |
| Quests                           | quest tables and `sessions.quest_id`                                       | owning work, status, blockers, outcomes                  |
| Events                           | event rows plus `event_invocations` and `event_invocation_steps`           | why automation fired and which tools it ran              |
| Tools                            | `ToolRegistry`, MCP registry, runtime tool specs                           | callable surface and tool-call attribution               |
| Activity                         | `activity` table and activity stream                                       | audit feed, costs, execution milestones                  |
| Pending message queue            | `pending_messages` with `queued` and `running` leases                      | queue depth, stale running rows, crash recovery evidence |
| Browser and external integration | capability-specific traces and future descriptors from the extension plane | app/tool health and evidence                             |
| UI event fires panel             | `/events/trace` and `FiresPanel`                                           | reusable event trace affordance                          |

The first version should compose these sources before adding new tables.

## Correlation Spine

Every observable record should project into this envelope, even when the current
storage only fills part of it.

```rust
pub struct OperateRecord {
    pub id: String,
    pub occurred_at: String,
    pub kind: OperateKind,
    pub level: OperateLevel,
    pub status: OperateStatus,
    pub ids: OperateIds,
    pub source: OperateSource,
    pub title: String,
    pub summary: Option<String>,
    pub duration_ms: Option<u64>,
    pub payload: Option<serde_json::Value>,
    pub redactions: Vec<RedactionNotice>,
}

pub struct OperateIds {
    pub trust_id: Option<String>,
    pub session_id: Option<String>,
    pub quest_id: Option<String>,
    pub agent_id: Option<String>,
    pub role_id: Option<String>,
    pub event_id: Option<String>,
    pub event_invocation_id: Option<String>,
    pub event_invocation_step_id: Option<String>,
    pub tool_call_id: Option<String>,
    pub tool_name: Option<String>,
    pub capability_id: Option<String>,
    pub app_id: Option<String>,
    pub mcp_server_id: Option<String>,
    pub request_id: Option<String>,
    pub actor_user_id: Option<String>,
    pub deployment_id: Option<String>,
    pub worktree_path: Option<String>,
    pub branch: Option<String>,
}
```

Initial `OperateKind` values:

| Kind               | Meaning                                                         |
| ------------------ | --------------------------------------------------------------- |
| `session`          | session opened, closed, forked, cancelled, resumed              |
| `quest`            | quest created, assigned, started, blocked, closed, failed       |
| `event_invocation` | event pattern matched and began dispatch                        |
| `tool_call`        | LLM, event, system, MCP, or app tool invocation                 |
| `activity`         | activity row, checkpoint, cost, evidence, or progress marker    |
| `queue`            | pending-message queued/running/stale/recovered state            |
| `capability`       | tool, app, MCP server, trigger type, or integration health      |
| `runtime_health`   | daemon, worker loop, model provider, storage, or deployment row |
| `security`         | auth, RBAC, redaction, credential, or policy event              |

## API Contract

The HTTP API can start as a read-only facade over existing IPC commands. MCP
gets the same shapes so external operator clients and agents can inspect the
runtime without scraping UI-specific endpoints.

| HTTP route                         | MCP tool                 | Purpose                                            |
| ---------------------------------- | ------------------------ | -------------------------------------------------- |
| `GET /api/operate/summary`         | `operate.summary`        | live counts, unhealthy surfaces, latest failures   |
| `GET /api/operate/timeline`        | `operate.timeline`       | unified timeline of operate records                |
| `GET /api/operate/traces/{id}`     | `operate.trace`          | one invocation/session/tool trace with child steps |
| `GET /api/operate/logs`            | `operate.logs`           | filtered activity/session trace rows               |
| `GET /api/operate/queues`          | `operate.queues`         | pending/running/stale queue leases                 |
| `GET /api/operate/capabilities`    | `operate.capabilities`   | extension-plane registry projection                |
| `GET /api/operate/stale-claims`    | `operate.stale_claims`   | rows requiring recovery or operator inspection     |
| `POST /api/operate/redrive`        | `operate.redrive`        | later mutating action for explicit recovery        |
| `POST /api/operate/acknowledgment` | `operate.acknowledgment` | later mutating action for incident bookkeeping     |

Read-only routes must ship first. Mutating routes require audit rows, RBAC, and
undo/recovery semantics before they are enabled.

### Filters

All list endpoints should accept the same filter vocabulary:

```text
trust_id
session_id
quest_id
agent_id
role_id
event_invocation_id
tool_name
capability_id
kind
status
level
since
until
limit
cursor
include_payload=false
```

`include_payload=false` is the default. Payload expansion is explicit and
permission-gated.

## UI Contract

Primary route:

```text
/trust/:trustId/operate
```

Initial tabs:

| Tab            | Purpose                                                                  |
| -------------- | ------------------------------------------------------------------------ |
| Overview       | live summary, active sessions, blocked quests, latest failures           |
| Timeline       | unified records with filters and deep links                              |
| Traces         | session, event invocation, and tool-call trace trees                     |
| Queues         | pending-message depth, running leases, stale claims, recovery evidence   |
| Capabilities   | tools, MCP servers, apps, trigger types, health, caller permissions      |
| Runtime Health | daemon, provider, storage, budget, deployment, and background-loop state |
| Security       | redactions, denied calls, credential errors, policy/audit events         |

The first UI slice can be smaller:

1. Add an Operate entry point from the TRUST home/runtime card.
2. Show read-only Overview plus Timeline.
3. Link event rows to the existing Event Fires/StepDetail affordance.
4. Link session rows to the existing SessionDetail surface.
5. Show queue state as read-only counts with stale-row explanation.

Avoid a second bespoke trace UI until the existing event trace panel and session
detail surface have been reused or deliberately replaced.

## Redaction and RBAC

Operate Console data is sensitive because it can contain prompts, tool args,
tool outputs, credentials, headers, user messages, and business evidence.

Default policy:

- Do not return raw prompts, full transcripts, tool args, tool outputs, request
  headers, environment variables, credential material, or provider payloads in
  timeline rows.
- Redact keys matching `authorization`, `token`, `secret`, `password`,
  `api_key`, `cookie`, `set-cookie`, `private_key`, `mnemonic`, and `seed`.
- Show previews only when the source row already stores a preview or summary.
- Payload expansion requires an explicit permission check and writes an audit
  row.
- Cross-TRUST reads are denied by default, including capability metadata.
- Operators can see operational metadata for their TRUST; agents only see rows
  scoped to their session, quest, role, or delegated authority.
- Mutating operations such as redrive, cancel, kill, requeue, credential test,
  or capability disable require role permission and activity/audit evidence.

Errors should be useful without leaking payloads. Prefer structured fields like
`error_code`, `error_class`, `tool_name`, `provider`, `status`, and
`redaction_count` over raw exception strings when returning list rows.

## First Shippable Slice

Ship this in the smallest useful order:

1. Define the `OperateRecord` JSON shape in one Rust module and one UI type.
2. Add read-only `operate.summary` and `operate.timeline` MCP tools over
   existing sessions, quests, activity, event invocations, and pending queues.
3. Add HTTP `GET /api/operate/summary` and `GET /api/operate/timeline` as thin
   proxies over the same backend.
4. Add `/trust/:trustId/operate` with Overview and Timeline tabs.
5. Deep-link each row to existing session, quest, event, and tool trace screens.
6. Add redaction tests before exposing `include_payload=true`.
7. Add stale-queue detection as read-only evidence; do not add redrive yet.

This produces visible platform improvement without introducing new runtime
authority paths.

## Verification Ladder

Minimum checks for the first slice:

- unit tests for `OperateRecord` projection from session, activity, event
  invocation, invocation step, and pending-message rows
- redaction tests for nested JSON, headers, env-like keys, and mixed-case secret
  keys
- TRUST-scope tests proving rows from another TRUST are absent
- role/agent permission tests for timeline and payload expansion
- API tests for filters, cursor pagination, and default payload omission
- MCP tests for `operate.summary` and `operate.timeline`
- UI tests for empty, loading, active, failed, and filtered timeline states
- Playwright check for `/trust/:trustId/operate` on desktop and mobile
- restart test proving stale running queue rows are reported before recovery or
  reported as recovered after startup cleanup

## Rollback

The first slice is additive and read-only. Rollback is:

1. remove the Operate UI route/link
2. disable the HTTP routes and MCP tools
3. leave existing sessions, activity, event invocation, and queue tables intact

No data migration is required until mutating recovery actions or new persisted
operate-specific tables are introduced.
