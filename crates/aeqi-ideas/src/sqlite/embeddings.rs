//! Embedding-side helpers for the SQLite idea store.
//!
//! Vector persistence itself lives in [`crate::vector::VectorStore`]. This
//! module holds the thin helpers that bind vectors back to ideas: SHA256
//! content fingerprinting for cache lookups, and the cache-lookup query
//! against `idea_embeddings`.

use super::SqliteIdeas;
use rusqlite::Connection;

impl SqliteIdeas {
    /// Compute SHA256 hash of content for embedding cache lookup.
    pub(super) fn content_hash(content: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Look up a cached embedding by content hash.
    /// Returns the embedding bytes if a match exists, None otherwise.
    pub(super) fn lookup_embedding_by_hash(conn: &Connection, hash: &str) -> Option<Vec<u8>> {
        conn.query_row(
            "SELECT embedding FROM idea_embeddings WHERE content_hash = ?1 LIMIT 1",
            rusqlite::params![hash],
            |row| row.get(0),
        )
        .ok()
    }
}
