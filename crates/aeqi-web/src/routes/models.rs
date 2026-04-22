//! Read-only catalog of available models the UI picker renders.
//!
//! The catalog is provider-agnostic — slugs are logical (`family/model-id`),
//! not transport-specific. The orchestrator decides which backend (Anthropic
//! direct, OpenRouter, Ollama, or future own-inference) actually handles a
//! given slug at inference time.

use aeqi_providers::catalog;
use axum::{Json, Router, response::IntoResponse, routing::get};

use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/models", get(models_list))
}

async fn models_list() -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "models": catalog::all(),
    }))
}
