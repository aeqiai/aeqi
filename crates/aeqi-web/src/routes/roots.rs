use axum::{
    Json, Router,
    extract::{Query, State},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::auth::Claims;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/roots", get(list_roots).post(create_root))
        .route("/roots/{name}", axum::routing::put(update_root_handler))
        .route("/roots/{name}/knowledge", get(root_knowledge))
        .route("/knowledge/channel", get(channel_knowledge))
        .route("/knowledge/store", post(knowledge_store))
        .route("/knowledge/delete", post(knowledge_delete))
}

async fn list_roots(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "roots", serde_json::Value::Null).await
}

async fn create_root(
    State(state): State<AppState>,
    scope: Scope,
    req: axum::extract::Request,
) -> Response {
    // Extract claims and body.
    let claims = req.extensions().get::<Claims>().cloned();
    let body: serde_json::Value = match axum::body::to_bytes(req.into_body(), 1_048_576).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    };

    let resp = ipc_proxy(state.clone(), scope.as_ref(), "create_root", body.clone()).await;

    // Link root agent to user in accounts store.
    if let (Some(accounts), Some(claims)) = (&state.accounts, &claims)
        && let Some(user_id) = claims.user_id.as_deref()
        && let Some(name) = body.get("name").and_then(|v| v.as_str())
    {
        let _ = accounts.add_director(user_id, name);
    }

    resp
}

async fn update_root_handler(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["name"] = serde_json::Value::String(name);
    ipc_proxy(state, scope.as_ref(), "update_root", params).await
}

async fn root_knowledge(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "project_knowledge",
        serde_json::json!({"project": name}),
    )
    .await
}

#[derive(Deserialize, Default)]
struct ChannelKnowledgeQuery {
    project: Option<String>,
    query: Option<String>,
    limit: Option<u64>,
}

async fn channel_knowledge(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ChannelKnowledgeQuery>,
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
    ipc_proxy(state, scope.as_ref(), "channel_knowledge", params).await
}

async fn knowledge_store(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "knowledge_store", body).await
}

async fn knowledge_delete(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "knowledge_delete", body).await
}
