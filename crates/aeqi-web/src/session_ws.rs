//! Streaming session WebSocket endpoint.
//!
//! Accepts user messages, submits them to the daemon via session_send with
//! streaming mode, forwarding ChatStreamEvents to the client in real-time.
//!
//! Protocol:
//! - Client sends: `{"message": "...", "agent": "...", "agent_id": "...", "session_id": "..."}`
//!   to dispatch a new user turn (queues + streams the response).
//! - Optional `session_ideas`, `quest_id`, and `files` fields are forwarded
//!   through to the daemon so turn-specific context survives the round trip.
//! - Client sends: `{"subscribe": true, "session_id": "..."}` to passively
//!   tail an already-running session (e.g. after a hard refresh). Routes to
//!   daemon's `session_subscribe` instead of `session_send`.
//! - Server streams: `{"type": "TextDelta", "text": "..."}` per token
//! - Server streams: `{"type": "ToolStart", ...}`, `{"type": "ToolComplete", ...}`
//! - Server sends final: `{"type": "Complete", "done": true, ...}`
//! - Connection stays open for next message (persistent session)

use aeqi_core::config::AuthMode;
use axum::{
    extract::{Query, State, WebSocketUpgrade},
    http::HeaderMap,
    response::Response,
};
use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tracing::info;

use crate::auth;
use crate::server::AppState;

#[derive(Deserialize, Default)]
pub struct SessionWsQuery {
    token: Option<String>,
}

pub async fn handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<SessionWsQuery>,
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

    ws.on_upgrade(move |socket| handle_session_socket(socket, state, user_roots))
}

async fn handle_session_socket(
    mut socket: axum::extract::ws::WebSocket,
    state: AppState,
    user_roots: Option<Vec<String>>,
) {
    use axum::extract::ws::Message;

    info!("Session WebSocket client connected");

    let mut session_id: Option<String> = None;

    loop {
        let request = match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                match serde_json::from_str::<serde_json::Value>(&text) {
                    Ok(v) => v,
                    Err(e) => {
                        let _ = socket
                            .send(Message::Text(
                                serde_json::json!({"type": "Error", "message": e.to_string(), "recoverable": true}).to_string().into(),
                            ))
                            .await;
                        continue;
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => break,
            _ => continue,
        };

        let subscribe_mode = request
            .get("subscribe")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let req_session_id = request
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| session_id.clone());

        let session_req = if subscribe_mode {
            let sid = match req_session_id.clone() {
                Some(s) if !s.is_empty() => s,
                _ => {
                    let _ = socket
                        .send(Message::Text(
                            serde_json::json!({"type": "Error", "message": "session_id required for subscribe", "recoverable": true}).to_string().into(),
                        ))
                        .await;
                    continue;
                }
            };
            session_id = Some(sid.clone());
            let mut req = serde_json::json!({
                "cmd": "session_subscribe",
                "session_id": sid,
            });
            if let Some(ref roots) = user_roots {
                req["allowed_roots"] = serde_json::json!(roots);
            }
            req
        } else {
            let message = request
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if message.is_empty() {
                let _ = socket
                    .send(Message::Text(
                        serde_json::json!({"type": "Error", "message": "empty message", "recoverable": true}).to_string().into(),
                    ))
                    .await;
                continue;
            }

            let agent = request.get("agent").and_then(|v| v.as_str()).unwrap_or("");

            let agent_id = request
                .get("agent_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let mut req = serde_json::json!({
                "cmd": "session_send",
                "message": message,
                "agent": agent,
                "stream": true,
            });
            if !agent_id.is_empty() {
                req["agent_id"] = serde_json::json!(agent_id);
            }
            if let Some(ref sid) = req_session_id {
                req["session_id"] = serde_json::json!(sid);
            }
            if let Some(ideas) = request.get("session_ideas").and_then(|v| v.as_array()) {
                req["session_ideas"] = serde_json::json!(ideas);
            }
            if let Some(quest_id) = request.get("quest_id").and_then(|v| v.as_str())
                && !quest_id.is_empty()
            {
                req["quest_id"] = serde_json::json!(quest_id);
            }
            if let Some(files) = request.get("files").and_then(|v| v.as_array())
                && !files.is_empty()
            {
                req["files"] = serde_json::json!(files);
            }
            if let Some(ref roots) = user_roots {
                req["allowed_roots"] = serde_json::json!(roots);
            }
            req
        };

        // Open a raw IPC connection and stream events directly to WebSocket.
        match stream_ipc_to_ws(
            state.ipc.socket_path(),
            &session_req,
            &mut socket,
            &mut session_id,
        )
        .await
        {
            Ok(()) => {}
            Err(e) => {
                let _ = socket
                    .send(Message::Text(
                        serde_json::json!({"type": "Error", "message": e.to_string(), "recoverable": true})
                            .to_string()
                            .into(),
                    ))
                    .await;
            }
        }
    }

    info!("Session WebSocket client disconnected");
}

/// Open a raw IPC connection, send the session request, and forward each JSON line to the WebSocket.
async fn stream_ipc_to_ws(
    socket_path: &std::path::Path,
    request: &serde_json::Value,
    ws: &mut axum::extract::ws::WebSocket,
    session_id: &mut Option<String>,
) -> anyhow::Result<()> {
    use axum::extract::ws::Message;

    let stream = tokio::net::UnixStream::connect(socket_path).await?;
    let (reader, mut writer) = stream.into_split();

    let mut req_bytes = serde_json::to_vec(request)?;
    req_bytes.push(b'\n');
    writer.write_all(&req_bytes).await?;

    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        let event: serde_json::Value = serde_json::from_str(&line)?;

        // Capture session_id.
        if let Some(sid) = event.get("session_id").and_then(|v| v.as_str()) {
            *session_id = Some(sid.to_string());
        }

        let is_done = event.get("done").and_then(|v| v.as_bool()).unwrap_or(false);

        // Forward to WebSocket.
        if ws.send(Message::Text(line.into())).await.is_err() {
            break;
        }

        if is_done {
            break;
        }
    }

    Ok(())
}
