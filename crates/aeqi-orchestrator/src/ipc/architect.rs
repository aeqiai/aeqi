//! Architect IPC handlers.
//!
//! Wraps the `aeqi-architect` crate's generator behind three IPC verbs:
//!
//! - `architect.draft` — turn a free-text brief into a generated blueprint.
//!   Phase 2: real LLM call via `aeqi_architect::generate_via_llm`,
//!   falling back to the stub when no API key is set or the LLM call
//!   fails. Provenance is recorded on the draft so the UI can show
//!   "drafted by LLM" vs "drafted by stub fallback".
//! - `architect.refine` — Wave 35 Phase 3. Multi-turn LLM refinement: the
//!   UI ferries the full conversation history (every prior brief +
//!   draft pair) and the new instruction; the orchestrator threads them
//!   into a chat completion via `aeqi_architect::refine_via_llm` and
//!   returns the next draft. Stateless — no DB, no in-memory cache.
//! - `architect.deploy` — provision a Company from a generated blueprint by
//!   piping it through the existing `spawn_blueprint` provisioner.
//!
//! Phase 3 is still request/response (no streaming). Phase 4 ships
//! streaming + `architect_drafts` persistence.
//!
//! All draft IDs are minted ad-hoc and are NOT stored — clients must
//! round-trip the full `draft` JSON object on `architect.refine` /
//! `architect.deploy`. The refinement loop ferries the whole prior turn
//! list to keep the orchestrator stateless across calls.

use std::time::Instant;

use aeqi_architect::{
    ArchitectError, Brief, GeneratedBlueprint, build_default_llm, generate, generate_via_llm,
    refine, refine_via_llm,
};
use serde_json::{Value, json};
use tracing::{info, warn};

/// Resolve the architect's LLM credential. Checks the process env vars
/// first (DEEPINFRA_API_KEY, OPENROUTER_API_KEY); when both are absent
/// (the host runtime case — only `aeqi-platform.service` loads
/// `/etc/aeqi/secrets.env`, the per-tenant host services don't), falls
/// back to the credentials substrate at `~/.aeqi/aeqi.db` where the
/// orchestrator's own startup migration parks the same OPENROUTER key.
/// This sets the env var in-process so [`build_default_llm`] sees it.
///
/// Idempotent — once the env var is populated, subsequent calls no-op.
fn ensure_llm_env_resolved() {
    let have_env = std::env::var("DEEPINFRA_API_KEY")
        .ok()
        .filter(|v| !v.is_empty())
        .is_some()
        || std::env::var("OPENROUTER_API_KEY")
            .ok()
            .filter(|v| !v.is_empty())
            .is_some();
    if have_env {
        return;
    }

    // Resolve the runtime's data dir. Mirrors `aeqi-core` config-default.
    let data_dir = match std::env::var("HOME") {
        Ok(home) => std::path::PathBuf::from(home).join(".aeqi"),
        Err(_) => return,
    };

    if let Ok(Some(key)) =
        aeqi_core::credentials::read_global_legacy_blob_sync(&data_dir, "OPENROUTER_API_KEY")
        && !key.is_empty()
    {
        // SAFETY: single-process IPC handler boot path; no concurrent env reads
        // are racing this write. The flag is set once and remains set for the
        // lifetime of the runtime process.
        unsafe { std::env::set_var("OPENROUTER_API_KEY", &key) };
        info!("architect.draft: resolved OPENROUTER_API_KEY from credentials substrate");
    }
}

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

    ensure_llm_env_resolved();

    let started = Instant::now();
    let draft = match build_default_llm() {
        Some((llm, opts)) => match generate_via_llm(&brief, llm.as_ref(), &opts).await {
            Ok(d) => {
                info!(
                    latency_ms = started.elapsed().as_millis() as u64,
                    "architect.draft: LLM path succeeded"
                );
                d
            }
            Err(err) if matches!(err, ArchitectError::LlmFailure(_)) => {
                warn!(error = %err, "architect.draft: LLM path failed; falling back to stub");
                match generate(&brief) {
                    Ok(d) => d,
                    Err(stub_err) => return architect_error_response(stub_err),
                }
            }
            Err(err) => {
                // EmptyBrief / BriefTooLong should already be caught
                // above, but bubble them up cleanly if they slip through.
                return architect_error_response(err);
            }
        },
        None => {
            warn!(
                "architect.draft: no LLM credentials in env (DEEPINFRA_API_KEY / OPENROUTER_API_KEY); using stub generator"
            );
            match generate(&brief) {
                Ok(d) => d,
                Err(err) => return architect_error_response(err),
            }
        }
    };

    let draft_id = synthetic_draft_id(&draft);
    json!({
        "ok": true,
        "draft_id": draft_id,
        "draft": draft,
    })
}

/// `architect.refine` — apply an instruction to an existing draft via a
/// multi-turn LLM conversation.
///
/// Wave 35 Phase 3. The UI ferries the entire conversation history on
/// each call: the original brief, every prior refinement instruction,
/// and the assistant's draft after each turn. The orchestrator stays
/// stateless — there is no DB row, no in-memory cache, no draft id
/// lookup. Phase 4 will add `architect_drafts` persistence.
///
/// Request shape:
/// ```json
/// {
///   "history": [
///     { "brief": "AI consulting firm", "draft": <GeneratedBlueprint> }
///     // … one entry per prior turn, oldest first …
///   ],
///   "instruction": "focus on legal AI"
/// }
/// ```
///
/// Backward-compatible legacy shape (single prior turn, no array):
/// ```json
/// { "draft": <GeneratedBlueprint>, "instruction": "..." }
/// ```
/// The legacy path falls back to the Phase-1 stub `refine` (returns the
/// draft unchanged) when the LLM is unavailable, so existing callers
/// don't break.
pub async fn handle_architect_refine(
    _ctx: &super::CommandContext,
    request: &Value,
    _allowed: &Option<Vec<String>>,
) -> Value {
    let instruction = request
        .get("instruction")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if instruction.trim().is_empty() {
        return json!({
            "ok": false,
            "error": "instruction is required",
            "code": "invalid_request",
        });
    }
    if instruction.len() > MAX_BRIEF_CHARS {
        return json!({
            "ok": false,
            "error": format!("instruction exceeds {MAX_BRIEF_CHARS}-char cap"),
            "code": "too_long",
        });
    }

    // Decode the history. Two accepted shapes:
    //  - canonical: `history: [{brief, draft}, ...]` (Wave 35)
    //  - legacy:    `draft: <GeneratedBlueprint>` (Phase 1)
    let (prior_briefs, prior_drafts): (Vec<String>, Vec<GeneratedBlueprint>) =
        match request.get("history") {
            Some(Value::Array(items)) if !items.is_empty() => {
                let mut briefs = Vec::with_capacity(items.len());
                let mut drafts = Vec::with_capacity(items.len());
                for (i, item) in items.iter().enumerate() {
                    let brief = match item.get("brief").and_then(|v| v.as_str()) {
                        Some(s) if !s.trim().is_empty() => s.to_string(),
                        _ => {
                            return json!({
                                "ok": false,
                                "error": format!("history[{i}].brief is required"),
                                "code": "invalid_request",
                            });
                        }
                    };
                    let draft_value = match item.get("draft").cloned() {
                        Some(v) => v,
                        None => {
                            return json!({
                                "ok": false,
                                "error": format!("history[{i}].draft is required"),
                                "code": "invalid_request",
                            });
                        }
                    };
                    let draft: GeneratedBlueprint = match serde_json::from_value(draft_value) {
                        Ok(d) => d,
                        Err(err) => {
                            return json!({
                                "ok": false,
                                "error": format!("history[{i}].draft is malformed: {err}"),
                                "code": "invalid_request",
                            });
                        }
                    };
                    briefs.push(brief);
                    drafts.push(draft);
                }
                (briefs, drafts)
            }
            _ => {
                // Legacy single-draft shape. Synthesize a one-entry
                // history with an empty brief — the LLM will treat the
                // instruction itself as the founder's request.
                let Some(draft_value) = request.get("draft").cloned() else {
                    return json!({
                        "ok": false,
                        "error": "history or draft is required",
                        "code": "invalid_request",
                    });
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
                let synthesized_brief = draft
                    .blueprint
                    .get("description")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("(prior brief unavailable)")
                    .to_string();
                (vec![synthesized_brief], vec![draft])
            }
        };

    let started = Instant::now();
    let refined = match build_default_llm() {
        Some((llm, opts)) => {
            match refine_via_llm(
                &prior_briefs,
                &prior_drafts,
                &instruction,
                llm.as_ref(),
                &opts,
            )
            .await
            {
                Ok(r) => {
                    info!(
                        latency_ms = started.elapsed().as_millis() as u64,
                        prior_turns = prior_briefs.len(),
                        "architect.refine: LLM refinement succeeded"
                    );
                    r
                }
                Err(err) => {
                    warn!(error = %err, "architect.refine: LLM path failed");
                    return architect_error_response(err);
                }
            }
        }
        None => {
            // No LLM credentials — fall back to the stub refine, which
            // returns the most recent draft unchanged so the UI keeps
            // working in tests / offline dev. Callers see a `stub` provenance.
            warn!(
                "architect.refine: no LLM credentials in env; falling back to stub (draft unchanged)"
            );
            let last = prior_drafts
                .last()
                .cloned()
                .expect("history is non-empty by construction");
            match refine(last, &instruction) {
                Ok(r) => r,
                Err(err) => return architect_error_response(err),
            }
        }
    };

    let draft_id = synthetic_draft_id(&refined);
    json!({"ok": true, "draft_id": draft_id, "draft": refined})
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
        ArchitectError::LlmFailure(_) => "llm_failure",
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
