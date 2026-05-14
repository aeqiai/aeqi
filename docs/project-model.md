# Project, Repository, and Library Model

This note defines the canonical product model for projects without breaking the
current runtime surfaces that already use the word `project`.

## Decision

A project is a mission container, not a repository, agent, folder, or entity.
It is a context and audit boundary, not the root authority boundary.

`Entity` is the canonical root. A company is `Entity { type: company }`, not a
separate primitive. The entity owns durable assets. Projects link those assets
for a bounded body of work.

```text
Entity
  owns agents
  owns roles
  owns repositories
  owns library items
  owns budgets
  owns runtime instances
  owns projects

Project
  links agents and humans
  links repositories
  links library items
  owns or links quests
  links decisions, deployments, sessions, and budget allocations
```

When a project completes, its repositories, agents, and library items survive.
The completed project remains as the audit trail: objective, quests, decisions,
evidence, deployments, and outcomes.

## Why Repository Is Not Project

Repositories are durable technical assets. They can serve many projects across
time:

```text
Repository: aeqi-platform
  Project: MVP launch
  Project: Runtime billing
  Project: Admin operations
  Project: Security hardening
```

Projects may also touch many repositories, or no repository at all:

```text
Project: Fundraise
  repositories: none
  library: investor deck, cap table export, legal notes
  quests: draft deck, prepare outreach, review terms

Project: Hosted runtime billing
  repositories: aeqi, aeqi-platform
  library: pricing notes, provider invoices
  quests: implement usage accounting, deploy admin controls
```

A one-to-one `project == repository` mapping would make short-term work own
long-term assets. That breaks lifecycle, access control, historical audit, and
non-code entity work.

## Current Runtime Reality

The current runtime already uses `project` in several incompatible ways:

- `[[projects]]` in `aeqi.toml` is a configured worker/repository binding. The
  Rust field is still named `agent_spawns`.
- `[repos]` is a global repository pool, but each configured project has a
  single `repo` value.
- MCP and CLI code graph operations use `project` as the graph key and store
  graph databases under `data_dir/codegraph/{project}.db`.
- Quests accept a `project` string, which often means the configured worker
  root rather than a first-class domain object.
- Session spawn options expose `project_id` as intended scope for workdir,
  memory, and tools, but persisted sessions do not yet store canonical project
  identity.
- Budgets already have `BudgetKind::Project`, but there is no canonical
  `projects` table yet.
- `projects/README.md` currently states that active configuration lives in the
  database and there are no separate project entities.

This means `project` is currently a compatibility label. It should become a
real object while existing command/config names continue to work.

## Consensus

The safe consensus is:

- Entity is the authority root.
- Repository is the code graph and worktree root.
- Agent is the execution identity.
- Role is the permission surface.
- Budget is role-owned spending authority.
- LibraryItem is the artifact/source-material object.
- Idea is interpreted memory.
- Quest is durable work.
- Project is optional mission context that links the above for a body of work.

The current `[[projects]]` config entry should be understood as a legacy
project runtime binding: a named worker pool pointed at one repository. It can
seed a real project and repository link, but it is not the full product model.

## Canonical Types

### Entity

An entity is an actor or institution: company, human, agent, fund, DAO,
holding, or protocol. Entities own or occupy roles and can be assigned to work.

### Project

A project is a coordination container inside an entity.

Suggested fields:

```text
projects
  id
  entity_id
  slug
  name
  prefix
  objective
  status                  active | paused | completed | archived
  owner_entity_id
  default_repository_id
  runtime_preset_id
  worktree_root
  max_workers
  default_budget_id
  metadata
  created_at
  updated_at
  completed_at
```

### Repository

A repository is a durable code root owned by the entity.

Suggested fields:

```text
repositories
  id
  entity_id
  slug
  name
  provider
  remote_url
  default_branch
  local_path
  credential_scope
  metadata
  created_at
  updated_at
```

### Library Item

A library item is any non-code artifact or knowledge object owned by the
entity: folder, file, note, link, idea, decision, spec, contract, image,
recording, dataset, or evidence.

Suggested fields:

```text
library_items
  id
  entity_id
  project_id
  agent_id
  parent_id
  type                    folder | file | note | link | idea | decision | spec | contract | image | evidence
  provider                local | google_drive | notion | github | upload | external
  title
  mime
  body
  blob_id
  storage_ref
  content_hash
  source_url
  metadata
  created_by_entity_id
  created_at
  updated_at
```

Ideas are interpreted memory. Files are source artifacts. Decisions are
committed ideas with operational consequence. All can appear in the same
Library UI, but they should keep distinct types.

Use `LibraryItem`, not `Drive`, as the domain noun. Drive is a provider or UI
metaphor, not the canonical object.

## Link Tables

Projects should link durable assets instead of owning them:

```text
project_members
  project_id
  actor_entity_id
  role_id

project_repositories
  project_id
  repository_id
  access_level             read | write | admin

project_library_links
  project_id
  library_item_id
  relation                 context | evidence | input | output | decision

project_budgets
  project_id
  budget_id
  relation                 default | inference | operating | treasury
```

Quests should eventually reference `entity_id`, and may reference `project_id`
when work belongs to a mission container. They can also link to a repository,
worktree, library item, session, deployment, or budget:

```text
quests
  id
  entity_id
  project_id
  assigned_actor_id
  repository_id
  worktree_id
```

`project_id` is not an authorization anchor. It is a planning, filtering, and
audit anchor. Role grants, repository permissions, and worktree grants remain
the operational authority.

## Access Model

Access is a composition of entity role, project assignment, repository
permission, and quest execution grant.

```text
Entity role grants baseline authority.
Project assignment grants mission context.
Repository permission grants code access.
Quest/worktree grant grants temporary execution authority.
```

Agents belong to the entity role graph. They are assigned to projects; they
are not children of projects. The same agent can work across multiple projects
when policy allows it.

Humans and agents act through roles. Role grants should remain the authority
surface; project membership grants mission context, not raw permission to every
asset in the entity.

Budgets remain role-owned cost centers. Project budgets are budgets of
`kind = project` with a `project_id` link; spending authority still comes from
the budget owner role.

## Code Graph Scope

Code graph storage should become repository-scoped:

```text
codegraph/{repository_id}.db
```

Project queries should fan out across linked repositories and combine that with
project memory, quests, decisions, and library context.

Compatibility rule: the current `code(project = "...")` MCP parameter should
continue to work by resolving the legacy configured project name to its linked
repository.

## Runtime And Deployment Scope

Runtime is the compute/data plane for an entity. Deployment is a provisioning or
release attempt. They should not collapse into project or placement rows.

```text
Runtime
  entity_id
  status                  provisioning | ready | degraded | stopped | failed
  endpoint
  version

Deployment
  entity_id
  project_id
  runtime_id
  source_kind             blueprint | architect_inline | git | manual
  state                   requested | admitted | provisioning | seeding | complete | failed | cancelled
  initiated_by_entity_id
```

Platform placement rows can remain as the hosted compatibility projection while
runtime, deployment, billing, and TRUST state split into their canonical
records.

## Worktree Scope

A quest is not a worktree. A worktree is a temporary execution sandbox for a
quest that changes code.

```text
Quest: audit legal deck
  worktree: none

Quest: refactor admin runtime page
  repository: aeqi
  worktree: /worktrees/aeqi-admin-runtime-page
```

## Migration Plan

1. Rename the internal concept in docs and comments: current `[[projects]]`
   entries are `worker bindings` or `project runtime bindings`, not the full
   product object.
2. Add first-class `repositories` backed by the existing `[repos]` config and
   local paths.
3. Add first-class `projects` as entity-owned mission containers.
4. Add `project_repositories` and resolve the legacy `[[projects]].repo` into a
   default repository link.
5. Add `project_members` for humans and agents.
6. Add `project_library_links`, initially backed by existing ideas and future
   library items.
7. Add `entity_id` to quests first; then add optional `project_id` as a context
   and audit link, preserving the legacy `project` string as a routing alias
   during migration.
8. Move code graph databases from project-keyed to repository-keyed storage,
   preserving a legacy resolver for existing MCP clients.
9. Add `entity_id`, `project_id`, and `library_item_id` anchors to ideas over
   time while preserving current idea search and graph behavior.
10. Split deployment state from runtime placement in the hosted platform after
    compatibility reads exist.
11. Update UI language so `Project` means mission container and `Repository`
    means code root.

## MVP Rule

For launch, do not build a large Drive clone. Build the minimum model that
prevents ontology debt:

- Entity Library with typed items and folders.
- Projects with objective, status, members, linked repos, linked library items,
  and quests.
- Repositories as entity assets with code graph state.
- Compatibility aliases for current `project` strings.

This keeps AEQI simple for normal users while giving agents the graph they need
to operate a programmable company.

## MVP UI Shape

The runtime UI already exposes most primitives separately: agents, events,
quests, ideas, blueprints, and an early file surface. The smallest coherent
product change is to introduce an entity-scoped `Library` entry that groups
knowledge and artifacts without hiding execution primitives.

```text
Organization
  Inbox
  Library
    Ideas
    Blueprints
    Files
  Agents
  Quests
  Events
  Roles
  Treasury
  Governance
```

User-facing meanings:

- Organization is the company/TRUST root.
- Agents execute.
- Quests are work.
- Ideas are knowledge, specs, and durable memory.
- Blueprints are reusable templates.
- Files are attachments and raw assets.
- Library is the access point for ideas, blueprints, files, decisions, specs,
  contracts, images, and evidence.

This should start as a hub over existing surfaces, not a complete Drive clone.
The file surface should become company/entity scoped over time; per-agent file
storage is an implementation detail, not the user-facing concept.
