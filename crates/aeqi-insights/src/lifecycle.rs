//! Memory lifecycle management — pruning, compaction, and auditing.
//!
//! Memories are not permanent. Cold, stale entries are archived after 90 days
//! of low access; similar low-value entries are compacted weekly into
//! consolidated records.  Every lifecycle action is audit-logged for
//! reconstructibility.
//!
//! This module provides the decision logic; actual storage mutations happen
//! in the caller (e.g. the daemon patrol loop or a CLI command).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tracing::debug;

// ── Configuration ──────────────────────────────────────────────────────────

/// Configuration for memory lifecycle operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleConfig {
    /// Memories older than this (in days) with low hotness are eligible for pruning.
    pub prune_threshold_days: u32,
    /// Hotness below this value makes a memory eligible for pruning.
    pub prune_hotness_threshold: f32,
    /// Interval in days between compaction runs.
    pub compact_interval_days: u32,
    /// Whether to archive pruned memories (true) or hard-delete them.
    pub archive_enabled: bool,
}

impl Default for LifecycleConfig {
    fn default() -> Self {
        Self {
            prune_threshold_days: 90,
            prune_hotness_threshold: 0.05,
            compact_interval_days: 7,
            archive_enabled: true,
        }
    }
}

// ── Memory Age Snapshot ────────────────────────────────────────────────────

/// A snapshot of a memory's age and access metadata, used by the lifecycle
/// manager to decide on pruning and compaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryAge {
    /// Memory ID.
    pub id: String,
    /// Current hotness score (from [`HotnessScorer`]).
    pub hotness: f32,
    /// Age in days since creation.
    pub age_days: u32,
    /// Total number of times this memory has been accessed.
    pub access_count: u32,
}

// ── Prune Result ───────────────────────────────────────────────────────────

/// Result of a prune operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PruneResult {
    /// IDs of memories that were archived (or would be archived).
    pub archived: Vec<String>,
    /// Number of memories that were kept.
    pub kept: usize,
    /// Total number of memories scanned.
    pub total_scanned: usize,
}

// ── Lifecycle Manager ──────────────────────────────────────────────────────

/// Manages memory lifecycle: identifies prunable and compactable memories.
pub struct LifecycleManager {
    /// Configuration for thresholds and intervals.
    pub config: LifecycleConfig,
}

impl LifecycleManager {
    /// Create a manager with default configuration.
    pub fn with_defaults() -> Self {
        Self {
            config: LifecycleConfig::default(),
        }
    }

    /// Create a manager with custom configuration.
    pub fn new(config: LifecycleConfig) -> Self {
        Self { config }
    }

    /// Identify memories eligible for pruning.
    ///
    /// A memory is prunable when:
    /// - hotness < `prune_hotness_threshold` AND
    /// - age > `prune_threshold_days`
    pub fn identify_prunable(&self, memories: &[MemoryAge]) -> Vec<String> {
        memories
            .iter()
            .filter(|m| {
                m.hotness < self.config.prune_hotness_threshold
                    && m.age_days > self.config.prune_threshold_days
            })
            .map(|m| m.id.clone())
            .collect()
    }

    /// Identify groups of memories that can be compacted (merged).
    ///
    /// Compaction heuristic: low-hotness memories (hotness < 0.1) that share
    /// more than 50% of their significant words (from their IDs) are grouped
    /// together.  Returns groups of 2+ for merging.
    pub fn identify_compactable(&self, memories: &[MemoryAge]) -> Vec<Vec<String>> {
        let low_hotness: Vec<&MemoryAge> = memories.iter().filter(|m| m.hotness < 0.1).collect();

        if low_hotness.len() < 2 {
            return Vec::new();
        }

        // Tokenize each memory ID into words.
        let word_sets: Vec<HashSet<String>> =
            low_hotness.iter().map(|m| tokenize_id(&m.id)).collect();

        let n = low_hotness.len();
        let mut visited = vec![false; n];
        let mut groups: Vec<Vec<String>> = Vec::new();

        for i in 0..n {
            if visited[i] {
                continue;
            }

            let mut group = vec![i];
            visited[i] = true;

            for j in (i + 1)..n {
                if visited[j] {
                    continue;
                }
                if id_word_overlap(&word_sets[i], &word_sets[j]) > 0.5 {
                    visited[j] = true;
                    group.push(j);
                }
            }

            if group.len() >= 2 {
                let ids: Vec<String> = group
                    .iter()
                    .map(|&idx| low_hotness[idx].id.clone())
                    .collect();
                groups.push(ids);
            }
        }

        debug!(
            groups = groups.len(),
            "lifecycle manager identified compactable groups"
        );
        groups
    }

    /// Run the prune pipeline and return the result.
    pub fn prune(&self, memories: &[MemoryAge]) -> PruneResult {
        let archived = self.identify_prunable(memories);
        let kept = memories.len() - archived.len();
        PruneResult {
            archived,
            kept,
            total_scanned: memories.len(),
        }
    }

    /// Determine whether a compaction run is due.
    ///
    /// Returns `true` if `last_compaction` is `None` (never run) or if the
    /// time since last compaction exceeds `compact_interval_days`.
    pub fn should_compact(&self, last_compaction: Option<DateTime<Utc>>) -> bool {
        match last_compaction {
            None => true,
            Some(last) => {
                let days_since = (Utc::now() - last).num_days();
                days_since > self.config.compact_interval_days as i64
            }
        }
    }
}

// ── Audit Types ────────────────────────────────────────────────────────────

/// Action taken on a memory during lifecycle management.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleAction {
    /// Memory was archived (soft-delete, still queryable).
    Archived,
    /// Memory was compacted (merged into another).
    Compacted,
    /// Memory was permanently deleted.
    Deleted,
}

/// An audit entry recording a lifecycle action on a memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    /// The action taken.
    pub action: LifecycleAction,
    /// The memory ID affected.
    pub memory_id: String,
    /// When the action occurred.
    pub timestamp: DateTime<Utc>,
    /// Human-readable reason for the action.
    pub reason: String,
}

impl AuditEntry {
    /// Create a new audit entry timestamped to now.
    pub fn new(
        action: LifecycleAction,
        memory_id: impl Into<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            action,
            memory_id: memory_id.into(),
            timestamp: Utc::now(),
            reason: reason.into(),
        }
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/// Tokenize a memory ID into significant words (lowercase, length >= 3).
fn tokenize_id(id: &str) -> HashSet<String> {
    id.split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() >= 3)
        .collect()
}

/// Compute word overlap ratio between two ID word sets.
///
/// Returns `intersection / min(a, b)` so partial containment scores high.
fn id_word_overlap(a: &HashSet<String>, b: &HashSet<String>) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let intersection = a.intersection(b).count();
    let min_size = a.len().min(b.len());
    intersection as f64 / min_size as f64
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn mem(id: &str, hotness: f32, age_days: u32, access_count: u32) -> MemoryAge {
        MemoryAge {
            id: id.to_string(),
            hotness,
            age_days,
            access_count,
        }
    }

    #[test]
    fn identify_prunable_old_and_cold() {
        let mgr = LifecycleManager::with_defaults();
        let memories = vec![
            mem("old-cold", 0.02, 120, 1),
            mem("old-hot", 0.8, 120, 50),
            mem("young-cold", 0.01, 10, 0),
            mem("old-warm", 0.06, 100, 5),
        ];

        let prunable = mgr.identify_prunable(&memories);
        assert_eq!(prunable, vec!["old-cold"]);
    }

    #[test]
    fn identify_prunable_none_eligible() {
        let mgr = LifecycleManager::with_defaults();
        let memories = vec![
            mem("hot-recent", 0.9, 5, 100),
            mem("warm-old", 0.1, 100, 10),
            mem("cold-young", 0.01, 30, 0),
        ];

        let prunable = mgr.identify_prunable(&memories);
        assert!(prunable.is_empty());
    }

    #[test]
    fn prune_returns_correct_counts() {
        let mgr = LifecycleManager::with_defaults();
        let memories = vec![
            mem("prunable-1", 0.01, 100, 0),
            mem("prunable-2", 0.03, 95, 1),
            mem("keep-1", 0.9, 200, 100),
            mem("keep-2", 0.5, 50, 20),
            mem("keep-3", 0.01, 80, 0), // cold but too young
        ];

        let result = mgr.prune(&memories);
        assert_eq!(result.archived.len(), 2);
        assert_eq!(result.kept, 3);
        assert_eq!(result.total_scanned, 5);
        assert!(result.archived.contains(&"prunable-1".to_string()));
        assert!(result.archived.contains(&"prunable-2".to_string()));
    }

    #[test]
    fn identify_compactable_groups_similar_ids() {
        let mgr = LifecycleManager::with_defaults();
        let memories = vec![
            mem("deploy-service-config", 0.05, 60, 2),
            mem("deploy-service-rollback", 0.03, 70, 1),
            mem("auth-jwt-rotation", 0.08, 50, 3),
        ];

        let groups = mgr.identify_compactable(&memories);
        assert_eq!(groups.len(), 1, "deploy-service-* should cluster");
        assert_eq!(groups[0].len(), 2);
        assert!(groups[0].contains(&"deploy-service-config".to_string()));
        assert!(groups[0].contains(&"deploy-service-rollback".to_string()));
    }

    #[test]
    fn identify_compactable_no_groups_when_dissimilar() {
        let mgr = LifecycleManager::with_defaults();
        let memories = vec![
            mem("deploy-config", 0.05, 60, 2),
            mem("auth-jwt", 0.03, 70, 1),
            mem("pricing-tiers", 0.08, 50, 3),
        ];

        let groups = mgr.identify_compactable(&memories);
        assert!(groups.is_empty(), "dissimilar IDs should not form groups");
    }

    #[test]
    fn identify_compactable_excludes_hot_memories() {
        let mgr = LifecycleManager::with_defaults();
        let memories = vec![
            mem("deploy-service-config", 0.5, 60, 50), // hot
            mem("deploy-service-rollback", 0.03, 70, 1),
        ];

        let groups = mgr.identify_compactable(&memories);
        assert!(groups.is_empty(), "hot memories should not be compacted");
    }

    #[test]
    fn should_compact_no_previous_run() {
        let mgr = LifecycleManager::with_defaults();
        assert!(mgr.should_compact(None));
    }

    #[test]
    fn should_compact_recent_run() {
        let mgr = LifecycleManager::with_defaults(); // 7-day interval
        let recent = Utc::now() - Duration::days(2);
        assert!(
            !mgr.should_compact(Some(recent)),
            "should not compact when last run was 2 days ago"
        );
    }

    #[test]
    fn should_compact_overdue() {
        let mgr = LifecycleManager::with_defaults(); // 7-day interval
        let old = Utc::now() - Duration::days(10);
        assert!(
            mgr.should_compact(Some(old)),
            "should compact when last run was 10 days ago"
        );
    }

    #[test]
    fn audit_entry_creation() {
        let entry = AuditEntry::new(
            LifecycleAction::Archived,
            "mem-42",
            "hotness 0.02 < 0.05 and age 120 > 90 days",
        );
        assert_eq!(entry.action, LifecycleAction::Archived);
        assert_eq!(entry.memory_id, "mem-42");
        assert!(entry.reason.contains("hotness"));
        let age = Utc::now() - entry.timestamp;
        assert!(age.num_seconds() < 5);
    }

    #[test]
    fn lifecycle_config_defaults() {
        let config = LifecycleConfig::default();
        assert_eq!(config.prune_threshold_days, 90);
        assert!((config.prune_hotness_threshold - 0.05).abs() < f32::EPSILON);
        assert_eq!(config.compact_interval_days, 7);
        assert!(config.archive_enabled);
    }

    #[test]
    fn custom_config() {
        let config = LifecycleConfig {
            prune_threshold_days: 30,
            prune_hotness_threshold: 0.1,
            compact_interval_days: 3,
            archive_enabled: false,
        };
        let mgr = LifecycleManager::new(config);
        assert_eq!(mgr.config.prune_threshold_days, 30);
        assert!(!mgr.config.archive_enabled);
    }
}
