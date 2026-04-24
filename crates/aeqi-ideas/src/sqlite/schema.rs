//! Schema creation and one-time backfills.
//!
//! This module owns every CREATE TABLE / CREATE INDEX / CREATE TRIGGER for the
//! ideas database, plus the `prepare_schema` driver and the content-hash
//! backfill that runs on every open.

use super::SqliteIdeas;
use crate::vector::VectorStore;
use anyhow::Result;
use rusqlite::Connection;

impl SqliteIdeas {
    pub fn prepare_schema(conn: &Connection) -> Result<()> {
        Self::ensure_ideas_table(conn)?;
        Self::ensure_idea_tags_table(conn)?;
        Self::ensure_idea_indexes(conn)?;
        Self::ensure_fts(conn)?;
        Self::ensure_edge_table(conn)?;
        VectorStore::open(conn, 1536)?;
        Self::backfill_content_hash(conn)?;
        Ok(())
    }

    /// One-time backfill: ideas rows inserted before content_hash was
    /// populated have a NULL value. Compute and write the hash so stale-
    /// embedding detection can compare current-content hash against the
    /// last-embedded hash in idea_embeddings.
    fn backfill_content_hash(conn: &Connection) -> Result<()> {
        let mut stmt = conn.prepare("SELECT id, content FROM ideas WHERE content_hash IS NULL")?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(Result::ok)
            .collect();
        drop(stmt);

        for (id, content) in rows {
            let hash = Self::content_hash(&content);
            conn.execute(
                "UPDATE ideas SET content_hash = ?1 WHERE id = ?2",
                rusqlite::params![hash, id],
            )?;
        }
        Ok(())
    }

    fn ensure_ideas_table(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS ideas (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                scope TEXT NOT NULL DEFAULT 'domain',
                agent_id TEXT,
                session_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT,
                expires_at TEXT,
                inheritance TEXT NOT NULL DEFAULT 'self',
                tool_allow TEXT NOT NULL DEFAULT '[]',
                tool_deny TEXT NOT NULL DEFAULT '[]',
                content_hash TEXT,
                source_kind TEXT,
                source_ref TEXT,
                managed INTEGER NOT NULL DEFAULT 0
            );",
        )?;
        Ok(())
    }

    fn ensure_idea_tags_table(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS idea_tags (
                idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
                tag TEXT NOT NULL,
                PRIMARY KEY (idea_id, tag)
            );
            CREATE INDEX IF NOT EXISTS idx_idea_tags_tag ON idea_tags(tag);",
        )?;
        Ok(())
    }

    fn ensure_idea_indexes(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_ideas_name ON ideas(name);
             CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at);
             CREATE INDEX IF NOT EXISTS idx_ideas_agent_id ON ideas(agent_id);
             CREATE INDEX IF NOT EXISTS idx_ideas_expires ON ideas(expires_at);
             CREATE INDEX IF NOT EXISTS idx_ideas_content_hash ON ideas(content_hash);
             CREATE INDEX IF NOT EXISTS idx_ideas_source ON ideas(source_kind, source_ref);",
        )?;
        Ok(())
    }

    fn ensure_fts(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS ideas_fts USING fts5(
                name, content, content=ideas, content_rowid=rowid
             );
             CREATE TRIGGER IF NOT EXISTS ideas_ai AFTER INSERT ON ideas BEGIN
                 INSERT INTO ideas_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
             END;
             CREATE TRIGGER IF NOT EXISTS ideas_ad AFTER DELETE ON ideas BEGIN
                 INSERT INTO ideas_fts(ideas_fts, rowid, name, content) VALUES('delete', old.rowid, old.name, old.content);
             END;
             CREATE TRIGGER IF NOT EXISTS ideas_au AFTER UPDATE ON ideas BEGIN
                 INSERT INTO ideas_fts(ideas_fts, rowid, name, content) VALUES('delete', old.rowid, old.name, old.content);
                 INSERT INTO ideas_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
             END;",
        )?;
        Ok(())
    }

    fn ensure_edge_table(conn: &Connection) -> Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS idea_edges (
                source_id TEXT NOT NULL,
                target_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                strength REAL NOT NULL DEFAULT 0.5,
                agent TEXT,
                task_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (source_id, target_id, relation)
            );
            CREATE INDEX IF NOT EXISTS idx_idea_edges_source ON idea_edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_idea_edges_target ON idea_edges(target_id);",
        )?;
        Ok(())
    }
}
