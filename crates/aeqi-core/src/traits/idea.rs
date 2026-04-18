use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// An idea entry owned by an agent in the tree.
/// Scoping is positional — determined by which agent_id owns the idea,
/// not by an enum. Idea walks up the parent_id chain.
///
/// Everything is an idea. Entries with `injection_mode` set are
/// deterministically injected into the agent's context (like prompts).
/// Entries without it are recalled via semantic search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Idea {
    pub id: String,
    pub name: String,
    pub content: String,
    /// Tags classify the idea. Free-form strings. No "primary" concept.
    #[serde(default)]
    pub tags: Vec<String>,
    /// The agent that owns this idea.
    pub agent_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub session_id: Option<String>,
    pub score: f64,
    /// Injection mode: None = search-only, Some("system"|"prepend"|"append"|"step") = deterministic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub injection_mode: Option<String>,
    /// Inheritance scope: "self" (only this agent) or "descendants" (all children).
    #[serde(default = "default_inheritance")]
    pub inheritance: String,
    /// Tool allow-list (empty = all allowed).
    #[serde(default)]
    pub tool_allow: Vec<String>,
    /// Tool deny-list.
    #[serde(default)]
    pub tool_deny: Vec<String>,
}

fn default_inheritance() -> String {
    "self".to_string()
}

impl Idea {
    /// Convert an idea with injection_mode into a PromptEntry for prompt assembly.
    /// Maps injection_mode → PromptPosition, inheritance → PromptScope,
    /// and tool_allow/tool_deny → ToolRestrictions.
    pub fn to_prompt_entry(&self) -> crate::prompt::PromptEntry {
        let position = match self.injection_mode.as_deref() {
            Some("prepend") => crate::prompt::PromptPosition::Prepend,
            Some("append") => crate::prompt::PromptPosition::Append,
            // "system" or any other value → System (the default).
            _ => crate::prompt::PromptPosition::System,
        };
        let scope = match self.inheritance.as_str() {
            "descendants" => crate::prompt::PromptScope::Descendants,
            _ => crate::prompt::PromptScope::SelfOnly,
        };
        let tools = if self.tool_allow.is_empty() && self.tool_deny.is_empty() {
            None
        } else {
            Some(crate::prompt::ToolRestrictions {
                allow: self.tool_allow.clone(),
                deny: self.tool_deny.clone(),
            })
        };
        crate::prompt::PromptEntry {
            content: self.content.clone(),
            position,
            scope,
            tools,
        }
    }

    /// Create a search-returned entry (no injection metadata).
    #[allow(clippy::too_many_arguments)]
    pub fn recalled(
        id: String,
        name: String,
        content: String,
        tags: Vec<String>,
        agent_id: Option<String>,
        created_at: DateTime<Utc>,
        session_id: Option<String>,
        score: f64,
    ) -> Self {
        Self {
            id,
            name,
            content,
            tags,
            agent_id,
            created_at,
            session_id,
            score,
            injection_mode: None,
            inheritance: "self".to_string(),
            tool_allow: Vec::new(),
            tool_deny: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct IdeaQuery {
    pub text: String,
    pub top_k: usize,
    /// Filter: idea must have at least one of these tags (OR match).
    pub tags: Vec<String>,
    pub session_id: Option<String>,
    /// Filter to a specific agent's ideas.
    pub agent_id: Option<String>,
    /// Also include shared ideas from sibling agents (same parent).
    pub sibling_agent_ids: Vec<String>,
}

impl IdeaQuery {
    pub fn new(text: impl Into<String>, top_k: usize) -> Self {
        Self {
            text: text.into(),
            top_k,
            tags: Vec::new(),
            session_id: None,
            agent_id: None,
            sibling_agent_ids: Vec::new(),
        }
    }

    pub fn with_agent(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    /// Include shared ideas from sibling agents.
    pub fn with_siblings(mut self, sibling_ids: Vec<String>) -> Self {
        self.sibling_agent_ids = sibling_ids;
        self
    }
}

#[async_trait]
pub trait IdeaStore: Send + Sync {
    /// Store an idea owned by an agent.
    /// agent_id = None stores a global/system idea.
    /// tags = classification labels (e.g. ["fact", "engineering"]).
    async fn store(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
    ) -> anyhow::Result<String>;

    /// Search ideas, optionally filtered by agent_id.
    async fn search(&self, query: &IdeaQuery) -> anyhow::Result<Vec<Idea>>;

    /// Hierarchical search: walk the agent tree from leaf to root.
    /// `ancestor_ids` = [self_id, parent_id, grandparent_id, ..., root_id].
    /// Searches each agent's ideas and merges by relevance score.
    async fn hierarchical_search(
        &self,
        query: &str,
        ancestor_ids: &[String],
        top_k: usize,
    ) -> anyhow::Result<Vec<Idea>> {
        let mut all = Vec::new();

        for agent_id in ancestor_ids {
            let q = IdeaQuery::new(query, top_k).with_agent(agent_id);
            if let Ok(entries) = self.search(&q).await {
                all.extend(entries);
            }
        }

        // Also search global ideas (agent_id IS NULL).
        let mut q = IdeaQuery::new(query, top_k);
        q.agent_id = None;
        if let Ok(entries) = self.search(&q).await {
            // Only include entries that are truly global (no agent_id).
            all.extend(entries.into_iter().filter(|e| e.agent_id.is_none()));
        }

        // Dedup by id, sort by score, truncate.
        all.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        all.dedup_by(|a, b| a.id == b.id);
        all.truncate(top_k);
        Ok(all)
    }

    /// Store with an optional TTL in seconds. Default delegates to store() ignoring TTL.
    async fn store_with_ttl(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
        _ttl_secs: Option<u64>,
    ) -> anyhow::Result<String> {
        self.store(name, content, tags, agent_id).await
    }

    /// Search by key prefix (exact prefix match, not FTS). Default returns empty.
    fn search_by_prefix(&self, _prefix: &str, _limit: usize) -> anyhow::Result<Vec<Idea>> {
        Ok(Vec::new())
    }

    /// Delete expired entries. Default is no-op.
    fn cleanup_expired(&self) -> anyhow::Result<usize> {
        Ok(0)
    }

    async fn delete(&self, id: &str) -> anyhow::Result<()>;

    /// Update an existing idea's name, content, and/or tags.
    async fn update(
        &self,
        id: &str,
        name: Option<&str>,
        content: Option<&str>,
        tags: Option<&[String]>,
    ) -> anyhow::Result<()> {
        let _ = (id, name, content, tags);
        anyhow::bail!("update not supported by this store")
    }

    fn name(&self) -> &str;

    /// Retrieve ideas by their IDs (bulk fetch).
    /// Used by event-based idea assembly to fetch ideas referenced by events.
    async fn get_by_ids(&self, ids: &[String]) -> anyhow::Result<Vec<Idea>> {
        // Default implementation: return empty. Subclasses override with actual DB query.
        let _ = ids;
        Ok(Vec::new())
    }

    /// Reassign ideas from one agent_id to another.
    /// Used after agent spawning to reconcile name-based references with actual UUIDs.
    async fn reassign_agent(
        &self,
        _old_agent_id: &str,
        _new_agent_id: &str,
    ) -> anyhow::Result<u64> {
        Ok(0)
    }

    /// Retrieve all ideas with injection_mode IS NOT NULL across all agents.
    /// Returns tuples of (agent_id, injection_mode, Idea).
    /// Used by the migration from injection_mode to event-based activation.
    async fn get_injection_ideas(&self) -> anyhow::Result<Vec<(String, String, Idea)>> {
        Ok(Vec::new())
    }

    /// Store an idea graph edge. Default is no-op.
    async fn store_idea_edge(
        &self,
        _source_id: &str,
        _target_id: &str,
        _relation: &str,
        _strength: f32,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    /// Remove one or more idea graph edges. If `relation` is Some, deletes only
    /// edges with that exact relation; if None, deletes all edges between the
    /// two ideas. Returns the number of rows removed.
    async fn remove_idea_edge(
        &self,
        _source_id: &str,
        _target_id: &str,
        _relation: Option<&str>,
    ) -> anyhow::Result<usize> {
        Ok(0)
    }

    /// Fetch outgoing and incoming edges for an idea.
    /// `links` are edges where this idea is the source; `backlinks` where it is the target.
    /// Each tuple: (other_idea_id, other_idea_name, relation, strength).
    async fn idea_edges(&self, _idea_id: &str) -> anyhow::Result<IdeaEdges> {
        Ok(IdeaEdges::default())
    }
}

/// Outgoing and incoming edges for a single idea.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IdeaEdges {
    pub links: Vec<IdeaEdgeRow>,
    pub backlinks: Vec<IdeaEdgeRow>,
}

/// One row in an edge list — the "other side" of the edge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdeaEdgeRow {
    pub other_id: String,
    pub other_name: Option<String>,
    pub relation: String,
    pub strength: f32,
}
