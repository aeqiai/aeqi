//! Tag policies: per-tag configuration stored as meta-ideas tagged
//! [`POLICY_TAG`].
//!
//! At store/search time the write/read pipelines look up an idea's tags,
//! resolve each to a [`TagPolicy`], and merge the policies to drive behaviour:
//! decay half-life, ranker weights, TTL, consolidation thresholds.
//!
//! This file owns the **policy data structure** and the **cache loader** only.
//! The retrieval-side ranker wrapper lives in `tag_ranker.rs` (Agent R).

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// The `meta:tag-policy` tag that identifies policy-bearing ideas.
pub const POLICY_TAG: &str = "meta:tag-policy";

// ── Policy struct + defaults ───────────────────────────────────────────────

/// Per-tag configuration parsed from the TOML body of a meta-idea tagged
/// [`POLICY_TAG`].
///
/// The write pipeline (Agent W) uses `confidence_default`, `expires_after_days`,
/// `time_context`, and `consolidate_when`. The retrieval pipeline (Agent R)
/// consumes the ranker weights, `decay_half_life_days`, `mmr_lambda`, and
/// `signals`. Defaults are chosen so that an idea *without* any tag policy
/// sees baseline behaviour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagPolicy {
    /// The tag this policy applies to. Matched case-insensitively during
    /// resolution. Optional in the TOML body — when omitted,
    /// [`TagPolicy::from_toml`] fills it from the fallback slug.
    #[serde(default)]
    pub tag: String,
    #[serde(default = "default_bm25")]
    pub bm25_weight: f32,
    #[serde(default = "default_vector")]
    pub vector_weight: f32,
    #[serde(default = "default_hotness")]
    pub hotness_weight: f32,
    #[serde(default = "default_graph")]
    pub graph_weight: f32,
    #[serde(default = "default_confidence_weight")]
    pub confidence_weight: f32,
    #[serde(default = "default_half_life")]
    pub decay_half_life_days: f32,
    #[serde(default = "default_mmr")]
    pub mmr_lambda: f32,
    /// Default confidence applied on store when the caller doesn't specify
    /// one. Overrides the system-wide 1.0 default.
    #[serde(default = "default_store_confidence")]
    pub confidence_default: f32,
    /// Default `expires_at` offset (in days) applied on store. `None` means
    /// "no TTL". Ideas that carry multiple policies take the *minimum*
    /// offset when merged.
    #[serde(default)]
    pub expires_after_days: Option<f32>,
    /// Bi-temporal hint applied on store. One of `timeless` | `event` |
    /// `state`. See `StoreFull::time_context` for semantics.
    #[serde(default = "default_time_context")]
    pub time_context: String,
    /// Optional consolidation trigger: fire `ideas:threshold_reached` when
    /// `COUNT(*)` of ideas with this tag reaches `count` within
    /// `age_hours`.
    #[serde(default)]
    pub consolidate_when: Option<ConsolidationTrigger>,
    /// Regex hints for `route_hint=auto` (Agent R consumes).
    #[serde(default)]
    pub signals: Vec<String>,
    // ── Tier 1 universality dials (T1.1) ──────────────────────────────
    //
    // Each of these is a strictly additive optional dial. When `None`, the
    // call site preserves its current hardcoded behaviour byte-for-byte.
    // When `Some(_)`, the call site routes through the policy value. No
    // baked-in opinion: the field expresses a primitive, the opinion lives
    // in seed content that sets it.
    /// Maximum items `ideas.store_many` is allowed to persist in a single
    /// call against ideas carrying this tag. Acts as a per-tag blast-radius
    /// cap on the batch writer. Items beyond the cap are refused and surface
    /// in the response under `refused`. `None` (default) preserves the
    /// pre-T1.1 unbounded behaviour.
    #[serde(default)]
    pub max_items_per_call: Option<i64>,
    /// Override for the dedup pipeline's recency window (in hours). When set,
    /// `handle_store_idea` filters BM25-similar candidates to those created
    /// within this window before passing them to the dedup pipeline; ideas
    /// created earlier are treated as "novel" and the new content is stored
    /// fresh. `None` (default) preserves the pre-T1.1 behaviour where the
    /// dedup pipeline considers every BM25-similar candidate regardless of
    /// age.
    #[serde(default)]
    pub dedup_window_hours: Option<i64>,
    /// Per-tag default for retrieval's supersession filter. When `Some(true)`
    /// the search pipeline includes superseded ideas for this tag even if
    /// the caller didn't pass `include_superseded=true`. `None` or
    /// `Some(false)` preserves the pre-T1.1 behaviour: superseded rows are
    /// filtered unless the query explicitly asks to include them.
    #[serde(default)]
    pub include_superseded_default: Option<bool>,
}

/// Consolidation threshold config embedded inside a [`TagPolicy`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsolidationTrigger {
    /// Absolute count of matching ideas that trips the trigger.
    pub count: i64,
    /// Window (hours back from `now`) over which `count` is measured.
    pub age_hours: i64,
    /// Name of the consolidator meta-idea (`meta:*-template`) the event
    /// spawns a sub-agent from.
    pub consolidator_idea: String,
}

// Field defaults — keep these functions instead of `Default` on the struct
// so `serde(default)` can call them per-field.
fn default_bm25() -> f32 {
    1.0
}
fn default_vector() -> f32 {
    1.0
}
fn default_hotness() -> f32 {
    0.5
}
fn default_graph() -> f32 {
    0.5
}
fn default_confidence_weight() -> f32 {
    0.5
}
fn default_half_life() -> f32 {
    30.0
}
fn default_mmr() -> f32 {
    0.5
}
fn default_store_confidence() -> f32 {
    1.0
}
fn default_time_context() -> String {
    "timeless".to_string()
}

impl Default for TagPolicy {
    fn default() -> Self {
        Self {
            tag: String::new(),
            bm25_weight: default_bm25(),
            vector_weight: default_vector(),
            hotness_weight: default_hotness(),
            graph_weight: default_graph(),
            confidence_weight: default_confidence_weight(),
            decay_half_life_days: default_half_life(),
            mmr_lambda: default_mmr(),
            confidence_default: default_store_confidence(),
            expires_after_days: None,
            time_context: default_time_context(),
            consolidate_when: None,
            signals: Vec::new(),
            max_items_per_call: None,
            dedup_window_hours: None,
            include_superseded_default: None,
        }
    }
}

impl TagPolicy {
    /// Parse a policy from the TOML body of a meta-idea. The `tag` field
    /// must be present in the body; `fallback_tag` is used only when the
    /// body omits it (unusual — callers are encouraged to author the tag
    /// inside the body for round-tripping).
    pub fn from_toml(body: &str, fallback_tag: &str) -> Result<Self> {
        let mut policy: Self = toml::from_str(body)
            .map_err(|e| anyhow::anyhow!("failed to parse tag policy TOML: {e}"))?;
        if policy.tag.trim().is_empty() {
            policy.tag = fallback_tag.to_string();
        }
        Ok(policy)
    }

    /// Build a default policy pinned to a specific tag.
    /// Used when the cache has no explicit policy for a requested tag.
    pub fn default_for(tag: &str) -> Self {
        Self {
            tag: tag.to_string(),
            ..Default::default()
        }
    }
}

// ── Cache ──────────────────────────────────────────────────────────────────

/// Lock-protected cache of tag policies.
///
/// Policies are meta-ideas; every `meta:tag-policy` store must call
/// [`TagPolicyCache::invalidate`] so the next `resolve` picks the update up.
/// Between invalidations, the cache serves reads for up to `ttl` before
/// auto-refreshing.
pub struct TagPolicyCache {
    inner: RwLock<CacheState>,
    ttl: std::time::Duration,
}

struct CacheState {
    policies: HashMap<String, TagPolicy>,
    loaded_at: DateTime<Utc>,
}

impl TagPolicyCache {
    /// Construct a cache with the given TTL. Initial state is empty and
    /// marked as stale so the first `resolve` call triggers a load.
    pub fn new(ttl_secs: u64) -> Self {
        Self {
            inner: RwLock::new(CacheState {
                policies: HashMap::new(),
                // Pin to Unix epoch so the first resolve treats the cache
                // as stale and pulls the real policies immediately.
                loaded_at: DateTime::<Utc>::from_timestamp(0, 0).unwrap_or_else(Utc::now),
            }),
            ttl: std::time::Duration::from_secs(ttl_secs),
        }
    }

    /// Resolve policies for every tag in `tags`. Tags without a matching
    /// `meta:tag-policy` meta-idea fall back to [`TagPolicy::default`] so
    /// callers always see a policy for every tag.
    pub async fn resolve(
        &self,
        store: &dyn aeqi_core::traits::IdeaStore,
        tags: &[String],
    ) -> Vec<TagPolicy> {
        self.refresh_if_stale(store).await;
        let guard = self.inner.read().await;
        tags.iter()
            .map(|tag| {
                guard
                    .policies
                    .get(&tag.to_lowercase())
                    .cloned()
                    .unwrap_or_else(|| TagPolicy {
                        tag: tag.clone(),
                        ..TagPolicy::default()
                    })
            })
            .collect()
    }

    /// Mark the cache stale so the next `resolve` refreshes from the store.
    /// Called after any store of an idea tagged `meta:tag-policy`.
    pub async fn invalidate(&self) {
        let mut guard = self.inner.write().await;
        guard.loaded_at = DateTime::<Utc>::from_timestamp(0, 0).unwrap_or_else(Utc::now);
    }

    /// Synchronous non-refreshing lookup. Returns whatever is currently in
    /// the cache for `tag`; falls back to `TagPolicy::default_for(tag)` when
    /// the cache doesn't carry one. Used by the hot search path where taking
    /// an async refresh would be a needless stall — callers are expected to
    /// `resolve()` periodically elsewhere.
    pub fn get_or_default(&self, tag: &str) -> TagPolicy {
        if let Ok(guard) = self.inner.try_read()
            && let Some(p) = guard.policies.get(&tag.to_lowercase())
        {
            return p.clone();
        }
        TagPolicy::default_for(tag)
    }

    async fn refresh_if_stale(&self, store: &dyn aeqi_core::traits::IdeaStore) {
        {
            let guard = self.inner.read().await;
            if !self.is_stale(&guard) {
                return;
            }
        }
        // Upgrade to write: re-check under write lock to avoid a double
        // load when two callers race on the first refresh.
        let mut guard = self.inner.write().await;
        if !self.is_stale(&guard) {
            return;
        }
        let policies = load_policies(store).await;
        guard.policies = policies;
        guard.loaded_at = Utc::now();
    }

    fn is_stale(&self, state: &CacheState) -> bool {
        let now = Utc::now();
        let age = now - state.loaded_at;
        let age_std = age.to_std().unwrap_or(std::time::Duration::MAX);
        age_std >= self.ttl
    }
}

async fn load_policies(store: &dyn aeqi_core::traits::IdeaStore) -> HashMap<String, TagPolicy> {
    let ideas = match store.ideas_by_tags(&[POLICY_TAG.to_string()], 1000).await {
        Ok(ideas) => ideas,
        Err(e) => {
            tracing::warn!(error = %e, "TagPolicyCache: failed to load policy ideas");
            return HashMap::new();
        }
    };

    let mut map: HashMap<String, TagPolicy> = HashMap::with_capacity(ideas.len());
    for idea in ideas {
        // The idea's `name` is typically `meta:tag-policy:<tag>`. The TOML
        // body SHOULD carry the `tag` field; we fall back to extracting
        // it from the name's suffix if missing.
        let fallback_tag = idea
            .name
            .rsplit_once(':')
            .map(|(_, t)| t.to_string())
            .unwrap_or_else(|| idea.name.clone());
        match TagPolicy::from_toml(&idea.content, &fallback_tag) {
            Ok(policy) => {
                map.insert(policy.tag.to_lowercase(), policy);
            }
            Err(e) => {
                tracing::warn!(
                    idea_id = %idea.id,
                    name = %idea.name,
                    error = %e,
                    "TagPolicyCache: failed to parse TOML policy body",
                );
            }
        }
    }
    map
}

/// Convenience constructor for callers that want an empty `Arc<TagPolicyCache>`
/// with a sensible default TTL.
pub fn default_cache() -> Arc<TagPolicyCache> {
    Arc::new(TagPolicyCache::new(60))
}

// ── Policy merge ───────────────────────────────────────────────────────────

/// Merged effective policy for an idea carrying multiple tags.
///
/// Merge rules are chosen to be conservative in both directions:
/// - `confidence_default`: **max** — if any tag insists on high confidence,
///   respect that.
/// - `expires_after_days`: **min** — the shortest TTL wins.
/// - `time_context`: first non-default wins (defaults to `timeless`).
/// - `consolidate_when`: first present wins (policies that disagree over
///   consolidation are unusual; log at debug and take the first).
#[derive(Debug, Clone)]
pub struct EffectivePolicy {
    pub confidence_default: f32,
    pub expires_after_days: Option<f32>,
    pub time_context: String,
    pub consolidate_when: Option<(String, ConsolidationTrigger)>,
    // ── Tier 1 universality dials (T1.1) ──────────────────────────────
    /// Tightest per-tag blast-radius cap among the merged policies. The
    /// minimum wins so a single restrictive tag bounds the whole batch.
    /// `None` means no policy declared a cap.
    pub max_items_per_call: Option<i64>,
    /// Tightest per-tag dedup window among the merged policies. The minimum
    /// wins so a tag that wants a stricter window narrows the dedup view
    /// for everyone. `None` means no policy declared a window.
    pub dedup_window_hours: Option<i64>,
    /// Whether retrieval should include superseded rows by default for
    /// this set of tags. Any policy opting in flips this on.
    pub include_superseded_default: bool,
}

impl Default for EffectivePolicy {
    fn default() -> Self {
        Self {
            confidence_default: default_store_confidence(),
            expires_after_days: None,
            time_context: default_time_context(),
            consolidate_when: None,
            max_items_per_call: None,
            dedup_window_hours: None,
            include_superseded_default: false,
        }
    }
}

/// Merge a set of resolved policies into a single effective policy.
pub fn merge_policies(policies: &[TagPolicy]) -> EffectivePolicy {
    if policies.is_empty() {
        return EffectivePolicy::default();
    }

    // Seed confidence_default from the first policy so the "max" merge
    // can *lower* the baseline if every policy insists on a lower number
    // than the system-wide 1.0 default.
    let mut effective = EffectivePolicy {
        confidence_default: policies[0].confidence_default,
        expires_after_days: None,
        time_context: default_time_context(),
        consolidate_when: None,
        max_items_per_call: None,
        dedup_window_hours: None,
        include_superseded_default: false,
    };
    let mut saw_non_default_time = false;

    for policy in policies {
        if policy.confidence_default > effective.confidence_default {
            effective.confidence_default = policy.confidence_default;
        }

        effective.expires_after_days =
            match (effective.expires_after_days, policy.expires_after_days) {
                (None, x) => x,
                (x, None) => x,
                (Some(a), Some(b)) => Some(a.min(b)),
            };

        if !saw_non_default_time && policy.time_context != default_time_context() {
            effective.time_context = policy.time_context.clone();
            saw_non_default_time = true;
        }

        if effective.consolidate_when.is_none()
            && let Some(ref trigger) = policy.consolidate_when
        {
            effective.consolidate_when = Some((policy.tag.clone(), trigger.clone()));
        }

        // Tier 1 dials — each merge rule mirrors the conservative direction
        // the existing fields use:
        //   `max_items_per_call` → min wins so the tightest cap binds.
        //   `dedup_window_hours` → min wins so the strictest window binds.
        //   `include_superseded_default` → OR-merge: any opt-in surfaces
        //   superseded rows for the whole tag set (additive surface; zero
        //   change unless someone explicitly asks).
        effective.max_items_per_call =
            match (effective.max_items_per_call, policy.max_items_per_call) {
                (None, x) => x,
                (x, None) => x,
                (Some(a), Some(b)) => Some(a.min(b)),
            };
        effective.dedup_window_hours =
            match (effective.dedup_window_hours, policy.dedup_window_hours) {
                (None, x) => x,
                (x, None) => x,
                (Some(a), Some(b)) => Some(a.min(b)),
            };
        if policy.include_superseded_default == Some(true) {
            effective.include_superseded_default = true;
        }
    }

    effective
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_toml_fills_defaults() {
        let body = r#"
            tag = "fact"
        "#;
        let policy = TagPolicy::from_toml(body, "fact").unwrap();
        assert_eq!(policy.tag, "fact");
        assert!((policy.bm25_weight - 1.0).abs() < f32::EPSILON);
        assert_eq!(policy.time_context, "timeless");
        assert!(policy.consolidate_when.is_none());
    }

    #[test]
    fn from_toml_parses_consolidation() {
        let body = r#"
            tag = "source:session"
            decay_half_life_days = 3.0
            [consolidate_when]
            count = 10
            age_hours = 168
            consolidator_idea = "meta:weekly-consolidator-template"
        "#;
        let policy = TagPolicy::from_toml(body, "source:session").unwrap();
        let trigger = policy.consolidate_when.expect("trigger parses");
        assert_eq!(trigger.count, 10);
        assert_eq!(trigger.age_hours, 168);
        assert_eq!(
            trigger.consolidator_idea,
            "meta:weekly-consolidator-template"
        );
        assert!((policy.decay_half_life_days - 3.0).abs() < f32::EPSILON);
    }

    #[test]
    fn from_toml_uses_fallback_tag_when_missing() {
        let body = r#"
            bm25_weight = 2.0
        "#;
        let policy = TagPolicy::from_toml(body, "evergreen").unwrap();
        assert_eq!(policy.tag, "evergreen");
        assert!((policy.bm25_weight - 2.0).abs() < f32::EPSILON);
    }

    #[test]
    fn merge_policies_takes_max_confidence_and_min_ttl() {
        let a = TagPolicy {
            tag: "a".into(),
            confidence_default: 0.7,
            expires_after_days: Some(30.0),
            ..TagPolicy::default()
        };
        let b = TagPolicy {
            tag: "b".into(),
            confidence_default: 0.9,
            expires_after_days: Some(7.0),
            ..TagPolicy::default()
        };
        let eff = merge_policies(&[a, b]);
        assert!((eff.confidence_default - 0.9).abs() < f32::EPSILON);
        assert_eq!(eff.expires_after_days, Some(7.0));
    }

    #[test]
    fn merge_policies_takes_first_consolidate_when() {
        let trigger_a = ConsolidationTrigger {
            count: 5,
            age_hours: 24,
            consolidator_idea: "meta:a-template".into(),
        };
        let trigger_b = ConsolidationTrigger {
            count: 20,
            age_hours: 168,
            consolidator_idea: "meta:b-template".into(),
        };
        let a = TagPolicy {
            tag: "a".into(),
            consolidate_when: Some(trigger_a),
            ..TagPolicy::default()
        };
        let b = TagPolicy {
            tag: "b".into(),
            consolidate_when: Some(trigger_b),
            ..TagPolicy::default()
        };
        let eff = merge_policies(&[a, b]);
        let (tag, trigger) = eff.consolidate_when.expect("first trigger kept");
        assert_eq!(tag, "a");
        assert_eq!(trigger.count, 5);
    }

    // ── T1.1 dial tests ────────────────────────────────────────────────

    #[test]
    fn t1_1_baseline_unset_fields_default_to_none() {
        // Neutral-dial invariant 2: a policy that doesn't set any of the
        // T1.1 fields preserves the pre-T1.1 surface — every dial is None.
        let body = r#"
            tag = "fact"
        "#;
        let policy = TagPolicy::from_toml(body, "fact").unwrap();
        assert!(policy.max_items_per_call.is_none());
        assert!(policy.dedup_window_hours.is_none());
        assert!(policy.include_superseded_default.is_none());
    }

    #[test]
    fn t1_1_max_items_per_call_round_trips_alone() {
        // Independent activation: only this dial set.
        let body = r#"
            tag = "ephemeral"
            max_items_per_call = 3
        "#;
        let policy = TagPolicy::from_toml(body, "ephemeral").unwrap();
        assert_eq!(policy.max_items_per_call, Some(3));
        assert!(policy.dedup_window_hours.is_none());
        assert!(policy.include_superseded_default.is_none());
    }

    #[test]
    fn t1_1_dedup_window_hours_round_trips_alone() {
        let body = r#"
            tag = "session"
            dedup_window_hours = 6
        "#;
        let policy = TagPolicy::from_toml(body, "session").unwrap();
        assert_eq!(policy.dedup_window_hours, Some(6));
        assert!(policy.max_items_per_call.is_none());
        assert!(policy.include_superseded_default.is_none());
    }

    #[test]
    fn t1_1_include_superseded_default_round_trips_alone() {
        let body = r#"
            tag = "history"
            include_superseded_default = true
        "#;
        let policy = TagPolicy::from_toml(body, "history").unwrap();
        assert_eq!(policy.include_superseded_default, Some(true));
        assert!(policy.max_items_per_call.is_none());
        assert!(policy.dedup_window_hours.is_none());
    }

    #[test]
    fn t1_1_unknown_fields_dont_crash_deserialization() {
        // Neutral-dial invariant 4: unknown TOML fields (including future
        // T1.x dials authored by ahead-of-runtime seeds) must be tolerated.
        let body = r#"
            tag = "future"
            curriculum_level = "expert"
            mystery_dial = 42
            [unknown_table]
            anything = "goes"
        "#;
        let policy = TagPolicy::from_toml(body, "future").unwrap();
        assert_eq!(policy.tag, "future");
    }

    #[test]
    fn t1_1_merge_policies_takes_min_max_items_per_call() {
        let a = TagPolicy {
            tag: "a".into(),
            max_items_per_call: Some(10),
            ..TagPolicy::default()
        };
        let b = TagPolicy {
            tag: "b".into(),
            max_items_per_call: Some(3),
            ..TagPolicy::default()
        };
        let eff = merge_policies(&[a, b]);
        assert_eq!(eff.max_items_per_call, Some(3));
    }

    #[test]
    fn t1_1_merge_policies_min_dedup_window_hours() {
        let a = TagPolicy {
            tag: "a".into(),
            dedup_window_hours: Some(48),
            ..TagPolicy::default()
        };
        let b = TagPolicy {
            tag: "b".into(),
            dedup_window_hours: Some(6),
            ..TagPolicy::default()
        };
        let eff = merge_policies(&[a, b]);
        assert_eq!(eff.dedup_window_hours, Some(6));
    }

    #[test]
    fn t1_1_merge_policies_or_includes_superseded_default() {
        let a = TagPolicy {
            tag: "a".into(),
            include_superseded_default: Some(false),
            ..TagPolicy::default()
        };
        let b = TagPolicy {
            tag: "b".into(),
            include_superseded_default: Some(true),
            ..TagPolicy::default()
        };
        let eff = merge_policies(&[a, b]);
        assert!(eff.include_superseded_default);
    }

    #[test]
    fn t1_1_merge_policies_no_dials_set_keeps_neutral_effective() {
        // Baseline preservation: the effective policy is byte-identical to
        // an EffectivePolicy::default() when nobody opts in.
        let a = TagPolicy {
            tag: "a".into(),
            ..TagPolicy::default()
        };
        let b = TagPolicy {
            tag: "b".into(),
            ..TagPolicy::default()
        };
        let eff = merge_policies(&[a, b]);
        assert!(eff.max_items_per_call.is_none());
        assert!(eff.dedup_window_hours.is_none());
        assert!(!eff.include_superseded_default);
    }

    #[test]
    fn merge_policies_uses_non_default_time_context() {
        let a = TagPolicy {
            tag: "a".into(),
            time_context: "timeless".into(),
            ..TagPolicy::default()
        };
        let b = TagPolicy {
            tag: "b".into(),
            time_context: "state".into(),
            ..TagPolicy::default()
        };
        let eff = merge_policies(&[a, b]);
        assert_eq!(eff.time_context, "state");
    }
}
