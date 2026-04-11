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
        .route("/prompts", get(list_prompts).post(create_prompt))
        .route(
            "/prompts/{id}",
            get(get_prompt).put(update_prompt).delete(delete_prompt),
        )
        .route("/ideas/seed", axum::routing::post(seed_ideas))
}

#[derive(Deserialize, Default)]
struct ListPromptsQuery {
    tag: Option<String>,
}

async fn list_prompts(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListPromptsQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(tag) = &q.tag {
        params["tag"] = serde_json::json!(tag);
    }
    ipc_proxy(state, scope.as_ref(), "list_prompts", params).await
}

async fn get_prompt(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "get_prompt", params).await
}

async fn create_prompt(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_prompt", body).await
}

async fn update_prompt(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["id"] = serde_json::json!(id);
    ipc_proxy(state, scope.as_ref(), "update_prompt", params).await
}

async fn delete_prompt(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "delete_prompt", params).await
}

/// Seed ideas + agents into a tenant's workspace.
/// Called by the platform after company provisioning.
async fn seed_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "seed_ideas", body).await
}
