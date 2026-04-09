//! Prompt store IPC handlers.

use super::request_field;

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
