//! IPC-level end-to-end tests built on the Round-7b `TestHarness`.
//!
//! Every test in this file exercises behaviour that was previously
//! impossible to test from the IPC boundary because `CommandContext`
//! required ~18 hand-wired dependencies. The harness
//! ([`aeqi_test_support::TestHarness`]) assembles all of them in memory so
//! tests can call the handlers directly and assert on the wire-level JSON
//! and the observable side effects on the store.
//!
//! Sibling file: `ipc_roundtrip.rs` still shadows the IPC boundary against
//! the store directly — keep it for fast unit-shaped tests. This file is
//! the home for tests that *must* cross the handler to validate scope /
//! guard / dispatch behaviour.

use aeqi_core::tool_registry::PatternDispatcher;
use aeqi_orchestrator::agent_registry::AgentRegistry;
use aeqi_orchestrator::event_handler::{EventHandlerStore, seed_lifecycle_events};
use aeqi_orchestrator::idea_assembly::EventPatternDispatcher;
use aeqi_orchestrator::ipc::ideas::{
    handle_add_idea_edge, handle_feedback_idea, handle_link_idea, handle_store_idea,
};
use aeqi_orchestrator::runtime_tools::{
    SpawnFn, SpawnRequest, build_runtime_registry_with_spawn_and_caps,
};
use aeqi_test_support::TestHarness;
use std::sync::Arc;

// ── 1. Feedback rejects cross-agent id ─────────────────────────────────
//
// `handle_feedback_idea` gates writes on `list_ideas_visible_to`: an agent
// that passes its own `agent_id` but targets another agent's self-scoped
// idea must be rejected. Pre-harness this was only covered at the store
// layer — nothing exercised the handler's visibility guard in-process.

#[tokio::test]
async fn feedback_rejects_cross_agent_id() {
    let h = TestHarness::build().await.unwrap();

    // Two agents. Agent A stores a self-scoped idea; agent B attempts to
    // feedback it.
    let agent_a = h.spawn_agent("agent-a").await.unwrap();
    let agent_b = h.spawn_agent("agent-b").await.unwrap();

    let idea_id = h
        .add_idea("a-private-idea", "private to A", &["fact"], Some(&agent_a))
        .await
        .unwrap();

    let ctx = h.ctx();
    let req = serde_json::json!({
        "id": idea_id,
        "signal": "used",
        "agent_id": agent_b,
    });
    let resp = handle_feedback_idea(&ctx, &req, &None).await;

    assert_eq!(
        resp["ok"],
        serde_json::json!(false),
        "agent B must not be able to feedback A's private idea: {resp}"
    );
    assert!(
        resp["error"].as_str().unwrap_or("").contains("not visible"),
        "error text should call out visibility, got: {resp}"
    );

    // Sanity: the owning agent CAN feedback. If this fails the harness
    // agent-registry wiring is off (ancestry closure missing, or the
    // `inheritance`/`tool_allow`/`tool_deny` shim in TestHarness regressed).
    let ok_req = serde_json::json!({
        "id": idea_id,
        "signal": "used",
        "agent_id": agent_a,
    });
    let ok_resp = handle_feedback_idea(&ctx, &ok_req, &None).await;
    assert_eq!(
        ok_resp["ok"],
        serde_json::json!(true),
        "owning agent must succeed: {ok_resp}"
    );
}

// ── 2. Link rejects unknown relation at the IPC boundary ───────────────
//
// R6b landed the validation inside `handle_link_idea`. This test confirms
// the handler rejects "foobar" without reaching the store — paired with
// the existing `is_known_rejects_unknown_relation_before_write` unit test
// which only checks the gate function in isolation.

#[tokio::test]
async fn link_handler_rejects_unknown_relation() {
    let h = TestHarness::build().await.unwrap();

    let a = h
        .add_idea("link-a", "body a", &["fact"], None)
        .await
        .unwrap();
    let b = h
        .add_idea("link-b", "body b", &["fact"], None)
        .await
        .unwrap();

    let ctx = h.ctx();
    let req = serde_json::json!({
        "from": a,
        "to": b,
        "relation": "foobar",
    });
    let resp = handle_link_idea(&ctx, &req, &None).await;

    assert_eq!(resp["ok"], serde_json::json!(false), "expected reject");
    let err = resp["error"].as_str().unwrap_or("");
    assert!(
        err.contains("not writable") || err.contains("foobar"),
        "got: {err}"
    );

    // Edge did NOT land.
    let edges = h.idea_store().idea_edges(&a).await.unwrap();
    assert!(
        edges.links.is_empty(),
        "store must not have picked up the rejected edge: {edges:?}"
    );
}

// ── 3. Add-idea-edge rejects unknown relation (R7b new validation) ─────
//
// R7b added the same guard to `handle_add_idea_edge`, which was the
// one remaining `store_idea_edge` call site that wrote user strings
// without validating. This test locks in the new behaviour so a future
// refactor can't regress it.

#[tokio::test]
async fn add_idea_edge_rejects_unknown_relation() {
    let h = TestHarness::build().await.unwrap();

    let a = h
        .add_idea("edge-a", "body a", &["fact"], None)
        .await
        .unwrap();
    let b = h
        .add_idea("edge-b", "body b", &["fact"], None)
        .await
        .unwrap();

    let ctx = h.ctx();
    let req = serde_json::json!({
        "source_id": a,
        "target_id": b,
        "relation": "not-a-relation",
    });
    let resp = handle_add_idea_edge(&ctx, &req, &None).await;

    assert_eq!(resp["ok"], serde_json::json!(false));
    let err = resp["error"].as_str().unwrap_or("");
    assert!(
        err.contains("not writable") || err.contains("not-a-relation"),
        "error must name the guard: {err}"
    );

    let edges = h.idea_store().idea_edges(&a).await.unwrap();
    assert!(edges.links.is_empty(), "no edge must land: {edges:?}");
}

// Same handler with a substrate-writable relation must succeed. T1.8
// collapsed the legacy typed vocabulary to `mention` / `embed` /
// `link`; `link` is the canonical IPC-side relation.
#[tokio::test]
async fn add_idea_edge_accepts_substrate_relation() {
    let h = TestHarness::build().await.unwrap();

    let a = h.add_idea("ok-a", "body", &["fact"], None).await.unwrap();
    let b = h.add_idea("ok-b", "body", &["fact"], None).await.unwrap();

    let ctx = h.ctx();
    let req = serde_json::json!({
        "source_id": a,
        "target_id": b,
        "relation": "link",
    });
    let resp = handle_add_idea_edge(&ctx, &req, &None).await;
    assert_eq!(resp["ok"], serde_json::json!(true), "got: {resp}");

    let edges = h.idea_store().idea_edges(&a).await.unwrap();
    assert!(
        edges
            .links
            .iter()
            .any(|e| e.other_id == b && e.relation == "link"),
        "edge must persist: {edges:?}"
    );
}

// Adjacent (legacy) must be rejected by the substrate-writability
// guard. Locks in the T1.8 vocabulary collapse.
#[tokio::test]
async fn add_idea_edge_rejects_legacy_adjacent() {
    let h = TestHarness::build().await.unwrap();

    let a = h
        .add_idea("legacy-a", "body", &["fact"], None)
        .await
        .unwrap();
    let b = h
        .add_idea("legacy-b", "body", &["fact"], None)
        .await
        .unwrap();

    let ctx = h.ctx();
    let req = serde_json::json!({
        "source_id": a,
        "target_id": b,
        "relation": "adjacent",
    });
    let resp = handle_add_idea_edge(&ctx, &req, &None).await;
    assert_eq!(resp["ok"], serde_json::json!(false));
    let err = resp["error"].as_str().unwrap_or("");
    assert!(
        err.contains("adjacent") || err.contains("not writable"),
        "T1.8 must reject the retired 'adjacent' relation; got: {err}"
    );
}

// ── 4. Supersede atomicity: `handle_store_idea` keeps the old row intact
//    when the dedup pipeline is offline ─────────────────────────────────
//
// The store writes supersede through `supersede_atomic` which runs in a
// single transaction. This test triggers the `Create` path (not `Supersede`
// — that requires a similarity hit with a score above the supersede
// threshold, driven by an embedder), and then issues a duplicate-name store
// to exercise the active-row short-circuit. The outcome is that the *first*
// row stays active and the second returns `action: "skip"` with the same
// id — there's no "mid-supersede failure" to simulate in the current
// store implementation because the whole thing is wrapped in a transaction.
// What we CAN verify is that the atomic path never leaves the store in a
// half-written state.

#[tokio::test]
async fn duplicate_store_short_circuits_and_does_not_split_active_row() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    // First store via the real IPC handler. Exercises dedup + finalize.
    let req1 = serde_json::json!({
        "name": "atomic/test",
        "content": "first write",
        "tags": ["fact"],
    });
    let resp1 = handle_store_idea(&ctx, &req1, &None).await;
    assert_eq!(resp1["ok"], serde_json::json!(true));
    let id1 = resp1["id"].as_str().unwrap().to_string();

    // Second store with the same name — must short-circuit to `skip` and
    // return the first id (the pre-dedup path at `handle_store_idea:100`).
    let req2 = serde_json::json!({
        "name": "atomic/test",
        "content": "second write attempt",
        "tags": ["fact"],
    });
    let resp2 = handle_store_idea(&ctx, &req2, &None).await;
    assert_eq!(resp2["ok"], serde_json::json!(true));
    assert_eq!(resp2["action"], serde_json::json!("skip"));
    assert_eq!(resp2["id"].as_str().unwrap(), id1);

    // Store invariant: exactly one active row with that name. If a half-
    // finished supersede had left two rows active, `get_active_id_by_name`
    // would return inconsistent results across repeated calls.
    let active1 = h
        .idea_store()
        .get_active_id_by_name("atomic/test", None)
        .await
        .unwrap();
    let active2 = h
        .idea_store()
        .get_active_id_by_name("atomic/test", None)
        .await
        .unwrap();
    assert_eq!(active1, Some(id1.clone()));
    assert_eq!(active1, active2);
}

// ── 5. Threshold dispatch persists consolidator output ─────────────────
//
// End-to-end: seed a `meta:tag-policy` idea that says
// `consolidate_when.count = 2`; fire two stores with that tag via
// `handle_store_idea`; the second write triggers
// `check_consolidation_threshold` which dispatches through the wired
// `PatternDispatcher` (a fake one returning canned JSON); `ideas.store_many`
// persists the canned consolidator output.
//
// This proves the full path IPC → tag policy → threshold count → pattern
// dispatch → seeded event → session.spawn → store_many works in-process
// with a fake LLM. Previously the reflection test covered only the back
// half (PatternDispatcher onward); this stitches the front half in too.

#[tokio::test]
async fn threshold_dispatch_persists_consolidator_output() {
    let h = TestHarness::build().await.unwrap();

    // 1. Seed the tag-policy meta-idea for "test-trigger". A count of 1 is
    //    the smallest legal threshold — the second store fires the event
    //    because the `count_by_tag_since` query includes the row just
    //    written. Age 24h keeps the window wide enough for wall-clock
    //    variance during CI.
    h.add_idea(
        "meta:tag-policy/test-trigger",
        r#"
tag = "test-trigger"
[consolidate_when]
count = 2
age_hours = 24
consolidator_idea = "consolidator/test"
"#,
        &["meta:tag-policy"],
        None,
    )
    .await
    .unwrap();

    // 2. Build a pattern dispatcher that returns canned consolidator JSON.
    //    Mirrors `reflection_roundtrip.rs::build_harness` but stands alone
    //    so the harness ownership is clean.
    let canned = r#"[
        {"name": "consolidated/test-trigger/synthesis",
         "content": "distilled",
         "tags": ["test-trigger", "consolidated"]}
    ]"#;
    let dispatcher = build_canned_dispatcher(
        canned,
        h.registry().clone(),
        h.event_store().clone(),
        h.idea_store().clone(),
    )
    .await;

    let h = h.with_pattern_dispatcher(dispatcher);
    let ctx = h.ctx();

    // 3. Fire two stores with the tag. The second triggers the threshold.
    for i in 0..2 {
        let resp = handle_store_idea(
            &ctx,
            &serde_json::json!({
                "name": format!("rolling/idea-{i}"),
                "content": format!("body {i}"),
                "tags": ["test-trigger"],
            }),
            &None,
        )
        .await;
        assert_eq!(resp["ok"], serde_json::json!(true), "store {i}: {resp}");
    }

    // 4. The consolidator output must have landed in the store with the
    //    source:threshold tag suffix injected by the seeded event.
    let consolidated = h
        .idea_store()
        .get_by_name("consolidated/test-trigger/synthesis", None)
        .await
        .unwrap()
        .expect("consolidator output must be persisted by store_many");
    assert!(consolidated.tags.iter().any(|t| t == "consolidated"));
    assert!(consolidated.tags.iter().any(|t| t == "test-trigger"));
    assert!(
        consolidated
            .tags
            .iter()
            .any(|t| t == "source:threshold:test-trigger"),
        "event tag_suffix must apply: {:?}",
        consolidated.tags
    );
}

// ── 6. Harness construction time — informational ───────────────────────
//
// Rough budget: each `TestHarness::build()` should complete in < 100ms on
// a warm machine. If we ever blow past that it's a signal the harness has
// grown real I/O. This test captures a single measurement and logs it;
// it only *fails* at the 500ms ceiling so CI doesn't flake on cold runs.

#[tokio::test]
async fn harness_build_time_is_reasonable() {
    let start = std::time::Instant::now();
    let _h = TestHarness::build().await.unwrap();
    let elapsed = start.elapsed();

    eprintln!("TestHarness::build elapsed: {:?}", elapsed);
    assert!(
        elapsed < std::time::Duration::from_millis(500),
        "harness build took {elapsed:?} — investigate before raising the ceiling"
    );
}

// ── helpers ────────────────────────────────────────────────────────────

/// Wire an `EventPatternDispatcher` whose `session.spawn` closure returns
/// `canned_json`. Shares the harness's agent registry, event store, and
/// idea store so the seeded events can resolve names and persist.
async fn build_canned_dispatcher(
    canned_json: &'static str,
    agent_registry: Arc<AgentRegistry>,
    event_store: Arc<EventHandlerStore>,
    idea_store: Arc<dyn aeqi_core::traits::IdeaStore>,
) -> Arc<dyn PatternDispatcher> {
    // Seed the lifecycle events on the harness's event store. Idempotent.
    seed_lifecycle_events(&event_store).await.unwrap();

    let spawn_fn: SpawnFn = {
        let canned = canned_json.to_string();
        Arc::new(move |_req: SpawnRequest| {
            let canned = canned.clone();
            Box::pin(async move { Ok(canned) })
        })
    };

    let registry = build_runtime_registry_with_spawn_and_caps(
        Some(idea_store.clone()),
        None,
        Some(spawn_fn),
        true,
    );

    Arc::new(EventPatternDispatcher {
        event_store,
        registry: Arc::new(registry),
        agent_registry,
        session_store: None,
        idea_store: None,
    }) as Arc<dyn PatternDispatcher>
}
