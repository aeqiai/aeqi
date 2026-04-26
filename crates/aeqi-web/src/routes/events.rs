use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/events", get(list_events).post(create_event))
        .route(
            "/events/{id}",
            get(get_event).put(update_event).delete(delete_event),
        )
        .route("/events/trigger", post(trigger_event))
        .route("/events/trace", get(list_trace).post(get_trace_detail))
        .route("/tools", get(list_tools))
}

async fn list_tools(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "list_tools", serde_json::json!({})).await
}

#[derive(Deserialize, Default)]
struct ListEventsQuery {
    agent_id: Option<String>,
}

async fn list_events(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListEventsQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(agent_id) = &q.agent_id {
        params["agent_id"] = serde_json::json!(agent_id);
    }
    ipc_proxy(state, scope.as_ref(), "list_events", params).await
}

async fn create_event(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_event", body).await
}

async fn get_event(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "get_event", params).await
}

async fn update_event(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["id"] = serde_json::json!(id);
    ipc_proxy(state, scope.as_ref(), "update_event", params).await
}

async fn delete_event(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    let params = serde_json::json!({"id": id});
    ipc_proxy(state, scope.as_ref(), "delete_event", params).await
}

async fn trigger_event(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "trigger_event", body).await
}

#[derive(Deserialize, Default)]
struct TraceQuery {
    session_id: Option<String>,
    event_name: Option<String>,
    pattern: Option<String>,
    limit: Option<u64>,
}

/// GET /events/trace
///   ?session_id=…             → invocations for one session
///   ?event_name=…&pattern=…   → invocations for one event across sessions
async fn list_trace(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<TraceQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(session_id) = &q.session_id {
        params["session_id"] = serde_json::json!(session_id);
    }
    if let Some(event_name) = &q.event_name {
        params["event_name"] = serde_json::json!(event_name);
    }
    if let Some(pattern) = &q.pattern {
        params["pattern"] = serde_json::json!(pattern);
    }
    if let Some(limit) = q.limit {
        params["limit"] = serde_json::json!(limit);
    }
    ipc_proxy(state, scope.as_ref(), "trace_events", params).await
}

/// POST /events/trace { invocation_id: int } → full step detail.
async fn get_trace_detail(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "trace_events", body).await
}
