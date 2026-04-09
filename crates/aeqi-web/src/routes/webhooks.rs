use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};

use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/webhooks/{public_id}", post(webhook_handler))
}

async fn webhook_handler(
    State(state): State<AppState>,
    axum::extract::Path(public_id): axum::extract::Path<String>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let signature = headers
        .get("x-signature-256")
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    // Encode body as base64 for IPC transport.
    use base64::Engine;
    let body_b64 = base64::engine::general_purpose::STANDARD.encode(&body);

    let mut params = serde_json::json!({
        "public_id": public_id,
        "body_b64": body_b64,
    });
    if let Some(sig) = signature {
        params["signature"] = serde_json::Value::String(sig);
    }

    let result = state.ipc.cmd_with("webhook_fire", params).await;

    match result {
        Ok(resp) => {
            if resp.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                Json(resp).into_response()
            } else {
                let error = resp
                    .get("error")
                    .and_then(|e| e.as_str())
                    .unwrap_or("unknown error");
                let status = if error.contains("not found") {
                    StatusCode::NOT_FOUND
                } else if error.contains("signature") {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::INTERNAL_SERVER_ERROR
                };
                (status, Json(resp)).into_response()
            }
        }
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}
