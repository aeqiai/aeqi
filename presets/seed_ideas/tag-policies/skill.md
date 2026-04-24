---
name: meta:tag-policy:skill
tags: [meta, meta:tag-policy]
description: Tag policy for promoted skills. Always-on priority; effectively zero decay because skills are the agent's operating manual.
---

tag = "skill"
bm25_weight = 1.0
vector_weight = 0.8
hotness_weight = 0.3
graph_weight = 0.4
confidence_weight = 0.8
decay_half_life_days = 10000.0
mmr_lambda = 0.4
confidence_default = 1.0
time_context = "timeless"
