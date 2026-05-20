# Agents

Agents are persistent identities stored in the database. The DB is the source of
truth for a running runtime.

Agent files under `agents/<name>/agent.md` are bootstrap templates. `aeqi setup`
and discovery can seed runtime state from them, but once an agent is spawned,
its live configuration, ideas, events, model, and budget live in `aeqi.db`.

## Agent Tree

Agents form a hierarchy via `parent_id`. Configuration (model, budget, workdir, timeout) inherits from parent to child. Override at any node.

## Managing Agents

```bash
aeqi agent list               # show all agents
aeqi agent show <name>        # show agent details
aeqi agent retire <name>      # deactivate (preserves ideas)
aeqi agent activate <name>    # reactivate
```

Agents spawn children at runtime through the delegate tool or via the API.
