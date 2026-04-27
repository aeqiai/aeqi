use crate::quest::{Priority, Quest, QuestStatus};
use crate::store::QuestBoard;

/// Query builder for filtering quests.
pub struct QuestQuery<'a> {
    store: &'a QuestBoard,
    prefix: Option<String>,
    status: Option<QuestStatus>,
    agent_id: Option<String>,
    label: Option<String>,
    min_priority: Option<Priority>,
    include_closed: bool,
}

impl<'a> QuestQuery<'a> {
    pub fn new(store: &'a QuestBoard) -> Self {
        Self {
            store,
            prefix: None,
            status: None,
            agent_id: None,
            label: None,
            min_priority: None,
            include_closed: false,
        }
    }

    pub fn prefix(mut self, prefix: &str) -> Self {
        self.prefix = Some(prefix.to_string());
        self
    }

    pub fn status(mut self, status: QuestStatus) -> Self {
        self.status = Some(status);
        self
    }

    pub fn agent_id(mut self, agent_id: &str) -> Self {
        self.agent_id = Some(agent_id.to_string());
        self
    }

    pub fn label(mut self, label: &str) -> Self {
        self.label = Some(label.to_string());
        self
    }

    pub fn min_priority(mut self, priority: Priority) -> Self {
        self.min_priority = Some(priority);
        self
    }

    pub fn include_closed(mut self) -> Self {
        self.include_closed = true;
        self
    }

    /// Execute the query, returning matching quests sorted by priority then creation time.
    pub fn execute(self) -> Vec<&'a Quest> {
        let mut results: Vec<&Quest> = self
            .store
            .all()
            .into_iter()
            .filter(|b| {
                if !self.include_closed && b.is_closed() {
                    return false;
                }
                if let Some(ref prefix) = self.prefix
                    && b.id.prefix() != prefix
                {
                    return false;
                }
                if let Some(ref status) = self.status
                    && &b.status != status
                {
                    return false;
                }
                if let Some(ref agent_id) = self.agent_id
                    && b.agent_id.as_deref() != Some(agent_id.as_str())
                {
                    return false;
                }
                if let Some(ref label) = self.label
                    && !b.idea_tags().iter().any(|t| t == label)
                {
                    return false;
                }
                if let Some(ref min_pri) = self.min_priority
                    && b.priority < *min_pri
                {
                    return false;
                }
                true
            })
            .collect();

        results.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| a.created_at.cmp(&b.created_at))
        });

        results
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::QuestBoard;
    use tempfile::TempDir;

    fn setup() -> (QuestBoard, TempDir) {
        let dir = TempDir::new().unwrap();
        let store = QuestBoard::open(dir.path()).unwrap();
        (store, dir)
    }

    #[test]
    fn query_returns_all_open_by_default() {
        let (mut store, _dir) = setup();
        store.create_with_agent("tq", "Quest A", None).unwrap();
        store.create_with_agent("tq", "Quest B", None).unwrap();
        store.close("tq-001", "done").unwrap();

        let results = QuestQuery::new(&store).execute();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.0, "tq-002");
    }

    #[test]
    fn query_include_closed_returns_all() {
        let (mut store, _dir) = setup();
        store.create_with_agent("tq", "Quest A", None).unwrap();
        store.create_with_agent("tq", "Quest B", None).unwrap();
        store.close("tq-001", "done").unwrap();

        let results = QuestQuery::new(&store).include_closed().execute();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn query_filter_by_prefix() {
        let (mut store, _dir) = setup();
        store.create_with_agent("aa", "Alpha quest", None).unwrap();
        store.create_with_agent("bb", "Beta quest", None).unwrap();

        let results = QuestQuery::new(&store).prefix("aa").execute();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.0, "aa-001");
    }

    #[test]
    fn query_filter_by_status() {
        let (mut store, _dir) = setup();
        store.create_with_agent("tq", "Quest A", None).unwrap();
        store.create_with_agent("tq", "Quest B", None).unwrap();
        store.checkout("tq-001", "worker-1").unwrap();

        let results = QuestQuery::new(&store)
            .status(QuestStatus::InProgress)
            .execute();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.0, "tq-001");
    }

    #[test]
    fn query_filter_by_agent() {
        let (mut store, _dir) = setup();
        store
            .create_with_agent("tq", "Agent A quest", Some("agent-a"))
            .unwrap();
        store
            .create_with_agent("tq", "Agent B quest", Some("agent-b"))
            .unwrap();
        store
            .create_with_agent("tq", "Unbound quest", None)
            .unwrap();

        let results = QuestQuery::new(&store).agent_id("agent-a").execute();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].agent_id.as_deref(), Some("agent-a"));
    }

    #[test]
    fn query_filter_by_label() {
        let (mut store, _dir) = setup();
        store.create_with_agent("tq", "Labeled", None).unwrap();
        store.create_with_agent("tq", "Unlabeled", None).unwrap();
        // Stub the in-memory linked idea so the query can match the tag.
        store
            .update("tq-001", |q| {
                q.idea = Some(aeqi_core::traits::Idea {
                    id: "idea-001".to_string(),
                    name: "Labeled".to_string(),
                    content: String::new(),
                    tags: vec!["infra".to_string()],
                    agent_id: None,
                    session_id: None,
                    score: 0.0,
                    scope: aeqi_core::Scope::SelfScope,
                    inheritance: "self".to_string(),
                    tool_allow: vec![],
                    tool_deny: vec![],
                    created_at: chrono::Utc::now(),
                });
            })
            .unwrap();

        let results = QuestQuery::new(&store).label("infra").execute();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.0, "tq-001");
    }

    #[test]
    fn query_filter_by_min_priority() {
        let (mut store, _dir) = setup();
        store.create_with_agent("tq", "Low pri", None).unwrap();
        store.create_with_agent("tq", "High pri", None).unwrap();
        store
            .update("tq-001", |q| {
                q.priority = Priority::Low;
            })
            .unwrap();
        store
            .update("tq-002", |q| {
                q.priority = Priority::High;
            })
            .unwrap();

        let results = QuestQuery::new(&store)
            .min_priority(Priority::High)
            .execute();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.0, "tq-002");
    }

    #[test]
    fn query_combined_filters() {
        let (mut store, _dir) = setup();
        store
            .create_with_agent("tq", "Match", Some("agent-x"))
            .unwrap();
        store
            .create_with_agent("tq", "Wrong agent", Some("agent-y"))
            .unwrap();
        store
            .create_with_agent("zz", "Wrong prefix", Some("agent-x"))
            .unwrap();

        let results = QuestQuery::new(&store)
            .prefix("tq")
            .agent_id("agent-x")
            .execute();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id.0, "tq-001");
    }

    #[test]
    fn query_results_sorted_by_priority_then_creation() {
        let (mut store, _dir) = setup();
        store.create_with_agent("tq", "Normal 1", None).unwrap();
        store.create_with_agent("tq", "Normal 2", None).unwrap();
        store.create_with_agent("tq", "Critical", None).unwrap();
        store
            .update("tq-003", |q| {
                q.priority = Priority::Critical;
            })
            .unwrap();

        let results = QuestQuery::new(&store).execute();
        assert_eq!(results[0].id.0, "tq-003");
        // The two Normal-priority quests follow in creation order.
        assert_eq!(results[1].id.0, "tq-001");
        assert_eq!(results[2].id.0, "tq-002");
    }

    #[test]
    fn query_empty_store_returns_empty() {
        let (store, _dir) = setup();
        let results = QuestQuery::new(&store).execute();
        assert!(results.is_empty());
    }
}
