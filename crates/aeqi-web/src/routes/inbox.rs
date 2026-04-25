//! Director-inbox HTTP routes.
//!
//! `GET /api/inbox` returns the list of sessions awaiting a human reply
//! that the requesting user has access to (via `user_access` walking up
//! to the root agent — handled inside the IPC layer).
//!
//! `POST /api/inbox/{session_id}/answer` submits a director's reply for a
//! pending question. The body is `{ "answer": String }`. The session_id
//! travels in the URL because the user's reply targets a specific session
//! they saw in the list, and putting it in the path produces clean
//! per-session URLs for sharing / debugging.
//!
//! Both routes proxy through `ipc_proxy` so tenancy enforcement, error
//! shapes, and JSON encoding match every other API surface.

use axum::{
    Json, Router,
    extract::{Path, State},
    response::Response,
    routing::{get, post},
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/inbox", get(inbox))
        .route("/inbox/{session_id}/answer", post(answer))
}

async fn inbox(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "inbox", serde_json::json!({})).await
}

async fn answer(
    State(state): State<AppState>,
    scope: Scope,
    Path(session_id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    // Inject the session_id from the URL into the body so the IPC handler
    // can accept it on the request without the caller having to duplicate
    // the value in JSON. Path > body when both are present (URL is the
    // canonical address of the resource).
    let mut payload = match body {
        serde_json::Value::Object(map) => serde_json::Value::Object(map),
        _ => serde_json::json!({}),
    };
    payload["session_id"] = serde_json::Value::String(session_id);
    ipc_proxy(state, scope.as_ref(), "answer_inbox", payload).await
}
