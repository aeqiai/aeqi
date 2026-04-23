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
        .route("/api/auth/github", get(github_auth_handler))
        .route("/api/auth/github/callback", get(github_callback_handler))
}

// ── Handlers ──────────────────────────────────────────────

async fn github_auth_handler(State(state): State<AppState>) -> Response {
    let Some(github) = &state.auth_config.github else {
        return (StatusCode::BAD_REQUEST, "GitHub OAuth not configured").into_response();
    };

    let redirect_uri = github.redirect_uri.clone().unwrap_or_else(|| {
        let base = state
            .auth_config
            .base_url
            .as_deref()
            .unwrap_or("http://localhost:8400");
        format!("{}/api/auth/github/callback", base)
    });

    let url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=read:user%20user:email",
        urlencoding(&github.client_id),
        urlencoding(&redirect_uri),
    );

    axum::response::Redirect::temporary(&url).into_response()
}

async fn github_callback_handler(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(github) = &state.auth_config.github else {
        return (StatusCode::BAD_REQUEST, "GitHub OAuth not configured").into_response();
    };
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };

    let Some(code) = params.get("code") else {
        return (StatusCode::BAD_REQUEST, "missing code parameter").into_response();
    };

    // Exchange code for access token.
    let client = reqwest::Client::new();
    let token_resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .form(&[
            ("code", code.as_str()),
            ("client_id", github.client_id.as_str()),
            ("client_secret", github.client_secret.as_str()),
        ])
        .send()
        .await;

    let token_json: serde_json::Value = match token_resp {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("github oauth token parse error: {e}");
                return (
                    StatusCode::BAD_GATEWAY,
                    "failed to parse GitHub token response",
                )
                    .into_response();
            }
        },
        Err(e) => {
            tracing::error!("github oauth token request error: {e}");
            return (
                StatusCode::BAD_GATEWAY,
                "failed to exchange code with GitHub",
            )
                .into_response();
        }
    };

    let Some(access_token) = token_json.get("access_token").and_then(|v| v.as_str()) else {
        tracing::error!(
            "github oauth: no access_token in response: {:?}",
            token_json
        );
        return (StatusCode::BAD_GATEWAY, "no access_token from GitHub").into_response();
    };

    // Fetch user profile.
    let user_resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "aeqi")
        .send()
        .await;

    let user_json: serde_json::Value = match user_resp {
        Ok(r) => match r.json().await {
            Ok(j) => j,
            Err(e) => {
                tracing::error!("github user fetch error: {e}");
                return (StatusCode::BAD_GATEWAY, "failed to fetch GitHub user").into_response();
            }
        },
        Err(e) => {
            tracing::error!("github user request error: {e}");
            return (StatusCode::BAD_GATEWAY, "failed to fetch GitHub user").into_response();
        }
    };

    let github_id = user_json
        .get("id")
        .and_then(|v| v.as_u64())
        .map(|v| v.to_string())
        .unwrap_or_default();
    let name = user_json
        .get("name")
        .or(user_json.get("login"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let avatar = user_json.get("avatar_url").and_then(|v| v.as_str());

    // Fetch primary email (may be private).
    let mut email = user_json
        .get("email")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if email.is_empty()
        && let Ok(resp) = client
            .get("https://api.github.com/user/emails")
            .header("Authorization", format!("Bearer {}", access_token))
            .header("User-Agent", "aeqi")
            .send()
            .await
        && let Ok(emails) = resp.json::<Vec<serde_json::Value>>().await
    {
        for e in &emails {
            if e.get("primary").and_then(|v| v.as_bool()) == Some(true)
                && e.get("verified").and_then(|v| v.as_bool()) == Some(true)
                && let Some(addr) = e.get("email").and_then(|v| v.as_str())
            {
                email = addr.to_string();
                break;
            }
        }
    }

    if github_id.is_empty() || email.is_empty() {
        return (StatusCode::BAD_GATEWAY, "missing user info from GitHub").into_response();
    }

    // Use "github:{id}" as the provider ID to avoid collision with Google IDs.
    let provider_id = format!("github:{}", github_id);
    let user = match accounts.upsert_oauth_user(&provider_id, &email, name, avatar) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("github oauth user upsert error: {e}");
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
    let token = match auth::create_token(signing_key, 24, Some(&user.id), Some(&email)) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("github oauth token creation error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to create session",
            )
                .into_response();
        }
    };

    let base = state.auth_config.base_url.as_deref().unwrap_or("");
    let redirect_url = format!("{}/auth/callback?token={}", base, urlencoding(&token));
    axum::response::Redirect::temporary(&redirect_url).into_response()
}
