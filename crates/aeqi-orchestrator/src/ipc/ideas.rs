//! Idea CRUD and search IPC handlers.

use std::path::PathBuf;

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

    let name = request_field(request, "name").unwrap_or("");
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

    match idea_store.store(name, content, &tags, agent_id).await {
        Ok(id) => serde_json::json!({"ok": true, "id": id}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
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

    let name = request_field(request, "name");
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
        Ok(()) => serde_json::json!({"ok": true}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
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
        "created_at": idea.created_at.to_rfc3339(),
        "session_id": idea.session_id,
        "score": idea.score,
        "injection_mode": idea.injection_mode,
        "inheritance": idea.inheritance,
        "tool_allow": idea.tool_allow,
        "tool_deny": idea.tool_deny,
    })
}

pub async fn handle_idea_profile(
    _ctx: &super::CommandContext,
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

    let aeqi_data_dir = std::env::var("HOME")
        .map(|h| PathBuf::from(h).join(".aeqi"))
        .unwrap_or_else(|_| PathBuf::from("/tmp"));
    let db_path = aeqi_data_dir.join("aeqi.db");
    if !db_path.exists() {
        return serde_json::json!({"ok": true, "profile": {"static": [], "dynamic": []}});
    }

    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let fetch = |tags: &[&str]| -> Vec<serde_json::Value> {
            let placeholders: Vec<String> =
                tags.iter().map(|tag| format!("LOWER('{tag}')")).collect();
            let sql = format!(
                "SELECT ideas.id, ideas.key, ideas.content, \
                        COALESCE((SELECT group_concat(tag, char(31)) FROM idea_tags WHERE idea_id = ideas.id), ''), \
                        ideas.scope, ideas.created_at \
                 FROM ideas \
                 WHERE EXISTS (
                     SELECT 1 FROM idea_tags
                     WHERE idea_tags.idea_id = ideas.id
                     AND LOWER(idea_tags.tag) IN ({})
                 ) \
                 ORDER BY created_at DESC \
                 LIMIT 20",
                placeholders.join(", ")
            );
            conn.prepare(&sql)
                .ok()
                .map(|mut stmt| {
                    stmt.query_map([], |row| {
                        let tags_raw: String = row.get(3)?;
                        let tags: Vec<String> = tags_raw
                            .split('\u{1f}')
                            .filter(|tag| !tag.is_empty())
                            .map(|tag| tag.to_string())
                            .collect();
                        Ok(serde_json::json!({
                            "id": row.get::<_, String>(0)?,
                            "name": row.get::<_, String>(1)?, // DB column is `key`
                            "content": row.get::<_, String>(2)?,
                            "tags": tags,
                            "scope": row.get::<_, String>(4)?,
                            "created_at": row.get::<_, String>(5)?,
                        }))
                    })
                    .ok()
                    .map(|iter| iter.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
                })
                .unwrap_or_default()
        };

        let static_ideas = fetch(&["fact", "preference", "evergreen"]);
        let dynamic_ideas = fetch(&["decision", "context", "insight", "procedure"]);

        serde_json::json!({
            "ok": true,
            "profile": {
                "static": static_ideas,
                "dynamic": dynamic_ideas,
            }
        })
    } else {
        serde_json::json!({"ok": true, "profile": {"static": [], "dynamic": []}})
    }
}

pub async fn handle_idea_graph(
    _ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_id = request.get("agent_id").and_then(|v| v.as_str());
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

    let aeqi_data_dir = std::env::var("HOME")
        .map(|h| PathBuf::from(h).join(".aeqi"))
        .unwrap_or_else(|_| PathBuf::from("/tmp"));
    let db_path = aeqi_data_dir.join("aeqi.db");
    if !db_path.exists() {
        return serde_json::json!({"ok": true, "nodes": [], "edges": []});
    }

    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        // Ancestry-aware scoping: self + descendants + globals (agent_id IS
        // NULL). Without an agent_id we return globals only — the graph view
        // is always rendered from within an agent context.
        let (sql, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = if let Some(aid) =
            agent_id
        {
            (
                format!(
                    "SELECT id, name, content, \
                            COALESCE((SELECT group_concat(tag, char(31)) FROM idea_tags WHERE idea_id = ideas.id), ''), \
                            created_at \
                     FROM ideas \
                     WHERE agent_id IS NULL \
                        OR agent_id IN ( \
                            SELECT descendant_id FROM agent_ancestry WHERE ancestor_id = ?1 \
                        ) \
                     ORDER BY created_at DESC \
                     LIMIT {limit}"
                ),
                vec![Box::new(aid.to_string())],
            )
        } else {
            (
                format!(
                    "SELECT id, name, content, \
                            COALESCE((SELECT group_concat(tag, char(31)) FROM idea_tags WHERE idea_id = ideas.id), ''), \
                            created_at \
                     FROM ideas \
                     WHERE agent_id IS NULL \
                     ORDER BY created_at DESC \
                     LIMIT {limit}"
                ),
                vec![],
            )
        };
        let nodes: Vec<serde_json::Value> = conn
            .prepare(&sql)
            .ok()
            .map(|mut stmt| {
                let param_refs: Vec<&dyn rusqlite::types::ToSql> =
                    params.iter().map(|p| p.as_ref()).collect();
                stmt.query_map(param_refs.as_slice(), |row| {
                    let id: String = row.get(0)?;
                    let name: String = row.get(1)?; // DB column is `key`
                    let content: String = row.get(2)?;
                    let tags_raw: String = row.get(3)?;
                    let created_at: String = row.get(4)?;
                    let tags: Vec<String> = tags_raw
                        .split('\u{1f}')
                        .filter(|tag| !tag.is_empty())
                        .map(|tag| tag.to_string())
                        .collect();

                    use std::hash::{Hash, Hasher};
                    let mut h = std::collections::hash_map::DefaultHasher::new();
                    name.hash(&mut h);
                    let x = (h.finish() % 1000) as u32;

                    let mut h2 = std::collections::hash_map::DefaultHasher::new();
                    content.hash(&mut h2);
                    let y = (h2.finish() % 1000) as u32;

                    let hotness =
                        chrono::NaiveDateTime::parse_from_str(&created_at, "%Y-%m-%dT%H:%M:%S%.f")
                            .or_else(|_| {
                                chrono::NaiveDateTime::parse_from_str(
                                    &created_at,
                                    "%Y-%m-%d %H:%M:%S",
                                )
                            })
                            .map(|dt| {
                                let age_secs =
                                    (chrono::Utc::now().naive_utc().signed_duration_since(dt))
                                        .num_seconds()
                                        .max(0) as f64;
                                let days = age_secs / 86400.0;
                                let lambda = (2.0_f64).ln() / 7.0;
                                (-lambda * days).exp() as f32
                            })
                            .unwrap_or(0.5);

                    Ok(serde_json::json!({
                        "id": id,
                        "name": name,
                        "content": content,
                        "tags": if tags.is_empty() { vec!["untagged".to_string()] } else { tags },
                        "x": x,
                        "y": y,
                        "hotness": hotness,
                    }))
                })
                .ok()
                .map(|iter| iter.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
            })
            .unwrap_or_default();

        let node_ids: Vec<String> = nodes
            .iter()
            .filter_map(|n| n.get("id").and_then(|v| v.as_str()).map(String::from))
            .collect();
        let edges: Vec<serde_json::Value> = if !node_ids.is_empty() {
            let id_set: std::collections::HashSet<&str> =
                node_ids.iter().map(|s| s.as_str()).collect();
            let placeholders: String = node_ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                "SELECT source_id, target_id, relation, strength \
                 FROM memory_edges \
                 WHERE source_id IN ({placeholders}) OR target_id IN ({placeholders})"
            );
            conn.prepare(&sql)
                .ok()
                .map(|mut stmt| {
                    let params: Vec<&dyn rusqlite::types::ToSql> = node_ids
                        .iter()
                        .map(|id| id as &dyn rusqlite::types::ToSql)
                        .chain(node_ids.iter().map(|id| id as &dyn rusqlite::types::ToSql))
                        .collect();
                    stmt.query_map(params.as_slice(), |row| {
                        let source: String = row.get(0)?;
                        let target: String = row.get(1)?;
                        let relation: String = row.get(2)?;
                        let strength: f64 = row.get(3)?;
                        Ok(serde_json::json!({
                            "source": source,
                            "target": target,
                            "relation": relation,
                            "strength": strength,
                        }))
                    })
                    .ok()
                    .map(|iter| {
                        iter.filter_map(|r| r.ok())
                            .filter(|e| {
                                let s = e.get("source").and_then(|v| v.as_str()).unwrap_or("");
                                let t = e.get("target").and_then(|v| v.as_str()).unwrap_or("");
                                id_set.contains(s) && id_set.contains(t)
                            })
                            .collect()
                    })
                    .unwrap_or_default()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };

        serde_json::json!({
            "ok": true,
            "nodes": nodes,
            "edges": edges,
        })
    } else {
        serde_json::json!({"ok": true, "nodes": [], "edges": []})
    }
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
