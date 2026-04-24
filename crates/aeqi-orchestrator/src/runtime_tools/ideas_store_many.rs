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
use aeqi_ideas::tag_policy::TagPolicyCache;
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
    /// Optional tag-policy cache. When wired, the tool consults
    /// `TagPolicy::max_items_per_call` on every tag carried by the inbound
    /// items + the `tag_suffix` and refuses items beyond the tightest cap
    /// (T1.1). When `None`, behaviour is identical to the pre-T1.1 path:
    /// every well-formed item is attempted regardless of policy.
    tag_policy_cache: Option<Arc<TagPolicyCache>>,
}

impl IdeasStoreManyTool {
    pub fn new(idea_store: Option<Arc<dyn IdeaStore>>) -> Self {
        Self {
            idea_store,
            tag_policy_cache: None,
        }
    }

    /// Wire a tag-policy cache so this tool can enforce per-tag dials
    /// (T1.1: `max_items_per_call`). Builder-style so existing call sites
    /// stay unchanged when no cache is available.
    pub fn with_tag_policy_cache(mut self, cache: Option<Arc<TagPolicyCache>>) -> Self {
        self.tag_policy_cache = cache;
        self
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
        let mut refused: Vec<String> = Vec::new();
        // Per-tag admitted count for the T1.1 `max_items_per_call` blast-
        // radius cap. Lazily populated when policies are present.
        let mut admitted_per_tag: std::collections::HashMap<String, i64> =
            std::collections::HashMap::new();

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

            // ── T1.1 blast-radius cap ─────────────────────────────────
            // Resolve per-tag policies and refuse the item if admitting it
            // would push any tag past its `max_items_per_call`. The
            // *tightest* cap among the item's tags wins (consistent with
            // EffectivePolicy::max_items_per_call min-merge). When no
            // policy declares a cap, behaviour is byte-identical to the
            // pre-T1.1 path.
            if let Some(cache) = self.tag_policy_cache.as_ref() {
                let policies = cache.resolve(store.as_ref(), &tags).await;
                let mut blocked_by: Option<(String, i64)> = None;
                for policy in &policies {
                    let Some(cap) = policy.max_items_per_call else {
                        continue;
                    };
                    let count = admitted_per_tag
                        .get(&policy.tag.to_lowercase())
                        .copied()
                        .unwrap_or(0);
                    if count >= cap {
                        blocked_by = Some((policy.tag.clone(), cap));
                        break;
                    }
                }
                if let Some((tag, cap)) = blocked_by {
                    info!(
                        name = %item.name,
                        blocking_tag = %tag,
                        cap,
                        "ideas.store_many: refused — max_items_per_call cap reached",
                    );
                    refused.push(format!(
                        "'{}': max_items_per_call cap {} reached for tag '{}'",
                        item.name, cap, tag
                    ));
                    continue;
                }
                // Pre-bump the per-tag counters so subsequent items in this
                // batch see the new admitted count. We do this BEFORE the
                // store attempt: a downstream insert failure leaves the
                // counter accurate to "items admitted past the cap gate"
                // which is the gate's actual semantic (it enforces blast
                // radius, not landed-write count).
                for policy in &policies {
                    if policy.max_items_per_call.is_some() {
                        *admitted_per_tag
                            .entry(policy.tag.to_lowercase())
                            .or_insert(0) += 1;
                    }
                }
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
        let summary = format!(
            "stored={stored} skipped={skipped} refused={} errors={}",
            refused.len(),
            errors.len()
        );
        info!(%summary, "ideas.store_many: batch complete");

        Ok(ToolResult::success(summary).with_data(serde_json::json!({
            "stored": stored,
            "skipped": skipped,
            "ids": stored_ids,
            "errors": errors,
            "refused": refused,
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

    // ── T1.1 — `max_items_per_call` blast-radius cap ─────────────────
    //
    // These tests cover the neutral-dial invariants for the
    // `max_items_per_call` field added to TagPolicy:
    //   1. Baseline: no policy cache wired → behaviour unchanged (every
    //      well-formed item lands).
    //   2. Baseline: cache wired but no policy declares a cap → behaviour
    //      unchanged.
    //   3. Activation: policy declares cap=N → first N items stored, rest
    //      refused with a `refused` array entry.

    /// Helper: seed a `meta:tag-policy` idea declaring a per-tag policy
    /// body. Returns nothing — the cache picks it up on first resolve.
    async fn seed_policy(store: &Arc<dyn IdeaStore>, tag: &str, body: &str) {
        let name = format!("meta:tag-policy:{tag}");
        store
            .store(&name, body, &["meta:tag-policy".to_string()], None)
            .await
            .expect("seed policy must store");
    }

    #[tokio::test]
    async fn t1_1_baseline_no_cache_stores_all_items() {
        // Neutral-dial invariant 1 — when no TagPolicyCache is wired, no
        // dial can possibly bind. Behaviour must be byte-identical to the
        // pre-T1.1 path.
        let (store, _dir) = make_store();
        let tool = IdeasStoreManyTool::new(Some(store.clone()));
        let items: Vec<serde_json::Value> = (0..10)
            .map(|i| {
                serde_json::json!({
                    "name": format!("baseline-no-cache/{i}"),
                    "content": format!("body {i}"),
                    "tags": ["ephemeral"],
                })
            })
            .collect();
        let result = tool
            .execute(serde_json::json!({
                "from_json": serde_json::Value::Array(items),
                "authored_by": "test",
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(10));
        assert_eq!(
            result
                .data
                .get("refused")
                .and_then(|v| v.as_array())
                .map(Vec::len),
            Some(0),
        );
    }

    #[tokio::test]
    async fn t1_1_baseline_cache_without_cap_stores_all_items() {
        // Neutral-dial invariant 2 — cache wired but no policy declares
        // `max_items_per_call`. Behaviour must be unchanged.
        let (store, _dir) = make_store();
        let cache = aeqi_ideas::tag_policy::default_cache();
        let tool = IdeasStoreManyTool::new(Some(store.clone())).with_tag_policy_cache(Some(cache));
        let items: Vec<serde_json::Value> = (0..10)
            .map(|i| {
                serde_json::json!({
                    "name": format!("baseline-no-cap/{i}"),
                    "content": format!("body {i}"),
                    "tags": ["ephemeral"],
                })
            })
            .collect();
        let result = tool
            .execute(serde_json::json!({
                "from_json": serde_json::Value::Array(items),
                "authored_by": "test",
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(10));
        assert_eq!(
            result
                .data
                .get("refused")
                .and_then(|v| v.as_array())
                .map(Vec::len),
            Some(0),
        );
    }

    #[tokio::test]
    async fn t1_1_max_items_per_call_caps_batch_at_three() {
        // Independent activation: only `max_items_per_call=3` set on the
        // tag policy. 10 items → 3 stored, 7 refused.
        let (store, _dir) = make_store();
        seed_policy(
            &store,
            "ephemeral",
            r#"
            tag = "ephemeral"
            max_items_per_call = 3
        "#,
        )
        .await;
        let cache = aeqi_ideas::tag_policy::default_cache();
        let tool = IdeasStoreManyTool::new(Some(store.clone())).with_tag_policy_cache(Some(cache));

        let items: Vec<serde_json::Value> = (0..10)
            .map(|i| {
                serde_json::json!({
                    "name": format!("blast-cap/{i}"),
                    "content": format!("body {i}"),
                    "tags": ["ephemeral"],
                })
            })
            .collect();
        let result = tool
            .execute(serde_json::json!({
                "from_json": serde_json::Value::Array(items),
                "authored_by": "test",
            }))
            .await
            .unwrap();
        assert!(!result.is_error, "expected ok, got: {}", result.output);
        assert_eq!(
            result.data.get("stored").and_then(|v| v.as_u64()),
            Some(3),
            "expected 3 stored, got data: {}",
            result.data
        );
        let refused = result
            .data
            .get("refused")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(refused.len(), 7, "expected 7 refused, got: {refused:?}");
        // Refused entries must reference the cap.
        for r in &refused {
            let s = r.as_str().unwrap_or("");
            assert!(
                s.contains("max_items_per_call"),
                "refused string must mention dial: {s}"
            );
        }
    }

    #[tokio::test]
    async fn t1_1_max_items_per_call_only_counts_matching_tag() {
        // Items not carrying the capped tag should pass through. Cap is
        // tag-scoped, not batch-scoped.
        let (store, _dir) = make_store();
        seed_policy(
            &store,
            "ephemeral",
            r#"
            tag = "ephemeral"
            max_items_per_call = 2
        "#,
        )
        .await;
        let cache = aeqi_ideas::tag_policy::default_cache();
        let tool = IdeasStoreManyTool::new(Some(store.clone())).with_tag_policy_cache(Some(cache));

        let result = tool
            .execute(serde_json::json!({
                "from_json": [
                    {"name": "e1", "content": "x", "tags": ["ephemeral"]},
                    {"name": "f1", "content": "x", "tags": ["fact"]},
                    {"name": "e2", "content": "x", "tags": ["ephemeral"]},
                    {"name": "f2", "content": "x", "tags": ["fact"]},
                    {"name": "e3", "content": "x", "tags": ["ephemeral"]},
                    {"name": "f3", "content": "x", "tags": ["fact"]},
                ],
                "authored_by": "test",
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        // 2 ephemeral admitted + 3 fact admitted = 5 stored. 1 ephemeral refused.
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(5));
        let refused = result
            .data
            .get("refused")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        assert_eq!(refused.len(), 1);
    }

    /// End-to-end test from the universality plan: seed a policy with
    /// `max_items_per_call=3`. Fire `ideas.store_many` with 10 items. Expect
    /// 3 stored, 7 refused. (The other half of the plan's E2E — `ban_after_wrong`
    /// + supersession recall — is deferred until `wrong_feedback_count`
    /// exists as a column or a feedback-join migration lands.)
    #[tokio::test]
    async fn t1_1_end_to_end_blast_radius_three_in_seven_refused() {
        let (store, _dir) = make_store();
        seed_policy(
            &store,
            "throttled",
            r#"
            tag = "throttled"
            max_items_per_call = 3
        "#,
        )
        .await;
        let cache = aeqi_ideas::tag_policy::default_cache();
        let tool = IdeasStoreManyTool::new(Some(store.clone())).with_tag_policy_cache(Some(cache));

        let items: Vec<serde_json::Value> = (0..10)
            .map(|i| {
                serde_json::json!({
                    "name": format!("e2e/{i}"),
                    "content": format!("body {i}"),
                    "tags": ["throttled"],
                })
            })
            .collect();
        let result = tool
            .execute(serde_json::json!({
                "from_json": serde_json::Value::Array(items),
                "authored_by": "e2e",
            }))
            .await
            .unwrap();
        assert!(!result.is_error);
        assert_eq!(result.data.get("stored").and_then(|v| v.as_u64()), Some(3));
        assert_eq!(
            result
                .data
                .get("refused")
                .and_then(|v| v.as_array())
                .map(Vec::len),
            Some(7),
        );
    }
}
