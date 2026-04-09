use axum::{
    Router,
    extract::{Query, State},
    response::Response,
    routing::get,
};
use serde::Deserialize;

use crate::extractors::Scope;
use crate::server::AppState;
use super::helpers::ipc_proxy;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/memories", get(memories))
        .route("/memory/profile", get(memory_profile))
        .route("/memory/graph", get(memory_graph))
}

#[derive(Deserialize, Default)]
struct MemoriesQuery {
    project: Option<String>,
    query: Option<String>,
    limit: Option<u64>,
}

async fn memories(State(state): State<AppState>, scope: Scope, Query(q): Query<MemoriesQuery>) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::json!(project);
    }
    if let Some(query) = &q.query {
        params["query"] = serde_json::json!(query);
    }
    if let Some(limit) = q.limit {
        params["limit"] = serde_json::json!(limit);
    }
    ipc_proxy(state, scope.as_ref(), "memories", params).await
}

#[derive(Deserialize, Default)]
struct MemoryProfileQuery {
    project: Option<String>,
}

async fn memory_profile(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<MemoryProfileQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::json!(project);
    }
    ipc_proxy(state, scope.as_ref(), "memory_profile", params).await
}

#[derive(Deserialize, Default)]
struct MemoryGraphQuery {
    project: Option<String>,
    limit: Option<u64>,
}

async fn memory_graph(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<MemoryGraphQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::json!(project);
    }
    if let Some(limit) = q.limit {
        params["limit"] = serde_json::json!(limit);
    }
    ipc_proxy(state, scope.as_ref(), "memory_graph", params).await
}
