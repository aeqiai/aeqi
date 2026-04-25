//! Thin HTTP client wrapper used by the GitHub issue / PR / file /
//! release / search tools.
//!
//! Pulls the bearer token off a [`UsableCredential`] resolved by T1.9's
//! credential substrate and presents `get` / `post` / `patch` / `put` /
//! `delete` helpers. Every request that returns 401 is reflected back
//! as [`GithubApiError::AuthExpired`] so the dispatch boundary can
//! surface the canonical refresh-on-401 marker (`reason_code=auth_expired`,
//! `credential_id=...`) in [`ToolResult::data`] —
//! `ToolRegistry::invoke` catches that marker, refreshes the credential
//! through the lifecycle, and retries the tool exactly once.
//!
//! 403 responses with `X-RateLimit-Remaining: 0` map to
//! [`GithubApiError::RateLimited`] so tools surface a stable
//! `reason_code=rate_limited` (with the upstream reset timestamp when
//! present) — distinct from auth failures so the dispatch boundary
//! does not waste a refresh round trip.
//!
//! Pagination follows GitHub's `Link: <...>; rel="next"` header. The
//! [`paginate_get`] helper walks the chain up to a hard cap of 200
//! items (two pages at the maximum `per_page=100`) to bound runtime
//! when an LLM accidentally requests an unbounded scan.

use aeqi_core::credentials::UsableCredential;
use reqwest::{Client, Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use thiserror::Error;

/// GitHub.com REST v3 root. Tests override via [`GithubApiClient::with_base`].
pub const API_BASE: &str = "https://api.github.com";

/// Hard cap on how many items a `paginate_*` walk will return before
/// truncating — two pages at GitHub's maximum `per_page=100`. The cap
/// is documented in every list-tool spec; consumers needing more
/// results should narrow their query.
pub const PAGINATION_CAP: usize = 200;

/// Stable, public errors a tool surfaces back into a `ToolResult`. The
/// `reason_code` strings deliberately mirror the credential substrate's
/// `CredentialReasonCode` (and extend with `rate_limited`) so the
/// doctor + UI layers can use one vocabulary across every integration.
#[derive(Debug, Error)]
pub enum GithubApiError {
    /// Upstream replied 401 — the resolved access_token / installation
    /// token is dead. Carries the credential row id so the dispatch
    /// boundary can refresh + retry.
    #[error("auth_expired (credential_id={credential_id})")]
    AuthExpired { credential_id: String },
    /// Upstream replied 403 with `X-RateLimit-Remaining: 0`. The agent
    /// should back off; refresh would not help.
    #[error("rate_limited (reset_at={reset_at:?})")]
    RateLimited {
        /// Epoch-seconds string when the bucket resets, when the header
        /// `X-RateLimit-Reset` was present.
        reset_at: Option<String>,
    },
    /// Upstream replied 403 without rate-limit headers, or 404 / 422
    /// / 5xx — surface status + body verbatim.
    #[error("github api error status={status} body={body}")]
    Http { status: u16, body: String },
    /// Network / serialization failure.
    #[error("transport error: {0}")]
    Transport(String),
}

impl GithubApiError {
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
pub struct GithubApiClient<'a> {
    http: Client,
    cred: &'a UsableCredential,
    base: String,
}

impl<'a> GithubApiClient<'a> {
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
    /// `token <bearer>` (GitHub's documented installation-token shape)
    /// when no header was wired.
    fn auth_header(&self) -> (String, String) {
        if let Some(h) = self.cred.headers.iter().find(|(k, _)| k == "Authorization") {
            return h.clone();
        }
        (
            "Authorization".to_string(),
            format!("token {}", self.cred.bearer.as_deref().unwrap_or_default()),
        )
    }

    fn apply_default_headers(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        let (auth_k, auth_v) = self.auth_header();
        builder
            .header(auth_k, auth_v)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header(
                "User-Agent",
                concat!("aeqi-pack-github/", env!("CARGO_PKG_VERSION")),
            )
    }

    /// Issue an HTTP request and translate the response into a typed
    /// envelope. The body is deserialised into `T` on 2xx; non-2xx maps
    /// onto a [`GithubApiError`] variant carrying enough context for the
    /// dispatch boundary to pick the right retry policy.
    async fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        url: String,
        body: Option<Value>,
    ) -> Result<T, GithubApiError> {
        let mut req = self.apply_default_headers(self.http.request(method, &url));
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| GithubApiError::Transport(e.to_string()))?;
        check_response(resp, &self.cred.id).await
    }

    pub async fn get<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
    ) -> Result<T, GithubApiError> {
        self.send(Method::GET, url.into(), None).await
    }

    pub async fn post_json<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
        body: Value,
    ) -> Result<T, GithubApiError> {
        self.send(Method::POST, url.into(), Some(body)).await
    }

    pub async fn patch_json<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
        body: Value,
    ) -> Result<T, GithubApiError> {
        self.send(Method::PATCH, url.into(), Some(body)).await
    }

    /// Issue a paginated GET — follows `Link: ...; rel="next"` up to the
    /// pack-wide [`PAGINATION_CAP`]. Returns the concatenated array
    /// (GitHub list endpoints return JSON arrays) plus a `truncated`
    /// flag indicating whether more pages were available.
    pub async fn paginate_get(
        &self,
        first_url: impl Into<String>,
    ) -> Result<(Vec<Value>, bool), GithubApiError> {
        let mut out: Vec<Value> = Vec::new();
        let mut url = first_url.into();
        let mut truncated = false;
        loop {
            let req = self.apply_default_headers(self.http.get(&url));
            let resp = req
                .send()
                .await
                .map_err(|e| GithubApiError::Transport(e.to_string()))?;
            let status = resp.status();
            if status == StatusCode::UNAUTHORIZED {
                return Err(GithubApiError::AuthExpired {
                    credential_id: self.cred.id.clone(),
                });
            }
            if status == StatusCode::FORBIDDEN
                && resp
                    .headers()
                    .get("X-RateLimit-Remaining")
                    .and_then(|v| v.to_str().ok())
                    == Some("0")
            {
                let reset = resp
                    .headers()
                    .get("X-RateLimit-Reset")
                    .and_then(|v| v.to_str().ok())
                    .map(str::to_string);
                return Err(GithubApiError::RateLimited { reset_at: reset });
            }
            if !status.is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(GithubApiError::Http {
                    status: status.as_u16(),
                    body,
                });
            }
            let next = parse_link_next(resp.headers().get("link").and_then(|v| v.to_str().ok()));
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| GithubApiError::Transport(e.to_string()))?;
            let page: Value = if bytes.is_empty() {
                Value::Array(Vec::new())
            } else {
                serde_json::from_slice(&bytes)
                    .map_err(|e| GithubApiError::Transport(e.to_string()))?
            };
            if let Some(arr) = page.as_array() {
                for item in arr {
                    if out.len() >= PAGINATION_CAP {
                        truncated = true;
                        break;
                    }
                    out.push(item.clone());
                }
            }
            if out.len() >= PAGINATION_CAP {
                // We may have stopped mid-page; flag truncation if the
                // next link exists OR we filled the cap on this page.
                if next.is_some() {
                    truncated = true;
                }
                break;
            }
            match next {
                Some(n) => url = n,
                None => break,
            }
        }
        Ok((out, truncated))
    }
}

async fn check_response<T: DeserializeOwned>(
    resp: Response,
    credential_id: &str,
) -> Result<T, GithubApiError> {
    let status = resp.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(GithubApiError::AuthExpired {
            credential_id: credential_id.to_string(),
        });
    }
    if status == StatusCode::FORBIDDEN
        && resp
            .headers()
            .get("X-RateLimit-Remaining")
            .and_then(|v| v.to_str().ok())
            == Some("0")
    {
        let reset = resp
            .headers()
            .get("X-RateLimit-Reset")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        return Err(GithubApiError::RateLimited { reset_at: reset });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(GithubApiError::Http {
            status: status.as_u16(),
            body,
        });
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| GithubApiError::Transport(e.to_string()))?;
    if bytes.is_empty() {
        return serde_json::from_slice(b"null")
            .map_err(|e| GithubApiError::Transport(e.to_string()));
    }
    serde_json::from_slice(&bytes).map_err(|e| GithubApiError::Transport(e.to_string()))
}

/// Parse the `Link: <url>; rel="next", <url>; rel="last"` header GitHub
/// returns on paginated responses. Returns the URL of the `rel="next"`
/// page when present.
pub fn parse_link_next(header: Option<&str>) -> Option<String> {
    let h = header?;
    for part in h.split(',') {
        let part = part.trim();
        // Each segment looks like: `<https://api.github.com/...>; rel="next"`
        let mut bits = part.splitn(2, ';');
        let url_part = bits.next()?.trim();
        let rel_part = bits.next()?.trim();
        if !rel_part.contains("rel=\"next\"") {
            continue;
        }
        let url = url_part.trim_start_matches('<').trim_end_matches('>');
        return Some(url.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_link_next_picks_next_segment() {
        let link = r#"<https://api.github.com/page/2>; rel="next", <https://api.github.com/page/9>; rel="last""#;
        assert_eq!(
            parse_link_next(Some(link)),
            Some("https://api.github.com/page/2".to_string())
        );
    }

    #[test]
    fn parse_link_next_returns_none_when_only_last_present() {
        let link = r#"<https://api.github.com/page/9>; rel="last""#;
        assert_eq!(parse_link_next(Some(link)), None);
    }

    #[test]
    fn parse_link_next_returns_none_when_header_absent() {
        assert_eq!(parse_link_next(None), None);
    }

    #[test]
    fn rate_limited_reason_code_distinct_from_auth_expired() {
        assert_eq!(
            GithubApiError::RateLimited { reset_at: None }.reason_code(),
            "rate_limited"
        );
        assert_eq!(
            GithubApiError::AuthExpired {
                credential_id: "x".into()
            }
            .reason_code(),
            "auth_expired"
        );
    }
}
