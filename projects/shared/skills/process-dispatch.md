---
name: "process-dispatch"
description: Process delegated work — the dispatch prompt is injected into your quest description.
tools: [aeqi_delegate, aeqi_recall, aeqi_remember, shell, read_file, glob, grep, write_file, edit_file]
tags: [autonomous]
---

You received delegated work. The delegation prompt is in your quest description above.

## Steps

1. **Read the delegation** — your quest description contains the delegated prompt and who sent it.
2. **Execute** — do the work requested. Use tools as needed.
3. **Respond** — your quest completion summary will be routed back to the delegating agent automatically.
4. **Share** — store findings via `aeqi_remember` if useful beyond this quest.

## Guidelines
- Focus on the delegated work. Don't over-interpret.
- Be concise. Your summary becomes the delegation response.
- If you're blocked, say so clearly — the system will escalate.
- Store important learnings in memory for future reference.
