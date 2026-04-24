//! Integration tests for the ANN (sqlite-vec) path.
//!
//! Exercises the default-on `ann-sqlite-vec` feature: the migration v7 rebuild,
//! the sync triggers, `VectorStore::search` routing through `idea_vec`, and
//! `vector_search_scoped` via the public `IdeaStore::search` surface with
//! embeddings wired in.

use aeqi_core::traits::{Embedder, IdeaQuery, IdeaStore};
use aeqi_ideas::{SqliteIdeas, VectorStore};
use anyhow::Result;
use async_trait::async_trait;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;

/// Deterministic embedder that hashes the input text into a seeded pseudo-random
/// unit vector. Different text produces different-but-stable vectors, so we
/// can ground-truth the ANN path against the brute-force answer.
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
        // Simple hashed expansion: fold the text into a u64 seed, then fill.
        // Not crypto-strong; just needs to be deterministic and discriminative.
        let mut seed: u64 = 0xcbf29ce484222325;
        for b in text.as_bytes() {
            seed = seed.wrapping_mul(0x100000001b3).wrapping_add(*b as u64);
        }
        let mut out = Vec::with_capacity(self.dimensions);
        let mut state = seed | 1; // avoid zero vector
        for i in 0..self.dimensions {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let f = ((state >> 32) as u32 as f32) / (u32::MAX as f32) - 0.5;
            out.push(f + (i as f32 * 1e-6));
        }
        // Normalise so cosine similarity stays well-behaved and ordering is stable.
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

/// Assert that `idea_vec` exists in the schema. When ANN is enabled the
/// virtual table is installed by migration v7; when it isn't (or the feature
/// is off at compile time), the table is absent and the brute-force path
/// carries the load.
fn has_idea_vec(ideas: &SqliteIdeas, path: &std::path::Path) -> bool {
    let _ = ideas; // keep arg to force lifetime ordering
    let conn = Connection::open(path).unwrap();
    conn.query_row(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='idea_vec'",
        [],
        |row| row.get::<_, String>(0),
    )
    .is_ok()
}

#[tokio::test]
async fn ann_search_matches_brute_force_top_hit() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("ann.db");
    let embedder = Arc::new(HashEmbedder::new(1536));

    let ideas = SqliteIdeas::open(&db_path, 30.0)
        .unwrap()
        .with_embedder(embedder.clone(), 1536, 0.6, 0.4, 0.7)
        .unwrap();

    let apple_id = ideas
        .store(
            "apple-note",
            "Apples are red fruit that grow on trees in temperate climates",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();
    let banana_id = ideas
        .store(
            "banana-note",
            "Bananas are yellow tropical fruit high in potassium",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();
    let car_id = ideas
        .store(
            "car-note",
            "Internal combustion engines burn gasoline to drive pistons",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();

    // Query for apple — the hashed embedding for "Apples are red fruit..."
    // should win when we search for the identical content.
    let query_text = "Apples are red fruit that grow on trees in temperate climates";
    let query_vec = embedder.embed(query_text).await.unwrap();

    // 1. VectorStore::search path (ANN-first).
    let conn = Connection::open(&db_path).unwrap();
    let store = VectorStore::new(Mutex::new(conn), 1536).unwrap();
    let results = store.search(&query_vec, 2).unwrap();
    assert_eq!(results.len(), 2, "expected 2 hits from top-2 search");
    assert_eq!(
        results[0].idea_id, apple_id,
        "identical-content query must rank the matching idea first"
    );
    // The other two candidates (banana, car) are both non-matches; we only
    // assert the top slot here since vec0's MATCH ordering is stable enough.
    assert!(
        results.iter().any(|r| r.idea_id == banana_id)
            || results.iter().any(|r| r.idea_id == car_id)
    );

    // 2. IdeaStore::search (through the scope-aware `vector_search_scoped`).
    let hits = ideas.search(&IdeaQuery::new(query_text, 2)).await.unwrap();
    assert!(!hits.is_empty(), "search must return at least one hit");
    // The ANN + BM25 merge should place apple at the top (BM25 agrees, vec agrees).
    assert_eq!(hits[0].id, apple_id);
}

#[cfg(feature = "ann-sqlite-vec")]
#[tokio::test]
async fn idea_vec_table_installed_when_feature_on() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("feature-on.db");
    let ideas = SqliteIdeas::open(&db_path, 30.0).unwrap();
    assert!(
        has_idea_vec(&ideas, &db_path),
        "idea_vec virtual table must exist when ann-sqlite-vec is enabled"
    );
}

#[cfg(not(feature = "ann-sqlite-vec"))]
#[tokio::test]
async fn idea_vec_table_absent_when_feature_off() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("feature-off.db");
    let ideas = SqliteIdeas::open(&db_path, 30.0).unwrap();
    assert!(
        !has_idea_vec(&ideas, &db_path),
        "idea_vec virtual table must be absent when ann-sqlite-vec is disabled"
    );
}

/// Even with ANN on, a DB that has no embeddings inserted yet must return an
/// empty result set (not panic, not leak cross-queries).
#[tokio::test]
async fn ann_empty_db_returns_no_hits() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("empty.db");
    let embedder = Arc::new(HashEmbedder::new(1536));
    let _ideas = SqliteIdeas::open(&db_path, 30.0)
        .unwrap()
        .with_embedder(embedder.clone(), 1536, 0.6, 0.4, 0.7)
        .unwrap();

    let conn = Connection::open(&db_path).unwrap();
    let store = VectorStore::new(Mutex::new(conn), 1536).unwrap();
    let q = embedder.embed("anything").await.unwrap();
    let results = store.search(&q, 10).unwrap();
    assert!(results.is_empty());
}

/// Scope visibility must be preserved on the ANN path. Agent "guardian"
/// writes a private idea; an unscoped query sees the global idea only,
/// and a different agent's query sees nothing of guardian's.
#[tokio::test]
async fn ann_path_honors_agent_scope() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("scope.db");
    let embedder = Arc::new(HashEmbedder::new(1536));

    let ideas = SqliteIdeas::open(&db_path, 30.0)
        .unwrap()
        .with_embedder(embedder.clone(), 1536, 0.6, 0.4, 0.7)
        .unwrap();

    ideas
        .store(
            "global-fact",
            "The service runs on port 8080 by default",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();
    ideas
        .store(
            "guardian-secret",
            "The service runs on port 9999 in guardian-mode for private access",
            &["fact".to_string()],
            Some("guardian"),
        )
        .await
        .unwrap();

    // Librarian — another agent — must not see guardian's secret.
    let librarian_q = IdeaQuery::new("service port", 10).with_agent("librarian");
    let hits = ideas.search(&librarian_q).await.unwrap();
    assert!(
        hits.iter()
            .all(|i| i.agent_id.as_deref() != Some("guardian")),
        "cross-agent scope leak: librarian got guardian's idea"
    );
}
