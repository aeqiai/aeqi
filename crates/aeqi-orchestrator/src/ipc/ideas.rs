//! Idea CRUD and search IPC handlers.
//!
//! Consolidates the former `memory` module handlers under the canonical `idea`
//! naming.  The daemon dispatch keeps `"memories"` etc. as backward-compat
//! aliases that route into these same functions.

use std::path::PathBuf;

use super::request_field;

pub async fn handle_list_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
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
    let Some(ref idea_store) = ctx.idea_store else {
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

    let key = request_field(request, "key");
    let content = request_field(request, "content");
    let category = request_field(request, "category").map(|c| match c {
        "procedure" => aeqi_core::traits::IdeaCategory::Procedure,
        "preference" => aeqi_core::traits::IdeaCategory::Preference,
        "context" => aeqi_core::traits::IdeaCategory::Context,
        "evergreen" => aeqi_core::traits::IdeaCategory::Evergreen,
        _ => aeqi_core::traits::IdeaCategory::Fact,
    });

    match idea_store.update(id, key, content, category).await {
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

// ── Handlers migrated from the former `memory` IPC module ─────────────────

pub async fn handle_ideas_search(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let query = request.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;
    let scope = request
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or("domain");
    let agent_id_param = request.get("agent_id").and_then(|v| v.as_str());

    if allowed.is_some() && (project.is_empty() || project == "*") {
        return serde_json::json!({"ok": true, "ideas": [], "count": 0});
    }

    if let Some(ref engine) = ctx.message_router {
        if let Some(mem) = engine.idea_store.as_ref() {
            let mut mq = aeqi_core::traits::IdeaQuery::new(query, limit);
            match scope {
                "entity" => {
                    if let Some(aid) = agent_id_param {
                        mq = mq.with_agent(aid);
                    }
                }
                "system" => {}
                _ => {
                    if let Some(aid) = agent_id_param {
                        mq = mq.with_agent(aid);
                    }
                }
            }
            match mem.search(&mq).await {
                Ok(entries) => {
                    let rows: Vec<serde_json::Value> = entries
                        .iter()
                        .map(|e| {
                            serde_json::json!({
                                "id": e.id,
                                "key": e.key,
                                "content": e.content,
                                "category": format!("{:?}", e.category),
                                "agent_id": e.agent_id,
                                "created_at": e.created_at.to_rfc3339(),
                            })
                        })
                        .collect();
                    serde_json::json!({"ok": true, "ideas": rows, "count": rows.len()})
                }
                Err(e) => {
                    serde_json::json!({"ok": false, "error": format!("search failed: {e}")})
                }
            }
        } else {
            serde_json::json!({"ok": true, "ideas": [], "count": 0})
        }
    } else {
        serde_json::json!({"ok": true, "ideas": []})
    }
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
        let fetch = |categories: &[&str]| -> Vec<serde_json::Value> {
            let placeholders: Vec<String> =
                categories.iter().map(|c| format!("LOWER('{c}')")).collect();
            let sql = format!(
                "SELECT id, key, content, category, scope, created_at \
                 FROM ideas \
                 WHERE LOWER(category) IN ({}) \
                 ORDER BY created_at DESC \
                 LIMIT 20",
                placeholders.join(", ")
            );
            conn.prepare(&sql)
                .ok()
                .map(|mut stmt| {
                    stmt.query_map([], |row| {
                        Ok(serde_json::json!({
                            "id": row.get::<_, String>(0)?,
                            "key": row.get::<_, String>(1)?,
                            "content": row.get::<_, String>(2)?,
                            "category": row.get::<_, String>(3)?,
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
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let graph_project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

    if allowed.is_some() && (graph_project.is_empty() || graph_project == "*") {
        return serde_json::json!({"ok": true, "nodes": [], "edges": []});
    }

    let aeqi_data_dir = std::env::var("HOME")
        .map(|h| PathBuf::from(h).join(".aeqi"))
        .unwrap_or_else(|_| PathBuf::from("/tmp"));
    let db_path = aeqi_data_dir.join("aeqi.db");
    if !db_path.exists() {
        return serde_json::json!({"ok": true, "nodes": [], "edges": []});
    }

    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let sql = format!(
            "SELECT id, key, content, category, created_at \
             FROM ideas \
             ORDER BY created_at DESC \
             LIMIT {limit}"
        );
        let nodes: Vec<serde_json::Value> =
            conn.prepare(&sql)
                .ok()
                .map(|mut stmt| {
                    stmt.query_map([], |row| {
                        let id: String = row.get(0)?;
                        let key: String = row.get(1)?;
                        let content: String = row.get(2)?;
                        let category: String = row.get(3)?;
                        let created_at: String = row.get(4)?;

                        use std::hash::{Hash, Hasher};
                        let mut h = std::collections::hash_map::DefaultHasher::new();
                        key.hash(&mut h);
                        let x = (h.finish() % 1000) as u32;

                        let mut h2 = std::collections::hash_map::DefaultHasher::new();
                        content.hash(&mut h2);
                        let y = (h2.finish() % 1000) as u32;

                        let hotness = chrono::NaiveDateTime::parse_from_str(
                            &created_at,
                            "%Y-%m-%dT%H:%M:%S%.f",
                        )
                        .or_else(|_| {
                            chrono::NaiveDateTime::parse_from_str(&created_at, "%Y-%m-%d %H:%M:%S")
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
                            "key": key,
                            "content": content,
                            "category": category,
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
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

    if prefix.is_empty() {
        return serde_json::json!({"ok": false, "error": "prefix required"});
    }

    if let Some(ref engine) = ctx.message_router {
        if let Some(mem) = engine.idea_store.as_ref() {
            match mem.search_by_prefix(prefix, limit) {
                Ok(entries) => {
                    let ideas: Vec<serde_json::Value> = entries
                        .iter()
                        .map(|e| {
                            serde_json::json!({
                                "id": e.id,
                                "key": e.key,
                                "content": e.content,
                                "category": e.category,
                                "agent_id": e.agent_id,
                                "created_at": e.created_at.to_rfc3339(),
                            })
                        })
                        .collect();
                    serde_json::json!({"ok": true, "ideas": ideas, "count": ideas.len()})
                }
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        } else {
            serde_json::json!({"ok": false, "error": "no idea store available"})
        }
    } else {
        serde_json::json!({"ok": false, "error": "chat engine not initialized"})
    }
}

pub async fn handle_company_knowledge(
    _ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if project.is_empty() {
        return serde_json::json!({"ok": false, "error": "project required"});
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    let project_dir = cwd.join("projects").join(project);
    let mut files = serde_json::Map::new();
    let knowledge_files = ["KNOWLEDGE.md", "AGENTS.md", "HEARTBEAT.md", "project.toml"];
    for filename in &knowledge_files {
        let path = project_dir.join(filename);
        if path.exists()
            && let Ok(content) = std::fs::read_to_string(&path)
        {
            files.insert(filename.to_string(), serde_json::Value::String(content));
        }
    }
    serde_json::json!({"ok": true, "project": project, "files": files})
}

pub async fn handle_channel_knowledge(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let query = request.get("query").and_then(|v| v.as_str()).unwrap_or("");
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(15) as usize;

    if project.is_empty() {
        return serde_json::json!({"ok": false, "error": "project required"});
    }

    let mut items: Vec<serde_json::Value> = Vec::new();

    if let Some(ref engine) = ctx.message_router
        && let Some(mem) = engine.idea_store.as_ref()
    {
        let q = if query.is_empty() { project } else { query };
        let mq = aeqi_core::traits::IdeaQuery::new(q, limit);
        if let Ok(results) = mem.search(&mq).await {
            for entry in results {
                items.push(serde_json::json!({
                    "id": entry.id,
                    "key": entry.key,
                    "content": entry.content,
                    "category": format!("{:?}", entry.category).to_lowercase(),
                    "agent_id": entry.agent_id,
                    "source": "ideas",
                    "created_at": entry.created_at.to_rfc3339(),
                    "project": project,
                }));
            }
        }
    }

    serde_json::json!({"ok": true, "items": items, "count": items.len()})
}

pub async fn handle_knowledge_store(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let key = request.get("key").and_then(|v| v.as_str()).unwrap_or("");
    let content = request
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let category = request
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("fact");
    let scope = request
        .get("scope")
        .and_then(|v| v.as_str())
        .unwrap_or("domain");

    if project.is_empty() || key.is_empty() || content.is_empty() {
        return serde_json::json!({"ok": false, "error": "project, key, and content required"});
    }

    if let Some(ref engine) = ctx.message_router {
        if let Some(mem) = engine.idea_store.as_ref() {
            let cat = match category {
                "procedure" => aeqi_core::traits::IdeaCategory::Procedure,
                "preference" => aeqi_core::traits::IdeaCategory::Preference,
                "context" => aeqi_core::traits::IdeaCategory::Context,
                "evergreen" => aeqi_core::traits::IdeaCategory::Evergreen,
                _ => aeqi_core::traits::IdeaCategory::Fact,
            };
            let raw_agent_id = request.get("agent_id").and_then(|v| v.as_str());
            let agent_id = match scope {
                "system" => None,
                _ => raw_agent_id,
            };
            let ttl_secs = request.get("ttl_secs").and_then(|v| v.as_u64());
            match mem
                .store_with_ttl(key, content, cat, agent_id, ttl_secs)
                .await
            {
                Ok(id) => serde_json::json!({"ok": true, "id": id}),
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        } else {
            serde_json::json!({"ok": false, "error": format!("no idea store available: {project}")})
        }
    } else {
        serde_json::json!({"ok": false, "error": "chat engine not initialized"})
    }
}

pub async fn handle_knowledge_delete(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let id = request.get("id").and_then(|v| v.as_str()).unwrap_or("");

    if project.is_empty() || id.is_empty() {
        return serde_json::json!({"ok": false, "error": "project and id required"});
    }

    if let Some(ref engine) = ctx.message_router {
        if let Some(mem) = engine.idea_store.as_ref() {
            match mem.delete(id).await {
                Ok(_) => serde_json::json!({"ok": true}),
                Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        } else {
            serde_json::json!({"ok": false, "error": "no idea store available"})
        }
    } else {
        serde_json::json!({"ok": false, "error": "chat engine not initialized"})
    }
}
