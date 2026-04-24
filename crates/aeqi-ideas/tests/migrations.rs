//! Migration regression tests.
//!
//! Simulates an old (pre-v2) aeqi.db by manually constructing the v1-era
//! schema, inserting rows with the old shape, and then opening the file
//! through `SqliteIdeas::open`. The migration runner should bring the DB
//! up to v7 without losing data and with the correct defaults applied.

use aeqi_ideas::SqliteIdeas;
use rusqlite::Connection;
use tempfile::TempDir;

/// Create a minimal v1-era schema by hand — no lifecycle columns, no
/// bi-temporal columns, no feedback/access log tables. Matches what a
/// pre-migration aeqi.db actually looked like.
fn seed_v1_schema(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE ideas (
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
        );
        CREATE TABLE idea_tags (
            idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
            tag TEXT NOT NULL,
            PRIMARY KEY (idea_id, tag)
        );
        CREATE TABLE idea_embeddings (
            idea_id TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
            embedding BLOB NOT NULL,
            dimensions INTEGER NOT NULL,
            content_hash TEXT
        );
        CREATE TABLE idea_edges (
            source_id TEXT NOT NULL,
            target_id TEXT NOT NULL,
            relation TEXT NOT NULL,
            strength REAL NOT NULL DEFAULT 0.5,
            agent TEXT,
            task_id TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (source_id, target_id, relation)
        );
        CREATE VIRTUAL TABLE ideas_fts USING fts5(
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
    )
    .expect("seed v1 schema");
}

fn insert_v1_row(conn: &Connection, id: &str, name: &str, content: &str, created_at: &str) {
    conn.execute(
        "INSERT INTO ideas (id, name, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, name, content, created_at],
    )
    .expect("insert v1 row");
}

fn columns_on(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .expect("prepare table_info");
    stmt.query_map([], |row| row.get::<_, String>(1))
        .expect("run table_info")
        .filter_map(Result::ok)
        .collect()
}

#[test]
fn test_migrations_preserve_rows_and_apply_defaults() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("legacy.db");

    // 1. Manually build the v1-era schema and insert three test rows with
    //    the old shape (no status, access_count, valid_from, etc.).
    {
        let conn = Connection::open(&db_path).expect("open legacy db");
        seed_v1_schema(&conn);
        insert_v1_row(
            &conn,
            "idea-a",
            "alpha-note",
            "alpha body",
            "2024-01-01T00:00:00Z",
        );
        insert_v1_row(
            &conn,
            "idea-b",
            "beta-note",
            "beta body",
            "2024-06-15T12:30:00Z",
        );
        insert_v1_row(
            &conn,
            "idea-c",
            "gamma-note",
            "gamma body",
            "2025-11-09T08:45:00Z",
        );
    }

    // 2. Open through `SqliteIdeas::open` — this runs the migration runner.
    let _ideas = SqliteIdeas::open(&db_path, 30.0).expect("open + migrate");

    // 3. Re-open a raw connection to inspect the rebuilt schema directly.
    let conn = Connection::open(&db_path).expect("inspect db");

    // 3a. Schema version tracks all applied migrations.
    let max_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .expect("read schema_version");
    assert!(
        max_version >= 7,
        "expected schema_version >= 7 after migrate, got {max_version}"
    );

    // 3b. Old columns are dropped. Check `PRAGMA table_info`.
    let cols = columns_on(&conn, "ideas");
    for gone in &[
        "inheritance",
        "tool_allow",
        "tool_deny",
        "managed",
        "source_kind",
        "source_ref",
    ] {
        assert!(
            !cols.iter().any(|c| c == gone),
            "column {gone} should be dropped after v3 migration"
        );
    }

    // 3c. New columns exist with correct defaults.
    for must_have in &[
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
    ] {
        assert!(
            cols.iter().any(|c| c == must_have),
            "column {must_have} should exist after migrations"
        );
    }

    // 3d. Row survival + correct defaults. Fetch each row and assert.
    let mut stmt = conn
        .prepare(
            "SELECT id, name, content, status, access_count, confidence, embedding_pending, \
                    valid_from, time_context, created_at \
             FROM ideas ORDER BY id",
        )
        .expect("prepare inspect");
    type MigratedRow = (
        String,
        String,
        String,
        String,
        i64,
        f64,
        i64,
        Option<String>,
        String,
        String,
    );
    let rows: Vec<MigratedRow> = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
                r.get(9)?,
            ))
        })
        .expect("query")
        .filter_map(Result::ok)
        .collect();

    assert_eq!(rows.len(), 3, "all three pre-migration rows must survive");

    for (
        id,
        _name,
        _content,
        status,
        access_count,
        confidence,
        embedding_pending,
        valid_from,
        time_context,
        created_at,
    ) in &rows
    {
        assert_eq!(
            status, "active",
            "row {id}: status should default to 'active'"
        );
        assert_eq!(
            *access_count, 0,
            "row {id}: access_count should default to 0"
        );
        assert!(
            (*confidence - 1.0).abs() < f64::EPSILON,
            "row {id}: confidence should default to 1.0 (got {confidence})"
        );
        assert_eq!(
            *embedding_pending, 1,
            "row {id}: embedding_pending should default to 1 (no embedding yet)"
        );
        assert_eq!(
            time_context, "timeless",
            "row {id}: time_context should default to 'timeless'"
        );
        // v6 backfill: valid_from = created_at for rows migrated from v1.
        assert_eq!(
            valid_from.as_deref(),
            Some(created_at.as_str()),
            "row {id}: valid_from should be backfilled from created_at"
        );
    }

    // 3e. New tables exist.
    for table in &["idea_access_log", "idea_feedback", "schema_version"] {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name = ?1",
                rusqlite::params![table],
                |r| r.get(0),
            )
            .expect("check table existence");
        assert_eq!(count, 1, "table {table} should exist post-migration");
    }

    // 3f. FTS triggers were recreated against the rebuilt `ideas` table.
    let triggers: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='ideas'")
        .expect("prepare triggers")
        .query_map([], |r| r.get::<_, String>(0))
        .expect("run triggers")
        .filter_map(Result::ok)
        .collect();
    for expected in &["ideas_ai", "ideas_ad", "ideas_au"] {
        assert!(
            triggers.contains(&expected.to_string()),
            "FTS trigger {expected} should exist after v3 rename-swap"
        );
    }

    // 3g. FTS table should be searchable — the rebuild in v3 should have
    //     re-populated it with the new rowids.
    let fts_hits: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ideas_fts WHERE ideas_fts MATCH 'alpha'",
            [],
            |r| r.get(0),
        )
        .expect("fts search");
    assert!(
        fts_hits >= 1,
        "FTS should return the 'alpha' row after v3 rebuild"
    );
}

#[test]
fn test_migrations_are_idempotent() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("legacy.db");

    {
        let conn = Connection::open(&db_path).expect("open legacy db");
        seed_v1_schema(&conn);
        insert_v1_row(
            &conn,
            "idea-idem",
            "idem-note",
            "idem body",
            "2024-01-01T00:00:00Z",
        );
    }

    // First migrate.
    let _a = SqliteIdeas::open(&db_path, 30.0).expect("first open");
    drop(_a);

    // Second open — should be a no-op, no errors, no duplicate version rows.
    let _b = SqliteIdeas::open(&db_path, 30.0).expect("second open");
    drop(_b);

    let conn = Connection::open(&db_path).expect("inspect");
    let distinct_versions: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT version) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .expect("count distinct");
    let total_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .expect("count total");
    assert_eq!(
        distinct_versions, total_rows,
        "no migration should be recorded more than once"
    );

    // Row still exists.
    let ideas_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ideas", [], |r| r.get(0))
        .expect("count ideas");
    assert_eq!(ideas_count, 1, "idempotent re-open must not duplicate rows");
}

#[test]
fn test_fresh_db_gets_full_schema() {
    // Opening a fresh DB with no pre-existing schema should still apply all
    // migrations cleanly — not just DBs that had legacy rows.
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("fresh.db");

    let _ideas = SqliteIdeas::open(&db_path, 30.0).expect("fresh open");

    let conn = Connection::open(&db_path).expect("inspect");
    let max_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .expect("schema_version");
    assert!(
        max_version >= 7,
        "fresh DB should reach schema_version >= 7, got {max_version}"
    );

    let cols = columns_on(&conn, "ideas");
    for must_have in &[
        "status",
        "access_count",
        "valid_from",
        "time_context",
        "embedding_pending",
    ] {
        assert!(
            cols.iter().any(|c| c == must_have),
            "column {must_have} missing on fresh DB"
        );
    }
}

/// v9 — every pre-existing idea that lacks a row in `idea_tags` should
/// receive the default `fact` tag after the migration runs. Mirrors the
/// live-DB state investigated on 2026-04-24: 333 ideas, 0 tag rows.
///
/// Root cause of the 0-tag state: the v3 migration does `DROP TABLE ideas`
/// before recreating it, which cascades through the
/// `idea_tags(idea_id) REFERENCES ideas(id) ON DELETE CASCADE` foreign key
/// and deletes every tag row on upgrade. v9 restores the invariant that
/// every idea has at least one tag (`normalize_tags` default = `fact`).
#[test]
fn test_migration_v9_backfills_default_tag_for_untagged_ideas() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("untagged.db");

    // Hand-build the v1 schema and insert rows without touching idea_tags —
    // mirroring the observed production state after v3 cascade-wiped tags.
    {
        let conn = Connection::open(&db_path).expect("open legacy db");
        seed_v1_schema(&conn);
        insert_v1_row(
            &conn,
            "untagged-a",
            "alpha",
            "alpha body",
            "2024-01-01T00:00:00Z",
        );
        insert_v1_row(
            &conn,
            "untagged-b",
            "beta",
            "beta body",
            "2024-06-15T12:30:00Z",
        );
        insert_v1_row(
            &conn,
            "untagged-c",
            "gamma",
            "gamma body",
            "2025-03-01T00:00:00Z",
        );
    }

    // Run migrations.
    let _ideas = SqliteIdeas::open(&db_path, 30.0).expect("open + migrate");

    let conn = Connection::open(&db_path).expect("inspect db");

    let max_version: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_version",
            [],
            |r| r.get(0),
        )
        .expect("read schema_version");
    assert!(
        max_version >= 9,
        "expected schema_version >= 9 after v9 migration, got {max_version}"
    );

    // Every idea now has at least one tag row.
    let untagged: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ideas i \
             LEFT JOIN idea_tags t ON t.idea_id = i.id \
             WHERE t.idea_id IS NULL",
            [],
            |r| r.get(0),
        )
        .expect("count untagged");
    assert_eq!(untagged, 0, "v9 must backfill every untagged idea");

    // Every previously-untagged row got the default `fact` tag.
    for id in &["untagged-a", "untagged-b", "untagged-c"] {
        let tag: String = conn
            .query_row(
                "SELECT tag FROM idea_tags WHERE idea_id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            )
            .expect("read backfilled tag");
        assert_eq!(tag, "fact", "row {id}: expected default 'fact' tag");
    }
}

/// v9 must NOT clobber ideas that already have tags. We simulate this by
/// running the migrations once, manually adding a user tag to an idea that
/// has only 'fact', then re-running migrations — the user tag survives,
/// and v9 doesn't add a second 'fact' row.
#[test]
fn test_migration_v9_does_not_duplicate_existing_tags() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("preserve-tags.db");

    {
        let conn = Connection::open(&db_path).expect("open legacy db");
        seed_v1_schema(&conn);
        insert_v1_row(&conn, "keep", "keep", "body", "2024-01-01T00:00:00Z");
    }

    // First migration pass — backfills 'fact'.
    let _first = SqliteIdeas::open(&db_path, 30.0).expect("first open");
    drop(_first);

    // Simulate a user tagging this idea with something custom.
    {
        let conn = Connection::open(&db_path).expect("second raw open");
        conn.execute(
            "INSERT INTO idea_tags (idea_id, tag) VALUES (?1, ?2)",
            rusqlite::params!["keep", "user-tag"],
        )
        .expect("insert user tag");
    }

    // Re-open — v9 is already applied per schema_version, so it should be a
    // no-op. Even hypothetically, the guarded WHERE clause prevents
    // double-inserts.
    let _second = SqliteIdeas::open(&db_path, 30.0).expect("second open");
    drop(_second);

    let conn = Connection::open(&db_path).expect("inspect");
    let mut stmt = conn
        .prepare("SELECT tag FROM idea_tags WHERE idea_id = 'keep' ORDER BY tag")
        .expect("prepare");
    let tags: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .expect("query")
        .filter_map(Result::ok)
        .collect();
    assert_eq!(
        tags,
        vec!["fact".to_string(), "user-tag".to_string()],
        "both the backfilled 'fact' tag and the user-added 'user-tag' must coexist"
    );
}

/// v9 is idempotent — re-running the migration runner (simulated by a
/// second `SqliteIdeas::open`) must not duplicate tag rows.
#[test]
fn test_migration_v9_is_idempotent() {
    let dir = TempDir::new().expect("tempdir");
    let db_path = dir.path().join("v9-idem.db");

    {
        let conn = Connection::open(&db_path).expect("open legacy db");
        seed_v1_schema(&conn);
        insert_v1_row(&conn, "id-x", "x", "x body", "2024-01-01T00:00:00Z");
    }

    let _first = SqliteIdeas::open(&db_path, 30.0).expect("first open");
    drop(_first);
    let _second = SqliteIdeas::open(&db_path, 30.0).expect("second open");
    drop(_second);

    let conn = Connection::open(&db_path).expect("inspect");
    let tag_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM idea_tags WHERE idea_id = 'id-x'",
            [],
            |r| r.get(0),
        )
        .expect("count tags");
    assert_eq!(
        tag_count, 1,
        "v9 must be idempotent: re-running cannot duplicate the default tag row"
    );
}
