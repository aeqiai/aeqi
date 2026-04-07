use aeqi_core::config::{AEQIConfig, AuthConfig, AuthMode, PeerAgentConfig};
use anyhow::Result;
use axum::{
    Router,
    body::Body,
    extract::{Request, State},
    http::{Method, StatusCode},
    middleware,
    response::{IntoResponse, Response},
};
use std::{path::PathBuf, sync::Arc};
use tower::ServiceExt;
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use tracing::info;

use aeqi_core::config::SmtpConfig;
use crate::accounts::AccountStore;
use crate::auth;
use crate::ipc::IpcClient;
use crate::routes::{api_routes, webhook_routes};
use crate::ws;

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    pub ipc: Arc<IpcClient>,
    pub auth_secret: Option<String>,
    pub auth_mode: AuthMode,
    pub auth_config: AuthConfig,
    pub agents_config: Vec<PeerAgentConfig>,
    pub ui_dist_dir: Option<PathBuf>,
    pub accounts: Option<Arc<AccountStore>>,
    pub smtp: Option<SmtpConfig>,
}

/// Start the web server using settings from AEQIConfig.
pub async fn start(config: &AEQIConfig) -> Result<()> {
    let web = &config.web;
    let data_dir = config.data_dir();

    let ipc = Arc::new(IpcClient::from_data_dir(&data_dir));

    // Open account store if using accounts mode.
    let accounts = if matches!(web.auth.mode, AuthMode::Accounts) {
        Some(Arc::new(AccountStore::open(&data_dir)?))
    } else {
        None
    };

    let state = AppState {
        ipc: ipc.clone(),
        auth_secret: web.auth_secret.clone(),
        auth_mode: web.auth.mode.clone(),
        auth_config: web.auth.clone(),
        agents_config: config.agents.clone(),
        ui_dist_dir: web.ui_dist_dir.as_ref().map(PathBuf::from),
        accounts,
        smtp: web.auth.smtp.clone(),
    };

    // Error if auth mode requires a secret but signing_secret resolves to the default.
    if matches!(state.auth_mode, AuthMode::Secret)
        && auth::signing_secret(&state) == "aeqi-dev"
    {
        tracing::error!(
            "SECURITY: auth_mode is {:?} but no auth_secret configured — using insecure default. Set [web] auth_secret in aeqi.toml",
            state.auth_mode
        );
    }

    let ui_dist_dir = state.ui_dist_dir.clone();
    let serve_ui = ui_dist_dir.is_some();

    // Build CORS layer.
    let cors = if web.cors_origins.is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins: Vec<_> = web
            .cors_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
    };

    // Protected routes (auth required) — uses AppState for the secret.
    let protected = api_routes().route_layer(middleware::from_fn_with_state(
        state.clone(),
        auth::require_auth,
    ));

    // Public routes (health + login + ws + webhooks).
    let mut public = Router::new()
        .route("/api/health", axum::routing::get(health_handler))
        .route("/api/auth/mode", axum::routing::get(auth_mode_handler))
        .route("/api/auth/login", axum::routing::post(login_handler))
        .route("/api/ws", axum::routing::get(ws::handler))
        .route(
            "/api/chat/stream",
            axum::routing::get(crate::session_ws::handler),
        )
        .nest("/api", webhook_routes());

    // Accounts-mode routes (signup, verify, me, Google OAuth).
    if matches!(state.auth_mode, AuthMode::Accounts) {
        public = public
            .route("/api/auth/signup", axum::routing::post(signup_handler))
            .route("/api/auth/login/email", axum::routing::post(email_login_handler))
            .route("/api/auth/verify", axum::routing::post(verify_email_handler))
            .route("/api/auth/resend-code", axum::routing::post(resend_code_handler))
            .route("/api/auth/me", axum::routing::get(me_handler))
            .route("/api/auth/google", axum::routing::get(google_auth_handler))
            .route("/api/auth/google/callback", axum::routing::get(google_callback_handler));
    }

    let mut app = Router::new()
        .nest("/api", protected)
        .merge(public)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(axum::middleware::from_fn(
            |req: Request, next: middleware::Next| async move {
                let mut resp = next.run(req).await;
                let hdrs = resp.headers_mut();
                hdrs.insert("x-content-type-options", "nosniff".parse().unwrap());
                hdrs.insert("x-frame-options", "DENY".parse().unwrap());
                hdrs.insert(
                    "referrer-policy",
                    "strict-origin-when-cross-origin".parse().unwrap(),
                );
                resp
            },
        ));

    if serve_ui {
        if let Some(ui_dist_dir) = ui_dist_dir.as_ref() {
            info!("aeqi-web serving UI assets from {}", ui_dist_dir.display());
        }
        app = app.fallback(spa_handler);
    } else {
        #[cfg(feature = "embed-ui")]
        {
            info!("aeqi-web serving embedded UI assets");
            app = app.fallback(embedded_spa_handler);
        }
    }

    let app = app.with_state(state);

    let listener = tokio::net::TcpListener::bind(&web.bind).await?;
    info!(
        "aeqi-web listening on {} (auth: {:?})",
        web.bind, web.auth.mode
    );
    axum::serve(listener, app).await?;

    Ok(())
}

// ── Handlers ────────────────────────────────────────────

async fn health_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Response {
    match state.ipc.cmd("ping").await {
        Ok(resp) => axum::Json(resp).into_response(),
        Err(_) => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({"ok": false, "error": "daemon not reachable"})),
        )
            .into_response(),
    }
}

async fn auth_mode_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Response {
    let mode = match state.auth_mode {
        AuthMode::None => "none",
        AuthMode::Secret => "secret",
        AuthMode::Accounts => "accounts",
    };
    axum::Json(serde_json::json!({
        "mode": mode,
        "google_oauth": state.auth_config.google_oauth_enabled(),
    }))
    .into_response()
}

async fn login_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> axum::response::Response {
    match state.auth_mode {
        AuthMode::None => {
            match auth::create_token("aeqi-dev", 8760, None, None) {
                Ok(token) => axum::Json(serde_json::json!({
                    "ok": true, "token": token, "token_type": "Bearer", "expires_in": 31536000,
                }))
                .into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        AuthMode::Secret => {
            let secret = body.get("secret").and_then(|s| s.as_str()).unwrap_or("");
            let expected = state.auth_secret.as_deref().unwrap_or("");

            if !expected.is_empty() && secret != expected {
                return (
                    StatusCode::UNAUTHORIZED,
                    axum::Json(serde_json::json!({"ok": false, "error": "invalid secret"})),
                )
                    .into_response();
            }

            let signing_key = if expected.is_empty() { "aeqi-dev" } else { expected };
            match auth::create_token(signing_key, 24, None, None) {
                Ok(token) => axum::Json(serde_json::json!({
                    "ok": true, "token": token, "token_type": "Bearer", "expires_in": 86400,
                }))
                .into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        AuthMode::Accounts => {
            // For accounts mode, use /api/auth/login/email instead.
            (StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({
                "ok": false, "error": "use /api/auth/login/email for accounts mode"
            }))).into_response()
        }
    }
}

// ── Accounts-mode handlers ─────────────────────────────

async fn signup_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> axum::response::Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let password = body.get("password").and_then(|v| v.as_str()).unwrap_or("");
    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("");

    if email.is_empty() || password.len() < 8 || name.is_empty() {
        return (StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({
            "ok": false, "error": "email, name, and password (8+ chars) required"
        }))).into_response();
    }

    // Check if user already exists.
    if let Ok(Some(_)) = accounts.get_user_by_email(email) {
        return (StatusCode::CONFLICT, axum::Json(serde_json::json!({
            "ok": false, "error": "an account with this email already exists"
        }))).into_response();
    }

    let user = match accounts.create_user(email, name, password) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("signup error: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({
                "ok": false, "error": "failed to create account"
            }))).into_response();
        }
    };

    // Generate verification code and send email.
    let code = accounts.set_verify_code(&user.id).unwrap_or_default();
    if let Some(smtp) = &state.smtp {
        let smtp = smtp.clone();
        let email_addr = email.to_string();
        let code_copy = code.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::email::send_verification_email(&smtp, &email_addr, &code_copy).await {
                tracing::error!("failed to send verification email to {}: {e}", email_addr);
            }
        });
    } else {
        tracing::info!("signup: verification code for {} = {} (no SMTP configured)", email, code);
    }

    let signing_key = auth::signing_secret(&state);
    match auth::create_token(signing_key, 24, Some(&user.id), Some(email)) {
        Ok(token) => axum::Json(serde_json::json!({
            "ok": true,
            "token": token,
            "pending_verification": true,
            "user": user,
        })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn email_login_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> axum::response::Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let password = body.get("password").and_then(|v| v.as_str()).unwrap_or("");

    let user = match accounts.verify_password(email, password) {
        Ok(Some(u)) => u,
        Ok(None) => {
            return (StatusCode::UNAUTHORIZED, axum::Json(serde_json::json!({
                "ok": false, "error": "invalid email or password"
            }))).into_response();
        }
        Err(e) => {
            tracing::error!("login error: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({
                "ok": false, "error": "login failed"
            }))).into_response();
        }
    };

    let signing_key = auth::signing_secret(&state);
    match auth::create_token(signing_key, 24, Some(&user.id), Some(&user.email)) {
        Ok(token) => axum::Json(serde_json::json!({
            "ok": true, "token": token, "user": user,
        })).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn verify_email_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> axum::response::Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let code = body.get("code").and_then(|v| v.as_str()).unwrap_or("");

    match accounts.verify_email_code(email, code) {
        Ok(true) => {
            // Re-issue token with verified status.
            if let Ok(Some(user)) = accounts.get_user_by_email(email) {
                let signing_key = auth::signing_secret(&state);
                if let Ok(token) = auth::create_token(signing_key, 24, Some(&user.id), Some(email)) {
                    return axum::Json(serde_json::json!({
                        "ok": true, "token": token, "user": user,
                    })).into_response();
                }
            }
            axum::Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(false) => {
            (StatusCode::BAD_REQUEST, axum::Json(serde_json::json!({
                "ok": false, "error": "invalid or expired code"
            }))).into_response()
        }
        Err(e) => {
            tracing::error!("verify error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({
                "ok": false, "error": "verification failed"
            }))).into_response()
        }
    }
}

async fn resend_code_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> axum::response::Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };
    let email = body.get("email").and_then(|v| v.as_str()).unwrap_or("");

    if let Ok(Some(user)) = accounts.get_user_by_email(email) {
        if let Ok(code) = accounts.set_verify_code(&user.id) {
            if let Some(smtp) = &state.smtp {
                let smtp = smtp.clone();
                let email_addr = email.to_string();
                let code_copy = code.clone();
                tokio::spawn(async move {
                    if let Err(e) = crate::email::send_verification_email(&smtp, &email_addr, &code_copy).await {
                        tracing::error!("failed to resend verification email to {}: {e}", email_addr);
                    }
                });
            } else {
                tracing::info!("resend: verification code for {} = {} (no SMTP configured)", email, code);
            }
        }
    }

    // Always return ok to not leak whether email exists.
    axum::Json(serde_json::json!({"ok": true})).into_response()
}

async fn me_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    req: Request,
) -> axum::response::Response {
    let Some(accounts) = &state.accounts else {
        return (StatusCode::BAD_REQUEST, "accounts not enabled").into_response();
    };

    // Extract user from JWT.
    let secret = auth::signing_secret(&state);
    let token = req.headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    let Some(token) = token else {
        return (StatusCode::UNAUTHORIZED, axum::Json(serde_json::json!({
            "ok": false, "error": "missing token"
        }))).into_response();
    };

    let claims = match auth::validate_token(token, secret) {
        Ok(c) => c,
        Err(_) => {
            return (StatusCode::UNAUTHORIZED, axum::Json(serde_json::json!({
                "ok": false, "error": "invalid token"
            }))).into_response();
        }
    };

    let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
    match accounts.get_user_by_id(user_id) {
        Ok(Some(user)) => axum::Json(serde_json::json!(user)).into_response(),
        Ok(None) => (StatusCode::NOT_FOUND, axum::Json(serde_json::json!({
            "ok": false, "error": "user not found"
        }))).into_response(),
        Err(e) => {
            tracing::error!("me error: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, axum::Json(serde_json::json!({
                "ok": false, "error": "failed to fetch user"
            }))).into_response()
        }
    }
}

async fn google_auth_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> axum::response::Response {
    let Some(google) = &state.auth_config.google else {
        return (StatusCode::BAD_REQUEST, "Google OAuth not configured").into_response();
    };

    let redirect_uri = google.redirect_uri.clone().unwrap_or_else(|| {
        let base = state.auth_config.base_url.as_deref().unwrap_or("http://localhost:8400");
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
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
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
        let base = state.auth_config.base_url.as_deref().unwrap_or("http://localhost:8400");
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
                return (StatusCode::BAD_GATEWAY, "failed to parse Google token response").into_response();
            }
        },
        Err(e) => {
            tracing::error!("google oauth token request error: {e}");
            return (StatusCode::BAD_GATEWAY, "failed to exchange code with Google").into_response();
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

    let payload = match base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        parts[1],
    ) {
        Ok(bytes) => match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) => v,
            Err(_) => return (StatusCode::BAD_GATEWAY, "invalid id_token payload").into_response(),
        },
        Err(_) => return (StatusCode::BAD_GATEWAY, "invalid id_token encoding").into_response(),
    };

    let google_id = payload.get("sub").and_then(|v| v.as_str()).unwrap_or("");
    let email = payload.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let name = payload.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let picture = payload.get("picture").and_then(|v| v.as_str());

    if google_id.is_empty() || email.is_empty() {
        return (StatusCode::BAD_GATEWAY, "missing user info from Google").into_response();
    }

    let user = match accounts.upsert_google_user(google_id, email, name, picture) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("google oauth user upsert error: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to create/update user").into_response();
        }
    };

    let signing_key = auth::signing_secret(&state);
    let token = match auth::create_token(signing_key, 24, Some(&user.id), Some(email)) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("google oauth token creation error: {e}");
            return (StatusCode::INTERNAL_SERVER_ERROR, "failed to create session").into_response();
        }
    };

    // Redirect to frontend with token.
    let base = state.auth_config.base_url.as_deref().unwrap_or("");
    let redirect_url = format!("{}/auth/callback?token={}", base, urlencoding(&token));
    axum::response::Redirect::temporary(&redirect_url).into_response()
}

fn urlencoding(s: &str) -> String {
    s.chars().map(|c| match c {
        'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
        _ => format!("%{:02X}", c as u32),
    }).collect()
}

// ── SPA Handlers ────────────────────────────────────────

#[cfg(feature = "embed-ui")]
async fn embedded_spa_handler(req: Request) -> Response {
    use crate::embedded_ui::Assets;

    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }

    let path = req.uri().path();
    if path.starts_with("/api") {
        return StatusCode::NOT_FOUND.into_response();
    }

    let file_path = path.trim_start_matches('/');

    let file = Assets::get(file_path).or_else(|| Assets::get("index.html"));

    match file {
        Some(content) => {
            let mime = mime_guess::from_path(file_path)
                .first_or_octet_stream()
                .to_string();
            Response::builder()
                .header("content-type", mime)
                .body(Body::from(content.data.to_vec()))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn spa_handler(State(state): State<AppState>, req: Request) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::NOT_FOUND.into_response();
    }

    let path = req.uri().path();
    if path.starts_with("/api") {
        return StatusCode::NOT_FOUND.into_response();
    }

    let Some(ui_dist_dir) = state.ui_dist_dir.clone() else {
        return StatusCode::NOT_FOUND.into_response();
    };

    let last_segment = path.rsplit('/').next().unwrap_or_default();
    let response = if !last_segment.contains('.') {
        ServeDir::new(ui_dist_dir.clone())
            .fallback(ServeFile::new(ui_dist_dir.join("index.html")))
            .oneshot(req)
            .await
    } else {
        ServeDir::new(ui_dist_dir).oneshot(req).await
    };

    match response {
        Ok(response) => response.map(Body::new).into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("failed to serve UI asset: {err}"),
        )
            .into_response(),
    }
}
