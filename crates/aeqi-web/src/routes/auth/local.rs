use axum::{
    Json, Router,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};

use crate::auth;
use crate::server::AppState;
use aeqi_core::config::AuthMode;

use super::{
    CheckInviteRequest, EmailLoginRequest, ResendCodeRequest, SignupRequest, VerifyEmailRequest,
    WaitlistRequest, server_configuration_error,
};

// ── Route builder ─────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/signup", post(signup_handler))
        .route("/api/auth/login/email", post(email_login_handler))
        .route("/api/auth/verify", post(verify_email_handler))
        .route("/api/auth/resend-code", post(resend_code_handler))
        .route("/api/auth/me", get(me_handler))
        .route("/api/auth/waitlist", post(waitlist_handler))
        .route("/api/auth/invite/check", post(check_invite_handler))
        .route("/api/auth/invite/codes", get(my_invite_codes_handler))
}

// ── Handlers ──────────────────────────────────────────────

pub async fn login_handler(
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
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false, "error": "invite code required"
                })),
            )
                .into_response();
        }
        match accounts.is_invite_code_valid(invite_code) {
            Ok(true) => {}
            _ => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({
                        "ok": false, "error": "invalid or already used invite code"
                    })),
                )
                    .into_response();
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

    let user = match accounts
        .clone()
        .create_user_async(email.to_string(), name.to_string(), password.to_string())
        .await
    {
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

    // Auto-create a root agent for the user.
    // Use first name + short user ID suffix to avoid collisions ("Alice-a3f1").
    let first_name = name.split_whitespace().next().unwrap_or(name);
    let suffix = &user.id[..std::cmp::min(4, user.id.len())];
    let root_name = format!("{first_name}-{suffix}");
    // Await root agent creation so the user_access link exists before the first API call.
    // This ensures allowed_roots is populated when the auth middleware resolves scope.
    let mut root_id: Option<String> = None;
    match state
        .ipc
        .cmd_with("create_root", serde_json::json!({ "name": root_name }))
        .await
    {
        Ok(resp) => {
            if resp.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                // Store UUID in user_access for scoping; fall back to name.
                let agent_id = resp
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&root_name);
                root_id = Some(agent_id.to_string());
                if let Err(e) = accounts.add_director(&user.id, agent_id) {
                    tracing::warn!(
                        "signup: failed to link root agent '{}' (id={}) to user {}: {e}",
                        root_name,
                        agent_id,
                        user.id
                    );
                }
            } else {
                let err = resp
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                tracing::warn!(
                    "signup: create root agent '{}' for user {} failed: {err}",
                    root_name,
                    user.id
                );
            }
        }
        Err(e) => {
            tracing::warn!(
                "signup: create root agent IPC failed for user {}: {e}",
                user.id
            );
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

    let signing_key = match auth::signing_secret(&state) {
        Ok(secret) => secret,
        Err(err) => return server_configuration_error(err),
    };
    match auth::create_token(signing_key, 24, Some(&user.id), Some(email)) {
        Ok(token) => Json(serde_json::json!({
            "ok": true,
            "token": token,
            "pending_verification": true,
            "user": user,
            "root": &root_name,
            "root_id": root_id,
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

    let user = match accounts
        .clone()
        .verify_password_async(body.email.clone(), body.password.clone())
        .await
    {
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

    let signing_key = match auth::signing_secret(&state) {
        Ok(secret) => secret,
        Err(err) => return server_configuration_error(err),
    };
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
                let signing_key = match auth::signing_secret(&state) {
                    Ok(secret) => secret,
                    Err(err) => return server_configuration_error(err),
                };
                if let Ok(token) =
                    auth::create_token(signing_key, 24, Some(&user.id), Some(&body.email))
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
    let secret = match auth::signing_secret(&state) {
        Ok(secret) => secret,
        Err(err) => return server_configuration_error(err),
    };
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

async fn waitlist_handler(
    State(state): State<AppState>,
    Json(body): Json<WaitlistRequest>,
) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    if body.email.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "ok": false, "error": "email required"
            })),
        )
            .into_response();
    }
    match accounts.join_waitlist(&body.email) {
        Ok(true) => {
            Json(serde_json::json!({"ok": true, "message": "You're on the list!"})).into_response()
        }
        Ok(false) => {
            Json(serde_json::json!({"ok": true, "message": "You're already on the list."}))
                .into_response()
        }
        Err(e) => {
            tracing::error!("waitlist error: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({
                    "ok": false, "error": "failed to join waitlist"
                })),
            )
                .into_response()
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

async fn my_invite_codes_handler(State(state): State<AppState>, req: Request) -> Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    let secret = match auth::signing_secret(&state) {
        Ok(secret) => secret,
        Err(err) => return server_configuration_error(err),
    };
    let token = req
        .headers()
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
