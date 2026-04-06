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
}

/// Start the web server using settings from AEQIConfig.
pub async fn start(config: &AEQIConfig) -> Result<()> {
    let web = &config.web;
    let data_dir = config.data_dir();

    let ipc = Arc::new(IpcClient::from_data_dir(&data_dir));

    let state = AppState {
        ipc: ipc.clone(),
        auth_secret: web.auth_secret.clone(),
        auth_mode: web.auth.mode.clone(),
        auth_config: web.auth.clone(),
        agents_config: config.agents.clone(),
        ui_dist_dir: web.ui_dist_dir.as_ref().map(PathBuf::from),
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
    let public = Router::new()
        .route("/api/health", axum::routing::get(health_handler))
        .route("/api/auth/mode", axum::routing::get(auth_mode_handler))
        .route("/api/auth/login", axum::routing::post(login_handler))
        .route("/api/ws", axum::routing::get(ws::handler))
        .route(
            "/api/chat/stream",
            axum::routing::get(crate::session_ws::handler),
        )
        .nest("/api", webhook_routes());

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
    };
    axum::Json(serde_json::json!({
        "mode": mode,
    }))
    .into_response()
}

async fn login_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::Json(body): axum::Json<serde_json::Value>,
) -> axum::response::Response {
    match state.auth_mode {
        AuthMode::None => {
            // No auth needed — return a token anyway for API compat.
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

            let signing_key = if expected.is_empty() {
                "aeqi-dev"
            } else {
                expected
            };
            match auth::create_token(signing_key, 24, None, None) {
                Ok(token) => axum::Json(serde_json::json!({
                    "ok": true, "token": token, "token_type": "Bearer", "expires_in": 86400,
                }))
                .into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
    }
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
