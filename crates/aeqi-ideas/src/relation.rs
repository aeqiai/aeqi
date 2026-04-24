//! Edge relation constants + validator. Replaces the legacy 3-variant
//! `IdeaRelation` enum. The `idea_edges.relation` column is TEXT — the
//! valid-relation check happens in code, not in a database constraint,
//! so new relations can be introduced without a migration.

/// Body-parsed relations (inline wikilinks + typed prefixes).
pub const MENTIONS: &str = "mentions";
pub const EMBEDS: &str = "embeds";
pub const SUPERSEDES: &str = "supersedes";
pub const SUPPORTS: &str = "supports";
pub const CONTRADICTS: &str = "contradicts";
pub const DISTILLED_INTO: &str = "distilled_into";

/// Explicit MCP `ideas(action='link')` + UI-wired relations.
pub const ADJACENT: &str = "adjacent";
pub const CAUSED_BY: &str = "caused_by";

/// Emergent / usage-driven relations.
pub const CO_RETRIEVED: &str = "co_retrieved";
pub const CONTRADICTION: &str = "contradiction";

pub const KNOWN_RELATIONS: &[&str] = &[
    MENTIONS,
    EMBEDS,
    SUPERSEDES,
    SUPPORTS,
    CONTRADICTS,
    DISTILLED_INTO,
    ADJACENT,
    CAUSED_BY,
    CO_RETRIEVED,
    CONTRADICTION,
];

/// Returns true if `relation` is a documented relation kind. Callers that
/// accept user-supplied relation strings should validate before storing.
pub fn is_known(relation: &str) -> bool {
    KNOWN_RELATIONS.contains(&relation)
}

/// Authoritative relations — never decay, never auto-removed.
pub fn is_authoritative(relation: &str) -> bool {
    matches!(relation, SUPERSEDES | DISTILLED_INTO | CAUSED_BY)
}

/// Usage-emergent relations — decay over time.
pub fn is_usage_emergent(relation: &str) -> bool {
    matches!(relation, CO_RETRIEVED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_relations_has_ten() {
        assert_eq!(KNOWN_RELATIONS.len(), 10);
    }

    #[test]
    fn is_known_accepts_every_documented_relation() {
        for rel in KNOWN_RELATIONS {
            assert!(is_known(rel), "{rel} must be known");
        }
    }

    #[test]
    fn is_known_rejects_bogus() {
        assert!(!is_known("bogus"));
        assert!(!is_known(""));
        assert!(!is_known("Mentions")); // case-sensitive
    }

    #[test]
    fn authoritative_and_usage_emergent_do_not_overlap() {
        for rel in KNOWN_RELATIONS {
            assert!(
                !(is_authoritative(rel) && is_usage_emergent(rel)),
                "{rel} flagged both authoritative and usage-emergent"
            );
        }
    }

    #[test]
    fn authoritative_covers_supersedes_distilled_caused_by() {
        assert!(is_authoritative(SUPERSEDES));
        assert!(is_authoritative(DISTILLED_INTO));
        assert!(is_authoritative(CAUSED_BY));
        assert!(!is_authoritative(MENTIONS));
        assert!(!is_authoritative(CO_RETRIEVED));
    }

    #[test]
    fn usage_emergent_covers_co_retrieved() {
        assert!(is_usage_emergent(CO_RETRIEVED));
        assert!(!is_usage_emergent(MENTIONS));
        assert!(!is_usage_emergent(SUPERSEDES));
    }
}
