//! W1 — Google Workspace pack end-to-end tests.
//!
//! Fifteen cases covering each tool's request shape, the refresh-on-401
//! retry path, per-agent isolation, and scope mismatch. Mock Google
//! endpoints are hand-rolled with axum on an OS-assigned port — no
//! tests reach out to real Google APIs.

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
use aeqi_pack_google_workspace::{
    calendar::{
        CalendarCreateEventTool, CalendarDeleteEventTool, CalendarListEventsTool,
        CalendarUpdateEventTool,
    },
    gmail::{
        GmailArchiveTool, GmailLabelTool, GmailReadTool, GmailSearchTool, GmailSendTool,
        build_rfc5322,
    },
    meet::{MeetCreateTool, MeetListActiveTool},
};
use axum::extract::{Path, Query, State};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use base64::Engine;
use chrono::Utc;
use rusqlite::Connection;
use serde_json::{Value, json};
use tempfile::TempDir;

// ────────────────────────────────────────────────────────────────────────
// Test scaffolding.
// ────────────────────────────────────────────────────────────────────────

#[derive(Clone, Default)]
struct MockState {
    /// Last received request body (parsed JSON), keyed by path.
    last_body: Arc<Mutex<Option<(String, Value)>>>,
    /// 401 budget — when >0, the next request returns 401 and decrements.
    fail_with_401: Arc<AtomicUsize>,
    /// All paths hit so far.
    history: Arc<Mutex<Vec<String>>>,
    /// Optional last query string captured on GET.
    last_query: Arc<Mutex<Option<String>>>,
}

async fn spawn_mock(state: MockState) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = google_router().with_state(state);
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    (format!("http://{addr}"), handle)
}

fn google_router() -> Router<MockState> {
    Router::new()
        // ------ gmail ------
        .route("/gmail/v1/users/me/messages", get(gmail_list))
        .route("/gmail/v1/users/me/messages/send", post(gmail_send_handler))
        .route("/gmail/v1/users/me/messages/{id}", get(gmail_get_handler))
        .route(
            "/gmail/v1/users/me/messages/{id}/modify",
            post(gmail_modify_handler),
        )
        // ------ calendar ------
        .route("/calendars/{cal}/events", get(calendar_list))
        .route("/calendars/{cal}/events", post(calendar_create))
        .route(
            "/calendars/{cal}/events/{eid}",
            patch(calendar_patch).delete(calendar_delete),
        )
}

async fn gmail_list(
    State(s): State<MockState>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> (axum::http::StatusCode, Json<Value>) {
    s.history
        .lock()
        .unwrap()
        .push("/gmail/v1/users/me/messages".into());
    if let Some(qs) = q.get("q") {
        *s.last_query.lock().unwrap() = Some(qs.clone());
    }
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    (
        axum::http::StatusCode::OK,
        Json(json!({
            "messages": [
                { "id": "m1", "threadId": "t1" },
                { "id": "m2", "threadId": "t1" }
            ]
        })),
    )
}

async fn gmail_get_handler(
    State(s): State<MockState>,
    Path(id): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> (axum::http::StatusCode, Json<Value>) {
    s.history
        .lock()
        .unwrap()
        .push(format!("/gmail/v1/users/me/messages/{id}"));
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let format = q.get("format").map(String::as_str).unwrap_or("metadata");
    if format == "full" {
        // Encoded "hello world" body and an attachment.
        let body = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("hello world");
        return (
            axum::http::StatusCode::OK,
            Json(json!({
                "id": id,
                "threadId": "t1",
                "snippet": "hello",
                "payload": {
                    "mimeType": "multipart/mixed",
                    "headers": [
                        { "name": "From", "value": "alice@example.com" },
                        { "name": "To", "value": "agent@example.com" },
                        { "name": "Subject", "value": "Greetings" }
                    ],
                    "parts": [
                        { "mimeType": "text/plain", "body": { "data": body, "size": 11 } },
                        { "mimeType": "application/pdf", "filename": "doc.pdf", "body": { "size": 1234, "attachmentId": "att-1" } }
                    ]
                }
            })),
        );
    }
    (
        axum::http::StatusCode::OK,
        Json(json!({
            "id": id,
            "threadId": "t1",
            "snippet": "snip",
            "internalDate": "1700000000000",
            "payload": {
                "headers": [
                    { "name": "From", "value": "from@example.com" },
                    { "name": "Subject", "value": "subj" }
                ]
            }
        })),
    )
}

async fn gmail_send_handler(
    State(s): State<MockState>,
    Json(body): Json<Value>,
) -> (axum::http::StatusCode, Json<Value>) {
    s.history
        .lock()
        .unwrap()
        .push("/gmail/v1/users/me/messages/send".into());
    *s.last_body.lock().unwrap() = Some(("send".into(), body));
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    (
        axum::http::StatusCode::OK,
        Json(json!({ "id": "sent-1", "threadId": "t-out" })),
    )
}

async fn gmail_modify_handler(
    State(s): State<MockState>,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> (axum::http::StatusCode, Json<Value>) {
    s.history
        .lock()
        .unwrap()
        .push(format!("/gmail/v1/users/me/messages/{id}/modify"));
    *s.last_body.lock().unwrap() = Some(("modify".into(), body.clone()));
    if try_consume_401(&s) {
        return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let add = body
        .get("addLabelIds")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    let remove = body
        .get("removeLabelIds")
        .cloned()
        .unwrap_or(Value::Array(Vec::new()));
    (
        axum::http::StatusCode::OK,
        Json(json!({
            "id": id,
            "labelIds": ["INBOX", "STARRED"],
            "echo_add": add,
            "echo_remove": remove,
        })),
    )
}

async fn calendar_list(
    State(s): State<MockState>,
    Path(cal): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
) -> Json<Value> {
    s.history
        .lock()
        .unwrap()
        .push(format!("/calendars/{cal}/events"));
    *s.last_query.lock().unwrap() = Some(format!(
        "timeMin={} timeMax={}",
        q.get("timeMin").cloned().unwrap_or_default(),
        q.get("timeMax").cloned().unwrap_or_default()
    ));
    let now = Utc::now();
    let one_min_ago = (now - chrono::Duration::minutes(1)).to_rfc3339();
    let one_min_ahead = (now + chrono::Duration::minutes(1)).to_rfc3339();
    Json(json!({
        "items": [
            {
                "id": "ev-1",
                "summary": "standup",
                "start": { "dateTime": one_min_ago },
                "end":   { "dateTime": one_min_ahead },
                "conferenceData": {
                    "entryPoints": [
                        { "entryPointType": "video", "uri": "https://meet.google.com/abc-defg-hij" }
                    ]
                }
            },
            {
                "id": "ev-2",
                "summary": "lunch",
                "start": { "dateTime": "2030-01-01T12:00:00Z" },
                "end":   { "dateTime": "2030-01-01T13:00:00Z" }
            }
        ]
    }))
}

async fn calendar_create(
    State(s): State<MockState>,
    Path(cal): Path<String>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    Json(body): Json<Value>,
) -> (axum::http::StatusCode, Json<Value>) {
    s.history
        .lock()
        .unwrap()
        .push(format!("/calendars/{cal}/events"));
    *s.last_body.lock().unwrap() = Some(("calendar_create".into(), body.clone()));
    let want_meet = q
        .get("conferenceDataVersion")
        .map(|v| v == "1")
        .unwrap_or(false);
    let mut response = json!({
        "id": "ev-new",
        "htmlLink": "https://calendar.google.com/event?eid=abc",
        "summary": body.get("summary").cloned().unwrap_or(Value::Null),
    });
    if want_meet || body.get("conferenceData").is_some() {
        response["conferenceData"] = json!({
            "entryPoints": [
                { "entryPointType": "video", "uri": "https://meet.google.com/xyz-pqrs-tuv" }
            ]
        });
    }
    (axum::http::StatusCode::OK, Json(response))
}

async fn calendar_patch(
    State(s): State<MockState>,
    Path((cal, eid)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Json<Value> {
    s.history
        .lock()
        .unwrap()
        .push(format!("/calendars/{cal}/events/{eid}"));
    *s.last_body.lock().unwrap() = Some(("calendar_patch".into(), body.clone()));
    Json(json!({ "id": eid, "patched": body }))
}

async fn calendar_delete(
    State(s): State<MockState>,
    Path((cal, eid)): Path<(String, String)>,
) -> axum::http::StatusCode {
    s.history
        .lock()
        .unwrap()
        .push(format!("/calendars/{cal}/events/{eid}"));
    let _ = (cal, eid);
    axum::http::StatusCode::NO_CONTENT
}

fn try_consume_401(s: &MockState) -> bool {
    let prev = s.fail_with_401.load(Ordering::SeqCst);
    if prev > 0 {
        s.fail_with_401.fetch_sub(1, Ordering::SeqCst);
        return true;
    }
    false
}

// ────────────────────────────────────────────────────────────────────────
// Helpers — credential + registry plumbing.
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

/// Insert an OAuth2-shaped row covering `scopes` into `agent_id`'s scope.
async fn seed_token(
    env: &Env,
    agent_id: &str,
    base_url: &str,
    access_token: &str,
    refresh_token: &str,
    scopes: &[&str],
) -> String {
    let tokens = OAuth2Tokens {
        access_token: access_token.into(),
        refresh_token: Some(refresh_token.into()),
        token_type: "Bearer".into(),
        scope: scopes.join(" "),
    };
    let plaintext = serde_json::to_vec(&tokens).unwrap();
    let metadata = json!({
        "provider_kind": "google",
        "token_url":  format!("{base_url}/oauth2/token"),
        "auth_url":   "https://accounts.google.com/o/oauth2/v2/auth",
        "revoke_url": format!("{base_url}/oauth2/revoke"),
        "client_id":  "test-client-id",
        "scopes":     scopes,
        "redirect_uri": "http://localhost:0/callback",
        // Tests pin the API base URL via this metadata override so the
        // tools' GoogleApiClient hits the mock server.
        "aeqi_test_base": base_url,
    });
    env.store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Agent,
            scope_id: agent_id.into(),
            provider: "google".into(),
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

fn ctx(env: &Env, agent_id: &str) -> ExecutionContext {
    ExecutionContext {
        session_id: "s1".into(),
        agent_id: agent_id.into(),
        credential_resolver: Some(env.resolver.clone()),
        credential_scope: ResolutionScope::for_agent(agent_id),
        ..Default::default()
    }
}

// ────────────────────────────────────────────────────────────────────────
// 1 — gmail.search: URL + query params + returned shape.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t01_gmail_search_emits_query_param_and_returns_shape() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    let _id = seed_token(
        &env,
        "agentA",
        &base,
        "tok-a",
        "rt-a",
        &["https://www.googleapis.com/auth/gmail.readonly"],
    )
    .await;

    let reg = registry_with(vec![Arc::new(GmailSearchTool)]);
    let result = reg
        .invoke(
            "gmail.search",
            json!({"query": "from:alice", "max_results": 5}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "got {:?}", result.output);
    let messages = result.data.get("messages").unwrap().as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["id"], "m1");
    assert_eq!(
        mock_state.last_query.lock().unwrap().as_deref(),
        Some("from:alice")
    );
}

// ────────────────────────────────────────────────────────────────────────
// 2 — gmail.read: full body + attachments metadata.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t02_gmail_read_returns_body_and_attachments() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/gmail.readonly"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(GmailReadTool)]);
    let result = reg
        .invoke(
            "gmail.read",
            json!({"message_id": "m1"}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["body_text"], "hello world");
    let atts = result.data["attachments"].as_array().unwrap();
    assert_eq!(atts.len(), 1);
    assert_eq!(atts[0]["filename"], "doc.pdf");
    assert_eq!(atts[0]["mime_type"], "application/pdf");
}

// ────────────────────────────────────────────────────────────────────────
// 3 — gmail.send: multipart body construction + RFC 5322 headers.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t03_gmail_send_constructs_rfc5322_and_base64url_encodes() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/gmail.modify"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(GmailSendTool)]);
    let result = reg
        .invoke(
            "gmail.send",
            json!({
                "to":      "bob@example.com",
                "cc":      "cc@example.com",
                "subject": "Hello",
                "body":    "World",
                "reply_to_thread_id": "t-out"
            }),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["message_id"], "sent-1");
    assert_eq!(result.data["thread_id"], "t-out");
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "send");
    let raw_b64 = captured.1["raw"].as_str().unwrap();
    assert_eq!(captured.1["threadId"].as_str().unwrap(), "t-out");
    let raw_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(raw_b64)
        .unwrap();
    let raw = String::from_utf8(raw_bytes).unwrap();
    assert!(raw.contains("To: bob@example.com\r\n"));
    assert!(raw.contains("Cc: cc@example.com\r\n"));
    assert!(raw.contains("Subject: Hello\r\n"));
    assert!(raw.ends_with("\r\nWorld"));
}

#[test]
fn t03b_build_rfc5322_omits_blank_cc_bcc() {
    let raw = build_rfc5322("a@x", "", "", "Hi", "Body");
    assert!(raw.contains("To: a@x\r\n"));
    assert!(!raw.contains("Cc:"));
    assert!(!raw.contains("Bcc:"));
}

// ────────────────────────────────────────────────────────────────────────
// 4 — gmail.label: add and remove.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t04_gmail_label_adds_and_removes() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/gmail.modify"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(GmailLabelTool)]);
    let result = reg
        .invoke(
            "gmail.label",
            json!({
                "message_id": "m1",
                "add_labels": ["STARRED"],
                "remove_labels": ["UNREAD"]
            }),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "modify");
    assert_eq!(captured.1["addLabelIds"][0], "STARRED");
    assert_eq!(captured.1["removeLabelIds"][0], "UNREAD");
}

// ────────────────────────────────────────────────────────────────────────
// 5 — gmail.archive: removes INBOX label.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t05_gmail_archive_removes_inbox() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/gmail.modify"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(GmailArchiveTool)]);
    let result = reg
        .invoke(
            "gmail.archive",
            json!({"message_id": "m1"}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    let removed = captured.1["removeLabelIds"].as_array().unwrap();
    assert_eq!(removed[0], "INBOX");
}

// ────────────────────────────────────────────────────────────────────────
// 6 — calendar.list_events: time window filtering.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t06_calendar_list_events_passes_time_window() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/calendar.readonly"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(CalendarListEventsTool)]);
    let result = reg
        .invoke(
            "calendar.list_events",
            json!({
                "time_min": "2026-04-25T00:00:00Z",
                "time_max": "2026-04-26T00:00:00Z"
            }),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["events"].as_array().unwrap().len(), 2);
    let q = mock_state.last_query.lock().unwrap().clone().unwrap();
    assert!(q.contains("timeMin=2026-04-25"));
    assert!(q.contains("timeMax=2026-04-26"));
}

// ────────────────────────────────────────────────────────────────────────
// 7 — calendar.create_event with conferencing_meet=true: createRequest +
//     surfaces meet_link.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t07_calendar_create_event_with_meet_includes_create_request() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/calendar"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(CalendarCreateEventTool)]);
    let result = reg
        .invoke(
            "calendar.create_event",
            json!({
                "title": "demo",
                "start": "2026-04-25T15:00:00Z",
                "end":   "2026-04-25T15:30:00Z",
                "attendees": ["a@x", "b@x"],
                "conferencing_meet": true
            }),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(
        result.data["meet_link"],
        "https://meet.google.com/xyz-pqrs-tuv"
    );
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "calendar_create");
    let cd = &captured.1["conferenceData"]["createRequest"];
    assert_eq!(cd["conferenceSolutionKey"]["type"], "hangoutsMeet");
    assert!(cd["requestId"].as_str().unwrap().starts_with("aeqi-"));
}

// ────────────────────────────────────────────────────────────────────────
// 8 — calendar.update_event: PATCH semantics (only changed fields).
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t08_calendar_update_event_patches_only_passed_fields() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/calendar"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(CalendarUpdateEventTool)]);
    let result = reg
        .invoke(
            "calendar.update_event",
            json!({"event_id": "ev-1", "title": "renamed"}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    assert_eq!(captured.0, "calendar_patch");
    assert_eq!(captured.1.as_object().unwrap().len(), 1);
    assert_eq!(captured.1["summary"], "renamed");
}

// ────────────────────────────────────────────────────────────────────────
// 9 — calendar.delete_event.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t09_calendar_delete_event_returns_success() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/calendar"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(CalendarDeleteEventTool)]);
    let result = reg
        .invoke(
            "calendar.delete_event",
            json!({"event_id": "ev-9"}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(result.data["deleted"], true);
    let history = mock_state.history.lock().unwrap();
    assert!(
        history
            .iter()
            .any(|p| p.contains("/calendars/primary/events/ev-9"))
    );
}

// ────────────────────────────────────────────────────────────────────────
// 10 — meet.create.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t10_meet_create_via_calendar_returns_meet_link() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/calendar"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(MeetCreateTool)]);
    let result = reg
        .invoke(
            "meet.create",
            json!({"topic": "sync", "duration_minutes": 15, "attendees": ["x@y"]}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    assert_eq!(
        result.data["meet_link"],
        "https://meet.google.com/xyz-pqrs-tuv"
    );
    let captured = mock_state.last_body.lock().unwrap().clone().unwrap();
    let cd = &captured.1["conferenceData"]["createRequest"];
    assert_eq!(cd["conferenceSolutionKey"]["type"], "hangoutsMeet");
}

// ────────────────────────────────────────────────────────────────────────
// 11 — meet.list_active.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t11_meet_list_active_filters_to_currently_running() {
    let env = env();
    let (base, _h) = spawn_mock(MockState::default()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/calendar"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(MeetListActiveTool)]);
    let result = reg
        .invoke(
            "meet.list_active",
            json!({}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(!result.is_error, "{:?}", result.output);
    let meetings = result.data["meetings"].as_array().unwrap();
    // Only ev-1 (with Meet link, spanning now). ev-2 is in the future.
    assert_eq!(meetings.len(), 1);
    assert_eq!(meetings[0]["event_id"], "ev-1");
    assert_eq!(
        meetings[0]["meet_link"],
        "https://meet.google.com/abc-defg-hij"
    );
}

// ────────────────────────────────────────────────────────────────────────
// 12 — Refresh-on-401 retry succeeds.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t12_refresh_on_401_retries_and_succeeds() {
    let env = env();
    // We need a token endpoint that responds to refresh requests on the same
    // base URL the tools hit. Mount a simple POST /oauth2/token that returns
    // a fresh access token, then add the gmail routes.
    let state = MockState::default();
    let token_calls = Arc::new(AtomicUsize::new(0));
    let token_calls_route = token_calls.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = google_router()
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
                            "scope":         "https://www.googleapis.com/auth/gmail.readonly"
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
    seed_token(
        &env,
        "agentA",
        &base,
        "stale-tok",
        "rt-original",
        &["https://www.googleapis.com/auth/gmail.readonly"],
    )
    .await;

    // Make the next request return 401 — exactly one.
    state.fail_with_401.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(GmailSearchTool)]);
    let result = reg
        .invoke(
            "gmail.search",
            json!({"query": "x"}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();

    assert!(
        !result.is_error,
        "expected success after retry, got {:?} data={}",
        result.output, result.data
    );
    assert_eq!(token_calls.load(Ordering::SeqCst), 1);
    // 1st list (401) + 2nd list (ok) + 2 metadata GETs for the 2 messages.
    assert_eq!(state.history.lock().unwrap().len(), 4);
}

// ────────────────────────────────────────────────────────────────────────
// 13 — Refresh-on-401 fails (refresh endpoint returns 400 invalid_grant).
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t13_refresh_failed_surfaces_reason_code() {
    let env = env();
    let state = MockState::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = google_router()
        .route(
            "/oauth2/token",
            post(|| async {
                (
                    axum::http::StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "invalid_grant" })),
                )
            }),
        )
        .with_state(state.clone());
    let _h = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    tokio::time::sleep(Duration::from_millis(20)).await;
    let base = format!("http://{addr}");
    seed_token(
        &env,
        "agentA",
        &base,
        "stale",
        "rt-revoked",
        &["https://www.googleapis.com/auth/gmail.readonly"],
    )
    .await;
    state.fail_with_401.store(1, Ordering::SeqCst);

    let reg = registry_with(vec![Arc::new(GmailSearchTool)]);
    let result = reg
        .invoke(
            "gmail.search",
            json!({"query": "x"}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert!(
        result.output.contains("revoked_by_provider") || result.output.contains("refresh_failed"),
        "got {}",
        result.output
    );
}

// ────────────────────────────────────────────────────────────────────────
// 14 — Per-agent isolation: two agents see two different mailboxes (via
//     two distinct credential rows). Verifies scope_id resolution.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t14_per_agent_isolation_separate_credentials() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    let id_a = seed_token(
        &env,
        "agentA",
        &base,
        "tok-a",
        "rt-a",
        &["https://www.googleapis.com/auth/gmail.readonly"],
    )
    .await;
    let id_b = seed_token(
        &env,
        "agentB",
        &base,
        "tok-b",
        "rt-b",
        &["https://www.googleapis.com/auth/gmail.readonly"],
    )
    .await;
    assert_ne!(id_a, id_b);

    // Resolve directly via the resolver (the registry path is exercised
    // elsewhere — here we want to assert the row-id mapping).
    let need = aeqi_pack_google_workspace::gmail::GmailSearchTool
        .required_credentials()
        .into_iter()
        .next()
        .unwrap();

    let cred_a: UsableCredential = env
        .resolver
        .resolve(&need, &ResolutionScope::for_agent("agentA"))
        .await
        .unwrap()
        .unwrap();
    let cred_b: UsableCredential = env
        .resolver
        .resolve(&need, &ResolutionScope::for_agent("agentB"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cred_a.id, id_a);
    assert_eq!(cred_b.id, id_b);
    assert_ne!(cred_a.bearer, cred_b.bearer);
    assert_eq!(cred_a.bearer.as_deref(), Some("tok-a"));
    assert_eq!(cred_b.bearer.as_deref(), Some("tok-b"));
}

// ────────────────────────────────────────────────────────────────────────
// 15 — Scope mismatch: tool requires gmail.modify but credential only has
//     gmail.readonly → surfaces scope_mismatch.
// ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn t15_scope_mismatch_returns_error_without_request() {
    let env = env();
    let mock_state = MockState::default();
    let (base, _h) = spawn_mock(mock_state.clone()).await;
    seed_token(
        &env,
        "agentA",
        &base,
        "tok",
        "rt",
        &["https://www.googleapis.com/auth/gmail.readonly"],
    )
    .await;
    let reg = registry_with(vec![Arc::new(GmailSendTool)]);
    let result = reg
        .invoke(
            "gmail.send",
            json!({"to": "x@y", "subject": "s", "body": "b"}),
            CallerKind::Llm,
            &ctx(&env, "agentA"),
        )
        .await
        .unwrap();
    assert!(result.is_error);
    assert_eq!(result.data["reason_code"], "scope_mismatch");
    // Never issued an upstream call.
    assert!(mock_state.history.lock().unwrap().is_empty());
}
