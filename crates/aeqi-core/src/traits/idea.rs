use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// An idea entry owned by an agent in the tree.
/// Scoping is positional — determined by which agent_id owns the insight,
/// not by an enum. Insight walks up the parent_id chain.
///
/// Everything is an insight. Entries with `injection_mode` set are
/// deterministically injected into the agent's context (like prompts).
/// Entries without it are recalled via semantic search.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Idea {
    pub id: String,
    pub key: String,
    pub content: String,
    pub category: IdeaCategory,
    /// The agent that owns this insight.
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
    /// Create a search-returned entry (no injection metadata).
    pub fn recalled(
        id: String,
        key: String,
        content: String,
        category: IdeaCategory,
        agent_id: Option<String>,
        created_at: DateTime<Utc>,
        session_id: Option<String>,
        score: f64,
    ) -> Self {
        Self {
            id,
            key,
            content,
            category,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum IdeaCategory {
    Fact,
    Procedure,
    Preference,
    Context,
    Evergreen,
}

#[derive(Debug, Clone)]
pub struct IdeaQuery {
    pub text: String,
    pub top_k: usize,
    pub category: Option<IdeaCategory>,
    pub session_id: Option<String>,
    /// Filter to a specific agent's insights.
    pub agent_id: Option<String>,
    /// Also include shared insights from sibling agents (same parent).
    /// Populated by the caller from AgentRegistry.get_children(parent_id).
    pub sibling_agent_ids: Vec<String>,
}

impl IdeaQuery {
    pub fn new(text: impl Into<String>, top_k: usize) -> Self {
        Self {
            text: text.into(),
            top_k,
            category: None,
            session_id: None,
            agent_id: None,
            sibling_agent_ids: Vec::new(),
        }
    }

    pub fn with_agent(mut self, agent_id: impl Into<String>) -> Self {
        self.agent_id = Some(agent_id.into());
        self
    }

    /// Include shared insights from sibling agents.
    pub fn with_siblings(mut self, sibling_ids: Vec<String>) -> Self {
        self.sibling_agent_ids = sibling_ids;
        self
    }
}

#[async_trait]
pub trait IdeaStore: Send + Sync {
    /// Store an insight owned by an agent.
    /// agent_id = None stores a global/system insight.
    async fn store(
        &self,
        key: &str,
        content: &str,
        category: IdeaCategory,
        agent_id: Option<&str>,
    ) -> anyhow::Result<String>;

    /// Search insights, optionally filtered by agent_id.
    async fn search(&self, query: &IdeaQuery) -> anyhow::Result<Vec<Idea>>;

    /// Hierarchical search: walk the agent tree from leaf to root.
    /// `ancestor_ids` = [self_id, parent_id, grandparent_id, ..., root_id].
    /// Searches each agent's insights and merges by relevance score.
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

        // Also search global insights (agent_id IS NULL).
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
        key: &str,
        content: &str,
        category: IdeaCategory,
        agent_id: Option<&str>,
        _ttl_secs: Option<u64>,
    ) -> anyhow::Result<String> {
        self.store(key, content, category, agent_id).await
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

    fn name(&self) -> &str;

    /// Store a prompt-type insight (deterministically injected into agent context).
    /// This is the unified API for what was previously stored in the prompts table.
    #[allow(clippy::too_many_arguments)]
    async fn store_prompt(
        &self,
        key: &str,
        content: &str,
        agent_id: Option<&str>,
        _injection_mode: &str,
        _inheritance: &str,
        _tool_allow: &[String],
        _tool_deny: &[String],
    ) -> anyhow::Result<String> {
        // Default implementation: fall back to store() — subclasses override.
        self.store(key, content, IdeaCategory::Evergreen, agent_id)
            .await
    }

    /// Retrieve all prompt-type insights for an agent (injection_mode IS NOT NULL).
    /// Returns entries ordered for prompt assembly.
    async fn get_prompts(
        &self,
        _agent_id: &str,
    ) -> anyhow::Result<Vec<Idea>> {
        Ok(Vec::new())
    }

    /// Retrieve prompt-type insights for an agent and all its ancestors.
    /// Used by prompt_assembly to build the full system prompt.
    async fn get_prompts_for_chain(
        &self,
        _ancestor_ids: &[String],
    ) -> anyhow::Result<Vec<Idea>> {
        Ok(Vec::new())
    }

    /// Store an insight graph edge. Default is no-op.
    async fn store_idea_edge(
        &self,
        _source_id: &str,
        _target_id: &str,
        _relation: &str,
        _strength: f32,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}
