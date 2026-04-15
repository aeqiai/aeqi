use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use super::helpers::{ipc_proxy, merge_path_id, query_to_params};
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/quests", get(quests).post(create_quest))
        .route("/quests/{id}", get(get_quest).put(update_quest))
        .route("/quests/{id}/close", post(close_quest))
}

#[derive(Deserialize, Serialize, Default)]
struct QuestsQuery {
    project: Option<String>,
    status: Option<String>,
}

async fn quests(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<QuestsQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "quests", query_to_params(&q)).await
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
    ipc_proxy(
        state,
        scope.as_ref(),
        "get_quest",
        serde_json::json!({"id": id}),
    )
    .await
}

async fn update_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "update_quest",
        merge_path_id(body, "id", id),
    )
    .await
}

async fn close_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "close_quest",
        merge_path_id(body, "quest_id", id),
    )
    .await
}
