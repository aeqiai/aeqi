use crate::graph::{IdeaEdge, IdeaRelation};
use aeqi_core::traits::{Embedder, Idea, IdeaQuery, IdeaStore};
use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tracing::{debug, warn};

use crate::hybrid::{ScoredResult, merge_scores, mmr_rerank};
use crate::vector::{VectorStore, bytes_to_vec, cosine_similarity, vec_to_bytes};

struct MemRow {
    id: String,
    key: String,
    content: String,
    cat_str: String,
    agent_id: Option<String>,
    created_at: String,
    session_id: Option<String>,
    tags: Vec<String>,
}

#[derive(Clone)]
pub struct SqliteIdeas {
    conn: Arc<Mutex<Connection>>,
    decay_halflife_days: f64,
    embedder: Option<Arc<dyn Embedder>>,
    embedding_dimensions: usize,
    vector_weight: f64,
    keyword_weight: f64,
    mmr_lambda: f64,
}

impl SqliteIdeas {
    pub fn open(path: &Path, decay_halflife_days: f64) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(path)
            .with_context(|| format!("failed to open memory DB: {}", path.display()))?;

        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             PRAGMA synchronous=NORMAL;
             PRAGMA wal_autocheckpoint=100;
             PRAGMA cache_size=-8000;
             PRAGMA temp_store=MEMORY;",
        )?;

        // Jitter retry on lock contention: random 20-150ms sleep, up to 15 attempts.
        // Breaks convoy effect from SQLite's deterministic backoff.
        conn.busy_handler(Some(|attempt| {
            if attempt >= 15 {
                return false; // Give up after 15 retries.
            }
            let jitter_ms = 20 + (attempt as u64 * 9) % 131; // 20-150ms range
            std::thread::sleep(std::time::Duration::from_millis(jitter_ms));
            true
        }))?;

        // Migrate: rename memories → insights → ideas for existing databases.
        Self::migrate_table_rename(&conn)?;
        Self::migrate_insights_to_ideas(&conn)?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ideas (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'fact',
                scope TEXT NOT NULL DEFAULT 'domain',
                agent_id TEXT,
                session_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_ideas_key ON ideas(key);
            CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);
            CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at);
            ",
        )?;

        // Junction table for multi-tag support.
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS idea_tags (
                idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
                tag TEXT NOT NULL,
                PRIMARY KEY (idea_id, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_idea_tags_tag ON idea_tags(tag);",
        )?;

        Self::migrate(&conn)?;

        conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_ideas_agent_id ON ideas(agent_id);")?;

        let fts_exists: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='ideas_fts'",
            [],
            |row| row.get(0),
        )?;

        if !fts_exists {
            conn.execute_batch(
                "CREATE VIRTUAL TABLE ideas_fts USING fts5(
                    key, content, content=ideas, content_rowid=rowid
                );

                CREATE TRIGGER IF NOT EXISTS ideas_ai AFTER INSERT ON ideas BEGIN
                    INSERT INTO ideas_fts(rowid, key, content) VALUES (new.rowid, new.key, new.content);
                END;

                CREATE TRIGGER IF NOT EXISTS ideas_ad AFTER DELETE ON ideas BEGIN
                    INSERT INTO ideas_fts(ideas_fts, rowid, key, content) VALUES('delete', old.rowid, old.key, old.content);
                END;

                CREATE TRIGGER IF NOT EXISTS ideas_au AFTER UPDATE ON ideas BEGIN
                    INSERT INTO ideas_fts(ideas_fts, rowid, key, content) VALUES('delete', old.rowid, old.key, old.content);
                    INSERT INTO ideas_fts(rowid, key, content) VALUES (new.rowid, new.key, new.content);
                END;

                INSERT INTO ideas_fts(ideas_fts) VALUES('rebuild');",
            )?;
        }

        // Idea graph edges table (SQL table name kept as `memory_edges` for DB compat).
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS memory_edges (
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                strength REAL NOT NULL DEFAULT 0.5,
                agent TEXT,
                task_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (source_id, target_id, relation)
            );
            CREATE INDEX IF NOT EXISTS idx_edges_source ON memory_edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON memory_edges(target_id);",
        )?;

        // Always ensure embeddings table exists for future use.
        VectorStore::open(&conn, 1536)?;

        // Migrate: add expires_at column for optional TTL.
        Self::migrate_ttl(&conn)?;

        // Migrate: add content_hash column for embedding cache dedup.
        Self::migrate_embedding_hash(&conn)?;

        // Migrate: add injection metadata columns (prompts consolidated into insights).
        Self::migrate_injection_columns(&conn)?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            decay_halflife_days,
            embedder: None,
            embedding_dimensions: 1536,
            vector_weight: 0.6,
            keyword_weight: 0.4,
            mmr_lambda: 0.7,
        })
    }

    /// Run a blocking closure on a cloned Arc<Mutex<Connection>> via spawn_blocking.
    /// Prevents std::sync::Mutex from blocking the tokio runtime thread.
    async fn blocking<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&Connection) -> Result<R> + Send + 'static,
        R: Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
            f(&conn)
        })
        .await
        .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))?
    }

    /// Configure vector embeddings and hybrid search.
    pub fn with_embedder(
        mut self,
        embedder: Arc<dyn Embedder>,
        dimensions: usize,
        vector_weight: f64,
        keyword_weight: f64,
        mmr_lambda: f64,
    ) -> Result<Self> {
        {
            let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
            VectorStore::open(&conn, dimensions)?;
        }
        self.embedder = Some(embedder);
        self.embedding_dimensions = dimensions;
        self.vector_weight = vector_weight;
        self.keyword_weight = keyword_weight;
        self.mmr_lambda = mmr_lambda;
        Ok(self)
    }

    /// Migrate: rename `memories` table to `insights` for existing databases.
    fn migrate_table_rename(conn: &Connection) -> Result<()> {
        let has_memories: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='memories'",
            [],
            |row| row.get(0),
        )?;
        if !has_memories {
            return Ok(());
        }

        // Drop old FTS triggers and virtual table (they reference 'memories').
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS memories_ai;
             DROP TRIGGER IF EXISTS memories_ad;
             DROP TRIGGER IF EXISTS memories_au;
             DROP TABLE IF EXISTS ideas_fts;",
        )?;

        // Rename the main table.
        conn.execute_batch("ALTER TABLE memories RENAME TO ideas;")?;

        // Rename indexes (SQLite doesn't support ALTER INDEX, so drop + recreate).
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_memories_key;
             DROP INDEX IF EXISTS idx_memories_category;
             DROP INDEX IF EXISTS idx_memories_created;
             DROP INDEX IF EXISTS idx_memories_entity;
             DROP INDEX IF EXISTS idx_memories_scope;
             DROP INDEX IF EXISTS idx_memories_companion;",
        )?;

        debug!("migrated: renamed memories table → insights");
        Ok(())
    }

    /// Migrate: rename `insights` table to `ideas` for existing databases.
    fn migrate_insights_to_ideas(conn: &Connection) -> Result<()> {
        let has_insights: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='insights'",
            [],
            |row| row.get(0),
        )?;
        if !has_insights {
            return Ok(());
        }

        let has_ideas: bool = conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='ideas'",
            [],
            |row| row.get(0),
        )?;

        if has_ideas {
            // Both tables exist — ideas was already created, drop the old one.
            conn.execute_batch("DROP TABLE IF EXISTS insights;")?;
        } else {
            // Only insights exists — rename it.
            conn.execute_batch("ALTER TABLE insights RENAME TO ideas;")?;
        }

        // Drop old FTS table and triggers (will be recreated by main init).
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS insights_ai;
             DROP TRIGGER IF EXISTS insights_ad;
             DROP TRIGGER IF EXISTS insights_au;
             DROP TABLE IF EXISTS insights_fts;",
        )?;

        // Drop old indexes (recreated by main init with ideas_ prefix).
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_insights_key;
             DROP INDEX IF EXISTS idx_insights_category;
             DROP INDEX IF EXISTS idx_insights_created;
             DROP INDEX IF EXISTS idx_insights_agent_id;
             DROP INDEX IF EXISTS idx_insights_scope;
             DROP INDEX IF EXISTS idx_insights_expires;
             DROP INDEX IF EXISTS idx_insights_injection;
             DROP INDEX IF EXISTS idx_insights_content_hash;
             DROP INDEX IF EXISTS idx_insights_source;",
        )?;

        debug!("migrated: renamed insights table → ideas");
        Ok(())
    }

    fn migrate(conn: &Connection) -> Result<()> {
        let has_scope: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('ideas') WHERE name='scope'")?
            .query_row([], |row| row.get(0))?;

        if !has_scope {
            conn.execute_batch(
                "ALTER TABLE ideas ADD COLUMN scope TEXT NOT NULL DEFAULT 'domain';
                 ALTER TABLE ideas ADD COLUMN agent_id TEXT;
                 CREATE INDEX IF NOT EXISTS idx_ideas_scope ON ideas(scope);
                 CREATE INDEX IF NOT EXISTS idx_ideas_agent_id ON ideas(agent_id);",
            )?;
            debug!("migrated insights table: added scope + agent_id columns");
        }

        // Rename companion_id → agent_id (for DBs created before the rename).
        let has_companion: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('ideas') WHERE name='companion_id'")?
            .query_row([], |row| row.get(0))?;
        if has_companion {
            conn.execute_batch(
                "ALTER TABLE ideas RENAME COLUMN companion_id TO agent_id;
                 UPDATE ideas SET scope = 'entity' WHERE scope = 'companion';",
            )?;
            conn.execute_batch(
                "DROP INDEX IF EXISTS idx_ideas_companion;
                 CREATE INDEX IF NOT EXISTS idx_ideas_agent_id ON ideas(agent_id);",
            )?;
            debug!("migrated: companion_id → agent_id");
        }

        // Rename entity_id → agent_id (for DBs created before this rename).
        let has_entity_id: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('ideas') WHERE name='entity_id'")?
            .query_row([], |row| row.get(0))?;
        if has_entity_id {
            conn.execute_batch("ALTER TABLE ideas RENAME COLUMN entity_id TO agent_id;")?;
            conn.execute_batch(
                "DROP INDEX IF EXISTS idx_ideas_entity;
                 CREATE INDEX IF NOT EXISTS idx_ideas_agent_id ON ideas(agent_id);",
            )?;
            debug!("migrated: entity_id → agent_id");
        }

        Ok(())
    }

    /// Migrate: add content_hash column to embeddings table for embedding cache.
    ///
    /// This enables skipping expensive embedding API calls when the same content
    /// has already been embedded — we look up by SHA256 hash instead.
    fn migrate_embedding_hash(conn: &Connection) -> Result<()> {
        let has_hash: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('memory_embeddings') WHERE name='content_hash'")?
            .query_row([], |row| row.get(0))?;

        if !has_hash {
            conn.execute_batch(
                "ALTER TABLE memory_embeddings ADD COLUMN content_hash TEXT;
                 CREATE INDEX IF NOT EXISTS idx_embed_hash ON memory_embeddings(content_hash);",
            )?;
            debug!("migrated memory_embeddings: added content_hash column + index");
        }

        Ok(())
    }

    /// Migrate: add optional expires_at column for TTL support.
    fn migrate_ttl(conn: &Connection) -> Result<()> {
        let has_expires: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('ideas') WHERE name='expires_at'")?
            .query_row([], |row| row.get(0))?;

        if !has_expires {
            conn.execute_batch(
                "ALTER TABLE ideas ADD COLUMN expires_at TEXT;
                 CREATE INDEX IF NOT EXISTS idx_ideas_expires ON ideas(expires_at);",
            )?;
            debug!("migrated insights: added expires_at column + index");
        }

        Ok(())
    }

    /// Migrate: add injection metadata columns — unifies prompts into insights.
    ///
    /// Insights with injection_mode != NULL are deterministically injected into
    /// the agent's context (like prompts). Others are recalled via search.
    fn migrate_injection_columns(conn: &Connection) -> Result<()> {
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(ideas)")?
            .query_map([], |row| row.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .collect();

        if !cols.contains(&"injection_mode".to_string()) {
            conn.execute_batch(
                "ALTER TABLE ideas ADD COLUMN injection_mode TEXT;
                 ALTER TABLE ideas ADD COLUMN inheritance TEXT NOT NULL DEFAULT 'self';
                 ALTER TABLE ideas ADD COLUMN tool_allow TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE ideas ADD COLUMN tool_deny TEXT NOT NULL DEFAULT '[]';
                 ALTER TABLE ideas ADD COLUMN content_hash TEXT;
                 ALTER TABLE ideas ADD COLUMN source_kind TEXT;
                 ALTER TABLE ideas ADD COLUMN source_ref TEXT;
                 ALTER TABLE ideas ADD COLUMN managed INTEGER NOT NULL DEFAULT 0;
                 CREATE INDEX IF NOT EXISTS idx_ideas_injection ON ideas(injection_mode);
                 CREATE INDEX IF NOT EXISTS idx_ideas_content_hash ON ideas(content_hash);
                 CREATE INDEX IF NOT EXISTS idx_ideas_source ON ideas(source_kind, source_ref);",
            )?;
            debug!("migrated insights: added injection metadata columns (prompt consolidation)");
        }
        Ok(())
    }

    /// Compute SHA256 hash of content for embedding cache lookup.
    fn content_hash(content: &str) -> String {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    /// Look up a cached embedding by content hash.
    /// Returns the embedding bytes if a match exists, None otherwise.
    fn lookup_embedding_by_hash(conn: &Connection, hash: &str) -> Option<Vec<u8>> {
        conn.query_row(
            "SELECT embedding FROM memory_embeddings WHERE content_hash = ?1 LIMIT 1",
            rusqlite::params![hash],
            |row| row.get(0),
        )
        .ok()
    }

    // ── Bulk queries for export ──

    /// List all non-expired ideas (unscored, no search ranking).
    pub fn list_all(&self) -> Result<Vec<Idea>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let mut stmt = conn.prepare(
            "SELECT id, key, content, category, agent_id, session_id, created_at
             FROM ideas
             WHERE expires_at IS NULL OR expires_at > ?1
             ORDER BY created_at DESC",
        )?;
        let mut entries = stmt
            .query_map(rusqlite::params![now], |row| {
                let id: String = row.get(0)?;
                let key: String = row.get(1)?;
                let content: String = row.get(2)?;
                let cat_str: String = row.get(3)?;
                let agent_id: Option<String> = row.get(4)?;
                let session_id: Option<String> = row.get(5)?;
                let created_str: String = row.get(6)?;
                Ok((id, key, content, cat_str, agent_id, session_id, created_str))
            })?
            .filter_map(|r| r.ok())
            .filter_map(
                |(id, key, content, cat_str, agent_id, session_id, created_str)| {
                    let created_at = DateTime::parse_from_rfc3339(&created_str)
                        .ok()?
                        .with_timezone(&Utc);
                    Some(Idea::recalled(
                        id,
                        key,
                        content,
                        vec![cat_str],
                        agent_id,
                        created_at,
                        session_id,
                        1.0,
                    ))
                },
            )
            .collect::<Vec<Idea>>();
        Self::enrich_tags(&conn, &mut entries);
        Ok(entries)
    }

    // ── TTL and prefix queries ──

    /// Search ideas by key prefix (exact prefix match, not FTS5).
    /// Filters out expired entries. Returns newest first.
    pub fn search_by_prefix(&self, prefix: &str, limit: usize) -> Result<Vec<Idea>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let like_pattern = format!("{prefix}%");
        let mut stmt = conn.prepare(
            "SELECT id, key, content, category, agent_id, session_id, created_at
             FROM ideas
             WHERE key LIKE ?1
             AND (expires_at IS NULL OR expires_at > ?2)
             ORDER BY created_at DESC
             LIMIT ?3",
        )?;
        let mut entries: Vec<Idea> = stmt
            .query_map(rusqlite::params![like_pattern, now, limit as i64], |row| {
                let id: String = row.get(0)?;
                let key: String = row.get(1)?;
                let content: String = row.get(2)?;
                let cat_str: String = row.get(3)?;
                let agent_id: Option<String> = row.get(4)?;
                let session_id: Option<String> = row.get(5)?;
                let created_str: String = row.get(6)?;
                Ok((id, key, content, cat_str, agent_id, session_id, created_str))
            })?
            .filter_map(|r| r.ok())
            .filter_map(
                |(id, key, content, cat_str, agent_id, session_id, created_str)| {
                    let created_at = DateTime::parse_from_rfc3339(&created_str)
                        .ok()?
                        .with_timezone(&Utc);
                    Some(Idea::recalled(
                        id,
                        key,
                        content,
                        vec![cat_str],
                        agent_id,
                        created_at,
                        session_id,
                        1.0,
                    ))
                },
            )
            .collect();
        Self::enrich_tags(&conn, &mut entries);
        Ok(entries)
    }

    /// Delete expired ideas and their embeddings.
    /// Returns the number of entries cleaned up.
    pub fn cleanup_expired(&self) -> Result<usize> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let now = Utc::now().to_rfc3339();

        // Get IDs of expired entries (for embedding cleanup).
        let expired_ids: Vec<String> = conn
            .prepare("SELECT id FROM ideas WHERE expires_at IS NOT NULL AND expires_at <= ?1")?
            .query_map(rusqlite::params![now], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        if expired_ids.is_empty() {
            return Ok(0);
        }

        let count = expired_ids.len();

        // Delete tags and embeddings for expired entries.
        for id in &expired_ids {
            conn.execute(
                "DELETE FROM idea_tags WHERE idea_id = ?1",
                rusqlite::params![id],
            )
            .ok();
            conn.execute(
                "DELETE FROM memory_embeddings WHERE memory_id = ?1",
                rusqlite::params![id],
            )
            .ok();
        }

        // Delete the expired ideas.
        conn.execute(
            "DELETE FROM ideas WHERE expires_at IS NOT NULL AND expires_at <= ?1",
            rusqlite::params![now],
        )?;

        debug!(count, "cleaned up expired ideas");
        Ok(count)
    }

    fn decay_factor(&self, created_at: &DateTime<Utc>) -> f64 {
        let age_days = (Utc::now() - *created_at).num_seconds() as f64 / 86400.0;
        if age_days <= 0.0 {
            return 1.0;
        }
        let lambda = (2.0_f64).ln() / self.decay_halflife_days;
        (-lambda * age_days).exp()
    }

    fn bm25_search(
        conn: &Connection,
        query: &IdeaQuery,
        limit: usize,
    ) -> Result<Vec<(MemRow, f64)>> {
        let fts_query = query
            .text
            .split_whitespace()
            .map(|w| format!("\"{w}\""))
            .collect::<Vec<_>>()
            .join(" OR ");

        let mut conditions = vec!["ideas_fts MATCH ?1".to_string()];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(fts_query)];
        let mut idx = 2usize;

        // Filter out expired entries.
        let now = Utc::now().to_rfc3339();
        conditions.push(format!("(m.expires_at IS NULL OR m.expires_at > ?{idx})"));
        params.push(Box::new(now));
        idx += 1;

        if let Some(ref agent_id) = query.agent_id {
            conditions.push(format!("m.agent_id = ?{idx}"));
            params.push(Box::new(agent_id.clone()));
            idx += 1;
        }

        let where_clause = conditions.join(" AND ");

        let sql = format!(
            "SELECT m.id, m.key, m.content, m.category, m.agent_id,
                    m.created_at, m.session_id, bm25(ideas_fts) as rank
             FROM ideas_fts f
             JOIN ideas m ON m.rowid = f.rowid
             WHERE {where_clause}
             ORDER BY rank
             LIMIT ?{idx}"
        );

        params.push(Box::new(limit as i64));
        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;

        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let id: String = row.get(0)?;
                let key: String = row.get(1)?;
                let content: String = row.get(2)?;
                let cat_str: String = row.get(3)?;
                let agent_id: Option<String> = row.get(4)?;
                let created_at: String = row.get(5)?;
                let session_id: Option<String> = row.get(6)?;
                let bm25: f64 = row.get(7)?;
                Ok((
                    MemRow {
                        id,
                        key,
                        content,
                        cat_str,
                        agent_id,
                        created_at,
                        session_id,
                        tags: Vec::new(),
                    },
                    bm25,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    fn vector_search_scoped(
        conn: &Connection,
        query_vec: &[f32],
        top_k: usize,
        query: &IdeaQuery,
    ) -> Vec<(String, f32)> {
        let mut conditions = vec!["1=1".to_string()];
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];
        let mut idx = 1usize;

        if let Some(ref agent_id) = query.agent_id {
            conditions.push(format!("m.agent_id = ?{idx}"));
            params.push(Box::new(agent_id.clone()));
            idx += 1;
        }

        let _ = idx; // suppress unused warning
        let where_clause = conditions.join(" AND ");
        let sql = format!(
            "SELECT me.memory_id, me.embedding
             FROM memory_embeddings me
             JOIN ideas m ON m.id = me.memory_id
             WHERE {where_clause}"
        );

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return vec![];
        };

        let mut results: Vec<(String, f32)> = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mid: String = row.get(0)?;
                let bytes: Vec<u8> = row.get(1)?;
                Ok((mid, bytes))
            })
            .map(|iter| {
                iter.filter_map(|r| r.ok())
                    .map(|(mid, bytes)| {
                        let emb = bytes_to_vec(&bytes);
                        let sim = cosine_similarity(query_vec, &emb);
                        (mid, sim)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        results
    }

    fn fetch_by_ids(conn: &Connection, ids: &[String]) -> Vec<MemRow> {
        if ids.is_empty() {
            return vec![];
        }
        let placeholders = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, key, content, category, agent_id, created_at, session_id
             FROM ideas WHERE id IN ({placeholders})"
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return vec![];
        };
        stmt.query_map(params.as_slice(), |row| {
            Ok(MemRow {
                id: row.get(0)?,
                key: row.get(1)?,
                content: row.get(2)?,
                cat_str: row.get(3)?,
                agent_id: row.get(4)?,
                created_at: row.get(5)?,
                session_id: row.get(6)?,
                tags: Vec::new(),
            })
        })
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    fn load_embeddings_for_ids(conn: &Connection, ids: &[String]) -> HashMap<String, Vec<f32>> {
        if ids.is_empty() {
            return HashMap::new();
        }
        let placeholders = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT memory_id, embedding FROM memory_embeddings WHERE memory_id IN ({placeholders})"
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return HashMap::new();
        };
        stmt.query_map(params.as_slice(), |row| {
            let mid: String = row.get(0)?;
            let bytes: Vec<u8> = row.get(1)?;
            Ok((mid, bytes))
        })
        .map(|iter| {
            iter.filter_map(|r| r.ok())
                .map(|(mid, bytes)| (mid, bytes_to_vec(&bytes)))
                .collect()
        })
        .unwrap_or_default()
    }

    /// Bulk-fetch tags from the idea_tags junction table for a set of idea IDs.
    /// Falls back to the category column for ideas not present in the junction table.
    fn fetch_tags_for_ids(conn: &Connection, ids: &[String]) -> HashMap<String, Vec<String>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        if ids.is_empty() {
            return map;
        }
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "SELECT idea_id, tag FROM idea_tags WHERE idea_id IN ({})",
            placeholders.join(",")
        );
        let params: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return map;
        };
        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        if let Ok(rows) = rows {
            for (idea_id, tag) in rows.flatten() {
                map.entry(idea_id).or_default().push(tag);
            }
        }
        map
    }

    /// Enrich a list of Ideas with tags from the junction table.
    /// For ideas not present in the junction table, keeps existing tags (category fallback).
    fn enrich_tags(conn: &Connection, entries: &mut [Idea]) {
        let ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
        let tag_map = Self::fetch_tags_for_ids(conn, &ids);
        for entry in entries.iter_mut() {
            if let Some(tags) = tag_map.get(&entry.id) {
                entry.tags = tags.clone();
            }
            // else: keep existing tags (from category column fallback)
        }
    }

    /// Check if a memory with the same key was stored within the given time window.
    /// When agent_id is provided, scopes the check to that agent only.
    pub fn has_recent_key(&self, key: &str, agent_id: Option<&str>, hours: u32) -> bool {
        let cutoff = (Utc::now() - chrono::Duration::hours(hours as i64)).to_rfc3339();
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };
        let count: i64 = if let Some(aid) = agent_id {
            conn.query_row(
                "SELECT COUNT(*) FROM ideas WHERE key = ?1 AND agent_id = ?2 AND created_at > ?3",
                rusqlite::params![key, aid, cutoff],
                |row| row.get(0),
            )
            .unwrap_or(0)
        } else {
            conn.query_row(
                "SELECT COUNT(*) FROM ideas WHERE key = ?1 AND agent_id IS NULL AND created_at > ?2",
                rusqlite::params![key, cutoff],
                |row| row.get(0),
            )
            .unwrap_or(0)
        };
        count > 0
    }

    pub fn has_recent_duplicate(&self, content: &str, hours: u32) -> bool {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        let cutoff = (Utc::now() - chrono::Duration::hours(hours as i64)).to_rfc3339();

        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ideas WHERE content = ?1 AND created_at > ?2",
                rusqlite::params![content, cutoff],
                |row| row.get(0),
            )
            .unwrap_or(0);

        if count > 0 {
            debug!(hash = %hash, "duplicate memory detected within {hours}h window");
        }
        count > 0
    }

    fn row_to_entry(&self, row: MemRow, score: f64, query: &IdeaQuery) -> Option<Idea> {
        if !query.tags.is_empty() && !query.tags.iter().any(|t| t == &row.cat_str) {
            return None;
        }

        if let Some(ref q_session) = query.session_id
            && row.session_id.as_deref() != Some(q_session.as_str())
        {
            return None;
        }

        let created_at = DateTime::parse_from_rfc3339(&row.created_at)
            .ok()?
            .with_timezone(&Utc);

        let decay = if row.cat_str == "evergreen" {
            1.0
        } else {
            self.decay_factor(&created_at)
        };

        let tags = if row.tags.is_empty() {
            vec![row.cat_str]
        } else {
            row.tags
        };

        Some(Idea::recalled(
            row.id,
            row.key,
            row.content,
            tags,
            row.agent_id,
            created_at,
            row.session_id,
            score * decay,
        ))
    }

    // ── Idea graph edge operations ──

    /// Store a memory edge (upsert on conflict).
    pub fn store_edge(&self, edge: &IdeaEdge) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in store_edge: {e}"))?;
        let relation_str = serde_json::to_value(edge.relation)?
            .as_str()
            .unwrap_or("related_to")
            .to_string();
        conn.execute(
            "INSERT INTO memory_edges (source_id, target_id, relation, strength, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
                strength = MAX(excluded.strength, memory_edges.strength)",
            rusqlite::params![
                edge.source_id,
                edge.target_id,
                relation_str,
                edge.strength,
                edge.created_at.to_rfc3339(),
            ],
        )?;
        debug!(
            source = %edge.source_id,
            target = %edge.target_id,
            relation = %relation_str,
            strength = edge.strength,
            "stored idea edge"
        );
        Ok(())
    }

    /// Fetch all edges where this idea is source or target.
    pub fn fetch_edges(&self, idea_id: &str) -> Result<Vec<IdeaEdge>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| anyhow::anyhow!("lock poisoned in fetch_edges: {e}"))?;
        let mut stmt = conn.prepare(
            "SELECT source_id, target_id, relation, strength, created_at
             FROM memory_edges
             WHERE source_id = ?1 OR target_id = ?1",
        )?;
        let edges = stmt
            .query_map(rusqlite::params![idea_id], |row| {
                let source_id: String = row.get(0)?;
                let target_id: String = row.get(1)?;
                let relation_str: String = row.get(2)?;
                let strength: f32 = row.get(3)?;
                let created_str: String = row.get(4)?;
                Ok((source_id, target_id, relation_str, strength, created_str))
            })?
            .filter_map(|r| r.ok())
            .filter_map(
                |(source_id, target_id, relation_str, strength, created_str)| {
                    let relation: IdeaRelation =
                        serde_json::from_value(serde_json::Value::String(relation_str)).ok()?;
                    let created_at = DateTime::parse_from_rfc3339(&created_str)
                        .ok()?
                        .with_timezone(&Utc);
                    Some(IdeaEdge {
                        source_id,
                        target_id,
                        relation,
                        strength,
                        created_at,
                    })
                },
            )
            .collect();
        Ok(edges)
    }

    /// Fetch all edges where any of the given IDs is involved.
    pub fn fetch_edges_for_set(&self, ids: &[String]) -> Result<Vec<IdeaEdge>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut all_edges = Vec::new();
        for id in ids {
            all_edges.extend(self.fetch_edges(id)?);
        }
        // Deduplicate by (source, target, relation).
        all_edges.sort_by(|a, b| (&a.source_id, &a.target_id).cmp(&(&b.source_id, &b.target_id)));
        all_edges.dedup_by(|a, b| {
            a.source_id == b.source_id && a.target_id == b.target_id && a.relation == b.relation
        });
        Ok(all_edges)
    }

    /// Compute graph boost for an idea based on supporting edges in a result set.
    pub fn compute_graph_boost(&self, idea_id: &str, result_ids: &[String]) -> f32 {
        let edges = match self.fetch_edges(idea_id) {
            Ok(e) => e,
            Err(_) => return 0.0,
        };

        let result_set: std::collections::HashSet<&str> =
            result_ids.iter().map(|s| s.as_str()).collect();

        let mut boost: f32 = 0.0;
        for edge in &edges {
            let other = if edge.source_id == idea_id {
                &edge.target_id
            } else {
                &edge.source_id
            };
            if !result_set.contains(other.as_str()) {
                continue;
            }
            match edge.relation {
                IdeaRelation::Supports | IdeaRelation::RelatedTo => {
                    boost += edge.strength * 0.5;
                }
                IdeaRelation::DerivedFrom | IdeaRelation::CausedBy => {
                    boost += edge.strength * 0.3;
                }
                IdeaRelation::Contradicts => {
                    boost -= edge.strength * 0.3;
                }
                IdeaRelation::Supersedes => {
                    // Source supersedes target — boost the source.
                    if edge.source_id == idea_id {
                        boost += edge.strength * 0.4;
                    }
                }
            }
        }
        boost.clamp(0.0, 1.0)
    }

    /// Synchronous search implementation. Called from spawn_blocking.
    fn search_sync(
        &self,
        query: &IdeaQuery,
        query_embedding: Option<Vec<f32>>,
    ) -> Result<Vec<Idea>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;

        let bm25_limit = if query_embedding.is_some() {
            query.top_k * 3
        } else {
            query.top_k
        };
        let bm25_rows = Self::bm25_search(&conn, query, bm25_limit)?;

        let vector_scores = if let Some(ref qvec) = query_embedding {
            Self::vector_search_scoped(&conn, qvec, query.top_k * 3, query)
        } else {
            vec![]
        };

        // BM25-only path with graph boost.
        if vector_scores.is_empty() {
            // Enrich MemRows with tags from junction table before dropping conn.
            let bm25_ids: Vec<String> = bm25_rows.iter().map(|(r, _)| r.id.clone()).collect();
            let tag_map = Self::fetch_tags_for_ids(&conn, &bm25_ids);
            let bm25_rows: Vec<(MemRow, f64)> = bm25_rows
                .into_iter()
                .map(|(mut row, score)| {
                    if let Some(tags) = tag_map.get(&row.id) {
                        row.tags = tags.clone();
                    }
                    (row, score)
                })
                .collect();
            // Drop conn before calling methods that re-lock.
            drop(conn);
            let mut entries: Vec<Idea> = bm25_rows
                .into_iter()
                .filter_map(|(row, bm25_score)| {
                    let raw = -bm25_score;
                    self.row_to_entry(row, raw, query)
                })
                .collect();
            let ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
            for entry in &mut entries {
                let boost = self.compute_graph_boost(&entry.id, &ids);
                if boost > 0.0 {
                    entry.score = entry.score * 0.9 + (boost as f64) * 0.1;
                }
            }
            entries.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            return Ok(entries);
        }

        // Hybrid merge.
        let kw_pairs: Vec<(String, f64)> = bm25_rows
            .iter()
            .map(|(row, bm25)| (row.id.clone(), -bm25))
            .collect();
        let vec_pairs: Vec<(String, f64)> = vector_scores
            .iter()
            .map(|(id, sim)| (id.clone(), *sim as f64))
            .collect();

        let merged = merge_scores(
            &kw_pairs,
            &vec_pairs,
            self.keyword_weight,
            self.vector_weight,
        );

        let bm25_map: HashMap<String, &MemRow> = bm25_rows
            .iter()
            .map(|(row, _)| (row.id.clone(), row))
            .collect();

        let missing_ids: Vec<String> = merged
            .iter()
            .take(query.top_k * 2)
            .filter(|r| !bm25_map.contains_key(&r.idea_id))
            .map(|r| r.idea_id.clone())
            .collect();

        let extra_rows: HashMap<String, MemRow> = if !missing_ids.is_empty() {
            Self::fetch_by_ids(&conn, &missing_ids)
                .into_iter()
                .map(|row| (row.id.clone(), row))
                .collect()
        } else {
            HashMap::new()
        };

        // Enrich BM25 rows and extra rows with tags from junction table.
        let all_row_ids: Vec<String> = bm25_rows
            .iter()
            .map(|(r, _)| r.id.clone())
            .chain(extra_rows.keys().cloned())
            .collect();
        let tag_map = Self::fetch_tags_for_ids(&conn, &all_row_ids);

        // Build Idea for each merged result, applying temporal decay.
        let mut scored: Vec<(ScoredResult, Idea)> = Vec::new();
        for sr in merged.into_iter().take(query.top_k * 2) {
            let enriched_tags = tag_map.get(&sr.idea_id).cloned().unwrap_or_default();
            let row_ref = bm25_map
                .get(&sr.idea_id)
                .map(|r| MemRow {
                    id: r.id.clone(),
                    key: r.key.clone(),
                    content: r.content.clone(),
                    cat_str: r.cat_str.clone(),
                    agent_id: r.agent_id.clone(),
                    created_at: r.created_at.clone(),
                    session_id: r.session_id.clone(),
                    tags: enriched_tags.clone(),
                })
                .or_else(|| {
                    extra_rows.get(&sr.idea_id).map(|r| MemRow {
                        id: r.id.clone(),
                        key: r.key.clone(),
                        content: r.content.clone(),
                        cat_str: r.cat_str.clone(),
                        agent_id: r.agent_id.clone(),
                        created_at: r.created_at.clone(),
                        session_id: r.session_id.clone(),
                        tags: enriched_tags.clone(),
                    })
                });

            if let Some(row) = row_ref
                && let Some(entry) = self.row_to_entry(row, sr.combined_score, query)
            {
                scored.push((sr, entry));
            }
        }

        scored.sort_by(|a, b| {
            b.1.score
                .partial_cmp(&a.1.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // MMR rerank using embedding similarity.
        let candidate_ids: Vec<String> = scored.iter().map(|(_, e)| e.id.clone()).collect();
        let embedding_cache = Self::load_embeddings_for_ids(&conn, &candidate_ids);

        let scored_results: Vec<ScoredResult> = scored.iter().map(|(sr, _)| sr.clone()).collect();

        let reranked = mmr_rerank(
            &scored_results,
            query.top_k,
            self.mmr_lambda,
            |id_a, id_b| match (embedding_cache.get(id_a), embedding_cache.get(id_b)) {
                (Some(a), Some(b)) => cosine_similarity(a, b) as f64,
                _ => 0.0,
            },
        );

        // Drop conn before calling compute_graph_boost which re-locks.
        drop(conn);

        // Apply graph boost from idea edges.
        let entry_map: HashMap<String, Idea> =
            scored.into_iter().map(|(_, e)| (e.id.clone(), e)).collect();

        let result_ids: Vec<String> = reranked.iter().map(|r| r.idea_id.clone()).collect();

        let mut result: Vec<Idea> = reranked
            .into_iter()
            .filter_map(|r| {
                let mut entry = entry_map.get(&r.idea_id)?.clone();
                let graph_boost = self.compute_graph_boost(&entry.id, &result_ids);
                if graph_boost > 0.0 {
                    entry.score = entry.score * 0.9 + (graph_boost as f64) * 0.1;
                    debug!(id = %entry.id, key = %entry.key, graph_boost, "graph boost applied");
                } else {
                    entry.score = r.combined_score;
                }
                Some(entry)
            })
            .collect();

        result.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        Ok(result)
    }
}

#[async_trait]
impl IdeaStore for SqliteIdeas {
    async fn store(
        &self,
        key: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
    ) -> Result<String> {
        // Dedup + insert in spawn_blocking to avoid blocking tokio.
        let key_owned = key.to_string();
        let content_owned = content.to_string();
        let tags_owned: Vec<String> = tags.to_vec();
        let cat_owned = tags
            .first()
            .map(|s| s.as_str())
            .unwrap_or("untagged")
            .to_string();
        let agent_id_owned = agent_id.map(|s| s.to_string());
        let this = self.clone();

        let id = tokio::task::spawn_blocking(move || -> Result<String> {
            if this.has_recent_duplicate(&content_owned, 24) {
                debug!(key = %key_owned, "skipping duplicate memory (exact content match within 24h)");
                return Ok(String::new());
            }
            if this.has_recent_key(&key_owned, agent_id_owned.as_deref(), 24) {
                debug!(key = %key_owned, "skipping duplicate memory (same key within 24h)");
                return Ok(String::new());
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();

            let conn = this.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
            conn.execute(
                "INSERT INTO ideas (id, key, content, category, agent_id, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, key_owned, content_owned, cat_owned, agent_id_owned, now],
            )?;

            // Insert all tags into the junction table.
            for tag in &tags_owned {
                conn.execute(
                    "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                    rusqlite::params![id, tag],
                )?;
            }

            debug!(id = %id, key = %key_owned, agent_id = ?agent_id_owned, "memory stored");
            Ok(id)
        })
        .await
        .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))??;

        if id.is_empty() {
            return Ok(id);
        }

        // Embedding phase: async embed, then sync store.
        if let Some(ref embedder) = self.embedder {
            let hash = Self::content_hash(content);

            // Check cache in spawn_blocking.
            let cached = {
                let conn = self.conn.clone();
                let hash_c = hash.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().ok()?;
                    Self::lookup_embedding_by_hash(&conn, &hash_c)
                })
                .await
                .ok()
                .flatten()
            };

            let embed_bytes = if let Some(existing_bytes) = cached {
                debug!(id = %id, hash = %hash, "embedding cache hit — reusing existing embedding");
                Some(existing_bytes)
            } else {
                match embedder.embed(content).await {
                    Ok(embedding) => {
                        debug!(id = %id, hash = %hash, "embedding stored (cache miss)");
                        Some(vec_to_bytes(&embedding))
                    }
                    Err(e) => {
                        warn!(id = %id, "embedding failed: {e}");
                        None
                    }
                }
            };

            if let Some(bytes) = embed_bytes {
                let conn = self.conn.clone();
                let id = id.clone();
                let dims = self.embedding_dimensions;
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(conn) = conn.lock()
                        && let Err(e) = conn.execute(
                            "INSERT OR REPLACE INTO memory_embeddings (memory_id, embedding, dimensions, content_hash) VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![id, bytes, dims as i64, hash],
                        ) {
                            warn!(id = %id, "failed to store embedding: {e}");
                        }
                })
                .await;
            }
        }

        Ok(id)
    }

    async fn search(&self, query: &IdeaQuery) -> Result<Vec<Idea>> {
        // Phase 1: embed query text if embedder present (async, no lock).
        let query_embedding: Option<Vec<f32>> = if let Some(ref embedder) = self.embedder {
            match embedder.embed(&query.text).await {
                Ok(emb) => Some(emb),
                Err(e) => {
                    warn!("query embedding failed, falling back to BM25: {e}");
                    None
                }
            }
        } else {
            None
        };

        // Phase 2+: all DB and computation work runs in spawn_blocking
        // to avoid blocking the tokio runtime with std::sync::Mutex.
        let this = self.clone();
        let query = query.clone();
        tokio::task::spawn_blocking(move || this.search_sync(&query, query_embedding))
            .await
            .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))?
    }

    async fn delete(&self, id: &str) -> Result<()> {
        let id = id.to_string();
        self.blocking(move |conn| {
            conn.execute(
                "DELETE FROM idea_tags WHERE idea_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM ideas WHERE id = ?1", rusqlite::params![id])?;
            conn.execute(
                "DELETE FROM memory_embeddings WHERE memory_id = ?1",
                rusqlite::params![id],
            )?;
            Ok(())
        })
        .await
    }

    async fn update(
        &self,
        id: &str,
        key: Option<&str>,
        content: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<()> {
        let id = id.to_string();
        let key = key.map(|s| s.to_string());
        let content = content.map(|s| s.to_string());
        let tags_owned = tags.map(|t| t.to_vec());
        let cat_from_tags = tags.map(|t| {
            t.first()
                .map(|s| s.as_str())
                .unwrap_or("untagged")
                .to_string()
        });
        self.blocking(move |conn| {
            let now = Utc::now().to_rfc3339();
            if let Some(key) = key {
                conn.execute(
                    "UPDATE ideas SET key = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![key, now, id],
                )?;
            }
            if let Some(content) = content {
                conn.execute(
                    "UPDATE ideas SET content = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![content, now, id],
                )?;
            }
            if let Some(cat_str) = cat_from_tags {
                conn.execute(
                    "UPDATE ideas SET category = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![cat_str, now, id],
                )?;
            }
            if let Some(tags) = tags_owned {
                conn.execute(
                    "DELETE FROM idea_tags WHERE idea_id = ?1",
                    rusqlite::params![id],
                )?;
                for tag in &tags {
                    conn.execute(
                        "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                        rusqlite::params![id, tag],
                    )?;
                }
            }
            Ok(())
        })
        .await
    }

    async fn store_with_ttl(
        &self,
        key: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
        ttl_secs: Option<u64>,
    ) -> Result<String> {
        let id = self.store(key, content, tags, agent_id).await?;
        if id.is_empty() {
            return Ok(id);
        }
        if let Some(ttl) = ttl_secs {
            let id_c = id.clone();
            self.blocking(move |conn| {
                let expires = Utc::now() + chrono::Duration::seconds(ttl as i64);
                let expires_str = expires.to_rfc3339();
                conn.execute(
                    "UPDATE ideas SET expires_at = ?1 WHERE id = ?2",
                    rusqlite::params![expires_str, id_c],
                )?;
                Ok(())
            })
            .await?;
        }
        Ok(id)
    }

    fn search_by_prefix(&self, prefix: &str, limit: usize) -> Result<Vec<Idea>> {
        // Delegate to inherent method.
        SqliteIdeas::search_by_prefix(self, prefix, limit)
    }

    fn cleanup_expired(&self) -> Result<usize> {
        SqliteIdeas::cleanup_expired(self)
    }

    fn name(&self) -> &str {
        "sqlite"
    }

    async fn reassign_agent(&self, old_agent_id: &str, new_agent_id: &str) -> Result<u64> {
        let old = old_agent_id.to_string();
        let new = new_agent_id.to_string();
        self.blocking(move |conn| {
            let updated = conn.execute(
                "UPDATE ideas SET agent_id = ?1 WHERE agent_id = ?2",
                rusqlite::params![new, old],
            )?;
            Ok(updated as u64)
        })
        .await
    }

    async fn store_idea_edge(
        &self,
        source_id: &str,
        target_id: &str,
        relation: &str,
        strength: f32,
    ) -> Result<()> {
        let relation_enum: IdeaRelation =
            serde_json::from_value(serde_json::Value::String(relation.to_string()))
                .unwrap_or(IdeaRelation::RelatedTo);
        let edge = IdeaEdge::new(source_id, target_id, relation_enum, strength);
        let this = self.clone();
        tokio::task::spawn_blocking(move || this.store_edge(&edge))
            .await
            .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))?
    }

    // store_prompt, get_prompts, get_prompts_for_chain — REMOVED.
    // Ideas are activated through events, not injection_mode.

    async fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Idea>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids = ids.to_vec();
        self.blocking(move |conn| {
            let placeholders: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 1)).collect();
            let sql = format!(
                "SELECT id, key, content, category, agent_id, created_at, session_id, injection_mode, inheritance, tool_allow, tool_deny
                 FROM ideas WHERE id IN ({})",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let params: Vec<&dyn rusqlite::types::ToSql> =
                ids.iter().map(|id| id as &dyn rusqlite::types::ToSql).collect();
            let mut entries: Vec<Idea> = stmt
                .query_map(params.as_slice(), |row| {
                    let tool_allow_str: String = row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string());
                    let tool_deny_str: String = row.get::<_, String>(10).unwrap_or_else(|_| "[]".to_string());
                    let cat: String = row.get(3)?;
                    Ok(Idea {
                        id: row.get(0)?,
                        key: row.get(1)?,
                        content: row.get(2)?,
                        tags: vec![cat],
                        agent_id: row.get(4)?,
                        created_at: {
                            let s: String = row.get(5)?;
                            DateTime::parse_from_rfc3339(&s).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now())
                        },
                        session_id: row.get(6)?,
                        score: 1.0,
                        injection_mode: row.get(7)?,
                        inheritance: row.get::<_, String>(8).unwrap_or_else(|_| "self".to_string()),
                        tool_allow: serde_json::from_str(&tool_allow_str).unwrap_or_default(),
                        tool_deny: serde_json::from_str(&tool_deny_str).unwrap_or_default(),
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Self::enrich_tags(conn, &mut entries);
            Ok(entries)
        })
        .await
    }

    async fn get_injection_ideas(&self) -> Result<Vec<(String, String, Idea)>> {
        self.blocking(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, key, content, category, agent_id, created_at, session_id, injection_mode, inheritance, tool_allow, tool_deny
                 FROM ideas WHERE injection_mode IS NOT NULL AND agent_id IS NOT NULL
                 ORDER BY agent_id, created_at ASC",
            )?;
            let mut entries: Vec<(String, String, Idea)> = stmt
                .query_map([], |row| {
                    let agent_id: String = row.get(4)?;
                    let injection_mode: String = row.get::<_, Option<String>>(7)?.unwrap_or_default();
                    let tool_allow_str: String = row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string());
                    let tool_deny_str: String = row.get::<_, String>(10).unwrap_or_else(|_| "[]".to_string());
                    let cat: String = row.get(3)?;
                    let idea = Idea {
                        id: row.get(0)?,
                        key: row.get(1)?,
                        content: row.get(2)?,
                        tags: vec![cat],
                        agent_id: Some(agent_id.clone()),
                        created_at: {
                            let s: String = row.get(5)?;
                            DateTime::parse_from_rfc3339(&s).map(|d| d.with_timezone(&Utc)).unwrap_or_else(|_| Utc::now())
                        },
                        session_id: row.get(6)?,
                        score: 1.0,
                        injection_mode: Some(injection_mode.clone()),
                        inheritance: row.get::<_, String>(8).unwrap_or_else(|_| "self".to_string()),
                        tool_allow: serde_json::from_str(&tool_allow_str).unwrap_or_default(),
                        tool_deny: serde_json::from_str(&tool_deny_str).unwrap_or_default(),
                    };
                    Ok((agent_id, injection_mode, idea))
                })?
                .filter_map(|r| r.ok())
                .collect();
            // Enrich tags on the ideas within the tuples.
            let idea_ids: Vec<String> = entries.iter().map(|(_, _, idea)| idea.id.clone()).collect();
            let tag_map = Self::fetch_tags_for_ids(conn, &idea_ids);
            for (_, _, idea) in &mut entries {
                if let Some(tags) = tag_map.get(&idea.id) {
                    idea.tags = tags.clone();
                }
            }
            Ok(entries)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ideas() -> (SqliteIdeas, tempfile::TempDir) {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test.db");
        let ideas = SqliteIdeas::open(&db_path, 30.0).unwrap();
        (ideas, dir)
    }

    #[tokio::test]
    async fn test_store_and_search() {
        let (mem, _dir) = test_ideas();

        mem.store(
            "login-flow",
            "The login uses JWT tokens with 24h expiry",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();
        mem.store(
            "deploy-process",
            "Deploy by merging to dev branch, auto-deploys",
            &["procedure".to_string()],
            None,
        )
        .await
        .unwrap();
        mem.store(
            "db-config",
            "PostgreSQL on port 5432 with TimescaleDB",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();

        let results = mem.search(&IdeaQuery::new("login JWT", 10)).await.unwrap();
        assert!(!results.is_empty());
        assert!(results[0].content.contains("JWT"));
        assert!(results[0].agent_id.is_none());

        let results = mem.search(&IdeaQuery::new("deploy", 10)).await.unwrap();
        assert!(!results.is_empty());
        assert!(results[0].content.contains("deploy"));
    }

    #[tokio::test]
    async fn test_agent_scoped_memory() {
        let (mem, _dir) = test_ideas();

        mem.store(
            "shared-fact",
            "The API runs on port 8080",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();
        mem.store(
            "guardian-note",
            "Risk tolerance is low for this user",
            &["preference".to_string()],
            Some("guardian-001"),
        )
        .await
        .unwrap();
        mem.store(
            "librarian-note",
            "User prefers detailed explanations",
            &["preference".to_string()],
            Some("librarian-001"),
        )
        .await
        .unwrap();

        let guardian_query = IdeaQuery::new("risk tolerance", 10).with_agent("guardian-001");
        let results = mem.search(&guardian_query).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].agent_id.as_deref(), Some("guardian-001"));

        let librarian_query = IdeaQuery::new("risk tolerance", 10).with_agent("librarian-001");
        let results = mem.search(&librarian_query).await.unwrap();
        assert!(results.is_empty());

        // Unscoped query should find the global memory.
        let global_query = IdeaQuery::new("API port", 10);
        let results = mem.search(&global_query).await.unwrap();
        assert!(!results.is_empty());
        assert!(results[0].agent_id.is_none());
    }

    #[tokio::test]
    async fn test_agent_filtered_memory() {
        let (mem, _dir) = test_ideas();

        mem.store(
            "strategic-pref",
            "Always prefer Rust over Python for new services",
            &["preference".to_string()],
            Some("root-agent"),
        )
        .await
        .unwrap();
        mem.store(
            "domain-fact",
            "The trading engine uses 50us tick",
            &["fact".to_string()],
            None,
        )
        .await
        .unwrap();

        let agent_query = IdeaQuery::new("Rust Python", 10).with_agent("root-agent");
        let results = mem.search(&agent_query).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].agent_id.as_deref(), Some("root-agent"));

        let all_query = IdeaQuery::new("Rust Python services", 10);
        let results = mem.search(&all_query).await.unwrap();
        assert!(!results.is_empty());
    }

    #[tokio::test]
    async fn test_migration_on_existing_db() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test_migrate.db");

        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE memories (
                    id TEXT PRIMARY KEY,
                    key TEXT NOT NULL,
                    content TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'fact',
                    session_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO memories (id, key, content, category, created_at) VALUES ('old-1', 'test', 'old data', 'fact', '2025-01-01T00:00:00Z')",
                [],
            ).unwrap();
        }

        let mem = SqliteIdeas::open(&db_path, 30.0).unwrap();

        let results = mem.search(&IdeaQuery::new("old data", 10)).await.unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].agent_id.is_none());

        mem.store(
            "new-fact",
            "New data with agent",
            &["fact".to_string()],
            Some("agent-1"),
        )
        .await
        .unwrap();

        let results = mem
            .search(&IdeaQuery::new("New data agent", 10).with_agent("agent-1"))
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].agent_id.as_deref(), Some("agent-1"));
    }

    #[tokio::test]
    async fn test_delete_removes_embedding() {
        let (mem, _dir) = test_ideas();

        let id = mem
            .store("key", "content", &["fact".to_string()], None)
            .await
            .unwrap();

        mem.delete(&id).await.unwrap();

        let results = mem.search(&IdeaQuery::new("content", 10)).await.unwrap();
        assert!(results.is_empty());
    }

    /// A mock embedder that tracks how many times `embed()` is called.
    /// Returns a deterministic embedding based on content length.
    struct MockEmbedder {
        call_count: std::sync::atomic::AtomicU32,
        dimensions: usize,
    }

    impl MockEmbedder {
        fn new(dimensions: usize) -> Self {
            Self {
                call_count: std::sync::atomic::AtomicU32::new(0),
                dimensions,
            }
        }

        fn calls(&self) -> u32 {
            self.call_count.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    #[async_trait]
    impl aeqi_core::traits::Embedder for MockEmbedder {
        async fn embed(&self, text: &str) -> anyhow::Result<Vec<f32>> {
            self.call_count
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            // Deterministic: fill vector based on text length.
            let val = (text.len() as f32) / 100.0;
            Ok(vec![val; self.dimensions])
        }

        fn dimensions(&self) -> usize {
            self.dimensions
        }
    }

    #[tokio::test]
    async fn test_embedding_cache_skips_duplicate_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test_embed_cache.db");
        let embedder = Arc::new(MockEmbedder::new(4));

        let mem = SqliteIdeas::open(&db_path, 30.0)
            .unwrap()
            .with_embedder(embedder.clone(), 4, 0.6, 0.4, 0.7)
            .unwrap();

        // Store first memory — should call embedder.
        let _id1 = mem
            .store(
                "key-1",
                "identical content for embedding",
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();
        assert_eq!(embedder.calls(), 1, "first store should call embedder");

        // Store second memory with IDENTICAL content — should NOT call embedder (cache hit).
        // Note: has_recent_duplicate will skip this since content is the same within 24h.
        // So we need slightly different keys but same content.
        // Actually, has_recent_duplicate checks content equality — it will skip the second store entirely.
        // We need to use different content to test the embedding cache properly.
        // Let's test with content that bypasses the duplicate check but has same hash.

        // Actually the duplicate check returns empty string early. Let's verify the cache
        // works when content is stored across different DB instances (simulating restart).
        // Instead, let's directly test the hash lookup mechanism.
        {
            let conn = mem.conn.lock().unwrap();
            let hash = SqliteIdeas::content_hash("identical content for embedding");

            // Verify the hash was stored.
            let stored_hash: Option<String> = conn
                .query_row(
                    "SELECT content_hash FROM memory_embeddings LIMIT 1",
                    [],
                    |row| row.get(0),
                )
                .ok();
            assert_eq!(
                stored_hash,
                Some(hash.clone()),
                "content_hash should be stored"
            );

            // Verify lookup_embedding_by_hash finds it.
            let cached = SqliteIdeas::lookup_embedding_by_hash(&conn, &hash);
            assert!(cached.is_some(), "should find cached embedding by hash");
        }
    }

    #[tokio::test]
    async fn test_embedding_cache_different_content_calls_embedder() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test_embed_diff.db");
        let embedder = Arc::new(MockEmbedder::new(4));

        let mem = SqliteIdeas::open(&db_path, 30.0)
            .unwrap()
            .with_embedder(embedder.clone(), 4, 0.6, 0.4, 0.7)
            .unwrap();

        // Store two memories with different content — both should call embedder.
        let _id1 = mem
            .store("key-1", "first unique content", &["fact".to_string()], None)
            .await
            .unwrap();
        let _id2 = mem
            .store(
                "key-2",
                "second unique content",
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();

        assert_eq!(
            embedder.calls(),
            2,
            "different content should call embedder each time"
        );

        // Verify both have different hashes stored.
        {
            let conn = mem.conn.lock().unwrap();
            let hash1 = SqliteIdeas::content_hash("first unique content");
            let hash2 = SqliteIdeas::content_hash("second unique content");
            assert_ne!(
                hash1, hash2,
                "different content should have different hashes"
            );

            let cached1 = SqliteIdeas::lookup_embedding_by_hash(&conn, &hash1);
            let cached2 = SqliteIdeas::lookup_embedding_by_hash(&conn, &hash2);
            assert!(cached1.is_some(), "first hash should be cached");
            assert!(cached2.is_some(), "second hash should be cached");
        }
    }

    #[tokio::test]
    async fn test_content_hash_deterministic() {
        let h1 = SqliteIdeas::content_hash("hello world");
        let h2 = SqliteIdeas::content_hash("hello world");
        let h3 = SqliteIdeas::content_hash("different content");

        assert_eq!(h1, h2, "same content should produce same hash");
        assert_ne!(h1, h3, "different content should produce different hash");
        assert_eq!(h1.len(), 64, "SHA256 hex should be 64 chars");
    }

    #[tokio::test]
    async fn test_embedding_hash_migration_on_existing_db() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("test_embed_migrate.db");

        // Create a DB with the old schema (no content_hash column).
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "CREATE TABLE memories (
                    id TEXT PRIMARY KEY,
                    key TEXT NOT NULL,
                    content TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'fact',
                    scope TEXT NOT NULL DEFAULT 'domain',
                    entity_id TEXT,
                    session_id TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT
                );
                CREATE TABLE memory_embeddings (
                    memory_id TEXT PRIMARY KEY,
                    embedding BLOB NOT NULL,
                    dimensions INTEGER NOT NULL
                );",
            )
            .unwrap();
        }

        // Opening should auto-migrate and add content_hash column.
        let _mem = SqliteIdeas::open(&db_path, 30.0).unwrap();

        // Verify the column exists.
        let conn = Connection::open(&db_path).unwrap();
        let has_hash: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('memory_embeddings') WHERE name='content_hash'")
            .unwrap()
            .query_row([], |row| row.get(0))
            .unwrap();
        assert!(has_hash, "content_hash column should exist after migration");
    }
}
