use axum::{Json, Router, extract::State, response::Response, routing::get};

use super::helpers::ipc_proxy;
use crate::auth::Claims;
use crate::extractors::Scope;
use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/roots", get(list_roots).post(create_root))
        .route("/roots/{name}", axum::routing::put(update_root_handler))
}

async fn list_roots(State(state): State<AppState>, scope: Scope) -> Response {
    ipc_proxy(state, scope.as_ref(), "roots", serde_json::Value::Null).await
}

async fn create_root(
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

    let resp = ipc_proxy(state.clone(), scope.as_ref(), "create_root", body.clone()).await;

    // Link root agent to user in accounts store.
    if let (Some(accounts), Some(claims)) = (&state.accounts, &claims)
        && let Some(user_id) = claims.user_id.as_deref()
        && let Some(name) = body.get("name").and_then(|v| v.as_str())
    {
        let _ = accounts.add_director(user_id, name);
    }

    resp
}

async fn update_root_handler(
    State(state): State<AppState>,
    scope: Scope,
    axum::extract::Path(name): axum::extract::Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut params = body;
    params["name"] = serde_json::Value::String(name);
    ipc_proxy(state, scope.as_ref(), "update_root", params).await
}
