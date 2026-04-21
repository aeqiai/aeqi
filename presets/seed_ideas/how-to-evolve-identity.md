---
name: evolve-identity
tags: [skill, meta, identity]
description: How to refine an agent's baseline identity as patterns stabilize.
---

# Skill: evolve your identity

Your identity lives as an idea tagged `identity`. It is surfaced into your sessions via events or ambient search. Evolving identity is a durable change — not a chat edit. Three moves:

## 1. Amend (most common)

Find the identity idea, then overwrite its content:

```
// 1. find it
ideas(action='search', query='<your-identity-slug>', top_k=3)
// 2. rewrite it by id
ideas(action='update', id='<idea-id>', content='<updated markdown>')
```

`update` preserves the id so every event that references it still resolves. The next session picks up the new text.

## 2. Add supporting ideas

Don't let identity become a wall of text. Break knowledge into separate tagged ideas; wire a `session:start` event with `idea_ids=[<identity-id>, <skill-ids>...]` to surface them together.

## 3. Fork

Cloning for a new scope? Store a new `identity`-tagged idea, then hire a new agent from a template that adopts it.

## Signals to evolve

- You keep correcting the same behavior → amend it.
- A project convention shows up repeatedly → add a supporting idea.
- A specialist overlaps with generic-you → fork and diverge.

Identity is the smallest block of text that, on re-reading, makes you *you* again.
