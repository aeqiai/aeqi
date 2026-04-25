//! Slack message tools — post / update / delete / history.
//!
//! Per-workspace scoping (`ScopeHint::User`, scope_id = workspace_id).
//!
//! | Tool                    | OAuth scope                         |
//! | ----------------------- | ----------------------------------- |
//! | `slack.messages.post`   | `chat:write`                        |
//! | `slack.messages.update` | `chat:write`                        |
//! | `slack.messages.delete` | `chat:write`                        |
//! | `slack.messages.history`| `channels:history` (+ `groups:read` for private) |
//!
//! `slack.messages.post` accepts an optional `blocks` JSON array — when
//! supplied, the call is dispatched as `application/json` so Slack's
//! Block Kit payload survives. Plain text + thread_ts use the simpler
//! form-encoded path.

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
// slack.messages.post
// ------------------------------------------------------------------------

pub struct MessagesPostTool;

#[async_trait]
impl Tool for MessagesPostTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.messages.post requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.messages.post".into(),
            description: "Post a message to a channel or DM. `channel` accepts a channel id or `@user` direct-message handle. Pass `text` (always required as a fallback for notifications) and optionally `blocks` (Block Kit array) and `thread_ts` to reply in-thread.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "channel":   { "type": "string" },
                    "text":      { "type": "string" },
                    "blocks":    { "type": "array",  "description": "Block Kit blocks. When set, posted as JSON." },
                    "thread_ts": { "type": "string", "description": "Reply in this thread (parent message ts)" }
                },
                "required": ["channel", "text"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.messages.post"
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
        let text = match require_str(&args, "text") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let blocks = args.get("blocks").cloned().filter(|v| v.is_array());
        let thread_ts = args.get("thread_ts").and_then(|v| v.as_str());

        let envelope_result: Result<Value, SlackApiError> = if let Some(b) = blocks {
            let mut body = json!({
                "channel": channel,
                "text":    text,
                "blocks":  b,
            });
            if let Some(t) = thread_ts
                && !t.is_empty()
                && let Some(obj) = body.as_object_mut()
            {
                obj.insert("thread_ts".into(), Value::String(t.into()));
            }
            client.post_json("chat.postMessage", body).await
        } else {
            let mut form: Vec<(&str, &str)> = vec![("channel", channel), ("text", text)];
            if let Some(t) = thread_ts
                && !t.is_empty()
            {
                form.push(("thread_ts", t));
            }
            client.post_form("chat.postMessage", &form).await
        };
        let envelope = match envelope_result {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let ts = envelope.get("ts").cloned().unwrap_or(Value::Null);
        let resolved_channel = envelope.get("channel").cloned().unwrap_or(Value::Null);
        Ok(
            ToolResult::success(format!("posted ts={ts}")).with_data(json!({
                "ts":        ts,
                "channel":   resolved_channel,
            })),
        )
    }
}

// ------------------------------------------------------------------------
// slack.messages.update
// ------------------------------------------------------------------------

pub struct MessagesUpdateTool;

#[async_trait]
impl Tool for MessagesUpdateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.messages.update requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.messages.update".into(),
            description: "Edit a previously posted message. `ts` is the original message timestamp Slack returned. Pass new `text` and/or `blocks`.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "channel": { "type": "string" },
                    "ts":      { "type": "string" },
                    "text":    { "type": "string" },
                    "blocks":  { "type": "array" }
                },
                "required": ["channel", "ts"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.messages.update"
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
        let ts = match require_str(&args, "ts") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let text = args.get("text").and_then(|v| v.as_str());
        let blocks = args.get("blocks").cloned().filter(|v| v.is_array());
        if text.is_none() && blocks.is_none() {
            return Ok(ToolResult::error(
                "slack.messages.update requires at least one of 'text' or 'blocks'",
            ));
        }
        let envelope_result = if let Some(b) = blocks {
            let mut body = json!({
                "channel": channel,
                "ts":      ts,
                "blocks":  b,
            });
            if let Some(t) = text
                && let Some(obj) = body.as_object_mut()
            {
                obj.insert("text".into(), Value::String(t.into()));
            }
            client.post_json("chat.update", body).await
        } else {
            // text guaranteed Some by the early return above.
            let t = text.unwrap();
            let form: Vec<(&str, &str)> = vec![("channel", channel), ("ts", ts), ("text", t)];
            client.post_form("chat.update", &form).await
        };
        let envelope: Value = match envelope_result {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let new_ts = envelope.get("ts").cloned().unwrap_or(Value::Null);
        Ok(
            ToolResult::success(format!("updated ts={new_ts}")).with_data(json!({
                "ts":      new_ts,
                "channel": envelope.get("channel").cloned().unwrap_or(Value::Null),
            })),
        )
    }
}

// ------------------------------------------------------------------------
// slack.messages.delete
// ------------------------------------------------------------------------

pub struct MessagesDeleteTool;

#[async_trait]
impl Tool for MessagesDeleteTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.messages.delete requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.messages.delete".into(),
            description: "Delete a message by `(channel, ts)`. The token's user must have permission to delete the message — bots can only delete their own posts unless granted `chat:write.customize`.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "channel": { "type": "string" },
                    "ts":      { "type": "string" }
                },
                "required": ["channel", "ts"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.messages.delete"
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
        let ts = match require_str(&args, "ts") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let form: Vec<(&str, &str)> = vec![("channel", channel), ("ts", ts)];
        match client.post_form::<Value>("chat.delete", &form).await {
            Ok(envelope) => Ok(
                ToolResult::success(format!("deleted ts={ts} channel={channel}")).with_data(
                    json!({
                        "channel": envelope.get("channel").cloned().unwrap_or(Value::Null),
                        "ts":      envelope.get("ts").cloned().unwrap_or(Value::Null),
                        "deleted": true,
                    }),
                ),
            ),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

// ------------------------------------------------------------------------
// slack.messages.history
// ------------------------------------------------------------------------

pub struct MessagesHistoryTool;

#[async_trait]
impl Tool for MessagesHistoryTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.messages.history requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.messages.history".into(),
            description: "Read recent messages from a channel. Returns messages newest-first: ts / user / text / thread_ts / reactions / type. Pagination caps at 200; sets `truncated=true` when more pages remain. Optional `oldest` / `latest` are message ts bounds.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "channel": { "type": "string" },
                    "oldest":  { "type": "string", "description": "Lower-bound ts (exclusive)" },
                    "latest":  { "type": "string", "description": "Upper-bound ts (exclusive)" }
                },
                "required": ["channel"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.messages.history"
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
        let oldest = args.get("oldest").and_then(|v| v.as_str()).unwrap_or("");
        let latest = args.get("latest").and_then(|v| v.as_str()).unwrap_or("");
        let mut params: Vec<(&str, &str)> = vec![("channel", channel), ("limit", "100")];
        if !oldest.is_empty() {
            params.push(("oldest", oldest));
        }
        if !latest.is_empty() {
            params.push(("latest", latest));
        }
        let (items, truncated) = match client
            .paginate_get("conversations.history", &params, "messages")
            .await
        {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let messages: Vec<Value> = items
            .into_iter()
            .map(|m| {
                json!({
                    "ts":        m.get("ts").cloned().unwrap_or(Value::Null),
                    "user":      m.get("user").cloned().unwrap_or(Value::Null),
                    "text":      m.get("text").cloned().unwrap_or(Value::Null),
                    "type":      m.get("type").cloned().unwrap_or(Value::Null),
                    "thread_ts": m.get("thread_ts").cloned().unwrap_or(Value::Null),
                    "reactions": m.get("reactions").cloned().unwrap_or(Value::Array(Vec::new())),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&messages).unwrap_or_default()).with_data(
                json!({
                    "messages":  messages,
                    "truncated": truncated,
                    "count":     messages.len(),
                }),
            ),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(MessagesPostTool),
        std::sync::Arc::new(MessagesUpdateTool),
        std::sync::Arc::new(MessagesDeleteTool),
        std::sync::Arc::new(MessagesHistoryTool),
    ]
}
