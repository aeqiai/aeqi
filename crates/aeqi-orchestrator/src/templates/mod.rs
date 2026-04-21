//! Compile-time-embedded templates.
//!
//! AEQI ships two flavours of starter content:
//!
//! - **Identity templates** — single-agent personas (leader, researcher,
//!   reviewer). YAML-frontmatter markdown, spawned under an existing parent
//!   via `/api/agents/spawn`.
//! - **Company templates** — full multi-agent companies (solo-founder, studio,
//!   small-business). JSON manifests, spawned as a new root via
//!   `/api/templates/spawn`.
//!
//! Both used to live on disk under `agents/*/agent.md` and
//! `presets/templates/*.json` — which meant the binary could only find them
//! when the runtime happened to be launched from the repo root. Now they're
//! `include_str!`'d at build time so the runtime is self-contained and the
//! catalog can't drift from the shipping binary.
//!
//! The shipped files are still the source of truth on disk; `include_str!`
//! just pins them into the binary. Editing either the md or the json files
//! and rebuilding is the flow.
//!
//! `Template` (company shape) lives in [`crate::ipc::templates`].
//! Identity content is opaque markdown consumed by
//! [`crate::agent_registry::AgentRegistry::spawn_from_template`].

use crate::ipc::templates::Template;

/// One identity-template entry. `content` is the full YAML-frontmatter
/// markdown — everything `spawn_from_template` needs.
#[derive(Debug, Clone, Copy)]
pub struct IdentityTemplate {
    pub slug: &'static str,
    pub content: &'static str,
}

// ---------------------------------------------------------------------------
// Identity templates
// ---------------------------------------------------------------------------

const LEADER_MD: &str = include_str!("../../../../agents/leader/agent.md");
const RESEARCHER_MD: &str = include_str!("../../../../agents/researcher/agent.md");
const REVIEWER_MD: &str = include_str!("../../../../agents/reviewer/agent.md");

const IDENTITY_TEMPLATES: &[IdentityTemplate] = &[
    IdentityTemplate {
        slug: "leader",
        content: LEADER_MD,
    },
    IdentityTemplate {
        slug: "researcher",
        content: RESEARCHER_MD,
    },
    IdentityTemplate {
        slug: "reviewer",
        content: REVIEWER_MD,
    },
];

/// All shipped identity templates, in catalog order.
pub fn identity_templates() -> &'static [IdentityTemplate] {
    IDENTITY_TEMPLATES
}

/// Look up the raw identity markdown by slug.
pub fn identity_template_content(slug: &str) -> Option<&'static str> {
    IDENTITY_TEMPLATES
        .iter()
        .find(|t| t.slug == slug)
        .map(|t| t.content)
}

// ---------------------------------------------------------------------------
// Company templates
// ---------------------------------------------------------------------------

const SOLO_FOUNDER_JSON: &str = include_str!("../../../../presets/templates/solo-founder.json");
const STUDIO_JSON: &str = include_str!("../../../../presets/templates/studio.json");
const SMALL_BUSINESS_JSON: &str = include_str!("../../../../presets/templates/small-business.json");

const COMPANY_TEMPLATE_JSON: &[&str] = &[SOLO_FOUNDER_JSON, STUDIO_JSON, SMALL_BUSINESS_JSON];

/// All shipped company templates, sorted by slug so the catalog is stable.
/// Parses the embedded JSON on every call — cheap (three small docs) and
/// avoids carrying a `once_cell` dependency just for this.
pub fn company_templates() -> Vec<Template> {
    // A malformed shipped JSON should fail loudly at boot rather than
    // silently drop out of the picker — `expect` makes that explicit.
    let mut out: Vec<Template> = COMPANY_TEMPLATE_JSON
        .iter()
        .map(|raw| {
            serde_json::from_str::<Template>(raw).expect("shipped company template failed to parse")
        })
        .collect();
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// Company template lookup by slug.
pub fn company_template(slug: &str) -> Option<Template> {
    company_templates().into_iter().find(|t| t.slug == slug)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_catalog_has_three_canonical_slugs() {
        let slugs: Vec<&str> = identity_templates().iter().map(|t| t.slug).collect();
        assert_eq!(slugs, vec!["leader", "researcher", "reviewer"]);
    }

    #[test]
    fn identity_content_parses_as_frontmatter() {
        for t in identity_templates() {
            assert!(
                t.content.starts_with("---"),
                "identity '{}' missing frontmatter",
                t.slug,
            );
        }
    }

    #[test]
    fn company_catalog_has_three_canonical_slugs() {
        let slugs: Vec<String> = company_templates().into_iter().map(|t| t.slug).collect();
        for expected in ["small-business", "solo-founder", "studio"] {
            assert!(
                slugs.iter().any(|s| s == expected),
                "canonical company template '{expected}' missing; got {slugs:?}",
            );
        }
    }

    #[test]
    fn company_template_lookup_returns_full_spec() {
        let studio = company_template("studio").expect("studio template present");
        assert_eq!(studio.name, "Content Studio");
        assert_eq!(studio.seed_agents.len(), 2);
    }
}
