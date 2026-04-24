//! Cheap microbench: compare ANN vs brute-force on a 1000-row embedding
//! store. Not a proper criterion harness — `cargo test --release
//! --test ann_bench -- --ignored --nocapture` prints timings. Left as
//! `#[ignore]` so it doesn't slow the default test loop.

use aeqi_core::traits::{Embedder, IdeaStore};
use aeqi_ideas::{SqliteIdeas, VectorStore};
use anyhow::Result;
use async_trait::async_trait;
use rusqlite::Connection;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tempfile::TempDir;

struct SeedEmbedder {
    dims: usize,
}

#[async_trait]
impl Embedder for SeedEmbedder {
    async fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let mut seed: u64 = 0xcbf29ce484222325;
        for b in text.as_bytes() {
            seed = seed.wrapping_mul(0x100000001b3).wrapping_add(*b as u64);
        }
        let mut out = Vec::with_capacity(self.dims);
        let mut s = seed | 1;
        for _ in 0..self.dims {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let f = ((s >> 32) as u32 as f32) / (u32::MAX as f32) - 0.5;
            out.push(f);
        }
        let n: f32 = out.iter().map(|x| x * x).sum::<f32>().sqrt();
        if n > 0.0 {
            for x in out.iter_mut() {
                *x /= n;
            }
        }
        Ok(out)
    }
    fn dimensions(&self) -> usize {
        self.dims
    }
}

#[ignore]
#[tokio::test]
async fn bench_ann_vs_brute_force_1000() {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("bench.db");
    let emb = Arc::new(SeedEmbedder { dims: 1536 });
    let ideas = SqliteIdeas::open(&db, 30.0)
        .unwrap()
        .with_embedder(emb.clone(), 1536, 0.6, 0.4, 0.7)
        .unwrap();

    let n = 1000usize;
    let t0 = Instant::now();
    for i in 0..n {
        let text = format!(
            "sample idea number {i} with some varying content text for the embedding"
        );
        ideas
            .store(
                &format!("idea-{i}"),
                &text,
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();
    }
    eprintln!("inserted {} ideas in {:?}", n, t0.elapsed());

    // Warm (first run also pays the ANN probe cost).
    let q = emb.embed("sample idea number 500").await.unwrap();

    // ANN path via VectorStore (direct, no pipeline overhead).
    let conn = Connection::open(&db).unwrap();
    let store_ann = VectorStore::new(Mutex::new(conn), 1536).unwrap();
    // Prime the atomic.
    let _ = store_ann.search(&q, 10).unwrap();
    let t_ann = Instant::now();
    let runs = 50;
    for _ in 0..runs {
        let _ = store_ann.search(&q, 10).unwrap();
    }
    let ann_avg = t_ann.elapsed() / runs;
    eprintln!("ANN avg query: {:?}", ann_avg);

    // Force the fallback: drop idea_vec so ANN marks itself unavailable.
    let conn2 = Connection::open(&db).unwrap();
    conn2
        .execute_batch(
            "DROP TRIGGER IF EXISTS idea_vec_sync_insert;
             DROP TRIGGER IF EXISTS idea_vec_sync_update;
             DROP TRIGGER IF EXISTS idea_vec_sync_delete;
             DROP TABLE IF EXISTS idea_vec;",
        )
        .unwrap();
    let store_bf = VectorStore::new(Mutex::new(conn2), 1536).unwrap();
    // First call marks ANN unavailable via the error branch.
    let _ = store_bf.search(&q, 10).unwrap();
    let t_bf = Instant::now();
    for _ in 0..runs {
        let _ = store_bf.search(&q, 10).unwrap();
    }
    let bf_avg = t_bf.elapsed() / runs;
    eprintln!("Brute-force avg query: {:?}", bf_avg);

    eprintln!(
        "speedup: ~{:.1}x (ANN {:?} vs BF {:?})",
        bf_avg.as_secs_f64() / ann_avg.as_secs_f64(),
        ann_avg,
        bf_avg
    );
}
