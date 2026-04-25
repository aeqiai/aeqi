//! GitHub Files tools — read / list.
//!
//! Per-installation scoping (`ScopeHint::Installation`).
//!
//! | Tool                | GitHub App permission | OAuth scope |
//! | ------------------- | --------------------- | ----------- |
//! | `github.files.read` | `Contents: Read`      | `repo`      |
//! | `github.files.list` | `Contents: Read`      | `repo`      |
//!
//! Both endpoints use `GET /repos/{owner}/{repo}/contents/{path}`. The
//! response shape disambiguates: a single object means a file (with
//! base64-encoded `content`), an array means a directory listing.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use base64::Engine;
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

fn build_contents_url(client: &GithubApiClient<'_>, owner: &str, repo: &str, path: &str) -> String {
    // `path` may contain '/' which urlencoding encodes — preserve it so
    // GitHub treats it as a nested path. We percent-encode each segment.
    let encoded_path: String = path
        .split('/')
        .map(urlencoding::encode)
        .collect::<Vec<_>>()
        .join("/");
    format!(
        "{}/repos/{}/{}/contents/{}",
        client.base().trim_end_matches('/'),
        urlencoding::encode(owner),
        urlencoding::encode(repo),
        encoded_path,
    )
}

// ------------------------------------------------------------------------
// github.files.read
// ------------------------------------------------------------------------

pub struct FilesReadTool;

#[async_trait]
impl Tool for FilesReadTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.files.read requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.files.read".into(),
            description: "Read a single file from a repository. Returns content (decoded to UTF-8 when possible), sha, and size. Optional `ref` (branch / tag / commit sha) defaults to the repo's default branch.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner": { "type": "string" },
                    "repo":  { "type": "string" },
                    "path":  { "type": "string" },
                    "ref":   { "type": "string", "description": "Branch / tag / commit sha. Defaults to default branch." }
                },
                "required": ["owner", "repo", "path"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.files.read"
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
        let path = match require_str(&args, "path") {
            Ok(s) => s,
            Err(r) => return Ok(*r),
        };
        let mut url = build_contents_url(&client, owner, repo, path);
        if let Some(rf) = args.get("ref").and_then(|v| v.as_str())
            && !rf.is_empty()
        {
            url.push_str(&format!("?ref={}", urlencoding::encode(rf)));
        }
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        if resp.is_array() {
            return Ok(ToolResult::error(format!(
                "path '{path}' is a directory — use github.files.list"
            )));
        }
        let content_b64 = resp
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .replace('\n', "");
        let content = match base64::engine::general_purpose::STANDARD.decode(content_b64.as_bytes())
        {
            Ok(bytes) => String::from_utf8(bytes)
                .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned()),
            Err(_) => String::new(),
        };
        let sha = resp.get("sha").cloned().unwrap_or(Value::Null);
        let size = resp.get("size").cloned().unwrap_or(Value::Null);
        Ok(ToolResult::success(content.clone()).with_data(json!({
            "content": content,
            "sha":     sha,
            "size":    size,
            "path":    path,
        })))
    }
}

// ------------------------------------------------------------------------
// github.files.list
// ------------------------------------------------------------------------

pub struct FilesListTool;

#[async_trait]
impl Tool for FilesListTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.files.list requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.files.list".into(),
            description: "List entries in a directory. Empty `path` lists the repo root. Optional `ref` selects a branch / tag / commit. Returns name / type (file|dir) / size / sha / path per entry.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "owner": { "type": "string" },
                    "repo":  { "type": "string" },
                    "path":  { "type": "string", "description": "Directory path. Empty = repo root." },
                    "ref":   { "type": "string" }
                },
                "required": ["owner", "repo"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.files.list"
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
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let mut url = build_contents_url(&client, owner, repo, path);
        if let Some(rf) = args.get("ref").and_then(|v| v.as_str())
            && !rf.is_empty()
        {
            url.push_str(&format!("?ref={}", urlencoding::encode(rf)));
        }
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        if !resp.is_array() {
            return Ok(ToolResult::error(format!(
                "path '{path}' is a file — use github.files.read"
            )));
        }
        let entries: Vec<Value> = resp
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                json!({
                    "name": e.get("name").cloned().unwrap_or(Value::Null),
                    "type": e.get("type").cloned().unwrap_or(Value::Null),
                    "size": e.get("size").cloned().unwrap_or(Value::Null),
                    "sha":  e.get("sha").cloned().unwrap_or(Value::Null),
                    "path": e.get("path").cloned().unwrap_or(Value::Null),
                })
            })
            .collect();
        Ok(
            ToolResult::success(serde_json::to_string(&entries).unwrap_or_default())
                .with_data(json!({ "entries": entries, "path": path, "count": entries.len() })),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(FilesReadTool),
        std::sync::Arc::new(FilesListTool),
    ]
}
