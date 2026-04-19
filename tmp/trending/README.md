# Trending Repos Research — 2026-04-19

External research sweep: Claude-Code-adjacent / agent-stack repos. Shallow clones at `/home/claudedev/aeqi/tmp/trending/`.

---

## Repos Cloned

| Name | URL | Commit | Notes |
|------|-----|--------|-------|
| llm-wiki | https://github.com/ekadetov/llm-wiki | 5e49545 | Karpathy LLM Wiki pattern for Claude Code |
| hermes-agent | https://github.com/NousResearch/hermes-agent | db59c19 | 90k+ stars, self-improving agent |
| opencode | https://github.com/sst/opencode | 1d54b0e | 140k+ stars, open-source Claude Code alternative |
| superpowers | https://github.com/obra/superpowers | b557648 | Zero-dep composable skills methodology |
| claudecodelearn | https://github.com/shareAI-lab/learn-claude-code | 4b95969 | Harness engineering pedagogy |
| agentic-stack | https://github.com/codejunkie99/agentic-stack | 2ea3a0e | Portable .agent/ brain, 8 harness adapters |

**Not found / failed:** None — all 6 cloned successfully.

---

## Ideas Stored (MCP via REST)

| Idea Key | MCP ID | Core Insight |
|----------|--------|--------------|
| external/llm-wiki-immutable-raw-layer | d0df9302-06f7-422c-8d86-67911bff6cce | Raw vs compiled split: raw observations are immutable; agents compile them into ideas on demand |
| external/hermes-closed-learning-loop | f5afcbae-f950-41ce-987b-32859c41fd40 | Auto-promote quest tool-call traces into candidate skills; close the learning loop |
| external/opencode-quest-session-decoupling | ff24544b-83dc-427b-ae20-cd9910874f4f | Quest execution should outlive the session; client reconnects to a running worktree |
| external/superpowers-skills-are-code-not-prose | 3513264b-0f98-4987-b023-3ce7d1ecbedc | Skills need adversarial eval gates before promotion; compliance rewrites degrade behavior |
| external/claudecodelearn-harness-model-separation | 50e28316-2ef0-443c-b5ae-86df46d88a8f | Harness = Tools+Knowledge+Observation+Action+Permissions; trace every execution as training signal |
| external/agentic-stack-staged-lesson-review | 6ed33951-3bc8-46c6-958e-d70290c7a8ae | Stage candidate skills for human review; rejected entries retain rationale to catch recurring churn |

---

## Distillation Summary

**llm-wiki** — The raw/compiled split is the key architectural gift. AEQI should never let agents mutate raw ingestion. Ideas are compiled output, not raw input.

**hermes-agent** — The closed learning loop (task → skill promotion → search recall) is the most impactful structural pattern missing from AEQI. Hermes proves it works at scale (90k stars).

**opencode** — Quest execution should be a persistent server process, not a session-scoped child. The client/server split makes autonomous long-running quests possible.

**superpowers** — Skills are behavior-shaping code. The 94% PR rejection rate is a lesson: agent-generated "improvements" to skill prompts are usually regressions. Require eval evidence.

**claudecodelearn** — Validates AEQI's primitive mapping (Tools/Knowledge/Observation/Action/Permissions) is complete. Reminds us execution traces are training signal — persist them.

**agentic-stack** — The staged review protocol (stage → human rationale → graduate/reject) is the missing governance layer for AEQI skill promotion. Rejected entries with rationale prevent churn.

---

## Convergent Theme

Three of the six repos independently arrive at the same pattern: **skills should be auto-discovered from task execution, staged for human review, and only promoted after evidence of generalization.** This is the highest-confidence architectural signal from this sweep.
