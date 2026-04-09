use axum::{
    Json, Router,
    extract::{Query, State},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;

use crate::extractors::Scope;
use crate::server::AppState;
use super::helpers::ipc_proxy;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/quests", get(quests).post(create_quest))
        .route("/quests/{id}/close", post(close_quest))
}

#[derive(Deserialize, Default)]
struct QuestsQuery {
    project: Option<String>,
    status: Option<String>,
}

async fn quests(State(state): State<AppState>, scope: Scope, Query(q): Query<QuestsQuery>) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::Value::String(project.clone());
    }
    if let Some(status) = &q.status {
        params["status"] = serde_json::Value::String(status.clone());
    }
    ipc_proxy(state, scope.as_ref(), "quests", params).await
}

async fn create_quest(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_quest", body).await
}

async fn close_quest(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["quest_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "close_quest", params).await
}
