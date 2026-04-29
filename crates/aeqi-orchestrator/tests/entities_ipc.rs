//! IPC-level integration tests for the entity primitive (Phase A).
//!
//! Uses `aeqi-test-support::TestHarness` for the full `CommandContext`
//! construction so the handler layer (including tenancy filtering and
//! quest count roll-up) is exercised end-to-end.

use aeqi_orchestrator::ipc::entities::{
    handle_create_entity, handle_delete_entity, handle_entities, handle_update_entity,
};
use aeqi_test_support::TestHarness;

// ── handle_entities ──────────────────────────────────────────────────────────

#[tokio::test]
async fn entities_returns_roots_envelope() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    // Spawn a root agent — triggers entity row creation.
    h.registry().spawn("acme", None, None).await.unwrap();

    let resp = handle_entities(&ctx, &serde_json::Value::Null, &None).await;
    assert_eq!(resp["ok"], true);
    let roots = resp["roots"].as_array().unwrap();
    assert!(!roots.is_empty(), "roots array must not be empty");

    let first = &roots[0];
    // Legacy fields.
    assert!(first.get("id").is_some());
    assert!(first.get("name").is_some());
    assert!(first.get("open_tasks").is_some());
    assert!(first.get("total_tasks").is_some());
    // New fields.
    assert!(first.get("type").is_some());
    assert!(first.get("slug").is_some());
    assert_eq!(first["type"], "company");
}

#[tokio::test]
async fn entities_scope_filtering() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let a1 = h.registry().spawn("allowed-co", None, None).await.unwrap();
    let _a2 = h.registry().spawn("denied-co", None, None).await.unwrap();

    let entity_id_a1 = a1.entity_id.expect("agent must own an entity");
    let allowed = Some(vec![entity_id_a1.clone()]);
    let resp = handle_entities(&ctx, &serde_json::Value::Null, &allowed).await;
    let roots = resp["roots"].as_array().unwrap();
    assert_eq!(roots.len(), 1, "scope must filter to exactly one entity");
    assert_eq!(roots[0]["id"], entity_id_a1);
}

// ── handle_create_entity ─────────────────────────────────────────────────────

#[tokio::test]
async fn create_entity_invalid_name_rejected() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let cases = [
        serde_json::json!({"name": ""}),
        serde_json::json!({"name": "bad/name"}),
        serde_json::json!({"name": "bad\\name"}),
        serde_json::json!({"name": ".hidden"}),
    ];
    for req in &cases {
        let resp = handle_create_entity(&ctx, req, &None).await;
        assert_eq!(resp["ok"], false, "case {req} must fail");
    }
}

#[tokio::test]
async fn create_entity_company_creates_agent() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let resp = handle_create_entity(
        &ctx,
        &serde_json::json!({"name": "newco", "type": "company"}),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true);
    let entity_id = resp["id"].as_str().unwrap();

    // Entity row exists.
    let entity = ctx.entity_registry.get(entity_id).await.unwrap();
    assert!(entity.is_some(), "entity row must exist after create");

    // Backing agent exists with a fresh UUID (distinct from the entity id).
    let backing_agents = h.registry().list(Some(entity_id), None).await.unwrap();
    assert_eq!(
        backing_agents.len(),
        1,
        "exactly one backing agent must own the new company"
    );
    assert_ne!(
        backing_agents[0].id, entity_id,
        "backing agent UUID must be distinct from the entity UUID"
    );
}

#[tokio::test]
async fn create_entity_non_company_no_agent() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let resp = handle_create_entity(
        &ctx,
        &serde_json::json!({"name": "test-fund", "type": "fund"}),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true);
    let entity_id = resp["id"].as_str().unwrap();

    // Entity row exists.
    let entity = ctx.entity_registry.get(entity_id).await.unwrap();
    assert!(entity.is_some());

    // No backing agent for non-company type.
    let backing = h.registry().list(Some(entity_id), None).await.unwrap();
    assert!(
        backing.is_empty(),
        "non-company entity must NOT spawn a backing agent"
    );
}

// ── handle_update_entity ─────────────────────────────────────────────────────

#[tokio::test]
async fn update_entity_renames_name_and_slug() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let agent = h.registry().spawn("old-co", None, None).await.unwrap();
    let entity_id = agent.entity_id.clone().expect("agent must own an entity");

    let resp = handle_update_entity(
        &ctx,
        &serde_json::json!({"id": entity_id, "new_name": "new-co", "new_slug": "new-co"}),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true);

    let entity = ctx.entity_registry.get(&entity_id).await.unwrap().unwrap();
    assert_eq!(entity.name, "new-co");
    assert_eq!(entity.slug, "new-co");
}

#[tokio::test]
async fn update_entity_requires_new_name_or_slug() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let agent = h.registry().spawn("some-co", None, None).await.unwrap();
    let entity_id = agent.entity_id.clone().expect("agent must own an entity");
    let resp = handle_update_entity(&ctx, &serde_json::json!({"id": entity_id}), &None).await;
    assert_eq!(resp["ok"], false);
}

#[tokio::test]
async fn update_entity_access_denied_when_scoped() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let agent = h.registry().spawn("secret-co", None, None).await.unwrap();
    let entity_id = agent.entity_id.clone().expect("agent must own an entity");
    let allowed = Some(vec!["some-other-id".to_string()]);
    let resp = handle_update_entity(
        &ctx,
        &serde_json::json!({"id": entity_id, "new_name": "hacked"}),
        &allowed,
    )
    .await;
    assert_eq!(resp["ok"], false);
    assert_eq!(resp["error"], "access denied");
}

// ── handle_delete_entity ─────────────────────────────────────────────────────

#[tokio::test]
async fn delete_entity_not_found() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let resp =
        handle_delete_entity(&ctx, &serde_json::json!({"id": "no-such-entity"}), &None).await;
    assert_eq!(resp["ok"], false);
}

#[tokio::test]
async fn delete_entity_success() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    // Create a non-company entity (no backing agent, simpler teardown).
    let create_resp = handle_create_entity(
        &ctx,
        &serde_json::json!({"name": "disposable-fund", "type": "fund"}),
        &None,
    )
    .await;
    assert_eq!(create_resp["ok"], true);
    let id = create_resp["id"].as_str().unwrap();

    let del_resp = handle_delete_entity(&ctx, &serde_json::json!({"id": id}), &None).await;
    assert_eq!(del_resp["ok"], true);

    let entity = ctx.entity_registry.get(id).await.unwrap();
    assert!(entity.is_none(), "entity must be gone after delete");
}
