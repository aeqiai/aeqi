# App and Package Installer

This document defines the locked installer contract for AEQI apps, packages,
integration packs, and future worker-backed capabilities.

It builds on:

- [primitive-contract.md](primitive-contract.md): Apps/Tools are a first-class
  TRUST surface, not a separate public ontology.
- [extension-plane.md](extension-plane.md): capabilities need owners,
  namespaces, trigger types, and owner-token cleanup.
- [operate-console.md](operate-console.md): install, drift, health, and removal
  must be inspectable by operators and agents.
- [compositional-blueprint-assets.md](compositional-blueprint-assets.md):
  current packages are repo-backed, curated, data-only, and previewable.

## Goal

Make installable AEQI surface area boring, inspectable, and reversible:

- preview exactly what will be created
- lock exactly what was installed
- declare permissions, credentials, namespaces, events, tools, and lifecycle
  hooks before install
- detect drift from the installed lock
- remove owned registrations without touching another owner
- show every install/remove/start/stop/drift decision in the Operate Console

The iii lesson to copy is a small installable unit with clear lifecycle
commands. The AEQI version must be TRUST-scoped, authority-aware, and incapable
of smuggling arbitrary runtime code through a manifest.

## Non-Goals

- No public upload store in the first implementation.
- No arbitrary shell, JavaScript, Python, WASM, or container execution from
  package manifests.
- No package may grant itself `CallerKind::System`.
- No package may write raw database rows directly.
- No cross-TRUST install visibility in hosted mode.
- No silent transitive install. Every agent, role, idea, quest, event, tool,
  credential need, and namespace grant must appear in preview.

## Installable Units

| Unit                     | Meaning                                                          | First allowed source                  |
| ------------------------ | ---------------------------------------------------------------- | ------------------------------------- |
| `blueprint_package`      | TRUST launch recipe with roles, agents, ideas, events, quests    | repo-backed `presets/blueprints`      |
| `agent_template_package` | hireable agent template plus scoped seeds                        | repo-backed `presets/agent_templates` |
| `idea_pack`              | curated memory, instructions, decisions, or procedures           | repo-backed seed docs                 |
| `event_pack`             | typed event bindings and tool-call routines                      | repo-backed manifest                  |
| `tool_pack`              | compiled integration crate already linked into the runtime       | `crates/aeqi-pack-*`                  |
| `mcp_app`                | configured MCP server plus namespaced tools                      | operator-supplied config              |
| `platform_app`           | hosted AEQI app integration backed by platform OAuth/credentials | curated platform registry             |
| `worker_app`             | future process-backed capability                                 | disabled until sandbox contract       |

`worker_app` is reserved. It must not execute until AEQI has a separate
sandbox, resource limits, provenance, upgrade, and rollback contract.

## Manifest

Every installable unit projects into one manifest shape. Repo-backed blueprint
JSON can keep its current schema, but the installer should normalize it into
this contract before preview and lock generation.

```rust
pub struct AeqiPackageManifest {
    pub manifest_version: u32,
    pub package_id: String,
    pub unit_type: InstallableUnitType,
    pub name: String,
    pub version: String,
    pub description: String,
    pub publisher: PublisherRef,
    pub license: Option<String>,
    pub compatibility: Compatibility,
    pub provenance: Provenance,
    pub install_modes: Vec<InstallMode>,
    pub surfaces: PackageSurfaces,
    pub permissions: Vec<PermissionNeed>,
    pub credentials: Vec<CredentialNeedDecl>,
    pub namespaces: Vec<NamespaceRequest>,
    pub lifecycle: LifecycleDecl,
}
```

Manifest rules:

- `package_id` is stable and namespaced, for example `aeqi:first-company` or
  `github:issues`.
- `version` is semantic for curated packages and pinned for generated imports.
- `compatibility` declares minimum/maximum AEQI runtime versions and optional
  required features.
- `provenance` declares source repo/path, commit hash, content hash, and whether
  the package is runtime-builtin, curated, operator-local, or future marketplace.
- `surfaces` is data: agents, roles, ideas, quests, event bindings, tool
  descriptors, MCP server descriptors, trigger types, UI placements, and
  documentation links.
- `lifecycle` is declarative. It may name runtime operations such as install,
  remove, start, stop, health, and sync, but it cannot include arbitrary code.

## Lockfile

Every install writes a lock record. The lock is the source of truth for removal,
drift detection, and audit.

```rust
pub struct AeqiPackageLock {
    pub install_id: String,
    pub trust_id: String,
    pub package_id: String,
    pub package_version: String,
    pub manifest_hash: String,
    pub resolved_at_ms: i64,
    pub installed_by: ActorRef,
    pub approved_by_role_id: Option<String>,
    pub owner: CapabilityOwner,
    pub owner_token: RegistrationToken,
    pub namespace_grants: Vec<NamespaceGrant>,
    pub created_records: Vec<InstalledRecordRef>,
    pub enabled_capabilities: Vec<String>,
    pub credential_bindings: Vec<CredentialBindingRef>,
    pub status: InstallStatus,
}
```

Lock rules:

- Hash the normalized manifest, not raw file bytes.
- Store every created record by stable kind and id.
- Removal only deletes or disables records owned by the lock's owner token.
- Drift detection compares current records to `created_records`,
  `enabled_capabilities`, namespace grants, and manifest hash.
- Manual edits are not overwritten silently. Drift becomes an Operate Console
  record and a previewable sync plan.

## Lifecycle Commands

Installer commands should exist as runtime APIs and MCP tools once implemented:

| Command                 | Behavior                                                         |
| ----------------------- | ---------------------------------------------------------------- |
| `apps.packages.preview` | return install diff, permissions, credentials, namespaces        |
| `apps.packages.install` | create records, grants, owner token, lock, and audit rows        |
| `apps.packages.list`    | list locks visible to the actor                                  |
| `apps.packages.info`    | show manifest, lock, created records, health, and drift          |
| `apps.packages.sync`    | preview or apply a manifest/lock reconciliation                  |
| `apps.packages.remove`  | remove owned records by owner token, or disable when destructive |
| `apps.packages.start`   | enable owned events/tools/app health checks                      |
| `apps.packages.stop`    | disable owned events/tools/app health checks                     |
| `apps.packages.health`  | report credential, namespace, capability, and drift state        |

Every mutating command emits activity and Operate Console records with:

```text
trust_id
package_id
install_id
actor_user_id
approved_by_role_id
owner_token.generation
manifest_hash
summary
```

## Authority and Scoping

Install authority is role-based:

- Installing a package into a TRUST requires a role grant such as
  `apps.install`.
- Enabling event bindings requires `events.manage`.
- Granting tool/capability namespaces requires `apps.authorize_capabilities`.
- Binding credentials requires `credentials.bind`.
- Enabling posting, payment, on-chain, email, or destructive tools requires an
  explicit high-risk permission and approval row.
- Removing a package requires either the installing actor, an authorized role,
  or a higher TRUST authority.

The installer must pass the actor envelope through all runtime calls. Package
install cannot become a privileged backdoor around normal tool, event, role,
quest, idea, or credential APIs.

## Namespace Ownership

The installer uses the extension plane's namespace grant model.

| Package type       | Namespace                            |
| ------------------ | ------------------------------------ |
| builtin runtime    | `runtime:*`                          |
| curated blueprint  | `pkg:aeqi:first-company:*`           |
| agent template     | `pkg:agent-template:<template_id>:*` |
| Google tool pack   | `pack:google-workspace:*`            |
| MCP GitHub server  | `mcp:github:*`                       |
| platform email app | `app:email:*`                        |

Rules:

- A package cannot register outside granted namespaces.
- A package cannot overwrite another owner by string collision.
- Namespace takeover requires explicit role authority, a reason, and audit.
- On reload, cleanup compares owner and generation before deleting descriptors.

## Preview Contract

Preview is mandatory before install and before sync.

```rust
pub struct InstallPreview {
    pub package_id: String,
    pub package_version: String,
    pub manifest_hash: String,
    pub trust_id: String,
    pub mode: InstallMode,
    pub creates: Vec<InstallChange>,
    pub updates: Vec<InstallChange>,
    pub disables: Vec<InstallChange>,
    pub removes: Vec<InstallChange>,
    pub permissions: Vec<PermissionNeed>,
    pub credentials: Vec<CredentialNeedDecl>,
    pub namespaces: Vec<NamespaceRequest>,
    pub risks: Vec<RiskNotice>,
    pub blocked_reasons: Vec<String>,
}
```

Preview must include transitive assets after expansion. A company blueprint that
references an agent template must show the agent, role, template ideas, template
events, and template quests that will materialize.

## Drift Detection

| State                | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `clean`              | current records match lock                                     |
| `manifest_changed`   | normalized manifest hash differs from lock                     |
| `record_missing`     | a created record is gone                                       |
| `record_changed`     | a managed field changed                                        |
| `capability_stale`   | registry descriptor no longer matches lock/source              |
| `credential_broken`  | required credential is missing, expired, revoked, scoped wrong |
| `namespace_conflict` | another owner now claims a required namespace                  |
| `unsafe_to_sync`     | sync would remove user-edited state without approval           |

Drift detection is read-only by default. `apps.packages.sync` must support
`dry_run=true` and show the exact plan before applying.

## Threat Model

| Threat                         | Control                                                                    |
| ------------------------------ | -------------------------------------------------------------------------- |
| Manifest hides executable code | Manifests are declarative; no arbitrary command/script/container execution |
| Package steals namespace       | namespace grants and owner-token compare-and-release                       |
| Package overwrites user data   | preview, lock ownership, managed-field boundaries, and sync dry-run        |
| Package exfiltrates secrets    | no secrets in manifest/preview/logs; credentials resolve only at call time |
| Package grants itself power    | role-gated install, permission review, no third-party `System` caller kind |
| Cross-tenant metadata leak     | actor-scoped registry and package list                                     |
| Removal deletes wrong records  | delete only records matching install lock and owner generation             |
| Drift hides broken automation  | health and drift records in Operate Console                                |
| Transitive install surprise    | expanded preview lists every child asset and credential need               |
| Supply-chain substitution      | manifest hash, source commit/path, signed curated registry later           |

## First Shippable Slice

Do not begin with a marketplace or worker runtime.

Current implementation starts this slice with a read-only blueprint package
preview exposed through runtime IPC command `blueprint_package_preview` and HTTP
route `GET /api/blueprints/{slug}/package-preview`.

1. Define normalized manifest, preview, lock, and installed-record JSON shapes.
2. Normalize existing repo-backed blueprints and agent templates into preview.
3. Add `apps.packages.preview` for the shipped `aeqi` blueprint package.
4. Add lock generation for launches that use the default blueprint, initially
   in read-only/reporting mode if persistence needs a separate migration.
5. Project installed packages into the capability registry as `app`,
   `event_handler`, and owned `tool` descriptors.
6. Surface package install and drift state in Operate Console read models.
7. Add schema tests proving preview expansion matches spawn expansion.

Acceptance:

- preview for the default package lists the exact agents, roles, ideas, quests,
  events, tool calls, permissions, and credential needs that spawn will create
- normalized manifest hash is stable across formatting changes
- install lock records every created record or reports why the first slice is
  read-only
- remove/sync remain disabled until owner-token cleanup is implemented
- no runtime/platform boundary is weakened

## Later Slices

Second slice:

- persistent install locks
- package list/info/health APIs
- drift detection over managed records
- Operate Console package health view

Third slice:

- owner-token cleanup and audited remove
- namespace takeover workflow
- dry-run sync and apply
- role-gated start/stop for owned events and tools

Fourth slice:

- curated package registry with signed index
- external PR contribution path
- marketplace review state
- worker-app sandbox contract, if still needed

## Verification Ladder

- schema tests for manifest normalization and stable hash
- preview tests for default blueprint and agent-template expansion
- permission tests for install, credential binding, event enable, and removal
- namespace tests for cross-owner collision and takeover
- lock tests for created-record inventory and compare-and-release cleanup
- drift tests for missing records, edited records, missing credentials, and
  manifest changes
- redaction tests for preview, activity, Operate Console, and MCP responses
- hosted isolation tests proving packages from one TRUST are invisible to
  another
- rollback tests proving disabled remove/sync paths cannot mutate state in the
  first slice

## Rollback

The first slice is additive:

1. remove package preview endpoints/tools
2. stop projecting package descriptors into the capability registry
3. leave existing blueprint spawn behavior unchanged

Do not migrate existing blueprints into a new required installer path until the
preview and lock models have shipped in read-only mode and stayed stable.
