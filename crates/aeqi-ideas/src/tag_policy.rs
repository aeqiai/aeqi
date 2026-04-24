//! Tag policy values consumed by the retrieval pipeline.
//!
//! **OWNERSHIP:** this file is owned by Agent W (Write Path). Agent R
//! ([`tag_ranker`](crate::tag_ranker), [`sqlite::search`](crate::sqlite))
//! only reads [`TagPolicy`] — it must never modify the struct shape.
//!
//! Until W's implementation lands this module only defines the minimal
//! surface R needs: weight fields, decay half-life, and the cache type
//! that R's search path reads from. When W lands, they replace this file
//! with the full policy loader (TOML body parser, cache invalidation on
//! `meta:tag-policy` writes, consolidation triggers). R's call sites are
//! written against this minimal shape so the merge is additive.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};

/// Per-tag retrieval / lifecycle policy. Component weights drive the
/// cross-tag weighted-sum merge in the staged pipeline; `decay_halflife_days`
/// feeds the per-hit decay factor.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TagPolicy {
    pub tag: String,
    pub bm25_weight: f32,
    pub vector_weight: f32,
    pub hotness_weight: f32,
    pub graph_weight: f32,
    pub confidence_weight: f32,
    /// Exponential decay half-life for `created_at`-based decay. A value of
    /// `0.0` disables decay (evergreen / pinned tags).
    pub decay_halflife_days: f32,
}

impl TagPolicy {
    /// Sensible defaults for an arbitrary tag with no explicit policy.
    /// Weights sum to 1.0 for readability; absolute scale is controlled by
    /// the downstream normalisation.
    pub fn default_for(tag: impl Into<String>) -> Self {
        Self {
            tag: tag.into(),
            bm25_weight: 0.30,
            vector_weight: 0.30,
            hotness_weight: 0.15,
            graph_weight: 0.10,
            confidence_weight: 0.15,
            decay_halflife_days: 30.0,
        }
    }
}

/// Lookup cache for tag policies. Writes bump the internal generation
/// counter and a TTL-bounded reload refreshes stale entries. R only needs
/// `get` / `get_or_default`; W populates the rest.
pub struct TagPolicyCache {
    entries: RwLock<HashMap<String, (Instant, TagPolicy)>>,
    ttl: Duration,
}

impl TagPolicyCache {
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            entries: RwLock::new(HashMap::new()),
            ttl: Duration::from_secs(ttl_secs),
        }
    }

    /// Returns a stored policy when fresh, otherwise `None`. Writers on
    /// the W side populate this with the latest policy values.
    pub fn get(&self, tag: &str) -> Option<TagPolicy> {
        let entries = self.entries.read().ok()?;
        entries
            .get(tag)
            .filter(|(t, _)| t.elapsed() < self.ttl)
            .map(|(_, p)| p.clone())
    }

    /// Always returns a policy — either the cached one or a default so the
    /// read path can always route the query.
    pub fn get_or_default(&self, tag: &str) -> TagPolicy {
        self.get(tag).unwrap_or_else(|| TagPolicy::default_for(tag))
    }

    /// Replace a tag's policy. W calls this after each `meta:tag-policy`
    /// write; R never writes to the cache.
    pub fn put(&self, tag: String, policy: TagPolicy) {
        if let Ok(mut entries) = self.entries.write() {
            entries.insert(tag, (Instant::now(), policy));
        }
    }

    /// Remove one tag's cached policy — used when a policy idea is
    /// deleted.
    pub fn invalidate(&self, tag: &str) {
        if let Ok(mut entries) = self.entries.write() {
            entries.remove(tag);
        }
    }

    /// Wipe the entire cache — used on mass reloads.
    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.write() {
            entries.clear();
        }
    }
}

impl Default for TagPolicyCache {
    fn default() -> Self {
        Self::new(60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_policy_has_weights() {
        let p = TagPolicy::default_for("fact");
        assert_eq!(p.tag, "fact");
        assert!(p.bm25_weight > 0.0);
        assert!(p.decay_halflife_days > 0.0);
    }

    #[test]
    fn cache_roundtrips_custom_policy() {
        let cache = TagPolicyCache::new(60);
        let mut p = TagPolicy::default_for("preference");
        p.bm25_weight = 0.1;
        cache.put("preference".to_string(), p.clone());
        let got = cache.get("preference").expect("cached policy");
        assert!((got.bm25_weight - 0.1).abs() < f32::EPSILON);
    }

    #[test]
    fn get_or_default_falls_back() {
        let cache = TagPolicyCache::new(60);
        let p = cache.get_or_default("unknown");
        assert_eq!(p.tag, "unknown");
    }

    #[test]
    fn ttl_expires_entries() {
        let cache = TagPolicyCache::new(0);
        cache.put("x".to_string(), TagPolicy::default_for("x"));
        std::thread::sleep(Duration::from_millis(5));
        assert!(cache.get("x").is_none());
    }
}
