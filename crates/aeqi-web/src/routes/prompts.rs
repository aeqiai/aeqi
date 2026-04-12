use axum::{
    Json, Router,
    extract::State,
    response::Response,
};

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ideas/seed", axum::routing::post(seed_ideas))
}

/// Seed ideas + agents into a tenant's workspace.
/// Called by the platform after company provisioning.
async fn seed_ideas(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "seed_ideas", body).await
}
