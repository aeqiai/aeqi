//! Slack search tools — `search.messages`.
//!
//! Per-workspace scoping (`ScopeHint::User`, scope_id = workspace_id).
//!
//! | Tool                    | OAuth scope    |
//! | ----------------------- | -------------- |
//! | `slack.search.messages` | `search:read`  |
//!
//! Slack's search endpoint is a paid-plan feature — workspaces on a
//! free plan get `{ok: false, error: "paid_only"}` (or `not_authed`
//! / `missing_scope` depending on bootstrap). The api client surfaces
//! these as a clean `slack_error` with the upstream string preserved
//! in `data.slack_error` so the agent can react meaningfully.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{SlackApiClient, SlackApiError};

const PROVIDER: &str = "slack";
const NAME: &str = "bot_token";
const DEFAULT_MAX: usize = 30;
const HARD_CAP: usize = 100;

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

fn clamp_max(args: &Value) -> usize {
    args.get("max_results")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_MAX)
        .clamp(1, HARD_CAP)
}

// ------------------------------------------------------------------------
// slack.search.messages
// ------------------------------------------------------------------------

pub struct SearchMessagesTool;

#[async_trait]
impl Tool for SearchMessagesTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.search.messages requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.search.messages".into(),
            description: "Search messages across the workspace using Slack's search syntax (e.g. 'in:#general from:@alice has:link'). Slack's search is a paid-plan feature; free workspaces return a clean error with `slack_error` set. `max_results` clamps to 100.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query":       { "type": "string" },
                    "max_results": { "type": "integer", "description": "Default 30, hard cap 100" }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.search.messages"
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
        let query = match require_str(&args, "query") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let max = clamp_max(&args);
        let max_s = max.to_string();
        let params: Vec<(&str, &str)> =
            vec![("query", query), ("count", max_s.as_str()), ("page", "1")];
        let envelope: Value = match client.get("search.messages", &params).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let total = envelope
            .get("messages")
            .and_then(|m| m.get("total"))
            .cloned()
            .unwrap_or(Value::Null);
        let matches: Vec<Value> = envelope
            .get("messages")
            .and_then(|m| m.get("matches"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|m| {
                        json!({
                            "ts":         m.get("ts").cloned().unwrap_or(Value::Null),
                            "user":       m.get("user").cloned().unwrap_or(Value::Null),
                            "username":   m.get("username").cloned().unwrap_or(Value::Null),
                            "text":       m.get("text").cloned().unwrap_or(Value::Null),
                            "channel":    m.get("channel").and_then(|c| c.get("id")).cloned().unwrap_or(Value::Null),
                            "channel_name": m.get("channel").and_then(|c| c.get("name")).cloned().unwrap_or(Value::Null),
                            "permalink":  m.get("permalink").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(
            ToolResult::success(serde_json::to_string(&matches).unwrap_or_default()).with_data(
                json!({
                    "matches":     matches,
                    "total_count": total,
                    "count":       matches.len(),
                }),
            ),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![std::sync::Arc::new(SearchMessagesTool)]
}
