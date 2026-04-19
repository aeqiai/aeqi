use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use super::helpers::{ipc_proxy, merge_path_id, query_to_params};
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/quests", get(quests).post(create_quest))
        .route("/quests/preflight", post(quest_preflight))
        .route("/quests/{id}", get(get_quest).put(update_quest))
        .route("/quests/{id}/close", post(close_quest))
        .route("/quests/{id}/traces", get(quest_traces))
        .route(
            "/quests/presets/feature-dev",
            post(create_feature_dev_preset),
        )
        .route("/quests/presets/bug-fix", post(create_bug_fix_preset))
        .route("/quests/presets/refactor", post(create_refactor_preset))
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

/// Return every captured tool-call trace for sessions bound to this quest.
///
/// This is the read-side of the closed learning loop (quest `lu-005`).
/// The response shape is `{ok, quest_id, count, traces}` where each
/// trace is `{session_id, tool_name, tool_use_id, success, input_preview,
/// output_preview, duration_ms, timestamp}`.
///
/// Demo:
/// ```text
/// curl -s http://localhost:8443/api/quests/lu-005/traces
/// ```
async fn quest_traces(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "quest_traces",
        serde_json::json!({"id": id}),
    )
    .await
}

/// Request body for `POST /api/quests/preflight`.
#[derive(Deserialize)]
struct PreflightBody {
    agent_id: String,
    description: String,
    #[serde(default)]
    task_idea_ids: Vec<String>,
}

/// Return the assembled system prompt and tool lists that would be used when
/// this quest starts — without creating anything. Lets the user inspect what
/// context the agent will receive before committing.
async fn quest_preflight(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<PreflightBody>,
) -> Response {
    if body.agent_id.trim().is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": "agent_id is required"})),
        )
            .into_response();
    }
    if body.description.trim().is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"ok": false, "error": "description is required"})),
        )
            .into_response();
    }
    ipc_proxy(
        state,
        scope.as_ref(),
        "quest_preflight",
        serde_json::json!({
            "agent_id": body.agent_id,
            "description": body.description,
            "task_idea_ids": body.task_idea_ids,
        }),
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

/// Body for `POST /api/quests/presets/bug-fix`. `symptom` describes the user-visible failure.
#[derive(Deserialize)]
struct BugFixPresetBody {
    subject: String,
    project: String,
    symptom: String,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
}

/// Body for `POST /api/quests/presets/refactor`. `motivation` is why the refactor is worth the risk.
#[derive(Deserialize)]
struct RefactorPresetBody {
    subject: String,
    project: String,
    motivation: String,
    #[serde(default)]
    agent: Option<String>,
    #[serde(default)]
    agent_id: Option<String>,
}

fn preset_params(
    preset: aeqi_quests::QuestPreset,
    project: String,
    agent: Option<String>,
    agent_id: Option<String>,
) -> serde_json::Value {
    let mut params = serde_json::json!({
        "project": project,
        "subject": preset.subject,
        "description": preset.description,
        "acceptance_criteria": preset.acceptance_criteria,
        "labels": preset.labels,
    });
    if let Some(a) = agent {
        params["agent"] = serde_json::Value::String(a);
    }
    if let Some(a) = agent_id {
        params["agent_id"] = serde_json::Value::String(a);
    }
    params
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
    let params = preset_params(preset, body.project, body.agent, body.agent_id);
    ipc_proxy(state, scope.as_ref(), "create_quest", params).await
}

/// Create a quest using the `bug-fix` preset template (6 phases, root-cause biased).
async fn create_bug_fix_preset(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<BugFixPresetBody>,
) -> Response {
    let preset = aeqi_quests::bug_fix_preset(&body.subject, &body.symptom);
    let params = preset_params(preset, body.project, body.agent, body.agent_id);
    ipc_proxy(state, scope.as_ref(), "create_quest", params).await
}

/// Create a quest using the `refactor` preset template (5 phases, behaviour-preserving).
async fn create_refactor_preset(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<RefactorPresetBody>,
) -> Response {
    let preset = aeqi_quests::refactor_preset(&body.subject, &body.motivation);
    let params = preset_params(preset, body.project, body.agent, body.agent_id);
    ipc_proxy(state, scope.as_ref(), "create_quest", params).await
}
