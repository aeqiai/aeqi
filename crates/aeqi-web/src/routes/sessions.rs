use axum::{
    Json, Router,
    extract::{Query, State},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sessions", get(sessions).post(create_session))
        .route("/sessions/{id}/close", post(close_session))
        .route("/sessions/{id}/cancel", post(cancel_session))
        .route("/sessions/{id}/fork", post(fork_session))
        .route("/sessions/{id}/messages", get(session_messages))
        .route("/sessions/{id}/children", get(session_children))
        .route("/session/send", post(session_send))
        .route("/channel-sessions", get(channel_sessions))
}

#[derive(Deserialize, Default)]
struct SessionsQuery {
    agent_id: Option<String>,
}

async fn sessions(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<SessionsQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(agent_id) = &q.agent_id {
        params["agent_id"] = serde_json::Value::String(agent_id.clone());
    }
    ipc_proxy(state, scope.as_ref(), "list_sessions", params).await
}

async fn create_session(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_session", body).await
}

async fn close_session(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "close_session",
        serde_json::json!({"session_id": id}),
    )
    .await
}

async fn fork_session(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["session_id"] = serde_json::json!(id);
    ipc_proxy(state, scope.as_ref(), "session_fork", params).await
}

async fn cancel_session(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "session_cancel",
        serde_json::json!({"session_id": id}),
    )
    .await
}

#[derive(Deserialize, Default)]
struct SessionMessagesQuery {
    limit: Option<u64>,
}

async fn session_messages(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
    Query(q): Query<SessionMessagesQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(50);
    ipc_proxy(
        state,
        scope.as_ref(),
        "session_messages",
        serde_json::json!({"session_id": id, "limit": limit}),
    )
    .await
}

async fn session_children(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "session_children",
        serde_json::json!({"session_id": id}),
    )
    .await
}

async fn session_send(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "session_send", body).await
}

#[derive(Deserialize, Default)]
struct ChannelSessionsQuery {
    agent_id: Option<String>,
}

async fn channel_sessions(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ChannelSessionsQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(agent_id) = &q.agent_id {
        params["agent_id"] = serde_json::Value::String(agent_id.clone());
    }
    ipc_proxy(state, scope.as_ref(), "list_channel_sessions", params).await
}
