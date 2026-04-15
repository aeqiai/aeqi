use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::get,
};
use serde::{Deserialize, Serialize};

use super::helpers::{ipc_proxy, merge_path_id, query_to_params};
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ideas", get(list_ideas).post(store_idea))
        .route("/ideas/search", get(search_ideas))
        .route("/ideas/prefix", get(ideas_by_prefix))
        .route("/ideas/by-ids", axum::routing::post(ideas_by_ids))
        .route("/ideas/profile", get(idea_profile))
        .route("/ideas/graph", get(idea_graph))
        .route("/ideas/seed", axum::routing::post(seed_ideas))
        .route(
            "/ideas/{id}",
            axum::routing::put(update_idea).delete(delete_idea),
        )
}

#[derive(Deserialize, Serialize, Default)]
struct ListIdeasQuery {
    agent_id: Option<String>,
}

async fn list_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListIdeasQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "list_ideas", query_to_params(&q)).await
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
    ipc_proxy(
        state,
        scope.as_ref(),
        "update_idea",
        merge_path_id(body, "id", id),
    )
    .await
}

async fn delete_idea(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "delete_idea",
        serde_json::json!({"id": id}),
    )
    .await
}

#[derive(Deserialize, Serialize, Default)]
struct SearchIdeasQuery {
    query: Option<String>,
    agent_id: Option<String>,
    tags: Option<String>,
    top_k: Option<u64>,
}

async fn search_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<SearchIdeasQuery>,
) -> Response {
    let mut params = query_to_params(&q);
    // Parse comma-separated tags into an array.
    if let Some(tags_str) = &q.tags {
        let parsed: Vec<&str> = tags_str
            .split(',')
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .collect();
        if !parsed.is_empty() {
            params["tags"] = serde_json::json!(parsed);
        }
    }
    ipc_proxy(state, scope.as_ref(), "search_ideas", params).await
}

#[derive(Deserialize, Serialize, Default)]
struct PrefixQuery {
    prefix: Option<String>,
    limit: Option<u64>,
}

async fn ideas_by_prefix(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<PrefixQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "idea_prefix", query_to_params(&q)).await
}

async fn ideas_by_ids(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "ideas_by_ids", body).await
}

#[derive(Deserialize, Serialize, Default)]
struct ProjectQuery {
    project: Option<String>,
}

async fn idea_profile(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ProjectQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "idea_profile", query_to_params(&q)).await
}

#[derive(Deserialize, Serialize, Default)]
struct IdeaGraphQuery {
    project: Option<String>,
    limit: Option<u64>,
}

async fn idea_graph(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<IdeaGraphQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "idea_graph", query_to_params(&q)).await
}

async fn seed_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "seed_ideas", body).await
}
