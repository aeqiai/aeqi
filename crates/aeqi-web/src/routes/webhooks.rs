use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Deserialize;
use tracing::{error, info, warn};

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

/// Validate a Twilio webhook request signature.
///
/// Algorithm (from Twilio docs):
/// 1. Take the full URL of the request
/// 2. Sort all POST parameters alphabetically by key
/// 3. Append each key-value pair (no separators) to the URL
/// 4. Sign with HMAC-SHA1 using the auth token as key
/// 5. Base64 encode the result
/// 6. Compare with X-Twilio-Signature header
fn validate_twilio_signature(
    auth_token: &str,
    url: &str,
    params: &[(String, String)],
    signature: &str,
) -> bool {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha1::Sha1;

    // Build the data string: URL + sorted key-value pairs appended directly.
    let mut data = url.to_string();
    let mut sorted_params: Vec<_> = params.iter().collect();
    sorted_params.sort_by(|a, b| a.0.cmp(&b.0));
    for (key, value) in sorted_params {
        data.push_str(key);
        data.push_str(value);
    }

    // Compute HMAC-SHA1.
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(auth_token.as_bytes()) else {
        error!("failed to create HMAC-SHA1 instance");
        return false;
    };
    mac.update(data.as_bytes());
    let result = mac.finalize();
    let expected = base64::engine::general_purpose::STANDARD.encode(result.into_bytes());

    // Constant-time comparison to prevent timing attacks.
    if expected.len() != signature.len() {
        return false;
    }
    let mut diff = 0u8;
    for (a, b) in expected.bytes().zip(signature.bytes()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// WhatsApp/Twilio webhook — receives form-encoded messages from Twilio,
/// validates the X-Twilio-Signature header, parses From/To/Body, and routes
/// through the session_manager via IPC.
async fn whatsapp_handler(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    // --- Twilio signature verification ---
    if let Some(auth_token) = state.twilio_auth_token.as_deref() {
        let twilio_sig = headers
            .get("x-twilio-signature")
            .and_then(|v| v.to_str().ok());

        let Some(twilio_sig) = twilio_sig else {
            warn!("WhatsApp webhook rejected: missing X-Twilio-Signature header");
            return (StatusCode::FORBIDDEN, "missing signature").into_response();
        };

        // Reconstruct the full webhook URL.
        // Use auth.base_url from config (the externally-visible origin).
        let base_url = state
            .auth_config
            .base_url
            .as_deref()
            .unwrap_or("http://localhost:8400");
        let url = format!("{}/api/webhooks/whatsapp", base_url.trim_end_matches('/'));

        // Parse the form body into key-value pairs for signature computation.
        let params: Vec<(String, String)> = serde_urlencoded::from_bytes(&body).unwrap_or_default();

        if !validate_twilio_signature(auth_token, &url, &params, twilio_sig) {
            warn!("WhatsApp webhook rejected: invalid Twilio signature");
            return (StatusCode::FORBIDDEN, "invalid signature").into_response();
        }
    } else {
        warn!("twilio_auth_token not configured — skipping webhook signature verification");
    }

    // Parse the form body into the typed payload.
    let payload: TwilioWhatsAppWebhook = match serde_urlencoded::from_bytes(&body) {
        Ok(p) => p,
        Err(e) => {
            warn!(error = %e, "failed to parse WhatsApp webhook payload");
            return (StatusCode::BAD_REQUEST, "invalid payload").into_response();
        }
    };
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
