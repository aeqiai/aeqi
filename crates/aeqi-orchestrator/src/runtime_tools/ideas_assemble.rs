// design note: ideas.assemble fetches ideas by exact name from the IdeaStore
// using get_by_name(). It emits a Status event per assembled idea so the user
// can see what context was injected. The tool returns the joined idea content
// as its output string; the event dispatcher appends this to the assembled
// context. This tool is event_only — the LLM cannot call it directly.

use std::sync::Arc;

use aeqi_core::traits::{IdeaStore, Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use tracing::warn;

/// Fetches ideas by name and returns them joined as context.
///
/// Args: `{ "names": Vec<String> }`
///
/// Returns: ideas joined with `---` separators. Each fetched idea emits a
/// `ChatStreamEvent::Status` so the operator can see what was assembled.
///
/// ACL: event_only (set in build_runtime_registry).
pub struct IdeasAssembleTool {
    idea_store: Option<Arc<dyn IdeaStore>>,
}

impl IdeasAssembleTool {
    pub fn new(idea_store: Option<Arc<dyn IdeaStore>>) -> Self {
        Self { idea_store }
    }
}

#[async_trait]
impl Tool for IdeasAssembleTool {
    fn name(&self) -> &str {
        "ideas.assemble"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas.assemble".into(),
            description: "Fetch ideas by exact name and assemble them into context. \
                          Returns ideas joined with separators. \
                          Each fetched idea emits a status event."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "names": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "List of idea names to fetch (exact match)."
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "Optional agent_id scope. If omitted, searches global ideas."
                    }
                },
                "required": ["names"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let store = match self.idea_store.as_ref() {
            Some(s) => s,
            None => {
                return Ok(ToolResult::error(
                    "ideas.assemble: no idea store configured",
                ));
            }
        };

        let names: Vec<String> = match args.get("names").and_then(|v| v.as_array()) {
            Some(arr) => arr
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            None => {
                return Ok(ToolResult::error(
                    "ideas.assemble: missing required field 'names'",
                ));
            }
        };

        let agent_id_opt = args.get("agent_id").and_then(|v| v.as_str());

        let mut parts: Vec<String> = Vec::new();
        let mut not_found: Vec<String> = Vec::new();

        for name in &names {
            match store.get_by_name(name, agent_id_opt).await {
                Ok(Some(idea)) => {
                    if !idea.content.is_empty() {
                        parts.push(idea.content.clone());
                    }
                    // Status emission happens at the ToolRegistry level via ctx.
                    // We log here for observability in the background.
                }
                Ok(None) => {
                    warn!(name = %name, "ideas.assemble: idea not found, skipping");
                    not_found.push(name.clone());
                }
                Err(e) => {
                    warn!(name = %name, error = %e, "ideas.assemble: failed to fetch idea");
                }
            }
        }

        let mut output = parts.join("\n\n---\n\n");
        if !not_found.is_empty() {
            if !output.is_empty() {
                output.push('\n');
            }
            output.push_str(&format!(
                "[ideas.assemble: not found: {}]",
                not_found.join(", ")
            ));
        }

        if output.is_empty() {
            Ok(ToolResult::success("(no ideas assembled)"))
        } else {
            Ok(ToolResult::success(output))
        }
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }

    fn produces_context(&self) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::{Idea, IdeaQuery, IdeaStore};
    use async_trait::async_trait;
    use chrono::Utc;
    use std::collections::HashMap;
    use std::sync::Mutex;

    struct StubStore {
        ideas: Mutex<HashMap<String, Idea>>,
    }

    impl StubStore {
        fn with(ideas: Vec<Idea>) -> Arc<dyn IdeaStore> {
            let map = ideas.into_iter().map(|i| (i.name.clone(), i)).collect();
            Arc::new(Self {
                ideas: Mutex::new(map),
            })
        }
    }

    #[async_trait]
    impl IdeaStore for StubStore {
        async fn store(
            &self,
            _: &str,
            _: &str,
            _: &[String],
            _: Option<&str>,
        ) -> anyhow::Result<String> {
            unimplemented!()
        }
        async fn search(&self, _: &IdeaQuery) -> anyhow::Result<Vec<Idea>> {
            Ok(vec![])
        }
        async fn delete(&self, _: &str) -> anyhow::Result<()> {
            Ok(())
        }
        fn name(&self) -> &str {
            "stub"
        }
        async fn get_by_name(
            &self,
            name: &str,
            _agent_id: Option<&str>,
        ) -> anyhow::Result<Option<Idea>> {
            Ok(self.ideas.lock().unwrap().get(name).cloned())
        }
    }

    fn idea(name: &str, content: &str) -> Idea {
        Idea {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            content: content.to_string(),
            tags: vec![],
            agent_id: None,
            created_at: Utc::now(),
            session_id: None,
            score: 1.0,
            inheritance: "self".to_string(),
            tool_allow: vec![],
            tool_deny: vec![],
        }
    }

    #[tokio::test]
    async fn assembles_ideas_by_name() {
        let store = StubStore::with(vec![
            idea("session:primer", "You are an AEQI agent."),
            idea("extra-context", "Extra context here."),
        ]);
        let tool = IdeasAssembleTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "names": ["session:primer", "extra-context"] }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("You are an AEQI agent."));
        assert!(result.output.contains("Extra context here."));
    }

    #[tokio::test]
    async fn missing_ideas_noted_in_output() {
        let store = StubStore::with(vec![idea("exists", "content")]);
        let tool = IdeasAssembleTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "names": ["exists", "missing-idea"] }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("content"));
        assert!(result.output.contains("not found"));
        assert!(result.output.contains("missing-idea"));
    }

    #[tokio::test]
    async fn no_store_returns_error() {
        let tool = IdeasAssembleTool::new(None);
        let result = tool
            .execute(serde_json::json!({ "names": ["x"] }))
            .await
            .unwrap();
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn missing_names_field_returns_error() {
        let store = StubStore::with(vec![]);
        let tool = IdeasAssembleTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "other": "field" }))
            .await
            .unwrap();
        assert!(result.is_error);
    }
}
