---
name: meta:pack:data-operations
tags: [meta, pack-infrastructure, data, agent-teams, blueprint, evergreen]
description: Baseline data operations package for schema, ETL, validation, monitoring, and incident follow-up.
---

# pack:data-operations

Use this package when a company repeatedly ingests, transforms, validates, or
reports data. The default topology is pipeline plus supervisor: design the
pipeline, divide implementation work, then monitor and improve it.

## Default roles

- Data Lead: owns domain model, quality thresholds, and stakeholder contract.
- Schema Designer: defines entities, keys, retention, and compatibility.
- Pipeline Builder: implements extraction, transform, load, and backfill.
- Validation Engineer: writes checks for freshness, completeness, uniqueness,
  ranges, and referential integrity.
- Monitor Operator: owns alerts, runbooks, dashboards, and incident review.

## Seed ideas

- Data contract: source, owner, consumer, SLA, fields, and failure behavior.
- Schema change policy: compatibility, migrations, and rollback.
- Validation rubric: what must be true before data is trusted.
- Incident log: failure, detection, impact, fix, prevention.

## First quests

- Define the data contract.
- Build the first pipeline slice.
- Add validation and a monitor.
- Run backfill or dry run.
- Document the incident path before production use.

## Done signal

A consumer can trust the dataset because source, schema, checks, monitor,
ownership, and recovery path are explicit.
