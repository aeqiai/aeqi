use axum::{
    Router,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use std::collections::HashMap;

use crate::auth;
use crate::server::AppState;

use super::{server_configuration_error, urlencoding};

// ── Route builder ─────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/google", get(google_auth_handler))
        .route("/api/auth/google/callback", get(google_callback_handler))
}

// ── Handlers ──────────────────────────────────────────────

async fn google_auth_handler(State(state): State<AppState>) -> Response {
    let Some(google) = &state.auth_config.google else {
        return (StatusCode::BAD_REQUEST, "Google OAuth not configured").into_response();
    };

    let redirect_uri = google.redirect_uri.clone().unwrap_or_else(|| {
        let base = state
            .auth_config
            .base_url
            .as_deref()
            .unwrap_or("http://localhost:8400");
        format!("{}/api/auth/google/callback", base)
    });

    // Generate state param for CSRF protection.
    let csrf_state = uuid::Uuid::new_v4().to_string();

    let url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope=openid%20email%20profile&state={}&access_type=offline&prompt=consent",
        urlencoding(&google.client_id),
        urlencoding(&redirect_uri),
        urlencoding(&csrf_state),
    );

    axum::response::Redirect::temporary(&url).into_response()
}

async fn google_callback_handler(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(google) = &state.auth_config.google else {
        return (StatusCode::BAD_REQUEST, "Google OAuth not configured").into_response();
    };
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };

    let Some(code) = params.get("code") else {
        return (StatusCode::BAD_REQUEST, "missing code parameter").into_response();
    };

    let redirect_uri = google.redirect_uri.clone().unwrap_or_else(|| {
        let base = state
            .auth_config
            .base_url
            .as_deref()
            .unwrap_or("http://localhost:8400");
        format!("{}/api/auth/google/callback", base)
    });

    // Exchange code for tokens.
    let client = reqwest::Client::new();
    let token_resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("code", code.as_str()),
            ("client_id", &google.client_id),
            ("client_secret", &google.client_secret),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await;

    let token_json: serde_json::Value = match token_resp {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("google oauth token parse error: {e}");
                return (
                    StatusCode::BAD_GATEWAY,
                    "failed to parse Google token response",
                )
                    .into_response();
            }
        },
        Err(e) => {
            tracing::error!("google oauth token request error: {e}");
            return (
                StatusCode::BAD_GATEWAY,
                "failed to exchange code with Google",
            )
                .into_response();
        }
    };

    let Some(id_token) = token_json.get("id_token").and_then(|v| v.as_str()) else {
        tracing::error!("google oauth: no id_token in response");
        return (StatusCode::BAD_GATEWAY, "no id_token from Google").into_response();
    };

    // Decode the ID token payload (we trust Google's signature since we just got it).
    let parts: Vec<&str> = id_token.split('.').collect();
    if parts.len() != 3 {
        return (StatusCode::BAD_GATEWAY, "malformed id_token").into_response();
    }

    let payload =
        match base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, parts[1]) {
            Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
                Ok(v) => v,
                Err(_) => {
                    return (StatusCode::BAD_GATEWAY, "invalid id_token payload").into_response();
                }
            },
            Err(_) => {
                return (StatusCode::BAD_GATEWAY, "invalid id_token encoding").into_response();
            }
        };

    let google_id = payload.get("sub").and_then(|v| v.as_str()).unwrap_or("");
    let email = payload.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let picture = payload.get("picture").and_then(|v| v.as_str());

    if google_id.is_empty() || email.is_empty() {
        return (StatusCode::BAD_GATEWAY, "missing user info from Google").into_response();
    }

    let user = match accounts.upsert_oauth_user(google_id, email, name, picture) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("google oauth user upsert error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to create/update user",
            )
                .into_response();
        }
    };

    let signing_key = match auth::signing_secret(&state) {
        Ok(secret) => secret,
        Err(err) => return server_configuration_error(err),
    };
    let token = match auth::create_token(signing_key, 24, Some(&user.id), Some(email)) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("google oauth token creation error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to create session",
            )
                .into_response();
        }
    };

    // Redirect to frontend with token.
    let base = state.auth_config.base_url.as_deref().unwrap_or("");
    let redirect_url = format!("{}/auth/callback?token={}", base, urlencoding(&token));
    axum::response::Redirect::temporary(&redirect_url).into_response()
}
