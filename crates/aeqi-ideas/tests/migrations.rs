//! Schema regression tests.
//!
//! The old v1..v9 incremental migration chain was collapsed into a single
//! `initial_schema` baseline on 2026-04-24. R5 Agent A deleted v1..v7;
//! R9 finished the job by deleting v8 and v9 once the live DB reached
//! `schema_version = 9`. These tests protect three scenarios:
//!
//! * Fresh DB: `initial_schema` runs once, DB is stamped at `schema_version=10`.
//! * Legacy DB already at v9: a pure no-op (no catch-up migrations remain).
//! * Opening the same DB twice: no-op.
//!
//! The tests that used to simulate a pre-v2 DB and watch the migration runner
//! reshape it are gone — that code path (v1..v7) no longer exists. The test
//! that simulated a v7 DB catching up to v9 is also gone — v8 and v9 were
//! deleted from the runner.
//!
//! NOTE: the legacy v3 migration silently cascade-wiped `idea_tags` on
//! upgrade. That class of bug can't reappear in `initial_schema` (no
//! rename-swap).

use aeqi_ideas::SqliteIdeas;
use rusqlite::Connection;
use tempfile::TempDir;

/// All columns the post-v9 `ideas` table must carry.
const REQUIRED_IDEAS_COLUMNS: &[&str] = &[
    "id",
    "name",
    "content",
    "scope",
    "agent_id",
    "session_id",
    "created_at",
    "updated_at",
    "expires_at",
    "content_hash",
    "status",
    "access_count",
    "last_accessed",
    "authored_by",
    "confidence",
    "verified_by",
    "verified_at",
    "last_feedback_at",
    "feedback_boost",
    "embedding_pending",
    "valid_from",
    "valid_until",
    "time_context",
];

/// Columns that were dropped by v3 — must NOT appear in the final shape.
const DROPPED_IDEAS_COLUMNS: &[&str] = &[
    "inheritance",
    "tool_allow",
    "tool_deny",
    "managed",
    "source_kind",
    "source_ref",
];

/// Every index the baseline creates on `ideas` / `idea_edges` / `idea_tags` /
/// log/feedback tables.
const REQUIRED_INDEXES: &[&str] = &[
    "idx_ideas_name",
    "idx_ideas_created",
    "idx_ideas_agent_id",
    "idx_ideas_expires",
    "idx_ideas_content_hash",
    "idx_ideas_status",
    "idx_ideas_last_accessed",
    "idx_ideas_embedding_pending",
    "idx_ideas_valid_from",
    "idx_ideas_valid_until",
    "idx_ideas_time_context",
    "idx_ideas_agent_name_active_unique",
    "idx_idea_tags_tag",
    "idx_idea_edges_source",
    "idx_idea_edges_target",
    "idx_idea_edges_relation",
    "idx_idea_edges_reinforced",
    "idx_access_log_idea",
    "idx_access_log_query",
    "idx_feedback_idea",
];

/// Every FTS5 sync trigger on `ideas`.
const REQUIRED_FTS_TRIGGERS: &[&str] = &["ideas_ai", "ideas_ad", "ideas_au"];

fn columns_on(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("prepare table_info");
    stmt.query_map([], |row| row.get::<_, String>(1))
        .expect("run table_info")
        .filter_map(Result::ok)
        .collect()
}

fn index_names(conn: &Connection) -> Vec<String> {
    conn.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
        .expect("prepare idx list")
        .query_map([], |r| r.get::<_, String>(0))
        .expect("run idx list")
        .filter_map(Result::ok)
        .collect()
}

fn trigger_names(conn: &Connection, tbl_name: &str) -> Vec<String> {
    conn.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = ?1")
        .expect("prepare trigger list")
        .query_map(rusqlite::params![tbl_name], |r| r.get::<_, String>(0))
        .expect("run trigger list")
        .filter_map(Result::ok)
        .collect()
}

fn table_exists(conn: &Connection, name: &str) -> bool {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
            rusqlite::params![name],
            |r| r.get(0),
        )
        .expect("check table");
    count == 1
}

/// Build the final-shape schema by hand for legacy-DB simulation. Matches
/// `initial_schema` (with the v8 partial unique index applied explicitly by
/// the legacy test that pretends to be a DB stamped at v9).
fn build_post_v7_shape(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE schema_version (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        CREATE TABLE ideas (
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
        );
        CREATE TABLE idea_tags (
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY (idea_id, tag)
        );
        CREATE TABLE idea_edges (
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            relation TEXT NOT NULL,
            strength REAL NOT NULL DEFAULT 0.5,
            agent TEXT,
            task_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_reinforced_at TEXT,
            PRIMARY KEY (source_id, target_id, relation)
        );
        CREATE TABLE idea_embeddings (
            idea_id TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
            embedding BLOB NOT NULL,
            dimensions INTEGER NOT NULL,
            content_hash TEXT
        );
        CREATE TABLE idea_access_log (
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            agent_id TEXT,
            session_id TEXT,
            context TEXT NOT NULL,
            result_position INTEGER,
            query_hash TEXT
        );
        CREATE TABLE idea_feedback (
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
        CREATE INDEX idx_ideas_name ON ideas(name);
        CREATE INDEX idx_ideas_agent_id ON ideas(agent_id);
        CREATE VIRTUAL TABLE ideas_fts USING fts5(
            name, content, content=ideas, content_rowid=rowid
        );
        CREATE TRIGGER ideas_ai AFTER INSERT ON ideas BEGIN
            INSERT INTO ideas_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
        END;",
    )
    .expect("build post-v7 shape");
}

/// Fresh DB gets the full post-v9 shape directly from `initial_schema`,
/// stamped at `schema_version = 10` (the "baseline reached" marker).
#[test]
fn test_fresh_db_has_final_shape() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("fresh.db");

    let _ideas = SqliteIdeas::open(&db_path, 30.0).expect("fresh open");

    let conn = Connection::open(&db_path).expect("inspect db");

    // 1. schema_version is stamped at 10 — the baseline marker.
    let max_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .expect("read schema_version");
    assert_eq!(
        max_version, 10,
        "fresh DB should be stamped at baseline version 10, got {max_version}"
    );

    // 2. ideas has every required column.
    let cols = columns_on(&conn, "ideas");
    for required in REQUIRED_IDEAS_COLUMNS {
        assert!(
            cols.iter().any(|c| c == required),
            "column {required} missing on fresh DB; got {cols:?}"
        );
    }

    // 3. No ghosts from the v3 drop.
    for gone in DROPPED_IDEAS_COLUMNS {
        assert!(
            !cols.iter().any(|c| c == gone),
            "column {gone} should never appear in baseline"
        );
    }

    // 4. Every auxiliary table exists.
    for tbl in &[
        "idea_tags",
        "idea_edges",
        "idea_embeddings",
        "idea_access_log",
        "idea_feedback",
        "schema_version",
    ] {
        assert!(table_exists(&conn, tbl), "table {tbl} should exist");
    }

    // 5. FTS5 virtual table exists.
    assert!(
        table_exists(&conn, "ideas_fts"),
        "FTS table ideas_fts should exist"
    );

    // 6. Every index from the legacy chain is present.
    let indexes = index_names(&conn);
    for required in REQUIRED_INDEXES {
        assert!(
            indexes.iter().any(|i| i == required),
            "index {required} missing on fresh DB; got {indexes:?}"
        );
    }

    // 7. FTS triggers wired.
    let triggers = trigger_names(&conn, "ideas");
    for required in REQUIRED_FTS_TRIGGERS {
        assert!(
            triggers.iter().any(|t| t == required),
            "trigger {required} missing on fresh DB; got {triggers:?}"
        );
    }

    // 8. `idea_edges.last_reinforced_at` column exists — v4's addition.
    let edge_cols = columns_on(&conn, "idea_edges");
    assert!(
        edge_cols.iter().any(|c| c == "last_reinforced_at"),
        "idea_edges.last_reinforced_at column missing; got {edge_cols:?}"
    );
}

/// A DB that was migrated by the full legacy v1..v9 chain carries
/// `schema_version` rows 1..9. Opening it through the new runner must be a
/// pure no-op: no re-running of CREATE TABLE (which would error), no extra
/// schema_version rows, no data loss. This is the permanent legacy path
/// now that v8 and v9 migration functions have been deleted.
#[test]
fn test_legacy_db_with_schema_version_9_is_noop() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("legacy-v9.db");

    {
        let conn = Connection::open(&db_path).expect("open legacy");
        build_post_v7_shape(&conn);
        // v8 index was applied in this scenario.
        conn.execute_batch(
            "CREATE UNIQUE INDEX idx_ideas_agent_name_active_unique
                ON ideas(COALESCE(agent_id, ''), name)
                WHERE status = 'active';",
        )
        .expect("add v8 index");

        for v in 1..=9 {
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
                rusqlite::params![v, "2026-04-20T00:00:00Z"],
            )
            .expect("stamp version");
        }

        conn.execute(
            "INSERT INTO ideas (id, name, content, created_at) VALUES \
                ('legacy-a', 'legacy-a', 'body a', '2024-01-01T00:00:00Z'), \
                ('legacy-b', 'legacy-b', 'body b', '2024-01-02T00:00:00Z')",
            [],
        )
        .expect("seed ideas");
        conn.execute(
            "INSERT INTO idea_tags (idea_id, tag) VALUES ('legacy-a', 'fact'), ('legacy-b', 'user-tag')",
            [],
        )
        .expect("seed tags");
    }

    let _ideas = SqliteIdeas::open(&db_path, 30.0).expect("open legacy v9 db");

    let conn = Connection::open(&db_path).expect("reinspect");

    let versions: Vec<i64> = conn
        .prepare("SELECT version FROM schema_version ORDER BY version")
        .expect("prepare")
        .query_map([], |r| r.get::<_, i64>(0))
        .expect("query")
        .filter_map(Result::ok)
        .collect();
    assert_eq!(
        versions,
        (1..=9).collect::<Vec<_>>(),
        "legacy 1..9 rows must be preserved, nothing appended"
    );

    let idea_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ideas", [], |r| r.get(0))
        .expect("count ideas");
    assert_eq!(idea_count, 2, "seeded ideas must survive");

    let tag_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM idea_tags", [], |r| r.get(0))
        .expect("count tags");
    assert_eq!(tag_count, 2, "seeded tags must survive");

    let cols = columns_on(&conn, "ideas");
    for required in REQUIRED_IDEAS_COLUMNS {
        assert!(
            cols.iter().any(|c| c == required),
            "column {required} missing on legacy DB post-open"
        );
    }
}

/// Opening the same fresh DB twice is a no-op: the first open stamps
/// version 10, the second sees current >= 10 and skips. No errors, no
/// duplicate rows.
#[test]
fn test_open_is_idempotent() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("idem.db");

    let _a = SqliteIdeas::open(&db_path, 30.0).expect("first open");
    drop(_a);
    let _b = SqliteIdeas::open(&db_path, 30.0).expect("second open");
    drop(_b);

    let conn = Connection::open(&db_path).expect("inspect");
    let total_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .expect("count");
    assert_eq!(
        total_rows, 1,
        "idempotent re-open must not stamp schema_version twice"
    );

    let distinct_versions: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT version) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .expect("count distinct");
    assert_eq!(
        distinct_versions, total_rows,
        "every schema_version row must be unique"
    );
}
