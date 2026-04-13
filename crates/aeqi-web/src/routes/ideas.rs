use axum::{
    Router,
    extract::{Query, State},
    response::Response,
    routing::get,
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ideas/recall", get(ideas))
        .route("/ideas/profile", get(idea_profile))
        .route("/ideas/graph", get(idea_graph))
}

#[derive(Deserialize, Default)]
struct IdeasQuery {
    project: Option<String>,
    query: Option<String>,
    limit: Option<u64>,
}

async fn ideas(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<IdeasQuery>,
) -> Response {
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
    ipc_proxy(state, scope.as_ref(), "ideas", params).await
}

#[derive(Deserialize, Default)]
struct IdeaProfileQuery {
    project: Option<String>,
}

async fn idea_profile(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<IdeaProfileQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::json!(project);
    }
    ipc_proxy(state, scope.as_ref(), "idea_profile", params).await
}

#[derive(Deserialize, Default)]
struct IdeaGraphQuery {
    project: Option<String>,
    limit: Option<u64>,
}

async fn idea_graph(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<IdeaGraphQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::json!(project);
    }
    if let Some(limit) = q.limit {
        params["limit"] = serde_json::json!(limit);
    }
    ipc_proxy(state, scope.as_ref(), "idea_graph", params).await
}
