# AEQI Architecture Plan

## The Primitives

```
4 tables:   agents, quests, events, ideas
1 tree:     parent_id on agents
1 loop:     wake --> reap --> query --> spawn
1 database: aeqi.db (+ ideas.db for embeddings)
```

Every entity has `name` (for humans). Ideas provide instructions for the model.
Everything that happened is an activity. Everything that's known is an idea.
Everything else is a query over these four tables.

```
aeqi.db
  agents    -- the tree (name, model, workdir, budget, concurrency, parent_id)
  quests    -- work queue (name, status, agent_id, dependencies, outcomes)
  events    -- reaction rules (pattern, agent_id NULL-for-global, idea_ids JSON)
  activity  -- immutable log (type, agent_id, session_id, quest_id, content, cost)

ideas.db
  ideas     -- knowledge store (content, tags, inheritance scope, agent_id NULL-for-global, embedding)
```

### What collapses

| Old concept | Becomes |
|---|---|
| system_prompt | ideas referenced by a `session:start` event |
| shared_primer | idea on root agent, inheritance='descendants' |
| skill (TOML) | idea referenced by an event |
| agent template | ideas loaded onto agent at spawn |
| Identity struct | gone -- ideas replace persona/memory/skill_prompt/knowledge |
| triggers | events |
| insights | ideas |
| injection_mode / prompt position | gone -- events decide activation, walk order decides position |
| per-agent lifecycle events | global events (`agent_id IS NULL`), one set shared by every agent |
| prompts/skills | ideas referenced by events |
| channels | gates (Telegram, Discord, Slack bridges) |
| projects | company is the workspace, agents own workdirs |
| dispatch queue | direct delegation via delegate tool |
| agent.toml/agent.md files | DB is source of truth |
| containers/Docker | bubblewrap sandboxes |
| aeqi-cloud | aeqi-platform |

### Idea activation

Activation is event-driven. For a given agent + event pattern (e.g. `session:start`, `session:quest_start`):

1. Walk the agent ancestor chain root → ... → self
2. At each level, collect events matching the pattern (per-agent rows **and** global rows)
3. For each matched event, pull its `idea_ids` from the idea store
4. Apply each idea's inheritance: `self` ideas only fire on the owning agent, `descendants` ideas propagate to every descendant
5. Concatenate idea content in walk order; merge tool allow/deny (intersection of allows, union of denies)
6. Task-specific `idea_ids` append last, always scoped to the target agent
7. `recall` (semantic search) is a separate runtime tool, not part of static assembly

Root ideas → parent ideas → self ideas → task ideas.

### Idea entry schema

```json
{
  "content": "You are a code reviewer...",
  "tags": ["identity"],
  "inheritance": "self|descendants",
  "agent_id": "uuid-or-null-for-global",
  "tool_allow": ["shell", "file"],
  "tool_deny": ["git_push"]
}
```

### Event entry schema

```json
{
  "agent_id": "uuid-or-null-for-global",
  "name": "on_session_start",
  "pattern": "session:start",
  "idea_ids": ["idea-uuid-1", "idea-uuid-2"],
  "enabled": true,
  "system": true
}
```

---

## Invariants

- **4 primitives**: agents, ideas, quests, events
- **1 infrastructure table**: activity (audit + costs)
- **2 databases**: aeqi.db (agents, quests, events, sessions, activity) + ideas.db (ideas, embeddings, knowledge graph)
- **1 scheduler**: event-driven, global, wake --> reap --> query --> spawn
- **0 concept files on disk**: no agent.toml, no skill.toml, no identity struct, no primer injection
- `cargo clippy --workspace && cargo test --workspace` all green
