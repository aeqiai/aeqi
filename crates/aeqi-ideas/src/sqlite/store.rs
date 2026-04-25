//! Write path for the SQLite idea store.
//!
//! Owns the end-to-end store/update/delete lifecycle: redact secrets,
//! hand-off to the embedder (with a content-hash cache), mutate the
//! `ideas` and `idea_embeddings` rows, and maintain the idea_tags junction.
//! `store_with_ttl` and `store_with_scope` layer expiry and visibility on
//! top of the base `store` path. `reassign_agent` is the bulk ownership
//! mutation used when agents are renamed.
//!
//! The provenance-rich path (`store_full_impl`, `update_full_impl`,
//! `set_status_impl`, `set_embedding_impl`, `count_by_tag_since_impl`) is
//! the real underlying writer; the plainer entry points are thin wrappers
//! that fill missing fields with defaults. Agents R and W in Round 3 will
//! route their write paths through `store_full_impl`.

use super::SqliteIdeas;
use crate::vector::vec_to_bytes;
use aeqi_core::traits::{StoreFull, UpdateFull};
use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use tracing::{debug, warn};

/// Insert a provenance-rich row + its tags on an existing connection /
/// transaction. Shared between `store_full_impl` (plain blocking) and
/// `supersede_atomic_impl` (wrapped in a tx). `tags` must already be
/// normalised; `content` must already be redacted.
///
/// Returns the freshly-minted UUID.
fn insert_full_row_on_conn(
    conn: &Connection,
    input: &StoreFull,
    content: &str,
    tags: &[String],
) -> Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let hash = SqliteIdeas::content_hash(content);

    let expires_at = input.expires_at.as_ref().map(|d| d.to_rfc3339());
    let valid_from = input
        .valid_from
        .as_ref()
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| now.clone());
    let valid_until = input.valid_until.as_ref().map(|d| d.to_rfc3339());

    conn.execute(
        "INSERT INTO ideas (
            id, name, content, scope, agent_id, created_at, expires_at,
            content_hash, status, access_count, authored_by, confidence,
            embedding_pending, valid_from, valid_until, time_context
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7,
            ?8, ?9, 0, ?10, ?11,
            1, ?12, ?13, ?14
         )",
        rusqlite::params![
            id,
            input.name,
            content,
            input.scope.as_str(),
            input.agent_id,
            now,
            expires_at,
            hash,
            input.status,
            input.authored_by,
            input.confidence as f64,
            valid_from,
            valid_until,
            input.time_context,
        ],
    )?;

    for tag in tags {
        conn.execute(
            "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
            rusqlite::params![id, tag],
        )?;
    }
    Ok(id)
}

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

    // ── Round 2 provenance-rich write path ──────────────────────────────

    /// Provenance-rich store. This is the canonical writer for rows that
    /// carry any non-default lifecycle / provenance / validity data.
    ///
    /// Skips the 24h name+content dedup entirely — callers that need dedup
    /// should route through `store_impl` (which Agent W will refactor into
    /// the dispatch in Round 3). Embedding is *not* queued here; callers
    /// set `embedding_pending` and `set_embedding` completes the flow.
    pub(super) async fn store_full_impl(&self, input: StoreFull) -> Result<String> {
        // Same secret scrubbing as the plain path — the content lands in the
        // FTS index and the embedding input, so over-redaction is safer than
        // under-redaction.
        let content = crate::redact::redact_secrets(&input.content);
        let tags = Self::normalize_tags(input.tags.iter().cloned());

        self.blocking(move |conn| insert_full_row_on_conn(conn, &input, &content, &tags))
            .await
    }

    /// Atomically supersede an existing idea. Wraps three sub-operations in
    /// a single SQLite transaction:
    ///
    /// 1. Flip the old row's `status` to `superseded`.
    /// 2. Insert the new row (the v8 partial unique index enforces active-
    ///    name uniqueness, so step 1 has to land before step 2).
    /// 3. Write a `supersedes` edge from new → old.
    ///
    /// If any step fails the transaction rolls back, leaving the old row in
    /// `active` and no partial edge. The three sub-ops have an interlocked
    /// correctness contract that plain sequential calls can't honour — if
    /// step 2 or 3 errored mid-way the old row would be orphaned in
    /// `superseded` status with no replacement.
    ///
    /// Edge reconciliation from body parsing (mentions, embeds, typed
    /// prefixes) still happens outside this transaction — inline edges are
    /// additive and their resolver may need async DB round-trips that don't
    /// compose with a single-connection tx.
    pub(super) async fn supersede_atomic_impl(
        &self,
        old_id: &str,
        input: StoreFull,
    ) -> Result<String> {
        let old = old_id.to_string();
        let content = crate::redact::redact_secrets(&input.content);
        let tags = Self::normalize_tags(input.tags.iter().cloned());

        self.blocking(move |conn| {
            let tx = conn.unchecked_transaction()?;
            let now = Utc::now().to_rfc3339();

            // 1. Flip the old row off `active` so step 2 can insert the
            //    same `(agent_id, name)` without tripping the partial
            //    unique index.
            let flipped = tx.execute(
                "UPDATE ideas SET status = 'superseded', updated_at = ?1 WHERE id = ?2",
                rusqlite::params![now, old],
            )?;
            if flipped == 0 {
                anyhow::bail!("supersede_atomic: old idea {old} not found");
            }

            // 2. Insert the replacement row (tags + row in one shot).
            let new_id = insert_full_row_on_conn(&tx, &input, &content, &tags)?;

            // 3. Write a `link` edge new → old. The supersession
            //    relationship itself is captured by `ideas.status =
            //    'superseded'` on the old row; the edge is a structural
            //    breadcrumb so graph walks still surface the lineage,
            //    not a typed semantic relation. T1.8 retired the
            //    `supersedes` relation.
            tx.execute(
                "INSERT INTO entity_edges \
                    (source_kind, source_id, target_kind, target_id, \
                     relation, strength, created_at) \
                 VALUES ('idea', ?1, 'idea', ?2, 'link', 1.0, ?3)",
                rusqlite::params![new_id, old, now],
            )?;

            tx.commit()?;
            Ok(new_id)
        })
        .await
    }

    /// Provenance-rich partial update. Only fields set on the patch are
    /// touched; `updated_at` defaults to now when content changes and a
    /// patch-level `updated_at` wasn't supplied.
    pub(super) async fn update_full_impl(&self, id: &str, patch: UpdateFull) -> Result<()> {
        let id = id.to_string();
        let content = patch.content.clone();
        self.blocking(move |conn| {
            let now = patch
                .updated_at
                .as_ref()
                .map(|d| d.to_rfc3339())
                .unwrap_or_else(|| Utc::now().to_rfc3339());

            if let Some(ref new_content) = content {
                let hash = Self::content_hash(new_content);
                conn.execute(
                    "UPDATE ideas SET content = ?1, content_hash = ?2, updated_at = ?3 \
                     WHERE id = ?4",
                    rusqlite::params![new_content, hash, &now, &id],
                )?;
            }

            if let Some(conf) = patch.confidence {
                conn.execute(
                    "UPDATE ideas SET confidence = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![conf as f64, &now, &id],
                )?;
            }

            if let Some(pending) = patch.embedding_pending {
                let flag: i64 = if pending { 1 } else { 0 };
                conn.execute(
                    "UPDATE ideas SET embedding_pending = ?1 WHERE id = ?2",
                    rusqlite::params![flag, &id],
                )?;
            }

            if let Some(ref valid_until) = patch.valid_until {
                conn.execute(
                    "UPDATE ideas SET valid_until = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![valid_until.to_rfc3339(), &now, &id],
                )?;
            }

            if let Some(ref status) = patch.status {
                conn.execute(
                    "UPDATE ideas SET status = ?1, updated_at = ?2 WHERE id = ?3",
                    rusqlite::params![status, &now, &id],
                )?;
            }

            if let Some(ref tags) = patch.tags {
                let tags = Self::normalize_tags(tags.iter().cloned());
                conn.execute(
                    "DELETE FROM idea_tags WHERE idea_id = ?1",
                    rusqlite::params![&id],
                )?;
                for tag in &tags {
                    conn.execute(
                        "INSERT OR IGNORE INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
                        rusqlite::params![&id, tag],
                    )?;
                }
            }

            Ok(())
        })
        .await
    }

    /// Flip an idea's `status` column. Used by supersession (writes
    /// `superseded`) and consolidation (writes `archived`).
    pub(super) async fn set_status_impl(&self, id: &str, status: &str) -> Result<()> {
        let id = id.to_string();
        let status = status.to_string();
        self.blocking(move |conn| {
            conn.execute(
                "UPDATE ideas SET status = ?1, updated_at = ?2 WHERE id = ?3",
                rusqlite::params![status, Utc::now().to_rfc3339(), id],
            )?;
            Ok(())
        })
        .await
    }

    /// Persist a fresh embedding for an existing idea and clear the
    /// `embedding_pending` flag. Called by the embed worker once the
    /// (possibly slow) embedder round-trip completes.
    pub(super) async fn set_embedding_impl(&self, id: &str, embedding: &[f32]) -> Result<()> {
        let id = id.to_string();
        let bytes = vec_to_bytes(embedding);
        let dims = embedding.len() as i64;
        self.blocking(move |conn| {
            // Content hash is the cache key for duplicate-embedding detection;
            // read it from the row so a later call with the same content can
            // short-circuit via lookup_embedding_by_hash.
            let hash: Option<String> = conn
                .query_row(
                    "SELECT content_hash FROM ideas WHERE id = ?1",
                    rusqlite::params![&id],
                    |row| row.get(0),
                )
                .optional()?;
            conn.execute(
                "INSERT OR REPLACE INTO idea_embeddings \
                     (idea_id, embedding, dimensions, content_hash) \
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, bytes, dims, hash],
            )?;
            conn.execute(
                "UPDATE ideas SET embedding_pending = 0 WHERE id = ?1",
                rusqlite::params![id],
            )?;
            Ok(())
        })
        .await
    }

    /// Count rows tagged `tag` created on/after `since`. Used by the
    /// per-store consolidation threshold check.
    pub(super) async fn count_by_tag_since_impl(
        &self,
        tag: &str,
        since: DateTime<Utc>,
    ) -> Result<i64> {
        let tag = tag.trim().to_lowercase();
        self.blocking(move |conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(DISTINCT i.id) \
                 FROM ideas i JOIN idea_tags t ON t.idea_id = i.id \
                 WHERE LOWER(t.tag) = ?1 AND i.created_at >= ?2",
                rusqlite::params![tag, since.to_rfc3339()],
                |row| row.get(0),
            )?;
            Ok(count)
        })
        .await
    }
}
