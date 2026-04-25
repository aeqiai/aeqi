//! Thin HTTP client wrapper used by the Notion pages / databases / blocks /
//! users tools.
//!
//! Pulls the bearer token off a [`UsableCredential`] resolved by T1.9's
//! credential substrate and presents `get` / `post_json` / `patch_json` /
//! `delete` helpers. Every request that returns 401 is reflected back as
//! [`NotionApiError::AuthExpired`] so the dispatch boundary can surface
//! the canonical refresh-on-401 marker (`reason_code=auth_expired`,
//! `credential_id=...`) in [`ToolResult::data`] —
//! `ToolRegistry::invoke` catches that marker, refreshes the credential
//! through the lifecycle, and retries the tool exactly once.
//!
//! 429 responses map to [`NotionApiError::RateLimited`] so tools surface
//! a stable `reason_code=rate_limited` (with the upstream `Retry-After`
//! seconds when present) — distinct from auth failures so the dispatch
//! boundary does not waste a refresh round trip. Notion documents an
//! average rate of 3 requests/second per integration.
//!
//! Pagination uses Notion's `next_cursor` / `has_more` envelope. The
//! [`paginate_post`] helper (search and database queries are POST-shaped
//! with the cursor in the body) walks the chain up to a hard cap of 200
//! items to bound runtime when an LLM accidentally requests an unbounded
//! scan. [`paginate_get`] does the same for `GET` endpoints
//! (block-children listings).

use aeqi_core::credentials::UsableCredential;
use reqwest::{Client, Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use thiserror::Error;

/// Notion API root. Tests override via [`NotionApiClient::with_base`].
pub const API_BASE: &str = "https://api.notion.com";

/// `Notion-Version` header value sent on every request. Pinned at the
/// well-documented `2022-06-28` release — the API surface used by this
/// pack (pages / databases / blocks / users / search) has been stable
/// at that version since release. Bumping is a deliberate code change
/// so every tool can be reviewed against any new shape.
pub const NOTION_VERSION: &str = "2022-06-28";

/// Hard cap on how many items a `paginate_*` walk will return before
/// truncating. Documented in every list-tool spec; consumers needing
/// more results should narrow their query.
pub const PAGINATION_CAP: usize = 200;

/// Notion's per-call cap on `blocks/{id}/children` PATCH (block append).
/// Larger payloads are chunked into multiple sequential calls inside
/// `pages.append_blocks`; the tool's response surfaces the chunk count
/// so the caller can reason about partial failure.
pub const APPEND_BLOCK_CHUNK: usize = 100;

/// Stable, public errors a tool surfaces back into a `ToolResult`. The
/// `reason_code` strings deliberately mirror the credential substrate's
/// `CredentialReasonCode` (and extend with `rate_limited`) so the
/// doctor + UI layers can use one vocabulary across every integration.
#[derive(Debug, Error)]
pub enum NotionApiError {
    /// Upstream replied 401 — the resolved access_token is dead.
    /// Carries the credential row id so the dispatch boundary can
    /// refresh + retry.
    #[error("auth_expired (credential_id={credential_id})")]
    AuthExpired { credential_id: String },
    /// Upstream replied 429 — rate-limited. The agent should back off;
    /// refresh would not help. `retry_after` is the upstream
    /// `Retry-After` value in seconds when present.
    #[error("rate_limited (retry_after={retry_after:?})")]
    RateLimited {
        /// Seconds-string from the `Retry-After` header when the upstream
        /// surfaced one.
        retry_after: Option<String>,
    },
    /// Upstream replied 4xx (other than 401/429) or 5xx — surface
    /// status + body verbatim.
    #[error("notion api error status={status} body={body}")]
    Http { status: u16, body: String },
    /// Network / serialization failure.
    #[error("transport error: {0}")]
    Transport(String),
}

impl NotionApiError {
    /// Stable reason-code string surfaced in `ToolResult.data.reason_code`.
    pub fn reason_code(&self) -> &'static str {
        match self {
            Self::AuthExpired { .. } => "auth_expired",
            Self::RateLimited { .. } => "rate_limited",
            Self::Http { .. } => "http_error",
            Self::Transport(_) => "transport_error",
        }
    }
}

/// Bound HTTP client carrying a credential. One instance per tool invocation.
pub struct NotionApiClient<'a> {
    http: Client,
    cred: &'a UsableCredential,
    base: String,
}

impl<'a> NotionApiClient<'a> {
    pub fn new(cred: &'a UsableCredential) -> Self {
        Self {
            http: Client::new(),
            cred,
            base: API_BASE.into(),
        }
    }

    /// Override the API base (test-only — production uses the default).
    pub fn with_base(mut self, base: impl Into<String>) -> Self {
        self.base = base.into();
        self
    }

    pub fn base(&self) -> &str {
        &self.base
    }

    pub fn credential_id(&self) -> &str {
        &self.cred.id
    }

    /// Compute the `Authorization` header. Honours whatever the
    /// lifecycle put on `UsableCredential.headers`; falls back to
    /// `Bearer <token>` (Notion's documented integration-token shape)
    /// when no header was wired.
    fn auth_header(&self) -> (String, String) {
        if let Some(h) = self.cred.headers.iter().find(|(k, _)| k == "Authorization") {
            return h.clone();
        }
        (
            "Authorization".to_string(),
            format!("Bearer {}", self.cred.bearer.as_deref().unwrap_or_default()),
        )
    }

    fn apply_default_headers(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let (auth_k, auth_v) = self.auth_header();
        builder
            .header(auth_k, auth_v)
            .header("Notion-Version", NOTION_VERSION)
            .header(
                "User-Agent",
                concat!("aeqi-pack-notion/", env!("CARGO_PKG_VERSION")),
            )
    }

    /// Issue an HTTP request and translate the response into a typed
    /// envelope. The body is deserialised into `T` on 2xx; non-2xx maps
    /// onto a [`NotionApiError`] variant carrying enough context for the
    /// dispatch boundary to pick the right retry policy.
    async fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        url: String,
        body: Option<Value>,
    ) -> Result<T, NotionApiError> {
        let mut req = self.apply_default_headers(self.http.request(method, &url));
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| NotionApiError::Transport(e.to_string()))?;
        check_response(resp, &self.cred.id).await
    }

    pub async fn get<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
    ) -> Result<T, NotionApiError> {
        self.send(Method::GET, url.into(), None).await
    }

    pub async fn post_json<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
        body: Value,
    ) -> Result<T, NotionApiError> {
        self.send(Method::POST, url.into(), Some(body)).await
    }

    pub async fn patch_json<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
        body: Value,
    ) -> Result<T, NotionApiError> {
        self.send(Method::PATCH, url.into(), Some(body)).await
    }

    pub async fn delete<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
    ) -> Result<T, NotionApiError> {
        self.send(Method::DELETE, url.into(), None).await
    }

    /// Walk a Notion `next_cursor` chain on a POST endpoint (search /
    /// database query). `body` is the request body shape — this helper
    /// injects `start_cursor` on each follow-up call. Returns the
    /// concatenated `results` array plus a `truncated` flag indicating
    /// whether more cursors remained.
    pub async fn paginate_post(
        &self,
        url: impl Into<String>,
        mut body: Value,
    ) -> Result<(Vec<Value>, bool), NotionApiError> {
        let url: String = url.into();
        let mut out: Vec<Value> = Vec::new();
        let mut truncated = false;
        loop {
            let resp: Value = self.post_json(&url, body.clone()).await?;
            extend_with_results(&resp, &mut out);
            if out.len() >= PAGINATION_CAP {
                if extract_has_more(&resp) {
                    truncated = true;
                }
                break;
            }
            if !extract_has_more(&resp) {
                break;
            }
            let cursor = match extract_next_cursor(&resp) {
                Some(c) => c,
                None => break,
            };
            if let Some(obj) = body.as_object_mut() {
                obj.insert("start_cursor".into(), Value::String(cursor));
            }
        }
        Ok((out, truncated))
    }

    /// Walk a Notion `next_cursor` chain on a GET endpoint
    /// (block-children listing). The cursor is sent as the
    /// `start_cursor` query parameter on each follow-up call.
    pub async fn paginate_get(
        &self,
        first_url: impl Into<String>,
    ) -> Result<(Vec<Value>, bool), NotionApiError> {
        let mut out: Vec<Value> = Vec::new();
        let mut truncated = false;
        let mut cursor: Option<String> = None;
        let base_url: String = first_url.into();
        loop {
            let url = match &cursor {
                Some(c) => append_query(&base_url, "start_cursor", c),
                None => base_url.clone(),
            };
            let resp: Value = self.get(url).await?;
            extend_with_results(&resp, &mut out);
            if out.len() >= PAGINATION_CAP {
                if extract_has_more(&resp) {
                    truncated = true;
                }
                break;
            }
            if !extract_has_more(&resp) {
                break;
            }
            match extract_next_cursor(&resp) {
                Some(c) => cursor = Some(c),
                None => break,
            }
        }
        Ok((out, truncated))
    }
}

async fn check_response<T: DeserializeOwned>(
    resp: Response,
    credential_id: &str,
) -> Result<T, NotionApiError> {
    let status = resp.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(NotionApiError::AuthExpired {
            credential_id: credential_id.to_string(),
        });
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        let retry = resp
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        return Err(NotionApiError::RateLimited { retry_after: retry });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(NotionApiError::Http {
            status: status.as_u16(),
            body,
        });
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| NotionApiError::Transport(e.to_string()))?;
    if bytes.is_empty() {
        return serde_json::from_slice(b"null")
            .map_err(|e| NotionApiError::Transport(e.to_string()));
    }
    serde_json::from_slice(&bytes).map_err(|e| NotionApiError::Transport(e.to_string()))
}

fn extend_with_results(resp: &Value, out: &mut Vec<Value>) {
    if let Some(arr) = resp.get("results").and_then(|v| v.as_array()) {
        for item in arr {
            if out.len() >= PAGINATION_CAP {
                break;
            }
            out.push(item.clone());
        }
    }
}

fn extract_has_more(resp: &Value) -> bool {
    resp.get("has_more")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn extract_next_cursor(resp: &Value) -> Option<String> {
    resp.get("next_cursor")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// Append a `key=value` query parameter to a URL — chooses `?` vs `&`
/// based on whether the URL already carries a query string.
pub fn append_query(url: &str, key: &str, value: &str) -> String {
    let sep = if url.contains('?') { '&' } else { '?' };
    format!(
        "{url}{sep}{key}={value_enc}",
        value_enc = urlencoding::encode(value)
    )
}

/// Build the JSON body required by `notion.pages.append_blocks`. Public
/// so the tool can construct it once and pass each chunked slice
/// through the API client without rebuilding the wrapping shape.
pub fn append_blocks_body(children: &[Value]) -> Value {
    json!({ "children": children })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_query_picks_question_mark_when_absent() {
        assert_eq!(append_query("https://x/y", "k", "v"), "https://x/y?k=v");
    }

    #[test]
    fn append_query_picks_ampersand_when_query_present() {
        assert_eq!(
            append_query("https://x/y?a=b", "k", "v"),
            "https://x/y?a=b&k=v"
        );
    }

    #[test]
    fn append_query_url_encodes_value() {
        assert_eq!(
            append_query("https://x/y", "cursor", "abc def/=&"),
            "https://x/y?cursor=abc%20def%2F%3D%26"
        );
    }

    #[test]
    fn rate_limited_reason_code_distinct_from_auth_expired() {
        assert_eq!(
            NotionApiError::RateLimited { retry_after: None }.reason_code(),
            "rate_limited"
        );
        assert_eq!(
            NotionApiError::AuthExpired {
                credential_id: "x".into()
            }
            .reason_code(),
            "auth_expired"
        );
    }

    #[test]
    fn append_blocks_body_wraps_children() {
        let children = vec![json!({"type": "paragraph"})];
        let body = append_blocks_body(&children);
        assert_eq!(body["children"][0]["type"], "paragraph");
    }
}
