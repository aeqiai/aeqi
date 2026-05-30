---
name: meta:pack:agent-team-baselines
tags: [meta, pack-infrastructure, agent-teams, blueprint, evergreen]
description: Baseline package map for harness-style agent teams translated into aeqi primitives.
---

# pack:agent-team-baselines

This pack turns harness-style team architecture into aeqi-native starter
packages. It is a baseline map, not a mandatory org chart. Use it to decide
which reusable package should be attached to a new blueprint, role tree, or
quest workflow.

Source inspiration: revfactory/harness, especially its team architecture
patterns and sample team configurations. Adapt the ideas into aeqi primitives;
do not copy another runtime's command protocol directly.

## Pattern library

- Pipeline: analysis -> design -> build -> verify. Use for sequential work.
- Fan-out/fan-in: multiple specialists inspect the same input, then one
  operator synthesizes. Use for research, review, and due diligence.
- Expert pool: a router calls the right specialist only when needed. Use when
  inputs vary heavily.
- Producer-reviewer: one agent makes the artifact, another checks it against
  a rubric. Use when objective quality gates exist.
- Supervisor: one lead manages a dynamic task queue. Use for migrations,
  audits, bulk cleanup, or many similar tasks.
- Shallow hierarchy: domain leads own related agents. Use only when the
  Director can understand and inspect the tree.

## Baseline package set

- `meta:pack:deep-research` for multi-source research and synthesis.
- `meta:pack:software-delivery` for product implementation, review, docs,
  release, and regression testing.
- `meta:pack:content-campaign` for content planning, scripts, thumbnails,
  distribution, and A/B learning.
- `meta:pack:data-operations` for schema, ETL, validation, monitoring, and
  incident follow-up.

## Packaging rules

- Put the package contract in an idea before hiring agents.
- Give every agent a role, input, output, handoff, and failure behavior.
- Use quests for the work graph; do not manage long work only in chat.
- Use events sparingly for context loading, cadence, and review.
- Keep one owner responsible for synthesis so parallel work converges.
