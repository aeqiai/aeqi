---
name: meta:pack:software-delivery
tags: [meta, pack-infrastructure, software, agent-teams, blueprint, evergreen]
description: Baseline software delivery package for implementation, review, documentation, and release.
---

# pack:software-delivery

Use this package when a company repeatedly ships software changes. The
default topology combines pipeline, fan-out review, and producer-reviewer
gates.

## Default roles

- Delivery Lead: owns scope, sequencing, merge discipline, and release notes.
- Product Engineer: implements the change.
- Design Engineer: handles interaction, layout, accessibility, and visual QA
  when a user interface is touched.
- Reviewer Pool: security, performance, architecture, and test reviewers can
  be called when the diff touches their domain.
- Release Steward: runs verification, deploys, records rollback, and closes
  the quest with evidence.

## Seed ideas

- Definition of done: code, tests, product behavior, and deploy evidence.
- Review lanes: architecture, security, performance, tests, accessibility.
- Handoff protocol: what the implementer must provide to reviewers.
- Rollback policy: how to revert or disable the change.

## First quests

- Scope the smallest shippable change.
- Implement in a worktree.
- Run the review lanes that match the touched surface.
- Verify, deploy, and record evidence.

## Done signal

The change is merged, deployed when required, verified by an appropriate test
or screenshot, and the quest records what changed plus rollback instructions.
