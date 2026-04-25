//! GitHub Pull Request tools — list / get / create / comment / review.
//!
//! Per-installation scoping (`ScopeHint::Installation`).
//!
//! | Tool                  | GitHub App permission       | OAuth scope |
//! | --------------------- | --------------------------- | ----------- |
//! | `github.prs.list`     | `Pull requests: Read`       | `repo`      |
//! | `github.prs.get`      | `Pull requests: Read`       | `repo`      |
//! | `github.prs.create`   | `Pull requests: Read & write` | `repo`    |
//! | `github.prs.comment`  | `Pull requests: Read & write` | `repo`    |
//! | `github.prs.review`   | `Pull requests: Read & write` | `repo`    |
//!
//! Note: `github.prs.comment` posts an issue-style comment on the PR's
//! conversation tab (the only kind that doesn't require a diff hunk).
//! Inline review comments belong on `github.prs.review` with a `comments`
//! payload.

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
// github.prs.list
// ------------------------------------------------------------------------

pub struct PrsListTool;

#[async_trait]
impl Tool for PrsListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.prs.list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.prs.list".into(),
            description: "List pull requests on a repository. Optional state (open|closed|all), base (target branch), head (source branch in `user:branch` form). Pagination caps at 200.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner": { "type": "string" },
                    "repo":  { "type": "string" },
                    "state": { "type": "string" },
                    "base":  { "type": "string" },
                    "head":  { "type": "string" }
                },
                "required": ["owner", "repo"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.prs.list"
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
            "{}/repos/{}/{}/pulls?state={}&per_page=100",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            urlencoding::encode(state),
        );
        if let Some(base) = args.get("base").and_then(|v| v.as_str())
            && !base.is_empty()
        {
            url.push_str(&format!("&base={}", urlencoding::encode(base)));
        }
        if let Some(head) = args.get("head").and_then(|v| v.as_str())
            && !head.is_empty()
        {
            url.push_str(&format!("&head={}", urlencoding::encode(head)));
        }
        let (items, truncated) = match client.paginate_get(url).await {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let prs: Vec<Value> = items
            .into_iter()
            .map(|p| {
                json!({
                    "number":   p.get("number").cloned().unwrap_or(Value::Null),
                    "title":    p.get("title").cloned().unwrap_or(Value::Null),
                    "state":    p.get("state").cloned().unwrap_or(Value::Null),
                    "draft":    p.get("draft").cloned().unwrap_or(Value::Null),
                    "user":     p.get("user").and_then(|u| u.get("login")).cloned().unwrap_or(Value::Null),
                    "head":     p.get("head").and_then(|h| h.get("ref")).cloned().unwrap_or(Value::Null),
                    "base":     p.get("base").and_then(|b| b.get("ref")).cloned().unwrap_or(Value::Null),
                    "html_url": p.get("html_url").cloned().unwrap_or(Value::Null),
                    "updated_at": p.get("updated_at").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&prs).unwrap_or_default())
                .with_data(json!({ "prs": prs, "truncated": truncated, "count": prs.len() })),
        )
    }
}

// ------------------------------------------------------------------------
// github.prs.get
// ------------------------------------------------------------------------

pub struct PrsGetTool;

#[async_trait]
impl Tool for PrsGetTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.prs.get requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.prs.get".into(),
            description: "Read a pull request. Returns title / body / head / base / mergeable / mergeable_state / draft / changed_files / additions / deletions / state.".into(),
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
        "github.prs.get"
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
            "{}/repos/{}/{}/pulls/{}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            number,
        );
        let pr: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let data = json!({
            "number":          pr.get("number").cloned().unwrap_or(Value::Null),
            "title":           pr.get("title").cloned().unwrap_or(Value::Null),
            "body":            pr.get("body").cloned().unwrap_or(Value::Null),
            "state":           pr.get("state").cloned().unwrap_or(Value::Null),
            "draft":           pr.get("draft").cloned().unwrap_or(Value::Null),
            "merged":          pr.get("merged").cloned().unwrap_or(Value::Null),
            "mergeable":       pr.get("mergeable").cloned().unwrap_or(Value::Null),
            "mergeable_state": pr.get("mergeable_state").cloned().unwrap_or(Value::Null),
            "head":            pr.get("head").and_then(|h| h.get("ref")).cloned().unwrap_or(Value::Null),
            "base":            pr.get("base").and_then(|b| b.get("ref")).cloned().unwrap_or(Value::Null),
            "additions":       pr.get("additions").cloned().unwrap_or(Value::Null),
            "deletions":       pr.get("deletions").cloned().unwrap_or(Value::Null),
            "changed_files":   pr.get("changed_files").cloned().unwrap_or(Value::Null),
            "html_url":        pr.get("html_url").cloned().unwrap_or(Value::Null),
        });
        Ok(ToolResult::success(serde_json::to_string(&data).unwrap_or_default()).with_data(data))
    }
}

// ------------------------------------------------------------------------
// github.prs.create
// ------------------------------------------------------------------------

pub struct PrsCreateTool;

#[async_trait]
impl Tool for PrsCreateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.prs.create requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.prs.create".into(),
            description: "Open a pull request from `head` (source branch, `user:branch` form for cross-fork) into `base` (target branch). Returns PR number + html_url.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner": { "type": "string" },
                    "repo":  { "type": "string" },
                    "title": { "type": "string" },
                    "head":  { "type": "string", "description": "Source branch (e.g. 'feat/x' or 'fork:feat/x')" },
                    "base":  { "type": "string", "description": "Target branch (e.g. 'main')" },
                    "body":  { "type": "string" }
                },
                "required": ["owner", "repo", "title", "head", "base"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.prs.create"
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
        let head = match require_str(&args, "head") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let base = match require_str(&args, "base") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let mut body_payload = json!({
            "title": title,
            "head":  head,
            "base":  base,
        });
        if let Some(b) = args.get("body").and_then(|v| v.as_str())
            && !b.is_empty()
            && let Some(obj) = body_payload.as_object_mut()
        {
            obj.insert("body".into(), Value::String(b.into()));
        }
        let url = format!(
            "{}/repos/{}/{}/pulls",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
        );
        let resp: Value = match client.post_json(url, body_payload).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let number = resp.get("number").cloned().unwrap_or(Value::Null);
        let html_url = resp.get("html_url").cloned().unwrap_or(Value::Null);
        Ok(ToolResult::success(format!("opened PR #{number}"))
            .with_data(json!({ "number": number, "html_url": html_url })))
    }
}

// ------------------------------------------------------------------------
// github.prs.comment
// ------------------------------------------------------------------------

pub struct PrsCommentTool;

#[async_trait]
impl Tool for PrsCommentTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.prs.comment requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.prs.comment".into(),
            description: "Post a conversation-tab comment on a pull request. Uses GitHub's issues-comments endpoint, which doubles as the PR conversation API. Inline review comments live on github.prs.review.".into(),
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
        "github.prs.comment"
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
        // GitHub PR conversation comments live at the issues endpoint —
        // every PR is also an issue with the same number.
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
// github.prs.review
// ------------------------------------------------------------------------

pub struct PrsReviewTool;

#[async_trait]
impl Tool for PrsReviewTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.prs.review requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.prs.review".into(),
            description: "Submit a pull-request review. `event` ∈ APPROVE | REQUEST_CHANGES | COMMENT. Optional `body` is the review summary; optional `comments` is an array of inline comments shaped {path, line, body}.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner":    { "type": "string" },
                    "repo":     { "type": "string" },
                    "number":   { "type": "integer" },
                    "event":    { "type": "string", "description": "APPROVE | REQUEST_CHANGES | COMMENT" },
                    "body":     { "type": "string", "description": "Review summary" },
                    "comments": { "type": "array",  "description": "Inline review comments [{path, line, body}, ...]" }
                },
                "required": ["owner", "repo", "number", "event"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.prs.review"
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
        let event = match require_str(&args, "event") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        if !matches!(event, "APPROVE" | "REQUEST_CHANGES" | "COMMENT") {
            return Ok(ToolResult::error(format!(
                "invalid 'event': must be APPROVE | REQUEST_CHANGES | COMMENT (got '{event}')"
            )));
        }
        let mut body_payload = json!({ "event": event });
        if let Some(b) = args.get("body").and_then(|v| v.as_str())
            && !b.is_empty()
            && let Some(obj) = body_payload.as_object_mut()
        {
            obj.insert("body".into(), Value::String(b.into()));
        }
        if let Some(arr) = args.get("comments").and_then(|v| v.as_array())
            && !arr.is_empty()
            && let Some(obj) = body_payload.as_object_mut()
        {
            obj.insert("comments".into(), Value::Array(arr.clone()));
        }
        let url = format!(
            "{}/repos/{}/{}/pulls/{}/reviews",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
            number,
        );
        let resp: Value = match client.post_json(url, body_payload).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let review_id = resp.get("id").cloned().unwrap_or(Value::Null);
        Ok(
            ToolResult::success(format!("submitted review_id={review_id} event={event}"))
                .with_data(json!({
                    "review_id": review_id,
                    "event":     event,
                    "state":     resp.get("state").cloned().unwrap_or(Value::Null),
                })),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(PrsListTool),
        std::sync::Arc::new(PrsGetTool),
        std::sync::Arc::new(PrsCreateTool),
        std::sync::Arc::new(PrsCommentTool),
        std::sync::Arc::new(PrsReviewTool),
    ]
}
