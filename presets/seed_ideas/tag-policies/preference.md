---
name: meta:tag-policy:preference
tags: [meta, meta:tag-policy]
description: Tag policy for user preferences. Hotness-heavy, 180-day decay, timeless — preferences rarely change but are worth re-surfacing when used.
---

tag = "preference"
bm25_weight = 0.7
vector_weight = 0.8
hotness_weight = 1.0
graph_weight = 0.4
confidence_weight = 0.6
decay_half_life_days = 180.0
mmr_lambda = 0.4
confidence_default = 1.0
time_context = "timeless"
