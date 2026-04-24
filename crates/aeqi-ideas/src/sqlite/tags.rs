//! Tag normalization and tag-based queries.
//!
//! Owns the idea_tags junction-table access paths: normalization (dedupe +
//! lowercase + default-to-`fact`), bulk fetch for a set of idea IDs, the
//! enrich_tags helper that hydrates tag lists on already-constructed Ideas,
//! and the trait-level `ideas_by_tags` query.

use super::SqliteIdeas;
use aeqi_core::traits::Idea;
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};

impl SqliteIdeas {
    pub(super) fn normalize_tags(tags: impl IntoIterator<Item = String>) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut normalized = Vec::new();
        for tag in tags {
            let tag = tag.trim().to_lowercase();
            if tag.is_empty() {
                continue;
            }
            if seen.insert(tag.clone()) {
                normalized.push(tag);
            }
        }
        if normalized.is_empty() {
            normalized.push("fact".to_string());
        }
        normalized
    }

    /// Bulk-fetch tags from the idea_tags junction table for a set of idea IDs.
    pub(super) fn fetch_tags_for_ids(
        conn: &Connection,
        ids: &[String],
    ) -> HashMap<String, Vec<String>> {
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
        for tags in map.values_mut() {
            *tags = Self::normalize_tags(std::mem::take(tags));
        }
        map
    }

    /// Enrich a list of ideas with tags from the junction table.
    pub(super) fn enrich_tags(conn: &Connection, entries: &mut [Idea]) {
        let ids: Vec<String> = entries.iter().map(|e| e.id.clone()).collect();
        let tag_map = Self::fetch_tags_for_ids(conn, &ids);
        for entry in entries.iter_mut() {
            if let Some(tags) = tag_map.get(&entry.id) {
                entry.tags = tags.clone();
            } else {
                entry.tags = Self::normalize_tags(std::mem::take(&mut entry.tags));
            }
        }
    }

    pub(super) async fn ideas_by_tags_impl(
        &self,
        tags: &[String],
        limit: usize,
    ) -> Result<Vec<Idea>> {
        if tags.is_empty() || limit == 0 {
            return Ok(Vec::new());
        }
        let tags: Vec<String> = tags.iter().map(|t| t.trim().to_lowercase()).collect();
        self.blocking(move |conn| {
            let placeholders: Vec<String> =
                (0..tags.len()).map(|i| format!("?{}", i + 1)).collect();
            let sql = format!(
                "SELECT DISTINCT i.id, i.name, i.content, i.agent_id, i.session_id, i.created_at, \
                        i.scope \
                 FROM ideas i \
                 JOIN idea_tags t ON t.idea_id = i.id \
                 WHERE LOWER(t.tag) IN ({}) \
                 ORDER BY i.created_at DESC \
                 LIMIT ?{}",
                placeholders.join(", "),
                tags.len() + 1
            );
            let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = tags
                .iter()
                .map(|t| Box::new(t.clone()) as Box<dyn rusqlite::types::ToSql>)
                .collect();
            params.push(Box::new(limit as i64));
            let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            let mut stmt = conn.prepare(&sql)?;
            let mut entries: Vec<Idea> = stmt
                .query_map(param_refs.as_slice(), |row| {
                    let created_str: String = row.get(5)?;
                    let created_at = DateTime::parse_from_rfc3339(&created_str)
                        .map(|d| d.with_timezone(&Utc))
                        .unwrap_or_else(|_| Utc::now());
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
}
