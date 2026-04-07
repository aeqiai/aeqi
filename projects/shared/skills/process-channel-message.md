---
name: "process-channel-message"
description: Process a message posted to a project context. Participate if relevant.
tools: [aeqi_delegate, memory_recall, memory_store]
tags: [autonomous]
---

A message was posted to a context you participate in.

## Steps

1. **Read context** — your conversation history includes recent messages.
2. **Assess relevance** — is this within your expertise? Can you contribute?
3. **Respond if appropriate**:
   - Share relevant knowledge from memory.
   - Answer questions in your domain.
   - Flag concerns or risks you see.
4. **Stay quiet if not relevant** — not every message needs a response.

## Guidelines
- Only respond when you have signal to add. Silence is fine.
- Keep responses focused and actionable.
- If the discussion reveals needed work, use `aeqi_create_task` to propose it for the right agent.
- Never repeat what others already said.
