# AEQI Primitive Contract

This is the canonical product and runtime vocabulary for AEQI. It is the
source of truth for docs, UI labels, MCP surfaces, runtime APIs, and investor
or operator language.

The contract exists to prevent ontology drift. AEQI should not describe itself
as four primitives in one file, five primitives in another, and a company tool
somewhere else. The product root is the TRUST. Everything else is an operating
surface inside that TRUST.

## Product Root

| Term        | Meaning                                                                                                                                                    | Rule                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **TRUST**   | The programmable value-creation vehicle where direction, execution, memory, authority, treasury, governance, and ownership live in one operating context.  | Use as the product root in public and operator-facing language.                                                                    |
| **Company** | A familiar explanation for a TRUST-shaped operating organization, and an API-adjacent entity type where older contracts still use company/entity language. | Use when explaining a business wrapper or preserving existing API semantics. Do not let it compete with TRUST as the product root. |
| **Entity**  | The internal/runtime identity record that can represent a TRUST, human, agent, fund, or other institution.                                                 | Use in data-model and API docs when precision matters.                                                                             |

Canonical user gesture:

```text
Start a TRUST.
Give it a mission.
AEQI turns it into a running operating context.
```

## Operating Surfaces

These are first-class user and runtime surfaces inside a TRUST.

| Surface          | Meaning                                                                                                                                           | Owner of truth                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Roles**        | Authority, responsibility, scope, permissions, budgets, and human or agent occupancy.                                                             | Runtime state, role APIs, and eventually protocol authority.      |
| **Agents**       | Persistent workers that execute inside roles or delegated scopes. Agents carry identity, instructions, tools, budgets, and hierarchy.             | Runtime agent registry.                                           |
| **Quests**       | Durable units of work with assignment, status, dependencies, retries, evidence, and outcomes.                                                     | Quest store and session outcomes.                                 |
| **Ideas**        | Durable knowledge, directives, memories, decisions, procedures, skill records, and retrievable context.                                           | Idea store, idea graph, and search index.                         |
| **Events**       | Pattern, schedule, webhook, and lifecycle rules that wake the runtime and fire tool calls.                                                        | Event registry and dispatcher.                                    |
| **Sessions**     | Persistent execution and conversation traces. A session records chat, handoffs, tool calls, activity, and runtime context.                        | Session store and activity journal.                               |
| **Apps / Tools** | Capabilities a TRUST can connect, install, call, or authorize: MCP tools, integration packs, role apps, platform apps, and future plugin workers. | Tool registry, integration credentials, and app/plugin manifests. |

## Infrastructure Terms

These terms are important, but they are not product roots.

| Term             | Meaning                                                                                                                   | Rule                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Execution**    | A live run inside a session.                                                                                              | Use for runtime internals and observability.                |
| **Step**         | An internal loop boundary inside an execution.                                                                            | Use for agent loop, trace, and evidence contracts.          |
| **Activity**     | Audit log, costs, session journal, tool call records, and evidence metadata.                                              | Treat as infrastructure that supports trust and inspection. |
| **Project**      | A mission container linking people, agents, repositories, library items, quests, and outcomes.                            | Use for scoped work, not as the top-level institution.      |
| **Repository**   | A durable versioned code asset owned by a TRUST/entity.                                                                   | Use for code graph and software delivery surfaces.          |
| **Library Item** | A typed TRUST artifact or knowledge object: folder, file, note, link, idea, decision, spec, contract, image, or evidence. | Use for entity-scoped knowledge/assets.                     |

## Boundary Rules

- TRUST is the product root.
- Roles, Agents, Quests, Ideas, Events, Sessions, and Apps/Tools are the
  operating surfaces.
- Activity, executions, steps, projects, repositories, and library items are
  supporting infrastructure.
- Do not introduce new public primitives without updating this contract first.
- Do not use "Company" as a competing public product root; use it as a familiar
  explanation or where existing API/data contracts require it.
- Do not describe AEQI as a generic worker/function/trigger framework. Those
  are useful extension-plane concepts, not the public ontology.
- Do not lead public copy with on-chain ownership. Execution and operating
  truth are the wedge; ownership and treasury are depth.

## Mapping To Existing Runtime Storage

Current storage still reflects implementation history. The vocabulary contract
does not require a schema rewrite before docs can be coherent.

| Surface      | Current storage shape                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| Roles        | Runtime role tables and platform/protocol role state where present.                           |
| Agents       | `aeqi.db` agent records and agent-scoped ideas.                                               |
| Quests       | `sessions.db` quest tables and session outcomes.                                              |
| Ideas        | `aeqi.db` ideas, FTS/vector index, and idea graph edges.                                      |
| Events       | `aeqi.db` event rows and lifecycle seeds.                                                     |
| Sessions     | `sessions.db` sessions, messages, activity, runs, and journal state.                          |
| Apps / Tools | Tool registry, integration credentials, MCP tools, pack crates, and platform app credentials. |

## Decision Rule

When docs, UI, API, or strategy language disagree, use this hierarchy:

```text
TRUST
  Roles
  Agents
  Quests
  Ideas
  Events
  Sessions
  Apps / Tools
```

If a term does not fit that hierarchy, decide whether it is implementation
infrastructure, a legacy compatibility name, or a new primitive that needs a
separate design decision.
