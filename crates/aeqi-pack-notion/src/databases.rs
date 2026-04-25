//! Notion Databases tools — query / get_schema / create_row.
//!
//! Per-workspace scoping (`ScopeHint::User`).
//!
//! | Tool                          | Capability                       |
//! | ----------------------------- | -------------------------------- |
//! | `notion.databases.query`      | Filtered + sorted database query |
//! | `notion.databases.get_schema` | Database properties (schema)     |
//! | `notion.databases.create_row` | New database entry               |
//!
//! ## Property pass-through
//!
//! Notion's database row properties are heterogeneous (title vs rich_text vs
//! relation vs select vs multi_select vs date vs ...). The query tool
//! returns each row's `properties` as `serde_json::Value` verbatim — the
//! agent introspects shape directly rather than against a normalized Rust
//! struct. The schema tool returns the same heterogeneous `properties` map
//! at the database level so callers can read the column types.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{NotionApiClient, NotionApiError};

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
// notion.databases.query
// ------------------------------------------------------------------------

pub struct DatabasesQueryTool;

#[async_trait]
impl Tool for DatabasesQueryTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.databases.query requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.databases.query".into(),
            description: "Query a Notion database. Optional `filter` is Notion's filter shape (e.g. `{property: \"Status\", select: {equals: \"Done\"}}`); optional `sorts` is Notion's sort array. Each returned row's `properties` is passed through verbatim — the heterogeneous Notion property shape is preserved so the agent can introspect each column. Pagination caps at 200 rows.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database_id": { "type": "string" },
                    "filter":      { "type": "object", "description": "Notion filter shape" },
                    "sorts":       { "type": "array",  "description": "Notion sorts shape" }
                },
                "required": ["database_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.databases.query"
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
        let database_id = match require_str(&args, "database_id") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let mut body = json!({});
        if let Some(f) = args.get("filter")
            && f.is_object()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("filter".into(), f.clone());
        }
        if let Some(s) = args.get("sorts")
            && s.is_array()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("sorts".into(), s.clone());
        }
        let url = format!(
            "{}/v1/databases/{}/query",
            client.base().trim_end_matches('/'),
            urlencoding::encode(database_id),
        );
        let (items, truncated) = match client.paginate_post(url, body).await {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let rows: Vec<Value> = items
            .into_iter()
            .map(|r| {
                json!({
                    "id":         r.get("id").cloned().unwrap_or(Value::Null),
                    "url":        r.get("url").cloned().unwrap_or(Value::Null),
                    // Heterogeneous property map — pass through unchanged so
                    // the agent can read whatever Notion returns.
                    "properties": r.get("properties").cloned().unwrap_or(Value::Null),
                    "last_edited_time": r.get("last_edited_time").cloned().unwrap_or(Value::Null),
                    "archived":   r.get("archived").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&rows).unwrap_or_default())
                .with_data(json!({ "rows": rows, "truncated": truncated, "count": rows.len() })),
        )
    }
}

// ------------------------------------------------------------------------
// notion.databases.get_schema
// ------------------------------------------------------------------------

pub struct DatabasesGetSchemaTool;

#[async_trait]
impl Tool for DatabasesGetSchemaTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.databases.get_schema requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.databases.get_schema".into(),
            description: "Read a Notion database's schema. Returns the heterogeneous `properties` map (column name → property-type config) verbatim — callers introspect to learn whether a column is select, multi_select, relation, date, formula, etc. Plus the database title and url.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database_id": { "type": "string" }
                },
                "required": ["database_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.databases.get_schema"
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
        let database_id = match require_str(&args, "database_id") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let url = format!(
            "{}/v1/databases/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(database_id),
        );
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let title = resp
            .get("title")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t.get("plain_text").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        let data = json!({
            "id":         resp.get("id").cloned().unwrap_or(Value::Null),
            "title":      Value::String(title),
            "url":        resp.get("url").cloned().unwrap_or(Value::Null),
            "properties": resp.get("properties").cloned().unwrap_or(Value::Null),
            "parent":     resp.get("parent").cloned().unwrap_or(Value::Null),
        });
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

// ------------------------------------------------------------------------
// notion.databases.create_row
// ------------------------------------------------------------------------

pub struct DatabasesCreateRowTool;

#[async_trait]
impl Tool for DatabasesCreateRowTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.databases.create_row requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.databases.create_row".into(),
            description: "Create a new row in a Notion database. `properties` must match the database schema (e.g. `{\"Name\": {title: [{text: {content: \"Hello\"}}]}}`). Optional `children` is an array of block objects to attach as the row's page content.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "database_id": { "type": "string" },
                    "properties":  { "type": "object", "description": "Notion properties shape matching the database schema" },
                    "children":    { "type": "array",  "description": "Initial child blocks for the row's page" }
                },
                "required": ["database_id", "properties"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.databases.create_row"
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
        let database_id = match require_str(&args, "database_id") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let properties = match args.get("properties") {
            Some(v) if v.is_object() => v.clone(),
            _ => return Ok(ToolResult::error("missing or non-object 'properties'")),
        };
        let mut body = json!({
            "parent":     { "database_id": database_id },
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
            ToolResult::success(format!("created row id={id}")).with_data(json!({
                "id":  id,
                "url": url_out,
                "database_id": database_id,
            })),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(DatabasesQueryTool),
        std::sync::Arc::new(DatabasesGetSchemaTool),
        std::sync::Arc::new(DatabasesCreateRowTool),
    ]
}
