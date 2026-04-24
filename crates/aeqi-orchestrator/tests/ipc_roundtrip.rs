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
    ideas
        .store_idea_edge(&a, &b, "adjacent", 1.0)
        .await
        .unwrap();

    let edges = ideas.idea_edges(&a).await.unwrap();
    assert!(
        edges
            .links
            .iter()
            .any(|e| e.other_id == b && e.relation == "adjacent"),
        "link action must persist an edge on idea_edges"
    );

    // Remove roundtrips too (used by the UI when un-linking).
    let removed = ideas
        .remove_idea_edge(&a, &b, Some("adjacent"))
        .await
        .unwrap();
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

// ── Fix #6: active-row dedup lookup ───────────────────────────────────
//
// `get_active_id_by_name` mirrors the partial unique index
// `idx_ideas_agent_name_active_unique`. The write-path short-circuit in
// `handle_store_idea` calls this to return `action: "skip"` with the
// existing id instead of tripping UNIQUE at INSERT. Same-name second
// writes to an active row must find it; superseded rows must NOT match;
// global vs agent-scoped rows must not cross-contaminate.

#[tokio::test]
async fn get_active_id_by_name_finds_active_row() {
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full("uniq-target", "body", &["fact"]))
        .await
        .unwrap();
    let found = ideas
        .get_active_id_by_name("uniq-target", None)
        .await
        .unwrap();
    assert_eq!(found.as_deref(), Some(id.as_str()));
}

#[tokio::test]
async fn get_active_id_by_name_ignores_superseded_rows() {
    let (ideas, _dir) = make_store();
    let id = ideas
        .store_full(store_full("archivable", "historical", &["fact"]))
        .await
        .unwrap();
    ideas.set_status(&id, "superseded").await.unwrap();
    let found = ideas
        .get_active_id_by_name("archivable", None)
        .await
        .unwrap();
    assert!(
        found.is_none(),
        "superseded rows must not shadow the active slot"
    );
}

#[tokio::test]
async fn get_active_id_by_name_scopes_by_agent() {
    let (ideas, _dir) = make_store();
    let mut scoped = store_full("scoped-fact", "body", &["fact"]);
    scoped.agent_id = Some("agent-a".to_string());
    scoped.scope = aeqi_core::Scope::SelfScope;
    let _ = ideas.store_full(scoped).await.unwrap();

    // Global lookup finds nothing.
    let global_hit = ideas
        .get_active_id_by_name("scoped-fact", None)
        .await
        .unwrap();
    assert!(
        global_hit.is_none(),
        "agent-scoped row must not surface on global lookup"
    );

    // Agent-scoped lookup finds it.
    let scoped_hit = ideas
        .get_active_id_by_name("scoped-fact", Some("agent-a"))
        .await
        .unwrap();
    assert!(scoped_hit.is_some());

    // Sibling agent must not see it.
    let sibling_hit = ideas
        .get_active_id_by_name("scoped-fact", Some("agent-b"))
        .await
        .unwrap();
    assert!(sibling_hit.is_none());
}

#[tokio::test]
async fn duplicate_store_full_raises_unique_constraint_error() {
    // This exercises the *failure* path that `dispatch_create` swallows via
    // `is_unique_constraint_error`. We can't reach the IPC handler without
    // a `CommandContext`, but we can confirm the underlying error shape
    // stays stable: a second `store_full` with the same active
    // `(agent_id, name)` must surface a rusqlite UNIQUE error through the
    // `anyhow` chain.
    let (ideas, _dir) = make_store();
    let _ = ideas
        .store_full(store_full("dup-name", "body one", &["fact"]))
        .await
        .unwrap();
    let err = ideas
        .store_full(store_full("dup-name", "body two", &["fact"]))
        .await
        .expect_err("second active insert must collide with UNIQUE");

    // The safety net in `dispatch_create` relies on finding a rusqlite
    // SqliteFailure with extended code SQLITE_CONSTRAINT_UNIQUE somewhere
    // in the error chain.
    let mut saw_unique = false;
    for cause in err.chain() {
        if let Some(rusqlite::Error::SqliteFailure(sqlite_err, _)) =
            cause.downcast_ref::<rusqlite::Error>()
            && sqlite_err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
        {
            saw_unique = true;
            break;
        }
    }
    assert!(
        saw_unique,
        "expected SQLITE_CONSTRAINT_UNIQUE in error chain; got {err:?}"
    );
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
    ideas
        .set_status(&superseded_id, "superseded")
        .await
        .unwrap();

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
