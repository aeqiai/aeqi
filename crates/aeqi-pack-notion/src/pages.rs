//! Notion Pages tools — search / get / create / update / append_blocks.
//!
//! Per-workspace scoping (`ScopeHint::User` with `scope_id=<workspace_id>`).
//!
//! | Tool                       | Capability               |
//! | -------------------------- | ------------------------ |
//! | `notion.pages.search`      | Workspace search         |
//! | `notion.pages.get`         | Page metadata + children |
//! | `notion.pages.create`      | New page (parent + props + content) |
//! | `notion.pages.update`      | Properties only          |
//! | `notion.pages.append_blocks` | Append children blocks (chunked) |
//!
//! Notion's OAuth grants are workspace-wide; there are no granular OAuth
//! scopes to declare. The bot installs to a workspace and gets access to
//! whatever pages the user shared with it.
//!
//! ## `notion.pages.get` — metadata + children
//!
//! Returns the page's metadata (title, properties, parent, url) plus a
//! truncated children-block list (cap 200). Callers needing deep
//! introspection drill into specific blocks via `notion.blocks.get`.
//!
//! ## Property pass-through
//!
//! `properties` is returned verbatim as `serde_json::Value` — Notion's
//! property shapes (title vs rich_text vs relation vs select vs ...) are
//! heterogeneous and the agent introspects them directly rather than
//! against a normalized Rust shape.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{APPEND_BLOCK_CHUNK, NotionApiClient, NotionApiError, append_blocks_body};

const PROVIDER: &str = "notion";
const NAME: &str = "oauth_token";

fn need() -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::User)
}

fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error(
        "missing_credential: provider=notion name=oauth_token (no workspace-scoped Notion \
         credential found — install the Notion integration to a workspace first)",
    )
    .with_data(json!({"reason_code": "missing_credential"}))
}

fn build_client(cred: &UsableCredential) -> NotionApiClient<'_> {
    let base_override = cred
        .metadata
        .get("aeqi_test_base")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut c = NotionApiClient::new(cred);
    if let Some(b) = base_override {
        c = c.with_base(b);
    }
    c
}

fn into_tool_error(err: NotionApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    match &err {
        NotionApiError::AuthExpired { credential_id } => {
            data["credential_id"] = json!(credential_id);
        }
        NotionApiError::RateLimited {
            retry_after: Some(rs),
        } => {
            data["retry_after"] = json!(rs);
        }
        _ => {}
    }
    ToolResult::error(err.to_string()).with_data(data)
}

fn require_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, Box<ToolResult>> {
    match args.get(key).and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => Ok(s),
        _ => Err(Box::new(ToolResult::error(format!(
            "missing or empty '{key}'"
        )))),
    }
}

// ------------------------------------------------------------------------
// notion.pages.search
// ------------------------------------------------------------------------

pub struct PagesSearchTool;

#[async_trait]
impl Tool for PagesSearchTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.pages.search requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.pages.search".into(),
            description: "Search the Notion workspace for pages and databases the integration has access to. Optional `query` (substring match against title); optional `filter_object` ∈ `page | database` to constrain object type. Pagination caps at 200 results — `truncated=true` when more existed.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query":         { "type": "string" },
                    "filter_object": { "type": "string", "description": "page | database (omit for both)" }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.pages.search"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        let url = format!("{}/v1/search", client.base().trim_end_matches('/'));
        let mut body = json!({});
        if let Some(q) = args.get("query").and_then(|v| v.as_str())
            && !q.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("query".into(), Value::String(q.into()));
        }
        if let Some(f) = args.get("filter_object").and_then(|v| v.as_str())
            && !f.is_empty()
        {
            if !matches!(f, "page" | "database") {
                return Ok(ToolResult::error(format!(
                    "invalid 'filter_object': must be page | database (got '{f}')"
                )));
            }
            if let Some(obj) = body.as_object_mut() {
                obj.insert("filter".into(), json!({ "value": f, "property": "object" }));
            }
        }
        let (items, truncated) = match client.paginate_post(url, body).await {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let results: Vec<Value> = items
            .into_iter()
            .map(|i| {
                json!({
                    "id":      i.get("id").cloned().unwrap_or(Value::Null),
                    "object":  i.get("object").cloned().unwrap_or(Value::Null),
                    "url":     i.get("url").cloned().unwrap_or(Value::Null),
                    "title":   extract_title(&i),
                    "parent":  i.get("parent").cloned().unwrap_or(Value::Null),
                    "last_edited_time": i.get("last_edited_time").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&results).unwrap_or_default()).with_data(
                json!({ "results": results, "truncated": truncated, "count": results.len() }),
            ),
        )
    }
}

// ------------------------------------------------------------------------
// notion.pages.get
// ------------------------------------------------------------------------

pub struct PagesGetTool;

#[async_trait]
impl Tool for PagesGetTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.pages.get requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.pages.get".into(),
            description: "Read a Notion page. Returns metadata (id, url, parent, properties pass-through, last_edited_time) plus the page's top-level children blocks (cap 200, truncated=true when more existed). Drill into nested blocks via notion.blocks.get.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "page_id": { "type": "string" }
                },
                "required": ["page_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.pages.get"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        let page_id = match require_str(&args, "page_id") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let page_url = format!(
            "{}/v1/pages/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(page_id),
        );
        let page: Value = match client.get(page_url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let children_url = format!(
            "{}/v1/blocks/{}/children?page_size=100",
            client.base().trim_end_matches('/'),
            urlencoding::encode(page_id),
        );
        let (children, truncated) = match client.paginate_get(children_url).await {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let data = json!({
            "id":      page.get("id").cloned().unwrap_or(Value::Null),
            "url":     page.get("url").cloned().unwrap_or(Value::Null),
            "parent":  page.get("parent").cloned().unwrap_or(Value::Null),
            "properties": page.get("properties").cloned().unwrap_or(Value::Null),
            "last_edited_time": page.get("last_edited_time").cloned().unwrap_or(Value::Null),
            "archived": page.get("archived").cloned().unwrap_or(Value::Null),
            "children": children,
            "truncated": truncated,
        });
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

// ------------------------------------------------------------------------
// notion.pages.create
// ------------------------------------------------------------------------

pub struct PagesCreateTool;

#[async_trait]
impl Tool for PagesCreateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.pages.create requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.pages.create".into(),
            description: "Create a Notion page. `parent` is the Notion `parent` shape (e.g. `{type: \"page_id\", page_id: \"...\"}` or `{type: \"database_id\", database_id: \"...\"}`). `properties` is Notion's heterogeneous property-map (pass through verbatim — title is required when the parent is a workspace/page; database parents need keys matching the database schema). Optional `children` is an array of block objects.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "parent":     { "type": "object", "description": "Notion parent shape" },
                    "properties": { "type": "object", "description": "Notion properties shape" },
                    "children":   { "type": "array",  "description": "Initial child blocks" }
                },
                "required": ["parent", "properties"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.pages.create"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        let parent = match args.get("parent") {
            Some(v) if v.is_object() => v.clone(),
            _ => return Ok(ToolResult::error("missing or non-object 'parent'")),
        };
        let properties = match args.get("properties") {
            Some(v) if v.is_object() => v.clone(),
            _ => return Ok(ToolResult::error("missing or non-object 'properties'")),
        };
        let mut body = json!({
            "parent":     parent,
            "properties": properties,
        });
        if let Some(arr) = args.get("children").and_then(|v| v.as_array())
            && !arr.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("children".into(), Value::Array(arr.clone()));
        }
        let url = format!("{}/v1/pages", client.base().trim_end_matches('/'));
        let resp: Value = match client.post_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let id = resp.get("id").cloned().unwrap_or(Value::Null);
        let url_out = resp.get("url").cloned().unwrap_or(Value::Null);
        Ok(
            ToolResult::success(format!("created page id={id}")).with_data(json!({
                "id":  id,
                "url": url_out,
            })),
        )
    }
}

// ------------------------------------------------------------------------
// notion.pages.update
// ------------------------------------------------------------------------

pub struct PagesUpdateTool;

#[async_trait]
impl Tool for PagesUpdateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.pages.update requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.pages.update".into(),
            description: "Update a Notion page's properties (and optionally `archived`). `properties` is Notion's heterogeneous property-map — only the keys you pass are updated. To restore an archived page set `archived=false`.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "page_id":    { "type": "string" },
                    "properties": { "type": "object", "description": "Notion properties to update" },
                    "archived":   { "type": "boolean" }
                },
                "required": ["page_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.pages.update"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        let page_id = match require_str(&args, "page_id") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let mut body = json!({});
        if let Some(p) = args.get("properties")
            && p.is_object()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("properties".into(), p.clone());
        }
        if let Some(a) = args.get("archived").and_then(|v| v.as_bool())
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("archived".into(), Value::Bool(a));
        }
        if body.as_object().map(|o| o.is_empty()).unwrap_or(true) {
            return Ok(ToolResult::error(
                "no fields to update — pass 'properties' and/or 'archived'",
            ));
        }
        let url = format!(
            "{}/v1/pages/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(page_id),
        );
        let resp: Value = match client.patch_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let data = json!({
            "id": resp.get("id").cloned().unwrap_or(Value::Null),
            "archived": resp.get("archived").cloned().unwrap_or(Value::Null),
            "last_edited_time": resp.get("last_edited_time").cloned().unwrap_or(Value::Null),
        });
        Ok(ToolResult::success(format!("updated page {page_id}")).with_data(data))
    }
}

// ------------------------------------------------------------------------
// notion.pages.append_blocks
// ------------------------------------------------------------------------

pub struct PagesAppendBlocksTool;

#[async_trait]
impl Tool for PagesAppendBlocksTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.pages.append_blocks requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.pages.append_blocks".into(),
            description: "Append child blocks to a Notion page (or any block id — Notion treats pages as block containers). `children` is an array of block objects (e.g. paragraph / heading_1 / bulleted_list_item / ... — each is a Notion block shape). Notion caps each call at 100 children; oversized arrays are chunked transparently into sequential calls and the response surfaces `chunks` so callers can reason about partial failure.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "block_id": { "type": "string", "description": "Page id or block id to append into" },
                    "children": { "type": "array",  "description": "Array of Notion block objects" }
                },
                "required": ["block_id", "children"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.pages.append_blocks"
    }

    fn is_destructive(&self, _input: &Value) -> bool {
        true
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
    }

    async fn execute_with_credentials(
        &self,
        args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        let block_id = match require_str(&args, "block_id") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let children = match args.get("children").and_then(|v| v.as_array()) {
            Some(arr) if !arr.is_empty() => arr.clone(),
            _ => return Ok(ToolResult::error("missing or empty 'children'")),
        };
        let url = format!(
            "{}/v1/blocks/{}/children",
            client.base().trim_end_matches('/'),
            urlencoding::encode(block_id),
        );
        let mut chunks_issued = 0usize;
        let mut appended_total = 0usize;
        for chunk in children.chunks(APPEND_BLOCK_CHUNK) {
            let body = append_blocks_body(chunk);
            let resp: Value = match client.patch_json(&url, body).await {
                Ok(v) => v,
                Err(e) => {
                    // Surface partial-progress context so the caller
                    // knows which chunks landed before the failure.
                    let mut data = match into_tool_error(e).data {
                        Value::Object(map) => Value::Object(map),
                        _ => json!({}),
                    };
                    if let Some(obj) = data.as_object_mut() {
                        obj.insert("chunks_issued".into(), json!(chunks_issued));
                        obj.insert("appended_so_far".into(), json!(appended_total));
                    }
                    return Ok(ToolResult::error(format!(
                        "append_blocks failed mid-chunk: {data}"
                    ))
                    .with_data(data));
                }
            };
            chunks_issued += 1;
            if let Some(arr) = resp.get("results").and_then(|v| v.as_array()) {
                appended_total += arr.len();
            } else {
                appended_total += chunk.len();
            }
        }
        Ok(ToolResult::success(format!(
            "appended {appended_total} blocks across {chunks_issued} chunk(s)"
        ))
        .with_data(json!({
            "block_id": block_id,
            "chunks":   chunks_issued,
            "appended": appended_total,
        })))
    }
}

// ------------------------------------------------------------------------
// Title extraction helper.
// ------------------------------------------------------------------------

/// Pull a human-readable title out of a Notion page or database. Pages
/// nest the title under `properties.<title-prop>.title[].plain_text`;
/// databases use a top-level `title[].plain_text`. We try database-shape
/// first, then walk page properties looking for a `title`-typed entry.
fn extract_title(item: &Value) -> Value {
    if let Some(arr) = item.get("title").and_then(|v| v.as_array()) {
        return Value::String(plain_text_concat(arr));
    }
    if let Some(props) = item.get("properties").and_then(|v| v.as_object()) {
        for v in props.values() {
            if v.get("type").and_then(|t| t.as_str()) == Some("title")
                && let Some(arr) = v.get("title").and_then(|t| t.as_array())
            {
                return Value::String(plain_text_concat(arr));
            }
        }
    }
    Value::Null
}

fn plain_text_concat(arr: &[Value]) -> String {
    arr.iter()
        .filter_map(|t| t.get("plain_text").and_then(|v| v.as_str()))
        .collect::<Vec<_>>()
        .join("")
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(PagesSearchTool),
        std::sync::Arc::new(PagesGetTool),
        std::sync::Arc::new(PagesCreateTool),
        std::sync::Arc::new(PagesUpdateTool),
        std::sync::Arc::new(PagesAppendBlocksTool),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_title_from_database_shape() {
        let v = json!({
            "object": "database",
            "title": [{ "plain_text": "Hello" }, { "plain_text": " World" }]
        });
        assert_eq!(extract_title(&v), json!("Hello World"));
    }

    #[test]
    fn extract_title_from_page_shape() {
        let v = json!({
            "object": "page",
            "properties": {
                "Name": {
                    "type": "title",
                    "title": [{ "plain_text": "My Page" }]
                },
                "Tags": { "type": "multi_select", "multi_select": [] }
            }
        });
        assert_eq!(extract_title(&v), json!("My Page"));
    }

    #[test]
    fn extract_title_returns_null_when_absent() {
        let v = json!({ "object": "page" });
        assert_eq!(extract_title(&v), Value::Null);
    }
}
