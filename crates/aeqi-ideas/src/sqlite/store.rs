//! Write path for the SQLite idea store.
//!
//! Owns the end-to-end store/update/delete lifecycle: redact secrets,
//! hand-off to the embedder (with a content-hash cache), mutate the
//! `ideas` and `idea_embeddings` rows, and maintain the idea_tags junction.
//! `store_with_ttl` and `store_with_scope` layer expiry and visibility on
//! top of the base `store` path. `reassign_agent` is the bulk ownership
//! mutation used when agents are renamed.

use super::SqliteIdeas;
use crate::vector::vec_to_bytes;
use anyhow::Result;
use chrono::Utc;
use rusqlite::OptionalExtension;
use tracing::{debug, warn};

impl SqliteIdeas {
    pub(super) async fn store_impl(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
    ) -> Result<String> {
        // Strip credentials before any persistence path: the content ends up in
        // the DB row, the embedding input, and the FTS index. Over-redacting a
        // note is always preferable to leaking a token.
        let redacted = crate::redact::redact_secrets(content);

        // Dedup + insert in spawn_blocking to avoid blocking tokio.
        let name_owned = name.to_string();
        let content_owned = redacted.clone();
        let tags_owned = Self::normalize_tags(tags.iter().cloned());
        let agent_id_owned = agent_id.map(|s| s.to_string());
        let this = self.clone();

        let id = tokio::task::spawn_blocking(move || -> Result<String> {
            if this.has_recent_duplicate(&content_owned, 24) {
                debug!(name = %name_owned, "skipping duplicate idea (exact content match within 24h)");
                return Ok(String::new());
            }
            if this.has_recent_name(&name_owned, agent_id_owned.as_deref(), 24) {
                debug!(name = %name_owned, "skipping duplicate idea (same name within 24h)");
                return Ok(String::new());
            }

            let id = uuid::Uuid::new_v4().to_string();
            let now = Utc::now().to_rfc3339();
            let initial_hash = Self::content_hash(&content_owned);

            let conn = this.conn.lock().map_err(|e| anyhow::anyhow!("lock: {e}"))?;
            conn.execute(
                "INSERT INTO ideas (id, name, content, agent_id, created_at, content_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    id,
                    name_owned,
                    content_owned,
                    agent_id_owned,
                    now,
                    initial_hash
                ],
            )?;

            // Insert all tags into the junction table.
            for tag in &tags_owned {
                conn.execute(
                    "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                    rusqlite::params![id, tag],
                )?;
            }

            debug!(id = %id, name = %name_owned, agent_id = ?agent_id_owned, "idea stored");
            Ok(id)
        })
        .await
        .map_err(|e| anyhow::anyhow!("spawn_blocking join: {e}"))??;

        if id.is_empty() {
            return Ok(id);
        }

        // Embedding phase: async embed, then sync store.
        if let Some(ref embedder) = self.embedder {
            let hash = Self::content_hash(&redacted);

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
                match embedder.embed(&redacted).await {
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
                            "INSERT OR REPLACE INTO idea_embeddings (idea_id, embedding, dimensions, content_hash) VALUES (?1, ?2, ?3, ?4)",
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

    pub(super) async fn delete_impl(&self, id: &str) -> Result<()> {
        let id = id.to_string();
        self.blocking(move |conn| {
            conn.execute(
                "DELETE FROM idea_tags WHERE idea_id = ?1",
                rusqlite::params![id],
            )?;
            conn.execute("DELETE FROM ideas WHERE id = ?1", rusqlite::params![id])?;
            conn.execute(
                "DELETE FROM idea_embeddings WHERE idea_id = ?1",
                rusqlite::params![id],
            )?;
            Ok(())
        })
        .await
    }

    pub(super) async fn update_impl(
        &self,
        id: &str,
        name: Option<&str>,
        content: Option<&str>,
        tags: Option<&[String]>,
    ) -> Result<()> {
        let id = id.to_string();
        let id_for_update = id.clone();
        let name = name.map(|s| s.to_string());
        let content = content.map(|s| s.to_string());
        let content_for_embedding = content.clone();
        let tags_owned = tags.map(|t| Self::normalize_tags(t.iter().cloned()));
        let content_changed = self
            .blocking(move |conn| {
                let current_content: Option<String> = conn
                    .query_row(
                        "SELECT content FROM ideas WHERE id = ?1",
                        rusqlite::params![&id_for_update],
                        |row| row.get(0),
                    )
                    .optional()?;
                let Some(current_content) = current_content else {
                    anyhow::bail!("idea not found: {id_for_update}");
                };

                if name.is_none() && content.is_none() && tags_owned.is_none() {
                    anyhow::bail!("at least one field must be updated");
                }

                let content_changed = content
                    .as_ref()
                    .is_some_and(|new_content| new_content != &current_content);

                let now = Utc::now().to_rfc3339();
                if let Some(ref name) = name {
                    conn.execute(
                        "UPDATE ideas SET name = ?1, updated_at = ?2 WHERE id = ?3",
                        rusqlite::params![name, &now, &id_for_update],
                    )?;
                }
                if let Some(ref content) = content {
                    let new_hash = Self::content_hash(content);
                    conn.execute(
                        "UPDATE ideas SET content = ?1, updated_at = ?2, content_hash = ?3 \
                         WHERE id = ?4",
                        rusqlite::params![content, &now, new_hash, &id_for_update],
                    )?;
                }
                if let Some(ref tags) = tags_owned {
                    conn.execute(
                        "UPDATE ideas SET updated_at = ?1 WHERE id = ?2",
                        rusqlite::params![&now, &id_for_update],
                    )?;
                    conn.execute(
                        "DELETE FROM idea_tags WHERE idea_id = ?1",
                        rusqlite::params![&id_for_update],
                    )?;
                    for tag in tags {
                        conn.execute(
                            "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                            rusqlite::params![&id_for_update, tag],
                        )?;
                    }
                }
                Ok(content_changed)
            })
            .await?;

        if !content_changed {
            return Ok(());
        }

        let Some(content) = content_for_embedding else {
            return Ok(());
        };

        if let Some(ref embedder) = self.embedder {
            let hash = Self::content_hash(&content);

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
                Some(existing_bytes)
            } else {
                match embedder.embed(&content).await {
                    Ok(embedding) => Some(vec_to_bytes(&embedding)),
                    Err(e) => {
                        warn!(id = %id, "embedding refresh failed after update: {e}");
                        None
                    }
                }
            };

            let conn = self.conn.clone();
            let id_for_embedding = id.clone();
            let dims = self.embedding_dimensions;
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(conn) = conn.lock() {
                    let result = if let Some(bytes) = embed_bytes {
                        conn.execute(
                            "INSERT OR REPLACE INTO idea_embeddings (idea_id, embedding, dimensions, content_hash) VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![id_for_embedding, bytes, dims as i64, hash],
                        )
                        .map(|_| ())
                    } else {
                        conn.execute(
                            "DELETE FROM idea_embeddings WHERE idea_id = ?1",
                            rusqlite::params![id_for_embedding],
                        )
                        .map(|_| ())
                    };
                    if let Err(e) = result {
                        warn!(id = %id, "failed to refresh embedding after update: {e}");
                    }
                }
            })
            .await;
        } else {
            self.blocking(move |conn| {
                conn.execute(
                    "DELETE FROM idea_embeddings WHERE idea_id = ?1",
                    rusqlite::params![id],
                )?;
                Ok(())
            })
            .await?;
        }

        Ok(())
    }

    pub(super) async fn store_with_ttl_impl(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
        ttl_secs: Option<u64>,
    ) -> Result<String> {
        let id = self.store_impl(name, content, tags, agent_id).await?;
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

    pub(super) async fn store_with_scope_impl(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
        scope: aeqi_core::Scope,
    ) -> Result<String> {
        let id = self.store_impl(name, content, tags, agent_id).await?;
        if id.is_empty() || scope == aeqi_core::Scope::SelfScope {
            return Ok(id);
        }
        let id_c = id.clone();
        let scope_str = scope.as_str().to_string();
        self.blocking(move |conn| {
            conn.execute(
                "UPDATE ideas SET scope = ?1 WHERE id = ?2",
                rusqlite::params![scope_str, id_c],
            )?;
            Ok(())
        })
        .await?;
        Ok(id)
    }

    pub(super) async fn reassign_agent_impl(
        &self,
        old_agent_id: &str,
        new_agent_id: &str,
    ) -> Result<u64> {
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
}
