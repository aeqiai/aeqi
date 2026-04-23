use aeqi_core::config::{AEQIConfig, AuthConfig, AuthMode};
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

use crate::accounts::AccountStore;
use crate::auth;
use crate::ipc::IpcClient;
use crate::routes::{api_routes, auth as auth_routes, webhook_routes};
use crate::ws;
use aeqi_core::config::SmtpConfig;

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    pub ipc: Arc<IpcClient>,
    pub auth_secret: Option<String>,
    pub auth_mode: AuthMode,
    pub auth_config: AuthConfig,
    pub ui_dist_dir: Option<PathBuf>,
    pub accounts: Option<Arc<AccountStore>>,
    pub smtp: Option<SmtpConfig>,
    pub hosting: Arc<dyn aeqi_hosting::HostingProvider>,
    pub twilio_auth_token: Option<String>,
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

    // Initialize hosting provider.
    let hosting_config = aeqi_hosting::HostingConfig {
        provider: config.hosting.provider.clone(),
        local: config
            .hosting
            .local
            .as_ref()
            .map(|l| aeqi_hosting::LocalConfig {
                nginx_available_dir: l.nginx_available_dir.clone(),
                nginx_enabled_dir: l.nginx_enabled_dir.clone(),
                certbot_bin: l.certbot_bin.clone(),
                certbot_email: l.certbot_email.clone(),
                port_range_start: l.port_range_start,
                port_range_end: l.port_range_end,
                state_file: l.state_file.clone(),
            }),
        managed: config
            .hosting
            .managed
            .as_ref()
            .map(|m| aeqi_hosting::ManagedConfig {
                cloud_url: m.cloud_url.clone(),
                auth_token: m.auth_token.clone(),
            }),
    };
    let hosting: Arc<dyn aeqi_hosting::HostingProvider> =
        Arc::from(aeqi_hosting::from_config(&hosting_config)?);
    info!(mode = hosting.mode(), "hosting provider initialized");

    // Generate a random ephemeral secret if none configured.
    // This prevents the insecure "aeqi-dev" fallback from ever being used.
    let auth_secret = web.auth_secret.clone().or_else(|| {
        use rand::Rng;
        let secret: String = rand::thread_rng()
            .sample_iter(&rand::distr::Alphanumeric)
            .take(48)
            .map(char::from)
            .collect();
        tracing::warn!(
            "No auth_secret configured — generated ephemeral secret (tokens won't survive restarts)"
        );
        Some(secret)
    });

    let state = AppState {
        ipc: ipc.clone(),
        auth_secret,
        auth_mode: web.auth.mode.clone(),
        auth_config: web.auth.clone(),
        ui_dist_dir: web.ui_dist_dir.as_ref().map(PathBuf::from),
        accounts,
        smtp: web.auth.smtp.clone(),
        hosting,
        twilio_auth_token: web.twilio_auth_token.clone(),
    };

    // Error if auth mode requires a secret but signing_secret resolves to the default.
    if matches!(state.auth_mode, AuthMode::Secret)
        && state.auth_secret.as_deref() == Some("aeqi-ephemeral-fallback")
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
    let mut public = auth_routes::public_routes()
        .route("/api/ws", axum::routing::get(ws::handler))
        .route(
            "/api/chat/stream",
            axum::routing::get(crate::session_ws::handler),
        )
        .nest("/api", webhook_routes());

    // Accounts-mode routes (signup, verify, me, OAuth, waitlist, invites).
    if matches!(state.auth_mode, AuthMode::Accounts) {
        public = public.merge(auth_routes::accounts_routes());
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
