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
        .route("/chat", post(chat))
        .route("/chat/full", post(chat_full))
        .route("/chat/poll/{quest_id}", get(chat_poll))
        .route("/chat/history", get(chat_history))
        .route("/chat/timeline", get(chat_timeline))
        .route("/chat/channels", get(chat_channels))
}

async fn chat(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "chat", body).await
}

async fn chat_full(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "chat_full", body).await
}

async fn chat_poll(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(quest_id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "chat_poll",
        serde_json::json!({"quest_id": quest_id}),
    )
    .await
}

#[derive(Deserialize, Default)]
struct ChatHistoryQuery {
    chat_id: Option<i64>,
    project: Option<String>,
    channel_name: Option<String>,
    agent_id: Option<String>,
    limit: Option<u64>,
    offset: Option<u64>,
}

async fn chat_history(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ChatHistoryQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(chat_id) = q.chat_id {
        params["chat_id"] = serde_json::json!(chat_id);
    }
    if let Some(project) = &q.project {
        params["project"] = serde_json::Value::String(project.clone());
    }
    if let Some(channel_name) = &q.channel_name {
        params["channel_name"] = serde_json::Value::String(channel_name.clone());
    }
    if let Some(agent_id) = &q.agent_id {
        params["agent_id"] = serde_json::Value::String(agent_id.clone());
    }
    if let Some(limit) = q.limit {
        params["limit"] = serde_json::json!(limit);
    }
    if let Some(offset) = q.offset {
        params["offset"] = serde_json::json!(offset);
    }
    ipc_proxy(state, scope.as_ref(), "chat_history", params).await
}

async fn chat_timeline(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ChatHistoryQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(chat_id) = q.chat_id {
        params["chat_id"] = serde_json::json!(chat_id);
    }
    if let Some(project) = &q.project {
        params["project"] = serde_json::Value::String(project.clone());
    }
    if let Some(channel_name) = &q.channel_name {
        params["channel_name"] = serde_json::Value::String(channel_name.clone());
    }
    if let Some(limit) = q.limit {
        params["limit"] = serde_json::json!(limit);
    }
    if let Some(offset) = q.offset {
        params["offset"] = serde_json::json!(offset);
    }
    ipc_proxy(state, scope.as_ref(), "chat_timeline", params).await
}

async fn chat_channels(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "chat_channels",
        serde_json::Value::Null,
    )
    .await
}
