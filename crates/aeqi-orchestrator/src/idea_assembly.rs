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

use std::collections::HashSet;
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
        let mut event_idea_ids: Vec<String> = Vec::new();
        for event in &events_for_agent {
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
        if let Some(store) = idea_store {
            for event in &events_for_agent {
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
    use crate::event_handler::{EventHandlerStore, NewEvent};
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
}
