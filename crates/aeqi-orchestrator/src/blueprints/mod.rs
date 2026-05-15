//! Compile-time-embedded company templates.
//!
//! A template is a pre-threaded starter kit: one root agent plus seed agents,
//! events, ideas, and quests. Shipped catalog lives under
//! `presets/blueprints/*.json` and is `include_str!`'d so the runtime is
//! self-contained regardless of where it launches from.
//!
//! `Template` (the deserialized shape) lives in [`crate::ipc::blueprints`].

use crate::ipc::blueprints::Blueprint;

/// Slug of the canonical fallback default Blueprint shipped with the
/// runtime. Operators can override which Blueprint is the catalog
/// default via `[blueprints] default = "<slug>"` in `aeqi.toml`; this
/// constant is the safety net when that config is missing or points at
/// a slug that no longer exists in the catalog.
pub const DEFAULT_BLUEPRINT_SLUG: &str = "aeqi";

const AEQI_DEFAULT_JSON: &str = include_str!("../../../../presets/blueprints/aeqi.json");
// Keep the shipped catalog intentionally narrow. The repository still carries
// draft manifests for future archetypes, but only the conservative default is
// embedded into the public runtime catalog until the others have a fresh
// product and protocol audit.
const COMPANY_BLUEPRINT_JSON: &[&str] = &[AEQI_DEFAULT_JSON];

/// All shipped company templates, sorted by slug so the catalog is stable.
/// Parses the embedded JSON on every call — cheap (a handful of small docs)
/// and avoids carrying a `once_cell` dependency just for this.
pub fn company_blueprints() -> Vec<Blueprint> {
    let mut out: Vec<Blueprint> = COMPANY_BLUEPRINT_JSON
        .iter()
        .map(|raw| {
            serde_json::from_str::<Blueprint>(raw)
                .expect("shipped company template failed to parse")
        })
        .collect();
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// Company template lookup by slug.
pub fn company_blueprint(slug: &str) -> Option<Blueprint> {
    company_blueprints().into_iter().find(|t| t.slug == slug)
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
        assert_eq!(default.name, "aeqi");
        assert_eq!(default.seed_agents.len(), 0);
        assert_eq!(default.seed_quests.len(), 8);
    }

    #[test]
    fn default_blueprint_has_category_and_template() {
        let bp = company_blueprint(DEFAULT_BLUEPRINT_SLUG).expect("default template present");
        assert_eq!(bp.category, "company");
        assert_eq!(bp.template, "venture");
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
}
