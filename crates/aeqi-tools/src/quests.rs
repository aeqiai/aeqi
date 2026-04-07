use aeqi_core::traits::Tool;
use aeqi_core::traits::{ToolResult, ToolSpec};
use aeqi_quests::{Priority, QuestBoard};
use anyhow::Result;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Mutex;

/// Tool for creating quests.
pub struct QuestCreateTool {
    store: Mutex<QuestBoard>,
    prefix: String,
}

impl QuestCreateTool {
    pub fn new(quests_dir: PathBuf, prefix: String) -> Result<Self> {
        let store = QuestBoard::open(&quests_dir)?;
        Ok(Self {
            store: Mutex::new(store),
            prefix,
        })
    }
}

#[async_trait]
impl Tool for QuestCreateTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let subject = args
            .get("subject")
            .and_then(|v| v.as_str())
            .unwrap_or("untitled");
        let description = args
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let priority = args
            .get("priority")
            .and_then(|v| v.as_str())
            .unwrap_or("normal");

        let mut store = self
            .store
            .lock()
            .map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let mut quest = store.create_with_agent(&self.prefix, subject, None)?;

        if !description.is_empty() || priority != "normal" {
            quest = store.update(&quest.id.0, |t| {
                if !description.is_empty() {
                    t.description = description.to_string();
                }
                t.priority = match priority {
                    "low" => Priority::Low,
                    "high" => Priority::High,
                    "critical" => Priority::Critical,
                    _ => Priority::Normal,
                };
            })?;
        }

        Ok(ToolResult::success(format!(
            "Created quest {} [{}] {}",
            quest.id, quest.priority, quest.name
        )))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quest_create".to_string(),
            description: "Create a new quest with a subject and optional description/priority."
                .to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "subject": { "type": "string", "description": "Quest subject" },
                    "description": { "type": "string", "description": "Detailed description" },
                    "priority": { "type": "string", "enum": ["low", "normal", "high", "critical"], "default": "normal" }
                },
                "required": ["subject"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quest_create"
    }
}

/// Tool for listing ready (unblocked) quests.
pub struct QuestReadyTool {
    store: Mutex<QuestBoard>,
}

impl QuestReadyTool {
    pub fn new(quests_dir: PathBuf) -> Result<Self> {
        let store = QuestBoard::open(&quests_dir)?;
        Ok(Self {
            store: Mutex::new(store),
        })
    }
}

#[async_trait]
impl Tool for QuestReadyTool {
    async fn execute(&self, _args: serde_json::Value) -> Result<ToolResult> {
        let store = self
            .store
            .lock()
            .map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let ready = store.ready();

        if ready.is_empty() {
            return Ok(ToolResult::success("No ready work."));
        }

        let mut output = String::new();
        for quest in ready {
            output.push_str(&format!(
                "{} [{}] {} — {}\n",
                quest.id,
                quest.priority,
                quest.name,
                if quest.description.is_empty() {
                    "(no description)"
                } else {
                    &quest.description
                }
            ));
        }
        Ok(ToolResult::success(output))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quest_ready".to_string(),
            description: "List all unblocked quests that are ready to work on.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    fn name(&self) -> &str {
        "quest_ready"
    }
}

/// Tool for updating a quest's status.
pub struct QuestUpdateTool {
    store: Mutex<QuestBoard>,
}

impl QuestUpdateTool {
    pub fn new(quests_dir: PathBuf) -> Result<Self> {
        let store = QuestBoard::open(&quests_dir)?;
        Ok(Self {
            store: Mutex::new(store),
        })
    }
}

#[async_trait]
impl Tool for QuestUpdateTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;
        let status = args.get("status").and_then(|v| v.as_str());

        let mut store = self
            .store
            .lock()
            .map_err(|e| anyhow::anyhow!("lock: {e}"))?;

        let quest = store.update(id, |t| {
            if let Some(s) = status {
                t.status = match s {
                    "in_progress" => aeqi_quests::QuestStatus::InProgress,
                    "done" => aeqi_quests::QuestStatus::Done,
                    "blocked" => aeqi_quests::QuestStatus::Blocked,
                    "cancelled" => aeqi_quests::QuestStatus::Cancelled,
                    _ => aeqi_quests::QuestStatus::Pending,
                };
            }
        })?;

        Ok(ToolResult::success(format!(
            "Updated {} [{}] {}",
            quest.id, quest.status, quest.name
        )))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quest_update".to_string(),
            description: "Update a quest's status.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Quest ID (e.g. as-001)" },
                    "status": { "type": "string", "enum": ["pending", "in_progress", "done", "blocked", "cancelled"] }
                },
                "required": ["id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quest_update"
    }
}

/// Tool for closing a quest.
pub struct QuestCloseTool {
    store: Mutex<QuestBoard>,
}

impl QuestCloseTool {
    pub fn new(quests_dir: PathBuf) -> Result<Self> {
        let store = QuestBoard::open(&quests_dir)?;
        Ok(Self {
            store: Mutex::new(store),
        })
    }
}

#[async_trait]
impl Tool for QuestCloseTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;
        let reason = args
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("completed");

        let mut store = self
            .store
            .lock()
            .map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        let quest = store.close(id, reason)?;
        Ok(ToolResult::success(format!(
            "Closed {} — {}",
            quest.id, quest.name
        )))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quest_close".to_string(),
            description: "Close (complete) a quest with an optional reason.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Quest ID to close" },
                    "reason": { "type": "string", "description": "Completion reason", "default": "completed" }
                },
                "required": ["id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quest_close"
    }
}

/// Tool for showing quest details.
pub struct QuestShowTool {
    store: Mutex<QuestBoard>,
}

impl QuestShowTool {
    pub fn new(quests_dir: PathBuf) -> Result<Self> {
        let store = QuestBoard::open(&quests_dir)?;
        Ok(Self {
            store: Mutex::new(store),
        })
    }
}

#[async_trait]
impl Tool for QuestShowTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;

        let store = self
            .store
            .lock()
            .map_err(|e| anyhow::anyhow!("lock: {e}"))?;

        if let Some(quest) = store.get(id) {
            let deps = if quest.depends_on.is_empty() {
                "none".to_string()
            } else {
                quest.depends_on
                    .iter()
                    .map(|d| d.0.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let agent = quest.agent_id.as_deref().unwrap_or("unbound");

            let output = format!(
                "ID: {}\nSubject: {}\nStatus: {}\nPriority: {}\nAgent: {}\nDescription: {}\nDepends on: {}\nCreated: {}",
                quest.id,
                quest.name,
                quest.status,
                quest.priority,
                agent,
                if quest.description.is_empty() {
                    "(none)"
                } else {
                    &quest.description
                },
                deps,
                quest.created_at
            );
            Ok(ToolResult::success(output))
        } else {
            Ok(ToolResult::error(format!("Quest not found: {id}")))
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quest_show".to_string(),
            description: "Show detailed information about a specific quest.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Quest ID to show" }
                },
                "required": ["id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quest_show"
    }
}

/// Tool for adding a dependency between quests.
pub struct QuestDepTool {
    store: Mutex<QuestBoard>,
}

impl QuestDepTool {
    pub fn new(quests_dir: PathBuf) -> Result<Self> {
        let store = QuestBoard::open(&quests_dir)?;
        Ok(Self {
            store: Mutex::new(store),
        })
    }
}

#[async_trait]
impl Tool for QuestDepTool {
    async fn execute(&self, args: serde_json::Value) -> Result<ToolResult> {
        let id = args
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing id"))?;
        let depends_on = args
            .get("depends_on")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("missing depends_on"))?;

        let mut store = self
            .store
            .lock()
            .map_err(|e| anyhow::anyhow!("lock: {e}"))?;
        store.add_dependency(id, depends_on)?;

        Ok(ToolResult::success(format!(
            "{id} now depends on {depends_on}"
        )))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "quest_dep".to_string(),
            description: "Add a dependency between two quests. The first quest will be blocked until the second is closed.".to_string(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Quest that will be blocked" },
                    "depends_on": { "type": "string", "description": "Quest that must complete first" }
                },
                "required": ["id", "depends_on"]
            }),
        }
    }

    fn name(&self) -> &str {
        "quest_dep"
    }
}
