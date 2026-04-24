//! SQLite-side TTL and short-window dedup queries.
//!
//! Pure temporal filtering lives in [`crate::temporal_filter`]. This module
//! owns the queries that touch the `ideas` table: expired-entry cleanup,
//! prefix search on names, and the 24h-window checks used by the write path.

use super::SqliteIdeas;
use aeqi_core::traits::Idea;
use anyhow::Result;
use chrono::{DateTime, Utc};
use tracing::debug;

impl SqliteIdeas {
    /// Search ideas by name prefix (exact prefix match, not FTS5).
    /// Filters out expired entries. Returns newest first.
    pub fn search_by_prefix(&self, prefix: &str, limit: usize) -> Result<Vec<Idea>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let like_pattern = format!("{prefix}%");
        let mut stmt = conn.prepare(
            "SELECT id, name, content, agent_id, session_id, created_at
             FROM ideas
             WHERE name LIKE ?1
             AND (expires_at IS NULL OR expires_at > ?2)
             ORDER BY created_at DESC
             LIMIT ?3",
        )?;
        let mut entries: Vec<Idea> = stmt
            .query_map(rusqlite::params![like_pattern, now, limit as i64], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let content: String = row.get(2)?;
                let agent_id: Option<String> = row.get(3)?;
                let session_id: Option<String> = row.get(4)?;
                let created_str: String = row.get(5)?;
                Ok((id, name, content, agent_id, session_id, created_str))
            })?
            .filter_map(|r| r.ok())
            .filter_map(|(id, name, content, agent_id, session_id, created_str)| {
                let created_at = DateTime::parse_from_rfc3339(&created_str)
                    .ok()?
                    .with_timezone(&Utc);
                Some(Idea::recalled(
                    id,
                    name,
                    content,
                    Vec::new(),
                    agent_id,
                    created_at,
                    session_id,
                    1.0,
                ))
            })
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
                "DELETE FROM idea_embeddings WHERE idea_id = ?1",
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

    /// Check if an idea with the same name was stored within the given time window.
    /// When agent_id is provided, scopes the check to that agent only.
    pub fn has_recent_name(&self, name: &str, agent_id: Option<&str>, hours: u32) -> bool {
        let cutoff = (Utc::now() - chrono::Duration::hours(hours as i64)).to_rfc3339();
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };
        let count: i64 = if let Some(aid) = agent_id {
            conn.query_row(
                "SELECT COUNT(*) FROM ideas WHERE name = ?1 AND agent_id = ?2 AND created_at > ?3",
                rusqlite::params![name, aid, cutoff],
                |row| row.get(0),
            )
            .unwrap_or(0)
        } else {
            conn.query_row(
                "SELECT COUNT(*) FROM ideas WHERE name = ?1 AND agent_id IS NULL AND created_at > ?2",
                rusqlite::params![name, cutoff],
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
}
