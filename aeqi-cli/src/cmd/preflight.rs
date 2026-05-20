//! Boot-time preflight checks.
//!
//! Per AEQI idea `08c226f3-…` Phase 1 (C4): the
//! 2026-05-17 + 2026-05-18 outages presented as a healthy systemd unit
//! emitting `completion_tokens=0` for every LLM call because the upstream
//! provider was cap-exhausted. The runtime kept firing scheduled events,
//! sessions opened and closed empty, and `journalctl` had to be tailed
//! manually to notice. The signal is sitting in `aeqi.db` already — the
//! `inference_calls` audit table records `completion_tokens` per call.
//!
//! This module reads the last N rows at boot. If every recent call has
//! `completion_tokens == 0`, we emit a loud warn-level log. Warning is
//! deliberate: a transient provider hiccup must not hard-fail boot, and
//! a real page should come from the SA74 metric counter + an alert rule.
//! The boot warning exists so an operator restarting the daemon sees
//! the condition immediately on startup rather than discovering it
//! from a downstream symptom.

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use tracing::{info, warn};

/// Number of most-recent inference calls to inspect.
const RECENT_CALL_WINDOW: usize = 5;

/// Read the last `RECENT_CALL_WINDOW` rows from `inference_calls` and warn
/// if ALL of them have `completion_tokens == 0`.
///
/// - If the DB or the table is missing: log and return Ok (cold boot).
/// - If 0 rows: log "no history yet" and return Ok.
/// - If ≥1 rows and ALL zero: warn-log, return Ok (boot continues).
/// - Otherwise: info-log the mix and return Ok.
///
/// This function NEVER returns Err for "bad LLM health"; it only returns
/// Err if the DB read itself blows up in a way that suggests a corrupt
/// install. Even then the caller logs and continues — preflight is
/// advisory.
pub fn pre_flight_llm_health_check(aeqi_db: &Path) -> Result<()> {
    if !aeqi_db.exists() {
        info!(
            db = %aeqi_db.display(),
            "preflight: aeqi.db not found — skipping LLM health check (cold boot)"
        );
        return Ok(());
    }

    // Read-only open so we never touch journal/WAL state and never block
    // the daemon's own writer pool.
    let conn = Connection::open_with_flags(
        aeqi_db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("opening {} read-only", aeqi_db.display()))?;

    let outcomes = recent_llm_call_outcomes(&conn, RECENT_CALL_WINDOW)?;

    if outcomes.is_empty() {
        info!("preflight: no inference_calls history yet — skipping LLM health check");
        return Ok(());
    }

    let total = outcomes.len();
    let non_zero = outcomes.iter().filter(|ok| **ok).count();

    if non_zero == 0 {
        warn!(
            recent = total,
            "preflight: ALL {total} most-recent inference_calls returned completion_tokens=0 — \
             LLM provider may be cap-exhausted or misconfigured. \
             Boot continues; check provider quota / API keys before relying on agent output."
        );
    } else {
        info!(
            "preflight: LLM health OK — {non_zero} of {total} recent inference_calls had \
             non-zero completion_tokens"
        );
    }

    Ok(())
}

/// Returns one bool per recent `inference_calls` row: `true` iff
/// `completion_tokens > 0`. Most-recent first. Empty if the table is
/// missing or has no rows.
fn recent_llm_call_outcomes(conn: &Connection, limit: usize) -> Result<Vec<bool>> {
    // If the table doesn't exist (fresh DB on a code path that didn't
    // hit AgentRegistry::open yet), treat it as "no history".
    let table_exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='inference_calls'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !table_exists {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT completion_tokens
             FROM inference_calls
             ORDER BY datetime(created_at) DESC, id DESC
             LIMIT ?1",
        )
        .context("preparing recent inference_calls query")?;
    let rows = stmt
        .query_map([limit as i64], |row| {
            let ct: i64 = row.get(0)?;
            Ok(ct > 0)
        })
        .context("querying recent inference_calls")?;
    let mut out = Vec::with_capacity(limit);
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use tempfile::TempDir;

    fn seed_db(rows: &[i64]) -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("aeqi.db");
        let conn = Connection::open(&path).expect("open seed db");
        conn.execute_batch(
            "CREATE TABLE inference_calls (
                 id TEXT PRIMARY KEY,
                 agent_id TEXT NOT NULL,
                 session_id TEXT,
                 model TEXT NOT NULL,
                 prompt_tokens INTEGER NOT NULL DEFAULT 0,
                 completion_tokens INTEGER NOT NULL DEFAULT 0,
                 cost_usd REAL NOT NULL DEFAULT 0,
                 stop_reason TEXT,
                 correlation_id TEXT,
                 created_at TEXT NOT NULL
             );",
        )
        .expect("create inference_calls");
        // Inserted oldest-first so the SQL ORDER BY ... DESC picks the
        // last array element as "most recent".
        for (i, ct) in rows.iter().enumerate() {
            let id = format!("call-{i:04}");
            // ISO-8601 timestamps that sort lexicographically.
            let created_at = format!("2026-05-20T00:00:{:02}Z", i);
            conn.execute(
                "INSERT INTO inference_calls
                 (id, agent_id, session_id, model, prompt_tokens, completion_tokens,
                  cost_usd, stop_reason, correlation_id, created_at)
                 VALUES (?1, 'agent-x', NULL, 'm', 10, ?2, 0.0, 'stop', NULL, ?3)",
                params![id, ct, created_at],
            )
            .expect("insert row");
        }
        (dir, path)
    }

    #[test]
    fn pre_flight_llm_health_check_passes_when_db_empty() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("does-not-exist.db");
        // Missing DB is fine — cold boot.
        pre_flight_llm_health_check(&path).expect("missing db is ok");

        // Existing DB with no inference_calls table is also fine.
        let path2 = dir.path().join("aeqi.db");
        let conn = Connection::open(&path2).unwrap();
        conn.execute_batch("CREATE TABLE unrelated (id INTEGER);")
            .unwrap();
        drop(conn);
        pre_flight_llm_health_check(&path2).expect("table-less db is ok");

        // And a table with zero rows is fine.
        let (_dir3, path3) = seed_db(&[]);
        pre_flight_llm_health_check(&path3).expect("empty table is ok");
    }

    #[test]
    fn pre_flight_llm_health_check_warns_when_all_recent_zero() {
        // 5 zero rows — all-zero condition.
        let (_dir, path) = seed_db(&[0, 0, 0, 0, 0]);
        pre_flight_llm_health_check(&path).expect("warn path returns Ok");

        // Also: older non-zero rows must NOT save us if the most recent
        // 5 are all zero — the window is the most-recent 5.
        let (_dir2, path2) = seed_db(&[42, 99, 0, 0, 0, 0, 0]);
        pre_flight_llm_health_check(&path2).expect("still warn — window is recent");

        // Direct unit check on the helper, since pre_flight_llm_health_check
        // only logs.
        let conn = Connection::open_with_flags(
            &path2,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap();
        let outcomes = recent_llm_call_outcomes(&conn, RECENT_CALL_WINDOW).unwrap();
        assert_eq!(outcomes.len(), 5);
        assert!(
            outcomes.iter().all(|ok| !ok),
            "expected all-zero window, got {outcomes:?}"
        );
    }

    #[test]
    fn pre_flight_llm_health_check_passes_when_some_non_zero() {
        // Mixed window — at least one non-zero in the most-recent 5.
        let (_dir, path) = seed_db(&[0, 0, 0, 0, 42]);
        pre_flight_llm_health_check(&path).expect("mixed is ok");

        // All non-zero is also fine.
        let (_dir2, path2) = seed_db(&[10, 20, 30, 40, 50]);
        pre_flight_llm_health_check(&path2).expect("all-good is ok");

        let conn = Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap();
        let outcomes = recent_llm_call_outcomes(&conn, RECENT_CALL_WINDOW).unwrap();
        assert_eq!(outcomes.len(), 5);
        assert!(
            outcomes.iter().any(|ok| *ok),
            "expected at least one non-zero, got {outcomes:?}"
        );
    }
}
