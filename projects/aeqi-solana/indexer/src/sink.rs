//! SQLite event sink for aeqi-indexer.
//!
//! Schema (v2):
//! - `events` — one row per decoded Anchor event. Idempotent on
//!   (signature, program, event_type, log_index) so replays + reorgs
//!   don't double-count, while still allowing multiple events of the
//!   same type within a single transaction (e.g. several
//!   `ModuleRegistered` during a TRUST genesis that wires Role +
//!   Token + Governance modules).
//! - `cursor` — last processed slot per program. Resumed at startup so
//!   the indexer can re-attach to a public RPC and skip-ahead-or-replay
//!   accordingly.
//!
//! Schema is forward-compat: new event types only need their decoder;
//! the generic blob column holds the raw borsh payload for clients that
//! want to decode lazily.
//!
//! v1 → v2 migration runs automatically on startup. v1's
//! `UNIQUE(signature, program, event_type)` collapsed multiple
//! same-type events emitted in one transaction (quest 67-162.6); v2
//! adds `log_index` (the event's ordinal position in the tx log
//! stream) to the unique key.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    program       TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    slot          INTEGER NOT NULL,
    signature     TEXT NOT NULL,
    log_index     INTEGER NOT NULL DEFAULT 0,
    payload_b64   TEXT NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(signature, program, event_type, log_index)
);

CREATE INDEX IF NOT EXISTS events_program_slot_idx ON events(program, slot);
CREATE INDEX IF NOT EXISTS events_signature_idx ON events(signature);

CREATE TABLE IF NOT EXISTS cursor (
    program       TEXT PRIMARY KEY,
    last_slot     INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
"#;

/// Connection wrapped in Mutex so `Arc<Sink>` is `Send + Sync` for the
/// per-program tokio::spawn'd subscription tasks. Lock scope is tight
/// (one SQL statement per acquire) so contention is minimal.
pub struct Sink {
    conn: Mutex<Connection>,
}

impl Sink {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(&path)
            .with_context(|| format!("opening sqlite at {:?}", path.as_ref()))?;

        // Migrate v1 → v2 BEFORE applying the v2 schema. The v1 events
        // table has no `log_index` column and carries a UNIQUE
        // constraint we need to replace. SQLite can't ALTER a
        // table-level UNIQUE in place; the canonical migration is
        // rename + create new + copy + drop old.
        migrate_v1_to_v2(&conn).context("running v1→v2 events table migration")?;

        conn.execute_batch(SCHEMA).context("applying sqlite schema")?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            "#,
        )
        .context("applying sqlite pragmas")?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn record_event(
        &self,
        program: &str,
        event_type: &str,
        slot: u64,
        signature: &str,
        log_index: u32,
        payload_b64: &str,
    ) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            r#"INSERT OR IGNORE INTO events(program, event_type, slot, signature, log_index, payload_b64)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6)"#,
            params![program, event_type, slot as i64, signature, log_index as i64, payload_b64],
        )?;
        Ok(changed > 0)
    }

    pub fn bump_cursor(&self, program: &str, slot: u64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            r#"INSERT INTO cursor(program, last_slot) VALUES (?1, ?2)
               ON CONFLICT(program) DO UPDATE SET
                 last_slot = MAX(cursor.last_slot, excluded.last_slot),
                 updated_at = strftime('%s', 'now')"#,
            params![program, slot as i64],
        )?;
        Ok(())
    }

    pub fn cursor(&self, program: &str) -> Result<Option<u64>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT last_slot FROM cursor WHERE program = ?1")?;
        let row: Option<i64> = stmt.query_row(params![program], |r| r.get(0)).ok();
        Ok(row.map(|v| v as u64))
    }

    pub fn event_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))?)
    }
}

/// v1 → v2 migration. v1 events table lacks `log_index` and has the
/// old UNIQUE shape; v2 adds the column and extends the unique key.
///
/// Detection: a v1 table will return zero rows from
/// `PRAGMA table_info(events)` for `log_index`. A v2 table (or a
/// freshly-created table — `CREATE TABLE IF NOT EXISTS` won't fire
/// because the v1 table exists) returns one row. No table at all
/// returns zero rows from `PRAGMA table_info(events)` (the table
/// doesn't exist yet) AND the SCHEMA application below will create
/// the v2 shape directly — no migration needed.
fn migrate_v1_to_v2(conn: &Connection) -> Result<()> {
    let table_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='events'",
        [],
        |r| r.get(0),
    )?;
    if table_exists == 0 {
        return Ok(()); // fresh db; v2 schema will land below
    }

    let has_log_index: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('events') WHERE name='log_index'",
        [],
        |r| r.get(0),
    )?;
    if has_log_index == 1 {
        return Ok(()); // already v2
    }

    // v1 detected. Rename + recreate + copy + drop old.
    conn.execute_batch(
        r#"
        BEGIN;
        ALTER TABLE events RENAME TO events_v1;
        CREATE TABLE events (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            program       TEXT NOT NULL,
            event_type    TEXT NOT NULL,
            slot          INTEGER NOT NULL,
            signature     TEXT NOT NULL,
            log_index     INTEGER NOT NULL DEFAULT 0,
            payload_b64   TEXT NOT NULL,
            created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            UNIQUE(signature, program, event_type, log_index)
        );
        INSERT INTO events(id, program, event_type, slot, signature, log_index, payload_b64, created_at)
          SELECT id, program, event_type, slot, signature, 0, payload_b64, created_at
          FROM events_v1;
        DROP TABLE events_v1;
        COMMIT;
        "#,
    )
    .context("migrating events_v1 → events")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_and_idempotency() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let sink = Sink::open(&path).unwrap();

        let inserted =
            sink.record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 0, "b64A").unwrap();
        assert!(inserted);

        // Replay — same tuple (including log_index) should be a no-op.
        let inserted_again =
            sink.record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 0, "b64A").unwrap();
        assert!(!inserted_again);

        // Different event_type with same sig is allowed (one tx can emit
        // multiple events).
        let other =
            sink.record_event("aeqi_trust", "ModuleRegistered", 100, "sigA", 0, "b64B").unwrap();
        assert!(other);

        assert_eq!(sink.event_count().unwrap(), 2);
    }

    #[test]
    fn same_type_multiple_logs_in_one_tx() {
        // Quest 67-162.6 regression: a TRUST genesis tx that wires
        // multiple modules emits several `ModuleRegistered` events.
        // v1's UNIQUE(signature, program, event_type) collapsed them
        // into one row; v2's log_index lets each land.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let sink = Sink::open(&path).unwrap();

        for (i, payload) in ["payloadRole", "payloadToken", "payloadGov"].iter().enumerate() {
            let inserted = sink
                .record_event("aeqi_factory", "ModuleRegistered", 200, "sigGenesis", i as u32, payload)
                .unwrap();
            assert!(inserted, "log_index {i} should insert");
        }
        assert_eq!(sink.event_count().unwrap(), 3);

        // Replay the same three: all dedup.
        for (i, payload) in ["payloadRole", "payloadToken", "payloadGov"].iter().enumerate() {
            let inserted = sink
                .record_event("aeqi_factory", "ModuleRegistered", 200, "sigGenesis", i as u32, payload)
                .unwrap();
            assert!(!inserted, "log_index {i} replay should dedup");
        }
        assert_eq!(sink.event_count().unwrap(), 3);
    }

    #[test]
    fn v1_to_v2_migration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");

        // Hand-construct a v1 db, populate, close.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                r#"
                CREATE TABLE events (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    program       TEXT NOT NULL,
                    event_type    TEXT NOT NULL,
                    slot          INTEGER NOT NULL,
                    signature     TEXT NOT NULL,
                    payload_b64   TEXT NOT NULL,
                    created_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                    UNIQUE(signature, program, event_type)
                );
                CREATE TABLE cursor (
                    program       TEXT PRIMARY KEY,
                    last_slot     INTEGER NOT NULL,
                    updated_at    INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
                );
                INSERT INTO events(program, event_type, slot, signature, payload_b64)
                  VALUES ('aeqi_trust','TrustInitialized',100,'sigA','b64A'),
                         ('aeqi_factory','CompanySpawned',101,'sigA','b64B');
                "#,
            )
            .unwrap();
        }

        // Open via Sink — migration runs.
        let sink = Sink::open(&path).unwrap();
        assert_eq!(sink.event_count().unwrap(), 2);

        // Existing rows got log_index=0; same-type now requires a
        // distinct log_index.
        let dup = sink
            .record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 0, "b64A")
            .unwrap();
        assert!(!dup, "migrated row deduplicates on (..., log_index=0)");

        let new_log = sink
            .record_event("aeqi_trust", "TrustInitialized", 100, "sigA", 1, "b64Aprime")
            .unwrap();
        assert!(new_log, "new log_index for same type lands");
        assert_eq!(sink.event_count().unwrap(), 3);
    }

    #[test]
    fn cursor_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let sink = Sink::open(&path).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), None);

        sink.bump_cursor("aeqi_trust", 100).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), Some(100));

        // Cursor only moves forward
        sink.bump_cursor("aeqi_trust", 50).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), Some(100));

        sink.bump_cursor("aeqi_trust", 200).unwrap();
        assert_eq!(sink.cursor("aeqi_trust").unwrap(), Some(200));
    }
}
