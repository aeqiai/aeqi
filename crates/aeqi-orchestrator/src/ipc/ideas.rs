//! Idea CRUD and search IPC handlers.
//!
//! ## Write-path dispatch (Agent W, Round 3)
//!
//! `handle_store_idea` routes every incoming store through a four-way
//! dispatch driven by [`aeqi_ideas::dedup::DedupPipeline`]:
//!
//! - **Skip** — near-duplicate; return existing id, no side-effects.
//! - **Create** — insert via `store_full`, queue embed, reconcile inline
//!   edges, check consolidation threshold.
//! - **Merge** — append to the existing row, union tags, bump confidence
//!   by 0.1.
//! - **Supersede** — *first* flip the old row's `status` to `superseded`,
//!   *then* insert the new row (the v8 partial unique index enforces
//!   uniqueness only on `status='active'`, so the ordering matters), then
//!   add a `supersedes` edge.
//!
//! ## Retrieval default (shared contract with Agent R)
//!
//! Because `dispatch_supersede` leaves old rows in `status='superseded'`
//! and `dispatch_archive` will eventually write `archived`, the search
//! pipeline MUST default to `WHERE status='active'` and exclude ideas that
//! are the source of a `supersedes` edge. An `include_superseded=true`
//! knob can bypass. Agent R owns the search implementation; this comment
//! records the write-side invariants so the two halves stay consistent.

use std::collections::HashMap;
use std::sync::Arc;

use aeqi_core::traits::{IdeaStore, IdeaStoreCapability, StoreFull, UpdateFull};
use aeqi_ideas::dedup::{
    DedupAction, DedupCandidate, DedupPipeline, NEAR_DUPLICATE_THRESHOLD, SimilarIdea,
    lexical_similarity,
};
use aeqi_ideas::tag_policy::{EffectivePolicy, POLICY_TAG};

use super::request_field;

fn carries_identity_tag_for_agent(tags: &[String], agent_id: &str) -> bool {
    let persona_tag = format!("personality:{agent_id}");
    tags.iter().any(|tag| {
        tag.eq_ignore_ascii_case(crate::reserved_tags::IDENTITY)
            || tag.eq_ignore_ascii_case(&persona_tag)
    })
}

async fn ensure_identity_subscription_for_idea(
    ctx: &super::CommandContext,
    idea_store: &dyn IdeaStore,
    idea_id: &str,
) -> Option<String> {
    let idea = idea_store
        .get_by_ids(&[idea_id.to_string()])
        .await
        .ok()?
        .into_iter()
        .next()?;

    let Some(agent_id) = idea.agent_id.as_deref() else {
        return None;
    };
    let Some(event_store) = ctx.event_handler_store.as_ref() else {
        return Some("identity idea updated but event handler store is unavailable".to_string());
    };

    let result = if carries_identity_tag_for_agent(&idea.tags, agent_id) {
        crate::identity_subscription::sync_identity_session_start_event(
            event_store,
            agent_id,
            &idea.id,
        )
        .await
        .map(|_| ())
    } else {
        crate::identity_subscription::remove_identity_session_start_event(
            event_store,
            agent_id,
            &idea.id,
        )
        .await
    };

    match result {
        Ok(()) => None,
        Err(err) => Some(err.to_string()),
    }
}

fn unsupported_capability_response(
    idea_store: &dyn IdeaStore,
    method: &'static str,
    capability: IdeaStoreCapability,
) -> Option<serde_json::Value> {
    if idea_store.capabilities().supports(capability) {
        return None;
    }

    Some(serde_json::json!({
        "ok": false,
        "code": "unsupported_capability",
        "capability": capability.as_str(),
        "method": method,
        "store": idea_store.name(),
        "error": format!(
            "idea store '{}' does not support {} required by {}",
            idea_store.name(),
            capability,
            method
        ),
    }))
}

pub async fn handle_list_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    // Agent-scoped path goes through AgentRegistry so it can walk the
    // position DAG and include globals (agent_id IS NULL) + self +
    // descendants. The trait IdeaStore doesn't know about position edges.
    if let Some(aid) = request_field(request, "agent_id") {
        let backfilled = super::files::backfill_file_ideas_for_agent(ctx, aid).await;
        if backfilled > 0 {
            ctx.recall_cache.invalidate();
        }
        match ctx.agent_registry.list_ideas_visible_to(aid).await {
            Ok(ideas) => {
                let items: Vec<serde_json::Value> = ideas.iter().map(idea_to_json).collect();
                return serde_json::json!({"ok": true, "ideas": items});
            }
            Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
        }
    }

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    // Unscoped: return everything (admin-ish view — typically the /ideas page).
    match idea_store.search_by_prefix("", 1000) {
        Ok(ideas) => {
            let items: Vec<serde_json::Value> = ideas.iter().map(idea_to_json).collect();
            serde_json::json!({"ok": true, "ideas": items})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_store_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    // NOTE for Agent W: on successful store, call `ctx.recall_cache.invalidate()`
    // to keep the daemon-side recall cache coherent with new writes. Agent R
    // already invalidates from `handle_feedback_idea`, `handle_delete_idea`,
    // `handle_update_idea`, `handle_add_idea_edge`, `handle_remove_idea_edge`.
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    // Parse request. `key` is the legacy field name; pre-Apr18 MCP
    // binaries still send it. This fallback MUST survive every rename
    // sweep — see `ipc/ideas.rs:51` in the plan's Phase 0.
    let input = match parse_store_request(request) {
        Ok(i) => i,
        Err(e) => return serde_json::json!({"ok": false, "error": e}),
    };

    // Redact secrets before anything persists or feeds the embedder.
    let redacted_content = aeqi_ideas::redact::redact_secrets(&input.content);

    // Resolve tag policies. Empty → defaults are synthesised inside
    // `TagPolicyCache::resolve` so the merge always has something to
    // fold over.
    let policies = ctx
        .tag_policy_cache
        .resolve(idea_store.as_ref(), &input.tags)
        .await;
    let effective = aeqi_ideas::tag_policy::merge_policies(&policies);

    // Same-name active-row fast path. The partial unique index on
    // `(COALESCE(agent_id,''), name) WHERE status='active'` means a second
    // insert with the same name cannot create a sibling row. Older behavior
    // skipped every same-name write here, which lost materially distinct
    // follow-up lessons. Keep the fast exact/near-duplicate skip, but merge
    // changed content so the memory improves instead of disappearing.
    if let Ok(Some(existing_id)) = idea_store
        .get_active_id_by_name(&input.name, input.agent_id.as_deref())
        .await
    {
        if let Some(existing) = idea_store
            .get_by_ids(std::slice::from_ref(&existing_id))
            .await
            .ok()
            .and_then(|mut rows| rows.pop())
        {
            let similarity = lexical_similarity(
                &input.name,
                &redacted_content,
                &existing.name,
                &existing.content,
            );
            let top = SimilarIdea {
                id: existing_id.clone(),
                name: existing.name.clone(),
                content: existing.content.clone(),
                similarity,
            };

            if similarity > NEAR_DUPLICATE_THRESHOLD {
                if let Err(response) =
                    apply_store_metadata(idea_store, &existing_id, &input, "skip").await
                {
                    return response;
                }
                return serde_json::json!({
                    "ok": true,
                    "id": existing_id,
                    "action": "skip",
                    "dedup": dedup_report("same_name_near_duplicate", Some(&top), 1),
                });
            }

            let response = dispatch_merge(
                ctx,
                idea_store,
                &existing_id,
                &input,
                &effective,
                &redacted_content,
            )
            .await;
            return with_dedup_report(
                response,
                dedup_report("same_name_changed_content_merge", Some(&top), 1),
            );
        }

        if let Err(response) = apply_store_metadata(idea_store, &existing_id, &input, "skip").await
        {
            return response;
        }
        return serde_json::json!({
            "ok": true,
            "id": existing_id,
            "action": "skip",
            "dedup": dedup_report("same_name_existing_unavailable", None, 1),
        });
    }

    // Find similar candidates. Retrieval-side scoring lives in Agent R;
    // the dedup helper stays BM25-only for now so we don't block on
    // the embedder. Graceful fallback: if search errors, treat as "no
    // similar" (Create path).
    //
    // T1.1: when a tag policy declares `dedup_window_hours`, filter the
    // candidate set to ideas created within that window. Older
    // near-duplicates fall out of the dedup view, so the new content lands
    // as a fresh `Create` (the desired semantics for tags like
    // `state` or `signal:*` that re-emit on a cadence). When no policy
    // declares a window, behaviour is byte-identical to pre-T1.1.
    let similar = find_similar_for_dedup(
        idea_store.as_ref(),
        &input.name,
        &redacted_content,
        input.agent_id.as_deref(),
        effective.dedup_window_hours,
    )
    .await;

    let candidate = DedupCandidate {
        name: input.name.clone(),
        content: redacted_content.clone(),
        embedding: None,
    };
    let action = DedupPipeline::default().decide(&candidate, &similar);

    let dedup = dedup_report(
        match &action {
            DedupAction::Skip => "near_duplicate",
            DedupAction::Create => {
                if similar.is_empty() {
                    "no_candidate"
                } else {
                    "novel_enough"
                }
            }
            DedupAction::Merge(_) => "same_name_similarity_merge",
            DedupAction::Supersede(_) => "contradiction_supersede",
        },
        top_similar(&similar),
        similar.len(),
    );

    let response = match action {
        DedupAction::Skip => serde_json::json!({
            "ok": true,
            "id": top_similar(&similar).map(|s| s.id.clone()).unwrap_or_default(),
            "action": "skip",
        }),
        DedupAction::Create => {
            dispatch_create(ctx, idea_store, &input, &effective, &redacted_content).await
        }
        DedupAction::Merge(existing_id) => {
            dispatch_merge(
                ctx,
                idea_store,
                &existing_id,
                &input,
                &effective,
                &redacted_content,
            )
            .await
        }
        DedupAction::Supersede(old_id) => {
            dispatch_supersede(
                ctx,
                idea_store,
                &old_id,
                &input,
                &effective,
                &redacted_content,
            )
            .await
        }
    };
    let response = with_dedup_report(response, dedup);

    // Invalidate the policy cache when the new row carries `meta:tag-policy`.
    if input
        .tags
        .iter()
        .any(|t| t.eq_ignore_ascii_case(POLICY_TAG))
    {
        ctx.tag_policy_cache.invalidate().await;
    }

    // Emit a "created" activity row when this store actually created a new
    // idea. Skip / Merge / Supersede have their own semantics — only the
    // Create branch produces a fresh idea worth surfacing in the feed.
    if response.get("ok").and_then(|v| v.as_bool()) == Some(true)
        && response.get("action").and_then(|v| v.as_str()) == Some("create")
        && let Some(new_id) = response.get("id").and_then(|v| v.as_str())
    {
        let caller_user_id = request_field(request, "caller_user_id");
        emit_idea_activity(ctx, idea_store.as_ref(), new_id, "created", caller_user_id).await;
    }

    // Tables-in-Ideas Phase 2: persist parent_idea_id + properties on whichever
    // id the dispatch settled on (skip / create / merge / supersede all surface
    // an `id`). Run after the activity emit so a failure here doesn't lose the
    // primary write — the row exists; we just couldn't tag it.
    if response.get("ok").and_then(|v| v.as_bool()) == Some(true)
        && let Some(target_id) = response
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
        && let Err(error_response) = apply_store_metadata(
            idea_store,
            &target_id,
            &input,
            response
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("store"),
        )
        .await
    {
        return error_response;
    }

    let mut response = response;
    if response.get("ok").and_then(|v| v.as_bool()) == Some(true)
        && let Some(target_id) = response.get("id").and_then(|v| v.as_str())
        && let Some(warning) =
            ensure_identity_subscription_for_idea(ctx, idea_store.as_ref(), target_id).await
    {
        response["identity_event_warning"] = serde_json::json!(warning);
    }

    response
}

async fn apply_store_metadata(
    idea_store: &Arc<dyn IdeaStore>,
    target_id: &str,
    input: &StoreRequest,
    action: &str,
) -> std::result::Result<(), serde_json::Value> {
    if input.parent_idea_id.is_some() {
        let _ = idea_store
            .set_parent(target_id, input.parent_idea_id.as_deref())
            .await;
    }
    if let Some(props) = input.properties.clone() {
        let _ = idea_store.set_properties(target_id, Some(props)).await;
    }
    if let Some(kind) = input.kind.as_deref()
        && let Err(e) = idea_store
            .set_kind(target_id, kind, input.file_id.as_deref())
            .await
    {
        return Err(serde_json::json!({
            "ok": false,
            "id": target_id,
            "action": action,
            "error": format!("stored idea but failed to set kind={kind:?}: {e}"),
        }));
    }
    Ok(())
}

fn top_similar(similar: &[SimilarIdea]) -> Option<&SimilarIdea> {
    similar.iter().max_by(|a, b| {
        a.similarity
            .partial_cmp(&b.similarity)
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}

fn dedup_report(
    reason: &'static str,
    top: Option<&SimilarIdea>,
    candidate_count: usize,
) -> serde_json::Value {
    let top_candidate = top.map(|hit| {
        serde_json::json!({
            "id": hit.id.clone(),
            "name": hit.name.clone(),
            "similarity": hit.similarity,
        })
    });

    serde_json::json!({
        "reason": reason,
        "candidate_count": candidate_count,
        "top_candidate": top_candidate,
        "near_duplicate_threshold": NEAR_DUPLICATE_THRESHOLD,
    })
}

fn with_dedup_report(
    mut response: serde_json::Value,
    dedup: serde_json::Value,
) -> serde_json::Value {
    if let Some(obj) = response.as_object_mut() {
        obj.insert("dedup".to_string(), dedup);
    }
    response
}

/// One entry in the IPC `links` field — a kind-aware programmatic edge.
/// The body-parser-owned `mention` / `embed` relations are NEVER written
/// from this surface (they're recomputed from the body on every store);
/// the IPC field is reserved for `link` edges (direct API / "+ Link"
/// UI button).
#[derive(Debug, Clone)]
struct StoreLinkRequest {
    target_kind: String,
    target_id: String,
    relation: String,
}

/// Parsed, validated store-request. Holds the original `links` payload so
/// the per-action dispatchers can reconcile explicit UI/programmatic edges
/// alongside the body-parsed inline ones.
struct StoreRequest {
    name: String,
    content: String,
    tags: Vec<String>,
    agent_id: Option<String>,
    scope: aeqi_core::Scope,
    links: Vec<StoreLinkRequest>,
    /// Validation errors raised while parsing the `links` field. Surfaced
    /// to the caller as a soft warning per link rather than aborting the
    /// store — a typoed relation should not lose the idea.
    link_errors: Vec<String>,
    /// Who authored the content. Falls back to `agent_id` when the IPC
    /// doesn't carry a separate value.
    authored_by: Option<String>,
    /// Tables-in-Ideas Phase 2: optional parent in the Idea tree.
    parent_idea_id: Option<String>,
    /// Tables-in-Ideas Phase 2: schema-less property bag. The IPC accepts
    /// any JSON object; non-objects are rejected upstream.
    properties: Option<serde_json::Value>,
    /// Structural identity discriminator for the idea row. `None` preserves
    /// the store default (`note`).
    kind: Option<String>,
    /// Optional blob/file reference for `kind="file"` rows.
    file_id: Option<String>,
    /// Wave 5 — Lane C: the session the caller was inside when the idea was
    /// created. When set on a Create or Supersede that lands a new row,
    /// `finalize_write` writes an `idea → session` `link` edge so the graph
    /// records provenance. The receiving idea's own conversation session
    /// (lazy-created on first activity) is distinct and tracked in
    /// `ideas.session_id`.
    created_in_session_id: Option<String>,
}

fn parse_store_request(request: &serde_json::Value) -> std::result::Result<StoreRequest, String> {
    // "key" is the legacy field name; pre-Apr18 MCP binaries still send it.
    let name = request_field(request, "name")
        .or_else(|| request_field(request, "key"))
        .unwrap_or("");
    // Fix #7 (Option A): empty content is legitimate. Marker ideas, policy
    // stubs, and lifecycle seeds like `session:stopped` carry a name + tags
    // with no body — rejecting them here broke M's markdown re-import and
    // the preset seeder for empty-body entries. Only `name` is required.
    let content = request_field(request, "content").unwrap_or("");

    if name.is_empty() {
        return Err("name is required".to_string());
    }

    let tags: Vec<String> = request
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|tags_val| {
            tags_val
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_else(|| vec!["fact".to_string()]);

    let agent_id = request_field(request, "agent_id").map(|s| s.to_string());
    let scope: aeqi_core::Scope = request_field(request, "scope")
        .and_then(|s| s.parse().ok())
        .unwrap_or_else(|| {
            if agent_id.is_none() {
                aeqi_core::Scope::Global
            } else {
                aeqi_core::Scope::SelfScope
            }
        });

    let authored_by = request_field(request, "authored_by")
        .map(|s| s.to_string())
        .or_else(|| agent_id.clone());

    let (links, link_errors) = parse_links(request);

    let parent_idea_id = request_field(request, "parent_idea_id").map(|s| s.to_string());
    let properties: Option<serde_json::Value> = request
        .get("properties")
        .and_then(|v| if v.is_object() { Some(v.clone()) } else { None });
    let kind = request_field(request, "kind")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            const CANONICAL_IDEA_KINDS: &[&str] = &["note", "file", "goal"];
            if CANONICAL_IDEA_KINDS.contains(&s) || s.starts_with("custom:") {
                Ok(s.to_string())
            } else {
                Err(format!(
                    "invalid kind {s:?}; canonical Idea kinds: {} (or `custom:<name>` for company-specific kinds)",
                    CANONICAL_IDEA_KINDS.join(", ")
                ))
            }
        })
        .transpose()?;
    let file_id = request_field(request, "file_id")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let created_in_session_id = request_field(request, "created_in_session_id")
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    Ok(StoreRequest {
        name: name.to_string(),
        content: content.to_string(),
        tags,
        agent_id,
        scope,
        links,
        link_errors,
        authored_by,
        parent_idea_id,
        properties,
        kind,
        file_id,
        created_in_session_id,
    })
}

/// BM25-based similarity lookup for the dedup pipeline. Returns at most
/// 5 candidates; absent ideas and transport errors yield an empty vec so
/// the dispatch safely falls through to `Create`.
///
/// `dedup_window_hours` (T1.1): when `Some(h)`, filter results to ideas
/// whose `created_at` is within the last `h` hours. `None` preserves the
/// pre-T1.1 unbounded view.
async fn find_similar_for_dedup(
    idea_store: &dyn IdeaStore,
    name: &str,
    content: &str,
    agent_id: Option<&str>,
    dedup_window_hours: Option<i64>,
) -> Vec<SimilarIdea> {
    // Composite query: name keywords + first 200 chars of content.
    let snippet: String = content.chars().take(200).collect();
    let query_text = if snippet.is_empty() {
        name.to_string()
    } else {
        format!("{name} {snippet}")
    };

    let mut query = aeqi_core::traits::IdeaQuery::new(query_text, 5);
    if let Some(aid) = agent_id {
        query = query.with_agent(aid);
    }

    let cutoff: Option<chrono::DateTime<chrono::Utc>> = dedup_window_hours.and_then(|h| match h {
        n if n > 0 => Some(chrono::Utc::now() - chrono::Duration::hours(n)),
        _ => None,
    });

    match idea_store.search(&query).await {
        Ok(hits) => hits
            .into_iter()
            .filter(|idea| match cutoff {
                Some(c) => idea.created_at >= c,
                None => true,
            })
            .map(|idea| {
                // `Idea::score` is a retrieval rank, not a duplicate
                // probability. Use search only to find candidates, then
                // compute a conservative bounded lexical similarity for
                // the dedup gate.
                let sim = lexical_similarity(name, content, &idea.name, &idea.content);
                SimilarIdea {
                    id: idea.id,
                    name: idea.name,
                    content: idea.content,
                    similarity: sim,
                }
            })
            .collect(),
        Err(e) => {
            tracing::debug!(error = %e, "find_similar_for_dedup: search failed; treating as novel");
            Vec::new()
        }
    }
}

/// Build a `StoreFull` payload from the parsed request + merged policy.
fn build_store_full(input: &StoreRequest, effective: &EffectivePolicy, content: &str) -> StoreFull {
    let expires_at = effective.expires_after_days.map(|days| {
        let secs = (days * 86_400.0) as i64;
        chrono::Utc::now() + chrono::Duration::seconds(secs)
    });

    StoreFull {
        name: input.name.clone(),
        content: content.to_string(),
        tags: input.tags.clone(),
        agent_id: input.agent_id.clone(),
        scope: input.scope,
        authored_by: input.authored_by.clone(),
        confidence: effective.confidence_default,
        expires_at,
        valid_from: None,
        valid_until: None,
        time_context: effective.time_context.clone(),
        status: "active".to_string(),
    }
}

async fn dispatch_create(
    ctx: &super::CommandContext,
    idea_store: &Arc<dyn IdeaStore>,
    input: &StoreRequest,
    effective: &EffectivePolicy,
    redacted_content: &str,
) -> serde_json::Value {
    if let Some(response) = unsupported_capability_response(
        idea_store.as_ref(),
        "store_full",
        IdeaStoreCapability::RichWrite,
    ) {
        return response;
    }

    let payload = build_store_full(input, effective, redacted_content);
    let id = match idea_store.store_full(payload).await {
        Ok(id) => id,
        Err(e) => {
            // Fix #6 (Option B): safety net for the race between the
            // pre-dedup active-row check in `handle_store_idea` and this
            // INSERT. If a concurrent writer committed the same
            // `(agent_id, name)` first the partial unique index trips
            // `SQLITE_CONSTRAINT_UNIQUE`. Look up the landed row and
            // return `skip` with its id so the caller sees a clean
            // idempotent result instead of a hard error.
            if is_unique_constraint_error(&e)
                && let Ok(Some(existing_id)) = idea_store
                    .get_active_id_by_name(&input.name, input.agent_id.as_deref())
                    .await
            {
                return serde_json::json!({
                    "ok": true,
                    "id": existing_id,
                    "action": "skip",
                });
            }
            return serde_json::json!({"ok": false, "error": e.to_string()});
        }
    };

    finalize_write(
        ctx,
        idea_store,
        &id,
        input,
        effective,
        redacted_content,
        "create",
    )
    .await
}

/// Walk an `anyhow::Error` chain looking for a `rusqlite` UNIQUE-constraint
/// failure. The orchestrator's idea store is backed by SQLite, so the
/// innermost error on a duplicate `(agent_id, name) WHERE status='active'`
/// insert is `rusqlite::Error::SqliteFailure` with extended code
/// `SQLITE_CONSTRAINT_UNIQUE` (2067).
fn is_unique_constraint_error(err: &anyhow::Error) -> bool {
    for cause in err.chain() {
        if let Some(rusqlite::Error::SqliteFailure(sqlite_err, _)) =
            cause.downcast_ref::<rusqlite::Error>()
            && sqlite_err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
        {
            return true;
        }
    }
    false
}

async fn dispatch_merge(
    ctx: &super::CommandContext,
    idea_store: &Arc<dyn IdeaStore>,
    existing_id: &str,
    input: &StoreRequest,
    effective: &EffectivePolicy,
    redacted_content: &str,
) -> serde_json::Value {
    if let Some(response) = unsupported_capability_response(
        idea_store.as_ref(),
        "update_full",
        IdeaStoreCapability::RichWrite,
    ) {
        return response;
    }

    // Load the existing row so we can append + union tags + bump confidence.
    let existing = match idea_store
        .get_by_ids(&[existing_id.to_string()])
        .await
        .ok()
        .and_then(|mut v| v.pop())
    {
        Some(e) => e,
        None => {
            // Race: the row vanished between the dedup lookup and the
            // merge. Fall through to Create so the caller's content
            // still lands.
            return dispatch_create(ctx, idea_store, input, effective, redacted_content).await;
        }
    };

    let ts = chrono::Utc::now().to_rfc3339();
    let merged_content = format!(
        "{}\n\n--- merged at {} ---\n{}",
        existing.content, ts, redacted_content
    );

    let mut tag_union: Vec<String> = existing.tags.clone();
    for t in &input.tags {
        if !tag_union.iter().any(|e| e.eq_ignore_ascii_case(t)) {
            tag_union.push(t.clone());
        }
    }

    // Existing confidence defaults to 1.0 when the column is absent; bump
    // by 0.1 and clamp to 1.0. We can't read `confidence` off `Idea` yet
    // (Round 2 didn't extend the struct) — treat the stored value as
    // authoritative and let `UpdateFull::confidence` take the bumped value.
    let bumped_confidence = (effective.confidence_default + 0.1).min(1.0);

    let patch = UpdateFull {
        content: Some(merged_content.clone()),
        tags: Some(tag_union.clone()),
        confidence: Some(bumped_confidence),
        embedding_pending: Some(true),
        updated_at: Some(chrono::Utc::now()),
        valid_until: None,
        status: None,
    };

    if let Err(e) = idea_store.update_full(existing_id, patch).await {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    // Queue a re-embed so the merged body gets the freshest vector.
    // PRIORITY: the row is already visible to callers, but
    // `embedding_pending=1` drops it from vector search until the worker
    // catches up. Jumping the queue ahead of first-time embeds (which
    // are invisible anyway) shrinks that window.
    ctx.embed_queue
        .enqueue_priority(existing_id.to_string(), merged_content.clone());

    // Re-reconcile inline edges from the merged body.
    let unresolved_refs = reconcile_inline_edges_in_scope(
        ctx,
        idea_store.as_ref(),
        existing_id,
        &merged_content,
        input.agent_id.as_deref(),
    )
    .await;

    // @-mention parsing on the merged body.
    wire_at_mentions_on_idea(ctx, idea_store.as_ref(), existing_id, &merged_content).await;

    // Consolidation threshold check runs on every write.
    check_consolidation_threshold(ctx, idea_store.as_ref(), &tag_union, effective, existing_id)
        .await;

    let mut payload = serde_json::json!({
        "ok": true,
        "id": existing_id,
        "action": "merge",
    });
    if !unresolved_refs.is_empty() {
        payload["unresolved_refs"] = serde_json::json!(unresolved_refs);
    }
    payload
}

async fn dispatch_supersede(
    ctx: &super::CommandContext,
    idea_store: &Arc<dyn IdeaStore>,
    old_id: &str,
    input: &StoreRequest,
    effective: &EffectivePolicy,
    redacted_content: &str,
) -> serde_json::Value {
    if let Some(response) = unsupported_capability_response(
        idea_store.as_ref(),
        "supersede_atomic",
        IdeaStoreCapability::AtomicSupersede,
    ) {
        return response;
    }

    // Atomic supersession: single SQLite transaction flips old → superseded,
    // inserts the new row, and writes the supersedes edge. If any step
    // errors mid-way, the tx rolls back and the old row stays `active` —
    // no partial state, no orphaned superseded row without a replacement.
    // The v8 partial unique index enforces active-name uniqueness, and the
    // three sub-ops have an interlocked correctness contract the atomic
    // path preserves without the caller having to sequence them by hand.
    let payload = build_store_full(input, effective, redacted_content);
    let new_id = match idea_store.supersede_atomic(old_id, payload).await {
        Ok(id) => id,
        Err(e) => {
            return serde_json::json!({
                "ok": false,
                "error": format!("supersede_atomic failed: {e}"),
            });
        }
    };

    // Edge reconciliation from body parsing (mentions, embeds, typed
    // prefixes) still happens outside the transaction in `finalize_write`
    // — inline edges are additive and their resolver may need async DB
    // round-trips that don't compose with a single-connection tx.
    finalize_write(
        ctx,
        idea_store,
        &new_id,
        input,
        effective,
        redacted_content,
        "supersede",
    )
    .await
}

/// Shared tail for Create and Supersede: explicit links, inline edges,
/// embed enqueue, consolidation check. Merge has its own flow because
/// it patches an existing row.
async fn finalize_write(
    ctx: &super::CommandContext,
    idea_store: &Arc<dyn IdeaStore>,
    id: &str,
    input: &StoreRequest,
    effective: &EffectivePolicy,
    redacted_content: &str,
    action: &str,
) -> serde_json::Value {
    // Explicit links from the IPC `links` field. Cross-kind aware after
    // T1.8: a `kind: "session"` entry writes a true cross-kind edge
    // (idea → session) instead of being smuggled in as a tag.
    // Pre-validated by `parse_links`; invalid entries are already in
    // `input.link_errors` and surfaced to the caller below.
    for link in &input.links {
        let _ = idea_store
            .store_entity_edge(
                "idea",
                id,
                &link.target_kind,
                &link.target_id,
                &link.relation,
                1.0,
            )
            .await;
    }

    // Wave 5 — Lane C: record session provenance for ideas created inside a
    // live session. Direction matches the migration-v11 convention
    // (`idea → session`, `link` relation) so the existing `idea_edges.links`
    // surface picks it up without further plumbing. Skipped silently when the
    // caller didn't carry a session — globals + non-session writes are still
    // valid. Best-effort: an edge-write failure is logged but doesn't roll
    // back the idea.
    if let Some(ref sid) = input.created_in_session_id
        && let Err(e) = idea_store
            .store_entity_edge("idea", id, "session", sid, "link", 1.0)
            .await
    {
        tracing::warn!(
            idea = %id,
            session = %sid,
            action = action,
            error = %e,
            "session provenance edge write failed"
        );
    }

    // Inline body-parsed edges (mentions/embeds + typed prefixes). The
    // returned Vec<String> is the unresolved [[name]] tokens — see quest
    // 67-148.
    let unresolved_refs = reconcile_inline_edges_in_scope(
        ctx,
        idea_store.as_ref(),
        id,
        redacted_content,
        input.agent_id.as_deref(),
    )
    .await;

    // @-mention parsing: insert entity_edges + auto-subscribe mentioned
    // identities as session participants.
    wire_at_mentions_on_idea(ctx, idea_store.as_ref(), id, redacted_content).await;

    // Hand off the embedding — the worker flips `embedding_pending`.
    ctx.embed_queue
        .enqueue(id.to_string(), redacted_content.to_string());

    // Consolidation threshold check. Cheap — one COUNT per tagged policy.
    check_consolidation_threshold(ctx, idea_store.as_ref(), &input.tags, effective, id).await;

    let mut payload = serde_json::json!({
        "ok": true,
        "id": id,
        "action": action,
    });
    if !input.link_errors.is_empty() {
        payload["link_errors"] = serde_json::json!(input.link_errors);
    }
    if !unresolved_refs.is_empty() {
        payload["unresolved_refs"] = serde_json::json!(unresolved_refs);
    }
    payload
}

/// Evaluate every tag on the idea against its policy's `consolidate_when`
/// trigger. Fires `ideas:threshold_reached` via the daemon-level
/// `PatternDispatcher` when the count hits the threshold so the seeded
/// event runs: spawn a consolidator sub-agent, then persist its JSON
/// output via `ideas.store_many`.
///
/// When no dispatcher is wired (test harnesses that bypass the daemon)
/// the trigger is logged at INFO so operators can still observe the shape.
async fn check_consolidation_threshold(
    ctx: &super::CommandContext,
    idea_store: &dyn IdeaStore,
    tags: &[String],
    effective: &EffectivePolicy,
    triggering_id: &str,
) {
    let Some((ref tag, ref trigger)) = effective.consolidate_when else {
        return;
    };
    if !idea_store
        .capabilities()
        .supports(IdeaStoreCapability::TagAnalytics)
    {
        tracing::debug!(
            tag,
            store = idea_store.name(),
            "idea store does not support tag analytics; skipping consolidation threshold"
        );
        return;
    }
    // Only count when the trigger's tag is actually on the idea (defensive:
    // merged policies can surface a trigger for a tag the idea doesn't
    // carry; we still count in case the triggering tag is one of the
    // idea's tags).
    if !tags.iter().any(|t| t.eq_ignore_ascii_case(tag)) {
        return;
    }

    let window_start = chrono::Utc::now() - chrono::Duration::hours(trigger.age_hours.max(0));
    let count = match idea_store.count_by_tag_since(tag, window_start).await {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!(error = %e, tag, "count_by_tag_since failed");
            return;
        }
    };
    if count < trigger.count {
        return;
    }

    tracing::info!(
        tag,
        count,
        threshold = trigger.count,
        age_hours = trigger.age_hours,
        consolidator = %trigger.consolidator_idea,
        triggering_id,
        "ideas:threshold_reached — dispatching to seeded event"
    );

    // Dispatch the pattern if the daemon wired a dispatcher. Without it the
    // trigger is observable in logs but the consolidator doesn't run —
    // tolerated for unit-test harnesses that never spin up the daemon.
    let Some(dispatcher) = ctx.pattern_dispatcher.as_ref() else {
        return;
    };

    // Gather the full cluster of active ideas carrying `tag` inside the
    // policy's age window — oldest-first, capped at 50. The consolidator
    // persona distills the *cluster*, not just the triggering idea; feeding
    // only the triggering id hides the signal. The cap bounds payload size
    // so the sub-agent's context budget doesn't thrash on pathologically
    // large clusters.
    let candidates = idea_store
        .list_active_by_tag_since(tag, window_start, 50)
        .await
        .unwrap_or_else(|e| {
            tracing::debug!(error = %e, tag, "list_active_by_tag_since failed; falling back to triggering_id only");
            vec![triggering_id.to_string()]
        });
    // Serialize as JSON array so the event placeholder expands into a valid
    // JSON list the consolidator can iterate.
    let candidate_ids_json =
        serde_json::to_string(&candidates).unwrap_or_else(|_| "[]".to_string());

    // Resolve the triggering idea's owning agent so the consolidator's
    // `authored_by` carries real provenance instead of `"consolidator:"`
    // (the previous behaviour when the IPC path had no session-bound
    // agent_id). Global ideas (agent_id IS NULL) fall back to
    // `"consolidator:system"` — ugly but explicit.
    let triggering_owner = idea_store
        .get_by_ids(&[triggering_id.to_string()])
        .await
        .ok()
        .and_then(|ideas| ideas.into_iter().next())
        .and_then(|idea| idea.agent_id)
        .unwrap_or_else(|| "system".to_string());
    let authored_by = format!("consolidator:{triggering_owner}");

    // Build trigger_args — these flow into the event's tool_call args via
    // `{tag}`, `{count}`, `{candidate_ids}`, `{authored_by}`, etc. The
    // consolidator seed uses `{tag}` and `{candidate_ids}`; the store_many
    // step uses `{last_tool_result}` and `{authored_by}`.
    let trigger_args = serde_json::json!({
        "tag": tag,
        "count": count,
        "threshold": trigger.count,
        "age_hours": trigger.age_hours,
        "consolidator_idea": trigger.consolidator_idea,
        "triggering_id": triggering_id,
        "candidate_ids": candidate_ids_json,
        "authored_by": authored_by,
        "timestamp": chrono::Utc::now().to_rfc3339(),
    });

    // The IPC call has no live session; synthesize an ExecutionContext with
    // a synthetic `event:ideas:threshold_reached:<triggering_id>` session_id
    // so the consolidator seed's `{session_id}` substitution produces a
    // non-empty value (session.spawn rejects an empty parent_session). The
    // `event:` prefix lets session-genealogy filters exclude IPC-originated
    // synthetic sessions cleanly. The agent_id stays empty — the
    // consolidator seed is global, so visibility_sql_clause accepts the
    // empty viewer.
    let exec_ctx = aeqi_core::tool_registry::ExecutionContext {
        session_id: format!("event:ideas:threshold_reached:{triggering_id}"),
        ..Default::default()
    };
    let handled = dispatcher
        .dispatch("ideas:threshold_reached", &exec_ctx, &trigger_args)
        .await;
    if !handled {
        tracing::debug!(
            tag,
            "ideas:threshold_reached dispatch returned false (no matching event configured)"
        );
    }
}

/// Build a case-insensitive name→id resolver scoped to the agent's visible
/// idea set (or globals when `agent_id` is `None`) and reconcile the idea's
/// inline mention/embed edges from the body.
///
/// Errors in scope resolution or reconciliation are swallowed — inline
/// linking is a best-effort enrichment, not a store/update precondition.
///
/// Returns the case-preserved unresolved [[name]] tokens the body referenced.
/// Quest 67-148 surfaces these via the IPC response so the caller knows their
/// link silently dropped instead of training on broken bracket syntax.
async fn reconcile_inline_edges_in_scope(
    ctx: &super::CommandContext,
    idea_store: &dyn aeqi_core::traits::IdeaStore,
    source_id: &str,
    body: &str,
    agent_id: Option<&str>,
) -> Vec<String> {
    // Scope the resolver to what the agent can see; globals when unscoped.
    let scope: Vec<aeqi_core::traits::Idea> = match agent_id {
        Some(aid) => ctx
            .agent_registry
            .list_ideas_visible_to(aid)
            .await
            .unwrap_or_default(),
        None => idea_store
            .list_global_ideas(10_000)
            .await
            .unwrap_or_default(),
    };

    // Build the name → id lookup. On duplicate names the FIRST inserted wins
    // (deterministic iteration of `scope` makes binding stable across runs;
    // previous behaviour overwrote with whatever came last and trained agents
    // on a mystery resolver). Quest 67-148.
    let mut lookup: HashMap<String, String> = HashMap::with_capacity(scope.len());
    for i in scope {
        let key = i.name.to_lowercase();
        if let Some(existing) = lookup.get(&key) {
            tracing::warn!(
                name = %i.name,
                kept_id = %existing,
                rejected_id = %i.id,
                "duplicate idea name in resolver scope; first idea wins"
            );
            continue;
        }
        lookup.insert(key, i.id);
    }
    let lookup = Arc::new(lookup);

    let lookup_cloned = Arc::clone(&lookup);
    let resolver =
        move |name: &str| -> Option<String> { lookup_cloned.get(&name.to_lowercase()).cloned() };

    match idea_store
        .reconcile_inline_edges(source_id, body, &resolver)
        .await
    {
        Ok(unresolved) => unresolved,
        Err(e) => {
            tracing::warn!(source = %source_id, err = %e, "reconcile_inline_edges failed");
            Vec::new()
        }
    }
}

/// Parse the IPC `links` field on idea-create / idea-update.
///
/// T1.8 made the field cross-kind aware:
///
/// ```jsonc
/// "links": [
///   { "kind": "idea",    "id": "abc",  "relation": "link" },
///   { "kind": "session", "id": "uuid", "relation": "link" }
/// ]
/// ```
///
/// The legacy bare-string form (`["target-id"]`) is still accepted as a
/// shortcut for `{ kind: "idea", id: "target-id", relation: "link" }` so
/// pre-T1.8 callers don't break. The legacy `target_id` field name is
/// also accepted as an alias for `id` for the same reason.
///
/// Substrate writability check:
///
/// - `mention` / `embed` are body-parser-owned. Writing them through the
///   IPC `links` field is rejected — they would be re-derived on the
///   next reconcile and clobber the manual write anyway. This catches
///   typos like `relation: "mentions"` (plural) too.
/// - `link` is the only valid IPC-side relation (matches the "+ Link"
///   UI button and direct API writes).
/// - Legacy typed values (`adjacent`, `supersedes`, `contradicts`,
///   `supports`, `distilled_into`) are rejected with a clear error
///   pointing at the new vocabulary.
///
/// Returns `(valid_links, errors)` where `errors` is a list of
/// human-readable rejection reasons for the per-call response. Invalid
/// links never abort the store; they are logged and surfaced.
fn parse_links(request: &serde_json::Value) -> (Vec<StoreLinkRequest>, Vec<String>) {
    let mut out = Vec::new();
    let mut errors = Vec::new();

    let arr = match request.get("links").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => return (out, errors),
    };

    for entry in arr {
        match entry {
            serde_json::Value::String(s) if !s.is_empty() => {
                // Legacy bare-string shortcut. Defaults to a `link` edge
                // toward an idea — same behaviour the "+ Link" UI used
                // to expect from the old `adjacent` shape.
                out.push(StoreLinkRequest {
                    target_kind: "idea".to_string(),
                    target_id: s.clone(),
                    relation: aeqi_ideas::relation::LINK.to_string(),
                });
            }
            serde_json::Value::Object(obj) => {
                let target_id = obj
                    .get("id")
                    .or_else(|| obj.get("target_id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if target_id.is_empty() {
                    errors.push("link entry missing 'id'".to_string());
                    continue;
                }
                let kind = obj
                    .get("kind")
                    .or_else(|| obj.get("target_kind"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("idea");
                let relation = obj
                    .get("relation")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(aeqi_ideas::relation::LINK);

                if !aeqi_ideas::relation::is_substrate_writable(relation) {
                    errors.push(format!(
                        "relation '{relation}' is not writable through the IPC \
                         'links' field. Expected one of: mention, embed, link \
                         (T1.8 collapsed the legacy typed vocabulary)."
                    ));
                    continue;
                }
                if matches!(relation, "mention" | "embed") {
                    errors.push(format!(
                        "relation '{relation}' is body-parser-owned and is \
                         re-derived from the idea content; use 'link' for \
                         direct IPC writes."
                    ));
                    continue;
                }

                out.push(StoreLinkRequest {
                    target_kind: kind.to_string(),
                    target_id: target_id.to_string(),
                    relation: relation.to_string(),
                });
            }
            _ => {}
        }
    }

    (out, errors)
}

/// Programmatic link between two ideas. Powers `ideas(action='link')`
/// from the MCP surface and the "+ Link" UI flow when the user picks a
/// typed relation.
pub async fn handle_link_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let from = request_field(request, "from")
        .or_else(|| request_field(request, "source_id"))
        .unwrap_or("");
    let to = request_field(request, "to")
        .or_else(|| request_field(request, "target_id"))
        .unwrap_or("");
    if from.is_empty() || to.is_empty() {
        return serde_json::json!({"ok": false, "error": "from and to are required"});
    }
    if from == to {
        return serde_json::json!({"ok": false, "error": "from and to must differ"});
    }
    let relation = request_field(request, "relation").unwrap_or(aeqi_ideas::relation::LINK);
    if !aeqi_ideas::relation::is_substrate_writable(relation) {
        return serde_json::json!({
            "ok": false,
            "error": format!(
                "relation '{relation}' is not writable through ideas(action='link'). \
                 Expected one of: mention, embed, link (T1.8 collapsed the legacy typed vocabulary)."
            ),
        });
    }
    let strength = request
        .get("strength")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;

    // Visibility guard: both ideas must be visible to the requesting
    // agent. Without an agent_id we accept the operation (admin/UI
    // path). With an agent_id, the scope-filtered list gates the write.
    if let Some(aid) = request_field(request, "agent_id") {
        let visible = ctx
            .agent_registry
            .list_ideas_visible_to(aid)
            .await
            .unwrap_or_default();
        let ids: std::collections::HashSet<String> = visible.into_iter().map(|i| i.id).collect();
        if !ids.contains(from) || !ids.contains(to) {
            return serde_json::json!({
                "ok": false,
                "error": "one or both ideas are not visible to this agent",
            });
        }
    }

    match idea_store
        .store_idea_edge(from, to, relation, strength)
        .await
    {
        Ok(()) => serde_json::json!({"ok": true, "from": from, "to": to, "relation": relation}),
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_delete_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    // Pre-flight FK check across the sessions.db boundary: SQLite can't
    // enforce a real FK across attached DBs, so this is the only place that
    // protects the unification invariant ("a quest's idea cannot vanish").
    // Returning the conflicting quest ids lets the UI render a "Used by N
    // quests · Detach or delete those first" modal — see WS-7.
    //
    // Fail closed on lookup error (2026-05-14, Ideas steward Wave 2): the
    // previous warn-and-proceed behaviour silently let a transient sqlite
    // lock orphan quests forever. The cost of an unnecessary 503 here is
    // strictly less than an undetectable FK violation across two databases —
    // there is no way to repair an orphan after the fact.
    match ctx.agent_registry.find_quests_by_idea_id(id).await {
        Ok(quest_ids) if !quest_ids.is_empty() => {
            return serde_json::json!({
                "ok": false,
                "error": "in_use",
                "quest_ids": quest_ids,
            });
        }
        Ok(_) => {}
        Err(e) => {
            tracing::error!(
                idea = %id,
                error = %e,
                "delete_idea pre-flight failed; refusing delete to protect cross-DB FK"
            );
            return serde_json::json!({
                "ok": false,
                "error": "in_use_check_failed",
                "message": "Could not verify whether any quests reference this idea. Try again.",
            });
        }
    }

    let caller_user_id = request_field(request, "caller_user_id").map(str::to_string);

    // Capture the idea's session_id before the delete so we can still emit
    // a "deleted" activity row into the orphan session afterwards. The row
    // outlives the idea so the activity feed (read directly off the session)
    // still has a record after the idea row vanishes.
    let pre_delete_session_id: Option<String> = idea_store
        .get_by_ids(&[id.to_string()])
        .await
        .ok()
        .and_then(|mut v| v.pop())
        .and_then(|i| i.session_id);

    match idea_store.delete(id).await {
        Ok(()) => {
            ctx.recall_cache.invalidate();
            if let (Some(sid), Some(ss)) = (pre_delete_session_id, ctx.session_store.as_ref()) {
                let actor_kind = if caller_user_id.is_some() {
                    "user"
                } else {
                    "system"
                };
                let metadata = serde_json::json!({
                    "kind": "idea_deleted",
                    "actor_user_id": caller_user_id,
                    "actor_kind": actor_kind,
                });
                if let Err(e) = ss.append_system_activity(&sid, "deleted", &metadata).await {
                    tracing::warn!(idea = %id, error = %e, "delete_idea: append_system_activity failed");
                }
            }
            serde_json::json!({"ok": true})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_update_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    let name = request_field(request, "name").or_else(|| request_field(request, "key"));
    let content = request_field(request, "content");
    let tags: Option<Vec<String>> = request.get("tags").and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    });

    // Tables-in-Ideas Phase 2 — optional parent + wholesale-properties update.
    // Both are partial: omitting the keys leaves the row's columns untouched.
    // `parent_idea_id` accepts an explicit JSON `null` to detach to root; an
    // absent key is a no-op. Properties takes a full object (use the dedicated
    // `set_idea_properties` verb for deep-merge semantics).
    let parent_provided = request.get("parent_idea_id").is_some();
    let parent_idea_id: Option<String> =
        request_field(request, "parent_idea_id").map(str::to_string);
    let properties_provided = request.get("properties").is_some();
    let properties_value: Option<serde_json::Value> = request
        .get("properties")
        .and_then(|v| if v.is_object() { Some(v.clone()) } else { None });

    if name.is_none()
        && content.is_none()
        && tags.is_none()
        && !parent_provided
        && !properties_provided
    {
        return serde_json::json!({
            "ok": false,
            "error": "at least one of name, content, tags, parent_idea_id, or properties is required"
        });
    }

    let caller_user_id = request_field(request, "caller_user_id").map(str::to_string);

    // Skip the rich-write path entirely when only Phase 2 columns are
    // changing — handle_update_idea's `update` trait method requires at
    // least one of name/content/tags. For a parent-only or properties-only
    // edit, route straight to the new SqliteIdeas methods.
    let core_change = name.is_some() || content.is_some() || tags.is_some();
    if core_change && let Err(e) = idea_store.update(id, name, content, tags.as_deref()).await {
        return serde_json::json!({"ok": false, "error": e.to_string()});
    }

    if parent_provided {
        let _ = idea_store.set_parent(id, parent_idea_id.as_deref()).await;
    }
    if properties_provided {
        let _ = idea_store
            .set_properties(id, properties_value.clone())
            .await;
    }

    // Reconcile inline edges when the body changed. We need to know
    // which agent owns the idea to scope the resolver correctly. Capture
    // unresolved [[name]] tokens for the response — quest 67-148.
    let unresolved_refs = if let Some(body) = content {
        let agent_id = lookup_idea_agent(idea_store.as_ref(), id).await;
        reconcile_inline_edges_in_scope(ctx, idea_store.as_ref(), id, body, agent_id.as_deref())
            .await
    } else {
        Vec::new()
    };
    ctx.recall_cache.invalidate();
    emit_idea_activity(
        ctx,
        idea_store.as_ref(),
        id,
        "edited",
        caller_user_id.as_deref(),
    )
    .await;
    let mut payload = serde_json::json!({"ok": true});
    if !unresolved_refs.is_empty() {
        payload["unresolved_refs"] = serde_json::json!(unresolved_refs);
    }
    if let Some(warning) = ensure_identity_subscription_for_idea(ctx, idea_store.as_ref(), id).await
    {
        payload["identity_event_warning"] = serde_json::json!(warning);
    }
    payload
}

/// IPC handler — `set_idea_properties`. Deep-merge a JSON patch into the
/// Idea's `properties` column. Tables-in-Ideas Phase 2.
pub async fn handle_set_idea_properties(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let id = request_field(request, "id").unwrap_or("");
    if id.is_empty() {
        return serde_json::json!({"ok": false, "error": "id is required"});
    }

    let patch = match request.get("properties") {
        Some(v) if v.is_object() => v.clone(),
        Some(_) => {
            return serde_json::json!({
                "ok": false,
                "error": "properties must be a JSON object"
            });
        }
        None => {
            return serde_json::json!({
                "ok": false,
                "error": "properties is required"
            });
        }
    };

    match idea_store.merge_properties(id, patch).await {
        Ok(()) => {
            ctx.recall_cache.invalidate();
            serde_json::json!({"ok": true})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// IPC handler — `list_idea_children`. Return the direct children of an
/// Idea, newest first. Tables-in-Ideas Phase 2.
pub async fn handle_list_idea_children(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let parent_id = request_field(request, "parent_id")
        .or_else(|| request_field(request, "id"))
        .unwrap_or("");
    if parent_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "parent_id is required"});
    }

    match idea_store.list_children(parent_id).await {
        Ok(items) => {
            let serialised: Vec<serde_json::Value> = items.iter().map(idea_to_json).collect();
            serde_json::json!({"ok": true, "ideas": serialised})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Look up the owning agent_id for an idea. Used by update to scope the
/// inline-link resolver. Returns `None` for global ideas or on error.
async fn lookup_idea_agent(
    idea_store: &dyn aeqi_core::traits::IdeaStore,
    id: &str,
) -> Option<String> {
    idea_store
        .get_by_ids(&[id.to_string()])
        .await
        .ok()?
        .into_iter()
        .next()?
        .agent_id
}

pub async fn handle_search_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let query_text = request_field(request, "query").unwrap_or("");
    let top_k = request.get("top_k").and_then(|v| v.as_u64()).unwrap_or(20) as usize;

    let mut query = aeqi_core::traits::IdeaQuery::new(query_text, top_k);

    // Scope visibility: if the caller passes an `agent_id`, look up the
    // visible anchor set via scope_visibility so cross-agent leakage
    // through the search path is structurally impossible. Passing through
    // as `visible_anchor_ids` keeps aeqi-ideas free of agent-tree queries.
    if let Some(agent_id) = request_field(request, "agent_id") {
        query = query.with_agent(agent_id);
        if let Ok((_clause, anchors)) =
            crate::scope_visibility::visibility_sql_clause(&ctx.agent_registry, agent_id).await
        {
            // `anchors` is the flat anchor-id list used by the visibility
            // clause — exactly what IdeaQuery::visible_anchor_ids expects.
            query = query.with_visible_anchors(anchors);
        }
    }

    if let Some(tags_val) = request.get("tags").and_then(|v| v.as_array()) {
        let parsed: Vec<String> = tags_val
            .iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect();
        if !parsed.is_empty() {
            query.tags = parsed;
        }
    }

    // New MCP parameters from the unified `ideas` tool.
    let explain = request
        .get("explain")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if let Some(hint) = request_field(request, "route_hint") {
        query.route_hint = Some(hint.to_string());
    }
    if let Some(session_id) = request_field(request, "session_id") {
        query.session_id = Some(session_id.to_string());
    }
    if request
        .get("include_superseded")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        query.include_superseded = true;
    }

    // Recall cache: hash the shape, serve cached hits inside TTL.
    let cache_key = aeqi_ideas::CacheKey::build(
        query_text,
        &query.tags,
        top_k,
        query.agent_id.as_deref(),
        query.visible_anchor_ids.as_deref(),
    );

    if let Some((age, mut cached)) = ctx.recall_cache.get(&cache_key) {
        let age_ms = age.as_millis().min(u32::MAX as u128) as u32;
        tracing::debug!(age_ms, "recall cache hit");
        for hit in &mut cached {
            hit.why.cache = aeqi_core::traits::CacheSource::Hit { age_ms };
        }
        return build_search_response(cached, explain);
    }

    match idea_store.search_explained(&query).await {
        Ok(mut hits) => {
            // Freshly computed — stamp CacheSource::Fresh before caching so
            // the stored copy reflects its origin. A later cache hit
            // overrides this with CacheSource::Hit before returning.
            for hit in &mut hits {
                hit.why.cache = aeqi_core::traits::CacheSource::Fresh;
            }
            ctx.recall_cache.put(cache_key, hits.clone());
            build_search_response(hits, explain)
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Emit the search response. When `explain=true` each idea carries a
/// `why` object (bm25/vector/hotness/graph/confidence/decay/final_score);
/// otherwise only the ranked ideas ship.
fn build_search_response(
    hits: Vec<aeqi_core::traits::SearchHit>,
    explain: bool,
) -> serde_json::Value {
    let items: Vec<serde_json::Value> = hits
        .iter()
        .map(|h| {
            let mut v = idea_to_json(&h.idea);
            if explain {
                let cache_val = match h.why.cache {
                    aeqi_core::traits::CacheSource::Fresh => serde_json::json!("fresh"),
                    aeqi_core::traits::CacheSource::Hit { age_ms } => {
                        serde_json::json!({"hit": {"age_ms": age_ms}})
                    }
                };
                v["why"] = serde_json::json!({
                    "picked_by_tag": h.why.picked_by_tag,
                    "bm25": h.why.bm25,
                    "vector": h.why.vector,
                    "hotness": h.why.hotness,
                    "graph": h.why.graph,
                    "confidence": h.why.confidence,
                    "decay": h.why.decay,
                    "final_score": h.why.final_score,
                    "cache": cache_val,
                });
            }
            v
        })
        .collect();
    serde_json::json!({"ok": true, "ideas": items})
}

/// Multi-hop graph walk from a starting idea. Scopes every visited node
/// to the requesting agent's visible anchor set so a walk cannot leak
/// ideas owned by sibling agents. Used by `ideas(action='walk')`.
///
/// The walk is BFS with cycle protection, strength accumulation, and an
/// optional relation-filter. `max_hops` is capped at 10 so a pathological
/// call cannot push the SQLite CTE depth limit or swamp the daemon.
pub async fn handle_walk_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let Some(from) = request_field(request, "from") else {
        return serde_json::json!({"ok": false, "error": "from is required"});
    };
    let from = from.to_string();

    // Cap max_hops at 10 so no caller can push the traversal past the
    // default SQLite CTE depth or swamp the daemon on a dense graph.
    let max_hops = request
        .get("max_hops")
        .and_then(|v| v.as_u64())
        .unwrap_or(3)
        .min(10) as u32;

    let relations: Vec<String> = request
        .get("relations")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();

    let strength_threshold = request
        .get("strength_threshold")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.1) as f32;

    let limit = request
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(50)
        .min(100) as usize;

    // Visibility gate: resolve the requesting agent's anchor set so every
    // visited node (both endpoints) is clipped to what the agent can see.
    // Without an `agent_id` we fall back to globals + everything the store
    // sees — the admin / internal path. With an `agent_id` the resolver
    // is authoritative.
    let visible_ids: Option<std::collections::HashSet<String>> =
        if let Some(aid) = request_field(request, "agent_id") {
            match ctx.agent_registry.list_ideas_visible_to(aid).await {
                Ok(list) => Some(list.into_iter().map(|i| i.id).collect()),
                Err(e) => {
                    return serde_json::json!({
                        "ok": false,
                        "error": format!("visibility lookup failed: {e}"),
                    });
                }
            }
        } else {
            None
        };

    // If the agent can't see `from`, the walk must stop at the boundary
    // (hard-fail rather than silently returning empty so callers notice).
    if let Some(ref visible) = visible_ids
        && !visible.contains(&from)
    {
        return serde_json::json!({
            "ok": false,
            "error": "from is not visible to this agent",
        });
    }

    let raw_steps = match idea_store
        .walk(&from, max_hops, &relations, strength_threshold)
        .await
    {
        Ok(s) => s,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Post-filter: drop steps whose accumulated strength is below the
    // threshold, and whose endpoints aren't visible to the caller. Both
    // `from` and `to` must be visible — otherwise a walk can cross an
    // agent boundary at the second hop even though the start is in scope.
    let filtered_steps: Vec<&aeqi_core::traits::WalkStep> = raw_steps
        .iter()
        .filter(|step| step.strength >= strength_threshold)
        .filter(|step| match &visible_ids {
            Some(visible) => visible.contains(&step.from) && visible.contains(&step.to),
            None => true,
        })
        .take(limit)
        .collect();

    // Enrich the steps with the target idea's name and tags so UI/LLM
    // consumers don't have to round-trip through another `get_by_ids`.
    let node_ids: Vec<String> = filtered_steps.iter().map(|s| s.to.clone()).collect();
    let nodes: std::collections::HashMap<String, aeqi_core::traits::Idea> = if node_ids.is_empty() {
        std::collections::HashMap::new()
    } else {
        match idea_store.get_by_ids(&node_ids).await {
            Ok(items) => items.into_iter().map(|i| (i.id.clone(), i)).collect(),
            Err(_) => std::collections::HashMap::new(),
        }
    };

    let steps_json: Vec<serde_json::Value> = filtered_steps
        .into_iter()
        .map(|s| {
            let (name, tags) = match nodes.get(&s.to) {
                Some(i) => (Some(i.name.clone()), i.tags.clone()),
                None => (None, Vec::new()),
            };
            serde_json::json!({
                "from": s.from,
                "to": s.to,
                "relation": s.relation,
                "depth": s.depth,
                "strength": s.strength,
                "to_name": name,
                "to_tags": tags,
            })
        })
        .collect();

    serde_json::json!({
        "ok": true,
        "from": from,
        "count": steps_json.len(),
        "steps": steps_json,
    })
}

/// Record a feedback signal on an idea (used | useful | ignored | wrong |
/// corrected | pinned). Updates the row's `feedback_boost`, appends a
/// row to `idea_feedback`, invalidates the recall cache.
pub async fn handle_feedback_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let Some(id) = request_field(request, "id") else {
        return serde_json::json!({"ok": false, "error": "id is required"});
    };
    let Some(signal) = request_field(request, "signal") else {
        return serde_json::json!({"ok": false, "error": "signal is required"});
    };
    // Guardrail: accept only the documented signal vocabulary.
    if !matches!(
        signal,
        "used" | "useful" | "ignored" | "corrected" | "wrong" | "pinned"
    ) {
        return serde_json::json!({
            "ok": false,
            "error": format!("unknown signal: {signal}")
        });
    }

    let weight = request
        .get("weight")
        .and_then(|v| v.as_f64())
        .map(|f| f as f32)
        .unwrap_or(1.0);

    let meta = aeqi_core::traits::FeedbackMeta {
        agent_id: request_field(request, "agent_id").map(str::to_string),
        session_id: request_field(request, "session_id").map(str::to_string),
        query_text: request_field(request, "query_text").map(str::to_string),
        note: request_field(request, "note").map(str::to_string),
    };

    // Scope visibility guard. Callers that announce themselves as an agent
    // can only record feedback on ideas they can actually see — otherwise
    // a compromised or misrouted agent could move the feedback signal on
    // a sibling's private idea. Callers without an `agent_id` (global /
    // admin / internal daemon invocations) bypass this check, matching the
    // read-side scope model where an unscoped caller sees everything.
    if let Some(aid) = meta.agent_id.as_deref() {
        let visible = ctx
            .agent_registry
            .list_ideas_visible_to(aid)
            .await
            .unwrap_or_default();
        if !visible.iter().any(|i| i.id == id) {
            return serde_json::json!({
                "ok": false,
                "error": "idea not visible to this agent",
            });
        }
    }

    if let Some(response) = unsupported_capability_response(
        idea_store.as_ref(),
        "record_feedback",
        IdeaStoreCapability::Feedback,
    ) {
        return response;
    }

    match idea_store.record_feedback(id, signal, weight, meta).await {
        Ok(()) => {
            ctx.recall_cache.invalidate();
            serde_json::json!({"ok": true})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

fn idea_to_json(idea: &aeqi_core::traits::Idea) -> serde_json::Value {
    serde_json::json!({
        "id": idea.id,
        "name": idea.name,
        "content": idea.content,
        "tags": idea.tags,
        "agent_id": idea.agent_id,
        "scope": idea.scope.as_str(),
        "created_at": idea.created_at.to_rfc3339(),
        "session_id": idea.session_id,
        "score": idea.score,
        "inheritance": idea.inheritance,
        "tool_allow": idea.tool_allow,
        "tool_deny": idea.tool_deny,
        // Tables-in-Ideas Phase 2.
        "parent_idea_id": idea.parent_idea_id,
        "properties": idea.properties,
        "kind": idea.kind,
        "file_id": idea.file_id,
    })
}

pub async fn handle_idea_profile(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let project = request
        .get("project")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if allowed.is_some() && (project.is_empty() || project == "*") {
        return serde_json::json!({"ok": true, "profile": {"static": [], "dynamic": []}});
    }

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": true, "profile": {"static": [], "dynamic": []}});
    };

    let static_tags: Vec<String> = ["fact", "preference", "evergreen"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let dynamic_tags: Vec<String> = ["decision", "context", "insight", "procedure"]
        .iter()
        .map(|s| s.to_string())
        .collect();

    let static_ideas: Vec<serde_json::Value> =
        match idea_store.ideas_by_tags(&static_tags, 20).await {
            Ok(items) => items.iter().map(idea_to_profile_json).collect(),
            Err(_) => Vec::new(),
        };
    let dynamic_ideas: Vec<serde_json::Value> =
        match idea_store.ideas_by_tags(&dynamic_tags, 20).await {
            Ok(items) => items.iter().map(idea_to_profile_json).collect(),
            Err(_) => Vec::new(),
        };

    serde_json::json!({
        "ok": true,
        "profile": {
            "static": static_ideas,
            "dynamic": dynamic_ideas,
        }
    })
}

fn idea_to_profile_json(idea: &aeqi_core::traits::Idea) -> serde_json::Value {
    serde_json::json!({
        "id": idea.id,
        "name": idea.name,
        "content": idea.content,
        "tags": idea.tags,
        "created_at": idea.created_at.to_rfc3339(),
    })
}

pub async fn handle_idea_graph(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let agent_id = request.get("agent_id").and_then(|v| v.as_str());
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(50) as usize;

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": true, "nodes": [], "edges": []});
    };

    // Ancestry-aware scoping: self + descendants + globals (agent_id IS NULL)
    // is handled inside list_ideas_visible_to on AgentRegistry. Without an
    // agent_id we mirror `list_ideas` and return the full visible corpus.
    let ideas: Vec<aeqi_core::traits::Idea> = if let Some(aid) = agent_id {
        match ctx.agent_registry.list_ideas_visible_to(aid).await {
            Ok(mut items) => {
                items.truncate(limit);
                items
            }
            Err(_) => Vec::new(),
        }
    } else {
        idea_store.search_by_prefix("", limit).unwrap_or_default()
    };

    let nodes: Vec<serde_json::Value> = ideas.iter().map(idea_to_graph_node).collect();
    let node_ids: Vec<String> = ideas.iter().map(|i| i.id.clone()).collect();

    let edges: Vec<serde_json::Value> = if node_ids.is_empty() {
        Vec::new()
    } else {
        let id_set: std::collections::HashSet<&str> = node_ids.iter().map(|s| s.as_str()).collect();
        match idea_store.edges_between(&node_ids).await {
            Ok(raw) => raw
                .into_iter()
                .filter(|e| {
                    id_set.contains(e.source_id.as_str()) && id_set.contains(e.target_id.as_str())
                })
                .map(|e| {
                    serde_json::json!({
                        "source": e.source_id,
                        "target": e.target_id,
                        "relation": e.relation,
                        "strength": e.strength,
                    })
                })
                .collect(),
            Err(_) => Vec::new(),
        }
    };

    serde_json::json!({
        "ok": true,
        "nodes": nodes,
        "edges": edges,
    })
}

fn idea_to_graph_node(idea: &aeqi_core::traits::Idea) -> serde_json::Value {
    use std::hash::{Hash, Hasher};

    let mut h = std::collections::hash_map::DefaultHasher::new();
    idea.name.hash(&mut h);
    let x = (h.finish() % 1000) as u32;

    let mut h2 = std::collections::hash_map::DefaultHasher::new();
    idea.content.hash(&mut h2);
    let y = (h2.finish() % 1000) as u32;

    let age_secs = (chrono::Utc::now() - idea.created_at).num_seconds().max(0) as f64;
    let days = age_secs / 86400.0;
    let lambda = (2.0_f64).ln() / 7.0;
    let hotness = (-lambda * days).exp() as f32;

    let tags: Vec<String> = if idea.tags.is_empty() {
        vec!["untagged".to_string()]
    } else {
        idea.tags.clone()
    };

    serde_json::json!({
        "id": idea.id,
        "name": idea.name,
        "content": idea.content,
        "tags": tags,
        "x": x,
        "y": y,
        "hotness": hotness,
    })
}

pub async fn handle_add_idea_edge(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    let source_id = request_field(request, "source_id").unwrap_or("");
    let target_id = request_field(request, "target_id").unwrap_or("");
    if source_id.is_empty() || target_id.is_empty() {
        return serde_json::json!({"ok": false, "error": "source_id and target_id are required"});
    }
    if source_id == target_id {
        return serde_json::json!({"ok": false, "error": "source and target must differ"});
    }
    let relation = request_field(request, "relation").unwrap_or(aeqi_ideas::relation::LINK);
    // Mirror the guard in `handle_link_idea`: substrate-writable relations
    // must be one of `mention` / `embed` / `link` (T1.8 collapse).
    if !aeqi_ideas::relation::is_substrate_writable(relation) {
        return serde_json::json!({
            "ok": false,
            "error": format!(
                "relation '{relation}' is not writable through this surface. \
                 Expected one of: mention, embed, link (T1.8 collapsed the legacy typed vocabulary)."
            ),
        });
    }
    let strength = request
        .get("strength")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;

    match idea_store
        .store_idea_edge(source_id, target_id, relation, strength)
        .await
    {
        Ok(()) => {
            ctx.recall_cache.invalidate();
            serde_json::json!({"ok": true})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_remove_idea_edge(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };
    let source_id = match request_field(request, "source_id") {
        Some(v) => v,
        None => return serde_json::json!({"ok": false, "error": "source_id is required"}),
    };
    let target_id = match request_field(request, "target_id") {
        Some(v) => v,
        None => return serde_json::json!({"ok": false, "error": "target_id is required"}),
    };
    let relation = request_field(request, "relation");

    match idea_store
        .remove_idea_edge(source_id, target_id, relation)
        .await
    {
        Ok(removed) => {
            ctx.recall_cache.invalidate();
            serde_json::json!({"ok": true, "removed": removed})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_idea_edges(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };
    let idea_id = match request_field(request, "idea_id") {
        Some(id) => id,
        None => return serde_json::json!({"ok": false, "error": "idea_id is required"}),
    };

    let edges = match idea_store.idea_edges(idea_id).await {
        Ok(e) => e,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    let links: Vec<serde_json::Value> = edges
        .links
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "target_kind": r.other_kind,
                "target_id": r.other_id,
                "name": r.other_name,
                "relation": r.relation,
                "strength": r.strength,
            })
        })
        .collect();
    let backlinks: Vec<serde_json::Value> = edges
        .backlinks
        .into_iter()
        .map(|r| {
            serde_json::json!({
                "source_kind": r.other_kind,
                "source_id": r.other_id,
                "name": r.other_name,
                "relation": r.relation,
                "strength": r.strength,
            })
        })
        .collect();

    serde_json::json!({
        "ok": true,
        "links": links,
        "backlinks": backlinks,
    })
}

/// `ideas.references(idea_id)` — list every outgoing reference for an
/// idea, kind-aware. Convenience surface added in T1.8 for UI consumers
/// that want a flat `(kind, id, relation, strength)` list across all
/// entity kinds (sessions, quests, agents, …) without going through
/// `idea_edges` and re-derived names.
pub async fn handle_idea_references(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };
    let Some(idea_id) = request_field(request, "idea_id").or_else(|| request_field(request, "id"))
    else {
        return serde_json::json!({"ok": false, "error": "idea_id is required"});
    };

    match idea_store.idea_references(idea_id).await {
        Ok(refs) => {
            let payload: Vec<serde_json::Value> = refs
                .iter()
                .map(|r| {
                    serde_json::json!({
                        "kind": r.kind,
                        "id": r.id,
                        "relation": r.relation,
                        "strength": r.strength,
                    })
                })
                .collect();
            serde_json::json!({ "ok": true, "references": payload })
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

pub async fn handle_idea_prefix(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let prefix = request.get("prefix").and_then(|v| v.as_str()).unwrap_or("");
    let limit = request.get("limit").and_then(|v| v.as_u64()).unwrap_or(100) as usize;

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    match idea_store.search_by_prefix(prefix, limit) {
        Ok(entries) => {
            let ideas: Vec<serde_json::Value> = entries
                .iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.id,
                        "name": e.name,
                        "content": e.content,
                        "tags": e.tags,
                        "agent_id": e.agent_id,
                        "created_at": e.created_at.to_rfc3339(),
                    })
                })
                .collect();
            serde_json::json!({"ok": true, "ideas": ideas, "count": ideas.len()})
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

// ── activity / session helpers ───────────────────────────────────────────────

/// Resolve an idea's session id, creating one lazily if needed.
///
/// Mirrors the lazy-create block in `handle_message_to` for `target_kind="idea"`:
/// when `ideas.session_id` is null, mint a standalone session and backfill the
/// idea row. The result is the canonical session id for emitting comments,
/// activity, or subscribing participants.
pub(super) async fn ensure_idea_session(
    ctx: &super::CommandContext,
    idea_store: &dyn IdeaStore,
    idea_id: &str,
) -> std::result::Result<String, String> {
    let idea = idea_store
        .get_by_ids(&[idea_id.to_string()])
        .await
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "idea not found".to_string())?;

    if let Some(sid) = idea.session_id {
        return Ok(sid);
    }

    let Some(ref ss) = ctx.session_store else {
        return Err("session store not available".to_string());
    };

    let sid = ss
        .create_standalone_session(&format!("idea:{}", idea.name), "idea")
        .await
        .map_err(|e| e.to_string())?;

    let pool = ctx.agent_registry.db();
    let conn = pool.lock().await;
    conn.execute(
        "UPDATE ideas SET session_id = ?1 WHERE id = ?2",
        rusqlite::params![sid.as_str(), idea_id],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);

    Ok(sid)
}

/// Emit an "idea_<verb>" activity row into the idea's backing session.
///
/// Lazy-creates the session if one doesn't exist yet. `verb` is the short
/// summary the comment row stores ("created" / "edited" / "deleted") and the
/// metadata records the actor identity for the activity feed's chrome.
///
/// All failures are logged at WARN and swallowed — the source mutation has
/// already succeeded; an activity-emit failure must not propagate as a
/// caller-facing error.
async fn emit_idea_activity(
    ctx: &super::CommandContext,
    idea_store: &dyn IdeaStore,
    idea_id: &str,
    verb: &'static str,
    actor_user_id: Option<&str>,
) {
    let session_id = match ensure_idea_session(ctx, idea_store, idea_id).await {
        Ok(sid) => sid,
        Err(e) => {
            tracing::warn!(idea = %idea_id, error = %e, "emit_idea_activity: ensure_session failed");
            return;
        }
    };

    let Some(ref ss) = ctx.session_store else {
        return;
    };

    let kind_tag = format!("idea_{verb}");
    let actor_kind = if actor_user_id.is_some() {
        "user"
    } else {
        "system"
    };
    let metadata = serde_json::json!({
        "kind": kind_tag,
        "actor_user_id": actor_user_id,
        "actor_kind": actor_kind,
    });

    if let Err(e) = ss
        .append_system_activity(&session_id, verb, &metadata)
        .await
    {
        tracing::warn!(
            idea = %idea_id,
            verb = verb,
            error = %e,
            "emit_idea_activity: append_system_activity failed"
        );
    }
}

// ── @-mention wiring ─────────────────────────────────────────────────────────

/// Parse `@<token>` mentions from an idea body and:
///
/// 1. Insert `entity_edges(source_kind="idea", source_id=idea_id,
///    target_kind=<kind>, target_id=<resolved_id>, relation="mention_of")`
///    via `INSERT OR IGNORE` (idempotent).
/// 2. If the idea has a session, auto-subscribe each resolved identity as a
///    `session_participant` with `joined_by = "mention"`.
/// 3. Emit a `"<kind>:<id> mentioned"` system message in the idea's session
///    (only when the participant row was new — prevents duplicate noise).
///
/// Fuzzy mentions (bare `@name`) attempt resolution in this order:
///   agent by name → (position lookup not yet implemented, treated as fuzzy
///   no-op when unresolved). Unresolved fuzzy mentions are skipped silently.
///
/// All errors are swallowed — mention wiring is best-effort enrichment,
/// never a store precondition.
async fn wire_at_mentions_on_idea(
    ctx: &super::CommandContext,
    idea_store: &dyn IdeaStore,
    idea_id: &str,
    body: &str,
) {
    let mentions = crate::mentions::parse_mentions(body);
    if mentions.is_empty() {
        return;
    }

    // Look up the idea's session_id so we can subscribe mentioned identities.
    let session_id: Option<String> = idea_store
        .get_by_ids(&[idea_id.to_string()])
        .await
        .ok()
        .and_then(|mut v| v.pop())
        .and_then(|i| i.session_id);

    let ss = ctx.session_store.as_ref();

    for m in &mentions {
        // Resolve fuzzy mentions via agent-name lookup.
        let (resolved_kind, resolved_id): (&str, String) = match m.kind.as_str() {
            crate::mentions::KIND_AGENT => (crate::mentions::KIND_AGENT, m.id.clone()),
            crate::mentions::KIND_USER => (crate::mentions::KIND_USER, m.id.clone()),
            crate::mentions::KIND_POSITION => (crate::mentions::KIND_POSITION, m.id.clone()),
            crate::mentions::KIND_FUZZY => {
                // Try agent by name first.
                match ctx.agent_registry.get_active_by_name(&m.id).await {
                    Ok(Some(agent)) => (crate::mentions::KIND_AGENT, agent.id),
                    _ => {
                        // Unresolved — skip gracefully.
                        tracing::debug!(name = %m.id, "wire_at_mentions: unresolved fuzzy mention");
                        continue;
                    }
                }
            }
            _ => continue,
        };

        // 1. Insert entity edge (idempotent).
        let _ = idea_store
            .store_entity_edge(
                "idea",
                idea_id,
                resolved_kind,
                &resolved_id,
                "mention_of",
                1.0,
            )
            .await;

        // 2 + 3. Auto-subscribe in session when one exists.
        if let (Some(sid), Some(ss)) = (session_id.as_deref(), ss) {
            let inserted = ss
                .add_session_participant(sid, resolved_kind, &resolved_id, Some("mention"))
                .await
                .unwrap_or(false);

            if inserted {
                let body = format!("{resolved_kind}:{resolved_id} mentioned");
                let _ = ss
                    .append_message_from(sid, "system", &body, "system", None, None)
                    .await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Fix #7: empty content is allowed ─────────────────────────────
    //
    // `parse_store_request` only enforces `name` presence. Empty or missing
    // `content` resolves to an empty String, and the full handler must
    // still dispatch to Create. Callers send marker ideas and lifecycle
    // stubs (e.g. `session:stopped`) with body-less bodies.

    #[test]
    fn parse_store_request_accepts_empty_content() {
        let req = serde_json::json!({ "name": "marker-idea", "content": "" });
        let parsed = parse_store_request(&req).expect("empty content must parse");
        assert_eq!(parsed.name, "marker-idea");
        assert!(parsed.content.is_empty());
    }

    #[test]
    fn parse_store_request_accepts_missing_content_field() {
        let req = serde_json::json!({ "name": "just-a-name" });
        let parsed = parse_store_request(&req).expect("omitted content must parse");
        assert_eq!(parsed.name, "just-a-name");
        assert!(parsed.content.is_empty());
    }

    #[test]
    fn parse_store_request_rejects_empty_name() {
        let req = serde_json::json!({ "name": "", "content": "body" });
        match parse_store_request(&req) {
            Ok(_) => panic!("empty name must fail"),
            Err(e) => assert!(e.contains("name")),
        }
    }

    #[test]
    fn parse_store_request_rejects_missing_name() {
        let req = serde_json::json!({ "content": "body" });
        match parse_store_request(&req) {
            Ok(_) => panic!("missing name must fail"),
            Err(e) => assert!(e.contains("name")),
        }
    }

    // ── Fix #6: unique-constraint downcast ──────────────────────────
    //
    // The safety net in `dispatch_create` only fires when the inner cause is
    // a rusqlite `SqliteFailure` with extended code `SQLITE_CONSTRAINT_UNIQUE`.
    // Exercise the detector against a real UNIQUE collision in a throwaway
    // in-memory connection so the downcast chain and the extended-code match
    // stay in sync with rusqlite's wire shape.

    #[test]
    fn is_unique_constraint_error_detects_unique_collision() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE t (name TEXT NOT NULL UNIQUE)",
            rusqlite::params![],
        )
        .unwrap();
        conn.execute("INSERT INTO t(name) VALUES ('a')", rusqlite::params![])
            .unwrap();
        let err = conn
            .execute("INSERT INTO t(name) VALUES ('a')", rusqlite::params![])
            .unwrap_err();
        let anyhow_err: anyhow::Error = anyhow::Error::new(err);
        assert!(is_unique_constraint_error(&anyhow_err));
    }

    #[test]
    fn is_unique_constraint_error_rejects_other_errors() {
        let anyhow_err: anyhow::Error = anyhow::anyhow!("some unrelated failure");
        assert!(!is_unique_constraint_error(&anyhow_err));
    }

    // ── T1.1 — `dedup_window_hours` retroactive cutoff ────────────────
    //
    // `find_similar_for_dedup` filters BM25 candidates to those created
    // within `dedup_window_hours` when set. None preserves the pre-T1.1
    // unbounded view byte-for-byte. The filter operates on
    // `Idea::created_at` post-search, so an empty store still yields an
    // empty similar set in either mode.

    #[tokio::test]
    async fn t1_1_dedup_window_none_returns_full_candidate_set() {
        // Baseline: unset window → behaviour identical to the pre-T1.1
        // path (no time filter applied to the BM25 result list).
        use aeqi_ideas::SqliteIdeas;
        use std::sync::Arc;

        let dir = tempfile::TempDir::new().unwrap();
        let store = SqliteIdeas::open(&dir.path().join("d.db"), 30.0).unwrap();
        let store: Arc<dyn aeqi_core::traits::IdeaStore> = Arc::new(store);
        // Seed an idea with words that build a meaningful FTS query. Use
        // single-word tokens to avoid `/` and `-` interactions inside the
        // tokenizer.
        store
            .store(
                "login flow",
                "The login uses JWT tokens with 24 hour expiry",
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();

        // Window = None → result includes the seed.
        let similar = find_similar_for_dedup(
            store.as_ref(),
            "login flow",
            "The login uses JWT tokens with 24 hour expiry",
            None,
            None,
        )
        .await;
        assert!(
            !similar.is_empty(),
            "baseline (window=None) must surface the matching idea"
        );
    }

    #[tokio::test]
    async fn t1_1_dedup_window_six_hours_includes_recent_ideas() {
        // Activation: window=6 → recent ideas (created just now) still
        // surface in the similar set. Tests the positive path of the
        // cutoff: ideas inside the window pass the filter.
        use aeqi_ideas::SqliteIdeas;
        use std::sync::Arc;

        let dir = tempfile::TempDir::new().unwrap();
        let store = SqliteIdeas::open(&dir.path().join("d.db"), 30.0).unwrap();
        let store: Arc<dyn aeqi_core::traits::IdeaStore> = Arc::new(store);
        store
            .store(
                "login flow",
                "The login uses JWT tokens with 24 hour expiry",
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();

        let similar = find_similar_for_dedup(
            store.as_ref(),
            "login flow",
            "The login uses JWT tokens with 24 hour expiry",
            None,
            Some(6),
        )
        .await;
        assert!(
            !similar.is_empty(),
            "recently-stored idea must remain in window=6"
        );
    }

    #[tokio::test]
    async fn t1_1_dedup_window_drops_pre_existing_rows_when_zero_or_negative_treated_as_none() {
        // Negative / zero values must be tolerated and treated as "no
        // filter" (defensive: prevents a foot-gun config from silently
        // killing the dedup view).
        use aeqi_ideas::SqliteIdeas;
        use std::sync::Arc;

        let dir = tempfile::TempDir::new().unwrap();
        let store = SqliteIdeas::open(&dir.path().join("d.db"), 30.0).unwrap();
        let store: Arc<dyn aeqi_core::traits::IdeaStore> = Arc::new(store);
        store
            .store(
                "login flow",
                "The login uses JWT tokens with 24 hour expiry",
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();

        let negative = find_similar_for_dedup(
            store.as_ref(),
            "login flow",
            "The login uses JWT tokens with 24 hour expiry",
            None,
            Some(-5),
        )
        .await;
        assert!(
            !negative.is_empty(),
            "negative window must be ignored, behaviour identical to None"
        );
        let zero = find_similar_for_dedup(
            store.as_ref(),
            "login flow",
            "The login uses JWT tokens with 24 hour expiry",
            None,
            Some(0),
        )
        .await;
        assert!(
            !zero.is_empty(),
            "zero window must be ignored, behaviour identical to None"
        );
    }

    #[tokio::test]
    async fn t1_1_dedup_window_drops_old_rows_via_synthetic_created_at() {
        // Activation: window=1 → an idea whose `created_at` is older than
        // 1h ago must be filtered out. Override `created_at` directly via
        // SQL since `store_full` stamps "now".
        use aeqi_ideas::SqliteIdeas;
        use std::sync::Arc;

        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("d.db");
        let store = SqliteIdeas::open(&db_path, 30.0).unwrap();
        let store: Arc<dyn aeqi_core::traits::IdeaStore> = Arc::new(store);
        store
            .store(
                "login flow",
                "The login uses JWT tokens with 24 hour expiry",
                &["fact".to_string()],
                None,
            )
            .await
            .unwrap();

        // Push the row's `created_at` 25 hours into the past. The idea is
        // still in the FTS index (which keys on rowid, not created_at) so
        // BM25 still finds it; only the post-search window filter should
        // remove it.
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        let old = (chrono::Utc::now() - chrono::Duration::hours(25)).to_rfc3339();
        conn.execute("UPDATE ideas SET created_at = ?1", rusqlite::params![old])
            .unwrap();
        drop(conn);

        // Baseline (no window) — idea still surfaces.
        let baseline = find_similar_for_dedup(
            store.as_ref(),
            "login flow",
            "The login uses JWT tokens with 24 hour expiry",
            None,
            None,
        )
        .await;
        assert!(
            !baseline.is_empty(),
            "old idea must still surface when no window is set"
        );

        // 1h window — old idea is filtered out.
        let windowed = find_similar_for_dedup(
            store.as_ref(),
            "login flow",
            "The login uses JWT tokens with 24 hour expiry",
            None,
            Some(1),
        )
        .await;
        assert!(
            windowed.is_empty(),
            "1h window must drop a 25h-old row, got {windowed:?}"
        );
    }

    #[tokio::test]
    async fn store_dedup_scores_topical_search_hit_as_novel() {
        use aeqi_ideas::SqliteIdeas;
        use std::sync::Arc;

        let dir = tempfile::TempDir::new().unwrap();
        let store = SqliteIdeas::open(&dir.path().join("d.db"), 30.0).unwrap();
        let store: Arc<dyn aeqi_core::traits::IdeaStore> = Arc::new(store);
        store
            .store(
                "mcp-vector-verification-1778618251324",
                "Vector embedding verification for Aeqi MCP ideas. Search should retrieve this by semantic phrase after embedding worker runs.",
                &["mcp".to_string(), "vector".to_string(), "verification".to_string()],
                None,
            )
            .await
            .unwrap();

        let similar = find_similar_for_dedup(
            store.as_ref(),
            "Clean worktree deploys for AEQI platform host runtime changes",
            "Deploy AEQI platform/runtime binaries from clean worktrees based on remote main. Verify hosted MCP and code.index.",
            None,
            None,
        )
        .await;

        assert!(
            similar.iter().all(|hit| hit.similarity < 0.85),
            "topical search hits must not become duplicate candidates: {similar:?}"
        );
    }
}

// ── Wave-2 session-unified idea handlers ─────────────────────────────────────

/// `idea_activity` command: merged chronological activity feed for an idea.
///
/// Returns rows from two sources, merged by timestamp ascending:
///   - `activity` table rows whose `session_id` matches the idea's session
///     (emitted as `kind: "log"`)
///   - `session_messages` rows where `from_kind = 'system'` in the same
///     session (emitted as `kind: "system_message"`)
///
/// When the idea has no `session_id` yet, both sources are empty and the
/// handler returns an empty items array.
///
/// Tenancy: the caller's `allowed_roots` must include the root entity that
/// owns the idea's anchor agent.
pub async fn handle_idea_activity(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let idea_id = match super::request_field(request, "idea_id") {
        Some(id) => id.to_string(),
        None => return serde_json::json!({"ok": false, "error": "idea_id required"}),
    };

    // Resolve the idea.
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };
    let idea = match idea_store.get_by_ids(std::slice::from_ref(&idea_id)).await {
        Ok(ideas) if !ideas.is_empty() => ideas.into_iter().next().unwrap(),
        Ok(_) => return serde_json::json!({"ok": false, "error": "idea not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Tenancy check: the idea must belong to an agent in the allowed scope.
    if let Some(ref aid) = idea.agent_id {
        if !super::tenancy::check_agent_access(&ctx.agent_registry, allowed, aid).await {
            return serde_json::json!({"ok": false, "error": "access denied"});
        }
    } else if allowed.is_some() {
        // Global ideas are readable by everyone when running in platform mode
        // (operator sees all), but we don't gate on entity here.
    }

    let Some(ref session_id) = idea.session_id else {
        return serde_json::json!({"ok": true, "items": []});
    };

    // Collect activity-log rows whose session_id matches the idea's session.
    let mut items: Vec<serde_json::Value> = Vec::new();

    let activity_filter = crate::activity_log::EventFilter {
        session_id: Some(session_id.clone()),
        ..Default::default()
    };
    if let Ok(events) = ctx.activity_log.query(&activity_filter, 200, 0).await {
        for ev in events {
            items.push(serde_json::json!({
                "kind": "log",
                "at": ev.created_at.to_rfc3339(),
                "payload": ev.content,
            }));
        }
    }

    // Collect system messages from session_messages.
    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };
    match ss.system_messages_by_session(session_id, 200).await {
        Ok(msgs) => {
            for m in msgs {
                items.push(serde_json::json!({
                    "kind": "system_message",
                    "at": m.timestamp.to_rfc3339(),
                    "body": m.content,
                    "payload": m.metadata,
                }));
            }
        }
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    }

    // Sort by "at" string — ISO 8601 sorts lexicographically.
    items.sort_by(|a, b| {
        let ta = a.get("at").and_then(|v| v.as_str()).unwrap_or("");
        let tb = b.get("at").and_then(|v| v.as_str()).unwrap_or("");
        ta.cmp(tb)
    });

    serde_json::json!({"ok": true, "items": items})
}

/// `idea_comments` command: conversation messages on an idea's session.
///
/// Returns `session_messages` rows where `from_kind != 'system'` (or
/// `from_kind IS NULL` with a non-system `role`). Each item carries
/// `{ id, from_kind, from_id, body, at }`.
///
/// Response shape:
///
/// ```json
/// {
///   "ok": true,
///   "session_id": "<idea.session_id or null>",
///   "subscribed": true|false,
///   "items": [...]
/// }
/// ```
///
/// `session_id` is the idea's backing session — the value the conversation
/// panel needs when calling `add_participant`. `subscribed` is whether the
/// calling user (resolved from the request's `caller_user_id`, set by the
/// web layer from JWT claims) currently has a `session_participants` row
/// with `identity_kind="user"` and a matching `identity_id`. `subscribed`
/// is `false` when the caller has no user identity (operator / system call)
/// or when the idea has no session yet.
pub async fn handle_idea_comments(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let idea_id = match super::request_field(request, "idea_id") {
        Some(id) => id.to_string(),
        None => return serde_json::json!({"ok": false, "error": "idea_id required"}),
    };

    // Caller identity comes from the web layer's `ipc_proxy`, which copies
    // the JWT-resolved user id off `UserScope` into the request payload.
    let caller_user_id = super::request_field(request, "caller_user_id").map(str::to_string);

    // Resolve the idea.
    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };
    let idea = match idea_store.get_by_ids(std::slice::from_ref(&idea_id)).await {
        Ok(ideas) if !ideas.is_empty() => ideas.into_iter().next().unwrap(),
        Ok(_) => return serde_json::json!({"ok": false, "error": "idea not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Tenancy check: same as activity.
    if let Some(ref aid) = idea.agent_id
        && !super::tenancy::check_agent_access(&ctx.agent_registry, allowed, aid).await
    {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let Some(ref session_id) = idea.session_id else {
        return serde_json::json!({
            "ok": true,
            "session_id": serde_json::Value::Null,
            "subscribed": false,
            "items": [],
        });
    };

    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };

    // Resolve subscribe state by probing participants. Cheap single SQL.
    let subscribed = if let Some(ref uid) = caller_user_id {
        match ss.list_participants(session_id).await {
            Ok(rows) => rows
                .iter()
                .any(|p| p.identity_kind == "user" && &p.identity_id == uid),
            Err(_) => false,
        }
    } else {
        false
    };

    match ss.conversation_messages_by_session(session_id, 200).await {
        Ok(msgs) => {
            // Resolve display names for each (from_kind, from_id) pair so the
            // frontend renders avatar hue + initials off a stable string that
            // matches the rest of the app (where avatars are computed from
            // display name, not raw UUID). Authors with no resolvable record
            // fall back to a "User <prefix>" placeholder so hue still beats
            // the all-zero UUID-prefix collision.
            let mut items: Vec<serde_json::Value> = Vec::with_capacity(msgs.len());
            for m in &msgs {
                let author =
                    resolve_author_name(ctx, m.from_kind.as_deref(), m.from_id.as_deref()).await;
                items.push(serde_json::json!({
                    "id": m.id,
                    "from_kind": m.from_kind,
                    "from_id": m.from_id,
                    "author": author,
                    "body": m.content,
                    "at": m.timestamp.to_rfc3339(),
                }));
            }
            serde_json::json!({
                "ok": true,
                "session_id": session_id,
                "subscribed": subscribed,
                "items": items,
            })
        }
        Err(e) => serde_json::json!({"ok": false, "error": e.to_string()}),
    }
}

/// Resolve a `(from_kind, from_id)` pair to the display name the frontend
/// should use for avatar hue + initials.
///
/// - `agent` → `agent_registry.get(id)?.name`
/// - `role`  → `role_registry.get(id)?.title`
/// - `system` → `"System"` (system rows render via the activity feed, not
///   the comments list, but resolve them anyway for completeness)
/// - `user` → no cross-DB user lookup yet; returns a stable
///   `"User <first6>"` placeholder. The frontend can override for the caller
///   from `useAuthStore` since every message authored by the caller IS the
///   caller.
/// - Anything unresolved or missing → falls back to the raw `from_id` (or the
///   `from_kind` when even that is missing).
async fn resolve_author_name(
    ctx: &super::CommandContext,
    from_kind: Option<&str>,
    from_id: Option<&str>,
) -> String {
    match (from_kind, from_id) {
        (Some("agent"), Some(id)) => match ctx.agent_registry.get(id).await {
            Ok(Some(a)) => a.name,
            _ => id.to_string(),
        },
        (Some("role"), Some(id)) => match ctx.role_registry.get(id).await {
            Ok(Some(r)) => r.title,
            _ => id.to_string(),
        },
        (Some("system"), _) => "System".to_string(),
        (Some("user"), Some(id)) => {
            let prefix: String = id.chars().take(6).collect();
            format!("User {prefix}")
        }
        (_, Some(id)) => id.to_string(),
        (Some(k), None) => k.to_string(),
        (None, None) => "unknown".to_string(),
    }
}

/// `subscribe_to_idea` IPC handler.
///
/// Lazy-creates the idea's session if one doesn't exist yet, then inserts
/// the calling user into `session_participants`. Returns the session id so
/// downstream operations (composer, polling) can use it.
///
/// Request shape:
/// ```json
/// { "idea_id": "<id>", "caller_user_id": "<uid>" }
/// ```
///
/// `caller_user_id` is supplied by the web layer's `ipc_proxy` from the
/// JWT-resolved scope. Operator / system callers (no user identity) get a
/// `no_user_identity` error rather than a silent no-op so the UI can show
/// a sign-in prompt.
pub async fn handle_subscribe_to_idea(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    let idea_id = match super::request_field(request, "idea_id") {
        Some(id) => id.to_string(),
        None => return serde_json::json!({"ok": false, "error": "idea_id required"}),
    };
    let caller_user_id = match super::request_field(request, "caller_user_id") {
        Some(id) if !id.is_empty() => id.to_string(),
        _ => return serde_json::json!({"ok": false, "error": "no_user_identity"}),
    };

    let Some(ref idea_store) = ctx.idea_store else {
        return serde_json::json!({"ok": false, "error": "idea store not available"});
    };

    // Tenancy check.
    let idea = match idea_store.get_by_ids(std::slice::from_ref(&idea_id)).await {
        Ok(ideas) if !ideas.is_empty() => ideas.into_iter().next().unwrap(),
        Ok(_) => return serde_json::json!({"ok": false, "error": "idea not found"}),
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };
    if let Some(ref aid) = idea.agent_id
        && !super::tenancy::check_agent_access(&ctx.agent_registry, allowed, aid).await
    {
        return serde_json::json!({"ok": false, "error": "access denied"});
    }

    let session_id = match ensure_idea_session(ctx, idea_store.as_ref(), &idea_id).await {
        Ok(sid) => sid,
        Err(e) => return serde_json::json!({"ok": false, "error": e}),
    };

    let Some(ref ss) = ctx.session_store else {
        return serde_json::json!({"ok": false, "error": "session store not available"});
    };

    let inserted = match ss
        .add_session_participant(&session_id, "user", &caller_user_id, Some("subscribe"))
        .await
    {
        Ok(b) => b,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    if inserted {
        let join_body = format!("user:{caller_user_id} joined");
        let _ = ss
            .append_message_from(&session_id, "system", &join_body, "system", None, None)
            .await;
    }

    serde_json::json!({
        "ok": true,
        "session_id": session_id,
        "subscribed": true,
        "inserted": inserted,
    })
}

#[cfg(test)]
mod wave2_tests {
    use super::*;
    use crate::ipc::CommandContext;
    use std::sync::Arc;

    async fn wave2_ctx() -> (
        CommandContext,
        Arc<crate::session_store::SessionStore>,
        Arc<dyn aeqi_core::traits::IdeaStore>,
        tempfile::TempDir,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let registry = Arc::new(crate::agent_registry::AgentRegistry::open(dir.path()).unwrap());
        let sessions_pool = crate::agent_registry::ConnectionPool::in_memory().unwrap();
        {
            let conn = sessions_pool.lock().await;
            crate::session_store::SessionStore::create_tables(&conn).unwrap();
        }
        let ss = Arc::new(crate::session_store::SessionStore::new(Arc::new(
            sessions_pool,
        )));
        let ideas: Arc<dyn aeqi_core::traits::IdeaStore> =
            Arc::new(aeqi_ideas::SqliteIdeas::open(&dir.path().join("aeqi.db"), 30.0).unwrap());
        let event_store = Arc::new(crate::event_handler::EventHandlerStore::new(registry.db()));
        let ctx = build_ctx(
            Arc::clone(&registry),
            Arc::clone(&ss),
            Arc::clone(&ideas),
            event_store,
        );
        (ctx, ss, ideas, dir)
    }

    fn build_ctx(
        registry: Arc<crate::agent_registry::AgentRegistry>,
        ss: Arc<crate::session_store::SessionStore>,
        idea_store: Arc<dyn aeqi_core::traits::IdeaStore>,
        event_store: Arc<crate::event_handler::EventHandlerStore>,
    ) -> CommandContext {
        use crate::dispatch::{DispatchConfig, Dispatcher};
        use crate::ipc::ActivityBuffer;
        use tokio::sync::Mutex;

        let (embed_queue, _rx) = aeqi_ideas::embed_worker::EmbedQueue::channel(8);

        CommandContext {
            metrics: Arc::new(crate::metrics::AEQIMetrics::new()),
            activity_log: Arc::new(crate::activity_log::ActivityLog::new(registry.db())),
            session_store: Some(ss),
            event_handler_store: Some(event_store),
            agent_registry: registry.clone(),
            entity_registry: Arc::new(crate::entity_registry::EntityRegistry::open(registry.db())),
            role_registry: Arc::new(crate::role_registry::RoleRegistry::open(registry.db())),
            idea_store: Some(idea_store),
            message_router: None,
            activity_buffer: Arc::new(Mutex::new(ActivityBuffer::default())),
            default_provider: None,
            default_model: "test".to_string(),
            session_manager: Arc::new(crate::session_manager::SessionManager::new()),
            dispatcher: Arc::new(Dispatcher::new(DispatchConfig::default())),
            daily_budget_usd: 0.0,
            skill_loader: None,
            execution_registry: Arc::new(crate::execution_registry::ExecutionRegistry::new()),
            stream_registry: Arc::new(crate::stream_registry::StreamRegistry::new()),
            channel_spawner: None,
            tag_policy_cache: Arc::new(aeqi_ideas::tag_policy::TagPolicyCache::new(60)),
            embed_queue: Arc::new(embed_queue),
            embedder: None,
            recall_cache: Arc::new(aeqi_ideas::RecallCache::default()),
            pattern_dispatcher: None,
            credentials: None,
        }
    }

    #[tokio::test]
    async fn idea_activity_returns_empty_when_no_session() {
        let (ctx, _ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("act-test", "activity test body", &[], None)
            .await
            .unwrap();

        let req = serde_json::json!({"idea_id": idea_id});
        let resp = handle_idea_activity(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(
            resp["items"].as_array().unwrap().len(),
            0,
            "no session yet — items must be empty"
        );
    }

    #[tokio::test]
    async fn identity_tagged_agent_idea_creates_session_start_event() {
        let (ctx, _ss, _idea_store, _dir) = wave2_ctx().await;
        let agent = ctx
            .agent_registry
            .spawn("identity-agent", None, None)
            .await
            .unwrap();

        let response = handle_store_idea(
            &ctx,
            &serde_json::json!({
                "name": "Persona — identity-agent",
                "content": "IDENTITY SENTINEL",
                "tags": ["identity"],
                "agent_id": agent.id.clone(),
            }),
            &None,
        )
        .await;

        assert_eq!(response["ok"].as_bool(), Some(true), "{response}");
        let idea_id = response["id"].as_str().unwrap();
        let event_store = ctx.event_handler_store.as_ref().unwrap();
        let events = event_store
            .get_events_for_exact_pattern(&agent.id, "session:start")
            .await;
        let event = events
            .iter()
            .find(|event| {
                event.name
                    == crate::identity_subscription::identity_session_start_event_name(idea_id)
            })
            .unwrap_or_else(|| panic!("identity event not found in {events:?}"));

        assert_eq!(event.agent_id.as_deref(), Some(agent.id.as_str()));
        assert_eq!(event.scope, aeqi_core::Scope::SelfScope);
        assert_eq!(event.tool_calls.len(), 1);
        assert_eq!(event.tool_calls[0].tool, "ideas.assemble");
        assert_eq!(
            event.tool_calls[0].args["ids"],
            serde_json::json!([idea_id])
        );
    }

    #[tokio::test]
    async fn idea_activity_returns_system_messages_after_session_created() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("act-test-2", "body", &[], None)
            .await
            .unwrap();

        // First message_to creates the session lazily.
        let msg_req = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "system event text",
            "from_kind": "system",
        });
        let msg_resp = crate::ipc::messages::handle_message_to(&ctx, &msg_req, &None).await;
        assert_eq!(msg_resp["ok"], true, "setup: {msg_resp}");

        let session_id = msg_resp["session_id"].as_str().unwrap().to_string();

        // Verify the session got a system message.
        let sys_msgs = ss
            .system_messages_by_session(&session_id, 10)
            .await
            .unwrap();
        assert_eq!(sys_msgs.len(), 1);
        assert_eq!(sys_msgs[0].content, "system event text");

        // idea_activity should surface it.
        let req = serde_json::json!({"idea_id": idea_id});
        let resp = handle_idea_activity(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        let items = resp["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["kind"], "system_message");
        assert_eq!(items[0]["body"], "system event text");
    }

    #[tokio::test]
    async fn idea_comments_returns_empty_when_no_session() {
        let (ctx, _ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("cmt-test", "comments test body", &[], None)
            .await
            .unwrap();

        let req = serde_json::json!({"idea_id": idea_id});
        let resp = handle_idea_comments(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["items"].as_array().unwrap().len(), 0);
        assert!(
            resp["session_id"].is_null(),
            "no session yet — session_id must be null"
        );
        assert_eq!(
            resp["subscribed"], false,
            "no session — caller cannot be subscribed"
        );
    }

    #[tokio::test]
    async fn idea_comments_returns_user_messages_only() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("cmt-test-2", "body", &[], None)
            .await
            .unwrap();

        // Post a user comment (creates session lazily).
        let user_req = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "user comment",
            "from_kind": "user",
            "from_id": "user-xyz",
        });
        let r = crate::ipc::messages::handle_message_to(&ctx, &user_req, &None).await;
        assert_eq!(r["ok"], true);

        let session_id = r["session_id"].as_str().unwrap().to_string();

        // Post a system message directly so it must not appear in comments.
        ss.append_message_from(&session_id, "system", "sys note", "system", None, None)
            .await
            .unwrap();

        let req = serde_json::json!({"idea_id": idea_id});
        let resp = handle_idea_comments(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        let items = resp["items"].as_array().unwrap();
        assert_eq!(items.len(), 1, "only the user comment should appear");
        assert_eq!(items[0]["body"], "user comment");
        assert_eq!(items[0]["from_kind"], "user");
        assert_eq!(items[0]["from_id"], "user-xyz");
        // Display name resolution: user kinds with no cross-DB lookup get a
        // "User <prefix>" placeholder so avatar hue is keyed off a stable
        // human-readable string instead of the raw UUID.
        assert_eq!(items[0]["author"], "User user-x");
        // Wave-3 envelope fields.
        assert_eq!(
            resp["session_id"].as_str(),
            Some(session_id.as_str()),
            "session_id should match the lazily-created session"
        );
        assert_eq!(
            resp["subscribed"], false,
            "no caller_user_id supplied — must report not-subscribed"
        );
    }

    #[tokio::test]
    async fn idea_comments_resolves_agent_author_name() {
        let (ctx, _ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("cmt-author", "body", &[], None)
            .await
            .unwrap();

        let agent = ctx
            .agent_registry
            .spawn("acme-bot", None, Some("test"))
            .await
            .unwrap();

        // Post a comment from an agent. message_to lazy-creates the session.
        let req = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "agent thinking out loud",
            "from_kind": "agent",
            "from_id": agent.id.clone(),
        });
        let r = crate::ipc::messages::handle_message_to(&ctx, &req, &None).await;
        assert_eq!(r["ok"], true);

        let req = serde_json::json!({"idea_id": idea_id});
        let resp = handle_idea_comments(&ctx, &req, &None).await;
        let items = resp["items"].as_array().unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["from_kind"], "agent");
        assert_eq!(items[0]["from_id"], agent.id);
        assert_eq!(
            items[0]["author"], "acme-bot",
            "agent author must resolve to agent_registry.name"
        );
    }

    #[tokio::test]
    async fn idea_comments_reports_subscribed_when_caller_is_participant() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("cmt-sub", "sub body", &[], None)
            .await
            .unwrap();

        // Create the session.
        let user_req = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "open",
            "from_kind": "user",
            "from_id": "user-sub",
        });
        let r = crate::ipc::messages::handle_message_to(&ctx, &user_req, &None).await;
        assert_eq!(r["ok"], true);
        let session_id = r["session_id"].as_str().unwrap().to_string();

        // Subscribe the caller.
        ss.add_session_participant(&session_id, "user", "user-sub", None)
            .await
            .unwrap();

        let req = serde_json::json!({
            "idea_id": idea_id,
            "caller_user_id": "user-sub",
        });
        let resp = handle_idea_comments(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "response: {resp}");
        assert_eq!(resp["subscribed"], true);

        // A different caller is not subscribed.
        let req_other = serde_json::json!({
            "idea_id": idea_id,
            "caller_user_id": "user-other",
        });
        let resp_other = handle_idea_comments(&ctx, &req_other, &None).await;
        assert_eq!(resp_other["subscribed"], false);
    }

    #[tokio::test]
    async fn idea_activity_requires_idea_id() {
        let (ctx, _ss, _idea_store, _dir) = wave2_ctx().await;
        let resp = handle_idea_activity(&ctx, &serde_json::json!({}), &None).await;
        assert_eq!(resp["ok"], false);
        assert!(resp["error"].as_str().unwrap().contains("idea_id"));
    }

    // ── @-mention on idea save ────────────────────────────────────────────

    #[tokio::test]
    async fn idea_store_with_agent_mention_inserts_entity_edge_and_subscribes() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        // Create a target agent.
        let target_agent = ctx
            .agent_registry
            .spawn("the-agent", None, Some("test"))
            .await
            .unwrap();

        // Store an idea that @-mentions the agent by id.
        let body = format!("see @agent:{} for details", target_agent.id);
        let req = serde_json::json!({
            "name": "mention-idea",
            "content": body,
        });
        let resp = handle_store_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "store: {resp}");
        let idea_id = resp["id"].as_str().unwrap().to_string();

        // Entity edge should exist (check the `links` side of IdeaEdges).
        let edges = idea_store.idea_edges(&idea_id).await.unwrap_or_default();
        let has_edge = edges
            .links
            .iter()
            .any(|e| e.relation == "mention_of" && e.other_id == target_agent.id);
        assert!(
            has_edge,
            "mention_of edge must be present; links: {:?}",
            edges.links
        );

        // After Wave-3+: handle_store_idea now lazy-creates the idea's
        // session at store time so the "created" activity row has somewhere
        // to land. Send a comment anyway to exercise the message_to path
        // and then re-run wire_at_mentions to verify the subscribe wiring.
        let msg_req = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "open this discussion",
            "from_kind": "user",
            "from_id": "user-1",
        });
        let _ = crate::ipc::messages::handle_message_to(&ctx, &msg_req, &None).await;

        // Re-fetch the idea to get its session_id.
        let idea_row = idea_store
            .get_by_ids(std::slice::from_ref(&idea_id))
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let session_id = idea_row
            .session_id
            .expect("session_id must exist after message_to");

        // Now call wire_at_mentions_on_idea directly to test the subscribe path.
        wire_at_mentions_on_idea(&ctx, idea_store.as_ref(), &idea_id, &body).await;

        let participants = ss.list_participants(&session_id).await.unwrap();
        let found = participants
            .iter()
            .any(|p| p.identity_kind == "agent" && p.identity_id == target_agent.id);
        assert!(
            found,
            "mentioned agent must be subscribed; participants: {participants:?}"
        );
    }

    #[tokio::test]
    async fn idea_mention_emits_system_message_in_session() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        let target_agent = ctx
            .agent_registry
            .spawn("notif-agent", None, Some("test"))
            .await
            .unwrap();

        // Store the idea, create a session via message_to, then wire mentions.
        let idea_id = idea_store
            .store("notif-idea", "plain body", &[], None)
            .await
            .unwrap();

        // Create session.
        let msg_req = serde_json::json!({
            "target_kind": "idea",
            "target_id": idea_id,
            "body": "first",
            "from_kind": "user",
            "from_id": "u1",
        });
        let msg_resp = crate::ipc::messages::handle_message_to(&ctx, &msg_req, &None).await;
        let session_id = msg_resp["session_id"].as_str().unwrap().to_string();

        // Wire mentions manually (simulates what finalize_write would do).
        let body = format!("@agent:{} please review", target_agent.id);
        wire_at_mentions_on_idea(&ctx, idea_store.as_ref(), &idea_id, &body).await;

        // One system message ("agent:<id> mentioned") should be in the timeline.
        let timeline = ss.timeline_by_session(&session_id, 20).await.unwrap();
        let mention_msgs: Vec<_> = timeline
            .iter()
            .filter(|m| m.role == "system" && m.content.contains("mentioned"))
            .collect();
        assert_eq!(
            mention_msgs.len(),
            1,
            "one 'mentioned' system message expected; timeline: {timeline:?}"
        );
    }

    // ── activity-emission on idea CRUD ───────────────────────────────────

    #[tokio::test]
    async fn handle_update_idea_emits_edited_activity_row() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("edit-test", "first body", &[], None)
            .await
            .unwrap();

        let req = serde_json::json!({
            "id": idea_id,
            "content": "second body",
            "caller_user_id": "user-editor",
        });
        let resp = handle_update_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "update: {resp}");

        // The update should have lazy-created the session and dropped a
        // system "edited" row into it.
        let idea = idea_store
            .get_by_ids(std::slice::from_ref(&idea_id))
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let session_id = idea
            .session_id
            .expect("update_idea must lazy-create session for activity emission");

        let sys_msgs = ss
            .system_messages_by_session(&session_id, 10)
            .await
            .unwrap();
        let edited = sys_msgs
            .iter()
            .find(|m| m.content == "edited")
            .expect("an 'edited' system row must exist");
        let metadata = edited.metadata.as_ref().expect("metadata must be set");
        assert_eq!(metadata["kind"], "idea_edited");
        assert_eq!(metadata["actor_user_id"], "user-editor");
        assert_eq!(metadata["actor_kind"], "user");
    }

    #[tokio::test]
    async fn handle_store_idea_emits_created_activity_row() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        let req = serde_json::json!({
            "name": "create-test",
            "content": "fresh idea body",
            "caller_user_id": "user-creator",
        });
        let resp = handle_store_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "store: {resp}");
        assert_eq!(resp["action"], "create");
        let idea_id = resp["id"].as_str().unwrap().to_string();

        let idea = idea_store
            .get_by_ids(&[idea_id])
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let session_id = idea
            .session_id
            .expect("store_idea must lazy-create session");

        let sys_msgs = ss
            .system_messages_by_session(&session_id, 10)
            .await
            .unwrap();
        let created = sys_msgs
            .iter()
            .find(|m| m.content == "created")
            .expect("a 'created' system row must exist");
        assert_eq!(created.metadata.as_ref().unwrap()["kind"], "idea_created");
    }

    #[tokio::test]
    async fn handle_store_idea_persists_requested_kind() {
        let (ctx, _ss, idea_store, dir) = wave2_ctx().await;

        let req = serde_json::json!({
            "name": "goal-kind-test",
            "content": "ship the goal discriminator",
            "tags": ["goal", "regression"],
            "kind": "goal",
        });
        let resp = handle_store_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "store: {resp}");
        assert_eq!(resp["action"], "create");
        let idea_id = resp["id"].as_str().unwrap().to_string();

        let conn = rusqlite::Connection::open(dir.path().join("aeqi.db")).unwrap();
        let stored_kind: String = conn
            .query_row(
                "SELECT kind FROM ideas WHERE id = ?1",
                rusqlite::params![idea_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_kind, "goal");

        let hydrated = idea_store
            .get_by_name("goal-kind-test", None)
            .await
            .unwrap()
            .expect("stored idea must hydrate");
        assert_eq!(hydrated.kind, "goal");
    }

    #[tokio::test]
    async fn handle_store_idea_updates_kind_on_same_name_skip() {
        let (ctx, _ss, idea_store, dir) = wave2_ctx().await;

        let first = handle_store_idea(
            &ctx,
            &serde_json::json!({
                "name": "goal-kind-skip-test",
                "content": "same content should dedup",
                "tags": ["goal", "regression"],
            }),
            &None,
        )
        .await;
        assert_eq!(first["ok"], true, "first store: {first}");
        assert_eq!(first["action"], "create");
        let idea_id = first["id"].as_str().unwrap().to_string();

        let second = handle_store_idea(
            &ctx,
            &serde_json::json!({
                "name": "goal-kind-skip-test",
                "content": "same content should dedup",
                "tags": ["goal", "regression"],
                "kind": "goal",
            }),
            &None,
        )
        .await;
        assert_eq!(second["ok"], true, "second store: {second}");
        assert_eq!(second["action"], "skip");
        assert_eq!(second["id"], idea_id);

        let conn = rusqlite::Connection::open(dir.path().join("aeqi.db")).unwrap();
        let stored_kind: String = conn
            .query_row(
                "SELECT kind FROM ideas WHERE id = ?1",
                rusqlite::params![idea_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_kind, "goal");

        let hydrated = idea_store
            .get_by_name("goal-kind-skip-test", None)
            .await
            .unwrap()
            .expect("stored idea must hydrate");
        assert_eq!(hydrated.kind, "goal");
    }

    #[tokio::test]
    async fn handle_store_idea_rejects_unknown_kind() {
        let (ctx, _ss, _idea_store, _dir) = wave2_ctx().await;

        let resp = handle_store_idea(
            &ctx,
            &serde_json::json!({
                "name": "bad-kind-test",
                "content": "invalid kind",
                "kind": "project",
            }),
            &None,
        )
        .await;

        assert_eq!(resp["ok"], false, "store should reject bad kind: {resp}");
        assert!(
            resp["error"].as_str().unwrap().contains("invalid kind"),
            "unexpected error: {resp}"
        );
    }

    // ── Wave 5 — Lane C: session provenance edge ─────────────────────────

    #[tokio::test]
    async fn store_idea_with_created_in_session_writes_provenance_edge() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        // The session the caller was inside when authoring the idea. Distinct
        // from the idea's own lazy-created conversation session.
        let caller_session = ss
            .create_standalone_session("caller-session", "agent")
            .await
            .unwrap();

        let req = serde_json::json!({
            "name": "wave5-provenance",
            "content": "idea authored from inside a live session",
            "created_in_session_id": caller_session,
        });
        let resp = handle_store_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "store: {resp}");
        assert_eq!(resp["action"], "create");
        let idea_id = resp["id"].as_str().unwrap().to_string();

        let edges = idea_store.idea_edges(&idea_id).await.unwrap_or_default();
        let provenance = edges.links.iter().find(|e| {
            e.other_kind == "session" && e.other_id == caller_session && e.relation == "link"
        });
        assert!(
            provenance.is_some(),
            "idea→session provenance edge must be present; links: {:?}",
            edges.links
        );

        // The idea's own conversation session is still distinct from the
        // caller-provenance session — confirming the two roles don't collide.
        let idea = idea_store
            .get_by_ids(&[idea_id])
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        let own_session = idea
            .session_id
            .expect("store_idea still lazy-creates the idea's own session");
        assert_ne!(
            own_session, caller_session,
            "the idea's own session must not be the caller's session"
        );
    }

    #[tokio::test]
    async fn store_idea_without_created_in_session_writes_no_provenance_edge() {
        let (ctx, _ss, idea_store, _dir) = wave2_ctx().await;

        let req = serde_json::json!({
            "name": "wave5-no-provenance",
            "content": "no caller session attached",
        });
        let resp = handle_store_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "store: {resp}");
        let idea_id = resp["id"].as_str().unwrap().to_string();

        let edges = idea_store.idea_edges(&idea_id).await.unwrap_or_default();
        let session_links: Vec<_> = edges
            .links
            .iter()
            .filter(|e| e.other_kind == "session")
            .collect();
        assert!(
            session_links.is_empty(),
            "no session edge expected without created_in_session_id; got: {session_links:?}"
        );
    }

    #[tokio::test]
    async fn same_name_store_with_changed_content_merges_instead_of_skipping() {
        let (ctx, _ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store(
                "mcp/dedup-policy",
                "Store exact duplicate memory writes only once.",
                &["mcp".to_string(), "memory".to_string()],
                None,
            )
            .await
            .unwrap();

        let req = serde_json::json!({
            "name": "mcp/dedup-policy",
            "content": "When the same idea name carries materially new operational context, merge it so the lesson is not lost.",
            "tags": ["mcp", "memory", "workflow"],
        });
        let resp = handle_store_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "store: {resp}");
        assert_eq!(resp["id"], idea_id);
        assert_eq!(resp["action"], "merge");
        assert_eq!(resp["dedup"]["reason"], "same_name_changed_content_merge");

        let idea = idea_store
            .get_by_ids(std::slice::from_ref(&idea_id))
            .await
            .unwrap()
            .into_iter()
            .next()
            .unwrap();
        assert!(idea.content.contains("Store exact duplicate"));
        assert!(idea.content.contains("materially new operational context"));
        assert!(idea.tags.iter().any(|tag| tag == "workflow"));
    }

    #[tokio::test]
    async fn same_name_store_with_near_duplicate_content_skips_with_diagnostics() {
        let (ctx, _ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store(
                "mcp/dedup-exact",
                "AEQI MCP dedup should skip exact duplicate memory writes.",
                &["mcp".to_string()],
                None,
            )
            .await
            .unwrap();

        let req = serde_json::json!({
            "name": "mcp/dedup-exact",
            "content": "AEQI MCP dedup should skip exact duplicate memory writes.",
            "tags": ["mcp"],
        });
        let resp = handle_store_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "store: {resp}");
        assert_eq!(resp["id"], idea_id);
        assert_eq!(resp["action"], "skip");
        assert_eq!(resp["dedup"]["reason"], "same_name_near_duplicate");
        assert_eq!(resp["dedup"]["candidate_count"], 1);
    }

    #[tokio::test]
    async fn subscribe_to_idea_lazy_creates_and_joins() {
        let (ctx, ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("sub-fresh", "no comments yet", &[], None)
            .await
            .unwrap();

        // Idea has no session yet — Subscribe must still work.
        let req = serde_json::json!({
            "idea_id": idea_id,
            "caller_user_id": "user-eager",
        });
        let resp = handle_subscribe_to_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], true, "subscribe: {resp}");
        assert_eq!(resp["subscribed"], true);
        let session_id = resp["session_id"].as_str().unwrap().to_string();

        let participants = ss.list_participants(&session_id).await.unwrap();
        assert!(
            participants
                .iter()
                .any(|p| p.identity_kind == "user" && p.identity_id == "user-eager"),
            "subscriber must be in participants: {participants:?}"
        );
    }

    #[tokio::test]
    async fn subscribe_to_idea_rejects_callers_with_no_user_identity() {
        let (ctx, _ss, idea_store, _dir) = wave2_ctx().await;

        let idea_id = idea_store
            .store("sub-anon", "body", &[], None)
            .await
            .unwrap();

        let req = serde_json::json!({"idea_id": idea_id});
        let resp = handle_subscribe_to_idea(&ctx, &req, &None).await;
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "no_user_identity");
    }
}
