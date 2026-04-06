use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// An insight entry owned by an agent in the tree.
/// Scoping is positional — determined by which agent_id owns the insight,
/// not by an enum. Insight walks up the parent_id chain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InsightEntry {
    pub id: String,
    pub key: String,
    pub content: String,
    pub category: InsightCategory,
    /// The agent that owns this insight.
    pub agent_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub session_id: Option<String>,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum InsightCategory {
    Fact,
    Procedure,
    Preference,
    Context,
    Evergreen,
}

#[derive(Debug, Clone)]
pub struct InsightQuery {
    pub text: String,
    pub top_k: usize,
    pub category: Option<InsightCategory>,
    pub session_id: Option<String>,
    /// Filter to a specific agent's insights.
    pub agent_id: Option<String>,
    /// Also include shared insights from sibling agents (same parent).
    /// Populated by the caller from AgentRegistry.get_children(parent_id).
    pub sibling_agent_ids: Vec<String>,
}

impl InsightQuery {
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
pub trait Insight: Send + Sync {
    /// Store an insight owned by an agent.
    /// agent_id = None stores a global/system insight.
    async fn store(
        &self,
        key: &str,
        content: &str,
        category: InsightCategory,
        agent_id: Option<&str>,
    ) -> anyhow::Result<String>;

    /// Search insights, optionally filtered by agent_id.
    async fn search(&self, query: &InsightQuery) -> anyhow::Result<Vec<InsightEntry>>;

    /// Hierarchical search: walk the agent tree from leaf to root.
    /// `ancestor_ids` = [self_id, parent_id, grandparent_id, ..., root_id].
    /// Searches each agent's insights and merges by relevance score.
    async fn hierarchical_search(
        &self,
        query: &str,
        ancestor_ids: &[String],
        top_k: usize,
    ) -> anyhow::Result<Vec<InsightEntry>> {
        let mut all = Vec::new();

        for agent_id in ancestor_ids {
            let q = InsightQuery::new(query, top_k).with_agent(agent_id);
            if let Ok(entries) = self.search(&q).await {
                all.extend(entries);
            }
        }

        // Also search global insights (agent_id IS NULL).
        let mut q = InsightQuery::new(query, top_k);
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

    async fn delete(&self, id: &str) -> anyhow::Result<()>;

    fn name(&self) -> &str;

    /// Store an insight graph edge. Default is no-op.
    async fn store_insight_edge(
        &self,
        _source_id: &str,
        _target_id: &str,
        _relation: &str,
        _strength: f32,
    ) -> anyhow::Result<()> {
        Ok(())
    }
}
