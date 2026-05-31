//! HTTP routes for the budget primitive.
//!
//! Tenant-internal — every route proxies to the orchestrator IPC verb of
//! the same name (per `architecture_role_budget_canonical.md`). The auth
//! model lives in the IPC handler; this file is a thin shim.
//!
//! Reads (`GET`):
//! - `GET    /budgets?company_id=…&owner_role_id=…&parent_budget_id=…&is_primary=…`
//! - `GET    /budgets/tree?company_id=…`
//! - `GET    /budgets/{id}`
//! - `GET    /budgets/{id}/allowance`
//! - `GET    /budgets/{id}/history?event_type=…&since=…&limit=…`
//!
//! Writes (`POST`):
//! - `POST   /budgets` — create
//! - `POST   /budgets/{id}/policy` — set_policy
//! - `POST   /budgets/{id}/allocate` — sub-allocate down to a child budget
//! - `POST   /budgets/{id}/spend` — treasury outflow
//! - `POST   /budgets/{id}/hire` — atomic role + budget + allocation
//! - `POST   /budgets/{id}/refresh` — permissionless epoch tick
//! - `POST   /budgets/{id}/dissolve`
//! - `POST   /companies/{company_id}/treasury/pause`
//! - `POST   /companies/{company_id}/treasury/config` — bootstrap gateway + admin role

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        // Specific routes BEFORE the parameterised GET to avoid axum 405
        // shadowing (per feedback_axum_route_method_shadowing.md).
        .route("/budgets", get(list_budgets).post(create_budget))
        .route("/budgets/tree", get(budget_tree))
        .route("/budgets/{id}", get(get_budget))
        .route("/budgets/{id}/allowance", get(get_allowance))
        .route("/budgets/{id}/history", get(allowance_history))
        .route("/budgets/{id}/policy", post(set_policy))
        .route("/budgets/{id}/allocate", post(allocate_allowance))
        .route("/budgets/{id}/spend", post(spend_treasury))
        .route("/budgets/{id}/hire", post(hire_role))
        .route("/budgets/{id}/refresh", post(refresh_allowance))
        .route("/budgets/{id}/dissolve", post(dissolve_budget))
        .route(
            "/companies/{company_id}/treasury/pause",
            post(pause_treasury),
        )
        .route(
            "/companies/{company_id}/treasury/config",
            post(init_treasury_config),
        )
}

#[derive(serde::Deserialize)]
struct ListQuery {
    company_id: Option<String>,
    owner_role_id: Option<String>,
    parent_budget_id: Option<String>,
    is_primary: Option<bool>,
}

async fn list_budgets(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListQuery>,
) -> Response {
    let company_id = q.company_id.unwrap_or_default();
    let mut body = serde_json::json!({"company_id": company_id});
    if let Some(o) = q.owner_role_id {
        body["owner_role_id"] = serde_json::Value::String(o);
    }
    if let Some(p) = q.parent_budget_id {
        body["parent_budget_id"] = serde_json::Value::String(p);
    }
    if let Some(b) = q.is_primary {
        body["is_primary"] = serde_json::Value::Bool(b);
    }
    ipc_proxy(state, scope.as_ref(), "list_budgets", body).await
}

#[derive(serde::Deserialize)]
struct TreeQuery {
    company_id: Option<String>,
}

async fn budget_tree(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<TreeQuery>,
) -> Response {
    let company_id = q.company_id.unwrap_or_default();
    ipc_proxy(
        state,
        scope.as_ref(),
        "budget_tree",
        serde_json::json!({"company_id": company_id}),
    )
    .await
}

async fn get_budget(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "get_budget",
        serde_json::json!({"budget_id": id}),
    )
    .await
}

async fn get_allowance(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "get_allowance",
        serde_json::json!({"budget_id": id}),
    )
    .await
}

#[derive(serde::Deserialize)]
struct HistoryQuery {
    event_type: Option<String>,
    since: Option<String>,
    limit: Option<i64>,
}

async fn allowance_history(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Query(q): Query<HistoryQuery>,
) -> Response {
    let mut body = serde_json::json!({"budget_id": id});
    if let Some(e) = q.event_type {
        body["event_type"] = serde_json::Value::String(e);
    }
    if let Some(s) = q.since {
        body["since"] = serde_json::Value::String(s);
    }
    if let Some(l) = q.limit {
        body["limit"] = serde_json::Value::Number(l.into());
    }
    ipc_proxy(state, scope.as_ref(), "allowance_history", body).await
}

async fn create_budget(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_budget", body).await
}

async fn set_policy(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["budget_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "set_policy", body).await
}

async fn allocate_allowance(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["parent_budget_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "allocate_allowance", body).await
}

async fn spend_treasury(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["budget_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "spend_treasury", body).await
}

async fn hire_role(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["parent_budget_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "hire_role", body).await
}

async fn refresh_allowance(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "refresh_allowance",
        serde_json::json!({"budget_id": id}),
    )
    .await
}

async fn dissolve_budget(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["budget_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "dissolve_budget", body).await
}

async fn pause_treasury(
    State(state): State<AppState>,
    scope: Scope,
    Path(company_id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["company_id"] = serde_json::Value::String(company_id);
    ipc_proxy(state, scope.as_ref(), "pause_treasury", body).await
}

async fn init_treasury_config(
    State(state): State<AppState>,
    scope: Scope,
    Path(company_id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["company_id"] = serde_json::Value::String(company_id);
    ipc_proxy(state, scope.as_ref(), "init_treasury_config", body).await
}
