---
name: meta:pack:deep-research
tags: [meta, pack-infrastructure, research, agent-teams, blueprint, evergreen]
description: Baseline deep-research package using fan-out/fan-in investigation and synthesis.
---

# pack:deep-research

Use this package when a Director needs a decision-quality research brief from
multiple evidence types. The default topology is fan-out/fan-in: independent
research lanes first, synthesis second.

## Default roles

- Research Lead: owns scope, questions, source standards, synthesis, and
  final recommendation.
- Official Researcher: reads first-party docs, filings, changelogs, and
  primary statements.
- Market Researcher: reads media, analyst notes, funding, competitors, and
  adjacent products.
- Community Researcher: reads forums, social channels, reviews, complaints,
  and user language.
- Skeptic Reviewer: challenges claims, flags weak evidence, and checks
  whether conclusions overreach.

## Seed ideas

- Research question and decision context.
- Source policy: primary sources first, dates visible, uncertainty explicit.
- Contradiction log: claims that disagree and how they were resolved.
- Evidence rubric: source quality, recency, independence, and relevance.

## First quests

- Define research question and decision owner.
- Collect lane reports.
- Merge findings into one brief with recommendations and open risks.
- Review the brief against the evidence rubric.

## Done signal

The Director can read one brief and see the question, answer, evidence,
contradictions, confidence, open risks, and the next decision.
