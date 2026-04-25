//! Notion Blocks tools — get / update / delete.
//!
//! Per-workspace scoping (`ScopeHint::User`).
//!
//! | Tool                    | Capability                                  |
//! | ----------------------- | ------------------------------------------- |
//! | `notion.blocks.get`     | Read a block + its children (truncated)     |
//! | `notion.blocks.update`  | Edit block content (heterogeneous shape)    |
//! | `notion.blocks.delete`  | Archive (soft-delete) a block               |
//!
//! ## `get` semantics
//!
//! `notion.blocks.get` reads a single block by id and includes its
//! immediate children (cap 200). Page ids are also block ids in Notion's
//! model, so the same tool works for drilling into nested page content.
//! For top-level page metadata, prefer `notion.pages.get`.
//!
//! ## `update` shape
//!
//! Notion's update endpoint takes the block's type-specific patch under
//! the type key — e.g. `{ "paragraph": { "rich_text": [...] } }`. The
//! tool passes the caller-supplied `patch` object through verbatim so the
//! agent can target whichever block type it's editing.

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
// notion.blocks.get
// ------------------------------------------------------------------------

pub struct BlocksGetTool;

#[async_trait]
impl Tool for BlocksGetTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.blocks.get requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.blocks.get".into(),
            description: "Read a single Notion block plus its immediate children (cap 200, truncated=true when more existed). Block content is heterogeneous (paragraph / heading_1 / bulleted_list_item / image / ...) — the response passes the block object through verbatim so the caller can read the type-specific shape.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "block_id": { "type": "string" }
                },
                "required": ["block_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.blocks.get"
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
        let block_url = format!(
            "{}/v1/blocks/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(block_id),
        );
        let block: Value = match client.get(block_url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let has_children = block
            .get("has_children")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let (children, truncated) = if has_children {
            let children_url = format!(
                "{}/v1/blocks/{}/children?page_size=100",
                client.base().trim_end_matches('/'),
                urlencoding::encode(block_id),
            );
            match client.paginate_get(children_url).await {
                Ok(pair) => pair,
                Err(e) => return Ok(into_tool_error(e)),
            }
        } else {
            (Vec::new(), false)
        };
        let data = json!({
            "block":     block,
            "children":  children,
            "truncated": truncated,
        });
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

// ------------------------------------------------------------------------
// notion.blocks.update
// ------------------------------------------------------------------------

pub struct BlocksUpdateTool;

#[async_trait]
impl Tool for BlocksUpdateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.blocks.update requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.blocks.update".into(),
            description: "Update a Notion block. `patch` is Notion's heterogeneous block-update shape — the caller targets the block's type, e.g. `{paragraph: {rich_text: [{text: {content: \"new text\"}}]}}` for a paragraph block. Fields not in the patch are left unchanged. The patch is passed through to the API verbatim.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "block_id": { "type": "string" },
                    "patch":    { "type": "object", "description": "Notion block-update shape (type-specific)" }
                },
                "required": ["block_id", "patch"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.blocks.update"
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
        let patch = match args.get("patch") {
            Some(v) if v.is_object() => v.clone(),
            _ => return Ok(ToolResult::error("missing or non-object 'patch'")),
        };
        let url = format!(
            "{}/v1/blocks/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(block_id),
        );
        let resp: Value = match client.patch_json(url, patch).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let data = json!({
            "block": resp,
        });
        Ok(ToolResult::success(format!("updated block {block_id}")).with_data(data))
    }
}

// ------------------------------------------------------------------------
// notion.blocks.delete
// ------------------------------------------------------------------------

pub struct BlocksDeleteTool;

#[async_trait]
impl Tool for BlocksDeleteTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.blocks.delete requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.blocks.delete".into(),
            description: "Archive (soft-delete) a Notion block. Notion uses `DELETE /v1/blocks/{id}` to set `archived=true`; the block can be restored via the Notion UI's trash. Returns the archived block envelope.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "block_id": { "type": "string" }
                },
                "required": ["block_id"]
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.blocks.delete"
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
        let url = format!(
            "{}/v1/blocks/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(block_id),
        );
        let resp: Value = match client.delete(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let archived = resp.get("archived").cloned().unwrap_or(Value::Bool(true));
        Ok(
            ToolResult::success(format!("archived block {block_id}")).with_data(json!({
                "id":       resp.get("id").cloned().unwrap_or(Value::String(block_id.into())),
                "archived": archived,
            })),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(BlocksGetTool),
        std::sync::Arc::new(BlocksUpdateTool),
        std::sync::Arc::new(BlocksDeleteTool),
    ]
}
