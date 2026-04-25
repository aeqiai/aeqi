//! Slack channel tools — list / info / create / archive.
//!
//! Per-workspace scoping (`ScopeHint::User`, scope_id = workspace_id).
//!
//! | Tool                     | OAuth scope            |
//! | ------------------------ | ---------------------- |
//! | `slack.channels.list`    | `channels:read`        |
//! | `slack.channels.info`    | `channels:read`        |
//! | `slack.channels.create`  | `channels:manage`      |
//! | `slack.channels.archive` | `channels:manage`      |
//!
//! Slack's channel API is unified under `conversations.*`. Each tool
//! declares the narrowest scope it requires; the bootstrap consent flow
//! requests the union for the tools the agent enables. Archive +
//! create both target the destructive `channels:manage` scope (Slack
//! does not split archive from create at the scope level).

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{SlackApiClient, SlackApiError};

const PROVIDER: &str = "slack";
const NAME: &str = "bot_token";

fn need() -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::User)
}

fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error(
        "missing_credential: provider=slack name=bot_token (no workspace-scoped Slack \
         credential found — install the Slack app for the target workspace and run the \
         OAuth bootstrap flow first)",
    )
    .with_data(json!({"reason_code": "missing_credential"}))
}

fn build_client(cred: &UsableCredential) -> SlackApiClient<'_> {
    let base_override = cred
        .metadata
        .get("aeqi_test_base")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut c = SlackApiClient::new(cred);
    if let Some(b) = base_override {
        c = c.with_base(b);
    }
    c
}

fn into_tool_error(err: SlackApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    match &err {
        SlackApiError::AuthExpired { credential_id } => {
            data["credential_id"] = json!(credential_id);
        }
        SlackApiError::RateLimited {
            retry_after: Some(s),
        } => {
            data["retry_after"] = json!(s);
        }
        SlackApiError::SlackErr { error } => {
            data["slack_error"] = json!(error);
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
// slack.channels.list
// ------------------------------------------------------------------------

pub struct ChannelsListTool;

#[async_trait]
impl Tool for ChannelsListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.channels.list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.channels.list".into(),
            description: "List channels in the workspace. Optional `types` (default `public_channel`; comma-separated subset of public_channel,private_channel,mpim,im) and `exclude_archived` (default true). Pagination caps at 200; sets `truncated=true` when more pages remain.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "types":            { "type": "string", "description": "Comma-separated channel types (public_channel | private_channel | mpim | im)" },
                    "exclude_archived": { "type": "boolean" }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.channels.list"
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
        let types = args
            .get("types")
            .and_then(|v| v.as_str())
            .unwrap_or("public_channel")
            .to_string();
        let exclude_archived = args
            .get("exclude_archived")
            .and_then(|v| v.as_bool())
            .unwrap_or(true);
        let exclude_archived_s = if exclude_archived { "true" } else { "false" };
        let params: Vec<(&str, &str)> = vec![
            ("types", types.as_str()),
            ("exclude_archived", exclude_archived_s),
            ("limit", "100"),
        ];
        let (items, truncated) = match client
            .paginate_get("conversations.list", &params, "channels")
            .await
        {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let channels: Vec<Value> = items
            .into_iter()
            .map(|c| {
                json!({
                    "id":          c.get("id").cloned().unwrap_or(Value::Null),
                    "name":        c.get("name").cloned().unwrap_or(Value::Null),
                    "is_private":  c.get("is_private").cloned().unwrap_or(Value::Null),
                    "is_archived": c.get("is_archived").cloned().unwrap_or(Value::Null),
                    "is_member":   c.get("is_member").cloned().unwrap_or(Value::Null),
                    "num_members": c.get("num_members").cloned().unwrap_or(Value::Null),
                    "topic":       c.get("topic").and_then(|t| t.get("value")).cloned().unwrap_or(Value::Null),
                    "purpose":     c.get("purpose").and_then(|p| p.get("value")).cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&channels).unwrap_or_default()).with_data(
                json!({
                    "channels":  channels,
                    "truncated": truncated,
                    "count":     channels.len()
                }),
            ),
        )
    }
}

// ------------------------------------------------------------------------
// slack.channels.info
// ------------------------------------------------------------------------

pub struct ChannelsInfoTool;

#[async_trait]
impl Tool for ChannelsInfoTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.channels.info requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.channels.info".into(),
            description: "Read a single channel's metadata by id. Returns id / name / is_private / is_archived / topic / purpose / num_members / created.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "channel": { "type": "string", "description": "Channel id (e.g. C01234567)" } },
                "required": ["channel"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.channels.info"
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
        let channel = match require_str(&args, "channel") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let envelope: Value = match client
            .get("conversations.info", &[("channel", channel)])
            .await
        {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let ch = envelope.get("channel").cloned().unwrap_or(Value::Null);
        let data = json!({
            "id":          ch.get("id").cloned().unwrap_or(Value::Null),
            "name":        ch.get("name").cloned().unwrap_or(Value::Null),
            "is_private":  ch.get("is_private").cloned().unwrap_or(Value::Null),
            "is_archived": ch.get("is_archived").cloned().unwrap_or(Value::Null),
            "is_member":   ch.get("is_member").cloned().unwrap_or(Value::Null),
            "num_members": ch.get("num_members").cloned().unwrap_or(Value::Null),
            "topic":       ch.get("topic").and_then(|t| t.get("value")).cloned().unwrap_or(Value::Null),
            "purpose":     ch.get("purpose").and_then(|p| p.get("value")).cloned().unwrap_or(Value::Null),
            "created":     ch.get("created").cloned().unwrap_or(Value::Null),
        });
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

// ------------------------------------------------------------------------
// slack.channels.create
// ------------------------------------------------------------------------

pub struct ChannelsCreateTool;

#[async_trait]
impl Tool for ChannelsCreateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.channels.create requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.channels.create".into(),
            description: "Create a new channel. Slack lowercases names + replaces spaces with hyphens. Optional `is_private` (default false) creates a private channel.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "name":       { "type": "string", "description": "Channel name (Slack normalises to lowercase)" },
                    "is_private": { "type": "boolean" }
                },
                "required": ["name"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.channels.create"
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
        let name = match require_str(&args, "name") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let is_private = args
            .get("is_private")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let is_private_s = if is_private { "true" } else { "false" };
        let form: Vec<(&str, &str)> = vec![("name", name), ("is_private", is_private_s)];
        let envelope: Value = match client.post_form("conversations.create", &form).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let ch = envelope.get("channel").cloned().unwrap_or(Value::Null);
        let data = json!({
            "id":         ch.get("id").cloned().unwrap_or(Value::Null),
            "name":       ch.get("name").cloned().unwrap_or(Value::Null),
            "is_private": ch.get("is_private").cloned().unwrap_or(Value::Null),
        });
        Ok(ToolResult::success(format!(
            "created channel id={} name={}",
            data["id"], data["name"]
        ))
        .with_data(data))
    }
}

// ------------------------------------------------------------------------
// slack.channels.archive
// ------------------------------------------------------------------------

pub struct ChannelsArchiveTool;

#[async_trait]
impl Tool for ChannelsArchiveTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.channels.archive requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.channels.archive".into(),
            description: "Archive a channel by id. Slack rejects archiving #general; surface the upstream error verbatim if so.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "channel": { "type": "string" } },
                "required": ["channel"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.channels.archive"
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
        let channel = match require_str(&args, "channel") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let form: Vec<(&str, &str)> = vec![("channel", channel)];
        match client
            .post_form::<Value>("conversations.archive", &form)
            .await
        {
            Ok(_) => Ok(
                ToolResult::success(format!("archived channel={channel}")).with_data(json!({
                    "channel":  channel,
                    "archived": true
                })),
            ),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(ChannelsListTool),
        std::sync::Arc::new(ChannelsInfoTool),
        std::sync::Arc::new(ChannelsCreateTool),
        std::sync::Arc::new(ChannelsArchiveTool),
    ]
}
