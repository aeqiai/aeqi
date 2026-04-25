//! Slack reaction tools — add / remove.
//!
//! Per-workspace scoping (`ScopeHint::User`, scope_id = workspace_id).
//!
//! | Tool                    | OAuth scope        |
//! | ----------------------- | ------------------ |
//! | `slack.reactions.add`   | `reactions:write`  |
//! | `slack.reactions.remove`| `reactions:write`  |

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

fn strip_colons(s: &str) -> &str {
    s.trim_matches(':')
}

// ------------------------------------------------------------------------
// slack.reactions.add
// ------------------------------------------------------------------------

pub struct ReactionsAddTool;

#[async_trait]
impl Tool for ReactionsAddTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.reactions.add requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.reactions.add".into(),
            description: "Add an emoji reaction to a message. `name` is the emoji shortcode without colons (e.g. 'thumbsup'); leading/trailing colons are tolerated and stripped.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "channel": { "type": "string" },
                    "ts":      { "type": "string" },
                    "name":    { "type": "string", "description": "Emoji shortcode (e.g. 'thumbsup')" }
                },
                "required": ["channel", "ts", "name"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.reactions.add"
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
        let name_raw = match require_str(&args, "name") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let name = strip_colons(name_raw);
        let form: Vec<(&str, &str)> =
            vec![("channel", channel), ("timestamp", ts), ("name", name)];
        match client.post_form::<Value>("reactions.add", &form).await {
            Ok(_) => Ok(
                ToolResult::success(format!("added :{name}: to ts={ts}")).with_data(json!({
                    "channel": channel,
                    "ts":      ts,
                    "name":    name,
                    "added":   true,
                })),
            ),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

// ------------------------------------------------------------------------
// slack.reactions.remove
// ------------------------------------------------------------------------

pub struct ReactionsRemoveTool;

#[async_trait]
impl Tool for ReactionsRemoveTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.reactions.remove requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.reactions.remove".into(),
            description: "Remove an emoji reaction from a message. `name` is the emoji shortcode without colons.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "channel": { "type": "string" },
                    "ts":      { "type": "string" },
                    "name":    { "type": "string" }
                },
                "required": ["channel", "ts", "name"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.reactions.remove"
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
        let name_raw = match require_str(&args, "name") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let name = strip_colons(name_raw);
        let form: Vec<(&str, &str)> =
            vec![("channel", channel), ("timestamp", ts), ("name", name)];
        match client.post_form::<Value>("reactions.remove", &form).await {
            Ok(_) => Ok(
                ToolResult::success(format!("removed :{name}: from ts={ts}")).with_data(json!({
                    "channel": channel,
                    "ts":      ts,
                    "name":    name,
                    "removed": true,
                })),
            ),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(ReactionsAddTool),
        std::sync::Arc::new(ReactionsRemoveTool),
    ]
}
