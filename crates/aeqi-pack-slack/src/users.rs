//! Slack user tools — list / info / lookup_by_email.
//!
//! Per-workspace scoping (`ScopeHint::User`, scope_id = workspace_id).
//!
//! | Tool                          | OAuth scope                       |
//! | ----------------------------- | --------------------------------- |
//! | `slack.users.list`            | `users:read`                      |
//! | `slack.users.info`            | `users:read`                      |
//! | `slack.users.lookup_by_email` | `users:read` + `users:read.email` |

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

fn project_user(u: &Value) -> Value {
    let profile = u.get("profile").cloned().unwrap_or(Value::Null);
    json!({
        "id":           u.get("id").cloned().unwrap_or(Value::Null),
        "name":         u.get("name").cloned().unwrap_or(Value::Null),
        "real_name":    u.get("real_name").cloned().unwrap_or(Value::Null),
        "is_bot":       u.get("is_bot").cloned().unwrap_or(Value::Null),
        "is_admin":     u.get("is_admin").cloned().unwrap_or(Value::Null),
        "deleted":      u.get("deleted").cloned().unwrap_or(Value::Null),
        "tz":           u.get("tz").cloned().unwrap_or(Value::Null),
        "email":        profile.get("email").cloned().unwrap_or(Value::Null),
        "display_name": profile.get("display_name").cloned().unwrap_or(Value::Null),
        "title":        profile.get("title").cloned().unwrap_or(Value::Null),
    })
}

// ------------------------------------------------------------------------
// slack.users.list
// ------------------------------------------------------------------------

pub struct UsersListTool;

#[async_trait]
impl Tool for UsersListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.users.list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.users.list".into(),
            description: "List members of the workspace. Optional `include_deleted` (default false). Pagination caps at 200 results; sets `truncated=true` when more pages remain.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "include_deleted": { "type": "boolean" }
                }
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.users.list"
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
        let include_deleted = args
            .get("include_deleted")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let params: Vec<(&str, &str)> = vec![("limit", "100")];
        let (items, truncated) = match client.paginate_get("users.list", &params, "members").await
        {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let users: Vec<Value> = items
            .into_iter()
            .filter(|u| {
                include_deleted
                    || !u
                        .get("deleted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
            })
            .map(|u| project_user(&u))
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&users).unwrap_or_default()).with_data(
                json!({
                    "users":     users,
                    "truncated": truncated,
                    "count":     users.len(),
                }),
            ),
        )
    }
}

// ------------------------------------------------------------------------
// slack.users.info
// ------------------------------------------------------------------------

pub struct UsersInfoTool;

#[async_trait]
impl Tool for UsersInfoTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.users.info requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.users.info".into(),
            description: "Read a single user's metadata by id. Returns id / name / real_name / is_bot / is_admin / tz / email / display_name / title.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "user": { "type": "string", "description": "Slack user id (e.g. U01234567)" } },
                "required": ["user"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.users.info"
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
        let user = match require_str(&args, "user") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let envelope: Value = match client.get("users.info", &[("user", user)]).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let u = envelope.get("user").cloned().unwrap_or(Value::Null);
        let data = project_user(&u);
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

// ------------------------------------------------------------------------
// slack.users.lookup_by_email
// ------------------------------------------------------------------------

pub struct UsersLookupByEmailTool;

#[async_trait]
impl Tool for UsersLookupByEmailTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "slack.users.lookup_by_email requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "slack.users.lookup_by_email".into(),
            description: "Find a user by email. Requires `users:read.email`. Returns the same projection as users.info.".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "email": { "type": "string" } },
                "required": ["email"]
            }),
        }
    }

    fn name(&self) -> &str {
        "slack.users.lookup_by_email"
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
        let email = match require_str(&args, "email") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let envelope: Value = match client
            .get("users.lookupByEmail", &[("email", email)])
            .await
        {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let u = envelope.get("user").cloned().unwrap_or(Value::Null);
        let data = project_user(&u);
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(UsersListTool),
        std::sync::Arc::new(UsersInfoTool),
        std::sync::Arc::new(UsersLookupByEmailTool),
    ]
}
