//! Smoke tests for the paymaster HTTP API.
//!
//! These tests spin up the axum router in-process with an in-memory SQLite DB
//! and a known test private key. No bundler, no chain, no external services.
//!
//! Test coverage:
//! - Happy path: entity with budget → 200 with paymasterAndData
//! - Denied path: entity with zero budget → 402 Payment Required
//! - Health check: GET /health → 200

use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use rusqlite::Connection;
use tower::ServiceExt;

use aeqi_paymaster::{AppState, PaymasterSigner, UserOp, db, router};

// Known test private key — Hardhat account #0. Never use in production.
const TEST_PRIVATE_KEY: &str = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Shared sender address for test UserOps.
const TEST_SENDER: &str = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

fn setup_state_with_in_memory_db() -> (AppState, Connection, tempfile::TempDir) {
    // SAFETY: single-threaded test setup; no concurrent env reads.
    unsafe { std::env::set_var("PAYMASTER_PRIVATE_KEY", TEST_PRIVATE_KEY) };
    let signer = Arc::new(PaymasterSigner::from_env().expect("test signer init"));

    // Keep the TempDir alive for the duration of the test so the DB file persists.
    let tmp_dir = tempfile::TempDir::new().expect("temp dir");
    let db_path = tmp_dir.path().join("paymaster_test.db");
    let db_path_str = db_path.to_str().unwrap().to_string();
    let conn = Connection::open(&db_path).expect("open test db");
    db::init_schema(&conn).expect("init schema");

    let state = AppState {
        signer,
        db_path: db_path_str,
        valid_for_secs: 900,
    };
    (state, conn, tmp_dir)
}

fn test_user_op(sender: &str) -> UserOp {
    UserOp {
        sender: sender.to_string(),
        nonce: "0x0".to_string(),
        call_data: "0x".to_string(),
        call_gas_limit: 100_000,
        verification_gas_limit: 150_000,
        pre_verification_gas: 21_000,
        max_fee_per_gas: 1_000_000_000,
        max_priority_fee_per_gas: 100_000_000,
        paymaster_and_data: "0x".to_string(),
        signature: "0x".to_string(),
    }
}

#[tokio::test]
async fn test_sponsor_happy_path() {
    let (state, conn, _tmp) = setup_state_with_in_memory_db();

    // Seed a budget row so the entity is "known".
    let month = chrono::Utc::now().format("%Y-%m").to_string();
    db::get_or_init_budget(&conn, TEST_SENDER, &month).expect("seed budget");
    drop(conn);

    let app = router(state);
    let body = serde_json::to_string(&test_user_op(TEST_SENDER)).unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/paymaster/sponsor")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::OK,
        "expected 200 for entity with budget"
    );

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

    // Response must contain paymasterAndData and signature.
    assert!(
        json["paymasterAndData"]
            .as_str()
            .unwrap_or("")
            .starts_with("0x"),
        "paymasterAndData should be 0x-prefixed hex"
    );
    assert!(
        json["signature"].as_str().unwrap_or("").starts_with("0x"),
        "signature should be 0x-prefixed hex"
    );
    assert!(
        json["validUntil"].as_u64().unwrap_or(0) > 0,
        "validUntil should be non-zero"
    );
}

#[tokio::test]
async fn test_sponsor_denied_when_budget_exhausted() {
    let (state, conn, _tmp) = setup_state_with_in_memory_db();

    let month = chrono::Utc::now().format("%Y-%m").to_string();
    let entity_id = "0xaaaa000000000000000000000000000000000001";

    // Seed and drain budget.
    db::get_or_init_budget(&conn, entity_id, &month).expect("seed budget");
    db::deduct_budget(&conn, entity_id, &month, db::DEFAULT_MONTHLY_BUDGET_WEI)
        .expect("drain budget");
    drop(conn);

    let app = router(state);
    let body = serde_json::to_string(&test_user_op(entity_id)).unwrap();

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/paymaster/sponsor")
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(
        response.status(),
        StatusCode::PAYMENT_REQUIRED,
        "expected 402 for exhausted budget"
    );
}

#[tokio::test]
async fn test_health_check() {
    let (state, _conn, _tmp) = setup_state_with_in_memory_db();
    let app = router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(json["status"], "ok");
}
