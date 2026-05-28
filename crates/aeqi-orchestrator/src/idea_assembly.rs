//! Idea assembly — event-driven context construction.
//!
//! Walks the agent ancestor chain, finds events matching the target pattern,
//! and dispatches each event's `tool_calls` (e.g. `ideas.assemble`,
//! `ideas.search`) through the `ToolRegistry`. Tool outputs that produce
//! context (per `produces_context()`) are appended to the assembled prompt.
//! Tool restrictions from each idea merge across the set (intersection of
//! allows, union of denies). Scope controls whether an ancestor's idea reaches
//! the target agent.
//!
//! When no `ToolDispatch` is provided (None), events with tool_calls log a
//! warning and produce nothing (safe fallback for callers that have not yet
//! been wired to a registry — bare CLI / unit tests).
//!
//! `substitute_args` is a convenience for operator-readable event configs
//! (e.g. `{user_input}` → actual value). It is NOT a security boundary.
//! Sensitive values like session_id and agent_id travel via ExecutionContext,
//! not through args.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use aeqi_core::prompt::{AssembledContext, AssembledPromptSegment, PromptScope, ToolRestrictions};
use aeqi_core::tool_registry::{CallerKind, ExecutionContext, ToolRegistry};
use aeqi_core::traits::{Idea, IdeaStore};
use aeqi_ideas::tag_policy::{TagPolicyCache, merge_policies};

use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;
use crate::placeholder_resolver::{ResolverContext, resolve_placeholder_providers};
use crate::prompt_cache;
use crate::scope_visibility;
use crate::session_store::SessionStore;

/// Combined tool registry + execution context for event-fired tool dispatch.
///
/// Passed into `assemble_ideas_for_patterns` when the caller wants tool_calls
/// on events to execute. When `None`, events with tool_calls log + skip.
pub struct ToolDispatch<'a> {
    pub registry: &'a ToolRegistry,
    pub ctx: &'a ExecutionContext,
    /// When provided, every invocation of `dispatch_event_tool_calls` writes
    /// telemetry rows into `event_invocations` / `event_invocation_steps`.
    pub session_store: Option<Arc<SessionStore>>,
}

#[derive(Debug, Clone, Copy, Default)]
struct EventToolCallOutcome {
    produced_output: bool,
    had_error: bool,
}

/// Runtime values available to tool_call placeholder substitution.
/// Fields left `None` substitute to the empty string; placeholders that do
/// not correspond to any known field pass through literally.
#[derive(Debug, Clone, Default)]
pub struct AssemblyContext {
    pub user_prompt: Option<String>,
    pub tool_output: Option<String>,
    pub quest_description: Option<String>,
}

/// Assemble the foundational context for a session — `session:start`
/// ideas only. This is the stable, once-per-session context (identity, role,
/// skills) that persists across every turn and iteration.
///
/// Per-turn refresh context lives in `assemble_execution_context` and is
/// injected ephemerally by the agent loop.
///
/// Order: root ancestor → ... → parent → self → task ideas.
/// Within each level, ideas are ordered as referenced by their events.
///
/// `tool_dispatch`: when `Some`, events with non-empty `tool_calls` are executed
/// via the registry. When `None`, events with tool_calls log a warning and are
/// skipped.
pub async fn assemble_ideas(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledContext {
    assemble_ideas_with_cache(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        tool_dispatch,
        None,
    )
    .await
}

/// (T1.11) Variant of [`assemble_ideas`] that accepts an optional
/// `TagPolicyCache`. When provided, ideas whose tag-policy set votes
/// `cache_breakpoint=true` are emitted as `AssembledPromptSegment`s with an
/// `Ephemeral` cache marker so the Anthropic provider can apply
/// `cache_control` annotations on the wire. `None` preserves the pre-T1.11
/// behaviour (no markers).
pub async fn assemble_ideas_with_cache(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    tool_dispatch: Option<&ToolDispatch<'_>>,
    tag_policy_cache: Option<&Arc<TagPolicyCache>>,
) -> AssembledContext {
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        &["session:start"],
        &AssemblyContext::default(),
        tool_dispatch,
        tag_policy_cache,
    )
    .await
}

/// Assemble the per-turn refresh context — `session:execution_start` ideas
/// only. Returned as an `AssembledContext` (string + tool restrictions) so the
/// caller can merge tool restrictions with the foundational context if any.
///
/// The resulting `.system` string is injected ephemerally by the agent as a
/// system message appended AFTER the user message on every LLM request within
/// the turn — matching the lifetime of the event (fires once per spawn).
pub async fn assemble_execution_context(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledContext {
    assemble_execution_context_with_cache(
        registry,
        idea_store,
        event_store,
        agent_id,
        tool_dispatch,
        None,
    )
    .await
}

/// (T1.11) Variant of [`assemble_execution_context`] that accepts an
/// optional `TagPolicyCache` for cache-breakpoint annotation. See
/// [`assemble_ideas_with_cache`] for semantics.
pub async fn assemble_execution_context_with_cache(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    tool_dispatch: Option<&ToolDispatch<'_>>,
    tag_policy_cache: Option<&Arc<TagPolicyCache>>,
) -> AssembledContext {
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        &[],
        &["session:execution_start"],
        &AssemblyContext::default(),
        tool_dispatch,
        tag_policy_cache,
    )
    .await
}

/// Assemble the context for a quest-start moment. Covers both session:start
/// (session-scoped context) and session:quest_start (quest-scoped context),
/// with `quest_description` threaded into any tool_call args that reference
/// it — this is how the closed learning loop surfaces promoted skills
/// relevant to the quest.
///
/// `tool_dispatch`: when `Some`, events with non-empty `tool_calls` are executed
/// via the registry. When `None`, events with tool_calls log a warning and are
/// skipped.
pub async fn assemble_ideas_for_quest_start(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    quest_description: &str,
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledContext {
    let context = AssemblyContext {
        quest_description: Some(quest_description.to_string()),
        ..AssemblyContext::default()
    };
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        &["session:start", "session:quest_start"],
        &context,
        tool_dispatch,
        None,
    )
    .await
}

/// Like `assemble_ideas` but for an arbitrary event pattern and with an
/// explicit runtime context used to expand any tool_call args on
/// matching events.
///
/// `tool_dispatch`: when `Some`, events with non-empty `tool_calls` are executed
/// via the registry. When `None`, events with tool_calls log a warning and are
/// skipped.
pub async fn assemble_ideas_for_pattern(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    event_pattern: &str,
    context: &AssemblyContext,
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledContext {
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        &[event_pattern],
        context,
        tool_dispatch,
        None,
    )
    .await
}

/// Assemble ideas for multiple event patterns in a single ancestor traversal.
/// Deduplication of collected ideas spans all patterns so the same idea is
/// never injected twice, even if referenced by events matching different
/// patterns.
///
/// `tool_dispatch`: when `Some`, events with non-empty `tool_calls` are
/// dispatched through the registry and their outputs appended to the assembled
/// context. When `None`, events with tool_calls warn + skip so existing callers
/// without a registry remain safe.
pub async fn assemble_ideas_for_patterns(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    event_patterns: &[&str],
    context: &AssemblyContext,
    tool_dispatch: Option<&ToolDispatch<'_>>,
    tag_policy_cache: Option<&Arc<TagPolicyCache>>,
) -> AssembledContext {
    // get_ancestors returns [self, parent, grandparent, ..., root].
    // We want root-first ordering.
    let ancestors = registry.get_ancestors(agent_id).await.unwrap_or_default();

    // T1.3: pre-resolve `meta:placeholder-providers` once for this assembly
    // call. The map lives for the duration of the traversal; sync template
    // helpers consult it before falling through to built-ins. Empty when
    // the meta-idea is absent → existing behaviour preserved exactly.
    let resolver_ctx = ResolverContext {
        agent_id: Some(agent_id.to_string()),
        agent_name: ancestors.first().map(|a| a.name.clone()),
        session_id: tool_dispatch.map(|d| d.ctx.session_id.clone()),
    };
    let placeholder_providers =
        resolve_placeholder_providers(idea_store, Some(registry), &resolver_ctx).await;

    let mut parts: Vec<AssembledPromptSegment> = Vec::new();
    let mut allow_sets: Vec<Vec<String>> = Vec::new();
    let mut deny_all: Vec<String> = Vec::new();
    let mut collected_task_idea_ids: HashSet<String> = HashSet::new();
    let mut fired_event_ids: Vec<String> = Vec::new();
    let mut fired_event_seen: HashSet<String> = HashSet::new();

    // Walk from root to self (reverse of get_ancestors order).
    for agent in ancestors.iter().rev() {
        let (clause, vis_params) = scope_visibility::visibility_sql_clause(registry, &agent.id)
            .await
            .unwrap_or_else(|_| (String::new(), Vec::new()));

        let mut events_for_agent: Vec<crate::event_handler::Event> = Vec::new();
        let mut seen_event_ids: HashSet<String> = HashSet::new();
        if !clause.is_empty() {
            for pattern in event_patterns {
                for event in event_store
                    .get_events_for_pattern_visible(&clause, &vis_params, pattern)
                    .await
                {
                    if seen_event_ids.insert(event.id.clone()) {
                        events_for_agent.push(event);
                    }
                }
            }
        }

        // Dispatch tool_calls for every matched event. Events with no
        // tool_calls fire as a no-op (operators may attach calls later).
        for event in &events_for_agent {
            if event.tool_calls.is_empty() {
                continue;
            }
            let Some(dispatch) = tool_dispatch else {
                tracing::warn!(
                    event_id = %event.id,
                    event_name = %event.name,
                    tool_calls_count = event.tool_calls.len(),
                    "tool_calls dispatch skipped: no ToolDispatch provided"
                );
                continue;
            };
            let outcome = dispatch_event_tool_calls(
                event,
                dispatch,
                context,
                Some(&placeholder_providers),
                &mut parts,
            )
            .await;
            if outcome.produced_output && fired_event_seen.insert(event.id.clone()) {
                fired_event_ids.push(event.id.clone());
            }
        }
    }

    // Task ideas always apply to the target agent.
    if let Some(store) = idea_store
        && !task_idea_ids.is_empty()
    {
        let task_ids: Vec<String> = task_idea_ids
            .iter()
            .filter(|id| !id.is_empty() && collected_task_idea_ids.insert((*id).clone()))
            .cloned()
            .collect();
        if !task_ids.is_empty() {
            match store.get_by_ids(&task_ids).await {
                Ok(ideas) => {
                    for idea in ideas {
                        append_idea(
                            &idea,
                            true,
                            &mut parts,
                            &mut allow_sets,
                            &mut deny_all,
                            tag_policy_cache,
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to fetch task ideas");
                }
            }
        }
    }

    let merged_allow = if allow_sets.is_empty() {
        Vec::new()
    } else {
        let mut iter = allow_sets.into_iter();
        let first = iter.next().unwrap();
        iter.fold(first, |acc, set| {
            acc.into_iter().filter(|item| set.contains(item)).collect()
        })
    };
    deny_all.sort();
    deny_all.dedup();

    // (T1.11) Cap cache breakpoints to the Anthropic per-request limit.
    // This is substrate-level: we never emit more markers than the API
    // accepts. The text content is preserved verbatim; only the cache
    // annotations on the earliest-marked segments are dropped when we
    // exceed the cap.
    prompt_cache::apply_breakpoint_cap(&mut parts);
    let system = prompt_cache::segments_to_system_string(&parts);

    AssembledContext {
        system,
        tools: ToolRestrictions {
            allow: merged_allow,
            deny: deny_all,
        },
        fired_event_ids,
        segments: parts,
    }
}

/// Truncate a string to at most `max` chars, appending "…" if truncated.
fn truncate_summary(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        // Find a char boundary at or before `max`.
        let mut end = max;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

/// Execute the tool_calls declared on an event, appending context-producing
/// outputs to `parts`. Returns whether any context was produced and whether
/// the chain failed. Event chains stop on the first tool error so downstream
/// calls cannot consume unresolved placeholders such as `{last_tool_result}`.
///
/// Steps:
///  1. Build substitution context from `AssemblyContext` (user_input, quest_description, etc.).
///  2. For each ToolCall: apply `substitute_args` to expand `{placeholders}` in args,
///     including `{last_tool_result}` which is the output of the immediately preceding
///     tool call in the same event firing (enables chaining: spawn → inject).
///  3. Also inject `_session_id` into args for tools like `transcript.inject` that need it.
///  4. Invoke via `ToolRegistry::invoke` with `CallerKind::Event`.
///  5. Append non-error, non-empty outputs to `parts`.
///
/// `{last_tool_result}` substitution: after each tool call completes successfully,
/// its output is stored in `sub_ctx["last_tool_result"]`. The next tool call in the
/// same event firing can reference it via `{last_tool_result}` in its args. This is
/// the mechanism that allows `session.spawn` (produces a summary) → `transcript.inject`
/// (injects the summary) to work without an intermediate store.
async fn dispatch_event_tool_calls(
    event: &crate::event_handler::Event,
    dispatch: &ToolDispatch<'_>,
    assembly_ctx: &AssemblyContext,
    placeholder_providers: Option<&HashMap<String, String>>,
    parts: &mut Vec<AssembledPromptSegment>,
) -> EventToolCallOutcome {
    dispatch_event_tool_calls_with_trigger(
        event,
        dispatch,
        assembly_ctx,
        None,
        placeholder_providers,
        None,
        parts,
    )
    .await
}

/// Like `dispatch_event_tool_calls` but flows every scalar field of the
/// `trigger_args` JSON object into the substitution context. Used by
/// `EventPatternDispatcher::dispatch` so detectors can pass arbitrary
/// payload keys (e.g. `{tag}`, `{candidate_ids}`, `{count}`) into the
/// event's tool_call args.
async fn dispatch_event_tool_calls_with_trigger(
    event: &crate::event_handler::Event,
    dispatch: &ToolDispatch<'_>,
    assembly_ctx: &AssemblyContext,
    trigger_args: Option<&serde_json::Value>,
    placeholder_providers: Option<&HashMap<String, String>>,
    compactor_cooldown: Option<&CompactorCooldown>,
    parts: &mut Vec<AssembledPromptSegment>,
) -> EventToolCallOutcome {
    // Build substitution context from AssemblyContext fields.
    let mut sub_ctx: HashMap<String, String> = HashMap::new();
    if let Some(ref v) = assembly_ctx.user_prompt {
        sub_ctx.insert("user_input".to_string(), v.clone());
        sub_ctx.insert("user_prompt".to_string(), v.clone());
    }
    if let Some(ref v) = assembly_ctx.tool_output {
        sub_ctx.insert("tool_output".to_string(), v.clone());
    }
    if let Some(ref v) = assembly_ctx.quest_description {
        sub_ctx.insert("quest_description".to_string(), v.clone());
    }
    // Flow trigger_args scalar fields into sub_ctx so detectors can pass
    // `{tag}`, `{candidate_ids}`, `{count}` etc. to event tool_calls.
    // Only scalar values (string / number / bool) are flattened; nested
    // objects/arrays are skipped because they don't interpolate cleanly
    // into a `{placeholder}` slot.
    if let Some(serde_json::Value::Object(map)) = trigger_args {
        for (k, v) in map {
            let maybe_scalar = match v {
                serde_json::Value::String(s) => Some(s.clone()),
                serde_json::Value::Number(n) => Some(n.to_string()),
                serde_json::Value::Bool(b) => Some(b.to_string()),
                _ => None,
            };
            if let Some(scalar) = maybe_scalar {
                // ExecutionContext values win (the detector can't forge
                // session_id / agent_id from the payload).
                sub_ctx.entry(k.clone()).or_insert(scalar);
            }
        }
    }
    // Session-level values from ExecutionContext.
    sub_ctx.insert("session_id".to_string(), dispatch.ctx.session_id.clone());
    sub_ctx.insert("agent_id".to_string(), dispatch.ctx.agent_id.clone());
    if let Some(ref v) = dispatch.ctx.user_input {
        sub_ctx
            .entry("user_input".to_string())
            .or_insert_with(|| v.clone());
    }
    if let Some(ref v) = dispatch.ctx.quest_description {
        sub_ctx
            .entry("quest_description".to_string())
            .or_insert_with(|| v.clone());
    }
    // transcript_tail for compaction delegation: the recent transcript excerpt
    // passed as trigger_args when context:budget:exceeded fires.
    if let Some(ref v) = dispatch.ctx.transcript_tail {
        sub_ctx.insert("transcript_preview".to_string(), v.clone());
    }
    // T1.3: meta-idea placeholder providers win over built-ins. Inserted
    // last so any name collision (e.g. an operator override of `agent_id`)
    // overwrites the runtime-supplied value. Empty when no meta-idea is
    // seeded → identical behaviour to the pre-T1.3 sub_ctx.
    if let Some(map) = placeholder_providers {
        for (k, v) in map {
            sub_ctx.insert(k.clone(), v.clone());
        }
    }

    let mut produced_output = false;
    // History of results from prior tool_calls in this event firing, for
    // {tool_calls.N.output} / {tool_calls.N.data.path} substitution.
    let mut results_so_far: Vec<aeqi_core::traits::ToolResult> = Vec::new();

    // Snapshot tool_calls for the invocation record.
    let tool_calls_json = serde_json::to_string(&event.tool_calls).unwrap_or_default();

    // Open an invocation trace row if a session_store is wired.
    let invocation_id: Option<i64> = if let Some(ref store) = dispatch.session_store {
        match store
            .start_invocation(
                &dispatch.ctx.session_id,
                &event.pattern,
                Some(&event.name),
                "Event",
                &tool_calls_json,
            )
            .await
        {
            Ok(id) => Some(id),
            Err(e) => {
                tracing::warn!(
                    event_id = %event.id,
                    error = %e,
                    "failed to open invocation trace row"
                );
                None
            }
        }
    } else {
        None
    };

    let mut invocation_error: Option<String> = None;
    // T1.2 outcome capture. The dispatcher records the *last* tool result's
    // outcome on the invocation row. Tools can opt in by returning
    // `outcome_score` (and optionally `outcome_details`) on `ToolResult`. The
    // score is clamped to [0.0, 1.0] with a warning when out of range so a
    // single bad tool can't reject the whole invocation. Both stay `None` when
    // no tool opts in — the legacy zero-behavior path that persists NULLs.
    let mut invocation_outcome_score: Option<f64> = None;
    let mut invocation_outcome_details: Option<String> = None;

    // Pre-compute the deterministic fallback summary input once. The
    // `transcript_preview` field on `trigger_args` is the same preview the
    // compactor LLM would have summarised; reusing it for the fallback keeps
    // the structural and LLM paths drawing from the same source of truth.
    // Only meaningful when `compactor_cooldown` is engaged — otherwise the
    // closure below is dead code and the optimiser drops it.
    let fallback_transcript: String = trigger_args
        .and_then(|v| v.get("transcript_preview"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let session_id_for_cooldown = dispatch.ctx.session_id.clone();

    for (step_index, tc) in event.tool_calls.iter().enumerate() {
        // 1. Substitute placeholders in args (including {last_tool_result}
        //    scalar alias and {tool_calls.N.output|data.path} structured refs
        //    against any prior tool call in this event firing).
        let mut substituted = substitute_args_with_results(&tc.args, &sub_ctx, &results_so_far);

        // 2. Inject _session_id for tools that need it (transcript.inject, etc.).
        if let Some(obj) = substituted.as_object_mut() {
            obj.insert(
                "_session_id".to_string(),
                serde_json::Value::String(dispatch.ctx.session_id.clone()),
            );
        }

        // 3. Emit a status event before the tool runs.
        dispatch.ctx.emit_status(format!("event tool: {}", tc.tool));

        // Open a step trace row if telemetry is enabled.
        let args_json = serde_json::to_string(&tc.args).unwrap_or_default();
        let step_id: Option<i64> =
            if let (Some(inv_id), Some(store)) = (invocation_id, &dispatch.session_store) {
                match store
                    .start_step(inv_id, step_index as i64, &tc.tool, &args_json)
                    .await
                {
                    Ok(id) => Some(id),
                    Err(e) => {
                        tracing::warn!(
                            event_id = %event.id,
                            tool = %tc.tool,
                            error = %e,
                            "failed to open step trace row"
                        );
                        None
                    }
                }
            } else {
                None
            };

        // Quest 67-180.4 deliverable 10: compactor cooldown intercept.
        // When the calling pattern is `context:budget:exceeded` and a prior
        // turn flagged this session as a compactor failure, skip the LLM
        // `session.spawn` for `kind=compactor` and substitute a deterministic
        // fallback summary as the `{last_tool_result}` for the downstream
        // `transcript.replace_middle` call. Eliminates the hot-loop where a
        // misbehaving model would burn budget on consecutive empty summaries.
        let is_compactor_spawn = tc.tool == "session.spawn"
            && substituted
                .get("kind")
                .and_then(|v| v.as_str())
                .map(|k| k == "compactor")
                .unwrap_or(false);
        if is_compactor_spawn
            && let Some(cooldown) = compactor_cooldown
            && cooldown.is_cooling_down(&session_id_for_cooldown)
        {
            let fallback = aeqi_core::agent::compaction::fallback_summary(&fallback_transcript);
            tracing::warn!(
                event_id = %event.id,
                session_id = %session_id_for_cooldown,
                "compactor cooldown active — skipping session.spawn(kind=compactor); \
                 using deterministic fallback summary for downstream tool_calls"
            );
            sub_ctx.insert("last_tool_result".to_string(), fallback.clone());
            // Push a synthetic OK result so downstream {tool_calls.N.output}
            // refs resolve consistently with a normal compactor spawn.
            let synthetic = aeqi_core::traits::ToolResult::success(fallback);
            results_so_far.push(synthetic);
            // Close any open step trace row as a deterministic-fallback skip
            // rather than an error or a real success — operators reading
            // event_invocation_steps see why nothing hit the LLM.
            if let (Some(sid), Some(store)) = (step_id, &dispatch.session_store)
                && let Err(e) = store
                    .finish_step(
                        sid,
                        Some("compactor cooldown — used deterministic fallback summary"),
                        "ok",
                        None,
                    )
                    .await
            {
                tracing::warn!(error = %e, "failed to close step trace row");
            }
            continue;
        }

        // 4. Invoke the tool.
        match dispatch
            .registry
            .invoke(&tc.tool, substituted, CallerKind::Event, dispatch.ctx)
            .await
        {
            Ok(result) => {
                if result.is_error {
                    tracing::warn!(
                        event_id = %event.id,
                        tool = %tc.tool,
                        error = %result.output,
                        "event tool call returned error"
                    );
                    if let (Some(sid), Some(store)) = (step_id, &dispatch.session_store)
                        && let Err(e) = store
                            .finish_step(sid, None, "error", Some(&result.output))
                            .await
                    {
                        tracing::warn!(error = %e, "failed to close step trace row");
                    }
                    if invocation_error.is_none() {
                        invocation_error = Some(format!(
                            "tool '{}' returned error: {}",
                            tc.tool, result.output
                        ));
                    }
                    // Still record for index stability in {tool_calls.N.…} refs.
                    results_so_far.push(result);
                    break;
                } else {
                    // Quest 67-180.4 deliverable 10: post-call fallback.
                    // When a compactor `session.spawn` returns an empty or
                    // sub-threshold summary, the LLM either refused, was
                    // rate-limited, or returned garbage. Substitute the
                    // deterministic fallback summary as `{last_tool_result}`
                    // so the downstream `transcript.replace_middle` lands
                    // substantive content (and the resumed agent isn't told
                    // it's running on "" or a 12-char "ok" string). Also
                    // arm the cooldown so the next compaction round skips
                    // the LLM entirely.
                    let effective_output = if is_compactor_spawn
                        && compactor_cooldown.is_some()
                        && result.output.trim().len()
                            < aeqi_core::agent::compaction::FALLBACK_MIN_SUMMARY_CHARS
                    {
                        let fallback =
                            aeqi_core::agent::compaction::fallback_summary(&fallback_transcript);
                        tracing::warn!(
                            event_id = %event.id,
                            session_id = %session_id_for_cooldown,
                            llm_output_len = result.output.len(),
                            fallback_len = fallback.len(),
                            "compactor LLM returned empty/sub-threshold summary; \
                             substituting deterministic fallback and arming cooldown"
                        );
                        if let Some(cooldown) = compactor_cooldown {
                            cooldown.note_failure(&session_id_for_cooldown);
                        }
                        fallback
                    } else {
                        result.output.clone()
                    };

                    // 5. Store result for chaining: scalar alias
                    //    `{last_tool_result}` and structured refs
                    //    `{tool_calls.N.output|data.path}`.
                    sub_ctx.insert("last_tool_result".to_string(), effective_output.clone());

                    // T1.2 outcome capture. Last opt-in wins on the invocation
                    // row. Out-of-range values are clamped with a warning so a
                    // single misbehaving tool never rejects the whole result.
                    if let Some(raw) = result.outcome_score {
                        let clamped = clamp_outcome_score(raw, &event.id, &tc.tool);
                        invocation_outcome_score = Some(clamped);
                        invocation_outcome_details = result.outcome_details.clone();
                    } else if result.outcome_details.is_some() {
                        // Details without a score are still recorded — useful
                        // for free-form outcome notes (e.g. classifier labels).
                        invocation_outcome_details = result.outcome_details.clone();
                    }

                    // When the fallback intercepted, record the synthetic
                    // result on `results_so_far` so `{tool_calls.N.output}`
                    // refs see substantive content too. When no fallback,
                    // record the original result unchanged.
                    let recorded_result = if effective_output == result.output {
                        result.clone()
                    } else {
                        aeqi_core::traits::ToolResult::success(effective_output.clone())
                    };
                    results_so_far.push(recorded_result);

                    // Only context-producing tools (ideas.*) contribute their
                    // output to assembled parts. Side-effect tools like
                    // transcript.inject return a diagnostic ack whose text
                    // must not leak into the LLM prompt — otherwise the model
                    // will echo the injection back inside its answer.
                    let produces_context = dispatch.registry.produces_context(&tc.tool);
                    if produces_context
                        && !result.output.is_empty()
                        && result.output != "(no ideas assembled)"
                    {
                        // Tool-emitted context (ideas.recall, etc.) is
                        // dynamic — not a candidate for substrate-level
                        // cache breakpoints. Emit as a plain segment.
                        parts.push(AssembledPromptSegment::plain(result.output.clone()));
                        produced_output = true;

                        if tc.tool.starts_with("ideas.") {
                            dispatch
                                .ctx
                                .emit_status(format!("assembled context via {}", tc.tool));
                        }
                    }
                    if let (Some(sid), Some(store)) = (step_id, &dispatch.session_store) {
                        let summary = truncate_summary(&result.output, 2000);
                        if let Err(e) = store.finish_step(sid, Some(&summary), "ok", None).await {
                            tracing::warn!(error = %e, "failed to close step trace row");
                        }
                    }
                }
            }
            Err(e) => {
                tracing::warn!(
                    event_id = %event.id,
                    tool = %tc.tool,
                    error = %e,
                    "event tool call failed"
                );
                if let (Some(sid), Some(store)) = (step_id, &dispatch.session_store) {
                    let err_str = e.to_string();
                    if let Err(te) = store.finish_step(sid, None, "error", Some(&err_str)).await {
                        tracing::warn!(error = %te, "failed to close step trace row");
                    }
                }
                if invocation_error.is_none() {
                    invocation_error = Some(format!("tool '{}' failed: {}", tc.tool, e));
                }
                // Push a synthetic error result for index stability in
                // {tool_calls.N.…} refs.
                results_so_far.push(aeqi_core::traits::ToolResult::error(e.to_string()));
                break;
            }
        }
    }

    // Close the invocation trace row. When no tool opted in to outcome
    // tracking, both score and details are `None` and persist as NULL — the
    // legacy zero-behavior path.
    if let (Some(inv_id), Some(store)) = (invocation_id, &dispatch.session_store) {
        let (status, err) = if let Some(ref e) = invocation_error {
            ("error", Some(e.as_str()))
        } else {
            ("ok", None)
        };
        if let Err(e) = store
            .finish_invocation_with_outcome(
                inv_id,
                status,
                err,
                invocation_outcome_score,
                invocation_outcome_details.as_deref(),
            )
            .await
        {
            tracing::warn!(error = %e, "failed to close invocation trace row");
        }
    }

    EventToolCallOutcome {
        produced_output,
        had_error: invocation_error.is_some(),
    }
}

/// Clamp a tool-supplied `outcome_score` into `[0.0, 1.0]`. Logs a warning
/// (with event + tool context) when the value falls outside the range or is
/// non-finite. Pure helper so it's trivially testable.
fn clamp_outcome_score(raw: f64, event_id: &str, tool: &str) -> f64 {
    if !raw.is_finite() {
        tracing::warn!(
            event_id = %event_id,
            tool = %tool,
            raw = raw,
            "non-finite outcome_score from tool; clamping to 0.0"
        );
        return 0.0;
    }
    if raw < 0.0 {
        tracing::warn!(
            event_id = %event_id,
            tool = %tool,
            raw = raw,
            "outcome_score below 0.0 from tool; clamping"
        );
        return 0.0;
    }
    if raw > 1.0 {
        tracing::warn!(
            event_id = %event_id,
            tool = %tool,
            raw = raw,
            "outcome_score above 1.0 from tool; clamping"
        );
        return 1.0;
    }
    raw
}

/// Walk a JSON value recursively and replace `{key}` placeholders in every
/// string leaf using the provided `context` map.
///
/// - Known keys: substituted with the map value.
/// - Unknown keys: passed through literally (the `{key}` token is kept).
/// - Non-string values: left unchanged.
///
/// Convenience for operator-readable event configs (e.g. `{user_input}` in event
/// args JSON). Not a security boundary — security-sensitive values (session_id,
/// agent_id) travel via `ExecutionContext`, not through operator-writable args.
pub fn substitute_args(
    args: &serde_json::Value,
    context: &HashMap<String, String>,
) -> serde_json::Value {
    substitute_args_with_results(args, context, &[])
}

/// Like `substitute_args`, but also resolves `{tool_calls.N.output}` and
/// `{tool_calls.N.data.field.path}` refs against the results of prior
/// tool_calls in the current event firing. Scalar-key lookups still win when
/// a key collides (e.g. a context key literally named `tool_calls.0.output`
/// would be rare but valid — it resolves from the map before the structured
/// refs are considered).
pub fn substitute_args_with_results(
    args: &serde_json::Value,
    context: &HashMap<String, String>,
    results: &[aeqi_core::traits::ToolResult],
) -> serde_json::Value {
    match args {
        serde_json::Value::String(s) => {
            serde_json::Value::String(substitute_str_with_results(s, context, results))
        }
        serde_json::Value::Array(arr) => serde_json::Value::Array(
            arr.iter()
                .map(|v| substitute_args_with_results(v, context, results))
                .collect(),
        ),
        serde_json::Value::Object(map) => {
            let new_map: serde_json::Map<String, serde_json::Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), substitute_args_with_results(v, context, results)))
                .collect();
            serde_json::Value::Object(new_map)
        }
        // Numbers, booleans, null — pass through unchanged.
        other => other.clone(),
    }
}

/// String substitution with `{tool_calls.N.…}` structured-ref fallback.
fn substitute_str_with_results(
    s: &str,
    context: &HashMap<String, String>,
    results: &[aeqi_core::traits::ToolResult],
) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{'
            && let Some(close_rel) = s[i + 1..].find('}')
        {
            let close = i + 1 + close_rel;
            let key = &s[i + 1..close];
            if let Some(val) = context.get(key) {
                out.push_str(val);
            } else if let Some(val) = resolve_tool_calls_ref(key, results) {
                out.push_str(&val);
            } else {
                out.push_str(&s[i..=close]);
            }
            i = close + 1;
            continue;
        }
        out.push(s[i..].chars().next().unwrap());
        i += s[i..].chars().next().unwrap().len_utf8();
    }
    out
}

/// Resolve a `{tool_calls.N.field.path}` reference against a list of prior
/// `ToolResult`s from the current event firing. Returns `None` if the ref
/// does not match the grammar or the path cannot be resolved — the caller
/// then falls back to the scalar-key substitution.
///
/// Grammar:
///   `tool_calls.N.output`        → result[N].output (string)
///   `tool_calls.N.data.a.b.c`    → result[N].data pointed to by /a/b/c
///   `tool_calls.-1.output`       → last result's output
pub fn resolve_tool_calls_ref(
    reference: &str,
    results: &[aeqi_core::traits::ToolResult],
) -> Option<String> {
    let rest = reference.strip_prefix("tool_calls.")?;
    let (index_str, tail) = rest.split_once('.')?;
    let idx: i64 = index_str.parse().ok()?;
    let resolved_idx = if idx < 0 {
        let n = results.len() as i64 + idx;
        if n < 0 {
            return None;
        }
        n as usize
    } else {
        idx as usize
    };
    let result = results.get(resolved_idx)?;
    if tail == "output" {
        return Some(result.output.clone());
    }
    let data_path = tail.strip_prefix("data.")?;
    let pointer: String = std::iter::once(String::new())
        .chain(data_path.split('.').map(|s| s.to_string()))
        .collect::<Vec<_>>()
        .join("/");
    let value = result.data.pointer(&pointer)?;
    Some(match value {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    })
}

/// Expand `{user_prompt}`, `{tool_output}`, `{quest_description}` placeholders.
/// Unknown `{placeholders}` pass through literally.
/// Known-but-unset placeholders substitute to the empty string.
pub fn expand_template(template: &str, ctx: &AssemblyContext) -> String {
    expand_template_with_providers(template, ctx, None)
}

/// Like [`expand_template`] but consults `providers` BEFORE the built-in
/// match. T1.3 (placeholder resolver extensibility) — when the operator
/// has seeded `meta:placeholder-providers`, the caller pre-resolves it
/// into a `name → value` map and threads it through here.
///
/// Lookup priority: `providers` first (operator override allowed), then
/// the existing built-ins. Absent / `None` → identical behaviour to the
/// pre-T1.3 `expand_template`.
pub fn expand_template_with_providers(
    template: &str,
    ctx: &AssemblyContext,
    providers: Option<&HashMap<String, String>>,
) -> String {
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{'
            && let Some(close_rel) = template[i + 1..].find('}')
        {
            let close = i + 1 + close_rel;
            let key = &template[i + 1..close];
            // T1.3: meta-idea providers consulted first so operators can
            // override built-ins. A miss falls through to the legacy
            // hardcoded match below.
            if let Some(map) = providers
                && let Some(val) = map.get(key)
            {
                out.push_str(val);
                i = close + 1;
                continue;
            }
            match key {
                "user_prompt" => {
                    out.push_str(ctx.user_prompt.as_deref().unwrap_or(""));
                    i = close + 1;
                    continue;
                }
                "tool_output" => {
                    out.push_str(ctx.tool_output.as_deref().unwrap_or(""));
                    i = close + 1;
                    continue;
                }
                "quest_description" => {
                    out.push_str(ctx.quest_description.as_deref().unwrap_or(""));
                    i = close + 1;
                    continue;
                }
                _ => {
                    // Unknown placeholder — pass through literally.
                    out.push_str(&template[i..=close]);
                    i = close + 1;
                    continue;
                }
            }
        }
        out.push(template[i..].chars().next().unwrap());
        i += template[i..].chars().next().unwrap().len_utf8();
    }
    out
}

/// (T1.11) Decide whether `idea` should be emitted as a cache-pinned
/// segment. Returns `true` only when a `TagPolicyCache` is wired AND the
/// merged effective policy across the idea's tags votes
/// `cache_breakpoint=true`. Returns `false` (= plain segment) when no cache
/// is provided, when the idea has no tags, or when no contributing tag
/// policy opts in. The `get_or_default` path is sync and never blocks the
/// hot assembly loop on a cache refresh.
fn idea_wants_cache_pin(idea: &Idea, tag_policy_cache: Option<&Arc<TagPolicyCache>>) -> bool {
    let Some(cache) = tag_policy_cache else {
        return false;
    };
    if idea.tags.is_empty() {
        return false;
    }
    let policies: Vec<_> = idea
        .tags
        .iter()
        .map(|tag| cache.get_or_default(tag))
        .collect();
    let effective = merge_policies(&policies);
    effective.cache_breakpoint
}

/// Append a single idea to the output buffers, checking scope rules.
///
/// (T1.11) When `tag_policy_cache` is `Some`, the idea's tags are resolved
/// to per-tag policies, the policies are merged with `merge_policies`, and
/// the resulting `EffectivePolicy::cache_breakpoint` flag (OR-merged across
/// every contributing tag) decides whether the emitted segment carries an
/// `Ephemeral` cache marker. When `tag_policy_cache` is `None`, every
/// segment is emitted plain — the pre-T1.11 behaviour.
fn append_idea(
    idea: &Idea,
    is_self: bool,
    parts: &mut Vec<AssembledPromptSegment>,
    allow_sets: &mut Vec<Vec<String>>,
    deny_all: &mut Vec<String>,
    tag_policy_cache: Option<&Arc<TagPolicyCache>>,
) {
    let include = match idea.scope() {
        PromptScope::Descendants => true,
        PromptScope::SelfOnly => is_self,
    };
    if !include || idea.content.is_empty() {
        return;
    }
    let pin = idea_wants_cache_pin(idea, tag_policy_cache);
    let segment = if pin {
        AssembledPromptSegment::ephemeral(idea.content.clone())
    } else {
        AssembledPromptSegment::plain(idea.content.clone())
    };
    parts.push(segment);
    if let Some(tools) = idea.tool_restrictions() {
        if !tools.allow.is_empty() {
            allow_sets.push(tools.allow);
        }
        deny_all.extend(tools.deny);
    }
}

// ---------------------------------------------------------------------------
// PatternDispatcher implementation for the orchestrator
// ---------------------------------------------------------------------------

/// Default cooldown applied to a session after a compactor LLM spawn returns
/// empty / sub-threshold output. The static-fallback summary keeps the
/// session moving for this many seconds before another `context:budget:exceeded`
/// is allowed to fire the LLM compactor again. 30s matches the brief and is
/// short enough that recovery doesn't stall a turn for long, long enough that
/// a thrashing model can't burn a credit stack in one minute.
///
/// Quest 67-180.4, deliverable 10.
pub const COMPACTOR_COOLDOWN_SECS: u64 = 30;

/// Per-session cooldown cache for compactor LLM failures. Prevents a hot-loop
/// where the agent loop re-fires `context:budget:exceeded` immediately after a
/// previous compactor spawn returned empty/short output. While cooling down,
/// the dispatcher skips the LLM spawn and substitutes a deterministic
/// fallback summary so `transcript.replace_middle` still has substantive
/// content.
///
/// Lifetime: in-memory only — cleared on daemon restart. That is the right
/// posture: a restart is the operator's signal to re-attempt the LLM
/// compactor, and the cooldown is purely a stability guard, not a security
/// gate.
///
/// Quest 67-180.4, deliverable 10.
#[derive(Debug, Default)]
pub struct CompactorCooldown {
    /// `session_id` → instant when the cooldown expires.
    until: StdMutex<HashMap<String, Instant>>,
}

impl CompactorCooldown {
    pub fn new() -> Self {
        Self {
            until: StdMutex::new(HashMap::new()),
        }
    }

    /// Returns `true` when the session is currently cooling down. Expired
    /// entries are cleaned up lazily on read so the map doesn't grow without
    /// bound across long-lived sessions.
    pub fn is_cooling_down(&self, session_id: &str) -> bool {
        let now = Instant::now();
        let Ok(mut guard) = self.until.lock() else {
            // Poisoned mutex: fail open (no cooldown). Better to allow another
            // attempt than to wedge compaction forever.
            return false;
        };
        match guard.get(session_id).copied() {
            Some(deadline) if deadline > now => true,
            Some(_) => {
                guard.remove(session_id);
                false
            }
            None => false,
        }
    }

    /// Record a compactor failure for `session_id`. The session enters a
    /// `COMPACTOR_COOLDOWN_SECS`-second cooldown window before the LLM
    /// compactor may be re-invoked.
    pub fn note_failure(&self, session_id: &str) {
        let deadline = Instant::now() + Duration::from_secs(COMPACTOR_COOLDOWN_SECS);
        if let Ok(mut guard) = self.until.lock() {
            guard.insert(session_id.to_string(), deadline);
        }
    }

    /// Manually clear any cooldown for `session_id`. Used by tests and as the
    /// reset path when an operator wants the next compactor spawn to retry
    /// immediately.
    pub fn clear(&self, session_id: &str) {
        if let Ok(mut guard) = self.until.lock() {
            guard.remove(session_id);
        }
    }
}

/// Orchestrator-side `PatternDispatcher` that queries the event store for
/// enabled events matching a pattern and runs their `tool_calls` via the
/// `ToolRegistry`.
///
/// Wired into the agent by `SessionManager` so the agent loop can fire
/// `context:budget:exceeded` (and any future pattern) and delegate to a
/// configured event without depending on the orchestrator directly.
///
/// See the `PatternDispatcher` trait docs for the return semantic.
/// Summary: `dispatch` returns `true` if any matching event ran its
/// tool_calls — including pure side-effect chains that don't produce
/// context output. Returns `false` only when no event is configured (or
/// every matching event has an empty tool_calls list), so the caller can
/// fall back to inline handling.
pub struct EventPatternDispatcher {
    pub event_store: Arc<EventHandlerStore>,
    pub registry: Arc<ToolRegistry>,
    /// Agent registry for visibility-aware event lookup.
    pub agent_registry: Arc<AgentRegistry>,
    /// When set, invocation traces are written to `event_invocations` /
    /// `event_invocation_steps` for every dispatch.
    pub session_store: Option<Arc<SessionStore>>,
    /// T1.3: optional idea store for resolving `meta:placeholder-providers`.
    /// `None` → no custom placeholders; built-ins behave as before.
    pub idea_store: Option<Arc<dyn IdeaStore>>,
    /// Per-session cooldown cache for compactor LLM failures (quest 67-180.4,
    /// deliverable 10). `None` disables the cooldown + fallback path — tests
    /// and bare-CLI dispatchers that don't need it can leave this `None` and
    /// the dispatcher behaves identically to the pre-quest version.
    pub compactor_cooldown: Option<Arc<CompactorCooldown>>,
}

impl aeqi_core::tool_registry::PatternDispatcher for EventPatternDispatcher {
    fn dispatch<'a>(
        &'a self,
        pattern: &'a str,
        ctx: &'a aeqi_core::tool_registry::ExecutionContext,
        trigger_args: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            // Query the event store for enabled events matching this exact pattern,
            // using scope-aware visibility so parent-scoped events reach child agents.
            let (clause, vis_params) =
                scope_visibility::visibility_sql_clause(&self.agent_registry, &ctx.agent_id)
                    .await
                    .unwrap_or_else(|_| (String::new(), Vec::new()));
            let events = if clause.is_empty() {
                Vec::new()
            } else {
                self.event_store
                    .get_events_for_exact_pattern_visible(&clause, &vis_params, pattern)
                    .await
            };

            if events.is_empty() {
                return false;
            }

            // Enrich ctx with transcript_tail from trigger_args for {transcript_preview}
            // substitution in session.spawn and transcript.replace_middle args.
            let mut enriched_ctx = ctx.clone();
            enriched_ctx.transcript_tail = trigger_args
                .get("transcript_preview")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            let dispatch = ToolDispatch {
                registry: &self.registry,
                ctx: &enriched_ctx,
                session_store: self.session_store.clone(),
            };

            let assembly_ctx = AssemblyContext::default();
            let mut parts: Vec<AssembledPromptSegment> = Vec::new();
            let mut handled = false;
            let mut had_error = false;

            // T1.3: pre-resolve placeholder providers once for this dispatch
            // so every fired event in this batch sees the same map.
            let resolver_ctx = ResolverContext {
                agent_id: Some(ctx.agent_id.clone()),
                agent_name: None,
                session_id: Some(ctx.session_id.clone()),
            };
            let placeholder_providers = resolve_placeholder_providers(
                self.idea_store.as_ref(),
                Some(&self.agent_registry),
                &resolver_ctx,
            )
            .await;

            for event in &events {
                if !event.tool_calls.is_empty() {
                    // Option B: mark the event as handled for the *caller's*
                    // fallback-suppression decision as soon as we run its
                    // tool_calls. The previous "did any tool produce context
                    // output" semantic silently failed callers with pure
                    // side-effect chains (compaction's session.spawn →
                    // transcript.replace_middle; consolidation's session.spawn
                    // → ideas.store_many) — they'd return `false` and the
                    // caller would run its inline fallback too, doubling work.
                    // The inner helper's `produced_output` return still governs
                    // whether the event contributed to `parts`; that's separate
                    // from whether a matching event ran.
                    handled = true;
                    // Cooldown-aware path is only meaningful for the
                    // `context:budget:exceeded` pattern (the compactor seam).
                    // For other patterns we pass `None` so the dispatcher
                    // behaviour is unchanged.
                    let cooldown_for_call = if pattern == "context:budget:exceeded" {
                        self.compactor_cooldown.as_deref()
                    } else {
                        None
                    };
                    let outcome = dispatch_event_tool_calls_with_trigger(
                        event,
                        &dispatch,
                        &assembly_ctx,
                        Some(trigger_args),
                        Some(&placeholder_providers),
                        cooldown_for_call,
                        &mut parts,
                    )
                    .await;
                    if outcome.had_error {
                        had_error = true;
                    }
                    // Record fire — best effort.
                    if let Err(e) = self.event_store.record_fire(&event.id, 0.0).await {
                        tracing::warn!(
                            event = %event.id,
                            pattern = %pattern,
                            error = %e,
                            "EventPatternDispatcher: failed to record event fire"
                        );
                    }
                }
            }

            handled && !had_error
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
    use async_trait::async_trait;
    use std::sync::Mutex;

    struct RecordingTool {
        name: &'static str,
        result: ToolResult,
        calls: Arc<Mutex<Vec<serde_json::Value>>>,
    }

    #[async_trait]
    impl Tool for RecordingTool {
        async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
            self.calls.lock().unwrap().push(args);
            Ok(self.result.clone())
        }

        fn spec(&self) -> ToolSpec {
            ToolSpec {
                name: self.name.to_string(),
                description: "test tool".to_string(),
                input_schema: serde_json::json!({"type": "object"}),
            }
        }

        fn name(&self) -> &str {
            self.name
        }
    }

    #[test]
    fn expand_template_substitutes_known_placeholders() {
        let ctx = AssemblyContext {
            user_prompt: Some("hello world".to_string()),
            tool_output: Some("42".to_string()),
            quest_description: None,
        };
        let out = expand_template(
            "search {user_prompt} with tool result {tool_output} quest {quest_description}",
            &ctx,
        );
        assert_eq!(out, "search hello world with tool result 42 quest ");
    }

    #[test]
    fn expand_template_passes_unknown_placeholders_through_literally() {
        let ctx = AssemblyContext::default();
        let out = expand_template("find {banana} in {user_prompt}", &ctx);
        assert_eq!(out, "find {banana} in ");
    }

    #[test]
    fn expand_template_handles_no_placeholders() {
        let ctx = AssemblyContext::default();
        let out = expand_template("plain text no braces", &ctx);
        assert_eq!(out, "plain text no braces");
    }

    #[test]
    fn expand_template_handles_unterminated_brace() {
        let ctx = AssemblyContext::default();
        let out = expand_template("hello {unterminated", &ctx);
        assert_eq!(out, "hello {unterminated");
    }

    /// T1.3: meta-idea providers are consulted FIRST. A custom `{now}`
    /// substitutes from the provider map; absent it would pass through
    /// literally (it is not a built-in).
    #[test]
    fn expand_template_with_providers_uses_provider_value() {
        let ctx = AssemblyContext::default();
        let mut providers: HashMap<String, String> = HashMap::new();
        providers.insert("now".to_string(), "2026-04-25T00:00:00Z".to_string());
        let out = expand_template_with_providers("at {now}", &ctx, Some(&providers));
        assert_eq!(out, "at 2026-04-25T00:00:00Z");
    }

    /// T1.3: when the same placeholder name exists in the providers map
    /// AND in the built-in match (`user_prompt`), the provider entry
    /// wins. This is the operator-override semantic.
    #[test]
    fn expand_template_with_providers_overrides_builtin() {
        let ctx = AssemblyContext {
            user_prompt: Some("from-builtin".to_string()),
            ..AssemblyContext::default()
        };
        let mut providers: HashMap<String, String> = HashMap::new();
        providers.insert("user_prompt".to_string(), "from-provider".to_string());
        let out = expand_template_with_providers("{user_prompt}", &ctx, Some(&providers));
        assert_eq!(
            out, "from-provider",
            "providers must override built-ins (operator-override semantic)"
        );
    }

    /// T1.3: a placeholder that is NOT in the providers map and NOT a
    /// built-in falls through to literal pass-through (no behaviour change).
    #[test]
    fn expand_template_with_providers_falls_through_to_literal() {
        let ctx = AssemblyContext::default();
        let providers: HashMap<String, String> = HashMap::new();
        let out = expand_template_with_providers("{banana}", &ctx, Some(&providers));
        assert_eq!(out, "{banana}");
    }

    /// T1.3: when the providers map is missing a name BUT the built-in
    /// match handles it, the built-in still works. This is the
    /// "baseline preservation" invariant — adding the meta-idea must not
    /// remove any built-in behaviour.
    #[test]
    fn expand_template_with_providers_preserves_builtin_when_provider_missing() {
        let ctx = AssemblyContext {
            user_prompt: Some("hello".to_string()),
            ..AssemblyContext::default()
        };
        let mut providers: HashMap<String, String> = HashMap::new();
        providers.insert("now".to_string(), "2026-04-25T00:00:00Z".to_string());
        let out = expand_template_with_providers("{user_prompt} at {now}", &ctx, Some(&providers));
        assert_eq!(out, "hello at 2026-04-25T00:00:00Z");
    }

    /// T1.3: passing `None` for providers reproduces the pre-T1.3
    /// behaviour exactly. This is what `expand_template` (the
    /// public-API shim) does for every existing caller.
    #[test]
    fn expand_template_with_providers_none_matches_legacy_expand_template() {
        let ctx = AssemblyContext {
            user_prompt: Some("hello".to_string()),
            tool_output: Some("42".to_string()),
            quest_description: Some("ship".to_string()),
        };
        let template = "{user_prompt} {tool_output} {quest_description} {banana}";
        let legacy = expand_template(template, &ctx);
        let with_none = expand_template_with_providers(template, &ctx, None);
        assert_eq!(legacy, with_none);
    }

    /// Phase-1: `substitute_args` replaces known string-leaf placeholders and
    /// passes unknown ones through literally. Non-string leaves are unchanged.
    #[test]
    fn substitute_args_replaces_known_and_passes_unknown() {
        let ctx: HashMap<String, String> = [
            ("user_input".to_string(), "what is Rust?".to_string()),
            ("transcript".to_string(), "prev msg".to_string()),
        ]
        .into_iter()
        .collect();

        let args = serde_json::json!({
            "query": "{user_input}",
            "context": "{transcript}",
            "unknown_key": "{banana}",
            "nested": {"deep": "{user_input} tail"},
            "arr": ["{transcript}", 42, true],
            "num": 7,
            "flag": false
        });

        let result = substitute_args(&args, &ctx);

        assert_eq!(result["query"].as_str(), Some("what is Rust?"));
        assert_eq!(result["context"].as_str(), Some("prev msg"));
        // Unknown placeholders pass through literally.
        assert_eq!(result["unknown_key"].as_str(), Some("{banana}"));
        assert_eq!(
            result["nested"]["deep"].as_str(),
            Some("what is Rust? tail")
        );
        assert_eq!(result["arr"][0].as_str(), Some("prev msg"));
        // Non-string leaves are unchanged.
        assert_eq!(result["arr"][1].as_u64(), Some(42));
        assert_eq!(result["arr"][2].as_bool(), Some(true));
        assert_eq!(result["num"].as_u64(), Some(7));
        assert_eq!(result["flag"].as_bool(), Some(false));
    }

    #[test]
    fn resolve_tool_calls_ref_reads_output_by_index() {
        use aeqi_core::traits::ToolResult;
        let results = vec![ToolResult::success("first"), ToolResult::success("second")];
        assert_eq!(
            resolve_tool_calls_ref("tool_calls.0.output", &results).as_deref(),
            Some("first")
        );
        assert_eq!(
            resolve_tool_calls_ref("tool_calls.1.output", &results).as_deref(),
            Some("second")
        );
    }

    #[test]
    fn resolve_tool_calls_ref_negative_index_means_latest() {
        use aeqi_core::traits::ToolResult;
        let results = vec![ToolResult::success("a"), ToolResult::success("b")];
        assert_eq!(
            resolve_tool_calls_ref("tool_calls.-1.output", &results).as_deref(),
            Some("b")
        );
    }

    #[test]
    fn resolve_tool_calls_ref_reads_data_path() {
        use aeqi_core::traits::ToolResult;
        let results = vec![ToolResult::success("").with_data(serde_json::json!({
            "session_id": "sess-123",
            "nested": {"deep": "value"},
        }))];
        assert_eq!(
            resolve_tool_calls_ref("tool_calls.0.data.session_id", &results).as_deref(),
            Some("sess-123")
        );
        assert_eq!(
            resolve_tool_calls_ref("tool_calls.0.data.nested.deep", &results).as_deref(),
            Some("value")
        );
    }

    #[test]
    fn resolve_tool_calls_ref_unknown_path_returns_none() {
        use aeqi_core::traits::ToolResult;
        let results = vec![ToolResult::success("hi")];
        assert!(resolve_tool_calls_ref("tool_calls.0.data.missing", &results).is_none());
        assert!(resolve_tool_calls_ref("tool_calls.99.output", &results).is_none());
        assert!(resolve_tool_calls_ref("not_a_ref", &results).is_none());
    }

    #[test]
    fn substitute_args_with_results_resolves_structured_refs() {
        use aeqi_core::traits::ToolResult;
        let ctx: HashMap<String, String> = HashMap::new();
        let results = vec![ToolResult::success("hello").with_data(serde_json::json!({
            "session_id": "sess-xyz",
        }))];
        let args = serde_json::json!({
            "seed": "prior: {tool_calls.0.output}",
            "session": "{tool_calls.0.data.session_id}",
        });
        let out = substitute_args_with_results(&args, &ctx, &results);
        assert_eq!(out["seed"].as_str(), Some("prior: hello"));
        assert_eq!(out["session"].as_str(), Some("sess-xyz"));
    }

    #[tokio::test]
    async fn event_tool_dispatch_stops_after_tool_result_error() {
        let first_calls = Arc::new(Mutex::new(Vec::new()));
        let second_calls = Arc::new(Mutex::new(Vec::new()));
        let registry = ToolRegistry::new(vec![
            Arc::new(RecordingTool {
                name: "first",
                result: ToolResult::error("spawn failed"),
                calls: first_calls.clone(),
            }),
            Arc::new(RecordingTool {
                name: "second",
                result: ToolResult::success("should not run"),
                calls: second_calls.clone(),
            }),
        ]);
        let ctx = ExecutionContext {
            session_id: "sess-test".to_string(),
            ..Default::default()
        };
        let dispatch = ToolDispatch {
            registry: &registry,
            ctx: &ctx,
            session_store: None,
        };
        let event = crate::event_handler::Event {
            id: "event-1".to_string(),
            agent_id: None,
            scope: aeqi_core::Scope::Global,
            name: "test".to_string(),
            pattern: "context:budget:exceeded".to_string(),
            tool_calls: vec![
                crate::event_handler::ToolCall {
                    tool: "first".to_string(),
                    args: serde_json::json!({"seed": "{transcript_preview}"}),
                },
                crate::event_handler::ToolCall {
                    tool: "second".to_string(),
                    args: serde_json::json!({"content": "{last_tool_result}"}),
                },
            ],
            enabled: true,
            cooldown_secs: 0,
            last_fired: None,
            fire_count: 0,
            total_cost_usd: 0.0,
            system: false,
            created_at: chrono::Utc::now(),
        };
        let mut parts = Vec::new();

        let outcome = dispatch_event_tool_calls_with_trigger(
            &event,
            &dispatch,
            &AssemblyContext::default(),
            Some(&serde_json::json!({"transcript_preview": "tail"})),
            None,
            None,
            &mut parts,
        )
        .await;

        assert!(outcome.had_error);
        assert!(!outcome.produced_output);
        assert_eq!(first_calls.lock().unwrap().len(), 1);
        assert!(
            second_calls.lock().unwrap().is_empty(),
            "event chains must fail closed so downstream calls cannot consume unresolved placeholders"
        );
    }

    // ── Quest 67-180.4 deliverable 10: cooldown + static fallback ───────────────

    #[test]
    fn cooldown_starts_unset_and_records_failure() {
        let cooldown = CompactorCooldown::new();
        assert!(!cooldown.is_cooling_down("sess-1"));
        cooldown.note_failure("sess-1");
        assert!(cooldown.is_cooling_down("sess-1"));
        // Different sessions are independent.
        assert!(!cooldown.is_cooling_down("sess-2"));
        // Manual clear releases the cooldown.
        cooldown.clear("sess-1");
        assert!(!cooldown.is_cooling_down("sess-1"));
    }

    /// When a compactor `session.spawn` returns an empty/sub-threshold
    /// summary, the dispatcher must substitute the deterministic fallback as
    /// `{last_tool_result}`, arm the cooldown, and let downstream tools
    /// continue with substantive content. Without this, `transcript.replace_middle`
    /// receives empty content and errors — the legacy behaviour that ate
    /// transcripts in production.
    #[tokio::test]
    async fn compactor_empty_output_triggers_fallback_and_arms_cooldown() {
        let spawn_calls = Arc::new(Mutex::new(Vec::new()));
        let replace_calls = Arc::new(Mutex::new(Vec::new()));
        let registry = ToolRegistry::new(vec![
            // session.spawn returns empty string — simulates LLM refusal /
            // rate limit / empty response.
            Arc::new(RecordingTool {
                name: "session.spawn",
                result: ToolResult::success(""),
                calls: spawn_calls.clone(),
            }),
            // transcript.replace_middle records what it received as
            // `replacement_content` — we assert it got the fallback, not "".
            Arc::new(RecordingTool {
                name: "transcript.replace_middle",
                result: ToolResult::success("replaced"),
                calls: replace_calls.clone(),
            }),
        ]);
        let ctx = ExecutionContext {
            session_id: "sess-empty".to_string(),
            ..Default::default()
        };
        let dispatch = ToolDispatch {
            registry: &registry,
            ctx: &ctx,
            session_store: None,
        };
        let event = crate::event_handler::Event {
            id: "ev-empty".to_string(),
            agent_id: None,
            scope: aeqi_core::Scope::Global,
            name: "on_context_budget_exceeded".to_string(),
            pattern: "context:budget:exceeded".to_string(),
            tool_calls: vec![
                crate::event_handler::ToolCall {
                    tool: "session.spawn".to_string(),
                    args: serde_json::json!({
                        "kind": "compactor",
                        "parent_session": "{session_id}",
                        "seed_content": "{transcript_preview}",
                    }),
                },
                crate::event_handler::ToolCall {
                    tool: "transcript.replace_middle".to_string(),
                    args: serde_json::json!({
                        "preserve_head": 3,
                        "preserve_tail": 6,
                        "replacement_role": "system",
                        "replacement_content":
                            "# Context Summary (compactor session)\n\n{last_tool_result}",
                    }),
                },
            ],
            enabled: true,
            cooldown_secs: 0,
            last_fired: None,
            fire_count: 0,
            total_cost_usd: 0.0,
            system: false,
            created_at: chrono::Utc::now(),
        };
        let cooldown = CompactorCooldown::new();
        let mut parts = Vec::new();

        let outcome = dispatch_event_tool_calls_with_trigger(
            &event,
            &dispatch,
            &AssemblyContext::default(),
            Some(&serde_json::json!({"transcript_preview": "User: hello\nAssistant: hi"})),
            None,
            Some(&cooldown),
            &mut parts,
        )
        .await;

        assert!(
            !outcome.had_error,
            "fallback path keeps the chain green so transcript.replace_middle still lands"
        );
        // Cooldown was armed by the empty result.
        assert!(
            cooldown.is_cooling_down("sess-empty"),
            "empty compactor output must arm the cooldown"
        );
        // Both tools ran.
        assert_eq!(spawn_calls.lock().unwrap().len(), 1);
        assert_eq!(replace_calls.lock().unwrap().len(), 1);
        // The replacement_content carries the fallback header, not just the
        // wrapper around an empty string.
        let replace_args = &replace_calls.lock().unwrap()[0];
        let content = replace_args
            .get("replacement_content")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        assert!(
            content.contains("deterministic fallback"),
            "replace_middle must receive the fallback summary, got: {content}"
        );
    }

    /// Reflection and consolidation events also use `session.spawn(kind=compactor)`,
    /// but their downstream tool expects JSON, not a prose transcript fallback.
    /// With no cooldown handle wired, an empty spawned result must pass through
    /// unchanged so `ideas.store_many` can classify the reflection failure.
    #[tokio::test]
    async fn compactor_empty_output_without_cooldown_does_not_fallback() {
        let spawn_calls = Arc::new(Mutex::new(Vec::new()));
        let store_many_calls = Arc::new(Mutex::new(Vec::new()));
        let registry = ToolRegistry::new(vec![
            Arc::new(RecordingTool {
                name: "session.spawn",
                result: ToolResult::success(""),
                calls: spawn_calls.clone(),
            }),
            Arc::new(RecordingTool {
                name: "ideas.store_many",
                result: ToolResult::success("reflection_failed: empty reflector output"),
                calls: store_many_calls.clone(),
            }),
        ]);
        let ctx = ExecutionContext {
            session_id: "sess-reflect-empty".to_string(),
            ..Default::default()
        };
        let dispatch = ToolDispatch {
            registry: &registry,
            ctx: &ctx,
            session_store: None,
        };
        let event = crate::event_handler::Event {
            id: "ev-reflect-empty".to_string(),
            agent_id: None,
            scope: aeqi_core::Scope::Global,
            name: "on_reflect_after_quest".to_string(),
            pattern: "session:quest_end".to_string(),
            tool_calls: vec![
                crate::event_handler::ToolCall {
                    tool: "session.spawn".to_string(),
                    args: serde_json::json!({
                        "kind": "compactor",
                        "parent_session": "{session_id}",
                    }),
                },
                crate::event_handler::ToolCall {
                    tool: "ideas.store_many".to_string(),
                    args: serde_json::json!({
                        "from_json": "{last_tool_result}",
                        "tag_suffix": ["reflection"],
                    }),
                },
            ],
            enabled: true,
            cooldown_secs: 0,
            last_fired: None,
            fire_count: 0,
            total_cost_usd: 0.0,
            system: false,
            created_at: chrono::Utc::now(),
        };
        let mut parts = Vec::new();

        let outcome = dispatch_event_tool_calls_with_trigger(
            &event,
            &dispatch,
            &AssemblyContext::default(),
            Some(&serde_json::json!({"transcript_preview": "User: done"})),
            None,
            None,
            &mut parts,
        )
        .await;

        assert!(!outcome.had_error);
        assert_eq!(spawn_calls.lock().unwrap().len(), 1);
        assert_eq!(store_many_calls.lock().unwrap().len(), 1);
        let from_json = store_many_calls.lock().unwrap()[0]
            .get("from_json")
            .and_then(|v| v.as_str())
            .unwrap_or("<missing>")
            .to_string();
        assert_eq!(
            from_json, "",
            "non-budget compactor output must not be replaced with fallback prose"
        );
    }

    /// When the cooldown is already armed, the dispatcher must NOT invoke
    /// the compactor LLM — it substitutes the fallback summary directly and
    /// downstream tools run on that. This is the hot-loop guard.
    #[tokio::test]
    async fn compactor_cooldown_skips_llm_spawn_and_runs_fallback() {
        let spawn_calls = Arc::new(Mutex::new(Vec::new()));
        let replace_calls = Arc::new(Mutex::new(Vec::new()));
        let registry = ToolRegistry::new(vec![
            Arc::new(RecordingTool {
                name: "session.spawn",
                result: ToolResult::success("THIS-SHOULD-NEVER-LAND"),
                calls: spawn_calls.clone(),
            }),
            Arc::new(RecordingTool {
                name: "transcript.replace_middle",
                result: ToolResult::success("replaced"),
                calls: replace_calls.clone(),
            }),
        ]);
        let ctx = ExecutionContext {
            session_id: "sess-cool".to_string(),
            ..Default::default()
        };
        let dispatch = ToolDispatch {
            registry: &registry,
            ctx: &ctx,
            session_store: None,
        };
        let event = crate::event_handler::Event {
            id: "ev-cool".to_string(),
            agent_id: None,
            scope: aeqi_core::Scope::Global,
            name: "on_context_budget_exceeded".to_string(),
            pattern: "context:budget:exceeded".to_string(),
            tool_calls: vec![
                crate::event_handler::ToolCall {
                    tool: "session.spawn".to_string(),
                    args: serde_json::json!({
                        "kind": "compactor",
                        "parent_session": "{session_id}",
                        "seed_content": "{transcript_preview}",
                    }),
                },
                crate::event_handler::ToolCall {
                    tool: "transcript.replace_middle".to_string(),
                    args: serde_json::json!({
                        "preserve_head": 3,
                        "preserve_tail": 6,
                        "replacement_role": "system",
                        "replacement_content": "{last_tool_result}",
                    }),
                },
            ],
            enabled: true,
            cooldown_secs: 0,
            last_fired: None,
            fire_count: 0,
            total_cost_usd: 0.0,
            system: false,
            created_at: chrono::Utc::now(),
        };
        let cooldown = CompactorCooldown::new();
        cooldown.note_failure("sess-cool"); // pre-arm
        let mut parts = Vec::new();

        let outcome = dispatch_event_tool_calls_with_trigger(
            &event,
            &dispatch,
            &AssemblyContext::default(),
            Some(&serde_json::json!({"transcript_preview": "User: hi\nAssistant: yo"})),
            None,
            Some(&cooldown),
            &mut parts,
        )
        .await;

        assert!(!outcome.had_error);
        // LLM spawn was skipped — RecordingTool was never invoked.
        assert!(
            spawn_calls.lock().unwrap().is_empty(),
            "cooldown must prevent the compactor LLM spawn from running"
        );
        // replace_middle still ran and received the fallback content.
        assert_eq!(replace_calls.lock().unwrap().len(), 1);
        let content = replace_calls.lock().unwrap()[0]
            .get("replacement_content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        assert!(
            content.contains("deterministic fallback"),
            "replace_middle must receive the fallback summary under cooldown, got: {content}"
        );
    }

    /// A healthy compactor returns substantive output → no fallback, no
    /// cooldown. Regression guard: the cooldown intercept must not fire on
    /// the happy path.
    #[tokio::test]
    async fn compactor_substantive_output_does_not_arm_cooldown() {
        let spawn_calls = Arc::new(Mutex::new(Vec::new()));
        let replace_calls = Arc::new(Mutex::new(Vec::new()));
        let healthy_summary = "## Primary Request\nUser asked for X.\n## Current Work\n\
                               Implementing Y.\n## Next Step\nWrite tests.\n## Pending\nNone.";
        let registry = ToolRegistry::new(vec![
            Arc::new(RecordingTool {
                name: "session.spawn",
                result: ToolResult::success(healthy_summary),
                calls: spawn_calls.clone(),
            }),
            Arc::new(RecordingTool {
                name: "transcript.replace_middle",
                result: ToolResult::success("replaced"),
                calls: replace_calls.clone(),
            }),
        ]);
        let ctx = ExecutionContext {
            session_id: "sess-happy".to_string(),
            ..Default::default()
        };
        let dispatch = ToolDispatch {
            registry: &registry,
            ctx: &ctx,
            session_store: None,
        };
        let event = crate::event_handler::Event {
            id: "ev-happy".to_string(),
            agent_id: None,
            scope: aeqi_core::Scope::Global,
            name: "on_context_budget_exceeded".to_string(),
            pattern: "context:budget:exceeded".to_string(),
            tool_calls: vec![
                crate::event_handler::ToolCall {
                    tool: "session.spawn".to_string(),
                    args: serde_json::json!({
                        "kind": "compactor",
                        "parent_session": "{session_id}",
                    }),
                },
                crate::event_handler::ToolCall {
                    tool: "transcript.replace_middle".to_string(),
                    args: serde_json::json!({
                        "preserve_head": 3,
                        "preserve_tail": 6,
                        "replacement_role": "system",
                        "replacement_content": "{last_tool_result}",
                    }),
                },
            ],
            enabled: true,
            cooldown_secs: 0,
            last_fired: None,
            fire_count: 0,
            total_cost_usd: 0.0,
            system: false,
            created_at: chrono::Utc::now(),
        };
        let cooldown = CompactorCooldown::new();
        let mut parts = Vec::new();

        let outcome = dispatch_event_tool_calls_with_trigger(
            &event,
            &dispatch,
            &AssemblyContext::default(),
            Some(&serde_json::json!({"transcript_preview": "a transcript"})),
            None,
            Some(&cooldown),
            &mut parts,
        )
        .await;

        assert!(!outcome.had_error);
        assert!(
            !cooldown.is_cooling_down("sess-happy"),
            "substantive compactor output must NOT arm the cooldown"
        );
        // The compactor ran exactly once and replace_middle saw the real
        // summary verbatim, not the fallback header.
        assert_eq!(spawn_calls.lock().unwrap().len(), 1);
        let content = replace_calls.lock().unwrap()[0]
            .get("replacement_content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        assert!(content.contains("Primary Request"));
        assert!(!content.contains("deterministic fallback"));
    }

    /// Events with NON-compactor patterns must not see any cooldown effect
    /// even when the cooldown is shared and engaged for the session. This
    /// proves the special-case gating lives at the pattern boundary, not
    /// the tool name boundary.
    #[tokio::test]
    async fn cooldown_does_not_affect_non_compactor_patterns() {
        // The dispatch helper itself uses `is_compactor_spawn` derived from
        // `kind=="compactor"` in args — for a non-compactor session.spawn
        // (e.g. `kind=continuation`) the intercept must NOT fire even when
        // cooldown is engaged.
        let spawn_calls = Arc::new(Mutex::new(Vec::new()));
        let registry = ToolRegistry::new(vec![Arc::new(RecordingTool {
            name: "session.spawn",
            result: ToolResult::success("continuation went fine"),
            calls: spawn_calls.clone(),
        })]);
        let ctx = ExecutionContext {
            session_id: "sess-cont".to_string(),
            ..Default::default()
        };
        let dispatch = ToolDispatch {
            registry: &registry,
            ctx: &ctx,
            session_store: None,
        };
        let event = crate::event_handler::Event {
            id: "ev-cont".to_string(),
            agent_id: None,
            scope: aeqi_core::Scope::Global,
            name: "delegated_continuation".to_string(),
            pattern: "session:custom".to_string(),
            tool_calls: vec![crate::event_handler::ToolCall {
                tool: "session.spawn".to_string(),
                args: serde_json::json!({
                    "kind": "continuation",
                    "parent_session": "{session_id}",
                }),
            }],
            enabled: true,
            cooldown_secs: 0,
            last_fired: None,
            fire_count: 0,
            total_cost_usd: 0.0,
            system: false,
            created_at: chrono::Utc::now(),
        };
        let cooldown = CompactorCooldown::new();
        cooldown.note_failure("sess-cont"); // would block a compactor spawn
        let mut parts = Vec::new();

        let outcome = dispatch_event_tool_calls_with_trigger(
            &event,
            &dispatch,
            &AssemblyContext::default(),
            None,
            None,
            Some(&cooldown),
            &mut parts,
        )
        .await;

        assert!(!outcome.had_error);
        assert_eq!(
            spawn_calls.lock().unwrap().len(),
            1,
            "continuation spawn must still run — cooldown is scoped to compactor kind"
        );
    }

    /// Events with non-empty `tool_calls` must not contribute context unless
    /// a `ToolDispatch` is present — dry-run callers should warn + skip rather
    /// than reintroduce the retired `idea_ids` fallback path.
    /// Hygiene guard for the observability-as-a-feature invariant:
    /// every production use of `assembled.fired_event_ids` (or the
    /// tuple-returning `assemble_step_ideas_for_worker`) must either
    /// (a) feed the ids into `record_fire` so the Events UI stays
    /// honest, or (b) live in a dry-run / preview path that is
    /// explicitly exempt (preflight, test-trigger, tests).
    ///
    /// This test scans `crates/aeqi-orchestrator/src` for consumers
    /// of `fired_event_ids` (or `step_fire_ids`) and asserts that
    /// each consumer file either contains a `record_fire(` call or
    /// is listed in `DRY_RUN_PATHS`. If someone introduces a new
    /// legitimate firing path without wiring `record_fire`, this
    /// catches it at build time — same regression shape as the
    /// original silent-telemetry leak.
    #[test]
    fn fired_event_ids_consumers_are_paired_with_record_fire() {
        const DRY_RUN_PATHS: &[&str] = &["ipc/events.rs", "ipc/quests.rs", "idea_assembly.rs"];
        let src_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut offenders: Vec<String> = Vec::new();
        let mut stack = vec![src_root.clone()];
        while let Some(dir) = stack.pop() {
            for entry in std::fs::read_dir(&dir).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    stack.push(path);
                    continue;
                }
                if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                    continue;
                }
                let content = std::fs::read_to_string(&path).unwrap();
                let uses_fired_ids =
                    content.contains(".fired_event_ids") || content.contains("step_fire_ids");
                if !uses_fired_ids {
                    continue;
                }
                let has_record_fire = content.contains("record_fire(");
                let rel = path
                    .strip_prefix(&src_root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                let is_dry_run = DRY_RUN_PATHS.iter().any(|p| rel.ends_with(p));
                if !has_record_fire && !is_dry_run {
                    offenders.push(rel);
                }
            }
        }
        assert!(
            offenders.is_empty(),
            "files consume `fired_event_ids`/`step_fire_ids` without a paired `record_fire` call \
             and are not on the dry-run allowlist: {offenders:?}. \
             Either wire `record_fire` for every contributing event, or add the file to \
             DRY_RUN_PATHS in this test with a comment explaining why it's a preview/dry-run path."
        );
    }

    /// T1.2: `clamp_outcome_score` keeps in-range values, clamps out-of-range
    /// to `[0.0, 1.0]`, and folds non-finite to `0.0`. Warnings are emitted as
    /// side effects and not asserted here — the dial is "don't reject the
    /// whole result", which is what the return value guarantees.
    #[test]
    fn t1_2_clamp_outcome_score_clamps_to_unit_interval() {
        assert!((clamp_outcome_score(0.0, "evt", "tool") - 0.0).abs() < f64::EPSILON);
        assert!((clamp_outcome_score(0.5, "evt", "tool") - 0.5).abs() < f64::EPSILON);
        assert!((clamp_outcome_score(1.0, "evt", "tool") - 1.0).abs() < f64::EPSILON);
        // Above range clamps to 1.0.
        assert!((clamp_outcome_score(1.5, "evt", "tool") - 1.0).abs() < f64::EPSILON);
        assert!((clamp_outcome_score(99.0, "evt", "tool") - 1.0).abs() < f64::EPSILON);
        // Below range clamps to 0.0.
        assert!((clamp_outcome_score(-0.1, "evt", "tool") - 0.0).abs() < f64::EPSILON);
        // NaN / infinity fold to 0.0.
        assert!((clamp_outcome_score(f64::NAN, "evt", "tool") - 0.0).abs() < f64::EPSILON);
        assert!((clamp_outcome_score(f64::INFINITY, "evt", "tool") - 0.0).abs() < f64::EPSILON);
        assert!((clamp_outcome_score(f64::NEG_INFINITY, "evt", "tool") - 0.0).abs() < f64::EPSILON);
    }
}
