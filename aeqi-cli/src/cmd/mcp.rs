use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

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
    title: String,
    description: String,
    annotations: serde_json::Value,
    #[serde(rename = "inputSchema")]
    input_schema: serde_json::Value,
}

/// Canonical list of `action` values accepted by the `ideas` MCP tool.
///
/// Drift-guard contract: when you change this list (add, remove, rename),
/// you must also:
///
/// 1. Update the dispatch arm at `aeqi-cli/src/cmd/mcp.rs` (`"ideas" => ...`)
///    so the new action actually routes to an IPC verb.
/// 2. Update `aeqi-docs/docs/concepts/ideas.md` - the "REST <-> MCP surface"
///    table is the agent-facing canonical reference; out-of-band changes
///    silently mislead agents.
/// 3. Decide whether the new action also belongs on the REST surface
///    (`crates/aeqi-web/src/routes/ideas.rs`). The split is deliberate
///    (feedback / walk are MCP-only because they're agent-internal;
///    activity / comments / subscribe / properties / children are REST-only
///    because they back UI streams) but every new action needs the same
///    deliberate decision.
///
/// `ideas_mcp_action_enum_drift_guard` snapshots this list so the doc-update
/// step can't be silently skipped.
const IDEAS_MCP_ACTIONS: &[&str] = &[
    "store", "search", "update", "delete", "link", "feedback", "walk",
];

fn ipc_request_sync(sock_path: &Path, request: &serde_json::Value) -> Result<serde_json::Value> {
    let stream = connect_with_retry(sock_path)?;
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

/// Connect to the runtime IPC socket, retrying briefly on `NotFound` /
/// `ConnectionRefused` so the caller doesn't see a raw `No such file or
/// directory (os error 2)` during the host-restart cutover window.
///
/// The host runtime binds `rm.sock` as a side-effect of `spawn_ipc_listener`
/// in `aeqi-orchestrator/src/daemon.rs`, which runs after config load and
/// SQLite store setup — typically 1–5s, up to ~30s on a cold start. Without
/// this retry, any `mcp__aeqi__*` call landing in that window fails the
/// agent's tool call instead of riding through the bounce. Quest 67-152.
fn connect_with_retry(sock_path: &Path) -> Result<std::os::unix::net::UnixStream> {
    use std::os::unix::net::UnixStream;
    use std::time::{Duration, Instant};

    let deadline = Instant::now() + Duration::from_secs(30);
    let mut attempt = 0u32;
    loop {
        match UnixStream::connect(sock_path) {
            Ok(stream) => {
                if attempt > 0 {
                    eprintln!(
                        "[aeqi-mcp] connected to {} after {} retry(s)",
                        sock_path.display(),
                        attempt
                    );
                }
                return Ok(stream);
            }
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused
                ) && Instant::now() < deadline =>
            {
                let backoff_ms = std::cmp::min(100 + u64::from(attempt) * 100, 1000);
                std::thread::sleep(Duration::from_millis(backoff_ms));
                attempt += 1;
            }
            Err(e) => return Err(e.into()),
        }
    }
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

#[derive(Debug, Clone, Serialize)]
struct McpAuthContext {
    mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trust_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    user_id: Option<String>,
    #[serde(default)]
    allowed_roots: Vec<String>,
    actor: McpActorContext,
    runtime: serde_json::Value,
}

impl McpAuthContext {
    fn from_platform_response(parsed: &serde_json::Value) -> Result<(Self, PathBuf)> {
        let runtime = parsed
            .get("runtime")
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("platform did not return runtime metadata"))?;
        let socket = runtime
            .get("socket")
            .and_then(|s| s.as_str())
            .ok_or_else(|| anyhow::anyhow!("platform did not return a runtime socket path"))?
            .to_string();

        let root = parsed
            .get("root")
            .or_else(|| parsed.get("company"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let trust_id = parsed
            .get("trust_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| root.clone());
        let user_id = parsed
            .get("user_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let allowed_roots = string_array(parsed.get("allowed_roots"))
            .or_else(|| root.as_ref().map(|r| vec![r.clone()]))
            .unwrap_or_default();

        let actor_json = parsed.get("actor");
        let actor = McpActorContext {
            kind: actor_json
                .and_then(|a| a.get("kind"))
                .and_then(|v| v.as_str())
                .unwrap_or("user")
                .to_string(),
            user_id: actor_json
                .and_then(|a| a.get("user_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| user_id.clone()),
            trust_id: actor_json
                .and_then(|a| a.get("trust_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| trust_id.clone()),
            roles: actor_json
                .and_then(|a| string_array(a.get("roles")))
                .or_else(|| string_array(parsed.get("roles")))
                .unwrap_or_default(),
            grants: actor_json
                .and_then(|a| string_array(a.get("grants")))
                .or_else(|| string_array(parsed.get("grants")))
                .unwrap_or_default(),
            source: "platform".to_string(),
        };

        Ok((
            Self {
                mode: "platform".to_string(),
                root,
                trust_id,
                user_id,
                allowed_roots,
                actor,
                runtime,
            },
            PathBuf::from(socket),
        ))
    }

    fn local(sock_path: &Path, agent_name: Option<&str>) -> Self {
        let root = std::env::var("AEQI_ROOT")
            .ok()
            .or_else(|| std::env::var("AEQI_ENTITY_ID").ok())
            .or_else(|| agent_name.map(|s| s.to_string()));
        let user_id = std::env::var("AEQI_USER_ID").ok();
        let trust_id = root.clone();
        let actor = McpActorContext {
            kind: if user_id.is_some() {
                "user".to_string()
            } else {
                "local_operator".to_string()
            },
            user_id: user_id.clone(),
            trust_id: trust_id.clone(),
            roles: if user_id.is_some() {
                Vec::new()
            } else {
                vec!["local_admin".to_string()]
            },
            grants: if user_id.is_some() {
                Vec::new()
            } else {
                vec!["*".to_string()]
            },
            source: "self_hosted_local".to_string(),
        };
        Self {
            mode: "local".to_string(),
            root,
            trust_id,
            user_id,
            allowed_roots: Vec::new(),
            actor,
            runtime: serde_json::json!({
                "type": "local",
                "socket": sock_path.display().to_string(),
            }),
        }
    }

    fn apply_to_ipc(&self, request: &mut serde_json::Value) {
        request["actor"] = serde_json::json!(self.actor);
        if let Some(user_id) = self.user_id.as_deref() {
            request["caller_user_id"] = serde_json::json!(user_id);
        }
        if let Some(trust_id) = self.trust_id.as_deref() {
            request["caller_entity_id"] = serde_json::json!(trust_id);
        }
    }

    fn public_json(&self) -> serde_json::Value {
        serde_json::json!({
            "ok": true,
            "mode": self.mode,
            "root": self.root,
            "trust_id": self.trust_id,
            "user_id": self.user_id,
            "allowed_roots": self.allowed_roots,
            "actor": self.actor,
            "runtime": self.runtime,
        })
    }
}

fn string_array(value: Option<&serde_json::Value>) -> Option<Vec<String>> {
    value.and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    })
}

fn browser_capability_contract(auth_context: &McpAuthContext) -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "tool": "browser",
        "status": "contract_only",
        "summary": "AEQI browser execution is defined as a quest-scoped, audited capability. Mutable browser actions are intentionally disabled until the session backend and artifact store are wired.",
        "actions": ["capabilities", "policy", "status"],
        "planned_actions": ["open", "click", "type", "select", "wait", "screenshot", "snapshot", "extract", "close"],
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
        },
        "actor": auth_context.actor,
        "root": auth_context.root,
        "mode": auth_context.mode,
    })
}

/// Validate keys against the platform and return the runtime socket path.
/// secret_key (sk_) is required, api_key (ak_) is optional for analytics.
fn validate_api_key(
    secret_key: &str,
    api_key: Option<&str>,
    platform_url: &str,
) -> Result<(McpAuthContext, PathBuf)> {
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

    let (auth, socket) = McpAuthContext::from_platform_response(&parsed)?;
    eprintln!(
        "[aeqi-mcp] authenticated actor kind={} user={} root={}",
        auth.actor.kind,
        auth.user_id.as_deref().unwrap_or("unknown"),
        auth.root.as_deref().unwrap_or("unknown")
    );

    Ok((auth, socket))
}

pub fn cmd_mcp(config_path: &Option<PathBuf>) -> Result<()> {
    let (config, ..) = load_config(config_path)?;

    // Resolve client/agent hint. This is request context, not the authenticated
    // principal. Tool handlers should only use it as a default where an
    // agent-scoped operation requires one.
    let agent_name = std::env::var("AEQI_AGENT").ok();
    let agent_id = std::env::var("AEQI_AGENT_ID").ok();
    if let Some(ref name) = agent_name {
        eprintln!("[aeqi-mcp] client agent hint: {name}");
    }

    // Hosted/platform keys get first chance so local and hosted deployments
    // share the same actor envelope. Self-hosted runtimes without a
    // platform key still use the local socket as an operator boundary.
    let local_sock = config.data_dir().join("rm.sock");
    let hosted_auth = if let Ok(secret_key) = std::env::var("AEQI_SECRET_KEY") {
        let api_key = std::env::var("AEQI_API_KEY").ok();
        let platform_url = std::env::var("AEQI_PLATFORM_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:8443".to_string());
        match validate_api_key(&secret_key, api_key.as_deref(), &platform_url) {
            Ok(auth) => Some(auth),
            Err(e) if local_sock.exists() => {
                eprintln!(
                    "[aeqi-mcp] platform validation failed; falling back to local socket: {e}"
                );
                None
            }
            Err(e) => return Err(e),
        }
    } else {
        None
    };

    let (auth_context, sock_path) = if let Some(auth) = hosted_auth {
        auth
    } else if local_sock.exists() {
        eprintln!(
            "[aeqi-mcp] using local daemon socket {}",
            local_sock.display()
        );
        (
            McpAuthContext::local(&local_sock, agent_name.as_deref()),
            local_sock,
        )
    } else {
        anyhow::bail!(
            "no local daemon socket at {} and AEQI_SECRET_KEY is unset",
            local_sock.display()
        );
    };
    let call_ipc = |request: &serde_json::Value| -> Result<serde_json::Value> {
        let mut request = request.clone();
        auth_context.apply_to_ipc(&mut request);
        ipc_request_sync(&sock_path, &request)
    };

    let tools = vec![
        ToolDef {
            name: "me".to_string(),
            title: "AEQI Identity".to_string(),
            description: "Return the authenticated MCP actor, entity scope, runtime transport, and tenancy envelope. This is the canonical first call for checking whether MCP is acting as a user principal, local operator, or future agent principal.".to_string(),
            annotations: serde_json::json!({"title": "AEQI Identity", "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false}),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["profile", "permissions"],
                        "description": "profile returns actor/runtime metadata. permissions returns the same envelope plus grants when available."
                    }
                }
            }),
        },
        // ── Ideas (unified: store | search | update | delete) ───────────────
        ToolDef {
            name: "ideas".to_string(),
            title: "AEQI Ideas".to_string(),
            description: "Company memory and idea graph. Search before coding to recover prior decisions, store durable findings after useful work, link related ideas, and send feedback so retrieval improves. Search is tag-routed BM25+vector with MMR diversification, graph boosts, bi-temporal filtering, and hotness/feedback boosts.".to_string(),
            annotations: serde_json::json!({"title": "AEQI Ideas", "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false}),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": IDEAS_MCP_ACTIONS,
                        "description": "store: save knowledge (needs name, content, tags). search: find ideas by natural language query (needs query). update: modify an idea by ID (needs id plus name/content/tags). delete: remove an idea by ID (needs id). link: connect two ideas with a typed edge (needs from, to, relation). feedback: mark an idea as used/useful/ignored/wrong/corrected/pinned (needs id and signal). walk: BFS the idea graph from a starting idea (needs from; optional max_hops, relations[], strength_threshold, limit)."
                    },
                    "id": {"type": "string", "description": "Idea ID (for update, delete, feedback)"},
                    "name": {"type": "string", "description": "Short slug name, e.g. 'auth/jwt-rotation' (for store, update)."},
                    "content": {"type": "string", "description": "The knowledge to store or replace (for store, update)"},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to classify the idea. Common: fact, procedure, preference, context, evergreen, skill, architecture. Multiple tags supported. On search, becomes a hard filter."},
                    "kind": {"type": "string", "description": "Structural identity for store. Canonical: note (default), file, goal. Custom kinds may use custom:<name>."},
                    "file_id": {"type": "string", "description": "Optional blob/file row id when storing an idea with kind=file."},
                    "agent_id": {"type": "string", "description": "Optional explicit agent scope. Omit for entity/global memory owned by the authenticated user/company context."},
                    "query": {"type": "string", "description": "Natural language search query (for search). Uses tag-routed BM25 + vector similarity with MMR diversification."},
                    "limit": {"type": "integer", "description": "Max results (for search, default: 5)"},
                    "explain": {"type": "boolean", "description": "Include per-component score breakdown (bm25/vector/hotness/graph/confidence/decay/final_score) on each hit. Default false."},
                    "route_hint": {"type": "string", "description": "Optional routing hint for search. 'auto' (default) picks tags from the corpus; passing an explicit hint biases the planner."},
                    "include_superseded": {"type": "boolean", "description": "When true, include archived and superseded rows in search. Default false."},
                    "from": {"type": "string", "description": "Source idea ID (for link action)"},
                    "to": {"type": "string", "description": "Target idea ID (for link action)"},
                    "relation": {
                        "type": "string",
                        "enum": ["mention", "embed", "link"],
                        "description": "Edge relation (for link action). mention/embed are body-parser-owned (`[[X]]` / `![[X]]` in content); use 'link' for direct API writes (default)."
                    },
                    "strength": {"type": "number", "description": "Edge strength 0.0–1.0 (for link, default 1.0)"},
                    "signal": {"type": "string", "enum": ["used", "useful", "ignored", "corrected", "wrong", "pinned"], "description": "Feedback signal (for feedback). used/useful lift hotness; ignored dampens it; wrong/corrected drop it sharply; pinned tags the idea."},
                    "weight": {"type": "number", "description": "Feedback weight (for feedback, default 1.0)"},
                    "note": {"type": "string", "description": "Optional note to attach to a feedback row"},
                    "max_hops": {"type": "integer", "description": "Walk depth limit (for walk, default 3, max 10)"},
                    "relations": {"type": "array", "items": {"type": "string"}, "description": "Walk relation filter (for walk). Empty/omitted = all relations allowed."},
                    "strength_threshold": {"type": "number", "description": "Minimum edge strength to traverse (for walk, default 0.1). Applied both per-edge and to the accumulated multi-hop strength."}
                },
                "required": ["action"]
            }),
        },
        // ── Quests (unified: create | list | show | update | close | cancel) ──
        ToolDef {
            name: "quests".to_string(),
            title: "AEQI Quests".to_string(),
            description: "Task ledger for company work. Use quests to create, list, show, update, close, or cancel work even when no AEQI runtime agent is assigned. `list` with no `project`/`agent` returns all quests visible to the calling entity, including global (scope:\"global\", agent_id:null) quests — pass `project`, `agent`, or `agent_id` to narrow. `create` defaults to the runtime's first configured project unless `agent` is set. AEQI_AGENT only labels the MCP client and does not automatically own or filter quests.".to_string(),
            annotations: serde_json::json!({"title": "AEQI Quests", "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false}),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "show", "update", "close", "cancel"],
                        "description": "create: new quest (needs subject). list: show quests (optional status, explicit agent). show: details (needs quest_id). update: change status, priority, assignee, due_at, agent_id, or scope (needs quest_id). close: complete (needs quest_id, result). cancel: abort (needs quest_id). AEQI_AGENT labels the MCP client and does not automatically own or filter quests."
                    },
                    "project": {"type": "string", "description": "Project name. For `list`, omit to see all entity-visible quests (including globals); pass to narrow to a specific project's agent. For `create`, defaults to the runtime's first configured project when omitted."},
                    "quest_id": {"type": "string", "description": "Quest ID (for show/update/close/cancel)"},
                    "subject": {"type": "string", "description": "Quest subject (for create). Prefix with 'claim:' for atomic resource locking."},
                    "description": {"type": "string", "description": "Quest description (for create)"},
                    "agent": {"type": "string", "description": "Optional explicit agent name or hint for delegated/agent-scoped work. Omit for user/entity global quests."},
                    "agent_id": {"type": "string", "description": "Optional explicit agent ID for delegated/agent-scoped work."},
                    "assignee": {
                        "oneOf": [
                            {"type": "string", "description": "Assignee token, for example agent:<id> or user:<id>."},
                            {"type": "null", "description": "Clear the assignee."}
                        ],
                        "description": "Quest assignee for update. Omit to leave unchanged; null or empty string clears it."
                    },
                    "scope": {"type": "string", "enum": ["self", "siblings", "children", "branch", "global"], "description": "Quest visibility scope (for create/update)."},
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
                    "status": {"type": "string", "enum": ["backlog", "todo", "in_progress", "done", "cancelled"], "description": "Filter or new status (for list, update). Lifecycle: backlog → todo → in_progress → done | cancelled."},
                    "priority": {"type": "string", "enum": ["low", "normal", "high", "critical"], "description": "Priority (for create, update)"},
                    "due_at": {
                        "oneOf": [
                            {"type": "string", "description": "RFC3339 due timestamp."},
                            {"type": "number", "description": "Unix timestamp in seconds."},
                            {"type": "null", "description": "Clear the due date."}
                        ],
                        "description": "Due date for update. Omit to leave unchanged; null or empty string clears it."
                    },
                    "result": {"type": "string", "description": "Completion result (for close)"},
                    "reason": {"type": "string", "description": "Cancellation reason (for cancel)"},
                    "finalize": {"type": "string", "enum": ["merge", "commit", "discard"], "description": "What to do with the quest's worktree on close. merge (default): commit + merge to main. commit: commit but keep branch. discard: throw away changes."}
                },
                "required": ["action"]
            }),
        },
        // ── Agents (unified: hire | retire | list | delegate) ──────
        ToolDef {
            name: "agents".to_string(),
            title: "AEQI Agents".to_string(),
            description: "Optional AEQI runtime workers and project registry. Use this to inspect available agents/projects, get an agent profile/context, hire a new agent, or retire one. You do not need an AEQI agent to use ideas, quests, or code graph as the authenticated user.".to_string(),
            annotations: serde_json::json!({"title": "AEQI Agents", "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false}),
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
            title: "AEQI Events".to_string(),
            description: "Lifecycle automation for the runtime. Use events to list or manage handlers, manually trigger session/quest lifecycle context, and trace handler executions. Prefer read actions unless intentionally changing automation.".to_string(),
            annotations: serde_json::json!({"title": "AEQI Events", "readOnlyHint": false, "destructiveHint": true, "idempotentHint": false, "openWorldHint": false}),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["create", "list", "enable", "disable", "delete", "trigger", "trace"],
                        "description": "create: new handler (needs name plus pattern or schedule; optional tool_calls). list: show handlers. enable/disable: toggle (needs event_id). delete: remove (needs event_id). trigger: fire an event pattern and return the assembled ideas context — same context the runtime injects during its lifecycle (optional pattern, defaults to session:start). trace: query event invocation history — pass session_id + optional limit to list invocations, or invocation_id for full step detail."
                    },
                    "agent": {"type": "string", "description": "Agent name or ID"},
                    "agent_id": {"type": "string", "description": "Explicit agent ID. Required for schedule:* events unless `agent` resolves to an active agent."},
                    "name": {"type": "string", "description": "Event handler name (for create)"},
                    "pattern": {"type": "string", "description": "Full pattern (e.g. 'schedule:0 9 * * *', 'session:quest_result')"},
                    "schedule": {"type": "string", "description": "Cron expression — shorthand for pattern 'schedule:<expr>'"},
                    "event_pattern": {"type": "string", "description": "Session event — shorthand for pattern 'session:<event>' (e.g. 'start', 'quest_start', 'quest_end', 'quest_result')"},
                    "cooldown_secs": {"type": "integer", "description": "Minimum seconds between fires"},
                    "tool_calls": {"type": "array", "items": {"type": "object"}, "description": "Event tool calls to execute when the handler fires, e.g. session.spawn or ideas.search."},
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
            title: "AEQI Code Graph".to_string(),
            description: "Code intelligence graph for configured company repositories. Use search to find symbols, context for callers/callees/implementors, impact or diff_impact before edits, file/file_summary for file-level understanding, stats to inspect index health, audit to summarize all available roots, and index/incremental to refresh the graph.".to_string(),
            annotations: serde_json::json!({"title": "AEQI Code Graph", "readOnlyHint": false, "destructiveHint": false, "idempotentHint": false, "openWorldHint": false}),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["search", "context", "impact", "file", "stats", "health", "audit", "index", "diff_impact", "file_summary", "incremental", "synthesize"], "description": "search: find symbols by name (read). context: 360° view — callers, callees, implementors (read). impact: blast radius from a symbol (read). diff_impact: blast radius from uncommitted changes (read). file: list symbols in a file (read). file_summary: summary of a file (read). stats: graph statistics (read). health: repo-aware coverage/freshness report (read). audit: summarize all available roots at a glance (read). index: full re-index of project (write). incremental: re-index only changed files (write). synthesize: generate community summary (write)."},
                    "project": {"type": "string", "description": "Project name"},
                    "repo_path": {"type": "string", "description": "Optional repository path override for index, incremental, diff_impact, and stats repo resolution."},
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
        ToolDef {
            name: "browser".to_string(),
            title: "AEQI Browser".to_string(),
            description: "Quest-scoped browser execution contract for agents. The current slice is read-only: use capabilities, policy, or status to inspect backend order, required controls, and artifact expectations before any mutable browser backend is enabled.".to_string(),
            annotations: serde_json::json!({"title": "AEQI Browser", "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": true}),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["capabilities", "policy", "status"], "description": "Read the AEQI browser capability contract, execution policy, or current backend status."},
                    "quest_id": {"type": "string", "description": "Quest that will own future mutable browser sessions. Required for planned open/click/type actions; optional for read-only contract inspection."},
                    "backend": {"type": "string", "enum": ["playwright", "agent-browser", "cloakbrowser"], "description": "Requested browser backend for future mutable actions. Playwright remains the default."}
                },
                "required": ["action"]
            }),
        },
    ];

    // Recall caching is daemon-side (aeqi_ideas::RecallCache on the
    // CommandContext) so every MCP invocation sees a coherent cache.
    // The old per-process HashMap cache was removed — it only benefited
    // one MCP instance and went stale across tool calls.

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

        let retire_after_response = current_exe_has_been_replaced();

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
                        "actor": auth_context.actor,
                        "root": auth_context.root,
                        "mode": auth_context.mode,
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

                let result: Result<serde_json::Value> = (|| match tool_name {
                    "me" => {
                        let _action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("profile");
                        Ok(auth_context.public_json())
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
                                ipc["cmd"] = serde_json::json!("store_idea");
                                call_ipc(&ipc)
                            }
                            "search" => {
                                let query =
                                    args.get("query").and_then(|v| v.as_str()).unwrap_or("");
                                let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(5);

                                let mut ipc = serde_json::json!({
                                    "cmd": "search_ideas",
                                    "query": query,
                                    "top_k": limit,
                                });
                                if let Some(aid) = args.get("agent_id").and_then(|v| v.as_str()) {
                                    ipc["agent_id"] = serde_json::json!(aid);
                                }
                                if let Some(tags) = args.get("tags") {
                                    ipc["tags"] = tags.clone();
                                }
                                if let Some(v) = args.get("explain") {
                                    ipc["explain"] = v.clone();
                                }
                                if let Some(v) = args.get("route_hint") {
                                    ipc["route_hint"] = v.clone();
                                }
                                if let Some(v) = args.get("include_superseded") {
                                    ipc["include_superseded"] = v.clone();
                                }
                                call_ipc(&ipc)
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
                                call_ipc(&ipc)
                            }
                            "delete" => {
                                let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
                                call_ipc(&serde_json::json!({
                                    "cmd": "delete_idea",
                                    "id": id,
                                }))
                            }
                            "link" => {
                                // Programmatic typed-edge creation. Body-parsed
                                // edges (inline `[[X]]`, `supersedes:[[X]]`, …)
                                // go through the store path; this is the
                                // direct wire for UI "+ Link" flows and LLM
                                // tool calls that want to assert a relation.
                                let mut ipc = args.clone();
                                ipc["cmd"] = serde_json::json!("link_idea");
                                // Recall cache lives daemon-side now; the daemon
                                // invalidates it on any write (link_idea included).
                                call_ipc(&ipc)
                            }
                            "feedback" => {
                                let mut ipc = serde_json::json!({
                                    "cmd": "feedback_idea",
                                    "id": args.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                                    "signal": args.get("signal").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                if let Some(w) = args.get("weight") {
                                    ipc["weight"] = w.clone();
                                }
                                if let Some(n) = args.get("note").and_then(|v| v.as_str()) {
                                    ipc["note"] = serde_json::json!(n);
                                }
                                if let Some(aid) = args.get("agent_id").and_then(|v| v.as_str()) {
                                    ipc["agent_id"] = serde_json::json!(aid);
                                }
                                call_ipc(&ipc)
                            }
                            "walk" => {
                                // Multi-hop graph traversal. The daemon
                                // scopes visibility by `agent_id` and caps
                                // max_hops at 10.
                                let mut ipc = serde_json::json!({
                                    "cmd": "walk_ideas",
                                    "from": args.get("from").and_then(|v| v.as_str()).unwrap_or(""),
                                });
                                if let Some(v) = args.get("max_hops") {
                                    ipc["max_hops"] = v.clone();
                                }
                                if let Some(v) = args.get("relations") {
                                    ipc["relations"] = v.clone();
                                }
                                if let Some(v) = args.get("strength_threshold") {
                                    ipc["strength_threshold"] = v.clone();
                                }
                                if let Some(v) = args.get("limit") {
                                    ipc["limit"] = v.clone();
                                }
                                if let Some(aid) = args.get("agent_id").and_then(|v| v.as_str()) {
                                    ipc["agent_id"] = serde_json::json!(aid);
                                }
                                call_ipc(&ipc)
                            }
                            _ => Err(anyhow::anyhow!(
                                "unknown ideas action: {action}. Use: store, search, update, delete, link, feedback, walk"
                            )),
                        }
                    }

                    // ── Quests (unified) ───────────────────────────
                    "quests" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("list");
                        let default_project = config
                            .agent_spawns
                            .first()
                            .map(|p| p.name.as_str())
                            .unwrap_or("aeqi");
                        match action {
                            "create" => {
                                let ipc = quests_create_ipc_request(&args, default_project);
                                call_ipc(&ipc)
                            }
                            "list" => {
                                let ipc = quests_list_ipc_request(&args, default_project);
                                call_ipc(&ipc)
                            }
                            "show" => call_ipc(&serde_json::json!({
                                "cmd": "get_quest",
                                "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
                                "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(default_project),
                            })),
                            "update" => {
                                let ipc = quests_update_ipc_request(&args, default_project);
                                call_ipc(&ipc)
                            }
                            "close" => {
                                let ipc = quests_close_ipc_request(&args);
                                call_ipc(&ipc)
                            }
                            "cancel" => {
                                let quest_id =
                                    args.get("quest_id").and_then(|v| v.as_str()).unwrap_or("");
                                let reason = args
                                    .get("reason")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Cancelled");
                                call_ipc(&serde_json::json!({
                                    "cmd": "update_quest",
                                    "quest_id": quest_id,
                                    "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(default_project),
                                    "status": "cancelled",
                                    "reason": reason,
                                }))
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
                                let agent_resp = call_ipc(&serde_json::json!({
                                    "cmd": "agent_info",
                                    "name": agent_hint,
                                }));
                                // Fetch assembled ideas for on_session_start — reuses the
                                // read-only trigger_event path (no record_fire, same as preflight).
                                // The old "assemble_ideas" cmd never had a daemon handler, so this
                                // field silently came back empty despite the tool advertising it.
                                let ideas_resp =
                                    call_ipc(&agents_get_context_ipc_request(agent_hint));
                                // Fetch agent's events.
                                let events_resp = call_ipc(&serde_json::json!({
                                    "cmd": "list_events",
                                    "agent": agent_hint,
                                }));
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
                                if let Some(parent) =
                                    args.get("parent_agent_id").and_then(|v| v.as_str())
                                {
                                    ipc["parent_agent_id"] = serde_json::json!(parent);
                                }
                                call_ipc(&ipc)
                            }
                            "retire" => {
                                let agent_hint =
                                    args.get("agent").and_then(|v| v.as_str()).unwrap_or("");
                                call_ipc(&serde_json::json!({
                                    "cmd": "agent_set_status",
                                    "name": agent_hint,
                                    "status": "retired",
                                }))
                            }
                            "list" => {
                                let mut ipc = serde_json::json!({"cmd": "agents_registry"});
                                if let Some(status) = args.get("status").and_then(|v| v.as_str()) {
                                    ipc["status"] = serde_json::json!(status);
                                }
                                call_ipc(&ipc)
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
                                if let Some(aid) = args.get("agent_id").and_then(|v| v.as_str()) {
                                    ipc["agent_id"] = serde_json::json!(aid);
                                }
                                if let Some(cooldown) = args.get("cooldown_secs") {
                                    ipc["cooldown_secs"] = cooldown.clone();
                                }
                                if let Some(tool_calls) = args.get("tool_calls") {
                                    ipc["tool_calls"] = tool_calls.clone();
                                }
                                call_ipc(&ipc)
                            }
                            "list" => {
                                let mut ipc = serde_json::json!({"cmd": "list_events"});
                                if let Some(agent) = args.get("agent") {
                                    ipc["agent"] = agent.clone();
                                } else if let Some(agent_id) = args.get("agent_id") {
                                    ipc["agent_id"] = agent_id.clone();
                                } else if let Some(ref aname) = agent_name {
                                    ipc["agent"] = serde_json::json!(aname);
                                }
                                call_ipc(&ipc)
                            }
                            "enable" | "disable" => {
                                let event_id =
                                    args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
                                call_ipc(&serde_json::json!({
                                    "cmd": "update_event",
                                    "id": event_id,
                                    "enabled": action == "enable",
                                }))
                            }
                            "delete" => {
                                let event_id =
                                    args.get("event_id").and_then(|v| v.as_str()).unwrap_or("");
                                call_ipc(&serde_json::json!({
                                    "cmd": "delete_event",
                                    "id": event_id,
                                }))
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
                                let mut ipc = serde_json::json!({
                                    "cmd": "trigger_event",
                                    "agent": agent,
                                    "pattern": pattern,
                                });
                                if let Some(aid) = args.get("agent_id").and_then(|v| v.as_str()) {
                                    ipc["agent_id"] = serde_json::json!(aid);
                                    ipc.as_object_mut().unwrap().remove("agent");
                                }
                                call_ipc(&ipc)
                            }
                            "trace" => {
                                // Two modes:
                                // - { session_id, limit? } → list invocations
                                // - { invocation_id }       → detail + steps
                                if let Some(inv_id) =
                                    args.get("invocation_id").and_then(|v| v.as_i64())
                                {
                                    call_ipc(&serde_json::json!({
                                        "cmd": "trace_events",
                                        "invocation_id": inv_id,
                                    }))
                                } else {
                                    let session_id = args
                                        .get("session_id")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");
                                    let limit =
                                        args.get("limit").and_then(|v| v.as_u64()).unwrap_or(50);
                                    call_ipc(&serde_json::json!({
                                        "cmd": "trace_events",
                                        "session_id": session_id,
                                        "limit": limit,
                                    }))
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

                        let graph_dir = config.data_dir().join("codegraph");
                        std::fs::create_dir_all(&graph_dir).ok();
                        let db_path = graph_dir.join(format!("{project}.db"));

                        match action {
                            "index" => {
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let repo =
                                    resolve_code_repo_path(&args, &config, project, Some(&store))?
                                        .ok_or_else(|| code_project_not_found(project))?;
                                let indexer = aeqi_graph::Indexer::new();
                                let result = indexer.index(&repo, &store)?;
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
                                let last_commit =
                                    store.get_meta("last_commit")?.unwrap_or_default();
                                let dirty_files = graph_dirty_files(&store)?;
                                let repo_path =
                                    resolve_code_repo_path(&args, &config, project, Some(&store))
                                        .ok()
                                        .flatten();
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "project": project,
                                    "repo_path": repo_path.as_ref().map(|p| p.to_string_lossy().to_string()),
                                    "nodes": stats.node_count,
                                    "edges": stats.edge_count,
                                    "files": stats.file_count,
                                    "indexed_at": indexed_at,
                                    "last_commit": last_commit,
                                    "dirty_files": dirty_files.len(),
                                    "dirty_file_paths": dirty_files,
                                }))
                            }
                            "health" => {
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let repo =
                                    resolve_code_repo_path(&args, &config, project, Some(&store))?
                                        .ok_or_else(|| code_project_not_found(project))?;
                                let health = aeqi_graph::Indexer::new().health(&repo, &store)?;
                                Ok(serde_json::json!({
                                    "ok": true,
                                    "project": project,
                                    "repo_path": repo.to_string_lossy(),
                                    "health": health,
                                }))
                            }
                            "audit" => {
                                let graph_dir = config.data_dir().join("codegraph");
                                std::fs::create_dir_all(&graph_dir).ok();
                                let mut target_projects: Vec<String> =
                                    if !config.agent_spawns.is_empty() {
                                        config.agent_spawns.iter().map(|p| p.name.clone()).collect()
                                    } else {
                                        discover_graph_projects(&graph_dir)
                                    };
                                if let Some(project_name) = args
                                    .get("project")
                                    .and_then(|v| v.as_str())
                                    .map(str::trim)
                                    .filter(|p| !p.is_empty())
                                {
                                    target_projects = vec![project_name.to_string()];
                                }

                                if target_projects.is_empty() {
                                    return Ok(serde_json::json!({
                                        "ok": true,
                                        "count": 0,
                                        "projects": [],
                                        "message": format!("No graph DBs found in {}", graph_dir.display()),
                                    }));
                                }

                                let mut reports = Vec::with_capacity(target_projects.len());
                                for project_name in target_projects {
                                    let project_db_path =
                                        graph_dir.join(format!("{project_name}.db"));
                                    let db_path_str = project_db_path.to_string_lossy().to_string();
                                    if !project_db_path.exists() {
                                        reports.push(serde_json::json!({
                                            "project": project_name,
                                            "db_path": db_path_str,
                                            "ok": false,
                                            "error": format!("missing graph DB at {}", project_db_path.display()),
                                        }));
                                        continue;
                                    }

                                    let store = match aeqi_graph::GraphStore::open(&project_db_path)
                                    {
                                        Ok(store) => store,
                                        Err(error) => {
                                            reports.push(serde_json::json!({
                                                "project": project_name,
                                                "db_path": db_path_str,
                                                "ok": false,
                                                "error": error.to_string(),
                                            }));
                                            continue;
                                        }
                                    };

                                    let repo = match resolve_code_repo_path(
                                        &args,
                                        &config,
                                        &project_name,
                                        Some(&store),
                                    ) {
                                        Ok(Some(repo)) => repo,
                                        Ok(None) => {
                                            reports.push(serde_json::json!({
                                                "project": project_name,
                                                "db_path": db_path_str,
                                                "ok": false,
                                                "error": code_project_not_found(&project_name).to_string(),
                                            }));
                                            continue;
                                        }
                                        Err(error) => {
                                            reports.push(serde_json::json!({
                                                "project": project_name,
                                                "db_path": db_path_str,
                                                "ok": false,
                                                "error": error.to_string(),
                                            }));
                                            continue;
                                        }
                                    };

                                    match aeqi_graph::Indexer::new().health(&repo, &store) {
                                        Ok(health) => reports.push(serde_json::json!({
                                            "ok": true,
                                            "project": project_name,
                                            "db_path": db_path_str,
                                            "repo_path": repo.to_string_lossy(),
                                            "health": health,
                                        })),
                                        Err(error) => reports.push(serde_json::json!({
                                            "ok": false,
                                            "project": project_name,
                                            "db_path": db_path_str,
                                            "repo_path": repo.to_string_lossy(),
                                            "error": error.to_string(),
                                        })),
                                    }
                                }

                                Ok(serde_json::json!({
                                    "ok": true,
                                    "project": project,
                                    "count": reports.len(),
                                    "projects": reports,
                                }))
                            }
                            "diff_impact" => {
                                let depth =
                                    args.get("depth").and_then(|v| v.as_u64()).unwrap_or(3) as u32;
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let repo =
                                    resolve_code_repo_path(&args, &config, project, Some(&store))?
                                        .ok_or_else(|| code_project_not_found(project))?;
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
                                    "project": project,
                                    "repo_path": repo.to_string_lossy(),
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
                                let store = aeqi_graph::GraphStore::open(&db_path)?;
                                let repo =
                                    resolve_code_repo_path(&args, &config, project, Some(&store))?
                                        .ok_or_else(|| code_project_not_found(project))?;
                                let indexer = aeqi_graph::Indexer::new();
                                let result = indexer.index_incremental(&repo, &store)?;
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

                    "browser" => {
                        let action = args
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("capabilities");
                        match action {
                            "capabilities" | "policy" | "status" => {
                                Ok(browser_capability_contract(&auth_context))
                            }
                            _ => Err(anyhow::anyhow!(
                                "browser action `{action}` is not enabled yet. Use action=capabilities to inspect the contract."
                            )),
                        }
                    }

                    _ => Err(anyhow::anyhow!("unknown tool: {tool_name}")),
                })();

                match result {
                    Ok(data) => McpResponse {
                        jsonrpc: "2.0".to_string(),
                        id: request.id.unwrap_or(serde_json::Value::Null),
                        result: Some(serde_json::json!({
                            "content": [{"type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default()}],
                            "structuredContent": data,
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

        if retire_after_response {
            eprintln!(
                "[aeqi-mcp] executable has been replaced on disk; exiting after completed request"
            );
            break;
        }
    }

    Ok(())
}

fn current_exe_has_been_replaced() -> bool {
    std::fs::read_link("/proc/self/exe")
        .ok()
        .is_some_and(|path| exe_link_target_is_deleted(&path))
}

fn exe_link_target_is_deleted(path: &Path) -> bool {
    path.to_string_lossy().ends_with(" (deleted)")
}

fn agents_get_context_ipc_request(agent_hint: &str) -> serde_json::Value {
    serde_json::json!({
        "cmd": "trigger_event",
        "agent": agent_hint,
        "pattern": "session:start",
    })
}

fn quests_create_ipc_request(args: &serde_json::Value, default_project: &str) -> serde_json::Value {
    let mut ipc = args.clone();
    ipc["cmd"] = serde_json::json!("create_quest");
    if ipc
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .is_empty()
    {
        ipc["project"] = serde_json::json!(default_project);
    }

    if let Some(dep) = ipc.get("depends_on").cloned()
        && dep.is_string()
    {
        ipc["depends_on"] = serde_json::json!([dep.as_str().unwrap_or("")]);
    }

    ipc
}

fn quests_list_ipc_request(args: &serde_json::Value, _default_project: &str) -> serde_json::Value {
    // Do NOT default `project` on list. The daemon resolves `project` to an
    // agent_id and SQL-filters quests by it, which silently drops every
    // scope:"global" quest (agent_id IS NULL). Callers who want a narrowed
    // list pass `project` (or `agent`/`agent_id`) explicitly; absent those,
    // the daemon returns the entity-visible set including globals.
    let mut ipc = serde_json::json!({ "cmd": "quests" });
    if let Some(project) = args.get("project") {
        ipc["project"] = project.clone();
    }
    if let Some(status) = args.get("status") {
        ipc["status"] = status.clone();
    }
    if let Some(agent) = args.get("agent") {
        ipc["agent"] = agent.clone();
    }
    if let Some(agent_id) = args.get("agent_id") {
        ipc["agent_id"] = agent_id.clone();
    }
    ipc
}

fn quests_update_ipc_request(args: &serde_json::Value, default_project: &str) -> serde_json::Value {
    let mut ipc = serde_json::json!({
        "cmd": "update_quest",
        "quest_id": args.get("quest_id").and_then(|v| v.as_str()).unwrap_or(""),
        "project": args.get("project").and_then(|v| v.as_str()).unwrap_or(default_project),
    });
    for field in [
        "status", "priority", "agent_id", "scope", "assignee", "due_at",
    ] {
        if let Some(value) = args.get(field) {
            ipc[field] = value.clone();
        }
    }
    ipc
}

fn quests_close_ipc_request(args: &serde_json::Value) -> serde_json::Value {
    let mut ipc = args.clone();
    ipc["cmd"] = serde_json::json!("close_quest");
    if ipc.get("reason").and_then(|v| v.as_str()).is_none()
        && let Some(result) = args.get("result").and_then(|v| v.as_str())
    {
        ipc["reason"] = serde_json::json!(result);
    }
    ipc
}

fn resolve_code_repo_path(
    args: &serde_json::Value,
    config: &aeqi_core::config::AEQIConfig,
    project: &str,
    store: Option<&aeqi_graph::GraphStore>,
) -> anyhow::Result<Option<PathBuf>> {
    if let Some(repo) = args
        .get("repo_path")
        .or_else(|| args.get("repo"))
        .and_then(|v| v.as_str())
        .map(expand_path)
        .and_then(existing_dir)
    {
        return Ok(Some(repo));
    }

    if let Some(repo) = config
        .agent_spawns
        .iter()
        .find(|p| p.name == project)
        .map(|p| config.resolve_repo(&p.repo))
        .map(expand_pathbuf)
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

fn expand_path(path: &str) -> PathBuf {
    PathBuf::from(expand_tilde(path))
}

fn expand_pathbuf(path: PathBuf) -> PathBuf {
    PathBuf::from(expand_tilde(&path.to_string_lossy()))
}

fn existing_dir(path: PathBuf) -> Option<PathBuf> {
    if path.is_dir() {
        Some(std::fs::canonicalize(&path).unwrap_or(path))
    } else {
        None
    }
}

fn discover_repo_by_project_name(project: &str) -> Option<PathBuf> {
    if project.contains('/') || project.contains('\\') || project == "." || project == ".." {
        return None;
    }

    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home);
    }
    roots.push(PathBuf::from("/workspace"));

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

fn expand_tilde(path: &str) -> String {
    if path.starts_with('~')
        && let Some(home) = dirs::home_dir()
    {
        return path.replacen('~', &home.to_string_lossy(), 1);
    }
    path.to_string()
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

fn discover_graph_projects(graph_dir: &Path) -> Vec<String> {
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

#[allow(dead_code)]
fn graph_health_snapshot(store: &aeqi_graph::GraphStore) -> anyhow::Result<GraphHealthSnapshot> {
    let repo_path = store
        .get_meta("repo_path")?
        .filter(|value| !value.trim().is_empty());
    let indexed_at = store
        .get_meta("indexed_at")?
        .filter(|value| !value.trim().is_empty());
    let last_commit = store
        .get_meta("last_commit")?
        .filter(|value| !value.trim().is_empty());
    let dirty_files = graph_dirty_files(store)?;

    if let Some(repo_path_str) = repo_path.as_deref() {
        let repo_path = PathBuf::from(repo_path_str);
        if repo_path.is_dir() {
            let health = aeqi_graph::Indexer::new().health(&repo_path, store)?;
            return Ok(GraphHealthSnapshot {
                repo_path: Some(repo_path.to_string_lossy().to_string()),
                indexed_at,
                last_commit,
                dirty_files,
                missing_files: health.missing_files.clone(),
                missing_subtrees: derive_missing_subtrees(&health.missing_files),
                coverage_ratio: Some(health.coverage_ratio),
                freshness_state: freshness_state_label(health.freshness_state).to_string(),
            });
        }
    }

    let freshness_state = if repo_path.is_some() || indexed_at.is_some() || last_commit.is_some() {
        "stale"
    } else {
        "missing"
    };

    Ok(GraphHealthSnapshot {
        repo_path,
        indexed_at,
        last_commit,
        dirty_files,
        missing_files: Vec::new(),
        missing_subtrees: Vec::new(),
        coverage_ratio: None,
        freshness_state: freshness_state.to_string(),
    })
}

#[allow(dead_code)]
fn derive_missing_subtrees(missing_files: &[String]) -> Vec<String> {
    let mut subtrees = std::collections::BTreeSet::new();
    for missing in missing_files {
        let path = Path::new(missing);
        if let Some(parent) = path.parent()
            && let Some(first) = parent.components().next()
        {
            subtrees.insert(first.as_os_str().to_string_lossy().to_string());
        } else if !missing.is_empty() {
            subtrees.insert(".".to_string());
        }
    }
    subtrees.into_iter().collect()
}

#[allow(dead_code)]
fn freshness_state_label(state: aeqi_graph::GraphFreshnessState) -> &'static str {
    match state {
        aeqi_graph::GraphFreshnessState::Fresh => "fresh",
        aeqi_graph::GraphFreshnessState::Partial => "partial",
        aeqi_graph::GraphFreshnessState::Stale => "stale",
        aeqi_graph::GraphFreshnessState::Missing => "missing",
    }
}

#[allow(dead_code)]
fn same_path(left: &Path, right: &Path) -> bool {
    match (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
        (Ok(a), Ok(b)) => a == b,
        _ => left == right,
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
struct GraphHealthSnapshot {
    repo_path: Option<String>,
    indexed_at: Option<String>,
    last_commit: Option<String>,
    dirty_files: Vec<String>,
    missing_files: Vec<String>,
    missing_subtrees: Vec<String>,
    coverage_ratio: Option<f64>,
    freshness_state: String,
}

impl GraphHealthSnapshot {
    #[allow(dead_code)]
    fn effective_freshness(&self) -> &str {
        if self.freshness_state.is_empty() {
            "missing"
        } else {
            self.freshness_state.as_str()
        }
    }
}

#[allow(dead_code)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct GraphRootReport {
    name: String,
    configured_repo: String,
    indexed_repo_path: Option<String>,
    db_path: String,
    repo_present: bool,
    db_present: bool,
    status: String,
    freshness_state: String,
    notes: Vec<String>,
    stats: Option<aeqi_graph::GraphStats>,
    health: GraphHealthSnapshot,
}

#[allow(dead_code)]
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct GraphAuditReport {
    generated_at: String,
    root_filter: Option<String>,
    project_count: usize,
    healthy_count: usize,
    stale_count: usize,
    missing_count: usize,
    error_count: usize,
    roots: Vec<GraphRootReport>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Snapshot the `ideas` MCP tool action enum. Fires loudly on any
    /// add/remove/rename so the dev is forced to:
    ///   - update the dispatch arm in `cmd_mcp`
    ///   - refresh `aeqi-docs/docs/concepts/ideas.md` ("REST <-> MCP surface")
    ///   - decide whether the change should also touch
    ///     `crates/aeqi-web/src/routes/ideas.rs`
    ///
    /// See the full contract on `IDEAS_MCP_ACTIONS`.
    #[test]
    fn ideas_mcp_action_enum_drift_guard() {
        let expected: &[&str] = &[
            "store", "search", "update", "delete", "link", "feedback", "walk",
        ];
        assert_eq!(
            IDEAS_MCP_ACTIONS, expected,
            "ideas MCP action enum changed - update aeqi-docs/docs/concepts/ideas.md \
             (REST <-> MCP surface table), the dispatch arm in cmd_mcp, and decide \
             whether the change also belongs on the REST surface in \
             crates/aeqi-web/src/routes/ideas.rs. Then update this snapshot."
        );
    }

    #[test]
    fn connect_with_retry_succeeds_immediately_when_socket_exists() {
        let tmp = tempfile::tempdir().expect("tmp dir");
        let sock_path = tmp.path().join("rm.sock");
        let _listener = std::os::unix::net::UnixListener::bind(&sock_path).expect("bind listener");

        let stream = connect_with_retry(&sock_path).expect("connect should succeed");
        drop(stream);
    }

    #[test]
    fn connect_with_retry_rides_through_late_socket_bind() {
        let tmp = tempfile::tempdir().expect("tmp dir");
        let sock_path = tmp.path().join("rm.sock");

        let bind_path = sock_path.clone();
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            std::os::unix::net::UnixListener::bind(&bind_path).expect("late bind")
        });

        let stream = connect_with_retry(&sock_path).expect("connect should ride the retry");
        drop(stream);
        let _listener = handle.join().expect("bind thread joined");
    }

    #[test]
    fn detects_deleted_proc_exe_target() {
        assert!(exe_link_target_is_deleted(Path::new(
            "/home/me/aeqi/target/release/aeqi (deleted)"
        )));
        assert!(!exe_link_target_is_deleted(Path::new(
            "/home/me/aeqi/target/release/aeqi"
        )));
    }

    #[test]
    fn agents_get_context_uses_trigger_event_with_session_start() {
        let req = agents_get_context_ipc_request("worker-1");
        assert_eq!(req["cmd"], "trigger_event");
        assert_eq!(req["pattern"], "session:start");
        assert_eq!(req["agent"], "worker-1");
    }

    #[test]
    fn quests_create_request_does_not_invent_agent_scope() {
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
    fn quests_create_request_defaults_project_for_mcp_clients() {
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
    fn quests_list_request_only_filters_explicit_agent() {
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
    fn quests_list_request_does_not_default_project() {
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
    fn quests_list_request_forwards_agent_id() {
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
    fn quests_update_request_forwards_assignment_fields() {
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
    fn quests_close_request_maps_result_to_reason() {
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
    fn quests_close_request_preserves_explicit_reason() {
        let req = quests_close_ipc_request(&serde_json::json!({
            "action": "close",
            "quest_id": "ae-015",
            "result": "Tool result text",
            "reason": "Explicit audit reason",
        }));

        assert_eq!(req["reason"], "Explicit audit reason");
    }

    #[test]
    fn stdio_code_repo_resolution_prefers_explicit_repo_path() {
        let repo = tempfile::tempdir().unwrap();
        let configured = tempfile::tempdir().unwrap();
        let config = aeqi_core::config::AEQIConfig::parse(&format!(
            r#"
[aeqi]
name = "test"

[[projects]]
name = "aeqi"
prefix = "ae"
repo = "{}"
"#,
            configured.path().display()
        ))
        .unwrap();

        let resolved = resolve_code_repo_path(
            &serde_json::json!({"repo_path": repo.path().to_string_lossy()}),
            &config,
            "aeqi",
            None,
        )
        .unwrap()
        .unwrap();

        assert_eq!(resolved, std::fs::canonicalize(repo.path()).unwrap());
    }

    #[test]
    fn stdio_code_repo_resolution_uses_config_repo_key() {
        let repo = tempfile::tempdir().unwrap();
        let config = aeqi_core::config::AEQIConfig::parse(&format!(
            r#"
[aeqi]
name = "test"

[repos]
main = "{}"

[[projects]]
name = "aeqi"
prefix = "ae"
repo = "main"
"#,
            repo.path().display()
        ))
        .unwrap();

        let resolved = resolve_code_repo_path(&serde_json::json!({}), &config, "aeqi", None)
            .unwrap()
            .unwrap();

        assert_eq!(resolved, std::fs::canonicalize(repo.path()).unwrap());
    }

    #[test]
    fn stdio_code_repo_resolution_uses_graph_metadata_without_config() {
        let repo = tempfile::tempdir().unwrap();
        let config = aeqi_core::config::AEQIConfig::parse(
            r#"
[aeqi]
name = "test"
"#,
        )
        .unwrap();
        let store = aeqi_graph::GraphStore::open_in_memory().unwrap();
        store
            .set_meta("repo_path", repo.path().to_string_lossy().as_ref())
            .unwrap();

        let resolved =
            resolve_code_repo_path(&serde_json::json!({}), &config, "aeqi", Some(&store))
                .unwrap()
                .unwrap();

        assert_eq!(resolved, std::fs::canonicalize(repo.path()).unwrap());
    }

    #[test]
    fn platform_auth_context_parses_current_validate_shape() {
        let parsed = serde_json::json!({
            "ok": true,
            "root": "entity-1",
            "user_id": "user-1",
            "runtime": {
                "type": "host",
                "socket": "/tmp/aeqi.sock",
                "host": "127.0.0.1",
                "port": 8502
            }
        });

        let (auth, socket) = McpAuthContext::from_platform_response(&parsed).unwrap();

        assert_eq!(socket, PathBuf::from("/tmp/aeqi.sock"));
        assert_eq!(auth.mode, "platform");
        assert_eq!(auth.root.as_deref(), Some("entity-1"));
        assert_eq!(auth.trust_id.as_deref(), Some("entity-1"));
        assert_eq!(auth.user_id.as_deref(), Some("user-1"));
        assert_eq!(auth.allowed_roots, vec!["entity-1"]);
        assert_eq!(auth.actor.kind, "user");
        assert_eq!(auth.actor.user_id.as_deref(), Some("user-1"));
        assert_eq!(auth.actor.trust_id.as_deref(), Some("entity-1"));
    }

    #[test]
    fn platform_auth_context_preserves_expanded_actor_shape() {
        let parsed = serde_json::json!({
            "ok": true,
            "trust_id": "company-1",
            "user_id": "user-1",
            "allowed_roots": ["company-1", "project-a"],
            "actor": {
                "kind": "user",
                "user_id": "user-1",
                "trust_id": "company-1",
                "roles": ["Director"],
                "grants": ["*"]
            },
            "runtime": {
                "type": "host",
                "socket": "/tmp/aeqi.sock"
            }
        });

        let (auth, _) = McpAuthContext::from_platform_response(&parsed).unwrap();

        assert_eq!(auth.allowed_roots, vec!["company-1", "project-a"]);
        assert_eq!(auth.actor.roles, vec!["Director"]);
        assert_eq!(auth.actor.grants, vec!["*"]);
    }

    #[test]
    fn auth_context_injects_actor_into_ipc_request() {
        let parsed = serde_json::json!({
            "ok": true,
            "root": "entity-1",
            "user_id": "user-1",
            "runtime": {
                "type": "host",
                "socket": "/tmp/aeqi.sock"
            }
        });
        let (auth, _) = McpAuthContext::from_platform_response(&parsed).unwrap();
        let mut request = serde_json::json!({"cmd": "create_quest", "project": "aeqi"});

        auth.apply_to_ipc(&mut request);

        assert_eq!(request["caller_user_id"], "user-1");
        assert_eq!(request["caller_entity_id"], "entity-1");
        assert_eq!(request["actor"]["kind"], "user");
        assert_eq!(request["actor"]["user_id"], "user-1");
        assert!(request.get("allowed_roots").is_none());
    }

    #[test]
    fn auth_context_keeps_authorized_roots_in_profile_only() {
        let parsed = serde_json::json!({
            "ok": true,
            "root": "entity-1",
            "user_id": "user-1",
            "runtime": {
                "type": "host",
                "socket": "/tmp/aeqi.sock"
            }
        });
        let (auth, _) = McpAuthContext::from_platform_response(&parsed).unwrap();
        let profile = auth.public_json();

        assert_eq!(profile["allowed_roots"], serde_json::json!(["entity-1"]));
    }
}
