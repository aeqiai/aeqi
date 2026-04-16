use aeqi_core::config::AuthMode;
use axum::{
    extract::{Query, State, WebSocketUpgrade},
    http::HeaderMap,
    response::Response,
};
use serde::Deserialize;
use tracing::info;

use crate::auth;
use crate::server::AppState;

#[derive(Deserialize, Default)]
pub struct WsQuery {
    token: Option<String>,
}

/// WebSocket upgrade handler.
pub async fn handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    // Validate token from query param, dispatching by auth mode.
    // Also resolve user's root agents for tenant scoping when in Accounts mode.
    let mut user_roots: Option<Vec<String>> = None;

    match state.auth_mode {
        AuthMode::None => {
            user_roots = auth::proxy_scope_from_headers(&state, &headers).map(|s| s.roots);
        }
        AuthMode::Secret | AuthMode::Accounts => {
            let secret = auth::signing_secret(&state);
            let token = q.token.as_deref().unwrap_or("");
            match auth::validate_token(token, secret) {
                Ok(claims) => {
                    // Resolve user's root agents for tenant scoping.
                    if let Some(accounts) = &state.accounts {
                        let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
                        user_roots = accounts
                            .get_user_by_id(user_id)
                            .ok()
                            .flatten()
                            .and_then(|u| u.roots);
                    }
                }
                Err(_) => {
                    return axum::response::IntoResponse::into_response((
                        axum::http::StatusCode::UNAUTHORIZED,
                        "invalid or missing token",
                    ));
                }
            }
        }
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state, user_roots))
}

async fn handle_socket(
    mut socket: axum::extract::ws::WebSocket,
    state: AppState,
    user_roots: Option<Vec<String>>,
) {
    use axum::extract::ws::Message;

    info!("WebSocket client connected");

    // Build a reusable scope params object for IPC calls.
    let scope_params: serde_json::Value = match &user_roots {
        Some(roots) => serde_json::json!({"allowed_roots": roots}),
        None => serde_json::json!({}),
    };

    let poll_interval = std::time::Duration::from_secs(5);
    let mut interval = tokio::time::interval(poll_interval);
    let mut worker_cursor: Option<u64> = None;

    loop {
        tokio::select! {
            _ = interval.tick() => {
                // Poll daemon for status + worker progress.
                let status = state.ipc.cmd_with("status", scope_params.clone()).await;
                let workers = state.ipc.cmd_with("worker_progress", scope_params.clone()).await;
                let msg = match (status, workers) {
                    (Ok(data), Ok(wp)) => serde_json::json!({
                        "event": "status",
                        "data": data,
                        "workers": wp.get("workers").cloned().unwrap_or(serde_json::json!([])),
                    }),
                    (Ok(data), Err(_)) => serde_json::json!({"event": "status", "data": data}),
                    (Err(e), _) => serde_json::json!({"event": "error", "data": {"error": e.to_string()}}),
                };

                if let Ok(text) = serde_json::to_string(&msg)
                    && socket.send(Message::Text(text.into())).await.is_err()
                {
                    break;
                }

                // Poll and forward real-time worker execution events.
                let mut worker_req = match worker_cursor {
                    Some(cursor) => serde_json::json!({"cursor": cursor}),
                    None => serde_json::json!({}),
                };
                if let Some(ref roots) = user_roots {
                    worker_req["allowed_roots"] = serde_json::json!(roots);
                }
                if let Ok(events_resp) = state.ipc.cmd_with("worker_events", worker_req).await {
                    if let Some(next_cursor) = events_resp.get("next_cursor").and_then(|v| v.as_u64()) {
                        worker_cursor = Some(next_cursor);
                    }
                    if events_resp.get("reset").and_then(|v| v.as_bool()) == Some(true) {
                        let msg = serde_json::json!({
                            "event": "worker_gap",
                            "data": {
                                "oldest_cursor": events_resp.get("oldest_cursor").cloned().unwrap_or(serde_json::json!(null)),
                                "next_cursor": events_resp.get("next_cursor").cloned().unwrap_or(serde_json::json!(null)),
                            }
                        });
                        if let Ok(text) = serde_json::to_string(&msg)
                            && socket.send(Message::Text(text.into())).await.is_err()
                        {
                            break;
                        }
                    }
                    if let Some(events) = events_resp.get("events").and_then(|e| e.as_array()) {
                    for event in events {
                        let msg = serde_json::json!({"event": "worker", "data": event});
                        if let Ok(text) = serde_json::to_string(&msg)
                            && socket.send(Message::Text(text.into())).await.is_err()
                        {
                            break;
                        }
                    }
                    }
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Text(text))) => {
                        // Handle client requests — inject tenant scope before forwarding.
                        if let Ok(mut req) = serde_json::from_str::<serde_json::Value>(&text) {
                            let cmd = req.get("cmd").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            if let Some(ref roots) = user_roots {
                                req["allowed_roots"] = serde_json::json!(roots);
                            }
                            let result = state.ipc.request(&req).await;
                            let resp = match result {
                                Ok(data) => serde_json::json!({"event": cmd, "data": data}),
                                Err(e) => serde_json::json!({"event": "error", "data": {"error": e.to_string()}}),
                            };
                            if let Ok(text) = serde_json::to_string(&resp)
                                && socket.send(Message::Text(text.into())).await.is_err()
                            {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    info!("WebSocket client disconnected");
}
