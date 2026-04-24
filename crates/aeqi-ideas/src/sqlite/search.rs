//! Hybrid search pipeline: BM25 + vector + MMR + graph boost.
//!
//! The pipeline runs inside `spawn_blocking` (see `search_sync`) to keep the
//! tokio runtime free of std::sync::Mutex waits. The `search` trait method
//! embeds the query outside the blocking task, then hands the vector in.
//!
//! This module is scheduled for replacement by a staged pipeline in Round 3
//! (see velvet-bouncing-honey.md Phase 5). The current implementation is
//! preserved verbatim here so the split in Phase 2 remains a pure refactor.

use super::{IdeaRow, SqliteIdeas};
use crate::hybrid::{ScoredResult, merge_scores, mmr_rerank};
use crate::sqlite::embeddings::vec_extension_ready;
use crate::vector::{bytes_to_vec, cosine_similarity, vec_to_bytes};
use aeqi_core::traits::{Idea, IdeaQuery};
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use tracing::{debug, warn};

/// Per-DB memo of whether the ANN path works on this process. Values:
/// 0 = unknown (try on first call), 1 = available, 2 = unavailable.
/// Stays sticky across queries so we don't pay the error cost per query.
static ANN_STATE: AtomicU8 = AtomicU8::new(0);

impl SqliteIdeas {
    pub(super) fn decay_factor(&self, created_at: &DateTime<Utc>) -> f64 {
        let age_days = (Utc::now() - *created_at).num_seconds() as f64 / 86400.0;
        if age_days <= 0.0 {
            return 1.0;
        }
        let lambda = (2.0_f64).ln() / self.decay_halflife_days;
        (-lambda * age_days).exp()
    }

    fn bm25_search(
        conn: &Connection,
        query: &IdeaQuery,
        limit: usize,
    ) -> Result<Vec<(IdeaRow, f64)>> {
        // Build an FTS5 query that supports both short keyword queries and longer
        // sentences.  Each token becomes a prefix term (`word*`) so "auth" matches
        // "authentication", and terms are joined with implicit AND so all words
        // must appear.  A single fallback OR pass catches cases where the strict
        // AND yields nothing.
        //
        // Column weights: name (title) column is boosted 5× over content so a
        // title match outranks a buried body mention.  bm25(ideas_fts, 5, 1).
        let words: Vec<String> = query
            .text
            .split_whitespace()
            .filter(|w| !w.is_empty())
            .map(|w| {
                // Strip FTS5 metacharacters to avoid parse errors on user input.
                let safe = w.replace(['"', '\'', '*', '^', '-', '(', ')'], "");
                if safe.is_empty() {
                    String::new()
                } else {
                    format!("{safe}*")
                }
            })
            .filter(|w| !w.is_empty())
            .collect();

        // If the query reduced to nothing (all punctuation), fall back to a
        // wildcard that returns everything so the vector path can still run.
        let fts_query = if words.is_empty() {
            "\"\"".to_string() // matches all docs (FTS5 empty string)
        } else if words.len() == 1 {
            words[0].clone()
        } else {
            // AND semantics: all words must appear somewhere in name|content.
            words.join(" ")
        };

        let mut conditions = vec!["ideas_fts MATCH ?1".to_string()];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(fts_query)];
        let mut idx = 2usize;

        // Filter out expired entries.
        let now = Utc::now().to_rfc3339();
        conditions.push(format!("(m.expires_at IS NULL OR m.expires_at > ?{idx})"));
        params.push(Box::new(now));
        idx += 1;

        if let Some(ref anchors) = query.visible_anchor_ids {
            // Visibility clause: global OR anchor in allowed set.
            if anchors.is_empty() {
                // No anchors visible at any non-global scope — only global rows.
                conditions.push("(m.scope = 'global' OR m.agent_id IS NULL)".to_string());
            } else {
                let placeholders = (0..anchors.len())
                    .map(|i| format!("?{}", idx + i))
                    .collect::<Vec<_>>()
                    .join(",");
                conditions.push(format!(
                    "(m.scope = 'global' OR m.agent_id IS NULL OR m.agent_id IN ({placeholders}))"
                ));
                for a in anchors {
                    params.push(Box::new(a.clone()));
                    idx += 1;
                }
            }
        } else if let Some(ref agent_id) = query.agent_id {
            conditions.push(format!("m.agent_id = ?{idx}"));
            params.push(Box::new(agent_id.clone()));
            idx += 1;
        }

        let where_clause = conditions.join(" AND ");

        // bm25(ideas_fts, 5, 1): name column weighted 5×, content weighted 1×.
        // Lower bm25() value = better match (SQLite FTS5 returns negative scores).
        let sql = format!(
            "SELECT m.id, m.name, m.content, m.agent_id,
                    m.created_at, m.session_id, bm25(ideas_fts, 5, 1) as rank
             FROM ideas_fts f
             JOIN ideas m ON m.rowid = f.rowid
             WHERE {where_clause}
             ORDER BY rank
             LIMIT ?{idx}"
        );

        params.push(Box::new(limit as i64));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let content: String = row.get(2)?;
                let agent_id: Option<String> = row.get(3)?;
                let created_at: String = row.get(4)?;
                let session_id: Option<String> = row.get(5)?;
                let bm25: f64 = row.get(6)?;
                Ok((
                    IdeaRow {
                        id,
                        name,
                        content,
                        agent_id,
                        created_at,
                        session_id,
                        tags: Vec::new(),
                    },
                    bm25,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    /// Top-k vector search with scope-visibility filtering applied. Prefers
    /// the sqlite-vec `idea_vec` MATCH path when the extension is loaded;
    /// falls back to the brute-force scan over `idea_embeddings` when it
    /// isn't (or when the ANN probe fails at runtime).
    ///
    /// Signature is load-bearing — Agent R depends on it.
    fn vector_search_scoped(
        conn: &Connection,
        query_vec: &[f32],
        top_k: usize,
        query: &IdeaQuery,
    ) -> Vec<(String, f32)> {
        if let Some(hits) = try_ann_search(conn, query_vec, top_k, query) {
            return hits;
        }
        brute_force_vector_search(conn, query_vec, top_k, query)
    }

    fn load_embeddings_for_ids(conn: &Connection, ids: &[String]) -> HashMap<String, Vec<f32>> {
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

    /// Synchronous search implementation. Called from spawn_blocking.
    fn search_sync(
        &self,
        query: &IdeaQuery,
        query_embedding: Option<Vec<f32>>,
    ) -> Result<Vec<Idea>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;

        let bm25_limit = if query_embedding.is_some() {
            query.top_k * 3
        } else {
            query.top_k
        };
        let bm25_rows = Self::bm25_search(&conn, query, bm25_limit)?;

        let vector_scores = if let Some(ref qvec) = query_embedding {
            Self::vector_search_scoped(&conn, qvec, query.top_k * 3, query)
        } else {
            vec![]
        };

        // BM25-only path with graph boost.
        if vector_scores.is_empty() {
            // Enrich IdeaRows with tags from junction table before dropping conn.
            let bm25_ids: Vec<String> = bm25_rows.iter().map(|(r, _)| r.id.clone()).collect();
            let tag_map = Self::fetch_tags_for_ids(&conn, &bm25_ids);
            let bm25_rows: Vec<(IdeaRow, f64)> = bm25_rows
                .into_iter()
                .map(|(mut row, score)| {
                    if let Some(tags) = tag_map.get(&row.id) {
                        row.tags = tags.clone();
                    }
                    (row, score)
                })
                .collect();
            // Drop conn before calling methods that re-lock.
            drop(conn);
            let mut entries: Vec<Idea> = bm25_rows
                .into_iter()
                .filter_map(|(row, bm25_score)| {
                    let raw = -bm25_score;
                    self.row_to_entry(row, raw, query)
                })
                .collect();
            let ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
            for entry in &mut entries {
                let boost = self.compute_graph_boost(&entry.id, &ids);
                if boost > 0.0 {
                    entry.score = entry.score * 0.9 + (boost as f64) * 0.1;
                }
            }
            entries.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            return Ok(entries);
        }

        // Hybrid merge.
        let kw_pairs: Vec<(String, f64)> = bm25_rows
            .iter()
            .map(|(row, bm25)| (row.id.clone(), -bm25))
            .collect();
        let vec_pairs: Vec<(String, f64)> = vector_scores
            .iter()
            .map(|(id, sim)| (id.clone(), *sim as f64))
            .collect();

        let merged = merge_scores(
            &kw_pairs,
            &vec_pairs,
            self.keyword_weight,
            self.vector_weight,
        );

        let bm25_map: HashMap<String, &IdeaRow> = bm25_rows
            .iter()
            .map(|(row, _)| (row.id.clone(), row))
            .collect();

        let missing_ids: Vec<String> = merged
            .iter()
            .take(query.top_k * 2)
            .filter(|r| !bm25_map.contains_key(&r.idea_id))
            .map(|r| r.idea_id.clone())
            .collect();

        let extra_rows: HashMap<String, IdeaRow> = if !missing_ids.is_empty() {
            Self::fetch_by_ids(&conn, &missing_ids)
                .into_iter()
                .map(|row| (row.id.clone(), row))
                .collect()
        } else {
            HashMap::new()
        };

        // Enrich BM25 rows and extra rows with tags from junction table.
        let all_row_ids: Vec<String> = bm25_rows
            .iter()
            .map(|(r, _)| r.id.clone())
            .chain(extra_rows.keys().cloned())
            .collect();
        let tag_map = Self::fetch_tags_for_ids(&conn, &all_row_ids);

        // Build Idea for each merged result, applying temporal decay.
        let mut scored: Vec<(ScoredResult, Idea)> = Vec::new();
        for sr in merged.into_iter().take(query.top_k * 2) {
            let enriched_tags = tag_map.get(&sr.idea_id).cloned().unwrap_or_default();
            let row_ref = bm25_map
                .get(&sr.idea_id)
                .map(|r| IdeaRow {
                    id: r.id.clone(),
                    name: r.name.clone(),
                    content: r.content.clone(),
                    agent_id: r.agent_id.clone(),
                    created_at: r.created_at.clone(),
                    session_id: r.session_id.clone(),
                    tags: enriched_tags.clone(),
                })
                .or_else(|| {
                    extra_rows.get(&sr.idea_id).map(|r| IdeaRow {
                        id: r.id.clone(),
                        name: r.name.clone(),
                        content: r.content.clone(),
                        agent_id: r.agent_id.clone(),
                        created_at: r.created_at.clone(),
                        session_id: r.session_id.clone(),
                        tags: enriched_tags.clone(),
                    })
                });

            if let Some(row) = row_ref
                && let Some(entry) = self.row_to_entry(row, sr.combined_score, query)
            {
                scored.push((sr, entry));
            }
        }

        scored.sort_by(|a, b| {
            b.1.score
                .partial_cmp(&a.1.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // MMR rerank using embedding similarity.
        let candidate_ids: Vec<String> = scored.iter().map(|(_, e)| e.id.clone()).collect();
        let embedding_cache = Self::load_embeddings_for_ids(&conn, &candidate_ids);

        let scored_results: Vec<ScoredResult> = scored.iter().map(|(sr, _)| sr.clone()).collect();

        let reranked = mmr_rerank(
            &scored_results,
            query.top_k,
            self.mmr_lambda,
            |id_a, id_b| match (embedding_cache.get(id_a), embedding_cache.get(id_b)) {
                (Some(a), Some(b)) => cosine_similarity(a, b) as f64,
                _ => 0.0,
            },
        );

        // Drop conn before calling compute_graph_boost which re-locks.
        drop(conn);

        // Apply graph boost from idea edges.
        let entry_map: HashMap<String, Idea> =
            scored.into_iter().map(|(_, e)| (e.id.clone(), e)).collect();

        let result_ids: Vec<String> = reranked.iter().map(|r| r.idea_id.clone()).collect();

        let mut result: Vec<Idea> = reranked
            .into_iter()
            .filter_map(|r| {
                let mut entry = entry_map.get(&r.idea_id)?.clone();
                let graph_boost = self.compute_graph_boost(&entry.id, &result_ids);
                if graph_boost > 0.0 {
                    entry.score = entry.score * 0.9 + (graph_boost as f64) * 0.1;
                    debug!(id = %entry.id, name = %entry.name, graph_boost, "graph boost applied");
                } else {
                    entry.score = r.combined_score;
                }
                Some(entry)
            })
            .collect();

        result.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        Ok(result)
    }

    pub(super) async fn search_impl(&self, query: &IdeaQuery) -> Result<Vec<Idea>> {
        // Phase 1: embed query text if embedder present (async, no lock).
        let query_embedding: Option<Vec<f32>> = if let Some(ref embedder) = self.embedder {
            match embedder.embed(&query.text).await {
                Ok(emb) => Some(emb),
                Err(e) => {
                    warn!("query embedding failed, falling back to BM25: {e}");
                    None
                }
            }
        } else {
            None
        };

        // Phase 2+: all DB and computation work runs in spawn_blocking
        // to avoid blocking the tokio runtime with std::sync::Mutex.
        let this = self.clone();
        let query = query.clone();
        tokio::task::spawn_blocking(move || this.search_sync(&query, query_embedding))
            .await
            .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))?
    }
}

/// Build the visibility-scope WHERE fragment used by both the ANN and the
/// brute-force vector search paths. Keeping one implementation prevents the
/// two paths drifting on scope semantics — getting this wrong leaks
/// cross-agent ideas.
pub(super) fn build_vector_scope_clause(
    query: &IdeaQuery,
    start_idx: usize,
) -> (Vec<String>, Vec<Box<dyn rusqlite::types::ToSql>>, usize) {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = start_idx;

    if let Some(ref anchors) = query.visible_anchor_ids {
        if anchors.is_empty() {
            conditions.push("(m.scope = 'global' OR m.agent_id IS NULL)".to_string());
        } else {
            let placeholders = (0..anchors.len())
                .map(|i| format!("?{}", idx + i))
                .collect::<Vec<_>>()
                .join(",");
            conditions.push(format!(
                "(m.scope = 'global' OR m.agent_id IS NULL OR m.agent_id IN ({placeholders}))"
            ));
            for a in anchors {
                params.push(Box::new(a.clone()));
                idx += 1;
            }
        }
    } else if let Some(ref agent_id) = query.agent_id {
        conditions.push(format!("m.agent_id = ?{idx}"));
        params.push(Box::new(agent_id.clone()));
        idx += 1;
    }

    (conditions, params, idx)
}

/// ANN path. Returns `Some(hits)` on success; `None` when ANN is unavailable
/// (extension not loaded, virtual table missing, or runtime MATCH failure) so
/// the caller falls through to brute-force. Uses `ANN_STATE` as a sticky
/// flag so a single "ANN unavailable on this DB" decision doesn't keep
/// retrying an error-raising query on every lookup.
fn try_ann_search(
    conn: &Connection,
    query_vec: &[f32],
    top_k: usize,
    query: &IdeaQuery,
) -> Option<Vec<(String, f32)>> {
    if !vec_extension_ready() {
        return None;
    }
    if ANN_STATE.load(Ordering::Relaxed) == 2 {
        return None;
    }

    let query_bytes = vec_to_bytes(query_vec);
    // Pull a larger candidate pool from the vec index (`k`) and then apply
    // scope filters in the outer query. `k` must be a literal-ish constant
    // to keep sqlite-vec happy, so we bind it as an integer parameter.
    let k: i64 = (top_k as i64).saturating_mul(4).max(top_k as i64);

    // Build scope filters starting at param ?3 (?1 = query bytes, ?2 = k).
    let (mut scope_conditions, scope_params, _end_idx) = build_vector_scope_clause(query, 3);

    // Always-on filters for the ANN path.
    scope_conditions.insert(0, "m.status = 'active'".to_string());

    let scope_clause = if scope_conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", scope_conditions.join(" AND "))
    };

    // vec0 MATCH: the rowid→idea_embeddings join reconnects the ANN hit to
    // the real idea row so we can enforce scope + status. distance is the
    // cosine distance (since vec0's default metric on a float[] column is
    // L2, we recompute cosine here — this gives the same ordering as the
    // brute-force path and is cheap).
    let sql = format!(
        "SELECT me.idea_id, iv.distance, me.embedding \
         FROM idea_vec iv \
         JOIN idea_embeddings me ON me.rowid = iv.rowid \
         JOIN ideas m ON m.id = me.idea_id \
         WHERE iv.embedding MATCH ?1 AND iv.k = ?2{scope_clause} \
         ORDER BY iv.distance"
    );

    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![
        Box::new(query_bytes),
        Box::new(k),
    ];
    params.extend(scope_params);
    let param_refs: Vec<&dyn rusqlite::types::ToSql> =
        params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(e) => {
            warn!(error = %e, "ANN query prepare failed; marking ANN unavailable + falling back to brute-force");
            ANN_STATE.store(2, Ordering::Relaxed);
            return None;
        }
    };

    let rows = match stmt.query_map(param_refs.as_slice(), |row| {
        let idea_id: String = row.get(0)?;
        let _distance: f64 = row.get(1)?;
        let emb_bytes: Vec<u8> = row.get(2)?;
        Ok((idea_id, emb_bytes))
    }) {
        Ok(iter) => iter,
        Err(e) => {
            warn!(error = %e, "ANN query execution failed; marking ANN unavailable + falling back to brute-force");
            ANN_STATE.store(2, Ordering::Relaxed);
            return None;
        }
    };

    // Mark ANN as known-good on the first successful query.
    ANN_STATE.store(1, Ordering::Relaxed);

    let mut hits: Vec<(String, f32)> = rows
        .filter_map(|r| r.ok())
        .map(|(id, emb_bytes)| {
            // Recompute cosine on the actual embedding so the score stays
            // on the same scale as the brute-force path. vec0's L2 distance
            // preserves ordering for unit-normalised vectors but the score
            // magnitudes differ, and downstream ranker weights depend on
            // [0,1] cosine similarity.
            let emb = bytes_to_vec(&emb_bytes);
            let sim = cosine_similarity(query_vec, &emb);
            (id, sim)
        })
        .collect();
    hits.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(top_k);
    Some(hits)
}

/// Brute-force vector search — the original implementation, retained as the
/// fallback when ANN is unavailable. Scans every `idea_embeddings` row
/// through the scope-visibility filter and computes cosine in Rust.
fn brute_force_vector_search(
    conn: &Connection,
    query_vec: &[f32],
    top_k: usize,
    query: &IdeaQuery,
) -> Vec<(String, f32)> {
    let (mut conditions, params, _idx) = build_vector_scope_clause(query, 1);
    conditions.insert(0, "1=1".to_string());

    let where_clause = conditions.join(" AND ");
    let sql = format!(
        "SELECT me.idea_id, me.embedding
         FROM idea_embeddings me
         JOIN ideas m ON m.id = me.idea_id
         WHERE {where_clause}"
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
                .map(|(mid, bytes)| {
                    let emb = bytes_to_vec(&bytes);
                    let sim = cosine_similarity(query_vec, &emb);
                    (mid, sim)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(top_k);
    results
}
