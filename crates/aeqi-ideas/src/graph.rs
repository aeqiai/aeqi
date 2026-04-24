//! Idea graph primitives: edges, provenance, and hotness scoring.
//!
//! These are the building blocks for the idea graph described in AEQI v4
//! Layer 5 (Learn). Ideas become graph nodes; relationships between them
//! are typed, directed edges with strength weights.
//!
//! Relation strings are open-ended and live in [`crate::relation`] —
//! the `idea_edges.relation` column is TEXT so the vocabulary can grow
//! without a schema migration. `IdeaEdge.relation` is therefore a plain
//! `String`; validate with `crate::relation::is_known` at the callers
//! that accept untrusted input.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ── Edges ───────────────────────────────────────────────────────────────────

/// A directed edge in the idea graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdeaEdge {
    /// Source idea node ID.
    pub source_id: String,
    /// Target idea node ID.
    pub target_id: String,
    /// Type of relationship — one of the strings in
    /// [`crate::relation::KNOWN_RELATIONS`].
    pub relation: String,
    /// Edge strength in `[0.0, 1.0]`.
    pub strength: f32,
    /// When this edge was created.
    pub created_at: DateTime<Utc>,
}

impl IdeaEdge {
    /// Create a new edge with the given relation and strength.
    ///
    /// Strength is clamped to `[0.0, 1.0]`.
    pub fn new(
        source_id: impl Into<String>,
        target_id: impl Into<String>,
        relation: impl Into<String>,
        strength: f32,
    ) -> Self {
        Self {
            source_id: source_id.into(),
            target_id: target_id.into(),
            relation: relation.into(),
            strength: strength.clamp(0.0, 1.0),
            created_at: Utc::now(),
        }
    }
}

// ── Provenance ──────────────────────────────────────────────────────────────

/// Tracks where an idea came from: which agent, which task, and whether
/// the outcome was verified by the verification pipeline.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IdeaProvenance {
    /// Agent that produced this idea (e.g. "engineer", "trader").
    pub agent: Option<String>,
    /// Quest ID that triggered the extraction.
    pub quest_id: Option<String>,
    /// Whether the originating task outcome was verified.
    pub verified: bool,
}

// ── Hotness Scoring ─────────────────────────────────────────────────────────

/// Computes a "hotness" score for an idea based on access frequency and
/// recency.  Hot ideas surface higher in retrieval; cold ideas drift
/// toward archival.
///
/// ```text
/// frequency_score = sigmoid(ln(1 + access_count))
/// recency_score   = exp(-λ × days_since_access)   where λ = ln(2)/7
/// hotness         = 0.6 × frequency + 0.4 × recency
/// ```
pub struct HotnessScorer {
    /// Decay constant: `ln(2) / half_life_days`.
    lambda: f64,
}

impl Default for HotnessScorer {
    fn default() -> Self {
        Self::new(7.0)
    }
}

impl HotnessScorer {
    /// Create a scorer with a custom half-life (in days).
    pub fn new(half_life_days: f64) -> Self {
        Self {
            lambda: (2.0_f64).ln() / half_life_days,
        }
    }

    /// Compute the hotness score for an idea.
    pub fn compute(&self, access_count: u32, last_accessed: DateTime<Utc>) -> f32 {
        let freq = self.frequency_score(access_count);
        let rec = self.recency_score(last_accessed);
        0.6 * freq + 0.4 * rec
    }

    /// `sigmoid(ln(1 + access_count))` — saturates toward 1.0 for heavily-
    /// accessed ideas.
    fn frequency_score(&self, access_count: u32) -> f32 {
        let x = ((1 + access_count) as f64).ln();
        sigmoid(x) as f32
    }

    /// `exp(-λ × days_since_access)` — decays exponentially from 1.0.
    fn recency_score(&self, last_accessed: DateTime<Utc>) -> f32 {
        let days = (Utc::now() - last_accessed).num_seconds().max(0) as f64 / 86400.0;
        ((-self.lambda * days).exp()) as f32
    }
}

/// Standard logistic sigmoid: `1 / (1 + exp(-x))`.
fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// Apply rapid decay to a hotness score when an idea is contradicted.
/// Multiplies by 0.3 so the superseded idea sinks fast.
pub fn on_contradiction(hotness: &mut f32) {
    *hotness *= 0.3;
}

/// Record an idea access: bump counter and refresh timestamp.
pub fn on_access(access_count: &mut u32, last_accessed: &mut DateTime<Utc>) {
    *access_count = access_count.saturating_add(1);
    *last_accessed = Utc::now();
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn scorer() -> HotnessScorer {
        HotnessScorer::default() // 7-day half-life
    }

    #[test]
    fn fresh_idea_high_recency_low_frequency() {
        let s = scorer();
        let now = Utc::now();
        let h = s.compute(0, now);
        // Recency ≈ 1.0, frequency = sigmoid(ln(1)) = sigmoid(0) = 0.5
        // hotness ≈ 0.6 × 0.5 + 0.4 × 1.0 = 0.70
        assert!(h > 0.65 && h < 0.75, "fresh idea hotness = {h}");
    }

    #[test]
    fn old_accessed_idea_low_recency_high_frequency() {
        let s = scorer();
        let long_ago = Utc::now() - Duration::days(60);
        let h = s.compute(200, long_ago);
        // Recency near 0 (60 days >> 7-day half-life)
        // Frequency: sigmoid(ln(201)) ≈ sigmoid(5.3) ≈ 0.995
        // hotness ≈ 0.6 × 0.995 + 0.4 × ~0 ≈ 0.597
        assert!(h > 0.50 && h < 0.70, "old frequent idea hotness = {h}");
    }

    #[test]
    fn cold_idea_low_both() {
        let s = scorer();
        let long_ago = Utc::now() - Duration::days(90);
        let h = s.compute(1, long_ago);
        // Frequency: sigmoid(ln(2)) ≈ sigmoid(0.693) ≈ 0.667
        // Recency: exp(-lambda * 90) ≈ 0 for 7-day half-life
        // hotness ≈ 0.6 × 0.667 ≈ 0.40
        assert!(h < 0.45, "cold idea hotness = {h}");
    }

    #[test]
    fn hot_idea_high_both() {
        let s = scorer();
        let recent = Utc::now() - Duration::hours(1);
        let h = s.compute(100, recent);
        // Frequency: sigmoid(ln(101)) ≈ sigmoid(4.62) ≈ 0.99
        // Recency ≈ 1.0
        // hotness ≈ 0.6 × 0.99 + 0.4 × 1.0 ≈ 0.994
        assert!(h > 0.90, "hot idea hotness = {h}");
    }

    #[test]
    fn contradiction_decay() {
        let mut hotness = 0.8_f32;
        on_contradiction(&mut hotness);
        assert!(
            (hotness - 0.24).abs() < 0.01,
            "after contradiction: {hotness}"
        );
        // A second contradiction drives it even lower.
        on_contradiction(&mut hotness);
        assert!(hotness < 0.08, "double contradiction: {hotness}");
    }

    #[test]
    fn on_access_updates_count_and_timestamp() {
        let mut count = 5_u32;
        let mut ts = Utc::now() - Duration::hours(2);
        let before = ts;
        on_access(&mut count, &mut ts);
        assert_eq!(count, 6);
        assert!(ts > before);
    }

    #[test]
    fn idea_edge_creation() {
        let edge = IdeaEdge::new("src-1", "tgt-2", crate::relation::EMBEDS, 0.9);
        assert_eq!(edge.source_id, "src-1");
        assert_eq!(edge.target_id, "tgt-2");
        assert_eq!(edge.relation, "embeds");
        assert!((edge.strength - 0.9).abs() < f32::EPSILON);
    }

    #[test]
    fn edge_strength_clamped() {
        let edge = IdeaEdge::new("a", "b", crate::relation::ADJACENT, 1.5);
        assert!((edge.strength - 1.0).abs() < f32::EPSILON);
        let edge2 = IdeaEdge::new("a", "b", crate::relation::ADJACENT, -0.5);
        assert!(edge2.strength.abs() < f32::EPSILON);
    }

    #[test]
    fn provenance_defaults() {
        let p = IdeaProvenance::default();
        assert!(p.agent.is_none());
        assert!(p.quest_id.is_none());
        assert!(!p.verified);
    }
}
