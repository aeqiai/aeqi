use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/roles", get(list_roles).post(create_role))
        // Specific routes before the parameterised GET to avoid axum 405 shadowing.
        .route("/roles/grants", get(user_grants))
        .route("/roles/{id}", get(get_role))
        .route("/roles/{id}/occupant", post(change_occupant))
        .route("/roles/{id}/update", post(update_role))
        .route("/roles/{id}/archive", post(archive_role))
}

#[derive(serde::Deserialize)]
struct ListQuery {
    trust_id: Option<String>,
}

async fn list_roles(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListQuery>,
) -> Response {
    let trust_id = q.trust_id.unwrap_or_default();
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_roles",
        serde_json::json!({"trust_id": trust_id}),
    )
    .await
}

async fn get_role(State(state): State<AppState>, scope: Scope, Path(id): Path<String>) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "get_role",
        serde_json::json!({"role_id": id}),
    )
    .await
}

async fn create_role(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_role", body).await
}

/// POST /api/roles/:id/update
///
/// Body: `{ "title"?, "role_type"?, "grants"? }`
///
/// Gates on `roles.manage` (enforced in the IPC handler via `caller_user_id`
/// injected by `ipc_proxy`).
async fn update_role(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "update_role", body).await
}

/// POST /api/roles/:id/archive
///
/// Gates on `roles.manage`.
async fn archive_role(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    body: Option<Json<serde_json::Value>>,
) -> Response {
    let mut params = body.map(|b| b.0).unwrap_or_else(|| serde_json::json!({}));
    params["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "archive_role", params).await
}

/// POST /api/roles/:id/occupant
///
/// Body: `{ "occupant_kind": "human"|"agent"|"vacant", "occupant_id": "<id>" }`
///
/// Proxies to the `change_occupant` IPC command, which:
///   - Updates the role row.
///   - Rotates participant sets on every anchored session.
///   - Appends a system hand-off message in each session.
///
/// Gates on `roles.manage` (caller_user_id injected by ipc_proxy).
async fn change_occupant(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "change_occupant", body).await
}

/// GET /api/roles/grants?trust_id=X&user_id=Y
///
/// Returns the union of grants for the given user at the given entity.
#[derive(serde::Deserialize)]
struct GrantsQuery {
    trust_id: Option<String>,
    user_id: Option<String>,
}

async fn user_grants(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<GrantsQuery>,
) -> Response {
    let trust_id = match q.trust_id.filter(|s| !s.is_empty()) {
        Some(id) => id,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"ok": false, "error": "trust_id is required"})),
            )
                .into_response();
        }
    };
    let user_id = match q.user_id.filter(|s| !s.is_empty()) {
        Some(id) => id,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"ok": false, "error": "user_id is required"})),
            )
                .into_response();
        }
    };
    ipc_proxy(
        state,
        scope.as_ref(),
        "user_grants",
        serde_json::json!({"trust_id": trust_id, "user_id": user_id}),
    )
    .await
}
