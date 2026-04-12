//! Idea CRUD IPC handlers.

use super::request_field;

pub async fn handle_list_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let idea_store = ctx
        .message_router
        .as_ref()
        .and_then(|mr| mr.idea_store.as_ref());

    let Some(idea_store) = idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let agent_id = request_field(request, "agent_id");

    let mut query = aeqi_core::traits::IdeaQuery::new("", 1000);
    if let Some(agent_id) = agent_id {
        query = query.with_agent(agent_id);
    }

    match idea_store.search(&query).await {
        Ok(ideas) => {
            let items: Vec<serde_json::Value> = ideas.iter().map(idea_to_json).collect();
            serde_json::json!({"ok": true, "ideas": items})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_store_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let idea_store = ctx
        .message_router
        .as_ref()
        .and_then(|mr| mr.idea_store.as_ref());

    let Some(idea_store) = idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let key = request_field(request, "key").unwrap_or("");
    let content = request_field(request, "content").unwrap_or("");

    if key.is_empty() || content.is_empty() {
        return serde_json::json!({"ok": false, "error": "key and content are required"});
    }

    let category = match request_field(request, "category").unwrap_or("fact") {
        "procedure" => aeqi_core::traits::IdeaCategory::Procedure,
        "preference" => aeqi_core::traits::IdeaCategory::Preference,
        "context" => aeqi_core::traits::IdeaCategory::Context,
        "evergreen" => aeqi_core::traits::IdeaCategory::Evergreen,
        _ => aeqi_core::traits::IdeaCategory::Fact,
    };

    let agent_id = request_field(request, "agent_id");

    match idea_store.store(key, content, category, agent_id).await {
        Ok(id) => serde_json::json!({"ok": true, "id": id}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_delete_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let idea_store = ctx
        .message_router
        .as_ref()
        .and_then(|mr| mr.idea_store.as_ref());

    let Some(idea_store) = idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    match idea_store.delete(id).await {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_search_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let idea_store = ctx
        .message_router
        .as_ref()
        .and_then(|mr| mr.idea_store.as_ref());

    let Some(idea_store) = idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let query_text = request_field(request, "query").unwrap_or("");
    let top_k = request
        .get("top_k")
        .and_then(|v| v.as_u64())
        .unwrap_or(20) as usize;

    let mut query = aeqi_core::traits::IdeaQuery::new(query_text, top_k);

    if let Some(agent_id) = request_field(request, "agent_id") {
        query = query.with_agent(agent_id);
    }

    if let Some(cat_str) = request_field(request, "category") {
        query.category = Some(match cat_str {
            "procedure" => aeqi_core::traits::IdeaCategory::Procedure,
            "preference" => aeqi_core::traits::IdeaCategory::Preference,
            "context" => aeqi_core::traits::IdeaCategory::Context,
            "evergreen" => aeqi_core::traits::IdeaCategory::Evergreen,
            _ => aeqi_core::traits::IdeaCategory::Fact,
        });
    }

    match idea_store.search(&query).await {
        Ok(ideas) => {
            let items: Vec<serde_json::Value> = ideas.iter().map(idea_to_json).collect();
            serde_json::json!({"ok": true, "ideas": items})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

fn idea_to_json(idea: &aeqi_core::traits::Idea) -> serde_json::Value {
    serde_json::json!({
        "id": idea.id,
        "key": idea.key,
        "content": idea.content,
        "category": idea.category,
        "agent_id": idea.agent_id,
        "created_at": idea.created_at.to_rfc3339(),
        "session_id": idea.session_id,
        "score": idea.score,
        "injection_mode": idea.injection_mode,
        "inheritance": idea.inheritance,
        "tool_allow": idea.tool_allow,
        "tool_deny": idea.tool_deny,
    })
}
