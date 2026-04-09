//! Prompt store IPC handlers.

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
        let (name, tags, body) = parse_prompt_file(&file_path, &content);

        // Skip if a prompt with this name already exists.
        if let Ok(existing) = ctx.agent_registry.list_prompts(None).await
            && existing.iter().any(|p| p.name == name)
        {
            skipped += 1;
            continue;
        }

        match ctx.agent_registry.create_prompt(&name, &body, &tags).await {
            Ok(_) => imported += 1,
            Err(e) => errors.push(format!("{name}: {e}")),
        }
    }

    serde_json::json!({
        "ok": true,
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
    })
}

/// Parse a prompt .md file. Extracts name and tags from YAML frontmatter if present.
fn parse_prompt_file(path: &Path, content: &str) -> (String, Vec<String>, String) {
    let default_name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    match aeqi_core::frontmatter::parse_frontmatter(content) {
        Ok((fm, body)) => {
            let name = fm
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| default_name.clone());
            let tags: Vec<String> = fm
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            (name, tags, body)
        }
        Err(_) => (default_name, Vec::new(), content.to_string()),
    }
}
