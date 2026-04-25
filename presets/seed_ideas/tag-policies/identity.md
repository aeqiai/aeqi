---
name: meta:tag-policy:identity
tags: [meta, meta:tag-policy]
description: Tag policy for identity ideas. No decay, high authority — the smallest block of text that makes an agent itself across sessions.
---

tag = "identity"
bm25_weight = 1.0
vector_weight = 0.8
hotness_weight = 0.2
graph_weight = 0.5
confidence_weight = 1.0
decay_half_life_days = 10000.0
mmr_lambda = 0.3
confidence_default = 1.0
time_context = "timeless"
# (T1.11) Identity is the canonical "frozen-snapshot" content — by far
# the highest cache-hit rate per byte. Pinning it as a cache breakpoint
# lets Anthropic reuse the prefix on every subsequent turn.
cache_breakpoint = true
