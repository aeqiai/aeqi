//! Notion Users tool — list.
//!
//! Per-workspace scoping (`ScopeHint::User`).
//!
//! | Tool                | Capability                              |
//! | ------------------- | --------------------------------------- |
//! | `notion.users.list` | List workspace members + integration bots |
//!
//! `notion.users.list` returns the workspace's user roster — humans
//! (`type=person`) and integration bots (`type=bot`). Pagination follows
//! Notion's `next_cursor` / `has_more` envelope; the pack walks the chain
//! up to the shared 200-result cap.

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

// ------------------------------------------------------------------------
// notion.users.list
// ------------------------------------------------------------------------

pub struct UsersListTool;

#[async_trait]
impl Tool for UsersListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "notion.users.list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "notion.users.list".into(),
            description: "List the Notion workspace's members + integration bots. Returns each user's id / name / type (person|bot) / avatar_url. Pagination caps at 200 — `truncated=true` when more existed.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {}
            }),
        }
    }

    fn name(&self) -> &str {
        "notion.users.list"
    }

    fn required_credentials(&self) -> Vec<CredentialNeed> {
        vec![need()]
    }

    async fn execute_with_credentials(
        &self,
        _args: Value,
        credentials: Vec<Option<UsableCredential>>,
    ) -> Result<ToolResult> {
        let cred = match first_cred(credentials) {
            Some(c) => c,
            None => return Ok(missing_credential()),
        };
        let client = build_client(&cred);
        let url = format!(
            "{}/v1/users?page_size=100",
            client.base().trim_end_matches('/'),
        );
        let (items, truncated) = match client.paginate_get(url).await {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let users: Vec<Value> = items
            .into_iter()
            .map(|u| {
                json!({
                    "id":         u.get("id").cloned().unwrap_or(Value::Null),
                    "name":       u.get("name").cloned().unwrap_or(Value::Null),
                    "type":       u.get("type").cloned().unwrap_or(Value::Null),
                    "avatar_url": u.get("avatar_url").cloned().unwrap_or(Value::Null),
                    "person":     u.get("person").cloned().unwrap_or(Value::Null),
                    "bot":        u.get("bot").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&users).unwrap_or_default())
                .with_data(json!({ "users": users, "truncated": truncated, "count": users.len() })),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![std::sync::Arc::new(UsersListTool)]
}
