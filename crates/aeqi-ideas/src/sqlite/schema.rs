//! Schema creation and migration runner.
//!
//! This module owns every CREATE TABLE / CREATE INDEX / CREATE TRIGGER for the
//! ideas database, plus the `prepare_schema` driver and a versioned migration
//! runner tracked in `schema_version`.
//!
//! Migration order:
//! - v1 — baseline (matches legacy `ensure_*` layout) + content_hash backfill.
//! - v2 — lifecycle + provenance columns on `ideas`.
//! - v3 — drop dead columns via rename-swap (FTS triggers recreated).
//! - v4 — `idea_edges` expansion (last_reinforced_at + indices).
//! - v5 — `idea_access_log` and `idea_feedback` tables.
//! - v6 — bi-temporal columns (`valid_from`, `valid_until`, `time_context`).
//! - v7 — ANN vector table (feature-gated behind `ann-sqlite-vec`).

use super::SqliteIdeas;
use crate::vector::VectorStore;
use anyhow::{Context, Result};
use rusqlite::Connection;

impl SqliteIdeas {
    pub fn prepare_schema(conn: &Connection) -> Result<()> {
        // Legacy baseline schema — creates the v1 tables if they don't exist.
        // Existing DBs already have these; fresh DBs get them here so migration
        // v1's ALTER statements (and later migrations) all have something to
        // mutate.
        Self::ensure_ideas_table(conn)?;
        Self::ensure_idea_tags_table(conn)?;
        Self::ensure_idea_indexes(conn)?;
        Self::ensure_fts(conn)?;
        Self::ensure_edge_table(conn)?;
        VectorStore::open(conn, 1536)?;

        // Versioned migrations — idempotent, recorded in `schema_version`.
        run_migrations(conn)?;
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

/// Runs every migration whose version is newer than `schema_version.max`.
/// Each migration runs in its own transaction; version row is inserted
/// alongside so a partial apply cannot leave the DB half-migrated.
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

    type Migration = fn(&Connection) -> Result<()>;
    let migrations: &[(i64, Migration)] = &[
        (1, migration_v1),
        (2, migration_v2),
        (3, migration_v3),
        (4, migration_v4),
        (5, migration_v5),
        (6, migration_v6),
        (7, migration_v7),
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

/// v1 — baseline. The CREATE TABLE IF NOT EXISTS statements in
/// `prepare_schema` already populate the table shape; this migration only
/// backfills `content_hash` for rows that pre-date that column so
/// embedding-cache lookups work.
fn migration_v1(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("SELECT id, content FROM ideas WHERE content_hash IS NULL")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .filter_map(Result::ok)
        .collect();
    drop(stmt);

    for (id, content) in rows {
        let hash = SqliteIdeas::content_hash(&content);
        conn.execute(
            "UPDATE ideas SET content_hash = ?1 WHERE id = ?2",
            rusqlite::params![hash, id],
        )?;
    }
    Ok(())
}

/// v2 — lifecycle + provenance columns on `ideas`.
fn migration_v2(conn: &Connection) -> Result<()> {
    let alters = [
        "ALTER TABLE ideas ADD COLUMN status TEXT NOT NULL DEFAULT 'active'",
        "ALTER TABLE ideas ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE ideas ADD COLUMN last_accessed TEXT",
        "ALTER TABLE ideas ADD COLUMN authored_by TEXT",
        "ALTER TABLE ideas ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0",
        "ALTER TABLE ideas ADD COLUMN verified_by TEXT",
        "ALTER TABLE ideas ADD COLUMN verified_at TEXT",
        "ALTER TABLE ideas ADD COLUMN last_feedback_at TEXT",
        "ALTER TABLE ideas ADD COLUMN feedback_boost REAL NOT NULL DEFAULT 0",
        "ALTER TABLE ideas ADD COLUMN embedding_pending INTEGER NOT NULL DEFAULT 1",
    ];
    for sql in alters {
        if let Err(e) = conn.execute(sql, []) {
            // Tolerate "duplicate column name" so the migration stays idempotent
            // against DBs that partially ran a hand-applied version of this.
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                return Err(e.into());
            }
        }
    }

    // Rows with an existing embedding already have vectors — don't mark them
    // pending. The idea_embeddings join is cheap because `idea_id` is unique.
    conn.execute(
        "UPDATE ideas SET embedding_pending = 0 \
         WHERE id IN (SELECT idea_id FROM idea_embeddings)",
        [],
    )?;

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
         CREATE INDEX IF NOT EXISTS idx_ideas_last_accessed ON ideas(last_accessed);
         CREATE INDEX IF NOT EXISTS idx_ideas_embedding_pending ON ideas(embedding_pending) \
            WHERE embedding_pending=1;",
    )?;
    Ok(())
}

/// v3 — drop dead columns via rename-swap.
///
/// SQLite < 3.35 can't DROP COLUMN, and even modern versions prefer the
/// rebuild pattern for multi-column drops to avoid shadow-index drift.
/// Column removed: `inheritance`, `tool_allow`, `tool_deny`, `managed`,
/// `source_kind`, `source_ref`.
fn migration_v3(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE ideas_new (
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
            embedding_pending INTEGER NOT NULL DEFAULT 1
        );",
    )?;

    conn.execute(
        "INSERT INTO ideas_new (
            id, name, content, scope, agent_id, session_id, created_at,
            updated_at, expires_at, content_hash,
            status, access_count, last_accessed, authored_by, confidence,
            verified_by, verified_at, last_feedback_at, feedback_boost,
            embedding_pending
         )
         SELECT
            id, name, content, scope, agent_id, session_id, created_at,
            updated_at, expires_at, content_hash,
            status, access_count, last_accessed, authored_by, confidence,
            verified_by, verified_at, last_feedback_at, feedback_boost,
            embedding_pending
         FROM ideas",
        [],
    )?;

    // Dropping `ideas` cascades the FTS5 triggers (they reference `ideas`),
    // so we must recreate them after the rename.
    conn.execute_batch("DROP TABLE ideas; ALTER TABLE ideas_new RENAME TO ideas;")?;

    // Recreate indexes that lived on the old `ideas` table.
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_ideas_name ON ideas(name);
         CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at);
         CREATE INDEX IF NOT EXISTS idx_ideas_agent_id ON ideas(agent_id);
         CREATE INDEX IF NOT EXISTS idx_ideas_expires ON ideas(expires_at);
         CREATE INDEX IF NOT EXISTS idx_ideas_content_hash ON ideas(content_hash);
         CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
         CREATE INDEX IF NOT EXISTS idx_ideas_last_accessed ON ideas(last_accessed);
         CREATE INDEX IF NOT EXISTS idx_ideas_embedding_pending ON ideas(embedding_pending) \
            WHERE embedding_pending=1;",
    )?;

    // Recreate FTS5 triggers against the new `ideas` table. The FTS virtual
    // table itself survives the rename (content=ideas is resolved at query
    // time), so we only rewire the insert/delete/update triggers.
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS ideas_ai;
         DROP TRIGGER IF EXISTS ideas_ad;
         DROP TRIGGER IF EXISTS ideas_au;
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

    // FTS index rows were keyed by the old rowids; rebuild to pick up the
    // new `ideas` rowids after the rename-swap.
    conn.execute("INSERT INTO ideas_fts(ideas_fts) VALUES('rebuild')", [])?;

    Ok(())
}

/// v4 — `idea_edges` gains a `last_reinforced_at` column + relation index.
fn migration_v4(conn: &Connection) -> Result<()> {
    if let Err(e) = conn.execute(
        "ALTER TABLE idea_edges ADD COLUMN last_reinforced_at TEXT",
        [],
    ) {
        let msg = e.to_string();
        if !msg.contains("duplicate column name") {
            return Err(e.into());
        }
    }
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_idea_edges_relation ON idea_edges(relation);
         CREATE INDEX IF NOT EXISTS idx_idea_edges_reinforced ON idea_edges(last_reinforced_at) \
            WHERE relation = 'co_retrieved';",
    )?;
    Ok(())
}

/// v5 — access log + feedback tables.
fn migration_v5(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS idea_access_log (
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            agent_id TEXT,
            session_id TEXT,
            context TEXT NOT NULL,
            result_position INTEGER,
            query_hash TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_access_log_idea ON idea_access_log(idea_id, accessed_at);
        CREATE INDEX IF NOT EXISTS idx_access_log_query ON idea_access_log(query_hash, accessed_at);

        CREATE TABLE IF NOT EXISTS idea_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            signal TEXT NOT NULL,
            weight REAL NOT NULL DEFAULT 1.0,
            at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            agent_id TEXT,
            session_id TEXT,
            query_text TEXT,
            note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_feedback_idea ON idea_feedback(idea_id, at);",
    )?;
    Ok(())
}

/// v6 — bi-temporal columns on `ideas`.
///
/// `created_at` is DB ingestion time. `valid_from` / `valid_until` are
/// real-world validity (Zep/Graphiti-style). `time_context` distinguishes
/// timeless prefs from time-scoped events and current-state facts.
fn migration_v6(conn: &Connection) -> Result<()> {
    let alters = [
        "ALTER TABLE ideas ADD COLUMN valid_from TEXT",
        "ALTER TABLE ideas ADD COLUMN valid_until TEXT",
        "ALTER TABLE ideas ADD COLUMN time_context TEXT NOT NULL DEFAULT 'timeless'",
    ];
    for sql in alters {
        if let Err(e) = conn.execute(sql, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                return Err(e.into());
            }
        }
    }

    // Back-fill valid_from with created_at so existing rows become valid from
    // their ingestion time (reasonable default for pre-bitemporal data).
    conn.execute(
        "UPDATE ideas SET valid_from = created_at WHERE valid_from IS NULL",
        [],
    )?;

    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_ideas_valid_from ON ideas(valid_from);
         CREATE INDEX IF NOT EXISTS idx_ideas_valid_until ON ideas(valid_until);
         CREATE INDEX IF NOT EXISTS idx_ideas_time_context ON ideas(time_context);",
    )?;
    Ok(())
}

/// v7 — ANN via sqlite-vec virtual table.
///
/// The `ann-sqlite-vec` feature gates the extension load at runtime. When the
/// feature is off (current default), this migration is a no-op: the
/// brute-force cosine path in `sqlite/search.rs` stays active. Agent N
/// wires the real lookup path in Round 3c.
///
/// When the feature is on, we try to create the virtual table. Any failure
/// (missing extension, older libsqlite, dimension mismatch) is logged and
/// swallowed so startup doesn't fail on ANN-adjacent infrastructure issues.
fn migration_v7(conn: &Connection) -> Result<()> {
    #[cfg(feature = "ann-sqlite-vec")]
    {
        let create =
            "CREATE VIRTUAL TABLE IF NOT EXISTS idea_vec USING vec0(embedding float[1536])";
        if let Err(e) = conn.execute(create, []) {
            tracing::warn!(error = %e, "sqlite-vec virtual table unavailable; falling back to brute-force search");
            return Ok(());
        }

        // Sync triggers: any write to idea_embeddings mirrors into idea_vec.
        // The rowid of idea_embeddings is the join key.
        let triggers = "
            CREATE TRIGGER IF NOT EXISTS idea_vec_sync_insert
            AFTER INSERT ON idea_embeddings
            BEGIN
                INSERT INTO idea_vec(rowid, embedding) VALUES (new.rowid, new.embedding);
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
        }
    }
    #[cfg(not(feature = "ann-sqlite-vec"))]
    {
        // Feature off: nothing to do. Schema stays brute-force. The migration
        // row is still recorded so a future feature flip doesn't re-run the
        // no-op. Agent N wires the lookup when turning the feature on.
        let _ = conn;
    }
    Ok(())
}
