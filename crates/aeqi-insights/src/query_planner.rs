//! Query planning for intelligent memory retrieval.
//!
//! Analyzes input text to generate typed, prioritized queries that target
//! different memory categories (domain knowledge, recent decisions, system
//! patterns, similar past tasks).  The planner produces a [`QueryPlan`] that
//! the retrieval pipeline executes in priority order, then merges and
//! deduplicates the results.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ── Query Types ─────────────────────────────────────────────────────────────

/// The semantic type of a memory query, used to prioritize and weight results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryType {
    /// Domain knowledge: facts, context, documentation.
    DomainKnowledge,
    /// Recent decisions: choices, tradeoffs, rationale.
    RecentDecisions,
    /// System patterns: deployment, infrastructure, configuration.
    SystemPatterns,
    /// Similar past tasks: implementation, fixes, refactors.
    SimilarPastTasks,
    /// General context: project-level or channel-level background.
    GeneralContext,
}

impl QueryType {
    /// Priority of this query type (higher = more important).
    ///
    /// | Type              | Priority |
    /// |-------------------|----------|
    /// | DomainKnowledge   | 5        |
    /// | RecentDecisions   | 4        |
    /// | SystemPatterns    | 3        |
    /// | SimilarPastTasks  | 2        |
    /// | GeneralContext    | 1        |
    pub fn priority(self) -> u8 {
        match self {
            Self::DomainKnowledge => 5,
            Self::RecentDecisions => 4,
            Self::SystemPatterns => 3,
            Self::SimilarPastTasks => 2,
            Self::GeneralContext => 1,
        }
    }

    /// Weight multiplier derived from priority for scoring.
    /// Normalized so DomainKnowledge = 1.0.
    pub fn priority_weight(self) -> f32 {
        self.priority() as f32 / 5.0
    }
}

impl std::fmt::Display for QueryType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DomainKnowledge => write!(f, "domain_knowledge"),
            Self::RecentDecisions => write!(f, "recent_decisions"),
            Self::SystemPatterns => write!(f, "system_patterns"),
            Self::SimilarPastTasks => write!(f, "similar_past_tasks"),
            Self::GeneralContext => write!(f, "general_context"),
        }
    }
}

// ── Typed Query ─────────────────────────────────────────────────────────────

/// A single query with its type and priority, produced by the planner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypedQuery {
    /// The text to search for.
    pub query_text: String,
    /// Semantic type of this query.
    pub query_type: QueryType,
    /// Priority (copied from `query_type.priority()` for convenience).
    pub priority: u8,
}

impl TypedQuery {
    /// Create a new typed query.
    pub fn new(query_text: impl Into<String>, query_type: QueryType) -> Self {
        Self {
            query_text: query_text.into(),
            priority: query_type.priority(),
            query_type,
        }
    }
}

// ── Query Plan ──────────────────────────────────────────────────────────────

/// A plan containing multiple typed queries to execute against the memory store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryPlan {
    /// Typed queries sorted by priority (descending).
    pub queries: Vec<TypedQuery>,
    /// Optional channel/project context for scoping.
    pub channel: Option<String>,
    /// Maximum results to retrieve per individual query.
    pub max_results_per_query: usize,
}

// ── Scored Result ───────────────────────────────────────────────────────────

/// A memory result from the query planner's merge step, carrying its source
/// query type for downstream weighting.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerScoredResult {
    /// Memory ID.
    pub id: String,
    /// Memory content.
    pub content: String,
    /// Score (weighted by query priority).
    pub score: f32,
    /// Which query type produced this result.
    pub source_query: QueryType,
}

// ── Keyword Detection ───────────────────────────────────────────────────────

/// Words that signal decision-related intent.
const DECISION_WORDS: &[&str] = &[
    "decide",
    "choose",
    "should",
    "whether",
    "option",
    "tradeoff",
    "trade-off",
    "decision",
    "chose",
    "decided",
    "choice",
    "alternative",
    "prefer",
];

/// Words that signal system/infrastructure intent.
const SYSTEM_WORDS: &[&str] = &[
    "deploy",
    "config",
    "setup",
    "server",
    "database",
    "migration",
    "infra",
    "infrastructure",
    "service",
    "port",
    "domain",
    "ssl",
    "nginx",
    "docker",
    "systemd",
    "configuration",
    "cluster",
    "kubernetes",
];

/// Words that signal task/action intent.
const ACTION_WORDS: &[&str] = &[
    "fix",
    "build",
    "implement",
    "create",
    "refactor",
    "update",
    "add",
    "remove",
    "change",
    "modify",
    "write",
    "debug",
    "optimize",
    "migrate",
    "rewrite",
];

/// Check if any keyword from the set appears in the lowercased input.
fn contains_any(input_lower: &str, keywords: &[&str]) -> bool {
    keywords.iter().any(|kw| input_lower.contains(kw))
}

// ── Planner ─────────────────────────────────────────────────────────────────

/// Analyzes input text and generates a prioritized plan of typed queries.
pub struct QueryPlanner;

impl QueryPlanner {
    /// Analyze the input and produce a query plan.
    ///
    /// Always generates:
    /// - A `DomainKnowledge` query (the input itself)
    /// - A `GeneralContext` query (channel/project name or generic)
    ///
    /// Conditionally generates:
    /// - `RecentDecisions` if decision-related words detected
    /// - `SystemPatterns` if system/infra words detected
    /// - `SimilarPastTasks` if action verbs detected
    ///
    /// Results are sorted by priority descending.
    pub fn plan(input: &str, channel: Option<&str>) -> QueryPlan {
        let lower = input.to_lowercase();
        let mut queries = Vec::with_capacity(5);

        // Always: domain knowledge query with the raw input.
        queries.push(TypedQuery::new(input, QueryType::DomainKnowledge));

        // Conditional: decision-related.
        if contains_any(&lower, DECISION_WORDS) {
            queries.push(TypedQuery::new(
                format!("decisions about: {input}"),
                QueryType::RecentDecisions,
            ));
        }

        // Conditional: system/infra patterns.
        if contains_any(&lower, SYSTEM_WORDS) {
            queries.push(TypedQuery::new(
                format!("system patterns: {input}"),
                QueryType::SystemPatterns,
            ));
        }

        // Conditional: similar past tasks.
        if contains_any(&lower, ACTION_WORDS) {
            queries.push(TypedQuery::new(
                format!("past tasks similar to: {input}"),
                QueryType::SimilarPastTasks,
            ));
        }

        // Always: general context scoped to channel.
        let context_text = match channel {
            Some(ch) => format!("context for {ch}"),
            None => "general project context".to_string(),
        };
        queries.push(TypedQuery::new(context_text, QueryType::GeneralContext));

        // Sort by priority descending.
        queries.sort_by(|a, b| b.priority.cmp(&a.priority));

        QueryPlan {
            queries,
            channel: channel.map(String::from),
            max_results_per_query: 10,
        }
    }

    /// Merge results from multiple typed queries into a single ranked list.
    ///
    /// - Deduplicates by memory ID (keeps the highest-weighted occurrence).
    /// - Applies priority weighting: `final_score = raw_score × priority_weight`.
    /// - Returns the top `max_total` results sorted by final score descending.
    pub fn merge_results(
        results: Vec<(TypedQuery, Vec<PlannerScoredResult>)>,
        max_total: usize,
    ) -> Vec<PlannerScoredResult> {
        // Deduplicate: for each id, keep the entry with the highest weighted score.
        let mut best: HashMap<String, PlannerScoredResult> = HashMap::new();

        for (query, scored_results) in results {
            let weight = query.query_type.priority_weight();
            for mut result in scored_results {
                let weighted_score = result.score * weight;
                let entry = best.entry(result.id.clone());
                match entry {
                    std::collections::hash_map::Entry::Vacant(v) => {
                        result.score = weighted_score;
                        result.source_query = query.query_type;
                        v.insert(result);
                    }
                    std::collections::hash_map::Entry::Occupied(mut o) => {
                        if weighted_score > o.get().score {
                            result.score = weighted_score;
                            result.source_query = query.query_type;
                            o.insert(result);
                        }
                    }
                }
            }
        }

        let mut merged: Vec<PlannerScoredResult> = best.into_values().collect();
        merged.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        merged.truncate(max_total);
        merged
    }
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── QueryType ───────────────────────────────────────────────────────

    #[test]
    fn query_type_priorities() {
        assert_eq!(QueryType::DomainKnowledge.priority(), 5);
        assert_eq!(QueryType::RecentDecisions.priority(), 4);
        assert_eq!(QueryType::SystemPatterns.priority(), 3);
        assert_eq!(QueryType::SimilarPastTasks.priority(), 2);
        assert_eq!(QueryType::GeneralContext.priority(), 1);
    }

    #[test]
    fn priority_weights_normalized() {
        assert!((QueryType::DomainKnowledge.priority_weight() - 1.0).abs() < f32::EPSILON);
        assert!((QueryType::GeneralContext.priority_weight() - 0.2).abs() < f32::EPSILON);
    }

    // ── Plan generation ─────────────────────────────────────────────────

    #[test]
    fn plan_always_includes_domain_and_general() {
        let plan = QueryPlanner::plan("hello world", None);

        let types: Vec<QueryType> = plan.queries.iter().map(|q| q.query_type).collect();
        assert!(
            types.contains(&QueryType::DomainKnowledge),
            "must always include DomainKnowledge"
        );
        assert!(
            types.contains(&QueryType::GeneralContext),
            "must always include GeneralContext"
        );
    }

    #[test]
    fn plan_detects_decision_words() {
        let plan = QueryPlanner::plan("should we choose PostgreSQL or MySQL?", None);
        let types: Vec<QueryType> = plan.queries.iter().map(|q| q.query_type).collect();
        assert!(
            types.contains(&QueryType::RecentDecisions),
            "input with 'should' and 'choose' must trigger RecentDecisions"
        );
    }

    #[test]
    fn plan_detects_system_words() {
        let plan = QueryPlanner::plan("deploy the new database migration", None);
        let types: Vec<QueryType> = plan.queries.iter().map(|q| q.query_type).collect();
        assert!(
            types.contains(&QueryType::SystemPatterns),
            "input with 'deploy', 'database', 'migration' must trigger SystemPatterns"
        );
    }

    #[test]
    fn plan_detects_action_words() {
        let plan = QueryPlanner::plan("fix the authentication bug", None);
        let types: Vec<QueryType> = plan.queries.iter().map(|q| q.query_type).collect();
        assert!(
            types.contains(&QueryType::SimilarPastTasks),
            "input with 'fix' must trigger SimilarPastTasks"
        );
    }

    #[test]
    fn plan_complex_input_triggers_multiple_types() {
        // Contains decision word ("should"), system word ("deploy"), action word ("fix").
        let plan = QueryPlanner::plan(
            "should we fix the server config before we deploy?",
            Some("aeqi/engineering"),
        );
        let types: Vec<QueryType> = plan.queries.iter().map(|q| q.query_type).collect();
        assert!(types.contains(&QueryType::DomainKnowledge));
        assert!(types.contains(&QueryType::RecentDecisions));
        assert!(types.contains(&QueryType::SystemPatterns));
        assert!(types.contains(&QueryType::SimilarPastTasks));
        assert!(types.contains(&QueryType::GeneralContext));
        assert_eq!(types.len(), 5, "all five query types should be present");
    }

    #[test]
    fn plan_simple_input_only_domain_and_general() {
        let plan = QueryPlanner::plan("what is the current status?", None);
        let types: Vec<QueryType> = plan.queries.iter().map(|q| q.query_type).collect();
        assert_eq!(
            types.len(),
            2,
            "simple input should produce exactly 2 queries"
        );
        assert!(types.contains(&QueryType::DomainKnowledge));
        assert!(types.contains(&QueryType::GeneralContext));
    }

    #[test]
    fn plan_sorted_by_priority_descending() {
        let plan = QueryPlanner::plan("should we fix the deploy config?", Some("aeqi"));
        for window in plan.queries.windows(2) {
            assert!(
                window[0].priority >= window[1].priority,
                "queries must be sorted by priority descending: {} >= {}",
                window[0].priority,
                window[1].priority
            );
        }
    }

    #[test]
    fn plan_channel_propagated() {
        let plan = QueryPlanner::plan("hello", Some("aeqi/engineering"));
        assert_eq!(plan.channel.as_deref(), Some("aeqi/engineering"));

        // GeneralContext query text should include the channel name.
        let general = plan
            .queries
            .iter()
            .find(|q| q.query_type == QueryType::GeneralContext)
            .unwrap();
        assert!(
            general.query_text.contains("aeqi/engineering"),
            "GeneralContext query should reference channel"
        );
    }

    #[test]
    fn plan_no_channel_general_context_fallback() {
        let plan = QueryPlanner::plan("hello", None);
        assert!(plan.channel.is_none());

        let general = plan
            .queries
            .iter()
            .find(|q| q.query_type == QueryType::GeneralContext)
            .unwrap();
        assert!(
            general.query_text.contains("general project context"),
            "without channel, GeneralContext should use fallback text"
        );
    }

    // ── Merge results ───────────────────────────────────────────────────

    fn make_result(id: &str, content: &str, score: f32, qt: QueryType) -> PlannerScoredResult {
        PlannerScoredResult {
            id: id.to_string(),
            content: content.to_string(),
            score,
            source_query: qt,
        }
    }

    #[test]
    fn merge_deduplicates_by_id() {
        let results = vec![
            (
                TypedQuery::new("q1", QueryType::DomainKnowledge),
                vec![make_result(
                    "mem-1",
                    "content A",
                    0.9,
                    QueryType::DomainKnowledge,
                )],
            ),
            (
                TypedQuery::new("q2", QueryType::GeneralContext),
                vec![make_result(
                    "mem-1",
                    "content A",
                    0.8,
                    QueryType::GeneralContext,
                )],
            ),
        ];

        let merged = QueryPlanner::merge_results(results, 10);
        assert_eq!(merged.len(), 1, "duplicate IDs should be deduplicated");
        assert_eq!(merged[0].id, "mem-1");
    }

    #[test]
    fn merge_keeps_highest_weighted_score() {
        let results = vec![
            (
                TypedQuery::new("q1", QueryType::DomainKnowledge), // weight = 1.0
                vec![make_result(
                    "mem-1",
                    "content",
                    0.5,
                    QueryType::DomainKnowledge,
                )],
            ),
            (
                TypedQuery::new("q2", QueryType::GeneralContext), // weight = 0.2
                vec![make_result(
                    "mem-1",
                    "content",
                    0.9,
                    QueryType::GeneralContext,
                )],
            ),
        ];

        let merged = QueryPlanner::merge_results(results, 10);
        assert_eq!(merged.len(), 1);
        // DomainKnowledge: 0.5 × 1.0 = 0.5
        // GeneralContext: 0.9 × 0.2 = 0.18
        // Should keep DomainKnowledge result.
        assert!(
            (merged[0].score - 0.5).abs() < 0.01,
            "should keep the higher weighted score (0.5), got {}",
            merged[0].score
        );
        assert_eq!(merged[0].source_query, QueryType::DomainKnowledge);
    }

    #[test]
    fn merge_respects_priority_weighting() {
        let results = vec![
            (
                TypedQuery::new("q1", QueryType::DomainKnowledge), // weight 1.0
                vec![make_result(
                    "mem-1",
                    "domain fact",
                    0.6,
                    QueryType::DomainKnowledge,
                )],
            ),
            (
                TypedQuery::new("q2", QueryType::SimilarPastTasks), // weight 0.4
                vec![make_result(
                    "mem-2",
                    "past task",
                    0.9,
                    QueryType::SimilarPastTasks,
                )],
            ),
        ];

        let merged = QueryPlanner::merge_results(results, 10);
        assert_eq!(merged.len(), 2);
        // mem-1: 0.6 × 1.0 = 0.60
        // mem-2: 0.9 × 0.4 = 0.36
        assert_eq!(
            merged[0].id, "mem-1",
            "domain result with priority weighting should rank first"
        );
        assert!(
            merged[0].score > merged[1].score,
            "first result score ({}) should exceed second ({})",
            merged[0].score,
            merged[1].score
        );
    }

    #[test]
    fn merge_truncates_to_max_total() {
        let many_results: Vec<PlannerScoredResult> = (0..20)
            .map(|i| {
                make_result(
                    &format!("mem-{i}"),
                    &format!("content {i}"),
                    0.5,
                    QueryType::DomainKnowledge,
                )
            })
            .collect();

        let results = vec![(
            TypedQuery::new("q1", QueryType::DomainKnowledge),
            many_results,
        )];

        let merged = QueryPlanner::merge_results(results, 5);
        assert_eq!(merged.len(), 5, "should truncate to max_total");
    }

    #[test]
    fn merge_empty_input_returns_empty() {
        let merged = QueryPlanner::merge_results(vec![], 10);
        assert!(merged.is_empty());
    }

    #[test]
    fn merge_sorted_by_score_descending() {
        let results = vec![(
            TypedQuery::new("q1", QueryType::DomainKnowledge),
            vec![
                make_result("mem-1", "a", 0.3, QueryType::DomainKnowledge),
                make_result("mem-2", "b", 0.9, QueryType::DomainKnowledge),
                make_result("mem-3", "c", 0.6, QueryType::DomainKnowledge),
            ],
        )];

        let merged = QueryPlanner::merge_results(results, 10);
        for window in merged.windows(2) {
            assert!(
                window[0].score >= window[1].score,
                "results must be sorted descending: {} >= {}",
                window[0].score,
                window[1].score
            );
        }
    }
}
