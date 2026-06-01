use aeqi_core::config::{AEQIConfig, AuthConfig, AuthMode, WebConfig};
use anyhow::Result;
use axum::{
    Router,
    body::Body,
    extract::{DefaultBodyLimit, Request, State},
    http::{Method, StatusCode},
    middleware,
    response::{IntoResponse, Response},
};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
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
use crate::model_catalog::ModelCatalogPolicy;
use crate::passkey::PasskeyContext;
use crate::rate_limit;
use crate::routes::{api_routes, auth as auth_routes, webhook_routes};
use crate::security_middleware::{SecurityHeadersConfig, security_headers_middleware};
use crate::validation::{request_size_limit_middleware, validate_content_type_middleware};
use crate::wallets::WalletContext;
use crate::ws;
use aeqi_core::config::{AgentSpawnConfig, SmtpConfig};
use tower_governor::GovernorLayer;

/// Shared application state.
#[derive(Clone)]
pub struct AppState {
    pub ipc: Arc<IpcClient>,
    pub auth_secret: Option<String>,
    pub auth_mode: AuthMode,
    pub auth_config: AuthConfig,
    pub ui_dist_dir: Option<PathBuf>,
    pub accounts: Option<Arc<AccountStore>>,
    pub wallets: Arc<WalletContext>,
    pub passkeys: Arc<PasskeyContext>,
    pub smtp: Option<SmtpConfig>,
    pub hosting: Arc<dyn aeqi_hosting::HostingProvider>,
    pub twilio_auth_token: Option<String>,
    /// Aeqi data directory — needed by routes that open the credential DB
    /// (`integrations` routes) directly without going through the daemon
    /// IPC. Mirrors the path the daemon uses (`config.data_dir()`).
    pub data_dir: PathBuf,
    /// Slug of the Blueprint surfaced on `/start` when the user hasn't
    /// chosen one explicitly. Sourced from `[blueprints] default` in
    /// `aeqi.toml`; defaults to the runtime's bundled fallback.
    pub default_blueprint_slug: String,
    pub model_catalog_policy: ModelCatalogPolicy,
    /// Project/repo map used by the HTTP MCP code graph tool. Mirrors the
    /// runtime config's `[[projects]]` entries so HTTP MCP and stdio MCP expose
    /// the same code intelligence surface.
    pub mcp_projects: Vec<AgentSpawnConfig>,
    /// In-process registry of bootstrap handles keyed by uuid. Each entry
    /// tracks one in-flight OAuth2 loopback callback handshake. Pruned
    /// when polled past completion or when handles age out.
    pub bootstrap_registry: Arc<crate::routes::integrations::BootstrapRegistry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AuthSecretSource {
    Env,
    Config,
    Generated,
}

#[derive(Debug, Clone)]
struct ResolvedAuthSecret {
    value: String,
    source: AuthSecretSource,
}

fn resolve_auth_secret_from(web: &WebConfig, env_secret: Option<String>) -> ResolvedAuthSecret {
    if let Some(value) = env_secret.filter(|s| !s.trim().is_empty()) {
        return ResolvedAuthSecret {
            value,
            source: AuthSecretSource::Env,
        };
    }

    if let Some(value) = web.auth_secret.clone().filter(|s| !s.trim().is_empty()) {
        return ResolvedAuthSecret {
            value,
            source: AuthSecretSource::Config,
        };
    }

    use rand::Rng;
    let value: String = rand::rng()
        .sample_iter(&rand::distr::Alphanumeric)
        .take(48)
        .map(char::from)
        .collect();
    tracing::warn!(
        "AEQI_WEB_SECRET unset and [web].auth_secret unconfigured — generated ephemeral random secret. Platform-issued scope tokens will not validate; cross-tenant guards will short-circuit. Set AEQI_WEB_SECRET in the tenant's systemd unit."
    );
    ResolvedAuthSecret {
        value,
        source: AuthSecretSource::Generated,
    }
}

fn resolve_auth_secret(web: &WebConfig) -> ResolvedAuthSecret {
    resolve_auth_secret_from(web, std::env::var("AEQI_WEB_SECRET").ok())
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

    // Resolve auth_secret with strict precedence:
    //   1. AEQI_WEB_SECRET env var (canonical for tenant runtimes — platform
    //      threads it in via systemd --setenv so the platform's
    //      `x-aeqi-scope-token` HMAC validates against the same shared secret).
    //   2. [web].auth_secret from aeqi.toml (single-tenant / dev).
    //   3. Ephemeral random fallback (warns loudly — drift here means scope
    //      tokens never validate, gates short-circuit, cross-tenant data
    //      leaks. Track:
    //      `feedback_per_tenant_auth_secret_drift.md`).
    //
    // Resolve this before bootstrapping wallets. Wallet KEK derivation must use
    // the same secret the HTTP auth/scope layer uses.
    let auth_secret = resolve_auth_secret(web);

    // Initialize wallet/passkey services.
    let wallets = Arc::new(WalletContext::bootstrap(&auth_secret.value, &data_dir)?);
    let passkeys = Arc::new(PasskeyContext::bootstrap(
        web.auth
            .base_url
            .as_deref()
            .unwrap_or("http://localhost:8400"),
    )?);

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

    let state = AppState {
        ipc: ipc.clone(),
        auth_secret: Some(auth_secret.value),
        auth_mode: web.auth.mode.clone(),
        auth_config: web.auth.clone(),
        ui_dist_dir: web.ui_dist_dir.as_ref().map(PathBuf::from),
        accounts,
        wallets,
        passkeys,
        smtp: web.auth.smtp.clone(),
        hosting,
        twilio_auth_token: web.twilio_auth_token.clone(),
        data_dir: data_dir.clone(),
        default_blueprint_slug: config.blueprints.default.clone(),
        model_catalog_policy: crate::model_catalog::policy_for_config(config),
        mcp_projects: config.agent_spawns.clone(),
        bootstrap_registry: Arc::new(crate::routes::integrations::BootstrapRegistry::new()),
    };

    // Error if auth mode requires a secret but signing_secret resolves to the default.
    if matches!(state.auth_mode, AuthMode::Secret)
        && auth_secret.source == AuthSecretSource::Generated
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

    // Rate-limit tiers (see rate_limit.rs).  Built once and attached to
    // subrouters below — topology, not a global blanket.
    let loose_tier = rate_limit::loose();
    let tight_tier = rate_limit::tight();

    // ── Exempt ────────────────────────────────────────────
    // Liveness/readiness, operational endpoints, websocket upgrades (one
    // HTTP request per session lifetime, not per message), and signed
    // webhooks (they authenticate themselves via signature).  No limiter.
    let exempt = auth_routes::exempt_routes()
        .route("/api/ws", axum::routing::get(ws::handler))
        .route(
            "/api/chat/stream",
            axum::routing::get(crate::session_ws::handler),
        )
        .nest("/api", webhook_routes());

    // ── Tight tier ────────────────────────────────────────
    // Credential-testing endpoints: login, signup, verify, password reset,
    // OAuth callbacks.  Abuse here is the real threat model.
    let mut tight = auth_routes::login_routes();
    if matches!(state.auth_mode, AuthMode::Accounts) {
        tight = tight.merge(auth_routes::accounts_routes());
    }
    let tight = tight.layer(GovernorLayer::new(tight_tier));

    // ── Loose tier ────────────────────────────────────────
    // Everything authenticated (the full /api surface).
    //
    // Layer-order invariant: `route_layer(require_auth)` runs BEFORE
    // `layer(GovernorLayer)`. In axum, `layer()` is outer / later, so
    // the request actually hits rate-limit FIRST, then auth. That's
    // safe today because `loose_tier` keys on IP via
    // `SmartIpKeyExtractor` (header-only, no user_id required). If a
    // future tier keys on user_id, the limiter must move to a
    // `route_layer` AFTER auth or it'll panic on missing identity.
    let protected = api_routes().route_layer(middleware::from_fn_with_state(
        state.clone(),
        auth::require_auth,
    ));
    let loose = Router::new()
        .nest("/api", protected)
        .layer(GovernorLayer::new(loose_tier));

    let mut app = Router::new()
        .merge(exempt)
        .merge(tight)
        .merge(loose)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024))
        // Add request size limiting middleware
        .layer(axum::middleware::from_fn(request_size_limit_middleware))
        // Add content-type validation middleware
        .layer(axum::middleware::from_fn(validate_content_type_middleware))
        // Add security headers middleware
        .layer(axum::middleware::from_fn_with_state(
            SecurityHeadersConfig::default(),
            security_headers_middleware,
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
    let bound_addr = listener
        .local_addr()
        .map_err(|e| anyhow::anyhow!("failed to read bound socket addr: {e}"))?;
    info!(
        "aeqi-web listening on {} (auth: {:?})",
        bound_addr, web.auth.mode
    );

    // Sidecar listen-port file. The platform proxy reads this on every
    // request as source-of-truth for the runtime's actual bound address —
    // the platform's `runtime_placements.target_port` column becomes a
    // hint, not a contract. Eliminates the postgres↔runtime port-drift
    // class. Best-effort: write failures log WARN but never block startup;
    // the platform falls back to placement values when the file is absent.
    let listen_port_path = resolve_listen_port_path(config);
    if let Err(e) = write_listen_port_file(&listen_port_path, bound_addr) {
        tracing::warn!(
            path = %listen_port_path.display(),
            error = %e,
            "failed to write listen.port — proxy falls back to placement.target_port"
        );
    } else {
        info!(
            path = %listen_port_path.display(),
            bound = %bound_addr,
            "wrote listen.port for platform proxy"
        );
    }
    let _listen_port_guard = ListenPortGuard {
        path: listen_port_path,
    };

    // Optional Unix domain socket bind. When `web.uds_bind` is set the
    // runtime serves BOTH the existing TCP listener AND a UDS listener at
    // the configured path. The platform proxy may then dial either; the
    // TCP path remains the rollback. Drops out cleanly when uds_bind is
    // None (TCP-only legacy behaviour).
    if let Some(uds_path) = web.uds_bind.as_ref().filter(|p| !p.is_empty()) {
        let uds_path = PathBuf::from(uds_path);
        let uds_listener = bind_uds(&uds_path).await?;
        info!(
            path = %uds_path.display(),
            "aeqi-web also listening on UDS"
        );
        let _uds_guard = UdsSocketGuard {
            path: uds_path.clone(),
        };
        let tcp_app = app.clone();
        let uds_app = app;
        tokio::try_join!(
            async move {
                axum::serve(
                    listener,
                    tcp_app.into_make_service_with_connect_info::<SocketAddr>(),
                )
                .await
                .map_err(anyhow::Error::from)
            },
            async move {
                axum::serve(
                    uds_listener,
                    uds_app.into_make_service_with_connect_info::<UdsConnectInfo>(),
                )
                .await
                .map_err(anyhow::Error::from)
            },
        )?;
    } else {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await?;
    }

    Ok(())
}

/// Bind a `UnixListener` at `path`, recovering from a dangling socket file
/// left by a previously crashed runtime. We probe the existing inode with a
/// short connect attempt; if it accepts we refuse to overwrite (another
/// runtime is alive on the same path — bind would have caused either two
/// services to race the inode or this start to clobber a live socket).
/// If the probe fails the inode is stale and we remove it before `bind`.
///
/// Permissions are tightened to `0o660` and the socket inherits the parent
/// directory group so sibling runtime clients can dial sockets created by
/// root-owned transient units.
async fn bind_uds(path: &std::path::Path) -> Result<tokio::net::UnixListener> {
    if path.exists() {
        let connectable = tokio::time::timeout(
            std::time::Duration::from_millis(50),
            tokio::net::UnixStream::connect(path),
        )
        .await
        .ok()
        .and_then(|res| res.ok())
        .is_some();
        if connectable {
            anyhow::bail!(
                "UDS path {} is already serving a live runtime; refusing to clobber",
                path.display()
            );
        }
        std::fs::remove_file(path).map_err(|e| {
            anyhow::anyhow!("failed to remove stale UDS at {}: {e}", path.display())
        })?;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            anyhow::anyhow!("failed to create UDS parent dir {}: {e}", parent.display())
        })?;
    }
    let listener = tokio::net::UnixListener::bind(path)
        .map_err(|e| anyhow::anyhow!("failed to bind UDS at {}: {e}", path.display()))?;
    #[cfg(unix)]
    apply_uds_permissions(path)?;
    Ok(listener)
}

#[cfg(unix)]
fn apply_uds_permissions(path: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt, chown};

    if let Some(parent) = path.parent() {
        let gid = std::fs::metadata(parent)
            .map_err(|e| anyhow::anyhow!("failed to stat UDS parent {}: {e}", parent.display()))?
            .gid();
        chown(path, None, Some(gid)).map_err(|e| {
            anyhow::anyhow!(
                "failed to chgrp UDS at {} to parent gid {gid}: {e} (proxy may be unable to dial)",
                path.display()
            )
        })?;
    }
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o660)).map_err(|e| {
        anyhow::anyhow!(
            "failed to chmod UDS at {}: {e} (proxy may be unable to dial)",
            path.display()
        )
    })?;
    Ok(())
}

/// ConnectInfo for axum's UDS branch. Carries peer credentials for audit
/// (the proxy runs as `aeqi`; `peer_cred` lets future middleware hard-
/// assert that) and is the per-stream type axum threads into request
/// extensions. Extractors that read `ConnectInfo<SocketAddr>` won't fire
/// on UDS requests — `SmartIpKeyExtractor` resolves via the
/// `X-Forwarded-For: 127.0.0.1` header the platform proxy always injects
/// (see aeqi-platform's `internal_runtime_client()` invariant).
#[derive(Clone, Debug)]
pub struct UdsConnectInfo {
    pub peer_cred: Option<UCredInfo>,
}

/// Peer credentials snapshot — `tokio::net::unix::UCred` isn't `Clone`,
/// so we project it into a `Copy` shape on accept.
#[derive(Clone, Copy, Debug)]
pub struct UCredInfo {
    pub uid: u32,
    pub gid: u32,
    pub pid: Option<i32>,
}

impl
    axum::extract::connect_info::Connected<
        axum::serve::IncomingStream<'_, tokio::net::UnixListener>,
    > for UdsConnectInfo
{
    fn connect_info(stream: axum::serve::IncomingStream<'_, tokio::net::UnixListener>) -> Self {
        let peer_cred = stream.io().peer_cred().ok().map(|c| UCredInfo {
            uid: c.uid(),
            gid: c.gid(),
            pid: c.pid(),
        });
        UdsConnectInfo { peer_cred }
    }
}

/// Best-effort cleanup of the UDS inode on graceful shutdown. systemd
/// `Restart=on-failure` covers SIGKILL/OOM via `bind_uds`'s stale-inode
/// recovery on the next start.
struct UdsSocketGuard {
    path: PathBuf,
}

impl Drop for UdsSocketGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Resolve where the runtime should write `listen.port`. Prefers the
/// platform-injected `AEQI_DATA_DIR` (set by `host.rs` for
/// `aeqi-host-*.service` transient units); falls back to the config's
/// resolved data dir for dev runs without systemd-run.
fn resolve_listen_port_path(config: &AEQIConfig) -> PathBuf {
    if let Some(dir) = std::env::var_os("AEQI_DATA_DIR") {
        return PathBuf::from(dir).join("listen.port");
    }
    config.data_dir().join("listen.port")
}

/// Atomically write `bound_addr` as `host:port\n` to `path`. Writes to
/// `<path>.tmp` then `rename`s over the destination so a partial write is
/// never observable. Sets mode 0644 so the platform service user can
/// read regardless of group membership.
fn write_listen_port_file(path: &std::path::Path, bound_addr: SocketAddr) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("port.tmp");
    std::fs::write(&tmp, format!("{bound_addr}\n"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o644));
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

/// Best-effort cleanup of `listen.port` on graceful shutdown. SIGKILL /
/// OOM don't get a chance — that's fine because the next spawn rewrites
/// atomically. The mtime-cache on the platform side notices.
struct ListenPortGuard {
    path: PathBuf,
}

impl Drop for ListenPortGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(test)]
mod listen_port_tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn writes_host_port_with_trailing_newline() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("listen.port");
        let addr: SocketAddr = "127.0.0.1:8501".parse().unwrap();
        write_listen_port_file(&path, addr).unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert_eq!(contents, "127.0.0.1:8501\n");
    }

    #[test]
    fn write_is_atomic_no_tmp_remains() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("listen.port");
        let addr: SocketAddr = "127.0.0.1:8501".parse().unwrap();
        write_listen_port_file(&path, addr).unwrap();
        assert!(path.exists());
        assert!(!path.with_extension("port.tmp").exists());
    }

    #[test]
    fn write_failure_does_not_panic() {
        // Non-existent parent path that isn't writable (root-owned `/proc/<bogus>`).
        let path = std::path::PathBuf::from("/proc/aeqi-bogus-test/listen.port");
        let addr: SocketAddr = "127.0.0.1:8501".parse().unwrap();
        let result = write_listen_port_file(&path, addr);
        assert!(
            result.is_err(),
            "expected write to fail under /proc/<bogus>"
        );
    }

    #[test]
    fn guard_removes_file_on_drop() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("listen.port");
        let addr: SocketAddr = "127.0.0.1:8501".parse().unwrap();
        write_listen_port_file(&path, addr).unwrap();
        assert!(path.exists());
        {
            let _guard = ListenPortGuard { path: path.clone() };
        }
        assert!(!path.exists(), "guard should remove the file on drop");
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

    // Two-step lookup: try the literal path first, fall back to index.html for
    // SPA routes (any path that doesn't match a static asset). Critically, the
    // mime-guess MUST use the file actually served — using the original request
    // path when we fell back to index.html produces `application/octet-stream`
    // for `/`, `/me/inbox`, and every SPA route, which makes the browser
    // download the HTML instead of rendering it.
    let (file, served_name) = match Assets::get(file_path) {
        Some(f) => (Some(f), file_path),
        None => (Assets::get("index.html"), "index.html"),
    };

    match file {
        Some(content) => {
            let mime = mime_guess::from_path(served_name)
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

#[cfg(test)]
mod tests {
    use super::{AuthSecretSource, resolve_auth_secret_from};
    use aeqi_core::config::WebConfig;

    #[test]
    fn auth_secret_prefers_env_over_config() {
        let web = WebConfig {
            auth_secret: Some("config-secret".to_string()),
            ..WebConfig::default()
        };

        let resolved = resolve_auth_secret_from(&web, Some("env-secret".to_string()));

        assert_eq!(resolved.value, "env-secret");
        assert_eq!(resolved.source, AuthSecretSource::Env);
    }

    #[test]
    fn auth_secret_uses_config_when_env_missing() {
        let web = WebConfig {
            auth_secret: Some("config-secret".to_string()),
            ..WebConfig::default()
        };

        let resolved = resolve_auth_secret_from(&web, None);

        assert_eq!(resolved.value, "config-secret");
        assert_eq!(resolved.source, AuthSecretSource::Config);
    }

    #[test]
    fn auth_secret_generates_ephemeral_fallback_when_unconfigured() {
        let resolved = resolve_auth_secret_from(&WebConfig::default(), None);

        assert_eq!(resolved.source, AuthSecretSource::Generated);
        assert_eq!(resolved.value.len(), 48);
        assert_ne!(resolved.value, "aeqi-dev");
    }

    #[test]
    fn auth_secret_ignores_whitespace_env_and_uses_config() {
        let web = WebConfig {
            auth_secret: Some("config-secret".to_string()),
            ..WebConfig::default()
        };

        let resolved = resolve_auth_secret_from(&web, Some("   ".to_string()));

        assert_eq!(resolved.value, "config-secret");
        assert_eq!(resolved.source, AuthSecretSource::Config);
    }

    #[test]
    fn auth_secret_generates_fallback_for_whitespace_config() {
        let web = WebConfig {
            auth_secret: Some("   ".to_string()),
            ..WebConfig::default()
        };

        let resolved = resolve_auth_secret_from(&web, None);

        assert_eq!(resolved.source, AuthSecretSource::Generated);
        assert_eq!(resolved.value.len(), 48);
    }
}

#[cfg(test)]
mod uds_tests {
    use super::bind_uds;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use tempfile::TempDir;
    use tokio::net::UnixListener;

    #[tokio::test]
    async fn bind_uds_creates_listener_with_parent_group_and_chmods_660() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("runtime.sock");
        let listener = bind_uds(&path).await.expect("bind on fresh path");
        assert!(path.exists(), "socket file should exist after bind");
        let socket_meta = std::fs::metadata(&path).unwrap();
        let mode = socket_meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o660, "socket should be 0o660 for group-only access");
        assert_eq!(
            socket_meta.gid(),
            std::fs::metadata(tmp.path()).unwrap().gid(),
            "socket should inherit parent directory group"
        );
        drop(listener);
    }

    #[tokio::test]
    async fn bind_uds_recovers_stale_inode() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("runtime.sock");
        // Simulate a leftover regular file from a crashed runtime.
        std::fs::write(&path, b"stale").unwrap();
        assert!(path.exists());
        let _listener = bind_uds(&path).await.expect("should recover stale inode");
        assert!(
            path.exists(),
            "bind should have replaced the file with a live socket"
        );
    }

    #[tokio::test]
    async fn bind_uds_refuses_to_clobber_live_socket() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("runtime.sock");
        let _existing = UnixListener::bind(&path).expect("existing live socket");
        let err = bind_uds(&path).await.expect_err("should refuse to clobber");
        assert!(
            err.to_string().contains("already serving a live runtime"),
            "expected clobber guard, got: {err}"
        );
    }

    #[tokio::test]
    async fn bind_uds_creates_parent_dir() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("nested/deep/runtime.sock");
        let _listener = bind_uds(&path).await.expect("should mkdir -p parent");
        assert!(path.exists());
    }
}
