use axum::{
    Json, Router,
    extract::{Path, State},
    response::Response,
    routing::{get, post},
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/templates", get(list_templates))
        .route("/templates/identities", get(list_identity_templates))
        .route("/templates/spawn", post(spawn_template))
        .route("/templates/{slug}", get(template_detail))
}

async fn list_templates(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_templates",
        serde_json::json!({}),
    )
    .await
}

async fn list_identity_templates(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_identity_templates",
        serde_json::json!({}),
    )
    .await
}

async fn template_detail(
    State(state): State<AppState>,
    scope: Scope,
    Path(slug): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "template_detail",
        serde_json::json!({"slug": slug}),
    )
    .await
}

async fn spawn_template(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "spawn_template", body).await
}
