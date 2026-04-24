use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Instant;

use crate::helpers::load_config;

#[derive(Debug, Deserialize)]
struct McpRequest {
    // Required by JSON-RPC 2.0 framing; parsed to reject non-conforming
    // payloads but never read thereafter — responses always set "2.0".
    #[allow(dead_code)]
    jsonrpc: String,
    id: Option<serde_json::Value>,
    method: String,
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

#[derive(Debug, Serialize)]
struct ToolDef {
    name: String,
    description: String,
    #[serde(rename = "inputSchema")]
    input_schema: serde_json::Value,
}

fn ipc_request_sync(
    sock_path: &std::path::Path,
    request: &serde_json::Value,
) -> Result<serde_json::Value> {
    let stream = std::os::unix::net::UnixStream::connect(sock_path)?;
    let mut writer = io::BufWriter::new(&stream);
    let mut reader = io::BufReader::new(&stream);

    let mut req_bytes = serde_json::to_vec(request)?;
    req_bytes.push(b'\n');
    writer.write_all(&req_bytes)?;
    writer.flush()?;

    let mut line = String::new();
    reader.read_line(&mut line)?;
    let response: serde_json::Value = serde_json::from_str(&line)?;
    Ok(response)
}

/// Validate keys against the platform and return the runtime socket path.
/// secret_key (sk_) is required, api_key (ak_) is optional for analytics.
fn validate_api_key(
    secret_key: &str,
    api_key: Option<&str>,
    platform_url: &str,
) -> Result<PathBuf> {
    let url = format!("{platform_url}/api/mcp/validate");
    let client = std::net::TcpStream::connect(
        url.trim_start_matches("http://")
            .trim_start_matches("https://")
            .split('/')
            .next()
            .unwrap_or("127.0.0.1:8443"),
    )?;

    // Build HTTP request manually to avoid async dependency.
    let host = url
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .split('/')
        .next()
        .unwrap_or("127.0.0.1:8443");
    let api_key_header = match api_key {
        Some(ak) => format!("X-Api-Key: {ak}\r\n"),
        None => String::new(),
    };
    let request = format!(
        "POST /api/mcp/validate HTTP/1.1\r\n\
         Host: {host}\r\n\
         Authorization: Bearer {secret_key}\r\n\
         {api_key_header}\
         Content-Length: 0\r\n\
         Connection: close\r\n\
         \r\n"
    );

    let mut writer = io::BufWriter::new(&client);
    let mut reader = io::BufReader::new(&client);
    writer.write_all(request.as_bytes())?;
    writer.flush()?;

    // Read HTTP response.
    let mut response = String::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            break;
        }
        response.push_str(&line);
    }

    // Parse: skip headers, find JSON body after blank line.
    let body = response.split("\r\n\r\n").nth(1).unwrap_or(&response);

    // Handle chunked transfer encoding — extract the JSON from chunks.
    let json_body = if body.contains('{') {
        let start = body.find('{').unwrap_or(0);
        let end = body.rfind('}').map(|i| i + 1).unwrap_or(body.len());
        &body[start..end]
    } else {
        body
    };

    let parsed: serde_json::Value = serde_json::from_str(json_body)
        .map_err(|e| anyhow::anyhow!("platform returned invalid JSON: {e}\nbody: {json_body}"))?;

    if !parsed.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(anyhow::anyhow!("API key validation failed: {error}"));
    }

    let socket = parsed
        .get("runtime")
        .and_then(|r| r.get("socket"))
        .and_then(|s| s.as_str())
        .ok_or_else(|| anyhow::anyhow!("platform did not return a runtime socket path"))?;

    let root = parsed
        .get("company")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    eprintln!("[aeqi-mcp] authenticated as root '{root}'");

    Ok(PathBuf::from(socket))
}

pub fn cmd_mcp(config_path: &Option<PathBuf>) -> Result<()> {
    let (config, ..) = load_config(config_path)?;

    // Resolve agent identity: AEQI_AGENT scopes all operations to a specific agent.
    let agent_name = std::env::var("AEQI_AGENT").ok();
    let agent_id = std::env::var("AEQI_AGENT_ID").ok();
    if let Some(ref name) = agent_name {
        eprintln!("[aeqi-mcp] agent scope: {name}");
    }

    // Resolve IPC socket: secret key auth (hosted root runtime) or local daemon fallback.
    let sock_path = if let Ok(secret_key) = std::env::var("AEQI_SECRET_KEY") {
        let api_key = std::env::var("AEQI_API_KEY").ok();
        let platform_url = std::env::var("AEQI_PLATFORM_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8443".to_string());
        validate_api_key(&secret_key, api_key.as_deref(), &platform_url)?
    } else {
        config.data_dir().join("rm.sock")
    };

    let tools = vec![
        // ── Ideas (unified: store | search | update | delete) ───────────────
        ToolDef {
            name: "ideas".to_string(),
            description: "Persistent knowledge store. Search, store, update, or delete ideas — facts, procedures, preferences, architecture decisions, skills, and context worth remembering across sessions.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["store", "search", "update", "delete"],
                        "description": "store: save knowledge (needs name, content, tags). search: find ideas by natural language query (needs query). update: modify an idea by ID (needs id plus name/content/tags). delete: remove an idea by ID (needs id)."
                    },
                    "id": {"type": "string", "description": "Idea ID (for update, delete)"},
                    "name": {"type": "string", "description": "Short slug name, e.g. 'auth/jwt-rotation' (for store, update). Same name+agent within 24h is deduplicated on store."},
                    "content": {"type": "string", "description": "The knowledge to store or replace (for store, update)"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to classify the idea. Common: fact, procedure, preference, context, evergreen, skill, architecture. Multiple tags supported."},
                    "agent_id": {"type": "string", "description": "Agent ID to scope the idea to. Defaults to the session's AEQI_AGENT_ID (entity scope). Omit to create/search global (agent_id=NULL) ideas."},
                    "query": {"type": "string", "description": "Natural language search query (for search). Uses full-text search + optional vector similarity."},
                    "limit": {"type": "integer", "description": "Max results (for search, default: 5)"}
                },
                "required": ["action"]
            }),
        },
        // ── Quests (unified: create | list | show | update | close | cancel) ──
        ToolDef {
            name: "quests".to_string(),
            description: "Track units of work. Quests support dependencies, parent-child hierarchy, and priority. Use for multi-step tasks worth tracking. Each quest can own a git worktree branch.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "show", "update", "close", "cancel"],
                        "description": "create: new quest (needs subject). list: show quests (optional status, agent). show: details (needs quest_id). update: change status/priority (needs quest_id). close: complete (needs quest_id, result). cancel: abort (needs quest_id)."
                    },
                    "project": {"type": "string"},
                    "quest_id": {"type": "string", "description": "Quest ID (for show/update/close/cancel)"},
                    "subject": {"type": "string", "description": "Quest subject (for create). Prefix with 'claim:' for atomic resource locking."},
                    "description": {"type": "string", "description": "Quest description (for create)"},
                    "agent": {"type": "string", "description": "Agent name (for create, list)"},
                    "idea_ids": {"type": "array", "items": {"type": "string"}, "description": "Idea IDs to reference (for create)"},
                    "labels": {"type": "array", "items": {"type": "string"}, "description": "Tags for categorization (for create)"},
                    "depends_on": {
                        "oneOf": [
                            {"type": "string", "description": "Single quest ID"},
                            {"type": "array", "items": {"type": "string"}, "description": "Quest IDs"}
                        ],
                        "description": "Quest ID(s) that must complete first (for create)"
                    },
                    "parent": {"type": "string", "description": "Parent quest ID — makes this a child quest (for create)"},
                    "status": {"type": "string", "enum": ["pending", "in_progress", "done", "blocked", "cancelled"], "description": "Filter or new status (for list, update)"},
                    "priority": {"type": "string", "enum": ["low", "normal", "high", "critical"], "description": "Priority (for create, update)"},
                    "result": {"type": "string", "description": "Completion result (for close)"},
                    "reason": {"type": "string", "description": "Cancellation reason (for cancel)"},
                    "finalize": {"type": "string", "enum": ["merge", "commit", "discard"], "description": "What to do with the quest's worktree on close. merge (default): commit + merge to main. commit: commit but keep branch. discard: throw away changes."}
                },
                "required": ["action", "project"]
            }),
        },
        // ── Agents (unified: hire | retire | list | delegate) ──────
        ToolDef {
            name: "agents".to_string(),
            description: "Manage agents in the agent tree. get: full agent profile with assembled ideas (session primer). list: all agents. hire: spawn from template. retire: deactivate. delegate: assemble a subagent prompt with quest context. projects: list configured projects.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["get", "hire", "retire", "list", "projects"],
                        "description": "get: full agent profile with assembled ideas (needs agent). hire: spawn from template. retire: deactivate. list: show agents. projects: list configured projects. To delegate work, use quests(action='create', agent='target-name')."
                    },
                    "project": {"type": "string", "description": "Project name"},
                    "template": {"type": "string", "description": "Template name, e.g. 'shadow', 'analyst' (for hire)"},
                    "agent": {"type": "string", "description": "Agent name or ID (for get, retire)"},
                    "status": {"type": "string", "enum": ["active", "paused", "retired", "all"], "description": "Filter by status (for list, default: active)"},
                },
                "required": ["action"]
            }),
        },
        // ── Events (new: create | list | enable | disable | delete) ──
        ToolDef {
            name: "events".to_string(),
            description: "Manage event handlers and trigger lifecycle events. Events bind ideas to lifecycle patterns (session:start, quest_start, etc.) or cron schedules. Use trigger to fire an event and receive the assembled ideas context.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "enable", "disable", "delete", "trigger", "trace"],
                        "description": "create: new handler (needs name, pattern or schedule, idea_ids). list: show handlers. enable/disable: toggle (needs event_id). delete: remove (needs event_id). trigger: fire an event pattern and return the assembled ideas context — same context the runtime injects during its lifecycle (optional pattern, defaults to session:start). trace: query event invocation history — pass session_id + optional limit to list invocations, or invocation_id for full step detail."
                    },
                    "agent": {"type": "string", "description": "Agent name or ID"},
                    "name": {"type": "string", "description": "Event handler name (for create)"},
                    "pattern": {"type": "string", "description": "Full pattern (e.g. 'schedule:0 9 * * *', 'session:quest_result')"},
                    "schedule": {"type": "string", "description": "Cron expression — shorthand for pattern 'schedule:<expr>'"},
                    "event_pattern": {"type": "string", "description": "Session event — shorthand for pattern 'session:<event>' (e.g. 'start', 'quest_start', 'quest_end', 'quest_result')"},
                    "cooldown_secs": {"type": "integer", "description": "Minimum seconds between fires"},
                    "idea_ids": {"type": "array", "items": {"type": "string"}, "description": "Idea IDs to reference (for create)"},
                    "event_id": {"type": "string", "description": "Event handler ID (for enable/disable/delete)"},
                    "session_id": {"type": "string", "description": "Session ID — list invocations for this session (for trace)"},
                    "invocation_id": {"type": "integer", "description": "Invocation ID — fetch full step detail (for trace)"},
                    "limit": {"type": "integer", "description": "Max results to return (for trace list, default 50)"}
                },
                "required": ["action"]
            }),
        },
        // ── Code (unified graph intelligence) ──────────────────────
        ToolDef {
            name: "code".to_string(),
            description: "Code intelligence graph. Search symbols, get 360° context (callers/callees/implementors), analyze blast radius of changes before refactoring. Use diff_impact to see what your uncommitted changes affect. Use incremental to re-index after code changes.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["search", "context", "impact", "file", "stats", "index", "diff_impact", "file_summary", "incremental", "synthesize"], "description": "search: find symbols by name (read). context: 360° view — callers, callees, implementors (read). impact: blast radius from a symbol (read). diff_impact: blast radius from uncommitted changes (read). file: list symbols in a file (read). file_summary: summary of a file (read). stats: graph statistics (read). index: full re-index of project (write). incremental: re-index only changed files (write). synthesize: generate community summary (write)."},
                    "project": {"type": "string", "description": "Project name"},
                    "query": {"type": "string", "description": "Search query (for search action)"},
                    "node_id": {"type": "string", "description": "Node ID (for context/impact actions)"},
                    "file_path": {"type": "string", "description": "File path relative to project root (for file/file_summary actions)"},
                    "depth": {"type": "integer", "description": "Max traversal depth (impact/diff_impact, default 3)", "default": 3},
                    "limit": {"type": "integer", "description": "Max results (default 10)", "default": 10},
                    "community_id": {"type": "string", "description": "Community ID (for synthesize action)"}
                },
                "required": ["action", "project"]
            }),
        },
    ];

    // Recall result cache: avoids redundant IPC queries within a session.
    // Entries older than 5 minutes are treated as stale.
    let mut recall_cache: HashMap<String, (Instant, serde_json::Value)> = HashMap::new();
    const RECALL_CACHE_TTL_SECS: u64 = 300;

    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let request: McpRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let response = match request.method.as_str() {
            "initialize" => McpResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id.unwrap_or(serde_json::Value::Null),
                result: Some(serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": "aeqi",
                        "version": "5.0.0",
                        "agent": agent_name.as_deref().unwrap_or("default"),
                        "agent_id": agent_id.as_deref().unwrap_or(""),
                    }
                })),
                error: None,
            },
            "notifications/initialized" => continue,
            "tools/list" => McpResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id.unwrap_or(serde_json::Value::Null),
                result: Some(serde_json::json!({"tools": tools})),
                error: None,
            },
            "tools/call" => {
                let tool_name = request
                    .params
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("");
                let args = request.params.get("arguments").cloned().unwrap_or_default();

                let result = match tool_name {
                    // ── Ideas (unified) ────────────────────────────
                    "ideas" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("search");
                        match action {
                            "store" => {
                                let mut ipc = args.clone();
                                ipc["cmd"] = serde_json::json!("store_idea");
                                if ipc.get("agent_id").and_then(|v| v.as_str()).is_none()
                                    && let Some(ref aid) = agent_id
                                {
                                    ipc["agent_id"] = serde_json::json!(aid);
                                }
                                recall_cache.clear();
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "search" => {
                                let query =
                                    args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                                let search_agent_id = args
                                    .get("agent_id")
                                    .and_then(|v| v.as_str())
                                    .or(agent_id.as_deref());
                                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(5);

                                let agent_key = search_agent_id.unwrap_or("");
                                let tags_key =
                                    args.get("tags").map(|v| v.to_string()).unwrap_or_default();
                                let cache_key =
                                    format!("{query}\0{agent_key}\0{tags_key}\0{limit}");

                                let cached_hit =
                                    recall_cache.get(&cache_key).and_then(|(ts, val)| {
                                        if ts.elapsed().as_secs() < RECALL_CACHE_TTL_SECS {
                                            Some(val.clone())
                                        } else {
                                            None
                                        }
                                    });

                                if let Some(val) = cached_hit {
                                    Ok(val)
                                } else {
                                    recall_cache.remove(&cache_key);
                                    let mut ipc = serde_json::json!({
                                        "cmd": "search_ideas",
                                        "query": query,
                                        "top_k": limit,
                                    });
                                    if let Some(aid) = search_agent_id {
                                        ipc["agent_id"] = serde_json::json!(aid);
                                    }
                                    if let Some(tags) = args.get("tags") {
                                        ipc["tags"] = tags.clone();
                                    }
                                    let r = ipc_request_sync(&sock_path, &ipc);
                                    if let Ok(ref val) = r {
                                        recall_cache
                                            .insert(cache_key, (Instant::now(), val.clone()));
                                    }
                                    r
                                }
                            }
                            "update" => {
                                let mut ipc = serde_json::json!({
                                    "cmd": "update_idea",
                                    "id": args.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                if let Some(name) = args.get("name").and_then(|v| v.as_str()) {
                                    ipc["name"] = serde_json::json!(name);
                                }
                                if let Some(content) = args.get("content").and_then(|v| v.as_str())
                                {
                                    ipc["content"] = serde_json::json!(content);
                                }
                                if let Some(tags) = args.get("tags") {
                                    ipc["tags"] = tags.clone();
                                }
                                recall_cache.clear();
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "delete" => {
                                let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                recall_cache.clear();
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "delete_idea",
                                        "id": id,
                                    }),
                                )
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown ideas action: {action}. Use: store, search, update, delete"
                            )),
                        }
                    }

                    // ── Quests (unified) ───────────────────────────
                    "quests" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("list");
                        match action {
                            "create" => {
                                let mut ipc = args.clone();
                                ipc["cmd"] = serde_json::json!("create_quest");
                                // Default agent to AEQI_AGENT if not specified.
                                if ipc.get("agent").and_then(|v| v.as_str()).is_none()
                                    && let Some(ref aname) = agent_name
                                {
                                    ipc["agent"] = serde_json::json!(aname);
                                }
                                // Normalize depends_on: string → array
                                if let Some(dep) = ipc.get("depends_on").cloned()
                                    && dep.is_string()
                                {
                                    ipc["depends_on"] =
                                        serde_json::json!([dep.as_str().unwrap_or("")]);
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "list" => {
                                let mut ipc = serde_json::json!({
                                    "cmd": "quests",
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                if let Some(status) = args.get("status") {
                                    ipc["status"] = status.clone();
                                }
                                // Default agent filter to AEQI_AGENT if not specified.
                                if let Some(agent) = args.get("agent") {
                                    ipc["agent"] = agent.clone();
                                } else if let Some(ref aname) = agent_name {
                                    ipc["agent"] = serde_json::json!(aname);
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "show" => ipc_request_sync(
                                &sock_path,
                                &serde_json::json!({
                                    "cmd": "get_quest",
                                    "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                }),
                            ),
                            "update" => {
                                let mut ipc = serde_json::json!({
                                    "cmd": "update_quest",
                                    "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                if let Some(status) = args.get("status") {
                                    ipc["status"] = status.clone();
                                }
                                if let Some(priority) = args.get("priority") {
                                    ipc["priority"] = priority.clone();
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "close" => {
                                let _project = args
                                    .get("project")
                                    .and_then(|v| v.as_str())
                                    .or_else(|| {
                                        args.get("quest_id")
                                            .and_then(|v| v.as_str())
                                            .and_then(|id| id.split('-').next())
                                    })
                                    .unwrap_or("");
                                let _quest_id =
                                    args.get("quest_id").and_then(|v| v.as_str()).unwrap_or("");
                                let mut ipc = args.clone();
                                ipc["cmd"] = serde_json::json!("close_quest");

                                // Enrich: check if review was posted for this quest
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "cancel" => {
                                let quest_id =
                                    args.get("quest_id").and_then(|v| v.as_str()).unwrap_or("");
                                let reason = args
                                    .get("reason")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Cancelled");
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "update_quest",
                                        "quest_id": quest_id,
                                        "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                        "status": "cancelled",
                                        "reason": reason,
                                    }),
                                )
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown quests action: {action}. Use: create, list, show, update, close, cancel"
                            )),
                        }
                    }

                    // ── Agents (unified) ───────────────────────────
                    "agents" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("list");
                        match action {
                            "get" => {
                                let agent_hint = args
                                    .get("agent")
                                    .and_then(|v| v.as_str())
                                    .or(agent_name.as_deref())
                                    .unwrap_or("");
                                // Fetch agent info.
                                let agent_resp = ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "agent_info",
                                        "name": agent_hint,
                                    }),
                                );
                                // Fetch assembled ideas for on_session_start — reuses the
                                // read-only trigger_event path (no record_fire, same as preflight).
                                // The old "assemble_ideas" cmd never had a daemon handler, so this
                                // field silently came back empty despite the tool advertising it.
                                let ideas_resp = ipc_request_sync(
                                    &sock_path,
                                    &agents_get_context_ipc_request(agent_hint),
                                );
                                // Fetch agent's events.
                                let events_resp = ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "list_events",
                                        "agent": agent_hint,
                                    }),
                                );
                                let mut result = agent_resp.unwrap_or_else(|_| {
                                    serde_json::json!({"ok": false, "error": "agent not found"})
                                });
                                if let Some(assembled) = ideas_resp
                                    .ok()
                                    .and_then(|r| r.get("system_prompt").cloned())
                                {
                                    result["context"] = assembled;
                                }
                                if let Some(events) =
                                    events_resp.ok().and_then(|r| r.get("events").cloned())
                                {
                                    result["events"] = events;
                                }
                                Ok(result)
                            }
                            "hire" => {
                                let template =
                                    args.get("template").and_then(|v| v.as_str()).unwrap_or("");
                                let mut ipc = serde_json::json!({
                                    "cmd": "agent_spawn",
                                    "template": template,
                                });
                                if let Some(parent) = args.get("parent_id").and_then(|v| v.as_str())
                                {
                                    ipc["parent_id"] = serde_json::json!(parent);
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "retire" => {
                                let agent_hint =
                                    args.get("agent").and_then(|v| v.as_str()).unwrap_or("");
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "agent_set_status",
                                        "name": agent_hint,
                                        "status": "retired",
                                    }),
                                )
                            }
                            "list" => {
                                let mut ipc = serde_json::json!({"cmd": "agents_registry"});
                                if let Some(status) = args.get("status").and_then(|v| v.as_str()) {
                                    ipc["status"] = serde_json::json!(status);
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "projects" => {
                                let projects: Vec<serde_json::Value> = config
                                    .agent_spawns
                                    .iter()
                                    .map(|p| {
                                        serde_json::json!({
                                            "name": p.name,
                                            "prefix": p.prefix,
                                            "repo": p.repo,
                                        })
                                    })
                                    .collect();
                                Ok(serde_json::json!({"ok": true, "projects": projects}))
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown agents action: {action}. Use: get, hire, retire, list, projects. \
                                 To delegate work, use quests(action='create', agent='target-name')."
                            )),
                        }
                    }

                    // ── Events (new) ───────────────────────────────
                    "events" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("list");
                        match action {
                            "create" => {
                                let agent = args
                                    .get("agent")
                                    .and_then(|v| v.as_str())
                                    .or(agent_name.as_deref())
                                    .unwrap_or("");
                                let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
                                // Build pattern from shorthand or explicit
                                let pattern = if let Some(schedule) =
                                    args.get("schedule").and_then(|v| v.as_str())
                                {
                                    format!("schedule:{schedule}")
                                } else if let Some(event) =
                                    args.get("event_pattern").and_then(|v| v.as_str())
                                {
                                    format!("session:{event}")
                                } else {
                                    args.get("pattern")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string()
                                };

                                let mut ipc = serde_json::json!({
                                    "cmd": "create_event",
                                    "agent": agent,
                                    "name": name,
                                    "pattern": pattern,
                                });
                                if let Some(cooldown) = args.get("cooldown_secs") {
                                    ipc["cooldown_secs"] = cooldown.clone();
                                }
                                if let Some(idea_ids) = args.get("idea_ids") {
                                    ipc["idea_ids"] = idea_ids.clone();
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "list" => {
                                let mut ipc = serde_json::json!({"cmd": "list_events"});
                                if let Some(agent) = args.get("agent") {
                                    ipc["agent"] = agent.clone();
                                } else if let Some(ref aname) = agent_name {
                                    ipc["agent"] = serde_json::json!(aname);
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "enable" | "disable" => {
                                let event_id =
                                    args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "update_event",
                                        "event_id": event_id,
                                        "enabled": action == "enable",
                                    }),
                                )
                            }
                            "delete" => {
                                let event_id =
                                    args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "delete_event",
                                        "event_id": event_id,
                                    }),
                                )
                            }
                            "trigger" => {
                                let agent = args
                                    .get("agent")
                                    .and_then(|v| v.as_str())
                                    .or(agent_name.as_deref())
                                    .unwrap_or("");
                                // Build pattern from shorthand or explicit
                                let pattern = if let Some(event) =
                                    args.get("event_pattern").and_then(|v| v.as_str())
                                {
                                    format!("session:{event}")
                                } else {
                                    args.get("pattern")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("session:start")
                                        .to_string()
                                };
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "trigger_event",
                                        "agent": agent,
                                        "pattern": pattern,
                                    }),
                                )
                            }
                            "trace" => {
                                // Two modes:
                                // - { session_id, limit? } → list invocations
                                // - { invocation_id }       → detail + steps
                                if let Some(inv_id) =
                                    args.get("invocation_id").and_then(|v| v.as_i64())
                                {
                                    ipc_request_sync(
                                        &sock_path,
                                        &serde_json::json!({
                                            "cmd": "trace_events",
                                            "invocation_id": inv_id,
                                        }),
                                    )
                                } else {
                                    let session_id = args
                                        .get("session_id")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    let limit =
                                        args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50);
                                    ipc_request_sync(
                                        &sock_path,
                                        &serde_json::json!({
                                            "cmd": "trace_events",
                                            "session_id": session_id,
                                            "limit": limit,
                                        }),
                                    )
                                }
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown events action: {action}. Use: create, list, enable, disable, delete, trigger, trace"
                            )),
                        }
                    }

                    // ── Code (graph intelligence) ──────────────────
                    "code" => {
                        let project_arg =
                            args.get("project").and_then(|v| v.as_str()).unwrap_or("");
                        // Default to first configured project when not specified.
                        let project = if project_arg.is_empty() {
                            config
                                .agent_spawns
                                .first()
                                .map(|c| c.name.as_str())
                                .unwrap_or("code")
                        } else {
                            project_arg
                        };
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("stats");

                        // Find project repo path from config
                        let repo_path =
                            config
                                .agent_spawns
                                .iter()
                                .find(|p| p.name == project)
                                .map(|p| {
                                    let r = p.repo.replace(
                                        '~',
                                        &dirs::home_dir().unwrap_or_default().to_string_lossy(),
                                    );
                                    std::path::PathBuf::from(r)
                                });

                        let graph_dir = config.data_dir().join("codegraph");
                        std::fs::create_dir_all(&graph_dir).ok();
                        let db_path = graph_dir.join(format!("{project}.db"));

                        match action {
                            "index" => {
                                let repo = repo_path.ok_or_else(|| {
                                    anyhow::anyhow!("project '{project}' not found in config")
                                })?;
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let indexer = aeqi_graph::Indexer::new();
                                let result = indexer.index(&repo, &store)?;
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
                                let query =
                                    args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10)
                                    as usize;
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let results = store.search_nodes(query, limit)?;
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "count": results.len(),
                                    "nodes": results,
                                }))
                            }
                            "context" => {
                                let node_id =
                                    args.get("node_id").and_then(|v| v.as_str()).unwrap_or("");
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let ctx = store.context(node_id)?;
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
                                let node_id =
                                    args.get("node_id").and_then(|v| v.as_str()).unwrap_or("");
                                let depth =
                                    args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as u32;
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let entries = store.impact(&[node_id], depth)?;
                                let affected: Vec<serde_json::Value> = entries
                                    .iter()
                                    .map(|e| {
                                        serde_json::json!({
                                            "node": e.node,
                                            "depth": e.depth,
                                        })
                                    })
                                    .collect();
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "source": node_id,
                                    "affected_count": affected.len(),
                                    "affected": affected,
                                }))
                            }
                            "file" => {
                                let file_path =
                                    args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let nodes = store.nodes_in_file(file_path)?;
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "file": file_path,
                                    "count": nodes.len(),
                                    "nodes": nodes,
                                }))
                            }
                            "stats" => {
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let stats = store.stats()?;
                                let indexed_at = store.get_meta("indexed_at")?.unwrap_or_default();
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "project": project,
                                    "nodes": stats.node_count,
                                    "edges": stats.edge_count,
                                    "files": stats.file_count,
                                    "indexed_at": indexed_at,
                                }))
                            }
                            "diff_impact" => {
                                let repo = repo_path.ok_or_else(|| {
                                    anyhow::anyhow!("project '{project}' not found")
                                })?;
                                let depth =
                                    args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as u32;
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let indexer = aeqi_graph::Indexer::new();
                                let impact = indexer.diff_impact(&repo, &store, depth)?;
                                let changed: Vec<serde_json::Value> = impact.changed_symbols.iter().map(|s| {
                                    serde_json::json!({"name": s.name, "label": s.label, "file": s.file_path, "line": s.start_line})
                                }).collect();
                                let affected: Vec<serde_json::Value> = impact.affected.iter().map(|e| {
                                    serde_json::json!({"name": e.node.name, "label": e.node.label, "file": e.node.file_path, "depth": e.depth})
                                }).collect();
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "changed_files": impact.changed_files,
                                    "changed_symbols": changed,
                                    "affected_count": affected.len(),
                                    "affected": affected,
                                }))
                            }
                            "file_summary" => {
                                let file_path =
                                    args.get("file_path").and_then(|v| v.as_str()).unwrap_or("");
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let summary = store.file_summary(file_path)?;
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "file": file_path,
                                    "summary": summary,
                                }))
                            }
                            "incremental" => {
                                let repo = repo_path.ok_or_else(|| {
                                    anyhow::anyhow!("project '{project}' not found")
                                })?;
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let indexer = aeqi_graph::Indexer::new();
                                let result = indexer.index_incremental(&repo, &store)?;
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "project": project,
                                    "result": result.to_string(),
                                    "files": result.files_parsed,
                                    "nodes": result.nodes,
                                    "edges": result.edges,
                                }))
                            }
                            "synthesize" => {
                                let community_id = args
                                    .get("community_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let store = aeqi_graph::GraphStore::open(&db_path)?;

                                let all_nodes: Vec<aeqi_graph::CodeNode> = {
                                    let mut stmt = store.conn().prepare(
                                        "SELECT id, label, name, file_path, start_line, end_line, language, is_exported, signature, doc_comment, community_id FROM code_nodes"
                                    )?;
                                    stmt.query_map([], |row| {
                                        Ok(aeqi_graph::CodeNode {
                                            id: row.get(0)?,
                                            label: serde_json::from_str(&format!(
                                                "\"{}\"",
                                                row.get::<_, String>(1)?
                                            ))
                                            .unwrap_or(aeqi_graph::NodeLabel::Function),
                                            name: row.get(2)?,
                                            file_path: row.get(3)?,
                                            start_line: row.get(4)?,
                                            end_line: row.get(5)?,
                                            language: row.get(6)?,
                                            is_exported: row.get(7)?,
                                            signature: row.get(8)?,
                                            doc_comment: row.get(9)?,
                                            community_id: row.get(10)?,
                                        })
                                    })?
                                    .filter_map(|r| r.ok())
                                    .collect()
                                };

                                let all_edges: Vec<aeqi_graph::CodeEdge> = {
                                    let mut stmt = store.conn().prepare(
                                        "SELECT source_id, target_id, edge_type, confidence, tier, step FROM code_edges"
                                    )?;
                                    stmt.query_map([], |row| {
                                        Ok(aeqi_graph::CodeEdge {
                                            source_id: row.get(0)?,
                                            target_id: row.get(1)?,
                                            edge_type: serde_json::from_str(&format!(
                                                "\"{}\"",
                                                row.get::<_, String>(2)?
                                            ))
                                            .unwrap_or(aeqi_graph::EdgeType::Uses),
                                            confidence: row.get(3)?,
                                            tier: row.get(4)?,
                                            step: row.get(5)?,
                                        })
                                    })?
                                    .filter_map(|r| r.ok())
                                    .collect()
                                };

                                let communities =
                                    aeqi_graph::detect_communities(&all_nodes, &all_edges, 3);
                                let community = if community_id.is_empty() {
                                    communities.first()
                                } else {
                                    communities.iter().find(|c| c.id == community_id)
                                };

                                match community {
                                    Some(comm) => {
                                        let summary = aeqi_graph::synthesize_summary(
                                            comm, &all_nodes, &all_edges,
                                        );
                                        Ok(serde_json::json!({
                                            "ok": true,
                                            "name": summary.name,
                                            "description": summary.description,
                                            "content": summary.content,
                                        }))
                                    }
                                    None => {
                                        Err(anyhow::anyhow!("community '{community_id}' not found"))
                                    }
                                }
                            }
                            _ => Err(anyhow::anyhow!("unknown code action: {action}")),
                        }
                    }

                    _ => Err(anyhow::anyhow!("unknown tool: {tool_name}")),
                };

                match result {
                    Ok(data) => McpResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id.unwrap_or(serde_json::Value::Null),
                        result: Some(serde_json::json!({
                            "content": [{"type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default()}]
                        })),
                        error: None,
                    },
                    Err(e) => McpResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id.unwrap_or(serde_json::Value::Null),
                        result: Some(serde_json::json!({
                            "content": [{"type": "text", "text": format!("Error: {e}")}],
                            "isError": true
                        })),
                        error: None,
                    },
                }
            }
            _ => McpResponse {
                jsonrpc: "2.0".to_string(),
                id: request.id.unwrap_or(serde_json::Value::Null),
                result: Some(serde_json::json!({})),
                error: None,
            },
        };

        let resp_json = serde_json::to_string(&response)?;
        writeln!(stdout, "{resp_json}")?;
        stdout.flush()?;
    }

    Ok(())
}

fn agents_get_context_ipc_request(agent_hint: &str) -> serde_json::Value {
    serde_json::json!({
        "cmd": "trigger_event",
        "agent": agent_hint,
        "pattern": "session:start",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agents_get_context_uses_trigger_event_with_session_start() {
        let req = agents_get_context_ipc_request("worker-1");
        assert_eq!(req["cmd"], "trigger_event");
        assert_eq!(req["pattern"], "session:start");
        assert_eq!(req["agent"], "worker-1");
    }
}
