//! Edge relation constants + validator.
//!
//! T1.8 collapsed the substrate connection vocabulary to three primitives
//! plus two system-emitted relations. The `entity_edges.relation` column is
//! still TEXT — the valid-relation check happens in code, not in a database
//! constraint, so new relations can be introduced without a migration.
//!
//! ## Substrate vocabulary (user-facing)
//!
//! - `mention` — body parser extracts `[[X]]` from content. Lightweight
//!   reference; surrounding prose carries semantic meaning.
//! - `embed` — body parser extracts `![[X]]` from content. Transclusion-class
//!   reference; rendering pulls X's content into here.
//! - `link` — direct API write OR explicit "+ Link" UI button. Bare metadata
//!   connection with no body involvement.
//!
//! That's it. Meaning lives in tags + content + surrounding prose, not in
//! typed edges nothing programmatically consumes.
//!
//! ## System-emitted (internal, not user-facing)
//!
//! - `co_retrieved` — usage-derived edge between ideas that travel together
//!   in result sets. Decays without reinforcement.
//! - `contradiction` — self-loop marker emitted by the `wrong` feedback
//!   signal. Durable; never decays.

/// Body-parsed mention edge: `[[X]]` in content.
pub const MENTION: &str = "mention";
/// Body-parsed embed edge: `![[X]]` in content.
pub const EMBED: &str = "embed";
/// Direct API / "+ Link" UI button edge.
pub const LINK: &str = "link";

/// Usage-emergent retrieval co-occurrence edge.
pub const CO_RETRIEVED: &str = "co_retrieved";
/// Self-loop marker for the `wrong` feedback signal.
pub const CONTRADICTION: &str = "contradiction";

pub const KNOWN_RELATIONS: &[&str] = &[MENTION, EMBED, LINK, CO_RETRIEVED, CONTRADICTION];

/// Returns true if `relation` is a documented relation kind. Callers that
/// accept user-supplied relation strings should validate before storing.
pub fn is_known(relation: &str) -> bool {
    KNOWN_RELATIONS.contains(&relation)
}

/// Substrate-level relations writable from outside the runtime: body
/// parsing (`mention`, `embed`) and direct API/UI writes (`link`). Rejects
/// the legacy typed vocabulary plus the system-emitted relations
/// (`co_retrieved`, `contradiction`) so they cannot be set through the IPC
/// `links` field.
pub fn is_substrate_writable(relation: &str) -> bool {
    matches!(relation, MENTION | EMBED | LINK)
}

/// Usage-emergent relations — decay over time.
pub fn is_usage_emergent(relation: &str) -> bool {
    matches!(relation, CO_RETRIEVED)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_relations_has_five() {
        assert_eq!(KNOWN_RELATIONS.len(), 5);
    }

    #[test]
    fn is_known_accepts_every_documented_relation() {
        for rel in KNOWN_RELATIONS {
            assert!(is_known(rel), "{rel} must be known");
        }
    }

    #[test]
    fn is_known_rejects_legacy_typed_vocabulary() {
        for legacy in &[
            "mentions",
            "embeds",
            "adjacent",
            "supersedes",
            "supports",
            "contradicts",
            "distilled_into",
            "caused_by",
        ] {
            assert!(
                !is_known(legacy),
                "{legacy} must NOT be known after T1.8 collapse"
            );
        }
    }

    #[test]
    fn is_known_rejects_bogus() {
        assert!(!is_known("bogus"));
        assert!(!is_known(""));
        assert!(!is_known("Mention")); // case-sensitive
    }

    #[test]
    fn substrate_writable_covers_three_primitives() {
        assert!(is_substrate_writable(MENTION));
        assert!(is_substrate_writable(EMBED));
        assert!(is_substrate_writable(LINK));
        assert!(!is_substrate_writable(CO_RETRIEVED));
        assert!(!is_substrate_writable(CONTRADICTION));
    }

    #[test]
    fn usage_emergent_covers_co_retrieved() {
        assert!(is_usage_emergent(CO_RETRIEVED));
        assert!(!is_usage_emergent(MENTION));
        assert!(!is_usage_emergent(LINK));
    }
}
