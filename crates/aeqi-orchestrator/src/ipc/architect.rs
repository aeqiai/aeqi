//! Architect IPC handlers.
//!
//! Wraps the `aeqi-architect` crate's pure-Rust generator behind three IPC
//! verbs:
//!
//! - `architect.draft` — turn a free-text brief into a generated blueprint
//! - `architect.refine` — apply an instruction to an existing draft (Phase 1
//!   stub: returns input unchanged)
//! - `architect.deploy` — provision a Company from a generated blueprint by
//!   piping it through the existing `spawn_blueprint` provisioner
//!
//! Phase 1 is request/response; there is no LLM streaming, no draft
//! persistence, and no refinement diff. Phase 2 wires inference into
//! `architect.draft` and adds an `architect_drafts` table; Phase 3 ships a
//! stream-of-thought UI.
//!
//! All draft IDs in Phase 1 are minted ad-hoc and are NOT stored — clients
//! must round-trip the full `draft` JSON object on `architect.refine` /
//! `architect.deploy`. This keeps the orchestrator stateless during the
//! scaffolding phase.

use aeqi_architect::{ArchitectError, Brief, GeneratedBlueprint, generate, refine};
use serde_json::{Value, json};

use crate::ipc::blueprints::{Blueprint, BlueprintPart, spawn_blueprint};

/// Maximum allowed brief length, hard-enforced at the IPC boundary so the
/// orchestrator doesn't allocate a multi-megabyte blob per request.
/// Mirrors `aeqi_architect::generator::HARD_CHAR_CAP` so the two
/// boundaries agree.
const MAX_BRIEF_CHARS: usize = 8_000;

/// `architect.draft` — generate a blueprint from a free-text brief.
///
/// Request shape:
/// ```json
/// { "brief": "I want to build a foundation focused on open-source AI",
///   "target_kind": "single" }
/// ```
///
/// Response shape on success:
/// ```json
/// { "ok": true, "draft_id": "<uuid>", "draft": <GeneratedBlueprint> }
/// ```
pub async fn handle_architect_draft(
    _ctx: &super::CommandContext,
    request: &Value,
    _allowed: &Option<Vec<String>>,
) -> Value {
    let brief_text = match request.get("brief").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.to_string(),
        _ => {
            return json!({"ok": false, "error": "brief is required", "code": "invalid_request"});
        }
    };

    if brief_text.len() > MAX_BRIEF_CHARS {
        return json!({
            "ok": false,
            "error": format!("brief exceeds {MAX_BRIEF_CHARS}-char cap"),
            "code": "too_long",
        });
    }

    let target_kind: Option<aeqi_architect::types::TargetKind> = request
        .get("target_kind")
        .cloned()
        .and_then(|v| serde_json::from_value(v).ok());

    let brief = Brief {
        text: brief_text,
        target_kind,
        notes: None,
    };

    match generate(&brief) {
        Ok(draft) => {
            let draft_id = synthetic_draft_id(&draft);
            json!({
                "ok": true,
                "draft_id": draft_id,
                "draft": draft,
            })
        }
        Err(err) => architect_error_response(err),
    }
}

/// `architect.refine` — apply an instruction to a draft.
///
/// Phase 1 stub: returns the input draft unchanged so the round trip is
/// honored. Phase 2 will diff the instruction against the draft and emit
/// a revised blueprint via inference.
///
/// Request shape:
/// ```json
/// { "draft_id": "<id>", "draft": <GeneratedBlueprint>, "instruction": "..." }
/// ```
pub async fn handle_architect_refine(
    _ctx: &super::CommandContext,
    request: &Value,
    _allowed: &Option<Vec<String>>,
) -> Value {
    let Some(draft_value) = request.get("draft").cloned() else {
        return json!({"ok": false, "error": "draft is required", "code": "invalid_request"});
    };
    let draft: GeneratedBlueprint = match serde_json::from_value(draft_value) {
        Ok(d) => d,
        Err(err) => {
            return json!({
                "ok": false,
                "error": format!("draft is malformed: {err}"),
                "code": "invalid_request",
            });
        }
    };
    let instruction = request
        .get("instruction")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    match refine(draft, &instruction) {
        Ok(refined) => {
            let draft_id = synthetic_draft_id(&refined);
            json!({"ok": true, "draft_id": draft_id, "draft": refined})
        }
        Err(err) => architect_error_response(err),
    }
}

/// `architect.deploy` — provision a Company from a generated blueprint.
///
/// Phase 1: takes the inline blueprint from the draft, deserializes it
/// into the canonical `Blueprint` shape, and routes through the existing
/// `spawn_blueprint` provisioner — same code path the catalog uses. No
/// new on-chain logic, no draft persistence.
///
/// Request shape:
/// ```json
/// { "draft": <GeneratedBlueprint>,
///   "display_name": "My foundation"  // optional
/// }
/// ```
pub async fn handle_architect_deploy(
    ctx: &super::CommandContext,
    request: &Value,
    _allowed: &Option<Vec<String>>,
) -> Value {
    let Some(draft_value) = request.get("draft").cloned() else {
        return json!({"ok": false, "error": "draft is required", "code": "invalid_request"});
    };
    let draft: GeneratedBlueprint = match serde_json::from_value(draft_value) {
        Ok(d) => d,
        Err(err) => {
            return json!({
                "ok": false,
                "error": format!("draft is malformed: {err}"),
                "code": "invalid_request",
            });
        }
    };

    // The architect emits the canonical Blueprint shape inline as JSON.
    // Round-trip it through the orchestrator's deserializer so we get the
    // full validation surface the catalog path enjoys (required fields,
    // role-type parsing, etc.).
    let blueprint: Blueprint = match serde_json::from_value(draft.blueprint.clone()) {
        Ok(b) => b,
        Err(err) => {
            return json!({
                "ok": false,
                "error": format!("generated blueprint is not a valid Blueprint: {err}"),
                "code": "invalid_blueprint",
            });
        }
    };

    let display_name = super::request_field(request, "display_name").map(str::to_string);
    let entity_id_override = super::request_field(request, "entity_id").map(str::to_string);
    let creator_user_id = super::request_field(request, "creator_user_id").map(str::to_string);

    let Some(ref event_store) = ctx.event_handler_store else {
        return json!({"ok": false, "error": "event handler store not available"});
    };

    let role_overrides = Vec::new();

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
            // Mirror the catalog deploy path: ensure a founding Director
            // role for the creator when the IPC carried a user id.
            if let Some(ref uid) = creator_user_id
                && let Err(e) = ctx
                    .role_registry
                    .ensure_founding_director(&outcome.entity_id, uid)
                    .await
            {
                tracing::error!(
                    error = %e,
                    entity_id = %outcome.entity_id,
                    user_id = %uid,
                    "architect.deploy: failed to auto-create founding Director role",
                );
            }
            json!({
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
                "generator": draft.generator,
            })
        }
        Err(err) => json!({"ok": false, "error": err.to_string()}),
    }
}

/// Build a stable-ish synthetic draft id from the blueprint's slug and a
/// hash of its rationale. Phase 1 doesn't persist drafts, so this id is
/// purely a UI handle — clients must round-trip the full draft on each
/// follow-up call.
fn synthetic_draft_id(draft: &GeneratedBlueprint) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    draft.rationale.hash(&mut hasher);
    draft.blueprint.to_string().hash(&mut hasher);
    let slug = draft.blueprint["slug"].as_str().unwrap_or("draft");
    format!("draft-{slug}-{:016x}", hasher.finish())
}

fn architect_error_response(err: ArchitectError) -> Value {
    let code = match err {
        ArchitectError::EmptyBrief => "invalid_request",
        ArchitectError::BriefTooLong(_) => "too_long",
    };
    json!({"ok": false, "error": err.to_string(), "code": code})
}

#[cfg(test)]
mod tests {
    //! Unit tests that exercise the IPC layer without spinning up a full
    //! `CommandContext`. Each test builds the request value, calls
    //! `generate`/`refine` directly, and asserts the wire-shaped response
    //! body. The deploy handler is exercised via integration tests through
    //! the existing `aeqi-test-support` `TestHarness` (Phase 2 fixture work
    //! lives there).

    use super::*;
    use aeqi_architect::{Brief, generate};

    #[test]
    fn architect_draft_emits_foundation_template() {
        // This mirrors what `handle_architect_draft` does internally,
        // sans the CommandContext (which only matters for `deploy`).
        let brief = Brief {
            text: "I want a foundation".to_string(),
            target_kind: None,
            notes: None,
        };
        let draft = generate(&brief).expect("generate succeeds");
        assert_eq!(draft.kind, "single");
        assert_eq!(draft.blueprint["slug"], "architect-foundation");
        assert_eq!(draft.blueprint["template"], "foundation");
        // Round-trip through the synthetic draft id helper.
        let id = synthetic_draft_id(&draft);
        assert!(id.starts_with("draft-architect-foundation-"));
    }

    #[test]
    fn architect_error_response_maps_codes() {
        let v = architect_error_response(ArchitectError::EmptyBrief);
        assert_eq!(v["ok"], false);
        assert_eq!(v["code"], "invalid_request");
        let v = architect_error_response(ArchitectError::BriefTooLong(9000));
        assert_eq!(v["code"], "too_long");
    }

    #[test]
    fn synthetic_draft_id_is_stable_for_same_input() {
        let a = generate(&Brief {
            text: "stable test".to_string(),
            target_kind: None,
            notes: None,
        })
        .unwrap();
        let b = generate(&Brief {
            text: "stable test".to_string(),
            target_kind: None,
            notes: None,
        })
        .unwrap();
        assert_eq!(synthetic_draft_id(&a), synthetic_draft_id(&b));
    }
}
