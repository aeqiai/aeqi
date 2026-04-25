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
use crate::sqlite::fts::sanitise_fts5_query;
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
#[cfg(feature = "ann-sqlite-vec")]
use std::sync::atomic::{AtomicU8, Ordering};
use tracing::warn;

/// Sticky ANN availability cache for the scope-aware path in this module.
/// 0 = unknown, 1 = ready, 2 = unavailable. Mirrors `VS_ANN_STATE` in
/// `vector.rs` but lives here so a failure on one path doesn't disable the
/// other. Once set to `unavailable` we stop probing until the process
/// restarts.
#[cfg(feature = "ann-sqlite-vec")]
static ANN_STATE: AtomicU8 = AtomicU8::new(0);

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
        include_superseded: bool,
    ) -> Result<Vec<(String, f32)>> {
        let fts_query = sanitise_fts5_query(&query.text);

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

        if !include_superseded {
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

    /// Vector search filtered to rows that carry `tag`.
    ///
    /// ANN-first: when the `ann-sqlite-vec` feature is on AND the extension
    /// is registered, we route through `idea_vec MATCH` and return its hits
    /// (tag-filtered + scope-filtered in the same query). On any failure —
    /// feature off, extension missing, prepare/query error — we fall through
    /// to the brute-force cosine path over `idea_embeddings`. The ANN
    /// decision is sticky per-process via `ANN_STATE` so we stop re-probing
    /// once we've learned the extension isn't available.
    fn vector_search_filtered(
        conn: &Connection,
        query_vec: &[f32],
        query: &IdeaQuery,
        tag: &str,
        limit: usize,
        include_superseded: bool,
    ) -> Vec<(String, f32)> {
        if let Some(hits) =
            Self::try_ann_search(conn, query_vec, query, tag, limit, include_superseded)
        {
            return hits;
        }

        let mut conditions: Vec<String> = vec![
            "EXISTS(SELECT 1 FROM idea_tags it WHERE it.idea_id = m.id AND LOWER(it.tag) = ?1)"
                .into(),
        ];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(tag.to_lowercase())];
        let mut idx = 2usize;

        if !include_superseded {
            conditions.push("m.status = 'active'".into());
            conditions.push(
                "NOT EXISTS(SELECT 1 FROM idea_edges se WHERE se.source_id = m.id \
                 AND se.relation = 'supersedes')"
                    .into(),
            );
        }

        // Rows mid-reembed carry a stale embedding (the content_hash on the
        // row has advanced but `idea_embeddings` still holds the old vector
        // until the embed worker writes the new one). Filter them out of
        // the vector path so we never score against an out-of-date vector.
        // BM25 is unaffected — FTS5 indexes the current content directly.
        conditions.push("m.embedding_pending = 0".into());

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

    /// Tag-filtered ANN nearest-neighbour search via the `idea_vec` virtual
    /// table. Returns `None` when ANN is unavailable (feature off, extension
    /// missing, prepare/query failure) so the caller can fall back to the
    /// brute-force path. On success returns the same `(id, similarity)`
    /// shape the brute-force path emits so downstream mixing is oblivious.
    ///
    /// Scope + visibility + supersede filters are applied in the same SQL
    /// so the ANN path doesn't leak cross-agent ideas and doesn't resurrect
    /// superseded rows. We ask vec0 for `k*4` neighbours, then filter and
    /// truncate to `limit` — this lets post-hoc filtering discard up to 75%
    /// of candidates without running short of hits.
    #[cfg(feature = "ann-sqlite-vec")]
    fn try_ann_search(
        conn: &Connection,
        query_vec: &[f32],
        query: &IdeaQuery,
        tag: &str,
        limit: usize,
        include_superseded: bool,
    ) -> Option<Vec<(String, f32)>> {
        use crate::sqlite::embeddings::vec_extension_ready;
        use crate::vector::vec_to_bytes;

        // Short-circuit when we already learned ANN isn't available, or when
        // the extension never registered globally.
        if ANN_STATE.load(Ordering::Relaxed) == 2 {
            return None;
        }
        if !vec_extension_ready() {
            ANN_STATE.store(2, Ordering::Relaxed);
            return None;
        }

        // Build a parameterised WHERE that filters by tag + scope + (optional)
        // supersede-exclusion. The vec0 MATCH clause goes first, then the
        // JOIN with ideas + idea_tags handles the tag filter, then
        // apply_scope_clause layers on agent visibility.
        //
        // vec0 `k` controls how many neighbours the virtual table returns
        // before any JOIN filtering — over-fetch so the tag/scope filter has
        // room to drop candidates without starving the caller.
        let k: i64 = (limit as i64).saturating_mul(4).max(limit as i64);

        let mut conditions: Vec<String> = vec![
            "iv.embedding MATCH ?1".into(),
            "iv.k = ?2".into(),
            "EXISTS(SELECT 1 FROM idea_tags it WHERE it.idea_id = m.id AND LOWER(it.tag) = ?3)"
                .into(),
        ];
        let query_bytes = vec_to_bytes(query_vec);
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
            Box::new(query_bytes),
            Box::new(k),
            Box::new(tag.to_lowercase()),
        ];
        let mut idx = 4usize;

        if !include_superseded {
            conditions.push("m.status = 'active'".into());
            conditions.push(
                "NOT EXISTS(SELECT 1 FROM idea_edges se WHERE se.source_id = m.id \
                 AND se.relation = 'supersedes')"
                    .into(),
            );
        }

        // Mirror the brute-force path: skip rows mid-reembed. `idea_vec`
        // syncs from `idea_embeddings` via triggers, so stale rows WILL be
        // present here too — the `m.embedding_pending = 0` filter removes
        // them from the ANN join so a post-update search doesn't return a
        // hit against the pre-update vector.
        conditions.push("m.embedding_pending = 0".into());

        apply_scope_clause(query, &mut conditions, &mut params, &mut idx);

        let where_clause = conditions.join(" AND ");
        let sql = format!(
            "SELECT me.idea_id, me.embedding \
             FROM idea_vec iv \
             JOIN idea_embeddings me ON me.rowid = iv.rowid \
             JOIN ideas m ON m.id = me.idea_id \
             WHERE {where_clause} ORDER BY iv.distance"
        );

        let mut stmt = match conn.prepare(&sql) {
            Ok(s) => s,
            Err(e) => {
                tracing::debug!(
                    error = %e,
                    "ANN prepare failed; falling back to brute-force for this process"
                );
                ANN_STATE.store(2, Ordering::Relaxed);
                return None;
            }
        };

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let rows_iter = match stmt.query_map(param_refs.as_slice(), |row| {
            let id: String = row.get(0)?;
            let bytes: Vec<u8> = row.get(1)?;
            Ok((id, bytes))
        }) {
            Ok(i) => i,
            Err(e) => {
                warn!(error = %e, "ANN query failed; falling back to brute-force for this process");
                ANN_STATE.store(2, Ordering::Relaxed);
                return None;
            }
        };

        ANN_STATE.store(1, Ordering::Relaxed);
        let mut hits: Vec<(String, f32)> = rows_iter
            .filter_map(|r| r.ok())
            .map(|(id, bytes)| {
                let sim = cosine_similarity(query_vec, &bytes_to_vec(&bytes));
                (id, sim)
            })
            .collect();
        // vec0 returns results ordered by L2 distance. Re-sort by cosine
        // similarity so the shape matches the brute-force fallback exactly
        // (both paths feed the same downstream mixing code).
        hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        hits.truncate(limit);
        Some(hits)
    }

    /// Feature-off stub: ANN is never available in a `--no-default-features`
    /// build, so the brute-force path is the only path.
    #[cfg(not(feature = "ann-sqlite-vec"))]
    fn try_ann_search(
        _conn: &Connection,
        _query_vec: &[f32],
        _query: &IdeaQuery,
        _tag: &str,
        _limit: usize,
        _include_superseded: bool,
    ) -> Option<Vec<(String, f32)>> {
        None
    }

    // ── Pipeline entry — search_explained ──────────────────────────────

    /// Staged retrieval returning fully-explained [`SearchHit`]s. Public
    /// callers go through this; it always applies the temporal filter
    /// against "now", mirroring the default `search` contract.
    pub async fn search_explained_impl(
        &self,
        query: &IdeaQuery,
        policies: Option<Arc<TagPolicyCache>>,
    ) -> Result<Vec<SearchHit>> {
        self.search_explained_impl_with_as_of(query, policies, None)
            .await
    }

    /// Internal variant that accepts an explicit as_of for the pipeline's
    /// temporal filter. Lets `search_as_of_impl` ask "what did the store look
    /// like at this moment?" without the pipeline dropping rows whose
    /// validity window closed before "now". `as_of = None` uses `Utc::now()`,
    /// so `search_explained_impl` stays byte-identical.
    async fn search_explained_impl_with_as_of(
        &self,
        query: &IdeaQuery,
        policies: Option<Arc<TagPolicyCache>>,
        as_of: Option<DateTime<Utc>>,
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
            this.run_staged_pipeline(
                &query_owned,
                query_embedding.as_deref(),
                &rankers_owned,
                top_k,
                as_of,
            )
        })
        .await
        .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))??;

        // Phase D: hydrate ideas + tags for each hit id.
        let ids: Vec<String> = hits.iter().map(|h| h.id.clone()).collect();
        let ideas = self.get_by_ids_impl(&ids).await.unwrap_or_default();
        let idea_map: HashMap<String, Idea> =
            ideas.into_iter().map(|i| (i.id.clone(), i)).collect();

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
                    // `cache` is stamped by the IPC layer — the store itself
                    // always produces fresh hits, so default (Fresh) is
                    // correct here.
                    ..Why::default()
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
    ///
    /// Pushes `as_of` down into the staged pipeline so ideas whose window
    /// has closed by "now" but was open at `as_of` are retrievable.
    pub(super) async fn search_as_of_impl(
        &self,
        query: &IdeaQuery,
        as_of: DateTime<Utc>,
    ) -> Result<Vec<Idea>> {
        let hits = self
            .search_explained_impl_with_as_of(query, None, Some(as_of))
            .await?;
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
    ///
    /// `as_of` controls the temporal filter that drops rows whose validity
    /// window doesn't cover the chosen moment. `None` means "now" — the
    /// default `search` / `search_explained` contract. `Some(ts)` is used by
    /// `search_as_of` so ideas whose window has closed by now but was open
    /// at `ts` survive the pipeline and make it back to the caller.
    fn run_staged_pipeline(
        &self,
        query: &IdeaQuery,
        query_embedding: Option<&[f32]>,
        rankers: &[TagRanker],
        top_k: usize,
        as_of: Option<DateTime<Utc>>,
    ) -> Result<Vec<StagedHit>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let per_tag_width = (top_k * 3).max(5);

        // Per-tag retrieve + local score.
        let mut by_id: HashMap<String, StagedHit> = HashMap::new();
        for ranker in rankers {
            let tag = &ranker.policy.tag;
            // T1.1 — `include_superseded_default` per-tag dial. If the
            // policy opts in, the supersession filter for THIS tag's
            // retrieve+score pass is bypassed even if the caller's
            // `IdeaQuery::include_superseded` is false. The OR-merge keeps
            // the caller's existing override semantics intact.
            let include_superseded =
                query.include_superseded || ranker.policy.include_superseded_default == Some(true);
            let bm25_list =
                Self::bm25_search_filtered(&conn, query, tag, per_tag_width, include_superseded)
                    .unwrap_or_default();
            let vec_list = match query_embedding {
                Some(qv) => Self::vector_search_filtered(
                    &conn,
                    qv,
                    query,
                    tag,
                    per_tag_width,
                    include_superseded,
                ),
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
                let created_at = row_info
                    .as_ref()
                    .map(|r| r.created_at)
                    .unwrap_or_else(Utc::now);
                let confidence = row_info.as_ref().map(|r| r.confidence).unwrap_or(1.0);
                let hotness = Self::fetch_hotness_on_conn(&conn, &id);
                let decay = ranker.decay_factor(created_at);

                // Graph component: populated post-merge once we know the
                // winning id-set. Placeholder here.
                let graph = 0.0_f32;
                let final_score =
                    ranker.score_components(bm25, vector, hotness, graph, confidence, decay);
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
                if let Some(ranker) = rankers.iter().find(|r| r.policy.tag == hit.picked_by_tag) {
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
        // doesn't cover the caller's chosen moment. Plain search queries
        // against "now"; search_as_of passes the requested timestamp through
        // so historical windows remain retrievable. Timeless rows always
        // pass either way.
        let ts = as_of.unwrap_or_else(Utc::now);
        let mut hits: Vec<StagedHit> = by_id
            .into_values()
            .filter(|h| {
                let info = fetch_row_meta(&conn, &h.id);
                match info {
                    Some(r) => r.is_valid_at(ts),
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
            // Defensive: MMR selects from a distinct candidate set, but
            // being explicit guards against future callers that dedup
            // differently. Self-similarity is always 1.0 by definition —
            // returning it keeps the diversity math well-behaved if the
            // input ever DOES contain a duplicate (MMR's `1 - max_sim`
            // penalty drives it to 0, so the duplicate ranks last).
            if a == b {
                return 1.0;
            }
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
                    r.get::<_, String>(4)
                        .unwrap_or_else(|_| "timeless".to_string()),
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

// ── T1.1 retrieval tests ─────────────────────────────────────────────
//
// These exercise the `include_superseded_default` per-tag dial. The
// invariant is: when no tag policy opts in (or no cache is wired) the
// supersession filter behaves exactly as it did pre-T1.1; when a policy
// declares `include_superseded_default = true` for a tag, that tag's
// retrieve+score pass surfaces superseded rows even if the caller didn't
// pass `IdeaQuery::include_superseded = true`.

#[cfg(test)]
mod t1_1_retrieval_tests {
    use super::SqliteIdeas;
    use crate::tag_policy::{TagPolicyCache, default_cache};
    use aeqi_core::traits::{IdeaQuery, IdeaStore, StoreFull};
    use std::sync::Arc;
    use tempfile::TempDir;

    fn make_store() -> (SqliteIdeas, TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("d.db");
        let store = SqliteIdeas::open(&db_path, 30.0).unwrap();
        (store, dir, db_path)
    }

    /// Seed two ideas tagged `tag` and flip the first to status='superseded'
    /// directly via a side-channel SQLite connection. Mirrors the DB state
    /// of a real supersession without writing a `supersedes` edge — keeps
    /// these tests focused on the status-only path of the search filter.
    /// Returns `(superseded_id, active_id)`.
    async fn seed_supersession_pair(
        store: &SqliteIdeas,
        db_path: &std::path::Path,
        tag: &str,
    ) -> (String, String) {
        let old_id = store
            .store("first body", "old body content", &[tag.to_string()], None)
            .await
            .unwrap();
        // Flip BEFORE inserting the new row so the active-name partial
        // unique index doesn't trip when both rows share a name (we use
        // distinct names below for clarity, but the flip-first ordering
        // mirrors `supersede_atomic_impl`).
        let conn = rusqlite::Connection::open(db_path).unwrap();
        conn.execute(
            "UPDATE ideas SET status='superseded' WHERE id = ?1",
            rusqlite::params![old_id],
        )
        .unwrap();
        drop(conn);

        let payload = StoreFull {
            name: "second body".to_string(),
            content: "new body content".to_string(),
            tags: vec![tag.to_string()],
            agent_id: None,
            scope: aeqi_core::Scope::Global,
            authored_by: None,
            confidence: 1.0,
            expires_at: None,
            valid_from: None,
            valid_until: None,
            time_context: "timeless".to_string(),
            status: "active".to_string(),
        };
        let new_id = store.store_full(payload).await.unwrap();
        (old_id, new_id)
    }

    /// Seed a meta:tag-policy idea declaring policy TOML for `tag`.
    async fn seed_policy(store: &SqliteIdeas, tag: &str, body: &str) {
        let name = format!("meta:tag-policy:{tag}");
        store
            .store(&name, body, &["meta:tag-policy".to_string()], None)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn t1_1_baseline_no_cache_excludes_superseded_rows() {
        // Neutral-dial invariant: when no policy cache is wired, the
        // supersession filter behaves exactly as it did pre-T1.1.
        let (store, _dir, db_path) = make_store();
        let (_old, new_id) = seed_supersession_pair(&store, &db_path, "rule").await;

        let mut q = IdeaQuery::new("body", 10);
        q.tags = vec!["rule".to_string()];
        let hits = store.search_explained_impl(&q, None).await.unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.idea.id.as_str()).collect();
        assert!(
            ids.contains(&new_id.as_str()),
            "the active replacement must surface, got: {ids:?}"
        );
        assert!(
            !ids.iter().any(|id| *id == _old),
            "the superseded row must be filtered, got: {ids:?}"
        );
    }

    #[tokio::test]
    async fn t1_1_baseline_cache_without_dial_excludes_superseded_rows() {
        // Cache present but no policy declares the dial → behaviour
        // identical to baseline.
        let (store, _dir, db_path) = make_store();
        let (old_id, new_id) = seed_supersession_pair(&store, &db_path, "rule").await;
        let cache: Arc<TagPolicyCache> = default_cache();

        let mut q = IdeaQuery::new("body", 10);
        q.tags = vec!["rule".to_string()];
        let hits = store.search_explained_impl(&q, Some(cache)).await.unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.idea.id.as_str()).collect();
        assert!(ids.contains(&new_id.as_str()));
        assert!(
            !ids.iter().any(|id| *id == old_id),
            "without policy opt-in, superseded row stays hidden"
        );
    }

    /// Warm the tag policy cache against the store. The hot search path
    /// uses `get_or_default` (sync; doesn't refresh), so production warms
    /// the cache through `cache.resolve(...)` from `handle_store_idea`.
    /// Tests that exercise the search path must do the same.
    async fn warm_cache(cache: &TagPolicyCache, store: &SqliteIdeas, tags: &[&str]) {
        let owned: Vec<String> = tags.iter().map(|t| t.to_string()).collect();
        let _ = cache.resolve(store as &dyn IdeaStore, &owned).await;
    }

    #[tokio::test]
    async fn t1_1_include_superseded_default_surfaces_superseded_rows() {
        // Activation: a policy with `include_superseded_default = true`
        // must surface the superseded row even when the caller didn't
        // pass `include_superseded` in the IdeaQuery.
        let (store, _dir, db_path) = make_store();
        let (old_id, new_id) = seed_supersession_pair(&store, &db_path, "rule").await;
        seed_policy(
            &store,
            "rule",
            r#"
            tag = "rule"
            include_superseded_default = true
        "#,
        )
        .await;
        let cache: Arc<TagPolicyCache> = default_cache();
        warm_cache(&cache, &store, &["rule"]).await;

        let mut q = IdeaQuery::new("body", 10);
        q.tags = vec!["rule".to_string()];
        let hits = store.search_explained_impl(&q, Some(cache)).await.unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.idea.id.as_str()).collect();
        assert!(
            ids.contains(&new_id.as_str()),
            "active row must still surface: {ids:?}"
        );
        assert!(
            ids.iter().any(|id| *id == old_id),
            "superseded row must surface when policy opts in: {ids:?}"
        );
    }

    #[tokio::test]
    async fn t1_1_include_superseded_default_does_not_leak_to_other_tags() {
        // The dial is per-tag. A policy on `rule` opting in must NOT
        // affect retrieval for ideas tagged `unrelated`. Cross-
        // contamination check.
        let (store, _dir, db_path) = make_store();
        let (old_other, new_other) = seed_supersession_pair(&store, &db_path, "unrelated").await;
        seed_policy(
            &store,
            "rule",
            r#"
            tag = "rule"
            include_superseded_default = true
        "#,
        )
        .await;
        let cache: Arc<TagPolicyCache> = default_cache();
        warm_cache(&cache, &store, &["rule", "unrelated"]).await;

        let mut q = IdeaQuery::new("body", 10);
        q.tags = vec!["unrelated".to_string()];
        let hits = store.search_explained_impl(&q, Some(cache)).await.unwrap();
        let ids: Vec<&str> = hits.iter().map(|h| h.idea.id.as_str()).collect();
        assert!(ids.contains(&new_other.as_str()));
        assert!(
            !ids.iter().any(|id| *id == old_other),
            "rule-tag opt-in must not leak to unrelated-tag retrieval"
        );
    }
}
