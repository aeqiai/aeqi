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
//! ## Phase-1 tool_calls stub
//!
//! Events that have a non-empty `tool_calls` field take a separate path:
//! the legacy `idea_ids`/`query_template` processing is skipped and a
//! warning is logged. Phase 2 will replace the log with real tool dispatch.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use aeqi_core::prompt::{AssembledPrompt, PromptScope, ToolRestrictions};
use aeqi_core::traits::{Idea, IdeaStore};

use crate::agent_registry::AgentRegistry;
use crate::event_handler::EventHandlerStore;

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
pub async fn assemble_ideas(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
) -> AssembledPrompt {
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        &["session:start"],
        &AssemblyContext::default(),
    )
    .await
}

/// Assemble the prompt for a quest-start moment. Covers both session:start
/// (session-scoped context) and session:quest_start (quest-scoped context),
/// with `quest_description` threaded into any query_template that references
/// it — this is how the closed learning loop surfaces promoted skills
/// relevant to the quest.
pub async fn assemble_ideas_for_quest_start(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    quest_description: &str,
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
pub async fn assemble_ideas_for_pattern(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    event_pattern: &str,
    context: &AssemblyContext,
) -> AssembledPrompt {
    assemble_ideas_for_patterns(
        registry,
        idea_store,
        event_store,
        agent_id,
        task_idea_ids,
        &[event_pattern],
        context,
    )
    .await
}

/// Assemble ideas for multiple event patterns in a single ancestor traversal.
/// Deduplication of collected ideas spans all patterns so the same idea is
/// never injected twice, even if referenced by events matching different
/// patterns.
pub async fn assemble_ideas_for_patterns(
    registry: &AgentRegistry,
    idea_store: Option<&Arc<dyn IdeaStore>>,
    event_store: &EventHandlerStore,
    agent_id: &str,
    task_idea_ids: &[String],
    event_patterns: &[&str],
    context: &AssemblyContext,
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

        // Static idea_ids referenced directly by the event.
        // Events with non-empty `tool_calls` skip the legacy idea_ids/query_template
        // path (Phase-1 stub: log and produce no ideas; Phase 2 will dispatch tools).
        let mut event_idea_ids: Vec<String> = Vec::new();
        for event in &events_for_agent {
            if !event.tool_calls.is_empty() {
                tracing::warn!(
                    event_id = %event.id,
                    event_name = %event.name,
                    tool_calls_count = event.tool_calls.len(),
                    "tool_calls execution not yet implemented (Phase 1 stub) — skipping legacy idea_ids path for this event"
                );
                continue;
            }
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

/// Walk a JSON value recursively and replace `{key}` placeholders in every
/// string leaf using the provided `context` map.
///
/// - Known keys: substituted with the map value.
/// - Unknown keys: passed through literally (the `{key}` token is kept).
/// - Non-string values: left unchanged.
///
/// This is the Phase-1 stub implementation. Phase 2 will call it during
/// actual `tool_calls` dispatch to expand args before passing them to the
/// tool registry.
pub fn substitute_args(
    args: &serde_json::Value,
    context: &HashMap<String, String>,
) -> serde_json::Value {
    match args {
        serde_json::Value::String(s) => serde_json::Value::String(substitute_str(s, context)),
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(|v| substitute_args(v, context)).collect())
        }
        serde_json::Value::Object(map) => {
            let new_map: serde_json::Map<String, serde_json::Value> = map
                .iter()
                .map(|(k, v)| (k.clone(), substitute_args(v, context)))
                .collect();
            serde_json::Value::Object(new_map)
        }
        // Numbers, booleans, null — pass through unchanged.
        other => other.clone(),
    }
}

/// Substitute `{key}` tokens in a string using the context map.
/// Unknown keys are passed through literally.
fn substitute_str(s: &str, context: &HashMap<String, String>) -> String {
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
            } else {
                // Unknown placeholder — pass through literally.
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

        let assembled = assemble_ideas(&registry, Some(&store), &event_store, &agent.id, &[]).await;

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

        let assembled = assemble_ideas(&registry, Some(&store), &event_store, &agent.id, &[]).await;

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
