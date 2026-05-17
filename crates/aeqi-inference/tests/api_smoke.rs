//! Smoke tests for the aeqi-inference axum router.
//!
//! These tests spin up the router in-process and verify the routing/auth
//! behaviour without touching any real upstream providers.

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;

use aeqi_inference::{
    api::{AppState, create_router},
    billing::subscription::BalanceStore,
    router::Router as InferenceRouter,
};

/// Build a test AppState with no registered providers and an empty balance store.
fn test_state() -> AppState {
    AppState::new(InferenceRouter::new(), BalanceStore::new())
}

/// Build a test AppState where `trust_id = "test-entity"` has 1000 cents balance.
fn test_state_with_balance() -> AppState {
    let store = BalanceStore::new();
    store.set("test-entity", 1000);
    AppState::new(InferenceRouter::new(), store)
}

// ---------------------------------------------------------------------------
// GET /v1/models — must return 200 with model list (no auth required)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn get_models_returns_200() {
    let app = create_router(test_state());

    let req = Request::builder()
        .method("GET")
        .uri("/models")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();

    assert_eq!(json["object"], "list");
    let data = json["data"].as_array().unwrap();
    assert!(!data.is_empty(), "model list should be non-empty");

    // Verify expected model IDs are present.
    // Phase 1: DeepInfra models are live; Anthropic/OpenAI/DeepSeek are stubs.
    let ids: Vec<&str> = data.iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert!(ids.contains(&"gpt-5"), "gpt-5 stub should be in model list");
    assert!(
        ids.contains(&"claude-sonnet-4-6"),
        "claude-sonnet-4-6 stub should be in model list"
    );
    assert!(
        ids.contains(&"deepseek-v4"),
        "deepseek-v4 stub should be in model list"
    );
    assert!(
        ids.contains(&"meta-llama/Meta-Llama-3.1-70B-Instruct"),
        "primary DeepInfra model should be in model list"
    );
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions — unknown model → 400 Bad Request
// ---------------------------------------------------------------------------

#[tokio::test]
async fn chat_completions_unknown_model_returns_400() {
    let state = test_state_with_balance();
    let app = create_router(state);

    let body = serde_json::json!({
        "model": "unknown-model-xyz-99",
        "messages": [{"role": "user", "content": "hello"}]
    });

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        // Provide auth headers so the (stub) middleware passes
        .header("authorization", "Bearer stub-token")
        .header("x-entity", "test-entity")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();

    let response = app.oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::BAD_REQUEST,
        "unknown model should return 400"
    );
}

// ---------------------------------------------------------------------------
// POST /v1/chat/completions — no Authorization header → 401 Unauthorized
//
// The subscription middleware checks that Bearer token is present.
// Without it the request should be rejected before reaching the handler.
//
// NOTE: The subscription middleware is NOT automatically applied in
// `create_router` — it is layered on top by the platform (Wave 4).
// This test exercises the handler's own auth guard path via the
// InferenceError::Auth variant returned when the router has no provider
// and no auth checking at the layer level.
//
// For a full middleware test we exercise it directly below.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn subscription_middleware_rejects_missing_auth() {
    use aeqi_inference::billing::subscription::{BalanceStore, SubscriptionLayer};
    use axum::http::Response;
    use tower::{Layer, ServiceExt};

    // Stand up a minimal tower service that always returns 200
    let store = BalanceStore::new();
    store.set("test-entity", 500);

    let inner = tower::service_fn(|_req: Request<Body>| async {
        Ok::<_, std::convert::Infallible>(Response::new(Body::empty()))
    });

    let service = SubscriptionLayer::new(store).layer(inner);

    // No Authorization header → should get 401
    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("content-type", "application/json")
        .body(Body::empty())
        .unwrap();

    let response = service.oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "missing auth header should yield 401"
    );
}

#[tokio::test]
async fn subscription_middleware_rejects_zero_balance() {
    use aeqi_inference::billing::subscription::{BalanceStore, SubscriptionLayer};
    use axum::http::Response;
    use tower::{Layer, ServiceExt};

    // Entity with zero balance
    let store = BalanceStore::new();
    store.set("broke-entity", 0);

    let inner = tower::service_fn(|_req: Request<Body>| async {
        Ok::<_, std::convert::Infallible>(Response::new(Body::empty()))
    });

    let service = SubscriptionLayer::new(store).layer(inner);

    let req = Request::builder()
        .method("POST")
        .uri("/chat/completions")
        .header("authorization", "Bearer some-token")
        .header("x-entity", "broke-entity")
        .body(Body::empty())
        .unwrap();

    let response = service.oneshot(req).await.unwrap();
    assert_eq!(
        response.status(),
        StatusCode::PAYMENT_REQUIRED,
        "zero balance should yield 402"
    );
}
