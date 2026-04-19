// design note: ideas.search delegates to IdeaStore::search() with an IdeaQuery.
// It is usable by both LLM and events. When called by an event, the args may
// contain {user_input} placeholders that are substituted by substitute_args
// before calling invoke(). The tool returns search results as a formatted
// string. The caller (event dispatcher or LLM) decides what to do with the
// result.

use std::sync::Arc;

use aeqi_core::traits::{IdeaQuery, IdeaStore, Tool, ToolResult, ToolSpec};
use async_trait::async_trait;

/// Semantic search over the idea store.
///
/// Args: `{ "query": String, "tags": Option<Vec<String>>, "top_k": Option<u32>,
///           "agent_id": Option<String> }`
///
/// Returns: formatted list of matching ideas (name + content preview).
///
/// ACL: open — callable by LLM and events.
pub struct IdeasSearchTool {
    idea_store: Option<Arc<dyn IdeaStore>>,
}

impl IdeasSearchTool {
    pub fn new(idea_store: Option<Arc<dyn IdeaStore>>) -> Self {
        Self { idea_store }
    }
}

#[async_trait]
impl Tool for IdeasSearchTool {
    fn name(&self) -> &str {
        "ideas.search"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas.search".into(),
            description: "Semantic search over the idea store. \
                          Returns matching ideas ranked by relevance."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query text."
                    },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional tag filter (OR semantics — idea must match at least one)."
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Maximum number of results. Defaults to 5.",
                        "default": 5
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "Optional agent_id to scope the search."
                    }
                },
                "required": ["query"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let store = match self.idea_store.as_ref() {
            Some(s) => s,
            None => {
                return Ok(ToolResult::error("ideas.search: no idea store configured"));
            }
        };

        let query_text = match args.get("query").and_then(|v| v.as_str()) {
            Some(q) => q.to_string(),
            None => {
                return Ok(ToolResult::error(
                    "ideas.search: missing required field 'query'",
                ));
            }
        };

        let top_k = args.get("top_k").and_then(|v| v.as_u64()).unwrap_or(5) as usize;

        let tags: Vec<String> = args
            .get("tags")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let agent_id = args
            .get("agent_id")
            .and_then(|v| v.as_str())
            .map(str::to_string);

        let mut q = IdeaQuery::new(&query_text, top_k);
        q.tags = tags;
        q.agent_id = agent_id;

        match store.search(&q).await {
            Ok(ideas) => {
                if ideas.is_empty() {
                    return Ok(ToolResult::success("(no ideas found)"));
                }
                let mut out = String::new();
                for (i, idea) in ideas.iter().enumerate() {
                    let preview: String = idea.content.chars().take(300).collect();
                    let ellipsis = if idea.content.len() > 300 { "…" } else { "" };
                    out.push_str(&format!(
                        "{}. **{}** (score: {:.2})\n{}{}\n\n",
                        i + 1,
                        idea.name,
                        idea.score,
                        preview,
                        ellipsis
                    ));
                }
                Ok(ToolResult::success(out.trim_end().to_string()))
            }
            Err(e) => Ok(ToolResult::error(format!("ideas.search failed: {e}"))),
        }
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::traits::{Idea, IdeaStore};
    use async_trait::async_trait;
    use chrono::Utc;

    struct StubSearchStore {
        results: Vec<Idea>,
    }

    #[async_trait]
    impl IdeaStore for StubSearchStore {
        async fn store(
            &self,
            _: &str,
            _: &str,
            _: &[String],
            _: Option<&str>,
        ) -> anyhow::Result<String> {
            unimplemented!()
        }
        async fn search(&self, _q: &IdeaQuery) -> anyhow::Result<Vec<Idea>> {
            Ok(self.results.clone())
        }
        async fn delete(&self, _: &str) -> anyhow::Result<()> {
            Ok(())
        }
        fn name(&self) -> &str {
            "stub"
        }
    }

    fn stub_idea(name: &str, content: &str, score: f64) -> Idea {
        Idea {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.to_string(),
            content: content.to_string(),
            tags: vec![],
            agent_id: None,
            created_at: Utc::now(),
            session_id: None,
            score,
            inheritance: "self".to_string(),
            tool_allow: vec![],
            tool_deny: vec![],
        }
    }

    #[tokio::test]
    async fn returns_search_results_formatted() {
        let store: Arc<dyn IdeaStore> = Arc::new(StubSearchStore {
            results: vec![
                stub_idea("skill-tdd", "Use TDD for this quest.", 0.95),
                stub_idea("skill-git", "Commit early and often.", 0.88),
            ],
        });
        let tool = IdeasSearchTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "query": "testing practices", "top_k": 5 }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("skill-tdd"));
        assert!(result.output.contains("skill-git"));
        assert!(result.output.contains("0.95"));
    }

    #[tokio::test]
    async fn empty_results_returns_descriptive_message() {
        let store: Arc<dyn IdeaStore> = Arc::new(StubSearchStore { results: vec![] });
        let tool = IdeasSearchTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "query": "nothing matches" }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert!(result.output.contains("no ideas found"));
    }

    #[tokio::test]
    async fn no_store_returns_error() {
        let tool = IdeasSearchTool::new(None);
        let result = tool
            .execute(serde_json::json!({ "query": "x" }))
            .await
            .unwrap();
        assert!(result.is_error);
    }

    #[tokio::test]
    async fn missing_query_field_returns_error() {
        let store: Arc<dyn IdeaStore> = Arc::new(StubSearchStore { results: vec![] });
        let tool = IdeasSearchTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "top_k": 3 }))
            .await
            .unwrap();
        assert!(result.is_error);
    }
}
