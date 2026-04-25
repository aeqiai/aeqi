//! GitHub Releases tools — list / create.
//!
//! Per-installation scoping (`ScopeHint::Installation`).
//!
//! | Tool                     | GitHub App permission     | OAuth scope |
//! | ------------------------ | ------------------------- | ----------- |
//! | `github.releases.list`   | `Contents: Read`          | `repo`      |
//! | `github.releases.create` | `Contents: Read & write`  | `repo`      |

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
// github.releases.list
// ------------------------------------------------------------------------

pub struct ReleasesListTool;

#[async_trait]
impl Tool for ReleasesListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.releases.list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.releases.list".into(),
            description: "List releases on a repository. Pagination caps at 200.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner": { "type": "string" },
                    "repo":  { "type": "string" }
                },
                "required": ["owner", "repo"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.releases.list"
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
        let url = format!(
            "{}/repos/{}/{}/releases?per_page=100",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
        );
        let (items, truncated) = match client.paginate_get(url).await {
            Ok(pair) => pair,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let releases: Vec<Value> = items
            .into_iter()
            .map(|r| {
                json!({
                    "id":         r.get("id").cloned().unwrap_or(Value::Null),
                    "tag_name":   r.get("tag_name").cloned().unwrap_or(Value::Null),
                    "name":       r.get("name").cloned().unwrap_or(Value::Null),
                    "draft":      r.get("draft").cloned().unwrap_or(Value::Null),
                    "prerelease": r.get("prerelease").cloned().unwrap_or(Value::Null),
                    "html_url":   r.get("html_url").cloned().unwrap_or(Value::Null),
                    "published_at": r.get("published_at").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&releases).unwrap_or_default()).with_data(
                json!({ "releases": releases, "truncated": truncated, "count": releases.len() }),
            ),
        )
    }
}

// ------------------------------------------------------------------------
// github.releases.create
// ------------------------------------------------------------------------

pub struct ReleasesCreateTool;

#[async_trait]
impl Tool for ReleasesCreateTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.releases.create requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.releases.create".into(),
            description: "Create a release on a tag. Optional name / body / draft / prerelease flags. Returns release_id and html_url.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner":      { "type": "string" },
                    "repo":       { "type": "string" },
                    "tag_name":   { "type": "string" },
                    "name":       { "type": "string" },
                    "body":       { "type": "string" },
                    "draft":      { "type": "boolean" },
                    "prerelease": { "type": "boolean" }
                },
                "required": ["owner", "repo", "tag_name"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.releases.create"
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
        let tag_name = match require_str(&args, "tag_name") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let mut body_payload = json!({ "tag_name": tag_name });
        if let Some(n) = args.get("name").and_then(|v| v.as_str())
            && !n.is_empty()
            && let Some(obj) = body_payload.as_object_mut()
        {
            obj.insert("name".into(), Value::String(n.into()));
        }
        if let Some(b) = args.get("body").and_then(|v| v.as_str())
            && !b.is_empty()
            && let Some(obj) = body_payload.as_object_mut()
        {
            obj.insert("body".into(), Value::String(b.into()));
        }
        if let Some(d) = args.get("draft").and_then(|v| v.as_bool())
            && let Some(obj) = body_payload.as_object_mut()
        {
            obj.insert("draft".into(), Value::Bool(d));
        }
        if let Some(p) = args.get("prerelease").and_then(|v| v.as_bool())
            && let Some(obj) = body_payload.as_object_mut()
        {
            obj.insert("prerelease".into(), Value::Bool(p));
        }
        let url = format!(
            "{}/repos/{}/{}/releases",
            client.base().trim_end_matches('/'),
            urlencoding::encode(owner),
            urlencoding::encode(repo),
        );
        let resp: Value = match client.post_json(url, body_payload).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let release_id = resp.get("id").cloned().unwrap_or(Value::Null);
        let html_url = resp.get("html_url").cloned().unwrap_or(Value::Null);
        Ok(
            ToolResult::success(format!("created release id={release_id} tag={tag_name}"))
                .with_data(json!({
                    "release_id": release_id,
                    "html_url":   html_url,
                    "tag_name":   tag_name,
                    "draft":      resp.get("draft").cloned().unwrap_or(Value::Null),
                    "prerelease": resp.get("prerelease").cloned().unwrap_or(Value::Null),
                })),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(ReleasesListTool),
        std::sync::Arc::new(ReleasesCreateTool),
    ]
}
