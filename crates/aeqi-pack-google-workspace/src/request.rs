//! Generic Google API request tool.
//!
//! This is intentionally provider-generic, not product-specific: MCP exposes
//! one integration proxy, and the Google pack exposes one constrained request
//! primitive for Google API endpoints covered by the connected OAuth token.

use aeqi_core::credentials::{CredentialNeed, ScopeHint, UsableCredential};
use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use anyhow::Result;
use async_trait::async_trait;
use reqwest::{Client, Method, StatusCode};
use serde_json::{Value, json};

use crate::api::{GoogleApiError, scope_satisfied};

const PROVIDER: &str = "google";
const NAME: &str = "oauth_token";
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

fn need() -> CredentialNeed {
    CredentialNeed::new(PROVIDER, NAME, ScopeHint::Agent)
}

fn first_cred(creds: Vec<Option<UsableCredential>>) -> Option<UsableCredential> {
    creds.into_iter().next().flatten()
}

fn missing_credential() -> ToolResult {
    ToolResult::error("missing_credential: provider=google name=oauth_token (no Google credential found — connect Google Workspace first)").with_data(json!({"reason_code": "missing_credential"}))
}

fn into_tool_error(err: GoogleApiError) -> ToolResult {
    let reason = err.reason_code();
    let mut data = json!({ "reason_code": reason });
    if let GoogleApiError::AuthExpired { credential_id } = &err {
        data["credential_id"] = json!(credential_id);
    }
    ToolResult::error(err.to_string()).with_data(data)
}

fn auth_header(cred: &UsableCredential) -> (String, String) {
    if let Some(h) = cred.headers.iter().find(|(k, _)| k == "Authorization") {
        return h.clone();
    }
    (
        "Authorization".to_string(),
        format!("Bearer {}", cred.bearer.as_deref().unwrap_or_default()),
    )
}

fn credential_scopes(cred: &UsableCredential) -> Vec<String> {
    cred.metadata
        .get("scopes")
        .and_then(|v| {
            if let Some(arr) = v.as_array() {
                Some(
                    arr.iter()
                        .filter_map(|s| s.as_str())
                        .map(ToOwned::to_owned)
                        .collect::<Vec<_>>(),
                )
            } else {
                v.as_str()
                    .map(|s| s.split_whitespace().map(ToOwned::to_owned).collect())
            }
        })
        .unwrap_or_default()
}

fn ensure_scopes(cred: &UsableCredential, required: &[String]) -> Result<(), GoogleApiError> {
    if required.is_empty() {
        return Err(GoogleApiError::ScopeMismatch {
            has: credential_scopes(cred).join(" "),
            needs: "at least one required_scopes entry".to_string(),
        });
    }
    let scopes = credential_scopes(cred);
    let has = scopes.iter().map(String::as_str).collect::<Vec<_>>();
    for required_scope in required {
        if !scope_satisfied(&has, required_scope)
            && !has.contains(&"https://www.googleapis.com/auth/cloud-platform")
        {
            return Err(GoogleApiError::ScopeMismatch {
                has: has.join(" "),
                needs: required_scope.clone(),
            });
        }
    }
    Ok(())
}

fn allowed_google_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or_default();
    host == "www.googleapis.com" || host.ends_with(".googleapis.com")
}

fn method_from_arg(args: &Value) -> Result<Method, Box<ToolResult>> {
    let method = args
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET")
        .to_ascii_uppercase();
    match method.as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PATCH" => Ok(Method::PATCH),
        "PUT" => Ok(Method::PUT),
        "DELETE" => Ok(Method::DELETE),
        _ => Err(Box::new(ToolResult::error(
            "method must be one of GET, POST, PATCH, PUT, DELETE",
        ))),
    }
}

fn required_scopes(args: &Value) -> Vec<String> {
    args.get("required_scopes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub struct GoogleRequestTool;

#[async_trait]
impl Tool for GoogleRequestTool {
    async fn execute(&self, _args: Value) -> Result<ToolResult> {
        Ok(ToolResult::error(
            "google.request requires credentials — invoked without substrate",
        ))
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: "google.request".into(),
            description: "Call a Google API endpoint with the connected Google Workspace OAuth token. This is a constrained provider-generic primitive: `url` must be https://*.googleapis.com or https://www.googleapis.com, and `required_scopes` must name the OAuth scope(s) needed for the endpoint. Use this for Google APIs that do not yet have a first-class pack tool, for example Slides batchUpdate.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "method": { "type": "string", "enum": ["GET", "POST", "PATCH", "PUT", "DELETE"], "default": "GET" },
                    "url": { "type": "string", "description": "Absolute Google API URL under https://*.googleapis.com or https://www.googleapis.com." },
                    "required_scopes": { "type": "array", "items": { "type": "string" }, "description": "OAuth scope(s) required for this endpoint." },
                    "body": { "type": "object", "description": "JSON request body for POST/PATCH/PUT." }
                },
                "required": ["url", "required_scopes"]
            }),
        }
    }

    fn name(&self) -> &str {
        "google.request"
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
        let scopes = required_scopes(&args);
        if let Err(e) = ensure_scopes(&cred, &scopes) {
            return Ok(into_tool_error(e));
        }
        let url = match args.get("url").and_then(|v| v.as_str()) {
            Some(url) if allowed_google_url(url) => url,
            Some(_) => {
                return Ok(ToolResult::error(
                    "url must be an HTTPS Google API endpoint under *.googleapis.com",
                ));
            }
            None => return Ok(ToolResult::error("url is required")),
        };
        let method = match method_from_arg(&args) {
            Ok(method) => method,
            Err(result) => return Ok(*result),
        };
        let (auth_k, auth_v) = auth_header(&cred);
        let mut req = Client::new()
            .request(method.clone(), url)
            .header(auth_k, auth_v)
            .header("Accept", "application/json");
        if matches!(method, Method::POST | Method::PATCH | Method::PUT) {
            req = req.json(args.get("body").unwrap_or(&Value::Null));
        }

        let resp = match req.send().await {
            Ok(resp) => resp,
            Err(e) => return Ok(into_tool_error(GoogleApiError::Transport(e.to_string()))),
        };
        let status = resp.status();
        if status == StatusCode::UNAUTHORIZED {
            return Ok(into_tool_error(GoogleApiError::AuthExpired {
                credential_id: cred.id.clone(),
            }));
        }
        let body = resp.text().await.unwrap_or_default();
        let truncated = body.len() > MAX_RESPONSE_BYTES;
        let body = if truncated {
            body.chars().take(MAX_RESPONSE_BYTES).collect::<String>()
        } else {
            body
        };
        let parsed = serde_json::from_str::<Value>(&body).ok();
        let ok = status.is_success();
        let result = if ok {
            ToolResult::success(format!("Google API request succeeded ({status})"))
        } else {
            ToolResult::error(format!("Google API request failed ({status})"))
        };
        Ok(result.with_data(json!({
            "status": status.as_u16(),
            "url": url,
            "truncated": truncated,
            "json": parsed,
            "text": body,
        })))
    }

    fn is_concurrent_safe(&self, input: &Value) -> bool {
        input
            .get("method")
            .and_then(|v| v.as_str())
            .map(|m| m.eq_ignore_ascii_case("GET"))
            .unwrap_or(true)
    }
}

pub fn all_tools() -> Vec<std::sync::Arc<dyn Tool>> {
    vec![std::sync::Arc::new(GoogleRequestTool)]
}
