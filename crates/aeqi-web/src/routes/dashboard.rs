use axum::{
    Json, Router,
    extract::{Query, State},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/status", get(status))
        .route("/dashboard", get(dashboard))
        .route("/cost", get(cost))
        .route("/activity", get(activity))
        .route("/activity/events", get(activity_events))
        // Keep old path for backward compat with existing clients.
        .route("/worker/events", get(activity_events))
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
    // Inject allowed_companies into each sub-query for tenant scoping.
    let scope_params = match scope.as_ref() {
        Some(s) => serde_json::json!({"allowed_companies": s.companies}),
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

#[derive(Deserialize, Default)]
struct ActivityQuery {
    project: Option<String>,
    last: Option<u32>,
}

async fn activity(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ActivityQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::Value::String(project.clone());
    }
    if let Some(last) = q.last {
        params["last"] = serde_json::json!(last);
    }
    ipc_proxy(state, scope.as_ref(), "activity", params).await
}

#[derive(Deserialize, Default)]
struct ActivityEventsQuery {
    cursor: Option<u64>,
}

async fn activity_events(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ActivityEventsQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(cursor) = q.cursor {
        params["cursor"] = serde_json::json!(cursor);
    }
    ipc_proxy(state, scope.as_ref(), "worker_events", params).await
}

#[derive(Deserialize, Default)]
struct NotesQuery {
    project: Option<String>,
    limit: Option<u32>,
}

async fn notes(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<NotesQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::Value::String(project.clone());
    }
    if let Some(limit) = q.limit {
        params["limit"] = serde_json::json!(limit);
    }
    ipc_proxy(state, scope.as_ref(), "notes", params).await
}

async fn post_note_entry(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "post_notes", body).await
}

#[derive(Deserialize, Default)]
struct ExpertiseQuery {
    domain: Option<String>,
}

async fn expertise(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ExpertiseQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(domain) = &q.domain {
        params["domain"] = serde_json::Value::String(domain.clone());
    }
    ipc_proxy(state, scope.as_ref(), "expertise", params).await
}

async fn rate_limit(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "rate_limit", serde_json::Value::Null).await
}

#[derive(Deserialize, Default)]
struct ApprovalsQuery {
    status: Option<String>,
}

async fn approvals(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ApprovalsQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(status) = &q.status {
        params["status"] = serde_json::Value::String(status.clone());
    }
    ipc_proxy(state, scope.as_ref(), "approvals", params).await
}

async fn resolve_approval(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["approval_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "resolve_approval", params).await
}
