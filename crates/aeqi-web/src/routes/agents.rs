use axum::{
    Json, Router,
    extract::{Path, Query, State},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;

use super::helpers::ipc_proxy;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/agents", get(agents))
        .route("/agents/registry", get(agents_registry))
        .route("/agents/spawn", post(agents_spawn))
        .route("/agents/{id}/retire", post(agent_retire))
        .route("/agents/{id}/activate", post(agent_activate))
        .route("/agents/{id}/model", axum::routing::put(agent_set_model))
        .route("/agents/{name}/identity", get(agent_identity))
        .route("/agents/{name}/prompts", get(agent_prompts))
        .route("/agents/{name}/files", post(save_agent_file))
}

async fn agents(State(state): State<AppState>, scope: Scope) -> Response {
    let allowed = scope.as_ref();
    let agents_config: Vec<serde_json::Value> = state
        .agents_config
        .iter()
        .filter(|a| {
            // When scoped, only show agents matching allowed companies.
            match allowed {
                Some(s) => s.companies.iter().any(|c| c == &a.name || c == &a.prefix),
                None => true,
            }
        })
        .map(|a| {
            serde_json::json!({
                "name": a.name,
                "prefix": a.prefix,
                "model": a.model,
                "role": a.role,
                "expertise": a.expertise,
            })
        })
        .collect();

    let expertise = state.ipc.cmd("expertise").await.ok();
    let scores = expertise
        .as_ref()
        .and_then(|e| e.get("scores"))
        .and_then(|s| s.as_array());

    let enriched: Vec<serde_json::Value> = agents_config
        .into_iter()
        .map(|mut agent| {
            if let (Some(name), Some(scores)) = (agent.get("name").and_then(|n| n.as_str()), scores)
            {
                let agent_scores: Vec<&serde_json::Value> = scores
                    .iter()
                    .filter(|s| s.get("agent").and_then(|a| a.as_str()) == Some(name))
                    .collect();
                if !agent_scores.is_empty() {
                    agent["expertise_scores"] = serde_json::json!(agent_scores);
                }
            }
            agent
        })
        .collect();

    Json(serde_json::json!({"ok": true, "agents": enriched})).into_response()
}

async fn agent_set_model(
    State(state): State<AppState>,
    scope: Scope,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["id"] = serde_json::json!(id);
    ipc_proxy(state, scope.as_ref(), "agent_set_model", params).await
}

#[derive(Deserialize, Default)]
struct RegistryQuery {
    project: Option<String>,
    status: Option<String>,
}

async fn agents_registry(
    State(state): State<AppState>,
    scope: Scope,
    Query(q): Query<RegistryQuery>,
) -> Response {
    let mut params = serde_json::json!({});
    if let Some(project) = &q.project {
        params["project"] = serde_json::Value::String(project.clone());
    }
    if let Some(status) = &q.status {
        params["status"] = serde_json::Value::String(status.clone());
    }
    ipc_proxy(state, scope.as_ref(), "agents_registry", params).await
}

async fn agents_spawn(
    State(state): State<AppState>,
    scope: Scope,
    Json(body): Json<serde_json::Value>,
) -> Response {
    ipc_proxy(state, scope.as_ref(), "agent_spawn", body).await
}

async fn agent_retire(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_set_status",
        serde_json::json!({"name": id, "status": "retired"}),
    )
    .await
}

async fn agent_activate(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_set_status",
        serde_json::json!({"name": id, "status": "active"}),
    )
    .await
}

async fn agent_identity(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_identity",
        serde_json::json!({"name": name}),
    )
    .await
}

async fn agent_prompts(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "agent_info",
        serde_json::json!({"name": name}),
    )
    .await
}

async fn save_agent_file(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["name"] = serde_json::Value::String(name);
    ipc_proxy(state, scope.as_ref(), "save_agent_file", params).await
}
