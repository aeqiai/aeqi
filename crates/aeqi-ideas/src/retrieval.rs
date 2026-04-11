//! Intelligent retrieval scoring, contradiction filtering, and temporal scoping.
//!
//! This module implements the scoring layer of the AEQI v4 retrieval pipeline
//! (Layer 5 — Learn).  It combines five signal components into a single final
//! score:
//!
//! ```text
//! final = 0.35 × BM25
//!       + 0.35 × vector
//!       + 0.10 × hotness
//!       + 0.10 × confidence
//!       + 0.10 × graph_boost
//! ```
//!
//! Post-scoring filters remove superseded memories ([`ContradictionFilter`])
//! and support time-travel queries ([`TemporalFilter`]).
//!
//! These types are pure computation — they don't touch SQLite or the network.
//! Integration with the actual memory stores happens upstream.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::graph::{MemoryEdge, MemoryRelation};

// ── Config ──────────────────────────────────────────────────────────────────

/// Configuration for the retrieval scorer.
///
/// Weights should sum to 1.0 for normalized scoring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalConfig {
    /// Maximum number of results to return.
    pub max_results: usize,
    /// Weight for BM25 keyword score component.
    pub bm25_weight: f32,
    /// Weight for vector cosine similarity component.
    pub vector_weight: f32,
    /// Weight for hotness (access frequency + recency) component.
    pub hotness_weight: f32,
    /// Weight for confidence (provenance verification) component.
    pub confidence_weight: f32,
    /// Weight for graph boost (connectivity to high-relevance nodes) component.
    pub graph_boost_weight: f32,
    /// Whether to search across project boundaries.
    pub enable_cross_project: bool,
    /// Optional temporal cutoff: only include memories created before this time.
    pub temporal_cutoff: Option<DateTime<Utc>>,
}

impl Default for RetrievalConfig {
    fn default() -> Self {
        Self {
            max_results: 20,
            bm25_weight: 0.35,
            vector_weight: 0.35,
            hotness_weight: 0.10,
            confidence_weight: 0.10,
            graph_boost_weight: 0.10,
            enable_cross_project: false,
            temporal_cutoff: None,
        }
    }
}

// ── Score Components ────────────────────────────────────────────────────────

/// Individual score components contributing to the final retrieval score.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ScoreComponents {
    /// BM25 keyword match score (normalized 0..1).
    pub bm25: f32,
    /// Vector cosine similarity (0..1).
    pub vector: f32,
    /// Hotness score from access frequency and recency (0..1).
    pub hotness: f32,
    /// Confidence from provenance verification (0..1).
    pub confidence: f32,
    /// Boost from graph connectivity to high-relevance nodes (0..1).
    pub graph_boost: f32,
}

// ── Retrieval Result ────────────────────────────────────────────────────────

/// A fully scored retrieval result with all metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetrievalResult {
    /// Memory ID.
    pub id: String,
    /// Semantic key (e.g. "auth/jwt-rotation").
    pub key: String,
    /// Full memory content.
    pub content: String,
    /// Weighted final score.
    pub final_score: f32,
    /// Breakdown of individual score components.
    pub components: ScoreComponents,
    /// Optional provenance description (agent + task).
    pub provenance: Option<String>,
    /// Which project this memory came from (for cross-project results).
    pub source_project: Option<String>,
    /// When this memory was created.
    pub created_at: Option<DateTime<Utc>>,
}

// ── Retrieval Scorer ────────────────────────────────────────────────────────

/// Combines multiple score signals into a single weighted retrieval score.
pub struct RetrievalScorer {
    /// Scoring configuration with component weights.
    pub config: RetrievalConfig,
}

impl RetrievalScorer {
    /// Create a scorer with default weights.
    pub fn with_defaults() -> Self {
        Self {
            config: RetrievalConfig::default(),
        }
    }

    /// Create a scorer with a custom configuration.
    pub fn new(config: RetrievalConfig) -> Self {
        Self { config }
    }

    /// Compute the final weighted score from individual components.
    ///
    /// Each component should be in `[0.0, 1.0]`.  The result is the weighted
    /// sum per the config weights.
    pub fn score(
        &self,
        bm25: f32,
        vector: f32,
        hotness: f32,
        confidence: f32,
        graph_boost: f32,
    ) -> f32 {
        self.config.bm25_weight * bm25
            + self.config.vector_weight * vector
            + self.config.hotness_weight * hotness
            + self.config.confidence_weight * confidence
            + self.config.graph_boost_weight * graph_boost
    }

    /// Build a complete `ScoreComponents` from individual values.
    pub fn build_components(
        &self,
        bm25: f32,
        vector: f32,
        hotness: f32,
        confidence: f32,
        graph_boost: f32,
    ) -> ScoreComponents {
        ScoreComponents {
            bm25,
            vector,
            hotness,
            confidence,
            graph_boost,
        }
    }
}

// ── Contradiction Filter ────────────────────────────────────────────────────

/// Removes superseded memories from retrieval results.
///
/// If memory A has a `Supersedes` edge pointing to memory B, memory B is
/// removed from the results (the newer truth wins).  This is skipped if the
/// query is in temporal mode (looking at historical state).
pub struct ContradictionFilter;

impl ContradictionFilter {
    /// Filter out memories that have been superseded.
    ///
    /// For each `Supersedes` edge `(source → target)`, if `source` is in the
    /// result set, `target` is removed.
    pub fn filter(results: &mut Vec<RetrievalResult>, edges: &[MemoryEdge]) {
        if edges.is_empty() {
            return;
        }

        // Collect IDs of results present in the set for fast lookup.
        let result_ids: std::collections::HashSet<&str> =
            results.iter().map(|r| r.id.as_str()).collect();

        // Find all target IDs that should be removed: where the source is
        // present in results and the edge is Supersedes.
        let superseded: std::collections::HashSet<&str> = edges
            .iter()
            .filter(|e| e.relation == MemoryRelation::Supersedes)
            .filter(|e| result_ids.contains(e.source_id.as_str()))
            .map(|e| e.target_id.as_str())
            .collect();

        if !superseded.is_empty() {
            results.retain(|r| !superseded.contains(r.id.as_str()));
        }
    }
}

// ── Temporal Filter ─────────────────────────────────────────────────────────

/// Filters results by creation time for "what did we know before X?" queries.
pub struct TemporalFilter;

impl TemporalFilter {
    /// Remove results created after the given cutoff time.
    pub fn apply(results: &mut Vec<RetrievalResult>, cutoff: DateTime<Utc>) {
        results.retain(|r| {
            match r.created_at {
                Some(ts) => ts <= cutoff,
                // If no timestamp, keep the result (conservative: don't drop
                // data we can't date).
                None => true,
            }
        });
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::MemoryEdge;
    use chrono::Duration;

    // ── Helpers ─────────────────────────────────────────────────────────

    fn default_scorer() -> RetrievalScorer {
        RetrievalScorer::with_defaults()
    }

    fn make_result(id: &str, created_at: Option<DateTime<Utc>>) -> RetrievalResult {
        RetrievalResult {
            id: id.to_string(),
            key: format!("key/{id}"),
            content: format!("content for {id}"),
            final_score: 0.5,
            components: ScoreComponents::default(),
            provenance: None,
            source_project: None,
            created_at,
        }
    }

    // ── RetrievalConfig defaults ────────────────────────────────────────

    #[test]
    fn default_weights_sum_to_one() {
        let cfg = RetrievalConfig::default();
        let sum = cfg.bm25_weight
            + cfg.vector_weight
            + cfg.hotness_weight
            + cfg.confidence_weight
            + cfg.graph_boost_weight;
        assert!(
            (sum - 1.0).abs() < 1e-6,
            "default weights must sum to 1.0, got {sum}"
        );
    }

    #[test]
    fn default_config_values() {
        let cfg = RetrievalConfig::default();
        assert_eq!(cfg.max_results, 20);
        assert!(!cfg.enable_cross_project);
        assert!(cfg.temporal_cutoff.is_none());
    }

    // ── RetrievalScorer ─────────────────────────────────────────────────

    #[test]
    fn scorer_all_zeros() {
        let scorer = default_scorer();
        let score = scorer.score(0.0, 0.0, 0.0, 0.0, 0.0);
        assert!(
            score.abs() < f32::EPSILON,
            "all-zero components should give zero score"
        );
    }

    #[test]
    fn scorer_all_max() {
        let scorer = default_scorer();
        let score = scorer.score(1.0, 1.0, 1.0, 1.0, 1.0);
        // With default weights summing to 1.0, all-max should give 1.0.
        assert!(
            (score - 1.0).abs() < 1e-6,
            "all-max components should give 1.0, got {score}"
        );
    }

    #[test]
    fn scorer_bm25_only() {
        let scorer = default_scorer();
        let score = scorer.score(1.0, 0.0, 0.0, 0.0, 0.0);
        assert!(
            (score - 0.35).abs() < 1e-6,
            "BM25-only should give 0.35, got {score}"
        );
    }

    #[test]
    fn scorer_vector_only() {
        let scorer = default_scorer();
        let score = scorer.score(0.0, 1.0, 0.0, 0.0, 0.0);
        assert!(
            (score - 0.35).abs() < 1e-6,
            "vector-only should give 0.35, got {score}"
        );
    }

    #[test]
    fn scorer_hotness_only() {
        let scorer = default_scorer();
        let score = scorer.score(0.0, 0.0, 1.0, 0.0, 0.0);
        assert!(
            (score - 0.10).abs() < 1e-6,
            "hotness-only should give 0.10, got {score}"
        );
    }

    #[test]
    fn scorer_confidence_only() {
        let scorer = default_scorer();
        let score = scorer.score(0.0, 0.0, 0.0, 1.0, 0.0);
        assert!(
            (score - 0.10).abs() < 1e-6,
            "confidence-only should give 0.10, got {score}"
        );
    }

    #[test]
    fn scorer_graph_boost_only() {
        let scorer = default_scorer();
        let score = scorer.score(0.0, 0.0, 0.0, 0.0, 1.0);
        assert!(
            (score - 0.10).abs() < 1e-6,
            "graph_boost-only should give 0.10, got {score}"
        );
    }

    #[test]
    fn scorer_partial_components() {
        let scorer = default_scorer();
        // BM25=0.8, vector=0.6, rest zero.
        let score = scorer.score(0.8, 0.6, 0.0, 0.0, 0.0);
        let expected = 0.35 * 0.8 + 0.35 * 0.6;
        assert!(
            (score - expected).abs() < 1e-6,
            "partial score mismatch: expected {expected}, got {score}"
        );
    }

    #[test]
    fn scorer_custom_weights() {
        let config = RetrievalConfig {
            bm25_weight: 0.5,
            vector_weight: 0.3,
            hotness_weight: 0.1,
            confidence_weight: 0.05,
            graph_boost_weight: 0.05,
            ..Default::default()
        };
        let scorer = RetrievalScorer::new(config);
        let score = scorer.score(1.0, 1.0, 1.0, 1.0, 1.0);
        assert!(
            (score - 1.0).abs() < 1e-6,
            "custom weights summing to 1.0 with all-max should give 1.0"
        );
    }

    // ── ContradictionFilter ─────────────────────────────────────────────

    #[test]
    fn contradiction_filter_removes_superseded() {
        let mut results = vec![
            make_result("new-mem", Some(Utc::now())),
            make_result("old-mem", Some(Utc::now() - Duration::days(30))),
        ];

        let edges = vec![MemoryEdge::new(
            "new-mem",
            "old-mem",
            MemoryRelation::Supersedes,
            0.9,
        )];

        ContradictionFilter::filter(&mut results, &edges);
        assert_eq!(results.len(), 1, "superseded memory should be removed");
        assert_eq!(results[0].id, "new-mem");
    }

    #[test]
    fn contradiction_filter_keeps_non_superseded() {
        let mut results = vec![
            make_result("mem-a", Some(Utc::now())),
            make_result("mem-b", Some(Utc::now())),
        ];

        // Edge exists but is RelatedTo, not Supersedes.
        let edges = vec![MemoryEdge::new(
            "mem-a",
            "mem-b",
            MemoryRelation::RelatedTo,
            0.7,
        )];

        ContradictionFilter::filter(&mut results, &edges);
        assert_eq!(
            results.len(),
            2,
            "non-supersedes edges should not remove anything"
        );
    }

    #[test]
    fn contradiction_filter_empty_edges_noop() {
        let mut results = vec![
            make_result("mem-a", Some(Utc::now())),
            make_result("mem-b", Some(Utc::now())),
        ];
        let original_len = results.len();

        ContradictionFilter::filter(&mut results, &[]);
        assert_eq!(results.len(), original_len, "empty edges should be a no-op");
    }

    #[test]
    fn contradiction_filter_source_not_in_results() {
        let mut results = vec![
            make_result("mem-a", Some(Utc::now())),
            make_result("mem-b", Some(Utc::now())),
        ];

        // Supersedes edge from a memory NOT in the result set.
        let edges = vec![MemoryEdge::new(
            "mem-external",
            "mem-b",
            MemoryRelation::Supersedes,
            0.9,
        )];

        ContradictionFilter::filter(&mut results, &edges);
        assert_eq!(
            results.len(),
            2,
            "supersedes edge with source outside results should not remove target"
        );
    }

    #[test]
    fn contradiction_filter_multiple_supersedes() {
        let mut results = vec![
            make_result("newest", Some(Utc::now())),
            make_result("older", Some(Utc::now() - Duration::days(10))),
            make_result("oldest", Some(Utc::now() - Duration::days(30))),
            make_result("unrelated", Some(Utc::now())),
        ];

        let edges = vec![
            MemoryEdge::new("newest", "older", MemoryRelation::Supersedes, 0.9),
            MemoryEdge::new("newest", "oldest", MemoryRelation::Supersedes, 0.8),
        ];

        ContradictionFilter::filter(&mut results, &edges);
        assert_eq!(results.len(), 2);
        let ids: Vec<&str> = results.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"newest"));
        assert!(ids.contains(&"unrelated"));
    }

    // ── TemporalFilter ──────────────────────────────────────────────────

    #[test]
    fn temporal_filter_removes_after_cutoff() {
        let cutoff = Utc::now() - Duration::days(7);
        let mut results = vec![
            make_result("old", Some(Utc::now() - Duration::days(30))),
            make_result("recent", Some(Utc::now())),
            make_result("edge", Some(cutoff)),
        ];

        TemporalFilter::apply(&mut results, cutoff);
        assert_eq!(results.len(), 2, "result after cutoff should be removed");
        let ids: Vec<&str> = results.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"old"));
        assert!(
            ids.contains(&"edge"),
            "result exactly at cutoff should be kept"
        );
    }

    #[test]
    fn temporal_filter_keeps_all_before_cutoff() {
        let cutoff = Utc::now() + Duration::days(1); // future cutoff
        let mut results = vec![
            make_result("a", Some(Utc::now())),
            make_result("b", Some(Utc::now() - Duration::days(5))),
        ];

        TemporalFilter::apply(&mut results, cutoff);
        assert_eq!(
            results.len(),
            2,
            "all results before future cutoff should be kept"
        );
    }

    #[test]
    fn temporal_filter_preserves_undated_results() {
        let cutoff = Utc::now() - Duration::days(7);
        let mut results = vec![
            make_result("dated-old", Some(Utc::now() - Duration::days(30))),
            make_result("undated", None),
            make_result("dated-new", Some(Utc::now())),
        ];

        TemporalFilter::apply(&mut results, cutoff);
        assert_eq!(results.len(), 2);
        let ids: Vec<&str> = results.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains(&"dated-old"));
        assert!(
            ids.contains(&"undated"),
            "undated results should be preserved (conservative)"
        );
    }

    #[test]
    fn temporal_filter_empty_results_noop() {
        let cutoff = Utc::now();
        let mut results: Vec<RetrievalResult> = vec![];
        TemporalFilter::apply(&mut results, cutoff);
        assert!(results.is_empty());
    }

    #[test]
    fn temporal_filter_removes_all_if_all_after_cutoff() {
        let cutoff = Utc::now() - Duration::days(365);
        let mut results = vec![
            make_result("a", Some(Utc::now())),
            make_result("b", Some(Utc::now() - Duration::days(30))),
        ];

        TemporalFilter::apply(&mut results, cutoff);
        assert!(
            results.is_empty(),
            "all results after cutoff should be removed"
        );
    }
}
