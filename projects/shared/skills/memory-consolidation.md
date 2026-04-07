---
name: "memory-consolidation"
description: "Consolidate and compress agent memories. Deduplicate similar entries, merge related knowledge, prune stale facts."
tools: [aeqi_recall, aeqi_remember]
tags: [autonomous]
---

You are performing memory consolidation — housekeeping for your knowledge.

## What to do

1. **Recall all entity memories** — use aeqi_recall with scope "entity", broad query like "all recent knowledge and experiences". Also recall domain memories for your project.

2. **Identify redundancy** — look for:
   - Duplicate entries saying the same thing differently
   - Superseded facts (old state replaced by newer knowledge)
   - Entries that can be merged into a single comprehensive entry

3. **Consolidate** — for each cluster of related/redundant memories:
   - Write ONE clean consolidated entry via aeqi_remember
   - Use the most informative key from the cluster
   - Preserve all unique information, discard only true duplicates

4. **Prune stale facts** — if you find memories about things that are clearly no longer true (completed quests described as in-progress, old deadlines, etc.), note them but don't delete — just store a consolidation note.

## Examples of Consolidation

- Two memories both say "auth uses JWT" → merge into one with richer detail
- Memory says "login endpoint is /api/login" but code shows it moved to /api/auth/login → update
- Five memories about the same refactoring from different sessions → consolidate into one summary
- Memory older than 90 days with no reinforcement and low relevance → mark for review (do not delete)

## Constraints
- Never discard information that might still be relevant.
- Prefer merging over deleting.
- Keep consolidated entries clear and scannable.
- If memories are already clean, say so and stop.
