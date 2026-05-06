use axum::{Json, Router, extract::State, response::Response, routing::get};

use super::helpers::ipc_proxy;
use crate::auth::Claims;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/entities", get(list_entities).post(create_entity))
        .route(
            "/entities/{name}",
            axum::routing::put(update_entity_handler),
        )
        // In-app, Slack-style channels — Phase-1 of the Channels surface.
        // Distinct from `/channels/*` which routes transport channels
        // (Telegram / WhatsApp / Slack-app webhook bindings).
        .route(
            "/entities/{entity_id}/channels",
            get(list_entity_channels).post(create_entity_channel),
        )
        // Legacy alias — kept for one transition window so running clients
        // that still send /roots don't 404. Forwards to the legacy IPC commands
        // which now read from the same entity store underneath.
        .route("/roots", get(list_roots_legacy).post(create_root_legacy))
        .route(
            "/roots/{name}",
            axum::routing::put(update_root_legacy_handler),
        )
}

async fn list_entity_channels(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(entity_id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_channels_for_entity",
        serde_json::json!({"entity_id": entity_id}),
    )
    .await
}

async fn create_entity_channel(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(entity_id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["entity_id"] = serde_json::Value::String(entity_id);
    ipc_proxy(state, scope.as_ref(), "create_channel", params).await
}

async fn list_entities(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "entities", serde_json::Value::Null).await
}

async fn create_entity(
    State(state): State<AppState>,
    scope: Scope,
    req: axum::extract::Request,
) -> Response {
    // Extract claims and body.
    let claims = req.extensions().get::<Claims>().cloned();
    let body: serde_json::Value = match axum::body::to_bytes(req.into_body(), 1_048_576).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    };

    let resp = ipc_proxy(state.clone(), scope.as_ref(), "create_entity", body.clone()).await;

    // Link root agent to user in accounts store.
    if let (Some(accounts), Some(claims)) = (&state.accounts, &claims)
        && let Some(user_id) = claims.user_id.as_deref()
        && let Some(name) = body.get("name").and_then(|v| v.as_str())
    {
        let _ = accounts.add_director(user_id, name);
    }

    resp
}

async fn update_entity_handler(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["name"] = serde_json::Value::String(name);
    ipc_proxy(state, scope.as_ref(), "update_entity", params).await
}

// ── Legacy /roots handlers (transition window) ───────────────────────────────

async fn list_roots_legacy(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "roots", serde_json::Value::Null).await
}

async fn create_root_legacy(
    State(state): State<AppState>,
    scope: Scope,
    req: axum::extract::Request,
) -> Response {
    let claims = req.extensions().get::<Claims>().cloned();
    let body: serde_json::Value = match axum::body::to_bytes(req.into_body(), 1_048_576).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null),
        Err(_) => serde_json::Value::Null,
    };

    let resp = ipc_proxy(state.clone(), scope.as_ref(), "create_root", body.clone()).await;

    if let (Some(accounts), Some(claims)) = (&state.accounts, &claims)
        && let Some(user_id) = claims.user_id.as_deref()
        && let Some(name) = body.get("name").and_then(|v| v.as_str())
    {
        let _ = accounts.add_director(user_id, name);
    }

    resp
}

async fn update_root_legacy_handler(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["name"] = serde_json::Value::String(name);
    ipc_proxy(state, scope.as_ref(), "update_root", params).await
}
