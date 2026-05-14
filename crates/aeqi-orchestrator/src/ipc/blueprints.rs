//! Company blueprint IPC handlers.
//!
//! A "blueprint" here is a pre-threaded starter kit for a company: one root
//! agent plus seed agents, events, ideas, and quests. The shipped catalog
//! is embedded at compile time (see [`crate::blueprints`]) so the runtime is
//! self-contained regardless of the cwd it launches from. The on-disk
//! `presets/blueprints/*.json` files remain the source of truth for editing
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
    /// Optional spawn-time greeting. When present, the blueprint
    /// provisioner creates an agent-bound DM session between this agent
    /// and the founder, posts the greeting as an `assistant` turn, and
    /// stamps `awaiting_at` so it surfaces in the inbox immediately.
    /// Each agent introduces itself ("Hi — I'm your CFO. I track
    /// runway and plan funding rounds. Try asking me what your runway
    /// is.") so a freshly-blueprinted Company arrives populated with
    /// one inbox row per operationally-relevant agent.
    #[serde(default)]
    pub proactive_greeting: Option<String>,
}

/// Child agent. `owner` is always "root" for seed_agents — they sit directly
/// under the blueprint's root agent. Nested hierarchies are deferred to v2.
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
    /// Optional spawn-time greeting — see [`RootAgentSpec::proactive_greeting`].
    #[serde(default)]
    pub proactive_greeting: Option<String>,
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

/// A declared role inside the entity. `key` is a stable identifier
/// (used by `seed_role_edges` to reference this role); `title` is the
/// user-visible label ("CTO"). `default_occupant_agent` names a
/// seed_agent (or "root") to slot into this role at spawn time;
/// when `None`, the role spawns vacant.
///
/// v1 round-trips this through the wire so the UI can render the
/// declared org chart on the blueprint detail page. The orchestrator
/// doesn't yet use these at spawn (positions are still auto-derived
/// from seed_agents) — that's the Phase-B refactor. Until then,
/// declared roles must mirror the agent tree 1:1 to keep the preview
/// honest.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SeedRoleSpec {
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub default_occupant_agent: Option<String>,
    /// Role classification. Defaults to `operational` when absent so
    /// pre-rework Blueprint JSON continues to parse without changes.
    #[serde(default)]
    pub role_type: Option<crate::role_registry::RoleType>,
    /// Optional explicit grant set. `None` means "use the type-default
    /// bundle" — the common case for Blueprint-declared roles.
    #[serde(default)]
    pub grants: Option<Vec<String>>,
}

/// Edge in the role DAG. Both ends reference `SeedRoleSpec.key`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SeedRoleEdgeSpec {
    pub parent: String,
    pub child: String,
}

/// Operator-time override of a declared role's default occupant.
/// Sent in the spawn payload; applied during position installation.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RoleOverride {
    pub role_key: String,
    pub occupant: OverrideOccupant,
}

/// What the operator chose to slot into a role at spawn time. The
/// `kind` discriminator picks the variant; agent and human carry their
/// occupant identifier.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum OverrideOccupant {
    /// Use a seed_agent by name (or "root" for the root agent).
    Agent { agent: String },
    /// Slot a human user as the occupant. `user_id` is the
    /// platform-side user UUID; usually the operator's own.
    Human { user_id: String },
    /// Leave the role vacant.
    Vacant,
}

/// Full blueprint manifest.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Blueprint {
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub tagline: String,
    #[serde(default)]
    pub description: String,
    /// User-facing display category. One of `company | foundation | fund`.
    /// Defaults to empty string on older Blueprints that predate the field.
    #[serde(default)]
    pub category: String,
    /// On-chain template slug registered by `RegisterTemplates.s.sol`.
    /// One of `entity | venture | foundation | fund`. The Factory expects
    /// `templateId = keccak256(template)`. Defaults to empty string.
    #[serde(default)]
    pub template: String,
    pub root: RootAgentSpec,
    #[serde(default)]
    pub seed_agents: Vec<SeedAgentSpec>,
    #[serde(default)]
    pub seed_events: Vec<SeedEventSpec>,
    #[serde(default)]
    pub seed_ideas: Vec<SeedIdeaSpec>,
    #[serde(default)]
    pub seed_quests: Vec<SeedQuestSpec>,
    #[serde(default)]
    pub seed_roles: Vec<SeedRoleSpec>,
    #[serde(default)]
    pub seed_role_edges: Vec<SeedRoleEdgeSpec>,
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

/// Which parts of a blueprint to seed. Used by Import flows that want
/// to materialize only ideas or only quests (the full set is the
/// default, fresh-company path). Unknown values get dropped during
/// parsing so unknown keys never 400 a spawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlueprintPart {
    Agents,
    Events,
    Ideas,
    Quests,
}

impl BlueprintPart {
    fn parse(s: &str) -> Option<Self> {
        match s {
            "agents" => Some(Self::Agents),
            "events" => Some(Self::Events),
            "ideas" => Some(Self::Ideas),
            "quests" => Some(Self::Quests),
            _ => None,
        }
    }

    /// All four parts — the default behavior when callers don't specify.
    pub const ALL: [Self; 4] = [Self::Agents, Self::Events, Self::Ideas, Self::Quests];
}

/// Read `parts` from an IPC request. Missing / empty → all four; unknown
/// values warn-and-skip (the brief: "drop the parts validation
/// server-side: unknown values get ignored"). Returns a `Vec` so the
/// caller can hand `&parts` to `spawn_blueprint`.
fn parse_parts(request: &serde_json::Value) -> Vec<BlueprintPart> {
    let Some(arr) = request.get("parts").and_then(|v| v.as_array()) else {
        return BlueprintPart::ALL.to_vec();
    };
    if arr.is_empty() {
        return BlueprintPart::ALL.to_vec();
    }
    let mut out: Vec<BlueprintPart> = Vec::with_capacity(arr.len());
    for v in arr {
        if let Some(s) = v.as_str()
            && let Some(p) = BlueprintPart::parse(s)
            && !out.contains(&p)
        {
            out.push(p);
        } else if let Some(s) = v.as_str() {
            tracing::warn!(value = %s, "blueprint spawn: ignoring unknown 'parts' value");
        }
    }
    if out.is_empty() {
        BlueprintPart::ALL.to_vec()
    } else {
        out
    }
}

/// Read `role_overrides` from the spawn IPC payload. Forward-compatible:
/// missing or malformed entries warn and skip rather than 400 the spawn.
/// Each entry must be `{ "role_key": "...", "occupant": { "kind": "agent|human|vacant", ... } }`.
fn parse_role_overrides(request: &serde_json::Value) -> Vec<RoleOverride> {
    let Some(arr) = request.get("role_overrides").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    let mut out: Vec<RoleOverride> = Vec::with_capacity(arr.len());
    for v in arr {
        match serde_json::from_value::<RoleOverride>(v.clone()) {
            Ok(r) => out.push(r),
            Err(err) => {
                tracing::warn!(error = %err, "blueprint spawn: ignoring malformed role override");
            }
        }
    }
    out
}

/// Spawn a company from a blueprint. Pure logic: everything external is
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
///
/// `parts` selects which seed blocks to materialize. The root agent is
/// always created (it owns the entity); seed_agents/events/ideas/quests
/// are gated on the corresponding `BlueprintPart` flag. The Import flows
/// pass `[Ideas]` or `[Quests]` to scope a spawn to one primitive.
#[allow(clippy::too_many_arguments)]
pub async fn spawn_blueprint(
    blueprint: &Blueprint,
    override_name: Option<&str>,
    parent_agent_id: Option<&str>,
    entity_id_override: Option<&str>,
    parts: &[BlueprintPart],
    agent_registry: &AgentRegistry,
    event_store: &EventHandlerStore,
    idea_store: Option<&Arc<dyn aeqi_core::traits::IdeaStore>>,
    role_registry: &crate::role_registry::RoleRegistry,
    role_overrides: &[RoleOverride],
) -> anyhow::Result<SpawnOutcome> {
    let mut warnings: Vec<String> = Vec::new();

    // ---- root agent ----
    // Pass `blueprint.slug` as the entity-slug override so the canonical
    // marketing brand (e.g. `meridian-supply`) lands on the entity row,
    // not the root agent's persona name. This decouples the entity
    // identity from the agent-level canonical_name; slug collisions key
    // off the brand, not the persona, so a founder deploying two
    // companies with the same default persona (`founder`) but different
    // brands no longer trips a UNIQUE error on `entities.slug`.
    //
    // For child spawns (`parent_agent_id = Some(_)`) the override is
    // a no-op — children reuse the parent's entity row.
    let entity_slug_override = if parent_agent_id.is_none() && !blueprint.slug.is_empty() {
        Some(blueprint.slug.as_str())
    } else {
        None
    };
    let root = agent_registry
        .spawn_with_entity_id(
            override_name.unwrap_or(&blueprint.root.name),
            parent_agent_id,
            blueprint.root.model.as_deref(),
            entity_id_override,
            entity_slug_override,
        )
        .await?;
    apply_visual_identity(
        agent_registry,
        &root.id,
        blueprint.root.color.as_deref(),
        blueprint.root.avatar.as_deref(),
    )
    .await;

    // Persist persona as an identity idea so assemble_ideas picks it up on
    // session:start. No separate persona table needed.
    if let (Some(store), Some(prompt)) = (idea_store, blueprint.root.system_prompt.as_ref()) {
        store_identity_idea(store.as_ref(), &root.id, &root.name, prompt, &mut warnings).await;
    }

    // ---- seed agents ----
    let mut owner_to_agent_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    owner_to_agent_id.insert("root".to_string(), root.id.clone());
    owner_to_agent_id.insert(blueprint.root.name.clone(), root.id.clone());

    let mut spawned_agents = vec![SpawnedAgent {
        id: root.id.clone(),
        name: root.name.clone(),
    }];

    let want_agents = parts.contains(&BlueprintPart::Agents);
    let want_events = parts.contains(&BlueprintPart::Events);
    let want_ideas = parts.contains(&BlueprintPart::Ideas);
    let want_quests = parts.contains(&BlueprintPart::Quests);

    if want_agents {
        for seed in &blueprint.seed_agents {
            if seed.owner != "root" && seed.owner != blueprint.root.name {
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
                store_identity_idea(store.as_ref(), &child.id, &seed.name, prompt, &mut warnings)
                    .await;
            }
            owner_to_agent_id.insert(seed.name.clone(), child.id.clone());
            spawned_agents.push(SpawnedAgent {
                id: child.id.clone(),
                name: child.name.clone(),
            });
        }
    }

    // ---- seed ideas ----
    // Seed ideas before events/quests so events referencing them by name
    // could, in principle, be resolved later. Current blueprint shape doesn't
    // require it but this preserves the invariant for v2.
    let mut created_ideas = 0usize;
    if want_ideas {
        if let Some(store) = idea_store {
            for idea in &blueprint.seed_ideas {
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
        } else if !blueprint.seed_ideas.is_empty() {
            // Fail loud (2026-05-14, Ideas steward Wave 2). A blueprint that
            // declares seed ideas but lands on a runtime without an idea
            // store would silently ship persona-less agents. That is
            // unrecoverable at the user level — there is no observable
            // signal that the persona was supposed to load. Refuse the
            // spawn so the operator gets a deterministic configuration
            // error instead.
            return Err(anyhow::anyhow!(
                "blueprint '{}' declares {} seed_ideas but no idea store is wired; refusing to spawn persona-less agents",
                blueprint.slug,
                blueprint.seed_ideas.len(),
            ));
        }
    }

    // ---- seed events ----
    let mut created_events = 0usize;
    if want_events {
        for ev in &blueprint.seed_events {
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
                tool_calls,
                cooldown_secs: ev.cooldown_secs,
                system: false,
            };
            match event_store.create(&new_event).await {
                Ok(_) => created_events += 1,
                Err(err) => warnings.push(format!("seed_event '{}' create failed: {err}", ev.name)),
            }
        }
    }

    // ---- seed quests ----
    let mut created_quests = 0usize;
    if want_quests {
        for q in &blueprint.seed_quests {
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
                Err(err) => {
                    warnings.push(format!("seed_quest '{}' create failed: {err}", q.subject,))
                }
            }
        }
    }

    let entity_id = root.entity_id.clone().ok_or_else(|| {
        anyhow::anyhow!("spawned root agent has no entity_id (post-Phase-4 invariant)")
    })?;

    // Install declared roles when the blueprint provides them. The
    // agent_registry has already auto-created one position per spawned
    // agent (the legacy fallback path that keeps un-declared blueprints
    // working). When `seed_roles` is non-empty, we wipe those auto
    // positions and install the declared structure fresh — that's how
    // vacancies and role-overrides land on the spawned company.
    if !blueprint.seed_roles.is_empty()
        && let Err(err) = install_declared_roles(
            role_registry,
            &entity_id,
            &blueprint.seed_roles,
            &blueprint.seed_role_edges,
            &owner_to_agent_id,
            role_overrides,
            &mut warnings,
        )
        .await
    {
        warnings.push(format!("declared roles install failed: {err}"));
    }

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

/// Replace every auto-created position for `entity_id` with the
/// declared role structure. Operator overrides take precedence over
/// the blueprint's `default_occupant_agent`. Unknown role keys in
/// overrides become warnings (the spawn still proceeds).
#[allow(clippy::too_many_arguments)]
async fn install_declared_roles(
    role_registry: &crate::role_registry::RoleRegistry,
    entity_id: &str,
    seed_roles: &[SeedRoleSpec],
    seed_role_edges: &[SeedRoleEdgeSpec],
    owner_to_agent_id: &std::collections::HashMap<String, String>,
    role_overrides: &[RoleOverride],
    warnings: &mut Vec<String>,
) -> anyhow::Result<()> {
    use crate::role_registry::OccupantKind;

    // Validate operator-supplied overrides early; an override referencing
    // an unknown role key signals UI-side staleness and should warn loudly.
    let role_keys: std::collections::HashSet<&str> =
        seed_roles.iter().map(|r| r.key.as_str()).collect();
    let mut overrides_by_key: std::collections::HashMap<&str, &OverrideOccupant> =
        std::collections::HashMap::new();
    for o in role_overrides {
        if !role_keys.contains(o.role_key.as_str()) {
            warnings.push(format!(
                "role override for unknown role key '{}' ignored",
                o.role_key,
            ));
            continue;
        }
        overrides_by_key.insert(o.role_key.as_str(), &o.occupant);
    }

    // Wipe the auto-position residue. Single transaction underneath —
    // edges first (FK to positions), then positions.
    role_registry.delete_for_entity(entity_id).await?;

    // Mint declared roles; map role_key → fresh role_id so
    // `seed_role_edges` can reference them.
    let mut key_to_role_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for role_spec in seed_roles {
        let (kind, occupant_id): (OccupantKind, Option<String>) = match overrides_by_key
            .get(role_spec.key.as_str())
        {
            Some(OverrideOccupant::Agent { agent }) => match owner_to_agent_id.get(agent) {
                Some(id) => (OccupantKind::Agent, Some(id.clone())),
                None => {
                    warnings.push(format!(
                            "override for role '{}' names agent '{}' which wasn't seeded; leaving vacant",
                            role_spec.key, agent,
                        ));
                    (OccupantKind::Vacant, None)
                }
            },
            Some(OverrideOccupant::Human { user_id }) => {
                (OccupantKind::Human, Some(user_id.clone()))
            }
            Some(OverrideOccupant::Vacant) => (OccupantKind::Vacant, None),
            None => match role_spec.default_occupant_agent.as_deref() {
                Some(agent_name) => match owner_to_agent_id.get(agent_name) {
                    Some(id) => (OccupantKind::Agent, Some(id.clone())),
                    None => {
                        warnings.push(format!(
                            "default occupant '{}' for role '{}' wasn't seeded; leaving vacant",
                            agent_name, role_spec.key,
                        ));
                        (OccupantKind::Vacant, None)
                    }
                },
                None => (OccupantKind::Vacant, None),
            },
        };

        let role_type = role_spec
            .role_type
            .unwrap_or(crate::role_registry::RoleType::Operational);
        let created_role = role_registry
            .create_with_type(
                entity_id,
                &role_spec.title,
                kind,
                occupant_id.as_deref(),
                role_type,
                false,
                role_spec.grants.clone(),
            )
            .await?;
        key_to_role_id.insert(role_spec.key.clone(), created_role.id);
    }

    // Wire edges. Unknown keys here are blueprint-author bugs — warn
    // but don't fail the spawn.
    for edge in seed_role_edges {
        let parent_id = match key_to_role_id.get(&edge.parent) {
            Some(id) => id,
            None => {
                warnings.push(format!(
                    "seed_role_edge parent '{}' not found in seed_roles; skipping",
                    edge.parent,
                ));
                continue;
            }
        };
        let child_id = match key_to_role_id.get(&edge.child) {
            Some(id) => id,
            None => {
                warnings.push(format!(
                    "seed_role_edge child '{}' not found in seed_roles; skipping",
                    edge.child,
                ));
                continue;
            }
        };
        role_registry.add_edge(parent_id, child_id).await?;
    }

    Ok(())
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
    // The `personality:<agent_id>` tag is the deterministic per-agent
    // lookup key the Personality tab on the agent rail reads from. It
    // co-exists with the legacy `identity` tag so the existing
    // session:start tag-policy assembly path keeps working unchanged —
    // identity-tagged ideas are pulled into the system prompt today,
    // and the new tag is purely a UI handle. See `tools/mod.rs` for the
    // shared helper used by every persona-creation surface.
    let tags = crate::tools::persona_idea_tags(agent_id);
    if let Err(err) = idea_store
        .store(&idea_name, system_prompt, &tags, Some(agent_id))
        .await
    {
        warnings.push(format!("identity idea for '{name}' store failed: {err}"));
    }
}

/// Post each operationally-relevant agent's spawn-time greeting into a fresh
/// DM session with the founder. One inbox row per agent that declares a
/// `proactive_greeting` — so a freshly-blueprinted Company arrives populated
/// instead of empty. Best-effort: every failure is warn-logged and the spawn
/// proceeds regardless. Only called from `handle_spawn_blueprint` (fresh
/// Company spawn); import/into-entity paths intentionally skip this.
///
/// Each greeting introduces the agent — who they are, what they do, what to
/// ask them — so the founder lands in a workspace that already feels alive.
///
/// The DM session is created via `create_session` (not
/// `find_or_create_dm_session`) so the row carries `agent_id` directly. That's
/// load-bearing for the `answer_inbox` reply path: `handle_answer_inbox`
/// rejects the founder's reply with `"session has no agent binding"` when the
/// session row's `agent_id` is empty. The participant table holds the same
/// information for multi-participant queries; the column on the row keeps
/// single-agent reply routing simple.
async fn seed_proactive_greetings(
    session_store: &crate::session_store::SessionStore,
    blueprint: &Blueprint,
    outcome: &SpawnOutcome,
    creator_user_id: &str,
) {
    // Walk every agent the blueprint declares — root + seeds — and pair its
    // declared greeting with the just-spawned agent_id by name. The root's
    // id is on the outcome under `root_agent_id`; seed agent ids land in
    // `outcome.spawned_agents` keyed by name.
    let mut greetings: Vec<(String, String, String)> = Vec::new();
    if let Some(ref content) = blueprint.root.proactive_greeting {
        greetings.push((
            outcome.root_agent_id.clone(),
            blueprint.root.name.clone(),
            content.clone(),
        ));
    }
    for seed in &blueprint.seed_agents {
        let Some(ref content) = seed.proactive_greeting else {
            continue;
        };
        match outcome.spawned_agents.iter().find(|a| a.name == seed.name) {
            Some(spawned) => {
                greetings.push((spawned.id.clone(), seed.name.clone(), content.clone()))
            }
            None => tracing::warn!(
                seed = %seed.name,
                "proactive greeting: seed agent not present in spawn outcome; skipping",
            ),
        }
    }

    for (agent_id, agent_name, content) in greetings {
        seed_one_greeting(
            session_store,
            &agent_id,
            &agent_name,
            &content,
            creator_user_id,
        )
        .await;
    }
}

async fn seed_one_greeting(
    session_store: &crate::session_store::SessionStore,
    agent_id: &str,
    agent_name: &str,
    content: &str,
    creator_user_id: &str,
) {
    // Subject is the agent's name — the inbox row reads "<Agent Name>:
    // <preview>". One row per agent keeps the inbox legible at a glance.
    let subject = agent_name.to_string();
    let dm_name = format!("DM — {agent_name}");

    // 1. Mint an agent-bound DM session. `create_session` writes
    //    `agent_id` on the row so `handle_answer_inbox` can route the
    //    founder's reply back through this agent's queue.
    let session_id = match session_store
        .create_session(agent_id, "dm", &dm_name, None, None)
        .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::warn!(error = %e, agent_id, "proactive greeting: failed to create DM session");
            return;
        }
    };

    // 2. Add both participants. Idempotent — `INSERT OR IGNORE` so a
    //    re-run on the same session is safe.
    if let Err(e) = session_store
        .add_session_participant(&session_id, "agent", agent_id, None)
        .await
    {
        tracing::warn!(error = %e, session_id, "proactive greeting: failed to add agent participant");
    }
    if let Err(e) = session_store
        .add_session_participant(&session_id, "user", creator_user_id, None)
        .await
    {
        tracing::warn!(error = %e, session_id, "proactive greeting: failed to add user participant");
    }

    // 3. Append the greeting as an `assistant` turn from this agent.
    if let Err(e) = session_store
        .append_message_from(
            &session_id,
            "assistant",
            content,
            "agent",
            Some(agent_id),
            None,
        )
        .await
    {
        tracing::warn!(error = %e, session_id, "proactive greeting: failed to append message");
        return;
    }

    // 4. Stamp `awaiting_at` so the row surfaces in the founder's inbox
    //    immediately. The first reply will clear awaiting via
    //    `clear_awaiting` (in `session_send`) or `answer_awaiting` (in
    //    `handle_answer_inbox`).
    if let Err(e) = session_store.set_awaiting(&session_id, &subject).await {
        tracing::warn!(error = %e, session_id, "proactive greeting: failed to set awaiting");
        return;
    }

    tracing::info!(
        session_id,
        agent_id,
        agent_name,
        creator_user_id,
        "proactive greeting seeded",
    );
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

pub async fn handle_list_blueprints(
    _ctx: &super::CommandContext,
    _request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let templates = crate::blueprints::company_blueprints();
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
    match crate::blueprints::company_blueprint(slug) {
        Some(t) => serde_json::json!({"ok": true, "blueprint": t}),
        None => serde_json::json!({
            "ok": false,
            "error": format!("blueprint not found: {slug}"),
            "code": "not_found",
        }),
    }
}

pub async fn handle_spawn_blueprint(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    // Two payload shapes the platform may send:
    //
    //   1. `blueprint` = static catalog slug (legacy + canonical seed path
    //      used by `/start/launch`, `/api/companies/create`, etc.).
    //   2. `inline_blueprint` = the full Blueprint JSON, sent by the
    //      architect's deploy path which generates a one-off blueprint
    //      that doesn't live in the static catalog.
    //
    // Exactly one must be present. The inline shape lets the platform
    // ferry an architect-generated draft straight into the runtime
    // without round-tripping through a fake catalog entry.
    let inline_blueprint_value = request.get("inline_blueprint").cloned();
    let slug = super::request_field(request, "blueprint").unwrap_or("");
    if slug.is_empty() && inline_blueprint_value.is_none() {
        return serde_json::json!({
            "ok": false,
            "error": "blueprint or inline_blueprint is required",
        });
    }

    // `display_name` is the canonical override key (mirrors `/start/launch`).
    let display_name = super::request_field(request, "display_name").map(str::to_string);
    // Optional platform-supplied entity_id (UUID). When present, the
    // runtime adopts it instead of minting its own — the canonical
    // `/start/launch` path.
    let entity_id_override = super::request_field(request, "entity_id").map(str::to_string);
    // The platform-side user UUID for the creator. Injected by the web
    // route when a JWT is present. Used to auto-create the founding Director
    // role; absent for scope/proxy tokens that have no user context.
    let creator_user_id = super::request_field(request, "creator_user_id").map(str::to_string);

    let blueprint = if let Some(value) = inline_blueprint_value {
        match serde_json::from_value::<Blueprint>(value) {
            Ok(b) => b,
            Err(err) => {
                return serde_json::json!({
                    "ok": false,
                    "error": format!("inline_blueprint is not a valid Blueprint: {err}"),
                    "code": "invalid_blueprint",
                });
            }
        }
    } else {
        match crate::blueprints::company_blueprint(slug) {
            Some(t) => t,
            None => {
                return serde_json::json!({
                    "ok": false,
                    "error": format!("blueprint not found: {slug}"),
                    "code": "not_found",
                });
            }
        }
    };

    let requested_display_name = display_name.as_deref().unwrap_or(&blueprint.root.name);

    // Reject if a root agent with this name already exists — blueprint spawns
    // are meant to be the beginning of a fresh company, not a silent merge
    // into an existing one.
    match ctx
        .agent_registry
        .get_active_by_name(requested_display_name)
        .await
    {
        Ok(Some(existing)) => {
            return serde_json::json!({
                "ok": false,
                "error": format!(
                    "an agent named '{}' already exists (id {}); pick a different company name or retire the existing one",
                    requested_display_name, existing.id,
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

    let role_overrides = parse_role_overrides(request);

    match spawn_blueprint(
        &blueprint,
        display_name.as_deref(),
        None,
        entity_id_override.as_deref(),
        &BlueprintPart::ALL,
        &ctx.agent_registry,
        event_store.as_ref(),
        ctx.idea_store.as_ref(),
        ctx.role_registry.as_ref(),
        &role_overrides,
    )
    .await
    {
        Ok(outcome) => {
            // Auto-create the founding Director role for the creator. Every
            // Company has exactly one founding Director (founder=1, all 6
            // grants, occupant_kind=human). This is system-invariant —
            // Blueprints may declare additional Directors or Advisors, but
            // the founding Director is always created here, idempotently.
            if let Some(ref uid) = creator_user_id {
                match ctx
                    .role_registry
                    .ensure_founding_director(&outcome.entity_id, uid)
                    .await
                {
                    Ok(role) => tracing::info!(
                        role_id = %role.id,
                        entity_id = %outcome.entity_id,
                        user_id = %uid,
                        "auto-created founding Director role",
                    ),
                    Err(e) => tracing::error!(
                        error = %e,
                        entity_id = %outcome.entity_id,
                        user_id = %uid,
                        "failed to auto-create founding Director role",
                    ),
                }

                // Spawn-time proactive greetings — one DM per agent that
                // declares a `proactive_greeting`. Best-effort, never
                // blocks spawn.
                if let Some(ref ss) = ctx.session_store {
                    seed_proactive_greetings(ss.as_ref(), &blueprint, &outcome, uid).await;
                }
            }
            serde_json::json!({
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
                    "slug": blueprint.slug,
                    "name": blueprint.name,
                },
            })
        }
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

    let blueprint = match crate::blueprints::company_blueprint(slug) {
        Some(t) => t,
        None => {
            return serde_json::json!({
                "ok": false,
                "error": format!("blueprint not found: {slug}"),
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

    // `parts` filter: when omitted, seed all four (full-company import,
    // current behavior). When set, only the listed parts materialize —
    // the Import-from-blueprint flow on Ideas / Quests narrows this to
    // a single primitive. Unknown values are ignored (warn + skip), not
    // 400'd, so a forward-compatible client never breaks the spawn.
    let parts = parse_parts(request);

    match spawn_blueprint(
        &blueprint,
        None,
        Some(&parent.id),
        None,
        &parts,
        &ctx.agent_registry,
        event_store.as_ref(),
        ctx.idea_store.as_ref(),
        ctx.role_registry.as_ref(),
        &[],
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
                "slug": blueprint.slug,
                "name": blueprint.name,
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

    fn fixture_blueprint() -> Blueprint {
        Blueprint {
            slug: "test-studio".to_string(),
            name: "Test Studio".to_string(),
            tagline: "fixture".to_string(),
            description: "fixture blueprint".to_string(),
            category: String::new(),
            template: String::new(),
            root: RootAgentSpec {
                name: "Director".to_string(),
                model: Some("anthropic/claude-sonnet-4.6".to_string()),
                color: Some("#3fae8c".to_string()),
                avatar: None,
                system_prompt: Some("You are the director.".to_string()),
                proactive_greeting: None,
            },
            seed_agents: vec![
                SeedAgentSpec {
                    owner: "root".to_string(),
                    name: "Editor".to_string(),
                    model: Some("anthropic/claude-sonnet-4.6".to_string()),
                    color: None,
                    avatar: None,
                    system_prompt: Some("You are the editor.".to_string()),
                    proactive_greeting: None,
                },
                SeedAgentSpec {
                    owner: "root".to_string(),
                    name: "Distribution".to_string(),
                    model: None,
                    color: None,
                    avatar: None,
                    system_prompt: None,
                    proactive_greeting: None,
                },
            ],
            seed_events: vec![
                SeedEventSpec {
                    owner: "root".to_string(),
                    name: "weekly".to_string(),
                    pattern: "session:start".to_string(),
                    cooldown_secs: 0,
                    tool_calls: Vec::new(),
                },
                SeedEventSpec {
                    owner: "Editor".to_string(),
                    name: "on_draft".to_string(),
                    pattern: "session:quest_start".to_string(),
                    cooldown_secs: 60,
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
            seed_roles: Vec::new(),
            seed_role_edges: Vec::new(),
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
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());
        let idea_store = test_idea_store();

        let blueprint = fixture_blueprint();
        let outcome = spawn_blueprint(
            &blueprint,
            None,
            None,
            None,
            &BlueprintPart::ALL,
            &registry,
            &event_store,
            Some(&idea_store),
            &role_registry,
            &[],
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
    async fn spawn_blueprint_refuses_missing_idea_store_when_seeds_declared() {
        // Behaviour locked 2026-05-14 (Ideas steward Wave 2). A blueprint
        // that declares `seed_ideas` and runs against a runtime without an
        // idea store must fail loud — silently dropping the seeds shipped
        // persona-less agents with no observable signal. See
        // `crates/aeqi-orchestrator/src/ipc/blueprints.rs::spawn_blueprint`
        // for the matching error site.
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());

        let blueprint = fixture_blueprint();
        assert!(
            !blueprint.seed_ideas.is_empty(),
            "fixture should declare seed_ideas for this case to be meaningful",
        );

        let err = spawn_blueprint(
            &blueprint,
            None,
            None,
            None,
            &BlueprintPart::ALL,
            &registry,
            &event_store,
            None,
            &role_registry,
            &[],
        )
        .await
        .expect_err("spawn must fail when seed_ideas declared but no idea store wired");
        let msg = err.to_string();
        assert!(
            msg.contains("seed_ideas") && msg.contains("no idea store"),
            "error should name the cause; got: {msg}",
        );
    }

    #[tokio::test]
    async fn spawn_blueprint_succeeds_without_idea_store_when_no_seeds() {
        // Counterpart to the refuses_… test above: a blueprint that
        // declares zero seed_ideas should still spawn cleanly without an
        // idea store. The fail-loud rule only fires when seeds would have
        // been dropped.
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());

        let mut blueprint = fixture_blueprint();
        blueprint.seed_ideas.clear();

        let outcome = spawn_blueprint(
            &blueprint,
            None,
            None,
            None,
            &BlueprintPart::ALL,
            &registry,
            &event_store,
            None,
            &role_registry,
            &[],
        )
        .await
        .expect("spawn should succeed without idea store when no seeds");

        assert_eq!(outcome.spawned_agents.len(), 3);
        assert_eq!(outcome.created_ideas, 0);
    }

    #[tokio::test]
    async fn spawn_blueprint_warns_on_unknown_owner() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());
        let idea_store = test_idea_store();

        let mut blueprint = fixture_blueprint();
        blueprint.seed_events.push(SeedEventSpec {
            owner: "ghost".to_string(),
            name: "orphan".to_string(),
            pattern: "session:start".to_string(),
            cooldown_secs: 0,
            tool_calls: Vec::new(),
        });

        let outcome = spawn_blueprint(
            &blueprint,
            None,
            None,
            None,
            &BlueprintPart::ALL,
            &registry,
            &event_store,
            Some(&idea_store),
            &role_registry,
            &[],
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
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());
        let idea_store = test_idea_store();

        let blueprint = fixture_blueprint();
        let outcome = spawn_blueprint(
            &blueprint,
            Some("My Cool Studio"),
            None,
            None,
            &BlueprintPart::ALL,
            &registry,
            &event_store,
            Some(&idea_store),
            &role_registry,
            &[],
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
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());
        let idea_store = test_idea_store();

        // Stand up a host entity first.
        let host_template = fixture_blueprint();
        let host = spawn_blueprint(
            &host_template,
            Some("Host Co"),
            None,
            None,
            &BlueprintPart::ALL,
            &registry,
            &event_store,
            Some(&idea_store),
            &role_registry,
            &[],
        )
        .await
        .expect("host spawn should succeed");
        let host_root_id = host.root_agent_id.clone();
        let host_entity_id = host.entity_id.clone();

        // Now import a second blueprint into that entity.
        let imported_blueprint = Blueprint {
            slug: "imported-bp".to_string(),
            name: "Imported BP".to_string(),
            tagline: String::new(),
            description: String::new(),
            category: String::new(),
            template: String::new(),
            root: RootAgentSpec {
                name: "Imported Root".to_string(),
                model: None,
                color: None,
                avatar: None,
                system_prompt: None,
                proactive_greeting: None,
            },
            seed_agents: vec![SeedAgentSpec {
                owner: "root".to_string(),
                name: "Imported Helper".to_string(),
                model: None,
                color: None,
                avatar: None,
                system_prompt: None,
                proactive_greeting: None,
            }],
            seed_events: Vec::new(),
            seed_ideas: Vec::new(),
            seed_quests: Vec::new(),
            seed_roles: Vec::new(),
            seed_role_edges: Vec::new(),
        };
        let imported = spawn_blueprint(
            &imported_blueprint,
            None,
            Some(&host_root_id),
            None,
            &BlueprintPart::ALL,
            &registry,
            &event_store,
            Some(&idea_store),
            &role_registry,
            &[],
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
    async fn spawn_blueprint_with_only_ideas_skips_other_seeds() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());
        let idea_store = test_idea_store();

        let blueprint = fixture_blueprint();
        let outcome = spawn_blueprint(
            &blueprint,
            None,
            None,
            None,
            &[BlueprintPart::Ideas],
            &registry,
            &event_store,
            Some(&idea_store),
            &role_registry,
            &[],
        )
        .await
        .expect("spawn should succeed");

        // Only the root spawned (no seed_agents), no events, no quests, but
        // ideas owned by `root` are seeded. Editor's seed_idea (owner =
        // "Editor") is skipped because the Editor agent wasn't spawned —
        // the warning trail records it.
        assert_eq!(outcome.spawned_agents.len(), 1);
        assert_eq!(outcome.created_events, 0);
        assert_eq!(outcome.created_quests, 0);
        assert_eq!(outcome.created_ideas, 1);
        assert!(
            outcome
                .warnings
                .iter()
                .any(|w| w.contains("Rubric") && w.contains("Editor")),
            "expected owner-not-found warning for Editor's idea; got {:?}",
            outcome.warnings,
        );
    }

    #[tokio::test]
    async fn spawn_blueprint_with_only_quests_skips_other_seeds() {
        let registry = test_registry().await;
        let event_store = EventHandlerStore::new(registry.db());
        let role_registry = crate::role_registry::RoleRegistry::open(registry.db());
        let idea_store = test_idea_store();

        let blueprint = fixture_blueprint();
        let outcome = spawn_blueprint(
            &blueprint,
            None,
            None,
            None,
            &[BlueprintPart::Quests],
            &registry,
            &event_store,
            Some(&idea_store),
            &role_registry,
            &[],
        )
        .await
        .expect("spawn should succeed");

        assert_eq!(outcome.spawned_agents.len(), 1);
        assert_eq!(outcome.created_events, 0);
        assert_eq!(outcome.created_ideas, 0);
        // root-owned quest lands; Editor-owned quest skips with a warning.
        assert_eq!(outcome.created_quests, 1);
    }

    #[test]
    fn parse_parts_defaults_to_all_when_missing_or_empty() {
        let req_no_parts = serde_json::json!({});
        assert_eq!(parse_parts(&req_no_parts), BlueprintPart::ALL.to_vec());

        let req_empty = serde_json::json!({"parts": []});
        assert_eq!(parse_parts(&req_empty), BlueprintPart::ALL.to_vec());
    }

    #[test]
    fn parse_parts_drops_unknown_values_silently() {
        let req = serde_json::json!({"parts": ["ideas", "wat", "quests"]});
        assert_eq!(
            parse_parts(&req),
            vec![BlueprintPart::Ideas, BlueprintPart::Quests],
        );

        // All-unknown collapses to ALL — never spawn nothing.
        let req = serde_json::json!({"parts": ["mystery"]});
        assert_eq!(parse_parts(&req), BlueprintPart::ALL.to_vec());
    }

    #[tokio::test]
    async fn embedded_canonical_templates_parse_cleanly() {
        // Guard against accidental JSON breakage in the shipped presets —
        // the embed helper panics on parse failure, so reaching here proves
        // each shipped blueprint deserializes into a full `Template`.
        let loaded = crate::blueprints::company_blueprints();
        let slugs: Vec<&str> = loaded.iter().map(|t| t.slug.as_str()).collect();
        for expected in [
            "aeqi",
            "solo-founder",
            "studio",
            "tech-studio",
            "personal-os",
        ] {
            assert!(
                slugs.contains(&expected),
                "canonical blueprint '{expected}' missing; loaded: {slugs:?}",
            );
        }
    }
}
