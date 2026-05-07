//! Architect HTTP routes.
//!
//! Three POST endpoints map onto the orchestrator IPC verbs declared in
//! `crates/aeqi-orchestrator/src/ipc/architect.rs`:
//!
//! - `POST /api/architect/draft` — generate a Blueprint from a free-text brief
//! - `POST /api/architect/refine` — apply an instruction to an existing draft
//! - `POST /api/architect/deploy` — provision a Company from a generated draft
//!
//! Phase 1 is request/response. The deploy route mirrors `spawn_blueprint`'s
//! account-side gating (free-trial slot + creator-user-id injection) so the
//! Architect path is a one-for-one alternative to the catalog deploy and
//! never bypasses subscription checks.

use axum::{
    Json, Router,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};

use super::helpers::ipc_proxy_with_timeout;
use crate::auth::Claims;
use crate::extractors::Scope;
use crate::server::AppState;

/// Architect verbs front an LLM call; the default 10s IPC timeout is
/// too aggressive. Allow up to 60s — covers the architect's own 30s
/// internal timeout plus IPC overhead and slow OpenRouter routes.
const ARCHITECT_IPC_TIMEOUT_SECS: u64 = 60;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/architect/draft", post(architect_draft))
        .route("/architect/refine", post(architect_refine))
        .route("/architect/deploy", post(architect_deploy))
}

async fn architect_draft(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy_with_timeout(
        state,
        scope.as_ref(),
        "architect.draft",
        body,
        ARCHITECT_IPC_TIMEOUT_SECS,
    )
    .await
}

async fn architect_refine(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy_with_timeout(
        state,
        scope.as_ref(),
        "architect.refine",
        body,
        ARCHITECT_IPC_TIMEOUT_SECS,
    )
    .await
}

/// Phase 1 deploy mirrors the `spawn_blueprint` route's gating: free-trial
/// slot enforcement when accounts are on, creator-user-id injection so the
/// daemon can auto-create the founding Director, and best-effort
/// `add_director` + `mark_free_company_used` post-processing.
async fn architect_deploy(State(state): State<AppState>, scope: Scope, req: Request) -> Response {
    let claims = req.extensions().get::<Claims>().cloned();
    let body: serde_json::Value = match axum::body::to_bytes(req.into_body(), 1_048_576).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    };

    let acting_user_id = claims
        .as_ref()
        .and_then(|c| c.user_id.as_deref())
        .map(|s| s.to_string());

    if let (Some(accounts), Some(user_id)) = (&state.accounts, acting_user_id.as_deref()) {
        let paid = accounts.user_has_paid_plan(user_id).unwrap_or(false);
        let trial_used = accounts
            .get_user_by_id(user_id)
            .ok()
            .flatten()
            .and_then(|u| u.free_company_used_at)
            .is_some();
        if !paid && trial_used {
            return (
                StatusCode::PAYMENT_REQUIRED,
                Json(serde_json::json!({
                    "ok": false,
                    "code": "trial_used",
                    "error": "Your free trial company has already been launched. Subscribe to spawn another.",
                })),
            )
                .into_response();
        }
    }

    let mut params = body;
    if !params.is_object() {
        params = serde_json::json!({});
    }
    if let Some(scope_ref) = scope.as_ref() {
        params["allowed_roots"] = serde_json::json!(scope_ref.roots);
    }
    if let Some(uid) = acting_user_id.as_deref() {
        params["creator_user_id"] = serde_json::json!(uid);
    }

    let resp = match state.ipc.cmd_with("architect.deploy", params).await {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };

    let succeeded = resp.get("ok") == Some(&serde_json::Value::Bool(true));
    if let (Some(accounts), Some(user_id)) = (&state.accounts, acting_user_id.as_deref())
        && succeeded
    {
        if let Some(entity_id) = resp.get("entity_id").and_then(|v| v.as_str())
            && let Err(err) = accounts.add_director(user_id, entity_id)
        {
            tracing::warn!(
                user_id,
                entity_id,
                "architect.deploy: failed to link entity to user: {err}"
            );
        }
        if let Err(err) = accounts.mark_free_company_used(user_id) {
            tracing::warn!(
                user_id,
                "architect.deploy: failed to mark free trial slot used: {err}"
            );
        }
    }

    Json(resp).into_response()
}
