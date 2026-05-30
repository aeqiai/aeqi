use aeqi_orchestrator::ipc::blueprints::handle_spawn_blueprint;
use aeqi_orchestrator::ipc::entities::{handle_create_entity, handle_list_cap_table_entries};
use aeqi_test_support::TestHarness;

#[tokio::test]
async fn personal_cap_table_defaults_seed_creator_common() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let resp = handle_create_entity(
        &ctx,
        &serde_json::json!({
            "name": "Ada Personal Trust",
            "personal_trust": true,
            "caller_user_id": "user-ada",
        }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true);
    let trust_id = resp["id"].as_str().unwrap();

    let rows = h.registry().list_cap_table_entries(trust_id).await.unwrap();
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(row.allocation_key, "creator_common");
    assert_eq!(row.holder_kind, "creator");
    assert_eq!(row.holder_id.as_deref(), Some("user-ada"));
    assert_eq!(row.security_type, "common");
    assert_eq!(row.basis_points, 10_000);
    assert_eq!(row.vesting_months, None);
    assert_eq!(row.cliff_months, None);
}

#[tokio::test]
async fn company_cap_table_defaults_seed_founder_and_option_pool() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let resp = handle_create_entity(
        &ctx,
        &serde_json::json!({
            "name": "NewCo",
            "type": "company",
            "caller_user_id": "user-founder",
        }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true);
    let trust_id = resp["id"].as_str().unwrap();

    assert_company_cap_table_defaults(&h, trust_id, Some("user-founder")).await;
}

#[tokio::test]
async fn blueprint_cap_table_defaults_seed_founder_and_option_pool() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let resp = handle_spawn_blueprint(
        &ctx,
        &serde_json::json!({
            "creator_user_id": "user-founder",
            "trust_id": "trust-blueprint-1",
            "display_name": "Launch Co",
            "inline_blueprint": {
                "slug": "launch-co",
                "name": "Launch Co",
                "tagline": "Fixture",
                "description": "Fixture blueprint",
                "category": "company",
                "template": "company",
                "root": {
                    "name": "Director",
                    "model": null,
                    "color": null,
                    "avatar": null,
                    "system_prompt": null,
                    "proactive_greeting": null,
                    "seed_messages": []
                },
                "seed_agents": [],
                "agent_template_refs": [],
                "seed_views": [],
                "seed_events": [],
                "seed_ideas": [],
                "seed_quests": [],
                "seed_roles": [],
                "seed_role_edges": []
            }
        }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true, "{resp}");

    assert_company_cap_table_defaults(&h, "trust-blueprint-1", Some("user-founder")).await;
}

#[tokio::test]
async fn list_cap_table_entries_respects_scope() {
    let h = TestHarness::build().await.unwrap();
    let ctx = h.ctx();

    let resp = handle_create_entity(
        &ctx,
        &serde_json::json!({
            "name": "Scoped Co",
            "type": "company",
            "caller_user_id": "user-founder",
        }),
        &None,
    )
    .await;
    assert_eq!(resp["ok"], true);
    let trust_id = resp["id"].as_str().unwrap();

    let allowed = Some(vec![trust_id.to_string()]);
    let listed =
        handle_list_cap_table_entries(&ctx, &serde_json::json!({"trust_id": trust_id}), &allowed)
            .await;
    assert_eq!(listed["ok"], true);
    assert_eq!(listed["entries"].as_array().unwrap().len(), 2);

    let denied = handle_list_cap_table_entries(
        &ctx,
        &serde_json::json!({"trust_id": trust_id}),
        &Some(vec!["other-trust".to_string()]),
    )
    .await;
    assert_eq!(denied["ok"], false);
    assert_eq!(denied["code"], "forbidden");
    assert_eq!(denied["error"], "access denied");
}

async fn assert_company_cap_table_defaults(
    h: &TestHarness,
    trust_id: &str,
    creator_user_id: Option<&str>,
) {
    let rows = h.registry().list_cap_table_entries(trust_id).await.unwrap();
    assert_eq!(rows.len(), 2);

    let founder = rows
        .iter()
        .find(|row| row.allocation_key == "founder_vesting_common")
        .expect("founder row");
    assert_eq!(founder.holder_kind, "creator");
    assert_eq!(founder.holder_id.as_deref(), creator_user_id);
    assert_eq!(founder.security_type, "vesting_common");
    assert_eq!(founder.basis_points, 8_000);
    assert_eq!(founder.vesting_months, Some(48));
    assert_eq!(founder.cliff_months, Some(12));

    let pool = rows
        .iter()
        .find(|row| row.allocation_key == "option_pool")
        .expect("option pool row");
    assert_eq!(pool.holder_kind, "unassigned");
    assert_eq!(pool.holder_id, None);
    assert_eq!(pool.security_type, "option_pool");
    assert_eq!(pool.basis_points, 2_000);
    assert_eq!(pool.vesting_months, None);
    assert_eq!(pool.cliff_months, None);
}
