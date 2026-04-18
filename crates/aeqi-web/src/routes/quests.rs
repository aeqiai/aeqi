use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::Response,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use super::helpers::{ipc_proxy, merge_path_id, query_to_params};
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/quests", get(quests).post(create_quest))
        .route("/quests/{id}", get(get_quest).put(update_quest))
        .route("/quests/{id}/close", post(close_quest))
        .route(
            "/quests/presets/feature-dev",
            post(create_feature_dev_preset),
        )
}

#[derive(Deserialize, Serialize, Default)]
struct QuestsQuery {
    project: Option<String>,
    status: Option<String>,
}

async fn quests(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<QuestsQuery>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "quests", query_to_params(&q)).await
}

async fn create_quest(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "create_quest", body).await
}

async fn get_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "get_quest",
        serde_json::json!({"id": id}),
    )
    .await
}

async fn update_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "update_quest",
        merge_path_id(body, "id", id),
    )
    .await
}

async fn close_quest(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "close_quest",
        merge_path_id(body, "quest_id", id),
    )
    .await
}

/// Body expected by `POST /api/quests/presets/feature-dev`.
#[derive(Deserialize)]
struct FeatureDevPresetBody {
    subject: String,
    project: String,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
}

/// Create a quest using the `feature-dev` preset template.
///
/// The preset pre-fills `description` and `acceptance_criteria` with the
/// 7-phase workflow.  All other quest-creation logic (agent resolution,
/// rate limiting, ID generation) is handled by the existing `create_quest`
/// IPC command.
///
/// Demo:
/// ```text
/// curl -s -X POST http://localhost:8443/api/quests/presets/feature-dev \
///   -H 'Content-Type: application/json' \
///   -d '{"subject":"add widget API","project":"myproject"}'
/// ```
async fn create_feature_dev_preset(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<FeatureDevPresetBody>,
) -> Response {
    let preset = aeqi_quests::feature_dev_preset(&body.subject);

    let mut params = serde_json::json!({
        "project": body.project,
        "subject": preset.subject,
        "description": preset.description,
        "acceptance_criteria": preset.acceptance_criteria,
        "labels": preset.labels,
    });

    if let Some(agent) = body.agent {
        params["agent"] = serde_json::Value::String(agent);
    }
    if let Some(agent_id) = body.agent_id {
        params["agent_id"] = serde_json::Value::String(agent_id);
    }

    ipc_proxy(state, scope.as_ref(), "create_quest", params).await
}
