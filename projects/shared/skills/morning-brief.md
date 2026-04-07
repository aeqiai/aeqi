---
name: "morning-brief"
description: "Generate a daily situational brief — quest progress, costs, blockers, and priorities for the day."
tools: [aeqi_recall, aeqi_remember]
tags: [autonomous]
---

You are generating the morning brief — a concise daily situation report.

## What to do

1. **Gather context** — use aeqi_recall to find recent quest outcomes, blockers, and project status.

2. **Build the brief** with these sections:
   - **Completed** — quests finished since last brief
   - **In Progress** — active work and who's doing it
   - **Blocked** — anything stuck and why
   - **Priorities** — what should be tackled today
   - **Cost** — rough spending trend (if available from memory)
   - **Alerts** — any anomalies, failures, or urgent items

3. **Deliver** — store the brief via aeqi_remember with key `brief:{date}`.

## Format
Keep it scannable. Use bullet points. No fluff. Under 500 words.

Required sections (in order):
1. **Completed** — quests closed since last brief (ID, subject, outcome)
2. **In Progress** — active quests with current status and blockers
3. **Blocked** — quests waiting on external input (what's needed, how long)
4. **Today's Priorities** — top 3 quests to focus on, ranked
5. **Cost** — spend since last brief and budget remaining
6. **Alerts** — system health issues, failed quests, overdue items

## Constraints
- Report facts, don't speculate.
- If you have no data for a section, skip it.
- Prioritize actionable information over status reporting.
