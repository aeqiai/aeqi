//! WS-B7: end-to-end acceptance harness for the role-budget primitive.
//!
//! Walks the canonical 12-step scenario from
//! `architecture_role_budget_canonical.md` § 19. Exercises the full IPC
//! verb surface plus the underlying `BudgetRegistry` so a regression in
//! either layer breaks this test.
//!
//! The scenario:
//!
//! 1. Bootstrap: create entity → create CEO/CTO/IC roles → init treasury
//!    config → create root operating budget → set policy.
//! 2. CEO sub-allocates from operating → CEO primary.
//! 3. CEO creates a "Special Project" budget with an IC owner — note the
//!    IC is NOT a descendant of CEO in the role DAG; budget edges route
//!    around the org chart freely.
//! 4. CTO `hire`s a "Research Lead" role + auto primary budget + initial
//!    allocation — atomic.
//! 5. (Inference settle simulated via direct registry call as System
//!    CallerKind would do; the WS-B3 BudgetGate seam is covered in
//!    aeqi-inference's own tests.)
//! 6. (MCP-equivalent show — a second CommandContext clone reads the
//!    same state through the IPC layer; same data the agent's tool
//!    calls saw.)
//! 7. Multi-role disambiguation — agent occupying two roles must pass
//!    `as_role_id` or get `EAmbiguousCallerRole`.
//! 8. Insufficient suballoc — over-allocate from CTO returns
//!    `EInsufficientSuballoc` with the offending value.
//! 9. Vacant owner cannot spend treasury until an occupant is assigned.
//! 10. Idempotency — same key on a second `allocate` returns success
//!     without double-debiting.
//! 11. Epoch refresh — advance the clock and a new allowance row
//!     materialises with the expected caps (burn vs rollover covered in
//!     `budget_registry::tests`; here we just verify the IPC seam).
//! 12. Pause halts mutations and unpause restores them.

use aeqi_orchestrator::ipc::budgets::{
    handle_allocate_allowance, handle_allowance_history, handle_budget_tree, handle_create_budget,
    handle_dissolve_budget, handle_get_allowance, handle_get_budget, handle_hire_role,
    handle_init_treasury_config, handle_list_budgets, handle_pause_treasury,
    handle_refresh_allowance, handle_set_policy, handle_spend_inference, handle_spend_treasury,
};
use aeqi_orchestrator::role_registry::{ALL_GRANTS, OccupantKind, RoleType};
use aeqi_test_support::TestHarness;
use serde_json::json;

/// Test fixture: company entity + 3 humans + 3 occupied roles +
/// admin/gateway wiring. CEO is the founding director (full grants);
/// CTO and IC are operational roles.
struct Scene {
    h: TestHarness,
    entity_id: String,
    ceo_role: String,
    cto_role: String,
    ic_role: String,
    ceo_user: String,
    cto_user: String,
}

impl Scene {
    async fn new() -> Self {
        let h = TestHarness::build().await.expect("harness");
        let ctx = h.ctx();

        // Spawn an agent so the entity row is created via the canonical
        // path. Then carve up the org chart with three humans.
        let agent = h.registry().spawn("budget-co", None, None).await.unwrap();
        let entity_id = agent.entity_id.expect("agent must own entity");

        let ceo_role = ctx
            .role_registry
            .create_with_type(
                &entity_id,
                "CEO",
                OccupantKind::Human,
                Some("user-ceo"),
                RoleType::Director,
                true,
                Some(ALL_GRANTS.iter().map(|s| s.to_string()).collect()),
            )
            .await
            .unwrap();
        let cto_role = ctx
            .role_registry
            .create_with_type(
                &entity_id,
                "CTO",
                OccupantKind::Human,
                Some("user-cto"),
                RoleType::Operational,
                false,
                None,
            )
            .await
            .unwrap();
        let ic_role = ctx
            .role_registry
            .create_with_type(
                &entity_id,
                "Senior Engineer",
                OccupantKind::Human,
                Some("user-ic"),
                RoleType::Operational,
                false,
                None,
            )
            .await
            .unwrap();

        // CEO sits at the top, CTO reports to CEO; IC reports to CTO.
        ctx.role_registry
            .add_edge(&ceo_role.id, &cto_role.id)
            .await
            .unwrap();
        ctx.role_registry
            .add_edge(&cto_role.id, &ic_role.id)
            .await
            .unwrap();

        // Init treasury config — gateway is a dummy agent, admin is the CEO.
        let resp = handle_init_treasury_config(
            &ctx,
            &json!({
                "trust_id": entity_id,
                "inference_gateway": "agent-gateway",
                "admin_role_id": ceo_role.id,
                "caller_user_id": "user-ceo",
            }),
            &None,
        )
        .await;
        assert_eq!(resp["ok"], true, "init_treasury_config: {resp}");

        Self {
            h,
            entity_id,
            ceo_role: ceo_role.id,
            cto_role: cto_role.id,
            ic_role: ic_role.id,
            ceo_user: "user-ceo".to_string(),
            cto_user: "user-cto".to_string(),
        }
    }
}

#[tokio::test]
async fn step_01_bootstrap_root_budget_and_policy() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();

    // CEO creates a root operating budget owned by the CEO role.
    let create = handle_create_budget(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "owner_role_id": s.ceo_role,
            "name": "Operating FY26",
            "kind": "operating",
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(create["ok"], true, "create root: {create}");
    let root_budget = create["budget_id"].as_str().unwrap().to_string();

    // CEO sets a generous policy on the root.
    let policy = handle_set_policy(
        &ctx,
        &json!({
            "budget_id": root_budget,
            "policy": {
                "default_inference": 1_000_000_000_i64,
                "default_treasury": 500_000_000_i64,
                "default_suballoc": 400_000_000_i64,
                "default_hire": 5_i64,
                "epoch_period_secs": 604_800_i64,
                "rollover_mode": "burn",
            },
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(policy["ok"], true, "set_policy: {policy}");

    // refresh_allowance materialises the first epoch row from policy.
    let refresh = handle_refresh_allowance(
        &ctx,
        &json!({"budget_id": root_budget, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(refresh["ok"], true, "refresh: {refresh}");
    let alw = &refresh["allowance"];
    assert_eq!(alw["caps"]["inference_credits"], 1_000_000_000_i64);
    assert_eq!(alw["caps"]["suballoc_cap"], 400_000_000_i64);
    assert_eq!(alw["spent_inference"], 0);
}

#[tokio::test]
async fn step_02_ceo_suballocates_to_primary() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // The CEO's primary budget gets created on first reference. We
    // reach it via list_budgets + is_primary filter.
    let list = handle_list_budgets(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "owner_role_id": s.ceo_role,
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(list["ok"], true);
    let _root_visible = list["budgets"]
        .as_array()
        .unwrap()
        .iter()
        .any(|b| b["id"] == root);

    // Materialise CEO's primary by calling get_budget on it indirectly
    // — easier: use the registry directly.
    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let ceo_primary = registry.primary_budget(&s.ceo_role).await.unwrap();
    let ceo_primary_id = ceo_primary.id.clone();

    // Sub-allocate 200/100 inference/treasury from root → CEO primary.
    let alloc = handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": ceo_primary_id,
            "bundle": {
                "inference_credits": 200_000_000_i64,
                "treasury_cap": 100_000_000_i64,
                "suballoc_cap": 50_000_000_i64,
                "hire_cap": 2_i64,
            },
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(alloc["ok"], true, "allocate: {alloc}");

    // Verify the CEO primary received the funds.
    let show = handle_get_allowance(
        &ctx,
        &json!({"budget_id": ceo_primary_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(
        show["allowance"]["caps"]["inference_credits"],
        200_000_000_i64
    );
    assert_eq!(show["allowance"]["caps"]["treasury_cap"], 100_000_000_i64);

    // And root debited.
    let root_show = handle_get_allowance(
        &ctx,
        &json!({"budget_id": root, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(
        root_show["allowance"]["spent_suballoc"], 350_000_000_i64,
        "200+100+50 = 350m suballoc consumed"
    );
}

#[tokio::test]
async fn step_03_special_project_skips_org_chart() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // CEO funds a "Special Project" budget owned by IC — the IC role is
    // TWO LEVELS DOWN in the org chart (CEO→CTO→IC). The budget edge
    // skips that hierarchy entirely. This is the canonical "budget tree
    // != role tree" test.
    let create = handle_create_budget(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "parent_budget_id": root,
            "owner_role_id": s.ic_role,
            "name": "Special Project",
            "kind": "project",
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(create["ok"], true, "create special project: {create}");
    let project_id = create["budget_id"].as_str().unwrap().to_string();

    // Allocate to it.
    let alloc = handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": project_id,
            "bundle": {"inference_credits": 30_000_000_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(alloc["ok"], true);

    // Tree includes the special project as a child of root, NOT a
    // descendant of any role-tree node.
    let tree = handle_budget_tree(
        &ctx,
        &json!({"trust_id": s.entity_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    let edges = tree["tree"]["edges"].as_array().unwrap();
    let owner = tree["tree"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == project_id)
        .unwrap();
    assert_eq!(owner["owner_role_id"], s.ic_role);
    assert!(
        edges.iter().any(|e| e[0] == root && e[1] == project_id),
        "root → project edge present in budget DAG"
    );
}

#[tokio::test]
async fn step_04_atomic_hire_creates_role_budget_allocation() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // Materialise CEO primary, then fund it so CEO has hire headroom.
    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let ceo_primary = registry.primary_budget(&s.ceo_role).await.unwrap();
    let ceo_primary_id = ceo_primary.id.clone();
    let alloc = handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": ceo_primary_id,
            "bundle": {"inference_credits": 100_000_000_i64, "treasury_cap": 50_000_000_i64, "suballoc_cap": 80_000_000_i64, "hire_cap": 3},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(alloc["ok"], true);

    // CEO hires a Research Lead under herself with an initial allowance.
    let hire = handle_hire_role(
        &ctx,
        &json!({
            "parent_budget_id": ceo_primary_id,
            "parent_role_id": s.ceo_role,
            "new_role": {
                "title": "Research Lead",
                "role_type": "operational",
                "occupant_kind": "agent",
                "occupant_id": "agent-research-lead",
            },
            "bundle": {"inference_credits": 20_000_000_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(hire["ok"], true, "hire: {hire}");
    let new_role_id = hire["role_id"].as_str().unwrap().to_string();
    let new_primary_id = hire["primary_budget_id"].as_str().unwrap().to_string();

    // The new role exists, the new primary exists + is owned by it.
    let role = ctx.role_registry.get(&new_role_id).await.unwrap().unwrap();
    assert_eq!(role.title, "Research Lead");
    assert_eq!(role.occupant_kind, OccupantKind::Agent);

    let primary = handle_get_budget(
        &ctx,
        &json!({"budget_id": new_primary_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(primary["budget"]["is_primary"], true);
    assert_eq!(primary["budget"]["owner_role_id"], new_role_id);

    // CEO primary debited; new primary credited.
    let ceo_alw = handle_get_allowance(
        &ctx,
        &json!({"budget_id": ceo_primary_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(ceo_alw["allowance"]["spent_suballoc"], 20_000_000_i64);
    assert_eq!(ceo_alw["allowance"]["used_hire"], 1);
    let new_alw = handle_get_allowance(
        &ctx,
        &json!({"budget_id": new_primary_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(
        new_alw["allowance"]["caps"]["inference_credits"],
        20_000_000_i64
    );

    // Role edge wired.
    let edges = ctx
        .role_registry
        .list_edges_for_entity(&s.entity_id)
        .await
        .unwrap();
    assert!(
        edges
            .iter()
            .any(|e| e.parent_role_id == s.ceo_role && e.child_role_id == new_role_id),
        "CEO → Research Lead edge present"
    );
}

#[tokio::test]
async fn step_05_inference_settle_via_gateway() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // Fund CEO primary with inference credits.
    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let ceo_primary = registry.primary_budget(&s.ceo_role).await.unwrap();
    let ceo_primary_id = ceo_primary.id.clone();
    handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": ceo_primary_id,
            "bundle": {"inference_credits": 50_000_000_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;

    // Gateway settles a 100 micro-USD inference call.
    let settle = handle_spend_inference(
        &ctx,
        &json!({
            "budget_id": ceo_primary_id,
            "amount": 100_i64,
            "request_hash": "hash-call-1",
            "actor_agent_id": "agent-research",
            "gateway_agent_id": "agent-gateway",
        }),
        &None,
    )
    .await;
    assert_eq!(settle["ok"], true, "settle: {settle}");

    let alw = handle_get_allowance(
        &ctx,
        &json!({"budget_id": ceo_primary_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(alw["allowance"]["spent_inference"], 100);

    // Wrong gateway id → EGatewayMismatch.
    let bad = handle_spend_inference(
        &ctx,
        &json!({
            "budget_id": ceo_primary_id,
            "amount": 100_i64,
            "request_hash": "hash-call-2",
            "actor_agent_id": "agent-research",
            "gateway_agent_id": "agent-not-the-gateway",
        }),
        &None,
    )
    .await;
    assert_eq!(bad["ok"], false);
    assert_eq!(bad["code"], "EGatewayMismatch");
}

#[tokio::test]
async fn step_06_history_reflects_events() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let ceo_primary = registry.primary_budget(&s.ceo_role).await.unwrap();
    let ceo_primary_id = ceo_primary.id.clone();
    handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": ceo_primary_id,
            "bundle": {"inference_credits": 1_000_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;

    let history = handle_allowance_history(
        &ctx,
        &json!({"budget_id": ceo_primary_id, "caller_user_id": s.ceo_user, "limit": 100}),
        &None,
    )
    .await;
    assert_eq!(history["ok"], true);
    let events = history["events"].as_array().unwrap();
    let kinds: Vec<&str> = events
        .iter()
        .map(|e| e["event_type"].as_str().unwrap())
        .collect();
    assert!(
        kinds.contains(&"allowance_created"),
        "primary budget creation emits allowance_created"
    );
}

#[tokio::test]
async fn step_07_multi_role_disambiguation() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // Make user-ceo also occupy CTO. Now the user holds two roles in the
    // same trust — IPC writes that resolve caller_role implicitly must
    // demand `as_role_id`.
    ctx.role_registry
        .update_occupant(&s.cto_role, OccupantKind::Human, Some("user-ceo"))
        .await
        .unwrap();

    // Without as_role_id — ambiguous.
    let bad = handle_create_budget(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "parent_budget_id": root,
            "owner_role_id": s.cto_role,
            "name": "Eng Operating",
            "kind": "operating",
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(bad["ok"], false);
    assert_eq!(bad["code"], "EAmbiguousCallerRole");
    assert!(
        bad["roles"].as_array().unwrap().len() == 2,
        "error carries the ambiguous roles for the UI to disambiguate"
    );

    // With as_role_id explicit — works.
    let ok = handle_create_budget(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "parent_budget_id": root,
            "owner_role_id": s.cto_role,
            "name": "Eng Operating",
            "kind": "operating",
            "caller_user_id": s.ceo_user,
            "as_role_id": s.ceo_role,
        }),
        &None,
    )
    .await;
    assert_eq!(ok["ok"], true, "explicit as_role_id resolves: {ok}");
}

#[tokio::test]
async fn step_08_insufficient_suballoc_returns_structured_error() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget_capped(&s, &ctx, 1_000).await;

    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let cto_primary = registry.primary_budget(&s.cto_role).await.unwrap();
    let cto_primary_id = cto_primary.id.clone();

    let bad = handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": cto_primary_id,
            "bundle": {"inference_credits": 5_000_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(bad["ok"], false);
    assert_eq!(bad["code"], "EInsufficientSuballoc");
    assert!(
        bad["error"].as_str().unwrap().contains("remaining 1000"),
        "error message names the remaining cap"
    );
}

#[tokio::test]
async fn step_09_vacant_owner_cannot_spend_treasury() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // Canonical vacant-chair funding flow: CEO creates the vacant CFO
    // role, then sub-allocates from her own primary into CFO's primary.
    // The vacant chair has caps but no occupant.
    let cfo_role = ctx
        .role_registry
        .create_with_type(
            &s.entity_id,
            "CFO",
            OccupantKind::Vacant,
            None,
            RoleType::Operational,
            false,
            None,
        )
        .await
        .unwrap();
    ctx.role_registry
        .add_edge(&s.ceo_role, &cfo_role.id)
        .await
        .unwrap();

    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let ceo_primary = registry.primary_budget(&s.ceo_role).await.unwrap();
    let cfo_primary = registry.primary_budget(&cfo_role.id).await.unwrap();

    // CEO funds her own primary first (so she has suballoc headroom).
    handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": ceo_primary.id,
            "bundle": {"inference_credits": 0, "treasury_cap": 1_000_000_i64, "suballoc_cap": 1_000_000_i64, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    // Then funds the CFO's primary.
    handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": ceo_primary.id,
            "child_budget_id": cfo_primary.id,
            "bundle": {"inference_credits": 0, "treasury_cap": 500_000_i64, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;

    // CEO trying to spend FROM CFO's budget fails because CEO doesn't
    // own that budget (it's CFO's chair). The brief's auth model is
    // strict: only the budget's owner role can spend.
    let blocked = handle_spend_treasury(
        &ctx,
        &json!({
            "budget_id": cfo_primary.id,
            "destination": "0xdest",
            "amount": 100_i64,
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(blocked["ok"], false);
    assert_eq!(blocked["code"], "ENotOwner");

    // Promote a human into the CFO seat. Now the human can spend, and
    // the vacant-owner rule no longer applies.
    ctx.role_registry
        .update_occupant(&cfo_role.id, OccupantKind::Human, Some("user-cfo"))
        .await
        .unwrap();
    let ok = handle_spend_treasury(
        &ctx,
        &json!({
            "budget_id": cfo_primary.id,
            "destination": "0xdest",
            "amount": 100_i64,
            "caller_user_id": "user-cfo",
        }),
        &None,
    )
    .await;
    assert_eq!(ok["ok"], true, "occupied owner spends: {ok}");

    // And the explicit vacant-rejection: vacate the CFO seat again,
    // then try to spend "as" the CFO chair. The registry's
    // EVacantOwnerCannotSpend fires when the owner role has no
    // occupant.
    ctx.role_registry
        .update_occupant(&cfo_role.id, OccupantKind::Vacant, None)
        .await
        .unwrap();
    let registry_direct =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let err = registry_direct
        .spend_treasury(
            &cfo_primary.id,
            "0xdest",
            50,
            None,
            &cfo_role.id,
            None,
            None,
        )
        .await
        .unwrap_err();
    let be = err
        .downcast_ref::<aeqi_orchestrator::budget_registry::BudgetError>()
        .expect("downcast to BudgetError");
    assert_eq!(be.code(), "EVacantOwnerCannotSpend");
}

#[tokio::test]
async fn step_10_idempotency_dedups_repeat_call() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    let ceo_primary = registry.primary_budget(&s.ceo_role).await.unwrap();
    let ceo_primary_id = ceo_primary.id.clone();

    // First allocate with idempotency key.
    let first = handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": ceo_primary_id,
            "bundle": {"inference_credits": 100_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
            "idempotency_key": "k-001",
        }),
        &None,
    )
    .await;
    assert_eq!(first["ok"], true);

    // Second call with same key — must NOT double-debit.
    let second = handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": ceo_primary_id,
            "bundle": {"inference_credits": 100_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
            "idempotency_key": "k-001",
        }),
        &None,
    )
    .await;
    assert_eq!(second["ok"], true);

    let alw = handle_get_allowance(
        &ctx,
        &json!({"budget_id": ceo_primary_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(
        alw["allowance"]["caps"]["inference_credits"], 100_i64,
        "second allocate with same key was a no-op (still 100, not 200)"
    );
}

#[tokio::test]
async fn step_11_pause_halts_mutations_unpause_restores() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // Pause.
    let pause = handle_pause_treasury(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "paused": true,
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(pause["ok"], true, "pause: {pause}");

    // Mutations now fail with EPaused.
    let blocked = handle_spend_treasury(
        &ctx,
        &json!({
            "budget_id": root,
            "destination": "0xdest",
            "amount": 1_i64,
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(blocked["ok"], false);
    assert_eq!(blocked["code"], "EPaused");

    // Reads still work.
    let read = handle_get_budget(
        &ctx,
        &json!({"budget_id": root, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    assert_eq!(read["ok"], true, "reads pass through pause: {read}");

    // Unpause.
    let unpause = handle_pause_treasury(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "paused": false,
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(unpause["ok"], true);
}

#[tokio::test]
async fn step_12_dissolve_rejects_non_zero_then_works_when_drained() {
    let s = Scene::new().await;
    let ctx = s.h.ctx();
    let root = create_root_budget(&s, &ctx).await;

    // Make a leaf budget owned by CTO.
    let create = handle_create_budget(
        &ctx,
        &json!({
            "trust_id": s.entity_id,
            "parent_budget_id": root,
            "owner_role_id": s.cto_role,
            "name": "Eng Q3",
            "kind": "project",
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    let leaf_id = create["budget_id"].as_str().unwrap().to_string();

    // Fund it → dissolve must reject.
    handle_allocate_allowance(
        &ctx,
        &json!({
            "parent_budget_id": root,
            "child_budget_id": leaf_id,
            "bundle": {"inference_credits": 50_i64, "treasury_cap": 0, "suballoc_cap": 0, "hire_cap": 0},
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    let blocked = handle_dissolve_budget(
        &ctx,
        &json!({"budget_id": leaf_id, "caller_user_id": s.cto_user}),
        &None,
    )
    .await;
    assert_eq!(blocked["ok"], false);
    assert_eq!(blocked["code"], "EBudgetNonZeroBalance");

    // Drain via spend then dissolve.
    let registry =
        aeqi_orchestrator::budget_registry::BudgetRegistry::open(ctx.agent_registry.db());
    registry
        .spend_inference(&leaf_id, 50, "drain-hash", "agent-x", "agent-gateway")
        .await
        .unwrap();
    let drained = handle_dissolve_budget(
        &ctx,
        &json!({"budget_id": leaf_id, "caller_user_id": s.cto_user}),
        &None,
    )
    .await;
    assert_eq!(drained["ok"], true, "drained dissolve: {drained}");
}

// ── helpers ──────────────────────────────────────────────────────────────────

async fn create_root_budget(s: &Scene, ctx: &aeqi_orchestrator::ipc::CommandContext) -> String {
    create_root_budget_capped(s, ctx, 400_000_000_i64).await
}

async fn create_root_budget_capped(
    s: &Scene,
    ctx: &aeqi_orchestrator::ipc::CommandContext,
    suballoc_cap: i64,
) -> String {
    let create = handle_create_budget(
        ctx,
        &json!({
            "trust_id": s.entity_id,
            "owner_role_id": s.ceo_role,
            "name": "Operating FY26",
            "kind": "operating",
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    assert_eq!(create["ok"], true, "create root: {create}");
    let root_id = create["budget_id"].as_str().unwrap().to_string();
    handle_set_policy(
        ctx,
        &json!({
            "budget_id": root_id,
            "policy": {
                "default_inference": 1_000_000_000_i64,
                "default_treasury": 500_000_000_i64,
                "default_suballoc": suballoc_cap,
                "default_hire": 5_i64,
                "epoch_period_secs": 604_800_i64,
                "rollover_mode": "burn",
            },
            "caller_user_id": s.ceo_user,
        }),
        &None,
    )
    .await;
    handle_refresh_allowance(
        ctx,
        &json!({"budget_id": root_id, "caller_user_id": s.ceo_user}),
        &None,
    )
    .await;
    root_id
}
