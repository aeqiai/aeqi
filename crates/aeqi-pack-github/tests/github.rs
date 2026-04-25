//! W2 — GitHub pack end-to-end tests.
//!
//! Sixteen-plus cases covering each tool's request shape, refresh-on-401
//! retry, per-installation isolation, scope/permission handling,
//! pagination via Link headers, and rate-limit handling. Mock GitHub
//! endpoints are hand-rolled with axum on an OS-assigned port — no
//! tests reach out to the real api.github.com.
//!
//! Most tests use the simpler `oauth2` lifecycle (matches W1's pattern
//! and keeps the test plumbing identical between packs); one test
//! exercises the `github_app` minting path end-to-end.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aeqi_core::credentials::lifecycles::{GithubAppLifecycle, OAuth2Lifecycle, OAuth2Tokens};
use aeqi_core::credentials::{
    CredentialCipher, CredentialInsert, CredentialLifecycle, CredentialResolver, CredentialStore,
    ResolutionScope, ScopeKind, UsableCredential,
};
use aeqi_core::traits::Tool;
use aeqi_core::{CallerKind, ExecutionContext, ToolRegistry};
use aeqi_pack_github::{
    files::{FilesListTool, FilesReadTool},
    issues::{IssuesCloseTool, IssuesCommentTool, IssuesCreateTool, IssuesGetTool, IssuesListTool},
    prs::{PrsCommentTool, PrsCreateTool, PrsGetTool, PrsListTool, PrsReviewTool},
    releases::{ReleasesCreateTool, ReleasesListTool},
    search::{SearchIssuesTool, SearchReposTool},
};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use rusqlite::Connection;
use serde_json::{Value, json};
use tempfile::TempDir;

// ────────────────────────────────────────────────────────────────────────
// Test scaffolding.
// ────────────────────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct MockState {
    last_body: Arc<Mutex<Option<(String, Value)>>>,
    /// 401 budget — when >0, the next request returns 401 and decrements.
    fail_with_401: Arc<AtomicUsize>,
    /// rate-limited budget — when >0, the next request returns 403 with
    /// `X-RateLimit-Remaining: 0` and decrements.
    fail_with_rate_limit: Arc<AtomicUsize>,
    history: Arc<Mutex<Vec<String>>>,
    last_query: Arc<Mutex<Option<String>>>,
    /// Tag used by token-isolation tests so we can assert which token
    /// hit the upstream.
    last_auth: Arc<Mutex<Option<String>>>,
    /// Page counter used by the pagination test to drive Link headers.
    page_counter: Arc<AtomicUsize>,
    /// Captured `?per_page=` query for assertion.
    last_per_page: Arc<Mutex<Option<String>>>,
    /// Base URL the mock is bound to — used by the pagination handler to
    /// build self-referential `Link: rel="next"` URLs that resolve.
    self_base: Arc<Mutex<Option<String>>>,
}

async fn spawn_mock(state: MockState) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{addr}");
    *state.self_base.lock().unwrap() = Some(base.clone());
    let app = github_router().with_state(state);
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    (base, handle)
}

fn github_router() -> Router<MockState> {
    Router::new()
        // Issues
        .route(
            "/repos/{owner}/{repo}/issues",
            get(issues_list).post(issues_create),
        )
        .route(
            "/repos/{owner}/{repo}/issues/{number}",
            get(issues_get).patch(issues_patch),
        )
        .route(
            "/repos/{owner}/{repo}/issues/{number}/comments",
            post(issues_comment),
        )
        // PRs
        .route(
            "/repos/{owner}/{repo}/pulls",
            get(prs_list).post(prs_create),
        )
        .route("/repos/{owner}/{repo}/pulls/{number}", get(prs_get))
        .route(
            "/repos/{owner}/{repo}/pulls/{number}/reviews",
            post(prs_review),
        )
        // Files
        .route("/repos/{owner}/{repo}/contents/{*path}", get(contents))
        // Releases
        .route(
            "/repos/{owner}/{repo}/releases",
            get(releases_list).post(releases_create),
        )
        // Search
        .route("/search/repositories", get(search_repos))
        .route("/search/issues", get(search_issues))
        // Pagination probe — distinct from issues_list so tests can mount a
        // dedicated handler that returns a Link header.
        .route("/repos/{owner}/{repo}/issues_paged", get(issues_list_paged))
}

fn record(s: &MockState, headers: &HeaderMap, path: impl Into<String>) {
    s.history.lock().unwrap().push(path.into());
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

fn try_consume_rate_limit(s: &MockState) -> bool {
    let prev = s.fail_with_rate_limit.load(Ordering::SeqCst);
    if prev > 0 {
        s.fail_with_rate_limit.fetch_sub(1, Ordering::SeqCst);
        return true;
    }
    false
}

fn rate_limit_response() -> impl IntoResponse {
    let mut hm = HeaderMap::new();
    hm.insert("X-RateLimit-Remaining", "0".parse().unwrap());
    hm.insert("X-RateLimit-Reset", "1700001234".parse().unwrap());
    (
        axum::http::StatusCode::FORBIDDEN,
        hm,
        Json(json!({ "message": "API rate limit exceeded" })),
    )
}

async fn issues_list(
    State(s): State<MockState>,
    Path((owner, repo)): Path<(String, String)>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("GET /repos/{owner}/{repo}/issues"));
    *s.last_query.lock().unwrap() = Some(format!(
        "state={} labels={} since={}",
        q.get("state").cloned().unwrap_or_default(),
        q.get("labels").cloned().unwrap_or_default(),
        q.get("since").cloned().unwrap_or_default(),
    ));
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    }
    if try_consume_rate_limit(&s) {
        return rate_limit_response().into_response();
    }
    Json(json!([
        {
            "number": 1,
            "title": "first",
            "state": "open",
            "user": { "login": "alice" },
            "labels": [{ "name": "bug" }],
            "html_url": "https://github.com/x/y/issues/1",
            "comments": 2,
            "updated_at": "2026-04-25T00:00:00Z"
        },
        {
            "number": 2,
            "title": "from PR endpoint",
            "state": "open",
            "user": { "login": "bob" },
            "labels": [],
            "html_url": "https://github.com/x/y/pull/2",
            "comments": 0,
            "updated_at": "2026-04-25T00:00:00Z",
            "pull_request": { "url": "..." }
        }
    ]))
    .into_response()
}

async fn issues_get(
    State(s): State<MockState>,
    Path((owner, repo, number)): Path<(String, String, i64)>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(
        &s,
        &headers,
        format!("GET /repos/{owner}/{repo}/issues/{number}"),
    );
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    }
    Json(json!({
        "number": number,
        "title": "details",
        "body": "body text",
        "state": "open",
        "labels": [{ "name": "bug" }],
        "assignees": [{ "login": "alice" }],
        "comments": 3,
        "html_url": format!("https://github.com/{owner}/{repo}/issues/{number}"),
        "updated_at": "2026-04-25T00:00:00Z"
    }))
    .into_response()
}

async fn issues_create(
    State(s): State<MockState>,
    Path((owner, repo)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, format!("POST /repos/{owner}/{repo}/issues"));
    *s.last_body.lock().unwrap() = Some(("issues_create".into(), body.clone()));
    Json(json!({
        "number": 42,
        "html_url": format!("https://github.com/{owner}/{repo}/issues/42"),
        "title": body.get("title").cloned().unwrap_or(Value::Null)
    }))
    .into_response()
}

async fn issues_comment(
    State(s): State<MockState>,
    Path((owner, repo, number)): Path<(String, String, i64)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(
        &s,
        &headers,
        format!("POST /repos/{owner}/{repo}/issues/{number}/comments"),
    );
    *s.last_body.lock().unwrap() = Some(("issues_comment".into(), body.clone()));
    Json(json!({ "id": 1001, "body": body.get("body") })).into_response()
}

async fn issues_patch(
    State(s): State<MockState>,
    Path((owner, repo, number)): Path<(String, String, i64)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(
        &s,
        &headers,
        format!("PATCH /repos/{owner}/{repo}/issues/{number}"),
    );
    *s.last_body.lock().unwrap() = Some(("issues_patch".into(), body.clone()));
    Json(json!({
        "number": number,
        "state": body.get("state").cloned().unwrap_or(Value::Null),
        "state_reason": body.get("state_reason").cloned().unwrap_or(Value::Null)
    }))
    .into_response()
}

async fn prs_list(
    State(s): State<MockState>,
    Path((owner, repo)): Path<(String, String)>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("GET /repos/{owner}/{repo}/pulls"));
    *s.last_query.lock().unwrap() = Some(format!(
        "state={} base={} head={}",
        q.get("state").cloned().unwrap_or_default(),
        q.get("base").cloned().unwrap_or_default(),
        q.get("head").cloned().unwrap_or_default(),
    ));
    Json(json!([
        {
            "number": 9,
            "title": "feat: x",
            "state": "open",
            "draft": false,
            "user": { "login": "alice" },
            "head": { "ref": "feat/x" },
            "base": { "ref": "main" },
            "html_url": format!("https://github.com/{owner}/{repo}/pull/9"),
            "updated_at": "2026-04-25T00:00:00Z"
        }
    ]))
    .into_response()
}

async fn prs_get(
    State(s): State<MockState>,
    Path((owner, repo, number)): Path<(String, String, i64)>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(
        &s,
        &headers,
        format!("GET /repos/{owner}/{repo}/pulls/{number}"),
    );
    Json(json!({
        "number": number,
        "title": "feat: x",
        "body": "details",
        "state": "open",
        "draft": false,
        "merged": false,
        "mergeable": true,
        "mergeable_state": "clean",
        "head": { "ref": "feat/x" },
        "base": { "ref": "main" },
        "additions": 100,
        "deletions": 5,
        "changed_files": 7,
        "html_url": format!("https://github.com/{owner}/{repo}/pull/{number}")
    }))
    .into_response()
}

async fn prs_create(
    State(s): State<MockState>,
    Path((owner, repo)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, format!("POST /repos/{owner}/{repo}/pulls"));
    *s.last_body.lock().unwrap() = Some(("prs_create".into(), body.clone()));
    Json(json!({
        "number": 11,
        "html_url": format!("https://github.com/{owner}/{repo}/pull/11"),
    }))
    .into_response()
}

async fn prs_review(
    State(s): State<MockState>,
    Path((owner, repo, number)): Path<(String, String, i64)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(
        &s,
        &headers,
        format!("POST /repos/{owner}/{repo}/pulls/{number}/reviews"),
    );
    *s.last_body.lock().unwrap() = Some(("prs_review".into(), body.clone()));
    let event = body
        .get("event")
        .and_then(|v| v.as_str())
        .unwrap_or("COMMENT")
        .to_string();
    let state = match event.as_str() {
        "APPROVE" => "APPROVED",
        "REQUEST_CHANGES" => "CHANGES_REQUESTED",
        _ => "COMMENTED",
    };
    Json(json!({ "id": 7777, "state": state })).into_response()
}

async fn contents(
    State(s): State<MockState>,
    Path((owner, repo, path)): Path<(String, String, String)>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(
        &s,
        &headers,
        format!("GET /repos/{owner}/{repo}/contents/{path}"),
    );
    *s.last_query.lock().unwrap() =
        Some(format!("ref={}", q.get("ref").cloned().unwrap_or_default()));
    if path == "src" {
        // Directory listing.
        return Json(json!([
            { "name": "main.rs", "type": "file", "size": 100, "sha": "aaa", "path": "src/main.rs" },
            { "name": "lib", "type": "dir", "size": 0, "sha": "bbb", "path": "src/lib" }
        ]))
        .into_response();
    }
    // File response.
    let body = base64::engine::general_purpose::STANDARD.encode("hello github");
    Json(json!({
        "name": "README.md",
        "path": path,
        "content": body,
        "sha": "deadbeef",
        "size": 12
    }))
    .into_response()
}

async fn releases_list(
    State(s): State<MockState>,
    Path((owner, repo)): Path<(String, String)>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("GET /repos/{owner}/{repo}/releases"));
    Json(json!([
        {
            "id": 1,
            "tag_name": "v1.0.0",
            "name": "v1",
            "draft": false,
            "prerelease": false,
            "html_url": format!("https://github.com/{owner}/{repo}/releases/tag/v1.0.0"),
            "published_at": "2026-04-25T00:00:00Z"
        }
    ]))
    .into_response()
}

async fn releases_create(
    State(s): State<MockState>,
    Path((owner, repo)): Path<(String, String)>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, format!("POST /repos/{owner}/{repo}/releases"));
    *s.last_body.lock().unwrap() = Some(("releases_create".into(), body.clone()));
    Json(json!({
        "id": 999,
        "html_url": format!("https://github.com/{owner}/{repo}/releases/tag/{}", body.get("tag_name").and_then(|v| v.as_str()).unwrap_or("")),
        "draft": body.get("draft").cloned().unwrap_or(Value::Bool(false)),
        "prerelease": body.get("prerelease").cloned().unwrap_or(Value::Bool(false))
    }))
    .into_response()
}

async fn search_repos(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /search/repositories".to_string());
    *s.last_query.lock().unwrap() = q.get("q").cloned();
    *s.last_per_page.lock().unwrap() = q.get("per_page").cloned();
    Json(json!({
        "total_count": 2,
        "items": [
            {
                "full_name": "rust-lang/rust",
                "description": "the rust compiler",
                "stargazers_count": 100000,
                "language": "Rust",
                "html_url": "https://github.com/rust-lang/rust",
                "private": false
            },
            {
                "full_name": "tokio-rs/tokio",
                "description": "async runtime",
                "stargazers_count": 30000,
                "language": "Rust",
                "html_url": "https://github.com/tokio-rs/tokio",
                "private": false
            }
        ]
    }))
    .into_response()
}

async fn search_issues(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /search/issues".to_string());
    *s.last_query.lock().unwrap() = q.get("q").cloned();
    Json(json!({
        "total_count": 2,
        "items": [
            {
                "number": 1,
                "title": "issue 1",
                "state": "open",
                "html_url": "https://github.com/x/y/issues/1",
                "repository_url": "https://api.github.com/repos/x/y"
            },
            {
                "number": 2,
                "title": "pr 2",
                "state": "open",
                "html_url": "https://github.com/x/y/pull/2",
                "repository_url": "https://api.github.com/repos/x/y",
                "pull_request": { "url": "..." }
            }
        ]
    }))
    .into_response()
}

async fn issues_list_paged(
    State(s): State<MockState>,
    Path((owner, repo)): Path<(String, String)>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(
        &s,
        &headers,
        format!("GET /repos/{owner}/{repo}/issues_paged"),
    );
    let page = q
        .get("page")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1);
    s.page_counter.fetch_add(1, Ordering::SeqCst);
    // Each page returns 100 items so two pages == cap. Page 3 has 50.
    let count = if page == 3 { 50 } else { 100 };
    let mut items = Vec::with_capacity(count);
    for i in 0..count {
        let n = (page - 1) * 100 + i + 1;
        items.push(json!({
            "number": n,
            "title": format!("issue-{n}"),
            "state": "open",
            "user": { "login": "alice" },
            "labels": [],
            "html_url": format!("https://github.com/{owner}/{repo}/issues/{n}"),
            "comments": 0,
            "updated_at": "2026-04-25T00:00:00Z"
        }));
    }
    let mut hm = HeaderMap::new();
    if page < 3 {
        let self_base = s
            .self_base
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| "http://127.0.0.1".to_string());
        hm.insert(
            "Link",
            format!(
                "<{}/repos/{}/{}/issues_paged?page={}>; rel=\"next\"",
                self_base.trim_end_matches('/'),
                owner,
                repo,
                page + 1
            )
            .parse()
            .unwrap(),
        );
    }
    (axum::http::StatusCode::OK, hm, Json(Value::Array(items))).into_response()
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
    let lifecycles: Vec<Arc<dyn CredentialLifecycle>> =
        vec![Arc::new(OAuth2Lifecycle), Arc::new(GithubAppLifecycle)];
    let resolver = CredentialResolver::new(store.clone(), lifecycles);
    Env {
        _tempdir: tempdir,
        store,
        resolver,
    }
}

/// Insert an OAuth2-shaped row covering an installation.
async fn seed_oauth_installation(
    env: &Env,
    installation_id: &str,
    base_url: &str,
    access_token: &str,
    refresh_token: &str,
) -> String {
    let tokens = OAuth2Tokens {
        access_token: access_token.into(),
        refresh_token: Some(refresh_token.into()),
        token_type: "Bearer".into(),
        scope: "repo".into(),
    };
    let plaintext = serde_json::to_vec(&tokens).unwrap();
    let metadata = json!({
        "provider_kind": "github",
        "auth_url":   "https://github.com/login/oauth/authorize",
        "token_url":  format!("{base_url}/oauth2/token"),
        "revoke_url": format!("{base_url}/oauth2/revoke"),
        "client_id":  "test-client-id",
        "scopes":     ["repo"],
        "redirect_uri": "http://localhost:0/callback",
        "aeqi_test_base": base_url,
    });
    env.store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Installation,
            scope_id: installation_id.into(),
            provider: "github".into(),
            name: "installation_token".into(),
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

fn ctx(env: &Env, installation_id: &str) -> ExecutionContext {
    ExecutionContext {
        session_id: "s1".into(),
        agent_id: "agentA".into(),
        credential_resolver: Some(env.resolver.clone()),
        credential_scope: ResolutionScope {
            installation_id: Some(installation_id.into()),
            ..Default::default()
        },
        ..Default::default()
    }
}

// ────────────────────────────────────────────────────────────────────────
// 1 — github.issues.list filters PRs out of the issues endpoint.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t01_issues_list_filters_pull_requests() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;

    let reg = registry_with(vec![Arc::new(IssuesListTool)]);
    let result = reg
        .invoke(
            "github.issues.list",
            json!({"owner": "x", "repo": "y", "state": "open", "labels": "bug", "since": "2026-01-01"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let issues = result.data["issues"].as_array().unwrap();
    assert_eq!(issues.len(), 1, "PR should be stripped");
    assert_eq!(issues[0]["number"], 1);
    let q = mock_state.last_query.lock().unwrap().clone().unwrap();
    assert!(q.contains("state=open"));
    assert!(q.contains("labels=bug"));
    assert!(q.contains("since=2026-01-01"));
}

// ────────────────────────────────────────────────────────────────────────
// 2 — github.issues.get returns full body + assignees.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t02_issues_get_returns_full_body_and_assignees() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(IssuesGetTool)]);
    let result = reg
        .invoke(
            "github.issues.get",
            json!({"owner": "x", "repo": "y", "number": 7}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["number"], 7);
    assert_eq!(result.data["body"], "body text");
    assert_eq!(result.data["comments_count"], 3);
    assert_eq!(result.data["assignees"][0]["login"], "alice");
}

// ────────────────────────────────────────────────────────────────────────
// 3 — github.issues.create with labels + assignees.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t03_issues_create_round_trips_labels_and_assignees() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(IssuesCreateTool)]);
    let result = reg
        .invoke(
            "github.issues.create",
            json!({
                "owner": "x",
                "repo": "y",
                "title": "Hello",
                "body": "world",
                "labels": ["bug", "p1"],
                "assignees": ["alice"]
            }),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error);
    assert_eq!(result.data["number"], 42);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "issues_create");
    assert_eq!(captured.1["title"], "Hello");
    assert_eq!(captured.1["labels"][0], "bug");
    assert_eq!(captured.1["assignees"][0], "alice");
}

// ────────────────────────────────────────────────────────────────────────
// 4 — github.issues.comment posts on the issues endpoint.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t04_issues_comment_returns_comment_id() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(IssuesCommentTool)]);
    let result = reg
        .invoke(
            "github.issues.comment",
            json!({"owner": "x", "repo": "y", "number": 7, "body": "+1"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error);
    assert_eq!(result.data["comment_id"], 1001);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.1["body"], "+1");
}

// ────────────────────────────────────────────────────────────────────────
// 5 — github.issues.close PATCHes state + state_reason.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t05_issues_close_patches_state_with_reason() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(IssuesCloseTool)]);
    let result = reg
        .invoke(
            "github.issues.close",
            json!({"owner": "x", "repo": "y", "number": 7, "state_reason": "not_planned"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["state"], "closed");
    assert_eq!(result.data["state_reason"], "not_planned");
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "issues_patch");
    assert_eq!(captured.1["state"], "closed");
    assert_eq!(captured.1["state_reason"], "not_planned");
}

// ────────────────────────────────────────────────────────────────────────
// 6 — github.prs.list returns mapped fields.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t06_prs_list_passes_filters_and_returns_shape() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PrsListTool)]);
    let result = reg
        .invoke(
            "github.prs.list",
            json!({"owner": "x", "repo": "y", "state": "open", "base": "main", "head": "fork:feat/x"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error);
    let prs = result.data["prs"].as_array().unwrap();
    assert_eq!(prs.len(), 1);
    assert_eq!(prs[0]["base"], "main");
    let q = mock_state.last_query.lock().unwrap().clone().unwrap();
    assert!(q.contains("base=main"));
    assert!(q.contains("head=fork:feat/x"));
}

// ────────────────────────────────────────────────────────────────────────
// 7 — github.prs.get returns mergeable + diff stats.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t07_prs_get_returns_mergeable_and_stats() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PrsGetTool)]);
    let result = reg
        .invoke(
            "github.prs.get",
            json!({"owner": "x", "repo": "y", "number": 9}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["mergeable"], true);
    assert_eq!(result.data["additions"], 100);
    assert_eq!(result.data["changed_files"], 7);
}

// ────────────────────────────────────────────────────────────────────────
// 8 — github.prs.create posts head/base/title.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t08_prs_create_posts_required_fields() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PrsCreateTool)]);
    let result = reg
        .invoke(
            "github.prs.create",
            json!({
                "owner": "x", "repo": "y",
                "title": "feat: x", "head": "feat/x", "base": "main",
                "body": "details"
            }),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error);
    assert_eq!(result.data["number"], 11);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.1["title"], "feat: x");
    assert_eq!(captured.1["head"], "feat/x");
    assert_eq!(captured.1["base"], "main");
    assert_eq!(captured.1["body"], "details");
}

// ────────────────────────────────────────────────────────────────────────
// 9 — github.prs.comment uses the issues-comments endpoint.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t09_prs_comment_routes_through_issues_endpoint() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PrsCommentTool)]);
    let result = reg
        .invoke(
            "github.prs.comment",
            json!({"owner": "x", "repo": "y", "number": 9, "body": "review pls"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error);
    assert_eq!(result.data["comment_id"], 1001);
    let history = mock_state.history.lock().unwrap().clone();
    assert!(
        history
            .iter()
            .any(|p| p == "POST /repos/x/y/issues/9/comments"),
        "got {history:?}"
    );
}

// ────────────────────────────────────────────────────────────────────────
// 10 — github.prs.review covers all three event types.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t10_prs_review_supports_all_three_events() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PrsReviewTool)]);
    for (event, expected_state) in &[
        ("APPROVE", "APPROVED"),
        ("REQUEST_CHANGES", "CHANGES_REQUESTED"),
        ("COMMENT", "COMMENTED"),
    ] {
        let result = reg
            .invoke(
                "github.prs.review",
                json!({
                    "owner": "x", "repo": "y", "number": 9,
                    "event": event, "body": "lgtm"
                }),
                CallerKind::Llm,
                &ctx(&env, "inst-1"),
            )
            .await
            .unwrap();
        assert!(!result.is_error, "{event}: {:?}", result.output);
        assert_eq!(result.data["state"], *expected_state);
        assert_eq!(result.data["event"], *event);
    }
    // And invalid event surfaces a clean error without hitting the upstream.
    let result = reg
        .invoke(
            "github.prs.review",
            json!({"owner": "x", "repo": "y", "number": 9, "event": "BOGUS"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert!(result.output.contains("invalid 'event'"));
}

// ────────────────────────────────────────────────────────────────────────
// 11 — github.files.read decodes base64 + accepts a ref override.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t11_files_read_decodes_base64_and_passes_ref() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(FilesReadTool)]);
    let result = reg
        .invoke(
            "github.files.read",
            json!({"owner": "x", "repo": "y", "path": "README.md", "ref": "feat/x"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["content"], "hello github");
    assert_eq!(result.data["sha"], "deadbeef");
    let q = mock_state.last_query.lock().unwrap().clone().unwrap();
    assert!(q.contains("ref=feat/x"));
}

// ────────────────────────────────────────────────────────────────────────
// 12 — github.files.list returns directory entries; read on a dir errors.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t12_files_list_returns_entries_and_read_on_dir_errors() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![
        Arc::new(FilesListTool) as Arc<dyn Tool>,
        Arc::new(FilesReadTool) as Arc<dyn Tool>,
    ]);
    let listing = reg
        .invoke(
            "github.files.list",
            json!({"owner": "x", "repo": "y", "path": "src"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!listing.is_error, "{:?}", listing.output);
    let entries = listing.data["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["name"], "main.rs");
    assert_eq!(entries[1]["type"], "dir");

    // Reading a directory must surface a clean error.
    let bad = reg
        .invoke(
            "github.files.read",
            json!({"owner": "x", "repo": "y", "path": "src"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(bad.is_error);
    assert!(bad.output.contains("github.files.list"));
}

// ────────────────────────────────────────────────────────────────────────
// 13 — github.releases.list + create with draft + prerelease.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t13_releases_list_and_create_round_trip_flags() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![
        Arc::new(ReleasesListTool) as Arc<dyn Tool>,
        Arc::new(ReleasesCreateTool) as Arc<dyn Tool>,
    ]);
    let listing = reg
        .invoke(
            "github.releases.list",
            json!({"owner": "x", "repo": "y"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!listing.is_error);
    assert_eq!(listing.data["count"], 1);

    let created = reg
        .invoke(
            "github.releases.create",
            json!({
                "owner": "x", "repo": "y",
                "tag_name": "v2.0.0",
                "name": "v2",
                "body": "notes",
                "draft": true,
                "prerelease": true
            }),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!created.is_error, "{:?}", created.output);
    assert_eq!(created.data["release_id"], 999);
    assert_eq!(created.data["draft"], true);
    assert_eq!(created.data["prerelease"], true);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.1["tag_name"], "v2.0.0");
    assert_eq!(captured.1["draft"], true);
    assert_eq!(captured.1["prerelease"], true);
}

// ────────────────────────────────────────────────────────────────────────
// 14 — github.search.repos + search.issues with max_results clamping.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t14_search_repos_and_issues_round_trip() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![
        Arc::new(SearchReposTool) as Arc<dyn Tool>,
        Arc::new(SearchIssuesTool) as Arc<dyn Tool>,
    ]);
    let repos = reg
        .invoke(
            "github.search.repos",
            json!({"query": "language:rust stars:>1000", "max_results": 999}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!repos.is_error, "{:?}", repos.output);
    assert_eq!(repos.data["repos"].as_array().unwrap().len(), 2);
    assert_eq!(repos.data["total_count"], 2);
    // 999 should clamp to the hard cap of 100.
    let pp = mock_state.last_per_page.lock().unwrap().clone();
    assert_eq!(pp.as_deref(), Some("100"));

    let issues = reg
        .invoke(
            "github.search.issues",
            json!({"query": "is:open is:pr"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(!issues.is_error);
    let items = issues.data["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    // The second item is a PR (carries `pull_request`); the first is not.
    assert_eq!(items[0]["is_pr"], false);
    assert_eq!(items[1]["is_pr"], true);
}

// ────────────────────────────────────────────────────────────────────────
// 15 — Refresh-on-401 retry succeeds (oauth2 lifecycle).
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t15_refresh_on_401_retries_and_succeeds() {
    let env = env();
    let state = MockState::default();
    let token_calls = Arc::new(AtomicUsize::new(0));
    let token_calls_route = token_calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = github_router()
        .route(
            "/oauth2/token",
            post(move || {
                let counter = token_calls_route.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    (
                        axum::http::StatusCode::OK,
                        Json(json!({
                            "access_token":  "fresh-tok",
                            "refresh_token": "rt-rotated",
                            "token_type":    "Bearer",
                            "expires_in":    3600,
                            "scope":         "repo"
                        })),
                    )
                }
            }),
        )
        .with_state(state.clone());
    let _h = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    let base = format!("http://{addr}");
    seed_oauth_installation(&env, "inst-1", &base, "stale-tok", "rt-original").await;

    state.fail_with_401.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(IssuesGetTool)]);
    let result = reg
        .invoke(
            "github.issues.get",
            json!({"owner": "x", "repo": "y", "number": 7}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(
        !result.is_error,
        "expected success after retry, got {:?} data={}",
        result.output, result.data
    );
    assert_eq!(token_calls.load(Ordering::SeqCst), 1);
    // Two upstream attempts: the 401 + the retry.
    assert_eq!(state.history.lock().unwrap().len(), 2);
    let last_auth = state.last_auth.lock().unwrap().clone().unwrap();
    assert!(
        last_auth.contains("fresh-tok"),
        "retry should use refreshed token, got {last_auth}"
    );
}

// ────────────────────────────────────────────────────────────────────────
// 16 — Per-installation isolation: two installations resolve to two rows.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t16_per_installation_isolation_separate_credentials() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    let id_a = seed_oauth_installation(&env, "inst-A", &base, "tok-A", "rt-A").await;
    let id_b = seed_oauth_installation(&env, "inst-B", &base, "tok-B", "rt-B").await;
    assert_ne!(id_a, id_b);

    let reg = registry_with(vec![Arc::new(IssuesListTool)]);
    let _ = reg
        .invoke(
            "github.issues.list",
            json!({"owner": "x", "repo": "y"}),
            CallerKind::Llm,
            &ctx(&env, "inst-A"),
        )
        .await
        .unwrap();
    let auth_after_a = mock_state.last_auth.lock().unwrap().clone().unwrap();
    assert!(auth_after_a.contains("tok-A"), "got {auth_after_a}");

    let _ = reg
        .invoke(
            "github.issues.list",
            json!({"owner": "x", "repo": "y"}),
            CallerKind::Llm,
            &ctx(&env, "inst-B"),
        )
        .await
        .unwrap();
    let auth_after_b = mock_state.last_auth.lock().unwrap().clone().unwrap();
    assert!(auth_after_b.contains("tok-B"), "got {auth_after_b}");
    assert_ne!(auth_after_a, auth_after_b);

    // And resolving directly via the resolver returns the matching row id.
    let need = IssuesListTool
        .required_credentials()
        .into_iter()
        .next()
        .unwrap();
    let cred_a: UsableCredential = env
        .resolver
        .resolve(
            &need,
            &ResolutionScope {
                installation_id: Some("inst-A".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cred_a.id, id_a);
}

// ────────────────────────────────────────────────────────────────────────
// 17 — Missing credential surfaces missing_credential.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t17_missing_credential_surfaces_reason_code() {
    let env = env();
    let reg = registry_with(vec![Arc::new(IssuesListTool)]);
    // No row seeded — substrate has nothing to resolve.
    let result = reg
        .invoke(
            "github.issues.list",
            json!({"owner": "x", "repo": "y"}),
            CallerKind::Llm,
            &ctx(&env, "no-such-installation"),
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
// 18 — Pagination follows the Link rel="next" chain and caps at 200.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t18_pagination_caps_at_200_and_marks_truncated() {
    use aeqi_pack_github::api::GithubApiClient;

    let env = env();
    let state = MockState::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{addr}");
    *state.self_base.lock().unwrap() = Some(base.clone());
    let app = github_router().with_state(state.clone());
    let _h = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok", "rt").await;

    // Resolve directly so we can drive `paginate_get` without going via a
    // tool — the test focuses on Link-header walking, not on tool wiring.
    let need = IssuesListTool
        .required_credentials()
        .into_iter()
        .next()
        .unwrap();
    let cred = env
        .resolver
        .resolve(
            &need,
            &ResolutionScope {
                installation_id: Some("inst-1".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    let client = GithubApiClient::new(&cred).with_base(base.clone());
    // Our paged handler returns 100, 100, 50 across pages 1/2/3 with
    // `rel="next"` Link headers between them. The walk should stop after
    // reaching the 200 cap and mark `truncated=true`.
    let url = format!("{base}/repos/x/y/issues_paged?page=1");
    let (items, truncated) = client.paginate_get(url).await.unwrap();
    assert_eq!(items.len(), 200, "should hit cap exactly");
    assert!(truncated, "more pages remained — must be truncated");
    // First item is page-1 entry 1; last is page-2 entry 100.
    assert_eq!(items[0]["number"], 1);
    assert_eq!(items[199]["number"], 200);
    // Pages 1 and 2 walked; page 3 never fetched.
    assert!(state.page_counter.load(Ordering::SeqCst) >= 2);
    assert!(state.page_counter.load(Ordering::SeqCst) <= 2);
}

// ────────────────────────────────────────────────────────────────────────
// 19 — Rate limit (403 + X-RateLimit-Remaining: 0) surfaces rate_limited.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t19_rate_limit_surfaces_distinct_reason_code() {
    let env = env();
    let state = MockState::default();
    let (base, _h) = spawn_mock(state.clone()).await;
    seed_oauth_installation(&env, "inst-1", &base, "tok", "rt").await;
    state.fail_with_rate_limit.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(IssuesListTool)]);
    let result = reg
        .invoke(
            "github.issues.list",
            json!({"owner": "x", "repo": "y"}),
            CallerKind::Llm,
            &ctx(&env, "inst-1"),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert_eq!(
        result.data["reason_code"], "rate_limited",
        "got data={}",
        result.data
    );
    assert_eq!(result.data["reset_at"], "1700001234");
}

// ────────────────────────────────────────────────────────────────────────
// 20 — github_app lifecycle mints an installation token and sends it.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t20_github_app_lifecycle_mints_installation_token() {
    let env = env();
    let state = MockState::default();
    let mint_calls = Arc::new(AtomicUsize::new(0));
    let mint_calls_route = mint_calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = github_router()
        .route(
            "/app/installations/{id}/access_tokens",
            post(move |Path(id): Path<String>| {
                let counter = mint_calls_route.clone();
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    let _ = id;
                    (
                        axum::http::StatusCode::OK,
                        Json(json!({
                            "token": "ghs_minted_token",
                            "expires_at": (chrono::Utc::now() + chrono::Duration::minutes(50)).to_rfc3339()
                        })),
                    )
                }
            }),
        )
        .with_state(state.clone());
    let _h = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    let base = format!("http://{addr}");

    // A fresh PEM private key. Generated once for tests via
    // `openssl genrsa 2048` — no real-world signing power.
    let pem = TEST_RSA_PRIVATE_KEY_PEM;
    let stored = json!({
        "app_id": "12345",
        "private_key_pem": pem,
        "installation_id": "67890"
    });
    let plaintext = serde_json::to_vec(&stored).unwrap();
    let metadata = json!({
        "api_base": base,
        "aeqi_test_base": base,
    });
    env.store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Installation,
            scope_id: "inst-app".into(),
            provider: "github".into(),
            name: "installation_token".into(),
            lifecycle_kind: "github_app".into(),
            plaintext_blob: plaintext,
            metadata,
            expires_at: None,
        })
        .await
        .unwrap();

    let reg = registry_with(vec![Arc::new(IssuesGetTool)]);
    let result = reg
        .invoke(
            "github.issues.get",
            json!({"owner": "x", "repo": "y", "number": 7}),
            CallerKind::Llm,
            &ctx(&env, "inst-app"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?} data={}", result.output, result.data);
    assert!(mint_calls.load(Ordering::SeqCst) >= 1);
    let last_auth = state.last_auth.lock().unwrap().clone().unwrap();
    assert!(
        last_auth.contains("ghs_minted_token"),
        "expected installation token in Authorization, got {last_auth}"
    );
}

// 2048-bit RSA private key generated specifically for this test suite
// (PKCS#1 — `BEGIN RSA PRIVATE KEY` — to match `jsonwebtoken`'s
// `EncodingKey::from_rsa_pem`). Has no value beyond signing JWTs that
// our local mock server accepts.
const TEST_RSA_PRIVATE_KEY_PEM: &str = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEAxiqJhooIEqhPq508yKZtNh0iJSiQyWeD4mwffOLEP4zuhOJ6\nWt2SUi9WA4KFLq5v46WJorUBbWBndnjxCv39ONi5f2KMFZzPiQr6sxKfqWBqXl8B\nEEv9V2T/NdbyKHGevJUztrKAFw376ievf/xFKya6HpSFwfXOrJf6FEwT2pTfkiuz\nTfFFOcPP3kETNXNl0w323s6avHqcV2s0MK+YvA3SDXkCSqabRqHxTP525zsXwg8c\nK71WcqdrlbAQvrTV63C03myGzdtXMpkpsvfDoeOI/hPdyjbeh7S+uBPl7y28FE5D\nEob41jYFa1yx0LbULPOVKj+62zQMZdE6WBewZwIDAQABAoIBAAV/p6pCiT/PSMqn\nxciBibU/MLPcQMw94ZR2UJdcCXsD85hfWmrMDCPYqWfWhtCJSZSFAuEvaZc53hUU\n/QdDjfO2W8tTljSBUebpFZTDdwexo7Hzq+liWmjC5iv9x2Fk6bUs5K70nAZHvo48\nRKvl+Ztdazuu/lkn83CplOhcRg7CFz9LNOdJBRInglGqXkfx7Qe+2Gvao2t7rCxT\noyGTO4una4GnHShIsbYOcLd0yNUPNmaEvd4tyDkJKgP7FuCf/LWCR3sH8NBf0FFX\nD0TtFw4cBUDu2x+qdbJoojU2ghZi06K53gTzY9VF8avGHBD2Baznx8HbpBqDWEQu\nLfOhI3UCgYEA7fjYlr3gfvfARWKTQSvWQnvBqkfoi9llBxcTGq6HdKt7/77LgC57\nUddB8lWG7EJ4qF+eVstVzVqBC0zJRxRsfIh9d+4gbC25/PbohopSPm7o300Bq4lE\n5Nt5OibkUHreiJoLgj1L2EdwT2Msw5b+kuALyfYICtjUC7cj+0kDl1UCgYEA1S21\nWFKywbqBm+opSbkPqYvTI3R4fxFi6sXBZ9Hs24LQTZ3GzdyPPPDv+IFtOXAscdDJ\n09E2+1vy/GJd+Vubtih1qvs37LA7KGCFH1McMlMiu5OiM5aGXzC52OnGB8dhAZC2\nybo3ATZTjNMTTidoEHYoqxZ1NjeGZR87+VTj8MsCgYEAvMRSenCv7cd1GxTwnhe5\n5A7rNrnHu3d87jzdiKK9DE0jFWExZ8J3TBomU6aIWkz4DQecQFkW/Mg36NDGML4A\nuGBEtqeLzIQRLpplJKQATUoJK2iYVIuUvL1j0j8biMOOVmlri6o3yZ4RdsfCsHvM\nAJH8h/3Dr2cD/S8PObtXP+kCgYA5og/i/wig44Fi252p9sRLPCgq77Qb9mFdw3UU\nUmbMucMDGOLEiRqYiTL3ZlZXLwJ1CtNl1qwcrLE2lol9fszMJIgbX6uw67wyoFWd\nMGTxHhTHzZQOimVtmsjD4f/N3pNVTwB77UItq7hO3End2T2DJc684mdx7vUApb8b\nG148nQKBgQDWWd6M1jrpycobL4zeymiPKAIyq7sEBWX7cOnV6G4wKRDwbdQm18Kd\nBeDaDJzV6Q9FlsuhDWcq4AJF0pKc+OHWz9zj/P8LAm3RKzj48xBZep309q4tFhGo\ntzqsg27cL2uTd30gcSI5wcEATRkB8OFbqcYuMgCuOs8WPMbPJbR5Gw==\n-----END RSA PRIVATE KEY-----\n";
