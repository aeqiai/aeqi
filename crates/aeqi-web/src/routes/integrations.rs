//! Integrations API — UI1 surface.
//!
//! Surfaces the credential substrate (T1.9) to the dashboard UI: lists the
//! available integration packs, the credentials a scope (global / agent)
//! currently holds, drives the OAuth2 loopback consent flow for new
//! connections, and lets the operator refresh / disconnect existing rows.
//!
//! This module talks to the credential DB directly (same pattern as
//! `aeqi doctor`) rather than going through the daemon's IPC. The web
//! process and the daemon both touch the same SQLite file; the credentials
//! table has a unique index that keeps writes coherent.
//!
//! OAuth2 client credentials are configured via environment variables:
//!   * `AEQI_OAUTH_GOOGLE_CLIENT_ID` (required for `google` provider)
//!   * `AEQI_OAUTH_GOOGLE_CLIENT_SECRET` (required for confidential clients)
//!
//! Bootstrap handles live in an in-process registry — one entry per
//! in-flight consent flow. The OAuth callback runs as a background
//! task that binds an OS-picked loopback port, captures the `code` query
//! param, runs the token exchange, persists the row, and marks the handle
//! `complete`. Frontend polls the handle status.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tracing::warn;
use uuid::Uuid;

use aeqi_core::credentials::{
    CredentialBootstrapContext, CredentialCipher, CredentialKey, CredentialReasonCode,
    CredentialResolveContext, CredentialResolver, CredentialRow, CredentialStore, ScopeKind,
    lifecycles::{
        DeviceSessionLifecycle, GithubAppLifecycle, OAuth2Lifecycle, ServiceAccountLifecycle,
        StaticSecretLifecycle, oauth2::OAuth2ProviderConfig,
    },
};

use crate::server::AppState;

// ── Pack catalog ──────────────────────────────────────────────────────────
//
// Hard-coded for now — the seed-idea catalog at
// `presets/seed_ideas/meta-pack-catalog.md` is human-readable, not a
// machine-queryable surface yet. When pack install infra lands the catalog
// becomes the source of truth; until then this list mirrors the seed.

#[derive(Debug, Clone, Serialize)]
pub struct IntegrationCatalogEntry {
    /// Stable provider key — matches `CredentialNeed::provider` and the
    /// `credentials.provider` column.
    pub provider: &'static str,
    /// Stable credential name — the substrate's secondary key with the
    /// provider above.
    pub name: &'static str,
    /// Human-readable label shown in the UI.
    pub label: &'static str,
    /// Marketing-style description. One sentence.
    pub description: &'static str,
    /// Lifecycle handler this pack uses (`oauth2`, `github_app`, …).
    pub lifecycle_kind: &'static str,
    /// Provider config the bootstrap flow will use. Empty when the pack
    /// isn't shipping yet (`coming_soon=true`).
    pub auth_url: Option<&'static str>,
    pub token_url: Option<&'static str>,
    pub revoke_url: Option<&'static str>,
    /// OAuth scopes requested at consent time.
    pub oauth_scopes: Vec<&'static str>,
    /// Environment variables the operator needs to set on the daemon to
    /// supply the OAuth client credentials. Surfaced in the UI when a
    /// connect is attempted but the env isn't populated.
    pub client_id_env: Option<&'static str>,
    pub client_secret_env: Option<&'static str>,
    /// Whether per-agent scoping is supported (most packs scope per-agent;
    /// some legacy LLM-key flows are global only).
    pub per_agent: bool,
    pub coming_soon: bool,
}

/// Built-in catalog. Order is the surface order in the UI.
fn catalog() -> Vec<IntegrationCatalogEntry> {
    vec![
        IntegrationCatalogEntry {
            provider: "google",
            name: "oauth_token",
            label: "Google Workspace",
            description: "Gmail, Calendar, and Meet via the pack:google-workspace toolset. Eleven tools \
                 backed by the oauth2 lifecycle with refresh-on-401.",
            lifecycle_kind: "oauth2",
            auth_url: Some("https://accounts.google.com/o/oauth2/v2/auth"),
            token_url: Some("https://oauth2.googleapis.com/token"),
            revoke_url: Some("https://oauth2.googleapis.com/revoke"),
            oauth_scopes: vec![
                "https://www.googleapis.com/auth/gmail.modify",
                "https://www.googleapis.com/auth/calendar",
            ],
            client_id_env: Some("AEQI_OAUTH_GOOGLE_CLIENT_ID"),
            client_secret_env: Some("AEQI_OAUTH_GOOGLE_CLIENT_SECRET"),
            per_agent: true,
            coming_soon: false,
        },
        IntegrationCatalogEntry {
            provider: "github",
            name: "oauth_token",
            label: "GitHub",
            description: "Issues, pull requests, repository access. Lands with W2 (pack:github); the \
                 substrate hooks are ready today.",
            lifecycle_kind: "oauth2",
            auth_url: Some("https://github.com/login/oauth/authorize"),
            token_url: Some("https://github.com/login/oauth/access_token"),
            revoke_url: None,
            oauth_scopes: vec!["repo", "read:org"],
            client_id_env: Some("AEQI_OAUTH_GITHUB_CLIENT_ID"),
            client_secret_env: Some("AEQI_OAUTH_GITHUB_CLIENT_SECRET"),
            per_agent: true,
            coming_soon: true,
        },
    ]
}

// ── Response shapes ───────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct IntegrationListResponse {
    integrations: Vec<IntegrationCatalogEntry>,
}

#[derive(Debug, Serialize)]
struct CredentialView {
    id: String,
    scope_kind: String,
    scope_id: String,
    provider: String,
    name: String,
    lifecycle_kind: String,
    /// `aeqi doctor`-style stable reason code.
    status: String,
    account_email: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    last_refreshed_at: Option<DateTime<Utc>>,
    last_used_at: Option<DateTime<Utc>>,
    /// OAuth scopes the stored token was granted (read from metadata).
    granted_scopes: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct CredentialsListQuery {
    scope_kind: Option<String>,
    scope_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct CredentialsListResponse {
    credentials: Vec<CredentialView>,
}

#[derive(Debug, Deserialize)]
struct BootstrapStartBody {
    pub provider: String,
    pub scope_kind: String,
    /// Empty string permitted for global scope.
    #[serde(default)]
    pub scope_id: String,
    /// Optional override — defaults to catalog's declared scopes.
    #[serde(default)]
    pub oauth_scopes: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct BootstrapStartResponse {
    handle: String,
    authorize_url: String,
    /// Suggested timeout — UI stops polling past this.
    expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
struct BootstrapStatusResponse {
    handle: String,
    status: String, // 'pending' | 'complete' | 'failed' | 'expired'
    credential_id: Option<String>,
    error: Option<String>,
}

// ── Bootstrap registry ────────────────────────────────────────────────────

/// One in-flight OAuth consent flow. The background task holds a sender;
/// the polling endpoint reads the receiver.
#[derive(Debug, Clone)]
pub enum BootstrapStatus {
    /// User hasn't completed consent yet.
    Pending,
    /// Code captured + token exchange ran; row inserted.
    Complete { credential_id: String },
    /// Something went wrong (token exchange failed, user denied, etc.).
    Failed { error: String },
}

pub struct BootstrapEntry {
    pub status: Mutex<BootstrapStatus>,
    pub created_at: Instant,
}

#[derive(Default)]
pub struct BootstrapRegistry {
    inner: Mutex<HashMap<String, Arc<BootstrapEntry>>>,
}

impl BootstrapRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, handle: String, entry: Arc<BootstrapEntry>) {
        // Drop entries older than 30 minutes opportunistically — keeps the
        // registry trimmed without a background task.
        let mut map = self.inner.lock().expect("bootstrap registry poisoned");
        map.retain(|_, e| e.created_at.elapsed() < Duration::from_secs(30 * 60));
        map.insert(handle, entry);
    }

    pub fn get(&self, handle: &str) -> Option<Arc<BootstrapEntry>> {
        self.inner
            .lock()
            .expect("bootstrap registry poisoned")
            .get(handle)
            .cloned()
    }
}

// ── Routes ────────────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/integrations", get(list_integrations))
        .route("/credentials", get(list_credentials))
        .route("/credentials/bootstrap", post(bootstrap_start))
        .route(
            "/credentials/bootstrap/{handle}",
            get(bootstrap_status_handler),
        )
        .route("/credentials/{id}/refresh", post(refresh_credential))
        .route("/credentials/{id}", delete(delete_credential))
}

async fn list_integrations() -> impl IntoResponse {
    Json(IntegrationListResponse {
        integrations: catalog(),
    })
}

async fn list_credentials(
    State(state): State<AppState>,
    Query(q): Query<CredentialsListQuery>,
) -> impl IntoResponse {
    let store = match open_store(&state) {
        Ok(s) => s,
        Err(e) => return error_response(StatusCode::SERVICE_UNAVAILABLE, &e.to_string()),
    };

    let resolver = build_resolver(store.clone());
    let rows = if let (Some(kind_str), Some(scope_id)) =
        (q.scope_kind.as_deref(), q.scope_id.as_deref())
    {
        let kind = match ScopeKind::parse(kind_str) {
            Some(k) => k,
            None => {
                return error_response(StatusCode::BAD_REQUEST, "invalid scope_kind");
            }
        };
        match store.list_by_scope(kind, scope_id).await {
            Ok(r) => r,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("list_by_scope failed: {e}"),
                );
            }
        }
    } else {
        match store.list_all().await {
            Ok(r) => r,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("list_all failed: {e}"),
                );
            }
        }
    };

    let credentials: Vec<CredentialView> = rows
        .into_iter()
        .map(|row| credential_view(&row, &resolver, &store))
        .collect();

    Json(CredentialsListResponse { credentials }).into_response()
}

async fn bootstrap_start(
    State(state): State<AppState>,
    Json(body): Json<BootstrapStartBody>,
) -> impl IntoResponse {
    // Resolve catalog entry.
    let entry = match catalog().into_iter().find(|c| c.provider == body.provider) {
        Some(c) => c,
        None => return error_response(StatusCode::NOT_FOUND, "unknown provider"),
    };

    if entry.coming_soon {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "provider not yet available; pack lands later",
        );
    }

    if entry.lifecycle_kind != "oauth2" {
        return error_response(
            StatusCode::NOT_IMPLEMENTED,
            "only oauth2 bootstrap is currently exposed via this surface",
        );
    }

    let scope_kind = match ScopeKind::parse(&body.scope_kind) {
        Some(k) => k,
        None => return error_response(StatusCode::BAD_REQUEST, "invalid scope_kind"),
    };

    // Pull client credentials from env. We deliberately do NOT bake any
    // client_id into the binary — this matches the operator-supplied
    // contract documented in `meta:pack:google-workspace`.
    let client_id_var = entry
        .client_id_env
        .ok_or("provider is missing a client_id_env declaration")
        .ok();
    let client_id = match client_id_var.and_then(|v| std::env::var(v).ok()) {
        Some(id) if !id.is_empty() => id,
        _ => {
            return error_response(
                StatusCode::PRECONDITION_REQUIRED,
                &format!(
                    "OAuth client_id missing — set {} on the daemon environment",
                    entry.client_id_env.unwrap_or("AEQI_OAUTH_CLIENT_ID")
                ),
            );
        }
    };
    let client_secret = entry
        .client_secret_env
        .and_then(|v| std::env::var(v).ok())
        .filter(|s| !s.is_empty());

    let store = match open_store(&state) {
        Ok(s) => s,
        Err(e) => return error_response(StatusCode::SERVICE_UNAVAILABLE, &e.to_string()),
    };

    // Bind the loopback callback listener now so we know the port. The
    // background task takes ownership of the listener.
    let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
        Ok(l) => l,
        Err(e) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("failed to bind loopback callback: {e}"),
            );
        }
    };
    let local_addr = listener.local_addr().expect("loopback addr");
    let redirect_uri = format!("http://127.0.0.1:{}/callback", local_addr.port());

    // Override scopes if the caller supplied a narrower / wider list.
    let scopes: Vec<String> = body
        .oauth_scopes
        .clone()
        .unwrap_or_else(|| entry.oauth_scopes.iter().map(|s| s.to_string()).collect());

    let provider_cfg = OAuth2ProviderConfig {
        provider_kind: entry.provider.to_string(),
        auth_url: entry.auth_url.unwrap_or("").to_string(),
        token_url: entry.token_url.unwrap_or("").to_string(),
        revoke_url: entry.revoke_url.map(str::to_string),
        client_id: client_id.clone(),
        client_secret: client_secret.clone(),
        scopes: scopes.clone(),
        redirect_uri: redirect_uri.clone(),
    };

    let state_param = Uuid::new_v4().to_string();
    let (authorize_url, code_verifier) =
        OAuth2Lifecycle::build_consent_url(&provider_cfg, &state_param);

    let handle = Uuid::new_v4().to_string();
    let entry_arc = Arc::new(BootstrapEntry {
        status: Mutex::new(BootstrapStatus::Pending),
        created_at: Instant::now(),
    });
    state
        .bootstrap_registry
        .insert(handle.clone(), entry_arc.clone());

    // Spawn the loopback callback handler. It owns the listener, accepts
    // exactly one connection, parses the redirect, runs the token
    // exchange, and writes the credential row.
    let provider_for_task = provider_cfg.clone();
    let store_for_task = store.clone();
    let scope_kind_for_task = scope_kind;
    let scope_id_for_task = body.scope_id.clone();
    let provider_key = entry.provider.to_string();
    let cred_name = entry.name.to_string();
    let state_check = state_param.clone();
    tokio::spawn(async move {
        let result = run_oauth_callback(
            listener,
            provider_for_task,
            code_verifier,
            state_check,
            store_for_task,
            scope_kind_for_task,
            scope_id_for_task,
            provider_key,
            cred_name,
        )
        .await;
        let mut slot = entry_arc.status.lock().expect("bootstrap entry poisoned");
        match result {
            Ok(credential_id) => *slot = BootstrapStatus::Complete { credential_id },
            Err(e) => *slot = BootstrapStatus::Failed { error: e },
        }
    });

    let resp = BootstrapStartResponse {
        handle,
        authorize_url,
        expires_at: Utc::now() + chrono::Duration::minutes(15),
    };
    Json(resp).into_response()
}

async fn bootstrap_status_handler(
    State(state): State<AppState>,
    Path(handle): Path<String>,
) -> impl IntoResponse {
    let entry = match state.bootstrap_registry.get(&handle) {
        Some(e) => e,
        None => {
            return Json(BootstrapStatusResponse {
                handle,
                status: "expired".into(),
                credential_id: None,
                error: Some("handle not found or expired".into()),
            })
            .into_response();
        }
    };
    let snapshot = entry
        .status
        .lock()
        .expect("bootstrap entry poisoned")
        .clone();
    let resp = match snapshot {
        BootstrapStatus::Pending => BootstrapStatusResponse {
            handle,
            status: "pending".into(),
            credential_id: None,
            error: None,
        },
        BootstrapStatus::Complete { credential_id } => BootstrapStatusResponse {
            handle,
            status: "complete".into(),
            credential_id: Some(credential_id),
            error: None,
        },
        BootstrapStatus::Failed { error } => BootstrapStatusResponse {
            handle,
            status: "failed".into(),
            credential_id: None,
            error: Some(error),
        },
    };
    Json(resp).into_response()
}

async fn refresh_credential(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let store = match open_store(&state) {
        Ok(s) => s,
        Err(e) => return error_response(StatusCode::SERVICE_UNAVAILABLE, &e.to_string()),
    };
    let resolver = build_resolver(store.clone());
    match resolver.refresh_by_id(&id).await {
        Ok(_usable) => {
            let row = match store.get(&id).await.ok().flatten() {
                Some(r) => r,
                None => return error_response(StatusCode::NOT_FOUND, "credential vanished"),
            };
            Json(serde_json::json!({
                "ok": true,
                "credential": credential_view(&row, &resolver, &store),
            }))
            .into_response()
        }
        Err(e) => error_response(StatusCode::BAD_GATEWAY, &e.to_string()),
    }
}

async fn delete_credential(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let store = match open_store(&state) {
        Ok(s) => s,
        Err(e) => return error_response(StatusCode::SERVICE_UNAVAILABLE, &e.to_string()),
    };
    let resolver = build_resolver(store.clone());

    // Best-effort lifecycle revoke before deletion. Errors are logged
    // but don't block the row deletion — once we delete locally the
    // user is "disconnected" from aeqi's perspective even if the
    // provider-side revoke didn't go through.
    if let Some(row) = store.get(&id).await.ok().flatten()
        && let Some(lifecycle) = resolver.lifecycle_for(&row.lifecycle_kind)
        && let Ok(plaintext) = store.decrypt(&row)
    {
        let ctx = CredentialResolveContext {
            row: &row,
            plaintext: &plaintext,
            metadata: &row.metadata,
            http: resolver.http(),
        };
        if let Err(e) = lifecycle.revoke(&ctx).await {
            warn!(error = %e, credential_id = %id, "revoke handler failed (continuing with delete)");
        }
    }

    if let Err(e) = store.delete(&id).await {
        return error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("delete failed: {e}"),
        );
    }
    Json(serde_json::json!({"ok": true})).into_response()
}

// ── OAuth callback handler ────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn run_oauth_callback(
    listener: tokio::net::TcpListener,
    provider: OAuth2ProviderConfig,
    code_verifier: String,
    expected_state: String,
    store: CredentialStore,
    scope_kind: ScopeKind,
    scope_id: String,
    provider_key: String,
    name: String,
) -> Result<String, String> {
    use axum::{
        Router, extract::Query as AxumQuery, http::StatusCode, response::Html, routing::get,
    };

    #[derive(Deserialize)]
    struct CallbackParams {
        code: Option<String>,
        state: Option<String>,
        error: Option<String>,
    }

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let tx_holder = Arc::new(Mutex::new(Some(tx)));
    let expected = expected_state.clone();

    let app: Router = Router::new().route(
        "/callback",
        get({
            let tx_holder = tx_holder.clone();
            move |AxumQuery(params): AxumQuery<CallbackParams>| {
                let tx_holder = tx_holder.clone();
                let expected = expected.clone();
                async move {
                    if let Some(err) = params.error {
                        if let Some(tx) = tx_holder.lock().expect("oauth tx poisoned").take() {
                            let _ = tx.send(Err(format!("provider returned error: {err}")));
                        }
                        return (
                            StatusCode::OK,
                            Html(error_page(
                                "Provider returned an error — you can close this window.",
                            )),
                        );
                    }
                    if params.state.as_deref() != Some(expected.as_str()) {
                        if let Some(tx) = tx_holder.lock().expect("oauth tx poisoned").take() {
                            let _ = tx.send(Err("state parameter mismatch".into()));
                        }
                        return (
                            StatusCode::BAD_REQUEST,
                            Html(error_page("OAuth state mismatch — please retry.")),
                        );
                    }
                    let code = match params.code {
                        Some(c) if !c.is_empty() => c,
                        _ => {
                            if let Some(tx) = tx_holder.lock().expect("oauth tx poisoned").take() {
                                let _ = tx.send(Err("no authorization code returned".into()));
                            }
                            return (
                                StatusCode::BAD_REQUEST,
                                Html(error_page("No authorization code received.")),
                            );
                        }
                    };
                    if let Some(tx) = tx_holder.lock().expect("oauth tx poisoned").take() {
                        let _ = tx.send(Ok(code));
                    }
                    (
                        StatusCode::OK,
                        Html(success_page(
                            "Connected. You can close this window and return to aeqi.",
                        )),
                    )
                }
            }
        }),
    );

    // Run the loopback server until the callback fires or the timeout
    // elapses. We hand-roll axum::serve so we can shut it down once we
    // have the code.
    let serve_handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });

    let code = tokio::select! {
        result = rx => match result {
            Ok(Ok(code)) => code,
            Ok(Err(e)) => {
                serve_handle.abort();
                return Err(e);
            }
            Err(_) => {
                serve_handle.abort();
                return Err("callback channel closed".into());
            }
        },
        _ = tokio::time::sleep(Duration::from_secs(15 * 60)) => {
            serve_handle.abort();
            return Err("OAuth consent timed out after 15 minutes".into());
        }
    };
    serve_handle.abort();

    // Hand the code off to the lifecycle's bootstrap path. We construct
    // a one-shot HTTP client locally — the resolver's client isn't
    // accessible here without threading more state. reqwest::Client is
    // cheap to build.
    let http = reqwest::Client::builder()
        .user_agent(concat!("aeqi/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("http client build failed: {e}"))?;
    let lifecycle = OAuth2Lifecycle;
    let bootstrap_cfg = serde_json::json!({
        "provider": provider,
        "code": code,
        "code_verifier": code_verifier,
    });
    let ctx = CredentialBootstrapContext {
        provider: &provider_key,
        scope_kind: scope_kind.clone(),
        scope_id: &scope_id,
        config: &bootstrap_cfg,
        http: Some(&http),
    };
    use aeqi_core::credentials::CredentialLifecycle;
    let bootstrapped = lifecycle
        .bootstrap(&ctx)
        .await
        .map_err(|e| format!("oauth2 bootstrap failed: {e}"))?;

    // If a row already exists for this scope+provider+name, replace it
    // (re-connect flow). Otherwise insert fresh.
    let key = CredentialKey {
        scope_kind: scope_kind.clone(),
        scope_id: scope_id.clone(),
        provider: provider_key.clone(),
        name: name.clone(),
    };
    if let Some(existing) = store
        .find(&key)
        .await
        .map_err(|e| format!("find failed: {e}"))?
    {
        let upd = aeqi_core::credentials::CredentialUpdate {
            plaintext_blob: Some(bootstrapped.plaintext_blob),
            metadata: Some(bootstrapped.metadata),
            expires_at: Some(bootstrapped.expires_at),
            bump_last_refreshed: true,
            bump_last_used: false,
        };
        store
            .update(&existing.id, upd)
            .await
            .map_err(|e| format!("update failed: {e}"))?;
        Ok(existing.id)
    } else {
        let ins = aeqi_core::credentials::CredentialInsert {
            scope_kind: key.scope_kind,
            scope_id: key.scope_id,
            provider: key.provider,
            name: key.name,
            lifecycle_kind: "oauth2".to_string(),
            plaintext_blob: bootstrapped.plaintext_blob,
            metadata: bootstrapped.metadata,
            expires_at: bootstrapped.expires_at,
        };
        store
            .insert(ins)
            .await
            .map_err(|e| format!("insert failed: {e}"))
    }
}

fn success_page(msg: &str) -> String {
    format!(
        "<!doctype html><meta charset=utf-8><title>aeqi — connected</title>\
         <style>body{{font-family:system-ui,sans-serif;background:#f4f4f5;color:#0a0a0b;\
         display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}}\
         .card{{background:#fff;padding:40px 48px;border:1px solid rgba(0,0,0,0.08);\
         border-radius:8px;max-width:420px;text-align:center;}}\
         h1{{font-size:18px;margin:0 0 12px;}}p{{color:#525252;font-size:14px;line-height:1.5;}}</style>\
         <div class=card><h1>Connected to aeqi</h1><p>{msg}</p></div>"
    )
}

fn error_page(msg: &str) -> String {
    format!(
        "<!doctype html><meta charset=utf-8><title>aeqi — error</title>\
         <style>body{{font-family:system-ui,sans-serif;background:#f4f4f5;color:#0a0a0b;\
         display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}}\
         .card{{background:#fff;padding:40px 48px;border:1px solid rgba(0,0,0,0.08);\
         border-radius:8px;max-width:420px;text-align:center;}}\
         h1{{font-size:18px;margin:0 0 12px;color:#b85c5c;}}p{{color:#525252;font-size:14px;line-height:1.5;}}</style>\
         <div class=card><h1>Connection failed</h1><p>{msg}</p></div>"
    )
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn open_store(state: &AppState) -> anyhow::Result<CredentialStore> {
    let aeqi_db = state.data_dir.join("aeqi.db");
    let conn = Connection::open(&aeqi_db)?;
    // Make sure the schema exists — the daemon's migration is the canonical
    // path, but the web layer can be hit before the daemon is fully booted
    // (e.g. local dev). `initialize_schema` is idempotent.
    CredentialStore::initialize_schema(&conn)?;
    let secrets_dir = state.data_dir.join("secrets");
    let cipher = CredentialCipher::open(&secrets_dir)?;
    Ok(CredentialStore::new(Arc::new(Mutex::new(conn)), cipher))
}

fn build_resolver(store: CredentialStore) -> CredentialResolver {
    use aeqi_core::credentials::CredentialLifecycle;
    let lifecycles: Vec<Arc<dyn CredentialLifecycle>> = vec![
        Arc::new(StaticSecretLifecycle),
        Arc::new(OAuth2Lifecycle),
        Arc::new(DeviceSessionLifecycle),
        Arc::new(GithubAppLifecycle),
        Arc::new(ServiceAccountLifecycle),
    ];
    CredentialResolver::new(store, lifecycles)
}

fn credential_view(
    row: &CredentialRow,
    resolver: &CredentialResolver,
    store: &CredentialStore,
) -> CredentialView {
    let status = classify_row(row, resolver, store);
    let account_email = row
        .metadata
        .get("account_email")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
            // OAuth2 lifecycles often write the granted scope but not the
            // email — try `email` as a secondary key for forward-compat.
            row.metadata
                .get("email")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        });
    let granted_scopes = row
        .metadata
        .get("scopes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    CredentialView {
        id: row.id.clone(),
        scope_kind: row.scope_kind.as_str().to_string(),
        scope_id: row.scope_id.clone(),
        provider: row.provider.clone(),
        name: row.name.clone(),
        lifecycle_kind: row.lifecycle_kind.clone(),
        status: status.as_str().to_string(),
        account_email,
        expires_at: row.expires_at,
        created_at: row.created_at,
        last_refreshed_at: row.last_refreshed_at,
        last_used_at: row.last_used_at,
        granted_scopes,
    }
}

fn classify_row(
    row: &CredentialRow,
    resolver: &CredentialResolver,
    store: &CredentialStore,
) -> CredentialReasonCode {
    let lifecycle = match resolver.lifecycle_for(&row.lifecycle_kind) {
        Some(l) => l,
        None => return CredentialReasonCode::UnsupportedLifecycle,
    };
    let plaintext = match store.decrypt(row) {
        Ok(p) => p,
        Err(_) => return CredentialReasonCode::RefreshFailed,
    };
    if lifecycle.validate(&plaintext, &row.metadata).is_err() {
        return CredentialReasonCode::RefreshFailed;
    }
    if let Some(exp) = row.expires_at
        && exp <= Utc::now()
    {
        return CredentialReasonCode::Expired;
    }
    CredentialReasonCode::Ok
}

fn error_response(status: StatusCode, msg: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({"ok": false, "error": msg}))).into_response()
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::credentials::{CredentialCipher, CredentialInsert, CredentialStore, ScopeKind};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    fn test_store() -> (TempDir, CredentialStore) {
        let dir = TempDir::new().unwrap();
        let db = dir.path().join("aeqi.db");
        let conn = Connection::open(&db).unwrap();
        CredentialStore::initialize_schema(&conn).unwrap();
        let secrets = dir.path().join("secrets");
        std::fs::create_dir_all(&secrets).unwrap();
        let cipher = CredentialCipher::open(&secrets).unwrap();
        let store = CredentialStore::new(Arc::new(Mutex::new(conn)), cipher);
        (dir, store)
    }

    #[test]
    fn catalog_lists_google_workspace_first() {
        let entries = catalog();
        assert!(!entries.is_empty());
        assert_eq!(entries[0].provider, "google");
        assert_eq!(entries[0].name, "oauth_token");
        assert_eq!(entries[0].lifecycle_kind, "oauth2");
        assert!(
            entries[0]
                .oauth_scopes
                .contains(&"https://www.googleapis.com/auth/gmail.modify")
        );
    }

    #[test]
    fn catalog_includes_github_as_coming_soon() {
        let entries = catalog();
        let github = entries.iter().find(|e| e.provider == "github").unwrap();
        assert!(github.coming_soon);
    }

    #[test]
    fn bootstrap_registry_round_trip() {
        let registry = BootstrapRegistry::new();
        let entry = Arc::new(BootstrapEntry {
            status: Mutex::new(BootstrapStatus::Pending),
            created_at: Instant::now(),
        });
        registry.insert("h1".into(), entry.clone());
        let got = registry.get("h1").unwrap();
        match got.status.lock().unwrap().clone() {
            BootstrapStatus::Pending => {}
            other => panic!("expected Pending, got {other:?}"),
        }
        assert!(registry.get("nonexistent").is_none());
    }

    #[test]
    fn bootstrap_registry_status_transitions_visible_through_arc() {
        let registry = BootstrapRegistry::new();
        let entry = Arc::new(BootstrapEntry {
            status: Mutex::new(BootstrapStatus::Pending),
            created_at: Instant::now(),
        });
        registry.insert("h1".into(), entry.clone());
        // Mutate via the shared Arc as the background task would.
        *entry.status.lock().unwrap() = BootstrapStatus::Complete {
            credential_id: "abc".into(),
        };
        let snapshot = registry.get("h1").unwrap().status.lock().unwrap().clone();
        match snapshot {
            BootstrapStatus::Complete { credential_id } => assert_eq!(credential_id, "abc"),
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn credential_view_marks_ok_for_fresh_oauth_row() {
        let (_dir, store) = test_store();
        let resolver = build_resolver(store.clone());
        let metadata = serde_json::json!({
            "provider_kind": "google",
            "token_url": "https://oauth2.googleapis.com/token",
            "client_id": "test-client",
            "scopes": ["https://www.googleapis.com/auth/gmail.modify"],
            "account_email": "user@example.com"
        });
        let blob = serde_json::to_vec(&serde_json::json!({
            "access_token": "tok",
            "refresh_token": "rt",
            "token_type": "Bearer",
            "scope": "https://www.googleapis.com/auth/gmail.modify"
        }))
        .unwrap();
        let id = store
            .insert(CredentialInsert {
                scope_kind: ScopeKind::Agent,
                scope_id: "agent-1".into(),
                provider: "google".into(),
                name: "oauth_token".into(),
                lifecycle_kind: "oauth2".into(),
                plaintext_blob: blob,
                metadata,
                expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
            })
            .await
            .unwrap();
        let row = store.get(&id).await.unwrap().unwrap();
        let view = credential_view(&row, &resolver, &store);
        assert_eq!(view.status, "ok");
        assert_eq!(view.account_email.as_deref(), Some("user@example.com"));
        assert_eq!(view.scope_kind, "agent");
        assert_eq!(view.scope_id, "agent-1");
        assert!(
            view.granted_scopes
                .contains(&"https://www.googleapis.com/auth/gmail.modify".to_string())
        );
    }

    #[tokio::test]
    async fn credential_view_marks_expired_for_past_expiry() {
        let (_dir, store) = test_store();
        let resolver = build_resolver(store.clone());
        let metadata = serde_json::json!({
            "provider_kind": "google",
            "token_url": "https://oauth2.googleapis.com/token",
            "client_id": "test-client"
        });
        let blob = serde_json::to_vec(&serde_json::json!({
            "access_token": "tok",
            "token_type": "Bearer",
            "scope": ""
        }))
        .unwrap();
        let id = store
            .insert(CredentialInsert {
                scope_kind: ScopeKind::Agent,
                scope_id: "agent-2".into(),
                provider: "google".into(),
                name: "oauth_token".into(),
                lifecycle_kind: "oauth2".into(),
                plaintext_blob: blob,
                metadata,
                expires_at: Some(Utc::now() - chrono::Duration::hours(1)),
            })
            .await
            .unwrap();
        let row = store.get(&id).await.unwrap().unwrap();
        let view = credential_view(&row, &resolver, &store);
        assert_eq!(view.status, "expired");
    }

    #[tokio::test]
    async fn credential_view_marks_unsupported_lifecycle_for_unknown_kind() {
        let (_dir, store) = test_store();
        let resolver = build_resolver(store.clone());
        let id = store
            .insert(CredentialInsert {
                scope_kind: ScopeKind::Global,
                scope_id: "".into(),
                provider: "weird".into(),
                name: "x".into(),
                lifecycle_kind: "made_up".into(),
                plaintext_blob: b"x".to_vec(),
                metadata: serde_json::json!({}),
                expires_at: None,
            })
            .await
            .unwrap();
        let row = store.get(&id).await.unwrap().unwrap();
        let view = credential_view(&row, &resolver, &store);
        assert_eq!(view.status, "unsupported_lifecycle");
    }

    #[tokio::test]
    async fn list_by_scope_returns_only_matching_rows() {
        let (_dir, store) = test_store();
        let metadata = serde_json::json!({
            "provider_kind": "google",
            "token_url": "https://oauth2.googleapis.com/token",
            "client_id": "test-client"
        });
        let blob = serde_json::to_vec(&serde_json::json!({
            "access_token": "tok",
            "token_type": "Bearer",
            "scope": ""
        }))
        .unwrap();
        // Two agents, both Google.
        for agent in ["agent-a", "agent-b"] {
            store
                .insert(CredentialInsert {
                    scope_kind: ScopeKind::Agent,
                    scope_id: agent.into(),
                    provider: "google".into(),
                    name: "oauth_token".into(),
                    lifecycle_kind: "oauth2".into(),
                    plaintext_blob: blob.clone(),
                    metadata: metadata.clone(),
                    expires_at: None,
                })
                .await
                .unwrap();
        }
        let only_a = store
            .list_by_scope(ScopeKind::Agent, "agent-a")
            .await
            .unwrap();
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].scope_id, "agent-a");
    }
}
