//! axum HTTP router for the paymaster service.
//!
//! ## Endpoints
//!
//! ### `POST /` — ERC-7677 JSON-RPC (`pm_sponsorUserOperation`)
//!
//! Standard JSON-RPC 2.0 envelope. Method: `pm_sponsorUserOperation`.
//! Params: `[userOp, entryPoint, chainId]`.
//!
//! Success response (200):
//! ```json
//! {
//!   "jsonrpc": "2.0",
//!   "id": 1,
//!   "result": {
//!     "paymasterAndData": "0x...",
//!     "validUntil": 1234567890,
//!     "validAfter": 0,
//!     "signature": "0x..."
//!   }
//! }
//! ```
//!
//! ### `POST /paymaster/sponsor` — REST shim
//!
//! Request body: [`UserOp`] JSON. Same logic as `pm_sponsorUserOperation` without
//! the JSON-RPC envelope. Kept for internal tooling and smoke tests.
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
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::task::spawn_blocking;
use tracing::{error, info, warn};

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
    /// Deployed Paymaster.sol contract address (hex, 0x-prefixed, 20 bytes).
    ///
    /// Committed into the signing digest so signatures are bound to this
    /// specific on-chain contract. Set via `PAYMASTER_CONTRACT_ADDRESS` env var.
    /// Required for real on-chain sponsorship; unused in Phase-1 stub mode.
    pub paymaster_contract_address: String,
}

// ── JSON-RPC types ────────────────────────────────────────────────────────────

/// Incoming JSON-RPC 2.0 request envelope.
#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: serde_json::Value,
    pub method: String,
    pub params: serde_json::Value,
}

/// Outgoing JSON-RPC 2.0 success response.
#[derive(Debug, Serialize)]
pub struct JsonRpcOk {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    pub result: serde_json::Value,
}

/// Outgoing JSON-RPC 2.0 error response.
#[derive(Debug, Serialize)]
pub struct JsonRpcErr {
    pub jsonrpc: &'static str,
    pub id: serde_json::Value,
    pub error: JsonRpcErrBody,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcErrBody {
    pub code: i32,
    pub message: String,
}

impl JsonRpcErr {
    fn invalid_params(id: serde_json::Value, msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::OK, // JSON-RPC always returns 200; error is in body
            Json(Self {
                jsonrpc: "2.0",
                id,
                error: JsonRpcErrBody {
                    code: -32602,
                    message: msg.into(),
                },
            }),
        )
    }

    fn sponsor_denied(id: serde_json::Value, msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (
            StatusCode::OK,
            Json(Self {
                jsonrpc: "2.0",
                id,
                error: JsonRpcErrBody {
                    code: -32500, // AA rejected (ERC-4337 convention)
                    message: msg.into(),
                },
            }),
        )
    }

    fn internal(id: serde_json::Value) -> (StatusCode, Json<Self>) {
        (
            StatusCode::OK,
            Json(Self {
                jsonrpc: "2.0",
                id,
                error: JsonRpcErrBody {
                    code: -32603,
                    message: "internal error".to_string(),
                },
            }),
        )
    }

    fn method_not_found(id: serde_json::Value, method: &str) -> (StatusCode, Json<Self>) {
        (
            StatusCode::OK,
            Json(Self {
                jsonrpc: "2.0",
                id,
                error: JsonRpcErrBody {
                    code: -32601,
                    message: format!("method not found: {method}"),
                },
            }),
        )
    }
}

// ── Router ────────────────────────────────────────────────────────────────────

/// Build the axum router.
pub fn router(state: AppState) -> Router {
    Router::new()
        // ERC-7677 JSON-RPC endpoint — bundlers / wallets call this.
        .route("/", post(jsonrpc_handler))
        // REST shim — internal tooling + smoke tests.
        .route("/paymaster/sponsor", post(sponsor_handler))
        .route("/health", get(health_handler))
        .with_state(state)
}

// ── ERC-7677 JSON-RPC handler ─────────────────────────────────────────────────

/// `POST /` — JSON-RPC 2.0 dispatcher.
///
/// Routes `pm_sponsorUserOperation` (ERC-7677) to the sponsorship pipeline.
/// All other methods return -32601 method-not-found.
async fn jsonrpc_handler(
    State(state): State<AppState>,
    Json(req): Json<JsonRpcRequest>,
) -> impl IntoResponse {
    if req.jsonrpc != "2.0" {
        return JsonRpcErr::invalid_params(req.id, "jsonrpc must be \"2.0\"").into_response();
    }

    match req.method.as_str() {
        "pm_sponsorUserOperation" => pm_sponsor_user_operation(state, req.id, req.params).await,
        other => {
            warn!(method = other, "unknown JSON-RPC method");
            JsonRpcErr::method_not_found(req.id, other).into_response()
        }
    }
}

/// Implement `pm_sponsorUserOperation` (ERC-7677).
///
/// Params array: `[userOp, entryPoint, chainId?]`
/// - `userOp` — ERC-4337 UserOperation object (camelCase fields).
/// - `entryPoint` — hex address string (validated but not verified on-chain in Phase-1).
/// - `chainId` — optional hex or decimal chain ID (logged; not enforced in Phase-1).
async fn pm_sponsor_user_operation(
    state: AppState,
    id: serde_json::Value,
    params: serde_json::Value,
) -> axum::response::Response {
    let params_arr = match params.as_array() {
        Some(a) if !a.is_empty() => a,
        _ => {
            return JsonRpcErr::invalid_params(id, "params must be [userOp, entryPoint, chainId?]")
                .into_response();
        }
    };

    // Parse userOp from params[0].
    let user_op: UserOp = match serde_json::from_value(params_arr[0].clone()) {
        Ok(u) => u,
        Err(e) => {
            return JsonRpcErr::invalid_params(id, format!("invalid userOp: {e}")).into_response();
        }
    };

    // Log entryPoint if provided.
    if let Some(ep) = params_arr.get(1).and_then(|v| v.as_str()) {
        info!(entry_point = ep, sender = %user_op.sender, "pm_sponsorUserOperation");
    }

    // Delegate to the shared approval pipeline.
    match approve_user_op(&state, &user_op).await {
        Ok(resp) => (
            StatusCode::OK,
            Json(JsonRpcOk {
                jsonrpc: "2.0",
                id,
                result: serde_json::to_value(&resp).unwrap_or(serde_json::Value::Null),
            }),
        )
            .into_response(),
        Err(ApprovalError::Denied(reason)) => {
            JsonRpcErr::sponsor_denied(id, reason).into_response()
        }
        Err(ApprovalError::Internal) => JsonRpcErr::internal(id).into_response(),
    }
}

// ── Shared approval pipeline ──────────────────────────────────────────────────

enum ApprovalError {
    Denied(String),
    Internal,
}

/// Evaluate policy + sign for a UserOp. Shared between the JSON-RPC and REST paths.
async fn approve_user_op(
    state: &AppState,
    user_op: &UserOp,
) -> Result<SponsorResponse, ApprovalError> {
    let entity_id = user_op.sender.clone();
    let db_path = state.db_path.clone();
    let user_op_clone = user_op.clone();

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
            return Err(ApprovalError::Internal);
        }
        Err(e) => {
            error!(error = %e, "spawn_blocking join error");
            return Err(ApprovalError::Internal);
        }
    };

    if let SponsorshipDecision::Denied { reason } = decision {
        info!(sender = %user_op.sender, reason, "sponsorship denied");
        return Err(ApprovalError::Denied(reason));
    }

    // Compute validity window.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let valid_until = now + state.valid_for_secs;
    let valid_after: u64 = 0;

    let user_op_hash = compute_user_op_hash_stub(user_op);

    let signature = state
        .signer
        .sign_paymaster_op(
            &user_op_hash,
            valid_until,
            valid_after,
            &state.paymaster_contract_address,
        )
        .await
        .map_err(|e| {
            error!(error = %e, "signing failed");
            ApprovalError::Internal
        })?;

    // Build paymasterAndData: paymaster_contract_address(20) ++ validUntil(6) ++ validAfter(6) ++ signature(65).
    // The first 20 bytes MUST be the Paymaster.sol contract address (what the EntryPoint reads),
    // NOT the signer hot-key address.
    let contract_addr_bytes =
        hex::decode(state.paymaster_contract_address.trim_start_matches("0x")).unwrap_or_default();
    let mut pad = Vec::with_capacity(97);
    pad.extend_from_slice(&contract_addr_bytes);
    pad.extend_from_slice(&valid_until.to_be_bytes()[2..]); // uint48 = 6 bytes
    pad.extend_from_slice(&valid_after.to_be_bytes()[2..]);
    let sig_bytes = hex::decode(signature.trim_start_matches("0x")).unwrap_or_default();
    pad.extend_from_slice(&sig_bytes);

    let paymaster_and_data = format!("0x{}", hex::encode(&pad));

    info!(sender = %user_op.sender, valid_until, "sponsorship approved");

    Ok(SponsorResponse {
        paymaster_and_data,
        valid_until,
        valid_after,
        signature: format!("0x{}", hex::encode(&sig_bytes)),
    })
}

// ── REST shim ─────────────────────────────────────────────────────────────────

/// `POST /paymaster/sponsor` — REST shim; delegates to the shared approval pipeline.
async fn sponsor_handler(
    State(state): State<AppState>,
    Json(user_op): Json<UserOp>,
) -> impl IntoResponse {
    info!(sender = %user_op.sender, "paymaster/sponsor request");

    match approve_user_op(&state, &user_op).await {
        Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
        Err(ApprovalError::Denied(reason)) => (
            StatusCode::PAYMENT_REQUIRED,
            Json(ErrorResponse { error: reason }),
        )
            .into_response(),
        Err(ApprovalError::Internal) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: "internal error".to_string(),
            }),
        )
            .into_response(),
    }
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
