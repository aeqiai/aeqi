---
name: meta:tag-policy:fact
tags: [meta, meta:tag-policy]
description: Tag policy for state-of-the-world facts. BM25-heavy, 30-day decay, time_context=state so older facts are naturally superseded.
---

tag = "fact"
bm25_weight = 1.0
vector_weight = 0.6
hotness_weight = 0.3
graph_weight = 0.4
confidence_weight = 0.5
decay_half_life_days = 30.0
mmr_lambda = 0.5
confidence_default = 0.8
time_context = "state"
