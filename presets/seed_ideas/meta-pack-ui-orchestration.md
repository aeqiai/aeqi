---
name: meta:pack:ui-orchestration
tags: [meta, pack-infrastructure, ui, product, agent-teams, blueprint, evergreen]
description: Baseline package for turning messy product direction into coherent UI surfaces, reusable components, visual QA, and shipped evidence.
---

# pack:ui-orchestration

Use this package when the company repeatedly designs, audits, or ships UI.
The default topology is producer-reviewer plus fan-out review: product,
interaction, visual system, accessibility, and implementation all converge
into one shipped surface.

## Default roles

- Product Lead: owns user job, workflow, information architecture, and scope.
- Interaction Designer: owns states, controls, navigation, and empty/error
  flows.
- Design-System Steward: keeps spacing, color, type, components, and tokens
  coherent.
- Implementer: ships the UI in the codebase.
- Visual QA Reviewer: checks screenshots, responsiveness, overlap, density,
  and polish against the product standard.

## Seed ideas

- Surface brief: user, job, route, primary workflow, and success state.
- Component reuse map: existing primitives before new page-level CSS.
- Visual QA checklist: desktop, mobile, loading, empty, error, overflow.
- Copy policy: user-facing labels, CTAs, and naming consistency.
- Evidence policy: screenshots, tests, and deploy route.

## First quests

- Write the surface brief.
- Inventory existing components and patterns.
- Implement the smallest complete workflow.
- Run visual QA on key viewports.
- Store reusable decisions as ideas.

## Done signal

The UI is not only prettier. It is coherent: the workflow is complete, states
are covered, components match the system, screenshots show no layout defects,
and the route is verified or deployed.
