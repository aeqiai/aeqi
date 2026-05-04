//! axum HTTP router for the paymaster service.
//!
//! ## Endpoints
//!
//! ### `POST /paymaster/sponsor`
//!
//! Request body: [`UserOp`] JSON (the packed UserOperation the bundler wants
//! paymaster approval for).
//!
//! Success response (200):
//! ```json
//! {
//!   "paymasterAndData": "0x...",
//!   "validUntil": 1234567890,
//!   "validAfter": 0,
//!   "signature": "0x..."
//! }
//! ```
//!
//! Error responses:
//! - `400 Bad Request` — malformed UserOp JSON
//! - `402 Payment Required` — sponsorship denied (budget exhausted or billing inactive)
//! - `500 Internal Server Error` — signing or database failure
//!
//! ### `GET /health`
//!
//! Returns `{"status": "ok"}` when the service is ready.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde_json::json;
use tokio::task::spawn_blocking;
use tracing::{error, info};

use crate::{
    db,
    error::PaymasterError,
    policy::{self, SponsorshipDecision},
    signer::PaymasterSigner,
    types::{ErrorResponse, SponsorResponse, UserOp},
};

/// Shared application state injected into every handler.
#[derive(Clone)]
pub struct AppState {
    pub signer: Arc<PaymasterSigner>,
    pub db_path: String,
    /// Validity window in seconds from now (default: 15 minutes).
    pub valid_for_secs: u64,
}

/// Build the axum router.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/paymaster/sponsor", post(sponsor_handler))
        .route("/health", get(health_handler))
        .with_state(state)
}

/// `POST /paymaster/sponsor` — evaluate policy and return paymaster approval.
async fn sponsor_handler(
    State(state): State<AppState>,
    Json(user_op): Json<UserOp>,
) -> impl IntoResponse {
    info!(sender = %user_op.sender, "paymaster/sponsor request");

    // For Phase-1: entity_id == sender address.
    // Phase-2: resolve sender → entity_id via platform API.
    let entity_id = user_op.sender.clone();
    let db_path = state.db_path.clone();
    let user_op_clone = user_op.clone();

    // SQLite ops run on the blocking thread pool.
    let policy_result = spawn_blocking(move || -> Result<SponsorshipDecision, PaymasterError> {
        let conn = rusqlite::Connection::open(&db_path)?;
        db::init_schema(&conn).map_err(|e| PaymasterError::Internal(e.to_string()))?;
        policy::check_sponsorship(&conn, &user_op_clone, &entity_id)
            .map_err(|e| PaymasterError::Internal(e.to_string()))
    })
    .await;

    let decision = match policy_result {
        Ok(Ok(d)) => d,
        Ok(Err(e)) => {
            error!(error = %e, "policy check database error");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "internal error".to_string(),
                }),
            )
                .into_response();
        }
        Err(e) => {
            error!(error = %e, "spawn_blocking join error");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "internal error".to_string(),
                }),
            )
                .into_response();
        }
    };

    match decision {
        SponsorshipDecision::Denied { reason } => {
            info!(sender = %user_op.sender, reason, "sponsorship denied");
            return (
                StatusCode::PAYMENT_REQUIRED,
                Json(ErrorResponse { error: reason }),
            )
                .into_response();
        }
        SponsorshipDecision::Approved => {}
    }

    // Compute validity window.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let valid_until = now + state.valid_for_secs;
    let valid_after: u64 = 0;

    // Compute the UserOp hash (placeholder — real hash requires EntryPoint ABI).
    // Phase-2: call EntryPoint.getUserOpHash(userOp) via RPC.
    // For Phase-1 we derive a deterministic hash from the sender + nonce to give
    // the signer something meaningful to sign.
    let user_op_hash = compute_user_op_hash_stub(&user_op);

    // Sign.
    let signature = match state
        .signer
        .sign_paymaster_op(&user_op_hash, valid_until, valid_after)
        .await
    {
        Ok(s) => s,
        Err(e) => {
            error!(error = %e, "signing failed");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    error: "signing failed".to_string(),
                }),
            )
                .into_response();
        }
    };

    // Build paymasterAndData: address(20) ++ validUntil(6) ++ validAfter(6) ++ signature(65).
    let paymaster_address = state.signer.address();
    let mut pad = Vec::with_capacity(97);
    pad.extend_from_slice(paymaster_address.as_slice());
    pad.extend_from_slice(&valid_until.to_be_bytes()[2..]); // uint48 = 6 bytes
    pad.extend_from_slice(&valid_after.to_be_bytes()[2..]);
    let sig_bytes = hex::decode(signature.trim_start_matches("0x")).unwrap_or_default();
    pad.extend_from_slice(&sig_bytes);

    let paymaster_and_data = format!("0x{}", hex::encode(&pad));

    info!(sender = %user_op.sender, valid_until, "sponsorship approved");

    (
        StatusCode::OK,
        Json(SponsorResponse {
            paymaster_and_data,
            valid_until,
            valid_after,
            signature: format!("0x{}", hex::encode(&sig_bytes)),
        }),
    )
        .into_response()
}

/// `GET /health` — liveness probe.
async fn health_handler() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({"status": "ok"})))
}

/// Phase-1 stub: derive a deterministic "UserOp hash" from sender + nonce.
///
/// Real implementation: call `EntryPoint.getUserOpHash(userOp)` via JSON-RPC.
/// Deferred to Phase-2 when the EntryPoint is deployed and the RPC URL is wired.
fn compute_user_op_hash_stub(user_op: &UserOp) -> String {
    use alloy::primitives::keccak256;
    let mut input = Vec::new();
    input.extend_from_slice(user_op.sender.as_bytes());
    input.extend_from_slice(user_op.nonce.as_bytes());
    let hash = keccak256(&input);
    format!("0x{}", hex::encode(hash.as_slice()))
}
