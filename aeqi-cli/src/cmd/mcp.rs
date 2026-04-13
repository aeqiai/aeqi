use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::time::Instant;

use aeqi_tools::prompt::Prompt;

use crate::helpers::load_config;

#[derive(Debug, Deserialize)]
struct McpRequest {
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
fn validate_api_key(secret_key: &str, api_key: Option<&str>, platform_url: &str) -> Result<PathBuf> {
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
    let body = response
        .split("\r\n\r\n")
        .nth(1)
        .unwrap_or(&response);

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

    let company = parsed
        .get("company")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    eprintln!("[aeqi-mcp] authenticated as company '{company}'");

    Ok(PathBuf::from(socket))
}

/// Discover prompts in a directory, tagged with source.
fn discover_prompts(dir: &std::path::Path, source: &str) -> Vec<(Prompt, String)> {
    Prompt::discover(dir)
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s, source.to_string()))
        .collect()
}

pub fn cmd_mcp(config_path: &Option<PathBuf>) -> Result<()> {
    let (config, config_file) = load_config(config_path)?;
    let base_dir = config_file
        .parent()
        .and_then(|p| p.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());

    // Resolve IPC socket: secret key auth (company runtime) or local daemon fallback.
    let sock_path = if let Ok(secret_key) = std::env::var("AEQI_SECRET_KEY") {
        let api_key = std::env::var("AEQI_API_KEY").ok();
        let platform_url = std::env::var("AEQI_PLATFORM_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8443".to_string());
        validate_api_key(&secret_key, api_key.as_deref(), &platform_url)?
    } else {
        config.data_dir().join("rm.sock")
    };

    let tools = vec![
        // ── Discovery ──────────────────────────────────────────────
        ToolDef {
            name: "aeqi_projects".to_string(),
            description: "List all AEQI projects with repo paths, prefixes, and teams. Use to discover project names and match working directories.".to_string(),
            input_schema: serde_json::json!({"type": "object", "properties": {}}),
        },
        ToolDef {
            name: "aeqi_primer".to_string(),
            description: "Get a project's primer context (AEQI.md) — architecture, critical rules, build/deploy. This is the essential project brief. Call this before starting work on any project.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "Project name"}
                },
                "required": ["project"]
            }),
        },
        ToolDef {
            name: "aeqi_prompts".to_string(),
            description: "List or retrieve prompts — unified format for identities, skills, workflows, and knowledge. Filter by tags (e.g. 'workflow', 'identity', 'discover', 'autonomous').".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["list", "get"], "default": "list"},
                    "tags": {"type": "string", "description": "Filter by tag (optional). Returns prompts that have this tag."},
                    "name": {"type": "string", "description": "Prompt name (required for get)"}
                }
            }),
        },
        // ── Operations ─────────────────────────────────────────────
        ToolDef {
            name: "aeqi_status".to_string(),
            description: "Live status: active workers, budget, costs, pending tasks.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "project": {"type": "string", "description": "Filter to project (optional)"}
                }
            }),
        },
        ToolDef {
            name: "notes".to_string(),
            description: "Resource claims and ephemeral signals. Use claim/release for exclusive file locks during editing. For storing knowledge, use ideas(action='store') instead.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["read", "post", "get", "query", "claim", "release", "delete"],
                        "description": "read: list entries. post: create. get: by key. query: by tags. claim: exclusive lock. release: drop lock. delete: remove."
                    },
                    "project": {"type": "string"},
                    "key": {"type": "string", "description": "Entry key (post/get/delete)"},
                    "resource": {"type": "string", "description": "Resource to claim/release (e.g. file path)"},
                    "content": {"type": "string", "description": "Entry content (post/claim)"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags for filtering (post/query)"},
                    "prefix": {"type": "string", "description": "Filter entries by key prefix (read/query)."},
                    "durability": {"type": "string", "enum": ["transient", "durable"], "description": "TTL class (default: transient=24h, durable=7d)"},
                    "since": {"type": "string", "description": "ISO 8601 timestamp — only return entries created after this (read/query)"},
                    "cross_project": {"type": "boolean", "description": "Search across all projects (read/query)"},
                    "limit": {"type": "integer", "description": "Max results (read/query, default: 20)"},
                    "force": {"type": "boolean", "description": "Force release even if claimed by another agent"}
                },
                "required": ["action", "project"]
            }),
        },
        // ── Ideas (unified: store | search | delete) ───────────────
        ToolDef {
            name: "ideas".to_string(),
            description: "Store, search, or delete ideas (semantic memories). Use for facts, preferences, patterns, and context worth remembering.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["store", "search", "delete"],
                        "description": "store: save knowledge (needs key, content). search: find memories (needs query). delete: remove a memory (needs id)."
                    },
                    "project": {"type": "string", "description": "Project to scope memories to"},
                    "id": {"type": "string", "description": "Idea ID to delete (for delete)"},
                    "key": {"type": "string", "description": "Short slug key (for store)"},
                    "content": {"type": "string", "description": "The knowledge to store (for store)"},
                    "category": {"type": "string", "enum": ["fact", "procedure", "preference", "context", "evergreen"], "default": "fact"},
                    "scope": {"type": "string", "enum": ["domain", "system", "entity"], "default": "domain", "description": "domain = project-level, system = cross-project, entity = per-agent"},
                    "agent_id": {"type": "string", "description": "Agent ID — required when scope is 'entity'"},
                    "query": {"type": "string", "description": "Natural language search query (for search)"},
                    "limit": {"type": "integer", "description": "Max results (for search, default: 5)"}
                },
                "required": ["action", "project"]
            }),
        },
        // ── Quests (unified: create | list | show | update | close | cancel) ──
        ToolDef {
            name: "quests".to_string(),
            description: "Manage quests: create, list, show details, update status/priority, close with result, or cancel.".to_string(),
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
                    "reason": {"type": "string", "description": "Cancellation reason (for cancel)"}
                },
                "required": ["action", "project"]
            }),
        },
        // ── Agents (unified: hire | retire | list | delegate) ──────
        ToolDef {
            name: "agents".to_string(),
            description: "Manage agents: hire from template, retire, list, or delegate work. delegate assembles a structured prompt for Claude Code subagent dispatch.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["hire", "retire", "list", "delegate"],
                        "description": "hire: spawn from template (needs template). retire: deactivate (needs agent). list: show agents (optional status). delegate: assemble subagent prompt (needs agent, project)."
                    },
                    "project": {"type": "string", "description": "Project name"},
                    "template": {"type": "string", "description": "Template name, e.g. 'shadow', 'analyst' (for hire)"},
                    "agent": {"type": "string", "description": "Agent name or ID (for retire, delegate)"},
                    "status": {"type": "string", "enum": ["active", "paused", "retired", "all"], "description": "Filter by status (for list, default: active)"},
                    "quest_id": {"type": "string", "description": "Quest ID for notes context (for delegate)"},
                    "prompt": {"type": "string", "description": "Additional instructions (for delegate)"}
                },
                "required": ["action"]
            }),
        },
        // ── Events (new: create | list | enable | disable | delete) ──
        ToolDef {
            name: "events".to_string(),
            description: "Manage event handlers for agents. Events automate recurring quests on a schedule or in response to lifecycle events.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "enable", "disable", "delete"],
                        "description": "create: new handler (needs name, pattern or schedule). list: show handlers. enable/disable: toggle (needs event_id). delete: remove (needs event_id)."
                    },
                    "agent": {"type": "string", "description": "Agent name or ID"},
                    "name": {"type": "string", "description": "Event handler name (for create)"},
                    "pattern": {"type": "string", "description": "Full pattern (e.g. 'schedule:0 9 * * *', 'lifecycle:quest_completed')"},
                    "schedule": {"type": "string", "description": "Cron expression — shorthand for pattern 'schedule:<expr>'"},
                    "event_pattern": {"type": "string", "description": "Lifecycle event — shorthand for pattern 'lifecycle:<event>'"},
                    "scope": {"type": "string", "enum": ["self", "children", "descendants"], "description": "Event scope (default: 'self')"},
                    "content": {"type": "string", "description": "Instruction to run when event fires"},
                    "cooldown_secs": {"type": "integer", "description": "Minimum seconds between fires"},
                    "max_budget_usd": {"type": "number", "description": "Max budget per execution in USD"},
                    "event_id": {"type": "string", "description": "Event handler ID (for enable/disable/delete)"}
                },
                "required": ["action"]
            }),
        },
        // ── Code (unified graph intelligence) ──────────────────────
        ToolDef {
            name: "code".to_string(),
            description: "Code intelligence graph. Search symbols, get 360° context (callers/callees/implementors), analyze blast radius of changes, list communities or processes.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["search", "context", "impact", "file", "stats", "index", "diff_impact", "file_summary", "incremental", "synthesize"], "description": "search=FTS symbol search, context=360° view of a symbol, impact=blast radius, file=symbols in a file, stats=graph statistics, index=re-index project, diff_impact=blast radius from uncommitted changes, file_summary=summary of a file's symbols, incremental=re-index only changed files, synthesize=generate community summary"},
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
    // Key = "project\0query\0scope\0limit", Value = (timestamp, result).
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
                    "serverInfo": {"name": "aeqi", "version": "5.0.0"}
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
                    // ── Discovery ──────────────────────────────────
                    "aeqi_projects" => {
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

                    "aeqi_primer" => {
                        let project = args.get("project").and_then(|v| v.as_str()).unwrap_or("");

                        let project_primer = if project == "shared" {
                            config.shared_primer.clone().unwrap_or_default()
                        } else {
                            config
                                .agent_spawns
                                .iter()
                                .find(|p| p.name == project)
                                .and_then(|p| p.primer.clone())
                                .unwrap_or_default()
                        };

                        let shared_primer = if project != "shared" {
                            config.shared_primer.clone().unwrap_or_default()
                        } else {
                            String::new()
                        };

                        let mut parts = Vec::new();
                        if !shared_primer.is_empty() {
                            parts.push(shared_primer);
                        }
                        if !project_primer.is_empty() {
                            parts.push(project_primer);
                        }

                        if parts.is_empty() {
                            Ok(
                                serde_json::json!({"ok": false, "error": format!("no primer found for project '{project}'")}),
                            )
                        } else {
                            let content = parts.join("\n\n---\n\n");
                            Ok(serde_json::json!({
                                "ok": true,
                                "project": project,
                                "content": content,
                            }))
                        }
                    }

                    "aeqi_prompts" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("list");
                        let tag_filter = args.get("tags").and_then(|v| v.as_str());
                        let name_filter = args.get("name").and_then(|v| v.as_str());

                        let mut all_prompts: Vec<(Prompt, String)> = Vec::new();
                        let project_dirs: Vec<(String, std::path::PathBuf)> =
                            std::fs::read_dir(base_dir.join("projects"))
                                .into_iter()
                                .flatten()
                                .flatten()
                                .filter_map(|e| {
                                    let name = e.file_name().to_string_lossy().to_string();
                                    if name == "shared" {
                                        None
                                    } else {
                                        Some((name, e.path()))
                                    }
                                })
                                .collect();

                        for subdir in &["skills", "agents"] {
                            all_prompts.extend(discover_prompts(
                                &base_dir.join("projects/shared").join(subdir),
                                "shared",
                            ));
                            for (name, path) in &project_dirs {
                                all_prompts.extend(discover_prompts(&path.join(subdir), name));
                            }
                        }

                        if action == "get" {
                            let name = name_filter.unwrap_or("");
                            match all_prompts.into_iter().find(|(s, _)| s.name == name) {
                                Some((s, source)) => Ok(serde_json::json!({
                                    "name": s.name,
                                    "source": source,
                                    "description": s.description,
                                    "tags": s.tags,
                                    "prompt": s.body,
                                    "tools": { "allow": s.tools, "deny": s.deny },
                                })),
                                None => Ok(
                                    serde_json::json!({"ok": false, "error": format!("prompt '{name}' not found")}),
                                ),
                            }
                        } else {
                            let filtered: Vec<serde_json::Value> = all_prompts
                                .into_iter()
                                .filter(|(s, _)| {
                                    tag_filter.is_none_or(|tf| s.tags.iter().any(|t| t == tf))
                                })
                                .map(|(s, source)| {
                                    serde_json::json!({
                                        "name": s.name,
                                        "source": source,
                                        "tags": s.tags,
                                        "description": s.description,
                                    })
                                })
                                .collect();
                            Ok(
                                serde_json::json!({"ok": true, "count": filtered.len(), "prompts": filtered}),
                            )
                        }
                    }

                    // ── Operations ─────────────────────────────────
                    "aeqi_status" => {
                        let mut ipc = serde_json::json!({"cmd": "status"});
                        if let Some(p) = args.get("project").and_then(|v| v.as_str()) {
                            ipc["project"] = serde_json::json!(p);
                        }
                        ipc_request_sync(&sock_path, &ipc)
                    }

                    "notes" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("read");
                        match action {
                            "post" => {
                                let mut ipc = args.clone();
                                ipc["cmd"] = serde_json::json!("post_notes");
                                ipc["agent"] = serde_json::json!("worker");
                                if ipc.get("durability").and_then(|v| v.as_str()).is_none() {
                                    ipc["durability"] = serde_json::json!("durable");
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "get" => {
                                let ipc = serde_json::json!({
                                    "cmd": "get_notes",
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                    "key": args.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "claim" => {
                                let ipc = serde_json::json!({
                                    "cmd": "claim_notes",
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                    "resource": args.get("resource").and_then(|v| v.as_str()).unwrap_or(""),
                                    "content": args.get("content").and_then(|v| v.as_str()).unwrap_or(""),
                                    "agent": "worker",
                                });
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "release" => {
                                let ipc = serde_json::json!({
                                    "cmd": "release_notes",
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                    "resource": args.get("resource").and_then(|v| v.as_str()).unwrap_or(""),
                                    "agent": "worker",
                                    "force": args.get("force").and_then(|v| v.as_bool()).unwrap_or(false),
                                });
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "delete" => {
                                let ipc = serde_json::json!({
                                    "cmd": "delete_notes",
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                    "key": args.get("key").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            _ => {
                                let prefix_filter = args.get("prefix").and_then(|v| v.as_str());
                                let mut ipc = serde_json::json!({
                                    "cmd": "notes",
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                if let Some(tags) = args.get("tags") {
                                    ipc["tags"] = tags.clone();
                                }
                                if let Some(since) = args.get("since") {
                                    ipc["since"] = since.clone();
                                }
                                if let Some(limit) = args.get("limit") {
                                    ipc["limit"] = limit.clone();
                                }
                                if let Some(cross) = args.get("cross_project") {
                                    ipc["cross_project"] = cross.clone();
                                }
                                let result = ipc_request_sync(&sock_path, &ipc);
                                if let Some(pf) = prefix_filter {
                                    result.map(|mut v| {
                                        if let Some(entries) =
                                            v.get_mut("entries").and_then(|e| e.as_array_mut())
                                        {
                                            entries.retain(|e| {
                                                e.get("key")
                                                    .and_then(|k| k.as_str())
                                                    .is_some_and(|k| k.starts_with(pf))
                                            });
                                        }
                                        v
                                    })
                                } else {
                                    result
                                }
                            }
                        }
                    }

                    // ── Ideas (unified) ────────────────────────────
                    "ideas" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("search");
                        match action {
                            "store" => {
                                let mut ipc = args.clone();
                                ipc["cmd"] = serde_json::json!("knowledge_store");
                                if ipc
                                    .get("scope")
                                    .and_then(|v| v.as_str())
                                    .is_none_or(|s| s.is_empty())
                                {
                                    ipc["scope"] = serde_json::json!("domain");
                                }
                                // Invalidate recall cache — new memories change results.
                                if let Some(project) =
                                    args.get("project").and_then(|v| v.as_str())
                                {
                                    let prefix = format!("{project}\0");
                                    recall_cache.retain(|k, _| !k.starts_with(&prefix));
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "search" => {
                                let project = args
                                    .get("project")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let query =
                                    args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                                let scope = args
                                    .get("scope")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("domain");
                                let agent_id = args.get("agent_id").and_then(|v| v.as_str());
                                let limit =
                                    args.get("limit").and_then(|v| v.as_u64()).unwrap_or(5);

                                let agent_key = agent_id.unwrap_or("");
                                let cache_key =
                                    format!("{project}\0{query}\0{scope}\0{agent_key}\0{limit}");

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
                                        "cmd": "memories",
                                        "project": project,
                                        "query": query,
                                        "scope": scope,
                                        "limit": limit,
                                    });
                                    if let Some(aid) = agent_id {
                                        ipc["agent_id"] = serde_json::json!(aid);
                                    }
                                    let r = ipc_request_sync(&sock_path, &ipc);
                                    if let Ok(ref val) = r {
                                        recall_cache
                                            .insert(cache_key, (Instant::now(), val.clone()));
                                    }
                                    r
                                }
                            }
                            "delete" => {
                                let id =
                                    args.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                let project = args
                                    .get("project")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                // Invalidate recall cache.
                                let prefix = format!("{project}\0");
                                recall_cache.retain(|k, _| !k.starts_with(&prefix));
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "knowledge_delete",
                                        "id": id,
                                        "project": project,
                                    }),
                                )
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown ideas action: {action}. Use: store, search, delete"
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
                                if let Some(agent) = args.get("agent") {
                                    ipc["agent"] = agent.clone();
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "show" => {
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "get_quest",
                                        "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                                        "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(""),
                                    }),
                                )
                            }
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
                                let project = args
                                    .get("project")
                                    .and_then(|v| v.as_str())
                                    .or_else(|| {
                                        args.get("quest_id")
                                            .and_then(|v| v.as_str())
                                            .and_then(|id| id.split('-').next())
                                    })
                                    .unwrap_or("");
                                let quest_id = args
                                    .get("quest_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let mut ipc = args.clone();
                                ipc["cmd"] = serde_json::json!("close_quest");
                                let mut result = ipc_request_sync(&sock_path, &ipc);

                                // Enrich: check if review was posted for this quest
                                if let Ok(ref mut val) = result
                                    && !quest_id.is_empty()
                                {
                                    let review_key = format!("quest:{quest_id}:review");
                                    let bb_req = serde_json::json!({
                                        "cmd": "notes",
                                        "project": project,
                                        "prefix": &review_key,
                                        "limit": 1
                                    });
                                    let has_review = ipc_request_sync(&sock_path, &bb_req)
                                        .ok()
                                        .and_then(|r| {
                                            r.get("entries")?.as_array().map(|a| !a.is_empty())
                                        })
                                        .unwrap_or(false);

                                    if !has_review {
                                        val["review_warning"] = serde_json::json!(format!(
                                            "No review posted for {quest_id}. For significant changes, delegate: agents(action='delegate', agent='reviewer', project='{project}', quest_id='{quest_id}')"
                                        ));
                                    }
                                }

                                result
                            }
                            "cancel" => {
                                let quest_id = args
                                    .get("quest_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
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
                            "hire" => {
                                let template = args
                                    .get("template")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let mut ipc = serde_json::json!({
                                    "cmd": "agent_spawn",
                                    "template": template,
                                });
                                if let Some(parent) =
                                    args.get("parent_id").and_then(|v| v.as_str())
                                {
                                    ipc["parent_id"] = serde_json::json!(parent);
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "retire" => {
                                let agent_hint = args
                                    .get("agent")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
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
                                if let Some(status) = args.get("status").and_then(|v| v.as_str())
                                {
                                    ipc["status"] = serde_json::json!(status);
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "delegate" => {
                                let agent_name = args
                                    .get("agent")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let project = args
                                    .get("project")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let quest_id = args
                                    .get("quest_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let extra_prompt = args
                                    .get("prompt")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");

                                // 1. Load agent template — try DB via IPC first, fall back to .md files
                                let agent_template = {
                                    let mut found = String::new();

                                    if let Ok(resp) = ipc_request_sync(
                                        &sock_path,
                                        &serde_json::json!({
                                            "cmd": "agent_info",
                                            "name": agent_name,
                                        }),
                                    ) && resp
                                        .get("ok")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(false)
                                        && let Some(sp) =
                                            resp.get("system_prompt").and_then(|v| v.as_str())
                                        && !sp.is_empty()
                                    {
                                        found = sp.to_string();
                                    }

                                    if found.is_empty() {
                                        for dir in &[
                                            base_dir
                                                .join("projects")
                                                .join(project)
                                                .join("agents"),
                                            base_dir.join("projects/shared/agents"),
                                        ] {
                                            let path = dir.join(format!("{agent_name}.md"));
                                            if path.exists()
                                                && let Ok(content) =
                                                    std::fs::read_to_string(&path)
                                            {
                                                found = content;
                                                break;
                                            }
                                        }
                                    }

                                    if found.is_empty() {
                                        return Err(anyhow::anyhow!(
                                            "agent '{agent_name}' not found"
                                        ));
                                    }
                                    found
                                };

                                // 2. Gather notes context for the quest
                                let mut bb_context = String::new();
                                if !quest_id.is_empty() {
                                    let bb_req = serde_json::json!({
                                        "cmd": "notes",
                                        "project": project,
                                        "prefix": format!("quest:{quest_id}"),
                                        "limit": 10
                                    });
                                    if let Ok(bb_resp) = ipc_request_sync(&sock_path, &bb_req)
                                        && let Some(entries) =
                                            bb_resp.get("entries").and_then(|e| e.as_array())
                                    {
                                        for entry in entries {
                                            let key = entry
                                                .get("key")
                                                .and_then(|k| k.as_str())
                                                .unwrap_or("");
                                            let content = entry
                                                .get("content")
                                                .and_then(|c| c.as_str())
                                                .unwrap_or("");
                                            if !content.is_empty() {
                                                bb_context.push_str(&format!(
                                                    "\n## {key}\n{content}\n"
                                                ));
                                            }
                                        }
                                    }
                                }

                                // 3. Assemble the delegation prompt
                                let mut prompt = String::new();
                                prompt.push_str(&agent_template);
                                prompt.push_str("\n\n---\n\n");
                                prompt.push_str(&format!(
                                    "# Delegation Context\n\nProject: {project}\n"
                                ));
                                if !quest_id.is_empty() {
                                    prompt.push_str(&format!("Quest: {quest_id}\n"));
                                }
                                if !bb_context.is_empty() {
                                    prompt.push_str(&format!(
                                        "\n# Notes Context\n{bb_context}\n"
                                    ));
                                }
                                if !extra_prompt.is_empty() {
                                    prompt
                                        .push_str(&format!("\n# Instructions\n{extra_prompt}\n"));
                                }
                                prompt.push_str(&format!(
                                    "\nWhen done, post your results to notes:\n\
                                     notes(action='post', project='{project}', key='quest:{quest_id}:{agent_name}', content='<your findings>')\n"
                                ));

                                Ok(serde_json::json!({
                                    "ok": true,
                                    "agent": agent_name,
                                    "project": project,
                                    "quest_id": quest_id,
                                    "prompt": prompt,
                                    "usage": "Pass the 'prompt' field to a Claude Code Agent subagent. The agent will read notes context and post results back."
                                }))
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown agents action: {action}. Use: hire, retire, list, delegate"
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
                                    .unwrap_or("");
                                let name = args
                                    .get("name")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let scope = args
                                    .get("scope")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("self");

                                // Build pattern from shorthand or explicit
                                let pattern = if let Some(schedule) =
                                    args.get("schedule").and_then(|v| v.as_str())
                                {
                                    format!("schedule:{schedule}")
                                } else if let Some(event) =
                                    args.get("event_pattern").and_then(|v| v.as_str())
                                {
                                    format!("lifecycle:{event}")
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
                                    "scope": scope,
                                });
                                if let Some(content) = args.get("content") {
                                    ipc["content"] = content.clone();
                                }
                                if let Some(cooldown) = args.get("cooldown_secs") {
                                    ipc["cooldown_secs"] = cooldown.clone();
                                }
                                if let Some(budget) = args.get("max_budget_usd") {
                                    ipc["max_budget_usd"] = budget.clone();
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "list" => {
                                let mut ipc = serde_json::json!({"cmd": "list_events"});
                                if let Some(agent) = args.get("agent") {
                                    ipc["agent"] = agent.clone();
                                }
                                ipc_request_sync(&sock_path, &ipc)
                            }
                            "enable" | "disable" => {
                                let event_id = args
                                    .get("event_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
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
                                let event_id = args
                                    .get("event_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                ipc_request_sync(
                                    &sock_path,
                                    &serde_json::json!({
                                        "cmd": "delete_event",
                                        "event_id": event_id,
                                    }),
                                )
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown events action: {action}. Use: create, list, enable, disable, delete"
                            )),
                        }
                    }

                    // ── Code (graph intelligence) ──────────────────
                    "code" => {
                        let project = args
                            .get("project")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("stats");

                        // Find project repo path from config
                        let repo_path = config
                            .agent_spawns
                            .iter()
                            .find(|p| p.name == project)
                            .map(|p| {
                                let r = p.repo.replace(
                                    '~',
                                    &dirs::home_dir()
                                        .unwrap_or_default()
                                        .to_string_lossy(),
                                );
                                std::path::PathBuf::from(r)
                            });

                        let graph_dir = config.data_dir().join("codegraph");
                        std::fs::create_dir_all(&graph_dir).ok();
                        let db_path = graph_dir.join(format!("{project}.db"));

                        match action {
                            "index" => {
                                let repo = repo_path.ok_or_else(|| {
                                    anyhow::anyhow!(
                                        "project '{project}' not found in config"
                                    )
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
                                let query = args
                                    .get("query")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let limit = args
                                    .get("limit")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(10)
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
                                let node_id = args
                                    .get("node_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
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
                                let node_id = args
                                    .get("node_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let depth = args
                                    .get("depth")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(3)
                                    as u32;
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
                                let file_path = args
                                    .get("file_path")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
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
                                let indexed_at =
                                    store.get_meta("indexed_at")?.unwrap_or_default();
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
                                let depth = args
                                    .get("depth")
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(3)
                                    as u32;
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
                                let file_path = args
                                    .get("file_path")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
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
                                        let synthesized = aeqi_graph::synthesize_prompt(
                                            comm, &all_nodes, &all_edges,
                                        );
                                        Ok(serde_json::json!({
                                            "ok": true,
                                            "prompt_name": synthesized.name,
                                            "description": synthesized.description,
                                            "content": synthesized.content,
                                        }))
                                    }
                                    None => Err(anyhow::anyhow!(
                                        "community '{community_id}' not found"
                                    )),
                                }
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown code action: {action}"
                            )),
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
