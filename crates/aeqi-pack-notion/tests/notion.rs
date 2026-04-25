//! W4 — Notion pack end-to-end tests.
//!
//! Twelve-plus cases covering each tool's request shape, refresh-on-401
//! retry, per-workspace isolation, rate-limit handling, cursor-based
//! pagination, heterogeneous property pass-through, and block-append
//! chunking. Mock Notion endpoints are hand-rolled with axum on an
//! OS-assigned port — no tests reach out to api.notion.com.

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
use aeqi_pack_notion::{
    blocks::{BlocksDeleteTool, BlocksGetTool, BlocksUpdateTool},
    databases::{DatabasesCreateRowTool, DatabasesGetSchemaTool, DatabasesQueryTool},
    pages::{
        PagesAppendBlocksTool, PagesCreateTool, PagesGetTool, PagesSearchTool, PagesUpdateTool,
    },
    users::UsersListTool,
};
use axum::extract::{Path, Query, State};
use axum::http::HeaderMap;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
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
    /// 429 budget — when >0, the next request returns 429 and decrements.
    fail_with_429: Arc<AtomicUsize>,
    history: Arc<Mutex<Vec<String>>>,
    /// Tag used by isolation tests so we can assert which token hit the
    /// upstream.
    last_auth: Arc<Mutex<Option<String>>>,
    /// Last `Notion-Version` header observed.
    last_notion_version: Arc<Mutex<Option<String>>>,
    /// Page counter used by the cursor-pagination test.
    page_counter: Arc<AtomicUsize>,
    /// Captured per-request bodies for the append-blocks test.
    append_bodies: Arc<Mutex<Vec<Value>>>,
}

async fn spawn_mock(state: MockState) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let base = format!("http://{addr}");
    let app = notion_router().with_state(state);
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    (base, handle)
}

fn notion_router() -> Router<MockState> {
    Router::new()
        // Pages
        .route("/v1/search", post(search))
        .route("/v1/pages", post(pages_create))
        .route("/v1/pages/{id}", get(pages_get).patch(pages_patch))
        // Blocks
        .route(
            "/v1/blocks/{id}",
            get(block_get).patch(block_patch).delete(block_delete),
        )
        .route(
            "/v1/blocks/{id}/children",
            get(block_children_get).patch(block_children_patch),
        )
        // Databases
        .route("/v1/databases/{id}", get(database_get))
        .route("/v1/databases/{id}/query", post(database_query))
        // Users
        .route("/v1/users", get(users_list))
}

fn record(s: &MockState, headers: &HeaderMap, path: impl Into<String>) {
    s.history.lock().unwrap().push(path.into());
    if let Some(v) = headers.get("Authorization").and_then(|v| v.to_str().ok()) {
        *s.last_auth.lock().unwrap() = Some(v.to_string());
    }
    if let Some(v) = headers.get("Notion-Version").and_then(|v| v.to_str().ok()) {
        *s.last_notion_version.lock().unwrap() = Some(v.to_string());
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

fn rate_limit_response() -> impl IntoResponse {
    let mut hm = HeaderMap::new();
    hm.insert("Retry-After", "42".parse().unwrap());
    (
        axum::http::StatusCode::TOO_MANY_REQUESTS,
        hm,
        Json(json!({ "object": "error", "code": "rate_limited" })),
    )
}

async fn search(
    State(s): State<MockState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, "POST /v1/search");
    *s.last_body.lock().unwrap() = Some(("search".into(), body.clone()));
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    }
    if try_consume_429(&s) {
        return rate_limit_response().into_response();
    }
    Json(json!({
        "object": "list",
        "has_more": false,
        "next_cursor": null,
        "results": [
            {
                "object": "page",
                "id": "page-1",
                "url": "https://notion.so/page-1",
                "last_edited_time": "2026-04-25T00:00:00Z",
                "parent": { "type": "workspace", "workspace": true },
                "properties": {
                    "Name": {
                        "type": "title",
                        "title": [{ "plain_text": "First page" }]
                    }
                }
            },
            {
                "object": "database",
                "id": "db-1",
                "url": "https://notion.so/db-1",
                "title": [{ "plain_text": "Tasks" }]
            }
        ]
    }))
    .into_response()
}

async fn pages_get(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("GET /v1/pages/{id}"));
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({}))).into_response();
    }
    Json(json!({
        "object": "page",
        "id": id,
        "url": format!("https://notion.so/{id}"),
        "last_edited_time": "2026-04-25T00:00:00Z",
        "archived": false,
        "parent": { "type": "workspace", "workspace": true },
        "properties": {
            "Name": {
                "type": "title",
                "title": [{ "plain_text": "Hello" }]
            },
            "Status": {
                "type": "select",
                "select": { "name": "Draft" }
            },
            // A heterogeneous shape — relation and multi_select live here too.
            "Tags": {
                "type": "multi_select",
                "multi_select": [{ "name": "alpha" }, { "name": "beta" }]
            }
        }
    }))
    .into_response()
}

async fn pages_create(
    State(s): State<MockState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, "POST /v1/pages");
    *s.last_body.lock().unwrap() = Some(("pages_create".into(), body.clone()));
    Json(json!({
        "object": "page",
        "id": "new-page-id",
        "url": "https://notion.so/new-page-id"
    }))
    .into_response()
}

async fn pages_patch(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, format!("PATCH /v1/pages/{id}"));
    *s.last_body.lock().unwrap() = Some(("pages_patch".into(), body.clone()));
    Json(json!({
        "object": "page",
        "id": id,
        "archived": body.get("archived").cloned().unwrap_or(Value::Bool(false)),
        "last_edited_time": "2026-04-25T00:00:00Z"
    }))
    .into_response()
}

async fn block_get(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("GET /v1/blocks/{id}"));
    Json(json!({
        "object": "block",
        "id": id,
        "type": "paragraph",
        "has_children": true,
        "paragraph": {
            "rich_text": [{ "plain_text": "Body of the block" }]
        }
    }))
    .into_response()
}

async fn block_patch(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, format!("PATCH /v1/blocks/{id}"));
    *s.last_body.lock().unwrap() = Some(("block_patch".into(), body.clone()));
    Json(json!({
        "object": "block",
        "id": id,
        "type": "paragraph",
        "paragraph": body.get("paragraph").cloned().unwrap_or(Value::Null)
    }))
    .into_response()
}

async fn block_delete(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("DELETE /v1/blocks/{id}"));
    Json(json!({
        "object": "block",
        "id": id,
        "archived": true
    }))
    .into_response()
}

async fn block_children_get(
    State(s): State<MockState>,
    Path(id): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("GET /v1/blocks/{id}/children"));
    let cursor = q.get("start_cursor").cloned().unwrap_or_default();
    s.page_counter.fetch_add(1, Ordering::SeqCst);
    // Drive cursor walking when id == "paged-block":
    //   cursor empty → return 100 + has_more=true + next_cursor="c1"
    //   cursor "c1"  → return 100 + has_more=true + next_cursor="c2" (cap hit)
    //   cursor "c2"  → return 50  + has_more=false (would be hit if cap ignored)
    if id == "paged-block" {
        let (count, next, has_more) = match cursor.as_str() {
            "" => (100usize, Some("c1"), true),
            "c1" => (100usize, Some("c2"), true),
            _ => (50usize, None, false),
        };
        let items: Vec<Value> = (0..count)
            .map(|i| {
                json!({
                    "object": "block",
                    "id": format!("{cursor}-{i}"),
                    "type": "paragraph"
                })
            })
            .collect();
        return Json(json!({
            "object": "list",
            "has_more": has_more,
            "next_cursor": next,
            "results": items,
        }))
        .into_response();
    }
    // Default: a single paragraph child.
    Json(json!({
        "object": "list",
        "has_more": false,
        "next_cursor": null,
        "results": [
            { "object": "block", "id": "child-1", "type": "paragraph" }
        ]
    }))
    .into_response()
}

async fn block_children_patch(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, format!("PATCH /v1/blocks/{id}/children"));
    s.append_bodies.lock().unwrap().push(body.clone());
    let children = body
        .get("children")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Json(json!({
        "object": "list",
        "results": children
    }))
    .into_response()
}

async fn database_get(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, format!("GET /v1/databases/{id}"));
    Json(json!({
        "object": "database",
        "id": id,
        "url": format!("https://notion.so/{id}"),
        "title": [{ "plain_text": "Project tracker" }],
        "parent": { "type": "page_id", "page_id": "parent-page" },
        "properties": {
            "Name":   { "type": "title",        "title": {} },
            "Status": { "type": "select",       "select": { "options": [{"name": "Open"}, {"name": "Closed"}] } },
            "Owner":  { "type": "people",       "people": {} },
            "Due":    { "type": "date",         "date": {} },
            "Linked": { "type": "relation",     "relation": { "database_id": "other-db" } }
        }
    }))
    .into_response()
}

async fn database_query(
    State(s): State<MockState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    record(&s, &headers, format!("POST /v1/databases/{id}/query"));
    *s.last_body.lock().unwrap() = Some(("database_query".into(), body.clone()));
    Json(json!({
        "object": "list",
        "has_more": false,
        "next_cursor": null,
        "results": [
            {
                "object": "page",
                "id": "row-1",
                "url": "https://notion.so/row-1",
                "last_edited_time": "2026-04-25T00:00:00Z",
                "archived": false,
                "properties": {
                    "Name": { "type": "title", "title": [{ "plain_text": "Row A" }] },
                    "Status": { "type": "select", "select": { "name": "Open" } },
                    "Owner":  { "type": "people", "people": [{ "id": "user-1" }] },
                    "Due":    { "type": "date",   "date": { "start": "2026-04-26" } },
                    "Linked": { "type": "relation", "relation": [{ "id": "rel-1" }, { "id": "rel-2" }] }
                }
            }
        ]
    }))
    .into_response()
}

async fn users_list(
    State(s): State<MockState>,
    Query(_q): Query<std::collections::HashMap<String, String>>,
    headers: HeaderMap,
) -> axum::response::Response {
    record(&s, &headers, "GET /v1/users".to_string());
    Json(json!({
        "object": "list",
        "has_more": false,
        "next_cursor": null,
        "results": [
            { "object": "user", "id": "u1", "name": "Alice", "type": "person", "person": { "email": "a@x" } },
            { "object": "user", "id": "u2", "name": "Bot",   "type": "bot",    "bot": {} }
        ]
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

/// Insert an OAuth2-shaped row covering a Notion workspace.
async fn seed_oauth_workspace(
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
        scope: String::new(),
    };
    let plaintext = serde_json::to_vec(&tokens).unwrap();
    let metadata = json!({
        "provider_kind": "notion",
        "auth_url":   "https://api.notion.com/v1/oauth/authorize",
        "token_url":  format!("{base_url}/v1/oauth/token"),
        "revoke_url": format!("{base_url}/v1/oauth/revoke"),
        "client_id":  "test-client-id",
        "scopes":     [],
        "redirect_uri": "http://localhost:0/callback",
        "aeqi_test_base": base_url,
    });
    env.store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::User,
            scope_id: workspace_id.into(),
            provider: "notion".into(),
            name: "oauth_token".into(),
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
// 1 — notion.pages.search returns mapped fields + extracts titles from
//     both database and page shapes; sends the Notion-Version header.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t01_pages_search_maps_fields_and_extracts_titles() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;

    let reg = registry_with(vec![Arc::new(PagesSearchTool)]);
    let result = reg
        .invoke(
            "notion.pages.search",
            json!({"query": "first", "filter_object": "page"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let results = result.data["results"].as_array().unwrap();
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["id"], "page-1");
    assert_eq!(results[0]["title"], "First page");
    // Database-shape titles also extracted.
    assert_eq!(results[1]["title"], "Tasks");
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "search");
    assert_eq!(captured.1["query"], "first");
    assert_eq!(captured.1["filter"]["value"], "page");
    // Notion-Version header pinned.
    let nv = mock_state.last_notion_version.lock().unwrap().clone();
    assert_eq!(nv.as_deref(), Some("2022-06-28"));
}

// ────────────────────────────────────────────────────────────────────────
// 2 — notion.pages.get returns metadata + heterogeneous properties verbatim
//     and includes children (default-mock returns 1 child, no truncation).
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t02_pages_get_returns_properties_passthrough_and_children() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PagesGetTool)]);
    let result = reg
        .invoke(
            "notion.pages.get",
            json!({"page_id": "page-xyz"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["id"], "page-xyz");
    // Properties passed through verbatim — including the heterogeneous shapes.
    assert_eq!(result.data["properties"]["Status"]["type"], "select");
    assert_eq!(
        result.data["properties"]["Status"]["select"]["name"],
        "Draft"
    );
    assert_eq!(result.data["properties"]["Tags"]["type"], "multi_select");
    let multi = result.data["properties"]["Tags"]["multi_select"]
        .as_array()
        .unwrap();
    assert_eq!(multi.len(), 2);
    assert_eq!(multi[0]["name"], "alpha");
    // Children present (default mock yields 1).
    assert_eq!(result.data["children"].as_array().unwrap().len(), 1);
    assert_eq!(result.data["truncated"], false);
}

// ────────────────────────────────────────────────────────────────────────
// 3 — notion.pages.create posts parent + properties + children.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t03_pages_create_round_trips_parent_properties_children() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PagesCreateTool)]);
    let result = reg
        .invoke(
            "notion.pages.create",
            json!({
                "parent": { "type": "page_id", "page_id": "parent-1" },
                "properties": {
                    "Name": { "title": [{ "text": { "content": "Hello" } }] }
                },
                "children": [
                    { "object": "block", "type": "paragraph",
                      "paragraph": { "rich_text": [{ "text": { "content": "Body" } }] } }
                ]
            }),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["id"], "new-page-id");
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "pages_create");
    assert_eq!(captured.1["parent"]["page_id"], "parent-1");
    assert!(captured.1["properties"]["Name"]["title"].is_array());
    assert_eq!(captured.1["children"].as_array().unwrap().len(), 1);
}

// ────────────────────────────────────────────────────────────────────────
// 4 — notion.pages.update PATCHes properties + archived; rejects empty body.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t04_pages_update_patches_and_rejects_empty() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PagesUpdateTool)]);

    // Successful PATCH with archived flag flipping.
    let ok = reg
        .invoke(
            "notion.pages.update",
            json!({
                "page_id": "page-1",
                "properties": { "Status": { "select": { "name": "Done" } } },
                "archived": true
            }),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!ok.is_error, "{:?}", ok.output);
    assert_eq!(ok.data["archived"], true);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "pages_patch");
    assert_eq!(captured.1["archived"], true);
    assert_eq!(captured.1["properties"]["Status"]["select"]["name"], "Done");

    // Empty body rejected.
    let bad = reg
        .invoke(
            "notion.pages.update",
            json!({"page_id": "page-1"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(bad.is_error);
    assert!(bad.output.contains("no fields to update"));
}

// ────────────────────────────────────────────────────────────────────────
// 5 — notion.pages.append_blocks chunks > 100 children transparently.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t05_append_blocks_chunks_oversized_arrays() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(PagesAppendBlocksTool)]);

    // 250 paragraph blocks → 3 chunks (100 + 100 + 50).
    let mut children: Vec<Value> = Vec::with_capacity(250);
    for i in 0..250 {
        children.push(json!({
            "object": "block",
            "type": "paragraph",
            "paragraph": { "rich_text": [{ "text": { "content": format!("p{i}") } }] }
        }));
    }
    let result = reg
        .invoke(
            "notion.pages.append_blocks",
            json!({ "block_id": "page-x", "children": children }),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["chunks"], 3);
    assert_eq!(result.data["appended"], 250);
    let bodies = mock_state.append_bodies.lock().unwrap().clone();
    assert_eq!(bodies.len(), 3, "should have issued 3 PATCHes");
    assert_eq!(bodies[0]["children"].as_array().unwrap().len(), 100);
    assert_eq!(bodies[1]["children"].as_array().unwrap().len(), 100);
    assert_eq!(bodies[2]["children"].as_array().unwrap().len(), 50);

    // 50-block payload exits in a single chunk.
    mock_state.append_bodies.lock().unwrap().clear();
    let small: Vec<Value> = (0..50)
        .map(|i| json!({"object": "block", "type": "paragraph", "id": format!("p{i}")}))
        .collect();
    let small_res = reg
        .invoke(
            "notion.pages.append_blocks",
            json!({ "block_id": "page-x", "children": small }),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!small_res.is_error);
    assert_eq!(small_res.data["chunks"], 1);
    assert_eq!(small_res.data["appended"], 50);
}

// ────────────────────────────────────────────────────────────────────────
// 6 — notion.databases.query passes filter + sorts and pass-through props.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t06_databases_query_passes_filter_and_returns_passthrough_properties() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(DatabasesQueryTool)]);
    let result = reg
        .invoke(
            "notion.databases.query",
            json!({
                "database_id": "db-1",
                "filter": { "property": "Status", "select": { "equals": "Open" } },
                "sorts":  [{ "property": "Due", "direction": "ascending" }]
            }),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let rows = result.data["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    let props = &rows[0]["properties"];
    // Heterogeneous property types pass through unchanged.
    assert_eq!(props["Status"]["type"], "select");
    assert_eq!(props["Status"]["select"]["name"], "Open");
    assert_eq!(props["Owner"]["type"], "people");
    assert_eq!(props["Owner"]["people"][0]["id"], "user-1");
    assert_eq!(props["Due"]["type"], "date");
    assert_eq!(props["Due"]["date"]["start"], "2026-04-26");
    assert_eq!(props["Linked"]["type"], "relation");
    let rels = props["Linked"]["relation"].as_array().unwrap();
    assert_eq!(rels.len(), 2);
    assert_eq!(rels[1]["id"], "rel-2");

    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "database_query");
    assert_eq!(captured.1["filter"]["property"], "Status");
    assert_eq!(captured.1["sorts"][0]["direction"], "ascending");
}

// ────────────────────────────────────────────────────────────────────────
// 7 — notion.databases.get_schema returns title + heterogeneous schema.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t07_databases_get_schema_returns_title_and_heterogeneous_columns() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(DatabasesGetSchemaTool)]);
    let result = reg
        .invoke(
            "notion.databases.get_schema",
            json!({"database_id": "db-1"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["id"], "db-1");
    assert_eq!(result.data["title"], "Project tracker");
    let props = &result.data["properties"];
    assert_eq!(props["Name"]["type"], "title");
    assert_eq!(props["Status"]["type"], "select");
    assert_eq!(props["Owner"]["type"], "people");
    assert_eq!(props["Due"]["type"], "date");
    assert_eq!(props["Linked"]["type"], "relation");
    assert_eq!(props["Linked"]["relation"]["database_id"], "other-db");
}

// ────────────────────────────────────────────────────────────────────────
// 8 — notion.databases.create_row injects the database_id parent shape.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t08_databases_create_row_wraps_with_database_parent() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(DatabasesCreateRowTool)]);
    let result = reg
        .invoke(
            "notion.databases.create_row",
            json!({
                "database_id": "db-1",
                "properties": {
                    "Name":   { "title": [{ "text": { "content": "Row Z" } }] },
                    "Status": { "select": { "name": "Open" } }
                }
            }),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["id"], "new-page-id");
    assert_eq!(result.data["database_id"], "db-1");
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "pages_create");
    assert_eq!(captured.1["parent"]["database_id"], "db-1");
    assert_eq!(captured.1["properties"]["Status"]["select"]["name"], "Open");
}

// ────────────────────────────────────────────────────────────────────────
// 9 — notion.blocks.get includes children when has_children=true.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t09_blocks_get_includes_children_envelope() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(BlocksGetTool)]);
    let result = reg
        .invoke(
            "notion.blocks.get",
            json!({"block_id": "blk-1"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["block"]["id"], "blk-1");
    assert_eq!(result.data["block"]["type"], "paragraph");
    let children = result.data["children"].as_array().unwrap();
    assert_eq!(children.len(), 1);
    assert_eq!(children[0]["id"], "child-1");
    assert_eq!(result.data["truncated"], false);
}

// ────────────────────────────────────────────────────────────────────────
// 10 — notion.blocks.update + notion.blocks.delete round-trip the patch.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t10_blocks_update_and_delete_roundtrip() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![
        Arc::new(BlocksUpdateTool) as Arc<dyn Tool>,
        Arc::new(BlocksDeleteTool) as Arc<dyn Tool>,
    ]);

    let updated = reg
        .invoke(
            "notion.blocks.update",
            json!({
                "block_id": "blk-1",
                "patch": { "paragraph": { "rich_text": [{ "text": { "content": "new text" } }] } }
            }),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!updated.is_error, "{:?}", updated.output);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "block_patch");
    assert!(captured.1["paragraph"]["rich_text"].is_array());

    let deleted = reg
        .invoke(
            "notion.blocks.delete",
            json!({"block_id": "blk-1"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!deleted.is_error, "{:?}", deleted.output);
    assert_eq!(deleted.data["archived"], true);
    assert_eq!(deleted.data["id"], "blk-1");
    let history = mock_state.history.lock().unwrap().clone();
    assert!(
        history.iter().any(|p| p == "DELETE /v1/blocks/blk-1"),
        "got {history:?}"
    );
}

// ────────────────────────────────────────────────────────────────────────
// 11 — notion.users.list returns mapped fields.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t11_users_list_returns_mapped_users() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok-1", "rt-1").await;
    let reg = registry_with(vec![Arc::new(UsersListTool)]);
    let result = reg
        .invoke(
            "notion.users.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let users = result.data["users"].as_array().unwrap();
    assert_eq!(users.len(), 2);
    assert_eq!(users[0]["name"], "Alice");
    assert_eq!(users[0]["type"], "person");
    assert_eq!(users[1]["type"], "bot");
    assert_eq!(result.data["truncated"], false);
}

// ────────────────────────────────────────────────────────────────────────
// 12 — Refresh-on-401 retry succeeds (oauth2 lifecycle).
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t12_refresh_on_401_retries_and_succeeds() {
    let env = env();
    let state = MockState::default();
    let token_calls = Arc::new(AtomicUsize::new(0));
    let token_calls_route = token_calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = notion_router()
        .route(
            "/v1/oauth/token",
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
                            "scope":         ""
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
    seed_oauth_workspace(&env, "ws-1", &base, "stale-tok", "rt-original").await;

    state.fail_with_401.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(PagesGetTool)]);
    let result = reg
        .invoke(
            "notion.pages.get",
            json!({"page_id": "page-xyz"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(
        !result.is_error,
        "expected success after retry, got {:?} data={}",
        result.output, result.data
    );
    assert_eq!(token_calls.load(Ordering::SeqCst), 1);
    let last_auth = state.last_auth.lock().unwrap().clone().unwrap();
    assert!(
        last_auth.contains("fresh-tok"),
        "retry should use refreshed token, got {last_auth}"
    );
}

// ────────────────────────────────────────────────────────────────────────
// 13 — Per-workspace isolation: two workspaces resolve to two rows.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t13_per_workspace_isolation_separate_credentials() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    let id_a = seed_oauth_workspace(&env, "ws-A", &base, "tok-A", "rt-A").await;
    let id_b = seed_oauth_workspace(&env, "ws-B", &base, "tok-B", "rt-B").await;
    assert_ne!(id_a, id_b);

    let reg = registry_with(vec![Arc::new(UsersListTool)]);
    let _ = reg
        .invoke(
            "notion.users.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "ws-A"),
        )
        .await
        .unwrap();
    let auth_after_a = mock_state.last_auth.lock().unwrap().clone().unwrap();
    assert!(auth_after_a.contains("tok-A"), "got {auth_after_a}");

    let _ = reg
        .invoke(
            "notion.users.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "ws-B"),
        )
        .await
        .unwrap();
    let auth_after_b = mock_state.last_auth.lock().unwrap().clone().unwrap();
    assert!(auth_after_b.contains("tok-B"), "got {auth_after_b}");
    assert_ne!(auth_after_a, auth_after_b);

    // And resolving directly via the resolver returns the matching row id.
    let need = UsersListTool
        .required_credentials()
        .into_iter()
        .next()
        .unwrap();
    let cred_a: UsableCredential = env
        .resolver
        .resolve(
            &need,
            &ResolutionScope {
                user_id: Some("ws-A".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cred_a.id, id_a);
}

// ────────────────────────────────────────────────────────────────────────
// 14 — Missing credential surfaces missing_credential.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t14_missing_credential_surfaces_reason_code() {
    let env = env();
    let reg = registry_with(vec![Arc::new(UsersListTool)]);
    // No row seeded — substrate has nothing to resolve.
    let result = reg
        .invoke(
            "notion.users.list",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "no-such-workspace"),
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
// 15 — Cursor pagination caps at 200 results and marks truncated=true.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t15_pagination_caps_at_200_and_marks_truncated() {
    use aeqi_pack_notion::api::NotionApiClient;

    let env = env();
    let state = MockState::default();
    let (base, _h) = spawn_mock(state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok", "rt").await;

    // Resolve directly so we drive `paginate_get` without going via a tool.
    let need = UsersListTool
        .required_credentials()
        .into_iter()
        .next()
        .unwrap();
    let cred = env
        .resolver
        .resolve(
            &need,
            &ResolutionScope {
                user_id: Some("ws-1".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .unwrap();
    let client = NotionApiClient::new(&cred).with_base(base.clone());
    // Mock returns 100, 100, 50 across cursors "" → "c1" → "c2". The walk
    // should stop after reaching the 200 cap and mark truncated=true,
    // never fetching the third page.
    let url = format!("{base}/v1/blocks/paged-block/children?page_size=100");
    let (items, truncated) = client.paginate_get(url).await.unwrap();
    assert_eq!(items.len(), 200, "should hit cap exactly");
    assert!(truncated, "more pages remained — must be truncated");
    // Pages 1 and 2 walked; page 3 never fetched.
    assert!(state.page_counter.load(Ordering::SeqCst) >= 2);
    assert!(state.page_counter.load(Ordering::SeqCst) <= 2);
}

// ────────────────────────────────────────────────────────────────────────
// 16 — Rate limit (429 + Retry-After) surfaces rate_limited.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t16_rate_limit_surfaces_distinct_reason_code() {
    let env = env();
    let state = MockState::default();
    let (base, _h) = spawn_mock(state.clone()).await;
    seed_oauth_workspace(&env, "ws-1", &base, "tok", "rt").await;
    state.fail_with_429.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(PagesSearchTool)]);
    let result = reg
        .invoke(
            "notion.pages.search",
            json!({"query": "anything"}),
            CallerKind::Llm,
            &ctx(&env, "ws-1"),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert_eq!(
        result.data["reason_code"], "rate_limited",
        "got data={}",
        result.data
    );
    assert_eq!(result.data["retry_after"], "42");
}
