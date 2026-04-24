//! Persistent idea store with full-text search and vector similarity.
//!
//! Combines SQLite FTS5 keyword search ([`SqliteIdeas`]) with vector embeddings
//! ([`VectorStore`]) using Reciprocal Rank Fusion and MMR reranking ([`hybrid`]).
//!
//! Used by agent workers for long-term idea recall during task execution.

pub mod debounce;
pub mod dedup;
pub mod graph;
pub mod hybrid;
pub mod inline_links;
pub mod lifecycle;
pub mod obsidian;
pub mod redact;
pub mod sqlite;
pub mod ttl;
pub mod vector;

pub use hybrid::{ScoredResult, merge_scores, mmr_rerank};
pub use sqlite::SqliteIdeas;
pub use vector::{VectorStore, cosine_similarity};
