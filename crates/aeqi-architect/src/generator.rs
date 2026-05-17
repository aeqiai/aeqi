//! Stub Blueprint generator.
//!
//! Takes a [`Brief`] and returns a [`GeneratedBlueprint`] by interpolating
//! the brief into a hard-coded foundation-shaped template. No LLM calls —
//! the function is fully deterministic, network-free, and runs in
//! microseconds.
//!
//! In Phase 2 the stub is the fallback path: when the LLM call (see
//! [`crate::llm`]) fails or its output can't be parsed into a valid
//! Blueprint, the IPC layer calls [`generate`] so the user always gets
//! a draft.

use serde_json::json;
use thiserror::Error;
use tracing::debug;

use crate::types::{Brief, GeneratedBlueprint, GeneratorProvenance};

/// Errors the generator can return.
#[derive(Debug, Error)]
pub enum ArchitectError {
    /// The brief was empty or whitespace-only after trimming.
    #[error("brief text is empty")]
    EmptyBrief,
    /// The brief exceeded the hard 8 KB cap.
    #[error("brief text exceeds 8000-char cap (got {0})")]
    BriefTooLong(usize),
    /// The LLM call failed (network, timeout, rate limit) or its output
    /// was not parseable into a valid Blueprint. The IPC layer should
    /// fall back to the stub so the user always sees a draft.
    #[error("LLM generation failed: {0}")]
    LlmFailure(String),
}

/// Slug emitted by the Phase-1 stub. Stable so the IPC test can pin it.
pub const STUB_SLUG: &str = "architect-foundation";

/// The on-chain template the stub picks. `entity` is the smallest
/// fully-wired template on the live anvil deploy (role + budget +
/// token + vesting + funding). Foundation looks like a softer fit
/// (no token model implied) but its 5th module slot
/// `keccak256("foundation")` has no Beacon implementation registered
/// — every TRUST minted under it reverts at module-init with
/// `BeaconProxy_ImplementationNotFound()`. Stays on `entity` until
/// the chain-side `_registerFoundation` shrink lands. Mirror of the
/// allow-list rationale documented on `llm::VALID_TEMPLATES`.
pub const STUB_TEMPLATE: &str = "trust";

/// Hard cap on brief length. Beyond this we refuse the request — the
/// orchestrator IPC layer should already reject before hitting us, but
/// duplicating the check here keeps the crate self-contained.
pub const HARD_CHAR_CAP: usize = 8_000;

/// Generate a blueprint from a brief.
///
/// Phase 1: returns a hard-coded entity-template blueprint populated
/// with the brief text in the root agent's identity idea, the
/// description field, and a kickoff quest. Always emits
/// `template = "trust"` — see [`STUB_TEMPLATE`] for why we don't
/// pick `foundation`.
pub fn generate(brief: &Brief) -> Result<GeneratedBlueprint, ArchitectError> {
    let trimmed = brief.text.trim();
    if trimmed.is_empty() {
        return Err(ArchitectError::EmptyBrief);
    }
    if trimmed.len() > HARD_CHAR_CAP {
        return Err(ArchitectError::BriefTooLong(trimmed.len()));
    }

    debug!(
        brief_len = trimmed.len(),
        "architect.stub: generating blueprint"
    );

    let blueprint = build_foundation_blueprint(trimmed);
    let rationale = "Stub generator. Picked the `entity` on-chain template — the smallest \
         fully-wired template (role + budget + token + vesting + funding), no \
         derivatives surface. The brief is interpolated into the root agent's \
         identity idea and a kickoff quest so the operator's first session has \
         the founder's stated intent ready in context. Used as a fallback when \
         the LLM path is unavailable; the LLM path picks template/agents/roles \
         from the brief itself."
        .to_string();

    Ok(GeneratedBlueprint {
        kind: "single".to_string(),
        rationale,
        blueprint,
        generator: GeneratorProvenance::stub_v1(),
    })
}

/// Phase-1 stub for the refinement loop. Returns the input draft unchanged
/// so the IPC contract is honored end-to-end. Phase 2 will diff against
/// the instruction and re-emit a revised blueprint via the LLM.
pub fn refine(
    draft: GeneratedBlueprint,
    _instruction: &str,
) -> Result<GeneratedBlueprint, ArchitectError> {
    debug!("architect.stub: refine returns input unchanged (Phase 1)");
    Ok(draft)
}

/// The on-chain template the stub falls back to when the LLM didn't
/// emit a usable `template` field. See [`STUB_TEMPLATE`] for the
/// chain-side rationale (`foundation` is broken; `entity` is the
/// smallest viable wired template).
pub fn choose_template_default() -> &'static str {
    STUB_TEMPLATE
}

/// Build a stub-shaped Blueprint JSON value with the brief interpolated.
/// Exposed so [`crate::llm`] can fall back to it when the model returns
/// non-object JSON.
pub fn build_minimal_foundation_blueprint(brief: &str) -> serde_json::Value {
    build_foundation_blueprint(brief)
}

fn build_foundation_blueprint(brief: &str) -> serde_json::Value {
    let truncated = truncate_for_description(brief, 200);
    let slug = STUB_SLUG;

    json!({
        "slug": slug,
        "name": "Founder's Foundation",
        "tagline": "Drafted from your brief.",
        "description": format!(
            "Architect-drafted foundation from brief: {truncated}"
        ),
        "category": "company",
        "template": STUB_TEMPLATE,
        "root": {
            "name": "founder",
            "model": "deepseek/deepseek-v4-pro",
            "color": "#0a0a0b",
            "system_prompt": format!(
                "You are the founder's primary agent inside a freshly drafted Foundation \
                 Company. The founder's brief, verbatim:\n\n{brief}\n\n\
                 Anchor every decision against this brief. Propose two or three concrete \
                 first quests when the operator surfaces intent. Default to action over \
                 asking permission for the obvious.",
            ),
            "proactive_greeting": "Hi — your Architect drafted this Foundation from your brief. Open the kickoff quest to see the first three moves I'd take, or tell me what's actually on your mind and I'll re-cut it."
        },
        "seed_agents": [],
        "seed_events": [
            {
                "owner": "root",
                "name": "session_bootstrap",
                "pattern": "session:start",
                "cooldown_secs": 0,
                "query_template": "founder priorities and recent decisions",
                "query_top_k": 6,
                "query_tag_filter": ["identity", "priorities", "evergreen"],
                "tool_calls": []
            }
        ],
        "seed_ideas": [
            {
                "owner": "root",
                "name": "Founder brief",
                "content": brief,
                "tags": ["identity", "priorities", "evergreen"]
            }
        ],
        "seed_quests": [
            {
                "owner": "root",
                "subject": "Kickoff: read the brief, propose three first moves",
                "description": format!(
                    "The founder said:\n\n{brief}\n\nWrite down the three highest-leverage \
                     first moves. Capture each as a follow-up quest with a clear acceptance \
                     criterion."
                ),
                "labels": ["kickoff"]
            }
        ],
        "seed_roles": [
            {
                "key": "founder",
                "title": "Founder",
                "default_occupant_agent": "root",
                "role_type": "director"
            }
        ],
        "seed_role_edges": []
    })
}

fn truncate_for_description(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brief(text: &str) -> Brief {
        Brief {
            text: text.to_string(),
            target_kind: None,
            notes: None,
        }
    }

    #[test]
    fn empty_brief_rejected() {
        let err = generate(&brief("")).unwrap_err();
        assert!(matches!(err, ArchitectError::EmptyBrief));
    }

    #[test]
    fn whitespace_brief_rejected() {
        let err = generate(&brief("   \n\t  ")).unwrap_err();
        assert!(matches!(err, ArchitectError::EmptyBrief));
    }

    #[test]
    fn oversized_brief_rejected() {
        let big = "x".repeat(HARD_CHAR_CAP + 1);
        let err = generate(&brief(&big)).unwrap_err();
        assert!(matches!(err, ArchitectError::BriefTooLong(_)));
    }

    #[test]
    fn stub_emits_canonical_template() {
        let out = generate(&brief(
            "I want to build a foundation focused on open-source AI",
        ))
        .expect("generate succeeds");
        assert_eq!(out.kind, "single");
        assert_eq!(out.generator.kind, "stub");
        let bp = &out.blueprint;
        assert_eq!(bp["slug"], STUB_SLUG);
        assert_eq!(bp["template"], STUB_TEMPLATE);
        assert_eq!(bp["category"], "company");
        // Brief is interpolated into the root agent's identity idea.
        let ideas = bp["seed_ideas"].as_array().expect("seed_ideas present");
        assert_eq!(ideas.len(), 1);
        assert!(
            ideas[0]["content"]
                .as_str()
                .unwrap()
                .contains("open-source AI"),
            "brief text must round-trip through the seed idea"
        );
    }

    #[test]
    fn stub_round_trips_through_serde_json() {
        let out = generate(&brief("test brief")).unwrap();
        let s = serde_json::to_string(&out).unwrap();
        let back: GeneratedBlueprint = serde_json::from_str(&s).unwrap();
        assert_eq!(back.kind, out.kind);
        assert_eq!(back.blueprint["slug"], STUB_SLUG);
    }

    #[test]
    fn refine_returns_input_unchanged_in_phase_1() {
        let draft = generate(&brief("a brief")).unwrap();
        let original_slug = draft.blueprint["slug"].clone();
        let refined = refine(draft, "make it bigger").unwrap();
        assert_eq!(refined.blueprint["slug"], original_slug);
    }
}
