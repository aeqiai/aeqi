---
name: meta:tag-policy:source:session
tags: [meta, meta:tag-policy]
description: Tag policy for raw per-session extractions. Short decay (7d) and automatic consolidation so the long tail stays compressed.
---

tag = "source:session"
bm25_weight = 0.8
vector_weight = 0.7
hotness_weight = 0.4
graph_weight = 0.4
confidence_weight = 0.4
decay_half_life_days = 7.0
mmr_lambda = 0.5
confidence_default = 0.8
time_context = "event"

[consolidate_when]
count = 10
age_hours = 168
consolidator_idea = "meta:consolidator-template"
