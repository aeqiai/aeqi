//! Staged retrieval pipeline: tag-routed BM25 + vector, component mixing,
//! MMR diversification, temporal filtering, access recording, and
//! co-retrieval reinforcement.
//!
//! The previous flat scorer was RRF-merged and applied a single set of
//! weights. The new pipeline runs per tag — each tag's policy picks its
//! own bm25/vector/hotness/graph/confidence/decay weights — then merges
//! across tags with a weighted sum, deduping by id and keeping the
//! winning tag on the hit's [`Why`] record.
//!
//! Execution shape:
//! 1. Plan — resolve tags from the query. Explicit `query.tags` is a
//!    hard filter; empty means "route by every tag observed in the
//!    corpus, weighted by their default policy".
//! 2. Per-tag retrieve — BM25 (tag-filtered) + vector (tag-filtered) at
//!    `top_k*3` width so diversification downstream has headroom.
//! 3. Cross-tag merge — dedupe by id, keep max final score, record
//!    `picked_by_tag`.
//! 4. MMR — diversify using real cosine over loaded embeddings (Jaccard
//!    tag overlap fallback when embeddings are absent).
//! 5. Temporal filter — bi-temporal-aware; non-timeless rows must satisfy
//!    `valid_from <= as_of AND (valid_until IS NULL OR valid_until > as_of)`.
//!    Plain `search` uses `as_of = now`.
//! 6. Record access + strengthen co-retrieval — both fire-and-forget on a
//!    secondary tokio task so they don't block the return.
//! 7. Wrap each hit with a fully-populated [`Why`] for explainability.
//!
//! Default WHERE: `status='active'` + excludes rows that are sources of
//! any `supersedes` edge. `query.include_superseded = true` bypasses both.

use super::SqliteIdeas;
use crate::hybrid::mmr_rerank;
use crate::sqlite::tags::tag_set_jaccard;
use crate::tag_policy::{TagPolicy, TagPolicyCache};
use crate::tag_ranker::TagRanker;
use crate::vector::{bytes_to_vec, cosine_similarity};
use aeqi_core::traits::{AccessContext, Idea, IdeaQuery, SearchHit, Why};
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::Arc;
use tracing::warn;

/// Internal scored-candidate view used across the stages.
#[derive(Clone, Debug)]
struct StagedHit {
    id: String,
    bm25: f32,
    vector: f32,
    hotness: f32,
    graph: f32,
    confidence: f32,
    decay: f32,
    final_score: f32,
    picked_by_tag: String,
}

impl SqliteIdeas {
    // ── Stage 1: plan ──────────────────────────────────────────────────

    /// Resolve the set of tags to route this query across.
    ///
    /// Explicit `query.tags` is a hard filter — exactly those tags become
    /// the plan. An empty tag list falls back to the observed tags in the
    /// corpus (capped at a small number to keep per-query fanout bounded).
    async fn plan_tags(
        &self,
        query: &IdeaQuery,
        policies: Option<&TagPolicyCache>,
    ) -> Result<Vec<TagPolicy>> {
        if !query.tags.is_empty() {
            return Ok(query
                .tags
                .iter()
                .map(|t| resolve_policy(policies, t))
                .collect());
        }

        // Route by all tags observed in the corpus, weighted by their
        // default policies. Cap at 6 tags to bound per-query fanout — the
        // cross-tag merge downstream will re-rank across them.
        let observed = self
            .blocking(|conn| {
                let mut stmt = conn.prepare(
                    "SELECT tag, COUNT(*) as n FROM idea_tags \
                     GROUP BY tag ORDER BY n DESC LIMIT 6",
                )?;
                let tags: Vec<String> = stmt
                    .query_map([], |row| row.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                Ok(tags)
            })
            .await
            .unwrap_or_default();

        if observed.is_empty() {
            // No tags in the DB yet — fall back to a single "fact" policy
            // so the pipeline has something to route through.
            return Ok(vec![resolve_policy(policies, "fact")]);
        }
        Ok(observed
            .into_iter()
            .map(|t| resolve_policy(policies, &t))
            .collect())
    }

    // ── Stage 2: per-tag retrieve ──────────────────────────────────────

    /// BM25 search filtered to rows that carry `tag`. Otherwise identical
    /// to the legacy BM25 path: FTS5 against `ideas_fts`, visibility +
    /// expiry filters, column weights favouring `name` over `content`.
    fn bm25_search_filtered(
        conn: &Connection,
        query: &IdeaQuery,
        tag: &str,
        limit: usize,
    ) -> Result<Vec<(String, f32)>> {
        let fts_query = build_fts_query(&query.text);

        let mut conditions: Vec<String> = vec![
            "ideas_fts MATCH ?1".into(),
            "EXISTS(SELECT 1 FROM idea_tags it WHERE it.idea_id = m.id AND LOWER(it.tag) = ?2)"
                .into(),
        ];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> =
            vec![Box::new(fts_query), Box::new(tag.to_lowercase())];
        let mut idx = 3usize;

        let now = Utc::now().to_rfc3339();
        conditions.push(format!("(m.expires_at IS NULL OR m.expires_at > ?{idx})"));
        params.push(Box::new(now));
        idx += 1;

        if !query.include_superseded {
            conditions.push("m.status = 'active'".into());
            conditions.push(
                "NOT EXISTS(SELECT 1 FROM idea_edges se WHERE se.source_id = m.id \
                 AND se.relation = 'supersedes')"
                    .into(),
            );
        }

        apply_scope_clause(query, &mut conditions, &mut params, &mut idx);

        let where_clause = conditions.join(" AND ");
        let sql = format!(
            "SELECT m.id, bm25(ideas_fts, 5, 1) as rank \
             FROM ideas_fts f JOIN ideas m ON m.rowid = f.rowid \
             WHERE {where_clause} ORDER BY rank LIMIT ?{idx}"
        );
        params.push(Box::new(limit as i64));

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let rows: Vec<(String, f32)> = stmt
            .query_map(param_refs.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)? as f32))
            })?
            .filter_map(|r| r.ok())
            // FTS5 bm25() returns negative scores — lower is better. Flip so
            // downstream weighted-sum merging treats higher as better.
            .map(|(id, raw)| (id, -raw))
            .collect();
        Ok(rows)
    }

    /// Vector search filtered to rows that carry `tag`. Brute-force cosine
    /// over all stored vectors for now; ANN wiring (Agent N) replaces the
    /// inner SELECT with `idea_vec` MATCH when available.
    fn vector_search_filtered(
        conn: &Connection,
        query_vec: &[f32],
        query: &IdeaQuery,
        tag: &str,
        limit: usize,
    ) -> Vec<(String, f32)> {
        let mut conditions: Vec<String> = vec![
            "EXISTS(SELECT 1 FROM idea_tags it WHERE it.idea_id = m.id AND LOWER(it.tag) = ?1)"
                .into(),
        ];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(tag.to_lowercase())];
        let mut idx = 2usize;

        if !query.include_superseded {
            conditions.push("m.status = 'active'".into());
            conditions.push(
                "NOT EXISTS(SELECT 1 FROM idea_edges se WHERE se.source_id = m.id \
                 AND se.relation = 'supersedes')"
                    .into(),
            );
        }

        apply_scope_clause(query, &mut conditions, &mut params, &mut idx);

        let where_clause = conditions.join(" AND ");
        let sql = format!(
            "SELECT me.idea_id, me.embedding FROM idea_embeddings me \
             JOIN ideas m ON m.id = me.idea_id WHERE {where_clause}"
        );
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return vec![];
        };
        let mut results: Vec<(String, f32)> = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mid: String = row.get(0)?;
                let bytes: Vec<u8> = row.get(1)?;
                Ok((mid, bytes))
            })
            .map(|iter| {
                iter.filter_map(|r| r.ok())
                    .map(|(mid, bytes)| (mid, cosine_similarity(query_vec, &bytes_to_vec(&bytes))))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(limit);
        results
    }

    // ── Pipeline entry — search_explained ──────────────────────────────

    /// Staged retrieval returning fully-explained [`SearchHit`]s.
    pub async fn search_explained_impl(
        &self,
        query: &IdeaQuery,
        policies: Option<Arc<TagPolicyCache>>,
    ) -> Result<Vec<SearchHit>> {
        let top_k = query.top_k.max(1);

        // Phase A: embed the query once, async, no lock.
        let query_embedding: Option<Vec<f32>> = if let Some(ref embedder) = self.embedder {
            match embedder.embed(&query.text).await {
                Ok(emb) => Some(emb),
                Err(e) => {
                    warn!("query embedding failed, BM25-only: {e}");
                    None
                }
            }
        } else {
            None
        };

        // Phase B: plan the tag set.
        let rankers: Vec<TagRanker> = self
            .plan_tags(query, policies.as_deref())
            .await?
            .into_iter()
            .map(TagRanker::from_policy)
            .collect();

        // Phase C: synchronous DB work → per-tag retrieve + merge + MMR.
        let this = self.clone();
        let query_owned = query.clone();
        let rankers_owned = rankers;
        let hits = tokio::task::spawn_blocking(move || -> Result<Vec<StagedHit>> {
            this.run_staged_pipeline(&query_owned, query_embedding.as_deref(), &rankers_owned, top_k)
        })
        .await
        .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))??;

        // Phase D: hydrate ideas + tags for each hit id.
        let ids: Vec<String> = hits.iter().map(|h| h.id.clone()).collect();
        let ideas = self.get_by_ids_impl(&ids).await.unwrap_or_default();
        let idea_map: HashMap<String, Idea> = ideas.into_iter().map(|i| (i.id.clone(), i)).collect();

        // Phase E: fire-and-forget access recording + co-retrieval reinforcement.
        let top_ids: Vec<String> = hits.iter().take(10).map(|h| h.id.clone()).collect();
        let top_ids_for_access: Vec<String> = top_ids.clone();
        let query_hash = stable_hash(&query.text);
        let agent_id_for_access = query.agent_id.clone();
        let session_id_for_access = query.session_id.clone();
        let this_access = self.clone();
        tokio::spawn(async move {
            for (pos, id) in top_ids_for_access.iter().enumerate() {
                let ctx = AccessContext {
                    agent_id: agent_id_for_access.clone(),
                    session_id: session_id_for_access.clone(),
                    context: "search".to_string(),
                    result_position: Some(pos as i32),
                    query_hash: Some(query_hash.clone()),
                };
                if let Err(e) = this_access.record_access_impl(id, ctx).await {
                    warn!(idea = %id, err = %e, "record_access failed");
                }
            }
        });
        let this_edges = self.clone();
        let top_ids_owned = top_ids;
        tokio::spawn(async move {
            let this = this_edges.clone();
            let r = tokio::task::spawn_blocking(move || {
                let refs: Vec<&str> = top_ids_owned.iter().map(|s| s.as_str()).collect();
                this.strengthen_co_retrieval(&refs)
            })
            .await;
            if let Ok(Err(e)) = r {
                warn!(err = %e, "strengthen_co_retrieval failed");
            }
        });

        // Phase F: build SearchHits.
        let mut out = Vec::with_capacity(hits.len());
        for h in hits {
            let mut idea = match idea_map.get(&h.id) {
                Some(i) => i.clone(),
                None => continue,
            };
            idea.score = h.final_score as f64;
            out.push(SearchHit {
                idea,
                why: Why {
                    picked_by_tag: Some(h.picked_by_tag),
                    bm25: h.bm25,
                    vector: h.vector,
                    hotness: h.hotness,
                    graph: h.graph,
                    confidence: h.confidence,
                    decay: h.decay,
                    final_score: h.final_score,
                },
            });
        }
        Ok(out)
    }

    /// Back-compat: the trait `search` strips `why` and returns plain
    /// [`Idea`]s. New callers go through `search_explained`.
    pub(super) async fn search_impl(&self, query: &IdeaQuery) -> Result<Vec<Idea>> {
        let hits = self.search_explained_impl(query, None).await?;
        Ok(hits.into_iter().map(|h| h.idea).collect())
    }

    /// Bi-temporal query — identical to `search_impl` plus a post-filter
    /// that keeps only ideas whose validity window covers `as_of`.
    /// `time_context='timeless'` rows always pass.
    pub(super) async fn search_as_of_impl(
        &self,
        query: &IdeaQuery,
        as_of: DateTime<Utc>,
    ) -> Result<Vec<Idea>> {
        let hits = self.search_explained_impl(query, None).await?;
        let ids: Vec<String> = hits.iter().map(|h| h.idea.id.clone()).collect();

        // Snap the validity-at-as_of filter in a single blocking trip so we
        // don't re-lock per id on the hot path.
        let metas = self
            .blocking(move |conn| {
                let placeholders: Vec<String> =
                    (0..ids.len()).map(|i| format!("?{}", i + 1)).collect();
                if ids.is_empty() {
                    return Ok(HashMap::<String, (Option<String>, Option<String>, String)>::new());
                }
                let sql = format!(
                    "SELECT id, valid_from, valid_until, time_context FROM ideas \
                     WHERE id IN ({})",
                    placeholders.join(", ")
                );
                let params: Vec<&dyn rusqlite::types::ToSql> = ids
                    .iter()
                    .map(|s| s as &dyn rusqlite::types::ToSql)
                    .collect();
                let mut stmt = conn.prepare(&sql)?;
                let map: HashMap<String, (Option<String>, Option<String>, String)> = stmt
                    .query_map(params.as_slice(), |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, Option<String>>(1)?,
                            row.get::<_, Option<String>>(2)?,
                            row.get::<_, String>(3)
                                .unwrap_or_else(|_| "timeless".to_string()),
                        ))
                    })?
                    .filter_map(|r| r.ok())
                    .map(|(id, vf, vu, tc)| (id, (vf, vu, tc)))
                    .collect();
                Ok(map)
            })
            .await?;

        let filtered = hits
            .into_iter()
            .filter(|h| match metas.get(&h.idea.id) {
                Some((vf, vu, tc)) => {
                    if tc == "timeless" {
                        return true;
                    }
                    let from_ok = vf
                        .as_deref()
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|d| d.with_timezone(&Utc) <= as_of)
                        .unwrap_or(true);
                    let to_ok = vu
                        .as_deref()
                        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                        .map(|d| d.with_timezone(&Utc) > as_of)
                        .unwrap_or(true);
                    from_ok && to_ok
                }
                None => true,
            })
            .map(|h| h.idea)
            .collect();
        Ok(filtered)
    }

    /// Synchronous guts of the pipeline. Called from spawn_blocking because
    /// it takes the SQLite mutex over multiple queries.
    fn run_staged_pipeline(
        &self,
        query: &IdeaQuery,
        query_embedding: Option<&[f32]>,
        rankers: &[TagRanker],
        top_k: usize,
    ) -> Result<Vec<StagedHit>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let per_tag_width = (top_k * 3).max(5);

        // Per-tag retrieve + local score.
        let mut by_id: HashMap<String, StagedHit> = HashMap::new();
        for ranker in rankers {
            let tag = &ranker.policy.tag;
            let bm25_list = Self::bm25_search_filtered(&conn, query, tag, per_tag_width)
                .unwrap_or_default();
            let vec_list = match query_embedding {
                Some(qv) => Self::vector_search_filtered(&conn, qv, query, tag, per_tag_width),
                None => Vec::new(),
            };

            let bm25_max = bm25_list
                .iter()
                .map(|(_, s)| *s)
                .fold(f32::NEG_INFINITY, f32::max);
            let bm25_min = bm25_list
                .iter()
                .map(|(_, s)| *s)
                .fold(f32::INFINITY, f32::min);
            let bm25_norm = |raw: f32| -> f32 {
                if !bm25_max.is_finite() || bm25_max <= bm25_min {
                    0.0
                } else {
                    (raw - bm25_min) / (bm25_max - bm25_min)
                }
            };

            let bm25_map: HashMap<String, f32> = bm25_list.into_iter().collect();
            let vec_map: HashMap<String, f32> = vec_list.into_iter().collect();

            let mut candidate_ids: HashSet<String> = HashSet::new();
            candidate_ids.extend(bm25_map.keys().cloned());
            candidate_ids.extend(vec_map.keys().cloned());

            for id in candidate_ids {
                let bm25_raw = bm25_map.get(&id).copied().unwrap_or(f32::NEG_INFINITY);
                let bm25 = if bm25_raw.is_finite() {
                    bm25_norm(bm25_raw)
                } else {
                    0.0
                };
                let vector = vec_map.get(&id).copied().unwrap_or(0.0).clamp(0.0, 1.0);
                let row_info = fetch_row_meta(&conn, &id);
                let created_at = row_info.as_ref().map(|r| r.created_at).unwrap_or_else(Utc::now);
                let confidence = row_info.as_ref().map(|r| r.confidence).unwrap_or(1.0);
                let hotness = Self::fetch_hotness_on_conn(&conn, &id);
                let decay = ranker.decay_factor(created_at);

                // Graph component: populated post-merge once we know the
                // winning id-set. Placeholder here.
                let graph = 0.0_f32;
                let final_score = ranker.score_components(
                    bm25, vector, hotness, graph, confidence, decay,
                );
                let new_hit = StagedHit {
                    id: id.clone(),
                    bm25,
                    vector,
                    hotness,
                    graph,
                    confidence,
                    decay,
                    final_score,
                    picked_by_tag: ranker.policy.tag.clone(),
                };
                by_id
                    .entry(id)
                    .and_modify(|existing| {
                        if new_hit.final_score > existing.final_score {
                            *existing = new_hit.clone();
                        }
                    })
                    .or_insert(new_hit);
            }
        }

        if by_id.is_empty() {
            return Ok(Vec::new());
        }

        // Graph boost: award points for edges to other candidates in the
        // set. Uses the pre-existing `compute_graph_boost` (W may share it).
        let candidate_ids: Vec<String> = by_id.keys().cloned().collect();
        for id in &candidate_ids {
            if let Some(hit) = by_id.get_mut(id) {
                let boost = Self::compute_graph_boost_on_conn(&conn, id, &candidate_ids);
                hit.graph = boost.clamp(0.0, 1.0);
                // Re-blend graph into the final score using the ranker the
                // hit was routed with.
                if let Some(ranker) = rankers
                    .iter()
                    .find(|r| r.policy.tag == hit.picked_by_tag)
                {
                    hit.final_score = ranker.score_components(
                        hit.bm25,
                        hit.vector,
                        hit.hotness,
                        hit.graph,
                        hit.confidence,
                        hit.decay,
                    );
                }
            }
        }

        // Temporal filter: drop rows with an open validity window that
        // doesn't cover "now". Timeless rows always pass.
        let now = Utc::now();
        let mut hits: Vec<StagedHit> = by_id
            .into_values()
            .filter(|h| {
                let info = fetch_row_meta(&conn, &h.id);
                match info {
                    Some(r) => r.is_valid_at(now),
                    None => true,
                }
            })
            .collect();

        hits.sort_by(|a, b| {
            b.final_score
                .partial_cmp(&a.final_score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // MMR diversify using loaded embeddings; Jaccard fallback per pair
        // when embeddings are missing on either side.
        let ids_for_embed: Vec<String> = hits.iter().map(|h| h.id.clone()).collect();
        let embeddings = Self::load_embeddings_for_ids(&conn, &ids_for_embed);
        let tags_for_ids = Self::fetch_tags_for_ids(&conn, &ids_for_embed);

        let scored = hits
            .iter()
            .map(|h| crate::hybrid::ScoredResult {
                idea_id: h.id.clone(),
                keyword_score: h.bm25 as f64,
                vector_score: h.vector as f64,
                combined_score: h.final_score as f64,
            })
            .collect::<Vec<_>>();
        let reranked = mmr_rerank(&scored, top_k, self.mmr_lambda, |a, b| {
            match (embeddings.get(a), embeddings.get(b)) {
                (Some(va), Some(vb)) => cosine_similarity(va, vb) as f64,
                _ => {
                    let ta = tags_for_ids.get(a);
                    let tb = tags_for_ids.get(b);
                    tag_set_jaccard(ta, tb) as f64
                }
            }
        });

        let by_id_ref: HashMap<String, StagedHit> =
            hits.into_iter().map(|h| (h.id.clone(), h)).collect();

        let result: Vec<StagedHit> = reranked
            .into_iter()
            .filter_map(|sr| by_id_ref.get(&sr.idea_id).cloned())
            .collect();
        Ok(result)
    }

    /// Load embeddings for a set of idea IDs. Used by the MMR rerank step.
    pub(super) fn load_embeddings_for_ids(
        conn: &Connection,
        ids: &[String],
    ) -> HashMap<String, Vec<f32>> {
        if ids.is_empty() {
            return HashMap::new();
        }
        let placeholders = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT idea_id, embedding FROM idea_embeddings WHERE idea_id IN ({placeholders})"
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return HashMap::new();
        };
        stmt.query_map(params.as_slice(), |row| {
            let mid: String = row.get(0)?;
            let bytes: Vec<u8> = row.get(1)?;
            Ok((mid, bytes))
        })
        .map(|iter| {
            iter.filter_map(|r| r.ok())
                .map(|(mid, bytes)| (mid, bytes_to_vec(&bytes)))
                .collect()
        })
        .unwrap_or_default()
    }

}

/// Compile an FTS5 MATCH expression. Strips metacharacters per word and
/// adds prefix wildcards so `"auth"` matches `"authentication"`.
fn build_fts_query(text: &str) -> String {
    let words: Vec<String> = text
        .split_whitespace()
        .filter(|w| !w.is_empty())
        .map(|w| {
            let safe = w.replace(['"', '\'', '*', '^', '-', '(', ')'], "");
            if safe.is_empty() {
                String::new()
            } else {
                format!("{safe}*")
            }
        })
        .filter(|w| !w.is_empty())
        .collect();
    if words.is_empty() {
        "\"\"".into()
    } else if words.len() == 1 {
        words.into_iter().next().unwrap()
    } else {
        words.join(" ")
    }
}

/// Append the visibility / anchor / agent scope clause onto the running
/// WHERE fragment. Mirrored between BM25 and vector paths so both see the
/// same corpus.
fn apply_scope_clause(
    query: &IdeaQuery,
    conditions: &mut Vec<String>,
    params: &mut Vec<Box<dyn rusqlite::types::ToSql>>,
    idx: &mut usize,
) {
    if let Some(ref anchors) = query.visible_anchor_ids {
        if anchors.is_empty() {
            conditions.push("(m.scope = 'global' OR m.agent_id IS NULL)".into());
        } else {
            let placeholders = (0..anchors.len())
                .map(|i| format!("?{}", *idx + i))
                .collect::<Vec<_>>()
                .join(",");
            conditions.push(format!(
                "(m.scope = 'global' OR m.agent_id IS NULL OR m.agent_id IN ({placeholders}))"
            ));
            for a in anchors {
                params.push(Box::new(a.clone()));
                *idx += 1;
            }
        }
    } else if let Some(ref agent_id) = query.agent_id {
        conditions.push(format!("m.agent_id = ?{idx}"));
        params.push(Box::new(agent_id.clone()));
        *idx += 1;
    }
}

/// Policy lookup that never fails — falls back to a sensible default so
/// the pipeline always has one.
fn resolve_policy(cache: Option<&TagPolicyCache>, tag: &str) -> TagPolicy {
    if let Some(c) = cache {
        return c.get_or_default(tag);
    }
    TagPolicy::default_for(tag)
}

/// Meta read back out for a single idea — carries just the bits the
/// pipeline needs for bi-temporal filtering and confidence mixing.
struct RowMeta {
    created_at: DateTime<Utc>,
    confidence: f32,
    valid_from: Option<DateTime<Utc>>,
    valid_until: Option<DateTime<Utc>>,
    time_context: String,
}

impl RowMeta {
    fn is_valid_at(&self, ts: DateTime<Utc>) -> bool {
        if self.time_context == "timeless" {
            return true;
        }
        let from_ok = self.valid_from.map(|vf| vf <= ts).unwrap_or(true);
        let to_ok = self.valid_until.map(|vu| vu > ts).unwrap_or(true);
        from_ok && to_ok
    }
}

fn fetch_row_meta(conn: &Connection, id: &str) -> Option<RowMeta> {
    let row = conn
        .query_row(
            "SELECT created_at, confidence, valid_from, valid_until, time_context \
             FROM ideas WHERE id = ?1",
            rusqlite::params![id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, f64>(1)? as f32,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4).unwrap_or_else(|_| "timeless".to_string()),
                ))
            },
        )
        .ok()?;
    let created_at = DateTime::parse_from_rfc3339(&row.0)
        .ok()?
        .with_timezone(&Utc);
    let valid_from = row
        .2
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    let valid_until = row
        .3
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    Some(RowMeta {
        created_at,
        confidence: row.1,
        valid_from,
        valid_until,
        time_context: row.4,
    })
}

/// Stable hash of a query string — feeds into the access log so co-access
/// bucketing can group repeats without retaining the raw text.
fn stable_hash(s: &str) -> String {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    s.hash(&mut h);
    format!("{:016x}", h.finish())
}
