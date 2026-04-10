---
name: "workflow-synthesis"
description: "Use when learning from an external source (codebase, framework, paper) to improve AEQI. Not for internal-only work."
tags: [workflow]
---

# Synthesis Workflow

A pipeline for analyzing external sources and synthesizing improvements into AEQI. Don't copy — understand, compare, extract what's genuinely better.

```
Analyze Source → Map AEQI → Gap Analysis → Prioritize → Implement → Close
```

---

## Phase 1: Analyze Source

**Before ANY comparison.** Deeply understand the external source on its own terms.

1. **Read thoroughly** — code, docs, architecture. Don't skim.
2. **Extract patterns** — what design decisions did they make? What problems do they solve? What trade-offs did they accept?
3. **Store findings** — `insights_store` with key `quest:{id}:external-analysis`
4. **Delegate deep dives** — `agents_delegate` with the researcher agent for specific subsystems

### What to Extract
- Architecture decisions and WHY (not just what)
- Novel patterns that solve real problems
- Tool interactions and coordination mechanisms
- User experience flows
- Error handling and resilience patterns

<HARD-GATE>
No comparison until the external source is understood on its own terms. Premature comparison biases toward confirming AEQI's existing approach.
</HARD-GATE>

**Terminal state:** External source analyzed, proceed to Map AEQI.

---

## Phase 2: Map AEQI

Understand AEQI's current equivalent for every pattern found.

1. **Recall existing knowledge** — `insights_recall` for each area the external source covers
2. **Search codebase** — `insights_graph` search/context for AEQI's existing implementations
3. **Map equivalences** — for each external pattern, find AEQI's corresponding mechanism (or note its absence)
4. **Store mapping** — `insights_store` with key `quest:{id}:aeqi-mapping`

### Mapping Quality
Every external pattern gets ONE of:
- **AEQI equivalent:** `{symbol/module}` — brief comparison
- **Partial equivalent:** `{what exists}` — what's missing
- **No equivalent:** what AEQI would need

**Terminal state:** Full mapping posted, proceed to Gap Analysis.

---

## Phase 3: Gap Analysis

Classify every difference. Be honest about where AEQI is ahead AND behind.

For each capability in the external source:

| Classification | Meaning | Action |
|---------------|---------|--------|
| **Already better in AEQI** | AEQI's approach is superior | Skip — don't regress |
| **Missing, valuable** | AEQI doesn't have this and should | Candidate for adoption |
| **Present but weaker** | AEQI has this but the external source does it better | Candidate for improvement |
| **Present in external, unnecessary** | Solving a problem AEQI doesn't have | Skip — don't bloat |

Store analysis: `insights_store` with key `quest:{id}:gap-analysis`

<HARD-GATE>
Don't adopt patterns just because a respected project uses them. Every adoption must solve a REAL problem in AEQI. "They have it" is not a reason. "Our users need X and this solves X" is.
</HARD-GATE>

**Terminal state:** Gap analysis classified, proceed to Prioritize.

---

## Phase 4: Prioritize

Order improvements by impact × effort. Not everything worth doing is worth doing now.

1. **Score each candidate** — high/medium/low for both impact and effort
2. **Classify by path:**
   - **Harness (Path A)** — improves Claude Code + AEQI MCP integration (hooks, primer, skills)
   - **Runtime (Path B)** — improves native agent orchestrator (agent loop, middleware, worker pool)
   - **Shared** — improves both paths (memory, graph, quest tree, tools)
3. **Prefer shared improvements** — changes that benefit both paths get priority
4. **Create implementation plan** — ordered list of changes with the appropriate workflow for each

**Terminal state:** Prioritized plan created, proceed to Implement.

---

## Phase 5: Implement

Execute the prioritized improvements using the appropriate workflow for each.

1. **Create parent quest** — `quests_create` for the synthesis effort
2. **For each improvement**, load the right workflow:
   - New capability → `aeqi_prompts` get workflow-feature
   - Restructuring existing code → `aeqi_prompts` get workflow-refactor
   - Fixing identified weakness → `aeqi_prompts` get workflow-bugfix
3. **After each improvement**, verify it integrates cleanly — no dead code, no orphaned features
4. **Store progress** — `insights_store` with key `quest:{id}:progress`

### Synthesis Discipline
- Adapt patterns to AEQI's architecture. Don't transplant foreign idioms.
- Express borrowed ideas in AEQI's existing primitives (triggers, skills, memory).
- If a pattern requires a new primitive, justify why existing primitives can't handle it.
- Every adopted pattern must have tests proving it works in AEQI's context.

**Terminal state:** All improvements implemented and verified, proceed to Close.

---

## Phase 6: Close

1. **Store learnings** — `insights_store` with:
   - What was adopted and why
   - What was rejected and why (equally valuable)
   - Architectural insights that apply beyond this specific source
2. **Close quest** — `quests_close`
3. **Update skills** — if the synthesis revealed reusable procedures, create or update skills

---

## Anti-Rationalization Table

| Excuse | Reality |
|--------|---------|
| "They're a major project, they must be doing it right" | Prestige is not evidence. Evaluate on merit. |
| "Let's just copy their approach" | Copying without understanding creates cargo-cult code. Understand WHY, then decide. |
| "AEQI already does this" | Does it do it WELL? Be honest about quality, not just presence. |
| "We should adopt everything" | Not every pattern fits. Selective adoption beats comprehensive copying. |
| "This doesn't apply to us" | Are you sure, or are you defending the status quo? Check your bias. |
| "We'll integrate it properly later" | Dead code and half-integrations are technical debt. Integrate now or don't adopt. |
