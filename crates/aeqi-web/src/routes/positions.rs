use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/positions", get(list_positions).post(create_position))
        .route("/positions/{id}/occupant", post(change_occupant))
        // /api/roles/:id/occupant is the user-facing alias — same handler.
        .route("/roles/{id}/occupant", post(change_occupant))
}

#[derive(serde::Deserialize)]
struct ListQuery {
    entity_id: Option<String>,
}

async fn list_positions(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListQuery>,
) -> Response {
    let entity_id = q.entity_id.unwrap_or_default();
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_positions",
        serde_json::json!({"entity_id": entity_id}),
    )
    .await
}

async fn create_position(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_position", body).await
}

/// POST /api/positions/:id/occupant
///
/// Body: `{ "occupant_kind": "human"|"agent"|"vacant", "occupant_id": "<id>" }`
///
/// Proxies to the `change_occupant` IPC command, which:
///   - Updates the position row.
///   - Rotates participant sets on every anchored session.
///   - Appends a system hand-off message in each session.
///
/// Tenancy: the `allowed_roots` scope injected by `ipc_proxy` gates writes
/// to positions the caller owns.
async fn change_occupant(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["position_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "change_occupant", body).await
}
