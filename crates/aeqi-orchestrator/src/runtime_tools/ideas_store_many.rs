// design note: ideas.store_many is the event-fired *batch* counterpart to
// ideas.store. The reflection / consolidation sub-agents spawned by the
// lifecycle events (reflect-after-quest, daily-digest, weekly-consolidate,
// ideas:threshold_reached) are not tool-bearing — they only emit text. We
// can't ask them to call `ideas(action='store', ...)` because their runtime
// has `tools: Vec::new()`. Instead, the template instructs them to output a
// JSON array of ideas, and the event's second tool_call pipes that output
// through this tool, which does the real persistence.
//
// Chain shape:
//   session.spawn → outputs JSON array (string)
//   ideas.store_many(from_json={last_tool_result}, authored_by=...,
//                    tag_suffix=[...]) → persists each row.
//
// ACL is event_only: the LLM has no reason to call this — it's the glue
// between an event's spawn tool_call and its store tool_call. Events are
// the composition mechanism.
//
// Why batch instead of multiple ideas.store calls? The sub-agent's output is
// a single stream; we can't chain N tool_calls against an unknown-size output.
// store_many takes the whole JSON array and loops. Each entry goes through
// the same redact+store path as ideas.store.

use std::sync::Arc;

use aeqi_core::traits::{IdeaStore, StoreFull, Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use serde::Deserialize;
use tracing::{info, warn};

/// One item in the reflector / consolidator output array.
#[derive(Debug, Deserialize)]
struct StoreItem {
    name: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default = "default_confidence")]
    confidence: f32,
    /// Optional agent_id override. Most callers leave this to the
    /// tool-level `authored_by` + tag_suffix combination.
    #[serde(default)]
    agent_id: Option<String>,
}

fn default_confidence() -> f32 {
    1.0
}

/// Persist a JSON array of ideas emitted by a reflector / consolidator
/// sub-agent. See the module-level design note.
///
/// Args (full shape):
/// ```json
/// {
///   "from_json": "<stringified JSON array>",
///   "authored_by": "reflector:<agent_id>",
///   "tag_suffix": ["source:session:<session_id>", "reflection"]
/// }
/// ```
///
/// Returns a summary: `{ stored: N, skipped: M, errors: [...] }`.
///
/// ACL: event_only. Set in `build_runtime_registry`.
pub struct IdeasStoreManyTool {
    idea_store: Option<Arc<dyn IdeaStore>>,
}

impl IdeasStoreManyTool {
    pub fn new(idea_store: Option<Arc<dyn IdeaStore>>) -> Self {
        Self { idea_store }
    }
}

#[async_trait]
impl Tool for IdeasStoreManyTool {
    fn name(&self) -> &str {
        "ideas.store_many"
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "ideas.store_many".into(),
            description: "Batch-persist an array of ideas from a sub-agent's \
                          JSON output. Parses `from_json` (tolerates markdown \
                          fences, raw arrays, or wrapped strings), redacts \
                          secrets, and inserts each entry via the same \
                          active-row UNIQUE-slot skip logic as ideas.store. \
                          Only callable by events."
                .into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {
                    "from_json": {
                        "type": "string",
                        "description": "Stringified JSON array. Usually the \
                                        output of a preceding session.spawn \
                                        tool_call, referenced as \
                                        `{last_tool_result}`."
                    },
                    "authored_by": {
                        "type": "string",
                        "description": "Provenance tag written to every row, \
                                        e.g. 'reflector:<agent_id>'."
                    },
                    "tag_suffix": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Extra tags appended to every item's \
                                        own tag list. Typically \
                                        'source:session:<session_id>' and \
                                        similar provenance tags."
                    },
                    "agent_id": {
                        "type": "string",
                        "description": "Optional default agent_id for all \
                                        items. Individual items may override."
                    }
                },
                "required": ["from_json"]
            }),
        }
    }

    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let store = match self.idea_store.as_ref() {
            Some(s) => s.clone(),
            None => {
                return Ok(ToolResult::error(
                    "ideas.store_many: no idea store configured",
                ));
            }
        };

        let from_json_raw = match args.get("from_json") {
            Some(v) => v,
            None => {
                return Ok(ToolResult::error(
                    "ideas.store_many: missing required field 'from_json'",
                ));
            }
        };

        let items = match parse_items(from_json_raw) {
            Ok(items) => items,
            Err(e) => {
                warn!(error = %e, "ideas.store_many: failed to parse from_json");
                return Ok(ToolResult::error(format!(
                    "ideas.store_many: failed to parse from_json: {e}"
                )));
            }
        };

        if items.is_empty() {
            info!("ideas.store_many: no items to store");
            return Ok(
                ToolResult::success("ideas.store_many: no items".to_string()).with_data(
                    serde_json::json!({
                        "stored": 0,
                        "skipped": 0,
                        "errors": [],
                    }),
                ),
            );
        }

        let authored_by = args
            .get("authored_by")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let tag_suffix: Vec<String> = args
            .get("tag_suffix")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let default_agent_id = args
            .get("agent_id")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        let mut stored_ids: Vec<String> = Vec::with_capacity(items.len());
        let mut skipped: usize = 0;
        let mut errors: Vec<String> = Vec::new();

        for item in items {
            if item.name.is_empty() {
                errors.push("skipped: item missing 'name'".to_string());
                continue;
            }

            let redacted_content = aeqi_ideas::redact::redact_secrets(&item.content);
            let mut tags = item.tags.clone();
            // Append provenance tags (dedup case-insensitively).
            for extra in &tag_suffix {
                if !tags.iter().any(|t| t.eq_ignore_ascii_case(extra.as_str())) {
                    tags.push(extra.clone());
                }
            }
            if tags.is_empty() {
                tags.push("fact".to_string());
            }

            let agent_id = item.agent_id.or_else(|| default_agent_id.clone());
            let scope = if agent_id.is_none() {
                aeqi_core::Scope::Global
            } else {
                aeqi_core::Scope::SelfScope
            };

            // Active-row UNIQUE skip, mirroring ideas.store.
            if let Ok(Some(existing_id)) = store
                .get_active_id_by_name(&item.name, agent_id.as_deref())
                .await
            {
                info!(
                    name = %item.name,
                    id = %existing_id,
                    "ideas.store_many: active row already exists, skipping"
                );
                skipped += 1;
                stored_ids.push(existing_id);
                continue;
            }

            let confidence = item.confidence.clamp(0.0, 1.0);
            let payload = StoreFull {
                name: item.name.clone(),
                content: redacted_content,
                tags,
                agent_id,
                scope,
                authored_by: authored_by.clone(),
                confidence,
                expires_at: None,
                valid_from: None,
                valid_until: None,
                time_context: "timeless".to_string(),
                status: "active".to_string(),
            };

            match store.store_full(payload).await {
                Ok(id) => {
                    info!(name = %item.name, id = %id, "ideas.store_many: inserted");
                    stored_ids.push(id);
                }
                Err(e) => {
                    warn!(
                        name = %item.name,
                        error = %e,
                        "ideas.store_many: insert failed"
                    );
                    errors.push(format!("'{}': {e}", item.name));
                }
            }
        }

        let stored = stored_ids.len().saturating_sub(skipped);
        let summary = format!("stored={stored} skipped={skipped} errors={}", errors.len());
        info!(%summary, "ideas.store_many: batch complete");

        Ok(ToolResult::success(summary).with_data(serde_json::json!({
            "stored": stored,
            "skipped": skipped,
            "ids": stored_ids,
            "errors": errors,
        })))
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        false
    }
}

/// Extract a `Vec<StoreItem>` from a `from_json` arg that may arrive in any
/// of the following shapes (sub-agent outputs are free-form):
///
/// 1. A JSON array value: `[{..}, {..}]` (passed in via `last_tool_result`
///    that was itself a JSON string the dispatcher decoded).
/// 2. A string containing JSON: `"[{..}, {..}]"` — the most common shape
///    because `{last_tool_result}` is substituted as a raw string.
/// 3. A string with markdown fences around the JSON:
///    ````json
///    [{..}]
///    ````
///    LLMs love to do this even when told not to.
fn parse_items(value: &serde_json::Value) -> Result<Vec<StoreItem>, String> {
    // Case 1 — already a JSON array value.
    if value.is_array() {
        return serde_json::from_value::<Vec<StoreItem>>(value.clone())
            .map_err(|e| format!("array deserialise failed: {e}"));
    }

    let raw = value
        .as_str()
        .ok_or_else(|| "from_json must be a JSON array or a string containing one".to_string())?;
    let stripped = strip_code_fence(raw).trim();
    if stripped.is_empty() {
        return Ok(Vec::new());
    }

    // Case 2/3 — parse the (possibly fenced) string.
    serde_json::from_str::<Vec<StoreItem>>(stripped).map_err(|e| format!("parse failed: {e}"))
}

/// Strip a surrounding ```json ... ``` or ``` ... ``` markdown fence if
/// present. Leaves unfenced input untouched.
fn strip_code_fence(input: &str) -> &str {
    let trimmed = input.trim();
    let Some(after_open) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    // Consume an optional language tag (e.g. "json\n").
    let after_lang = match after_open.find('\n') {
        Some(idx) => &after_open[idx + 1..],
        None => after_open,
    };
    after_lang
        .strip_suffix("```")
        .map(str::trim)
        .unwrap_or(after_lang)
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
    async fn stores_a_json_array_of_ideas() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store.clone()));
        let result = tool
            .execute(serde_json::json!({
                "from_json": r#"[
                    {"name": "auth/jwt-rotation", "content": "Rotate JWT every 24h.", "tags": ["fact"]},
                    {"name": "deploy/prefer-blue-green", "content": "User prefers blue-green.", "tags": ["preference"]}
                ]"#,
                "authored_by": "reflector:agent-xyz",
                "tag_suffix": ["source:session:sess-1"]
            }))
            .await
            .unwrap();

        assert!(!result.is_error, "expected success, got: {}", result.output);
        assert_eq!(
            result.data.get("stored").and_then(|v| v.as_u64()),
            Some(2),
            "expected 2 stored, got data: {}",
            result.data
        );

        // Verify persistence + provenance tags.
        let got = store
            .get_by_name("auth/jwt-rotation", None)
            .await
            .unwrap()
            .expect("idea must be retrievable");
        assert!(
            got.tags.iter().any(|t| t == "fact"),
            "expected 'fact' tag, got: {:?}",
            got.tags
        );
        assert!(
            got.tags.iter().any(|t| t == "source:session:sess-1"),
            "expected suffix tag applied, got: {:?}",
            got.tags
        );
    }

    #[tokio::test]
    async fn tolerates_markdown_fenced_json() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store.clone()));
        let result = tool
            .execute(serde_json::json!({
                "from_json": "```json\n[{\"name\": \"fenced-fact\", \"content\": \"x\", \"tags\": [\"fact\"]}]\n```",
                "authored_by": "reflector:x"
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "expected success, got: {}", result.output);
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(1));
        assert!(
            store
                .get_by_name("fenced-fact", None)
                .await
                .unwrap()
                .is_some()
        );
    }

    #[tokio::test]
    async fn tolerates_bare_backtick_fence_without_lang() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store.clone()));
        let result = tool
            .execute(serde_json::json!({
                "from_json": "```\n[{\"name\": \"bare-fence\", \"content\": \"y\"}]\n```"
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(1));
    }

    #[tokio::test]
    async fn accepts_raw_json_array_value() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store.clone()));
        let result = tool
            .execute(serde_json::json!({
                "from_json": [
                    {"name": "raw-array-fact", "content": "z", "tags": ["fact"]}
                ]
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(1));
    }

    #[tokio::test]
    async fn empty_string_returns_zero_stored() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store));
        let result = tool
            .execute(serde_json::json!({ "from_json": "" }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(0));
    }

    #[tokio::test]
    async fn missing_from_json_returns_error() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store));
        let result = tool.execute(serde_json::json!({})).await.unwrap();
        assert!(result.is_error);
        assert!(result.output.contains("from_json"));
    }

    #[tokio::test]
    async fn duplicate_name_is_skipped_not_errored() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store.clone()));
        // First insert.
        let _ = tool
            .execute(serde_json::json!({
                "from_json": r#"[{"name": "dup-many", "content": "first"}]"#
            }))
            .await
            .unwrap();
        // Second insert with the same name → skip.
        let second = tool
            .execute(serde_json::json!({
                "from_json": r#"[{"name": "dup-many", "content": "second"}]"#
            }))
            .await
            .unwrap();
        assert!(!second.is_error);
        assert_eq!(
            second.data.get("skipped").and_then(|v| v.as_u64()),
            Some(1),
            "expected 1 skipped, got: {}",
            second.data
        );
    }

    #[tokio::test]
    async fn redacts_secrets_before_storing() {
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store.clone()));
        // Use an OpenAI-style `sk-` + 20+ token bytes pattern, which the
        // redact_secrets matcher recognizes.
        let result = tool
            .execute(serde_json::json!({
                "from_json": r#"[{"name": "leaky", "content": "token=sk-abc123XYZ456def789GHI012 rest"}]"#
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        let row = store.get_by_name("leaky", None).await.unwrap().unwrap();
        assert!(
            !row.content.contains("sk-abc123XYZ456def789GHI012"),
            "redaction did not run: {}",
            row.content
        );
        assert!(row.content.contains("[REDACTED]"));
    }

    #[tokio::test]
    async fn no_store_returns_error() {
        let tool = IdeasStoreManyTool::new(None);
        let result = tool
            .execute(serde_json::json!({
                "from_json": r#"[{"name": "x"}]"#
            }))
            .await
            .unwrap();
        assert!(result.is_error);
    }
}
