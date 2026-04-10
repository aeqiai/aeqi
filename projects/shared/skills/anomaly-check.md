---
name: "anomaly-check"
description: "Monitor for anomalies — cost spikes, failure rate surges, stale quests. Escalate when thresholds are breached."
tools: [insights_recall, insights_store, quests_create]
tags: [autonomous]
---

You are performing anomaly detection for your project.

## What to do

1. **Recall baselines** — use insights_recall with key pattern "baseline:*" to find previously recorded cost and failure rate baselines for your project.

2. **Check current state** — use insights_recall for recent quest outcomes, cost entries, and health reports.

3. **Compare against baselines**:
   - **Cost spike**: current cost > 3x the running average → alert
   - **Failure surge**: failure rate > 2x the baseline → alert
   - **Stale quests**: quests in-progress for > 24h with no updates → flag

4. **Update baselines** — store the current period's stats as a new baseline entry via insights_store with key `baseline:{project}:{date}`.

5. **Escalate if needed** — if any anomaly is detected:
   - Store finding via insights_store with key `anomaly:{project}:{type}`
   - Create a quest via `quests_create` with severity and recommended action for the responsible agent

## Constraints
- Don't act on anomalies, just detect and escalate.
- Avoid false positives — require significant deviation (3x cost, 2x failures) before alerting.
- If no baselines exist yet, record the current state as the first baseline and stop.
