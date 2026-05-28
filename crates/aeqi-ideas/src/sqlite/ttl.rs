//! SQLite-side TTL queries.
//!
//! Pure temporal filtering lives in [`crate::temporal_filter`]. This module
//! owns the queries that touch the `ideas` table for expired-entry cleanup
//! and prefix search on names.

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
            "SELECT id, name, content, agent_id, session_id, created_at, scope,
                    parent_idea_id, properties, kind, file_id
             FROM ideas
             WHERE name LIKE ?1
             AND (expires_at IS NULL OR expires_at > ?2)
             ORDER BY created_at DESC
             LIMIT ?3",
        )?;
        let mut entries: Vec<Idea> = stmt
            .query_map(rusqlite::params![like_pattern, now, limit as i64], |row| {
                let agent_id: Option<String> = row.get(3)?;
                let scope = row
                    .get::<_, String>(6)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or_else(|| {
                        if agent_id.is_none() {
                            aeqi_core::Scope::Global
                        } else {
                            aeqi_core::Scope::SelfScope
                        }
                    });
                let props = row
                    .get::<_, Option<String>>(8)
                    .ok()
                    .flatten()
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok());
                let created_str: String = row.get(5)?;
                let created_at = DateTime::parse_from_rfc3339(&created_str)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or_else(|_| Utc::now());
                Ok(Idea {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    content: row.get(2)?,
                    tags: Vec::new(),
                    agent_id,
                    session_id: row.get(4)?,
                    created_at,
                    score: 1.0,
                    scope,
                    inheritance: "self".to_string(),
                    tool_allow: Vec::new(),
                    tool_deny: Vec::new(),
                    parent_idea_id: row.get(7)?,
                    properties: props,
                    kind: row.get(9)?,
                    file_id: row.get(10)?,
                })
            })?
            .filter_map(|r| r.ok())
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
}
