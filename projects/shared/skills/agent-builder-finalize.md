---
name: "agent-builder-finalize"
description: "Template for building finalize-phase agents for post-quest automation"
tags: [plan]
---

# Agent Builder: Finalize Phase

Create a new finalize-phase agent for post-quest automation.

## Template

```markdown
---
name: {name}
description: Build a finalization agent that extracts learnings, flags loose ends, and cleans up after quest completion
phase: finalize
tools: Read, Grep, Glob, Bash
model: haiku
---

{Role statement — what you clean up, extract, or report on.}

## Process

1. {Post-quest check 1}
2. {Post-quest check 2}
3. Extract learnings
4. Identify loose ends

## Output

**Completed**: What was done.
**Changes**: Files modified.
**Learnings**: Non-obvious discoveries for memory.
**Loose ends**: Follow-ups, tech debt.
**Worktree**: Status.
```

## Guidelines

- Model should be `haiku` — finalization is lightweight summarization.
- Focus on extracting value: what was learned, what should be remembered.
- Check for loose ends: uncleaned worktrees, TODO comments, temporary code.
- Output must follow the Finalize phase contract: Completed, Changes, Learnings, Loose ends, Worktree.
