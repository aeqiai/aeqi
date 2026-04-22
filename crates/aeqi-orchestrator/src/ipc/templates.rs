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
    pub display_name: Option<String>,
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
    pub display_name: Option<String>,
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

/// Outcome of a `spawn_template` call. Returned so Stream D can route the
/// browser straight to the new company without a second round-trip.
#[derive(Debug, Clone, Serialize)]
pub struct SpawnOutcome {
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
pub async fn spawn_template(
    template: &Template,
    override_display_name: Option<&str>,
    agent_registry: &AgentRegistry,
    event_store: &EventHandlerStore,
    idea_store: Option<&Arc<dyn aeqi_core::traits::IdeaStore>>,
) -> anyhow::Result<SpawnOutcome> {
    let mut warnings: Vec<String> = Vec::new();

    // ---- root agent ----
    let root_display = override_display_name
        .or(template.root.display_name.as_deref())
        .map(str::to_string);
    let root = agent_registry
        .spawn(
            &template.root.name,
            root_display.as_deref(),
            None,
            template.root.model.as_deref(),
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
        store_identity_idea(
            store.as_ref(),
            &root.id,
            &template.root.name,
            &template.root.display_name,
            prompt,
            &mut warnings,
        )
        .await;
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
            .spawn(
                &seed.name,
                seed.display_name.as_deref(),
                Some(&root.id),
                seed.model.as_deref(),
            )
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
            store_identity_idea(
                store.as_ref(),
                &child.id,
                &seed.name,
                &seed.display_name,
                prompt,
                &mut warnings,
            )
            .await;
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

    Ok(SpawnOutcome {
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
    display_name: &Option<String>,
    system_prompt: &str,
    warnings: &mut Vec<String>,
) {
    let display = display_name.as_deref().unwrap_or(name);
    let idea_name = format!("Persona — {display}");
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

pub async fn handle_list_templates(
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
                    "display_name": t.root.display_name,
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
    serde_json::json!({"ok": true, "templates": items})
}

pub async fn handle_template_detail(
    _ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let slug = super::request_field(request, "slug").unwrap_or("");
    if slug.is_empty() {
        return serde_json::json!({"ok": false, "error": "slug is required"});
    }
    match crate::templates::company_template(slug) {
        Some(t) => serde_json::json!({"ok": true, "template": t}),
        None => serde_json::json!({
            "ok": false,
            "error": format!("template not found: {slug}"),
            "code": "not_found",
        }),
    }
}

pub async fn handle_spawn_template(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let slug = super::request_field(request, "template")
        .or_else(|| super::request_field(request, "slug"))
        .unwrap_or("");
    if slug.is_empty() {
        return serde_json::json!({"ok": false, "error": "template is required"});
    }

    let display_name = super::request_field(request, "display_name").map(str::to_string);

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

    // Reject if a root agent with this name already exists — template spawns
    // are meant to be the beginning of a fresh company, not a silent merge
    // into an existing one.
    match ctx
        .agent_registry
        .get_active_by_name(&template.root.name)
        .await
    {
        Ok(Some(existing)) => {
            return serde_json::json!({
                "ok": false,
                "error": format!(
                    "an agent named '{}' already exists (id {}); pick a template whose root name is free or retire the existing one",
                    template.root.name, existing.id,
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

    match spawn_template(
        &template,
        display_name.as_deref(),
        &ctx.agent_registry,
        event_store.as_ref(),
        ctx.idea_store.as_ref(),
    )
    .await
    {
        Ok(outcome) => serde_json::json!({
            "ok": true,
            "root_agent_id": outcome.root_agent_id,
            "root_agent_name": outcome.root_agent_name,
            "spawned_agents": outcome.spawned_agents,
            "created_events": outcome.created_events,
            "created_ideas": outcome.created_ideas,
            "created_quests": outcome.created_quests,
            "warnings": outcome.warnings,
            "template": {
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
                name: "director".to_string(),
                display_name: Some("Director".to_string()),
                model: Some("anthropic/claude-sonnet-4.6".to_string()),
                color: Some("#3fae8c".to_string()),
                avatar: None,
                system_prompt: Some("You are the director.".to_string()),
            },
            seed_agents: vec![
                SeedAgentSpec {
                    owner: "root".to_string(),
                    name: "editor".to_string(),
                    display_name: Some("Editor".to_string()),
                    model: Some("anthropic/claude-sonnet-4.6".to_string()),
                    color: None,
                    avatar: None,
                    system_prompt: Some("You are the editor.".to_string()),
                },
                SeedAgentSpec {
                    owner: "root".to_string(),
                    name: "dist".to_string(),
                    display_name: None,
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
                    owner: "editor".to_string(),
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
                    owner: "editor".to_string(),
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
                    owner: "editor".to_string(),
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
    async fn spawn_template_creates_root_and_seeds_atomically() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let idea_store = test_idea_store();

        let template = fixture_template();
        let outcome = spawn_template(&template, None, &registry, &event_store, Some(&idea_store))
            .await
            .expect("spawn should succeed");

        // Root + 2 seed agents.
        assert_eq!(outcome.spawned_agents.len(), 3);
        assert_eq!(outcome.spawned_agents[0].name, "director");
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
            .get_active_by_name("director")
            .await
            .unwrap()
            .unwrap();
        let editor = registry
            .get_active_by_name("editor")
            .await
            .unwrap()
            .unwrap();
        let dist = registry.get_active_by_name("dist").await.unwrap().unwrap();
        assert_eq!(editor.parent_id.as_deref(), Some(root.id.as_str()));
        assert_eq!(dist.parent_id.as_deref(), Some(root.id.as_str()));

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
    async fn spawn_template_tolerates_missing_idea_store() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());

        let template = fixture_template();
        let outcome = spawn_template(&template, None, &registry, &event_store, None)
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
    async fn spawn_template_warns_on_unknown_owner() {
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

        let outcome = spawn_template(&template, None, &registry, &event_store, Some(&idea_store))
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
    async fn spawn_template_applies_override_display_name() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let idea_store = test_idea_store();

        let template = fixture_template();
        let outcome = spawn_template(
            &template,
            Some("My Cool Studio"),
            &registry,
            &event_store,
            Some(&idea_store),
        )
        .await
        .expect("spawn should succeed");

        let root = registry
            .get_active_by_name(&template.root.name)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(root.id, outcome.root_agent_id);
        assert_eq!(root.display_name.as_deref(), Some("My Cool Studio"));
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
