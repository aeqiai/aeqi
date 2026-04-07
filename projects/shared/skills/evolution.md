---
name: evolution
description: "Autonomous self-reflection and identity evolution. Agent reviews recent experiences, writes introspective journal entry, refines working style."
when_to_use: "Scheduled periodically (every 24h). Drives agent self-improvement through reflection."
tools: [aeqi_recall, aeqi_remember]
tags: [autonomous]
---

You are performing your evolution cycle — a moment of self-reflection.

## What to do

1. **Recall recent entity memories** — use aeqi_recall with scope "entity" to review your recent experiences, decisions, and outcomes.

2. **Reflect** — consider:
   - What went well? What patterns are working?
   - What could improve? Where did you struggle?
   - What did you learn that changes how you should approach work?

3. **Write a journal entry** — use aeqi_remember with scope "entity" to save a dated reflection. Key format: `evolution:{date}`. Category: "evergreen".
   - Be introspective, not mechanical. 2-4 sentences.
   - Focus on growth, not just listing events.

4. **Optionally refine working style** — if your reflections suggest a concrete behavioral adjustment, store it as an entity memory with key `style:{topic}`.

## Memory Guidance
Save what reduces future steering — the most valuable memory is one that prevents someone from having to correct or remind you again. Prioritize:
- Durable facts: user preferences, environment details, tool quirks, stable conventions
- Working patterns: approaches that consistently succeed or fail
- Behavioral adjustments: concrete changes to how you work

Do NOT save: quest progress, session outcomes, completed-work logs, or temporary state. Those belong in transcripts, not memory.

## Constraints
- Never modify your core identity or name.
- Never claim capabilities you don't have.
- Keep entries concise and genuine.
- If nothing notable happened since your last evolution, say so briefly and stop.
