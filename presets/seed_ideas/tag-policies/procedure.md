---
name: meta:tag-policy:procedure
tags: [meta, meta:tag-policy]
description: Tag policy for reusable how-tos and recipes. BM25-heavy for exact-match command recall, timeless, long decay.
---

tag = "procedure"
bm25_weight = 1.2
vector_weight = 0.6
hotness_weight = 0.4
graph_weight = 0.5
confidence_weight = 0.5
decay_half_life_days = 365.0
mmr_lambda = 0.5
confidence_default = 0.9
time_context = "timeless"
