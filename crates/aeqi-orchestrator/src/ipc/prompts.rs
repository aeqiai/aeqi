//! Prompt and idea store IPC handlers.

use super::request_field;
use std::path::Path;

pub async fn handle_list_prompts(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let tag = request_field(request, "tag");
    match ctx.agent_registry.list_prompts(tag).await {
        Ok(prompts) => {
            let items: Vec<serde_json::Value> = prompts
                .iter()
                .map(|p| {
                    serde_json::json!({
                        "id": p.id,
                        "content_hash": p.content_hash,
                        "name": p.name,
                        "content": p.content,
                        "tags": p.tags,
                        "source_kind": p.source_kind,
                        "source_ref": p.source_ref,
                        "managed": p.managed,
                        "source_hash": p.source_hash,
                        "created_at": p.created_at,
                        "updated_at": p.updated_at,
                    })
                })
                .collect();
            serde_json::json!({"ok": true, "prompts": items})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_get_prompt(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }
    match ctx.agent_registry.get_prompt(id).await {
        Ok(Some(p)) => serde_json::json!({
            "ok": true,
            "prompt": {
                "id": p.id,
                "content_hash": p.content_hash,
                "name": p.name,
                "content": p.content,
                "tags": p.tags,
                "source_kind": p.source_kind,
                "source_ref": p.source_ref,
                "managed": p.managed,
                "source_hash": p.source_hash,
                "created_at": p.created_at,
                "updated_at": p.updated_at,
            }
        }),
        Ok(None) => serde_json::json!({"ok": false, "error": format!("prompt '{id}' not found")}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_create_prompt(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request_field(request, "name").unwrap_or("");
    let content = request_field(request, "content").unwrap_or("");
    if name.is_empty() || content.is_empty() {
        return serde_json::json!({"ok": false, "error": "name and content are required"});
    }
    let tags: Vec<String> = request
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    match ctx.agent_registry.create_prompt(name, content, &tags).await {
        Ok(id) => serde_json::json!({"ok": true, "id": id}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_update_prompt(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }
    let name = request_field(request, "name");
    let content = request_field(request, "content");
    let tags: Option<Vec<String>> = request.get("tags").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    });

    match ctx
        .agent_registry
        .update_prompt(id, name, content, tags.as_deref())
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_delete_prompt(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }
    match ctx.agent_registry.delete_prompt(id).await {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Import .md files from a directory into the prompt store.
/// Files with YAML frontmatter get their name/tags from it; others use the filename.
pub async fn handle_import_prompts(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let dir = request_field(request, "dir").unwrap_or("");
    if dir.is_empty() {
        return serde_json::json!({"ok": false, "error": "dir is required"});
    }
    let path = Path::new(dir);
    if !path.exists() || !path.is_dir() {
        return serde_json::json!({"ok": false, "error": format!("directory not found: {dir}")});
    }

    let mut imported = 0u32;
    let mut updated = 0u32;
    let mut skipped = 0u32;
    let mut errors = Vec::new();

    let entries: Vec<_> = std::fs::read_dir(path)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| {
            e.path().extension().and_then(|x| x.to_str()) == Some("md") && e.path().is_file()
        })
        .collect();

    for entry in entries {
        let file_path = entry.path();
        let content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                errors.push(format!("{}: {e}", file_path.display()));
                continue;
            }
        };

        // Parse frontmatter if present.
        let parsed = parse_prompt_file(&file_path, &content);

        let source_ref = std::fs::canonicalize(&file_path)
            .unwrap_or(file_path.clone())
            .display()
            .to_string();

        match ctx
            .agent_registry
            .upsert_managed_prompt(
                &parsed.name,
                &parsed.body,
                &parsed.tags,
                &parsed.position,
                &parsed.scope,
                &parsed.tool_allow,
                &parsed.tool_deny,
                "file",
                &source_ref,
            )
            .await
        {
            Ok((_id, status)) => {
                match status {
                    "created" => imported += 1,
                    "updated" => updated += 1,
                    _ => skipped += 1,
                }
            }
            Err(e) => errors.push(format!("{}: {e}", parsed.name)),
        }
    }

    serde_json::json!({
        "ok": true,
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "errors": errors,
    })
}

/// Parse a prompt .md file. Extracts name and tags from YAML frontmatter if present.
/// Parsed prompt file with all metadata.
struct ParsedPromptFile {
    name: String,
    tags: Vec<String>,
    body: String,
    position: String,
    scope: String,
    tool_allow: Vec<String>,
    tool_deny: Vec<String>,
}

fn parse_prompt_file(path: &Path, content: &str) -> ParsedPromptFile {
    let default_name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    fn extract_string_array(fm: &serde_json::Value, key: &str) -> Vec<String> {
        fm.get(key)
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }

    match aeqi_core::frontmatter::parse_frontmatter(content) {
        Ok((fm, body)) => {
            let name = fm
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| default_name.clone());
            let tags = extract_string_array(&fm, "tags");
            let position = fm
                .get("position")
                .and_then(|v| v.as_str())
                .unwrap_or("append")
                .to_string();
            let scope = fm
                .get("scope")
                .and_then(|v| v.as_str())
                .unwrap_or("self")
                .to_string();
            let tool_allow = extract_string_array(&fm, "tools");
            let tool_deny = extract_string_array(&fm, "deny");
            ParsedPromptFile {
                name,
                tags,
                body,
                position,
                scope,
                tool_allow,
                tool_deny,
            }
        }
        Err(_) => ParsedPromptFile {
            name: default_name,
            tags: Vec::new(),
            body: content.to_string(),
            position: "system".to_string(),
            scope: "self".to_string(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        },
    }
}

/// Seed ideas into a tenant's idea store + spawn agents.
/// Called by the platform after company provisioning.
///
/// Request shape:
/// ```json
/// {
///   "cmd": "seed_ideas",
///   "ideas": [
///     { "name": "...", "content": "...", "tags": [...],
///       "injection_mode": "system", "inheritance": "self",
///       "tool_allow": [], "tool_deny": [] }
///   ],
///   "agents": [
///     { "name": "shadow", "template": "shadow-identity",
///       "display_name": "Shadow", "model": "..." }
///   ]
/// }
/// ```
pub async fn handle_seed_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let ideas = request.get("ideas").and_then(|v| v.as_array());
    let agents = request.get("agents").and_then(|v| v.as_array());

    let idea_store = ctx
        .message_router
        .as_ref()
        .and_then(|mr| mr.idea_store.as_ref());

    let Some(idea_store) = idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let mut idea_results = Vec::new();

    // Phase 1: Store ideas.
    if let Some(ideas) = ideas {
        for idea_val in ideas {
            let name = idea_val["name"].as_str().unwrap_or("");
            let content = idea_val["content"].as_str().unwrap_or("");
            if name.is_empty() || content.is_empty() {
                idea_results.push(serde_json::json!({"name": name, "status": "skipped", "reason": "empty"}));
                continue;
            }

            let injection_mode = idea_val["injection_mode"].as_str().unwrap_or("system");
            let inheritance = idea_val["inheritance"].as_str().unwrap_or("self");

            let tool_allow: Vec<String> = idea_val["tool_allow"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();
            let tool_deny: Vec<String> = idea_val["tool_deny"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default();

            // Determine agent_id — if this idea is tied to an agent, use the agent's name.
            // We'll resolve to actual agent UUIDs after agent spawning.
            let agent_id = idea_val["agent_id"].as_str();

            match idea_store
                .store_prompt(
                    name,
                    content,
                    agent_id,
                    injection_mode,
                    inheritance,
                    &tool_allow,
                    &tool_deny,
                )
                .await
            {
                Ok(id) => {
                    idea_results.push(serde_json::json!({"name": name, "id": id, "status": "created"}));
                }
                Err(e) => {
                    idea_results.push(serde_json::json!({"name": name, "status": "error", "error": e.to_string()}));
                }
            }
        }
    }

    // Phase 2: Spawn agents.
    let mut agent_results = Vec::new();
    if let Some(agents) = agents {
        for agent_val in agents {
            let name = agent_val["name"].as_str().unwrap_or("");
            let display_name = agent_val["display_name"].as_str();
            let model = agent_val["model"].as_str();
            let template = agent_val["template"].as_str().unwrap_or("seeded");

            if name.is_empty() {
                agent_results.push(serde_json::json!({"name": name, "status": "skipped"}));
                continue;
            }

            // Skip if agent already exists.
            if let Ok(Some(_)) = ctx.agent_registry.get_active_by_name(name).await {
                agent_results.push(serde_json::json!({"name": name, "status": "exists"}));
                continue;
            }

            // Find the identity idea for this agent (match by template name).
            let system_prompt = ideas
                .and_then(|ideas| {
                    ideas.iter().find(|i| i["name"].as_str() == Some(template))
                })
                .and_then(|i| i["content"].as_str())
                .unwrap_or("You are a helpful AI agent.");

            match ctx
                .agent_registry
                .spawn(name, display_name, template, system_prompt, None, model, &[])
                .await
            {
                Ok(agent) => {
                    agent_results.push(serde_json::json!({
                        "name": name,
                        "id": agent.id,
                        "status": "spawned",
                    }));
                }
                Err(e) => {
                    agent_results.push(serde_json::json!({
                        "name": name,
                        "status": "error",
                        "error": e.to_string(),
                    }));
                }
            }
        }
    }

    serde_json::json!({
        "ok": true,
        "ideas": idea_results,
        "agents": agent_results,
    })
}
