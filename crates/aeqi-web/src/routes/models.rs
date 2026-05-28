//! Read-only catalog of available models the UI picker renders.
//!
//! Self-hosted runtimes get the provider-agnostic catalog. Hosted DeepSeek
//! tenant proxies get the constrained platform catalog so the UI cannot offer
//! models the platform proxy will reject at inference time.

use aeqi_providers::catalog;
use axum::{Json, Router, extract::State, response::IntoResponse, routing::get};

use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/models", get(models_list))
}

async fn models_list(State(state): State<AppState>) -> impl IntoResponse {
    let models = match &state.model_catalog_policy.model_ids {
        Some(ids) => ids
            .iter()
            .filter_map(|id| catalog::find(id))
            .collect::<Vec<_>>(),
        None => catalog::all().iter().collect::<Vec<_>>(),
    };

    Json(serde_json::json!({
        "ok": true,
        "models": models,
        "allow_custom": state.model_catalog_policy.allow_custom,
        "scope": state.model_catalog_policy.scope,
    }))
}
