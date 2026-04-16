use axum::{
    Json, Router,
    extract::{Query, State},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use super::helpers::{ipc_proxy, merge_path_id, query_to_params};
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/dashboard", get(dashboard))
        .route("/cost", get(cost))
        .route("/activity", get(activity))
        .route("/activity/events", get(activity_events))
        .route("/notes", get(notes).post(post_note_entry))
        .route("/expertise", get(expertise))
        .route("/rate-limit", get(rate_limit))
        .route("/approvals", get(approvals))
        .route("/approvals/{id}/resolve", post(resolve_approval))
}

async fn status(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "status", serde_json::Value::Null).await
}

async fn dashboard(State(state): State<AppState>, scope: Scope) -> Response {
    // Inject allowed_roots into each sub-query for tenant scoping.
    let scope_params = match scope.as_ref() {
        Some(s) => serde_json::json!({"allowed_roots": s.roots}),
        None => serde_json::json!({}),
    };
    let mut activity_params = serde_json::json!({"last": 10});
    if let Some(obj) = scope_params.as_object() {
        for (k, v) in obj {
            activity_params[k] = v.clone();
        }
    }
    let status = state
        .ipc
        .cmd_with("status", scope_params.clone())
        .await
        .ok();
    let activity = state.ipc.cmd_with("activity", activity_params).await.ok();
    let cost = state.ipc.cmd_with("cost", scope_params).await.ok();

    Json(serde_json::json!({
        "ok": true,
        "status": status,
        "recent_activity": activity.as_ref().and_then(|a| a.get("events")),
        "cost": cost,
    }))
    .into_response()
}

async fn cost(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "cost", serde_json::Value::Null).await
}

#[derive(Deserialize, Serialize, Default)]
struct ActivityQuery {
    project: Option<String>,
    last: Option<u32>,
}

async fn activity(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ActivityQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "activity", query_to_params(&q)).await
}

#[derive(Deserialize, Serialize, Default)]
struct ActivityEventsQuery {
    cursor: Option<u64>,
}

async fn activity_events(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ActivityEventsQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "worker_events", query_to_params(&q)).await
}

#[derive(Deserialize, Serialize, Default)]
struct NotesQuery {
    project: Option<String>,
    limit: Option<u32>,
}

async fn notes(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<NotesQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "notes", query_to_params(&q)).await
}

async fn post_note_entry(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "post_notes", body).await
}

#[derive(Deserialize, Serialize, Default)]
struct ExpertiseQuery {
    domain: Option<String>,
}

async fn expertise(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ExpertiseQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "expertise", query_to_params(&q)).await
}

async fn rate_limit(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "rate_limit", serde_json::Value::Null).await
}

#[derive(Deserialize, Serialize, Default)]
struct ApprovalsQuery {
    status: Option<String>,
}

async fn approvals(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ApprovalsQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "approvals", query_to_params(&q)).await
}

async fn resolve_approval(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "resolve_approval",
        merge_path_id(body, "approval_id", id),
    )
    .await
}
