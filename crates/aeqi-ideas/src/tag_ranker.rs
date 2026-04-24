//! Per-tag ranker wrapping a [`TagPolicy`].
//!
//! The retrieval pipeline builds one `TagRanker` per tag on the query plan
//! and uses it to score candidates inside that tag. The cross-tag merge in
//! [`crate::sqlite::search`] then dedupes by id, keeps the max final score,
//! and records which tag "won" each hit.

use crate::tag_policy::TagPolicy;
use chrono::{DateTime, Utc};

/// Thin wrapper around a [`TagPolicy`] that exposes the two primitives the
/// search pipeline needs: component-weight mixing and age-based decay.
pub struct TagRanker {
    pub policy: TagPolicy,
}

impl TagRanker {
    pub fn from_policy(policy: TagPolicy) -> Self {
        Self { policy }
    }

    /// Weighted sum of the per-component sub-scores. Decay is applied as a
    /// final multiplier so an old hit with strong components can still rank
    /// above a fresh but weak hit, while recent hits get a proportional
    /// boost.
    pub fn score_components(
        &self,
        bm25: f32,
        vector: f32,
        hotness: f32,
        graph: f32,
        confidence: f32,
        decay: f32,
    ) -> f32 {
        let linear = self.policy.bm25_weight * bm25
            + self.policy.vector_weight * vector
            + self.policy.hotness_weight * hotness
            + self.policy.graph_weight * graph
            + self.policy.confidence_weight * confidence;
        // Clamp decay to [0,1] so a misconfigured half-life can't blow up
        // the score or flip signs.
        linear * decay.clamp(0.0, 1.0)
    }

    /// `exp(-ln(2) * age_days / half_life)`. Returns 1.0 when the tag
    /// policy disables decay (half-life <= 0) or when the row's timestamp
    /// is in the future.
    pub fn decay_factor(&self, created_at: DateTime<Utc>) -> f32 {
        if self.policy.decay_halflife_days <= 0.0 {
            return 1.0;
        }
        let age_secs = (Utc::now() - created_at).num_seconds();
        if age_secs <= 0 {
            return 1.0;
        }
        let age_days = age_secs as f32 / 86_400.0;
        let lambda = (2.0_f32).ln() / self.policy.decay_halflife_days;
        (-lambda * age_days).exp()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn decay_is_one_for_fresh_rows() {
        let r = TagRanker::from_policy(TagPolicy::default_for("fact"));
        let d = r.decay_factor(Utc::now());
        assert!(d > 0.99, "fresh row decay = {d}");
    }

    #[test]
    fn decay_halves_at_halflife() {
        let mut p = TagPolicy::default_for("fact");
        p.decay_halflife_days = 10.0;
        let r = TagRanker::from_policy(p);
        let ten_days_ago = Utc::now() - Duration::days(10);
        let d = r.decay_factor(ten_days_ago);
        assert!((d - 0.5).abs() < 0.02, "10-day decay = {d}");
    }

    #[test]
    fn disabled_decay_stays_one() {
        let mut p = TagPolicy::default_for("evergreen");
        p.decay_halflife_days = 0.0;
        let r = TagRanker::from_policy(p);
        let ancient = Utc::now() - Duration::days(10_000);
        assert_eq!(r.decay_factor(ancient), 1.0);
    }

    #[test]
    fn component_mix_uses_weights() {
        let mut p = TagPolicy::default_for("fact");
        p.bm25_weight = 1.0;
        p.vector_weight = 0.0;
        p.hotness_weight = 0.0;
        p.graph_weight = 0.0;
        p.confidence_weight = 0.0;
        let r = TagRanker::from_policy(p);
        let s = r.score_components(0.5, 0.9, 0.9, 0.9, 0.9, 1.0);
        assert!((s - 0.5).abs() < f32::EPSILON);
    }
}
