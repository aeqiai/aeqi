use crate::scope::Scope;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

/// An idea entry owned by an agent in the tree.
///
/// Visibility is determined by the `scope` field and the `agent_id` anchor.
/// `agent_id = None` is only valid when `scope = Scope::Global`.
///
/// Everything is an idea. Activation is event-driven: events reference
/// ideas by id; assembling an agent's context walks matching events and
/// pulls their referenced ideas in.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Idea {
    pub id: String,
    pub name: String,
    pub content: String,
    /// Tags classify the idea. Free-form strings. No "primary" concept.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Anchor agent for visibility. `None` only valid when `scope = Global`.
    pub agent_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub session_id: Option<String>,
    pub score: f64,
    /// Visibility scope for this idea.
    #[serde(default)]
    pub scope: Scope,
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
    /// Resolve the idea's inheritance string to a PromptScope.
    pub fn scope(&self) -> crate::prompt::PromptScope {
        match self.inheritance.as_str() {
            "descendants" => crate::prompt::PromptScope::Descendants,
            _ => crate::prompt::PromptScope::SelfOnly,
        }
    }

    /// Tool restrictions attached to this idea, if any.
    pub fn tool_restrictions(&self) -> Option<crate::prompt::ToolRestrictions> {
        if self.tool_allow.is_empty() && self.tool_deny.is_empty() {
            None
        } else {
            Some(crate::prompt::ToolRestrictions {
                allow: self.tool_allow.clone(),
                deny: self.tool_deny.clone(),
            })
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
        let scope = if agent_id.is_none() {
            Scope::Global
        } else {
            Scope::SelfScope
        };
        Self {
            id,
            name,
            content,
            tags,
            agent_id,
            created_at,
            session_id,
            score,
            scope,
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
    /// When set, the search filters to ideas whose `agent_id` is in this list
    /// OR whose `scope = 'global'`. Computed by `scope_visibility` and passed
    /// down to avoid re-querying the agent tree inside aeqi-ideas.
    pub visible_anchor_ids: Option<Vec<String>>,
    /// When `true`, bypass the default `status='active'` filter and the
    /// "exclude sources of `supersedes` edges" filter. Used by history /
    /// audit queries that want the full version chain.
    #[allow(dead_code)]
    pub include_superseded: bool,
    /// Optional routing hint from the caller. `"auto"` (or `None`) means the
    /// retrieval pipeline picks tags from the corpus with weights; explicit
    /// `query.tags` remains a hard filter either way.
    pub route_hint: Option<String>,
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
            visible_anchor_ids: None,
            include_superseded: false,
            route_hint: None,
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

    /// Restrict results to ideas visible to the viewer, using a precomputed
    /// anchor-id list from `scope_visibility::visibility_sql_clause`.
    pub fn with_visible_anchors(mut self, ids: Vec<String>) -> Self {
        self.visible_anchor_ids = Some(ids);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IdeaStoreCapability {
    BasicRead,
    BasicWrite,
    RichWrite,
    AtomicSupersede,
    StatusWrite,
    EmbeddingWrite,
    TagAnalytics,
    ExplainedSearch,
    AccessTracking,
    Feedback,
    GraphEdges,
    EntityEdges,
    GraphWalk,
    AnnSearch,
    TemporalSearch,
    CoRetrievalDecay,
}

impl IdeaStoreCapability {
    pub const fn bit(self) -> u64 {
        match self {
            Self::BasicRead => 1 << 0,
            Self::BasicWrite => 1 << 1,
            Self::RichWrite => 1 << 2,
            Self::AtomicSupersede => 1 << 3,
            Self::StatusWrite => 1 << 4,
            Self::EmbeddingWrite => 1 << 5,
            Self::TagAnalytics => 1 << 6,
            Self::ExplainedSearch => 1 << 7,
            Self::AccessTracking => 1 << 8,
            Self::Feedback => 1 << 9,
            Self::GraphEdges => 1 << 10,
            Self::EntityEdges => 1 << 11,
            Self::GraphWalk => 1 << 12,
            Self::AnnSearch => 1 << 13,
            Self::TemporalSearch => 1 << 14,
            Self::CoRetrievalDecay => 1 << 15,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::BasicRead => "basic_read",
            Self::BasicWrite => "basic_write",
            Self::RichWrite => "rich_write",
            Self::AtomicSupersede => "atomic_supersede",
            Self::StatusWrite => "status_write",
            Self::EmbeddingWrite => "embedding_write",
            Self::TagAnalytics => "tag_analytics",
            Self::ExplainedSearch => "explained_search",
            Self::AccessTracking => "access_tracking",
            Self::Feedback => "feedback",
            Self::GraphEdges => "graph_edges",
            Self::EntityEdges => "entity_edges",
            Self::GraphWalk => "graph_walk",
            Self::AnnSearch => "ann_search",
            Self::TemporalSearch => "temporal_search",
            Self::CoRetrievalDecay => "co_retrieval_decay",
        }
    }
}

impl fmt::Display for IdeaStoreCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdeaStoreCapabilities {
    bits: u64,
}

impl IdeaStoreCapabilities {
    pub const fn empty() -> Self {
        Self { bits: 0 }
    }

    pub const fn basic() -> Self {
        Self::empty()
            .with(IdeaStoreCapability::BasicRead)
            .with(IdeaStoreCapability::BasicWrite)
    }

    pub const fn with(self, capability: IdeaStoreCapability) -> Self {
        Self {
            bits: self.bits | capability.bit(),
        }
    }

    pub const fn supports(self, capability: IdeaStoreCapability) -> bool {
        self.bits & capability.bit() != 0
    }
}

impl Default for IdeaStoreCapabilities {
    fn default() -> Self {
        Self::basic()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnsupportedIdeaStoreCapability {
    pub store: String,
    pub method: &'static str,
    pub capability: IdeaStoreCapability,
}

impl fmt::Display for UnsupportedIdeaStoreCapability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "idea store '{}' does not support {} required by {}",
            self.store, self.capability, self.method
        )
    }
}

impl std::error::Error for UnsupportedIdeaStoreCapability {}

pub fn unsupported_idea_store_capability<T>(
    store: &str,
    method: &'static str,
    capability: IdeaStoreCapability,
) -> anyhow::Result<T> {
    Err(UnsupportedIdeaStoreCapability {
        store: store.to_string(),
        method,
        capability,
    }
    .into())
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
        self.hierarchical_search_with_tags(query, ancestor_ids, top_k, &[])
            .await
    }

    /// Hierarchical search with a tag filter. When `tags` is non-empty, only
    /// ideas that match at least one of the tags are returned (OR semantics).
    /// Callers: `on_quest_start` uses this to restrict `query_template`
    /// retrieval to `[promoted]` so candidate/rejected ideas cannot leak into
    /// the assembled prompt purely on semantic similarity.
    async fn hierarchical_search_with_tags(
        &self,
        query: &str,
        ancestor_ids: &[String],
        top_k: usize,
        tags: &[String],
    ) -> anyhow::Result<Vec<Idea>> {
        let mut all = Vec::new();

        for agent_id in ancestor_ids {
            let mut q = IdeaQuery::new(query, top_k).with_agent(agent_id);
            q.tags = tags.to_vec();
            if let Ok(entries) = self.search(&q).await {
                all.extend(entries);
            }
        }

        // Also search global ideas (agent_id IS NULL).
        let mut q = IdeaQuery::new(query, top_k);
        q.agent_id = None;
        q.tags = tags.to_vec();
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

    /// Store with an explicit visibility scope. Default delegates to store() and ignores scope.
    /// Backends that persist scope should override this.
    async fn store_with_scope(
        &self,
        name: &str,
        content: &str,
        tags: &[String],
        agent_id: Option<&str>,
        _scope: crate::scope::Scope,
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

    /// Advertise optional store features so runtime layers can fail cleanly
    /// before invoking capability-specific methods through a trait object.
    fn capabilities(&self) -> IdeaStoreCapabilities {
        IdeaStoreCapabilities::basic()
    }

    /// Retrieve ideas by their IDs (bulk fetch).
    /// Used by event-based idea assembly to fetch ideas referenced by events.
    async fn get_by_ids(&self, ids: &[String]) -> anyhow::Result<Vec<Idea>> {
        // Default implementation: return empty. Subclasses override with actual DB query.
        let _ = ids;
        Ok(Vec::new())
    }

    /// Exact-match lookup by idea name, scoped to a specific agent or global
    /// (`agent_id = None` → global ideas). Used by orchestrator bootstrap to
    /// load seeded system prompts (e.g. `session:compact-prompt`) into agent
    /// config at build time. Default impl returns `None`; backends override.
    async fn get_by_name(
        &self,
        name: &str,
        agent_id: Option<&str>,
    ) -> anyhow::Result<Option<Idea>> {
        let _ = (name, agent_id);
        Ok(None)
    }

    /// Fetch the id of the `status='active'` idea row matching `(agent_id, name)`,
    /// if any. Mirrors the partial unique index
    /// `idx_ideas_agent_name_active_unique`: at most one active row per
    /// `(COALESCE(agent_id, ''), name)` pair. Used by the write-path dedup
    /// short-circuit to return a pre-existing id instead of tripping UNIQUE
    /// at INSERT time. Default is `None`; SQLite backend overrides.
    async fn get_active_id_by_name(
        &self,
        name: &str,
        agent_id: Option<&str>,
    ) -> anyhow::Result<Option<String>> {
        let _ = (name, agent_id);
        Ok(None)
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

    /// Store a cross-kind entity edge (e.g. idea → session, idea → quest).
    /// Default delegates to `store_idea_edge` when both kinds are
    /// `"idea"`; everything else is a no-op so non-SQLite stores stay
    /// usable. T1.8 backends override with a real implementation.
    async fn store_entity_edge(
        &self,
        source_kind: &str,
        source_id: &str,
        target_kind: &str,
        target_id: &str,
        relation: &str,
        strength: f32,
    ) -> anyhow::Result<()> {
        if source_kind == "idea" && target_kind == "idea" {
            return self
                .store_idea_edge(source_id, target_id, relation, strength)
                .await;
        }
        let _ = (
            source_kind,
            source_id,
            target_kind,
            target_id,
            relation,
            strength,
        );
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

    /// Fetch outgoing references for an idea across all entity kinds.
    /// Returns `(target_kind, target_id, relation, strength)` rows.
    /// Substrates without cross-kind support fall back to an empty vec
    /// so the trait stays usable from non-SQLite backends.
    async fn idea_references(&self, _idea_id: &str) -> anyhow::Result<Vec<EntityRef>> {
        Ok(Vec::new())
    }

    /// Return ideas that carry any of the given tags (OR match), newest first.
    /// Used by the idea-profile view to slice by tag group.
    async fn ideas_by_tags(&self, _tags: &[String], _limit: usize) -> anyhow::Result<Vec<Idea>> {
        Ok(Vec::new())
    }

    /// Return global ideas (agent_id IS NULL), newest first. Used by the
    /// graph view when no agent context is provided.
    async fn list_global_ideas(&self, _limit: usize) -> anyhow::Result<Vec<Idea>> {
        Ok(Vec::new())
    }

    /// Return every edge whose source OR target is in `ids`. Callers filter
    /// to pairs where both endpoints are in their node set.
    async fn edges_between(&self, _ids: &[String]) -> anyhow::Result<Vec<IdeaGraphEdge>> {
        Ok(Vec::new())
    }

    /// Replace all `mentions` / `embeds` edges for `source_id` based on a
    /// fresh parse of the idea's body. `adjacent` edges are never touched.
    ///
    /// `resolver` maps a referenced name (case-insensitively) to an idea id.
    /// Unresolved names are silently skipped — no stub nodes are created and
    /// no error is raised. Called inside a blocking context, so the resolver
    /// must be `Send + Sync`. The `for<'r>` HRTB lets callers pass borrows
    /// of any lifetime.
    ///
    /// Default is a no-op for stores that don't track edges.
    async fn reconcile_inline_edges(
        &self,
        _source_id: &str,
        _body: &str,
        _resolver: &(dyn for<'r> Fn(&'r str) -> Option<String> + Send + Sync),
    ) -> anyhow::Result<()> {
        Ok(())
    }

    // ── Round 2 additions (Agent S) ─────────────────────────────────────
    //
    // The following methods are added for downstream agents (W, R, N, G)
    // to plug into without changing trait signatures mid-round. Defaults
    // either return a structured unsupported-capability error or a
    // trivially-safe fallback that keeps existing call paths green.

    /// Provenance-rich store. Carries authored_by, confidence, bi-temporal
    /// validity window, status, and TTL in one payload.
    ///
    /// The SQLite backend treats this as the real underlying writer; the
    /// plainer `store`/`store_with_ttl`/`store_with_scope` entry points are
    /// thin wrappers that fill the missing fields with defaults. Agents R
    /// and W call this directly.
    async fn store_full(&self, input: StoreFull) -> anyhow::Result<String> {
        let _ = input;
        unsupported_idea_store_capability(self.name(), "store_full", IdeaStoreCapability::RichWrite)
    }

    /// Provenance-rich partial update. Only fields set on `patch` are touched.
    async fn update_full(&self, id: &str, patch: UpdateFull) -> anyhow::Result<()> {
        let _ = (id, patch);
        unsupported_idea_store_capability(
            self.name(),
            "update_full",
            IdeaStoreCapability::RichWrite,
        )
    }

    /// Atomically supersede an existing idea. Flips `old_id.status` to
    /// `superseded`, inserts the new row, and writes a `supersedes` edge
    /// from new → old — all in a single transaction. All-or-nothing: if
    /// any step fails no rows change, so the old idea is never left
    /// orphaned in `superseded` status without a replacement.
    ///
    /// Required because the v8 partial unique index enforces active-name
    /// uniqueness, and the three sub-ops (status flip, insert, edge) have
    /// an interlocked correctness contract that sequential calls cannot
    /// honour without risking partial state.
    ///
    /// Default delegates to the non-atomic sequence via the primitive
    /// methods on this trait — backends that support real transactions
    /// (SqliteIdeas) override with a true tx-wrapped implementation.
    async fn supersede_atomic(
        &self,
        old_id: &str,
        new_payload: StoreFull,
    ) -> anyhow::Result<String> {
        let _ = (old_id, new_payload);
        unsupported_idea_store_capability(
            self.name(),
            "supersede_atomic",
            IdeaStoreCapability::AtomicSupersede,
        )
    }

    /// Set `status` for an idea (active | archived | superseded | ...).
    /// Used by supersession and consolidation flows.
    async fn set_status(&self, id: &str, status: &str) -> anyhow::Result<()> {
        let _ = (id, status);
        unsupported_idea_store_capability(
            self.name(),
            "set_status",
            IdeaStoreCapability::StatusWrite,
        )
    }

    /// Attach a (possibly refreshed) embedding to an existing idea row and
    /// flip `embedding_pending = 0`. Called by the embed worker after async
    /// embedding completes.
    async fn set_embedding(&self, id: &str, embedding: &[f32]) -> anyhow::Result<()> {
        let _ = (id, embedding);
        unsupported_idea_store_capability(
            self.name(),
            "set_embedding",
            IdeaStoreCapability::EmbeddingWrite,
        )
    }

    /// Count ideas tagged `tag` created on/after `since`. Used by the
    /// consolidation threshold check on every store.
    async fn count_by_tag_since(
        &self,
        tag: &str,
        since: chrono::DateTime<chrono::Utc>,
    ) -> anyhow::Result<i64> {
        let _ = (tag, since);
        unsupported_idea_store_capability(
            self.name(),
            "count_by_tag_since",
            IdeaStoreCapability::TagAnalytics,
        )
    }

    /// Return active idea IDs carrying `tag` whose `created_at >= since`,
    /// ordered oldest-first (the natural "cluster to consolidate" shape).
    /// Capped at `limit` to bound payload size. Used by the consolidation
    /// threshold check so the consolidator persona sees the whole cluster,
    /// not just the triggering idea.
    async fn list_active_by_tag_since(
        &self,
        tag: &str,
        since: chrono::DateTime<chrono::Utc>,
        limit: usize,
    ) -> anyhow::Result<Vec<String>> {
        let _ = (tag, since, limit);
        unsupported_idea_store_capability(
            self.name(),
            "list_active_by_tag_since",
            IdeaStoreCapability::TagAnalytics,
        )
    }

    /// Search with per-component score explainability. Default wraps the
    /// existing `search` and attaches an empty `Why` to each hit so the
    /// new API is safe before Agent R fills in per-component scoring.
    async fn search_explained(&self, query: &IdeaQuery) -> anyhow::Result<Vec<SearchHit>> {
        let hits = self.search(query).await?;
        Ok(hits
            .into_iter()
            .map(|idea| {
                let final_score = idea.score as f32;
                SearchHit {
                    idea,
                    why: Why {
                        final_score,
                        ..Why::default()
                    },
                }
            })
            .collect())
    }

    /// Record that an idea was surfaced to a caller. Updates hotness
    /// signals (`access_count`, `last_accessed`) and appends an access log
    /// row. Hot path: must be fire-and-forget in production callers.
    ///
    /// Default is a no-op (no tracking backend).
    async fn record_access(&self, idea_id: &str, ctx: AccessContext) -> anyhow::Result<()> {
        let _ = (idea_id, ctx);
        Ok(())
    }

    /// Record a feedback signal (`used | useful | ignored | corrected |
    /// wrong | pinned`). Agent R maps signals onto hotness / feedback_boost
    /// and may emit `contradiction` edges for `wrong`.
    async fn record_feedback(
        &self,
        idea_id: &str,
        signal: &str,
        weight: f32,
        meta: FeedbackMeta,
    ) -> anyhow::Result<()> {
        let _ = (idea_id, signal, weight, meta);
        unsupported_idea_store_capability(
            self.name(),
            "record_feedback",
            IdeaStoreCapability::Feedback,
        )
    }

    /// Walk the idea graph up to `max_hops` from `from`, optionally
    /// restricting to the given relations. Returns the visited edges in
    /// traversal order. Agent G (Round 4c) wires the MCP
    /// `ideas(action='walk')` against this.
    async fn walk(
        &self,
        from: &str,
        max_hops: u32,
        relations: &[String],
    ) -> anyhow::Result<Vec<WalkStep>> {
        let _ = (from, max_hops, relations);
        unsupported_idea_store_capability(self.name(), "walk", IdeaStoreCapability::GraphWalk)
    }

    /// ANN-backed nearest-neighbour search over `query_vec`. Stores with
    /// `sqlite-vec` (migration v7) override; the default errors so callers
    /// can detect unavailability and fall back to the brute-force hybrid
    /// path. Agent N (Round 3c) supplies the real implementation.
    async fn ann_search(
        &self,
        query_vec: &[f32],
        top_k: usize,
    ) -> anyhow::Result<Vec<(String, f32)>> {
        let _ = (query_vec, top_k);
        unsupported_idea_store_capability(self.name(), "ann_search", IdeaStoreCapability::AnnSearch)
    }

    /// Bi-temporal query. Only returns ideas whose validity window covers
    /// `as_of` (i.e. `valid_from <= as_of AND (valid_until IS NULL OR
    /// valid_until > as_of)`). Ideas with `time_context='timeless'` are
    /// always included. Agent R wires this against the search pipeline.
    async fn search_as_of(
        &self,
        query: &IdeaQuery,
        as_of: chrono::DateTime<chrono::Utc>,
    ) -> anyhow::Result<Vec<Idea>> {
        let _ = (query, as_of);
        unsupported_idea_store_capability(
            self.name(),
            "search_as_of",
            IdeaStoreCapability::TemporalSearch,
        )
    }

    /// Decay `co_retrieved` edges that haven't been reinforced in `days`
    /// days. Multiplies their strength by 0.5 then drops edges below 0.01.
    /// Returns the number of edges touched.
    ///
    /// Default is `Ok(0)` — only the SQLite-backed store persists
    /// co-retrieval edges. Called by the daemon's background patrol
    /// (Agent R).
    async fn decay_co_retrieval_older_than(&self, _days: i64) -> anyhow::Result<u64> {
        Ok(0)
    }
}

/// Outgoing and incoming edges for a single idea.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IdeaEdges {
    pub links: Vec<IdeaEdgeRow>,
    pub backlinks: Vec<IdeaEdgeRow>,
}

/// One row in an edge list — the "other side" of the edge. T1.8 added
/// `other_kind` so cross-kind targets (sessions, quests, agents) are
/// distinguishable from idea→idea edges. Defaults to `"idea"` so legacy
/// serialised payloads deserialise unchanged.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdeaEdgeRow {
    /// Entity kind of the other side of the edge: `"idea"`, `"session"`,
    /// `"quest"`, `"agent"`, …
    #[serde(default = "default_idea_kind")]
    pub other_kind: String,
    pub other_id: String,
    /// Resolved name when `other_kind = "idea"`; `None` for cross-kind
    /// targets (UI consumers fetch the entity by id separately).
    pub other_name: Option<String>,
    pub relation: String,
    pub strength: f32,
}

fn default_idea_kind() -> String {
    "idea".to_string()
}

/// A full directed edge between two ideas, returned by graph queries.
/// Idea-only view; cross-kind edges are exposed via [`EntityRef`] /
/// `idea_edges`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdeaGraphEdge {
    pub source_id: String,
    pub target_id: String,
    pub relation: String,
    pub strength: f32,
}

/// One outgoing reference from an idea, kind-aware. Returned by
/// `ideas.references` (T1.8 IPC addition) so UI consumers can render
/// cross-kind references uniformly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityRef {
    pub kind: String,
    pub id: String,
    pub relation: String,
    pub strength: f32,
}

// ── Round 2 additions ─────────────────────────────────────────────────

/// Provenance-rich store payload. Covers every column that Agents W and R
/// need to write on the store path; stores that understand it use it as
/// the underlying writer and layer `store` / `store_with_ttl` /
/// `store_with_scope` on top.
#[derive(Debug, Clone)]
pub struct StoreFull {
    pub name: String,
    pub content: String,
    pub tags: Vec<String>,
    pub agent_id: Option<String>,
    pub scope: Scope,
    /// Who authored this content. Not the same as `agent_id`: `authored_by`
    /// is the tool / user / sub-agent that generated the text, while
    /// `agent_id` is the anchor the row hangs off for visibility.
    pub authored_by: Option<String>,
    /// Default 1.0 ("author stands by this"). Tag policies override.
    pub confidence: f32,
    pub expires_at: Option<DateTime<Utc>>,
    /// Real-world validity window start. `None` means "unknown / timeless".
    pub valid_from: Option<DateTime<Utc>>,
    /// Real-world validity end. `None` means "still valid".
    pub valid_until: Option<DateTime<Utc>>,
    /// Bi-temporal flavour. One of `timeless` (prefs, procedures),
    /// `event` (time-scoped fact), `state` (current-state fact that gets
    /// superseded over time).
    pub time_context: String,
    /// Lifecycle state. Usually `active`; supersession/consolidation sets
    /// to `superseded`/`archived`.
    pub status: String,
}

impl StoreFull {
    /// Sensible defaults for the "store this for me" path: timeless,
    /// active, confidence 1.0, no TTL, no pre-set validity window.
    pub fn new(name: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            content: content.into(),
            tags: Vec::new(),
            agent_id: None,
            scope: Scope::SelfScope,
            authored_by: None,
            confidence: 1.0,
            expires_at: None,
            valid_from: None,
            valid_until: None,
            time_context: "timeless".to_string(),
            status: "active".to_string(),
        }
    }
}

/// Provenance-rich partial update payload. Any field left `None` is
/// untouched; setting a field to `Some(..)` writes it.
#[derive(Debug, Clone, Default)]
pub struct UpdateFull {
    pub content: Option<String>,
    pub tags: Option<Vec<String>>,
    pub confidence: Option<f32>,
    pub embedding_pending: Option<bool>,
    pub updated_at: Option<DateTime<Utc>>,
    pub valid_until: Option<DateTime<Utc>>,
    pub status: Option<String>,
}

/// A single search result with per-component explainability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub idea: Idea,
    pub why: Why,
}

/// Per-component score breakdown for an explainable search result.
///
/// Agent R populates these during the staged pipeline; components that
/// didn't contribute for this hit are left at 0.0. `picked_by_tag` records
/// which tag's policy routed the query onto this result in the cross-tag
/// weighted-sum merge.
#[derive(Default, Clone, Debug, Serialize, Deserialize)]
pub struct Why {
    pub picked_by_tag: Option<String>,
    pub bm25: f32,
    pub vector: f32,
    pub hotness: f32,
    pub graph: f32,
    pub confidence: f32,
    pub decay: f32,
    pub final_score: f32,
    /// Whether this hit was produced freshly or served from the recall
    /// cache (with the age at which it was served). Added AFTER existing
    /// fields and defaulted via serde so older serialised payloads still
    /// deserialise cleanly.
    #[serde(default)]
    pub cache: CacheSource,
}

/// Source annotation for a [`Why`]: whether the hit was computed by the
/// staged pipeline on this request, or served from the daemon-side recall
/// cache. `Hit` carries the cache entry's age in milliseconds so consumers
/// can reason about freshness.
#[derive(Default, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CacheSource {
    #[default]
    Fresh,
    Hit {
        age_ms: u32,
    },
}

/// One hop of a multi-hop graph walk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalkStep {
    pub from: String,
    pub to: String,
    pub relation: String,
    pub depth: u32,
    pub strength: f32,
}

/// Context metadata for an access-log row (`record_access`).
#[derive(Debug, Clone, Default)]
pub struct AccessContext {
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    /// Free-form category: `search`, `assemble`, `mcp`, `ui:idea-profile`,
    /// etc.
    pub context: String,
    /// 0-based rank within the result set, when the access came from a
    /// ranked search. `None` for direct lookups.
    pub result_position: Option<i32>,
    /// Stable hash of the triggering query text for co-access bucketing.
    pub query_hash: Option<String>,
}

/// Context metadata for a feedback row (`record_feedback`).
#[derive(Debug, Clone, Default)]
pub struct FeedbackMeta {
    pub agent_id: Option<String>,
    pub session_id: Option<String>,
    pub query_text: Option<String>,
    pub note: Option<String>,
}

/// Open enum of known feedback signals. Wire-format is the `&str` version;
/// this enum is a convenience for callers that want type-safety.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedbackSignal {
    Used,
    Useful,
    Ignored,
    Corrected,
    Wrong,
    Pinned,
}

impl FeedbackSignal {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Used => "used",
            Self::Useful => "useful",
            Self::Ignored => "ignored",
            Self::Corrected => "corrected",
            Self::Wrong => "wrong",
            Self::Pinned => "pinned",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct BasicStore;

    #[async_trait]
    impl IdeaStore for BasicStore {
        async fn store(
            &self,
            _name: &str,
            _content: &str,
            _tags: &[String],
            _agent_id: Option<&str>,
        ) -> anyhow::Result<String> {
            Ok("basic".to_string())
        }

        async fn search(&self, _query: &IdeaQuery) -> anyhow::Result<Vec<Idea>> {
            Ok(Vec::new())
        }

        async fn delete(&self, _id: &str) -> anyhow::Result<()> {
            Ok(())
        }

        fn name(&self) -> &str {
            "basic-test"
        }
    }

    #[test]
    fn default_capabilities_are_basic_only() {
        let caps = BasicStore.capabilities();
        assert!(caps.supports(IdeaStoreCapability::BasicRead));
        assert!(caps.supports(IdeaStoreCapability::BasicWrite));
        assert!(!caps.supports(IdeaStoreCapability::RichWrite));
        assert!(!caps.supports(IdeaStoreCapability::Feedback));
    }

    #[tokio::test]
    async fn advanced_defaults_return_typed_unsupported_errors() {
        let err = BasicStore
            .store_full(StoreFull {
                name: "name".to_string(),
                content: "content".to_string(),
                tags: Vec::new(),
                agent_id: None,
                scope: Scope::Global,
                authored_by: None,
                confidence: 1.0,
                expires_at: None,
                valid_from: None,
                valid_until: None,
                time_context: "timeless".to_string(),
                status: "active".to_string(),
            })
            .await
            .expect_err("unsupported rich write should return Err, not panic");

        let unsupported = err
            .downcast_ref::<UnsupportedIdeaStoreCapability>()
            .expect("error should preserve unsupported capability type");
        assert_eq!(unsupported.store, "basic-test");
        assert_eq!(unsupported.method, "store_full");
        assert_eq!(unsupported.capability, IdeaStoreCapability::RichWrite);
    }

    #[tokio::test]
    async fn embedding_default_returns_typed_unsupported_error() {
        let err = BasicStore
            .set_embedding("idea-id", &[0.1, 0.2])
            .await
            .expect_err("unsupported embedding write should return Err, not panic");

        let unsupported = err
            .downcast_ref::<UnsupportedIdeaStoreCapability>()
            .expect("error should preserve unsupported capability type");
        assert_eq!(unsupported.method, "set_embedding");
        assert_eq!(unsupported.capability, IdeaStoreCapability::EmbeddingWrite);
    }
}
