use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::get,
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ideas", get(list_ideas).post(store_idea))
        .route("/ideas/search", get(search_ideas))
        .route("/ideas/seed", axum::routing::post(seed_ideas))
        .route("/ideas/{id}", axum::routing::put(update_idea).delete(delete_idea))
}

#[derive(Deserialize, Default)]
struct ListIdeasQuery {
    agent_id: Option<String>,
}

async fn list_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListIdeasQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(agent_id) = &q.agent_id {
        params["agent_id"] = serde_json::json!(agent_id);
    }
    ipc_proxy(state, scope.as_ref(), "list_ideas", params).await
}

async fn store_idea(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "store_idea", body).await
}

async fn update_idea(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["id"] = serde_json::json!(id);
    ipc_proxy(state, scope.as_ref(), "update_idea", params).await
}

async fn delete_idea(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "delete_idea", params).await
}

#[derive(Deserialize, Default)]
struct SearchIdeasQuery {
    query: Option<String>,
    agent_id: Option<String>,
    category: Option<String>,
    top_k: Option<u64>,
}

async fn search_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<SearchIdeasQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(query) = &q.query {
        params["query"] = serde_json::json!(query);
    }
    if let Some(agent_id) = &q.agent_id {
        params["agent_id"] = serde_json::json!(agent_id);
    }
    if let Some(category) = &q.category {
        params["category"] = serde_json::json!(category);
    }
    if let Some(top_k) = q.top_k {
        params["top_k"] = serde_json::json!(top_k);
    }
    ipc_proxy(state, scope.as_ref(), "search_ideas", params).await
}

/// Seed ideas + agents into a tenant's company.
async fn seed_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "seed_ideas", body).await
}
