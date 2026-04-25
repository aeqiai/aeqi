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
        .route("/agents", get(agents))
        .route("/agents/spawn", post(agents_spawn))
        .route("/agents/{id}/retire", post(agent_retire))
        .route("/agents/{id}/activate", post(agent_activate))
        .route("/agents/{id}/model", axum::routing::put(agent_set_model))
        .route("/agents/{id}/tools", axum::routing::put(agent_set_tools))
        .route(
            "/agents/{id}/can-ask-director",
            post(agent_set_can_ask_director),
        )
        .route("/agents/{id}/identity", get(agent_identity))
        .route("/agents/{id}/files", post(save_agent_file))
        .route("/agents/{id}", axum::routing::delete(agent_delete))
}

#[derive(Deserialize, Serialize, Default)]
struct AgentsQuery {
    status: Option<String>,
    root: Option<bool>,
}

#[derive(Deserialize, Serialize, Default)]
struct AgentDeleteQuery {
    cascade: Option<bool>,
}

async fn agent_delete(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Query(q): Query<AgentDeleteQuery>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_delete",
        serde_json::json!({ "id": id, "cascade": q.cascade.unwrap_or(false) }),
    )
    .await
}

async fn agents(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<AgentsQuery>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agents_registry",
        query_to_params(&q),
    )
    .await
}

async fn agent_set_tools(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_set_tool_deny",
        merge_path_id(body, "id", id),
    )
    .await
}

async fn agent_set_model(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_set_model",
        merge_path_id(body, "id", id),
    )
    .await
}

async fn agent_set_can_ask_director(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "set_can_ask_director",
        merge_path_id(body, "agent_id", id),
    )
    .await
}

async fn agents_spawn(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "agent_spawn", body).await
}

async fn agent_retire(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_set_status",
        serde_json::json!({"name": id, "status": "retired"}),
    )
    .await
}

async fn agent_activate(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_set_status",
        serde_json::json!({"name": id, "status": "active"}),
    )
    .await
}

async fn agent_identity(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_identity",
        serde_json::json!({"name": id}),
    )
    .await
}

async fn save_agent_file(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "save_agent_file",
        merge_path_id(body, "name", id),
    )
    .await
}
