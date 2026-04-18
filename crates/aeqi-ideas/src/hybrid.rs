use std::collections::HashMap;

/// Hybrid search result merging BM25 keyword scores with vector similarity.
/// Applies temporal decay and MMR re-ranking.
///
/// A scored idea result from any source.
#[derive(Debug, Clone)]
pub struct ScoredResult {
    pub idea_id: String,
    pub keyword_score: f64,
    pub vector_score: f64,
    pub combined_score: f64,
}

/// Merge keyword (BM25) results with vector similarity results using
/// Reciprocal Rank Fusion (RRF).
///
/// RRF is rank-based, so it handles the different score magnitudes of BM25
/// (large negative floats) and cosine similarity ([0, 1]) without needing
/// normalization.  The constant `k` (default 60) smooths the impact of
/// top-ranked results.
///
/// `keyword_weight` and `vector_weight` control how much each ranked list
/// contributes.  They need not sum to 1.0 — they act as multipliers.
pub fn merge_scores(
    keyword_results: &[(String, f64)], // (idea_id, bm25_score) — already sorted best-first
    vector_results: &[(String, f64)],  // (idea_id, cosine_similarity) — already sorted best-first
    keyword_weight: f64,
    vector_weight: f64,
) -> Vec<ScoredResult> {
    // RRF constant: 60 is the standard default from the original paper.
    // Higher k → flatter distribution (rank-1 bonus less pronounced).
    const RRF_K: f64 = 60.0;

    let mut scores: HashMap<String, ScoredResult> = HashMap::new();

    for (rank, (id, kw_score)) in keyword_results.iter().enumerate() {
        let rrf = keyword_weight / (RRF_K + rank as f64 + 1.0);
        let entry = scores.entry(id.clone()).or_insert_with(|| ScoredResult {
            idea_id: id.clone(),
            keyword_score: *kw_score,
            vector_score: 0.0,
            combined_score: 0.0,
        });
        entry.keyword_score = *kw_score;
        entry.combined_score += rrf;
    }

    for (rank, (id, vec_score)) in vector_results.iter().enumerate() {
        let rrf = vector_weight / (RRF_K + rank as f64 + 1.0);
        let entry = scores.entry(id.clone()).or_insert_with(|| ScoredResult {
            idea_id: id.clone(),
            keyword_score: 0.0,
            vector_score: *vec_score,
            combined_score: 0.0,
        });
        entry.vector_score = *vec_score;
        entry.combined_score += rrf;
    }

    let mut results: Vec<ScoredResult> = scores.into_values().collect();
    results.sort_by(|a, b| {
        b.combined_score
            .partial_cmp(&a.combined_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    results
}

/// Apply temporal decay to scores.
/// `decay_factor`: value between 0 and 1, computed from age and half-life.
pub fn apply_decay(score: f64, decay_factor: f64) -> f64 {
    score * decay_factor
}

/// Maximal Marginal Relevance (MMR) re-ranking.
/// Balances relevance against diversity by penalizing results similar to already-selected ones.
///
/// `lambda`: 0.0 = maximize diversity, 1.0 = maximize relevance.
/// `similarity_fn`: returns similarity between two idea IDs.
pub fn mmr_rerank<F>(
    candidates: &[ScoredResult],
    top_k: usize,
    lambda: f64,
    similarity_fn: F,
) -> Vec<ScoredResult>
where
    F: Fn(&str, &str) -> f64,
{
    if candidates.is_empty() || top_k == 0 {
        return Vec::new();
    }

    let mut selected: Vec<ScoredResult> = Vec::with_capacity(top_k);
    let mut remaining: Vec<&ScoredResult> = candidates.iter().collect();

    while selected.len() < top_k && !remaining.is_empty() {
        let mut best_idx = 0;
        let mut best_mmr = f64::NEG_INFINITY;

        for (i, candidate) in remaining.iter().enumerate() {
            let relevance = candidate.combined_score;

            // Max similarity to already-selected items.
            let max_sim = selected
                .iter()
                .map(|s| similarity_fn(&candidate.idea_id, &s.idea_id))
                .fold(0.0f64, f64::max);

            let mmr = lambda * relevance - (1.0 - lambda) * max_sim;

            if mmr > best_mmr {
                best_mmr = mmr;
                best_idx = i;
            }
        }

        let chosen = remaining.remove(best_idx);
        selected.push(ScoredResult {
            combined_score: best_mmr,
            ..chosen.clone()
        });
    }

    selected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_scores_rrf_top_result() {
        // mem-1 appears in both lists (rank 0 in each) → highest RRF score.
        // mem-2 is rank-1 keyword only; mem-3 is rank-1 vector only.
        let kw = vec![("mem-1".to_string(), 5.0), ("mem-2".to_string(), 3.0)];
        let vec_results = vec![("mem-1".to_string(), 0.9), ("mem-3".to_string(), 0.8)];

        let merged = merge_scores(&kw, &vec_results, 0.4, 0.6);
        assert!(!merged.is_empty());
        // mem-1 should be top: it accumulates RRF from both lists.
        assert_eq!(merged[0].idea_id, "mem-1");
    }

    #[test]
    fn test_merge_scores_rrf_single_list() {
        // When only one list has results the top ranked item should still win.
        let kw = vec![
            ("a".to_string(), 10.0),
            ("b".to_string(), 5.0),
            ("c".to_string(), 1.0),
        ];
        let merged = merge_scores(&kw, &[], 1.0, 0.0);
        assert_eq!(merged.len(), 3);
        // "a" is rank-0 in keyword list → highest RRF score.
        assert_eq!(merged[0].idea_id, "a");
    }

    #[test]
    fn test_merge_scores_rrf_rank_beats_score() {
        // RRF is rank-based: a doc that is rank-0 keyword + rank-0 vector should
        // beat a doc with a higher raw score but lower rank.
        let kw = vec![
            ("popular".to_string(), 100.0), // rank 0 keyword
            ("niche".to_string(), 99.0),    // rank 1 keyword
        ];
        let vec_results = vec![
            ("popular".to_string(), 0.95), // rank 0 vector
            ("other".to_string(), 0.94),   // rank 1 vector
        ];
        let merged = merge_scores(&kw, &vec_results, 0.5, 0.5);
        // "popular" appears at rank-0 in both lists → should win.
        assert_eq!(merged[0].idea_id, "popular");
    }

    #[test]
    fn test_mmr_diversifies() {
        let candidates = vec![
            ScoredResult {
                idea_id: "a".to_string(),
                keyword_score: 0.9,
                vector_score: 0.9,
                combined_score: 0.9,
            },
            ScoredResult {
                idea_id: "b".to_string(),
                keyword_score: 0.85,
                vector_score: 0.85,
                combined_score: 0.85,
            },
            ScoredResult {
                idea_id: "c".to_string(),
                keyword_score: 0.5,
                vector_score: 0.5,
                combined_score: 0.5,
            },
        ];

        // Similarity: a and b are very similar, c is different.
        let sim = |a: &str, b: &str| -> f64 {
            match (a, b) {
                ("a", "b") | ("b", "a") => 0.95,
                _ => 0.1,
            }
        };

        let reranked = mmr_rerank(&candidates, 2, 0.7, sim);
        assert_eq!(reranked.len(), 2);
        // First should be "a" (highest relevance).
        assert_eq!(reranked[0].idea_id, "a");
        // Second should be "c" (diverse), not "b" (too similar to "a").
        assert_eq!(reranked[1].idea_id, "c");
    }
}
