---
name: meta:tag-policy:evergreen
tags: [meta, meta:tag-policy]
description: Tag policy for evergreen content. Pinned — effectively zero decay. Use for facts and decisions that have proven stable across many sessions.
---

tag = "evergreen"
bm25_weight = 1.0
vector_weight = 0.8
hotness_weight = 0.2
graph_weight = 0.5
confidence_weight = 0.8
decay_half_life_days = 10000.0
mmr_lambda = 0.5
confidence_default = 1.0
time_context = "timeless"
# (T1.11) Evergreen content is stable across sessions — a natural cache
# breakpoint. Pinning it lets Anthropic reuse the prefix on every
# subsequent turn while non-evergreen segments remain volatile.
cache_breakpoint = true
