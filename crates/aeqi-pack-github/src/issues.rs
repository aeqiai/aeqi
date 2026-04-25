//! GitHub Issues tools — list / get / create / comment / close.
//!
//! Per-installation scoping (`ScopeHint::Installation`) — different
//! GitHub App installations carry different repo permissions.
//!
//! | Tool                  | GitHub App permission     | OAuth scope |
//! | --------------------- | ------------------------- | ----------- |
//! | `github.issues.list`  | `Issues: Read`            | `repo`      |
//! | `github.issues.get`   | `Issues: Read`            | `repo`      |
//! | `github.issues.create`| `Issues: Read & write`    | `repo`      |
//! | `github.issues.comment`| `Issues: Read & write`   | `repo`      |
//! | `github.issues.close` | `Issues: Read & write`    | `repo`      |
//!
//! Tools always declare the narrowest permission they need; the
//! bootstrap consent flow concatenates the union.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{GithubApiClient, GithubApiError};

const PROVIDER: &str = "github";
const NAME: &str = "installation_token";

fn need() -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::Installation)
}

fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error(
        "missing_credential: provider=github name=installation_token (no installation-scoped \
         GitHub credential found — install the GitHub App or run the OAuth bootstrap flow first)",
    )
    .with_data(json!({"reason_code": "missing_credential"}))
}

fn build_client(cred: &UsableCredential) -> GithubApiClient<'_> {
    let base_override = cred
        .metadata
        .get("aeqi_test_base")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mut c = GithubApiClient::new(cred);
    if let Some(b) = base_override {
        c = c.with_base(b);
    }
    c
}

fn into_tool_error(err: GithubApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    match &err {
        GithubApiError::AuthExpired { credential_id } => {
            data["credential_id"] = json!(credential_id);
        }
        GithubApiError::RateLimited { reset_at: Some(rs) } => {
            data["reset_at"] = json!(rs);
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
// github.issues.list
// ------------------------------------------------------------------------

pub struct IssuesListTool;

#[async_trait]
impl Tool for IssuesListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.issues.list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.issues.list".into(),
            description: "List issues on a repository. Filters: state (open|closed|all), labels (comma-separated), since (ISO8601). Pagination caps at 200 results — the response sets `truncated=true` when GitHub had more pages available.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner":  { "type": "string" },
                    "repo":   { "type": "string" },
                    "state":  { "type": "string", "description": "open | closed | all (default open)" },
                    "labels": { "type": "string", "description": "Comma-separated label names" },
                    "since":  { "type": "string", "description": "Only issues updated at or after this ISO8601 timestamp" }
                },
                "required": ["owner", "repo"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.issues.list"
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
        let owner = match require_str(&args, "owner") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let repo = match require_str(&args, "repo") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("open");
        let mut url = format!(
            "{}/repos/{}/{}/issues?state={}&per_page=100",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            urlencoding::encode(state),
        );
        if let Some(labels) = args.get("labels").and_then(|v| v.as_str())
            && !labels.is_empty()
        {
            url.push_str(&format!("&labels={}", urlencoding::encode(labels)));
        }
        if let Some(since) = args.get("since").and_then(|v| v.as_str())
            && !since.is_empty()
        {
            url.push_str(&format!("&since={}", urlencoding::encode(since)));
        }
        let (items, truncated) = match client.paginate_get(url).await {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        // GitHub's `/issues` endpoint returns PRs too — strip them so
        // this is genuinely "issues only". The PR tools own that path.
        let issues: Vec<Value> = items
            .into_iter()
            .filter(|i| i.get("pull_request").is_none())
            .map(|i| {
                json!({
                    "number":    i.get("number").cloned().unwrap_or(Value::Null),
                    "title":     i.get("title").cloned().unwrap_or(Value::Null),
                    "state":     i.get("state").cloned().unwrap_or(Value::Null),
                    "user":      i.get("user").and_then(|u| u.get("login")).cloned().unwrap_or(Value::Null),
                    "labels":    i.get("labels").cloned().unwrap_or(Value::Array(Vec::new())),
                    "html_url":  i.get("html_url").cloned().unwrap_or(Value::Null),
                    "comments":  i.get("comments").cloned().unwrap_or(Value::Null),
                    "updated_at":i.get("updated_at").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&issues).unwrap_or_default()).with_data(
                json!({ "issues": issues, "truncated": truncated, "count": issues.len() }),
            ),
        )
    }
}

// ------------------------------------------------------------------------
// github.issues.get
// ------------------------------------------------------------------------

pub struct IssuesGetTool;

#[async_trait]
impl Tool for IssuesGetTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.issues.get requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.issues.get".into(),
            description: "Read a single issue by number. Returns title, body, labels, assignees, comments_count, and state.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner":  { "type": "string" },
                    "repo":   { "type": "string" },
                    "number": { "type": "integer" }
                },
                "required": ["owner", "repo", "number"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.issues.get"
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
        let owner = match require_str(&args, "owner") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let repo = match require_str(&args, "repo") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let number = match args.get("number").and_then(|v| v.as_i64()) {
            Some(n) => n,
            None => return Ok(ToolResult::error("missing or non-integer 'number'")),
        };
        let url = format!(
            "{}/repos/{}/{}/issues/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            number,
        );
        let issue: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let data = json!({
            "number":         issue.get("number").cloned().unwrap_or(Value::Null),
            "title":          issue.get("title").cloned().unwrap_or(Value::Null),
            "body":           issue.get("body").cloned().unwrap_or(Value::Null),
            "state":          issue.get("state").cloned().unwrap_or(Value::Null),
            "labels":         issue.get("labels").cloned().unwrap_or(Value::Array(Vec::new())),
            "assignees":      issue.get("assignees").cloned().unwrap_or(Value::Array(Vec::new())),
            "comments_count": issue.get("comments").cloned().unwrap_or(Value::Null),
            "html_url":       issue.get("html_url").cloned().unwrap_or(Value::Null),
            "updated_at":     issue.get("updated_at").cloned().unwrap_or(Value::Null),
        });
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

// ------------------------------------------------------------------------
// github.issues.create
// ------------------------------------------------------------------------

pub struct IssuesCreateTool;

#[async_trait]
impl Tool for IssuesCreateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.issues.create requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.issues.create".into(),
            description: "Open a new issue. Optional `labels` and `assignees` arrays of strings."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner":     { "type": "string" },
                    "repo":      { "type": "string" },
                    "title":     { "type": "string" },
                    "body":      { "type": "string" },
                    "labels":    { "type": "array", "items": { "type": "string" } },
                    "assignees": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["owner", "repo", "title"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.issues.create"
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
        let owner = match require_str(&args, "owner") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let repo = match require_str(&args, "repo") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let title = match require_str(&args, "title") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let mut body = json!({ "title": title });
        if let Some(b) = args.get("body").and_then(|v| v.as_str())
            && !b.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("body".into(), Value::String(b.into()));
        }
        if let Some(arr) = args.get("labels").and_then(|v| v.as_array()) {
            let labels: Vec<Value> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| Value::String(s.into()))
                .collect();
            if let Some(obj) = body.as_object_mut() {
                obj.insert("labels".into(), Value::Array(labels));
            }
        }
        if let Some(arr) = args.get("assignees").and_then(|v| v.as_array()) {
            let assignees: Vec<Value> = arr
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| Value::String(s.into()))
                .collect();
            if let Some(obj) = body.as_object_mut() {
                obj.insert("assignees".into(), Value::Array(assignees));
            }
        }
        let url = format!(
            "{}/repos/{}/{}/issues",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
        );
        let resp: Value = match client.post_json(url, body).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let number = resp.get("number").cloned().unwrap_or(Value::Null);
        let html_url = resp.get("html_url").cloned().unwrap_or(Value::Null);
        Ok(ToolResult::success(format!("created issue #{number}"))
            .with_data(json!({ "number": number, "html_url": html_url })))
    }
}

// ------------------------------------------------------------------------
// github.issues.comment
// ------------------------------------------------------------------------

pub struct IssuesCommentTool;

#[async_trait]
impl Tool for IssuesCommentTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.issues.comment requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.issues.comment".into(),
            description: "Post a comment on an issue (or a PR — GitHub treats PR comments and issue comments interchangeably at this endpoint). Returns the new comment_id.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner":  { "type": "string" },
                    "repo":   { "type": "string" },
                    "number": { "type": "integer" },
                    "body":   { "type": "string" }
                },
                "required": ["owner", "repo", "number", "body"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.issues.comment"
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
        let owner = match require_str(&args, "owner") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let repo = match require_str(&args, "repo") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let number = match args.get("number").and_then(|v| v.as_i64()) {
            Some(n) => n,
            None => return Ok(ToolResult::error("missing or non-integer 'number'")),
        };
        let body_text = match require_str(&args, "body") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let url = format!(
            "{}/repos/{}/{}/issues/{}/comments",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            number,
        );
        let resp: Value = match client.post_json(url, json!({ "body": body_text })).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let comment_id = resp.get("id").cloned().unwrap_or(Value::Null);
        Ok(
            ToolResult::success(format!("posted comment_id={comment_id}"))
                .with_data(json!({ "comment_id": comment_id })),
        )
    }
}

// ------------------------------------------------------------------------
// github.issues.close
// ------------------------------------------------------------------------

pub struct IssuesCloseTool;

#[async_trait]
impl Tool for IssuesCloseTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.issues.close requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.issues.close".into(),
            description: "Close an issue. Optional `state_reason` (completed | not_planned | reopened) sets the reason GitHub records.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner":        { "type": "string" },
                    "repo":         { "type": "string" },
                    "number":       { "type": "integer" },
                    "state_reason": { "type": "string" }
                },
                "required": ["owner", "repo", "number"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.issues.close"
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
        let owner = match require_str(&args, "owner") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let repo = match require_str(&args, "repo") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let number = match args.get("number").and_then(|v| v.as_i64()) {
            Some(n) => n,
            None => return Ok(ToolResult::error("missing or non-integer 'number'")),
        };
        let mut body = json!({ "state": "closed" });
        if let Some(reason) = args.get("state_reason").and_then(|v| v.as_str())
            && !reason.is_empty()
            && let Some(obj) = body.as_object_mut()
        {
            obj.insert("state_reason".into(), Value::String(reason.into()));
        }
        let url = format!(
            "{}/repos/{}/{}/issues/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            number,
        );
        match client.patch_json::<Value>(url, body).await {
            Ok(resp) => Ok(
                ToolResult::success(format!("closed issue #{number}")).with_data(json!({
                    "number": number,
                    "state": resp.get("state").cloned().unwrap_or(Value::Null),
                    "state_reason": resp.get("state_reason").cloned().unwrap_or(Value::Null),
                })),
            ),
            Err(e) => Ok(into_tool_error(e)),
        }
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(IssuesListTool),
        std::sync::Arc::new(IssuesGetTool),
        std::sync::Arc::new(IssuesCreateTool),
        std::sync::Arc::new(IssuesCommentTool),
        std::sync::Arc::new(IssuesCloseTool),
    ]
}
