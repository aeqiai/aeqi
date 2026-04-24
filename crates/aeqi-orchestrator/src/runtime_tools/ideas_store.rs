// design note: ideas.store is the event-fired counterpart to the MCP
// `ideas(action='store')` IPC handler. Consolidation events (e.g. the
// `ideas:threshold_reached` seed that compacts many rows into a single
// meta-idea) need to persist their result as an idea — that edge is the
// whole point of the consolidation flow. Without this tool, the event's
// second tool_call fires into a tool that doesn't exist and the whole
// chain fails at fire time.
//
// ACL is event_only: the LLM calls the MCP surface via `ideas(action=...)`
// which routes through `handle_store_idea` (full dedup + tag policies +
// embed queue + consolidation threshold check). This internal tool is a
// focused writer for events and skips the dedup pipeline deliberately —
// the event itself is the dedup decision.
//
// Redaction IS applied here: the content path is identical to the IPC
// handler (redact_secrets before persistence). Events can carry
// `{last_tool_result}` placeholders that may include raw tool output, so
// over-redaction is safer than under-redaction.

use std::sync::Arc;

use aeqi_core::traits::{IdeaStore, StoreFull, Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use tracing::{info, warn};

/// Persist an idea from an event tool_call.
///
/// Args: `{ "name": String, "content": String, "tags": Option<Vec<String>>,
///           "agent_id": Option<String>, "scope": Option<String> }`
///
/// Returns: the new or existing idea id. When the partial unique index on
/// `(agent_id, name) WHERE status='active'` already holds a row, the tool
/// returns the existing id with `action: "skip"` so event chains stay
/// idempotent across replays (mirrors the MCP store handler's Fix #6
/// behaviour).
///
/// ACL: event_only. Set in `build_runtime_registry`.
pub struct IdeasStoreTool {
    idea_store: Option<Arc<dyn IdeaStore>>,
}

impl IdeasStoreTool {
    pub fn new(idea_store: Option<Arc<dyn IdeaStore>>) -> Self {
        Self { idea_store }
    }
}

#[async_trait]
impl Tool for IdeasStoreTool {
    fn name(&self) -> &str {
        "ideas.store"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas.store".into(),
            description: "Persist an idea from an event tool_call. \
                          Skips the MCP-level dedup pipeline (the event is \
                          the dedup decision) but still redacts secrets and \
                          honours the active-row unique slot. \
                          Only callable by events."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Idea name. Required."
                    },
                    "content": {
                        "type": "string",
                        "description": "Idea body. May be empty for marker ideas."
                    },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional tag list. Defaults to ['fact']."
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "Optional owning agent_id. Omit for a global idea."
                    },
                    "scope": {
                        "type": "string",
                        "description": "Optional visibility scope override. Defaults to 'global' when \
                                        agent_id is omitted, 'self' otherwise."
                    }
                },
                "required": ["name"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let store = match self.idea_store.as_ref() {
            Some(s) => s.clone(),
            None => {
                return Ok(ToolResult::error("ideas.store: no idea store configured"));
            }
        };

        // `name` is required; `content` is optional (Fix #7 — marker ideas).
        let name = match args.get("name").and_then(|v| v.as_str()) {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => {
                return Ok(ToolResult::error(
                    "ideas.store: missing required field 'name'",
                ));
            }
        };

        let raw_content = args
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // Same secret scrubbing as the MCP path — content ends up in the FTS
        // index and (eventually) the embedding input, so over-redaction is
        // safer than under-redaction.
        let redacted_content = aeqi_ideas::redact::redact_secrets(&raw_content);

        let tags: Vec<String> = args
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_else(|| vec!["fact".to_string()]);

        let agent_id = args
            .get("agent_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let scope: aeqi_core::Scope = args
            .get("scope")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse().ok())
            .unwrap_or_else(|| {
                if agent_id.is_none() {
                    aeqi_core::Scope::Global
                } else {
                    aeqi_core::Scope::SelfScope
                }
            });

        // Active-row short-circuit: if a row with this (agent_id, name) is
        // already `status='active'`, return its id with action=skip instead
        // of tripping the partial unique index. Matches the Fix #6 behaviour
        // on the MCP path so event replays are idempotent.
        if let Ok(Some(existing_id)) = store
            .get_active_id_by_name(&name, agent_id.as_deref())
            .await
        {
            info!(
                name = %name,
                id = %existing_id,
                "ideas.store: active row already exists, skipping"
            );
            return Ok(ToolResult::success(format!(
                "skip: idea '{name}' already active (id={existing_id})"
            ))
            .with_data(serde_json::json!({
                "id": existing_id,
                "action": "skip",
                "name": name,
            })));
        }

        let payload = StoreFull {
            name: name.clone(),
            content: redacted_content,
            tags,
            agent_id,
            scope,
            authored_by: None,
            confidence: 1.0,
            expires_at: None,
            valid_from: None,
            valid_until: None,
            time_context: "timeless".to_string(),
            status: "active".to_string(),
        };

        match store.store_full(payload).await {
            Ok(id) => {
                info!(name = %name, id = %id, "ideas.store: inserted");
                Ok(
                    ToolResult::success(format!("created: idea '{name}' stored (id={id})"))
                        .with_data(serde_json::json!({
                            "id": id,
                            "action": "create",
                            "name": name,
                        })),
                )
            }
            Err(e) => {
                warn!(name = %name, error = %e, "ideas.store: insert failed");
                Ok(ToolResult::error(format!(
                    "ideas.store: failed to store idea '{name}': {e}"
                )))
            }
        }
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false // idea writes serialize through the SQLite mutex anyway.
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_ideas::SqliteIdeas;
    use tempfile::TempDir;

    fn make_store() -> (Arc<dyn IdeaStore>, TempDir) {
        let dir = TempDir::new().unwrap();
        let db = dir.path().join("ideas.db");
        let ideas = SqliteIdeas::open(&db, 30.0).unwrap();
        let arc: Arc<dyn IdeaStore> = Arc::new(ideas);
        (arc, dir)
    }

    #[tokio::test]
    async fn stores_a_new_idea() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreTool::new(Some(store.clone()));
        let result = tool
            .execute(serde_json::json!({
                "name": "consolidation/insight/2026",
                "content": "consolidated body",
                "tags": ["insight", "consolidated"]
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "expected success, got: {}", result.output);
        let id = result
            .data
            .get("id")
            .and_then(|v| v.as_str())
            .expect("id must be set on the structured result");
        let by_name = store
            .get_by_name("consolidation/insight/2026", None)
            .await
            .unwrap()
            .expect("stored idea must be retrievable");
        assert_eq!(by_name.id, id);
    }

    #[tokio::test]
    async fn missing_name_returns_error() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "content": "body" }))
            .await
            .unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("name"));
    }

    #[tokio::test]
    async fn allows_empty_content() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "name": "marker", "content": "" }))
            .await
            .unwrap();
        assert!(
            !result.is_error,
            "empty content must succeed, got: {}",
            result.output
        );
    }

    #[tokio::test]
    async fn duplicate_name_returns_skip_with_existing_id() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreTool::new(Some(store));
        let first = tool
            .execute(serde_json::json!({ "name": "dup-ev", "content": "first" }))
            .await
            .unwrap();
        let first_id = first.data.get("id").and_then(|v| v.as_str()).unwrap();

        let second = tool
            .execute(serde_json::json!({ "name": "dup-ev", "content": "second" }))
            .await
            .unwrap();
        assert!(!second.is_error);
        assert_eq!(
            second.data.get("action").and_then(|v| v.as_str()),
            Some("skip")
        );
        assert_eq!(
            second.data.get("id").and_then(|v| v.as_str()),
            Some(first_id),
            "skip must return the existing id"
        );
    }

    #[tokio::test]
    async fn no_store_returns_error() {
        let tool = IdeasStoreTool::new(None);
        let result = tool
            .execute(serde_json::json!({ "name": "x", "content": "y" }))
            .await
            .unwrap();
        assert!(result.is_error);
    }
}
