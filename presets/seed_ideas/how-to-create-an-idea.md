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

## Example

User (mid-session): "Note that `./scripts/deploy.sh` restarts both aeqi-runtime and aeqi-platform — I always forget and only restart one."

Before storing, search to avoid a duplicate:

```
ideas(action='search', query='deploy script restart runtime platform', top_k=3)
// returns nothing relevant
```

Store it:

```
ideas(action='store',
      name='aeqi-deploy-restarts-both-services',
      content='`./scripts/deploy.sh` restarts aeqi-runtime.service (:8400) **and** aeqi-platform.service (:8443). Running it is the correct way — do not restart services manually one at a time.',
      tags=['procedure', 'evergreen'])
```

Note: `fact` would be wrong here (this is a reusable how-to, not a state claim). `evergreen` because the deploy script's behavior is stable, not session-scoped.
