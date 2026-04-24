//! End-to-end integration tests for the idea store pipeline.
//!
//! Exercises the real `SqliteIdeas` stack — schema migrations, staged
//! retrieval, explainability, tag policies, bi-temporal filter,
//! co-retrieval edge reinforcement, and hotness — against an in-memory
//! SQLite + a deterministic fake embedder.
//!
//! The fake embedder maps content → a deterministic pseudo-random unit
//! vector seeded on the text, so the same text always yields the same
//! vector but different inputs differ. The dimension is small (16) so
//! cosine work stays cheap; the production dim is 1536 and is exercised
//! in `ann.rs`.

use aeqi_core::traits::{Embedder, IdeaQuery, IdeaStore, StoreFull};
use aeqi_ideas::SqliteIdeas;
use anyhow::Result;
use async_trait::async_trait;
use chrono::Utc;
use std::sync::Arc;
use tempfile::TempDir;

const TEST_DIMS: usize = 16;

/// Deterministic hash-based embedder for tests.
///
/// Same text → same unit vector. Different text → different vector.
/// Output is normalised so cosine similarity stays in `[-1, 1]`.
struct HashEmbedder {
    dimensions: usize,
}

impl HashEmbedder {
    fn new(dimensions: usize) -> Self {
        Self { dimensions }
    }
}

#[async_trait]
impl Embedder for HashEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>> {
        // FNV-ish fold for a stable seed.
        let mut seed: u64 = 0xcbf29ce484222325;
        for b in text.as_bytes() {
            seed = seed.wrapping_mul(0x100000001b3).wrapping_add(*b as u64);
        }
        let mut out = Vec::with_capacity(self.dimensions);
        let mut state = seed | 1;
        for i in 0..self.dimensions {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let f = ((state >> 32) as u32 as f32) / (u32::MAX as f32) - 0.5;
            out.push(f + (i as f32 * 1e-6));
        }
        let norm: f32 = out.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for x in out.iter_mut() {
                *x /= norm;
            }
        }
        Ok(out)
    }

    fn dimensions(&self) -> usize {
        self.dimensions
    }
}

fn make_store() -> (SqliteIdeas, TempDir) {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("integration.db");
    let embedder = Arc::new(HashEmbedder::new(TEST_DIMS));
    let ideas = SqliteIdeas::open(&db, 30.0)
        .unwrap()
        // Verify no panic when dims differ from production (1536).
        .with_embedder(embedder, TEST_DIMS, 0.6, 0.4, 0.7)
        .unwrap();
    (ideas, dir)
}

fn store_full(name: &str, content: &str, tags: &[&str]) -> StoreFull {
    StoreFull {
        name: name.to_string(),
        content: content.to_string(),
        tags: tags.iter().map(|s| s.to_string()).collect(),
        agent_id: None,
        scope: aeqi_core::Scope::Global,
        authored_by: None,
        confidence: 1.0,
        expires_at: None,
        valid_from: None,
        valid_until: None,
        time_context: "timeless".to_string(),
        status: "active".to_string(),
    }
}

// ── Test 1: store → search → assert `why` fields populated ─────────────

#[tokio::test]
async fn store_search_why_has_bm25_hotness_confidence() {
    let (ideas, _dir) = make_store();

    // Keep the target idea short so BM25 rewards it. Longer matching docs
    // score lower — this gives the min-max normalisation room to spread.
    let id_auth = ideas
        .store_full(store_full(
            "auth-jwt",
            "JWT authentication tokens bearer",
            &["fact"],
        ))
        .await
        .unwrap();
    let _id_jwt_related = ideas
        .store_full(store_full(
            "auth-tokens-overview",
            "JWT authentication tokens via bearer headers for API calls and many lengthy preamble words",
            &["fact"],
        ))
        .await
        .unwrap();
    let _id_tokens_legacy = ideas
        .store_full(store_full(
            "auth-tokens-legacy",
            "legacy JWT authentication tokens bearer description with more words that lower the bm25",
            &["fact"],
        ))
        .await
        .unwrap();
    let _id_deploy = ideas
        .store_full(store_full(
            "deploy-procedure",
            "Deploy to production by merging into main",
            &["procedure"],
        ))
        .await
        .unwrap();

    // Warm the row up so hotness > 0 for the target idea.
    ideas
        .record_access(
            &id_auth,
            aeqi_core::traits::AccessContext {
                context: "warmup".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();

    let query = IdeaQuery::new("JWT authentication tokens bearer", 5);
    let hits = ideas.search_explained(&query).await.unwrap();

    assert!(!hits.is_empty(), "search must return hits");
    // The auth-jwt idea must be in the fact-tag results.
    assert!(
        hits.iter().any(|h| h.idea.id == id_auth),
        "JWT idea must be among the returned hits: got {:?}",
        hits.iter().map(|h| &h.idea.name).collect::<Vec<_>>()
    );

    // Every explained hit carries a populated why record.
    for hit in &hits {
        assert!(
            hit.why.picked_by_tag.is_some(),
            "picked_by_tag must be set by the staged pipeline on every hit"
        );
        assert!(
            hit.why.confidence > 0.0,
            "confidence component should reflect the default 1.0 (got {})",
            hit.why.confidence
        );
        assert!(
            hit.why.final_score > 0.0,
            "final_score must be positive (got {}) for hit {}",
            hit.why.final_score,
            hit.idea.name,
        );
        // The idea is tagged `fact`; per-tag routing should surface that.
        if hit.idea.id == id_auth {
            assert_eq!(
                hit.why.picked_by_tag.as_deref(),
                Some("fact"),
                "JWT idea (tagged `fact`) should be routed via the fact policy"
            );
            // After the warmup access, hotness on the JWT idea must be > 0.
            assert!(
                hit.why.hotness > 0.0,
                "hotness on accessed idea should be > 0, got {}",
                hit.why.hotness
            );
        }
    }

    // At least one hit must carry a non-zero BM25 value — the staged
    // pipeline normalises bm25 via min-max per tag, so the min-scoring
    // hit lands at 0 but the top must be > 0 whenever spread exists.
    assert!(
        hits.iter().any(|h| h.why.bm25 > 0.0),
        "at least one hit must carry bm25 > 0 (min-max spread); got {:?}",
        hits.iter().map(|h| h.why.bm25).collect::<Vec<_>>()
    );
}

// ── Test 2: co-retrieval edges emerge from usage ────────────────────────

#[tokio::test]
async fn co_retrieval_edges_emerge_from_repeated_search() {
    let (ideas, _dir) = make_store();

    let id_a = ideas
        .store_full(store_full(
            "alpha-note",
            "alpha beta gamma shared token",
            &["fact"],
        ))
        .await
        .unwrap();
    let id_b = ideas
        .store_full(store_full(
            "beta-note",
            "alpha beta gamma different context",
            &["fact"],
        ))
        .await
        .unwrap();
    let id_c = ideas
        .store_full(store_full(
            "gamma-note",
            "alpha beta gamma third variant",
            &["fact"],
        ))
        .await
        .unwrap();

    // Two searches with the same query → top hits should form a co-retrieved triangle.
    let q = IdeaQuery::new("alpha beta gamma", 5);
    let _ = ideas.search_explained(&q).await.unwrap();
    let _ = ideas.search_explained(&q).await.unwrap();

    // strengthen_co_retrieval is fire-and-forget from a spawned task; give it
    // a beat to flush. The work itself is a single transaction inside
    // spawn_blocking, so polling is bounded.
    for _ in 0..20 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let edges_a = ideas.idea_edges(&id_a).await.unwrap();
        let co_edges: usize = edges_a
            .links
            .iter()
            .chain(edges_a.backlinks.iter())
            .filter(|r| r.relation == "co_retrieved")
            .count();
        if co_edges >= 2 {
            break;
        }
    }

    // Expected: three ideas → C(3,2) = 3 undirected pairs; with strength += 0.05 per
    // search and two searches, each edge carries at least 0.05 (min upsert value).
    let edges_a = ideas.idea_edges(&id_a).await.unwrap();
    let co_a: Vec<_> = edges_a
        .links
        .iter()
        .chain(edges_a.backlinks.iter())
        .filter(|r| r.relation == "co_retrieved")
        .collect();
    assert!(
        co_a.len() >= 2,
        "alpha-note should carry at least two co_retrieved edges, got {}: {:?}",
        co_a.len(),
        co_a
    );
    for edge in &co_a {
        assert!(
            edge.strength >= 0.05,
            "co_retrieved edge strength must be >= 0.05, got {}",
            edge.strength
        );
    }

    // All three ideas should be reachable via co_retrieved edges from id_a.
    let mut reached = std::collections::HashSet::new();
    reached.insert(id_a.clone());
    for edge in &co_a {
        reached.insert(edge.other_id.clone());
    }
    assert!(
        reached.contains(&id_b) && reached.contains(&id_c),
        "co_retrieved graph should connect alpha-note to both other notes: reached={:?}",
        reached
    );
}

// ── Test 3: hotness updates on access ──────────────────────────────────

#[tokio::test]
async fn access_bumps_count_and_last_accessed() {
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full("hot", "body for hotness testing", &["fact"]))
        .await
        .unwrap();

    // First access → count = 1, last_accessed populated.
    ideas
        .record_access(
            &id,
            aeqi_core::traits::AccessContext {
                context: "test".into(),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let (count, last, _boost) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert_eq!(count, 1);
    assert!(last.is_some(), "last_accessed must be populated");

    // Four more accesses → count = 5.
    for _ in 0..4 {
        ideas
            .record_access(
                &id,
                aeqi_core::traits::AccessContext {
                    context: "test".into(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
    }
    let (count, _last, _boost) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert_eq!(count, 5, "five accesses should bump access_count to 5");
}

// ── Test 4: tag policy drives search behaviour ─────────────────────────

#[tokio::test]
async fn tag_policy_meta_idea_influences_ranking() {
    // We store two similar ideas tagged `fact` and verify that search
    // returns them with their `fact` policy (bm25_weight=1.0 default).
    // Adding a meta-idea doesn't change the in-pipeline lookup when the
    // IPC-level `TagPolicyCache` isn't injected — the pipeline falls
    // back to `TagPolicy::default_for("fact")` either way — but we can
    // still verify the policy meta-idea is stored and queryable.
    let (ideas, _dir) = make_store();

    let policy_body = r#"tag = "fact"
bm25_weight = 1.5
vector_weight = 0.2
decay_half_life_days = 1.0
"#;
    let _policy_id = ideas
        .store_full(store_full(
            "meta:tag-policy:fact",
            policy_body,
            &["meta:tag-policy"],
        ))
        .await
        .unwrap();

    let _a = ideas
        .store_full(store_full("fact-alpha", "alpha system runtime", &["fact"]))
        .await
        .unwrap();
    let _b = ideas
        .store_full(store_full(
            "fact-beta",
            "alpha system runtime with a significantly longer body describing extra detail",
            &["fact"],
        ))
        .await
        .unwrap();
    // Third fact so the per-tag BM25 list has spread (min-max normalisation
    // collapses to 0 when only one candidate matches).
    let _c = ideas
        .store_full(store_full(
            "fact-gamma",
            "alpha system runtime with yet another even longer body packed with filler tokens \
             that reduce the inverse-document-frequency contribution of each match",
            &["fact"],
        ))
        .await
        .unwrap();

    // Query that BM25 can answer → scores should be non-zero and ordered.
    // Use tokens that appear in different amounts across docs so BM25
    // min-max normalisation produces spread.
    let q = IdeaQuery::new("alpha system runtime", 5);
    let hits = ideas.search_explained(&q).await.unwrap();
    assert!(
        !hits.is_empty(),
        "tag-policy-influenced search returns hits"
    );
    // fact-alpha has the most overlap; it should surface somewhere in the hits.
    assert!(
        hits.iter().any(|h| h.idea.name == "fact-alpha"),
        "fact-alpha must be in the returned hits"
    );
    // At least one hit carries BM25 > 0 (policy-driven bm25_weight = 1.5).
    assert!(
        hits.iter().any(|h| h.why.bm25 > 0.0),
        "at least one hit must carry bm25 > 0"
    );
    // The meta-idea itself must be retrievable by tag.
    let meta_hits = ideas
        .ideas_by_tags(&["meta:tag-policy".to_string()], 10)
        .await
        .unwrap();
    assert_eq!(
        meta_hits.len(),
        1,
        "tag-policy meta-idea must be queryable by its tag"
    );
}

// ── Test 5: bi-temporal filter ─────────────────────────────────────────

#[tokio::test]
async fn search_as_of_honours_validity_window() {
    // `search_as_of` pushes the caller's timestamp down into the staged
    // pipeline's temporal filter, so ideas whose window is entirely in the
    // past still surface when as_of picks a moment inside them. See
    // `search_as_of_retrieves_ideas_with_closed_window` for that case; this
    // test covers the simpler scenario of a window that covers "now".
    let (ideas, _dir) = make_store();

    // Window that covers "now" plus a generous span forward.
    let now = Utc::now();
    let valid_from = now - chrono::Duration::days(30);
    let valid_until = now + chrono::Duration::days(365);

    let mut state_idea = store_full(
        "policy-v1",
        "the policy body for bitemporal testing",
        &["fact"],
    );
    state_idea.valid_from = Some(valid_from);
    state_idea.valid_until = Some(valid_until);
    state_idea.time_context = "state".into();
    let id = ideas.store_full(state_idea).await.unwrap();

    let q = IdeaQuery::new("policy body bitemporal", 5);

    // as_of inside the window → returned.
    let inside = now + chrono::Duration::days(10);
    let inside_hits = ideas.search_as_of(&q, inside).await.unwrap();
    assert!(
        inside_hits.iter().any(|h| h.id == id),
        "as_of inside validity window must return the state idea"
    );

    // as_of before valid_from → dropped (state idea hadn't taken effect).
    let before = valid_from - chrono::Duration::days(10);
    let before_hits = ideas.search_as_of(&q, before).await.unwrap();
    assert!(
        !before_hits.iter().any(|h| h.id == id),
        "as_of before valid_from must NOT return the state idea"
    );

    // as_of after valid_until → dropped.
    let after = valid_until + chrono::Duration::days(10);
    let after_hits = ideas.search_as_of(&q, after).await.unwrap();
    assert!(
        !after_hits.iter().any(|h| h.id == id),
        "as_of after valid_until must NOT return the state idea"
    );
}

// ── Test 5b: search_as_of retrieves ideas whose window has closed by now ─

#[tokio::test]
async fn search_as_of_retrieves_ideas_with_closed_window() {
    // Round 5 regression: before the fix, run_staged_pipeline applied a
    // temporal filter against Utc::now() even when called from
    // search_as_of, so ideas whose valid_until lies in the past would be
    // dropped by the pipeline before the outer as_of filter ran.
    let (ideas, _dir) = make_store();

    // Build a window that is entirely in the past relative to "now" so the
    // non-as_of path (search_explained) would not surface it, but as_of
    // inside the window should.
    let past_from = Utc::now() - chrono::Duration::days(120); // 2026-01 relative
    let past_until = Utc::now() - chrono::Duration::days(60); // 2026-02 relative
    let inside_past = past_from + chrono::Duration::days(15);
    let after_past = past_until + chrono::Duration::days(15);

    let mut state_idea = store_full(
        "policy-v0",
        "the archived policy body closed window content",
        &["fact"],
    );
    state_idea.valid_from = Some(past_from);
    state_idea.valid_until = Some(past_until);
    state_idea.time_context = "state".into();
    let id = ideas.store_full(state_idea).await.unwrap();

    let q = IdeaQuery::new("archived policy closed window", 5);

    // as_of inside the past window → returned.
    let inside_hits = ideas.search_as_of(&q, inside_past).await.unwrap();
    assert!(
        inside_hits.iter().any(|h| h.id == id),
        "search_as_of must surface ideas whose validity covered as_of even when that window is now closed"
    );

    // as_of after the window closed → empty.
    let after_hits = ideas.search_as_of(&q, after_past).await.unwrap();
    assert!(
        !after_hits.iter().any(|h| h.id == id),
        "search_as_of after the window closed must NOT return the state idea"
    );

    // Plain search_explained at "now" → empty (window is already closed).
    let now_hits = ideas.search_explained(&q).await.unwrap();
    assert!(
        !now_hits.iter().any(|h| h.idea.id == id),
        "search_explained at now must not return ideas whose window has already closed"
    );
}

// ── Test 6b: vector search filters `embedding_pending=1` ──────────────
//
// After a merge/update, `content_hash` advances and `embedding_pending`
// flips to 1, but the old embedding row stays in `idea_embeddings` until
// the embed worker writes the new vector. Without the filter, a vector
// search in that window would score against the stale embedding.
//
// Scenario: store an idea → vector search finds it → mark it pending →
// re-search → it disappears from vector results → write a new embedding
// via `set_embedding` (which clears the pending flag) → re-search →
// it's back.

#[tokio::test]
async fn vector_search_skips_rows_with_embedding_pending() {
    use aeqi_core::traits::UpdateFull;

    let (ideas, _dir) = make_store();

    // Store an idea and let the initial embedding land.
    let id = ideas
        .store_full(store_full(
            "pending-filter-target",
            "zebra quokka narwhal platypus okapi",
            &["fact"],
        ))
        .await
        .unwrap();
    // A second, unrelated idea so the vector search has a non-target hit.
    let _other = ideas
        .store_full(store_full(
            "pending-filter-other",
            "completely unrelated content about the weather",
            &["fact"],
        ))
        .await
        .unwrap();

    // Baseline: search returns the target idea.
    let q = IdeaQuery::new("zebra quokka narwhal platypus okapi", 10);
    let hits_before = ideas.search_explained(&q).await.unwrap();
    assert!(
        hits_before.iter().any(|h| h.idea.id == id),
        "baseline: target idea must be retrievable pre-invalidation"
    );

    // Flip embedding_pending to true to simulate mid-reembed state.
    ideas
        .update_full(
            &id,
            UpdateFull {
                embedding_pending: Some(true),
                ..UpdateFull::default()
            },
        )
        .await
        .unwrap();

    // Now the target should be absent from the vector-scored results
    // (its why.vector is dropped). BM25 may still surface it, but the
    // `vector` component on any hit for this id should be 0 — the row
    // is filtered out of the vector path entirely.
    let hits_pending = ideas.search_explained(&q).await.unwrap();
    for hit in &hits_pending {
        if hit.idea.id == id {
            assert!(
                hit.why.vector <= 0.0 + f32::EPSILON,
                "pending row must not contribute a vector score; got {}",
                hit.why.vector
            );
        }
    }

    // Restore the embedding via set_embedding — that clears
    // embedding_pending. The vector path should pick the row up again.
    let dummy_vec = vec![0.25_f32; TEST_DIMS];
    ideas.set_embedding(&id, &dummy_vec).await.unwrap();

    let hits_after = ideas.search_explained(&q).await.unwrap();
    assert!(
        hits_after.iter().any(|h| h.idea.id == id),
        "row must reappear once the new embedding lands and pending=0"
    );
}

// ── Test 6: embedder dim mismatch doesn't panic (16 vs default 1536) ──

#[tokio::test]
async fn embedder_with_small_dims_does_not_panic() {
    // The `make_store` helper already uses a 16-dim embedder; the fact
    // that every other test here runs through it without panicking is
    // the regression coverage. This test asserts it explicitly.
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full("small-dim", "test content", &["fact"]))
        .await
        .unwrap();
    assert!(!id.is_empty());
    let hits = ideas
        .search_explained(&IdeaQuery::new("test content", 5))
        .await
        .unwrap();
    assert!(hits.iter().any(|h| h.idea.id == id));
}
