//! Feedback loop integration tests.
//!
//! Covers `record_feedback` on the direct `SqliteIdeas` surface, the
//! hotness signals the feedback signals fold into, and the contract
//! around `RecallCache` invalidation (which lives on `CommandContext`
//! and is invalidated by the IPC handler, not by the store itself).

use aeqi_core::traits::{FeedbackMeta, IdeaStore, StoreFull};
use aeqi_ideas::{CacheKey, RecallCache, SqliteIdeas};
use tempfile::TempDir;

fn make_store() -> (SqliteIdeas, TempDir) {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("feedback.db");
    let ideas = SqliteIdeas::open(&db, 30.0).unwrap();
    (ideas, dir)
}

fn store_full(name: &str, content: &str, tags: &[&str]) -> StoreFull {
    StoreFull {
        name: name.to_string(),
        content: content.to_string(),
        tags: tags.iter().map(|s| s.to_string()).collect(),
        agent_id: None,
        scope: aeqi_core::Scope::Global,
        authored_by: None,
        confidence: 1.0,
        expires_at: None,
        valid_from: None,
        valid_until: None,
        time_context: "timeless".into(),
        status: "active".into(),
    }
}

// ── 1. `used` signal lifts feedback_boost → hotness rises ──────────────

#[tokio::test]
async fn used_signal_raises_feedback_boost() {
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full("used-idea", "body content", &["fact"]))
        .await
        .unwrap();

    let (_c0, _l0, boost_before) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert_eq!(boost_before, 0.0, "new rows start at boost=0");

    ideas
        .record_feedback(&id, "used", 1.0, FeedbackMeta::default())
        .await
        .unwrap();

    let (_c, _l, boost_after) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert!(
        boost_after > boost_before,
        "used signal must raise feedback_boost; before={boost_before} after={boost_after}"
    );
    // Spec: `used` / `useful` → boost += 0.10 * weight.
    assert!(
        (boost_after - 0.10).abs() < 1e-4,
        "used signal at weight=1.0 should add 0.10 to boost; got {boost_after}"
    );

    // Hotness reads should reflect the boost.
    let h = ideas.fetch_hotness(&id).unwrap();
    assert!(
        h >= boost_after,
        "hotness must include feedback_boost (h={h} boost={boost_after})"
    );
}

// ── 2. `wrong` signal crushes feedback_boost ───────────────────────────
//
// Spec (hotness.rs): `wrong` → boost *= 0.30. The implementation applies
// the multiplier to the current (possibly positive) boost, so a prior
// `used` gets crushed down rather than simply zeroed.

#[tokio::test]
async fn wrong_signal_crushes_boost() {
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full("wrong-idea", "body content", &["fact"]))
        .await
        .unwrap();

    // First `used` to get a positive boost.
    ideas
        .record_feedback(&id, "used", 1.0, FeedbackMeta::default())
        .await
        .unwrap();
    let (_c, _l, positive) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert!(positive > 0.0);

    // Then `wrong` — boost should collapse toward zero.
    ideas
        .record_feedback(&id, "wrong", 1.0, FeedbackMeta::default())
        .await
        .unwrap();
    let (_c, _l, after) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert!(
        after.abs() < positive,
        "wrong signal must reduce the boost magnitude; positive={positive} after={after}"
    );
}

// ── 2b. `wrong` / `corrected` feedback emits a contradiction self-edge ─
//
// Spec (hotness.rs): on `wrong` / `corrected`, alongside the boost math,
// record a self-loop `contradiction` edge on `idea_edges`. The edge is a
// durable marker that survives hotness decay so graph walks and MMR can
// downweight contradicted ideas. Repeated negative feedback bumps the
// edge strength (capped at 1.0) instead of duplicating rows.

#[tokio::test]
async fn wrong_feedback_writes_contradiction_edge() {
    let (ideas, dir) = make_store();
    let id = ideas
        .store_full(store_full(
            "contradiction-target",
            "body content",
            &["fact"],
        ))
        .await
        .unwrap();

    ideas
        .record_feedback(&id, "wrong", 1.0, FeedbackMeta::default())
        .await
        .unwrap();

    let conn = rusqlite::Connection::open(dir.path().join("feedback.db")).unwrap();
    let (src, tgt, rel, strength): (String, String, String, f64) = conn
        .query_row(
            "SELECT source_id, target_id, relation, strength FROM idea_edges \
             WHERE source_id = ?1 AND relation = 'contradiction'",
            rusqlite::params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("wrong feedback must emit a contradiction edge");
    assert_eq!(src, id);
    assert_eq!(tgt, id, "contradiction marker is a self-loop");
    assert_eq!(rel, "contradiction");
    assert!(
        strength >= 1.0,
        "initial contradiction strength should be >= 1.0, got {strength}"
    );
}

#[tokio::test]
async fn repeat_wrong_feedback_bumps_contradiction_strength() {
    let (ideas, dir) = make_store();
    let id = ideas
        .store_full(store_full("repeat-wrong", "body", &["fact"]))
        .await
        .unwrap();

    // First signal seeds the edge at strength 1.0.
    ideas
        .record_feedback(&id, "wrong", 1.0, FeedbackMeta::default())
        .await
        .unwrap();
    // Repeat doesn't duplicate the row; it bumps strength, clamped at 1.0.
    ideas
        .record_feedback(&id, "wrong", 1.0, FeedbackMeta::default())
        .await
        .unwrap();

    let conn = rusqlite::Connection::open(dir.path().join("feedback.db")).unwrap();
    let rows: Vec<(String, f64)> = {
        let mut stmt = conn
            .prepare(
                "SELECT relation, strength FROM idea_edges \
                 WHERE source_id = ?1 AND target_id = ?1",
            )
            .unwrap();
        stmt.query_map(rusqlite::params![id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect()
    };
    assert_eq!(rows.len(), 1, "upsert must not duplicate the edge");
    assert_eq!(rows[0].0, "contradiction");
    assert!(rows[0].1 <= 1.0, "strength must be clamped at 1.0");
}

// ── 3. Feedback row lands on `idea_feedback` ───────────────────────────
//
// The feedback loop is auditable: every record_feedback call appends a
// row to `idea_feedback`. Verify via a raw query.

#[tokio::test]
async fn feedback_row_persists_with_metadata() {
    let (ideas, dir) = make_store();
    let id = ideas
        .store_full(store_full("audit-idea", "body content", &["fact"]))
        .await
        .unwrap();

    let meta = FeedbackMeta {
        agent_id: Some("agent-a".into()),
        session_id: Some("sess-1".into()),
        query_text: Some("why this".into()),
        note: Some("follow-up note".into()),
    };
    ideas
        .record_feedback(&id, "useful", 0.75, meta)
        .await
        .unwrap();

    // Query the DB directly — there's no read API for feedback rows.
    let conn = rusqlite::Connection::open(dir.path().join("feedback.db")).unwrap();
    let (signal, weight, agent, sess, qtext, note): (
        String,
        f64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT signal, weight, agent_id, session_id, query_text, note \
             FROM idea_feedback WHERE idea_id = ?1 \
             ORDER BY id DESC LIMIT 1",
            rusqlite::params![id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .expect("feedback row must exist");
    assert_eq!(signal, "useful");
    assert!((weight - 0.75).abs() < 1e-6);
    assert_eq!(agent.as_deref(), Some("agent-a"));
    assert_eq!(sess.as_deref(), Some("sess-1"));
    assert_eq!(qtext.as_deref(), Some("why this"));
    assert_eq!(note.as_deref(), Some("follow-up note"));
}

// ── 4. Unknown feedback signals are accepted but leave boost unchanged ─
//
// Unknown signals are allowed through so forward-compat wire messages
// don't crash the daemon; `hotness.rs` logs at warn and leaves boost
// alone. The feedback row still lands (for observability) so downstream
// consumers can inspect it.

#[tokio::test]
async fn unknown_signal_does_not_change_boost() {
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full("unknown-signal", "body", &["fact"]))
        .await
        .unwrap();
    ideas
        .record_feedback(&id, "future-signal", 1.0, FeedbackMeta::default())
        .await
        .unwrap();
    let (_c, _l, boost) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert_eq!(boost, 0.0, "unknown signal must leave boost at 0");
}

// ── 5. Recall cache generation bumps on invalidate ─────────────────────
//
// The `RecallCache` is the daemon-side cache wired into `CommandContext`
// by Agent R. Tests against a full `CommandContext` are gated on a test
// harness that doesn't yet exist (see agent return); we instead verify
// the cache primitive's invalidation contract directly. The IPC handler
// `handle_feedback_idea` is responsible for calling `invalidate()` after
// a successful `record_feedback` — the handler code is already unit-covered.

#[test]
fn recall_cache_invalidation_bumps_generation_and_clears() {
    let cache = RecallCache::default();
    let key = CacheKey::build("q", &[], 5, None, None);
    let hits = Vec::new();
    cache.put(key, hits);
    assert!(cache.get(&key).is_some(), "cache must return a fresh entry");
    let before = cache.generation();

    cache.invalidate();

    assert_eq!(
        cache.generation(),
        before + 1,
        "invalidate must bump the generation counter"
    );
    assert!(
        cache.get(&key).is_none(),
        "invalidate must clear every entry"
    );
}
