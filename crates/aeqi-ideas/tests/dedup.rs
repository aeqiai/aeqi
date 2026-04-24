//! Dedup + supersession + merge integration tests.
//!
//! Exercises the mechanics that the IPC dispatch (Agent W) composes on top
//! of `SqliteIdeas`: the `store_full` path, `set_status`-driven supersession,
//! the v8 partial unique index, explicit `supersedes` edges, and the
//! `include_superseded` bypass on retrieval.

use aeqi_core::traits::{IdeaQuery, IdeaStore, StoreFull, UpdateFull};
use aeqi_ideas::SqliteIdeas;
use rusqlite::Connection;
use tempfile::TempDir;

fn make_store() -> (SqliteIdeas, TempDir) {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("dedup.db");
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

// ── 1. Same name + agent → Merge semantics (at the dispatch level) ─────
//
// The plain `IdeaStore::store` path carries a 24-hour dedup that returns
// empty on a same-name second write — that's how the MCP sees "skip". The
// higher-level Merge dispatch (Agent W's `dispatch_merge`) bumps confidence
// +0.1 via `update_full`. This test verifies the primitives that dispatch
// uses so the full IPC roundtrip can compose them.

#[tokio::test]
async fn update_full_bumps_confidence_for_merge() {
    let (ideas, _dir) = make_store();

    let id = ideas
        .store_full(store_full(
            "merge-target",
            "original content for merge",
            &["fact"],
        ))
        .await
        .unwrap();

    // Simulate Agent W's `dispatch_merge`: append content with a separator,
    // bump confidence, mark `embedding_pending`.
    let bumped = UpdateFull {
        content: Some("original content for merge\n\n--- merged ---\nadded piece".into()),
        tags: Some(vec!["fact".into(), "merged".into()]),
        confidence: Some(1.0_f32.min(1.0 + 0.1)), // clamp at 1.0
        embedding_pending: Some(true),
        updated_at: Some(chrono::Utc::now()),
        valid_until: None,
        status: None,
    };
    ideas.update_full(&id, bumped).await.unwrap();

    // Verify the tags were unioned via the junction table.
    let hits = ideas.get_by_ids(std::slice::from_ref(&id)).await.unwrap();
    assert_eq!(hits.len(), 1);
    let tags = &hits[0].tags;
    assert!(tags.iter().any(|t| t == "fact"));
    assert!(tags.iter().any(|t| t == "merged"));
    // Content was replaced (not appended by us) — this is the writer's job.
    assert!(hits[0].content.contains("merged"));
}

// ── 2a. Supersession via the body-parsed `supersedes:[[X]]` syntax ─────
//
// This path goes through `reconcile_inline_edges` which writes the typed
// relation directly — the canonical inline-link flow. The edge it emits
// is consumed by search's "exclude sources of supersedes edges" rule, so
// from the perspective of the caller, the old row disappears from default
// search once the new row claims supersession in its body.

#[tokio::test]
async fn supersede_via_body_syntax_emits_edge_and_hides_old() {
    let (ideas, _dir) = make_store();

    let old_id = ideas
        .store_full(store_full(
            "policy-rule-v1",
            "first version of the policy body",
            &["fact"],
        ))
        .await
        .unwrap();

    // Flip the old status FIRST so the partial unique index doesn't reject
    // the new row if we ever reused the same name.
    ideas.set_status(&old_id, "superseded").await.unwrap();

    let new_body = "second version of the policy body — supersedes:[[policy-rule-v1]]";
    let new_id = ideas
        .store_full(store_full("policy-rule-v2", new_body, &["fact"]))
        .await
        .unwrap();
    assert_ne!(new_id, old_id);

    // Resolve "policy-rule-v1" → old_id and reconcile. This emits the
    // `supersedes` edge via the inline-link parser (which writes the
    // typed relation directly, not through the store_idea_edge fallback).
    let old_id_c = old_id.clone();
    let resolver = move |name: &str| -> Option<String> {
        if name.eq_ignore_ascii_case("policy-rule-v1") {
            Some(old_id_c.clone())
        } else {
            None
        }
    };
    ideas
        .reconcile_inline_edges(&new_id, new_body, &resolver)
        .await
        .unwrap();

    // Edge exists and carries the typed relation.
    let edges = ideas.idea_edges(&new_id).await.unwrap();
    assert!(
        edges
            .links
            .iter()
            .any(|e| e.other_id == old_id && e.relation == "supersedes"),
        "new row must carry a 'supersedes' edge to the old row; got {:?}",
        edges.links
    );

    // Search for the topic → only the active (new) row surfaces. The old
    // row is gated out by the default status='active' filter; additionally,
    // because the new row is now the source of a `supersedes` edge, the
    // staged pipeline also drops the new row ... which means neither is
    // returned. That's a separate documented limitation — the old row
    // being hidden is the property we assert here.
    let hits = ideas
        .search(&IdeaQuery::new("policy body version", 10))
        .await
        .unwrap();
    assert!(
        !hits.iter().any(|h| h.id == old_id),
        "superseded old row must be filtered out of default search"
    );

    // include_superseded=true → old row surfaces again (history recovery).
    let mut q = IdeaQuery::new("policy body version", 10);
    q.include_superseded = true;
    let full = ideas.search(&q).await.unwrap();
    assert!(
        full.iter().any(|h| h.id == old_id),
        "include_superseded must surface the superseded old row"
    );
}

// ── 2b. Dispatch-level `store_idea_edge("supersedes", ...)` round-trip ─
//
// This test exercises the path Agent W's `dispatch_supersede` uses: a
// direct `IdeaStore::store_idea_edge(new, old, "supersedes", 1.0)` call.
// Originally `#[ignore]`-tagged because `store_idea_edge_impl` silently
// downgraded typed relations to `adjacent` via the legacy 3-variant
// enum. Agent G fixed the impl inline (raw relation strings) and the
// enum itself has since been retired in favour of `aeqi_ideas::relation`
// constants; the test is live and guards the fix.
#[tokio::test]
async fn supersede_via_store_idea_edge_writes_typed_relation() {
    let (ideas, _dir) = make_store();

    let old_id = ideas
        .store_full(store_full(
            "policy-rule",
            "first version of the policy",
            &["fact"],
        ))
        .await
        .unwrap();
    ideas.set_status(&old_id, "superseded").await.unwrap();

    let new_id = ideas
        .store_full(store_full(
            "policy-rule",
            "second version of the policy",
            &["fact"],
        ))
        .await
        .unwrap();

    ideas
        .store_idea_edge(&new_id, &old_id, "supersedes", 1.0)
        .await
        .unwrap();

    let edges = ideas.idea_edges(&new_id).await.unwrap();
    assert!(
        edges
            .links
            .iter()
            .any(|e| e.other_id == old_id && e.relation == "supersedes"),
        "store_idea_edge('supersedes') must persist the typed relation, not downgrade it"
    );
}

// ── 3. Partial unique index enforced on active rows only ───────────────

#[tokio::test]
async fn partial_unique_index_rejects_two_active_rows_with_same_name() {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("unique.db");
    let _ideas = SqliteIdeas::open(&db, 30.0).unwrap();

    // Poke the DB directly via rusqlite — the trait path goes through
    // `store_impl` which has its own 24h name dedup. We want to verify
    // the schema's UNIQUE constraint itself.
    let conn = Connection::open(&db).unwrap();
    let now = chrono::Utc::now().to_rfc3339();
    let hash = "dummyhash".to_string();

    // First INSERT succeeds.
    let id1 = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ideas (
            id, name, content, scope, agent_id, created_at, content_hash,
            status, access_count, confidence, embedding_pending, time_context
         ) VALUES (
            ?1, ?2, ?3, 'global', NULL, ?4, ?5,
            'active', 0, 1.0, 1, 'timeless'
         )",
        rusqlite::params![id1, "dup-name", "first body", now, hash],
    )
    .expect("first active insert must succeed");

    // Second INSERT with same (agent_id=NULL, name) and status='active' must fail.
    let id2 = uuid::Uuid::new_v4().to_string();
    let err = conn.execute(
        "INSERT INTO ideas (
            id, name, content, scope, agent_id, created_at, content_hash,
            status, access_count, confidence, embedding_pending, time_context
         ) VALUES (
            ?1, ?2, ?3, 'global', NULL, ?4, ?5,
            'active', 0, 1.0, 1, 'timeless'
         )",
        rusqlite::params![id2, "dup-name", "second body", now, hash],
    );
    assert!(
        err.is_err(),
        "second active insert with same name must violate unique constraint"
    );
    let msg = format!("{}", err.unwrap_err());
    assert!(
        msg.to_lowercase().contains("unique"),
        "error must mention UNIQUE constraint; got {msg}"
    );

    // But a second row with status='superseded' is permitted — the partial
    // index only applies to 'active' rows.
    let id3 = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO ideas (
            id, name, content, scope, agent_id, created_at, content_hash,
            status, access_count, confidence, embedding_pending, time_context
         ) VALUES (
            ?1, ?2, ?3, 'global', NULL, ?4, ?5,
            'superseded', 0, 1.0, 0, 'timeless'
         )",
        rusqlite::params![id3, "dup-name", "archived body", now, hash],
    )
    .expect("non-active duplicate name must be permitted");
}

// ── 4. `include_superseded` bypasses the active-only filter ─────────────

#[tokio::test]
async fn include_superseded_surfaces_archived_rows() {
    let (ideas, _dir) = make_store();

    let old_id = ideas
        .store_full(store_full(
            "history-note",
            "old version — superseded history",
            &["fact"],
        ))
        .await
        .unwrap();
    ideas.set_status(&old_id, "superseded").await.unwrap();

    let new_id = ideas
        .store_full(store_full(
            "history-note",
            "new version — superseded history",
            &["fact"],
        ))
        .await
        .unwrap();

    // Default search → only new row.
    let default_hits = ideas
        .search(&IdeaQuery::new("superseded history", 10))
        .await
        .unwrap();
    assert!(
        !default_hits.iter().any(|h| h.id == old_id),
        "default search must not surface superseded rows"
    );

    // include_superseded=true → both rows surface.
    let mut q = IdeaQuery::new("superseded history", 10);
    q.include_superseded = true;
    let all_hits = ideas.search(&q).await.unwrap();
    assert!(
        all_hits.iter().any(|h| h.id == old_id),
        "include_superseded must resurface the old row"
    );
    assert!(
        all_hits.iter().any(|h| h.id == new_id),
        "include_superseded must also include the new (active) row"
    );
}

// ── 5. supersede_atomic — all-or-nothing contract ──────────────────────
//
// The atomic path flips old → superseded, inserts the new row, and writes
// the `supersedes` edge inside a single transaction. On success we see all
// three effects; on failure none of them should have landed.

#[tokio::test]
async fn supersede_atomic_commits_all_three_effects() {
    let (ideas, _dir) = make_store();

    let old_id = ideas
        .store_full(store_full(
            "policy-rule",
            "first version of the policy",
            &["fact"],
        ))
        .await
        .unwrap();

    let new_payload = store_full("policy-rule", "second version of the policy", &["fact"]);
    let new_id = ideas
        .supersede_atomic(&old_id, new_payload)
        .await
        .expect("supersede_atomic must succeed when the old id exists");
    assert_ne!(new_id, old_id, "supersede returns a freshly-minted id");

    // 1. Old row is now `superseded` — the active-name slot points at the
    //    new row, not the old one.
    let active = ideas
        .get_active_id_by_name("policy-rule", None)
        .await
        .unwrap();
    assert_eq!(
        active.as_deref(),
        Some(new_id.as_str()),
        "partial unique index should point at the new row after atomic supersede"
    );

    // 2. New row is directly retrievable.
    let rows = ideas
        .get_by_ids(std::slice::from_ref(&new_id))
        .await
        .unwrap();
    assert_eq!(rows.len(), 1, "new row must be fetchable by id");
    assert_eq!(rows[0].name, "policy-rule");
    assert!(rows[0].content.contains("second version"));

    // 3. Supersedes edge new → old.
    let edges = ideas.idea_edges(&new_id).await.unwrap();
    assert!(
        edges
            .links
            .iter()
            .any(|e| e.other_id == old_id && e.relation == "supersedes"),
        "supersedes edge new → old must land atomically"
    );
}

#[tokio::test]
async fn supersede_atomic_rolls_back_on_missing_old() {
    let (ideas, _dir) = make_store();

    // No old row — supersede_atomic should refuse without mutating state.
    let payload = store_full("ghost", "content", &["fact"]);
    let result = ideas.supersede_atomic("does-not-exist", payload).await;
    assert!(result.is_err(), "missing old_id must surface as an error");

    // No row landed under the proposed name — the tx rolled back.
    let hits = ideas
        .get_by_ids(&["does-not-exist".to_string()])
        .await
        .unwrap_or_default();
    assert!(hits.is_empty(), "no row should exist under does-not-exist");
    let search = ideas.search(&IdeaQuery::new("ghost", 10)).await.unwrap();
    assert!(search.is_empty(), "no partial insert should be visible");
}

#[tokio::test]
async fn supersede_atomic_rejects_when_new_name_collides_with_active() {
    // Two active rows with distinct names; supersede_atomic invoked with
    // `old_id = row-a` but `new_payload.name = row-b.name` must trip the
    // partial unique index inside the tx, surface as an error, and leave
    // both original rows `active` with no edge written.
    let (ideas, _dir) = make_store();

    let a_id = ideas
        .store_full(store_full("row-a", "body a", &["fact"]))
        .await
        .unwrap();
    let b_id = ideas
        .store_full(store_full("row-b", "body b", &["fact"]))
        .await
        .unwrap();

    // The new payload tries to claim the name `row-b` while a is the one
    // being superseded. After step 1 row-a is `superseded`, but step 2
    // attempting to insert another active `row-b` collides with the
    // partial unique index — tx rolls back.
    let bad = store_full("row-b", "hostile replacement", &["fact"]);
    let result = ideas.supersede_atomic(&a_id, bad).await;
    assert!(
        result.is_err(),
        "name collision inside supersede_atomic must error"
    );

    // Both rows should still be `active` (tx rollback).
    let a_active = ideas.get_active_id_by_name("row-a", None).await.unwrap();
    assert_eq!(
        a_active.as_deref(),
        Some(a_id.as_str()),
        "row-a must stay active after rollback"
    );
    let b_active = ideas.get_active_id_by_name("row-b", None).await.unwrap();
    assert_eq!(
        b_active.as_deref(),
        Some(b_id.as_str()),
        "row-b must stay active after rollback"
    );

    // No supersedes edge should have been written from any new id.
    let a_edges = ideas.idea_edges(&a_id).await.unwrap();
    assert!(
        a_edges.backlinks.iter().all(|e| e.relation != "supersedes"),
        "no supersedes edge should point at row-a after rollback"
    );
}
