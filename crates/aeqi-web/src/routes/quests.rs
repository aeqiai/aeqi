use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/quests", get(quests).post(create_quest))
        .route("/quests/{id}", get(get_quest).put(update_quest))
        .route("/quests/{id}/close", post(close_quest))
}

#[derive(Deserialize, Default)]
struct QuestsQuery {
    project: Option<String>,
    status: Option<String>,
}

async fn quests(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<QuestsQuery>,
) -> Response {
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

async fn get_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "get_quest", params).await
}

async fn update_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "update_quest", params).await
}

async fn close_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["quest_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "close_quest", params).await
}
