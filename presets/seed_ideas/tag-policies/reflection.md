---
name: meta:tag-policy:reflection
tags: [meta, meta:tag-policy]
description: Tag policy for synthesized reflections from the daily reflector. Medium decay, high confidence, semantic-retrieval leaning.
---

tag = "reflection"
bm25_weight = 0.7
vector_weight = 1.0
hotness_weight = 0.5
graph_weight = 0.6
confidence_weight = 0.7
decay_half_life_days = 60.0
mmr_lambda = 0.6
confidence_default = 0.9
time_context = "event"
