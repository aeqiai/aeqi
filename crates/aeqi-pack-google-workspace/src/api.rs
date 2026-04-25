//! Thin HTTP client wrapper used by the Gmail / Calendar / Meet tools.
//!
//! Pulls the bearer token off a [`UsableCredential`] resolved by T1.9's
//! credential substrate and presents `get` / `post` / `patch` / `delete` /
//! `post_form` helpers. Every request that returns 401 is reflected back to
//! the caller as a [`GoogleApiError::AuthExpired`] so the tool can surface
//! the canonical refresh-on-401 marker (`reason_code=auth_expired`,
//! `credential_id=...`) in its [`ToolResult::data`] — `ToolRegistry::invoke`
//! catches that marker, asks the resolver to refresh the credential, and
//! retries the tool exactly once.
//!
//! Scopes are validated up front via the `scope` field on the stored OAuth
//! tokens (set by the substrate at bootstrap + every refresh): if a tool
//! requires `gmail.modify` and the credential only carries `gmail.readonly`
//! we short-circuit to [`GoogleApiError::ScopeMismatch`] without ever
//! issuing a request.

use aeqi_core::credentials::UsableCredential;
use reqwest::{Client, Method, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde_json::Value;
use thiserror::Error;

/// Default base URLs. Overridden by `GoogleApiClient::with_base` in tests so
/// the same client speaks to a hand-rolled mock server.
pub const GMAIL_BASE: &str = "https://gmail.googleapis.com";
pub const CALENDAR_BASE: &str = "https://www.googleapis.com/calendar/v3";

/// Stable, public errors a tool surfaces back into a `ToolResult`. The
/// `reason_code` strings deliberately mirror the credential substrate's
/// `CredentialReasonCode` so the doctor + UI layers can use one vocabulary
/// across every integration.
#[derive(Debug, Error)]
pub enum GoogleApiError {
    /// Upstream replied 401 — the resolved access_token is dead. Carries the
    /// credential row id so the dispatch boundary can refresh + retry.
    #[error("auth_expired (credential_id={credential_id})")]
    AuthExpired { credential_id: String },
    /// Upstream replied 403 with insufficient-scope, or the stored token
    /// cannot cover the required scope set.
    #[error("scope_mismatch: token has [{has}], tool requires [{needs}]")]
    ScopeMismatch { has: String, needs: String },
    /// Anything else — surface the status + body verbatim.
    #[error("google api error status={status} body={body}")]
    Http { status: u16, body: String },
    /// Network / serialization failure.
    #[error("transport error: {0}")]
    Transport(String),
}

impl GoogleApiError {
    /// Stable reason-code string surfaced in `ToolResult.data.reason_code`.
    pub fn reason_code(&self) -> &'static str {
        match self {
            Self::AuthExpired { .. } => "auth_expired",
            Self::ScopeMismatch { .. } => "scope_mismatch",
            Self::Http { .. } => "http_error",
            Self::Transport(_) => "transport_error",
        }
    }
}

/// Bound HTTP client carrying a credential. One instance per tool invocation.
pub struct GoogleApiClient<'a> {
    http: Client,
    cred: &'a UsableCredential,
    gmail_base: String,
    calendar_base: String,
}

impl<'a> GoogleApiClient<'a> {
    pub fn new(cred: &'a UsableCredential) -> Self {
        Self {
            http: Client::new(),
            cred,
            gmail_base: GMAIL_BASE.into(),
            calendar_base: CALENDAR_BASE.into(),
        }
    }

    /// Override base URLs (test-only — production callers use the defaults).
    pub fn with_base(mut self, gmail: impl Into<String>, calendar: impl Into<String>) -> Self {
        self.gmail_base = gmail.into();
        self.calendar_base = calendar.into();
        self
    }

    pub fn gmail_base(&self) -> &str {
        &self.gmail_base
    }

    pub fn calendar_base(&self) -> &str {
        &self.calendar_base
    }

    pub fn credential_id(&self) -> &str {
        &self.cred.id
    }

    /// Confirm the stored token's scope set covers `required`. Each entry in
    /// `required` is a Google scope URL (e.g. `https://www.googleapis.com/auth/gmail.modify`).
    ///
    /// Google scopes form a tree — `gmail.modify` covers `gmail.readonly`,
    /// `calendar` covers `calendar.readonly`, `calendar.events` is a strict
    /// subset of `calendar`. This function knows the minimal hierarchy
    /// relevant to this pack so a token with the wider scope satisfies a
    /// requirement for the narrower one.
    pub fn ensure_scopes(&self, required: &[&str]) -> Result<(), GoogleApiError> {
        let scope_str = self
            .cred
            .metadata
            .get("scopes")
            .and_then(|v| {
                if let Some(arr) = v.as_array() {
                    Some(
                        arr.iter()
                            .filter_map(|s| s.as_str())
                            .collect::<Vec<_>>()
                            .join(" "),
                    )
                } else {
                    v.as_str().map(str::to_string)
                }
            })
            .unwrap_or_default();
        let has: Vec<&str> = scope_str.split_whitespace().collect();
        for need in required {
            if !scope_satisfied(&has, need) {
                return Err(GoogleApiError::ScopeMismatch {
                    has: has.join(" "),
                    needs: need.to_string(),
                });
            }
        }
        Ok(())
    }

    fn auth_header(&self) -> (String, String) {
        if let Some(h) = self.cred.headers.iter().find(|(k, _)| k == "Authorization") {
            return h.clone();
        }
        // Fallback when headers aren't wired (some lifecycles set only
        // `bearer`). We mint the canonical "Bearer <token>" header here so
        // every request shape stays uniform.
        (
            "Authorization".to_string(),
            format!("Bearer {}", self.cred.bearer.as_deref().unwrap_or_default()),
        )
    }

    /// Issue an HTTP request and translate the response into the typed
    /// envelope every helper returns. The body is deserialized into `T` on
    /// 2xx; non-2xx maps to a `GoogleApiError` variant carrying enough
    /// context for the dispatch boundary to pick the right retry policy.
    async fn send<T: DeserializeOwned>(
        &self,
        method: Method,
        url: String,
        body: Option<Value>,
    ) -> Result<T, GoogleApiError> {
        let (auth_k, auth_v) = self.auth_header();
        let mut req = self.http.request(method, &url).header(auth_k, auth_v);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| GoogleApiError::Transport(e.to_string()))?;
        check_response(resp, &self.cred.id).await
    }

    pub async fn get<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
    ) -> Result<T, GoogleApiError> {
        self.send(Method::GET, url.into(), None).await
    }

    pub async fn post_json<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
        body: Value,
    ) -> Result<T, GoogleApiError> {
        self.send(Method::POST, url.into(), Some(body)).await
    }

    pub async fn patch_json<T: DeserializeOwned>(
        &self,
        url: impl Into<String>,
        body: Value,
    ) -> Result<T, GoogleApiError> {
        self.send(Method::PATCH, url.into(), Some(body)).await
    }

    pub async fn delete_no_body(&self, url: impl Into<String>) -> Result<(), GoogleApiError> {
        let (auth_k, auth_v) = self.auth_header();
        let resp = self
            .http
            .delete(url.into())
            .header(auth_k, auth_v)
            .send()
            .await
            .map_err(|e| GoogleApiError::Transport(e.to_string()))?;
        let status = resp.status();
        if status.is_success() || status == StatusCode::NO_CONTENT {
            return Ok(());
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err(GoogleApiError::AuthExpired {
                credential_id: self.cred.id.clone(),
            });
        }
        let body = resp.text().await.unwrap_or_default();
        Err(GoogleApiError::Http {
            status: status.as_u16(),
            body,
        })
    }

    /// Issue an HTTP POST whose body is a raw RFC 5322 message — used by
    /// `gmail.send`. Google's `users.messages.send` endpoint expects either
    /// a base64url-encoded `raw` field inside JSON or `message/rfc822`
    /// directly; we use the JSON form because it's content-type-friendly.
    pub async fn post_gmail_send(&self, raw_b64url: &str) -> Result<Value, GoogleApiError> {
        let url = format!(
            "{}/gmail/v1/users/me/messages/send",
            self.gmail_base.trim_end_matches('/')
        );
        let body = serde_json::json!({ "raw": raw_b64url });
        self.post_json(url, body).await
    }
}

async fn check_response<T: DeserializeOwned>(
    resp: Response,
    credential_id: &str,
) -> Result<T, GoogleApiError> {
    let status = resp.status();
    if status == StatusCode::UNAUTHORIZED {
        return Err(GoogleApiError::AuthExpired {
            credential_id: credential_id.to_string(),
        });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(GoogleApiError::Http {
            status: status.as_u16(),
            body,
        });
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| GoogleApiError::Transport(e.to_string()))?;
    if bytes.is_empty() {
        // Some endpoints (PATCH with no return body) return 200 with no
        // payload. Synthesize a JSON null so callers expecting `Value`
        // still deserialize cleanly.
        return serde_json::from_slice(b"null")
            .map_err(|e| GoogleApiError::Transport(e.to_string()));
    }
    serde_json::from_slice(&bytes).map_err(|e| GoogleApiError::Transport(e.to_string()))
}

/// Returns true if any entry in `has` covers `required` per Google's scope
/// hierarchy. We expose this so unit tests can pin down exactly which
/// hierarchy edges this pack honours — the function intentionally lists
/// every covered case rather than parsing scope strings, because Google's
/// scope tree is ad-hoc and "covered by" relationships are determined by
/// product policy not URI structure.
pub fn scope_satisfied(has: &[&str], required: &str) -> bool {
    if has.contains(&required) {
        return true;
    }
    let covers: &[(&str, &[&str])] = &[
        // gmail.modify covers read + send + label + archive (the actions
        // in this pack). gmail.readonly is a strict subset.
        (
            "https://www.googleapis.com/auth/gmail.modify",
            &["https://www.googleapis.com/auth/gmail.readonly"],
        ),
        // calendar covers calendar.readonly + calendar.events.
        (
            "https://www.googleapis.com/auth/calendar",
            &[
                "https://www.googleapis.com/auth/calendar.readonly",
                "https://www.googleapis.com/auth/calendar.events",
                "https://www.googleapis.com/auth/calendar.events.readonly",
            ],
        ),
        // calendar.events covers calendar.events.readonly.
        (
            "https://www.googleapis.com/auth/calendar.events",
            &["https://www.googleapis.com/auth/calendar.events.readonly"],
        ),
    ];
    has.iter().any(|h| {
        covers
            .iter()
            .any(|(parent, children)| h == parent && children.contains(&required))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_satisfied_exact_match() {
        let has = vec!["https://www.googleapis.com/auth/gmail.readonly"];
        assert!(scope_satisfied(
            &has,
            "https://www.googleapis.com/auth/gmail.readonly"
        ));
    }

    #[test]
    fn scope_satisfied_modify_covers_readonly() {
        let has = vec!["https://www.googleapis.com/auth/gmail.modify"];
        assert!(scope_satisfied(
            &has,
            "https://www.googleapis.com/auth/gmail.readonly"
        ));
    }

    #[test]
    fn scope_satisfied_readonly_does_not_cover_modify() {
        let has = vec!["https://www.googleapis.com/auth/gmail.readonly"];
        assert!(!scope_satisfied(
            &has,
            "https://www.googleapis.com/auth/gmail.modify"
        ));
    }

    #[test]
    fn scope_satisfied_calendar_covers_readonly_and_events() {
        let has = vec!["https://www.googleapis.com/auth/calendar"];
        assert!(scope_satisfied(
            &has,
            "https://www.googleapis.com/auth/calendar.readonly"
        ));
        assert!(scope_satisfied(
            &has,
            "https://www.googleapis.com/auth/calendar.events"
        ));
    }
}
