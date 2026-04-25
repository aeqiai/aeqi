//! GitHub Search tools — `search.repos` / `search.issues`.
//!
//! Per-installation scoping (`ScopeHint::Installation`).
//!
//! GitHub's search API is the only set of endpoints in this pack with a
//! distinct response shape: `{ total_count, items: [...] }`. Pagination
//! is documented up to 1000 results regardless of the per-endpoint cap;
//! we honour the same pack-wide [`crate::api::PAGINATION_CAP`] of 200
//! and surface a `truncated` flag.
//!
//! | Tool                  | GitHub App permission          | OAuth scope      |
//! | --------------------- | ------------------------------ | ---------------- |
//! | `github.search.repos` | `Metadata: Read`               | (public, none)   |
//! | `github.search.issues`| `Issues: Read` + `Pull requests: Read` | `repo`   |

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{Value, json};

use crate::api::{GithubApiClient, GithubApiError};

const PROVIDER: &str = "github";
const NAME: &str = "installation_token";
const DEFAULT_MAX: usize = 30;
const HARD_CAP: usize = 100;

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

fn clamp_max(args: &Value) -> usize {
    args.get("max_results")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(DEFAULT_MAX)
        .clamp(1, HARD_CAP)
}

// ------------------------------------------------------------------------
// github.search.repos
// ------------------------------------------------------------------------

pub struct SearchReposTool;

#[async_trait]
impl Tool for SearchReposTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.search.repos requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.search.repos".into(),
            description: "Search repositories using GitHub's repo search syntax (e.g. 'org:foo language:rust stars:>100'). `max_results` clamps to 100.".into(),
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
        "github.search.repos"
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
        let url = format!(
            "{}/search/repositories?q={}&per_page={}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(query),
            max,
        );
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let total = resp.get("total_count").cloned().unwrap_or(Value::Null);
        let items: Vec<Value> = resp
            .get("items")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|r| {
                        json!({
                            "full_name":   r.get("full_name").cloned().unwrap_or(Value::Null),
                            "description": r.get("description").cloned().unwrap_or(Value::Null),
                            "stargazers":  r.get("stargazers_count").cloned().unwrap_or(Value::Null),
                            "language":    r.get("language").cloned().unwrap_or(Value::Null),
                            "html_url":    r.get("html_url").cloned().unwrap_or(Value::Null),
                            "private":     r.get("private").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(
            ToolResult::success(serde_json::to_string(&items).unwrap_or_default())
                .with_data(json!({ "repos": items, "total_count": total, "count": items.len() })),
        )
    }
}

// ------------------------------------------------------------------------
// github.search.issues
// ------------------------------------------------------------------------

pub struct SearchIssuesTool;

#[async_trait]
impl Tool for SearchIssuesTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "github.search.issues requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "github.search.issues".into(),
            description: "Search issues and pull requests using GitHub's issues+PRs search syntax (e.g. 'is:open is:pr author:@me'). The result mixes both — each item carries `is_pr` to disambiguate.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query":       { "type": "string" },
                    "max_results": { "type": "integer" }
                },
                "required": ["query"]
            }),
        }
    }

    fn name(&self) -> &str {
        "github.search.issues"
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
        let url = format!(
            "{}/search/issues?q={}&per_page={}",
            client.base().trim_end_matches('/'),
            urlencoding::encode(query),
            max,
        );
        let resp: Value = match client.get(url).await {
            Ok(v) => v,
            Err(e) => return Ok(into_tool_error(e)),
        };
        let total = resp.get("total_count").cloned().unwrap_or(Value::Null);
        let items: Vec<Value> = resp
            .get("items")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .map(|i| {
                        json!({
                            "number":   i.get("number").cloned().unwrap_or(Value::Null),
                            "title":    i.get("title").cloned().unwrap_or(Value::Null),
                            "state":    i.get("state").cloned().unwrap_or(Value::Null),
                            "is_pr":    i.get("pull_request").is_some(),
                            "html_url": i.get("html_url").cloned().unwrap_or(Value::Null),
                            "repository_url": i.get("repository_url").cloned().unwrap_or(Value::Null),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(
            ToolResult::success(serde_json::to_string(&items).unwrap_or_default())
                .with_data(json!({ "items": items, "total_count": total, "count": items.len() })),
        )
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![
        std::sync::Arc::new(SearchReposTool),
        std::sync::Arc::new(SearchIssuesTool),
    ]
}
