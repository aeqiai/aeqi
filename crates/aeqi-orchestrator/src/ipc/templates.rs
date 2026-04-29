//! Company template IPC handlers.
//!
//! A "template" here is a pre-threaded starter kit for a company: one root
//! agent plus seed agents, events, ideas, and quests. The shipped catalog
//! is embedded at compile time (see [`crate::templates`]) so the runtime is
//! self-contained regardless of the cwd it launches from. The on-disk
//! `presets/templates/*.json` files remain the source of truth for editing
//! — rebuilding the binary re-embeds them.
//!
//! The schema is intentionally flat JSON (not TOML) so Stream D's landing /
//! dashboard can fetch the catalog and render cards without a Rust build.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::agent_registry::AgentRegistry;
use crate::event_handler::{EventHandlerStore, NewEvent, ToolCall};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/// Root-agent definition. Always the owner of the spawned company.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RootAgentSpec {
    pub name: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    /// Persona / instructions for this agent. Stored as an idea tagged
    /// `identity` so the runtime's assemble_ideas path injects it at
    /// session:start without any new plumbing.
    #[serde(default)]
    pub system_prompt: Option<String>,
}

/// Child agent. `owner` is always "root" for seed_agents — they sit directly
/// under the template's root agent. Nested hierarchies are deferred to v2.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SeedAgentSpec {
    /// Currently must be "root". Reserved for future nested templates.
    #[serde(default = "default_owner_root")]
    pub owner: String,
    pub name: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub avatar: Option<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
}

fn default_owner_root() -> String {
    "root".to_string()
}

/// Seed event. `owner` is "root" or the name of a seed_agent.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SeedEventSpec {
    #[serde(default = "default_owner_root")]
    pub owner: String,
    pub name: String,
    pub pattern: String,
    #[serde(default)]
    pub cooldown_secs: u64,
    #[serde(default)]
    pub query_template: Option<String>,
    #[serde(default)]
    pub query_top_k: Option<u32>,
    #[serde(default)]
    pub query_tag_filter: Option<Vec<String>>,
    #[serde(default)]
    pub tool_calls: Vec<ToolCallSpec>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ToolCallSpec {
    pub tool: String,
    #[serde(default)]
    pub args: serde_json::Value,
}

/// Seed idea. `owner` is "root" or the name of a seed_agent.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SeedIdeaSpec {
    #[serde(default = "default_owner_root")]
    pub owner: String,
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Seed quest. `owner` is "root" or the name of a seed_agent.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SeedQuestSpec {
    #[serde(default = "default_owner_root")]
    pub owner: String,
    pub subject: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub labels: Vec<String>,
}

/// Full template manifest.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Template {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub tagline: String,
    #[serde(default)]
    pub description: String,
    pub root: RootAgentSpec,
    #[serde(default)]
    pub seed_agents: Vec<SeedAgentSpec>,
    #[serde(default)]
    pub seed_events: Vec<SeedEventSpec>,
    #[serde(default)]
    pub seed_ideas: Vec<SeedIdeaSpec>,
    #[serde(default)]
    pub seed_quests: Vec<SeedQuestSpec>,
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

/// Outcome of a `spawn_blueprint` call. Returned so Stream D can route the
/// browser straight to the new company without a second round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct SpawnOutcome {
    /// The entity (company) that was just minted. Distinct from any agent UUID.
    pub entity_id: String,
    pub root_agent_id: String,
    pub root_agent_name: String,
    pub spawned_agents: Vec<SpawnedAgent>,
    pub created_events: usize,
    pub created_ideas: usize,
    pub created_quests: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpawnedAgent {
    pub id: String,
    pub name: String,
}

/// Spawn a company from a template. Pure logic: everything external is
/// injected so tests can drive this without the full daemon context.
///
/// When `parent_agent_id` is `Some`, the blueprint's root attaches as a
/// sub-agent under that parent (reusing the parent's entity); seed_agents
/// nest under the blueprint's root just like a normal spawn. This is the
/// "import blueprint into existing entity" path that powers `+ New agent`.
/// When `None`, a fresh entity is minted unless `entity_id_override` is
/// supplied — the platform mints the canonical UUID and passes it through
/// for the `/start/launch` path so the runtime adopts the platform-side ID
/// instead of minting its own.
pub async fn spawn_blueprint(
    template: &Template,
    override_name: Option<&str>,
    parent_agent_id: Option<&str>,
    entity_id_override: Option<&str>,
    agent_registry: &AgentRegistry,
    event_store: &EventHandlerStore,
    idea_store: Option<&Arc<dyn aeqi_core::traits::IdeaStore>>,
) -> anyhow::Result<SpawnOutcome> {
    let mut warnings: Vec<String> = Vec::new();

    // ---- root agent ----
    let root = agent_registry
        .spawn_with_entity_id(
            override_name.unwrap_or(&template.root.name),
            parent_agent_id,
            template.root.model.as_deref(),
            entity_id_override,
        )
        .await?;
    apply_visual_identity(
        agent_registry,
        &root.id,
        template.root.color.as_deref(),
        template.root.avatar.as_deref(),
    )
    .await;

    // Persist persona as an identity idea so assemble_ideas picks it up on
    // session:start. No separate persona table needed.
    if let (Some(store), Some(prompt)) = (idea_store, template.root.system_prompt.as_ref()) {
        store_identity_idea(store.as_ref(), &root.id, &root.name, prompt, &mut warnings).await;
    }

    // ---- seed agents ----
    let mut owner_to_agent_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    owner_to_agent_id.insert("root".to_string(), root.id.clone());
    owner_to_agent_id.insert(template.root.name.clone(), root.id.clone());

    let mut spawned_agents = vec![SpawnedAgent {
        id: root.id.clone(),
        name: root.name.clone(),
    }];

    for seed in &template.seed_agents {
        if seed.owner != "root" && seed.owner != template.root.name {
            warnings.push(format!(
                "seed_agent '{}' owner '{}' not supported; attaching under root",
                seed.name, seed.owner,
            ));
        }
        let child = match agent_registry
            .spawn(&seed.name, Some(&root.id), seed.model.as_deref())
            .await
        {
            Ok(a) => a,
            Err(err) => {
                warnings.push(format!("seed_agent '{}' spawn failed: {err}", seed.name));
                continue;
            }
        };
        apply_visual_identity(
            agent_registry,
            &child.id,
            seed.color.as_deref(),
            seed.avatar.as_deref(),
        )
        .await;
        if let (Some(store), Some(prompt)) = (idea_store, seed.system_prompt.as_ref()) {
            store_identity_idea(store.as_ref(), &child.id, &seed.name, prompt, &mut warnings).await;
        }
        owner_to_agent_id.insert(seed.name.clone(), child.id.clone());
        spawned_agents.push(SpawnedAgent {
            id: child.id.clone(),
            name: child.name.clone(),
        });
    }

    // ---- seed ideas ----
    // Seed ideas before events/quests so events referencing them by name
    // could, in principle, be resolved later. Current template shape doesn't
    // require it but this preserves the invariant for v2.
    let mut created_ideas = 0usize;
    if let Some(store) = idea_store {
        for idea in &template.seed_ideas {
            let owner_id = match resolve_owner(&owner_to_agent_id, &idea.owner) {
                Some(id) => id,
                None => {
                    warnings.push(format!(
                        "seed_idea '{}' owner '{}' not found; skipping",
                        idea.name, idea.owner,
                    ));
                    continue;
                }
            };
            let tags = if idea.tags.is_empty() {
                vec!["fact".to_string()]
            } else {
                idea.tags.clone()
            };
            match store
                .store(&idea.name, &idea.content, &tags, Some(owner_id))
                .await
            {
                Ok(_) => created_ideas += 1,
                Err(err) => {
                    warnings.push(format!("seed_idea '{}' store failed: {err}", idea.name,))
                }
            }
        }
    } else if !template.seed_ideas.is_empty() {
        warnings.push(format!(
            "idea store unavailable; skipped {} seed_ideas",
            template.seed_ideas.len(),
        ));
    }

    // ---- seed events ----
    let mut created_events = 0usize;
    for ev in &template.seed_events {
        let owner_id = match resolve_owner(&owner_to_agent_id, &ev.owner) {
            Some(id) => id,
            None => {
                warnings.push(format!(
                    "seed_event '{}' owner '{}' not found; skipping",
                    ev.name, ev.owner,
                ));
                continue;
            }
        };
        let tool_calls: Vec<ToolCall> = ev
            .tool_calls
            .iter()
            .map(|tc| ToolCall {
                tool: tc.tool.clone(),
                args: tc.args.clone(),
            })
            .collect();
        let new_event = NewEvent {
            agent_id: Some(owner_id.to_string()),
            scope: aeqi_core::Scope::SelfScope,
            name: ev.name.clone(),
            pattern: ev.pattern.clone(),
            idea_ids: Vec::new(),
            query_template: ev.query_template.clone(),
            query_top_k: ev.query_top_k,
            query_tag_filter: ev.query_tag_filter.clone(),
            tool_calls,
            cooldown_secs: ev.cooldown_secs,
            system: false,
        };
        match event_store.create(&new_event).await {
            Ok(_) => created_events += 1,
            Err(err) => warnings.push(format!("seed_event '{}' create failed: {err}", ev.name)),
        }
    }

    // ---- seed quests ----
    let mut created_quests = 0usize;
    for q in &template.seed_quests {
        let owner_id = match resolve_owner(&owner_to_agent_id, &q.owner) {
            Some(id) => id,
            None => {
                warnings.push(format!(
                    "seed_quest '{}' owner '{}' not found; skipping",
                    q.subject, q.owner,
                ));
                continue;
            }
        };
        match agent_registry
            .create_task_v2(
                owner_id,
                &q.subject,
                &q.description,
                &[],
                &q.labels,
                &[],
                None,
            )
            .await
        {
            Ok(_) => created_quests += 1,
            Err(err) => warnings.push(format!("seed_quest '{}' create failed: {err}", q.subject,)),
        }
    }

    let entity_id = root.entity_id.clone().ok_or_else(|| {
        anyhow::anyhow!("spawned root agent has no entity_id (post-Phase-4 invariant)")
    })?;

    Ok(SpawnOutcome {
        entity_id,
        root_agent_id: root.id.clone(),
        root_agent_name: root.name.clone(),
        spawned_agents,
        created_events,
        created_ideas,
        created_quests,
        warnings,
    })
}

fn resolve_owner<'a>(
    map: &'a std::collections::HashMap<String, String>,
    owner: &str,
) -> Option<&'a str> {
    map.get(owner).map(|s| s.as_str())
}

async fn apply_visual_identity(
    agent_registry: &AgentRegistry,
    agent_id: &str,
    color: Option<&str>,
    avatar: Option<&str>,
) {
    if color.is_none() && avatar.is_none() {
        return;
    }
    if let Err(err) = agent_registry
        .set_visual_identity(agent_id, color, avatar)
        .await
    {
        tracing::warn!(agent_id, error = %err, "set_visual_identity failed");
    }
}

async fn store_identity_idea(
    idea_store: &dyn aeqi_core::traits::IdeaStore,
    agent_id: &str,
    name: &str,
    system_prompt: &str,
    warnings: &mut Vec<String>,
) {
    let idea_name = format!("Persona — {name}");
    let tags = vec!["identity".to_string(), "evergreen".to_string()];
    if let Err(err) = idea_store
        .store(&idea_name, system_prompt, &tags, Some(agent_id))
        .await
    {
        warnings.push(format!("identity idea for '{name}' store failed: {err}"));
    }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

pub async fn handle_list_blueprints(
    _ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let templates = crate::templates::company_templates();
    let items: Vec<serde_json::Value> = templates
        .iter()
        .map(|t| {
            serde_json::json!({
                "slug": t.slug,
                "name": t.name,
                "tagline": t.tagline,
                "description": t.description,
                "root": {
                    "name": t.root.name,
                    "model": t.root.model,
                    "color": t.root.color,
                },
                "agent_count": 1 + t.seed_agents.len(),
                "event_count": t.seed_events.len(),
                "idea_count": t.seed_ideas.len(),
                "quest_count": t.seed_quests.len(),
            })
        })
        .collect();
    serde_json::json!({"ok": true, "blueprints": items})
}

pub async fn handle_blueprint_detail(
    _ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let slug = super::request_field(request, "slug").unwrap_or("");
    if slug.is_empty() {
        return serde_json::json!({"ok": false, "error": "slug is required"});
    }
    match crate::templates::company_template(slug) {
        Some(t) => serde_json::json!({"ok": true, "blueprint": t}),
        None => serde_json::json!({
            "ok": false,
            "error": format!("template not found: {slug}"),
            "code": "not_found",
        }),
    }
}

pub async fn handle_spawn_blueprint(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let slug = super::request_field(request, "blueprint").unwrap_or("");
    if slug.is_empty() {
        return serde_json::json!({"ok": false, "error": "blueprint is required"});
    }

    let root_name = super::request_field(request, "name").map(str::to_string);
    // Optional platform-supplied entity_id (UUID). When present, the
    // runtime adopts it instead of minting its own — the canonical
    // `/start/launch` path.
    let entity_id_override = super::request_field(request, "entity_id").map(str::to_string);

    let template = match crate::templates::company_template(slug) {
        Some(t) => t,
        None => {
            return serde_json::json!({
                "ok": false,
                "error": format!("template not found: {slug}"),
                "code": "not_found",
            });
        }
    };

    let requested_root_name = root_name.as_deref().unwrap_or(&template.root.name);

    // Reject if a root agent with this name already exists — template spawns
    // are meant to be the beginning of a fresh company, not a silent merge
    // into an existing one.
    match ctx
        .agent_registry
        .get_active_by_name(requested_root_name)
        .await
    {
        Ok(Some(existing)) => {
            return serde_json::json!({
                "ok": false,
                "error": format!(
                    "an agent named '{}' already exists (id {}); pick a different company name or retire the existing one",
                    requested_root_name, existing.id,
                ),
                "code": "conflict",
            });
        }
        Ok(None) => {}
        Err(err) => return serde_json::json!({"ok": false, "error": err.to_string()}),
    }

    let Some(ref event_store) = ctx.event_handler_store else {
        return serde_json::json!({"ok": false, "error": "event handler store not available"});
    };

    match spawn_blueprint(
        &template,
        root_name.as_deref(),
        None,
        entity_id_override.as_deref(),
        &ctx.agent_registry,
        event_store.as_ref(),
        ctx.idea_store.as_ref(),
    )
    .await
    {
        Ok(outcome) => serde_json::json!({
            "ok": true,
            "entity_id": outcome.entity_id,
            "root_agent_id": outcome.root_agent_id,
            "root_agent_name": outcome.root_agent_name,
            "spawned_agents": outcome.spawned_agents,
            "created_events": outcome.created_events,
            "created_ideas": outcome.created_ideas,
            "created_quests": outcome.created_quests,
            "warnings": outcome.warnings,
            "blueprint": {
                "slug": template.slug,
                "name": template.name,
            },
        }),
        Err(err) => serde_json::json!({"ok": false, "error": err.to_string()}),
    }
}

/// Spawn a Blueprint INTO an existing entity. The blueprint's root attaches
/// as a sub-agent under the entity's root agent; seed_agents nest under the
/// blueprint's root in the position DAG. Powers the `+ New agent` UX.
pub async fn handle_spawn_blueprint_into_entity(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let slug = super::request_field(request, "blueprint").unwrap_or("");
    if slug.is_empty() {
        return serde_json::json!({"ok": false, "error": "blueprint is required"});
    }
    let entity_id = super::request_field(request, "entity_id").unwrap_or("");
    if entity_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "entity_id is required"});
    }

    // Tenancy: the entity must be inside the caller's allowed scope.
    if !super::tenancy::is_allowed(allowed, entity_id) {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let template = match crate::templates::company_template(slug) {
        Some(t) => t,
        None => {
            return serde_json::json!({
                "ok": false,
                "error": format!("template not found: {slug}"),
                "code": "not_found",
            });
        }
    };

    // Resolve the entity's root agent — the blueprint's root will attach
    // as a child of this agent. A position-DAG model can in principle host
    // multiple roots per entity; today every entity has exactly one.
    let entity_root = match ctx.agent_registry.list_root_agents().await {
        Ok(roots) => roots
            .into_iter()
            .find(|a| a.entity_id.as_deref() == Some(entity_id)),
        Err(err) => return serde_json::json!({"ok": false, "error": err.to_string()}),
    };
    let Some(parent) = entity_root else {
        return serde_json::json!({
            "ok": false,
            "error": format!("entity '{entity_id}' has no root agent"),
            "code": "not_found",
        });
    };

    let Some(ref event_store) = ctx.event_handler_store else {
        return serde_json::json!({"ok": false, "error": "event handler store not available"});
    };

    match spawn_blueprint(
        &template,
        None,
        Some(&parent.id),
        None,
        &ctx.agent_registry,
        event_store.as_ref(),
        ctx.idea_store.as_ref(),
    )
    .await
    {
        Ok(outcome) => serde_json::json!({
            "ok": true,
            "entity_id": outcome.entity_id,
            "root_agent_id": outcome.root_agent_id,
            "root_agent_name": outcome.root_agent_name,
            // Counts (not the SpawnedAgent array) so the import-flow
            // frontend can render "Spawned 3 agents · 2 ideas · 1 quest"
            // without iterating. The full array is a fresh-spawn-only
            // shape returned by `handle_spawn_blueprint`.
            "spawned_agents": outcome.spawned_agents.len(),
            "created_events": outcome.created_events,
            "created_ideas": outcome.created_ideas,
            "created_quests": outcome.created_quests,
            "warnings": outcome.warnings,
            "blueprint": {
                "slug": template.slug,
                "name": template.name,
            },
        }),
        Err(err) => serde_json::json!({"ok": false, "error": err.to_string()}),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn fixture_template() -> Template {
        Template {
            slug: "test-studio".to_string(),
            name: "Test Studio".to_string(),
            tagline: "fixture".to_string(),
            description: "fixture template".to_string(),
            root: RootAgentSpec {
                name: "Director".to_string(),
                model: Some("anthropic/claude-sonnet-4.6".to_string()),
                color: Some("#3fae8c".to_string()),
                avatar: None,
                system_prompt: Some("You are the director.".to_string()),
            },
            seed_agents: vec![
                SeedAgentSpec {
                    owner: "root".to_string(),
                    name: "Editor".to_string(),
                    model: Some("anthropic/claude-sonnet-4.6".to_string()),
                    color: None,
                    avatar: None,
                    system_prompt: Some("You are the editor.".to_string()),
                },
                SeedAgentSpec {
                    owner: "root".to_string(),
                    name: "Distribution".to_string(),
                    model: None,
                    color: None,
                    avatar: None,
                    system_prompt: None,
                },
            ],
            seed_events: vec![
                SeedEventSpec {
                    owner: "root".to_string(),
                    name: "weekly".to_string(),
                    pattern: "session:start".to_string(),
                    cooldown_secs: 0,
                    query_template: Some("weekly".to_string()),
                    query_top_k: Some(5),
                    query_tag_filter: Some(vec!["cadence".to_string()]),
                    tool_calls: Vec::new(),
                },
                SeedEventSpec {
                    owner: "Editor".to_string(),
                    name: "on_draft".to_string(),
                    pattern: "session:quest_start".to_string(),
                    cooldown_secs: 60,
                    query_template: None,
                    query_top_k: None,
                    query_tag_filter: None,
                    tool_calls: Vec::new(),
                },
            ],
            seed_ideas: vec![
                SeedIdeaSpec {
                    owner: "root".to_string(),
                    name: "Voice".to_string(),
                    content: "Direct, no throat-clearing.".to_string(),
                    tags: vec!["editorial".to_string()],
                },
                SeedIdeaSpec {
                    owner: "Editor".to_string(),
                    name: "Rubric".to_string(),
                    content: "Thesis, three moves, example, memorable line.".to_string(),
                    tags: vec!["voice".to_string()],
                },
            ],
            seed_quests: vec![
                SeedQuestSpec {
                    owner: "root".to_string(),
                    subject: "Pick themes".to_string(),
                    description: "Pick three editorial themes.".to_string(),
                    labels: vec!["editorial".to_string()],
                },
                SeedQuestSpec {
                    owner: "Editor".to_string(),
                    subject: "Draft first piece".to_string(),
                    description: "Produce first long-form draft.".to_string(),
                    labels: Vec::new(),
                },
            ],
        }
    }

    async fn test_registry() -> AgentRegistry {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        // Leak the TempDir so the sqlite files aren't deleted mid-test.
        std::mem::forget(dir);
        AgentRegistry::open(&path).unwrap()
    }

    fn test_idea_store() -> Arc<dyn aeqi_core::traits::IdeaStore> {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("ideas.db");
        std::mem::forget(dir);
        Arc::new(aeqi_ideas::SqliteIdeas::open(&db_path, 30.0).unwrap())
    }

    #[tokio::test]
    async fn spawn_blueprint_creates_root_and_seeds_atomically() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let idea_store = test_idea_store();

        let template = fixture_template();
        let outcome = spawn_blueprint(
            &template,
            None,
            None,
            None,
            &registry,
            &event_store,
            Some(&idea_store),
        )
        .await
        .expect("spawn should succeed");

        // Root + 2 seed agents.
        assert_eq!(outcome.spawned_agents.len(), 3);
        assert_eq!(outcome.spawned_agents[0].name, "Director");
        assert!(
            outcome.warnings.is_empty(),
            "warnings: {:?}",
            outcome.warnings
        );
        assert_eq!(outcome.created_events, 2);
        // 2 seed ideas + 2 identity ideas (root + editor with system_prompt).
        assert_eq!(outcome.created_ideas, 2);
        assert_eq!(outcome.created_quests, 2);

        // Verify children actually point at root.
        let root = registry
            .get_active_by_name("Director")
            .await
            .unwrap()
            .unwrap();
        let editor = registry
            .get_active_by_name("Editor")
            .await
            .unwrap()
            .unwrap();
        let dist = registry
            .get_active_by_name("Distribution")
            .await
            .unwrap()
            .unwrap();
        let editor_ancestors = registry.get_ancestor_ids(&editor.id).await.unwrap();
        let dist_ancestors = registry.get_ancestor_ids(&dist.id).await.unwrap();
        assert!(editor_ancestors.contains(&root.id));
        assert!(dist_ancestors.contains(&root.id));

        // Verify events were attached to the correct owners.
        let root_events = event_store.list_for_agent(&root.id).await.unwrap();
        assert!(
            root_events.iter().any(|e| e.name == "weekly"),
            "root should have 'weekly' event; got {:?}",
            root_events.iter().map(|e| &e.name).collect::<Vec<_>>(),
        );
        let editor_events = event_store.list_for_agent(&editor.id).await.unwrap();
        assert!(
            editor_events.iter().any(|e| e.name == "on_draft"),
            "editor should have 'on_draft' event",
        );

        // Verify at least one persona idea landed under root.
        let root_ideas = idea_store
            .ideas_by_tags(&["identity".to_string()], 50)
            .await
            .unwrap();
        assert!(
            root_ideas
                .iter()
                .any(|i| i.agent_id.as_deref() == Some(root.id.as_str())),
            "root should have an identity idea; got {:?}",
            root_ideas.iter().map(|i| &i.name).collect::<Vec<_>>(),
        );
    }

    #[tokio::test]
    async fn spawn_blueprint_tolerates_missing_idea_store() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());

        let template = fixture_template();
        let outcome = spawn_blueprint(&template, None, None, None, &registry, &event_store, None)
            .await
            .expect("spawn should succeed without idea store");

        // Agents, events, quests still land; ideas are skipped with a warning.
        assert_eq!(outcome.spawned_agents.len(), 3);
        assert_eq!(outcome.created_events, 2);
        assert_eq!(outcome.created_ideas, 0);
        assert_eq!(outcome.created_quests, 2);
        assert!(
            outcome
                .warnings
                .iter()
                .any(|w| w.contains("idea store unavailable")),
            "expected idea store warning; got {:?}",
            outcome.warnings,
        );
    }

    #[tokio::test]
    async fn spawn_blueprint_warns_on_unknown_owner() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let idea_store = test_idea_store();

        let mut template = fixture_template();
        template.seed_events.push(SeedEventSpec {
            owner: "ghost".to_string(),
            name: "orphan".to_string(),
            pattern: "session:start".to_string(),
            cooldown_secs: 0,
            query_template: None,
            query_top_k: None,
            query_tag_filter: None,
            tool_calls: Vec::new(),
        });

        let outcome = spawn_blueprint(
            &template,
            None,
            None,
            None,
            &registry,
            &event_store,
            Some(&idea_store),
        )
        .await
        .expect("spawn should succeed despite one bad seed");

        assert_eq!(outcome.created_events, 2);
        assert!(
            outcome
                .warnings
                .iter()
                .any(|w| w.contains("orphan") && w.contains("ghost")),
            "expected owner-not-found warning; got {:?}",
            outcome.warnings,
        );
    }

    #[tokio::test]
    async fn spawn_blueprint_applies_override_name() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let idea_store = test_idea_store();

        let template = fixture_template();
        let outcome = spawn_blueprint(
            &template,
            Some("My Cool Studio"),
            None,
            None,
            &registry,
            &event_store,
            Some(&idea_store),
        )
        .await
        .expect("spawn should succeed");

        let root = registry
            .get_active_by_name("My Cool Studio")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(root.id, outcome.root_agent_id);
        assert_eq!(root.name, "My Cool Studio");
    }

    #[tokio::test]
    async fn spawn_blueprint_into_existing_entity_attaches_under_root() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let idea_store = test_idea_store();

        // Stand up a host entity first.
        let host_template = fixture_template();
        let host = spawn_blueprint(
            &host_template,
            Some("Host Co"),
            None,
            None,
            &registry,
            &event_store,
            Some(&idea_store),
        )
        .await
        .expect("host spawn should succeed");
        let host_root_id = host.root_agent_id.clone();
        let host_entity_id = host.entity_id.clone();

        // Now import a second blueprint into that entity.
        let imported_template = Template {
            slug: "imported-bp".to_string(),
            name: "Imported BP".to_string(),
            tagline: String::new(),
            description: String::new(),
            root: RootAgentSpec {
                name: "Imported Root".to_string(),
                model: None,
                color: None,
                avatar: None,
                system_prompt: None,
            },
            seed_agents: vec![SeedAgentSpec {
                owner: "root".to_string(),
                name: "Imported Helper".to_string(),
                model: None,
                color: None,
                avatar: None,
                system_prompt: None,
            }],
            seed_events: Vec::new(),
            seed_ideas: Vec::new(),
            seed_quests: Vec::new(),
        };
        let imported = spawn_blueprint(
            &imported_template,
            None,
            Some(&host_root_id),
            None,
            &registry,
            &event_store,
            Some(&idea_store),
        )
        .await
        .expect("import spawn should succeed");

        // Imported blueprint reuses the host entity, not a fresh one.
        assert_eq!(imported.entity_id, host_entity_id);
        assert_eq!(imported.spawned_agents.len(), 2);

        // Imported root is now a descendant of the host root.
        let ancestors = registry
            .get_ancestor_ids(&imported.root_agent_id)
            .await
            .unwrap();
        assert!(
            ancestors.contains(&host_root_id),
            "imported root should be a descendant of the host root; ancestors: {ancestors:?}",
        );

        // Helper still nests under the imported root (not the host root).
        let helper = registry
            .get_active_by_name("Imported Helper")
            .await
            .unwrap()
            .unwrap();
        let helper_ancestors = registry.get_ancestor_ids(&helper.id).await.unwrap();
        assert!(helper_ancestors.contains(&imported.root_agent_id));
    }

    #[tokio::test]
    async fn embedded_canonical_templates_parse_cleanly() {
        // Guard against accidental JSON breakage in the shipped presets —
        // the embed helper panics on parse failure, so reaching here proves
        // each shipped template deserializes into a full `Template`.
        let loaded = crate::templates::company_templates();
        let slugs: Vec<&str> = loaded.iter().map(|t| t.slug.as_str()).collect();
        for expected in ["solo-founder", "studio", "small-business"] {
            assert!(
                slugs.contains(&expected),
                "canonical template '{expected}' missing; loaded: {slugs:?}",
            );
        }
    }
}
