//! IPC-level integration tests for the director-inbox flow.
//!
//! Unit-level coverage for the moving parts already exists:
//!   * `SessionStore::set_awaiting / clear_awaiting / list_awaiting / answer_awaiting`
//!     in `session_store.rs::tests` (5 tests, including the multi-director
//!     race and the latent-bug fix for mid-turn injection).
//!   * `QuestionAskTool::execute` in `runtime_tools::question_ask::tests`
//!     (8 tests, including capability gate, prompt validation, subject
//!     truncation).
//!
//! This file exercises the IPC boundary — `handle_inbox` and
//! `handle_answer_inbox` — and verifies they assemble a coherent end-to-end
//! flow with tenancy enforcement on top of the unit-tested primitives.

use aeqi_orchestrator::ipc::inbox::{handle_answer_inbox, handle_inbox};
use aeqi_orchestrator::queue_executor::QueuedMessage;
use aeqi_test_support::TestHarness;

/// Helper: create an agent + a session bound to it. Returns the session_id.
async fn seed_agent_and_session(h: &TestHarness, agent_name: &str) -> (String, String) {
    let agent_id = h.spawn_agent(agent_name).await.unwrap();
    let ctx = h.ctx();
    let ss = ctx.session_store.expect("session store wired");
    let session_id = ss
        .create_session(&agent_id, "session", "test session", None, None)
        .await
        .unwrap();
    (agent_id, session_id)
}

/// `handle_inbox` returns nothing when no session is awaiting.
#[tokio::test]
async fn inbox_empty_when_no_awaiting_sessions() {
    let h = TestHarness::build().await.unwrap();
    let _ = seed_agent_and_session(&h, "alpha").await;

    let resp = handle_inbox(&h.ctx(), &serde_json::json!({}), &None).await;
    assert_eq!(resp["ok"], serde_json::json!(true));
    let items = resp["items"].as_array().unwrap();
    assert!(items.is_empty(), "no awaiting sessions yet → empty list");
}

/// `handle_inbox` surfaces sessions whose `awaiting_at` is set, with the
/// agent name joined in.
#[tokio::test]
async fn inbox_lists_awaiting_sessions_with_agent_name() {
    let h = TestHarness::build().await.unwrap();
    let (_agent_id, session_id) = seed_agent_and_session(&h, "alpha").await;

    let ctx = h.ctx();
    let ss = ctx.session_store.clone().unwrap();
    ss.set_awaiting(&session_id, "approve $200 budget?")
        .await
        .unwrap();

    let resp = handle_inbox(&h.ctx(), &serde_json::json!({}), &None).await;
    let items = resp["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["session_id"], serde_json::json!(session_id));
    assert_eq!(items[0]["agent_name"], serde_json::json!("alpha"));
    assert_eq!(
        items[0]["awaiting_subject"],
        serde_json::json!("approve $200 budget?")
    );
}

/// `handle_answer_inbox` clears `awaiting_at` and enqueues the reply, so
/// the next `handle_inbox` call no longer surfaces it.
#[tokio::test]
async fn answer_inbox_clears_awaiting_and_enqueues_reply() {
    let h = TestHarness::build().await.unwrap();
    let (_agent_id, session_id) = seed_agent_and_session(&h, "alpha").await;
    let ctx = h.ctx();
    let ss = ctx.session_store.clone().unwrap();
    ss.set_awaiting(&session_id, "subj").await.unwrap();

    let resp = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": session_id, "answer": "yes" }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], serde_json::json!(true));

    // Inbox is now empty — the answer cleared the bit.
    let post = handle_inbox(&h.ctx(), &serde_json::json!({}), &None).await;
    assert!(post["items"].as_array().unwrap().is_empty());

    // And exactly one pending row exists, carrying the user's text.
    let claimed = ss
        .claim_pending_for_session(&session_id, None)
        .await
        .unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].content, "yes");
}

/// Two directors race to answer the same session. Exactly one wins; the
/// loser sees a clean error and produces no second pending row.
#[tokio::test]
async fn answer_inbox_first_writer_wins() {
    let h = TestHarness::build().await.unwrap();
    let (_agent_id, session_id) = seed_agent_and_session(&h, "alpha").await;
    let ctx = h.ctx();
    let ss = ctx.session_store.clone().unwrap();
    ss.set_awaiting(&session_id, "subj").await.unwrap();

    let first = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": session_id, "answer": "ship it" }),
        &None,
    )
    .await;
    assert_eq!(first["ok"], serde_json::json!(true));

    let second = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": session_id, "answer": "wait" }),
        &None,
    )
    .await;
    assert_eq!(second["ok"], serde_json::json!(false));
    assert!(
        second["error"]
            .as_str()
            .unwrap_or_default()
            .contains("already answered"),
        "unexpected error message: {second:?}"
    );

    // Only the first answer landed in the queue.
    let claimed = ss
        .claim_pending_for_session(&session_id, None)
        .await
        .unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].content, "ship it");
}

/// Tenancy: a user without `user_access` to the session's root agent gets
/// an empty inbox, and answering returns "access denied".
#[tokio::test]
async fn inbox_tenancy_blocks_unrelated_user() {
    let h = TestHarness::build().await.unwrap();
    // Agent "alpha" has an awaiting session.
    let (_alpha_id, alpha_sid) = seed_agent_and_session(&h, "alpha").await;
    let ctx = h.ctx();
    let ss = ctx.session_store.clone().unwrap();
    ss.set_awaiting(&alpha_sid, "alpha asks").await.unwrap();

    // Caller's allow-list points at a *different* root, "beta".
    let allowed = Some(vec!["beta".to_string()]);

    // List is filtered to nothing.
    let listed = handle_inbox(&h.ctx(), &serde_json::json!({}), &allowed).await;
    assert!(listed["items"].as_array().unwrap().is_empty());

    // Answer is rejected.
    let answered = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": alpha_sid, "answer": "denied" }),
        &allowed,
    )
    .await;
    assert_eq!(answered["ok"], serde_json::json!(false));
    assert!(
        answered["error"]
            .as_str()
            .unwrap_or_default()
            .contains("access"),
        "expected access-denied, got: {answered:?}"
    );

    // No row was inserted.
    let claimed = ss
        .claim_pending_for_session(&alpha_sid, None)
        .await
        .unwrap();
    assert!(claimed.is_empty());
}

/// `answer_inbox` rejects empty/missing fields.
#[tokio::test]
async fn answer_inbox_validates_inputs() {
    let h = TestHarness::build().await.unwrap();
    let (_, session_id) = seed_agent_and_session(&h, "alpha").await;
    let ctx = h.ctx();
    ctx.session_store
        .clone()
        .unwrap()
        .set_awaiting(&session_id, "subj")
        .await
        .unwrap();

    // Missing answer.
    let r1 = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": session_id }),
        &None,
    )
    .await;
    assert_eq!(r1["ok"], serde_json::json!(false));

    // Missing session_id.
    let r2 = handle_answer_inbox(&h.ctx(), &serde_json::json!({ "answer": "yo" }), &None).await;
    assert_eq!(r2["ok"], serde_json::json!(false));

    // Whitespace-only answer.
    let r3 = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": session_id, "answer": "   " }),
        &None,
    )
    .await;
    assert_eq!(r3["ok"], serde_json::json!(false));
}

/// `answer_inbox` returns 404-style error when the session doesn't exist.
#[tokio::test]
async fn answer_inbox_unknown_session_errors() {
    let h = TestHarness::build().await.unwrap();
    let resp = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": "no-such-session", "answer": "yo" }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], serde_json::json!(false));
    assert!(
        resp["error"]
            .as_str()
            .unwrap_or_default()
            .contains("not found"),
        "expected not-found, got: {resp:?}"
    );
}

/// `user_reply` payloads survive a roundtrip through the queue and emerge
/// as clean text via `claim_pending_for_session` (the latent-bug-fix path).
/// This is the integration check that complements the unit test in
/// `session_store.rs::tests::claim_pending_extracts_message_from_queued_payload`.
#[tokio::test]
async fn user_reply_payload_decoded_for_agent_loop() {
    let h = TestHarness::build().await.unwrap();
    let (_, session_id) = seed_agent_and_session(&h, "alpha").await;
    let ctx = h.ctx();
    let ss = ctx.session_store.clone().unwrap();

    let qm = QueuedMessage::user_reply("alpha", "the actual user words", Some("u-1".to_string()));
    let payload = qm.to_payload().unwrap();
    ss.enqueue_pending(&session_id, &payload).await.unwrap();

    let claimed = ss
        .claim_pending_for_session(&session_id, None)
        .await
        .unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(
        claimed[0].content, "the actual user words",
        "the agent loop must see clean text, not the QueuedMessage JSON envelope"
    );
}

/// Two sessions on different agents both awaiting — answering one leaves
/// the other untouched. Sanity check that `set_awaiting` /
/// `answer_awaiting` are scoped to a single session row.
#[tokio::test]
async fn parallel_awaiting_sessions_are_independent() {
    let h = TestHarness::build().await.unwrap();
    let (_a, sid_a) = seed_agent_and_session(&h, "alpha").await;
    let (_b, sid_b) = seed_agent_and_session(&h, "beta").await;
    let ctx = h.ctx();
    let ss = ctx.session_store.clone().unwrap();
    ss.set_awaiting(&sid_a, "subj-a").await.unwrap();
    ss.set_awaiting(&sid_b, "subj-b").await.unwrap();

    // Answer A only.
    let resp = handle_answer_inbox(
        &h.ctx(),
        &serde_json::json!({ "session_id": sid_a, "answer": "ans-a" }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], serde_json::json!(true));

    // B still in the inbox; A is gone.
    let listed = handle_inbox(&h.ctx(), &serde_json::json!({}), &None).await;
    let items = listed["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["session_id"], serde_json::json!(sid_b));
}
