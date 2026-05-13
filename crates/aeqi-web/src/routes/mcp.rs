use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use serde::{Deserialize, Serialize};

use crate::{auth::UserScope, extractors::Scope, server::AppState};

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
    entity_id: Option<String>,
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
        return response;
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
                        "content": [{"type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default()}]
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

fn validate_protocol_header(headers: &HeaderMap) -> Result<(), Response> {
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
        Some(version) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({
                "error": format!("unsupported MCP-Protocol-Version: {version}")
            })),
        )
            .into_response()),
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
    let allowed_roots = scope.map(|s| s.roots.clone()).unwrap_or_default();
    let entity_id = scope.and_then(|_| allowed_roots.first().cloned());
    let user_id = scope.and_then(|s| s.user_id.clone());

    let actor = McpActorContext {
        kind: if user_id.is_some() {
            "user".to_string()
        } else {
            "local_operator".to_string()
        },
        user_id,
        entity_id,
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
    if let Some(entity_id) = ctx.actor.entity_id.as_deref() {
        request["caller_entity_id"] = serde_json::json!(entity_id);
    }
}

async fn ipc(
    state: &AppState,
    ctx: &McpHttpContext,
    mut request: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    apply_actor(ctx, &mut request);
    Ok(state.ipc.request(&request).await?)
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
            "entity_id": ctx.actor.entity_id,
            "user_id": ctx.actor.user_id,
            "allowed_roots": ctx.allowed_roots,
            "actor": ctx.actor,
            "runtime": {"type": "http"},
        })),
        "ideas" => call_ideas(state, ctx, args).await,
        "quests" => call_quests(state, ctx, args).await,
        "agents" => call_agents(state, ctx, args).await,
        "events" => call_events(state, ctx, args).await,
        "code" => call_code(state, ctx, args).await,
        _ => anyhow::bail!("unknown tool: {tool_name}"),
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
            default_agent_id(ctx, &mut req);
            ipc(state, ctx, req).await
        }
        "search" => {
            let mut req = serde_json::json!({
                "cmd": "search_ideas",
                "query": args.get("query").and_then(|v| v.as_str()).unwrap_or(""),
                "top_k": args.get("limit").and_then(|v| v.as_u64()).unwrap_or(5),
            });
            default_agent_id(ctx, &mut req);
            copy_fields(
                &args,
                &mut req,
                &["tags", "explain", "route_hint", "include_superseded"],
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
            default_agent_id(ctx, &mut req);
            ipc(state, ctx, req).await
        }
        "feedback" => {
            let mut req = serde_json::json!({
                "cmd": "feedback_idea",
                "id": args.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                "signal": args.get("signal").and_then(|v| v.as_str()).unwrap_or(""),
            });
            copy_fields(&args, &mut req, &["weight", "note"]);
            default_agent_id(ctx, &mut req);
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
                &["max_hops", "relations", "strength_threshold", "limit"],
            );
            default_agent_id(ctx, &mut req);
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
            let mut req = args.clone();
            req["cmd"] = serde_json::json!("create_quest");
            default_agent_name(ctx, &mut req);
            if let Some(dep) = req.get("depends_on").cloned()
                && dep.is_string()
            {
                req["depends_on"] = serde_json::json!([dep.as_str().unwrap_or("")]);
            }
            ipc(state, ctx, req).await
        }
        "list" => {
            let mut req = serde_json::json!({
                "cmd": "quests",
                "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
            });
            copy_fields(&args, &mut req, &["status", "agent"]);
            default_agent_name(ctx, &mut req);
            ipc(state, ctx, req).await
        }
        "show" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "get_quest",
                    "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                }),
            )
            .await
        }
        "update" => {
            let mut req = serde_json::json!({
                "cmd": "update_quest",
                "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
            });
            copy_fields(&args, &mut req, &["status", "priority"]);
            ipc(state, ctx, req).await
        }
        "close" => {
            let mut req = args.clone();
            req["cmd"] = serde_json::json!("close_quest");
            ipc(state, ctx, req).await
        }
        "cancel" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "update_quest",
                    "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                    "status": "cancelled",
                    "reason": args.get("reason").and_then(|v| v.as_str()).unwrap_or("Cancelled"),
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
            copy_fields(&args, &mut req, &["cooldown_secs", "idea_ids"]);
            ipc(state, ctx, req).await
        }
        "list" => {
            let mut req = serde_json::json!({"cmd": "list_events"});
            if let Some(agent) = args.get("agent").cloned() {
                req["agent"] = agent;
            } else {
                default_agent_name(ctx, &mut req);
            }
            ipc(state, ctx, req).await
        }
        "enable" | "disable" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "update_event",
                    "event_id": args.get("event_id").and_then(|v| v.as_str()).unwrap_or(""),
                    "enabled": action == "enable",
                }),
            )
            .await
        }
        "delete" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "delete_event",
                    "event_id": args.get("event_id").and_then(|v| v.as_str()).unwrap_or(""),
                }),
            )
            .await
        }
        "trigger" => {
            ipc(
                state,
                ctx,
                serde_json::json!({
                    "cmd": "trigger_event",
                    "agent": args.get("agent").and_then(|v| v.as_str()).or(ctx.agent.as_deref()).unwrap_or(""),
                    "pattern": event_pattern(&args, "session:start"),
                }),
            )
            .await
        }
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
    } else {
        project_arg
    };
    let action = args
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("stats");
    let repo_path = state
        .mcp_projects
        .iter()
        .find(|p| p.name == project)
        .map(|p| std::path::PathBuf::from(expand_tilde(&p.repo)));
    let graph_dir = state.data_dir.join("codegraph");
    std::fs::create_dir_all(&graph_dir)?;
    let db_path = graph_dir.join(format!("{project}.db"));

    match action {
        "index" => {
            let repo = repo_path.ok_or_else(|| anyhow::anyhow!("project '{project}' not found"))?;
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let result = aeqi_graph::Indexer::new().index(&repo, &store)?;
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
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
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
                "nodes": stats.node_count,
                "edges": stats.edge_count,
                "files": stats.file_count,
                "indexed_at": store.get_meta("indexed_at")?.unwrap_or_default(),
            }))
        }
        "diff_impact" => {
            let repo = repo_path.ok_or_else(|| anyhow::anyhow!("project '{project}' not found"))?;
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let impact = aeqi_graph::Indexer::new().diff_impact(
                &repo,
                &store,
                args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as u32,
            )?;
            Ok(serde_json::json!({
                "ok": true,
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
            let repo = repo_path.ok_or_else(|| anyhow::anyhow!("project '{project}' not found"))?;
            let store = aeqi_graph::GraphStore::open(&db_path)?;
            let result = aeqi_graph::Indexer::new().index_incremental(&repo, &store)?;
            Ok(serde_json::json!({
                "ok": true,
                "project": project,
                "result": result.to_string(),
                "files": result.files_parsed,
                "nodes": result.nodes,
                "edges": result.edges,
            }))
        }
        "synthesize" => anyhow::bail!(
            "code.synthesize is available on stdio MCP; HTTP MCP currently supports index/search/context/impact/file/stats/diff_impact/file_summary/incremental"
        ),
        _ => anyhow::bail!("unknown code action: {action}"),
    }
}

fn default_agent_id(ctx: &McpHttpContext, req: &mut serde_json::Value) {
    if req.get("agent_id").and_then(|v| v.as_str()).is_none()
        && let Some(agent_id) = ctx.agent_id.as_deref()
    {
        req["agent_id"] = serde_json::json!(agent_id);
    }
}

fn default_agent_name(ctx: &McpHttpContext, req: &mut serde_json::Value) {
    if req.get("agent").and_then(|v| v.as_str()).is_none()
        && let Some(agent) = ctx.agent.as_deref()
    {
        req["agent"] = serde_json::json!(agent);
    }
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
            "description": "Return the authenticated MCP actor, entity scope, runtime transport, and authorization envelope.",
            "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["profile", "permissions"]}}}
        },
        {
            "name": "ideas",
            "description": "Persistent knowledge store: store, search, update, delete, link, feedback, and graph walk ideas.",
            "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["store", "search", "update", "delete", "link", "feedback", "walk"]}}, "required": ["action"]}
        },
        {
            "name": "quests",
            "description": "Track units of work with create, list, show, update, close, and cancel.",
            "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["create", "list", "show", "update", "close", "cancel"]}, "project": {"type": "string"}}, "required": ["action", "project"]}
        },
        {
            "name": "agents",
            "description": "Inspect and manage agents: get, list, hire, retire, and projects.",
            "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["get", "hire", "retire", "list", "projects"]}}, "required": ["action"]}
        },
        {
            "name": "events",
            "description": "Manage event handlers and trigger lifecycle events.",
            "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["create", "list", "enable", "disable", "delete", "trigger", "trace"]}}, "required": ["action"]}
        },
        {
            "name": "code",
            "description": "Code intelligence graph: index, search, context, impact, file, stats, diff_impact, file_summary, and incremental.",
            "inputSchema": {"type": "object", "properties": {"action": {"type": "string", "enum": ["search", "context", "impact", "file", "stats", "index", "diff_impact", "file_summary", "incremental"]}, "project": {"type": "string"}}, "required": ["action", "project"]}
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_mcp_context_builds_user_actor_from_scope() {
        let mut headers = HeaderMap::new();
        headers.insert("x-aeqi-agent", "architect".parse().unwrap());
        let scope = UserScope {
            roots: vec!["entity-1".to_string()],
            user_id: Some("user-1".to_string()),
        };

        let ctx = mcp_context(Some(&scope), &headers);

        assert_eq!(ctx.actor.kind, "user");
        assert_eq!(ctx.actor.user_id.as_deref(), Some("user-1"));
        assert_eq!(ctx.actor.entity_id.as_deref(), Some("entity-1"));
        assert_eq!(ctx.agent.as_deref(), Some("architect"));
        assert_eq!(ctx.allowed_roots, vec!["entity-1"]);
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
        assert_eq!(ctx.actor.entity_id, None);
        assert_eq!(ctx.actor.grants, vec!["*"]);
        assert!(ctx.allowed_roots.is_empty());
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
        assert_eq!(ctx.actor.entity_id.as_deref(), Some("entity-1"));
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
