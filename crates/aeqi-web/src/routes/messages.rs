//! HTTP routes for the unified-session message and participant primitives.
//!
//! `POST /api/messages/to`          — append a message to a session or idea target.
//! `POST /api/sessions/:id/participants` — add an identity to a session's roster.
//!
//! Both handlers proxy to the IPC layer (`message_to` / `add_participant`).
//! Tenancy is enforced by injecting `allowed_roots` from the request `Scope`;
//! the IPC handlers resolve the target's owning entity and gate access.

use axum::{
    Json, Router,
    extract::{Path, State},
    response::Response,
    routing::post,
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/messages/to", post(message_to))
        .route("/sessions/{id}/participants", post(add_participant))
}

/// `POST /api/messages/to`
///
/// Body: `{ target: { kind: "session"|"idea", id }, body, payload_kind? }`
///
/// Flat-maps the nested `target` onto the IPC field names (`target_kind`,
/// `target_id`) so the IPC handler's existing contract is unchanged.
async fn message_to(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    // Normalise: accept both flat (`target_kind`, `target_id`) and nested
    // (`target.kind`, `target.id`) shapes so the frontend can use either.
    let mut payload = match body {
        serde_json::Value::Object(map) => serde_json::Value::Object(map),
        _ => serde_json::json!({}),
    };

    if let Some(target) = payload.get("target").and_then(|t| t.as_object()).cloned() {
        if let Some(kind) = target.get("kind").and_then(|v| v.as_str()) {
            payload["target_kind"] = serde_json::Value::String(kind.to_string());
        }
        if let Some(id) = target.get("id").and_then(|v| v.as_str()) {
            payload["target_id"] = serde_json::Value::String(id.to_string());
        }
        // Remove the nested key so the IPC handler only sees flat fields.
        if let Some(obj) = payload.as_object_mut() {
            obj.remove("target");
        }
    }

    ipc_proxy(state, scope.as_ref(), "message_to", payload).await
}

/// `POST /api/sessions/:id/participants`
///
/// Body: `{ identity_kind, identity_id }`
///
/// Tenancy: the IPC handler (`add_participant`) verifies that the requesting
/// user's allowed_roots include the session's owning entity.
async fn add_participant(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut payload = match body {
        serde_json::Value::Object(map) => serde_json::Value::Object(map),
        _ => serde_json::json!({}),
    };
    payload["session_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "add_participant", payload).await
}
