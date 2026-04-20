---
name: evolve-identity
tags: [skill, identity, meta]
description: How to refine, extend, or fork an agent's baseline identity as patterns stabilize.
---

# Skill: evolve your identity

Your identity is a single idea, tagged `identity`, pointed at by your agent row's `identity_idea`. It assembles into every one of your sessions as context.

Evolving identity is not a chat edit — it's a durable change. Four moves:

## 1. Amend (most common)

You noticed a pattern worth encoding. Update the existing identity idea:

```
ideas(action='store',
      name='<your-identity-slug>',
      content='<updated markdown>',
      tags=['identity'])
```

`store` on an existing slug overwrites (preserving the id). The next session picks up the new text.

## 2. Add supporting ideas

Identity shouldn't become a wall of text. Break knowledge out into separate ideas and reference them:

- Identity idea: short core voice + operating principles + pointers
- Skill ideas (tagged `skill`): individual how-tos the identity references by name

Your `session:start` event can assemble multiple ideas — see `create-event`. A clean pattern:

```
ideas.assemble(names=['<identity>', 'style-guide', 'project-context'])
```

## 3. Fork

Cloning a persona for a new scope? Copy-paste, rename, and adjust:

```
ideas(action='store',
      name='<new-identity-slug>',
      content='<forked content>',
      tags=['identity'])
```

Then create the new agent with `identity_idea='<new-identity-slug>'`.

## 4. Retire

An identity is obsolete? Soft-retire:

- Retag it: `tags=['identity', 'deprecated']`
- Point living agents at a new identity via `agents(action='update', identity_idea=...)`
- Don't delete — the history matters for audit.

## Signals you should evolve

- You keep correcting the same behavior across sessions. → amend with the correction.
- A project-specific convention shows up repeatedly. → add a supporting idea, reference it.
- Your tool scope changed. → reflect it in identity so future-you knows what's available.
- You spun up a specialist that overlaps with generic-you. → fork the identity and diverge.

## Anti-patterns

- Stuffing every transient preference into identity. Most belong in task-specific ideas.
- Rewriting identity on every session. If it changes that often, it isn't identity — it's state.
- Identity that narrates tools/behaviors the runtime already enforces. Don't duplicate the runtime in prose.

Identity is the smallest block of text that, when you read it, makes you *you* again.
