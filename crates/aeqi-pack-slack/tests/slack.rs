//! W3 — Slack pack end-to-end tests.
//!
//! Fourteen-plus cases covering each tool's request shape, refresh-on-401
//! retry, per-workspace isolation, ok=false envelope handling, cursor
//! pagination capped at 200, and rate-limit handling. Mock Slack endpoints
//! are hand-rolled with axum on an OS-assigned port — no tests reach out
//! to the real slack.com.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aeqi_core::credentials::lifecycles::{OAuth2Lifecycle, OAuth2Tokens};
use aeqi_core::credentials::{
    CredentialCipher, CredentialInsert, CredentialLifecycle, CredentialResolver, CredentialStore,
    ResolutionScope, ScopeKind, UsableCredential,
};
use aeqi_core::traits::Tool;
use aeqi_core::{CallerKind, ExecutionContext, ToolRegistry};
use aeqi_pack_slack::{
    channels::{ChannelsArchiveTool, ChannelsCreateTool, ChannelsInfoTool, ChannelsListTool},
    messages::{MessagesDeleteTool, MessagesHistoryTool, MessagesPostTool, MessagesUpdateTool},
    reactions::{ReactionsAddTool, ReactionsRemoveTool},
    search::SearchMessagesTool,
    users::{UsersInfoTool, UsersListTool, UsersLookupByEmailTool},
};
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use rusqlite::Connection;
use serde_json::{Value, json};
use tempfile::TempDir;

// ────────────────────────────────────────────────────────────────────────
// Mock state + scaffolding.
// ────────────────────────────────────────────────────────────────────────

/// `(method, params)` capture used by the form / query mutexes — keeps
/// the test struct readable and silences clippy's `type_complexity` lint.
type Capture = Option<(String, Vec<(String, String)>)>;

#[derive(Clone, Default)]
struct MockState {
    last_body: Arc<Mutex<Option<(String, Value)>>>,
    last_form: Arc<Mutex<Capture>>,
    last_query: Arc<Mutex<Capture>>,
    history: Arc<Mutex<Vec<String>>>,
    last_auth: Arc<Mutex<Option<String>>>,
    /// Token-tagged channel store keyed by `Authorization` header value
    /// — used by the per-workspace isolation test.
    channels_by_auth: Arc<Mutex<std::collections::HashMap<String, Vec<Value>>>>,
    /// Number of consecutive 401 envelopes to return before serving the
    /// real response.
    fail_with_401: Arc<AtomicUsize>,
    /// Number of consecutive 429 responses to return before serving the
    /// real response.
    fail_with_429: Arc<AtomicUsize>,
    /// Counter for how many list pages have been requested — drives the
    /// pagination test's cursor walk.
    page_counter: Arc<AtomicUsize>,
}

async fn spawn_mock(state: MockState) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{addr}");
    let app = slack_router().with_state(state);
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    (base, handle)
}

fn slack_router() -> Router<MockState> {
    Router::new()
        // Channels
        .route("/conversations.list", get(conversations_list))
        .route("/conversations.info", get(conversations_info))
        .route("/conversations.create", post(conversations_create))
        .route("/conversations.archive", post(conversations_archive))
        // Messages
        .route("/chat.postMessage", post(chat_post_message))
        .route("/chat.update", post(chat_update))
        .route("/chat.delete", post(chat_delete))
        .route("/conversations.history", get(conversations_history))
        // Reactions
        .route("/reactions.add", post(reactions_add))
        .route("/reactions.remove", post(reactions_remove))
        // Users
        .route("/users.list", get(users_list))
        .route("/users.info", get(users_info))
        .route("/users.lookupByEmail", get(users_lookup_by_email))
        // Search
        .route("/search.messages", get(search_messages))
        // Pagination probe
        .route("/users.list_paged", get(users_list_paged))
        // OAuth refresh endpoint (used by the 401 retry test).
        .route("/oauth/v2/access", post(oauth_refresh))
}

fn record(s: &MockState, headers: &HeaderMap, label: impl Into<String>) {
    s.history.lock().unwrap().push(label.into());
    if let Some(v) = headers.get("Authorization").and_then(|v| v.to_str().ok()) {
        *s.last_auth.lock().unwrap() = Some(v.to_string());
    }
}

fn try_consume_401(s: &MockState) -> bool {
    let prev = s.fail_with_401.load(Ordering::SeqCst);
    if prev > 0 {
        s.fail_with_401.fetch_sub(1, Ordering::SeqCst);
        return true;
    }
    false
}

fn try_consume_429(s: &MockState) -> bool {
    let prev = s.fail_with_429.load(Ordering::SeqCst);
    if prev > 0 {
        s.fail_with_429.fetch_sub(1, Ordering::SeqCst);
        return true;
    }
    false
}

/// Slack returns 401 with no body for invalid Authorization headers in
/// production; aeqi maps that to AuthExpired regardless of body.
fn unauth_response() -> axum::response::Response {
    (axum::http::StatusCode::UNAUTHORIZED, Json(json!({}))).into_response()
}

fn rate_limited_response() -> axum::response::Response {
    let mut hm = HeaderMap::new();
    hm.insert("Retry-After", "30".parse().unwrap());
    (
        axum::http::StatusCode::TOO_MANY_REQUESTS,
        hm,
        Json(json!({ "ok": false, "error": "ratelimited" })),
    )
        .into_response()
}

fn auth_value(headers: &HeaderMap) -> String {
    headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

async fn conversations_list(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /conversations.list");
    *s.last_query.lock().unwrap() = Some((
        "conversations.list".into(),
        q.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    if try_consume_401(&s) {
        return unauth_response();
    }
    if try_consume_429(&s) {
        return rate_limited_response();
    }
    // Per-workspace channel data lookup. Defaults to a single canonical
    // workspace's channel list when no token-specific data is set.
    let auth = auth_value(&headers);
    let channels = {
        let map = s.channels_by_auth.lock().unwrap();
        map.get(&auth).cloned().unwrap_or_else(|| {
            vec![json!({
                "id": "C100",
                "name": "general",
                "is_private": false,
                "is_archived": false,
                "is_member": true,
                "num_members": 5,
                "topic": { "value": "the topic" },
                "purpose": { "value": "the purpose" }
            })]
        })
    };
    Json(json!({
        "ok": true,
        "channels": channels,
        "response_metadata": { "next_cursor": "" }
    }))
    .into_response()
}

async fn conversations_info(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /conversations.info");
    *s.last_query.lock().unwrap() = Some((
        "conversations.info".into(),
        q.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    if try_consume_401(&s) {
        return unauth_response();
    }
    let channel = q.get("channel").cloned().unwrap_or_default();
    Json(json!({
        "ok": true,
        "channel": {
            "id": channel,
            "name": "the-channel",
            "is_private": false,
            "is_archived": false,
            "is_member": true,
            "num_members": 7,
            "created": 1700000000_i64,
            "topic": { "value": "topic value" },
            "purpose": { "value": "purpose value" }
        }
    }))
    .into_response()
}

async fn conversations_create(
    State(s): State<MockState>,
    headers: HeaderMap,
    Form(form): Form<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    record(&s, &headers, "POST /conversations.create");
    *s.last_form.lock().unwrap() = Some((
        "conversations.create".into(),
        form.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    let name = form.get("name").cloned().unwrap_or_default();
    let is_private = form.get("is_private").map(|v| v == "true").unwrap_or(false);
    Json(json!({
        "ok": true,
        "channel": {
            "id": "C9NEW",
            "name": name,
            "is_private": is_private,
        }
    }))
    .into_response()
}

async fn conversations_archive(
    State(s): State<MockState>,
    headers: HeaderMap,
    Form(form): Form<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    record(&s, &headers, "POST /conversations.archive");
    *s.last_form.lock().unwrap() = Some((
        "conversations.archive".into(),
        form.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    Json(json!({ "ok": true })).into_response()
}

async fn chat_post_message(
    State(s): State<MockState>,
    headers: HeaderMap,
    body: axum::body::Body,
) -> axum::response::Response {
    record(&s, &headers, "POST /chat.postMessage");
    let bytes = axum::body::to_bytes(body, 1_000_000).await.unwrap();
    let ct = headers
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if ct.contains("application/json") {
        let v: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        *s.last_body.lock().unwrap() = Some(("chat.postMessage".into(), v.clone()));
        let channel = v
            .get("channel")
            .and_then(|c| c.as_str())
            .unwrap_or_default();
        return Json(json!({
            "ok": true,
            "channel": channel,
            "ts": "1700000000.000100",
        }))
        .into_response();
    }
    // form-encoded
    let s_str = String::from_utf8_lossy(&bytes).to_string();
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(&s_str).unwrap_or_default();
    let pairs_v: Vec<(String, String)> = pairs.clone();
    let map: std::collections::HashMap<String, String> = pairs.into_iter().collect();
    *s.last_form.lock().unwrap() = Some(("chat.postMessage".into(), pairs_v));
    let channel = map.get("channel").cloned().unwrap_or_default();
    Json(json!({
        "ok": true,
        "channel": channel,
        "ts": "1700000000.000100",
    }))
    .into_response()
}

async fn chat_update(
    State(s): State<MockState>,
    headers: HeaderMap,
    body: axum::body::Body,
) -> axum::response::Response {
    record(&s, &headers, "POST /chat.update");
    let bytes = axum::body::to_bytes(body, 1_000_000).await.unwrap();
    let ct = headers
        .get("Content-Type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_string();
    if ct.contains("application/json") {
        let v: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        *s.last_body.lock().unwrap() = Some(("chat.update".into(), v.clone()));
        let channel = v
            .get("channel")
            .and_then(|c| c.as_str())
            .unwrap_or_default();
        let ts = v.get("ts").and_then(|c| c.as_str()).unwrap_or_default();
        return Json(json!({ "ok": true, "channel": channel, "ts": ts })).into_response();
    }
    let s_str = String::from_utf8_lossy(&bytes).to_string();
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(&s_str).unwrap_or_default();
    let pairs_v = pairs.clone();
    let map: std::collections::HashMap<String, String> = pairs.into_iter().collect();
    *s.last_form.lock().unwrap() = Some(("chat.update".into(), pairs_v));
    Json(json!({
        "ok": true,
        "channel": map.get("channel").cloned().unwrap_or_default(),
        "ts": map.get("ts").cloned().unwrap_or_default(),
    }))
    .into_response()
}

async fn chat_delete(
    State(s): State<MockState>,
    headers: HeaderMap,
    Form(form): Form<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    record(&s, &headers, "POST /chat.delete");
    *s.last_form.lock().unwrap() = Some((
        "chat.delete".into(),
        form.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    Json(json!({
        "ok": true,
        "channel": form.get("channel").cloned().unwrap_or_default(),
        "ts": form.get("ts").cloned().unwrap_or_default(),
    }))
    .into_response()
}

async fn conversations_history(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /conversations.history");
    *s.last_query.lock().unwrap() = Some((
        "conversations.history".into(),
        q.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    Json(json!({
        "ok": true,
        "messages": [
            {
                "type": "message",
                "user": "U1",
                "text": "hello",
                "ts": "1700000000.000100",
                "reactions": [{ "name": "thumbsup", "users": ["U2"], "count": 1 }]
            },
            {
                "type": "message",
                "user": "U2",
                "text": "world",
                "ts": "1700000001.000100",
                "thread_ts": "1700000000.000100"
            }
        ],
        "response_metadata": { "next_cursor": "" }
    }))
    .into_response()
}

async fn reactions_add(
    State(s): State<MockState>,
    headers: HeaderMap,
    Form(form): Form<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    record(&s, &headers, "POST /reactions.add");
    *s.last_form.lock().unwrap() = Some((
        "reactions.add".into(),
        form.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    Json(json!({ "ok": true })).into_response()
}

async fn reactions_remove(
    State(s): State<MockState>,
    headers: HeaderMap,
    Form(form): Form<std::collections::HashMap<String, String>>,
) -> axum::response::Response {
    record(&s, &headers, "POST /reactions.remove");
    *s.last_form.lock().unwrap() = Some((
        "reactions.remove".into(),
        form.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    Json(json!({ "ok": true })).into_response()
}

async fn users_list(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /users.list");
    *s.last_query.lock().unwrap() = Some((
        "users.list".into(),
        q.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    Json(json!({
        "ok": true,
        "members": [
            {
                "id": "U1",
                "name": "alice",
                "real_name": "Alice Allen",
                "is_bot": false,
                "is_admin": true,
                "deleted": false,
                "tz": "America/New_York",
                "profile": { "email": "alice@example.com", "display_name": "alice", "title": "CEO" }
            },
            {
                "id": "U2",
                "name": "ghost",
                "real_name": "Ghost",
                "is_bot": false,
                "is_admin": false,
                "deleted": true,
                "tz": "UTC",
                "profile": { "email": null }
            },
            {
                "id": "B1",
                "name": "aeqi",
                "real_name": "aeqi bot",
                "is_bot": true,
                "is_admin": false,
                "deleted": false,
                "tz": "UTC",
                "profile": { "email": null, "display_name": "aeqi" }
            }
        ],
        "response_metadata": { "next_cursor": "" }
    }))
    .into_response()
}

async fn users_info(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /users.info");
    *s.last_query.lock().unwrap() = Some((
        "users.info".into(),
        q.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    let user = q.get("user").cloned().unwrap_or_default();
    Json(json!({
        "ok": true,
        "user": {
            "id": user,
            "name": "alice",
            "real_name": "Alice Allen",
            "is_bot": false,
            "is_admin": true,
            "deleted": false,
            "tz": "America/New_York",
            "profile": { "email": "alice@example.com", "display_name": "alice", "title": "CEO" }
        }
    }))
    .into_response()
}

async fn users_lookup_by_email(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /users.lookupByEmail");
    *s.last_query.lock().unwrap() = Some((
        "users.lookupByEmail".into(),
        q.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    let email = q.get("email").cloned().unwrap_or_default();
    if email == "missing@example.com" {
        return Json(json!({ "ok": false, "error": "users_not_found" })).into_response();
    }
    Json(json!({
        "ok": true,
        "user": {
            "id": "U1",
            "name": "alice",
            "real_name": "Alice Allen",
            "is_bot": false,
            "is_admin": true,
            "deleted": false,
            "tz": "America/New_York",
            "profile": { "email": email, "display_name": "alice", "title": "CEO" }
        }
    }))
    .into_response()
}

async fn search_messages(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /search.messages");
    *s.last_query.lock().unwrap() = Some((
        "search.messages".into(),
        q.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
    ));
    let query = q.get("query").cloned().unwrap_or_default();
    if query == "force_paid_only" {
        return Json(json!({ "ok": false, "error": "paid_only" })).into_response();
    }
    Json(json!({
        "ok": true,
        "messages": {
            "total": 2,
            "matches": [
                {
                    "ts": "1700000000.000100",
                    "user": "U1",
                    "username": "alice",
                    "text": "matched message one",
                    "channel": { "id": "C100", "name": "general" },
                    "permalink": "https://workspace.slack.com/archives/C100/p1700000000000100"
                },
                {
                    "ts": "1700000001.000100",
                    "user": "U2",
                    "username": "bob",
                    "text": "matched message two",
                    "channel": { "id": "C200", "name": "random" },
                    "permalink": "https://workspace.slack.com/archives/C200/p1700000001000100"
                }
            ]
        }
    }))
    .into_response()
}

/// Cursor-paginated `users.list` substitute used only by the pagination
/// test. Returns 100 members per page across pages 1/2/3 (50 on the
/// final page) so the pack-wide cap of 200 is exercised exactly.
async fn users_list_paged(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /users.list_paged");
    s.page_counter.fetch_add(1, Ordering::SeqCst);
    let cursor = q.get("cursor").cloned().unwrap_or_default();
    let page = match cursor.as_str() {
        "" => 1usize,
        "p2" => 2,
        "p3" => 3,
        _ => 1,
    };
    let count = if page == 3 { 50 } else { 100 };
    let mut members = Vec::with_capacity(count);
    for i in 0..count {
        let n = (page - 1) * 100 + i + 1;
        members.push(json!({
            "id": format!("U{n}"),
            "name": format!("user-{n}"),
            "deleted": false,
            "is_bot": false,
            "is_admin": false,
            "tz": "UTC",
            "profile": { "email": format!("user-{n}@example.com") }
        }));
    }
    let next_cursor = match page {
        1 => "p2",
        2 => "p3",
        _ => "",
    };
    Json(json!({
        "ok": true,
        "members": members,
        "response_metadata": { "next_cursor": next_cursor }
    }))
    .into_response()
}

async fn oauth_refresh(State(_s): State<MockState>) -> axum::response::Response {
    Json(json!({
        "access_token":  "xoxb-fresh",
        "refresh_token": "xoxe-rotated",
        "token_type":    "Bearer",
        "expires_in":    43200,
        "scope":         "chat:write,channels:read,channels:history,channels:manage,users:read,users:read.email,reactions:write,search:read,groups:read,im:read,im:write,mpim:read"
    }))
    .into_response()
}

// ────────────────────────────────────────────────────────────────────────
// Helpers — credential plumbing.
// ────────────────────────────────────────────────────────────────────────

struct Env {
    _tempdir: TempDir,
    store: CredentialStore,
    resolver: CredentialResolver,
}

fn env() -> Env {
    let tempdir = TempDir::new().unwrap();
    let secrets_dir = tempdir.path().join("secrets");
    std::fs::create_dir_all(&secrets_dir).unwrap();
    let cipher = CredentialCipher::open(&secrets_dir).unwrap();
    let conn = Connection::open_in_memory().unwrap();
    CredentialStore::initialize_schema(&conn).unwrap();
    let db = Arc::new(Mutex::new(conn));
    let store = CredentialStore::new(db, cipher);
    let lifecycles: Vec<Arc<dyn CredentialLifecycle>> = vec![Arc::new(OAuth2Lifecycle)];
    let resolver = CredentialResolver::new(store.clone(), lifecycles);
    Env {
        _tempdir: tempdir,
        store,
        resolver,
    }
}

/// Insert a Slack OAuth2 row keyed on a workspace id. We pass the
/// workspace id through `ScopeKind::User` so `ScopeHint::User` resolves
/// directly — the credential-substrate's `User` axis is the canonical
/// "per-tenant" axis aeqi already has, and Slack's bot tokens are scoped
/// per workspace.
async fn seed_workspace(
    env: &Env,
    workspace_id: &str,
    base_url: &str,
    access_token: &str,
    refresh_token: &str,
) -> String {
    let tokens = OAuth2Tokens {
        access_token: access_token.into(),
        refresh_token: Some(refresh_token.into()),
        token_type: "Bearer".into(),
        scope: "chat:write,channels:read,channels:history,channels:manage,users:read,\
            users:read.email,reactions:write,search:read,groups:read,im:read,im:write,\
            mpim:read"
            .into(),
    };
    let plaintext = serde_json::to_vec(&tokens).unwrap();
    let metadata = json!({
        "provider_kind": "slack",
        "auth_url":   "https://slack.com/oauth/v2/authorize",
        "token_url":  format!("{base_url}/oauth/v2/access"),
        "client_id":  "test-client-id",
        "scopes":     [
            "chat:write","channels:read","channels:history","channels:manage",
            "groups:read","im:read","im:write","mpim:read","users:read",
            "users:read.email","reactions:write","search:read"
        ],
        "redirect_uri": "http://localhost:0/callback",
        "aeqi_test_base": base_url,
    });
    env.store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::User,
            scope_id: workspace_id.into(),
            provider: "slack".into(),
            name: "bot_token".into(),
            lifecycle_kind: "oauth2".into(),
            plaintext_blob: plaintext,
            metadata,
            expires_at: None,
        })
        .await
        .unwrap()
}

fn registry_with(tools: Vec<Arc<dyn Tool>>) -> ToolRegistry {
    ToolRegistry::new(tools)
}

fn ctx(env: &Env, workspace_id: &str) -> ExecutionContext {
    ExecutionContext {
        session_id: "s1".into(),
        agent_id: "agentA".into(),
        credential_resolver: Some(env.resolver.clone()),
        credential_scope: ResolutionScope {
            user_id: Some(workspace_id.into()),
            ..Default::default()
        },
        ..Default::default()
    }
}

// ────────────────────────────────────────────────────────────────────────
// 1 — slack.channels.list returns mapped fields.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t01_channels_list_returns_mapped_fields() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;

    let reg = registry_with(vec![Arc::new(ChannelsListTool)]);
    let result = reg
        .invoke(
            "slack.channels.list",
            json!({"types": "public_channel,private_channel", "exclude_archived": false}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let channels = result.data["channels"].as_array().unwrap();
    assert_eq!(channels.len(), 1);
    assert_eq!(channels[0]["id"], "C100");
    assert_eq!(channels[0]["name"], "general");
    assert_eq!(channels[0]["topic"], "the topic");
    assert_eq!(channels[0]["purpose"], "the purpose");
    let q = mock_state.last_query.lock().unwrap().clone().unwrap();
    assert_eq!(q.0, "conversations.list");
    let qmap: std::collections::HashMap<_, _> = q.1.into_iter().collect();
    assert_eq!(
        qmap.get("types").map(String::as_str),
        Some("public_channel,private_channel")
    );
    assert_eq!(
        qmap.get("exclude_archived").map(String::as_str),
        Some("false")
    );
    assert_eq!(qmap.get("limit").map(String::as_str), Some("100"));
}

// ────────────────────────────────────────────────────────────────────────
// 2 — slack.channels.info projects the channel envelope.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t02_channels_info_projects_envelope() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(ChannelsInfoTool)]);
    let result = reg
        .invoke(
            "slack.channels.info",
            json!({"channel": "C100"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["id"], "C100");
    assert_eq!(result.data["name"], "the-channel");
    assert_eq!(result.data["topic"], "topic value");
    assert_eq!(result.data["num_members"], 7);
    assert_eq!(result.data["created"], 1_700_000_000_i64);
}

// ────────────────────────────────────────────────────────────────────────
// 3 — slack.channels.create round-trips name + is_private.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t03_channels_create_round_trips_name_and_visibility() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(ChannelsCreateTool)]);
    let result = reg
        .invoke(
            "slack.channels.create",
            json!({"name": "secret-room", "is_private": true}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["id"], "C9NEW");
    assert_eq!(result.data["name"], "secret-room");
    assert_eq!(result.data["is_private"], true);
    let captured = mock_state.last_form.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "conversations.create");
    let m: std::collections::HashMap<_, _> = captured.1.into_iter().collect();
    assert_eq!(m.get("name").map(String::as_str), Some("secret-room"));
    assert_eq!(m.get("is_private").map(String::as_str), Some("true"));
}

// ────────────────────────────────────────────────────────────────────────
// 4 — slack.channels.archive + slack.messages.delete + reactions.remove.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t04_archive_delete_and_reaction_remove_round_trip() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![
        Arc::new(ChannelsArchiveTool) as Arc<dyn Tool>,
        Arc::new(MessagesDeleteTool) as Arc<dyn Tool>,
        Arc::new(ReactionsRemoveTool) as Arc<dyn Tool>,
    ]);
    let archive = reg
        .invoke(
            "slack.channels.archive",
            json!({"channel": "C100"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!archive.is_error, "{:?}", archive.output);
    assert_eq!(archive.data["archived"], true);

    let del = reg
        .invoke(
            "slack.messages.delete",
            json!({"channel": "C100", "ts": "1700000000.000100"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!del.is_error, "{:?}", del.output);
    assert_eq!(del.data["deleted"], true);

    let unreact = reg
        .invoke(
            "slack.reactions.remove",
            json!({"channel": "C100", "ts": "1700000000.000100", "name": ":fire:"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!unreact.is_error, "{:?}", unreact.output);
    // Tool strips colons before sending to Slack.
    assert_eq!(unreact.data["name"], "fire");
    let captured = mock_state.last_form.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "reactions.remove");
    let m: std::collections::HashMap<_, _> = captured.1.into_iter().collect();
    assert_eq!(m.get("name").map(String::as_str), Some("fire"));
}

// ────────────────────────────────────────────────────────────────────────
// 5 — slack.messages.post posts text via form, blocks via JSON.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t05_messages_post_form_vs_json_paths() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(MessagesPostTool) as Arc<dyn Tool>]);

    // Plain text → form-encoded path.
    let plain = reg
        .invoke(
            "slack.messages.post",
            json!({"channel": "C100", "text": "hello world", "thread_ts": "1700000000.000099"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!plain.is_error, "{:?}", plain.output);
    assert_eq!(plain.data["ts"], "1700000000.000100");
    {
        let form_capture = mock_state.last_form.lock().unwrap().clone().unwrap();
        assert_eq!(form_capture.0, "chat.postMessage");
        let m: std::collections::HashMap<_, _> = form_capture.1.into_iter().collect();
        assert_eq!(m.get("channel").map(String::as_str), Some("C100"));
        assert_eq!(m.get("text").map(String::as_str), Some("hello world"));
        assert_eq!(
            m.get("thread_ts").map(String::as_str),
            Some("1700000000.000099")
        );
    }

    // Blocks → JSON path.
    let blocks = json!([
        { "type": "section", "text": { "type": "mrkdwn", "text": "*hi*" } }
    ]);
    let block = reg
        .invoke(
            "slack.messages.post",
            json!({"channel": "C100", "text": "hi", "blocks": blocks}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!block.is_error, "{:?}", block.output);
    let body_capture = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(body_capture.0, "chat.postMessage");
    assert_eq!(body_capture.1["channel"], "C100");
    assert!(body_capture.1["blocks"].is_array());
}

// ────────────────────────────────────────────────────────────────────────
// 6 — slack.messages.update requires text or blocks; happy path edits.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t06_messages_update_validates_payload_then_edits() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(MessagesUpdateTool) as Arc<dyn Tool>]);

    // No text and no blocks → clean tool error, no upstream hit.
    let bad = reg
        .invoke(
            "slack.messages.update",
            json!({"channel": "C100", "ts": "1700000000.000100"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(bad.is_error);
    assert!(bad.output.contains("at least one of"));

    // Happy path.
    let ok = reg
        .invoke(
            "slack.messages.update",
            json!({"channel": "C100", "ts": "1700000000.000100", "text": "edited"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!ok.is_error, "{:?}", ok.output);
    assert_eq!(ok.data["ts"], "1700000000.000100");
    let captured = mock_state.last_form.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "chat.update");
    let m: std::collections::HashMap<_, _> = captured.1.into_iter().collect();
    assert_eq!(m.get("text").map(String::as_str), Some("edited"));
}

// ────────────────────────────────────────────────────────────────────────
// 7 — slack.messages.history returns mapped messages newest-first.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t07_messages_history_returns_mapped_messages() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(MessagesHistoryTool) as Arc<dyn Tool>]);
    let hist = reg
        .invoke(
            "slack.messages.history",
            json!({"channel": "C100", "oldest": "1699000000.000000"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!hist.is_error, "{:?}", hist.output);
    let messages = hist.data["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["text"], "hello");
    assert_eq!(messages[0]["reactions"][0]["name"], "thumbsup");
    assert_eq!(messages[1]["thread_ts"], "1700000000.000100");
    let q = mock_state.last_query.lock().unwrap().clone().unwrap();
    let qmap: std::collections::HashMap<_, _> = q.1.into_iter().collect();
    assert_eq!(
        qmap.get("oldest").map(String::as_str),
        Some("1699000000.000000")
    );
}

// ────────────────────────────────────────────────────────────────────────
// 8 — slack.reactions.add strips colons + sends timestamp+channel+name.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t08_reactions_add_strips_colons() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(ReactionsAddTool) as Arc<dyn Tool>]);
    let result = reg
        .invoke(
            "slack.reactions.add",
            json!({"channel": "C100", "ts": "1700000000.000100", "name": ":thumbsup:"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["name"], "thumbsup");
    let captured = mock_state.last_form.lock().unwrap().clone().unwrap();
    let m: std::collections::HashMap<_, _> = captured.1.into_iter().collect();
    assert_eq!(
        m.get("timestamp").map(String::as_str),
        Some("1700000000.000100")
    );
    assert_eq!(m.get("name").map(String::as_str), Some("thumbsup"));
}

// ────────────────────────────────────────────────────────────────────────
// 9 — slack.users.list filters deleted by default; flag opts in.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t09_users_list_filters_deleted_by_default() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(UsersListTool) as Arc<dyn Tool>]);

    let default = reg
        .invoke(
            "slack.users.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!default.is_error, "{:?}", default.output);
    let users = default.data["users"].as_array().unwrap();
    // 3 mock members, one deleted — default keeps 2.
    assert_eq!(users.len(), 2);
    assert!(users.iter().all(|u| u["deleted"] != true));
    assert_eq!(users[0]["email"], "alice@example.com");

    let with_deleted = reg
        .invoke(
            "slack.users.list",
            json!({"include_deleted": true}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    let all = with_deleted.data["users"].as_array().unwrap();
    assert_eq!(all.len(), 3);
}

// ────────────────────────────────────────────────────────────────────────
// 10 — slack.users.info + lookup_by_email + clean error on miss.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t10_users_info_and_lookup_by_email_with_miss() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![
        Arc::new(UsersInfoTool) as Arc<dyn Tool>,
        Arc::new(UsersLookupByEmailTool) as Arc<dyn Tool>,
    ]);

    let info = reg
        .invoke(
            "slack.users.info",
            json!({"user": "U1"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!info.is_error, "{:?}", info.output);
    assert_eq!(info.data["id"], "U1");
    assert_eq!(info.data["email"], "alice@example.com");

    let hit = reg
        .invoke(
            "slack.users.lookup_by_email",
            json!({"email": "alice@example.com"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!hit.is_error, "{:?}", hit.output);
    assert_eq!(hit.data["id"], "U1");

    // Slack returns ok=false / users_not_found on a miss → tool surfaces
    // a clean slack_error with the upstream string.
    let miss = reg
        .invoke(
            "slack.users.lookup_by_email",
            json!({"email": "missing@example.com"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(miss.is_error);
    assert_eq!(miss.data["reason_code"], "slack_error");
    assert_eq!(miss.data["slack_error"], "users_not_found");
}

// ────────────────────────────────────────────────────────────────────────
// 11 — slack.search.messages happy path + paid_only error.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t11_search_messages_happy_and_paid_only() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let reg = registry_with(vec![Arc::new(SearchMessagesTool) as Arc<dyn Tool>]);
    let ok = reg
        .invoke(
            "slack.search.messages",
            json!({"query": "in:#general from:@alice", "max_results": 999}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(!ok.is_error, "{:?}", ok.output);
    assert_eq!(ok.data["matches"].as_array().unwrap().len(), 2);
    assert_eq!(ok.data["matches"][0]["channel"], "C100");
    assert_eq!(ok.data["matches"][0]["channel_name"], "general");
    assert_eq!(ok.data["total_count"], 2);
    // 999 should clamp to the hard cap of 100.
    let q = mock_state.last_query.lock().unwrap().clone().unwrap();
    let qmap: std::collections::HashMap<_, _> = q.1.into_iter().collect();
    assert_eq!(qmap.get("count").map(String::as_str), Some("100"));

    // paid_only error path → reason_code=slack_error and string preserved.
    let denied = reg
        .invoke(
            "slack.search.messages",
            json!({"query": "force_paid_only"}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(denied.is_error);
    assert_eq!(denied.data["reason_code"], "slack_error");
    assert_eq!(denied.data["slack_error"], "paid_only");
}

// ────────────────────────────────────────────────────────────────────────
// 12 — Refresh-on-401 retry succeeds (oauth2 lifecycle).
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t12_refresh_on_401_retries_and_succeeds() {
    let env = env();
    let state = MockState::default();
    let (base, _h) = spawn_mock(state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-stale", "xoxe-original").await;

    state.fail_with_401.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(ChannelsListTool)]);
    let result = reg
        .invoke(
            "slack.channels.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(
        !result.is_error,
        "expected success after retry, got output={:?} data={}",
        result.output, result.data
    );
    assert!(!result.data["channels"].as_array().unwrap().is_empty());
    // Two upstream attempts: 401 then retry.
    let history = state.history.lock().unwrap().clone();
    let list_hits = history
        .iter()
        .filter(|p| p.starts_with("GET /conversations.list"))
        .count();
    assert_eq!(list_hits, 2, "got {history:?}");
    let last_auth = state.last_auth.lock().unwrap().clone().unwrap();
    assert!(
        last_auth.contains("xoxb-fresh"),
        "retry should use refreshed token, got {last_auth}"
    );
}

// ────────────────────────────────────────────────────────────────────────
// 13 — Per-workspace isolation: two workspaces resolve to two rows
// and see distinct channel data per token.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t13_per_workspace_isolation_separate_credentials() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    let id_a = seed_workspace(&env, "T-WS-A", &base, "xoxb-A", "xoxe-A").await;
    let id_b = seed_workspace(&env, "T-WS-B", &base, "xoxb-B", "xoxe-B").await;
    assert_ne!(id_a, id_b);

    // Different channel data per workspace, keyed by the bearer token.
    {
        let mut map = mock_state.channels_by_auth.lock().unwrap();
        map.insert(
            "Bearer xoxb-A".to_string(),
            vec![json!({
                "id": "C-A1",
                "name": "team-a-only",
                "is_private": false,
                "is_archived": false,
                "is_member": true,
                "num_members": 1,
                "topic": { "value": "" },
                "purpose": { "value": "" }
            })],
        );
        map.insert(
            "Bearer xoxb-B".to_string(),
            vec![json!({
                "id": "C-B1",
                "name": "team-b-only",
                "is_private": false,
                "is_archived": false,
                "is_member": true,
                "num_members": 1,
                "topic": { "value": "" },
                "purpose": { "value": "" }
            })],
        );
    }

    let reg = registry_with(vec![Arc::new(ChannelsListTool)]);
    let res_a = reg
        .invoke(
            "slack.channels.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-A"),
        )
        .await
        .unwrap();
    assert!(!res_a.is_error, "{:?}", res_a.output);
    let chans_a = res_a.data["channels"].as_array().unwrap();
    assert_eq!(chans_a.len(), 1);
    assert_eq!(chans_a[0]["id"], "C-A1");
    let auth_after_a = mock_state.last_auth.lock().unwrap().clone().unwrap();
    assert!(auth_after_a.contains("xoxb-A"), "got {auth_after_a}");

    let res_b = reg
        .invoke(
            "slack.channels.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-B"),
        )
        .await
        .unwrap();
    assert!(!res_b.is_error, "{:?}", res_b.output);
    let chans_b = res_b.data["channels"].as_array().unwrap();
    assert_eq!(chans_b.len(), 1);
    assert_eq!(chans_b[0]["id"], "C-B1");
    let auth_after_b = mock_state.last_auth.lock().unwrap().clone().unwrap();
    assert!(auth_after_b.contains("xoxb-B"), "got {auth_after_b}");
    assert_ne!(auth_after_a, auth_after_b);

    // Resolving directly via the resolver returns the matching row id.
    let need = ChannelsListTool
        .required_credentials()
        .into_iter()
        .next()
        .unwrap();
    let cred_a: UsableCredential = env
        .resolver
        .resolve(
            &need,
            &ResolutionScope {
                user_id: Some("T-WS-A".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cred_a.id, id_a);
}

// ────────────────────────────────────────────────────────────────────────
// 14 — Missing credential surfaces missing_credential reason code.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t14_missing_credential_surfaces_reason_code() {
    let env = env();
    let reg = registry_with(vec![Arc::new(ChannelsListTool)]);
    let result = reg
        .invoke(
            "slack.channels.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-NEVER-SEEDED"),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert!(
        result.output.contains("missing_credential"),
        "got {}",
        result.output
    );
}

// ────────────────────────────────────────────────────────────────────────
// 15 — Rate-limit (HTTP 429 with Retry-After) surfaces rate_limited.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t15_rate_limit_surfaces_distinct_reason_code() {
    let env = env();
    let state = MockState::default();
    let (base, _h) = spawn_mock(state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    state.fail_with_429.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(ChannelsListTool)]);
    let result = reg
        .invoke(
            "slack.channels.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "T-WS-1"),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert_eq!(
        result.data["reason_code"], "rate_limited",
        "got data={}",
        result.data
    );
    assert_eq!(result.data["retry_after"], 30);
}

// ────────────────────────────────────────────────────────────────────────
// 16 — Pagination follows next_cursor and caps at 200.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t16_pagination_caps_at_200_and_marks_truncated() {
    use aeqi_pack_slack::api::SlackApiClient;

    let env = env();
    let state = MockState::default();
    let (base, _h) = spawn_mock(state.clone()).await;
    seed_workspace(&env, "T-WS-1", &base, "xoxb-1", "xoxe-1").await;
    let need = ChannelsListTool
        .required_credentials()
        .into_iter()
        .next()
        .unwrap();
    let cred = env
        .resolver
        .resolve(
            &need,
            &ResolutionScope {
                user_id: Some("T-WS-1".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    let client = SlackApiClient::new(&cred).with_base(base.clone());
    let (items, truncated) = client
        .paginate_get("users.list_paged", &[], "members")
        .await
        .unwrap();
    assert_eq!(items.len(), 200, "should hit cap exactly");
    assert!(truncated, "more pages remained — must be truncated");
    assert_eq!(items[0]["id"], "U1");
    assert_eq!(items[199]["id"], "U200");
    // Pages 1 and 2 walked; page 3 never fetched.
    let pages = state.page_counter.load(Ordering::SeqCst);
    assert_eq!(pages, 2, "should fetch exactly 2 pages, got {pages}");
}
