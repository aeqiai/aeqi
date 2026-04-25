//! Schema creation and migration runner.
//!
//! This module owns every CREATE TABLE / CREATE INDEX / CREATE TRIGGER for the
//! ideas database, plus the `prepare_schema` driver and a versioned migration
//! runner tracked in `schema_version`.
//!
//! # History: one baseline, no migration chain
//!
//! This file used to carry nine numbered migrations (`migration_v1` ..
//! `migration_v9`) that each incrementally reshaped the DB — ALTER TABLEs,
//! a rename-swap to drop dead columns, FTS/ANN wiring, bi-temporal columns,
//! the partial unique index on active names, and a default-tag backfill.
//!
//! On 2026-04-24 (R5 Agent A — Migration Collapse) the v1..v7 chain was
//! deleted because every deployed DB had already run them. R9 (same day)
//! finished the job by deleting v8 and v9: after the platform deploy the
//! live DB reached `schema_version = 9`, so no DB in the fleet still needs
//! incremental catch-up. Fresh DBs go straight to `initial_schema` and
//! legacy DBs (v1..v9) are pure no-ops.
//!
//! The runner now recognises two cases:
//!
//! 1. **Fresh DB** (`schema_version` empty): apply `initial_schema` and
//!    stamp `schema_version = 10`. This is the "baseline reached" marker.
//! 2. **Legacy DB at v1..v9 (or v10)**: every table, index, and trigger is
//!    already present. The runner skips `initial_schema` and iterates the
//!    empty migrations list; no-op.
//!
//! Future incremental migrations start at v11 and slot into the
//! `migrations: &[(i64, Migration)]` table below.
//!
//! # Writing new migrations
//!
//! - Never do a rename-swap (`CREATE TABLE new; INSERT…SELECT; DROP TABLE old;
//!   RENAME new TO old`) on `ideas` without first disabling foreign keys
//!   **inside** the transaction. The v3 migration did this and silently
//!   cascade-wiped every `idea_tags` row in production, which is why v9 had
//!   to exist as a backfill. The baseline below doesn't rename-swap — if you
//!   need to drop a column on a modern SQLite use `ALTER TABLE … DROP COLUMN`
//!   directly.
//! - Prefer additive migrations (new tables, new columns with defaults, new
//!   indexes) over rebuilds. Rebuilds interact badly with FTS5 content-table
//!   triggers and foreign keys.

use super::SqliteIdeas;
use crate::vector::VectorStore;
use anyhow::{Context, Result};
use rusqlite::Connection;

/// The version stamped on a fresh DB after `initial_schema` runs. Legacy
/// DBs that ran the old v1..v9 chain carry rows 1..9 and are not re-stamped;
/// they catch up via the `migrations` table below. The current head is v12
/// (T1.9 — credential lifecycle substrate).
const BASELINE_VERSION: i64 = 12;

impl SqliteIdeas {
    pub fn prepare_schema(conn: &Connection) -> Result<()> {
        run_migrations(conn)
    }
}

/// Migration runner.
///
/// * If `schema_version` is empty, runs `initial_schema` in a single
///   transaction and stamps `BASELINE_VERSION`.
/// * If `schema_version.max` is ≥ 1, the DB was migrated by the legacy
///   v1..v9 chain (or already stamped at baseline). Any versioned migration
///   newer than `current` in the `migrations` table runs; today that list
///   is empty, so opening a legacy DB is a pure no-op.
/// * Future migrations (v11+) slot into the same `migrations` table.
fn run_migrations(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
        [],
    )?;
    let current: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    if current == 0 {
        // Truly fresh DB — apply the collapsed baseline.
        let tx = conn.unchecked_transaction()?;
        initial_schema(&tx).context("initial_schema failed")?;
        tx.execute(
            "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![BASELINE_VERSION, chrono::Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
        return Ok(());
    }

    // Legacy DBs at v1..v9 already have every table, index, and trigger.
    // v11 (T1.8) generalises `idea_edges` → `entity_edges` with kind
    // columns and collapses the legacy typed-relation vocabulary down to
    // mention / embed / link.
    type Migration = fn(&Connection) -> Result<()>;
    let migrations: &[(i64, Migration)] = &[
        (11, migration_v11_entity_edges),
        (12, migration_v12_credentials),
    ];
    for (version, f) in migrations {
        if *version > current {
            let tx = conn.unchecked_transaction()?;
            f(&tx).with_context(|| format!("migration v{version} failed"))?;
            tx.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![version, chrono::Utc::now().to_rfc3339()],
            )?;
            tx.commit()?;
        }
    }
    Ok(())
}

/// Creates the full post-v9 schema from scratch.
///
/// Runs as a single transaction (the caller wraps it). Covers:
///
/// * Core tables: `ideas`, `idea_tags`, `idea_edges`, `idea_embeddings`,
///   `idea_access_log`, `idea_feedback`.
/// * FTS5 virtual table `ideas_fts` + its 3 content-table triggers.
/// * ANN virtual table `idea_vec` (feature-gated behind `ann-sqlite-vec`) +
///   its 3 sync triggers. Failure to install vec0 is non-fatal — the
///   brute-force cosine path in `VectorStore` stays active.
/// * Every index the legacy migrations built, including the partial unique
///   index on `(agent_id, name) WHERE status='active'` (v8).
///
/// There is no tag backfill here — on a fresh DB there's nothing to backfill.
/// Legacy DBs that needed the v9 backfill already ran it.
fn initial_schema(conn: &Connection) -> Result<()> {
    // ideas — final shape after v2 additions + v3 drops + v6 bi-temporal cols.
    conn.execute_batch(
        "CREATE TABLE ideas (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            scope TEXT NOT NULL DEFAULT 'self',
            agent_id TEXT,
            session_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            expires_at TEXT,
            content_hash TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            access_count INTEGER NOT NULL DEFAULT 0,
            last_accessed TEXT,
            authored_by TEXT,
            confidence REAL NOT NULL DEFAULT 1.0,
            verified_by TEXT,
            verified_at TEXT,
            last_feedback_at TEXT,
            feedback_boost REAL NOT NULL DEFAULT 0,
            embedding_pending INTEGER NOT NULL DEFAULT 1,
            valid_from TEXT,
            valid_until TEXT,
            time_context TEXT NOT NULL DEFAULT 'timeless'
        );",
    )?;

    // idea_tags — many-to-many tag join (cascaded delete).
    conn.execute_batch(
        "CREATE TABLE idea_tags (
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY (idea_id, tag)
        );",
    )?;

    // entity_edges — typed relations between entities (idea → idea by
    // default; cross-kind edges to sessions / quests / agents allowed).
    // Renamed from `idea_edges` in T1.8 with `source_kind` / `target_kind`
    // columns added. The PRIMARY KEY includes both kinds so an idea→idea
    // and idea→session edge with the same id pair can coexist.
    conn.execute_batch(
        "CREATE TABLE entity_edges (
            source_kind TEXT NOT NULL DEFAULT 'idea',
            source_id TEXT NOT NULL,
            target_kind TEXT NOT NULL DEFAULT 'idea',
            target_id TEXT NOT NULL,
            relation TEXT NOT NULL,
            strength REAL NOT NULL DEFAULT 0.5,
            agent TEXT,
            task_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_reinforced_at TEXT,
            PRIMARY KEY (source_kind, source_id, target_kind, target_id, relation)
        );",
    )?;

    // idea_embeddings — owned here (not in VectorStore::open) to keep the
    // whole schema definition in one place. VectorStore::open is idempotent;
    // if it runs later it won't clobber this.
    conn.execute_batch(
        "CREATE TABLE idea_embeddings (
            idea_id TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
            embedding BLOB NOT NULL,
            dimensions INTEGER NOT NULL,
            content_hash TEXT
        );",
    )?;

    // idea_access_log — append-only retrieval log for feedback signals.
    conn.execute_batch(
        "CREATE TABLE idea_access_log (
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            agent_id TEXT,
            session_id TEXT,
            context TEXT NOT NULL,
            result_position INTEGER,
            query_hash TEXT
        );",
    )?;

    // idea_feedback — thumbs-up/down + custom signals, weighted.
    conn.execute_batch(
        "CREATE TABLE idea_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            signal TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 1.0,
            at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            agent_id TEXT,
            session_id TEXT,
            query_text TEXT,
            note TEXT
        );",
    )?;

    // Indexes — every one the legacy v1..v8 chain built.
    conn.execute_batch(
        "CREATE INDEX idx_ideas_name ON ideas(name);
         CREATE INDEX idx_ideas_created ON ideas(created_at);
         CREATE INDEX idx_ideas_agent_id ON ideas(agent_id);
         CREATE INDEX idx_ideas_expires ON ideas(expires_at);
         CREATE INDEX idx_ideas_content_hash ON ideas(content_hash);
         CREATE INDEX idx_ideas_status ON ideas(status);
         CREATE INDEX idx_ideas_last_accessed ON ideas(last_accessed);
         CREATE INDEX idx_ideas_embedding_pending ON ideas(embedding_pending)
            WHERE embedding_pending=1;
         CREATE INDEX idx_ideas_valid_from ON ideas(valid_from);
         CREATE INDEX idx_ideas_valid_until ON ideas(valid_until);
         CREATE INDEX idx_ideas_time_context ON ideas(time_context);
         CREATE INDEX idx_idea_tags_tag ON idea_tags(tag);
         CREATE INDEX idx_entity_edges_source ON entity_edges(source_kind, source_id);
         CREATE INDEX idx_entity_edges_target ON entity_edges(target_kind, target_id);
         CREATE INDEX idx_entity_edges_relation ON entity_edges(relation);
         CREATE INDEX idx_entity_edges_reinforced ON entity_edges(last_reinforced_at)
            WHERE relation = 'co_retrieved';
         CREATE INDEX idx_access_log_idea ON idea_access_log(idea_id, accessed_at);
         CREATE INDEX idx_access_log_query ON idea_access_log(query_hash, accessed_at);
         CREATE INDEX idx_feedback_idea ON idea_feedback(idea_id, at);
         CREATE UNIQUE INDEX idx_ideas_agent_name_active_unique
            ON ideas(COALESCE(agent_id, ''), name)
            WHERE status = 'active';",
    )?;

    // FTS5 content-table mirror + sync triggers.
    conn.execute_batch(
        "CREATE VIRTUAL TABLE ideas_fts USING fts5(
            name, content, content=ideas, content_rowid=rowid
         );
         CREATE TRIGGER ideas_ai AFTER INSERT ON ideas BEGIN
             INSERT INTO ideas_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
         END;
         CREATE TRIGGER ideas_ad AFTER DELETE ON ideas BEGIN
             INSERT INTO ideas_fts(ideas_fts, rowid, name, content) VALUES('delete', old.rowid, old.name, old.content);
         END;
         CREATE TRIGGER ideas_au AFTER UPDATE ON ideas BEGIN
             INSERT INTO ideas_fts(ideas_fts, rowid, name, content) VALUES('delete', old.rowid, old.name, old.content);
             INSERT INTO ideas_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
         END;",
    )?;

    // T1.9 — credential lifecycle substrate. One table holds every named
    // credential the runtime needs (LLM keys, OAuth tokens, device sessions,
    // GitHub App keys, GCP service-account JSON). The blob is encrypted
    // with ChaCha20-Poly1305 using the SecretStore key.
    conn.execute_batch(
        "CREATE TABLE credentials (
            id TEXT PRIMARY KEY,
            scope_kind TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            name TEXT NOT NULL,
            lifecycle_kind TEXT NOT NULL,
            encrypted_blob BLOB NOT NULL,
            metadata_json TEXT,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            last_refreshed_at TEXT,
            last_used_at TEXT,
            UNIQUE (scope_kind, scope_id, provider, name)
         );
         CREATE INDEX idx_credentials_scope
            ON credentials(scope_kind, scope_id);
         CREATE INDEX idx_credentials_provider
            ON credentials(provider);
         CREATE INDEX idx_credentials_lifecycle
            ON credentials(lifecycle_kind);
         CREATE INDEX idx_credentials_expires
            ON credentials(expires_at)
            WHERE expires_at IS NOT NULL;",
    )?;

    // ANN virtual table — feature-gated, best-effort. Matches production
    // embedding dim (OpenAI text-embedding-3-small = 1536). Callers that
    // need a different dim rebuild via `rebuild_idea_vec_table`.
    #[cfg(feature = "ann-sqlite-vec")]
    {
        let _ = install_idea_vec(conn, 1536);
    }

    // VectorStore::open is a no-op here (idea_embeddings already exists), but
    // it's cheap and keeps the invariant that any VectorStore caller who
    // forgets to call prepare_schema still gets the table.
    VectorStore::open(conn, 1536)?;

    Ok(())
}

/// Create the `idea_vec` virtual table at a given dimension and wire the
/// sync triggers against `idea_embeddings`. Returns false if the virtual
/// table creation failed (typically because the sqlite-vec extension isn't
/// available) — the caller should log and fall back to brute-force.
#[cfg(feature = "ann-sqlite-vec")]
fn install_idea_vec(conn: &Connection, dimensions: usize) -> bool {
    let create = format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS idea_vec USING vec0(embedding float[{dimensions}])"
    );
    if let Err(e) = conn.execute(&create, []) {
        tracing::warn!(error = %e, "sqlite-vec virtual table unavailable; falling back to brute-force search");
        return false;
    }

    // Sync triggers: any write to idea_embeddings mirrors into idea_vec.
    // The rowid of idea_embeddings is the join key. `INSERT OR IGNORE` on
    // the INSERT trigger prevents dimension-mismatch writes from bubbling
    // up and rejecting the outer idea_embeddings insert — in such cases
    // the ANN table simply skips that row, and vector_search_scoped falls
    // back to brute-force for it.
    let triggers = "
        CREATE TRIGGER IF NOT EXISTS idea_vec_sync_insert
        AFTER INSERT ON idea_embeddings
        BEGIN
            INSERT OR IGNORE INTO idea_vec(rowid, embedding) VALUES (new.rowid, new.embedding);
        END;

        CREATE TRIGGER IF NOT EXISTS idea_vec_sync_update
        AFTER UPDATE ON idea_embeddings
        BEGIN
            INSERT OR REPLACE INTO idea_vec(rowid, embedding) VALUES (new.rowid, new.embedding);
        END;

        CREATE TRIGGER IF NOT EXISTS idea_vec_sync_delete
        AFTER DELETE ON idea_embeddings
        BEGIN
            DELETE FROM idea_vec WHERE rowid = old.rowid;
        END;
    ";
    if let Err(e) = conn.execute_batch(triggers) {
        tracing::warn!(error = %e, "sqlite-vec trigger setup failed; brute-force search remains active");
        return false;
    }
    true
}

/// Drop and recreate the `idea_vec` virtual table at a new dimension. Used
/// when `with_embedder` changes the embedding size (typical in tests, rare
/// in production). Re-runs the backfill for rows whose blob length matches.
///
/// Failures are logged and swallowed: if ANN rebuild fails, the system stays
/// on the brute-force path.
#[cfg(feature = "ann-sqlite-vec")]
pub(super) fn rebuild_idea_vec_table(conn: &Connection, dimensions: usize) {
    // Drop the existing triggers + virtual table. `idea_vec_sync_insert` has
    // to go too or we'd fire it during the backfill and double-insert.
    let _ = conn.execute_batch(
        "DROP TRIGGER IF EXISTS idea_vec_sync_insert;
         DROP TRIGGER IF EXISTS idea_vec_sync_update;
         DROP TRIGGER IF EXISTS idea_vec_sync_delete;
         DROP TABLE IF EXISTS idea_vec;",
    );
    if !install_idea_vec(conn, dimensions) {
        return;
    }
    let byte_len = (dimensions * 4) as i64;
    let _ = conn.execute(
        "INSERT OR IGNORE INTO idea_vec(rowid, embedding) \
         SELECT rowid, embedding FROM idea_embeddings WHERE LENGTH(embedding) = ?1",
        rusqlite::params![byte_len],
    );
}

#[cfg(not(feature = "ann-sqlite-vec"))]
pub(super) fn rebuild_idea_vec_table(_conn: &Connection, _dimensions: usize) {}

/// T1.8 — collapse the connection vocabulary and generalise the edge
/// table to support cross-kind edges.
///
/// Three substrate moves, all idempotent:
///
/// 1. Rename `idea_edges` → `entity_edges` and add `source_kind` /
///    `target_kind` columns (default `'idea'` so existing rows keep
///    working unchanged). The PRIMARY KEY changes from
///    `(source_id, target_id, relation)` to
///    `(source_kind, source_id, target_kind, target_id, relation)` so a
///    cross-kind edge with the same id-pair as an idea→idea edge can
///    coexist. SQLite can't `ALTER TABLE ... ADD CONSTRAINT`, so legacy
///    DBs go through a CREATE-NEW + INSERT-FROM-OLD + DROP-OLD swap.
/// 2. Collapse the legacy 7-relation vocabulary down to three:
///    `mention` (was `mentions` / `adjacent` / `supersedes` /
///    `contradicts` / `supports` / `distilled_into`), `embed` (was
///    `embeds`), and `link` (new — direct API write only). The old
///    typed semantics were decorative; mention preserves the connection.
/// 3. Migrate `source:session:<id>` tags into proper cross-kind
///    `idea → session` mention edges. The legacy tag is left in place
///    for one release (deprecation cycle) so consumers that read it can
///    migrate.
///
/// Re-running the migration is a no-op: every step uses
/// `CREATE TABLE IF NOT EXISTS`, idempotent table-swap detection,
/// `INSERT OR IGNORE`, and `INSERT … ON CONFLICT DO UPDATE`.
fn migration_v11_entity_edges(conn: &Connection) -> Result<()> {
    // ── Step 1 — Bring `entity_edges` into existence with the new
    //              PRIMARY KEY. ──
    //
    // Three possible starting states:
    //
    // * Fresh DB: `entity_edges` already exists with the new shape (the
    //   `initial_schema` baseline created it). Nothing to do.
    // * Legacy DB at v9: `idea_edges` exists with the old PK. We need a
    //   full table swap to land the new PK + kind columns.
    // * Mid-migration crash recovery: `entity_edges` exists alongside
    //   `idea_edges`. Re-running drops the leftover `idea_edges`.

    let entity_edges_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='entity_edges'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    let idea_edges_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='idea_edges'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !entity_edges_exists {
        // Legacy or crash-recovery path: build the new table, copy
        // rows over, drop the old table.
        conn.execute_batch(
            "CREATE TABLE entity_edges (
                source_kind TEXT NOT NULL DEFAULT 'idea',
                source_id TEXT NOT NULL,
                target_kind TEXT NOT NULL DEFAULT 'idea',
                target_id TEXT NOT NULL,
                relation TEXT NOT NULL,
                strength REAL NOT NULL DEFAULT 0.5,
                agent TEXT,
                task_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_reinforced_at TEXT,
                PRIMARY KEY (source_kind, source_id, target_kind, target_id, relation)
            );",
        )?;

        if idea_edges_exists {
            conn.execute(
                "INSERT INTO entity_edges \
                    (source_kind, source_id, target_kind, target_id, \
                     relation, strength, agent, task_id, created_at, \
                     last_reinforced_at) \
                 SELECT 'idea', source_id, 'idea', target_id, relation, \
                        strength, agent, task_id, created_at, last_reinforced_at \
                 FROM idea_edges",
                [],
            )?;
        }
    }

    if idea_edges_exists {
        conn.execute("DROP TABLE idea_edges", [])?;
    }

    // Refresh indexes — the renamed table still carries the old
    // `idx_idea_edges_*` index names on legacy DBs. Drop and recreate
    // against entity_edges with kind-aware coverage.
    conn.execute_batch(
        "DROP INDEX IF EXISTS idx_idea_edges_source;
         DROP INDEX IF EXISTS idx_idea_edges_target;
         DROP INDEX IF EXISTS idx_idea_edges_relation;
         DROP INDEX IF EXISTS idx_idea_edges_reinforced;
         CREATE INDEX IF NOT EXISTS idx_entity_edges_source
            ON entity_edges(source_kind, source_id);
         CREATE INDEX IF NOT EXISTS idx_entity_edges_target
            ON entity_edges(target_kind, target_id);
         CREATE INDEX IF NOT EXISTS idx_entity_edges_relation
            ON entity_edges(relation);
         CREATE INDEX IF NOT EXISTS idx_entity_edges_reinforced
            ON entity_edges(last_reinforced_at) WHERE relation = 'co_retrieved';",
    )?;

    // ── Step 2 — Collapse legacy relation vocabulary ──
    //
    // The PRIMARY KEY includes `relation`, so two rows with the same
    // (source, target) but different legacy relations would collapse
    // into the same `mention` edge under a naive UPDATE — and the
    // second UPDATE would trip the PK uniqueness. Two-phase plan:
    //
    //   a. INSERT OR IGNORE the canonical `mention` / `embed` / `link`
    //      row for every legacy relation row;
    //   b. DELETE every legacy relation row.
    //
    // Strength is preserved via MAX-style upsert when both shapes
    // already exist (e.g. an `adjacent` and a `mentions` between the
    // same pair).

    // a. Materialise canonical rows. ON CONFLICT keeps the higher
    //    strength so a strong `adjacent` doesn't get clobbered by a
    //    weaker `mentions`.
    conn.execute(
        "INSERT INTO entity_edges \
            (source_kind, source_id, target_kind, target_id, relation, \
             strength, agent, task_id, created_at, last_reinforced_at) \
         SELECT source_kind, source_id, target_kind, target_id, 'mention', \
                strength, agent, task_id, created_at, last_reinforced_at \
         FROM entity_edges \
         WHERE relation IN ('mentions', 'adjacent', 'supersedes', \
                            'contradicts', 'supports', 'distilled_into', \
                            'caused_by') \
         ON CONFLICT(source_kind, source_id, target_kind, target_id, relation) \
         DO UPDATE SET strength = MAX(excluded.strength, entity_edges.strength)",
        [],
    )?;
    conn.execute(
        "INSERT INTO entity_edges \
            (source_kind, source_id, target_kind, target_id, relation, \
             strength, agent, task_id, created_at, last_reinforced_at) \
         SELECT source_kind, source_id, target_kind, target_id, 'embed', \
                strength, agent, task_id, created_at, last_reinforced_at \
         FROM entity_edges \
         WHERE relation = 'embeds' \
         ON CONFLICT(source_kind, source_id, target_kind, target_id, relation) \
         DO UPDATE SET strength = MAX(excluded.strength, entity_edges.strength)",
        [],
    )?;

    // b. Delete the legacy rows now that their canonical counterparts
    //    exist.
    conn.execute(
        "DELETE FROM entity_edges \
         WHERE relation IN ('mentions', 'embeds', 'adjacent', 'supersedes', \
                            'contradicts', 'supports', 'distilled_into', \
                            'caused_by')",
        [],
    )?;

    // ── Step 3 — Tag-derived `source:session:<id>` → cross-kind edge ──
    //
    // For every `source:session:<id>` tag on an idea, materialise a
    // cross-kind `idea → session` mention edge. The tag stays in place
    // for one release (deprecation cycle).
    conn.execute(
        "INSERT INTO entity_edges \
            (source_kind, source_id, target_kind, target_id, relation, \
             strength, created_at) \
         SELECT 'idea', t.idea_id, 'session', \
                SUBSTR(t.tag, LENGTH('source:session:') + 1), \
                'mention', 1.0, COALESCE(i.created_at, CURRENT_TIMESTAMP) \
         FROM idea_tags t \
         LEFT JOIN ideas i ON i.id = t.idea_id \
         WHERE t.tag LIKE 'source:session:%' \
           AND LENGTH(t.tag) > LENGTH('source:session:') \
         ON CONFLICT(source_kind, source_id, target_kind, target_id, relation) \
         DO UPDATE SET strength = MAX(excluded.strength, entity_edges.strength)",
        [],
    )?;

    Ok(())
}

/// T1.9 — credential lifecycle substrate.
///
/// One additive table for every named credential the runtime holds. Five
/// lifecycle kinds (`static_secret`, `oauth2`, `device_session`,
/// `github_app`, `service_account`) share the same row schema; the
/// `encrypted_blob` is JSON-shaped per lifecycle and decrypted with the
/// SecretStore key. Existing filesystem-backed `SecretStore` entries
/// migrate via a separate runtime backfill (not here — the migration
/// runs against a Connection only).
fn migration_v12_credentials(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS credentials (
            id TEXT PRIMARY KEY,
            scope_kind TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            name TEXT NOT NULL,
            lifecycle_kind TEXT NOT NULL,
            encrypted_blob BLOB NOT NULL,
            metadata_json TEXT,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            last_refreshed_at TEXT,
            last_used_at TEXT,
            UNIQUE (scope_kind, scope_id, provider, name)
         );
         CREATE INDEX IF NOT EXISTS idx_credentials_scope
            ON credentials(scope_kind, scope_id);
         CREATE INDEX IF NOT EXISTS idx_credentials_provider
            ON credentials(provider);
         CREATE INDEX IF NOT EXISTS idx_credentials_lifecycle
            ON credentials(lifecycle_kind);
         CREATE INDEX IF NOT EXISTS idx_credentials_expires
            ON credentials(expires_at)
            WHERE expires_at IS NOT NULL;",
    )?;
    Ok(())
}
