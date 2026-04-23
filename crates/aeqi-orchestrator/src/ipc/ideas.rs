//! Idea CRUD and search IPC handlers.

use std::collections::HashMap;
use std::sync::Arc;

use super::request_field;

pub async fn handle_list_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    // Agent-scoped path goes through AgentRegistry so it can join agent_ancestry
    // and include globals (agent_id IS NULL) + self + descendants. The trait
    // IdeaStore doesn't know about ancestry.
    if let Some(aid) = request_field(request, "agent_id") {
        match ctx.agent_registry.list_ideas_visible_to(aid).await {
            Ok(ideas) => {
                let items: Vec<serde_json::Value> = ideas.iter().map(idea_to_json).collect();
                return serde_json::json!({"ok": true, "ideas": items});
            }
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    }

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    // Unscoped: return everything (admin-ish view — typically the /ideas page).
    match idea_store.search_by_prefix("", 1000) {
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
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    // "key" is the legacy field name; pre-Apr18 MCP binaries still send it.
    let name = request_field(request, "name")
        .or_else(|| request_field(request, "key"))
        .unwrap_or("");
    let content = request_field(request, "content").unwrap_or("");

    if name.is_empty() || content.is_empty() {
        return serde_json::json!({"ok": false, "error": "name and content are required"});
    }

    let tags: Vec<String> = request
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|tags_val| {
            tags_val
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_else(|| vec!["fact".to_string()]);

    let agent_id = request_field(request, "agent_id");
    let scope: aeqi_core::Scope = request_field(request, "scope")
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            if agent_id.is_none() {
                aeqi_core::Scope::Global
            } else {
                aeqi_core::Scope::SelfScope
            }
        });
    let links = parse_links(request);

    match idea_store
        .store_with_scope(name, content, &tags, agent_id, scope)
        .await
    {
        Ok(id) => {
            for (target_id, relation) in &links {
                let _ = idea_store
                    .store_idea_edge(&id, target_id, relation, 1.0)
                    .await;
            }
            reconcile_inline_edges_in_scope(ctx, idea_store.as_ref(), &id, content, agent_id).await;
            serde_json::json!({"ok": true, "id": id})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Build a case-insensitive name→id resolver scoped to the agent's visible
/// idea set (or globals when `agent_id` is `None`) and reconcile the idea's
/// inline mention/embed edges from the body.
///
/// Errors in scope resolution or reconciliation are swallowed — inline
/// linking is a best-effort enrichment, not a store/update precondition.
async fn reconcile_inline_edges_in_scope(
    ctx: &super::CommandContext,
    idea_store: &dyn aeqi_core::traits::IdeaStore,
    source_id: &str,
    body: &str,
    agent_id: Option<&str>,
) {
    // Scope the resolver to what the agent can see; globals when unscoped.
    let scope: Vec<aeqi_core::traits::Idea> = match agent_id {
        Some(aid) => ctx
            .agent_registry
            .list_ideas_visible_to(aid)
            .await
            .unwrap_or_default(),
        None => idea_store
            .list_global_ideas(10_000)
            .await
            .unwrap_or_default(),
    };

    let mut lookup: HashMap<String, String> = HashMap::with_capacity(scope.len());
    for i in scope {
        let key = i.name.to_lowercase();
        if let Some(existing) = lookup.insert(key.clone(), i.id.clone()) {
            tracing::warn!(
                name = %i.name,
                kept_id = %i.id,
                displaced_id = %existing,
                "duplicate idea name in resolver scope; later idea wins"
            );
        }
    }
    let lookup = Arc::new(lookup);

    let lookup_cloned = Arc::clone(&lookup);
    let resolver =
        move |name: &str| -> Option<String> { lookup_cloned.get(&name.to_lowercase()).cloned() };

    if let Err(e) = idea_store
        .reconcile_inline_edges(source_id, body, &resolver)
        .await
    {
        tracing::warn!(source = %source_id, err = %e, "reconcile_inline_edges failed");
    }
}

/// Parse a `links` field from an IPC request into (target_id, relation) pairs.
/// Accepts either strings (defaulting to `adjacent` — the "+ Link" picker
/// flow) or objects with `{target_id, relation}`.
fn parse_links(request: &serde_json::Value) -> Vec<(String, String)> {
    request
        .get("links")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| match entry {
                    serde_json::Value::String(s) if !s.is_empty() => {
                        Some((s.clone(), "adjacent".to_string()))
                    }
                    serde_json::Value::Object(obj) => {
                        let target = obj.get("target_id").and_then(|v| v.as_str())?;
                        if target.is_empty() {
                            return None;
                        }
                        let rel = obj
                            .get("relation")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .unwrap_or("adjacent")
                            .to_string();
                        Some((target.to_string(), rel))
                    }
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

pub async fn handle_delete_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
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

pub async fn handle_update_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    let name = request_field(request, "name").or_else(|| request_field(request, "key"));
    let content = request_field(request, "content");
    let tags: Option<Vec<String>> = request.get("tags").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    });

    if name.is_none() && content.is_none() && tags.is_none() {
        return serde_json::json!({
            "ok": false,
            "error": "at least one of name, content, or tags is required"
        });
    }

    match idea_store.update(id, name, content, tags.as_deref()).await {
        Ok(()) => {
            // Reconcile inline edges when the body changed. We need to know
            // which agent owns the idea to scope the resolver correctly.
            if let Some(body) = content {
                let agent_id = lookup_idea_agent(idea_store.as_ref(), id).await;
                reconcile_inline_edges_in_scope(
                    ctx,
                    idea_store.as_ref(),
                    id,
                    body,
                    agent_id.as_deref(),
                )
                .await;
            }
            serde_json::json!({"ok": true})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Look up the owning agent_id for an idea. Used by update to scope the
/// inline-link resolver. Returns `None` for global ideas or on error.
async fn lookup_idea_agent(
    idea_store: &dyn aeqi_core::traits::IdeaStore,
    id: &str,
) -> Option<String> {
    idea_store
        .get_by_ids(&[id.to_string()])
        .await
        .ok()?
        .into_iter()
        .next()?
        .agent_id
}

pub async fn handle_search_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let query_text = request_field(request, "query").unwrap_or("");
    let top_k = request.get("top_k").and_then(|v| v.as_u64()).unwrap_or(20) as usize;

    let mut query = aeqi_core::traits::IdeaQuery::new(query_text, top_k);

    if let Some(agent_id) = request_field(request, "agent_id") {
        query = query.with_agent(agent_id);
    }

    if let Some(tags_val) = request.get("tags").and_then(|v| v.as_array()) {
        let parsed: Vec<String> = tags_val
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !parsed.is_empty() {
            query.tags = parsed;
        }
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
        "name": idea.name,
        "content": idea.content,
        "tags": idea.tags,
        "agent_id": idea.agent_id,
        "scope": idea.scope.as_str(),
        "created_at": idea.created_at.to_rfc3339(),
        "session_id": idea.session_id,
        "score": idea.score,
        "inheritance": idea.inheritance,
        "tool_allow": idea.tool_allow,
        "tool_deny": idea.tool_deny,
    })
}

pub async fn handle_idea_profile(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if allowed.is_some() && (project.is_empty() || project == "*") {
        return serde_json::json!({"ok": true, "profile": {"static": [], "dynamic": []}});
    }

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": true, "profile": {"static": [], "dynamic": []}});
    };

    let static_tags: Vec<String> = ["fact", "preference", "evergreen"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let dynamic_tags: Vec<String> = ["decision", "context", "insight", "procedure"]
        .iter()
        .map(|s| s.to_string())
        .collect();

    let static_ideas: Vec<serde_json::Value> =
        match idea_store.ideas_by_tags(&static_tags, 20).await {
            Ok(items) => items.iter().map(idea_to_profile_json).collect(),
            Err(_) => Vec::new(),
        };
    let dynamic_ideas: Vec<serde_json::Value> =
        match idea_store.ideas_by_tags(&dynamic_tags, 20).await {
            Ok(items) => items.iter().map(idea_to_profile_json).collect(),
            Err(_) => Vec::new(),
        };

    serde_json::json!({
        "ok": true,
        "profile": {
            "static": static_ideas,
            "dynamic": dynamic_ideas,
        }
    })
}

fn idea_to_profile_json(idea: &aeqi_core::traits::Idea) -> serde_json::Value {
    serde_json::json!({
        "id": idea.id,
        "name": idea.name,
        "content": idea.content,
        "tags": idea.tags,
        "created_at": idea.created_at.to_rfc3339(),
    })
}

pub async fn handle_idea_graph(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_id = request.get("agent_id").and_then(|v| v.as_str());
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": true, "nodes": [], "edges": []});
    };

    // Ancestry-aware scoping: self + descendants + globals (agent_id IS NULL)
    // is handled inside list_ideas_visible_to on AgentRegistry. Without an
    // agent_id we return globals only.
    let ideas: Vec<aeqi_core::traits::Idea> = if let Some(aid) = agent_id {
        match ctx.agent_registry.list_ideas_visible_to(aid).await {
            Ok(mut items) => {
                items.truncate(limit);
                items
            }
            Err(_) => Vec::new(),
        }
    } else {
        idea_store
            .list_global_ideas(limit)
            .await
            .unwrap_or_default()
    };

    let nodes: Vec<serde_json::Value> = ideas.iter().map(idea_to_graph_node).collect();
    let node_ids: Vec<String> = ideas.iter().map(|i| i.id.clone()).collect();

    let edges: Vec<serde_json::Value> = if node_ids.is_empty() {
        Vec::new()
    } else {
        let id_set: std::collections::HashSet<&str> = node_ids.iter().map(|s| s.as_str()).collect();
        match idea_store.edges_between(&node_ids).await {
            Ok(raw) => raw
                .into_iter()
                .filter(|e| {
                    id_set.contains(e.source_id.as_str()) && id_set.contains(e.target_id.as_str())
                })
                .map(|e| {
                    serde_json::json!({
                        "source": e.source_id,
                        "target": e.target_id,
                        "relation": e.relation,
                        "strength": e.strength,
                    })
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    };

    serde_json::json!({
        "ok": true,
        "nodes": nodes,
        "edges": edges,
    })
}

fn idea_to_graph_node(idea: &aeqi_core::traits::Idea) -> serde_json::Value {
    use std::hash::{Hash, Hasher};

    let mut h = std::collections::hash_map::DefaultHasher::new();
    idea.name.hash(&mut h);
    let x = (h.finish() % 1000) as u32;

    let mut h2 = std::collections::hash_map::DefaultHasher::new();
    idea.content.hash(&mut h2);
    let y = (h2.finish() % 1000) as u32;

    let age_secs = (chrono::Utc::now() - idea.created_at).num_seconds().max(0) as f64;
    let days = age_secs / 86400.0;
    let lambda = (2.0_f64).ln() / 7.0;
    let hotness = (-lambda * days).exp() as f32;

    let tags: Vec<String> = if idea.tags.is_empty() {
        vec!["untagged".to_string()]
    } else {
        idea.tags.clone()
    };

    serde_json::json!({
        "id": idea.id,
        "name": idea.name,
        "content": idea.content,
        "tags": tags,
        "x": x,
        "y": y,
        "hotness": hotness,
    })
}

pub async fn handle_add_idea_edge(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let source_id = request_field(request, "source_id").unwrap_or("");
    let target_id = request_field(request, "target_id").unwrap_or("");
    if source_id.is_empty() || target_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "source_id and target_id are required"});
    }
    if source_id == target_id {
        return serde_json::json!({"ok": false, "error": "source and target must differ"});
    }
    let relation = request_field(request, "relation").unwrap_or("adjacent");
    let strength = request
        .get("strength")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;

    match idea_store
        .store_idea_edge(source_id, target_id, relation, strength)
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_remove_idea_edge(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };
    let source_id = match request_field(request, "source_id") {
        Some(v) => v,
        None => return serde_json::json!({"ok": false, "error": "source_id is required"}),
    };
    let target_id = match request_field(request, "target_id") {
        Some(v) => v,
        None => return serde_json::json!({"ok": false, "error": "target_id is required"}),
    };
    let relation = request_field(request, "relation");

    match idea_store
        .remove_idea_edge(source_id, target_id, relation)
        .await
    {
        Ok(removed) => serde_json::json!({"ok": true, "removed": removed}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_idea_edges(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };
    let idea_id = match request_field(request, "idea_id") {
        Some(id) => id,
        None => return serde_json::json!({"ok": false, "error": "idea_id is required"}),
    };

    let edges = match idea_store.idea_edges(idea_id).await {
        Ok(e) => e,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let links: Vec<serde_json::Value> = edges
        .links
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "target_id": r.other_id,
                "name": r.other_name,
                "relation": r.relation,
                "strength": r.strength,
            })
        })
        .collect();
    let backlinks: Vec<serde_json::Value> = edges
        .backlinks
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "source_id": r.other_id,
                "name": r.other_name,
                "relation": r.relation,
                "strength": r.strength,
            })
        })
        .collect();

    serde_json::json!({
        "ok": true,
        "links": links,
        "backlinks": backlinks,
    })
}

pub async fn handle_idea_prefix(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let prefix = request.get("prefix").and_then(|v| v.as_str()).unwrap_or("");
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    match idea_store.search_by_prefix(prefix, limit) {
        Ok(entries) => {
            let ideas: Vec<serde_json::Value> = entries
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.id,
                        "name": e.name,
                        "content": e.content,
                        "tags": e.tags,
                        "agent_id": e.agent_id,
                        "created_at": e.created_at.to_rfc3339(),
                    })
                })
                .collect();
            serde_json::json!({"ok": true, "ideas": ideas, "count": ideas.len()})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}
