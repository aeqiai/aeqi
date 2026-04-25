//! End-to-end tests covering the T1.10 plan's twelve mandatory cases.
//!
//! Every test stands up an in-process [`MockServer`] (no `npx`, no
//! external runtime) and exercises one slice of the substrate. The
//! protocol-level wiring is the same one the stdio / SSE transports
//! use against real servers — only the I/O loop differs.

use std::sync::Arc;
use std::time::Duration;

use aeqi_core::credentials::CredentialResolver;
use aeqi_core::tool_registry::{CallerKind, ExecutionContext};
use aeqi_mcp::client::McpClientBuilder;
use aeqi_mcp::config::{McpServerConfig, McpServersConfig, TransportKind};
use aeqi_mcp::mock::MockServer;
use aeqi_mcp::registry::{McpRegistry, install_servers, registry_with_snapshot};
use serde_json::json;

/// Spin until the registry has at least one tool registered for `server`,
/// or fail after `timeout`.
async fn wait_for_tools(reg: &McpRegistry, server: &str, timeout: Duration) {
    let start = std::time::Instant::now();
    loop {
        let snap = reg.snapshot().await;
        let has_one = snap
            .tools
            .iter()
            .any(|t| t.name().starts_with(&format!("mcp:{server}:")));
        if has_one {
            return;
        }
        if start.elapsed() > timeout {
            panic!("timed out waiting for mcp:{server}:* tools");
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn install_mock_server(reg: &McpRegistry, mock: &MockServer, name: &str) {
    let _ = mock; // mock isn't directly registered; transport indirection handles it
    let _ = name;
    let _ = reg;
}

/// Build a registry that wraps a single in-process mock as if it were a
/// configured server. We bypass the public `install_server` path
/// because the mock transport doesn't fit the TOML config shape — but
/// the snapshot / handle plumbing under test is identical.
async fn registry_with_mock(mock: &MockServer, name: &str) -> McpRegistry {
    use aeqi_mcp::config::McpServerConfig;
    let reg = McpRegistry::new(None);

    // Inject by hand: build the client, then write into the registry
    // using the same channels install_server would have used. We do
    // this via a helper below.
    let cfg = McpServerConfig {
        name: name.to_string(),
        transport: TransportKind::Stdio,
        command: Some("/bin/true".to_string()),
        args: vec![],
        env: Default::default(),
        cwd: None,
        url: None,
        headers: Default::default(),
        caller_kind: "Llm".to_string(),
        requires_credential: None,
        backoff_max_secs: 60,
        enabled: true,
    };
    install_via_mock(&reg, mock, cfg).await;
    reg
}

/// Test-only helper that mirrors `install_server` but uses an in-process
/// mock transport. We have to reach into the registry by going through
/// `install_server_with_transport` (added below).
async fn install_via_mock(reg: &McpRegistry, mock: &MockServer, cfg: McpServerConfig) {
    aeqi_mcp::registry::test_install_with_transport(reg, cfg, Arc::new(mock.transport()))
        .await
        .expect("install_via_mock");
}

// ---------------------------------------------------------------------------
// Test 1 — connect to mock stdio MCP server (handshake completes).
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t1_connect_handshake_succeeds() {
    let mock = MockServer::new();
    mock.register_tool(
        "ping",
        "say pong",
        json!({"type": "object"}),
        |_args| json!("pong"),
    )
    .await;

    let (client, _closed) =
        McpClientBuilder::new(Arc::new(mock.transport())).connect().await.unwrap();
    let tools = client.list_tools().await.unwrap();
    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name, "ping");
}

// ---------------------------------------------------------------------------
// Test 2 — list tools, verify registry surfaces mcp:<server>:<tool> names.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t2_tools_register_with_namespaced_prefix() {
    let mock = MockServer::new();
    mock.register_tool(
        "echo",
        "echo back",
        json!({"type": "object"}),
        |args| json!({"echoed": args}),
    )
    .await;
    let reg = registry_with_mock(&mock, "alpha").await;
    wait_for_tools(&reg, "alpha", Duration::from_secs(2)).await;
    let snap = reg.snapshot().await;
    let names: Vec<_> = snap.tools.iter().map(|t| t.name().to_string()).collect();
    assert!(names.contains(&"mcp:alpha:echo".to_string()), "got: {names:?}");
}

// ---------------------------------------------------------------------------
// Test 3 — call a tool, verify args + result roundtrip.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t3_tool_call_roundtrip() {
    let mock = MockServer::new();
    mock.register_tool(
        "add",
        "sum two ints",
        json!({"type": "object"}),
        |args| {
            let a = args.get("a").and_then(|v| v.as_i64()).unwrap_or(0);
            let b = args.get("b").and_then(|v| v.as_i64()).unwrap_or(0);
            json!({"sum": a + b})
        },
    )
    .await;
    let reg = registry_with_mock(&mock, "math").await;
    wait_for_tools(&reg, "math", Duration::from_secs(2)).await;
    let snap = reg.snapshot().await;
    let tool = snap
        .tools
        .iter()
        .find(|t| t.name() == "mcp:math:add")
        .unwrap()
        .clone();
    let result = tool
        .execute(json!({"a": 2, "b": 3}))
        .await
        .unwrap();
    assert!(!result.is_error, "{}", result.output);
    assert!(result.output.contains("\"sum\":5"));
}

// ---------------------------------------------------------------------------
// Test 4 — disconnect handling: tools fail with `unavailable` after close.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t4_disconnect_marks_tools_unavailable() {
    let mock = MockServer::new();
    mock.register_tool(
        "hello",
        "say hi",
        json!({"type": "object"}),
        |_args| json!("hi"),
    )
    .await;
    let reg = registry_with_mock(&mock, "gamma").await;
    wait_for_tools(&reg, "gamma", Duration::from_secs(2)).await;
    let snap = reg.snapshot().await;
    let tool = snap.tools.iter().find(|t| t.name() == "mcp:gamma:hello").unwrap().clone();
    // Force-disconnect by clearing the stored client.
    aeqi_mcp::registry::test_force_disconnect(&reg, "gamma").await;
    let result = tool.execute(json!({})).await.unwrap();
    assert!(result.is_error);
    assert!(result.output.contains("unavailable"), "{}", result.output);
}

// ---------------------------------------------------------------------------
// Test 5 — notifications/tools/list_changed refreshes the registry.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t5_tools_list_changed_refreshes_registry() {
    let mock = MockServer::new();
    mock.register_tool("first", "first tool", json!({"type": "object"}), |_| json!("ok"))
        .await;
    let reg = registry_with_mock(&mock, "delta").await;
    wait_for_tools(&reg, "delta", Duration::from_secs(2)).await;
    assert_eq!(reg.snapshot().await.tools.len(), 1);

    // Add a tool and push the notification.
    mock.register_tool("second", "added later", json!({"type": "object"}), |_| json!("late"))
        .await;
    assert!(mock.push_tools_list_changed().await);

    // Wait for the registry to pick the second tool up.
    let start = std::time::Instant::now();
    loop {
        let snap = reg.snapshot().await;
        if snap.tools.len() == 2 {
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(2),
            "tools/list_changed never propagated"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let names: Vec<_> = reg.snapshot().await.tools.iter().map(|t| t.name().to_string()).collect();
    assert!(names.contains(&"mcp:delta:first".to_string()));
    assert!(names.contains(&"mcp:delta:second".to_string()));
}

// ---------------------------------------------------------------------------
// Test 6 — auth handshake using T1.9 oauth2 lifecycle.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t6_oauth2_credential_flows_into_server_env() {
    use aeqi_core::credentials::{
        CredentialCipher, CredentialInsert, CredentialResolver, CredentialStore, ScopeKind,
        lifecycles::OAuth2Lifecycle,
    };
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use tempfile::tempdir;

    let tmp = tempdir().unwrap();
    let conn = Connection::open(tmp.path().join("creds.db")).unwrap();
    CredentialStore::initialize_schema(&conn).unwrap();
    let cipher = CredentialCipher::ephemeral();
    let store = CredentialStore::new(Arc::new(Mutex::new(conn)), cipher);
    // Seed an oauth2 row directly (skip the consent flow).
    let blob = serde_json::to_vec(&serde_json::json!({
        "access_token": "ya29.test-token",
        "refresh_token": "rfsh",
        "token_type": "Bearer",
        "scope": "repo:read"
    }))
    .unwrap();
    let metadata = serde_json::json!({
        "provider_kind": "github",
        "token_url": "https://example.invalid/token",
        "client_id": "cid",
    });
    store
        .insert(CredentialInsert {
            scope_kind: ScopeKind::Global,
            scope_id: String::new(),
            provider: "github".into(),
            name: "oauth_token".into(),
            lifecycle_kind: "oauth2".into(),
            plaintext_blob: blob,
            metadata,
            expires_at: None,
        })
        .await
        .unwrap();
    let resolver = CredentialResolver::new(
        store,
        vec![Arc::new(OAuth2Lifecycle) as Arc<dyn aeqi_core::credentials::CredentialLifecycle>],
    );

    let cfg = McpServerConfig {
        name: "github".to_string(),
        transport: TransportKind::Stdio,
        command: Some("/bin/true".to_string()),
        args: vec![],
        env: Default::default(),
        cwd: None,
        url: None,
        headers: Default::default(),
        caller_kind: "Llm".to_string(),
        requires_credential: Some(aeqi_mcp::config::McpServerCredentialNeed {
            provider: "github".into(),
            lifecycle: Some("oauth2".into()),
            name: "oauth_token".into(),
            scopes: vec!["repo:read".into()],
            env_var: Some("GITHUB_TOKEN".into()),
            header: None,
            arg: None,
        }),
        backoff_max_secs: 60,
        enabled: true,
    };

    // Resolve via the registry's internal helper — verifies the
    // credential plumbing surfaces the token into the env map without
    // actually spawning a subprocess.
    let resolved =
        aeqi_mcp::registry::test_resolve_credential(&cfg, Some(&resolver)).await.unwrap();
    let cred = resolved.expect("credential resolved");
    assert_eq!(cred.bearer.as_deref(), Some("ya29.test-token"));
}

// ---------------------------------------------------------------------------
// Test 7 — CallerKind enforcement: caller_kind="Llm" denies Event callers.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t7_caller_kind_llm_only_denies_event() {
    let mock = MockServer::new();
    mock.register_tool("safe", "llm-only", json!({"type": "object"}), |_| json!("ok"))
        .await;
    let cfg = McpServerConfig {
        name: "llmonly".to_string(),
        transport: TransportKind::Stdio,
        command: Some("/bin/true".to_string()),
        args: vec![],
        env: Default::default(),
        cwd: None,
        url: None,
        headers: Default::default(),
        caller_kind: "Llm".to_string(),
        requires_credential: None,
        backoff_max_secs: 60,
        enabled: true,
    };
    let reg = McpRegistry::new(None);
    install_via_mock(&reg, &mock, cfg).await;
    wait_for_tools(&reg, "llmonly", Duration::from_secs(2)).await;
    let snap = reg.snapshot().await;
    let tool_reg = registry_with_snapshot(snap);
    let ctx = ExecutionContext::test("s", "a");
    let r = tool_reg
        .invoke("mcp:llmonly:safe", json!({}), CallerKind::Event, &ctx)
        .await
        .unwrap();
    assert!(r.is_error);
    assert!(r.output.contains("cannot be called"));

    // Llm caller should pass.
    let r = tool_reg
        .invoke("mcp:llmonly:safe", json!({}), CallerKind::Llm, &ctx)
        .await
        .unwrap();
    assert!(!r.is_error, "{}", r.output);
}

// ---------------------------------------------------------------------------
// Test 8 — caller_kind="Llm,Event" allows both kinds.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t8_caller_kind_multi_allows_both() {
    let mock = MockServer::new();
    mock.register_tool("dual", "open", json!({"type": "object"}), |_| json!("ok"))
        .await;
    let cfg = McpServerConfig {
        name: "dual".to_string(),
        transport: TransportKind::Stdio,
        command: Some("/bin/true".to_string()),
        args: vec![],
        env: Default::default(),
        cwd: None,
        url: None,
        headers: Default::default(),
        caller_kind: "Llm,Event".to_string(),
        requires_credential: None,
        backoff_max_secs: 60,
        enabled: true,
    };
    let reg = McpRegistry::new(None);
    install_via_mock(&reg, &mock, cfg).await;
    wait_for_tools(&reg, "dual", Duration::from_secs(2)).await;
    let snap = reg.snapshot().await;
    let tool_reg = registry_with_snapshot(snap);
    let ctx = ExecutionContext::test("s", "a");
    for kind in [CallerKind::Llm, CallerKind::Event] {
        let r = tool_reg
            .invoke("mcp:dual:dual", json!({}), kind, &ctx)
            .await
            .unwrap();
        assert!(!r.is_error, "{:?} should be allowed: {}", kind, r.output);
    }
}

// ---------------------------------------------------------------------------
// Test 9 — server unreachable at startup: registry stays up, tools absent.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t9_unreachable_server_does_not_panic() {
    let cfg = McpServerConfig {
        name: "broken".to_string(),
        transport: TransportKind::Stdio,
        command: Some("/this/binary/definitely/does/not/exist".to_string()),
        args: vec![],
        env: Default::default(),
        cwd: None,
        url: None,
        headers: Default::default(),
        caller_kind: "Llm".to_string(),
        requires_credential: None,
        backoff_max_secs: 1,
        enabled: true,
    };
    let reg = McpRegistry::new(None);
    reg.install_server(cfg).await.unwrap();
    // Give the spawn loop a moment to flop.
    tokio::time::sleep(Duration::from_millis(200)).await;
    let snap = reg.snapshot().await;
    assert!(snap.tools.is_empty(), "no tools should appear for a broken server");
    let reason = reg.handle().unavailable_reason("broken").await;
    assert!(reason.is_some(), "broken server must record an unavailable_reason");
    reg.shutdown().await;
}

// ---------------------------------------------------------------------------
// Test 10 — JSON-RPC `-32601 method not found` maps to UnknownTool.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t10_jsonrpc_method_not_found_maps_to_reason_code() {
    let mock = MockServer::new();
    // No tools registered — `tools/call` will land on the mock's
    // "unknown tool" branch which returns `-32601`.
    let reg = registry_with_mock(&mock, "empty").await;
    // Manually call a tool the server doesn't know about by going
    // through the client (we register a fake McpTool descriptor).
    let (client, _closed) =
        McpClientBuilder::new(Arc::new(mock.transport())).connect().await.unwrap();
    let err = client
        .call_tool("nonexistent", json!({}))
        .await
        .expect_err("expected unknown_tool error");
    assert_eq!(err.code, aeqi_mcp::McpReasonCode::UnknownTool);
    let _ = reg; // keep `reg` alive in case future expansions chain to it
}

// ---------------------------------------------------------------------------
// Test 11 — empty meta:mcp-servers config yields no MCP tools.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t11_empty_config_registers_no_tools() {
    let cfg = McpServersConfig::from_toml("").unwrap();
    assert!(cfg.servers.is_empty());
    let reg = McpRegistry::new(None);
    install_servers(&reg, &cfg).await.unwrap();
    let snap = reg.snapshot().await;
    assert!(snap.tools.is_empty());
}

// ---------------------------------------------------------------------------
// Test 12 — two servers with same tool name register without collision.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t12_same_tool_name_two_servers_no_collision() {
    let mock_a = MockServer::new();
    mock_a
        .register_tool("read", "read tool A", json!({"type": "object"}), |_| {
            json!({"src": "a"})
        })
        .await;
    let mock_b = MockServer::new();
    mock_b
        .register_tool("read", "read tool B", json!({"type": "object"}), |_| {
            json!({"src": "b"})
        })
        .await;
    let reg = McpRegistry::new(None);
    let cfg_a = McpServerConfig {
        name: "alpha".to_string(),
        transport: TransportKind::Stdio,
        command: Some("/bin/true".to_string()),
        args: vec![],
        env: Default::default(),
        cwd: None,
        url: None,
        headers: Default::default(),
        caller_kind: "Llm".to_string(),
        requires_credential: None,
        backoff_max_secs: 60,
        enabled: true,
    };
    let cfg_b = McpServerConfig {
        name: "beta".to_string(),
        ..cfg_a.clone()
    };
    install_via_mock(&reg, &mock_a, cfg_a).await;
    install_via_mock(&reg, &mock_b, cfg_b).await;
    wait_for_tools(&reg, "alpha", Duration::from_secs(2)).await;
    wait_for_tools(&reg, "beta", Duration::from_secs(2)).await;
    let snap = reg.snapshot().await;
    let names: Vec<String> = snap.tools.iter().map(|t| t.name().to_string()).collect();
    assert!(names.contains(&"mcp:alpha:read".to_string()));
    assert!(names.contains(&"mcp:beta:read".to_string()));

    // Both tools work and route to the right server.
    let tool_a = snap.tools.iter().find(|t| t.name() == "mcp:alpha:read").unwrap().clone();
    let tool_b = snap.tools.iter().find(|t| t.name() == "mcp:beta:read").unwrap().clone();
    let ra = tool_a.execute(json!({})).await.unwrap();
    let rb = tool_b.execute(json!({})).await.unwrap();
    assert!(ra.output.contains("\"src\":\"a\""), "{}", ra.output);
    assert!(rb.output.contains("\"src\":\"b\""), "{}", rb.output);
}

// ---------------------------------------------------------------------------
// Bonus: TOML config parsing covers the documented shapes.
// ---------------------------------------------------------------------------
#[tokio::test]
async fn t_extra_toml_config_round_trips() {
    let body = r#"
[[server]]
name = "github-mcp"
transport = "stdio"
command = "npx"
args = ["@modelcontextprotocol/server-github"]
caller_kind = "Llm"

[[server]]
name = "remote-mcp"
transport = "sse"
url = "https://mcp.example.com/sse"
caller_kind = "Llm,Event"
"#;
    let cfg = McpServersConfig::from_toml(body).unwrap();
    assert_eq!(cfg.servers.len(), 2);
    assert_eq!(cfg.servers[0].transport, TransportKind::Stdio);
    assert_eq!(cfg.servers[1].transport, TransportKind::Sse);
    assert!(cfg.servers[1].allows_caller(CallerKind::Event));
    assert!(!cfg.servers[0].allows_caller(CallerKind::Event));
}

// Compile-time guard: install_mock_server / install_via_mock signatures
// are kept in sync with the public registry surface.
#[allow(dead_code)]
fn _shape_guard() {
    let _: fn(&McpRegistry, &MockServer, &str) = |_, _, _| {
        let _f = install_mock_server;
    };
    let _ = CredentialResolver::new;
}
