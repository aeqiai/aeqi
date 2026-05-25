//! Compile-time-embedded company templates.
//!
//! A template is a pre-threaded starter kit: one root agent plus seed agents,
//! events, ideas, and quests. Shipped catalog lives under
//! `presets/blueprints/*.json` and is `include_str!`'d so the runtime is
//! self-contained regardless of where it launches from.
//!
//! `Template` (the deserialized shape) lives in [`crate::ipc::blueprints`].

use std::collections::{HashMap, HashSet};

use crate::ipc::blueprints::{
    AgentTemplateSpec, Blueprint, SeedAgentSpec, SeedEventSpec, SeedIdeaSpec, SeedQuestSpec,
    SeedRoleEdgeSpec, SeedRoleSpec,
};

/// Slug of the canonical fallback default Blueprint shipped with the
/// runtime. Operators can override which Blueprint is the catalog
/// default via `[blueprints] default = "<slug>"` in `aeqi.toml`; this
/// constant is the safety net when that config is missing or points at
/// a slug that no longer exists in the catalog.
pub const DEFAULT_BLUEPRINT_SLUG: &str = "aeqi";

const AEQI_DEFAULT_JSON: &str = include_str!("../../../../presets/blueprints/aeqi.json");
const STEWARD_AGENT_TEMPLATE_JSON: &str =
    include_str!("../../../../presets/agent_templates/steward.json");
// Keep the shipped catalog intentionally narrow. The repository still carries
// draft manifests for future archetypes, but only the conservative default is
// embedded into the public runtime catalog until the others have a fresh
// product and protocol audit.
const COMPANY_BLUEPRINT_JSON: &[&str] = &[AEQI_DEFAULT_JSON];
const AGENT_TEMPLATE_JSON: &[&str] = &[STEWARD_AGENT_TEMPLATE_JSON];

/// Reusable agent templates exposed in the catalog.
pub fn agent_templates() -> Vec<AgentTemplateSpec> {
    let mut out: Vec<AgentTemplateSpec> = AGENT_TEMPLATE_JSON
        .iter()
        .map(|raw| {
            serde_json::from_str::<AgentTemplateSpec>(raw)
                .expect("shipped agent template failed to parse")
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

/// All shipped company templates, sorted by slug so the catalog is stable.
/// Parses the embedded JSON on every call — cheap (a handful of small docs)
/// and avoids carrying a `once_cell` dependency just for this.
pub fn company_blueprints() -> Vec<Blueprint> {
    let agent_templates = agent_templates();
    let mut out: Vec<Blueprint> = COMPANY_BLUEPRINT_JSON
        .iter()
        .map(|raw| {
            let bp = serde_json::from_str::<Blueprint>(raw)
                .expect("shipped company template failed to parse");
            expand_catalog_assets(bp, &agent_templates)
        })
        .collect();
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// Company template lookup by slug.
pub fn company_blueprint(slug: &str) -> Option<Blueprint> {
    company_blueprints().into_iter().find(|t| t.slug == slug)
}

/// Resolve reusable template references into the legacy flat seed lists.
/// This keeps old consumers working while making catalog dependencies visible
/// before launch/hire/install.
pub fn expand_catalog_assets(
    mut blueprint: Blueprint,
    templates: &[AgentTemplateSpec],
) -> Blueprint {
    if blueprint.agent_template_refs.is_empty() {
        return blueprint;
    }

    let by_id: HashMap<&str, &AgentTemplateSpec> = templates
        .iter()
        .map(|template| (template.id.as_str(), template))
        .collect();

    for reference in blueprint.agent_template_refs.clone() {
        let Some(template) = by_id.get(reference.id.as_str()) else {
            continue;
        };
        let agent_name = reference
            .name
            .clone()
            .unwrap_or_else(|| template.name.clone());
        let role = reference.role.clone().or_else(|| {
            if template.role.is_empty() {
                None
            } else {
                Some(template.role.clone())
            }
        });

        if !blueprint
            .seed_agents
            .iter()
            .any(|seed| seed.name == agent_name)
        {
            blueprint.seed_agents.push(SeedAgentSpec {
                owner: reference.owner.clone(),
                template_id: Some(template.id.clone()),
                name: agent_name.clone(),
                tagline: if template.tagline.is_empty() {
                    None
                } else {
                    Some(template.tagline.clone())
                },
                role,
                model: template.model.clone(),
                color: template.color.clone(),
                avatar: template.avatar.clone(),
                system_prompt: template.system_prompt.clone(),
                proactive_greeting: template.proactive_greeting.clone(),
                seed_messages: template.seed_messages.clone(),
            });
        }

        append_template_events(
            &mut blueprint.seed_events,
            &template.seed_events,
            &agent_name,
        );
        append_template_ideas(&mut blueprint.seed_ideas, &template.seed_ideas, &agent_name);
        append_template_quests(
            &mut blueprint.seed_quests,
            &template.seed_quests,
            &agent_name,
        );
        append_template_role(&mut blueprint, &reference, template, &agent_name);
    }

    blueprint
}

fn remap_template_owner(owner: &str, template_agent_name: &str) -> String {
    if owner.is_empty() || owner == "root" {
        template_agent_name.to_string()
    } else {
        owner.to_string()
    }
}

fn append_template_events(
    seed_events: &mut Vec<SeedEventSpec>,
    template_events: &[SeedEventSpec],
    agent_name: &str,
) {
    let mut seen: HashSet<(String, String)> = seed_events
        .iter()
        .map(|event| (event.owner.clone(), event.name.clone()))
        .collect();
    for template_event in template_events {
        let mut event = template_event.clone();
        event.owner = remap_template_owner(&event.owner, agent_name);
        if seen.insert((event.owner.clone(), event.name.clone())) {
            seed_events.push(event);
        }
    }
}

fn append_template_ideas(
    seed_ideas: &mut Vec<SeedIdeaSpec>,
    template_ideas: &[SeedIdeaSpec],
    agent_name: &str,
) {
    let mut seen: HashSet<(String, String)> = seed_ideas
        .iter()
        .map(|idea| (idea.owner.clone(), idea.name.clone()))
        .collect();
    for template_idea in template_ideas {
        let mut idea = template_idea.clone();
        idea.owner = remap_template_owner(&idea.owner, agent_name);
        if seen.insert((idea.owner.clone(), idea.name.clone())) {
            seed_ideas.push(idea);
        }
    }
}

fn append_template_quests(
    seed_quests: &mut Vec<SeedQuestSpec>,
    template_quests: &[SeedQuestSpec],
    agent_name: &str,
) {
    let mut seen: HashSet<(String, String)> = seed_quests
        .iter()
        .map(|quest| (quest.owner.clone(), quest.subject.clone()))
        .collect();
    for template_quest in template_quests {
        let mut quest = template_quest.clone();
        quest.owner = remap_template_owner(&quest.owner, agent_name);
        if seen.insert((quest.owner.clone(), quest.subject.clone())) {
            seed_quests.push(quest);
        }
    }
}

fn append_template_role(
    blueprint: &mut Blueprint,
    reference: &crate::ipc::blueprints::AgentTemplateRef,
    template: &AgentTemplateSpec,
    agent_name: &str,
) {
    if blueprint.seed_roles.is_empty() {
        return;
    }
    let key = format!("agent-template-{}", template.id);
    if !blueprint.seed_roles.iter().any(|role| role.key == key) {
        blueprint.seed_roles.push(SeedRoleSpec {
            key: key.clone(),
            title: reference
                .role
                .clone()
                .filter(|role| !role.is_empty())
                .or_else(|| {
                    if template.role.is_empty() {
                        None
                    } else {
                        Some(template.role.clone())
                    }
                })
                .unwrap_or_else(|| template.name.clone()),
            default_occupant_agent: Some(agent_name.to_string()),
            role_type: None,
            grants: None,
        });
    }
    if blueprint
        .seed_roles
        .iter()
        .any(|role| role.key == reference.owner)
        && !blueprint
            .seed_role_edges
            .iter()
            .any(|edge| edge.parent == reference.owner && edge.child == key)
    {
        blueprint.seed_role_edges.push(SeedRoleEdgeSpec {
            parent: reference.owner.clone(),
            child: key,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn company_catalog_ships_only_the_default_blueprint() {
        let slugs: Vec<String> = company_blueprints().into_iter().map(|t| t.slug).collect();
        assert_eq!(slugs, vec![DEFAULT_BLUEPRINT_SLUG.to_string()]);
    }

    #[test]
    fn default_blueprint_resolves() {
        assert!(
            company_blueprint(DEFAULT_BLUEPRINT_SLUG).is_some(),
            "DEFAULT_BLUEPRINT_SLUG '{DEFAULT_BLUEPRINT_SLUG}' must point at a shipped template",
        );
    }

    #[test]
    fn company_blueprint_lookup_returns_default_full_spec() {
        let default = company_blueprint(DEFAULT_BLUEPRINT_SLUG).expect("default template present");
        assert_eq!(default.name, "First Company");
        assert_eq!(default.root.name, "Chief of Staff");
        assert_eq!(default.seed_agents.len(), 1);
        assert!(default.agent_template_refs.is_empty());
        assert_eq!(default.seed_events.len(), 9);
        assert_eq!(default.seed_ideas.len(), 10);
        assert_eq!(default.seed_quests.len(), 8);
    }

    #[test]
    fn agent_catalog_ships_steward_template() {
        let templates = agent_templates();
        assert!(
            templates.iter().any(|template| template.id == "steward"),
            "Steward must be exposed as a reusable agent template",
        );
    }

    #[test]
    fn default_blueprint_seeds_chief_of_staff_and_founder_associate() {
        let default = company_blueprint(DEFAULT_BLUEPRINT_SLUG).expect("default template present");
        assert!(
            default.agent_template_refs.is_empty(),
            "default blueprint keeps first-company operators inline rather than hidden behind reusable templates",
        );
        assert_eq!(default.root.name, "Chief of Staff");
        assert!(
            default
                .seed_agents
                .iter()
                .any(|agent| agent.name == "Founder Associate"),
            "default blueprint should seed the Founder Associate as the second operator",
        );
        assert!(
            default
                .seed_roles
                .iter()
                .any(|role| role.title == "Chief of Staff"),
            "default blueprint should expose the root agent as a Chief of Staff role",
        );
        assert!(
            default.seed_roles.iter().any(|role| {
                role.title == "Founder Associate"
                    && role.default_occupant_agent.as_deref() == Some("Founder Associate")
            }),
            "default blueprint should expose the Founder Associate as an occupied role",
        );
        assert!(
            default
                .seed_role_edges
                .iter()
                .any(|edge| edge.parent == "root" && edge.child == "founder-associate"),
            "Founder Associate should sit under the Chief of Staff in the role map",
        );
        assert!(
            default
                .seed_ideas
                .iter()
                .any(|idea| idea.name == "First Company operating guide"),
            "default lifecycle events should assemble a top-level operating guide",
        );
        assert!(
            default
                .seed_events
                .iter()
                .any(|event| event.owner == "Founder Associate"
                    && event.name == "load_founder_associate_context"),
            "Founder Associate should have its own lifecycle context loader",
        );
        assert!(
            !default
                .seed_events
                .iter()
                .any(|event| event.owner == "Steward"),
            "no Steward-owned events should ship in the default blueprint",
        );
        assert!(
            !default
                .seed_ideas
                .iter()
                .any(|idea| idea.owner == "Steward"),
            "no Steward-owned ideas should ship in the default blueprint",
        );
        assert!(
            !default
                .seed_roles
                .iter()
                .any(|role| role.default_occupant_agent.as_deref() == Some("Steward")),
            "no Steward-occupied roles should ship in the default blueprint",
        );
    }

    #[test]
    fn default_blueprint_has_category_and_template() {
        let bp = company_blueprint(DEFAULT_BLUEPRINT_SLUG).expect("default template present");
        assert_eq!(bp.category, "company");
        assert_eq!(bp.template, "entity");
    }

    #[test]
    fn draft_blueprints_still_parse_as_inventory() {
        let draft_json = [
            include_str!("../../../../presets/blueprints/aeqi-company.json"),
            include_str!("../../../../presets/blueprints/index-fund.json"),
            include_str!("../../../../presets/blueprints/personal-os.json"),
            include_str!("../../../../presets/blueprints/solo-founder.json"),
            include_str!("../../../../presets/blueprints/studio.json"),
            include_str!("../../../../presets/blueprints/tech-studio.json"),
        ];
        for raw in draft_json {
            let bp: Blueprint =
                serde_json::from_str(raw).expect("draft blueprint inventory must parse");
            assert!(
                company_blueprint(&bp.slug).is_none(),
                "draft blueprint '{}' must not be exposed in the shipped catalog",
                bp.slug,
            );
        }
    }

    #[test]
    fn blueprint_events_use_tool_calls_only() {
        let blueprint_json = [
            AEQI_DEFAULT_JSON,
            include_str!("../../../../presets/blueprints/aeqi-company.json"),
            include_str!("../../../../presets/blueprints/index-fund.json"),
            include_str!("../../../../presets/blueprints/personal-os.json"),
            include_str!("../../../../presets/blueprints/solo-founder.json"),
            include_str!("../../../../presets/blueprints/studio.json"),
            include_str!("../../../../presets/blueprints/tech-studio.json"),
        ];
        for raw in blueprint_json {
            let value: serde_json::Value =
                serde_json::from_str(raw).expect("blueprint JSON must parse");
            let slug = value
                .get("slug")
                .and_then(|v| v.as_str())
                .unwrap_or("<missing-slug>");
            let events = value
                .get("seed_events")
                .and_then(|v| v.as_array())
                .expect("blueprint must carry seed_events");
            for event in events {
                let name = event
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("<missing-name>");
                for legacy_field in [
                    "idea_ids",
                    "query_template",
                    "query_top_k",
                    "query_tag_filter",
                ] {
                    assert!(
                        event.get(legacy_field).is_none(),
                        "blueprint {slug} event {name} still uses legacy field {legacy_field}"
                    );
                }
                assert!(
                    event
                        .get("tool_calls")
                        .and_then(|v| v.as_array())
                        .is_some_and(|calls| !calls.is_empty()),
                    "blueprint {slug} event {name} must declare canonical tool_calls"
                );
            }
        }
    }
}
