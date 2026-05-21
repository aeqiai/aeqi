//! Entity IPC handlers.
//!
//! Four commands: `entities`, `create_entity`, `update_entity`, `delete_entity`.
//!
//! Wire shape for `handle_entities` returns `{"ok": true, "roots": [...]}`.
//! The `roots` key name is preserved here for the platform proxy that
//! reshapes it into the `{ entities: [...] }` HTTP response the UI expects.

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
    // uses to land /trust/<addr>/ on the right agent.
    let all_default_agents = ctx
        .agent_registry
        .list_entity_agents()
        .await
        .unwrap_or_default();

    let mut result: Vec<serde_json::Value> = Vec::new();
    for entity in &entities {
        let backing_agent = all_default_agents
            .iter()
            .find(|a| a.trust_id.as_deref() == Some(&entity.id))
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
    let personal_trust = request.get("personal_trust").and_then(|v| v.as_bool()) == Some(true)
        || request.get("kind").and_then(|v| v.as_str()) == Some("personal")
        || request.get("trust_kind").and_then(|v| v.as_str()) == Some("personal");

    if personal_trust {
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

        if let Some(ref uid) = caller_user_id
            && let Err(e) = ctx
                .role_registry
                .ensure_founding_director(&entity.id, uid)
                .await
        {
            tracing::warn!(
                trust_id = %entity.id,
                user_id = %uid,
                "failed to create founding Director role for personal trust: {e}"
            );
        }

        return serde_json::json!({
            "ok": true,
            "id": entity.id,
            "trust": {
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
    let trust_id = match ctx.agent_registry.spawn(name, None, None).await {
        Ok(agent) => match agent.trust_id {
            Some(eid) => eid,
            None => {
                return serde_json::json!({
                    "ok": false,
                    "error": "spawned company agent has no trust_id (post-Phase-4 invariant)",
                });
            }
        },
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Ensure the project directory exists (mirrors
    // `handle_create_default_agent` behaviour).
    if let Ok(cwd) = std::env::current_dir() {
        let project_dir = cwd.join("projects").join(name);
        let _ = std::fs::create_dir_all(&project_dir);
    }

    serde_json::json!({
        "ok": true,
        "id": trust_id,
        "trust": {
            "id": trust_id,
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
            .find(|a| a.trust_id.as_deref() == Some(&entity.id))
    {
        let _ = ctx
            .agent_registry
            .update_name(&default_agent.id, new_name)
            .await;
    }

    serde_json::json!({"ok": true})
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
