use axum::{
    Form, Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use tracing::{info, warn};

use crate::server::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/webhooks/{public_id}", post(webhook_handler))
        .route("/webhooks/whatsapp", post(whatsapp_handler))
}

/// Twilio WhatsApp webhook payload (form-encoded).
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct TwilioWhatsAppWebhook {
    #[serde(rename = "From", default)]
    from: String,
    #[serde(rename = "To", default)]
    to: String,
    #[serde(rename = "Body", default)]
    body: String,
    #[serde(rename = "MessageSid", default)]
    message_sid: String,
    #[serde(rename = "NumMedia", default)]
    num_media: Option<String>,
}

/// WhatsApp/Twilio webhook — receives form-encoded messages from Twilio,
/// parses From/To/Body, and routes through the session_manager via IPC.
///
/// Twilio signature verification is deferred — this handler trusts the
/// incoming request for now.
async fn whatsapp_handler(
    State(state): State<AppState>,
    Form(payload): Form<TwilioWhatsAppWebhook>,
) -> Response {
    // Validate required fields.
    if payload.body.is_empty() || payload.from.is_empty() {
        return (
            StatusCode::OK,
            Json(serde_json::json!({"ok": true, "ignored": true})),
        )
            .into_response();
    }

    // Strip "whatsapp:" prefix for the channel_key, keep original for routing.
    let sender_number = payload
        .from
        .strip_prefix("whatsapp:")
        .unwrap_or(&payload.from);
    let to_number = payload.to.strip_prefix("whatsapp:").unwrap_or(&payload.to);

    info!(
        from = %payload.from,
        to = %payload.to,
        message_sid = %payload.message_sid,
        "received WhatsApp message via Twilio webhook"
    );

    // Route through session_message IPC. The agent is determined by which Twilio
    // number received the message (the `To` field). For now, route to the default agent.
    let params = serde_json::json!({
        "message": payload.body,
        "sender": sender_number,
        "channel_name": format!("whatsapp:{}", to_number),
    });

    match state.ipc.cmd_with("session_message", params).await {
        Ok(_resp) => {
            // Twilio expects a 200 with TwiML or empty body.
            // Return empty 200 — responses are sent via the Twilio REST API.
            (StatusCode::OK, "").into_response()
        }
        Err(e) => {
            warn!(error = %e, "failed to route WhatsApp message via IPC");
            (StatusCode::OK, "").into_response()
        }
    }
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
