# Agents

Agents are persistent identities stored in the database. The DB is the source of truth -- there are no agent definition files on disk.

Agent templates in subdirectories here are historical presets used during initial setup. Once spawned, all agent configuration (ideas, events, model, budget) lives in `aeqi.db`.

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
