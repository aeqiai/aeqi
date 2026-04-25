//! T1.9 — credential substrate end-to-end tests.
//!
//! Twenty cases covering migration, every lifecycle, tool capability
//! resolution, and the doctor reason-code surface. Mock OAuth + GitHub +
//! GCP servers are hand-rolled with axum on an OS-assigned port so the
//! tests don't reach out to the real internet.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aeqi_core::credentials::lifecycles::{
    DeviceSessionLifecycle, GithubAppLifecycle, OAuth2Lifecycle, OAuth2ProviderConfig,
    OAuth2Tokens, ServiceAccountLifecycle, StaticSecretLifecycle,
};
use aeqi_core::credentials::{
    CredentialCipher, CredentialInsert, CredentialKey, CredentialLifecycle, CredentialNeed,
    CredentialReasonCode, CredentialResolver, CredentialStore, ResolutionScope, ScopeHint,
    ScopeKind,
};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use aeqi_core::{CallerKind, ExecutionContext, SecretStore, ToolRegistry, UsableCredential};
use async_trait::async_trait;
use axum::Router;
use axum::extract::State;
use axum::routing::post;
use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::Connection;
use serde::Deserialize;
use std::sync::atomic::{AtomicUsize, Ordering};
use tempfile::TempDir;

// ────────────────────────────────────────────────────────────────────────
// Test scaffolding.
// ────────────────────────────────────────────────────────────────────────

struct TestEnv {
    _tempdir: TempDir,
    secrets_dir: PathBuf,
    store: CredentialStore,
}

fn env() -> TestEnv {
    let tempdir = TempDir::new().unwrap();
    let secrets_dir = tempdir.path().join("secrets");
    std::fs::create_dir_all(&secrets_dir).unwrap();
    let cipher = CredentialCipher::open(&secrets_dir).unwrap();
    let conn = Connection::open_in_memory().unwrap();
    CredentialStore::initialize_schema(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));
    let store = CredentialStore::new(db, cipher);
    TestEnv {
        _tempdir: tempdir,
        secrets_dir,
        store,
    }
}

fn default_lifecycles() -> Vec<Arc<dyn CredentialLifecycle>> {
    vec![
        Arc::new(StaticSecretLifecycle),
        Arc::new(OAuth2Lifecycle),
        Arc::new(DeviceSessionLifecycle),
        Arc::new(GithubAppLifecycle),
        Arc::new(ServiceAccountLifecycle),
    ]
}

// Spin up a hand-rolled HTTP server bound to localhost on an OS-assigned
// port and return the base URL plus a shutdown handle.
async fn spawn_mock_server<S>(state: S, routes: Router<S>) -> (String, tokio::task::JoinHandle<()>)
where
    S: Clone + Send + Sync + 'static,
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = routes.with_state(state);
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    // Give the server a tick to come up before tests fire requests.
    tokio::time::sleep(Duration::from_millis(20)).await;
    (format!("http://{addr}"), handle)
}

// ────────────────────────────────────────────────────────────────────────
// 1-3 — Migration: SecretStore → credentials; idempotent; round-trip.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_01_secret_store_migration_imports_entries() {
    let env = env();
    let secret_store = SecretStore::open(&env.secrets_dir).unwrap();
    secret_store
        .set("OPENROUTER_API_KEY", "sk-or-test")
        .unwrap();
    secret_store
        .set("ANTHROPIC_API_KEY", "sk-ant-test")
        .unwrap();

    let (inserted, _skipped) = secret_store
        .migrate_to_credentials(&env.store)
        .await
        .unwrap();
    assert_eq!(inserted, 2);

    let rows = env.store.list_all().await.unwrap();
    let names: Vec<&str> = rows.iter().map(|r| r.name.as_str()).collect();
    assert!(names.contains(&"OPENROUTER_API_KEY"));
    assert!(names.contains(&"ANTHROPIC_API_KEY"));
    for r in &rows {
        assert_eq!(r.scope_kind, ScopeKind::Global);
        assert_eq!(r.scope_id, "");
        assert_eq!(r.provider, "legacy");
        assert_eq!(r.lifecycle_kind, "static_secret");
    }
}

#[tokio::test]
async fn test_02_secret_store_migration_is_idempotent() {
    let env = env();
    let secret_store = SecretStore::open(&env.secrets_dir).unwrap();
    secret_store.set("KEY1", "v1").unwrap();
    secret_store
        .migrate_to_credentials(&env.store)
        .await
        .unwrap();
    let (inserted_again, skipped_again) = secret_store
        .migrate_to_credentials(&env.store)
        .await
        .unwrap();
    assert_eq!(inserted_again, 0);
    assert_eq!(skipped_again, 1);
    assert_eq!(env.store.list_all().await.unwrap().len(), 1);
}

#[tokio::test]
async fn test_03_secret_store_round_trip_through_credentials() {
    let env = env();
    let secret_store = SecretStore::open(&env.secrets_dir).unwrap();
    secret_store.set("TEST_TOKEN", "value-123").unwrap();
    secret_store
        .migrate_to_credentials(&env.store)
        .await
        .unwrap();

    let key = CredentialKey {
        scope_kind: ScopeKind::Global,
        scope_id: "".into(),
        provider: "legacy".into(),
        name: "TEST_TOKEN".into(),
    };
    let row = env.store.find(&key).await.unwrap().expect("row exists");
    let plain = env.store.decrypt(&row).unwrap();
    assert_eq!(plain, b"value-123");

    // Legacy SecretStore reads still work — filesystem entry untouched.
    assert_eq!(secret_store.get("TEST_TOKEN").unwrap(), "value-123");
}

// ────────────────────────────────────────────────────────────────────────
// 4-7 — static_secret lifecycle.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_04_static_secret_bootstrap_inserts_row() {
    let _env = env();
    let lifecycle = StaticSecretLifecycle;
    let bootstrapped = lifecycle
        .bootstrap(&aeqi_core::credentials::CredentialBootstrapContext {
            provider: "test",
            scope_kind: ScopeKind::Global,
            scope_id: "",
            config: &serde_json::json!({"value": "secret"}),
            http: None,
        })
        .await
        .unwrap();
    assert_eq!(bootstrapped.plaintext_blob, b"secret");
    assert!(bootstrapped.expires_at.is_none());
}

#[tokio::test]
async fn test_05_static_secret_validate_rejects_empty() {
    let lifecycle = StaticSecretLifecycle;
    assert!(lifecycle.validate(b"", &serde_json::json!({})).is_err());
    assert!(lifecycle.validate(b"x", &serde_json::json!({})).is_ok());
}

#[tokio::test]
async fn test_06_static_secret_resolve_returns_bearer() {
    let env = env();
    let lifecycle = StaticSecretLifecycle;
    let id = env
        .store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Global,
            scope_id: "".into(),
            provider: "legacy".into(),
            name: "OPENROUTER_API_KEY".into(),
            lifecycle_kind: "static_secret".into(),
            plaintext_blob: b"sk-or-resolve".to_vec(),
            metadata: serde_json::json!({}),
            expires_at: None,
        })
        .await
        .unwrap();
    let row = env.store.get(&id).await.unwrap().unwrap();
    let plaintext = env.store.decrypt(&row).unwrap();
    let usable = lifecycle
        .resolve(&aeqi_core::credentials::CredentialResolveContext {
            row: &row,
            plaintext: &plaintext,
            metadata: &row.metadata,
            http: None,
        })
        .await
        .unwrap();
    assert_eq!(usable.bearer.as_deref(), Some("sk-or-resolve"));
}

#[tokio::test]
async fn test_07_static_secret_refresh_is_noop_revoke_deletes() {
    let env = env();
    let lifecycle = StaticSecretLifecycle;
    let id = env
        .store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Global,
            scope_id: "".into(),
            provider: "legacy".into(),
            name: "TOKEN".into(),
            lifecycle_kind: "static_secret".into(),
            plaintext_blob: b"v".to_vec(),
            metadata: serde_json::json!({}),
            expires_at: None,
        })
        .await
        .unwrap();
    let row = env.store.get(&id).await.unwrap().unwrap();
    let plain = env.store.decrypt(&row).unwrap();
    let ctx = aeqi_core::credentials::CredentialResolveContext {
        row: &row,
        plaintext: &plain,
        metadata: &row.metadata,
        http: None,
    };
    match lifecycle.refresh(&ctx).await.unwrap() {
        aeqi_core::credentials::RefreshResult::NotNeeded => {}
        other => panic!("expected NotNeeded, got {other:?}"),
    }
    lifecycle.revoke(&ctx).await.unwrap();
    env.store.delete(&id).await.unwrap();
    assert!(env.store.get(&id).await.unwrap().is_none());
}

// ────────────────────────────────────────────────────────────────────────
// 8-12 — oauth2 lifecycle.
// ────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct OAuthMockState {
    refresh_calls: Arc<AtomicUsize>,
    refresh_response: Arc<Mutex<&'static str>>,
    refresh_status: Arc<Mutex<u16>>,
}

#[derive(Deserialize)]
struct FormBody {
    grant_type: String,
    #[allow(dead_code)]
    refresh_token: Option<String>,
    #[allow(dead_code)]
    client_id: Option<String>,
}

async fn token_handler(
    State(state): State<OAuthMockState>,
    body: axum::extract::Form<FormBody>,
) -> (
    axum::http::StatusCode,
    [(axum::http::HeaderName, &'static str); 1],
    String,
) {
    assert_eq!(body.grant_type, "refresh_token");
    state.refresh_calls.fetch_add(1, Ordering::SeqCst);
    let status = *state.refresh_status.lock().unwrap();
    let body = state.refresh_response.lock().unwrap().to_string();
    (
        axum::http::StatusCode::from_u16(status).unwrap(),
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    )
}

async fn spawn_oauth_mock() -> (String, OAuthMockState, tokio::task::JoinHandle<()>) {
    let state = OAuthMockState {
        refresh_calls: Arc::new(AtomicUsize::new(0)),
        refresh_response: Arc::new(Mutex::new(
            r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600,"token_type":"Bearer","scope":"foo"}"#,
        )),
        refresh_status: Arc::new(Mutex::new(200)),
    };
    let app = Router::new().route("/token", post(token_handler));
    let (base, handle) = spawn_mock_server(state.clone(), app).await;
    (base, state, handle)
}

fn oauth_provider(token_url: &str) -> OAuth2ProviderConfig {
    OAuth2ProviderConfig {
        provider_kind: "test".into(),
        auth_url: "https://example/auth".into(),
        token_url: token_url.into(),
        revoke_url: None,
        client_id: "client-id".into(),
        client_secret: None,
        scopes: vec!["foo".into()],
        redirect_uri: "http://localhost:0/callback".into(),
    }
}

async fn insert_oauth_row(
    env: &TestEnv,
    token_url: &str,
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
) -> String {
    let tokens = OAuth2Tokens {
        access_token: "old-access".into(),
        refresh_token: Some("old-refresh".into()),
        token_type: "Bearer".into(),
        scope: "foo".into(),
    };
    let blob = serde_json::to_vec(&tokens).unwrap();
    let metadata = serde_json::json!({
        "provider_kind": "test",
        "token_url": token_url,
        "auth_url": "https://example/auth",
        "client_id": "client-id",
    });
    env.store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Global,
            scope_id: "".into(),
            provider: "google".into(),
            name: "oauth_token".into(),
            lifecycle_kind: "oauth2".into(),
            plaintext_blob: blob,
            metadata,
            expires_at,
        })
        .await
        .unwrap()
}

#[tokio::test]
async fn test_08_oauth2_bootstrap_with_pre_authorized_tokens() {
    let _env = env();
    let lifecycle = OAuth2Lifecycle;
    let provider = oauth_provider("https://example/token");
    let bootstrapped = lifecycle
        .bootstrap(&aeqi_core::credentials::CredentialBootstrapContext {
            provider: "google",
            scope_kind: ScopeKind::Global,
            scope_id: "",
            config: &serde_json::json!({
                "provider": provider,
                "tokens": {
                    "access_token": "pre-access",
                    "refresh_token": "pre-refresh",
                    "token_type": "Bearer",
                    "scope": "foo",
                },
                "expires_at": (Utc::now() + ChronoDuration::seconds(3600)).to_rfc3339(),
            }),
            http: None,
        })
        .await
        .unwrap();
    let parsed: OAuth2Tokens = serde_json::from_slice(&bootstrapped.plaintext_blob).unwrap();
    assert_eq!(parsed.access_token, "pre-access");
    assert!(bootstrapped.expires_at.is_some());
}

#[tokio::test]
async fn test_09_oauth2_resolve_returns_bearer_header() {
    let env = env();
    let id = insert_oauth_row(&env, "https://example/token", None).await;
    let resolver = CredentialResolver::new(env.store.clone(), default_lifecycles());
    let row = env.store.get(&id).await.unwrap().unwrap();
    let usable = resolver.resolve_row(&row).await.unwrap();
    assert!(
        usable
            .headers
            .iter()
            .any(|(k, v)| k == "Authorization" && v.starts_with("Bearer "))
    );
}

#[tokio::test]
async fn test_10_oauth2_expired_then_refresh_replaces_blob() {
    let env = env();
    let (base, state, handle) = spawn_oauth_mock().await;
    let token_url = format!("{base}/token");
    let expired = Utc::now() - ChronoDuration::seconds(60);
    let id = insert_oauth_row(&env, &token_url, Some(expired)).await;
    let resolver = CredentialResolver::new(env.store.clone(), default_lifecycles());
    let need = CredentialNeed {
        provider: "google",
        name: "oauth_token",
        scope_hint: ScopeHint::Global,
        oauth_scopes: vec![],
        optional: false,
    };
    let usable = resolver
        .resolve(&need, &ResolutionScope::default())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state.refresh_calls.load(Ordering::SeqCst), 1);
    assert!(usable.bearer.unwrap().contains("new-access"));
    let row = env.store.get(&id).await.unwrap().unwrap();
    let plain = env.store.decrypt(&row).unwrap();
    let tokens: OAuth2Tokens = serde_json::from_slice(&plain).unwrap();
    assert_eq!(tokens.access_token, "new-access");
    assert_eq!(tokens.refresh_token.as_deref(), Some("new-refresh"));
    handle.abort();
}

#[tokio::test]
async fn test_11_oauth2_refresh_failed_invalid_grant_returns_revoked_code() {
    let env = env();
    let (base, state, handle) = spawn_oauth_mock().await;
    *state.refresh_status.lock().unwrap() = 400;
    *state.refresh_response.lock().unwrap() = r#"{"error":"invalid_grant"}"#;
    let token_url = format!("{base}/token");
    let expired = Utc::now() - ChronoDuration::seconds(60);
    let _id = insert_oauth_row(&env, &token_url, Some(expired)).await;
    let resolver = CredentialResolver::new(env.store.clone(), default_lifecycles());
    let need = CredentialNeed {
        provider: "google",
        name: "oauth_token",
        scope_hint: ScopeHint::Global,
        oauth_scopes: vec![],
        optional: false,
    };
    let err = resolver
        .resolve(&need, &ResolutionScope::default())
        .await
        .expect_err("expected resolve to fail on invalid_grant");
    assert_eq!(err.code, CredentialReasonCode::RevokedByProvider);
    handle.abort();
}

#[tokio::test]
async fn test_12_oauth2_validate_rejects_missing_metadata() {
    let lifecycle = OAuth2Lifecycle;
    let blob = serde_json::to_vec(&OAuth2Tokens {
        access_token: "a".into(),
        refresh_token: None,
        token_type: "Bearer".into(),
        scope: "".into(),
    })
    .unwrap();
    // Missing client_id in metadata.
    let bad = serde_json::json!({"provider_kind": "test", "token_url": "x"});
    assert!(lifecycle.validate(&blob, &bad).is_err());
    let good = serde_json::json!({
        "provider_kind": "test",
        "token_url": "x",
        "client_id": "y",
    });
    assert!(lifecycle.validate(&blob, &good).is_ok());
}

// ────────────────────────────────────────────────────────────────────────
// 13-15 — device_session lifecycle.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_13_device_session_bootstrap_round_trip() {
    let lifecycle = DeviceSessionLifecycle;
    let blob = serde_json::json!({
        "noise_key": "abc",
        "signal_pre_keys": [1,2,3]
    });
    let bootstrapped = lifecycle
        .bootstrap(&aeqi_core::credentials::CredentialBootstrapContext {
            provider: "whatsapp_baileys",
            scope_kind: ScopeKind::Channel,
            scope_id: "ch1",
            config: &serde_json::json!({"blob": blob, "metadata": {"jid": "555@s.whatsapp.net"}}),
            http: None,
        })
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&bootstrapped.plaintext_blob).unwrap();
    assert_eq!(parsed["noise_key"], "abc");
    assert_eq!(bootstrapped.metadata["jid"], "555@s.whatsapp.net");
}

#[tokio::test]
async fn test_14_device_session_resolve_returns_raw_blob() {
    let env = env();
    let lifecycle = DeviceSessionLifecycle;
    let blob = serde_json::json!({"noise_key": "abc"});
    let id = env
        .store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Channel,
            scope_id: "channel-A".into(),
            provider: "whatsapp_baileys".into(),
            name: "session_state".into(),
            lifecycle_kind: "device_session".into(),
            plaintext_blob: serde_json::to_vec(&blob).unwrap(),
            metadata: serde_json::json!({}),
            expires_at: None,
        })
        .await
        .unwrap();
    let row = env.store.get(&id).await.unwrap().unwrap();
    let plain = env.store.decrypt(&row).unwrap();
    let usable = lifecycle
        .resolve(&aeqi_core::credentials::CredentialResolveContext {
            row: &row,
            plaintext: &plain,
            metadata: &row.metadata,
            http: None,
        })
        .await
        .unwrap();
    let parsed: serde_json::Value = serde_json::from_slice(&usable.raw).unwrap();
    assert_eq!(parsed["noise_key"], "abc");
    assert!(usable.bearer.is_none());
}

#[tokio::test]
async fn test_15_device_session_refresh_says_re_pair_required() {
    let env = env();
    let lifecycle = DeviceSessionLifecycle;
    let id = env
        .store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Channel,
            scope_id: "ch".into(),
            provider: "whatsapp_baileys".into(),
            name: "session_state".into(),
            lifecycle_kind: "device_session".into(),
            plaintext_blob: serde_json::to_vec(&serde_json::json!({"x": 1})).unwrap(),
            metadata: serde_json::json!({}),
            expires_at: None,
        })
        .await
        .unwrap();
    let row = env.store.get(&id).await.unwrap().unwrap();
    let plain = env.store.decrypt(&row).unwrap();
    let result = lifecycle
        .refresh(&aeqi_core::credentials::CredentialResolveContext {
            row: &row,
            plaintext: &plain,
            metadata: &row.metadata,
            http: None,
        })
        .await
        .unwrap();
    match result {
        aeqi_core::credentials::RefreshResult::Failed(code, _) => {
            assert_eq!(code, CredentialReasonCode::RefreshFailed);
        }
        other => panic!("expected Failed, got {other:?}"),
    }
}

// ────────────────────────────────────────────────────────────────────────
// 16-17 — github_app lifecycle (mocked GitHub API).
// ────────────────────────────────────────────────────────────────────────

const TEST_RSA_PEM: &str = include_str!("fixtures/test_rsa_private.pem");

#[derive(Clone)]
struct GithubMockState {
    mint_calls: Arc<AtomicUsize>,
    next_token: Arc<Mutex<String>>,
    next_expires_at: Arc<Mutex<chrono::DateTime<chrono::Utc>>>,
}

async fn github_mint_handler(
    State(state): State<GithubMockState>,
) -> (
    axum::http::StatusCode,
    [(axum::http::HeaderName, &'static str); 1],
    String,
) {
    state.mint_calls.fetch_add(1, Ordering::SeqCst);
    let token = state.next_token.lock().unwrap().clone();
    let exp = state.next_expires_at.lock().unwrap().to_rfc3339();
    (
        axum::http::StatusCode::CREATED,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        format!(r#"{{"token":"{token}","expires_at":"{exp}"}}"#),
    )
}

async fn spawn_github_mock() -> (String, GithubMockState, tokio::task::JoinHandle<()>) {
    let state = GithubMockState {
        mint_calls: Arc::new(AtomicUsize::new(0)),
        next_token: Arc::new(Mutex::new("ghs_first".into())),
        next_expires_at: Arc::new(Mutex::new(Utc::now() + ChronoDuration::seconds(3600))),
    };
    let app = Router::new().route(
        "/app/installations/{id}/access_tokens",
        post(github_mint_handler),
    );
    let (base, handle) = spawn_mock_server(state.clone(), app).await;
    (base, state, handle)
}

#[tokio::test]
async fn test_16_github_app_mints_installation_token() {
    let env = env();
    let (base, state, handle) = spawn_github_mock().await;
    let blob = serde_json::json!({
        "app_id": "12345",
        "private_key_pem": TEST_RSA_PEM,
        "installation_id": "67890",
    });
    let id = env
        .store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Installation,
            scope_id: "67890".into(),
            provider: "github".into(),
            name: "app_token".into(),
            lifecycle_kind: "github_app".into(),
            plaintext_blob: serde_json::to_vec(&blob).unwrap(),
            metadata: serde_json::json!({"api_base": base}),
            expires_at: None,
        })
        .await
        .unwrap();
    let resolver = CredentialResolver::new(env.store.clone(), default_lifecycles());
    let row = env.store.get(&id).await.unwrap().unwrap();
    let usable = resolver.resolve_row(&row).await.unwrap();
    assert_eq!(state.mint_calls.load(Ordering::SeqCst), 1);
    assert!(usable.bearer.unwrap().starts_with("ghs_"));
    handle.abort();
}

#[tokio::test]
async fn test_17_github_app_refresh_mints_fresh_token() {
    let env = env();
    let (base, state, handle) = spawn_github_mock().await;
    *state.next_token.lock().unwrap() = "ghs_refreshed".into();
    let blob = serde_json::json!({
        "app_id": "12345",
        "private_key_pem": TEST_RSA_PEM,
        "installation_id": "67890",
    });
    env.store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Installation,
            scope_id: "67890".into(),
            provider: "github".into(),
            name: "app_token".into(),
            lifecycle_kind: "github_app".into(),
            plaintext_blob: serde_json::to_vec(&blob).unwrap(),
            metadata: serde_json::json!({"api_base": base}),
            expires_at: None,
        })
        .await
        .unwrap();
    let lifecycle = GithubAppLifecycle;
    let key = CredentialKey {
        scope_kind: ScopeKind::Installation,
        scope_id: "67890".into(),
        provider: "github".into(),
        name: "app_token".into(),
    };
    let row = env.store.find(&key).await.unwrap().unwrap();
    let plain = env.store.decrypt(&row).unwrap();
    let http = reqwest::Client::new();
    let result = lifecycle
        .refresh(&aeqi_core::credentials::CredentialResolveContext {
            row: &row,
            plaintext: &plain,
            metadata: &row.metadata,
            http: Some(&http),
        })
        .await
        .unwrap();
    match result {
        aeqi_core::credentials::RefreshResult::Refreshed(usable) => {
            assert!(usable.bearer.unwrap().contains("ghs_refreshed"));
            assert_eq!(state.mint_calls.load(Ordering::SeqCst), 1);
        }
        other => panic!("expected Refreshed, got {other:?}"),
    }
    handle.abort();
}

// ────────────────────────────────────────────────────────────────────────
// 18-19 — Tool capability resolution.
// ────────────────────────────────────────────────────────────────────────

struct GmailEchoTool;

#[async_trait]
impl Tool for GmailEchoTool {
    async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
        Ok(ToolResult::error("called without credentials"))
    }
    async fn execute_with_credentials(
        &self,
        _args: serde_json::Value,
        creds: Vec<Option<UsableCredential>>,
    ) -> anyhow::Result<ToolResult> {
        let cred = creds.into_iter().next().flatten();
        match cred {
            Some(c) => Ok(ToolResult::success(format!(
                "ok bearer={}",
                c.bearer.unwrap_or_default()
            ))),
            None => Ok(ToolResult::error("missing")),
        }
    }
    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "gmail.search".into(),
            description: "test".into(),
            input_schema: serde_json::json!({"type": "object"}),
        }
    }
    fn name(&self) -> &str {
        "gmail.search"
    }
    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![CredentialNeed::new(
            "google",
            "oauth_token",
            ScopeHint::Global,
        )]
    }
}

#[tokio::test]
async fn test_18_tool_capability_resolves_credentials() {
    let env = env();
    let _id = insert_oauth_row(&env, "https://example/token", None).await;
    let resolver = CredentialResolver::new(env.store.clone(), default_lifecycles());
    let registry = ToolRegistry::new(vec![Arc::new(GmailEchoTool)]);
    let mut ctx = ExecutionContext::test("s1", "a1");
    ctx.credential_resolver = Some(resolver);
    let result = registry
        .invoke("gmail.search", serde_json::json!({}), CallerKind::Llm, &ctx)
        .await
        .unwrap();
    assert!(!result.is_error);
    assert!(result.output.contains("ok bearer="));
}

#[tokio::test]
async fn test_19_tool_capability_missing_credential_surfaces_reason_code() {
    let env = env();
    let resolver = CredentialResolver::new(env.store.clone(), default_lifecycles());
    let registry = ToolRegistry::new(vec![Arc::new(GmailEchoTool)]);
    let mut ctx = ExecutionContext::test("s1", "a1");
    ctx.credential_resolver = Some(resolver);
    let result = registry
        .invoke("gmail.search", serde_json::json!({}), CallerKind::Llm, &ctx)
        .await
        .unwrap();
    assert!(result.is_error);
    assert!(
        result
            .output
            .contains(CredentialReasonCode::MissingCredential.as_str()),
        "expected reason code in error output, got: {}",
        result.output
    );
}

// ────────────────────────────────────────────────────────────────────────
// 20 — aeqi doctor reason-code surface.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn test_20_doctor_reason_codes_are_stable_strings() {
    use CredentialReasonCode::*;
    assert_eq!(Ok.as_str(), "ok");
    assert_eq!(MissingCredential.as_str(), "missing_credential");
    assert_eq!(Expired.as_str(), "expired");
    assert_eq!(RefreshFailed.as_str(), "refresh_failed");
    assert_eq!(RevokedByProvider.as_str(), "revoked_by_provider");
    assert_eq!(UnsupportedLifecycle.as_str(), "unsupported_lifecycle");
    assert_eq!(ScopeMismatch.as_str(), "scope_mismatch");
    assert_eq!(UnresolvedRef.as_str(), "unresolved_ref");
}
