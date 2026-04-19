//! Idea assembly — event-driven prompt construction.
//!
//! Walks the agent ancestor chain, collects ideas activated by the
//! target event pattern, and concatenates their content into a single
//! system prompt. Tool restrictions from each idea merge across the set
//! (intersection of allows, union of denies). Scope controls whether an
//! ancestor's idea reaches the target agent.
//!
//! Events may also declare a `query_template`: a string with placeholders
//! that is expanded at fire-time and then run through the idea store's
//! semantic search. Returned ideas are merged after the static idea_ids.
//! Placeholder semantics are loose — unknown placeholders pass through
//! literally.
//!
//! ## Phase-2 tool_calls dispatch
//!
//! Events that have a non-empty `tool_calls` field take a separate path:
//! the legacy `idea_ids`/`query_template` processing is skipped.
//! When a `ToolDispatch` is provided, each tool call is executed via the
//! `ToolRegistry` and its output is appended to the assembled context.
//! When no `ToolDispatch` is provided (None), the old Phase-1 warning is
//! logged and the event produces no ideas (safe fallback for callers that
//! have not yet been updated to pass a registry).
//!
//! `substitute_args` is a convenience for operator-readable event configs
//! (e.g. `{user_input}` → actual value). It is NOT a security boundary.
//! Sensitive values like session_id and agent_id travel via ExecutionContext,
//! not through args.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use aeqi_core::prompt::{AssembledPrompt, PromptScope, ToolRestrictions};
use aeqi_core::tool_registry::{CallerKind, ExecutionContext, ToolRegistry};
use aeqi_core::traits::{Idea, IdeaStore};

use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;
use crate::session_store::SessionStore;

/// Combined tool registry + execution context for event-fired tool dispatch.
///
/// Passed into `assemble_ideas_for_patterns` when the caller wants tool_calls
/// on events to execute. When `None`, events with tool_calls fall back to the
/// Phase-1 behavior (log + skip).
pub struct ToolDispatch<'a> {
    pub registry: &'a ToolRegistry,
    pub ctx: &'a ExecutionContext,
    /// When provided, every invocation of `dispatch_event_tool_calls` writes
    /// telemetry rows into `event_invocations` / `event_invocation_steps`.
    pub session_store: Option<Arc<SessionStore>>,
}

/// Runtime values available to a query_template.
/// Fields left `None` substitute to the empty string; placeholders that do
/// not correspond to any known field pass through literally.
#[derive(Debug, Clone, Default)]
pub struct AssemblyContext {
    pub user_prompt: Option<String>,
    pub tool_output: Option<String>,
    pub quest_description: Option<String>,
}

/// Assemble the full prompt for an agent + task combination.
///
/// Order: root ancestor → ... → parent → self → task ideas.
/// Within each level, ideas are ordered as referenced by their events.
///
/// `tool_dispatch`: when `Some`, events with non-empty `tool_calls` are executed
/// via the registry. When `None`, events with tool_calls log a warning and are
/// skipped (Phase-1 fallback — callers that have not yet been wired to Phase 2).
pub async fn assemble_ideas(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledPrompt {
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        &["session:start"],
        &AssemblyContext::default(),
        tool_dispatch,
    )
    .await
}

/// Assemble the prompt for a quest-start moment. Covers both session:start
/// (session-scoped context) and session:quest_start (quest-scoped context),
/// with `quest_description` threaded into any query_template that references
/// it — this is how the closed learning loop surfaces promoted skills
/// relevant to the quest.
///
/// `tool_dispatch`: when `Some`, events with non-empty `tool_calls` are executed
/// via the registry. When `None`, events with tool_calls log a warning and are
/// skipped (Phase-1 fallback).
pub async fn assemble_ideas_for_quest_start(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    quest_description: &str,
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledPrompt {
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
    )
    .await
}

/// Collect `session:step_start` ideas for a worker's agent ancestry and
/// snapshot them into `StepIdeaSpec`s. Returns the specs plus the IDs of
/// every event that contributed at least one non-empty idea (so the
/// scheduler can `record_fire` each).
///
/// Fires once per worker-run (= session), matching interactive-chat
/// semantics — see design doc `docs/design/as-011-worker-step-context.md`
/// for the per-session vs per-LLM-call decision.
pub async fn assemble_step_ideas_for_worker(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
) -> (Vec<aeqi_core::StepIdeaSpec>, Vec<String>) {
    let Some(store) = idea_store else {
        return (Vec::new(), Vec::new());
    };

    let ancestors = registry.get_ancestors(agent_id).await.unwrap_or_default();
    let mut specs: Vec<aeqi_core::StepIdeaSpec> = Vec::new();
    let mut fired_event_ids: Vec<String> = Vec::new();
    let mut fired_event_seen: HashSet<String> = HashSet::new();
    let mut collected_idea_ids: HashSet<String> = HashSet::new();

    // Root-first walk so parent step ideas precede self's.
    for agent in ancestors.iter().rev() {
        let events = event_store
            .get_events_for_pattern(&agent.id, "session:step_start")
            .await;

        let mut event_idea_ids: Vec<String> = Vec::new();
        let mut event_owner: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for event in &events {
            for idea_id in &event.idea_ids {
                if !idea_id.is_empty() && collected_idea_ids.insert(idea_id.clone()) {
                    event_idea_ids.push(idea_id.clone());
                    event_owner.insert(idea_id.clone(), event.id.clone());
                }
            }
        }

        if event_idea_ids.is_empty() {
            continue;
        }

        match store.get_by_ids(&event_idea_ids).await {
            Ok(ideas) => {
                for idea in ideas {
                    specs.push(aeqi_core::StepIdeaSpec {
                        // TODO(as-012): StepIdeaSpec currently requires a path
                        // even for store-sourced ideas. Using idea.name keeps
                        // diagnostics readable until the spec grows a proper
                        // enum variant.
                        path: std::path::PathBuf::from(&idea.name),
                        allow_shell: false,
                        name: idea.name.clone(),
                        content: Some(idea.content.clone()),
                    });
                    if let Some(owner) = event_owner.get(&idea.id)
                        && fired_event_seen.insert(owner.clone())
                    {
                        fired_event_ids.push(owner.clone());
                    }
                }
            }
            Err(e) => {
                tracing::warn!(
                    agent = %agent.id,
                    error = %e,
                    "failed to fetch session:step_start ideas",
                );
            }
        }
    }

    (specs, fired_event_ids)
}

/// Like `assemble_ideas` but for an arbitrary event pattern and with an
/// explicit runtime context used to expand any `query_template` fields on
/// matching events.
///
/// `tool_dispatch`: when `Some`, events with non-empty `tool_calls` are executed
/// via the registry. When `None`, events with tool_calls log a warning and are
/// skipped (Phase-1 fallback).
pub async fn assemble_ideas_for_pattern(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    event_pattern: &str,
    context: &AssemblyContext,
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledPrompt {
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        &[event_pattern],
        context,
        tool_dispatch,
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
/// context. When `None`, events with tool_calls fall back to the Phase-1
/// behavior (warn + skip) so existing callers without a registry remain safe.
pub async fn assemble_ideas_for_patterns(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    event_patterns: &[&str],
    context: &AssemblyContext,
    tool_dispatch: Option<&ToolDispatch<'_>>,
) -> AssembledPrompt {
    // get_ancestors returns [self, parent, grandparent, ..., root].
    // We want root-first ordering.
    let ancestors = registry.get_ancestors(agent_id).await.unwrap_or_default();
    let ancestor_ids: Vec<String> = ancestors.iter().map(|a| a.id.clone()).collect();

    let mut parts: Vec<String> = Vec::new();
    let mut allow_sets: Vec<Vec<String>> = Vec::new();
    let mut deny_all: Vec<String> = Vec::new();
    let mut collected_idea_ids: HashSet<String> = HashSet::new();
    let mut fired_event_ids: Vec<String> = Vec::new();
    let mut fired_event_seen: HashSet<String> = HashSet::new();

    // Walk from root to self (reverse of get_ancestors order).
    for (depth, agent) in ancestors.iter().rev().enumerate() {
        let is_self = depth == ancestors.len() - 1;

        let mut events_for_agent: Vec<crate::event_handler::Event> = Vec::new();
        let mut seen_event_ids: HashSet<String> = HashSet::new();
        for pattern in event_patterns {
            for event in event_store.get_events_for_pattern(&agent.id, pattern).await {
                if seen_event_ids.insert(event.id.clone()) {
                    events_for_agent.push(event);
                }
            }
        }

        // Phase-2: dispatch tool_calls for events that have opted in.
        // When tool_dispatch is Some, run the tools and append their output to parts.
        // When tool_dispatch is None, warn and skip (Phase-1 fallback).
        let mut event_idea_ids: Vec<String> = Vec::new();
        for event in &events_for_agent {
            if !event.tool_calls.is_empty() {
                match tool_dispatch {
                    Some(dispatch) => {
                        let fired =
                            dispatch_event_tool_calls(event, dispatch, context, &mut parts).await;
                        if fired && fired_event_seen.insert(event.id.clone()) {
                            fired_event_ids.push(event.id.clone());
                        }
                    }
                    None => {
                        tracing::warn!(
                            event_id = %event.id,
                            event_name = %event.name,
                            tool_calls_count = event.tool_calls.len(),
                            "tool_calls dispatch skipped: no ToolDispatch provided \
                             (caller has not been updated to Phase 2 — skipping legacy idea_ids path)"
                        );
                    }
                }
                // Either dispatched or warned — skip legacy path either way.
                continue;
            }
            // Legacy path: static idea_ids.
            for idea_id in &event.idea_ids {
                if !idea_id.is_empty() && collected_idea_ids.insert(idea_id.clone()) {
                    event_idea_ids.push(idea_id.clone());
                }
            }
        }

        if let Some(store) = idea_store
            && !event_idea_ids.is_empty()
        {
            match store.get_by_ids(&event_idea_ids).await {
                Ok(ideas) => {
                    let event_owner: std::collections::HashMap<&str, &str> = events_for_agent
                        .iter()
                        .flat_map(|e| e.idea_ids.iter().map(move |i| (i.as_str(), e.id.as_str())))
                        .collect();
                    for idea in ideas {
                        append_idea(&idea, is_self, &mut parts, &mut allow_sets, &mut deny_all);
                        if let Some(owner) = event_owner.get(idea.id.as_str())
                            && fired_event_seen.insert(owner.to_string())
                        {
                            fired_event_ids.push(owner.to_string());
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(agent = %agent.id, error = %e, "failed to fetch event-referenced ideas");
                }
            }
        }

        // Dynamic query_template expansion → semantic search.
        // Skip events that have opted into the new tool_calls path.
        if let Some(store) = idea_store {
            for event in &events_for_agent {
                if !event.tool_calls.is_empty() {
                    continue;
                }
                let Some(template) = event.query_template.as_deref() else {
                    continue;
                };
                let expanded = expand_template(template, context);
                if expanded.trim().is_empty() {
                    continue;
                }
                let top_k = event.query_top_k.unwrap_or(5) as usize;
                let tag_filter = event.query_tag_filter.clone().unwrap_or_default();
                match store
                    .hierarchical_search_with_tags(&expanded, &ancestor_ids, top_k, &tag_filter)
                    .await
                {
                    Ok(ideas) => {
                        let mut injected_any = false;
                        for idea in ideas {
                            if collected_idea_ids.insert(idea.id.clone()) {
                                append_idea(
                                    &idea,
                                    is_self,
                                    &mut parts,
                                    &mut allow_sets,
                                    &mut deny_all,
                                );
                                injected_any = true;
                            }
                        }
                        if injected_any && fired_event_seen.insert(event.id.clone()) {
                            fired_event_ids.push(event.id.clone());
                        }
                    }
                    Err(e) => {
                        tracing::warn!(
                            agent = %agent.id,
                            event = %event.name,
                            error = %e,
                            "query_template semantic search failed"
                        );
                    }
                }
            }
        }
    }

    // Task ideas always apply to the target agent.
    if let Some(store) = idea_store
        && !task_idea_ids.is_empty()
    {
        let task_ids: Vec<String> = task_idea_ids
            .iter()
            .filter(|id| !id.is_empty() && collected_idea_ids.insert((*id).clone()))
            .cloned()
            .collect();
        if !task_ids.is_empty() {
            match store.get_by_ids(&task_ids).await {
                Ok(ideas) => {
                    for idea in ideas {
                        append_idea(&idea, true, &mut parts, &mut allow_sets, &mut deny_all);
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

    AssembledPrompt {
        system: parts.join("\n\n---\n\n"),
        tools: ToolRestrictions {
            allow: merged_allow,
            deny: deny_all,
        },
        fired_event_ids,
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

/// Execute the tool_calls declared on an event, appending their outputs to
/// `parts`. Returns `true` if at least one tool call produced non-empty output
/// (used to decide whether to add the event to `fired_event_ids`).
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
    parts: &mut Vec<String>,
) -> bool {
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
                } else {
                    // 5. Store result for chaining: scalar alias
                    //    `{last_tool_result}` and structured refs
                    //    `{tool_calls.N.output|data.path}`.
                    sub_ctx.insert("last_tool_result".to_string(), result.output.clone());
                    results_so_far.push(result.clone());

                    if !result.output.is_empty() && result.output != "(no ideas assembled)" {
                        // 6. Append output to assembled context parts.
                        parts.push(result.output.clone());
                        produced_output = true;

                        // Emit status for tools that assemble ideas (by name pattern).
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
            }
        }
    }

    // Close the invocation trace row.
    if let (Some(inv_id), Some(store)) = (invocation_id, &dispatch.session_store) {
        let (status, err) = if let Some(ref e) = invocation_error {
            ("error", Some(e.as_str()))
        } else {
            ("ok", None)
        };
        if let Err(e) = store.finish_invocation(inv_id, status, err).await {
            tracing::warn!(error = %e, "failed to close invocation trace row");
        }
    }

    produced_output
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
    let mut out = String::with_capacity(template.len());
    let bytes = template.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{'
            && let Some(close_rel) = template[i + 1..].find('}')
        {
            let close = i + 1 + close_rel;
            let key = &template[i + 1..close];
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

/// Append a single idea to the output buffers, checking scope rules.
fn append_idea(
    idea: &Idea,
    is_self: bool,
    parts: &mut Vec<String>,
    allow_sets: &mut Vec<Vec<String>>,
    deny_all: &mut Vec<String>,
) {
    let include = match idea.scope() {
        PromptScope::Descendants => true,
        PromptScope::SelfOnly => is_self,
    };
    if !include || idea.content.is_empty() {
        return;
    }
    parts.push(idea.content.clone());
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

/// Orchestrator-side `PatternDispatcher` that queries the event store for
/// enabled events matching a pattern and runs their `tool_calls` via the
/// `ToolRegistry`.
///
/// Wired into the agent by `SessionManager` so the agent loop can fire
/// `context:budget:exceeded` (and any future pattern) and delegate to a
/// configured event without depending on the orchestrator directly.
///
/// Returns `true` if at least one enabled event for the pattern ran all its
/// tool_calls without fatal error. Returns `false` if no event is configured
/// for the pattern — the caller falls back to inline handling.
pub struct EventPatternDispatcher {
    pub event_store: Arc<EventHandlerStore>,
    pub registry: Arc<ToolRegistry>,
    /// When set, invocation traces are written to `event_invocations` /
    /// `event_invocation_steps` for every dispatch.
    pub session_store: Option<Arc<SessionStore>>,
}

impl aeqi_core::tool_registry::PatternDispatcher for EventPatternDispatcher {
    fn dispatch<'a>(
        &'a self,
        pattern: &'a str,
        ctx: &'a aeqi_core::tool_registry::ExecutionContext,
        trigger_args: &'a serde_json::Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            // Query the event store for enabled events matching this exact pattern.
            let events = self
                .event_store
                .get_events_for_exact_pattern(&ctx.agent_id, pattern)
                .await;

            if events.is_empty() {
                return false;
            }

            // Enrich ctx with transcript_tail from trigger_args for {transcript_preview}
            // substitution in session.spawn and transcript.replace_middle args.
            let enriched_ctx = aeqi_core::tool_registry::ExecutionContext {
                session_id: ctx.session_id.clone(),
                agent_id: ctx.agent_id.clone(),
                transcript_tail: trigger_args
                    .get("transcript_preview")
                    .and_then(|v| v.as_str())
                    .map(str::to_string),
                ..Default::default()
            };

            let dispatch = ToolDispatch {
                registry: &self.registry,
                ctx: &enriched_ctx,
                session_store: self.session_store.clone(),
            };

            let assembly_ctx = AssemblyContext::default();
            let mut parts: Vec<String> = Vec::new();
            let mut handled = false;

            for event in &events {
                if !event.tool_calls.is_empty() {
                    let fired =
                        dispatch_event_tool_calls(event, &dispatch, &assembly_ctx, &mut parts)
                            .await;
                    if fired {
                        handled = true;
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
            }

            handled
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_registry::AgentRegistry;
    use crate::event_handler::{EventHandlerStore, NewEvent, ToolCall as EventToolCall};
    use aeqi_core::traits::{Idea, IdeaQuery, IdeaStore};
    use async_trait::async_trait;
    use chrono::Utc;
    use std::sync::Mutex;

    /// Stub idea store that captures `hierarchical_search` queries and
    /// returns one pre-seeded idea. Used to prove the on_quest_start path
    /// expands `{quest_description}` and merges the returned idea into the
    /// assembled prompt — this is the lu-005 closed-loop wiring.
    struct StubIdeaStore {
        seen_queries: Mutex<Vec<String>>,
        idea: Idea,
    }

    #[async_trait]
    impl IdeaStore for StubIdeaStore {
        async fn store(
            &self,
            _: &str,
            _: &str,
            _: &[String],
            _: Option<&str>,
        ) -> anyhow::Result<String> {
            unreachable!("stub should never be asked to store")
        }

        async fn search(&self, _q: &IdeaQuery) -> anyhow::Result<Vec<Idea>> {
            Ok(Vec::new())
        }

        async fn hierarchical_search(
            &self,
            query: &str,
            _ancestor_ids: &[String],
            _top_k: usize,
        ) -> anyhow::Result<Vec<Idea>> {
            self.seen_queries.lock().unwrap().push(query.to_string());
            Ok(vec![self.idea.clone()])
        }

        async fn hierarchical_search_with_tags(
            &self,
            query: &str,
            _ancestor_ids: &[String],
            _top_k: usize,
            _tags: &[String],
        ) -> anyhow::Result<Vec<Idea>> {
            self.seen_queries.lock().unwrap().push(query.to_string());
            Ok(vec![self.idea.clone()])
        }

        async fn get_by_ids(&self, ids: &[String]) -> anyhow::Result<Vec<Idea>> {
            // Return the seeded idea if its id is in the requested set — lets
            // tests exercise static idea_ids injection without spinning up the
            // real sqlite store.
            if ids.iter().any(|id| id == &self.idea.id) {
                Ok(vec![self.idea.clone()])
            } else {
                Ok(Vec::new())
            }
        }

        async fn delete(&self, _id: &str) -> anyhow::Result<()> {
            Ok(())
        }

        fn name(&self) -> &str {
            "stub"
        }
    }

    #[tokio::test]
    async fn quest_start_query_template_pulls_promoted_skills() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AgentRegistry::open(dir.path()).unwrap();
        let agent = registry
            .spawn("assistant", None, None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        let event_store = EventHandlerStore::new(registry.db());
        let event = event_store
            .create(&NewEvent {
                agent_id: Some(agent.id.clone()),
                name: "recall-promoted-skills".into(),
                pattern: "session:quest_start".into(),
                query_template: Some("skills relevant to: {quest_description}".into()),
                query_top_k: Some(3),
                ..Default::default()
            })
            .await
            .unwrap();

        let promoted_skill = Idea {
            id: "skill-1".to_string(),
            name: "promoted-skill".to_string(),
            content: "Prefer TDD for this quest type.".to_string(),
            tags: vec!["skill".into(), "promoted".into()],
            agent_id: Some(agent.id.clone()),
            created_at: Utc::now(),
            session_id: None,
            score: 1.0,
            inheritance: "self".to_string(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        };

        let stub = Arc::new(StubIdeaStore {
            seen_queries: Mutex::new(Vec::new()),
            idea: promoted_skill,
        });
        let store: Arc<dyn IdeaStore> = stub.clone();

        let assembled = assemble_ideas_for_quest_start(
            &registry,
            Some(&store),
            &event_store,
            &agent.id,
            &[],
            "Build feature X",
            None,
        )
        .await;

        assert!(
            assembled.system.contains("Prefer TDD for this quest type."),
            "assembled prompt must merge the promoted skill content, got: {:?}",
            assembled.system
        );

        let queries = stub.seen_queries.lock().unwrap();
        assert_eq!(
            queries.len(),
            1,
            "hierarchical_search should be invoked exactly once for one matching event"
        );
        assert_eq!(
            queries[0], "skills relevant to: Build feature X",
            "query_template should expand {{quest_description}} from AssemblyContext"
        );
        assert_eq!(
            assembled.fired_event_ids,
            vec![event.id.clone()],
            "event that produced an injected idea must appear in fired_event_ids so record_fire can run"
        );
    }

    /// Sibling regression: a plain `session:start` assembly must not trigger
    /// the `session:quest_start` event's query_template. This pins the fix
    /// where `get_events_for_pattern` could previously LIKE-prefix-match
    /// `session:start` against `session:quest_start`.
    #[tokio::test]
    async fn plain_session_start_does_not_fire_quest_start_template() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AgentRegistry::open(dir.path()).unwrap();
        let agent = registry
            .spawn("assistant", None, None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        let event_store = EventHandlerStore::new(registry.db());
        event_store
            .create(&NewEvent {
                agent_id: Some(agent.id.clone()),
                name: "quest-recall".into(),
                pattern: "session:quest_start".into(),
                query_template: Some("q: {quest_description}".into()),
                query_top_k: Some(3),
                ..Default::default()
            })
            .await
            .unwrap();

        let stub = Arc::new(StubIdeaStore {
            seen_queries: Mutex::new(Vec::new()),
            idea: Idea {
                id: "x".into(),
                name: "x".into(),
                content: "should not appear".into(),
                tags: Vec::new(),
                agent_id: Some(agent.id.clone()),
                created_at: Utc::now(),
                session_id: None,
                score: 0.0,
                inheritance: "self".into(),
                tool_allow: Vec::new(),
                tool_deny: Vec::new(),
            },
        });
        let store: Arc<dyn IdeaStore> = stub.clone();

        let assembled =
            assemble_ideas(&registry, Some(&store), &event_store, &agent.id, &[], None).await;

        assert!(
            !assembled.system.contains("should not appear"),
            "session:start assembly must not fire session:quest_start events"
        );
        assert!(
            stub.seen_queries.lock().unwrap().is_empty(),
            "no semantic search should run when only quest_start events exist"
        );
        assert!(
            assembled.fired_event_ids.is_empty(),
            "no event fired → fired_event_ids must remain empty, got {:?}",
            assembled.fired_event_ids
        );
    }

    /// Regression test for leak #5 (as-010): `session:quest_end` was declared as
    /// a system event but nothing in the runtime consumed it. The close tool's
    /// `action_close` now assembles ideas for this pattern and prepends them to
    /// the result. This test pins the read-side: a `session:quest_end` event
    /// with an attached idea_id must surface in assembled.system and the event
    /// must appear in fired_event_ids so record_fire runs.
    #[tokio::test]
    async fn quest_end_static_idea_ids_surface_in_assembly() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AgentRegistry::open(dir.path()).unwrap();
        let agent = registry
            .spawn("assistant", None, None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        let postmortem_idea = Idea {
            id: "quest-end-idea-1".to_string(),
            name: "postmortem-template".to_string(),
            content: "POSTMORTEM: list any regressions you might have introduced.".to_string(),
            tags: vec!["template".into()],
            agent_id: Some(agent.id.clone()),
            created_at: Utc::now(),
            session_id: None,
            score: 1.0,
            inheritance: "self".to_string(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        };

        let event_store = EventHandlerStore::new(registry.db());
        let event = event_store
            .create(&NewEvent {
                agent_id: Some(agent.id.clone()),
                name: "quest-postmortem".into(),
                pattern: "session:quest_end".into(),
                idea_ids: vec![postmortem_idea.id.clone()],
                ..Default::default()
            })
            .await
            .unwrap();

        let stub = Arc::new(StubIdeaStore {
            seen_queries: Mutex::new(Vec::new()),
            idea: postmortem_idea,
        });
        let store: Arc<dyn IdeaStore> = stub.clone();

        let context = AssemblyContext {
            quest_description: Some("Quest q-1 closed: refactor done".to_string()),
            ..Default::default()
        };
        let assembled = assemble_ideas_for_pattern(
            &registry,
            Some(&store),
            &event_store,
            &agent.id,
            &[],
            "session:quest_end",
            &context,
            None,
        )
        .await;

        assert!(
            assembled
                .system
                .contains("POSTMORTEM: list any regressions"),
            "quest_end event's static idea_ids must appear in assembled.system, got: {:?}",
            assembled.system
        );
        assert_eq!(
            assembled.fired_event_ids,
            vec![event.id.clone()],
            "the event that contributed an idea must be in fired_event_ids so record_fire runs"
        );
        assert!(
            stub.seen_queries.lock().unwrap().is_empty(),
            "no semantic search should run when the event has only static idea_ids"
        );
    }

    #[tokio::test]
    async fn step_ideas_for_worker_snapshots_content_and_fires() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AgentRegistry::open(dir.path()).unwrap();
        let agent = registry
            .spawn("assistant", None, None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        let step_idea = Idea {
            id: "step-idea-1".to_string(),
            name: "reminder-check-work".to_string(),
            content: "Before every tool call: re-read your last message.".to_string(),
            tags: vec!["step".into()],
            agent_id: Some(agent.id.clone()),
            created_at: Utc::now(),
            session_id: None,
            score: 1.0,
            inheritance: "self".to_string(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        };

        let event_store = EventHandlerStore::new(registry.db());
        let event = event_store
            .create(&NewEvent {
                agent_id: Some(agent.id.clone()),
                name: "step-reminder".into(),
                pattern: "session:step_start".into(),
                idea_ids: vec![step_idea.id.clone()],
                ..Default::default()
            })
            .await
            .unwrap();

        let stub = Arc::new(StubIdeaStore {
            seen_queries: Mutex::new(Vec::new()),
            idea: step_idea,
        });
        let store: Arc<dyn IdeaStore> = stub.clone();

        let (specs, fired) =
            assemble_step_ideas_for_worker(&registry, Some(&store), &event_store, &agent.id).await;

        assert_eq!(specs.len(), 1, "one step idea should surface");
        assert_eq!(
            specs[0].name, "reminder-check-work",
            "spec name must come from the idea, not the event"
        );
        assert_eq!(
            specs[0].content.as_deref(),
            Some("Before every tool call: re-read your last message."),
            "content must be snapshotted — no mid-flight disk re-reads"
        );
        assert_eq!(
            fired,
            vec![event.id],
            "the contributing event must be in fired_event_ids so record_fire runs"
        );
        assert!(
            stub.seen_queries.lock().unwrap().is_empty(),
            "no semantic search — session:step_start resolves by static idea_ids only",
        );
    }

    #[tokio::test]
    async fn step_ideas_for_worker_empty_when_no_matching_events() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AgentRegistry::open(dir.path()).unwrap();
        let agent = registry
            .spawn("assistant", None, None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        let event_store = EventHandlerStore::new(registry.db());

        let placeholder_idea = Idea {
            id: "placeholder".to_string(),
            name: "placeholder".to_string(),
            content: String::new(),
            tags: Vec::new(),
            agent_id: None,
            created_at: Utc::now(),
            session_id: None,
            score: 0.0,
            inheritance: "self".to_string(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        };
        let stub = Arc::new(StubIdeaStore {
            seen_queries: Mutex::new(Vec::new()),
            idea: placeholder_idea,
        });
        let store: Arc<dyn IdeaStore> = stub;

        let (specs, fired) =
            assemble_step_ideas_for_worker(&registry, Some(&store), &event_store, &agent.id).await;

        assert!(specs.is_empty(), "no events → no specs");
        assert!(fired.is_empty(), "no events → no fired_event_ids");
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

    /// Phase-1: events with non-empty `tool_calls` must NOT contribute ideas
    /// through the legacy `idea_ids` path — the stub path is taken instead,
    /// and assembled.system must be empty (no ideas from that event).
    #[tokio::test]
    async fn tool_calls_event_skips_legacy_idea_ids_path() {
        let dir = tempfile::tempdir().unwrap();
        let registry = AgentRegistry::open(dir.path()).unwrap();
        let agent = registry
            .spawn("assistant", None, None, Some("claude-sonnet-4.6"))
            .await
            .unwrap();

        let tc_idea = Idea {
            id: "tc-idea-1".to_string(),
            name: "tc-idea".to_string(),
            content: "SHOULD NOT APPEAR — owned by tool_calls event".to_string(),
            tags: vec!["test".into()],
            agent_id: Some(agent.id.clone()),
            created_at: Utc::now(),
            session_id: None,
            score: 1.0,
            inheritance: "self".to_string(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        };

        let event_store = EventHandlerStore::new(registry.db());
        // Create an event with both idea_ids AND tool_calls — the tool_calls
        // path should win, so the idea must not appear in assembled.system.
        event_store
            .create(&NewEvent {
                agent_id: Some(agent.id.clone()),
                name: "tc-event".into(),
                pattern: "session:start".into(),
                idea_ids: vec![tc_idea.id.clone()],
                tool_calls: vec![EventToolCall {
                    tool: "ideas.assemble".to_string(),
                    args: serde_json::json!({"names": ["session:primer"]}),
                }],
                ..Default::default()
            })
            .await
            .unwrap();

        let stub = Arc::new(StubIdeaStore {
            seen_queries: Mutex::new(Vec::new()),
            idea: tc_idea,
        });
        let store: Arc<dyn IdeaStore> = stub.clone();

        let assembled =
            assemble_ideas(&registry, Some(&store), &event_store, &agent.id, &[], None).await;

        assert!(
            !assembled.system.contains("SHOULD NOT APPEAR"),
            "tool_calls events must not fall through to legacy idea_ids path, got: {:?}",
            assembled.system
        );
        // No semantic search should run either.
        assert!(
            stub.seen_queries.lock().unwrap().is_empty(),
            "no query_template search must run when the event has tool_calls"
        );
    }

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
}
