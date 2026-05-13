//! Idea deduplication pipeline.
//!
//! Before storing a new idea, the pipeline checks for similar existing
//! ideas and decides: **Skip** (near-duplicate), **Create** (novel),
//! **Merge** (enhances existing), or **Supersede** (contradicts existing).
//!
//! This is the heuristic fast-path; a future LLM judgment layer can refine
//! the decision for ambiguous cases.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Similarity above which two ideas may be considered near-identical.
///
/// This is intentionally not enough by itself to skip a write: the decision
/// also requires an exact normalized name or content match so topical overlap
/// does not discard distinct operational memories.
pub const NEAR_DUPLICATE_THRESHOLD: f32 = 0.95;

// ── Types ───────────────────────────────────────────────────────────────────

/// Action the pipeline recommends for a candidate idea.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DedupAction {
    /// Candidate is a near-duplicate — discard it.
    Skip,
    /// Candidate is novel enough — store as a new idea.
    Create,
    /// Candidate should be merged into an existing idea (by id).
    Merge(String),
    /// Candidate supersedes (contradicts) an existing idea (by id).
    Supersede(String),
}

/// A candidate idea about to be stored.
#[derive(Debug, Clone)]
pub struct DedupCandidate {
    /// Semantic name (e.g. "auth/jwt-rotation").
    pub name: String,
    /// Full content text.
    pub content: String,
    /// Optional pre-computed embedding for vector comparison.
    pub embedding: Option<Vec<f32>>,
}

/// An existing idea that may be similar to the candidate.
#[derive(Debug, Clone)]
pub struct SimilarIdea {
    /// Idea ID in the store.
    pub id: String,
    /// Semantic name.
    pub name: String,
    /// Full content text.
    pub content: String,
    /// Similarity score to the candidate (`0.0..=1.0`).
    pub similarity: f32,
}

// ── Pipeline ────────────────────────────────────────────────────────────────

/// Deduplication pipeline that decides whether a candidate idea should be
/// created, merged, skipped, or used to supersede an existing idea.
pub struct DedupPipeline {
    /// Minimum similarity to consider two ideas related (default 0.85).
    pub similarity_threshold: f32,
}

impl Default for DedupPipeline {
    fn default() -> Self {
        Self {
            similarity_threshold: 0.85,
        }
    }
}

impl DedupPipeline {
    /// Create a pipeline with a custom similarity threshold.
    pub fn new(similarity_threshold: f32) -> Self {
        Self {
            similarity_threshold,
        }
    }

    /// Filter existing ideas to those above the similarity threshold.
    pub fn find_similar<'a>(
        &self,
        _candidate: &DedupCandidate,
        existing: &'a [SimilarIdea],
    ) -> Vec<&'a SimilarIdea> {
        existing
            .iter()
            .filter(|m| m.similarity >= self.similarity_threshold)
            .collect()
    }

    /// Decide what to do with a candidate given a set of similar ideas.
    ///
    /// Decision logic (evaluated in order):
    /// 1. No similar ideas → **Create**
    /// 2. Similarity > 0.95 → **Skip** (near-duplicate)
    /// 3. Contradiction detected → **Supersede** the top match
    /// 4. Same key and similarity 0.85–0.95 → **Merge** with top match
    /// 5. Otherwise → **Create** (novel enough)
    pub fn decide(&self, candidate: &DedupCandidate, similar: &[SimilarIdea]) -> DedupAction {
        let above_threshold: Vec<&SimilarIdea> = similar
            .iter()
            .filter(|m| m.similarity >= self.similarity_threshold)
            .collect();

        if above_threshold.is_empty() {
            return DedupAction::Create;
        }

        // Sort by similarity descending to find the top match.
        let Some(top) = above_threshold.iter().max_by(|a, b| {
            a.similarity
                .partial_cmp(&b.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        }) else {
            return DedupAction::Create;
        };

        // Near-duplicate: skip only with a hard identity anchor. High lexical
        // overlap alone is not enough; distinct memories can share a lot of
        // vocabulary when they describe the same subsystem or incident.
        if top.similarity > NEAR_DUPLICATE_THRESHOLD
            && (normalize_text(&candidate.name) == normalize_text(&top.name)
                || normalize_text(&candidate.content) == normalize_text(&top.content))
        {
            return DedupAction::Skip;
        }

        // Contradiction: supersede.
        if is_contradiction(&candidate.content, &top.content) {
            return DedupAction::Supersede(top.id.clone());
        }

        // Same name, moderate similarity: merge.
        if candidate.name == top.name {
            return DedupAction::Merge(top.id.clone());
        }

        // Novel enough.
        DedupAction::Create
    }
}

/// Lexical similarity for the store-time dedup gate.
///
/// Ranked search scores are retrieval signals, not duplicate probabilities.
/// This helper maps candidate/existing text into a bounded similarity score
/// that is intentionally conservative: exact names carry weight, but content
/// token overlap must still be high for a near-duplicate decision.
pub fn lexical_similarity(
    candidate_name: &str,
    candidate_content: &str,
    existing_name: &str,
    existing_content: &str,
) -> f32 {
    let name_score = if normalize_text(candidate_name) == normalize_text(existing_name) {
        1.0
    } else {
        jaccard_tokens(candidate_name, existing_name)
    };

    let content_score = if normalize_text(candidate_content) == normalize_text(existing_content) {
        1.0
    } else {
        jaccard_tokens(candidate_content, existing_content)
    };

    (0.35 * name_score) + (0.65 * content_score)
}

fn normalize_text(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn jaccard_tokens(a: &str, b: &str) -> f32 {
    let a = token_set(a);
    let b = token_set(b);
    if a.is_empty() && b.is_empty() {
        return 1.0;
    }
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }

    let intersection = a.intersection(&b).count() as f32;
    let union = a.union(&b).count() as f32;
    if union == 0.0 {
        0.0
    } else {
        intersection / union
    }
}

fn token_set(input: &str) -> HashSet<String> {
    let mut tokens = HashSet::new();
    let mut current = String::new();

    for ch in input.chars().flat_map(char::to_lowercase) {
        if ch.is_alphanumeric() {
            current.push(ch);
        } else if current.len() > 1 {
            tokens.insert(std::mem::take(&mut current));
        } else {
            current.clear();
        }
    }

    if current.len() > 1 {
        tokens.insert(current);
    }

    tokens
}

// ── Contradiction Heuristic ─────────────────────────────────────────────────

/// Negation markers that indicate a statement reverses a previous claim.
const NEGATION_MARKERS: &[&str] = &[
    "not ",
    "no longer",
    "instead of",
    "replaced",
    "removed",
    "deprecated",
    "disabled",
    "don't",
    "doesn't",
    "won't",
    "cannot",
    "shouldn't",
    "never",
];

/// Simple heuristic contradiction check.
///
/// Returns `true` when one text contains negation markers that the other
/// lacks.  This is intentionally coarse — it catches the obvious cases
/// ("we use MySQL" vs "we no longer use MySQL") without requiring NLP.
pub fn is_contradiction(a: &str, b: &str) -> bool {
    let a_lower = a.to_lowercase();
    let b_lower = b.to_lowercase();

    let a_negs: Vec<&&str> = NEGATION_MARKERS
        .iter()
        .filter(|m| a_lower.contains(**m))
        .collect();
    let b_negs: Vec<&&str> = NEGATION_MARKERS
        .iter()
        .filter(|m| b_lower.contains(**m))
        .collect();

    // If one side has negation markers and the other doesn't,
    // that's a contradiction signal.
    if a_negs.is_empty() != b_negs.is_empty() {
        return true;
    }

    // If both have negation markers, but different ones, that could also
    // indicate contradiction — but to avoid false positives we only flag
    // the asymmetric case above.
    false
}

const SUPPORT_MARKERS: &[&str] = &[
    "confirms",
    "validated",
    "verified",
    "still ",
    "consistent with",
    "aligns with",
    "proves",
    "supports",
    "corroborates",
    "reaffirms",
    "as expected",
];

/// Simple heuristic support check.
///
/// Returns `true` when the candidate text contains confirmation markers
/// relative to existing content. This detects "A confirms B" patterns.
pub fn is_support(candidate: &str, existing: &str) -> bool {
    let candidate_lower = candidate.to_lowercase();

    // Check if candidate contains support markers
    let has_support = SUPPORT_MARKERS.iter().any(|m| candidate_lower.contains(m));

    if !has_support {
        return false;
    }

    // Both texts should NOT have negation markers (support ≠ double-negative)
    let candidate_has_neg = NEGATION_MARKERS.iter().any(|m| candidate_lower.contains(m));
    let existing_lower = existing.to_lowercase();
    let existing_has_neg = NEGATION_MARKERS.iter().any(|m| existing_lower.contains(m));

    has_support && !candidate_has_neg && !existing_has_neg
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn pipeline() -> DedupPipeline {
        DedupPipeline::default()
    }

    fn candidate(name: &str, content: &str) -> DedupCandidate {
        DedupCandidate {
            name: name.to_string(),
            content: content.to_string(),
            embedding: None,
        }
    }

    fn similar(id: &str, name: &str, content: &str, similarity: f32) -> SimilarIdea {
        SimilarIdea {
            id: id.to_string(),
            name: name.to_string(),
            content: content.to_string(),
            similarity,
        }
    }

    #[test]
    fn no_similar_creates() {
        let p = pipeline();
        let c = candidate("auth/jwt", "JWT rotation every 24h");
        let action = p.decide(&c, &[]);
        assert_eq!(action, DedupAction::Create);
    }

    #[test]
    fn exact_duplicate_skips() {
        let p = pipeline();
        let c = candidate("auth/jwt", "JWT rotation every 24h");
        let existing = vec![similar("mem-1", "auth/jwt", "JWT rotation every 24h", 0.97)];
        let action = p.decide(&c, &existing);
        assert_eq!(action, DedupAction::Skip);
    }

    #[test]
    fn similar_same_key_merges() {
        let p = pipeline();
        let c = candidate("auth/jwt", "JWT rotation every 12h with refresh tokens");
        let existing = vec![similar("mem-1", "auth/jwt", "JWT rotation every 24h", 0.90)];
        let action = p.decide(&c, &existing);
        assert_eq!(action, DedupAction::Merge("mem-1".to_string()));
    }

    #[test]
    fn novel_content_creates() {
        let p = pipeline();
        let c = candidate("deploy/docker", "Use Docker compose for local dev");
        let existing = vec![similar("mem-1", "auth/jwt", "JWT rotation every 24h", 0.88)];
        // Different key → Create even though similarity is above threshold.
        let action = p.decide(&c, &existing);
        assert_eq!(action, DedupAction::Create);
    }

    #[test]
    fn contradiction_supersedes() {
        let p = pipeline();
        let c = candidate(
            "db/backend",
            "We no longer use MySQL, migrated to PostgreSQL",
        );
        let existing = vec![similar(
            "mem-1",
            "db/backend",
            "We use MySQL for the main database",
            0.90,
        )];
        let action = p.decide(&c, &existing);
        assert_eq!(action, DedupAction::Supersede("mem-1".to_string()));
    }

    #[test]
    fn below_threshold_creates() {
        let p = pipeline();
        let c = candidate(
            "pricing/tiers",
            "Three pricing tiers: free, pro, enterprise",
        );
        let existing = vec![similar("mem-1", "auth/jwt", "JWT rotation every 24h", 0.50)];
        let action = p.decide(&c, &existing);
        assert_eq!(action, DedupAction::Create);
    }

    #[test]
    fn find_similar_filters_by_threshold() {
        let p = DedupPipeline::new(0.90);
        let c = candidate("test", "test content");
        let existing = vec![
            similar("mem-1", "a", "content a", 0.95),
            similar("mem-2", "b", "content b", 0.85),
            similar("mem-3", "c", "content c", 0.92),
        ];
        let result = p.find_similar(&c, &existing);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|m| m.similarity >= 0.90));
    }

    #[test]
    fn contradiction_detection_asymmetric_negation() {
        assert!(is_contradiction(
            "We use MySQL for the database",
            "We no longer use MySQL"
        ));
        assert!(is_contradiction(
            "Feature X was removed",
            "Feature X is available"
        ));
    }

    #[test]
    fn no_contradiction_when_both_neutral() {
        assert!(!is_contradiction(
            "We use PostgreSQL",
            "The database is PostgreSQL"
        ));
    }

    #[test]
    fn no_contradiction_when_both_have_negation() {
        assert!(!is_contradiction(
            "We don't use MySQL",
            "We no longer use Oracle"
        ));
    }

    #[test]
    fn support_detection() {
        assert!(is_support(
            "Testing confirms PostgreSQL is the right choice",
            "We use PostgreSQL for the database"
        ));
    }

    #[test]
    fn support_with_still_marker() {
        assert!(is_support(
            "The service is still running on port 8080",
            "Service runs on port 8080"
        ));
    }

    #[test]
    fn no_support_when_negation_present() {
        assert!(!is_support(
            "Testing confirms we should not use MySQL",
            "We use MySQL"
        ));
    }

    #[test]
    fn no_support_without_markers() {
        assert!(!is_support(
            "The database is PostgreSQL",
            "We use PostgreSQL"
        ));
    }

    #[test]
    fn lexical_similarity_keeps_exact_duplicate_high() {
        let score = lexical_similarity(
            "Clean worktree deploys",
            "Deploy AEQI platform binaries from clean worktrees based on remote main.",
            "clean worktree deploys",
            "Deploy AEQI platform binaries from clean worktrees based on remote main.",
        );

        assert!(score >= 0.95, "score={score}");
    }

    #[test]
    fn lexical_similarity_keeps_topical_but_distinct_low() {
        let score = lexical_similarity(
            "Clean worktree deploys for AEQI platform host runtime changes",
            "Deploy AEQI platform/runtime binaries from clean worktrees based on remote main. Verify hosted MCP and code.index.",
            "mcp-vector-verification-1778618251324",
            "Vector embedding verification for Aeqi MCP ideas. Search should retrieve this by semantic phrase after embedding worker runs.",
        );

        assert!(score < 0.85, "score={score}");
    }

    #[test]
    fn high_overlap_without_identity_anchor_creates() {
        let p = pipeline();
        let c = candidate(
            "mcp/dedup-operating-policy",
            "AEQI MCP ideas.store should preserve distinct operational lessons even when they mention MCP, vector search, quests, and code graph reliability.",
        );
        let existing = vec![similar(
            "mem-1",
            "mcp/vector-verification",
            "AEQI MCP vector search should retrieve ideas that mention MCP, vector search, quests, and code graph reliability.",
            0.98,
        )];

        let action = p.decide(&c, &existing);
        assert_eq!(action, DedupAction::Create);
    }
}
