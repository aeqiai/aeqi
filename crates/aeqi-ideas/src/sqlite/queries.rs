//! Read-only idea lookups that aren't part of the ranked search pipeline.
//!
//! Export-oriented queries (`list_all`, `list_global_ideas`), direct lookups
//! by ID or name (`get_by_ids`, `get_by_name`), and the low-level row fetcher
//! plus `row_to_entry` helper used by the search layer.

use super::{IdeaRow, SqliteIdeas};
use aeqi_core::traits::{Idea, IdeaQuery};
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::Connection;

impl SqliteIdeas {
    /// Fetch raw rows for a set of idea IDs. Tags are left empty — callers
    /// may enrich via `fetch_tags_for_ids` if needed.
    pub(super) fn fetch_by_ids(conn: &Connection, ids: &[String]) -> Vec<IdeaRow> {
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
            "SELECT id, name, content, agent_id, created_at, session_id
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
            Ok(IdeaRow {
                id: row.get(0)?,
                name: row.get(1)?,
                content: row.get(2)?,
                agent_id: row.get(3)?,
                created_at: row.get(4)?,
                session_id: row.get(5)?,
                tags: Vec::new(),
            })
        })
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    pub(super) fn row_to_entry(&self, row: IdeaRow, score: f64, query: &IdeaQuery) -> Option<Idea> {
        let tags = Self::normalize_tags(row.tags);

        if !query.tags.is_empty() && !query.tags.iter().any(|query_tag| tags.contains(query_tag)) {
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

        let decay = if tags.iter().any(|tag| tag == "evergreen") {
            1.0
        } else {
            self.decay_factor(&created_at)
        };

        Some(Idea::recalled(
            row.id,
            row.name,
            row.content,
            tags,
            row.agent_id,
            created_at,
            row.session_id,
            score * decay,
        ))
    }

    /// List all non-expired ideas (unscored, no search ranking).
    pub fn list_all(&self) -> Result<Vec<Idea>> {
        let conn = self.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let now = Utc::now().to_rfc3339();
        let mut stmt = conn.prepare(
            "SELECT id, name, content, agent_id, session_id, created_at
             FROM ideas
             WHERE expires_at IS NULL OR expires_at > ?1
             ORDER BY created_at DESC",
        )?;
        let mut entries = stmt
            .query_map(rusqlite::params![now], |row| {
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
            .collect::<Vec<Idea>>();
        Self::enrich_tags(&conn, &mut entries);
        Ok(entries)
    }

    pub(super) async fn list_global_ideas_impl(&self, limit: usize) -> Result<Vec<Idea>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        self.blocking(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, content, agent_id, session_id, created_at, scope \
                 FROM ideas \
                 WHERE agent_id IS NULL \
                 ORDER BY created_at DESC \
                 LIMIT ?1",
            )?;
            let mut entries: Vec<Idea> = stmt
                .query_map(rusqlite::params![limit as i64], |row| {
                    let created_str: String = row.get(5)?;
                    let created_at = DateTime::parse_from_rfc3339(&created_str)
                        .map(|d| d.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now());
                    let agent_id: Option<String> = row.get(3)?;
                    // These rows are always NULL agent_id by the WHERE clause.
                    let scope = aeqi_core::Scope::Global;
                    Ok(Idea {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        content: row.get(2)?,
                        tags: Vec::new(),
                        agent_id,
                        session_id: row.get(4)?,
                        created_at,
                        score: 0.0,
                        scope,
                        inheritance: "self".to_string(),
                        tool_allow: Vec::new(),
                        tool_deny: Vec::new(),
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Self::enrich_tags(conn, &mut entries);
            Ok(entries)
        })
        .await
    }

    pub(super) async fn get_by_ids_impl(&self, ids: &[String]) -> Result<Vec<Idea>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ids = ids.to_vec();
        self.blocking(move |conn| {
            let placeholders: Vec<String> = (0..ids.len()).map(|i| format!("?{}", i + 1)).collect();
            let sql = format!(
                "SELECT id, name, content, agent_id, created_at, session_id, scope
                 FROM ideas WHERE id IN ({})",
                placeholders.join(", ")
            );
            let mut stmt = conn.prepare(&sql)?;
            let params: Vec<&dyn rusqlite::types::ToSql> = ids
                .iter()
                .map(|id| id as &dyn rusqlite::types::ToSql)
                .collect();
            let mut entries: Vec<Idea> = stmt
                .query_map(params.as_slice(), |row| {
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
                    Ok(Idea {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        content: row.get(2)?,
                        tags: Vec::new(),
                        agent_id,
                        created_at: {
                            let s: String = row.get(4)?;
                            DateTime::parse_from_rfc3339(&s)
                                .map(|d| d.with_timezone(&Utc))
                                .unwrap_or_else(|_| Utc::now())
                        },
                        session_id: row.get(5)?,
                        score: 1.0,
                        scope,
                        inheritance: "self".to_string(),
                        tool_allow: Vec::new(),
                        tool_deny: Vec::new(),
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Self::enrich_tags(conn, &mut entries);
            Ok(entries)
        })
        .await
    }

    pub(super) async fn get_by_name_impl(
        &self,
        name: &str,
        agent_id: Option<&str>,
    ) -> Result<Option<Idea>> {
        let name = name.to_string();
        let agent_id = agent_id.map(|s| s.to_string());
        self.blocking(move |conn| {
            let sql = if agent_id.is_some() {
                "SELECT id, name, content, agent_id, created_at, session_id, scope
                 FROM ideas WHERE name = ?1 AND agent_id = ?2 LIMIT 1"
            } else {
                "SELECT id, name, content, agent_id, created_at, session_id, scope
                 FROM ideas WHERE name = ?1 AND agent_id IS NULL LIMIT 1"
            };
            let mut stmt = conn.prepare(sql)?;
            let mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<Idea> {
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
                Ok(Idea {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    content: row.get(2)?,
                    tags: Vec::new(),
                    agent_id,
                    created_at: {
                        let s: String = row.get(4)?;
                        DateTime::parse_from_rfc3339(&s)
                            .map(|d| d.with_timezone(&Utc))
                            .unwrap_or_else(|_| Utc::now())
                    },
                    session_id: row.get(5)?,
                    score: 1.0,
                    scope,
                    inheritance: "self".to_string(),
                    tool_allow: Vec::new(),
                    tool_deny: Vec::new(),
                })
            };
            let mut entries: Vec<Idea> = match agent_id.as_deref() {
                Some(aid) => stmt
                    .query_map(rusqlite::params![name, aid], mapper)?
                    .filter_map(|r| r.ok())
                    .collect(),
                None => stmt
                    .query_map(rusqlite::params![name], mapper)?
                    .filter_map(|r| r.ok())
                    .collect(),
            };
            Self::enrich_tags(conn, &mut entries);
            Ok(entries.into_iter().next())
        })
        .await
    }
}
