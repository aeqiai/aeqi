//! Write path for the SQLite idea store.
//!
//! Owns the end-to-end store/update/delete lifecycle: redact secrets,
//! mutate the `ideas` and `idea_embeddings` rows, and maintain the
//! `idea_tags` junction. `store_with_ttl` and `store_with_scope` layer
//! expiry and visibility on top of the base `store` path. `reassign_agent`
//! is the bulk ownership mutation used when agents are renamed.
//!
//! The provenance-rich path (`store_full_impl`, `update_full_impl`,
//! `set_status_impl`, `set_embedding_impl`, `count_by_tag_since_impl`) is
//! the real underlying writer; the plainer entry points (`store_impl`,
//! `store_with_ttl_impl`, `store_with_scope_impl`) are thin wrappers that
//! fill missing fields with defaults and funnel through `store_full_impl`.

use super::{EmbeddingProfile, EmbeddingRebuildSummary, SqliteIdeas};
use crate::vector::vec_to_bytes;
use aeqi_core::traits::{StoreFull, UpdateFull};
use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension};
use tracing::{debug, warn};

#[derive(Debug)]
struct EmbeddingRebuildCandidate {
    id: String,
    content: String,
}

fn rebuild_candidate_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<EmbeddingRebuildCandidate> {
    Ok(EmbeddingRebuildCandidate {
        id: row.get(0)?,
        content: row.get(1)?,
    })
}

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
    /// Plain entry point for the `IdeaStore::store` trait method. Builds a
    /// `StoreFull` payload with default provenance and routes through the
    /// canonical `store_full_impl` writer, then runs inline embedding when
    /// an embedder is configured.
    ///
    /// Dedup is the caller's responsibility: the orchestrator's
    /// `DedupPipeline` (`aeqi_orchestrator::ipc::ideas`) is the canonical
    /// dedup gate for IPC writers. Same-name collisions on active rows are
    /// rejected by the partial unique index on `(COALESCE(agent_id, ''),
    /// name) WHERE status='active'`; callers that need short-window dedup
    /// must layer it above this method instead of relying on a silent
    /// return-empty-id skip.
    ///
    /// Embedding is inline: when an embedder is attached, the call returns
    /// only after the embedding has been computed (cache-hit or fresh) and
    /// `embedding_pending` flipped to 0. Embedder-less stores leave the
    /// row with `embedding_pending=1` for the `embed_worker` to pick up.
    pub(super) async fn store_impl(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
    ) -> Result<String> {
        let redacted = crate::redact::redact_secrets(content);
        let mut input = StoreFull::new(name, redacted.clone());
        input.tags = tags.to_vec();
        input.agent_id = agent_id.map(|s| s.to_string());
        let id = self.store_full_impl(input).await?;

        // Inline embedding phase — preserves the synchronous "store +
        // embed" contract that the plain `IdeaStore::store` callers (and
        // unit tests) rely on. Daemon writers that route through
        // `store_full` directly let the async `embed_worker` flush
        // `embedding_pending=1` rows later.
        if let Some(ref embedder) = self.embedder {
            let profile = self.active_embedding_profile();
            let hash = Self::content_hash(&redacted);

            let cached = {
                let conn = self.conn.clone();
                let hash_c = hash.clone();
                let profile = profile.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().ok()?;
                    match profile {
                        Some(profile) => Self::lookup_embedding_by_hash_for_profile(
                            &conn,
                            &hash_c,
                            &profile.provider,
                            &profile.model,
                            profile.dimensions,
                        ),
                        None => None,
                    }
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
                let id_c = id.clone();
                let dims = self.embedding_dimensions;
                let provider = self.embedding_provider.clone();
                let model = self.embedding_model.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(conn) = conn.lock()
                        && let Err(e) = conn
                            .execute(
                                "INSERT OR REPLACE INTO idea_embeddings \
                                     (idea_id, embedding, dimensions, content_hash, embedding_provider, embedding_model) \
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                                rusqlite::params![&id_c, bytes, dims as i64, hash, provider, model],
                            )
                            .and_then(|_| {
                                conn.execute(
                                    "UPDATE ideas SET embedding_pending = 0 WHERE id = ?1",
                                    rusqlite::params![&id_c],
                                )
                            })
                    {
                        warn!(id = %id_c, "failed to store embedding: {e}");
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
            // Sweep entity_edges where this idea was source or target
            // (kind='idea'). `entity_edges` has no FK to `ideas` —
            // SQLite can't add a real FK after table create without a
            // full rebuild (and the schema.rs trapdoor banner says
            // never rename-swap this table). Do the cascade explicitly
            // at delete-time. Without this, edges accumulate
            // monotonically as ideas get deleted; reads were
            // accidentally correct only because callers filter by live
            // ids. 2026-05-14, Ideas steward Wave 4, Lane B.
            conn.execute(
                "DELETE FROM entity_edges \
                 WHERE (source_kind = 'idea' AND source_id = ?1) \
                    OR (target_kind = 'idea' AND target_id = ?1)",
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
            let profile = self.active_embedding_profile();
            let hash = Self::content_hash(&content);

            let cached = {
                let conn = self.conn.clone();
                let hash_c = hash.clone();
                let profile = profile.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = conn.lock().ok()?;
                    match profile {
                        Some(profile) => Self::lookup_embedding_by_hash_for_profile(
                            &conn,
                            &hash_c,
                            &profile.provider,
                            &profile.model,
                            profile.dimensions,
                        ),
                        None => None,
                    }
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
            let provider = self.embedding_provider.clone();
            let model = self.embedding_model.clone();
            let _ = tokio::task::spawn_blocking(move || {
                if let Ok(conn) = conn.lock() {
                    let result = if let Some(bytes) = embed_bytes {
                        conn.execute(
                            "INSERT OR REPLACE INTO idea_embeddings \
                                 (idea_id, embedding, dimensions, content_hash, embedding_provider, embedding_model) \
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                            rusqlite::params![&id_for_embedding, bytes, dims as i64, hash, provider, model],
                        )
                        .and_then(|_| {
                            conn.execute(
                                "UPDATE ideas SET embedding_pending = 0 WHERE id = ?1",
                                rusqlite::params![&id_for_embedding],
                            )
                        })
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
        if scope == aeqi_core::Scope::SelfScope {
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

    /// Provenance-rich store. The canonical writer for the SQLite backend:
    /// every store path on this store (`store_impl`, `store_with_ttl_impl`,
    /// `store_with_scope_impl`, and direct `IdeaStore::store_full` callers)
    /// funnels through here.
    ///
    /// Performs no dedup of its own; the partial unique index on
    /// `(COALESCE(agent_id, ''), name) WHERE status='active'` is the schema-
    /// level guard against same-name active duplicates. Callers that need
    /// short-window content dedup (the orchestrator's `DedupPipeline`,
    /// importers' pre-check, etc.) layer it above this method.
    ///
    /// Embedding is *not* queued here; callers (typically `embed_worker`)
    /// honour the `embedding_pending=1` flag set by `insert_full_row_on_conn`
    /// and complete the flow via `set_embedding`.
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
        let provider = self.embedding_provider.clone();
        let model = self.embedding_model.clone();
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
                     (idea_id, embedding, dimensions, content_hash, embedding_provider, embedding_model) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![id, bytes, dims, hash, provider, model],
            )?;
            conn.execute(
                "UPDATE ideas SET embedding_pending = 0 WHERE id = ?1",
                rusqlite::params![id],
            )?;
            Ok(())
        })
        .await
    }

    pub async fn rebuild_stale_embeddings(
        &self,
        limit: Option<usize>,
        dry_run: bool,
    ) -> Result<EmbeddingRebuildSummary> {
        if limit == Some(0) {
            return Ok(EmbeddingRebuildSummary {
                dry_run,
                ..EmbeddingRebuildSummary::default()
            });
        }

        let profile = self.active_embedding_profile().context(
            "idea vector search is disabled; configure an embedding provider/model first",
        )?;
        let embedder = self
            .embedder
            .clone()
            .context("idea vector search is disabled; configure an embedder first")?;
        let candidates = self
            .stale_embedding_candidates(profile.clone(), limit)
            .await?;

        let mut summary = EmbeddingRebuildSummary {
            candidates: candidates.len(),
            dry_run,
            ..EmbeddingRebuildSummary::default()
        };
        if dry_run {
            return Ok(summary);
        }

        for candidate in candidates {
            let pending_id = candidate.id.clone();
            self.blocking(move |conn| {
                conn.execute(
                    "UPDATE ideas SET embedding_pending = 1 WHERE id = ?1",
                    rusqlite::params![pending_id],
                )?;
                Ok(())
            })
            .await?;

            match embedder.embed(&candidate.content).await {
                Ok(embedding) if embedding.len() == profile.dimensions => {
                    if let Err(err) = self.set_embedding_impl(&candidate.id, &embedding).await {
                        summary.failed += 1;
                        warn!(id = %candidate.id, "failed to persist rebuilt embedding: {err}");
                    } else {
                        summary.rebuilt += 1;
                    }
                }
                Ok(embedding) => {
                    summary.failed += 1;
                    warn!(
                        id = %candidate.id,
                        expected = profile.dimensions,
                        actual = embedding.len(),
                        "embedder returned the wrong number of dimensions"
                    );
                }
                Err(err) => {
                    summary.failed += 1;
                    warn!(id = %candidate.id, "failed to rebuild embedding: {err}");
                }
            }
        }

        Ok(summary)
    }

    async fn stale_embedding_candidates(
        &self,
        profile: EmbeddingProfile,
        limit: Option<usize>,
    ) -> Result<Vec<EmbeddingRebuildCandidate>> {
        self.blocking(move |conn| {
            let mut sql = String::from(
                "SELECT i.id, i.content \
                 FROM ideas i \
                 LEFT JOIN idea_embeddings e ON e.idea_id = i.id \
                 WHERE i.status = 'active' \
                   AND (i.embedding_pending = 1 \
                        OR e.idea_id IS NULL \
                        OR e.embedding_provider IS NULL \
                        OR e.embedding_model IS NULL \
                        OR e.embedding_provider != ?1 \
                        OR e.embedding_model != ?2 \
                        OR e.dimensions != ?3) \
                 ORDER BY i.created_at ASC, i.id ASC",
            );

            if limit.is_some() {
                sql.push_str(" LIMIT ?4");
            }

            let mut stmt = conn.prepare(&sql)?;
            let rows = match limit {
                Some(limit) => stmt.query_map(
                    rusqlite::params![
                        &profile.provider,
                        &profile.model,
                        profile.dimensions as i64,
                        limit as i64
                    ],
                    rebuild_candidate_from_row,
                )?,
                None => stmt.query_map(
                    rusqlite::params![&profile.provider, &profile.model, profile.dimensions as i64],
                    rebuild_candidate_from_row,
                )?,
            };

            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(Into::into)
        })
        .await
    }

    /// Find rows still `embedding_pending = 1` whose most-recent
    /// timestamp (updated_at if set, else created_at) is older than
    /// `cutoff`. Used by the embed-worker sweeper to re-enqueue jobs
    /// that fell off the queue (drop-on-full or worker crash). Returns
    /// `(id, content)` pairs ordered ascending so persistent failures
    /// don't starve newer rows.
    ///
    /// The query rides the partial index
    /// `idx_ideas_embedding_pending WHERE embedding_pending=1`, so the
    /// scan is bounded to the pending set rather than the whole table.
    pub(super) async fn find_stale_pending_impl(
        &self,
        cutoff: DateTime<Utc>,
        limit: usize,
    ) -> Result<Vec<(String, String)>> {
        let cutoff_str = cutoff.to_rfc3339();
        let limit = limit as i64;
        self.blocking(move |conn| {
            // `updated_at` is nullable; a fresh insert leaves it NULL
            // until something rewrites the row. Use COALESCE so a row
            // that has been pending since insert is just as eligible as
            // a row that was edited later.
            let mut stmt = conn.prepare(
                "SELECT id, content FROM ideas \
                 WHERE embedding_pending = 1 \
                   AND COALESCE(updated_at, created_at) < ?1 \
                 ORDER BY COALESCE(updated_at, created_at) ASC \
                 LIMIT ?2",
            )?;
            let rows = stmt
                .query_map(rusqlite::params![cutoff_str, limit], |row| {
                    let id: String = row.get(0)?;
                    let content: String = row.get(1)?;
                    Ok((id, content))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
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
