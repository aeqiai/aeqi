use aeqi_orchestrator::agent_registry::EntityViewUpsert;
use aeqi_orchestrator::ipc::entities::{
    handle_create_entity, handle_delete_view, handle_list_views, handle_upsert_views,
};
use aeqi_test_support::TestHarness;

#[tokio::test]
async fn entity_views_upsert_lists_and_updates_without_duplicates() {
    let h = TestHarness::build().await.unwrap();
    let company_id = create_company_company(&h, "Views Co", "user-1").await;

    let views = h
        .registry()
        .upsert_entity_views(
            &company_id,
            Some("user-1"),
            vec![EntityViewUpsert {
                id: None,
                key: "overview".to_string(),
                label: "Overview".to_string(),
                kind: "dashboard".to_string(),
                scope: "private".to_string(),
                path: None,
                search: Some("status:open".to_string()),
                layout_json: Some(serde_json::json!({"widgets": ["agents", "quests"]})),
                pinned: true,
                sort_order: 10,
            }],
        )
        .await
        .unwrap();
    assert_eq!(views.len(), 1);
    let first_id = views[0].id.clone();
    let created_at = views[0].created_at.clone();

    let views = h
        .registry()
        .upsert_entity_views(
            &company_id,
            Some("user-1"),
            vec![EntityViewUpsert {
                id: None,
                key: "overview".to_string(),
                label: "Operating Overview".to_string(),
                kind: "dashboard".to_string(),
                scope: "private".to_string(),
                path: None,
                search: None,
                layout_json: Some(serde_json::json!({"widgets": ["sessions"]})),
                pinned: false,
                sort_order: 2,
            }],
        )
        .await
        .unwrap();

    assert_eq!(views.len(), 1);
    assert_eq!(views[0].id, first_id);
    assert_eq!(views[0].created_at, created_at);
    assert_eq!(views[0].label, "Operating Overview");
    assert_eq!(
        views[0].layout_json,
        Some(serde_json::json!({"widgets": ["sessions"]}))
    );
    assert!(!views[0].pinned);
    assert_eq!(views[0].sort_order, 2);
}

#[tokio::test]
async fn entity_views_owner_scope_isolated_with_public_rows_shared() {
    let h = TestHarness::build().await.unwrap();
    let company_id = create_company_company(&h, "Scoped Views Co", "user-a").await;

    h.registry()
        .upsert_entity_views(
            &company_id,
            Some("user-a"),
            vec![view("overview", "User A", "private", 1)],
        )
        .await
        .unwrap();
    h.registry()
        .upsert_entity_views(
            &company_id,
            Some("user-b"),
            vec![view("overview", "User B", "private", 1)],
        )
        .await
        .unwrap();
    h.registry()
        .upsert_entity_views(
            &company_id,
            Some("user-a"),
            vec![view("public-overview", "Public", "public", 0)],
        )
        .await
        .unwrap();

    let user_a = h
        .registry()
        .list_entity_views(&company_id, Some("user-a"))
        .await
        .unwrap();
    let user_b = h
        .registry()
        .list_entity_views(&company_id, Some("user-b"))
        .await
        .unwrap();

    assert!(user_a.iter().any(|row| row.label == "User A"));
    assert!(!user_a.iter().any(|row| row.label == "User B"));
    assert!(user_a.iter().any(|row| row.label == "Public"));
    assert!(user_b.iter().any(|row| row.label == "User B"));
    assert!(!user_b.iter().any(|row| row.label == "User A"));
    assert!(user_b.iter().any(|row| row.label == "Public"));
}

#[tokio::test]
async fn entity_views_delete_removes_only_matching_owner_view() {
    let h = TestHarness::build().await.unwrap();
    let company_id = create_company_company(&h, "Delete Views Co", "user-a").await;

    h.registry()
        .upsert_entity_views(
            &company_id,
            Some("user-a"),
            vec![view("overview", "User A", "private", 0)],
        )
        .await
        .unwrap();
    h.registry()
        .upsert_entity_views(
            &company_id,
            Some("user-b"),
            vec![view("overview", "User B", "private", 0)],
        )
        .await
        .unwrap();

    let deleted = h
        .registry()
        .delete_entity_view(&company_id, Some("user-a"), "overview")
        .await
        .unwrap();
    assert_eq!(deleted, 1);

    let user_a = h
        .registry()
        .list_entity_views(&company_id, Some("user-a"))
        .await
        .unwrap();
    let user_b = h
        .registry()
        .list_entity_views(&company_id, Some("user-b"))
        .await
        .unwrap();
    assert!(!user_a.iter().any(|row| row.key == "overview"));
    assert!(user_b.iter().any(|row| row.key == "overview"));
}

#[tokio::test]
async fn entity_views_ipc_respects_scope_and_caller_owner() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();
    let company_id = create_company_company(&h, "IPC Views Co", "user-a").await;

    let upsert = handle_upsert_views(
        &ctx,
        &serde_json::json!({
            "company_id": company_id,
            "caller_user_id": "user-a",
            "views": [{"key": "overview", "label": "Overview", "layout_json": {"widgets": ["quests"]}}]
        }),
        &Some(vec![company_id.clone()]),
    )
    .await;
    assert_eq!(upsert["ok"], true);
    assert_eq!(upsert["views"][0]["owner_user_id"], "user-a");

    let listed = handle_list_views(
        &ctx,
        &serde_json::json!({"company_id": company_id, "caller_user_id": "user-a"}),
        &Some(vec![company_id.clone()]),
    )
    .await;
    assert_eq!(listed["ok"], true);
    assert_eq!(listed["views"].as_array().unwrap().len(), 1);

    let denied = handle_list_views(
        &ctx,
        &serde_json::json!({"company_id": company_id}),
        &Some(vec!["other-company".to_string()]),
    )
    .await;
    assert_eq!(denied["ok"], false);
    assert_eq!(denied["code"], "forbidden");

    let deleted = handle_delete_view(
        &ctx,
        &serde_json::json!({"company_id": company_id, "caller_user_id": "user-a", "key": "overview"}),
        &Some(vec![company_id.clone()]),
    )
    .await;
    assert_eq!(deleted["ok"], true);
    assert_eq!(deleted["deleted"], 1);
}

async fn create_company_company(h: &TestHarness, name: &str, caller_user_id: &str) -> String {
    let resp = handle_create_entity(
        &h.ctx(),
        &serde_json::json!({
            "name": name,
            "type": "company",
            "caller_user_id": caller_user_id,
        }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true, "{resp}");
    resp["id"].as_str().unwrap().to_string()
}

fn view(key: &str, label: &str, scope: &str, sort_order: i64) -> EntityViewUpsert {
    EntityViewUpsert {
        id: None,
        key: key.to_string(),
        label: label.to_string(),
        kind: "dashboard".to_string(),
        scope: scope.to_string(),
        path: None,
        search: None,
        layout_json: Some(serde_json::json!({"widgets": ["agents"]})),
        pinned: false,
        sort_order,
    }
}
