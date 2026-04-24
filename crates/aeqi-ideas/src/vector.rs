use anyhow::{Context, Result};
use rusqlite::Connection;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU8, Ordering};
use tracing::{debug, warn};

/// Per-VectorStore ANN availability cache. 0 = unknown, 1 = ready, 2 = unavailable.
static VS_ANN_STATE: AtomicU8 = AtomicU8::new(0);

/// Cosine similarity between two f32 vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom == 0.0 { 0.0 } else { dot / denom }
}

/// Serialize f32 vector to little-endian bytes for SQLite BLOB storage.
pub fn vec_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(v.len() * 4);
    for val in v {
        bytes.extend_from_slice(&val.to_le_bytes());
    }
    bytes
}

/// Deserialize f32 vector from little-endian bytes.
pub fn bytes_to_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Vector store backed by SQLite. Stores embeddings as BLOBs.
pub struct VectorStore {
    conn: Mutex<Connection>,
    dimensions: usize,
}

/// A vector search result.
#[derive(Debug, Clone)]
pub struct VectorResult {
    pub idea_id: String,
    pub similarity: f32,
}

impl VectorStore {
    /// Open or create the vector store (uses same DB as SqliteIdeas).
    pub fn open(conn: &Connection, _dimensions: usize) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS idea_embeddings (
                idea_id TEXT PRIMARY KEY,
                embedding BLOB NOT NULL,
                dimensions INTEGER NOT NULL,
                content_hash TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_idea_embeddings_id ON idea_embeddings(idea_id);",
        )
        .context("failed to create embeddings table")?;
        Ok(())
    }

    /// Create a new VectorStore from an existing connection.
    pub fn new(conn: Mutex<Connection>, dimensions: usize) -> Result<Self> {
        {
            let c = conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
            Self::open(&c, dimensions)?;
        }
        Ok(Self { conn, dimensions })
    }

    /// Store an embedding for an idea ID.
    pub fn store(&self, idea_id: &str, embedding: &[f32]) -> Result<()> {
        if embedding.len() != self.dimensions {
            anyhow::bail!(
                "embedding dimensions mismatch: expected {}, got {}",
                self.dimensions,
                embedding.len()
            );
        }

        let bytes = vec_to_bytes(embedding);
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        conn.execute(
            "INSERT OR REPLACE INTO idea_embeddings (idea_id, embedding, dimensions) VALUES (?1, ?2, ?3)",
            rusqlite::params![idea_id, bytes, self.dimensions as i64],
        )?;
        debug!(idea_id = %idea_id, "embedding stored");
        Ok(())
    }

    /// Delete an embedding.
    pub fn delete(&self, idea_id: &str) -> Result<()> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        conn.execute(
            "DELETE FROM idea_embeddings WHERE idea_id = ?1",
            rusqlite::params![idea_id],
        )?;
        Ok(())
    }

    /// Search for the top-k most similar embeddings to the query vector.
    /// Prefers the sqlite-vec `idea_vec` MATCH path; falls back to a
    /// brute-force scan when the extension isn't loaded or a runtime error
    /// bubbles up. `VS_ANN_STATE` caches the "unavailable" decision.
    pub fn search(&self, query: &[f32], top_k: usize) -> Result<Vec<VectorResult>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;

        if let Some(hits) = try_ann_search_unscoped(&conn, query, top_k) {
            return Ok(hits);
        }

        // Brute-force fallback.
        let mut stmt = conn.prepare("SELECT idea_id, embedding FROM idea_embeddings")?;

        let mut results: Vec<VectorResult> = stmt
            .query_map([], |row| {
                let idea_id: String = row.get(0)?;
                let bytes: Vec<u8> = row.get(1)?;
                Ok((idea_id, bytes))
            })?
            .filter_map(|r| r.ok())
            .map(|(idea_id, bytes)| {
                let embedding = bytes_to_vec(&bytes);
                let similarity = cosine_similarity(query, &embedding);
                VectorResult {
                    idea_id,
                    similarity,
                }
            })
            .collect();

        // Sort by similarity descending.
        results.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(top_k);

        Ok(results)
    }
}

/// Unscoped ANN query — VectorStore::search has no IdeaQuery context, so it
/// skips the agent-visibility filter. (The scope-aware path lives in
/// `sqlite/search.rs::try_ann_search`.) Returns None when ANN is unavailable.
fn try_ann_search_unscoped(
    conn: &Connection,
    query_vec: &[f32],
    top_k: usize,
) -> Option<Vec<VectorResult>> {
    if VS_ANN_STATE.load(Ordering::Relaxed) == 2 {
        return None;
    }

    let query_bytes = vec_to_bytes(query_vec);
    let k: i64 = (top_k as i64).saturating_mul(4).max(top_k as i64);
    let sql = "SELECT me.idea_id, me.embedding \
               FROM idea_vec iv \
               JOIN idea_embeddings me ON me.rowid = iv.rowid \
               WHERE iv.embedding MATCH ?1 AND iv.k = ?2 \
               ORDER BY iv.distance";
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => {
            debug!(error = %e, "VectorStore ANN prepare failed; falling back to brute-force");
            VS_ANN_STATE.store(2, Ordering::Relaxed);
            return None;
        }
    };

    let iter = match stmt.query_map(
        rusqlite::params![query_bytes, k],
        |row| {
            let id: String = row.get(0)?;
            let bytes: Vec<u8> = row.get(1)?;
            Ok((id, bytes))
        },
    ) {
        Ok(i) => i,
        Err(e) => {
            warn!(error = %e, "VectorStore ANN query failed; falling back to brute-force");
            VS_ANN_STATE.store(2, Ordering::Relaxed);
            return None;
        }
    };

    VS_ANN_STATE.store(1, Ordering::Relaxed);
    let mut hits: Vec<VectorResult> = iter
        .filter_map(|r| r.ok())
        .map(|(idea_id, bytes)| {
            let emb = bytes_to_vec(&bytes);
            let similarity = cosine_similarity(query_vec, &emb);
            VectorResult {
                idea_id,
                similarity,
            }
        })
        .collect();
    hits.sort_by(|a, b| {
        b.similarity
            .partial_cmp(&a.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(top_k);
    Some(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 1e-6);

        let c = vec![0.0, 1.0, 0.0];
        assert!(cosine_similarity(&a, &c).abs() < 1e-6);

        let d = vec![-1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &d) + 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_vec_serialization() {
        let v = vec![1.0f32, 2.5, -3.7, 0.0];
        let bytes = vec_to_bytes(&v);
        let restored = bytes_to_vec(&bytes);
        assert_eq!(v, restored);
    }

    #[test]
    fn test_vector_store() {
        let conn = Connection::open_in_memory().unwrap();
        VectorStore::open(&conn, 3).unwrap();
        let store = VectorStore::new(Mutex::new(conn), 3).unwrap();

        store.store("mem-1", &[1.0, 0.0, 0.0]).unwrap();
        store.store("mem-2", &[0.0, 1.0, 0.0]).unwrap();
        store.store("mem-3", &[0.9, 0.1, 0.0]).unwrap();

        let results = store.search(&[1.0, 0.0, 0.0], 2).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].idea_id, "mem-1"); // Most similar.
        assert_eq!(results[1].idea_id, "mem-3"); // Second most similar.
    }
}
