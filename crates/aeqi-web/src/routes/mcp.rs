use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::io::Write as _;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use crate::{auth::UserScope, extractors::Scope, server::AppState};
use aeqi_core::credentials::{
    CredentialCipher, CredentialLifecycle, CredentialResolver, CredentialStore, ResolutionScope,
    lifecycles::{
        DeviceSessionLifecycle, GithubAppLifecycle, OAuth2Lifecycle, ServiceAccountLifecycle,
        StaticSecretLifecycle,
    },
};
use aeqi_core::tool_registry::{CallerKind, ExecutionContext, ToolRegistry};
use aeqi_core::traits::Tool;

#[derive(Debug, Deserialize)]
struct McpRequest {
    jsonrpc: String,
    id: Option<serde_json::Value>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    result: Option<serde_json::Value>,
    #[serde(default)]
    error: Option<serde_json::Value>,
    #[serde(default)]
    params: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct McpResponse {
    jsonrpc: String,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
struct McpActorContext {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trust_id: Option<String>,
    #[serde(default)]
    roles: Vec<String>,
    #[serde(default)]
    grants: Vec<String>,
    source: String,
}

#[derive(Debug, Clone)]
struct McpHttpContext {
    actor: McpActorContext,
    allowed_roots: Vec<String>,
    agent: Option<String>,
    agent_id: Option<String>,
    role_id: Option<String>,
}

const MCP_PROTOCOL_LATEST: &str = "2025-06-18";
const MCP_PROTOCOL_FALLBACK: &str = "2025-03-26";
const MCP_PROTOCOL_LEGACY: &str = "2024-11-05";

pub fn routes() -> Router<AppState> {
    Router::new().route("/mcp", post(mcp_post).get(mcp_get).delete(mcp_delete))
}

async fn mcp_get(headers: HeaderMap) -> Response {
    if !accepts(&headers, "text/event-stream") {
        return StatusCode::NOT_ACCEPTABLE.into_response();
    }

    Response::builder()
        .status(StatusCode::METHOD_NOT_ALLOWED)
        .header(header::ALLOW, "POST")
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({
                "ok": false,
                "error": "server-initiated MCP SSE streams are not supported yet"
            })
            .to_string(),
        ))
        .unwrap_or_else(|_| StatusCode::METHOD_NOT_ALLOWED.into_response())
}

async fn mcp_delete() -> Response {
    Response::builder()
        .status(StatusCode::METHOD_NOT_ALLOWED)
        .header(header::ALLOW, "POST")
        .body(axum::body::Body::empty())
        .unwrap_or_else(|_| StatusCode::METHOD_NOT_ALLOWED.into_response())
}

async fn mcp_post(
    State(state): State<AppState>,
    Scope(scope): Scope,
    headers: HeaderMap,
    Json(request): Json<McpRequest>,
) -> Response {
    if request.jsonrpc != "2.0" {
        return Json(McpResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id.unwrap_or(serde_json::Value::Null),
            result: None,
            error: Some(serde_json::json!({
                "code": -32600,
                "message": "invalid JSON-RPC version"
            })),
        })
        .into_response();
    }

    if let Err(response) = validate_protocol_header(&headers) {
        return *response;
    }

    if request.method.is_none() {
        if request.id.is_some() || request.result.is_some() || request.error.is_some() {
            return StatusCode::ACCEPTED.into_response();
        }
        return Json(McpResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id.unwrap_or(serde_json::Value::Null),
            result: None,
            error: Some(serde_json::json!({
                "code": -32600,
                "message": "invalid JSON-RPC message"
            })),
        })
        .into_response();
    }

    if request.id.is_none() {
        return StatusCode::ACCEPTED.into_response();
    }

    let ctx = mcp_context(scope.as_ref(), &headers);
    let id = request.id.clone().unwrap_or(serde_json::Value::Null);
    let method = request.method.as_deref().unwrap_or_default();
    let response = match method {
        "initialize" => McpResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(serde_json::json!({
                "protocolVersion": negotiated_protocol(&request.params),
                "capabilities": {"tools": {}},
                "serverInfo": {
                    "name": "aeqi",
                    "version": "5.0.0",
                    "transport": "http",
                    "agent": ctx.agent.as_deref().unwrap_or("default"),
                    "agent_id": ctx.agent_id.as_deref().unwrap_or(""),
                    "role_id": ctx.role_id.as_deref().unwrap_or(""),
                    "actor": ctx.actor,
                    "root": ctx.allowed_roots.first(),
                    "mode": if scope.is_some() { "http_scoped" } else { "self_hosted_local" },
                }
            })),
            error: None,
        },
        "tools/list" => McpResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(serde_json::json!({"tools": tool_defs()})),
            error: None,
        },
        "tools/call" => {
            let tool_name = request
                .params
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            let args = request
                .params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            match call_tool(&state, &ctx, tool_name, args).await {
                Ok(data) => McpResponse {
                    jsonrpc: "2.0".to_string(),
                    id,
                    result: Some(serde_json::json!({
                        "content": [{"type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default()}],
                        "structuredContent": data,
                    })),
                    error: None,
                },
                Err(err) => McpResponse {
                    jsonrpc: "2.0".to_string(),
                    id,
                    result: Some(serde_json::json!({
                        "content": [{"type": "text", "text": format!("Error: {err}")}],
                        "isError": true
                    })),
                    error: None,
                },
            }
        }
        _ => McpResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: None,
            error: Some(serde_json::json!({
                "code": -32601,
                "message": format!("unknown method: {method}"),
            })),
        },
    };

    Json(response).into_response()
}

fn negotiated_protocol(params: &serde_json::Value) -> &'static str {
    match params.get("protocolVersion").and_then(|v| v.as_str()) {
        Some(MCP_PROTOCOL_LATEST) => MCP_PROTOCOL_LATEST,
        Some(MCP_PROTOCOL_FALLBACK) => MCP_PROTOCOL_FALLBACK,
        Some(MCP_PROTOCOL_LEGACY) => MCP_PROTOCOL_LEGACY,
        _ => MCP_PROTOCOL_LATEST,
    }
}

fn validate_protocol_header(headers: &HeaderMap) -> Result<(), Box<Response>> {
    match headers
        .get("mcp-protocol-version")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        None
        | Some(MCP_PROTOCOL_LATEST)
        | Some(MCP_PROTOCOL_FALLBACK)
        | Some(MCP_PROTOCOL_LEGACY) => Ok(()),
        Some(version) => Err(Box::new(
            (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "error": format!("unsupported MCP-Protocol-Version: {version}")
                })),
            )
                .into_response(),
        )),
    }
}

fn accepts(headers: &HeaderMap, media_type: &str) -> bool {
    headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .map(|accept| {
            accept
                .split(',')
                .map(|part| part.split(';').next().unwrap_or("").trim())
                .any(|part| part == media_type || part == "*/*")
        })
        .unwrap_or(false)
}

fn mcp_context(scope: Option<&UserScope>, headers: &HeaderMap) -> McpHttpContext {
    let agent = header_string(headers, "x-aeqi-agent");
    let agent_id = header_string(headers, "x-aeqi-agent-id");
    let role_id = header_string(headers, "x-aeqi-role-id")
        .or_else(|| header_string(headers, "x-aeqi-as-role-id"));
    let allowed_roots = scope.map(|s| s.roots.clone()).unwrap_or_default();
    let trust_id = scope.and_then(|_| allowed_roots.first().cloned());
    let user_id = scope.and_then(|s| s.user_id.clone());

    let actor = McpActorContext {
        kind: if user_id.is_some() {
            "user".to_string()
        } else {
            "local_operator".to_string()
        },
        user_id,
        trust_id,
        roles: Vec::new(),
        grants: if scope.is_none() {
            vec!["*".to_string()]
        } else {
            Vec::new()
        },
        source: if scope.is_some() {
            "http_scoped".to_string()
        } else {
            "self_hosted_local".to_string()
        },
    };

    McpHttpContext {
        actor,
        allowed_roots,
        agent,
        agent_id,
        role_id,
    }
}

fn header_string(headers: &HeaderMap, name: &'static str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

fn apply_actor(ctx: &McpHttpContext, request: &mut serde_json::Value) {
    request["actor"] = serde_json::json!(ctx.actor);
    if let Some(user_id) = ctx.actor.user_id.as_deref() {
        request["caller_user_id"] = serde_json::json!(user_id);
    }
    if let Some(agent_id) = ctx.agent_id.as_deref() {
        request["caller_agent_id"] = serde_json::json!(agent_id);
    }
    if let Some(trust_id) = ctx.actor.trust_id.as_deref() {
        request["caller_entity_id"] = serde_json::json!(trust_id);
    }
}

async fn ipc(
    state: &AppState,
    ctx: &McpHttpContext,
    mut request: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    apply_actor(ctx, &mut request);
    state.ipc.request(&request).await
}

async fn call_tool(
    state: &AppState,
    ctx: &McpHttpContext,
    tool_name: &str,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    match tool_name {
        "me" => Ok(serde_json::json!({
            "ok": true,
            "mode": if ctx.allowed_roots.is_empty() { "self_hosted_local" } else { "http_scoped" },
            "root": ctx.allowed_roots.first(),
            "trust_id": ctx.actor.trust_id,
            "user_id": ctx.actor.user_id,
            "allowed_roots": ctx.allowed_roots,
            "actor": ctx.actor,
            "role_id": ctx.role_id,
            "runtime": {"type": "http"},
        })),
        "ideas" => call_ideas(state, ctx, args).await,
        "quests" => call_quests(state, ctx, args).await,
        "agents" => call_agents(state, ctx, args).await,
        "events" => call_events(state, ctx, args).await,
        "code" => call_code(state, ctx, args).await,
        "browser" => call_browser(state, ctx, args).await,
        "apps" => call_apps(state, ctx, args, "apps").await,
        "integrations" => call_apps(state, ctx, args, "integrations").await,
        _ => anyhow::bail!("unknown tool: {tool_name}"),
    }
}

async fn call_browser(
    state: &AppState,
    ctx: &McpHttpContext,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("capabilities");
    match action {
        "capabilities" | "policy" | "status" => {
            let mut contract = browser_capability_contract();
            contract["actor"] = serde_json::json!(ctx.actor);
            contract["role_id"] = serde_json::json!(ctx.role_id);
            Ok(contract)
        }
        "open" | "screenshot" => {
            let quest_id = required_arg(&args, "quest_id")?;
            let url = required_arg(&args, "url")?;
            validate_browser_request(&args, url)?;
            let agent_id = args
                .get("agent_id")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .or(ctx.agent_id.as_deref())
                .ok_or_else(|| {
                    anyhow::anyhow!(
                        "agent_id is required for browser evidence until TRUST-scoped files land"
                    )
                })?;
            let capture = run_browser_capture(&args)?;
            if !capture.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                anyhow::bail!(
                    "browser capture failed: {}",
                    capture
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown error")
                );
            }
            let evidence =
                upload_browser_evidence(state, ctx, &capture, action, quest_id, agent_id).await?;
            Ok(serde_json::json!({
                "ok": true,
                "action": action,
                "status": "completed",
                "backend": "playwright",
                "quest_id": quest_id,
                "agent_id": agent_id,
                "browser_session_id": uuid::Uuid::new_v4().to_string(),
                "url": url,
                "final_url": capture.get("final_url"),
                "title": capture.get("title"),
                "response_status": capture.get("response_status"),
                "viewport": capture.get("viewport"),
                "text_excerpt": capture.get("text_excerpt"),
                "console_errors": capture.get("console_errors"),
                "request_failures": capture.get("request_failures"),
                "http_failures": capture.get("http_failures"),
                "evidence": evidence,
                "disabled_actions": ["click", "type", "select"],
            }))
        }
        _ => anyhow::bail!(
            "browser action `{action}` is not enabled yet. Enabled actions: capabilities, policy, status, open, screenshot."
        ),
    }
}

fn browser_capability_contract() -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "tool": "browser",
        "status": "playwright_capture_enabled",
        "summary": "AEQI browser execution is defined as a quest-scoped, audited capability. `open` and `screenshot` run a one-shot Playwright capture and store screenshot/snapshot evidence. Mutating page actions stay disabled.",
        "actions": ["capabilities", "policy", "status", "open", "screenshot"],
        "planned_actions": ["click", "type", "select", "wait", "extract", "close"],
        "backend_order": [
            {"id": "playwright", "posture": "default", "reason": "Deterministic local QA and visual validation."},
            {"id": "agent-browser", "posture": "pilot", "reason": "Agent-oriented browser sessions and compact page state, evaluated after the contract lands."},
            {"id": "cloakbrowser", "posture": "optional", "reason": "Special backend for blocked workflows only; not a global default."}
        ],
        "required_controls": [
            "quest_id on every mutable session",
            "actor and role attribution",
            "credential resolution through AEQI scopes",
            "per-action event log",
            "screenshot or snapshot artifacts for inspection",
            "human takeover and stop controls before high-risk actions"
        ],
        "artifact_model": {
            "session": "browser_session_id",
            "event": "browser_action_id",
            "evidence": ["screenshot", "accessibility_snapshot", "dom_snapshot", "network_summary"]
        }
    })
}

fn required_arg<'a>(args: &'a serde_json::Value, name: &str) -> anyhow::Result<&'a str> {
    args.get(name)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow::anyhow!("{name} is required"))
}

fn validate_browser_request(args: &serde_json::Value, url: &str) -> anyhow::Result<()> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        anyhow::bail!("browser url must start with http:// or https://");
    }
    if let Some(backend) = args
        .get("backend")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter(|backend| *backend != "playwright")
    {
        anyhow::bail!("browser backend `{backend}` is not enabled; use `playwright`");
    }
    Ok(())
}

fn run_browser_capture(args: &serde_json::Value) -> anyhow::Result<serde_json::Value> {
    let script = browser_capture_script();
    let repo_root = script
        .parent()
        .and_then(|p| p.parent())
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_path_buf())
        .unwrap_or(std::env::current_dir()?);
    let mut child = Command::new("node")
        .arg(&script)
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("failed to spawn browser runner {}: {e}", script.display()))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("browser runner stdin unavailable"))?;
        stdin.write_all(serde_json::to_string(args)?.as_bytes())?;
    }

    let output = child.wait_with_output()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let parsed: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|e| {
        anyhow::anyhow!("browser runner returned invalid JSON: {e}; stderr={stderr}")
    })?;
    if !output.status.success() && parsed.get("ok").and_then(|v| v.as_bool()) != Some(false) {
        anyhow::bail!("browser runner failed: {stderr}");
    }
    Ok(parsed)
}

fn browser_capture_script() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("AEQI_BROWSER_CAPTURE_SCRIPT") {
        return std::path::PathBuf::from(path);
    }
    if let Ok(root) = std::env::var("AEQI_BROWSER_REPO_ROOT") {
        return std::path::Path::new(&root)
            .join("scripts")
            .join("browser-capture.mjs");
    }
    if let Ok(cwd) = std::env::current_dir() {
        let candidate = cwd.join("scripts").join("browser-capture.mjs");
        if candidate.exists() {
            return candidate;
        }
    }
    if let Ok(exe) = std::env::current_exe()
        && let Some(parent) = exe.parent()
    {
        let candidate = parent.join("scripts").join("browser-capture.mjs");
        if candidate.exists() {
            return candidate;
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let candidate = std::path::PathBuf::from(home)
            .join("aeqi")
            .join("scripts")
            .join("browser-capture.mjs");
        if candidate.exists() {
            return candidate;
        }
    }
    std::path::PathBuf::from("scripts/browser-capture.mjs")
}

async fn upload_browser_evidence(
    state: &AppState,
    ctx: &McpHttpContext,
    capture: &serde_json::Value,
    action: &str,
    quest_id: &str,
    agent_id: &str,
) -> anyhow::Result<serde_json::Value> {
    let slug = browser_evidence_slug(capture.get("final_url").and_then(|v| v.as_str()));
    let uploaded_by = ctx
        .actor
        .user_id
        .as_deref()
        .unwrap_or(ctx.actor.kind.as_str());
    let screenshot_b64 = capture
        .get("screenshot_b64")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("browser runner omitted screenshot_b64"))?;
    let snapshot_b64 = capture
        .get("snapshot_b64")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("browser runner omitted snapshot_b64"))?;

    let screenshot = ipc(
        state,
        ctx,
        serde_json::json!({
            "cmd": "files_upload",
            "agent_id": agent_id,
            "name": format!("browser-{action}-{quest_id}-{slug}.png"),
            "mime": "image/png",
            "content_b64": screenshot_b64,
            "uploaded_by": uploaded_by,
            "scope": "global",
        }),
    )
    .await?;
    let snapshot = ipc(
        state,
        ctx,
        serde_json::json!({
            "cmd": "files_upload",
            "agent_id": agent_id,
            "name": format!("browser-{action}-{quest_id}-{slug}.json"),
            "mime": "application/json",
            "content_b64": snapshot_b64,
            "uploaded_by": uploaded_by,
            "scope": "global",
        }),
    )
    .await?;
    require_browser_upload_ok(&screenshot, "screenshot")?;
    require_browser_upload_ok(&snapshot, "snapshot")?;
    Ok(serde_json::json!({
        "kind": "quest_browser_evidence",
        "screenshot": screenshot,
        "snapshot": snapshot,
    }))
}

fn require_browser_upload_ok(upload: &serde_json::Value, label: &str) -> anyhow::Result<()> {
    if upload.get("ok").and_then(|v| v.as_bool()) == Some(true) {
        return Ok(());
    }
    anyhow::bail!("browser {label} upload failed: {upload}")
}

fn browser_evidence_slug(url: Option<&str>) -> String {
    let raw = url.unwrap_or("capture");
    let mut slug = String::new();
    let mut last_dash = false;
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            slug.push('-');
            last_dash = true;
        }
    }
    slug.trim_matches('-').chars().take(64).collect()
}

async fn call_apps(
    state: &AppState,
    ctx: &McpHttpContext,
    args: serde_json::Value,
    surface: &str,
) -> anyhow::Result<serde_json::Value> {
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("list_tools");
    match action {
        "catalog" | "list_apps" => {
            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let catalog = integration_catalog(provider);
            Ok(serde_json::json!({
                "ok": true,
                "count": catalog.len(),
                "apps": catalog,
            }))
        }
        "list_tools" => {
            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty());
            let tools = integration_tools()
                .into_iter()
                .filter_map(|tool| {
                    let spec = tool.spec();
                    let inferred_provider = provider_for_integration_tool(&spec.name);
                    if provider.is_some() && provider != inferred_provider {
                        return None;
                    }
                    Some(serde_json::json!({
                        "provider": inferred_provider,
                        "name": spec.name,
                        "description": spec.description,
                        "input_schema": spec.input_schema,
                    }))
                })
                .collect::<Vec<_>>();
            Ok(serde_json::json!({
                "ok": true,
                "count": tools.len(),
                "tools": tools,
            }))
        }
        "call" => {
            let tool_name = args
                .get("tool")
                .or_else(|| args.get("tool_name"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| anyhow::anyhow!("tool is required for {surface}.call"))?;
            let provider = args
                .get("provider")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .or_else(|| provider_for_integration_tool(tool_name))
                .ok_or_else(|| {
                    anyhow::anyhow!("provider is required when the tool name cannot be inferred")
                })?;
            let tool_args = args
                .get("arguments")
                .or_else(|| args.get("args"))
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));

            let role_auth = authorize_app_role(state, ctx, &args, provider, tool_name)?;
            let registry = ToolRegistry::new(integration_tools());
            let store = open_mcp_credential_store(state)?;
            let resolver = build_mcp_credential_resolver(store);
            let credential_scope =
                credential_resolution_scope(ctx, &args, role_auth.role_id.as_deref());
            let exec_ctx = ExecutionContext {
                session_id: args
                    .get("session_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("mcp-http")
                    .to_string(),
                agent_id: credential_scope.agent_id.clone().unwrap_or_default(),
                caller_role_id: role_auth.role_id.clone(),
                credential_resolver: Some(resolver),
                credential_scope,
                ..Default::default()
            };

            let result = registry
                .invoke(tool_name, tool_args, CallerKind::System, &exec_ctx)
                .await?;
            Ok(serde_json::json!({
                "ok": !result.is_error,
                "provider": provider,
                "tool": tool_name,
                "role_id": role_auth.role_id,
                "grants": role_auth.grants,
                "output": result.output,
                "data": result.data,
                "is_error": result.is_error,
            }))
        }
        other => anyhow::bail!("unknown {surface} action: {other}"),
    }
}

async fn call_ideas(
    state: &AppState,
    ctx: &McpHttpContext,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("search");
    match action {
        "store" => {
            let mut req = args.clone();
            req["cmd"] = serde_json::json!("store_idea");
            ipc(state, ctx, req).await
        }
        "search" => {
            let mut req = serde_json::json!({
                "cmd": "search_ideas",
                "query": args.get("query").and_then(|v| v.as_str()).unwrap_or(""),
                "top_k": args.get("limit").and_then(|v| v.as_u64()).unwrap_or(5),
            });
            copy_fields(
                &args,
                &mut req,
                &[
                    "agent_id",
                    "tags",
                    "explain",
                    "route_hint",
                    "include_superseded",
                ],
            );
            ipc(state, ctx, req).await
        }
        "update" => {
            let mut req = serde_json::json!({
                "cmd": "update_idea",
                "id": args.get("id").and_then(|v| v.as_str()).unwrap_or(""),
            });
            copy_fields(&args, &mut req, &["name", "content", "tags"]);
            ipc(state, ctx, req).await
        }
        "delete" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "delete_idea",
                    "id": args.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                }),
            )
            .await
        }
        "link" => {
            let mut req = args.clone();
            req["cmd"] = serde_json::json!("link_idea");
            ipc(state, ctx, req).await
        }
        "feedback" => {
            let mut req = serde_json::json!({
                "cmd": "feedback_idea",
                "id": args.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "signal": args.get("signal").and_then(|v| v.as_str()).unwrap_or(""),
            });
            copy_fields(&args, &mut req, &["agent_id", "weight", "note"]);
            ipc(state, ctx, req).await
        }
        "walk" => {
            let mut req = serde_json::json!({
                "cmd": "walk_ideas",
                "from": args.get("from").and_then(|v| v.as_str()).unwrap_or(""),
            });
            copy_fields(
                &args,
                &mut req,
                &[
                    "agent_id",
                    "max_hops",
                    "relations",
                    "strength_threshold",
                    "limit",
                ],
            );
            ipc(state, ctx, req).await
        }
        _ => anyhow::bail!("unknown ideas action: {action}"),
    }
}

async fn call_quests(
    state: &AppState,
    ctx: &McpHttpContext,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("list");
    match action {
        "create" => {
            let req = quests_create_ipc_request(&args, default_mcp_project(state));
            ipc(state, ctx, req).await
        }
        "list" => {
            let req = quests_list_ipc_request(&args, default_mcp_project(state));
            ipc(state, ctx, req).await
        }
        "show" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "get_quest",
                    "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(default_mcp_project(state)),
                }),
            )
            .await
        }
        "update" => {
            let req = quests_update_ipc_request(&args, default_mcp_project(state));
            ipc(state, ctx, req).await
        }
        "close" => {
            let req = quests_close_ipc_request(&args);
            ipc(state, ctx, req).await
        }
        "cancel" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "update_quest",
                    "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(default_mcp_project(state)),
                    "status": "cancelled",
                    "reason": args.get("reason").and_then(|v| v.as_str()).unwrap_or("Cancelled"),
                }),
            )
            .await
        }
        "attach_github_issue" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "attach_github_issue",
                    "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "url": args.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                }),
            )
            .await
        }
        _ => anyhow::bail!("unknown quests action: {action}"),
    }
}

async fn call_agents(
    state: &AppState,
    ctx: &McpHttpContext,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("list");
    match action {
        "get" => {
            let agent = args
                .get("agent")
                .and_then(|v| v.as_str())
                .or(ctx.agent.as_deref())
                .unwrap_or("");
            let mut result = ipc(
                state,
                ctx,
                serde_json::json!({"cmd": "agent_info", "name": agent}),
            )
            .await?;
            if let Ok(context) = ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "trigger_event",
                    "agent": agent,
                    "pattern": "session:start",
                    "record_fire": false,
                }),
            )
            .await
                && let Some(system_prompt) = context.get("system_prompt").cloned()
            {
                result["context"] = system_prompt;
            }
            Ok(result)
        }
        "hire" => {
            let mut req = serde_json::json!({
                "cmd": "agent_spawn",
                "template": args.get("template").and_then(|v| v.as_str()).unwrap_or(""),
            });
            copy_fields(&args, &mut req, &["parent_agent_id"]);
            ipc(state, ctx, req).await
        }
        "retire" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "agent_set_status",
                    "name": args.get("agent").and_then(|v| v.as_str()).unwrap_or(""),
                    "status": "retired",
                }),
            )
            .await
        }
        "list" => {
            let mut req = serde_json::json!({"cmd": "agents_registry"});
            copy_fields(&args, &mut req, &["status"]);
            ipc(state, ctx, req).await
        }
        "projects" => Ok(serde_json::json!({
            "ok": true,
            "projects": state.mcp_projects.iter().map(|p| serde_json::json!({
                "name": p.name,
                "prefix": p.prefix,
                "repo": p.repo,
            })).collect::<Vec<_>>()
        })),
        _ => anyhow::bail!("unknown agents action: {action}"),
    }
}

async fn call_events(
    state: &AppState,
    ctx: &McpHttpContext,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("list");
    match action {
        "create" => {
            let mut req = serde_json::json!({
                "cmd": "create_event",
                "agent": args.get("agent").and_then(|v| v.as_str()).or(ctx.agent.as_deref()).unwrap_or(""),
                "name": args.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                "pattern": event_pattern(&args, "session:start"),
            });
            copy_fields(
                &args,
                &mut req,
                &["agent_id", "cooldown_secs", "tool_calls"],
            );
            ipc(state, ctx, req).await
        }
        "list" => {
            let mut req = serde_json::json!({"cmd": "list_events"});
            if let Some(agent) = args.get("agent").cloned() {
                req["agent"] = agent;
            } else if let Some(agent_id) = args.get("agent_id").cloned() {
                req["agent_id"] = agent_id;
            } else {
                default_agent_name(ctx, &mut req);
            }
            ipc(state, ctx, req).await
        }
        "enable" | "disable" => {
            ipc(
                state,
                ctx,
                events_update_ipc_request(&args, action == "enable"),
            )
            .await
        }
        "delete" => ipc(state, ctx, events_delete_ipc_request(&args)).await,
        "trigger" => ipc(state, ctx, events_trigger_ipc_request(&args, ctx)).await,
        "trace" => {
            if let Some(invocation_id) = args.get("invocation_id").and_then(|v| v.as_i64()) {
                ipc(
                    state,
                    ctx,
                    serde_json::json!({"cmd": "trace_events", "invocation_id": invocation_id}),
                )
                .await
            } else {
                ipc(
                    state,
                    ctx,
                    serde_json::json!({
                        "cmd": "trace_events",
                        "session_id": args.get("session_id").and_then(|v| v.as_str()).unwrap_or(""),
                        "limit": args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50),
                    }),
                )
                .await
            }
        }
        _ => anyhow::bail!("unknown events action: {action}"),
    }
}

async fn call_code(
    state: &AppState,
    _ctx: &McpHttpContext,
    args: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let project_arg = args.get("project").and_then(|v| v.as_str()).unwrap_or("");
    let project = if project_arg.is_empty() {
        state
            .mcp_projects
            .first()
            .map(|p| p.name.as_str())
            .unwrap_or("code")
            .to_string()
    } else {
        project_arg.to_string()
    };
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("stats");
    let graph_dir = state.data_dir.join("codegraph");
    std::fs::create_dir_all(&graph_dir)?;
    let db_path = graph_dir.join(format!("{project}.db"));

    match action {
        "index" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let repo = resolve_code_repo_path(&args, &state.mcp_projects, &project, Some(&store))?
                .ok_or_else(|| code_project_not_found(&project))?;
            let result = aeqi_graph::Indexer::new().index(&repo, &store)?;
            store.set_meta("repo_path", &repo.to_string_lossy())?;
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
                "repo_path": repo.to_string_lossy(),
                "result": result.to_string(),
                "files": result.files_parsed,
                "nodes": result.nodes,
                "edges": result.edges,
                "communities": result.communities,
                "processes": result.processes,
                "unresolved": result.unresolved,
            }))
        }
        "search" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let results = store.search_nodes(
                args.get("query").and_then(|v| v.as_str()).unwrap_or(""),
                args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize,
            )?;
            Ok(serde_json::json!({"ok": true, "count": results.len(), "nodes": results}))
        }
        "benchmark" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
            let min_recall = args
                .get("min_recall")
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0) as f32;
            let cases = parse_code_benchmark_cases(&args, limit)?;
            let report = aeqi_graph::run_search_benchmark(&store, &cases, min_recall)?;
            Ok(serde_json::json!({
                "ok": report.passed,
                "project": project,
                "report": report,
            }))
        }
        "context" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let ctx = store.context(args.get("node_id").and_then(|v| v.as_str()).unwrap_or(""))?;
            Ok(serde_json::json!({
                "ok": true,
                "node": ctx.node,
                "callers": ctx.callers,
                "callees": ctx.callees,
                "implementors": ctx.implementors,
                "incoming_edges": ctx.incoming_count,
                "outgoing_edges": ctx.outgoing_count,
            }))
        }
        "impact" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let node_id = args.get("node_id").and_then(|v| v.as_str()).unwrap_or("");
            let entries = store.impact(
                &[node_id],
                args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as u32,
            )?;
            Ok(serde_json::json!({
                "ok": true,
                "source": node_id,
                "affected_count": entries.len(),
                "affected": entries.iter().map(|e| serde_json::json!({"node": e.node, "depth": e.depth})).collect::<Vec<_>>(),
            }))
        }
        "file" => {
            let file_path = args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let nodes = store.nodes_in_file(file_path)?;
            Ok(
                serde_json::json!({"ok": true, "file": file_path, "count": nodes.len(), "nodes": nodes}),
            )
        }
        "stats" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let stats = store.stats()?;
            let dirty_files = graph_dirty_files(&store)?;
            let repo_path =
                resolve_code_repo_path(&args, &state.mcp_projects, &project, Some(&store))
                    .ok()
                    .flatten();
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
                "repo_path": repo_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                "nodes": stats.node_count,
                "edges": stats.edge_count,
                "files": stats.file_count,
                "indexed_at": store.get_meta("indexed_at")?.unwrap_or_default(),
                "last_commit": store.get_meta("last_commit")?.unwrap_or_default(),
                "dirty_files": dirty_files.len(),
                "dirty_file_paths": dirty_files,
            }))
        }
        "health" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let repo = resolve_code_repo_path(&args, &state.mcp_projects, &project, Some(&store))?
                .ok_or_else(|| code_project_not_found(&project))?;
            let health = aeqi_graph::Indexer::new().health(&repo, &store)?;
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
                "repo_path": repo.to_string_lossy(),
                "health": health,
            }))
        }
        "audit" => code_graph_audit_report(&state.data_dir, &state.mcp_projects, &args),
        "diff_impact" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let repo = resolve_code_repo_path(&args, &state.mcp_projects, &project, Some(&store))?
                .ok_or_else(|| code_project_not_found(&project))?;
            let impact = aeqi_graph::Indexer::new().diff_impact(
                &repo,
                &store,
                args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as u32,
            )?;
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
                "repo_path": repo.to_string_lossy(),
                "changed_files": impact.changed_files,
                "changed_symbols": impact.changed_symbols.iter().map(|s| {
                    serde_json::json!({"name": s.name, "label": s.label, "file": s.file_path, "line": s.start_line})
                }).collect::<Vec<_>>(),
                "affected_count": impact.affected.len(),
                "affected": impact.affected.iter().map(|e| {
                    serde_json::json!({"name": e.node.name, "label": e.node.label, "file": e.node.file_path, "depth": e.depth})
                }).collect::<Vec<_>>(),
            }))
        }
        "file_summary" => {
            let file_path = args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            Ok(serde_json::json!({
                "ok": true,
                "file": file_path,
                "summary": store.file_summary(file_path)?,
            }))
        }
        "incremental" => {
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let repo = resolve_code_repo_path(&args, &state.mcp_projects, &project, Some(&store))?
                .ok_or_else(|| code_project_not_found(&project))?;
            let result = aeqi_graph::Indexer::new().index_incremental(&repo, &store)?;
            store.set_meta("repo_path", &repo.to_string_lossy())?;
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
                "repo_path": repo.to_string_lossy(),
                "result": result.to_string(),
                "files": result.files_parsed,
                "parse_errors": result.parse_errors,
                "nodes": result.nodes,
                "edges": result.edges,
                "unresolved": result.unresolved,
                "dirty_files": graph_dirty_files(&store)?,
            }))
        }
        "synthesize" => anyhow::bail!(
            "code.synthesize is available on stdio MCP; HTTP MCP currently supports index/search/context/impact/file/stats/diff_impact/file_summary/incremental"
        ),
        _ => anyhow::bail!("unknown code action: {action}"),
    }
}

fn graph_dirty_files(store: &aeqi_graph::GraphStore) -> anyhow::Result<Vec<String>> {
    Ok(store
        .get_meta("dirty_files")?
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToOwned::to_owned)
        .collect())
}

fn parse_code_benchmark_cases(
    args: &serde_json::Value,
    limit: usize,
) -> anyhow::Result<Vec<aeqi_graph::SearchBenchmarkCase>> {
    let Some(cases) = args.get("cases").and_then(|v| v.as_array()) else {
        anyhow::bail!("benchmark requires cases: ['<id>|<query>=>expected']");
    };

    cases
        .iter()
        .map(|case| {
            let spec = case
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("benchmark cases must be strings"))?;
            aeqi_graph::SearchBenchmarkCase::parse(spec, limit)
        })
        .collect()
}

fn code_graph_audit_report(
    data_dir: &std::path::Path,
    projects: &[aeqi_core::config::AgentSpawnConfig],
    args: &serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    let graph_dir = data_dir.join("codegraph");
    std::fs::create_dir_all(&graph_dir)?;

    let requested_project = args
        .get("project")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|project| !project.is_empty());
    let target_projects: Vec<String> = requested_project
        .map(|project| vec![project.to_string()])
        .unwrap_or_else(|| {
            let configured: Vec<String> = projects
                .iter()
                .map(|project| project.name.clone())
                .collect();
            if configured.is_empty() {
                discover_graph_projects(&graph_dir)
            } else {
                configured
            }
        });

    if target_projects.is_empty() {
        return Ok(serde_json::json!({
            "ok": true,
            "count": 0,
            "projects": [],
            "message": format!("No graph DBs found in {}", graph_dir.display()),
        }));
    }

    let mut audit_args = args.clone();
    if let Some(obj) = audit_args.as_object_mut() {
        obj.remove("repo_path");
        obj.remove("repo");
        obj.remove("project");
    }

    let mut projects_report = Vec::with_capacity(target_projects.len());
    for project in target_projects {
        let db_path = graph_dir.join(format!("{project}.db"));
        let db_path_str = db_path.to_string_lossy().to_string();
        if !db_path.exists() {
            projects_report.push(serde_json::json!({
                "project": project,
                "db_path": db_path_str,
                "ok": false,
                "error": format!("missing graph DB at {}", db_path.display()),
            }));
            continue;
        }

        let store = match aeqi_graph::GraphStore::open(&db_path) {
            Ok(store) => store,
            Err(err) => {
                projects_report.push(serde_json::json!({
                    "project": project,
                    "db_path": db_path_str,
                    "ok": false,
                    "error": err.to_string(),
                }));
                continue;
            }
        };

        let repo = match resolve_code_repo_path(&audit_args, projects, &project, Some(&store)) {
            Ok(Some(repo)) => repo,
            Ok(None) => {
                projects_report.push(serde_json::json!({
                    "project": project,
                    "db_path": db_path_str,
                    "ok": false,
                    "error": code_project_not_found(&project).to_string(),
                }));
                continue;
            }
            Err(err) => {
                projects_report.push(serde_json::json!({
                    "project": project,
                    "db_path": db_path_str,
                    "ok": false,
                    "error": err.to_string(),
                }));
                continue;
            }
        };

        match aeqi_graph::Indexer::new().health(&repo, &store) {
            Ok(health) => projects_report.push(serde_json::json!({
                "project": project,
                "db_path": db_path_str,
                "repo_path": repo.to_string_lossy(),
                "ok": true,
                "health": health,
            })),
            Err(err) => projects_report.push(serde_json::json!({
                "project": project,
                "db_path": db_path_str,
                "repo_path": repo.to_string_lossy(),
                "ok": false,
                "error": err.to_string(),
            })),
        }
    }

    Ok(serde_json::json!({
        "ok": true,
        "count": projects_report.len(),
        "projects": projects_report,
    }))
}

fn discover_graph_projects(graph_dir: &std::path::Path) -> Vec<String> {
    let mut projects = Vec::new();
    let entries = match std::fs::read_dir(graph_dir) {
        Ok(entries) => entries,
        Err(_) => return projects,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("db") {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|stem| stem.to_str())
            && !stem.is_empty()
        {
            projects.push(stem.to_string());
        }
    }

    projects.sort();
    projects.dedup();
    projects
}

fn resolve_code_repo_path(
    args: &serde_json::Value,
    projects: &[aeqi_core::config::AgentSpawnConfig],
    project: &str,
    store: Option<&aeqi_graph::GraphStore>,
) -> anyhow::Result<Option<std::path::PathBuf>> {
    if let Some(repo) = args
        .get("repo_path")
        .or_else(|| args.get("repo"))
        .and_then(|v| v.as_str())
        .map(expand_path)
        .and_then(existing_dir)
    {
        return Ok(Some(repo));
    }

    if let Some(repo) = projects
        .iter()
        .find(|p| p.name == project)
        .map(|p| expand_path(&p.repo))
        .and_then(existing_dir)
    {
        return Ok(Some(repo));
    }

    if let Some(store) = store
        && let Some(repo) = store
            .get_meta("repo_path")?
            .as_deref()
            .map(expand_path)
            .and_then(existing_dir)
    {
        return Ok(Some(repo));
    }

    Ok(discover_repo_by_project_name(project))
}

fn code_project_not_found(project: &str) -> anyhow::Error {
    anyhow::anyhow!(
        "project '{project}' not found; configure [[projects]], pass repo_path, or run a full index with repo_path once"
    )
}

fn expand_path(path: &str) -> std::path::PathBuf {
    std::path::PathBuf::from(expand_tilde(path))
}

fn existing_dir(path: std::path::PathBuf) -> Option<std::path::PathBuf> {
    if path.is_dir() {
        Some(std::fs::canonicalize(&path).unwrap_or(path))
    } else {
        None
    }
}

fn discover_repo_by_project_name(project: &str) -> Option<std::path::PathBuf> {
    if project.contains('/') || project.contains('\\') || project == "." || project == ".." {
        return None;
    }

    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home);
    }
    roots.push(std::path::PathBuf::from("/workspace"));

    if let Ok(home_entries) = std::fs::read_dir("/home") {
        for entry in home_entries.flatten() {
            roots.push(entry.path());
        }
    }

    roots
        .into_iter()
        .map(|root| root.join(project))
        .find(|candidate| candidate.is_dir() && candidate.join(".git").exists())
        .and_then(existing_dir)
}

fn default_agent_name(ctx: &McpHttpContext, req: &mut serde_json::Value) {
    if req.get("agent").and_then(|v| v.as_str()).is_none()
        && let Some(agent) = ctx.agent.as_deref()
    {
        req["agent"] = serde_json::json!(agent);
    }
}

#[derive(Debug, Clone)]
struct AppRoleAuth {
    role_id: Option<String>,
    grants: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
struct IntegrationPack {
    provider: &'static str,
    title: &'static str,
    category: &'static str,
    description: &'static str,
    auth_model: &'static str,
    credential_name: &'static str,
    default_scope_kind: &'static str,
    credential_scope_note: &'static str,
    tool_prefixes: &'static [&'static str],
    capabilities: &'static [&'static str],
}

impl IntegrationPack {
    fn matches_tool(&self, tool_name: &str) -> bool {
        self.tool_prefixes.iter().any(|prefix| {
            tool_name == *prefix
                || tool_name
                    .strip_prefix(prefix)
                    .map(|rest| rest.starts_with('.') || rest.starts_with('_'))
                    .unwrap_or(false)
        })
    }
}

const INTEGRATION_PACKS: &[IntegrationPack] = &[
    IntegrationPack {
        provider: "google",
        title: "Google Workspace",
        category: "productivity",
        description: "Gmail, Calendar, Meet, and Drive tools for operator and agent workflows.",
        auth_model: "oauth2",
        credential_name: "oauth_token",
        default_scope_kind: "agent",
        credential_scope_note: "Per-agent OAuth by default, with TRUST/global fallback through the credential resolver.",
        tool_prefixes: &["google", "gmail", "calendar", "meet", "drive"],
        capabilities: &["email", "calendar", "meetings", "documents", "files"],
    },
    IntegrationPack {
        provider: "github",
        title: "GitHub",
        category: "engineering",
        description: "Repository, issue, pull request, release, file, and code-search operations.",
        auth_model: "github_app_or_oauth2",
        credential_name: "installation_token",
        default_scope_kind: "installation",
        credential_scope_note: "Prefer GitHub App installation credentials; OAuth/PAT-shaped rows are fallback.",
        tool_prefixes: &["github"],
        capabilities: &[
            "issues",
            "pull_requests",
            "repositories",
            "files",
            "releases",
            "search",
        ],
    },
    IntegrationPack {
        provider: "notion",
        title: "Notion",
        category: "knowledge",
        description: "Workspace pages, blocks, databases, users, and structured knowledge capture.",
        auth_model: "oauth2",
        credential_name: "oauth_token",
        default_scope_kind: "agent",
        credential_scope_note: "Per-agent Notion OAuth by default; can be elevated to TRUST scope when the workspace is company-owned.",
        tool_prefixes: &["notion"],
        capabilities: &["pages", "blocks", "databases", "users"],
    },
    IntegrationPack {
        provider: "slack",
        title: "Slack",
        category: "messaging",
        description: "Workspace channels, messages, reactions, users, and search.",
        auth_model: "oauth2_bot",
        credential_name: "bot_token",
        default_scope_kind: "user",
        credential_scope_note: "One bot token per Slack workspace, stored on the workspace/user scope.",
        tool_prefixes: &["slack"],
        capabilities: &["channels", "messages", "reactions", "users", "search"],
    },
    IntegrationPack {
        provider: "etsy",
        title: "Etsy",
        category: "commerce",
        description: "Seller shop, listing, order, and draft-listing tools for TRUST-owned storefronts.",
        auth_model: "oauth2",
        credential_name: "oauth_token",
        default_scope_kind: "trust",
        credential_scope_note: "TRUST-scoped OAuth: one connected seller account powers permitted humans and agents.",
        tool_prefixes: &["etsy"],
        capabilities: &["shops", "listings", "orders", "draft_listings"],
    },
];

fn integration_tools() -> Vec<Arc<dyn Tool>> {
    let mut tools = Vec::new();
    tools.extend(aeqi_pack_google_workspace::all_tools());
    tools.extend(aeqi_pack_github::all_tools());
    tools.extend(aeqi_pack_notion::all_tools());
    tools.extend(aeqi_pack_slack::all_tools());
    tools.extend(aeqi_pack_etsy::all_tools());
    tools
}

fn provider_for_integration_tool(tool_name: &str) -> Option<&'static str> {
    INTEGRATION_PACKS
        .iter()
        .find(|pack| pack.matches_tool(tool_name))
        .map(|pack| pack.provider)
}

fn integration_catalog(provider: Option<&str>) -> Vec<serde_json::Value> {
    let tools = integration_tools();
    INTEGRATION_PACKS
        .iter()
        .filter(|pack| provider.is_none_or(|requested| requested == pack.provider))
        .map(|pack| {
            let pack_tools = tools
                .iter()
                .filter_map(|tool| {
                    let spec = tool.spec();
                    if provider_for_integration_tool(&spec.name) != Some(pack.provider) {
                        return None;
                    }
                    Some(serde_json::json!({
                        "name": spec.name,
                        "description": spec.description,
                        "read_only": !tool.is_destructive(&serde_json::json!({})),
                        "destructive": tool.is_destructive(&serde_json::json!({})),
                        "credential_needs": tool.required_credentials().into_iter().map(|need| {
                            serde_json::json!({
                                "provider": need.provider,
                                "name": need.name,
                                "scope_hint": need.scope_hint,
                                "required": !need.optional,
                                "scopes": need.oauth_scopes,
                            })
                        }).collect::<Vec<_>>(),
                    }))
                })
                .collect::<Vec<_>>();

            serde_json::json!({
                "provider": pack.provider,
                "title": pack.title,
                "category": pack.category,
                "status": "available",
                "description": pack.description,
                "auth_model": pack.auth_model,
                "credential": {
                    "provider": pack.provider,
                    "name": pack.credential_name,
                    "default_scope_kind": pack.default_scope_kind,
                    "scope_note": pack.credential_scope_note,
                },
                "capabilities": pack.capabilities,
                "tool_count": pack_tools.len(),
                "tools": pack_tools,
                "grant_examples": [
                    "apps.use",
                    format!("apps.{}.use", pack.provider),
                ],
            })
        })
        .collect()
}

fn open_mcp_credential_store(state: &AppState) -> anyhow::Result<CredentialStore> {
    let aeqi_db = state.data_dir.join("aeqi.db");
    let conn = Connection::open(&aeqi_db)?;
    CredentialStore::initialize_schema(&conn)?;
    let secrets_dir = state.data_dir.join("secrets");
    let cipher = CredentialCipher::open(&secrets_dir)?;
    Ok(CredentialStore::new(Arc::new(Mutex::new(conn)), cipher))
}

fn build_mcp_credential_resolver(store: CredentialStore) -> CredentialResolver {
    let lifecycles: Vec<Arc<dyn CredentialLifecycle>> = vec![
        Arc::new(StaticSecretLifecycle),
        Arc::new(OAuth2Lifecycle),
        Arc::new(DeviceSessionLifecycle),
        Arc::new(GithubAppLifecycle),
        Arc::new(ServiceAccountLifecycle),
    ];
    CredentialResolver::new(store, lifecycles)
}

fn credential_resolution_scope(
    ctx: &McpHttpContext,
    args: &serde_json::Value,
    role_id: Option<&str>,
) -> ResolutionScope {
    let requested_kind = args
        .get("credential_scope_kind")
        .or_else(|| args.get("scope_kind"))
        .and_then(|v| v.as_str())
        .unwrap_or("agent");
    let requested_id = args
        .get("credential_scope_id")
        .or_else(|| args.get("credential_trust_id"))
        .or_else(|| args.get("credential_agent_id"))
        .or_else(|| args.get("agent_id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    let mut scope = ResolutionScope {
        trust_id: ctx
            .actor
            .trust_id
            .clone()
            .or_else(|| ctx.allowed_roots.first().cloned()),
        user_id: ctx.actor.user_id.clone(),
        ..Default::default()
    };
    match requested_kind {
        "global" => {}
        "trust" | "entity" => {
            scope.trust_id = requested_id
                .or_else(|| ctx.actor.trust_id.clone())
                .or_else(|| ctx.allowed_roots.first().cloned());
        }
        "user" => {
            if let Some(user_id) = requested_id.or_else(|| ctx.actor.user_id.clone()) {
                scope.user_id = Some(user_id);
            }
        }
        "installation" => {
            scope.installation_id = requested_id;
        }
        "channel" => {
            scope.channel_id = requested_id;
        }
        _ => {
            scope.agent_id = requested_id
                .or_else(|| ctx.agent_id.clone())
                .or_else(|| role_id.map(ToOwned::to_owned));
        }
    }
    scope
}

fn authorize_app_role(
    state: &AppState,
    ctx: &McpHttpContext,
    args: &serde_json::Value,
    provider: &str,
    tool_name: &str,
) -> anyhow::Result<AppRoleAuth> {
    if ctx.allowed_roots.is_empty() {
        return Ok(AppRoleAuth {
            role_id: ctx.role_id.clone(),
            grants: vec!["*".to_string()],
        });
    }

    let trust_id = args
        .get("trust_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or(ctx.actor.trust_id.as_deref())
        .ok_or_else(|| anyhow::anyhow!("trust_id is required for scoped app calls"))?;
    if !ctx.allowed_roots.iter().any(|root| root == trust_id) {
        anyhow::bail!("forbidden: trust_id is outside the MCP allowed roots");
    }

    let db_path = state.data_dir.join("aeqi.db");
    let conn = Connection::open(&db_path)?;
    let role_id = args
        .get("role_id")
        .or_else(|| args.get("as_role_id"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| ctx.role_id.clone())
        .or(infer_single_occupied_role(&conn, trust_id, ctx)?)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "role_id is required for scoped app calls when no single occupied role can be inferred"
            )
        })?;

    let (occupant_kind, occupant_id): (String, Option<String>) = conn
        .query_row(
            "SELECT occupant_kind, occupant_id FROM roles WHERE id = ?1 AND trust_id = ?2",
            params![role_id, trust_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| anyhow::anyhow!("role not found in trust: {role_id}"))?;
    match (occupant_kind.as_str(), occupant_id.as_deref()) {
        ("human", Some(id)) if ctx.actor.user_id.as_deref() == Some(id) => {}
        ("agent", Some(id)) if ctx.agent_id.as_deref() == Some(id) => {}
        _ => anyhow::bail!("forbidden: MCP actor does not occupy role {role_id}"),
    }

    let grants = role_grants(&conn, &role_id)?;
    let allowed = app_grant_candidates(provider, tool_name)
        .iter()
        .any(|candidate| grants.iter().any(|grant| grant == candidate));
    if !allowed {
        anyhow::bail!(
            "forbidden: role {role_id} lacks an app grant for provider={provider} tool={tool_name}"
        );
    }

    Ok(AppRoleAuth {
        role_id: Some(role_id),
        grants,
    })
}

fn infer_single_occupied_role(
    conn: &Connection,
    trust_id: &str,
    ctx: &McpHttpContext,
) -> anyhow::Result<Option<String>> {
    let (kind, occupant_id) = if let Some(user_id) = ctx.actor.user_id.as_deref() {
        ("human", user_id)
    } else if let Some(agent_id) = ctx.agent_id.as_deref() {
        ("agent", agent_id)
    } else {
        return Ok(None);
    };
    let mut stmt = conn.prepare(
        "SELECT id FROM roles
         WHERE trust_id = ?1 AND occupant_kind = ?2 AND occupant_id = ?3
         ORDER BY created_at ASC",
    )?;
    let roles = stmt
        .query_map(params![trust_id, kind, occupant_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(if roles.len() == 1 {
        roles.into_iter().next()
    } else {
        None
    })
}

fn role_grants(conn: &Connection, role_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT grant FROM role_grants WHERE role_id = ?1 ORDER BY grant")?;
    Ok(stmt
        .query_map(params![role_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?)
}

fn app_grant_candidates(provider: &str, tool_name: &str) -> Vec<String> {
    vec![
        "apps.use".to_string(),
        "apps.*.use".to_string(),
        format!("apps.{provider}.use"),
        format!("apps.{provider}.{tool_name}.use"),
        "integrations.use".to_string(),
        "integrations.*.use".to_string(),
        format!("integrations.{provider}.use"),
        format!("integrations.{provider}.{tool_name}.use"),
    ]
}

fn quests_create_ipc_request(args: &serde_json::Value, default_project: &str) -> serde_json::Value {
    let mut req = args.clone();
    req["cmd"] = serde_json::json!("create_quest");
    if req
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .is_empty()
    {
        req["project"] = serde_json::json!(default_project);
    }
    if let Some(dep) = req.get("depends_on").cloned()
        && dep.is_string()
    {
        req["depends_on"] = serde_json::json!([dep.as_str().unwrap_or("")]);
    }
    req
}

fn quests_list_ipc_request(args: &serde_json::Value, _default_project: &str) -> serde_json::Value {
    // Do NOT default `project` on list. The daemon resolves `project` to an
    // agent_id and SQL-filters quests by it, which silently drops every
    // scope:"global" quest (agent_id IS NULL). Callers who want a narrowed
    // list pass `project` (or `agent`/`agent_id`) explicitly; absent those,
    // the daemon returns the entity-visible set including globals.
    let mut req = serde_json::json!({ "cmd": "quests" });
    copy_fields(args, &mut req, &["project", "status", "agent", "agent_id"]);
    req
}

fn quests_update_ipc_request(args: &serde_json::Value, default_project: &str) -> serde_json::Value {
    let mut req = serde_json::json!({
        "cmd": "update_quest",
        "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
        "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(default_project),
    });
    copy_fields(
        args,
        &mut req,
        &[
            "status", "priority", "agent_id", "scope", "assignee", "due_at",
        ],
    );
    req
}

fn quests_close_ipc_request(args: &serde_json::Value) -> serde_json::Value {
    let mut req = args.clone();
    req["cmd"] = serde_json::json!("close_quest");
    if req.get("reason").and_then(|v| v.as_str()).is_none()
        && let Some(result) = args.get("result").and_then(|v| v.as_str())
    {
        req["reason"] = serde_json::json!(result);
    }
    req
}

fn default_mcp_project(state: &AppState) -> &str {
    state
        .mcp_projects
        .first()
        .map(|project| project.name.as_str())
        .unwrap_or("aeqi")
}

fn copy_fields(from: &serde_json::Value, to: &mut serde_json::Value, fields: &[&str]) {
    for field in fields {
        if let Some(value) = from.get(*field) {
            to[*field] = value.clone();
        }
    }
}

fn event_pattern(args: &serde_json::Value, default: &str) -> String {
    if let Some(schedule) = args.get("schedule").and_then(|v| v.as_str()) {
        format!("schedule:{schedule}")
    } else if let Some(event) = args.get("event_pattern").and_then(|v| v.as_str()) {
        format!("session:{event}")
    } else {
        args.get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or(default)
            .to_string()
    }
}

fn events_update_ipc_request(args: &serde_json::Value, enabled: bool) -> serde_json::Value {
    serde_json::json!({
        "cmd": "update_event",
        "id": args
            .get("event_id")
            .or_else(|| args.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or(""),
        "enabled": enabled,
    })
}

fn events_delete_ipc_request(args: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "cmd": "delete_event",
        "id": args
            .get("event_id")
            .or_else(|| args.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    })
}

fn events_trigger_ipc_request(args: &serde_json::Value, ctx: &McpHttpContext) -> serde_json::Value {
    let mut req = serde_json::json!({
        "cmd": "trigger_event",
        "pattern": event_pattern(args, "session:start"),
    });
    if let Some(agent_id) = args.get("agent_id").cloned() {
        req["agent_id"] = agent_id;
    } else if let Some(agent) = args.get("agent").cloned() {
        req["agent"] = agent;
    } else if let Some(agent) = ctx.agent.as_deref() {
        req["agent"] = serde_json::json!(agent);
    }
    req
}

fn expand_tilde(path: &str) -> String {
    if path.starts_with('~')
        && let Some(home) = dirs::home_dir()
    {
        return path.replacen('~', &home.to_string_lossy(), 1);
    }
    path.to_string()
}

fn tool_defs() -> serde_json::Value {
    serde_json::json!([
        {
            "name": "me",
            "title": "AEQI Identity",
            "description": "Inspect who this MCP connection is acting as. Use this first when you need to confirm the authenticated user, entity/company scope, runtime transport, and authorization envelope before reading or writing company context.",
            "annotations": {
                "title": "AEQI Identity",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["profile", "permissions"],
                        "description": "profile returns actor/runtime metadata. permissions returns the same envelope plus grants when available."
                    }
                }
            }
        },
        {
            "name": "ideas",
            "title": "AEQI Ideas",
            "description": "Company memory and idea graph. Use search before coding to recover prior decisions, store durable findings after useful work, link related ideas, and send feedback so retrieval improves. Search combines lexical/vector retrieval with ranking; writes are scoped to the authenticated entity unless an explicit agent_id is supplied.",
            "annotations": {
                "title": "AEQI Ideas",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["store", "search", "update", "delete", "link", "feedback", "walk"],
                        "description": "store saves knowledge; search retrieves ideas by natural language query; update/delete mutate an idea by id; link connects ideas; feedback adjusts ranking; walk traverses the idea graph."
                    },
                    "id": {"type": "string", "description": "Idea ID for update, delete, or feedback."},
                    "name": {"type": "string", "description": "Short human-readable idea name for store/update, for example 'mcp/user-principal-quests'."},
                    "content": {"type": "string", "description": "Durable knowledge body to store or replace."},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags for classification and hard-filtered search, for example architecture, decision, procedure, bug, mcp, codegraph."},
                    "kind": {"type": "string", "description": "Structural identity for store. Canonical: note (default), file, goal. Custom kinds may use custom:<name>."},
                    "file_id": {"type": "string", "description": "Optional blob/file row id when storing an idea with kind=file."},
                    "query": {"type": "string", "description": "Natural language search query for search."},
                    "limit": {"type": "integer", "description": "Maximum search/walk results. Defaults to the runtime action default."},
                    "agent_id": {"type": "string", "description": "Optional explicit agent scope. Omit for entity/global memory owned by the authenticated user/company context."},
                    "from": {"type": "string", "description": "Source idea ID for link or walk."},
                    "to": {"type": "string", "description": "Target idea ID for link."},
                    "relation": {"type": "string", "description": "Relationship type for link, usually link, mention, embed, supports, supersedes, or contradicts."},
                    "strength": {"type": "number", "description": "Relationship strength for link, 0.0 to 1.0."},
                    "signal": {"type": "string", "enum": ["used", "useful", "ignored", "corrected", "wrong", "pinned"], "description": "Feedback signal for retrieval quality."},
                    "explain": {"type": "boolean", "description": "When true, include score/ranking explanation in search results."},
                    "include_superseded": {"type": "boolean", "description": "When true, include archived or superseded ideas in search."},
                    "max_hops": {"type": "integer", "description": "Maximum graph depth for walk."},
                    "relations": {"type": "array", "items": {"type": "string"}, "description": "Optional relation filter for walk."}
                },
                "required": ["action"]
            }
        },
        {
            "name": "quests",
            "title": "AEQI Quests",
            "description": "Task ledger for company work. Use quests to create, list, show, update, close, or cancel work even when no AEQI runtime agent is assigned. `list` with no `project`/`agent` returns all quests visible to the calling entity, including global (scope:\"global\", agent_id:null) quests; pass `project`, `agent`, or `agent_id` to narrow. `create` defaults to the runtime's first configured project unless `agent` is set. AEQI_AGENT only labels the MCP client and does not automatically own or filter quests.",
            "annotations": {
                "title": "AEQI Quests",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": false
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "show", "update", "close", "cancel", "attach_github_issue"],
                        "description": "create makes a quest; list shows quests; show returns details; update changes status, priority, assignee, due_at, agent_id, or scope; close records a done outcome; cancel marks work cancelled; attach_github_issue links a https://github.com/<owner>/<repo>/issues/<n> URL to a quest (close-time mirror is filed separately as quest 67-218.1)."
                    },
                    "project": {"type": "string", "description": "Project name, for example aeqi or aeqi-platform. Optional in MCP clients; defaults to the runtime's first configured project."},
                    "quest_id": {"type": "string", "description": "Quest ID for show, update, close, or cancel."},
                    "subject": {"type": "string", "description": "Quest subject for create. Prefix with 'claim:' for atomic resource locking."},
                    "description": {"type": "string", "description": "Quest description for create."},
                    "agent": {"type": "string", "description": "Optional explicit agent name or hint for delegated/agent-scoped work. Omit for user/entity global quests."},
                    "agent_id": {"type": "string", "description": "Optional explicit agent ID for delegated/agent-scoped work."},
                    "assignee": {
                        "oneOf": [
                            {"type": "string", "description": "Assignee token, for example agent:<id> or user:<id>."},
                            {"type": "null", "description": "Clear the assignee."}
                        ],
                        "description": "Quest assignee for update. Omit to leave unchanged; null or empty string clears it."
                    },
                    "scope": {"type": "string", "enum": ["self", "siblings", "children", "branch", "global"], "description": "Quest visibility scope for create or update."},
                    "idea_id": {"type": "string", "description": "Existing idea ID to attach to a new quest."},
                    "idea": {"type": "object", "description": "Embedded idea to mint and attach while creating a quest; accepts name, content, tags, scope, and optional agent_id."},
                    "labels": {"type": "array", "items": {"type": "string"}, "description": "Quest labels/tags for create."},
                    "depends_on": {
                        "oneOf": [
                            {"type": "string", "description": "Single prerequisite quest ID."},
                            {"type": "array", "items": {"type": "string"}, "description": "Prerequisite quest IDs."}
                        ],
                        "description": "Quest dependency or dependencies for create."
                    },
                    "parent": {"type": "string", "description": "Parent quest ID for child quest creation."},
                    "status": {"type": "string", "enum": ["todo", "in_progress", "done", "backlog", "cancelled", "pending", "blocked"], "description": "Filter for list or new status for update."},
                    "priority": {"type": "string", "enum": ["low", "normal", "high", "critical"], "description": "Priority for create or update."},
                    "due_at": {
                        "oneOf": [
                            {"type": "string", "description": "RFC3339 due timestamp."},
                            {"type": "number", "description": "Unix timestamp in seconds."},
                            {"type": "null", "description": "Clear the due date."}
                        ],
                        "description": "Due date for update. Omit to leave unchanged; null or empty string clears it."
                    },
                    "result": {"type": "string", "description": "Completion result for close."},
                    "reason": {"type": "string", "description": "Cancellation reason for cancel."},
                    "url": {"type": "string", "description": "GitHub issue URL for attach_github_issue. Must match https://github.com/<owner>/<repo>/issues/<n>."}
                },
                "required": ["action"]
            }
        },
        {
            "name": "agents",
            "title": "AEQI Agents",
            "description": "Optional AEQI runtime workers and project registry. Use this to inspect available agents/projects, get an agent profile/context, hire a new agent, or retire one. You do not need an AEQI agent to use ideas, quests, or code graph as the authenticated user.",
            "annotations": {
                "title": "AEQI Agents",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["get", "hire", "retire", "list", "projects"], "description": "get returns one agent plus context; list returns agents; projects returns configured MCP projects; hire spawns; retire deactivates."},
                    "project": {"type": "string", "description": "Project name for project-specific operations."},
                    "agent": {"type": "string", "description": "Agent name or ID for get or retire."},
                    "template": {"type": "string", "description": "Agent template name for hire."},
                    "parent_agent_id": {"type": "string", "description": "Optional parent agent ID for hire."},
                    "status": {"type": "string", "enum": ["active", "paused", "retired", "all"], "description": "Status filter for list."}
                },
                "required": ["action"]
            }
        },
        {
            "name": "events",
            "title": "AEQI Events",
            "description": "Lifecycle automation for the runtime. Use events to list or manage handlers, manually trigger session/quest lifecycle context, and trace handler executions. Prefer read actions unless intentionally changing automation.",
            "annotations": {
                "title": "AEQI Events",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "list", "enable", "disable", "delete", "trigger", "trace"], "description": "create/list/enable/disable/delete manage handlers; create accepts tool_calls; trigger fires a lifecycle event; trace inspects invocations."},
                    "agent": {"type": "string", "description": "Optional agent name or ID for agent-scoped event context."},
                    "agent_id": {"type": "string", "description": "Explicit agent ID. Required for schedule:* events unless `agent` resolves to an active agent."},
                    "name": {"type": "string", "description": "Event handler name for create."},
                    "pattern": {"type": "string", "description": "Full event pattern, for example session:start, session:quest_end, or schedule:0 9 * * *."},
                    "schedule": {"type": "string", "description": "Cron expression shorthand for schedule:<expr>."},
                    "event_pattern": {"type": "string", "description": "Session event shorthand, for example start, quest_start, quest_end, or quest_result."},
                    "tool_calls": {"type": "array", "items": {"type": "object"}, "description": "Event tool calls to execute when the handler fires, e.g. session.spawn or ideas.search."},
                    "event_id": {"type": "string", "description": "Event handler ID for enable, disable, or delete."},
                    "session_id": {"type": "string", "description": "Session ID for trace list."},
                    "invocation_id": {"type": "integer", "description": "Invocation ID for detailed trace."},
                    "limit": {"type": "integer", "description": "Maximum trace rows."}
                },
                "required": ["action"]
            }
        },
        {
            "name": "code",
            "title": "AEQI Code Graph",
            "description": "Code intelligence graph for configured company repositories. Use search to find symbols, context for callers/callees/implementors, impact or diff_impact before edits, benchmark to run answerability quality gates, file/file_summary for file-level understanding, stats or health to inspect index health, audit to inspect all configured roots, and index/incremental to refresh the graph.",
            "annotations": {
                "title": "AEQI Code Graph",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": false
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["search", "context", "impact", "file", "stats", "health", "audit", "benchmark", "index", "diff_impact", "file_summary", "incremental"], "description": "search/context/impact/file/stats/health/audit/benchmark/diff_impact/file_summary are read actions; index and incremental refresh the graph."},
                    "project": {"type": "string", "description": "Configured project name, for example aeqi or aeqi-platform."},
                    "repo_path": {"type": "string", "description": "Optional checkout path for index, incremental, or diff_impact. Successful refreshes store it for future project-only calls."},
                    "query": {"type": "string", "description": "Symbol/name search query for search."},
                    "node_id": {"type": "string", "description": "Graph node ID for context or impact."},
                    "file_path": {"type": "string", "description": "Repository-relative path for file or file_summary."},
                    "depth": {"type": "integer", "description": "Traversal depth for impact or diff_impact."},
                    "limit": {"type": "integer", "description": "Maximum search results."},
                    "cases": {"type": "array", "items": {"type": "string"}, "description": "Benchmark cases for action=benchmark. Format: '<id>|<query>=>expected_a,expected_b'."},
                    "min_recall": {"type": "number", "description": "Minimum recall each benchmark case must meet."}
                },
                "required": ["action", "project"]
            }
        },
        {
            "name": "browser",
            "title": "AEQI Browser",
            "description": "Quest-scoped browser execution for agents. Use capabilities, policy, or status to inspect backend order and controls. Use open or screenshot for a one-shot Playwright capture that stores screenshot and snapshot evidence. Mutating page actions remain disabled.",
            "annotations": {
                "title": "AEQI Browser",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["capabilities", "policy", "status", "open", "screenshot"], "description": "Inspect the browser contract or run a one-shot Playwright capture."},
                    "url": {"type": "string", "description": "Absolute URL to open for open/screenshot."},
                    "quest_id": {"type": "string", "description": "Quest that owns the browser evidence. Required for open/screenshot."},
                    "agent_id": {"type": "string", "description": "Agent whose Drive/Ideas file store receives screenshot evidence. Defaults to the MCP agent context when present."},
                    "backend": {"type": "string", "enum": ["playwright", "agent-browser", "cloakbrowser"], "description": "Requested browser backend. Only playwright is enabled in this slice."},
                    "viewport": {"type": "string", "description": "Viewport as WIDTHxHEIGHT. Defaults to 1440x900."},
                    "wait_ms": {"type": "integer", "description": "Extra settling wait after navigation. Defaults to 1000."},
                    "full_page": {"type": "boolean", "description": "Capture a full-page screenshot instead of viewport only."}
                },
                "required": ["action"]
            }
        },
        {
            "name": "apps",
            "title": "AEQI Apps Proxy",
            "description": "Universal TRUST-role proxy for connected apps. Use catalog to discover available app packs, credential scope, capabilities, and safe/destructive tools; use list_tools for raw function schemas; use call to dispatch through the credential substrate. Scoped calls require the acting role to occupy the TRUST and hold an app grant such as apps.google.use or apps.use.",
            "annotations": {
                "title": "AEQI Apps Proxy",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["catalog", "list_apps", "list_tools", "call"], "description": "catalog/list_apps returns app-pack metadata and capability summaries; list_tools returns callable app/provider-pack tool specs; call dispatches one tool through role authorization and credential resolution."},
                    "provider": {"type": "string", "description": "App/provider key, for example google, github, notion, slack, or etsy. Required when the provider cannot be inferred from the tool name."},
                    "tool": {"type": "string", "description": "App tool name for call, for example google.request, drive.list_files, or gmail.search."},
                    "arguments": {"type": "object", "description": "Arguments passed unchanged to the app tool."},
                    "trust_id": {"type": "string", "description": "TRUST/entity id to authorize against. Defaults to the MCP allowed root."},
                    "role_id": {"type": "string", "description": "Role/chair the MCP actor is occupying. May also be supplied as x-aeqi-role-id."},
                    "credential_scope_kind": {"type": "string", "enum": ["agent", "trust", "global", "user", "channel", "installation"], "description": "Credential lookup scope. Defaults to agent, whose resolver order is agent, TRUST, then global."},
                    "credential_scope_id": {"type": "string", "description": "Optional credential scope id; for TRUST scope this is the TRUST/entity id."}
                },
                "required": ["action"]
            }
        },
        {
            "name": "integrations",
            "title": "AEQI Integration Proxy",
            "description": "Compatibility alias for AEQI Apps. Prefer apps for new clients. Existing integration grants still work, and apps.* grants are also accepted. Supports the same catalog, list_tools, and call actions.",
            "annotations": {
                "title": "AEQI Integration Proxy",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": true
            },
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["catalog", "list_apps", "list_tools", "call"], "description": "catalog/list_apps returns app-pack metadata and capability summaries; list_tools returns callable app/provider-pack tool specs; call dispatches one tool through role authorization and credential resolution."},
                    "provider": {"type": "string", "description": "Integration provider key, for example google, github, notion, slack, or etsy. Required when the provider cannot be inferred from the tool name."},
                    "tool": {"type": "string", "description": "App tool name for call, for example google.request, drive.list_files, or gmail.search."},
                    "arguments": {"type": "object", "description": "Arguments passed unchanged to the app tool."},
                    "trust_id": {"type": "string", "description": "TRUST/entity id to authorize against. Defaults to the MCP allowed root."},
                    "role_id": {"type": "string", "description": "Role/chair the MCP actor is occupying. May also be supplied as x-aeqi-role-id."},
                    "credential_scope_kind": {"type": "string", "enum": ["agent", "trust", "global", "user", "channel", "installation"], "description": "Credential lookup scope. Defaults to agent, whose resolver order is agent, TRUST, then global."},
                    "credential_scope_id": {"type": "string", "description": "Optional credential scope id; for TRUST scope this is the TRUST/entity id."}
                },
                "required": ["action"]
            }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_project(name: &str, repo: &std::path::Path) -> aeqi_core::config::AgentSpawnConfig {
        aeqi_core::config::AgentSpawnConfig {
            id: None,
            name: name.to_string(),
            prefix: name.to_string(),
            repo: repo.to_string_lossy().to_string(),
            model: None,
            runtime: None,
            max_workers: 2,
            worktree_root: None,
            execution_mode: Default::default(),
            max_steps: Some(25),
            max_budget_usd: None,
            worker_timeout_secs: 1800,
            max_cost_per_day_usd: None,
            orchestrator: None,
            domain_hints: Vec::new(),
            compact_instructions: None,
        }
    }

    #[test]
    fn http_mcp_context_builds_user_actor_from_scope() {
        let mut headers = HeaderMap::new();
        headers.insert("x-aeqi-agent", "architect".parse().unwrap());
        headers.insert("x-aeqi-role-id", "role-director".parse().unwrap());
        let scope = UserScope {
            roots: vec!["entity-1".to_string()],
            user_id: Some("user-1".to_string()),
        };

        let ctx = mcp_context(Some(&scope), &headers);

        assert_eq!(ctx.actor.kind, "user");
        assert_eq!(ctx.actor.user_id.as_deref(), Some("user-1"));
        assert_eq!(ctx.actor.trust_id.as_deref(), Some("entity-1"));
        assert_eq!(ctx.agent.as_deref(), Some("architect"));
        assert_eq!(ctx.role_id.as_deref(), Some("role-director"));
        assert_eq!(ctx.allowed_roots, vec!["entity-1"]);
    }

    #[test]
    fn http_mcp_quest_create_does_not_invent_agent_scope() {
        let req = quests_create_ipc_request(
            &serde_json::json!({
                "project": "aeqi",
                "subject": "Fix MCP quest scope",
                "depends_on": "67-026"
            }),
            "default-project",
        );

        assert_eq!(req["cmd"], "create_quest");
        assert_eq!(req["project"], "aeqi");
        assert_eq!(req["depends_on"], serde_json::json!(["67-026"]));
        assert!(req.get("agent").is_none());
    }

    #[test]
    fn http_mcp_quest_create_defaults_project_for_clients() {
        let req = quests_create_ipc_request(
            &serde_json::json!({
                "subject": "Track MCP work"
            }),
            "aeqi",
        );

        assert_eq!(req["cmd"], "create_quest");
        assert_eq!(req["project"], "aeqi");
    }

    #[test]
    fn http_mcp_quest_list_only_filters_explicit_agent() {
        let unfiltered = quests_list_ipc_request(
            &serde_json::json!({
                "project": "aeqi",
                "status": "todo"
            }),
            "default-project",
        );
        assert_eq!(unfiltered["cmd"], "quests");
        assert_eq!(unfiltered["status"], "todo");
        assert!(unfiltered.get("agent").is_none());

        let filtered = quests_list_ipc_request(
            &serde_json::json!({
                "project": "aeqi",
                "agent": "operator"
            }),
            "default-project",
        );
        assert_eq!(filtered["agent"], "operator");
    }

    #[test]
    fn http_mcp_quest_list_does_not_default_project() {
        // When the caller passes no `project`, the IPC must NOT inject the
        // default project. The daemon resolves `project` to an agent_id and
        // SQL-filters quests by it, which silently drops every scope:"global"
        // quest. An absent `project` is the only way to see the entity-wide
        // list including globals.
        let req = quests_list_ipc_request(&serde_json::json!({}), "aeqi");
        assert_eq!(req["cmd"], "quests");
        assert!(
            req.get("project").is_none(),
            "list must not auto-inject default project: {req}"
        );
        assert!(req.get("status").is_none());
        assert!(req.get("agent").is_none());
        assert!(req.get("agent_id").is_none());
    }

    #[test]
    fn http_mcp_quest_list_forwards_agent_id() {
        let req = quests_list_ipc_request(
            &serde_json::json!({
                "agent_id": "a6107b6a-1959-45f9-901c-77fa1f333cbe",
            }),
            "default-project",
        );
        assert_eq!(req["agent_id"], "a6107b6a-1959-45f9-901c-77fa1f333cbe");
        assert!(req.get("project").is_none());
    }

    #[test]
    fn http_mcp_quest_update_forwards_assignment_fields() {
        let req = quests_update_ipc_request(
            &serde_json::json!({
                "quest_id": "67-160",
                "assignee": "user:6708630a-69c4-42fa-a8a7-5a00412a61cf",
                "agent_id": "a6107b6a-1959-45f9-901c-77fa1f333cbe",
                "scope": "global",
                "due_at": null,
            }),
            "aeqi",
        );

        assert_eq!(req["cmd"], "update_quest");
        assert_eq!(req["quest_id"], "67-160");
        assert_eq!(req["project"], "aeqi");
        assert_eq!(req["assignee"], "user:6708630a-69c4-42fa-a8a7-5a00412a61cf");
        assert_eq!(req["agent_id"], "a6107b6a-1959-45f9-901c-77fa1f333cbe");
        assert_eq!(req["scope"], "global");
        assert!(req["due_at"].is_null());
    }

    #[test]
    fn http_mcp_quest_close_maps_result_to_reason() {
        let req = quests_close_ipc_request(&serde_json::json!({
            "action": "close",
            "quest_id": "ae-015",
            "result": "Preserved close outcome text",
        }));

        assert_eq!(req["cmd"], "close_quest");
        assert_eq!(req["quest_id"], "ae-015");
        assert_eq!(req["reason"], "Preserved close outcome text");
    }

    #[test]
    fn http_mcp_quest_close_preserves_explicit_reason() {
        let req = quests_close_ipc_request(&serde_json::json!({
            "action": "close",
            "quest_id": "ae-015",
            "result": "Tool result text",
            "reason": "Explicit audit reason",
        }));

        assert_eq!(req["reason"], "Explicit audit reason");
    }

    #[test]
    fn http_mcp_event_enable_maps_event_id_to_ipc_id() {
        let req = events_update_ipc_request(
            &serde_json::json!({
                "event_id": "evt-123",
            }),
            true,
        );

        assert_eq!(req["cmd"], "update_event");
        assert_eq!(req["id"], "evt-123");
        assert_eq!(req["enabled"], true);
        assert!(req.get("event_id").is_none());
    }

    #[test]
    fn http_mcp_event_delete_maps_event_id_to_ipc_id() {
        let req = events_delete_ipc_request(&serde_json::json!({
            "event_id": "evt-123",
        }));

        assert_eq!(req["cmd"], "delete_event");
        assert_eq!(req["id"], "evt-123");
        assert!(req.get("event_id").is_none());
    }

    #[test]
    fn http_mcp_event_trigger_prefers_explicit_agent_id() {
        let ctx = McpHttpContext {
            actor: McpActorContext {
                kind: "local_operator".to_string(),
                user_id: None,
                trust_id: None,
                roles: Vec::new(),
                grants: vec!["*".to_string()],
                source: "test".to_string(),
            },
            allowed_roots: Vec::new(),
            agent: Some("ambient-agent".to_string()),
            agent_id: None,
            role_id: None,
        };
        let req = events_trigger_ipc_request(
            &serde_json::json!({
                "agent_id": "agent-uuid",
                "agent": "explicit-name",
                "event_pattern": "start",
            }),
            &ctx,
        );

        assert_eq!(req["cmd"], "trigger_event");
        assert_eq!(req["agent_id"], "agent-uuid");
        assert_eq!(req["pattern"], "session:start");
        assert!(req.get("agent").is_none());
    }

    #[test]
    fn http_mcp_code_repo_resolution_prefers_explicit_repo_path() {
        let repo = tempfile::tempdir().unwrap();
        let configured = tempfile::tempdir().unwrap();
        let projects = vec![test_project("aeqi", configured.path())];

        let resolved = resolve_code_repo_path(
            &serde_json::json!({"repo_path": repo.path().to_string_lossy()}),
            &projects,
            "aeqi",
            None,
        )
        .unwrap()
        .unwrap();

        assert_eq!(resolved, std::fs::canonicalize(repo.path()).unwrap());
    }

    #[test]
    fn http_mcp_code_repo_resolution_uses_graph_metadata_without_config() {
        let repo = tempfile::tempdir().unwrap();
        let store = aeqi_graph::GraphStore::open_in_memory().unwrap();
        store
            .set_meta("repo_path", repo.path().to_string_lossy().as_ref())
            .unwrap();

        let resolved = resolve_code_repo_path(&serde_json::json!({}), &[], "aeqi", Some(&store))
            .unwrap()
            .unwrap();

        assert_eq!(resolved, std::fs::canonicalize(repo.path()).unwrap());
    }

    #[test]
    fn http_mcp_code_audit_discovers_projects_from_graph_dir_when_config_is_empty() {
        use std::process::Command;

        fn init_repo(path: &std::path::Path, file_name: &str, function_name: &str) {
            std::fs::create_dir_all(path.join("src")).unwrap();
            std::fs::write(
                path.join("src").join(file_name),
                format!("pub fn {function_name}() -> u32 {{ 1 }}\n"),
            )
            .unwrap();

            let init_status = Command::new("git")
                .arg("init")
                .current_dir(path)
                .status()
                .unwrap();
            assert!(init_status.success());

            let add_status = Command::new("git")
                .args(["add", "."])
                .current_dir(path)
                .status()
                .unwrap();
            assert!(add_status.success());

            let commit_status = Command::new("git")
                .args([
                    "-c",
                    "user.name=AEQI Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    "graph audit fixture",
                ])
                .current_dir(path)
                .status()
                .unwrap();
            assert!(commit_status.success());
        }

        let data_dir = tempfile::tempdir().unwrap();
        let repo_one = tempfile::tempdir().unwrap();
        let repo_two = tempfile::tempdir().unwrap();
        init_repo(repo_one.path(), "one.rs", "one");
        init_repo(repo_two.path(), "two.rs", "two");

        let graph_dir = data_dir.path().join("codegraph");
        std::fs::create_dir_all(&graph_dir).unwrap();

        let store_one = aeqi_graph::GraphStore::open(&graph_dir.join("one.db")).unwrap();
        aeqi_graph::Indexer::new()
            .index(repo_one.path(), &store_one)
            .unwrap();
        let store_two = aeqi_graph::GraphStore::open(&graph_dir.join("two.db")).unwrap();
        aeqi_graph::Indexer::new()
            .index(repo_two.path(), &store_two)
            .unwrap();

        let audit = code_graph_audit_report(data_dir.path(), &[], &serde_json::json!({})).unwrap();

        assert_eq!(audit["ok"], true);
        assert_eq!(audit["count"], 2);
        let entries = audit["projects"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert!(
            entries
                .iter()
                .all(|entry| entry["ok"].as_bool() == Some(true))
        );
        assert!(entries.iter().all(|entry| entry.get("health").is_some()));
    }

    #[test]
    fn http_mcp_code_tool_contract_exposes_repo_path_override() {
        let tools = tool_defs().as_array().cloned().unwrap();
        let code = tools
            .iter()
            .find(|tool| tool.get("name").and_then(|v| v.as_str()) == Some("code"))
            .unwrap();

        assert!(code["inputSchema"]["properties"].get("repo_path").is_some());
        assert!(code["inputSchema"]["properties"].get("cases").is_some());
        assert!(
            code["inputSchema"]["properties"]
                .get("min_recall")
                .is_some()
        );
    }

    #[test]
    fn http_mcp_browser_action_requires_quest_id() {
        let args = serde_json::json!({"action": "open", "url": "https://example.com"});
        assert!(required_arg(&args, "quest_id").is_err());
    }

    #[test]
    fn http_mcp_browser_request_allows_only_http_playwright() {
        let args = serde_json::json!({"url": "https://example.com", "backend": "playwright"});
        assert!(validate_browser_request(&args, "https://example.com").is_ok());
        assert!(validate_browser_request(&args, "file:///etc/passwd").is_err());

        let args = serde_json::json!({"url": "https://example.com", "backend": "cloakbrowser"});
        assert!(validate_browser_request(&args, "https://example.com").is_err());
    }

    #[test]
    fn http_mcp_browser_evidence_slug_is_filesystem_safe() {
        assert_eq!(
            browser_evidence_slug(Some("https://example.com/a path?q=1")),
            "https-example-com-a-path-q-1"
        );
    }

    #[test]
    fn http_mcp_tool_contracts_explain_user_workflow() {
        let tools = tool_defs().as_array().cloned().unwrap();
        let by_name = |name: &str| {
            tools
                .iter()
                .find(|tool| tool.get("name").and_then(|v| v.as_str()) == Some(name))
                .cloned()
                .unwrap()
        };

        let quests = by_name("quests");
        assert_eq!(quests["title"], "AEQI Quests");
        assert!(
            quests["description"]
                .as_str()
                .unwrap()
                .contains("list` with no `project`/`agent` returns all quests visible")
        );
        assert_eq!(quests["annotations"]["openWorldHint"], false);
        assert!(
            quests["inputSchema"]["properties"]
                .get("agent")
                .and_then(|v| v.get("description"))
                .and_then(|v| v.as_str())
                .unwrap()
                .contains("Omit for user/entity global quests")
        );

        let ideas = by_name("ideas");
        assert!(
            ideas["description"]
                .as_str()
                .unwrap()
                .contains("Company memory and idea graph")
        );
        assert!(ideas["inputSchema"]["properties"].get("query").is_some());

        let code = by_name("code");
        assert!(
            code["description"]
                .as_str()
                .unwrap()
                .contains("callers/callees/implementors")
        );
        assert!(code["inputSchema"]["properties"].get("node_id").is_some());
        let actions = code["inputSchema"]["properties"]["action"]["enum"]
            .as_array()
            .cloned()
            .unwrap();
        assert!(
            actions
                .iter()
                .any(|action| action.as_str() == Some("health"))
        );
        assert!(
            actions
                .iter()
                .any(|action| action.as_str() == Some("audit"))
        );
        assert!(
            actions
                .iter()
                .any(|action| action.as_str() == Some("benchmark"))
        );

        let browser = by_name("browser");
        assert_eq!(browser["title"], "AEQI Browser");
        assert_eq!(browser["annotations"]["readOnlyHint"], false);
        assert!(
            browser["description"]
                .as_str()
                .unwrap()
                .contains("Quest-scoped browser execution")
        );
        let browser_actions = browser["inputSchema"]["properties"]["action"]["enum"]
            .as_array()
            .cloned()
            .unwrap();
        assert!(
            browser_actions
                .iter()
                .any(|action| action.as_str() == Some("open"))
        );
        assert!(browser["inputSchema"]["properties"].get("url").is_some());
        assert!(
            browser["inputSchema"]["properties"]
                .get("backend")
                .is_some()
        );

        let apps = by_name("apps");
        assert_eq!(apps["title"], "AEQI Apps Proxy");
        assert!(
            apps["description"]
                .as_str()
                .unwrap()
                .contains("TRUST-role proxy")
        );
        assert!(
            apps["inputSchema"]["properties"]
                .get("credential_scope_kind")
                .is_some()
        );
        let app_actions = apps["inputSchema"]["properties"]["action"]["enum"]
            .as_array()
            .cloned()
            .unwrap();
        assert!(
            app_actions
                .iter()
                .any(|action| action.as_str() == Some("catalog"))
        );

        let integrations = by_name("integrations");
        assert_eq!(integrations["title"], "AEQI Integration Proxy");
        assert!(
            integrations["description"]
                .as_str()
                .unwrap()
                .contains("Compatibility alias")
        );
        assert!(
            integrations["inputSchema"]["properties"]
                .get("credential_scope_kind")
                .is_some()
        );
        assert_eq!(
            provider_for_integration_tool("google.request"),
            Some("google")
        );
        assert_eq!(
            provider_for_integration_tool("etsy_draft_listing_create"),
            Some("etsy")
        );
    }

    #[test]
    fn integration_catalog_describes_available_packs() {
        let catalog = integration_catalog(None);
        let providers = catalog
            .iter()
            .filter_map(|entry| entry["provider"].as_str())
            .collect::<Vec<_>>();

        for provider in ["google", "github", "notion", "slack", "etsy"] {
            assert!(providers.contains(&provider), "missing provider {provider}");
        }

        let etsy = catalog
            .iter()
            .find(|entry| entry["provider"] == "etsy")
            .expect("etsy catalog entry");
        assert_eq!(etsy["credential"]["default_scope_kind"], "trust");
        assert_eq!(etsy["auth_model"], "oauth2");
        assert!(etsy["tool_count"].as_u64().unwrap_or_default() >= 5);
        assert!(
            etsy["capabilities"]
                .as_array()
                .unwrap()
                .iter()
                .any(|cap| cap.as_str() == Some("draft_listings"))
        );

        let google_only = integration_catalog(Some("google"));
        assert_eq!(google_only.len(), 1);
        assert_eq!(google_only[0]["provider"], "google");
    }

    #[test]
    fn http_mcp_context_defaults_to_local_operator_without_scope() {
        let mut headers = HeaderMap::new();
        headers.insert("x-aeqi-caller-user-id", "spoofed-user".parse().unwrap());
        headers.insert("x-aeqi-caller-entity-id", "spoofed-entity".parse().unwrap());

        let ctx = mcp_context(None, &headers);

        assert_eq!(ctx.actor.kind, "local_operator");
        assert_eq!(ctx.actor.source, "self_hosted_local");
        assert_eq!(ctx.actor.user_id, None);
        assert_eq!(ctx.actor.trust_id, None);
        assert_eq!(ctx.actor.grants, vec!["*"]);
        assert!(ctx.allowed_roots.is_empty());
    }

    #[test]
    fn app_grants_accept_canonical_and_legacy_names() {
        let candidates = app_grant_candidates("google", "google.request");
        assert!(candidates.iter().any(|grant| grant == "apps.use"));
        assert!(candidates.iter().any(|grant| grant == "apps.google.use"));
        assert!(
            candidates
                .iter()
                .any(|grant| grant == "apps.google.google.request.use")
        );
        assert!(
            candidates
                .iter()
                .any(|grant| grant == "integrations.google.use")
        );
    }

    #[test]
    fn http_mcp_context_uses_scope_instead_of_spoofable_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-aeqi-caller-user-id", "spoofed-user".parse().unwrap());
        headers.insert("x-aeqi-caller-entity-id", "spoofed-entity".parse().unwrap());
        let scope = UserScope {
            roots: vec!["entity-1".to_string()],
            user_id: Some("user-1".to_string()),
        };

        let ctx = mcp_context(Some(&scope), &headers);

        assert_eq!(ctx.actor.kind, "user");
        assert_eq!(ctx.actor.user_id.as_deref(), Some("user-1"));
        assert_eq!(ctx.actor.trust_id.as_deref(), Some("entity-1"));
    }

    #[test]
    fn http_mcp_negotiates_supported_protocol_versions() {
        assert_eq!(
            negotiated_protocol(&serde_json::json!({"protocolVersion": "2025-06-18"})),
            "2025-06-18"
        );
        assert_eq!(
            negotiated_protocol(&serde_json::json!({"protocolVersion": "2025-03-26"})),
            "2025-03-26"
        );
        assert_eq!(
            negotiated_protocol(&serde_json::json!({"protocolVersion": "2024-11-05"})),
            "2024-11-05"
        );
        assert_eq!(negotiated_protocol(&serde_json::json!({})), "2025-06-18");
    }

    #[test]
    fn http_mcp_rejects_unsupported_protocol_header() {
        let mut headers = HeaderMap::new();
        headers.insert("mcp-protocol-version", "1999-01-01".parse().unwrap());

        assert!(validate_protocol_header(&headers).is_err());
    }

    #[test]
    fn http_mcp_accepts_event_stream_media_type() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::ACCEPT,
            "application/json, text/event-stream".parse().unwrap(),
        );

        assert!(accepts(&headers, "text/event-stream"));
        assert!(accepts(&headers, "application/json"));
        assert!(!accepts(&headers, "text/plain"));
    }
}
