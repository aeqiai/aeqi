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
  events    -- reaction rules (pattern, scope, agent_id, idea reference)
  activity  -- immutable log (type, agent_id, session_id, quest_id, content, cost)

ideas.db
  ideas     -- knowledge store (content, scope, entity_id, injection_mode, embedding)
```

### What collapses

| Old concept | Becomes |
|---|---|
| system_prompt | idea with injection_mode='system' |
| shared_primer | idea on root agent, scope='descendants' |
| skill (TOML) | idea with injection_mode, referenced by event |
| agent template | ideas loaded onto agent at spawn |
| Identity struct | gone -- ideas replace persona/memory/skill_prompt/knowledge |
| triggers | events |
| insights | ideas |
| prompts/skills | ideas with injection_mode |
| channels | gates (Telegram, Discord, Slack bridges) |
| projects | company is the workspace, agents own workdirs |
| dispatch queue | direct delegation via delegate tool |
| agent.toml/agent.md files | DB is source of truth |
| containers/Docker | bubblewrap sandboxes |
| aeqi-cloud | aeqi-platform |

### Idea activation

One query resolves all active ideas for any agent + quest combination:

1. Walk agent ancestors, collect ideas with scope='descendants'
2. Collect agent's own ideas with injection_mode set
3. Add ideas referenced by the firing event
4. Semantic search for recalled ideas relevant to the quest context
5. Merge tool restrictions from idea metadata

Root ideas --> parent ideas --> self ideas --> event-activated ideas --> recalled ideas.

### Idea entry schema

```json
{
  "content": "You are a code reviewer...",
  "injection_mode": "system|prepend|append|null",
  "scope": "self|descendants",
  "tools": { "allow": ["shell", "file"], "deny": ["git_push"] }
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
