//! Architect HTTP routes (runtime-side).
//!
//! Two POST endpoints map onto the orchestrator IPC verbs declared in
//! `crates/aeqi-orchestrator/src/ipc/architect.rs`:
//!
//! - `POST /api/architect/draft` — generate a Blueprint from a free-text brief
//! - `POST /api/architect/refine` — apply an instruction to an existing draft
//!
//! `POST /api/architect/deploy` is owned by **aeqi-platform**, not the
//! runtime. The deploy path needs to write `runtime_placements`, spawn
//! the sandbox, and fire on-chain COMPANY provisioning — all platform-side
//! responsibilities. The platform handler ferries the architect's inline
//! blueprint into the freshly-spawned runtime via the `spawn_blueprint`
//! IPC verb's `inline_blueprint` payload (see
//! `aeqi-platform/src/routes/architect.rs`).
//!
//! Phase 1 is request/response.

use axum::{Json, Router, extract::State, response::Response, routing::post};

use super::helpers::ipc_proxy_with_timeout;
use crate::extractors::Scope;
use crate::server::AppState;

/// Architect verbs front an LLM call; the default 10s IPC timeout is
/// too aggressive. Refine has an inner 90s deadline to absorb slow
/// OpenRouter shards (the body-decode failure mode that hit Wave 35
/// multi-turn); the IPC timeout sits above that with a small overhead
/// allowance so the IPC layer never wins the race.
const ARCHITECT_IPC_TIMEOUT_SECS: u64 = 100;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/architect/draft", post(architect_draft))
        .route("/architect/refine", post(architect_refine))
}

async fn architect_draft(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy_with_timeout(
        state,
        scope.as_ref(),
        "architect.draft",
        body,
        ARCHITECT_IPC_TIMEOUT_SECS,
    )
    .await
}

async fn architect_refine(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy_with_timeout(
        state,
        scope.as_ref(),
        "architect.refine",
        body,
        ARCHITECT_IPC_TIMEOUT_SECS,
    )
    .await
}
