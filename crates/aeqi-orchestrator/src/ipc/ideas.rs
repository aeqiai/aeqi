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

    // ── Fix #6 (Option A) ─────────────────────────────────────────────
    // Pre-dedup active-row short-circuit. The partial unique index on
    // `(COALESCE(agent_id,''), name) WHERE status='active'` means an
    // INSERT with the same key will trip UNIQUE. Catching it here keeps
    // bulk re-imports (M's 333-markdown smoke) fast: one cheap lookup
    // instead of the full dedup + search + error-path round-trip. The
    // race between this check and INSERT is covered by the downstream
    // Option-B safety net inside `dispatch_create`.
    if let Ok(Some(existing_id)) = idea_store
        .get_active_id_by_name(&input.name, input.agent_id.as_deref())
        .await
    {
        return serde_json::json!({
            "ok": true,
            "id": existing_id,
            "action": "skip",
        });
    }

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
    // Explicit links from the IPC `links` field. Validate the relation
    // against `aeqi_ideas::relation::KNOWN_RELATIONS` so a typoed or
    // malicious wire value can't slip an unknown edge-kind into the graph
    // and corrupt downstream walks / MMR.
    for (target_id, relation) in &input.links {
        if !aeqi_ideas::relation::is_known(relation) {
            tracing::warn!(
                relation = %relation,
                target = %target_id,
                "unknown relation in explicit links — skipping"
            );
            continue;
        }
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

    // Build trigger_args — these flow into the event's tool_call args via
    // `{tag}`, `{count}`, `{candidate_ids}`, etc. The consolidator seed
    // uses `{tag}` and `{candidate_ids}`; the store_many step uses
    // `{last_tool_result}` and `{agent_id}`.
    let candidate_ids_str = triggering_id.to_string();
    let trigger_args = serde_json::json!({
        "tag": tag,
        "count": count,
        "threshold": trigger.count,
        "age_hours": trigger.age_hours,
        "consolidator_idea": trigger.consolidator_idea,
        "triggering_id": triggering_id,
        "candidate_ids": candidate_ids_str,
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

use aeqi_ideas::relation::KNOWN_RELATIONS;

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
        Ok(()) => {
            ctx.recall_cache.invalidate();
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
            ctx.recall_cache.invalidate();
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

    let raw_steps = match idea_store.walk(&from, max_hops, &relations).await {
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
}
