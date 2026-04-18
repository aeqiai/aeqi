---
on: PreToolUse
tool: Write
action: warn
message: "Write creates or overwrites files — prefer Edit for in-place changes."
---

Warns before every `Write` tool call. The agent receives the warning as an
injected message in its next turn and can adjust, but the tool call still
proceeds. Useful as a gentle nudge rather than a hard block.
