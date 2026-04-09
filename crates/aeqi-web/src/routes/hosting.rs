use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde::Deserialize;

use crate::extractors::Scope;
use crate::server::AppState;
use super::helpers::hosting_deny_if_scoped;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/hosting/apps", get(hosting_list_apps).post(hosting_deploy_app))
        .route("/hosting/apps/{id}", delete(hosting_stop_app))
        .route("/hosting/apps/{id}/restart", post(hosting_restart_app))
        .route("/hosting/domains", get(hosting_list_domains).post(hosting_add_domain))
        .route("/hosting/domains/{domain}", delete(hosting_remove_domain))
}

async fn hosting_list_apps(State(state): State<AppState>, scope: Scope) -> Response {
    if let Some(r) = hosting_deny_if_scoped(&scope) { return r; }
    match state.hosting.list_apps().await {
        Ok(apps) => Json(serde_json::json!({"ok": true, "apps": apps})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn hosting_deploy_app(
    State(state): State<AppState>,
    scope: Scope,
    Json(config): Json<aeqi_hosting::AppConfig>,
) -> Response {
    if let Some(r) = hosting_deny_if_scoped(&scope) { return r; }
    match state.hosting.deploy_app(&config).await {
        Ok(deployment) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"ok": true, "deployment": deployment})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn hosting_stop_app(State(state): State<AppState>, scope: Scope, Path(id): Path<String>) -> Response {
    if let Some(r) = hosting_deny_if_scoped(&scope) { return r; }
    match state.hosting.stop_app(&id).await {
        Ok(()) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn hosting_restart_app(State(state): State<AppState>, scope: Scope, Path(id): Path<String>) -> Response {
    if let Some(r) = hosting_deny_if_scoped(&scope) { return r; }
    match state.hosting.restart_app(&id).await {
        Ok(()) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn hosting_list_domains(State(state): State<AppState>, scope: Scope) -> Response {
    if let Some(r) = hosting_deny_if_scoped(&scope) { return r; }
    match state.hosting.list_domains().await {
        Ok(domains) => Json(serde_json::json!({"ok": true, "domains": domains})).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct AddDomainRequest {
    domain: String,
    app_id: String,
}

async fn hosting_add_domain(
    State(state): State<AppState>,
    scope: Scope,
    Json(req): Json<AddDomainRequest>,
) -> Response {
    if let Some(r) = hosting_deny_if_scoped(&scope) { return r; }
    match state.hosting.add_domain(&req.domain, &req.app_id).await {
        Ok(info) => (
            StatusCode::CREATED,
            Json(serde_json::json!({"ok": true, "domain": info})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}

async fn hosting_remove_domain(
    State(state): State<AppState>,
    scope: Scope,
    Path(domain): Path<String>,
) -> Response {
    if let Some(r) = hosting_deny_if_scoped(&scope) { return r; }
    match state.hosting.remove_domain(&domain).await {
        Ok(()) => Json(serde_json::json!({"ok": true})).into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}
