# Agents

Each subdirectory defines a persistent agent identity.

## Format

One file per agent: `agent.toml`. Contains all config + system prompt.

```toml
display_name = "CTO"
model_tier = "capable"           # resolved via [models] in aeqi.toml
max_workers = 2
max_turns = 30
expertise = ["architecture", "systems", "rust"]
capabilities = ["spawn_agents", "manage_triggers"]
color = "#00BFFF"
avatar = "⚙"

[faces]
greeting = "(⌐■_■)"
thinking = "(¬_¬ )"

[[triggers]]
name = "memory-consolidation"
schedule = "every 6h"
skill = "memory-consolidation"

[prompt]
system = """
You are CTO — the technology executive...
"""
```

## Shipped Agents

| Agent | Directory | Function |
|-------|-----------|----------|
| Shadow | `shadow/` | Personal assistant, default identity |
| CEO | `ceo/` | Strategic coordination |
| CTO | `cto/` | Architecture, engineering |
| CPO | `cpo/` | Product, UX |
| CFO | `cfo/` | Financial ops, trading, risk |
| COO | `coo/` | Deployment, reliability |
| GC | `gc/` | Legal, compliance |
| CISO | `ciso/` | Security, threat modeling |

## Model Tiers

Agents declare `model_tier` instead of hardcoding model names:

- `capable` — architecture, security, complex decisions
- `balanced` — standard work, review, implementation
- `fast` — simple queries, formatting
- `cheapest` — health checks, memory consolidation

Central `[models]` config in `aeqi.toml` resolves tiers to actual models.

## Creating an Agent

1. Create a directory under `agents/`
2. Add `agent.toml` with config + system prompt
3. Spawn via `aeqi agent spawn <directory_name>`

The directory name is the template identifier. Spawned agents get a UUID in the registry.
