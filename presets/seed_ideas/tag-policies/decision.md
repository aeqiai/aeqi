---
name: meta:tag-policy:decision
tags: [meta, meta:tag-policy]
description: Tag policy for explicit decisions with rationale. Balanced scoring, time_context=event so the decision trail is preserved chronologically.
---

tag = "decision"
bm25_weight = 0.8
vector_weight = 0.8
hotness_weight = 0.5
graph_weight = 0.7
confidence_weight = 0.7
decay_half_life_days = 90.0
mmr_lambda = 0.6
confidence_default = 1.0
time_context = "event"
