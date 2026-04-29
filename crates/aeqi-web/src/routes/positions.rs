use axum::{
    Json, Router,
    extract::{Query, State},
    response::Response,
    routing::get,
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/positions", get(list_positions).post(create_position))
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
