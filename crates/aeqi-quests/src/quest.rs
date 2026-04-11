use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;

/// A hierarchical quest ID: "as-001", "as-001.1", "as-001.1.3"
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct QuestId(pub String);

impl QuestId {
    /// Create a new root-level quest ID with the given prefix and sequence number.
    pub fn root(prefix: &str, seq: u32) -> Self {
        Self(format!("{prefix}-{seq:03}"))
    }

    /// Create a child quest ID: "as-001" + 2 → "as-001.2"
    pub fn child(&self, child_seq: u32) -> Self {
        Self(format!("{}.{child_seq}", self.0))
    }

    /// Get the prefix (e.g., "as" from "as-001.2").
    pub fn prefix(&self) -> &str {
        self.0.split('-').next().unwrap_or("")
    }

    /// Get the parent ID, if this is a child quest.
    pub fn parent(&self) -> Option<Self> {
        let last_dot = self.0.rfind('.')?;
        Some(Self(self.0[..last_dot].to_string()))
    }

    /// Depth: "as-001" = 0, "as-001.1" = 1, "as-001.1.3" = 2
    pub fn depth(&self) -> usize {
        self.0.matches('.').count()
    }

    /// Check if this quest is an ancestor of another.
    pub fn is_ancestor_of(&self, other: &QuestId) -> bool {
        other.0.starts_with(&self.0) && other.0.len() > self.0.len()
    }
}

impl fmt::Display for QuestId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<&str> for QuestId {
    fn from(s: &str) -> Self {
        Self(s.to_string())
    }
}

impl From<String> for QuestId {
    fn from(s: String) -> Self {
        Self(s)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestStatus {
    Pending,
    InProgress,
    Done,
    Blocked,
    Cancelled,
}

impl fmt::Display for QuestStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::InProgress => write!(f, "in_progress"),
            Self::Done => write!(f, "done"),
            Self::Blocked => write!(f, "blocked"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestOutcomeKind {
    Done,
    Blocked,
    Handoff,
    Failed,
    Cancelled,
}

impl fmt::Display for QuestOutcomeKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Done => write!(f, "done"),
            Self::Blocked => write!(f, "blocked"),
            Self::Handoff => write!(f, "handoff"),
            Self::Failed => write!(f, "failed"),
            Self::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low = 0,
    #[default]
    Normal = 1,
    High = 2,
    Critical = 3,
}

impl fmt::Display for Priority {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Low => write!(f, "low"),
            Self::Normal => write!(f, "normal"),
            Self::High => write!(f, "high"),
            Self::Critical => write!(f, "critical"),
        }
    }
}

/// A checkpoint recording incremental progress on a quest.
/// Saved when a worker completes, blocks, or fails — so the next worker
/// can skip work that's already done.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub timestamp: DateTime<Utc>,
    pub worker: String,
    pub progress: String,
    pub cost_usd: f64,
    pub steps_used: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QuestOutcomeRecord {
    pub kind: QuestOutcomeKind,
    pub summary: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub next_action: Option<String>,
}

impl QuestOutcomeRecord {
    pub fn new(kind: QuestOutcomeKind, summary: impl Into<String>) -> Self {
        Self {
            kind,
            summary: summary.into(),
            reason: None,
            next_action: None,
        }
    }
}

/// A single quest in the DAG.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quest {
    pub id: QuestId,
    #[serde(alias = "subject")]
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub status: QuestStatus,
    #[serde(default)]
    pub priority: Priority,
    /// Persistent agent UUID that owns this quest. None = legacy/unbound.
    #[serde(default)]
    pub agent_id: Option<String>,
    /// Quest IDs that must be completed before this one can start.
    #[serde(default)]
    pub depends_on: Vec<QuestId>,
    /// Skill to apply when executing this quest (loaded from project skills dir).
    #[serde(default)]
    pub skill: Option<String>,
    /// Labels for categorization.
    #[serde(default)]
    pub labels: Vec<String>,
    /// Number of times this quest has been retried after failure/handoff.
    #[serde(default)]
    pub retry_count: u32,
    /// Incremental progress checkpoints from previous worker attempts.
    #[serde(default)]
    pub checkpoints: Vec<Checkpoint>,
    /// Arbitrary metadata.
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub closed_at: Option<DateTime<Utc>>,
    /// Structured outcome record — replaces closed_reason and metadata.aeqi.task_outcome.
    #[serde(default)]
    pub outcome: Option<QuestOutcomeRecord>,
    /// What "done" looks like — worker validates output against this.
    #[serde(default)]
    pub acceptance_criteria: Option<String>,
    /// Git worktree branch for isolated execution.
    #[serde(default)]
    pub worktree_branch: Option<String>,
    /// Filesystem path to the git worktree.
    #[serde(default)]
    pub worktree_path: Option<String>,
}

impl Quest {
    /// Create a new quest with minimal fields.
    pub fn new(id: QuestId, name: impl Into<String>) -> Self {
        Self::with_agent(id, name, None)
    }

    /// Create a new quest bound to a specific agent.
    pub fn with_agent(id: QuestId, name: impl Into<String>, agent_id: Option<&str>) -> Self {
        Self {
            id,
            name: name.into(),
            description: String::new(),
            status: QuestStatus::Pending,
            priority: Priority::Normal,
            agent_id: agent_id.map(|s| s.to_string()),
            depends_on: Vec::new(),
            skill: None,
            labels: Vec::new(),
            retry_count: 0,
            checkpoints: Vec::new(),
            metadata: serde_json::Value::Null,
            created_at: Utc::now(),
            updated_at: None,
            closed_at: None,
            outcome: None,
            acceptance_criteria: None,
            worktree_branch: None,
            worktree_path: None,
        }
    }

    /// Whether this quest is bound to a persistent agent.
    pub fn is_agent_bound(&self) -> bool {
        self.agent_id.is_some()
    }

    /// Is this quest in a terminal state?
    pub fn is_closed(&self) -> bool {
        matches!(self.status, QuestStatus::Done | QuestStatus::Cancelled)
    }

    /// Is this quest ready to work on? (pending + no unresolved dependencies)
    pub fn is_ready(&self, resolved: &dyn Fn(&QuestId) -> bool) -> bool {
        self.status == QuestStatus::Pending && self.depends_on.iter().all(resolved)
    }

    /// Whether the scheduler should temporarily hold this quest from execution.
    pub fn is_scheduler_held(&self) -> bool {
        self.metadata
            .pointer("/aeqi/hold")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }

    pub fn aeqi_metadata(&self, key: &str) -> Option<&serde_json::Value> {
        self.metadata
            .as_object()
            .and_then(|meta| meta.get("aeqi"))
            .and_then(|aeqi| aeqi.as_object())
            .and_then(|aeqi| aeqi.get(key))
    }

    pub fn set_aeqi_metadata(&mut self, key: &str, value: serde_json::Value) {
        let mut metadata = match std::mem::take(&mut self.metadata) {
            serde_json::Value::Object(map) => map,
            serde_json::Value::Null => serde_json::Map::new(),
            other => {
                let mut map = serde_json::Map::new();
                map.insert("_legacy".to_string(), other);
                map
            }
        };

        let aeqi_value = metadata
            .entry("aeqi".to_string())
            .or_insert_with(|| serde_json::json!({}));

        if !aeqi_value.is_object() {
            *aeqi_value = serde_json::json!({});
        }

        if let Some(aeqi_meta) = aeqi_value.as_object_mut() {
            aeqi_meta.insert(key.to_string(), value);
        }

        self.metadata = if metadata.is_empty() {
            serde_json::Value::Null
        } else {
            serde_json::Value::Object(metadata)
        };
    }

    pub fn task_outcome(&self) -> Option<QuestOutcomeRecord> {
        // Primary: read from the outcome field.
        if let Some(ref outcome) = self.outcome {
            return Some(outcome.clone());
        }
        // Fallback: legacy metadata path for old quests.
        self.aeqi_metadata("task_outcome")
            .cloned()
            .and_then(|value| serde_json::from_value(value).ok())
    }

    pub fn set_task_outcome(&mut self, record: &QuestOutcomeRecord) {
        self.outcome = Some(record.clone());
        // Also write to legacy metadata for backward compat with JSONL stores.
        if let Ok(value) = serde_json::to_value(record) {
            self.set_aeqi_metadata("task_outcome", value);
        }
    }

    pub fn runtime(&self) -> Option<serde_json::Value> {
        self.aeqi_metadata("runtime").cloned()
    }

    pub fn outcome_summary(&self) -> Option<String> {
        self.task_outcome()
            .map(|outcome| outcome.summary)
            .filter(|summary| !summary.trim().is_empty())
    }

    pub fn blocker_context(&self) -> Option<String> {
        self.task_outcome().and_then(|outcome| {
            outcome
                .reason
                .filter(|reason| !reason.trim().is_empty())
                .or_else(|| (!outcome.summary.trim().is_empty()).then_some(outcome.summary))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── QuestId tests ──────────────────────────────────────

    #[test]
    fn quest_id_root_formatting() {
        let id = QuestId::root("as", 1);
        assert_eq!(id.to_string(), "as-001");

        let id = QuestId::root("rd", 42);
        assert_eq!(id.to_string(), "rd-042");
    }

    #[test]
    fn quest_id_child_formatting() {
        let root = QuestId::root("as", 1);
        let child = root.child(2);
        assert_eq!(child.to_string(), "as-001.2");

        let grandchild = child.child(3);
        assert_eq!(grandchild.to_string(), "as-001.2.3");
    }

    #[test]
    fn quest_id_prefix() {
        assert_eq!(QuestId::from("as-001").prefix(), "as");
        assert_eq!(QuestId::from("rd-042.1.3").prefix(), "rd");
    }

    #[test]
    fn quest_id_parent() {
        assert_eq!(QuestId::from("as-001").parent(), None);
        assert_eq!(
            QuestId::from("as-001.2").parent(),
            Some(QuestId::from("as-001"))
        );
        assert_eq!(
            QuestId::from("as-001.2.3").parent(),
            Some(QuestId::from("as-001.2"))
        );
    }

    #[test]
    fn quest_id_depth() {
        assert_eq!(QuestId::from("as-001").depth(), 0);
        assert_eq!(QuestId::from("as-001.1").depth(), 1);
        assert_eq!(QuestId::from("as-001.1.3").depth(), 2);
    }

    #[test]
    fn quest_id_is_ancestor_of() {
        let root = QuestId::from("as-001");
        let child = QuestId::from("as-001.1");
        let grandchild = QuestId::from("as-001.1.3");

        assert!(root.is_ancestor_of(&child));
        assert!(root.is_ancestor_of(&grandchild));
        assert!(child.is_ancestor_of(&grandchild));
        assert!(!child.is_ancestor_of(&root));
        assert!(!root.is_ancestor_of(&root)); // not an ancestor of itself
    }

    #[test]
    fn quest_id_from_str_and_string() {
        let from_str: QuestId = "test-001".into();
        let from_string: QuestId = String::from("test-001").into();
        assert_eq!(from_str, from_string);
    }

    // ── Quest construction tests ───────────────────────────

    #[test]
    fn quest_new_defaults() {
        let quest = Quest::new(QuestId::from("t-001"), "Test quest");
        assert_eq!(quest.name, "Test quest");
        assert_eq!(quest.status, QuestStatus::Pending);
        assert_eq!(quest.priority, Priority::Normal);
        assert!(quest.agent_id.is_none());
        assert!(quest.depends_on.is_empty());
        assert!(quest.description.is_empty());
    }

    #[test]
    fn quest_with_agent_binds_agent() {
        let quest = Quest::with_agent(QuestId::from("t-001"), "Bound", Some("agent-42"));
        assert_eq!(quest.agent_id.as_deref(), Some("agent-42"));
        assert!(quest.is_agent_bound());

        let unbound = Quest::with_agent(QuestId::from("t-002"), "Unbound", None);
        assert!(unbound.agent_id.is_none());
        assert!(!unbound.is_agent_bound());
    }

    // ── Status / lifecycle tests ───────────────────────────

    #[test]
    fn quest_is_closed() {
        let mut quest = Quest::new(QuestId::from("t-001"), "Test");
        assert!(!quest.is_closed());

        quest.status = QuestStatus::InProgress;
        assert!(!quest.is_closed());

        quest.status = QuestStatus::Done;
        assert!(quest.is_closed());

        quest.status = QuestStatus::Cancelled;
        assert!(quest.is_closed());

        quest.status = QuestStatus::Blocked;
        assert!(!quest.is_closed());
    }

    #[test]
    fn quest_is_ready_no_deps() {
        let quest = Quest::new(QuestId::from("t-001"), "Ready");
        let always_resolved = |_: &QuestId| true;
        assert!(quest.is_ready(&always_resolved));
    }

    #[test]
    fn quest_is_ready_with_unresolved_deps() {
        let mut quest = Quest::new(QuestId::from("t-002"), "Blocked by dep");
        quest.depends_on = vec![QuestId::from("t-001")];

        let nothing_resolved = |_: &QuestId| false;
        assert!(!quest.is_ready(&nothing_resolved));

        let all_resolved = |_: &QuestId| true;
        assert!(quest.is_ready(&all_resolved));
    }

    #[test]
    fn quest_not_ready_if_not_pending() {
        let mut quest = Quest::new(QuestId::from("t-001"), "In progress");
        quest.status = QuestStatus::InProgress;

        let always_resolved = |_: &QuestId| true;
        assert!(!quest.is_ready(&always_resolved));
    }

    #[test]
    fn quest_is_scheduler_held() {
        let mut quest = Quest::new(QuestId::from("t-001"), "Held");
        assert!(!quest.is_scheduler_held());

        quest.metadata = serde_json::json!({"aeqi": {"hold": true}});
        assert!(quest.is_scheduler_held());

        quest.metadata = serde_json::json!({"aeqi": {"hold": false}});
        assert!(!quest.is_scheduler_held());
    }

    // ── Outcome tests ──────────────────────────────────────

    #[test]
    fn quest_outcome_round_trips_through_outcome_field() {
        let mut quest = Quest::new(QuestId::from("sg-001"), "Outcome");
        let outcome = QuestOutcomeRecord {
            kind: QuestOutcomeKind::Blocked,
            summary: "Waiting on staging credentials".to_string(),
            reason: Some("Which staging account should be used?".to_string()),
            next_action: Some("await_operator_input".to_string()),
        };

        quest.set_task_outcome(&outcome);

        // Reads from the outcome field.
        assert_eq!(quest.outcome, Some(outcome.clone()));
        // task_outcome() accessor also works.
        assert_eq!(quest.task_outcome(), Some(outcome));
    }

    #[test]
    fn quest_outcome_record_new_minimal() {
        let record = QuestOutcomeRecord::new(QuestOutcomeKind::Done, "All good");
        assert_eq!(record.kind, QuestOutcomeKind::Done);
        assert_eq!(record.summary, "All good");
        assert!(record.reason.is_none());
        assert!(record.next_action.is_none());
    }

    #[test]
    fn quest_outcome_summary() {
        let mut quest = Quest::new(QuestId::from("t-001"), "Test");
        assert!(quest.outcome_summary().is_none());

        quest.set_task_outcome(&QuestOutcomeRecord::new(
            QuestOutcomeKind::Done,
            "Implemented feature X",
        ));
        assert_eq!(
            quest.outcome_summary(),
            Some("Implemented feature X".to_string())
        );
    }

    #[test]
    fn quest_outcome_summary_ignores_blank() {
        let mut quest = Quest::new(QuestId::from("t-001"), "Test");
        quest.set_task_outcome(&QuestOutcomeRecord::new(QuestOutcomeKind::Done, "  "));
        assert!(quest.outcome_summary().is_none());
    }

    #[test]
    fn quest_blocker_context_uses_reason_first() {
        let mut quest = Quest::new(QuestId::from("t-001"), "Test");
        let mut outcome = QuestOutcomeRecord::new(QuestOutcomeKind::Blocked, "Summary text");
        outcome.reason = Some("Specific reason".to_string());
        quest.set_task_outcome(&outcome);

        assert_eq!(quest.blocker_context(), Some("Specific reason".to_string()));
    }

    #[test]
    fn quest_blocker_context_falls_back_to_summary() {
        let mut quest = Quest::new(QuestId::from("t-001"), "Test");
        quest.set_task_outcome(&QuestOutcomeRecord::new(
            QuestOutcomeKind::Blocked,
            "Summary fallback",
        ));

        assert_eq!(
            quest.blocker_context(),
            Some("Summary fallback".to_string())
        );
    }

    // ── Metadata tests ─────────────────────────────────────

    #[test]
    fn set_aeqi_metadata_preserves_legacy_metadata() {
        let mut quest = Quest::new(QuestId::from("sg-002"), "Legacy");
        quest.metadata = serde_json::json!("legacy");

        quest.set_aeqi_metadata("runtime", serde_json::json!({"phase": "act"}));

        assert_eq!(
            quest
                .metadata
                .pointer("/_legacy")
                .and_then(|value| value.as_str()),
            Some("legacy")
        );
        assert_eq!(
            quest
                .metadata
                .pointer("/aeqi/runtime/phase")
                .and_then(|value| value.as_str()),
            Some("act")
        );
    }

    #[test]
    fn aeqi_metadata_get_and_set() {
        let mut quest = Quest::new(QuestId::from("t-001"), "Test");
        assert!(quest.aeqi_metadata("foo").is_none());

        quest.set_aeqi_metadata("foo", serde_json::json!("bar"));
        assert_eq!(
            quest.aeqi_metadata("foo").and_then(|v| v.as_str()),
            Some("bar")
        );
    }

    // ── Display tests ──────────────────────────────────────

    #[test]
    fn quest_status_display() {
        assert_eq!(QuestStatus::Pending.to_string(), "pending");
        assert_eq!(QuestStatus::InProgress.to_string(), "in_progress");
        assert_eq!(QuestStatus::Done.to_string(), "done");
        assert_eq!(QuestStatus::Blocked.to_string(), "blocked");
        assert_eq!(QuestStatus::Cancelled.to_string(), "cancelled");
    }

    #[test]
    fn quest_outcome_kind_display() {
        assert_eq!(QuestOutcomeKind::Done.to_string(), "done");
        assert_eq!(QuestOutcomeKind::Blocked.to_string(), "blocked");
        assert_eq!(QuestOutcomeKind::Handoff.to_string(), "handoff");
        assert_eq!(QuestOutcomeKind::Failed.to_string(), "failed");
        assert_eq!(QuestOutcomeKind::Cancelled.to_string(), "cancelled");
    }

    #[test]
    fn priority_display_and_ordering() {
        assert_eq!(Priority::Low.to_string(), "low");
        assert_eq!(Priority::Normal.to_string(), "normal");
        assert_eq!(Priority::High.to_string(), "high");
        assert_eq!(Priority::Critical.to_string(), "critical");

        assert!(Priority::Low < Priority::Normal);
        assert!(Priority::Normal < Priority::High);
        assert!(Priority::High < Priority::Critical);
    }

    #[test]
    fn priority_default_is_normal() {
        assert_eq!(Priority::default(), Priority::Normal);
    }
}
