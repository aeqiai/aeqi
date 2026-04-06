---
name: "workflow-feature"
description: "Use when implementing a new feature, component, or multi-file change. Not for single-line fixes or research."
tags: [workflow]
---

# Feature Workflow

A structured pipeline for implementing features. Each phase has exactly ONE successor. No skipping phases.

```
Brainstorm → Plan → Implement → Review → Finish
```

---

## Phase 1: Brainstorm

**Before ANY implementation.** Understand what you're building.

1. **Recall context** — `aeqi_recall` for prior decisions about this area
2. **Explore codebase** — read relevant files, `aeqi_graph` search/context for related symbols and impact
3. **Ask clarifying questions** — ONE at a time, prefer concrete options over open-ended questions
4. **Propose approach** — 2-3 options with trade-offs and your recommendation
5. **Get approval** — do NOT proceed without explicit user agreement

<HARD-GATE>
No implementation until the approach is approved. Not "probably fine." Not "seems reasonable." Explicitly approved.
</HARD-GATE>

**Terminal state:** Store approved approach via `aeqi_remember` (key: `quest:{id}:approach`), proceed to Plan.

---

## Phase 2: Plan

Break the approved approach into bite-sized quests.

1. **Create parent quest** — `aeqi_create_task` with the feature description
2. **Map file structure** — `aeqi_graph` context/impact to understand what files need changing and their relationships
3. **Decompose into quests** — each quest is ONE action (2-5 minutes of work). Include:
   - Exact file paths
   - What to change and why
   - Expected test command and output
4. **Store plan in memory** — `aeqi_remember` with key `quest:{id}:plan`

### Plan Quality Checklist
- [ ] Every quest has exact file paths (no "the relevant files")
- [ ] Every quest has a verification step (test command + expected output)
- [ ] No quest depends on another quest's uncommitted changes
- [ ] No "TBD", "TODO", "as appropriate", or "similar to Quest N"

**Terminal state:** Plan stored in memory, proceed to Implement.

---

## Phase 3: Implement

Execute the plan quest by quest.

### Per-Quest Workflow

1. **Delegate to implementer** — `aeqi_delegate` with the implementer agent, spawn subagent with FULL quest context pasted inline (never file references)

2. **Handle implementer status:**
   - **DONE** → proceed to review
   - **DONE_WITH_CONCERNS** → read concerns, decide if acceptable or needs rework
   - **NEEDS_CONTEXT** → provide missing context, re-delegate
   - **BLOCKED** → respect it. Break the quest smaller or escalate to user.

3. **Two-stage review** (NEVER reverse this order):
   - **Stage 1: Spec review** — does the change match what was planned?
   - **Stage 2: Quality review** — is the code well-written?

   No point polishing code that doesn't meet spec. Spec first, always.

4. **Mark quest complete** — only after both review stages pass

### 3-Fix Escalation Rule
If 3 fix attempts for the same issue fail: **STOP.** Don't attempt fix #4. Question the architecture. The approach is wrong, not the execution.

**Terminal state:** All quests implemented and reviewed, proceed to Review.

---

## Phase 4: Final Review

Full-scope review of the entire implementation.

1. **Delegate final review** — `aeqi_delegate` with the reviewer agent, checks ALL changes against the original plan
2. **Recall findings** — `aeqi_recall` for the reviewer's stored findings
3. **Handle review result:**
   - **Approved** → proceed to Finish
   - **Issues found** → fix issues, re-review (but respect the 3-fix rule)

### Verification Gate (MANDATORY before claiming complete)

1. **IDENTIFY** — what command proves this works?
2. **RUN** — execute it (full, fresh, no shortcuts)
3. **READ** — check the FULL output and exit code
4. **VERIFY** — does the output confirm success?
5. **ONLY THEN** — claim completion

<HARD-GATE>
Claiming completion without running verification is dishonesty, not efficiency.
If you're thinking "it should work" or "tests probably pass" — you haven't verified. Run it.
</HARD-GATE>

**Terminal state:** Verified and approved, proceed to Finish.

---

## Phase 5: Finish

1. **Commit** with a clear message describing what and why
2. **Store learnings** — `aeqi_remember` anything non-obvious discovered during implementation
3. **Close quest** — `aeqi_close_task`
4. **Consider skill creation** — was this workflow complex enough to codify as a reusable skill?

---

## Anti-Rationalization Table

| Excuse | Reality |
|--------|---------|
| "This is simple enough to skip brainstorming" | Simple changes don't need long brainstorming, but they still need a clear approach before implementation |
| "I'll write tests after" | Write the test first. If you wrote code first, delete it and start with the test. |
| "The plan is obvious, no need to write it down" | If it's obvious, writing it takes 30 seconds. If it's not, you need the plan. |
| "One review stage is enough" | Spec review and quality review catch different problems. Skipping one means missing a class of issues. |
| "I'll verify at the end" | Verify after EACH quest. Bugs compound. Finding them early is 10x cheaper. |
| "Tests pass so it works" | Tests passing means tests pass. Not that the feature works. Run it. |
| "The subagent said it's done" | Don't trust the report. Verify independently. |
| "I'm almost done, just one more thing" | "Almost done" is the most dangerous state. Stop. Verify what you have. |
