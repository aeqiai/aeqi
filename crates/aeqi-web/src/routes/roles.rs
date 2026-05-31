use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::Value;

use super::helpers::ipc_proxy;
use crate::auth::UserScope;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/roles", get(list_roles).post(create_role))
        // Specific routes before the parameterised GET to avoid axum 405 shadowing.
        .route("/roles/grants", get(user_grants))
        .route("/roles/{id}", get(get_role))
        .route("/roles/{id}/occupant", post(change_occupant))
        .route("/roles/{id}/update", post(update_role))
        .route("/roles/{id}/edges", post(update_role_edges))
        .route("/roles/{id}/archive", post(archive_role))
}

#[derive(serde::Deserialize)]
struct ListQuery {
    company_id: Option<String>,
}

async fn list_roles(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<ListQuery>,
) -> Response {
    let company_id = q.company_id.unwrap_or_default();
    let mut resp = match ipc_value(
        &state,
        scope.as_ref(),
        "list_roles",
        serde_json::json!({"company_id": company_id}),
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    enrich_roles_response(&state, &mut resp);
    Json(resp).into_response()
}

async fn get_role(State(state): State<AppState>, scope: Scope, Path(id): Path<String>) -> Response {
    let mut resp = match ipc_value(
        &state,
        scope.as_ref(),
        "get_role",
        serde_json::json!({"role_id": id}),
    )
    .await
    {
        Ok(value) => value,
        Err(response) => return response,
    };
    if let Some(role) = resp.get_mut("role") {
        enrich_role(&state, role);
    }
    Json(resp).into_response()
}

async fn create_role(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_role", body).await
}

/// POST /api/roles/:id/update
///
/// Body: `{ "title"?, "role_type"?, "grants"?, "description_idea_id"? }`
///
/// Gates on `roles.manage` (enforced in the IPC handler via `caller_user_id`
/// injected by `ipc_proxy`).
async fn update_role(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "update_role", body).await
}

/// POST /api/roles/:id/edges
///
/// Body: `{ "parent_role_ids"?, "child_role_ids"? }`
///
/// Each present array replaces that edge side exactly. Gates on
/// `roles.manage`.
async fn update_role_edges(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "update_role_edges", body).await
}

/// POST /api/roles/:id/archive
///
/// Gates on `roles.manage`.
async fn archive_role(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    body: Option<Json<serde_json::Value>>,
) -> Response {
    let mut params = body.map(|b| b.0).unwrap_or_else(|| serde_json::json!({}));
    params["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "archive_role", params).await
}

/// POST /api/roles/:id/occupant
///
/// Body: `{ "occupant_kind": "human"|"agent"|"vacant", "occupant_id": "<id>" }`
///
/// Proxies to the `change_occupant` IPC command, which:
///   - Updates the role row.
///   - Rotates participant sets on every anchored session.
///   - Appends a system hand-off message in each session.
///
/// Gates on `roles.manage` (caller_user_id injected by ipc_proxy).
async fn change_occupant(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(mut body): Json<serde_json::Value>,
) -> Response {
    body["role_id"] = serde_json::Value::String(id);
    ipc_proxy(state, scope.as_ref(), "change_occupant", body).await
}

/// GET /api/roles/grants?company_id=X&user_id=Y
///
/// Returns the union of grants for the given user at the given entity.
#[derive(serde::Deserialize)]
struct GrantsQuery {
    company_id: Option<String>,
    user_id: Option<String>,
}

async fn user_grants(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<GrantsQuery>,
) -> Response {
    let company_id = match q.company_id.filter(|s| !s.is_empty()) {
        Some(id) => id,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"ok": false, "error": "company_id is required"})),
            )
                .into_response();
        }
    };
    let user_id = match q.user_id.filter(|s| !s.is_empty()) {
        Some(id) => id,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"ok": false, "error": "user_id is required"})),
            )
                .into_response();
        }
    };
    ipc_proxy(
        state,
        scope.as_ref(),
        "user_grants",
        serde_json::json!({"company_id": company_id, "user_id": user_id}),
    )
    .await
}

fn scoped_params(scope: Option<&UserScope>, mut params: Value) -> Value {
    if let Some(scope) = scope {
        if params.is_null() || params.as_object().is_some_and(|m| m.is_empty()) {
            params = serde_json::json!({});
        }
        params["allowed_roots"] = serde_json::json!(scope.roots);
        if let Some(uid) = scope.user_id.as_deref() {
            params["caller_user_id"] = Value::String(uid.to_string());
        }
    }
    params
}

async fn ipc_value(
    state: &AppState,
    scope: Option<&UserScope>,
    cmd: &str,
    params: Value,
) -> Result<Value, Response> {
    let params = scoped_params(scope, params);
    match state.ipc.cmd_with(cmd, params).await {
        Ok(resp) => {
            if resp.get("ok") == Some(&Value::Bool(false))
                && let Some(code) = resp.get("code").and_then(|v| v.as_str())
            {
                let status = match code {
                    "conflict" => Some(StatusCode::CONFLICT),
                    "not_found" => Some(StatusCode::NOT_FOUND),
                    _ => None,
                };
                if let Some(status) = status {
                    return Err((status, Json(resp)).into_response());
                }
            }
            Ok(resp)
        }
        Err(e) => Err((
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response()),
    }
}

fn enrich_roles_response(state: &AppState, resp: &mut Value) {
    let Some(roles) = resp.get_mut("roles").and_then(Value::as_array_mut) else {
        return;
    };
    for role in roles {
        enrich_role(state, role);
    }
}

fn enrich_role(state: &AppState, role: &mut Value) {
    if role.get("occupant_kind").and_then(Value::as_str) != Some("human") {
        return;
    }
    let Some(user_id) = role
        .get("occupant_id")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    let Some(accounts) = state.accounts.as_ref() else {
        return;
    };

    if let Ok(Some(user)) = accounts.get_user_by_id(&user_id) {
        if !user.name.is_empty() {
            role["occupant_name"] = Value::String(user.name.clone());
        } else {
            role["occupant_name"] = Value::String(user.email.clone());
        }
        if let Some(avatar_url) = user.avatar_url.clone() {
            role["occupant_avatar_url"] = Value::String(avatar_url);
        }
    }

    if let Ok(Some(last_active)) = accounts.get_user_last_active(&user_id) {
        role["occupant_last_active"] = Value::String(last_active);
    }
}
