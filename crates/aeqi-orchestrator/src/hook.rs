use aeqi_quests::QuestId;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A Hook pins a task to a worker. Workers discover their work via hooks on startup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hook {
    pub task_id: QuestId,
    pub subject: String,
    pub assigned_at: DateTime<Utc>,
}

impl Hook {
    pub fn new(task_id: QuestId, subject: String) -> Self {
        Self {
            task_id,
            subject,
            assigned_at: Utc::now(),
        }
    }
}
