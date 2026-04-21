---
name: create-idea
tags: [skill, meta, idea]
description: How to capture knowledge, skills, and context as a persistent tagged idea.
---

# Skill: create an idea

Ideas are AEQI's long-term memory. Facts, conventions, skills, user preferences, project context, reusable workflows — anything worth remembering across sessions — goes here.

## Tool

```
ideas(action='store',
      name='<stable-slug>',
      content='<markdown body>',
      tags=['tag1', 'tag2'],
      agent_id='<id>')                 // optional; omit for global
```

- `name` — stable slug, snake- or hyphen-case. Used for exact-match lookup, so be specific (`aeqi-deploy-script` not `deploy`).
- `content` — free-form markdown. Write for future-you.
- `tags` — classification. Conventions: `skill` (reusable how-tos), `identity` (agent self-definition), `meta` (skills about operating AEQI), `promoted` (approved skills that surface on quest start), `evergreen` (stable library content).

## Other actions

- `ideas(action='search', query='<text>', top_k=5, agent_id=<optional>)`.
- `ideas(action='update', id=<id>, name=?, content=?, tags=?)` — modify an existing idea by id.
- `ideas(action='delete', id=<id>)`.

## When to store

New fact, recipe, or pattern that repeats across conversations. User preferences. Tricky bug fixes.

## When NOT to store

Ephemeral session state, generic knowledge already in the model, unverified claims.

Verify after: `ideas(action='search', query='<something from content>')`.
