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

use aeqi_core::traits::{IdeaStore, StoreFull, UpdateFull};
use aeqi_ideas::dedup::{DedupAction, DedupCandidate, DedupPipeline, SimilarIdea};
use aeqi_ideas::tag_policy::{EffectivePolicy, POLICY_TAG};

use super::request_field;

pub async fn handle_list_ideas(
    ctx: &super::CommandContext,
    request: &serde_json::Value,
    _allowed: &Option<Vec<String>>,
) -> serde_json::Value {
    // Agent-scoped path goes through AgentRegistry so it can join agent_ancestry
    // and include globals (agent_id IS NULL) + self + descendants. The trait
    // IdeaStore doesn't know about ancestry.
    if let Some(aid) = request_field(request, "agent_id") {
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

    // Find similar candidates. Retrieval-side scoring lives in Agent R;
    // the dedup helper stays BM25-only for now so we don't block on
    // the embedder. Graceful fallback: if search errors, treat as "no
    // similar" (Create path).
    let similar = find_similar_for_dedup(
        idea_store.as_ref(),
        &input.name,
        &redacted_content,
        input.agent_id.as_deref(),
    )
    .await;

    let candidate = DedupCandidate {
        name: input.name.clone(),
        content: redacted_content.clone(),
        embedding: None,
    };
    let action = DedupPipeline::default().decide(&candidate, &similar);

    let response = match action {
        DedupAction::Skip => serde_json::json!({
            "ok": true,
            "id": similar.first().map(|s| s.id.clone()).unwrap_or_default(),
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

    // Invalidate the policy cache when the new row carries `meta:tag-policy`.
    if input
        .tags
        .iter()
        .any(|t| t.eq_ignore_ascii_case(POLICY_TAG))
    {
        ctx.tag_policy_cache.invalidate().await;
    }

    response
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
    links: Vec<(String, String)>,
    /// Who authored the content. Falls back to `agent_id` when the IPC
    /// doesn't carry a separate value.
    authored_by: Option<String>,
}

fn parse_store_request(request: &serde_json::Value) -> std::result::Result<StoreRequest, String> {
    // "key" is the legacy field name; pre-Apr18 MCP binaries still send it.
    let name = request_field(request, "name")
        .or_else(|| request_field(request, "key"))
        .unwrap_or("");
    let content = request_field(request, "content").unwrap_or("");

    if name.is_empty() || content.is_empty() {
        return Err("name and content are required".to_string());
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

    Ok(StoreRequest {
        name: name.to_string(),
        content: content.to_string(),
        tags,
        agent_id,
        scope,
        links: parse_links(request),
        authored_by,
    })
}

/// BM25-based similarity lookup for the dedup pipeline. Returns at most
/// 5 candidates; absent ideas and transport errors yield an empty vec so
/// the dispatch safely falls through to `Create`.
async fn find_similar_for_dedup(
    idea_store: &dyn IdeaStore,
    name: &str,
    content: &str,
    agent_id: Option<&str>,
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

    match idea_store.search(&query).await {
        Ok(hits) => hits
            .into_iter()
            .map(|idea| {
                // `Idea::score` is a BM25-ish rank here; clamp to [0, 1]
                // for the dedup pipeline. Real similarity lives in
                // Agent R's explainable search.
                let sim = (idea.score as f32).clamp(0.0, 1.0);
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
    let payload = build_store_full(input, effective, redacted_content);
    let id = match idea_store.store_full(payload).await {
        Ok(id) => id,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
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

async fn dispatch_merge(
    ctx: &super::CommandContext,
    idea_store: &Arc<dyn IdeaStore>,
    existing_id: &str,
    input: &StoreRequest,
    effective: &EffectivePolicy,
    redacted_content: &str,
) -> serde_json::Value {
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
    ctx.embed_queue
        .enqueue(existing_id.to_string(), merged_content.clone());

    // Re-reconcile inline edges from the merged body.
    reconcile_inline_edges_in_scope(
        ctx,
        idea_store.as_ref(),
        existing_id,
        &merged_content,
        input.agent_id.as_deref(),
    )
    .await;

    // Consolidation threshold check runs on every write.
    check_consolidation_threshold(ctx, idea_store.as_ref(), &tag_union, effective, existing_id)
        .await;

    serde_json::json!({
        "ok": true,
        "id": existing_id,
        "action": "merge",
    })
}

async fn dispatch_supersede(
    ctx: &super::CommandContext,
    idea_store: &Arc<dyn IdeaStore>,
    old_id: &str,
    input: &StoreRequest,
    effective: &EffectivePolicy,
    redacted_content: &str,
) -> serde_json::Value {
    // ── CRITICAL ORDERING ─────────────────────────────────────────────
    // The v8 partial unique index enforces uniqueness on
    // `(agent_id, name)` WHERE `status='active'`. We can only insert
    // a new row with the same name once the old row is flipped off
    // `active`. Do the flip FIRST.
    if let Err(e) = idea_store.set_status(old_id, "superseded").await {
        return serde_json::json!({"ok": false, "error": format!("set_status failed: {e}")});
    }

    let payload = build_store_full(input, effective, redacted_content);
    let new_id = match idea_store.store_full(payload).await {
        Ok(id) => id,
        Err(e) => return serde_json::json!({"ok": false, "error": e.to_string()}),
    };

    // Graph edge: new → supersedes → old.
    if let Err(e) = idea_store
        .store_idea_edge(&new_id, old_id, "supersedes", 1.0)
        .await
    {
        tracing::warn!(
            new = %new_id,
            old = %old_id,
            error = %e,
            "dispatch_supersede: failed to add supersedes edge"
        );
    }

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
    // Explicit links from the IPC `links` field.
    for (target_id, relation) in &input.links {
        let _ = idea_store
            .store_idea_edge(id, target_id, relation, 1.0)
            .await;
    }

    // Inline body-parsed edges (mentions/embeds + typed prefixes).
    reconcile_inline_edges_in_scope(
        ctx,
        idea_store.as_ref(),
        id,
        redacted_content,
        input.agent_id.as_deref(),
    )
    .await;

    // Hand off the embedding — the worker flips `embedding_pending`.
    ctx.embed_queue
        .enqueue(id.to_string(), redacted_content.to_string());

    // Consolidation threshold check. Cheap — one COUNT per tagged policy.
    check_consolidation_threshold(ctx, idea_store.as_ref(), &input.tags, effective, id).await;

    serde_json::json!({
        "ok": true,
        "id": id,
        "action": action,
    })
}

/// Evaluate every tag on the idea against its policy's `consolidate_when`
/// trigger. Fires `ideas:threshold_reached` via the event store (best-effort
/// log) when the count hits the threshold.
///
/// Until a `PatternDispatcher` is wired into `CommandContext`, the actual
/// event tool_calls don't run synchronously — this function logs the event
/// shape at INFO so operators can observe the trigger. The seeded
/// `ideas:threshold_reached` event in `event_handler.rs` is the code-side
/// handler; once a dispatcher is available, it'll fire the `session.spawn`
/// chain automatically on any agent whose loop handles the pattern.
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
        "ideas:threshold_reached (seeded event will fire when a pattern dispatcher is wired)"
    );
    // Touch the event handler store so future polling / UI observers can
    // find the event row alongside the info-level log.
    let _ = &ctx.event_handler_store;
}

/// Build a case-insensitive name→id resolver scoped to the agent's visible
/// idea set (or globals when `agent_id` is `None`) and reconcile the idea's
/// inline mention/embed edges from the body.
///
/// Errors in scope resolution or reconciliation are swallowed — inline
/// linking is a best-effort enrichment, not a store/update precondition.
async fn reconcile_inline_edges_in_scope(
    ctx: &super::CommandContext,
    idea_store: &dyn aeqi_core::traits::IdeaStore,
    source_id: &str,
    body: &str,
    agent_id: Option<&str>,
) {
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

    let mut lookup: HashMap<String, String> = HashMap::with_capacity(scope.len());
    for i in scope {
        let key = i.name.to_lowercase();
        if let Some(existing) = lookup.insert(key.clone(), i.id.clone()) {
            tracing::warn!(
                name = %i.name,
                kept_id = %i.id,
                displaced_id = %existing,
                "duplicate idea name in resolver scope; later idea wins"
            );
        }
    }
    let lookup = Arc::new(lookup);

    let lookup_cloned = Arc::clone(&lookup);
    let resolver =
        move |name: &str| -> Option<String> { lookup_cloned.get(&name.to_lowercase()).cloned() };

    if let Err(e) = idea_store
        .reconcile_inline_edges(source_id, body, &resolver)
        .await
    {
        tracing::warn!(source = %source_id, err = %e, "reconcile_inline_edges failed");
    }
}

/// Parse a `links` field from an IPC request into (target_id, relation) pairs.
/// Accepts either strings (defaulting to `adjacent` — the "+ Link" picker
/// flow) or objects with `{target_id, relation}`.
fn parse_links(request: &serde_json::Value) -> Vec<(String, String)> {
    request
        .get("links")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| match entry {
                    serde_json::Value::String(s) if !s.is_empty() => {
                        Some((s.clone(), "adjacent".to_string()))
                    }
                    serde_json::Value::Object(obj) => {
                        let target = obj.get("target_id").and_then(|v| v.as_str())?;
                        if target.is_empty() {
                            return None;
                        }
                        let rel = obj
                            .get("relation")
                            .and_then(|v| v.as_str())
                            .filter(|s| !s.is_empty())
                            .unwrap_or("adjacent")
                            .to_string();
                        Some((target.to_string(), rel))
                    }
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Known edge relations the `link` MCP action accepts. Matches the open
/// enum documented in the retrieval plan (v4 idea_edges migration).
/// Unknown values return an error so typos are loud.
const KNOWN_RELATIONS: &[&str] = &[
    "mentions",
    "embeds",
    "adjacent",
    "supersedes",
    "supports",
    "contradicts",
    "distilled_into",
    "caused_by",
    "co_retrieved",
    "contradiction",
];

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
    let relation = request_field(request, "relation").unwrap_or("adjacent");
    if !KNOWN_RELATIONS.contains(&relation) {
        return serde_json::json!({
            "ok": false,
            "error": format!(
                "unknown relation '{relation}'. Expected one of: {}",
                KNOWN_RELATIONS.join(", ")
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

    match idea_store.delete(id).await {
        Ok(()) => serde_json::json!({"ok": true}),
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

    if name.is_none() && content.is_none() && tags.is_none() {
        return serde_json::json!({
            "ok": false,
            "error": "at least one of name, content, or tags is required"
        });
    }

    match idea_store.update(id, name, content, tags.as_deref()).await {
        Ok(()) => {
            // Reconcile inline edges when the body changed. We need to know
            // which agent owns the idea to scope the resolver correctly.
            if let Some(body) = content {
                let agent_id = lookup_idea_agent(idea_store.as_ref(), id).await;
                reconcile_inline_edges_in_scope(
                    ctx,
                    idea_store.as_ref(),
                    id,
                    body,
                    agent_id.as_deref(),
                )
                .await;
            }
            serde_json::json!({"ok": true})
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

    if let Some(agent_id) = request_field(request, "agent_id") {
        query = query.with_agent(agent_id);
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

    match idea_store.search(&query).await {
        Ok(ideas) => {
            let items: Vec<serde_json::Value> = ideas.iter().map(idea_to_json).collect();
            serde_json::json!({"ok": true, "ideas": items})
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
    // agent_id we return globals only.
    let ideas: Vec<aeqi_core::traits::Idea> = if let Some(aid) = agent_id {
        match ctx.agent_registry.list_ideas_visible_to(aid).await {
            Ok(mut items) => {
                items.truncate(limit);
                items
            }
            Err(_) => Vec::new(),
        }
    } else {
        idea_store
            .list_global_ideas(limit)
            .await
            .unwrap_or_default()
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
    let relation = request_field(request, "relation").unwrap_or("adjacent");
    let strength = request
        .get("strength")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;

    match idea_store
        .store_idea_edge(source_id, target_id, relation, strength)
        .await
    {
        Ok(()) => serde_json::json!({"ok": true}),
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
        Ok(removed) => serde_json::json!({"ok": true, "removed": removed}),
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
