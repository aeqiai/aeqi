//! Thin HTTP client wrapper used by every Slack channel / message /
//! reaction / user / search tool.
//!
//! Pulls the bearer token off a [`UsableCredential`] resolved by T1.9's
//! credential substrate and presents `get`, `post_form`, and `post_json`
//! helpers. Slack's Web API has three quirks worth handling at this
//! layer:
//!
//! 1. **`ok` envelope.** Every method returns HTTP 200 wrapping
//!    `{ ok: true|false, ... }`. We treat `ok=false` as a logical
//!    error and translate it through [`SlackApiError`] just like an
//!    HTTP failure. The Slack `error` string surfaces as the reason
//!    metadata so the dispatch boundary can act on the canonical
//!    cases (`invalid_auth`, `not_in_channel`, `paid_only`, etc.).
//! 2. **Auth expiry.** A 401 *or* `{ok: false, error: "invalid_auth" |
//!    "token_expired" | "token_revoked" | "not_authed"}` body all map
//!    to [`SlackApiError::AuthExpired`] so the framework can refresh
//!    and retry exactly once.
//! 3. **Rate limits.** A 429 (or `{ok: false, error: "ratelimited"}`)
//!    maps to [`SlackApiError::RateLimited`]. The `Retry-After`
//!    header (seconds) is preserved when present so the agent can
//!    back off without spamming the substrate's refresh path.
//!
//! Pagination uses Slack's `cursor` model — a list response carries a
//! `response_metadata.next_cursor` string; pass it back as `cursor` on
//! the next request. The [`SlackApiClient::paginate_get`] helper walks
//! that chain up to [`PAGINATION_CAP`] items and exposes a `truncated`
//! flag matching the W2 GitHub pack's convention.

use aeqi_core::credentials::UsableCredential;
use reqwest::{Client, Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use thiserror::Error;

/// Slack Web API root. Tests override via [`SlackApiClient::with_base`].
pub const API_BASE: &str = "https://slack.com/api";

/// Hard cap on how many items a `paginate_*` walk will return before
/// truncating. Matches W2's GitHub pack so behaviour is uniform across
/// every wisdom pack.
pub const PAGINATION_CAP: usize = 200;

/// Stable, public errors a tool surfaces back into a `ToolResult`. The
/// `reason_code` strings deliberately mirror the credential substrate's
/// `CredentialReasonCode` (and W2's `rate_limited`) so the doctor + UI
/// layers can use one vocabulary across every integration.
#[derive(Debug, Error)]
pub enum SlackApiError {
    /// Upstream replied 401 *or* `{ok: false, error: "invalid_auth" |
    /// "token_expired" | "token_revoked" | "not_authed"}`. Carries the
    /// credential row id so the dispatch boundary can refresh + retry.
    #[error("auth_expired (credential_id={credential_id})")]
    AuthExpired { credential_id: String },
    /// Upstream replied 429, or returned `{ok: false, error:
    /// "ratelimited"}`. The agent should back off; refreshing would not
    /// help.
    #[error("rate_limited (retry_after={retry_after:?}s)")]
    RateLimited {
        /// Seconds to wait before retrying — surfaced from the
        /// `Retry-After` header when present.
        retry_after: Option<u64>,
    },
    /// `{ok: false, error: "<slack error string>"}`. Propagates the
    /// upstream string verbatim so consumers can act on it.
    #[error("slack api error: {error}")]
    SlackErr {
        /// Slack's `error` field — e.g. `"channel_not_found"`,
        /// `"paid_only"`, `"missing_scope"`.
        error: String,
    },
    /// Non-2xx HTTP response that wasn't a 401 or 429 — surface status
    /// + body verbatim.
    #[error("slack http error status={status} body={body}")]
    Http { status: u16, body: String },
    /// Network / serialization failure.
    #[error("transport error: {0}")]
    Transport(String),
}

impl SlackApiError {
    /// Stable reason-code string surfaced in `ToolResult.data.reason_code`.
    pub fn reason_code(&self) -> &'static str {
        match self {
            Self::AuthExpired { .. } => "auth_expired",
            Self::RateLimited { .. } => "rate_limited",
            Self::SlackErr { .. } => "slack_error",
            Self::Http { .. } => "http_error",
            Self::Transport(_) => "transport_error",
        }
    }
}

/// The set of Slack `error` strings that mean "the bot token is dead and
/// the substrate should refresh it". Slack returns these inside an HTTP
/// 200 body (with `ok: false`), so the api client has to inspect the
/// envelope before declaring success.
fn is_auth_expired_marker(slack_error: &str) -> bool {
    matches!(
        slack_error,
        "invalid_auth" | "not_authed" | "token_expired" | "token_revoked"
    )
}

/// Bound HTTP client carrying a credential. One instance per tool
/// invocation.
pub struct SlackApiClient<'a> {
    http: Client,
    cred: &'a UsableCredential,
    base: String,
}

impl<'a> SlackApiClient<'a> {
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
    /// `Bearer <token>` (Slack's documented bot-token shape) when no
    /// header was wired.
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
        builder.header(auth_k, auth_v).header(
            "User-Agent",
            concat!("aeqi-pack-slack/", env!("CARGO_PKG_VERSION")),
        )
    }

    /// Issue a GET to `<base>/<method>` with the supplied query
    /// parameters. Used by Slack's read-only methods that accept GET
    /// (most of `*.list` / `*.info` style endpoints).
    pub async fn get<T: DeserializeOwned>(
        &self,
        method: &str,
        params: &[(&str, &str)],
    ) -> Result<T, SlackApiError> {
        let mut url = format!("{}/{}", self.base.trim_end_matches('/'), method);
        if !params.is_empty() {
            url.push('?');
            let parts: Vec<String> = params
                .iter()
                .filter(|(_, v)| !v.is_empty())
                .map(|(k, v)| format!("{}={}", urlencoding::encode(k), urlencoding::encode(v)))
                .collect();
            url.push_str(&parts.join("&"));
        }
        let req = self.apply_default_headers(self.http.request(Method::GET, &url));
        let resp = req
            .send()
            .await
            .map_err(|e| SlackApiError::Transport(e.to_string()))?;
        check_response(resp, &self.cred.id).await
    }

    /// Issue a POST to `<base>/<method>` with form-encoded body.
    pub async fn post_form<T: DeserializeOwned>(
        &self,
        method: &str,
        form: &[(&str, &str)],
    ) -> Result<T, SlackApiError> {
        let url = format!("{}/{}", self.base.trim_end_matches('/'), method);
        let req = self
            .apply_default_headers(self.http.request(Method::POST, &url))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(form);
        let resp = req
            .send()
            .await
            .map_err(|e| SlackApiError::Transport(e.to_string()))?;
        check_response(resp, &self.cred.id).await
    }

    /// Issue a POST to `<base>/<method>` with a JSON body. Used by
    /// `chat.postMessage` etc. when callers pass `blocks` or array
    /// payloads that don't survive form encoding cleanly.
    pub async fn post_json<T: DeserializeOwned>(
        &self,
        method: &str,
        body: Value,
    ) -> Result<T, SlackApiError> {
        let url = format!("{}/{}", self.base.trim_end_matches('/'), method);
        let req = self
            .apply_default_headers(self.http.request(Method::POST, &url))
            .header("Content-Type", "application/json; charset=utf-8")
            .json(&body);
        let resp = req
            .send()
            .await
            .map_err(|e| SlackApiError::Transport(e.to_string()))?;
        check_response(resp, &self.cred.id).await
    }

    /// Walk a Slack cursor-paginated list endpoint. `extract` pulls the
    /// per-page array out of the envelope (Slack varies the field name
    /// — `channels`, `members`, `messages`). Pagination stops at
    /// [`PAGINATION_CAP`] items.
    ///
    /// Returns `(items, truncated)`. `truncated=true` means more pages
    /// existed but the cap was reached.
    pub async fn paginate_get(
        &self,
        method: &str,
        base_params: &[(&str, &str)],
        extract: &str,
    ) -> Result<(Vec<Value>, bool), SlackApiError> {
        let mut out: Vec<Value> = Vec::new();
        let mut cursor: Option<String> = None;
        let mut truncated = false;
        loop {
            let mut params: Vec<(&str, &str)> = base_params.to_vec();
            if let Some(c) = cursor.as_deref() {
                params.push(("cursor", c));
            }
            let envelope: Value = self.get(method, &params).await?;
            // `check_response` already promoted any non-ok envelope to
            // SlackApiError; here we know `ok=true`.
            let next = envelope
                .get("response_metadata")
                .and_then(|m| m.get("next_cursor"))
                .and_then(|c| c.as_str())
                .map(str::to_string);
            if let Some(arr) = envelope.get(extract).and_then(|v| v.as_array()) {
                for item in arr {
                    if out.len() >= PAGINATION_CAP {
                        truncated = true;
                        break;
                    }
                    out.push(item.clone());
                }
            }
            if out.len() >= PAGINATION_CAP {
                if next.as_deref().is_some_and(|c| !c.is_empty()) {
                    truncated = true;
                }
                break;
            }
            match next {
                Some(c) if !c.is_empty() => cursor = Some(c),
                _ => break,
            }
        }
        Ok((out, truncated))
    }
}

async fn check_response<T: DeserializeOwned>(
    resp: Response,
    credential_id: &str,
) -> Result<T, SlackApiError> {
    let status = resp.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(SlackApiError::AuthExpired {
            credential_id: credential_id.to_string(),
        });
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        let retry = resp
            .headers()
            .get("Retry-After")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse::<u64>().ok());
        return Err(SlackApiError::RateLimited { retry_after: retry });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(SlackApiError::Http {
            status: status.as_u16(),
            body,
        });
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| SlackApiError::Transport(e.to_string()))?;
    if bytes.is_empty() {
        return Err(SlackApiError::Transport("empty slack response".into()));
    }
    let envelope: Value = serde_json::from_slice(&bytes)
        .map_err(|e| SlackApiError::Transport(format!("non-JSON response: {e}")))?;
    if envelope.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let slack_error = envelope
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();
        if is_auth_expired_marker(&slack_error) {
            return Err(SlackApiError::AuthExpired {
                credential_id: credential_id.to_string(),
            });
        }
        if slack_error == "ratelimited" {
            return Err(SlackApiError::RateLimited { retry_after: None });
        }
        return Err(SlackApiError::SlackErr {
            error: slack_error,
        });
    }
    serde_json::from_value(envelope).map_err(|e| SlackApiError::Transport(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_expired_markers_are_recognised() {
        for marker in [
            "invalid_auth",
            "not_authed",
            "token_expired",
            "token_revoked",
        ] {
            assert!(
                is_auth_expired_marker(marker),
                "{marker} should map to auth_expired"
            );
        }
        assert!(!is_auth_expired_marker("channel_not_found"));
        assert!(!is_auth_expired_marker("ratelimited"));
    }

    #[test]
    fn reason_codes_are_distinct_per_variant() {
        assert_eq!(
            SlackApiError::AuthExpired {
                credential_id: "x".into()
            }
            .reason_code(),
            "auth_expired"
        );
        assert_eq!(
            SlackApiError::RateLimited { retry_after: None }.reason_code(),
            "rate_limited"
        );
        assert_eq!(
            SlackApiError::SlackErr {
                error: "paid_only".into()
            }
            .reason_code(),
            "slack_error"
        );
        assert_eq!(
            SlackApiError::Http {
                status: 500,
                body: "x".into()
            }
            .reason_code(),
            "http_error"
        );
        assert_eq!(
            SlackApiError::Transport("x".into()).reason_code(),
            "transport_error"
        );
    }
}
