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
        .route("/vfs", get(vfs_list))
        .route("/vfs/search", get(vfs_search))
        .route("/vfs/{*path}", get(vfs_read))
}

#[derive(Deserialize, Default)]
struct VfsListQuery {
    path: Option<String>,
}

async fn vfs_list(State(state): State<AppState>, scope: Scope, Query(q): Query<VfsListQuery>) -> Response {
    let path = q.path.unwrap_or_else(|| "/".to_string());
    ipc_proxy(state, scope.as_ref(), "vfs_list", serde_json::json!({"path": path})).await
}

async fn vfs_read(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(path): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "vfs_read", serde_json::json!({"path": path})).await
}

#[derive(Deserialize, Default)]
struct VfsSearchQuery {
    query: String,
}

async fn vfs_search(State(state): State<AppState>, scope: Scope, Query(q): Query<VfsSearchQuery>) -> Response {
    ipc_proxy(state, scope.as_ref(), "vfs_search", serde_json::json!({"query": q.query})).await
}
