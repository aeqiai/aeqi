//! Entity IPC handlers.
//!
//! Four commands: `entities`, `create_entity`, `update_entity`, `delete_entity`.
//!
//! Wire shape for `handle_entities` uses `{"ok": true, "roots": [...]}` so the
//! existing daemon parser at `apps/ui/src/store/daemon.ts:80-93` keeps working
//! without any frontend changes.

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

    // Pre-resolve the backing root agent per entity so the response can
    // surface `agent_id` (used by the daemon store to keep the legacy
    // sidebar wiring intact while we shift the rest of the UI to entity
    // ids).
    let all_roots = ctx
        .agent_registry
        .list_root_agents()
        .await
        .unwrap_or_default();

    let mut result: Vec<serde_json::Value> = Vec::new();
    for entity in &entities {
        let backing_agent = all_roots
            .iter()
            .find(|a| a.entity_id.as_deref() == Some(&entity.id))
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
            "agent_id": backing_agent,
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

    let type_str = request
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("company");
    let type_ = type_str
        .parse::<EntityType>()
        .unwrap_or(EntityType::Company);

    let slug = request.get("slug").and_then(|v| v.as_str()).unwrap_or(name);

    let parent_entity_id = request.get("parent_entity_id").and_then(|v| v.as_str());
    let owner_user_id = request.get("owner_user_id").and_then(|v| v.as_str());

    // For company-type entities, also spawn a backing root agent so the
    // agent surface stays consistent and quest counts work immediately. The
    // spawn path mints a fresh entity UUID alongside the agent UUID; the
    // entity is the canonical identifier exposed on the wire.
    let (entity_id, agent_spawned) = if type_ == EntityType::Company {
        match ctx.agent_registry.spawn(name, None, None).await {
            Ok(agent) => {
                let eid = agent.entity_id.ok_or_else(|| {
                    anyhow::anyhow!(
                        "spawned company agent has no entity_id (post-Phase-4 invariant)",
                    )
                });
                match eid {
                    Ok(eid) => (eid, true),
                    Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
                }
            }
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    } else {
        // Non-company entity: no backing agent; mint a fresh entity row directly.
        match ctx
            .entity_registry
            .create_new(name, slug, type_, parent_entity_id, owner_user_id)
            .await
        {
            Ok(entity) => (entity.id, false),
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    };

    // For agent-backed entities, ensure the project directory exists (mirrors
    // handle_create_root behaviour).
    if agent_spawned && let Ok(cwd) = std::env::current_dir() {
        let project_dir = cwd.join("projects").join(name);
        let _ = std::fs::create_dir_all(&project_dir);
    }

    serde_json::json!({
        "ok": true,
        "id": entity_id,
        "entity": {
            "id": entity_id,
            "name": name,
            "type": type_str,
            "slug": slug,
        }
    })
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

    if new_name.is_none() && new_slug.is_none() {
        return serde_json::json!({"ok": false, "error": "new_name or new_slug is required"});
    }

    // Update the entity row.
    if let Err(e) = ctx
        .entity_registry
        .update(&entity.id, new_name, new_slug)
        .await
    {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Also update the backing agent name (when present) so the agent label
    // and the entity name stay in sync. The backing agent is the (single)
    // agent inside this entity that has no incoming position edges.
    if let Some(new_name) = new_name
        && let Ok(roots) = ctx.agent_registry.list_root_agents().await
        && let Some(root) = roots
            .into_iter()
            .find(|a| a.entity_id.as_deref() == Some(&entity.id))
    {
        let _ = ctx.agent_registry.update_name(&root.id, new_name).await;
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
