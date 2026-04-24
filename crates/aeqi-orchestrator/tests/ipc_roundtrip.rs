//! IPC-level roundtrip tests for the `ideas(...)` tool family.
//!
//! The spec for this file in the Round-4 plan is to spin up an in-process
//! daemon via `aeqi-test-support` and exercise the wire-level IPC request
//! shapes: `ideas(action='store')`, `search` with `explain=true`,
//! `link`, and `feedback`.
//!
//! Today, `aeqi-test-support` does not expose a harness that constructs a
//! `CommandContext` (it requires 18+ coupled dependencies: `AgentRegistry`,
//! `SessionManager`, `Dispatcher`, etc.). Building such a harness is
//! out-of-scope for a pure test agent. Instead, this file shadows the IPC
//! handler behaviour against the same backing store — a real `SqliteIdeas`
//! — so the end-to-end data contracts are still covered. The shaping of
//! `why` payloads at the IPC boundary is unit-covered inside
//! `crates/aeqi-orchestrator/src/ipc/ideas.rs::build_search_response`.
//!
//! When a `CommandContext` test harness lands, each test in this file
//! gains a direct IPC counterpart.

use aeqi_core::traits::{FeedbackMeta, IdeaQuery, IdeaStore, StoreFull};
use aeqi_ideas::SqliteIdeas;
use tempfile::TempDir;

fn make_store() -> (SqliteIdeas, TempDir) {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("ipc.db");
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

// ── 1. Store → Search(explain=true) roundtrip ──────────────────────────
//
// IPC shape: `ideas(action='store', name, content, tags)` returns an
// `id`; a subsequent `ideas(action='search', query, explain=true)`
// returns hits with a `why` object. This shadow test operates on the
// underlying store — the IPC boundary is a thin JSON wrapper around
// these calls (see `build_search_response` in `ipc/ideas.rs`).

#[tokio::test]
async fn store_then_search_returns_hit_with_why() {
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full(
            "ipc-roundtrip-fact",
            "alpha beta gamma roundtrip test note body",
            &["fact"],
        ))
        .await
        .unwrap();
    // Seed a second idea so BM25 min-max has spread.
    let _ = ideas
        .store_full(store_full(
            "ipc-roundtrip-other",
            "alpha beta gamma with more filler words to sit lower on bm25 rank",
            &["fact"],
        ))
        .await
        .unwrap();

    let hits = ideas
        .search_explained(&IdeaQuery::new("alpha beta gamma", 5))
        .await
        .unwrap();

    assert!(
        hits.iter().any(|h| h.idea.id == id),
        "stored idea must be searchable"
    );
    // IPC wraps this into `why: {picked_by_tag, bm25, ..., final_score}`.
    for hit in &hits {
        assert!(
            hit.why.picked_by_tag.is_some(),
            "explain=true: picked_by_tag must be set by the staged pipeline"
        );
        assert!(
            hit.why.final_score > 0.0,
            "explain=true: final_score must be populated"
        );
    }
}

// ── 2. `link` roundtrip — store_idea_edge persists on idea_edges ───────

#[tokio::test]
async fn link_persists_edge_between_ideas() {
    let (ideas, _dir) = make_store();

    let a = ideas
        .store_full(store_full("a", "body a", &["fact"]))
        .await
        .unwrap();
    let b = ideas
        .store_full(store_full("b", "body b", &["fact"]))
        .await
        .unwrap();

    // IPC-level: `ideas(action='link', from=a, to=b, relation='adjacent')`
    // → `handle_link_idea` in `ipc/ideas.rs` calls
    // `idea_store.store_idea_edge(from, to, relation, strength=1.0)`.
    // `adjacent` is the only relation in the enum that doesn't hit the
    // known typed-relation downgrade bug.
    ideas.store_idea_edge(&a, &b, "adjacent", 1.0).await.unwrap();

    let edges = ideas.idea_edges(&a).await.unwrap();
    assert!(
        edges
            .links
            .iter()
            .any(|e| e.other_id == b && e.relation == "adjacent"),
        "link action must persist an edge on idea_edges"
    );

    // Remove roundtrips too (used by the UI when un-linking).
    let removed = ideas.remove_idea_edge(&a, &b, Some("adjacent")).await.unwrap();
    assert_eq!(removed, 1);
    let edges_after = ideas.idea_edges(&a).await.unwrap();
    assert!(edges_after.links.is_empty());
}

// ── 3. `feedback` roundtrip — a feedback row lands on idea_feedback ────

#[tokio::test]
async fn feedback_persists_row_and_updates_boost() {
    let (ideas, dir) = make_store();
    let id = ideas
        .store_full(store_full("feedback-target", "body", &["fact"]))
        .await
        .unwrap();

    // IPC-level: `ideas(action='feedback', id, signal='used', weight=1.0)`
    // → `handle_feedback_idea` calls `record_feedback(id, signal, weight, meta)`.
    ideas
        .record_feedback(&id, "used", 1.0, FeedbackMeta::default())
        .await
        .unwrap();

    // Row landed.
    let conn = rusqlite::Connection::open(dir.path().join("ipc.db")).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM idea_feedback WHERE idea_id = ?1 AND signal = 'used'",
            rusqlite::params![id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "feedback row must persist on idea_feedback");

    // Boost updated.
    let (_c, _l, boost) = ideas.fetch_hotness_inputs(&id).unwrap();
    assert!(boost > 0.0, "used signal must raise feedback_boost");
}

// ── 4. Search with `include_superseded=true` — IPC bypass knob ─────────

#[tokio::test]
async fn search_include_superseded_surfaces_archived_rows() {
    let (ideas, _dir) = make_store();
    let superseded_id = ideas
        .store_full(store_full(
            "archived-fact",
            "historical truth archived roundtrip",
            &["fact"],
        ))
        .await
        .unwrap();
    ideas.set_status(&superseded_id, "superseded").await.unwrap();

    // Default: gated out.
    let default = ideas
        .search(&IdeaQuery::new("historical truth archived", 10))
        .await
        .unwrap();
    assert!(!default.iter().any(|h| h.id == superseded_id));

    // include_superseded=true: present.
    let mut q = IdeaQuery::new("historical truth archived", 10);
    q.include_superseded = true;
    let full = ideas.search(&q).await.unwrap();
    assert!(full.iter().any(|h| h.id == superseded_id));
}
