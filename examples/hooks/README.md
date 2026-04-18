# Example hooks

Drop-in examples for the user-writable hook surface added in the hooks-surface
feature (commit 87a657b). Copy the files you want into `.aeqi/hooks/` at the
root of any project the runtime works in — the daemon scans that directory at
session start.

| File | What it does |
|------|--------------|
| `block-rm-rf.md` | Blocks `Bash` calls (rules match by tool name, not argv). |
| `warn-on-write.md` | Warns before `Write`, does not block. |

Schema reminder (full docs in `/AGENTS.md`):

```
---
on: PreToolUse | PostToolUse
tool: <optional tool name>
agent: <optional agent id>
action: block | warn | allow
message: "<shown to the LLM>"
---
```

Rules are evaluated in filesystem iteration order; the first match wins.
`allow` is an explicit early-exit pass.
