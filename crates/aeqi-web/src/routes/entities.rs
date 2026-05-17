use axum::{
    Json, Router, extract::State, response::IntoResponse, response::Response, routing::get,
};

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
            "/entities/{trust_id}/channels",
            get(list_entity_channels).post(create_entity_channel),
        )
}

async fn list_entity_channels(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(trust_id): axum::extract::Path<String>,
) -> Response {
    ipc_proxy(
        state,
        scope.as_ref(),
        "list_channels_for_entity",
        serde_json::json!({"trust_id": trust_id}),
    )
    .await
}

async fn create_entity_channel(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(trust_id): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["trust_id"] = serde_json::Value::String(trust_id);
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

    let mut params = if body.is_null() {
        serde_json::json!({})
    } else {
        body
    };
    if let Some(scope_ref) = scope.as_ref() {
        params["allowed_roots"] = serde_json::json!(scope_ref.roots);
        if let Some(uid) = scope_ref.user_id.as_deref() {
            params["caller_user_id"] = serde_json::Value::String(uid.to_string());
        }
    }

    let resp = match if params.is_null() || params.as_object().is_some_and(|m| m.is_empty()) {
        state.ipc.cmd("create_entity").await
    } else {
        state.ipc.cmd_with("create_entity", params.clone()).await
    } {
        Ok(resp) => resp,
        Err(e) => {
            return (
                axum::http::StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"ok": false, "error": e.to_string()})),
            )
                .into_response();
        }
    };

    if resp.get("ok") == Some(&serde_json::Value::Bool(true))
        && let (Some(accounts), Some(claims)) = (&state.accounts, &claims)
        && let Some(user_id) = claims.user_id.as_deref()
        && let Some(trust_id) = resp.get("id").and_then(|v| v.as_str())
        && let Err(err) = accounts.add_director(user_id, trust_id)
    {
        tracing::warn!(
            user_id,
            trust_id,
            "create_entity: failed to link entity to user: {err}"
        );
    }

    Json(resp).into_response()
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
