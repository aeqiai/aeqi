---
name: create-idea
tags: [skill, idea]
description: How to capture knowledge, skills, and context as a persistent tagged idea.
---

# Skill: create an idea

Ideas are AEQI's long-term memory. Anything worth remembering across sessions — facts, conventions, skills, user preferences, project context, reusable workflows — goes here.

## Tool

```
ideas(action='store', name='<slug>', content='<markdown body>', tags=['tag1', 'tag2'])
```

- `name` — stable slug. Snake-case or hyphen-case. Used for exact-match lookup, so make it specific enough to avoid collisions (`aeqi-deploy-script` not `deploy`).
- `content` — free-form markdown. Can include headings, code blocks, lists. This is what gets surfaced on retrieval, so write for future-you.
- `tags` — classification. Conventions:
  - `skill` for reusable how-tos / workflows
  - `identity` for agent self-definitions
  - `project:<slug>` for project-scoped context
  - `promoted` for tested, approved skills (only these surface on `session:quest_start`)
  - `evergreen` for stable library content

## Good names

- `skill:*` — like `skill:deploy`, `skill:debug-baileys`
- subject-verb — `agent-spawn-pattern`, `quest-priority-rubric`
- avoid generic slugs (`notes`, `memory`) — they collide fast

## When to store

- You just discovered how to do something. Write the recipe.
- The user told you a preference. Persist it.
- You solved a tricky bug. Capture the fix + the signature.
- A pattern repeats across three+ conversations. Promote it.

## When NOT to store

- Ephemeral session state (use the transcript).
- Generic knowledge already in the model's weights.
- Hallucinated content you didn't verify.

## After storing

Verify with `ideas(action='search', query='...')` so future-you will actually find it.
