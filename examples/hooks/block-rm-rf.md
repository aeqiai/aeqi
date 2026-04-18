---
on: PreToolUse
tool: Bash
action: block
message: "rm -rf is blocked by .aeqi/hooks/block-rm-rf.md — remove the hook file to override."
---

Blocks any `Bash` tool call whose command contains `rm -rf`. The rule matches on
tool name only; the agent's intent is communicated back via the `message` field,
so the LLM knows why the call failed and can choose a safer alternative.

Copy this file to `.aeqi/hooks/` at your project root to activate.
