use axum::{
    Json, Router,
    extract::{Query, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use std::collections::HashMap;

use crate::auth;
use crate::server::AppState;
use aeqi_core::config::AuthMode;

// ── Request DTOs ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct SecretLoginRequest {
    pub secret: Option<String>,
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub invite_code: Option<String>,
}

#[derive(Deserialize)]
pub struct EmailLoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct VerifyEmailRequest {
    pub email: String,
    pub code: String,
}

#[derive(Deserialize)]
pub struct ResendCodeRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct WaitlistRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct CheckInviteRequest {
    pub code: String,
}

// ── Route builders ────────────────────────────────────────

/// Public routes that require no authentication.
pub fn public_routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/auth/mode", get(auth_mode_handler))
        .route("/api/auth/login", post(login_handler))
}

/// Account-related routes (signup, login, verify, OAuth, waitlist, invites).
pub fn accounts_routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/signup", post(signup_handler))
        .route("/api/auth/login/email", post(email_login_handler))
        .route("/api/auth/verify", post(verify_email_handler))
        .route("/api/auth/resend-code", post(resend_code_handler))
        .route("/api/auth/me", get(me_handler))
        .route("/api/auth/google", get(google_auth_handler))
        .route("/api/auth/google/callback", get(google_callback_handler))
        .route("/api/auth/github", get(github_auth_handler))
        .route("/api/auth/github/callback", get(github_callback_handler))
        .route("/api/auth/waitlist", post(waitlist_handler))
        .route("/api/auth/invite/check", post(check_invite_handler))
        .route("/api/auth/invite/codes", get(my_invite_codes_handler))
}

// ── Handlers ──────────────────────────────────────────────

async fn health_handler(State(state): State<AppState>) -> Response {
    match state.ipc.cmd("ping").await {
        Ok(resp) => Json(resp).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"ok": false, "error": "daemon not reachable"})),
        )
            .into_response(),
    }
}

async fn auth_mode_handler(State(state): State<AppState>) -> Response {
    let mode = match state.auth_mode {
        AuthMode::None => "none",
        AuthMode::Secret => "secret",
        AuthMode::Accounts => "accounts",
    };
    Json(serde_json::json!({
        "mode": mode,
        "google_oauth": state.auth_config.google_oauth_enabled(),
        "github_oauth": state.auth_config.github_oauth_enabled(),
        "waitlist": state.auth_config.waitlist,
    }))
    .into_response()
}

async fn login_handler(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    match state.auth_mode {
        AuthMode::None => match auth::create_token("aeqi-dev", 8760, None, None) {
            Ok(token) => Json(serde_json::json!({
                "ok": true, "token": token, "token_type": "Bearer", "expires_in": 31536000,
            }))
            .into_response(),
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        },
        AuthMode::Secret => {
            let secret = body.get("secret").and_then(|s| s.as_str()).unwrap_or("");
            let expected = state.auth_secret.as_deref().unwrap_or("");

            if !expected.is_empty() && secret != expected {
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({"ok": false, "error": "invalid secret"})),
                )
                    .into_response();
            }

            let signing_key = if expected.is_empty() {
                "aeqi-dev"
            } else {
                expected
            };
            match auth::create_token(signing_key, 24, None, None) {
                Ok(token) => Json(serde_json::json!({
                    "ok": true, "token": token, "token_type": "Bearer", "expires_in": 86400,
                }))
                .into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        AuthMode::Accounts => {
            // For accounts mode, use /api/auth/login/email instead.
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false, "error": "use /api/auth/login/email for accounts mode"
                })),
            )
                .into_response()
        }
    }
}

// ── Accounts-mode handlers ────────────────────────────────

async fn signup_handler(
    State(state): State<AppState>,
    Json(body): Json<SignupRequest>,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    let email = &body.email;
    let password = &body.password;
    let name = &body.name;
    let invite_code = body.invite_code.as_deref().unwrap_or("");

    if email.is_empty() || password.len() < 8 || name.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false, "error": "email, name, and password (8+ chars) required"
            })),
        )
            .into_response();
    }

    // Validate invite code when waitlist is enabled.
    // Admin email bypasses invite code requirement.
    let is_admin = email.eq_ignore_ascii_case("0x@aeqi.ai");
    if state.auth_config.waitlist && !is_admin {
        if invite_code.is_empty() {
            return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                "ok": false, "error": "invite code required"
            }))).into_response();
        }
        match accounts.is_invite_code_valid(invite_code) {
            Ok(true) => {}
            _ => {
                return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
                    "ok": false, "error": "invalid or already used invite code"
                }))).into_response();
            }
        }
    }

    // Check if user already exists.
    if let Ok(Some(_)) = accounts.get_user_by_email(email) {
        return (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "ok": false, "error": "an account with this email already exists"
            })),
        )
            .into_response();
    }

    let user = match accounts.create_user(email, name, password) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("signup error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "ok": false, "error": "failed to create account"
                })),
            )
                .into_response();
        }
    };

    // Redeem invite code and generate new ones for the user.
    if state.auth_config.waitlist && !invite_code.is_empty() {
        let _ = accounts.redeem_invite_code(invite_code, &user.id);
    }
    let _ = accounts.generate_invite_codes(&user.id, state.auth_config.invite_codes_per_user);

    // Auto-create a company for the user.
    // Use first name + short user ID suffix to avoid collisions ("Alice-a3f1").
    let first_name = name.split_whitespace().next().unwrap_or(name);
    let suffix = &user.id[..std::cmp::min(4, user.id.len())];
    let company_name = format!("{first_name}-{suffix}");
    // Await company creation so the user_companies link exists before the first API call.
    // This ensures allowed_companies is populated when the auth middleware resolves scope.
    match state.ipc.cmd_with("create_company", serde_json::json!({ "name": company_name })).await {
        Ok(resp) => {
            if resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                if let Err(e) = accounts.add_company(&user.id, &company_name) {
                    tracing::warn!("signup: failed to link company '{}' to user {}: {e}", company_name, user.id);
                }
            } else {
                let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("unknown");
                tracing::warn!("signup: create_company '{}' for user {} failed: {err}", company_name, user.id);
            }
        }
        Err(e) => {
            tracing::warn!("signup: create_company IPC failed for user {}: {e}", user.id);
        }
    }

    // Generate verification code and send email.
    let code = accounts.set_verify_code(&user.id).unwrap_or_default();
    if let Some(smtp) = &state.smtp {
        let smtp = smtp.clone();
        let email_addr = email.to_string();
        let code_copy = code.clone();
        tokio::spawn(async move {
            if let Err(e) =
                crate::email::send_verification_email(&smtp, &email_addr, &code_copy).await
            {
                tracing::error!("failed to send verification email to {}: {e}", email_addr);
            }
        });
    } else {
        tracing::info!(
            "signup: verification code for {} = {} (no SMTP configured)",
            email,
            code
        );
    }

    let signing_key = auth::signing_secret(&state);
    match auth::create_token(signing_key, 24, Some(&user.id), Some(email)) {
        Ok(token) => Json(serde_json::json!({
            "ok": true,
            "token": token,
            "pending_verification": true,
            "user": user,
            "company": &company_name,
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn email_login_handler(
    State(state): State<AppState>,
    Json(body): Json<EmailLoginRequest>,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };

    let user = match accounts.verify_password(&body.email, &body.password) {
        Ok(Some(u)) => u,
        Ok(None) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "ok": false, "error": "invalid email or password"
                })),
            )
                .into_response();
        }
        Err(e) => {
            tracing::error!("login error: {e}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "ok": false, "error": "login failed"
                })),
            )
                .into_response();
        }
    };

    let signing_key = auth::signing_secret(&state);
    match auth::create_token(signing_key, 24, Some(&user.id), Some(&user.email)) {
        Ok(token) => Json(serde_json::json!({
            "ok": true, "token": token, "user": user,
        }))
        .into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn verify_email_handler(
    State(state): State<AppState>,
    Json(body): Json<VerifyEmailRequest>,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };

    match accounts.verify_email_code(&body.email, &body.code) {
        Ok(true) => {
            // Re-issue token with verified status.
            if let Ok(Some(user)) = accounts.get_user_by_email(&body.email) {
                let signing_key = auth::signing_secret(&state);
                if let Ok(token) = auth::create_token(signing_key, 24, Some(&user.id), Some(&body.email))
                {
                    return Json(serde_json::json!({
                        "ok": true, "token": token, "user": user,
                    }))
                    .into_response();
                }
            }
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(false) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false, "error": "invalid or expired code"
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("verify error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "ok": false, "error": "verification failed"
                })),
            )
                .into_response()
        }
    }
}

async fn resend_code_handler(
    State(state): State<AppState>,
    Json(body): Json<ResendCodeRequest>,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };

    if let Ok(Some(user)) = accounts.get_user_by_email(&body.email)
        && let Ok(code) = accounts.set_verify_code(&user.id)
    {
        if let Some(smtp) = &state.smtp {
            let smtp = smtp.clone();
            let email_addr = body.email.clone();
            let code_copy = code.clone();
            tokio::spawn(async move {
                if let Err(e) =
                    crate::email::send_verification_email(&smtp, &email_addr, &code_copy).await
                {
                    tracing::error!("failed to resend verification email to {}: {e}", email_addr);
                }
            });
        } else {
            tracing::info!(
                "resend: verification code for {} = {} (no SMTP configured)",
                body.email,
                code
            );
        }
    }

    // Always return ok to not leak whether email exists.
    Json(serde_json::json!({"ok": true})).into_response()
}

async fn me_handler(State(state): State<AppState>, req: Request) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };

    // Extract user from JWT.
    let secret = auth::signing_secret(&state);
    let token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let Some(token) = token else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "ok": false, "error": "missing token"
            })),
        )
            .into_response();
    };

    let claims = match auth::validate_token(token, secret) {
        Ok(c) => c,
        Err(_) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({
                    "ok": false, "error": "invalid token"
                })),
            )
                .into_response();
        }
    };

    let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
    match accounts.get_user_by_id(user_id) {
        Ok(Some(user)) => Json(serde_json::json!(user)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "ok": false, "error": "user not found"
            })),
        )
            .into_response(),
        Err(e) => {
            tracing::error!("me error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "ok": false, "error": "failed to fetch user"
                })),
            )
                .into_response()
        }
    }
}

// ── Google OAuth ──────────────────────────────────────────

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

    let signing_key = auth::signing_secret(&state);
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

// ── GitHub OAuth ──────────────────────────────────────────

async fn github_auth_handler(State(state): State<AppState>) -> Response {
    let Some(github) = &state.auth_config.github else {
        return (StatusCode::BAD_REQUEST, "GitHub OAuth not configured").into_response();
    };

    let redirect_uri = github.redirect_uri.clone().unwrap_or_else(|| {
        let base = state.auth_config.base_url.as_deref().unwrap_or("http://localhost:8400");
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
                return (StatusCode::BAD_GATEWAY, "failed to parse GitHub token response").into_response();
            }
        },
        Err(e) => {
            tracing::error!("github oauth token request error: {e}");
            return (StatusCode::BAD_GATEWAY, "failed to exchange code with GitHub").into_response();
        }
    };

    let Some(access_token) = token_json.get("access_token").and_then(|v| v.as_str()) else {
        tracing::error!("github oauth: no access_token in response: {:?}", token_json);
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

    let github_id = user_json.get("id").and_then(|v| v.as_u64()).map(|v| v.to_string()).unwrap_or_default();
    let name = user_json.get("name").or(user_json.get("login")).and_then(|v| v.as_str()).unwrap_or("");
    let avatar = user_json.get("avatar_url").and_then(|v| v.as_str());

    // Fetch primary email (may be private).
    let mut email = user_json.get("email").and_then(|v| v.as_str()).unwrap_or("").to_string();
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
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to create/update user").into_response();
        }
    };

    let signing_key = auth::signing_secret(&state);
    let token = match auth::create_token(signing_key, 24, Some(&user.id), Some(&email)) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("github oauth token creation error: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to create session").into_response();
        }
    };

    let base = state.auth_config.base_url.as_deref().unwrap_or("");
    let redirect_url = format!("{}/auth/callback?token={}", base, urlencoding(&token));
    axum::response::Redirect::temporary(&redirect_url).into_response()
}

// ── Waitlist & Invite Codes ───────────────────────────────

async fn waitlist_handler(
    State(state): State<AppState>,
    Json(body): Json<WaitlistRequest>,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    if body.email.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(serde_json::json!({
            "ok": false, "error": "email required"
        }))).into_response();
    }
    match accounts.join_waitlist(&body.email) {
        Ok(true) => Json(serde_json::json!({"ok": true, "message": "You're on the list!"})).into_response(),
        Ok(false) => Json(serde_json::json!({"ok": true, "message": "You're already on the list."})).into_response(),
        Err(e) => {
            tracing::error!("waitlist error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({
                "ok": false, "error": "failed to join waitlist"
            }))).into_response()
        }
    }
}

async fn check_invite_handler(
    State(state): State<AppState>,
    Json(body): Json<CheckInviteRequest>,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    match accounts.is_invite_code_valid(&body.code) {
        Ok(valid) => Json(serde_json::json!({"ok": true, "valid": valid})).into_response(),
        Err(_) => Json(serde_json::json!({"ok": true, "valid": false})).into_response(),
    }
}

async fn my_invite_codes_handler(
    State(state): State<AppState>,
    req: Request,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    let secret = auth::signing_secret(&state);
    let token = req.headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let Some(token) = token else {
        return (StatusCode::UNAUTHORIZED, "missing token").into_response();
    };
    let claims = match auth::validate_token(token, secret) {
        Ok(c) => c,
        Err(_) => return (StatusCode::UNAUTHORIZED, "invalid token").into_response(),
    };
    let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
    match accounts.get_invite_codes(user_id) {
        Ok(codes) => Json(serde_json::json!({"ok": true, "codes": codes})).into_response(),
        Err(e) => {
            tracing::error!("invite codes error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, "failed to fetch codes").into_response()
        }
    }
}

// ── Helpers ───────────────────────────────────────────────

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}
