//! Compile-time-embedded company templates.
//!
//! A template is a pre-threaded starter kit: one root agent plus seed agents,
//! events, ideas, and quests. Shipped catalog lives under
//! `presets/templates/*.json` and is `include_str!`'d so the runtime is
//! self-contained regardless of where it launches from.
//!
//! `Template` (the deserialized shape) lives in [`crate::ipc::templates`].

use crate::ipc::templates::Template;

/// Slug of the canonical fallback default Blueprint shipped with the
/// runtime. Operators can override which Blueprint is the catalog
/// default via `[blueprints] default = "<slug>"` in `aeqi.toml`; this
/// constant is the safety net when that config is missing or points at
/// a slug that no longer exists in the catalog.
pub const DEFAULT_BLUEPRINT_SLUG: &str = "aeqi";

const AEQI_DEFAULT_JSON: &str = include_str!("../../../../presets/templates/aeqi.json");
const BLANK_JSON: &str = include_str!("../../../../presets/templates/blank.json");
const SOLO_FOUNDER_JSON: &str = include_str!("../../../../presets/templates/solo-founder.json");
const STUDIO_JSON: &str = include_str!("../../../../presets/templates/studio.json");
const SMALL_BUSINESS_JSON: &str = include_str!("../../../../presets/templates/small-business.json");
const INDIE_CONSULTANCY_JSON: &str =
    include_str!("../../../../presets/templates/indie-consultancy.json");
const TECH_STUDIO_JSON: &str = include_str!("../../../../presets/templates/tech-studio.json");
const SOLO_CREATOR_JSON: &str = include_str!("../../../../presets/templates/solo-creator.json");
const AGENCY_JSON: &str = include_str!("../../../../presets/templates/agency.json");
const PERSONAL_OS_JSON: &str = include_str!("../../../../presets/templates/personal-os.json");
const COMMUNITY_JSON: &str = include_str!("../../../../presets/templates/community.json");

const COMPANY_TEMPLATE_JSON: &[&str] = &[
    AEQI_DEFAULT_JSON,
    BLANK_JSON,
    SOLO_FOUNDER_JSON,
    STUDIO_JSON,
    SMALL_BUSINESS_JSON,
    INDIE_CONSULTANCY_JSON,
    TECH_STUDIO_JSON,
    SOLO_CREATOR_JSON,
    AGENCY_JSON,
    PERSONAL_OS_JSON,
    COMMUNITY_JSON,
];

/// All shipped company templates, sorted by slug so the catalog is stable.
/// Parses the embedded JSON on every call — cheap (a handful of small docs)
/// and avoids carrying a `once_cell` dependency just for this.
pub fn company_templates() -> Vec<Template> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn company_catalog_has_canonical_slugs() {
        let slugs: Vec<String> = company_templates().into_iter().map(|t| t.slug).collect();
        for expected in [
            DEFAULT_BLUEPRINT_SLUG,
            "small-business",
            "solo-founder",
            "studio",
        ] {
            assert!(
                slugs.iter().any(|s| s == expected),
                "canonical company template '{expected}' missing; got {slugs:?}",
            );
        }
    }

    #[test]
    fn default_blueprint_resolves() {
        assert!(
            company_template(DEFAULT_BLUEPRINT_SLUG).is_some(),
            "DEFAULT_BLUEPRINT_SLUG '{DEFAULT_BLUEPRINT_SLUG}' must point at a shipped template",
        );
    }

    #[test]
    fn company_template_lookup_returns_full_spec() {
        let studio = company_template("studio").expect("studio template present");
        assert_eq!(studio.name, "Content Studio");
        assert_eq!(studio.seed_agents.len(), 2);
    }
}
