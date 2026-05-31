//! Entity IPC handlers.
//!
//! Entity commands plus read-only entity-scoped registries such as cap-table seeds.
//!
//! Wire shape for `handle_entities` returns `{"ok": true, "roots": [...]}`.
//! The `roots` key name is preserved here for the platform proxy that
//! reshapes it into the `{ entities: [...] }` HTTP response the UI expects.

use crate::agent_registry::EntityViewUpsert;
use crate::entity_registry::EntityType;

use super::tenancy::is_allowed;

pub async fn handle_entities(
    ctx: &super::CommandContext,
    _request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let entities = match ctx.entity_registry.list().await {
        Ok(e) => e,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Tenancy filtering: an entity is in scope iff its id or slug is on
    // the allowed list. Entity UUIDs are distinct from agent UUIDs after
    // Phase 4, so callers must pass the entity id explicitly.
    let entities: Vec<_> = if allowed.is_some() {
        entities
            .into_iter()
            .filter(|e| is_allowed(allowed, &e.id) || is_allowed(allowed, &e.slug))
            .collect()
    } else {
        entities
    };

    // Pre-resolve each entity's default agent so the response can surface
    // `agent_id` — the agent_id column on `placement` rows is what the UI
    // uses to land /company/<addr>/ on the right agent.
    let all_default_agents = ctx
        .agent_registry
        .list_entity_agents()
        .await
        .unwrap_or_default();

    let mut result: Vec<serde_json::Value> = Vec::new();
    for entity in &entities {
        let backing_agent = all_default_agents
            .iter()
            .find(|a| a.company_id.as_deref() == Some(&entity.id))
            .map(|a| a.id.clone());

        // Aggregate quest counts across every agent owned by this entity.
        let entity_agents = ctx
            .agent_registry
            .list(Some(&entity.id), None)
            .await
            .unwrap_or_default();
        let mut total = 0usize;
        let mut open = 0usize;
        let mut pending = 0usize;
        let mut in_progress = 0usize;
        let mut done = 0usize;
        let mut cancelled = 0usize;
        for a in &entity_agents {
            if let Ok(tasks) = ctx.agent_registry.list_tasks(None, Some(&a.id)).await {
                total += tasks.len();
                open += tasks.iter().filter(|t| !t.is_closed()).count();
                pending += tasks
                    .iter()
                    .filter(|t| t.status == aeqi_quests::QuestStatus::Todo)
                    .count();
                in_progress += tasks
                    .iter()
                    .filter(|t| t.status == aeqi_quests::QuestStatus::InProgress)
                    .count();
                done += tasks
                    .iter()
                    .filter(|t| t.status == aeqi_quests::QuestStatus::Done)
                    .count();
                cancelled += tasks
                    .iter()
                    .filter(|t| t.status == aeqi_quests::QuestStatus::Cancelled)
                    .count();
            }
        }

        result.push(serde_json::json!({
            "id": entity.id,
            "name": entity.name,
            "display_name": entity.name,
            "agent_id": backing_agent,
            "placement_type": if backing_agent.is_some() { "runtime" } else { "personal" },
            "plan": if backing_agent.is_some() { serde_json::Value::Null } else { serde_json::json!("free") },
            "prefix": entity.slug,
            "open_tasks": open,
            "total_tasks": total,
            "pending_tasks": pending,
            "in_progress_tasks": in_progress,
            "done_tasks": done,
            "cancelled_tasks": cancelled,
            "type": entity.type_,
            "slug": entity.slug,
            "parent_entity_id": entity.parent_entity_id,
            "owner_user_id": entity.owner_user_id,
            "tagline": entity.tagline,
            "public": entity.public,
        }));
    }
    serde_json::json!({"ok": true, "roots": result})
}

pub async fn handle_create_entity(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let name = request.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let is_safe_name = !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && name != "."
        && name != ".."
        && !name.starts_with('.')
        && name.len() <= 128;
    if !is_safe_name {
        return serde_json::json!({"ok": false, "error": "invalid name"});
    }

    let slug = request.get("slug").and_then(|v| v.as_str()).unwrap_or(name);
    let personal_company = request.get("personal_company").and_then(|v| v.as_bool()) == Some(true)
        || request.get("kind").and_then(|v| v.as_str()) == Some("personal")
        || request.get("company_kind").and_then(|v| v.as_str()) == Some("personal");

    if personal_company {
        let caller_user_id = super::request_field(request, "caller_user_id")
            .or_else(|| super::request_field(request, "creator_user_id"))
            .map(str::to_string);
        let slug = normalized_slug(slug);

        let entity = match ctx
            .entity_registry
            .create_new(
                name,
                &slug,
                EntityType::Company,
                None,
                caller_user_id.as_deref(),
            )
            .await
        {
            Ok(entity) => entity,
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        };

        if let Some(tagline) = request
            .get("tagline")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            && let Err(e) = ctx
                .entity_registry
                .set_tagline(&entity.id, Some(tagline))
                .await
        {
            return serde_json::json!({"ok": false, "error": e.to_string()});
        }

        if let Err(e) = ctx
            .agent_registry
            .seed_personal_cap_table_defaults(&entity.id, caller_user_id.as_deref())
            .await
        {
            return serde_json::json!({"ok": false, "error": e.to_string()});
        }

        if let Some(ref uid) = caller_user_id
            && let Err(e) = ctx
                .role_registry
                .ensure_founding_director(&entity.id, uid)
                .await
        {
            tracing::warn!(
                company_id = %entity.id,
                user_id = %uid,
                "failed to create founding Director role for personal company: {e}"
            );
        }

        return serde_json::json!({
            "ok": true,
            "id": entity.id,
            "company": {
                "id": entity.id,
                "name": entity.name,
                "type": "personal",
                "slug": entity.slug,
                "placement_type": "personal",
                "plan": "free",
            }
        });
    }

    // Every entity is a Company (the multi-type taxonomy was vestigial —
    // see AEQI idea `architecture/entitytype-enum-is-vestigial`). Spawn a
    // backing root agent so the agent surface stays consistent and quest
    // counts work immediately. The spawn path mints a fresh entity UUID
    // alongside the agent UUID; the entity is the canonical identifier
    // exposed on the wire.
    let creator_user_id = super::request_field(request, "creator_user_id")
        .or_else(|| super::request_field(request, "caller_user_id"))
        .map(str::to_string);
    let company_id = match ctx.agent_registry.spawn(name, None, None).await {
        Ok(agent) => match agent.company_id {
            Some(eid) => eid,
            None => {
                return serde_json::json!({
                    "ok": false,
                    "error": "spawned company agent has no company_id (post-Phase-4 invariant)",
                });
            }
        },
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if let Err(e) = ctx
        .agent_registry
        .seed_company_cap_table_defaults(&company_id, creator_user_id.as_deref())
        .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Ensure the project directory exists (mirrors
    // `handle_create_default_agent` behaviour).
    if let Ok(cwd) = std::env::current_dir() {
        let project_dir = cwd.join("projects").join(name);
        let _ = std::fs::create_dir_all(&project_dir);
    }

    serde_json::json!({
        "ok": true,
        "id": company_id,
        "company": {
            "id": company_id,
            "name": name,
            "type": "company",
            "slug": slug,
        }
    })
}

fn normalized_slug(value: &str) -> String {
    let slug = value
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        slug
    }
}

pub async fn handle_update_entity(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id_or_slug = request
        .get("id")
        .or_else(|| request.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if id_or_slug.is_empty() {
        return serde_json::json!({"ok": false, "error": "id or name is required"});
    }

    // Resolve entity.
    let entity = match ctx.entity_registry.get(id_or_slug).await {
        Ok(Some(e)) => e,
        Ok(None) => {
            // Try by slug.
            match ctx.entity_registry.get_by_slug(id_or_slug).await {
                Ok(Some(e)) => e,
                Ok(None) => return serde_json::json!({"ok": false, "error": "entity not found"}),
                Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
            }
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if allowed.is_some() && !is_allowed(allowed, &entity.id) && !is_allowed(allowed, &entity.slug) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let new_name = request
        .get("new_name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let new_slug = request
        .get("new_slug")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    // Tagline accepts empty string to clear; absent key = no change.
    let tagline_change = request.get("tagline").and_then(|v| v.as_str());
    let public_change = request.get("public").and_then(|v| v.as_bool());

    if new_name.is_none()
        && new_slug.is_none()
        && tagline_change.is_none()
        && public_change.is_none()
    {
        return serde_json::json!({
            "ok": false,
            "error": "new_name, new_slug, tagline, or public is required",
        });
    }

    // Update the entity row.
    if (new_name.is_some() || new_slug.is_some())
        && let Err(e) = ctx
            .entity_registry
            .update(&entity.id, new_name, new_slug)
            .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    if let Some(tagline) = tagline_change
        && let Err(e) = ctx
            .entity_registry
            .set_tagline(&entity.id, Some(tagline.trim()))
            .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    if let Some(public) = public_change
        && let Err(e) = ctx.entity_registry.set_public(&entity.id, public).await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Also update the default agent's name (when present) so the agent
    // label and the entity name stay in sync. The default agent is the
    // (single) agent inside this entity whose role has no incoming edges.
    if let Some(new_name) = new_name
        && let Ok(agents) = ctx.agent_registry.list_entity_agents().await
        && let Some(default_agent) = agents
            .into_iter()
            .find(|a| a.company_id.as_deref() == Some(&entity.id))
    {
        let _ = ctx
            .agent_registry
            .update_name(&default_agent.id, new_name)
            .await;
    }

    serde_json::json!({"ok": true})
}

pub async fn handle_list_cap_table_entries(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id") {
        Some(value) => value,
        None => {
            return serde_json::json!({"ok": false, "code": "bad_request", "error": "company_id is required"});
        }
    };

    if allowed.is_some() && !is_allowed(allowed, company_id) {
        return serde_json::json!({"ok": false, "code": "forbidden", "error": "access denied"});
    }

    match ctx.agent_registry.list_cap_table_entries(company_id).await {
        Ok(entries) => serde_json::json!({
            "ok": true,
            "company_id": company_id,
            "entries": entries,
        }),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_list_views(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id") {
        Some(value) => value,
        None => {
            return serde_json::json!({"ok": false, "code": "bad_request", "error": "company_id is required"});
        }
    };

    if allowed.is_some() && !is_allowed(allowed, company_id) {
        return serde_json::json!({"ok": false, "code": "forbidden", "error": "access denied"});
    }

    let owner_user_id = super::request_field(request, "owner_user_id")
        .or_else(|| super::request_field(request, "caller_user_id"));
    match ctx
        .agent_registry
        .list_entity_views(company_id, owner_user_id)
        .await
    {
        Ok(views) => serde_json::json!({
            "ok": true,
            "company_id": company_id,
            "views": views,
        }),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_upsert_views(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id") {
        Some(value) => value,
        None => {
            return serde_json::json!({"ok": false, "code": "bad_request", "error": "company_id is required"});
        }
    };

    if allowed.is_some() && !is_allowed(allowed, company_id) {
        return serde_json::json!({"ok": false, "code": "forbidden", "error": "access denied"});
    }

    let owner_user_id = super::request_field(request, "owner_user_id")
        .or_else(|| super::request_field(request, "caller_user_id"));
    let views = match parse_entity_view_upserts(request) {
        Ok(views) => views,
        Err(e) => {
            return serde_json::json!({"ok": false, "code": "bad_request", "error": e.to_string()});
        }
    };

    match ctx
        .agent_registry
        .upsert_entity_views(company_id, owner_user_id, views)
        .await
    {
        Ok(views) => serde_json::json!({
            "ok": true,
            "company_id": company_id,
            "views": views,
        }),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_delete_view(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let company_id = match super::request_field(request, "company_id") {
        Some(value) => value,
        None => {
            return serde_json::json!({"ok": false, "code": "bad_request", "error": "company_id is required"});
        }
    };
    let id_or_key = match super::request_field(request, "view_id")
        .or_else(|| super::request_field(request, "id"))
        .or_else(|| super::request_field(request, "key"))
    {
        Some(value) => value,
        None => {
            return serde_json::json!({"ok": false, "code": "bad_request", "error": "view_id or key is required"});
        }
    };

    if allowed.is_some() && !is_allowed(allowed, company_id) {
        return serde_json::json!({"ok": false, "code": "forbidden", "error": "access denied"});
    }

    let owner_user_id = super::request_field(request, "owner_user_id")
        .or_else(|| super::request_field(request, "caller_user_id"));
    match ctx
        .agent_registry
        .delete_entity_view(company_id, owner_user_id, id_or_key)
        .await
    {
        Ok(deleted) => serde_json::json!({
            "ok": true,
            "company_id": company_id,
            "deleted": deleted,
        }),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

fn parse_entity_view_upserts(request: &serde_json::Value) -> anyhow::Result<Vec<EntityViewUpsert>> {
    let raw_views = if let Some(views) = request.get("views").and_then(|value| value.as_array()) {
        views.clone()
    } else if let Some(view) = request.get("view") {
        vec![view.clone()]
    } else {
        anyhow::bail!("views or view is required");
    };

    if raw_views.is_empty() {
        anyhow::bail!("at least one view is required");
    }

    raw_views
        .into_iter()
        .map(|view| {
            let key = super::request_field(&view, "key")
                .map(str::to_string)
                .ok_or_else(|| anyhow::anyhow!("view key is required"))?;
            let label = super::request_field(&view, "label")
                .or_else(|| super::request_field(&view, "title"))
                .map(str::to_string)
                .ok_or_else(|| anyhow::anyhow!("view label is required"))?;
            Ok(EntityViewUpsert {
                id: super::request_field(&view, "id").map(str::to_string),
                key,
                label,
                kind: super::request_field(&view, "kind")
                    .unwrap_or("dashboard")
                    .to_string(),
                scope: super::request_field(&view, "scope")
                    .unwrap_or("private")
                    .to_string(),
                path: super::request_field(&view, "path").map(str::to_string),
                search: super::request_field(&view, "search").map(str::to_string),
                layout_json: view
                    .get("layout_json")
                    .or_else(|| view.get("layout"))
                    .cloned(),
                pinned: view
                    .get("pinned")
                    .and_then(|value| value.as_bool())
                    .unwrap_or(false),
                sort_order: view
                    .get("sort_order")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(0),
            })
        })
        .collect()
}

pub async fn handle_delete_entity(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let id_or_slug = request
        .get("id")
        .or_else(|| request.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if id_or_slug.is_empty() {
        return serde_json::json!({"ok": false, "error": "id or name is required"});
    }

    let entity = match ctx.entity_registry.get(id_or_slug).await {
        Ok(Some(e)) => e,
        Ok(None) => match ctx.entity_registry.get_by_slug(id_or_slug).await {
            Ok(Some(e)) => e,
            Ok(None) => return serde_json::json!({"ok": false, "error": "entity not found"}),
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        },
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if allowed.is_some() && !is_allowed(allowed, &entity.id) && !is_allowed(allowed, &entity.slug) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    if let Err(e) = ctx.entity_registry.delete(&entity.id).await {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    serde_json::json!({"ok": true})
}
