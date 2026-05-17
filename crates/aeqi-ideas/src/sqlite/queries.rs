//! Read-only idea lookups that aren't part of the ranked search pipeline.
//!
//! Export-oriented queries (`list_all`, `list_global_ideas`) and direct
//! lookups by ID or name (`get_by_ids`, `get_by_name`). The ranked search
//! pipeline lives in [`super::search`].

use super::SqliteIdeas;
use aeqi_core::traits::Idea;
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::OptionalExtension;

impl SqliteIdeas {
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
                "SELECT id, name, content, agent_id, session_id, created_at, scope, kind, file_id \
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
                        parent_idea_id: None,
                        properties: None,
                        kind: row.get(7)?,
                        file_id: row.get(8)?,
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
                "SELECT id, name, content, agent_id, created_at, session_id, scope, kind, file_id
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
                        parent_idea_id: None,
                        properties: None,
                        kind: row.get(7)?,
                        file_id: row.get(8)?,
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
                "SELECT id, name, content, agent_id, created_at, session_id, scope, kind, file_id
                 FROM ideas WHERE name = ?1 AND agent_id = ?2 LIMIT 1"
            } else {
                "SELECT id, name, content, agent_id, created_at, session_id, scope, kind, file_id
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
                    parent_idea_id: None,
                    properties: None,
                    kind: row.get(7)?,
                    file_id: row.get(8)?,
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

    /// Return active idea IDs carrying `tag` whose `created_at >= since`,
    /// ordered oldest-first. Used by the consolidation threshold check so
    /// the consolidator persona sees the whole cluster. `limit` caps the
    /// returned list so the event's substituted args don't blow past the
    /// consolidator's context budget.
    pub(super) async fn list_active_by_tag_since_impl(
        &self,
        tag: &str,
        since: DateTime<Utc>,
        limit: usize,
    ) -> Result<Vec<String>> {
        if limit == 0 {
            return Ok(Vec::new());
        }
        let tag = tag.trim().to_lowercase();
        let since_str = since.to_rfc3339();
        self.blocking(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT i.id FROM ideas i \
                 JOIN idea_tags t ON t.idea_id = i.id \
                 WHERE LOWER(t.tag) = ?1 \
                   AND i.created_at >= ?2 \
                   AND i.status = 'active' \
                 ORDER BY i.created_at ASC \
                 LIMIT ?3",
            )?;
            let ids: Vec<String> = stmt
                .query_map(rusqlite::params![tag, since_str, limit as i64], |row| {
                    row.get::<_, String>(0)
                })?
                .filter_map(|r| r.ok())
                .collect();
            Ok(ids)
        })
        .await
    }

    /// Tables-in-Ideas Phase 2: set the parent_idea_id column. `None`
    /// detaches the row to root. The migration v15 column is SET NULL on
    /// parent delete, so a vanished parent leaves children intact.
    pub(super) async fn set_parent_impl(
        &self,
        idea_id: &str,
        parent_id: Option<&str>,
    ) -> Result<()> {
        let id = idea_id.to_string();
        let pid = parent_id.map(|s| s.to_string());
        self.blocking(move |conn| {
            conn.execute(
                "UPDATE ideas SET parent_idea_id = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![pid, Utc::now().to_rfc3339(), id],
            )?;
            Ok(())
        })
        .await
    }

    /// Set the structural `kind` (and optional `file_id`) of an existing idea.
    /// Validation of kind values lives in the tool boundary; this is the raw
    /// column write. See idea
    /// `architecture/kind-taxonomy-and-the-structural-vs-categorical-rule`.
    pub(super) async fn set_kind_impl(
        &self,
        idea_id: &str,
        kind: &str,
        file_id: Option<&str>,
    ) -> Result<()> {
        let id = idea_id.to_string();
        let kind = kind.to_string();
        let file_id = file_id.map(|s| s.to_string());
        self.blocking(move |conn| {
            conn.execute(
                "UPDATE ideas SET kind = ?1, file_id = ?2, updated_at = ?3 WHERE id = ?4",
                rusqlite::params![kind, file_id, Utc::now().to_rfc3339(), id],
            )?;
            Ok(())
        })
        .await
    }

    /// Tables-in-Ideas Phase 2: replace the `properties` JSON column wholesale.
    /// `None` clears (column NULL); `Some(value)` serialises and stores.
    pub(super) async fn set_properties_impl(
        &self,
        idea_id: &str,
        properties: Option<serde_json::Value>,
    ) -> Result<()> {
        let id = idea_id.to_string();
        let json: Option<String> = properties.as_ref().map(|v| v.to_string());
        self.blocking(move |conn| {
            conn.execute(
                "UPDATE ideas SET properties = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![json, Utc::now().to_rfc3339(), id],
            )?;
            Ok(())
        })
        .await
    }

    /// Tables-in-Ideas Phase 2: shallow-merge `patch` into the existing
    /// properties object. Keys set in `patch` overwrite; keys absent are
    /// preserved; explicit `null` in `patch` deletes the key. Run inside a
    /// single transaction so concurrent updates don't lose writes.
    pub(super) async fn merge_properties_impl(
        &self,
        idea_id: &str,
        patch: serde_json::Value,
    ) -> Result<()> {
        let id = idea_id.to_string();
        self.blocking(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let existing: Option<String> = tx
                .query_row(
                    "SELECT properties FROM ideas WHERE id = ?1",
                    rusqlite::params![&id],
                    |row| row.get::<_, Option<String>>(0),
                )
                .optional()?
                .flatten();

            let mut merged = existing
                .as_deref()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                .filter(|v| v.is_object())
                .unwrap_or_else(|| serde_json::json!({}));

            if let (Some(merged_obj), Some(patch_obj)) = (merged.as_object_mut(), patch.as_object())
            {
                for (k, v) in patch_obj {
                    if v.is_null() {
                        merged_obj.remove(k);
                    } else {
                        merged_obj.insert(k.clone(), v.clone());
                    }
                }
            }

            let stored: Option<String> = match merged.as_object() {
                Some(obj) if obj.is_empty() => None,
                _ => Some(merged.to_string()),
            };

            tx.execute(
                "UPDATE ideas SET properties = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![stored, Utc::now().to_rfc3339(), &id],
            )?;
            tx.commit()?;
            Ok(())
        })
        .await
    }

    /// Tables-in-Ideas Phase 2: list direct children of `parent_id`,
    /// newest first. Tags + properties are hydrated.
    pub(super) async fn list_children_impl(&self, parent_id: &str) -> Result<Vec<Idea>> {
        let pid = parent_id.to_string();
        self.blocking(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, content, agent_id, created_at, session_id, scope, properties, kind, file_id
                 FROM ideas
                 WHERE parent_idea_id = ?1
                 ORDER BY created_at DESC",
            )?;
            let mut entries: Vec<Idea> = stmt
                .query_map(rusqlite::params![pid], |row| {
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
                        .get::<_, Option<String>>(7)
                        .ok()
                        .flatten()
                        .as_deref()
                        .and_then(|s| serde_json::from_str(s).ok());
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
                        parent_idea_id: None,
                        properties: props,
                        kind: row.get(8)?,
                        file_id: row.get(9)?,
                    })
                })?
                .filter_map(|r| r.ok())
                .collect();
            Self::enrich_tags(conn, &mut entries);
            Ok(entries)
        })
        .await
    }

    /// Cheap id-only lookup for the unique-active `(agent_id, name)` slot.
    /// Returns `Some(id)` when a `status='active'` row exists for that key,
    /// `None` otherwise — including when the name only matches superseded or
    /// archived rows. Mirrors the partial unique index from migration v8.
    pub(super) async fn get_active_id_by_name_impl(
        &self,
        name: &str,
        agent_id: Option<&str>,
    ) -> Result<Option<String>> {
        let name = name.to_string();
        let agent_id = agent_id.map(|s| s.to_string());
        self.blocking(move |conn| {
            let sql = "SELECT id FROM ideas
                       WHERE name = ?1
                         AND COALESCE(agent_id, '') = COALESCE(?2, '')
                         AND status = 'active'
                       LIMIT 1";
            conn.query_row(sql, rusqlite::params![name, agent_id], |row| {
                row.get::<_, String>(0)
            })
            .optional()
            .map_err(|e| anyhow::anyhow!("get_active_id_by_name: {e}"))
        })
        .await
    }
}
