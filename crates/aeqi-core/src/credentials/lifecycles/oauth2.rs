//! `oauth2` lifecycle — PKCE + loopback callback + refresh.
//!
//! Blob shape (JSON):
//! ```json
//! {
//!   "access_token": "...",
//!   "refresh_token": "...",
//!   "token_type": "Bearer",
//!   "scope": "scope1 scope2"
//! }
//! ```
//!
//! Metadata shape:
//! ```json
//! {
//!   "provider_kind": "google" | "github" | "...",
//!   "token_url": "https://oauth2.googleapis.com/token",
//!   "auth_url": "https://accounts.google.com/o/oauth2/v2/auth",
//!   "revoke_url": "https://oauth2.googleapis.com/revoke",
//!   "client_id": "...",
//!   "scopes": ["scope1", "scope2"],
//!   "expires_at": "ISO8601"
//! }
//! ```
//!
//! Refresh-token reuse defence: every successful refresh writes the new
//! `refresh_token` returned by the provider (or keeps the old one if the
//! provider didn't rotate). Storage replacement is atomic via the resolver's
//! `update` path.

use anyhow::{Context, Result};
use async_trait::async_trait;
use base64::Engine;
use chrono::{Duration, Utc};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::credentials::lifecycle::{BootstrappedRow, CredentialLifecycle};
use crate::credentials::types::{
    CredentialBootstrapContext, CredentialReasonCode, CredentialResolveContext, RefreshResult,
    UsableCredential,
};

/// Provider-side static config — token endpoint, auth endpoint, revoke
/// endpoint, client_id. Stored in the row's metadata by `bootstrap`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuth2ProviderConfig {
    pub provider_kind: String,
    pub auth_url: String,
    pub token_url: String,
    pub revoke_url: Option<String>,
    pub client_id: String,
    /// Optional client secret — for confidential clients. PKCE-only public
    /// clients leave this `None`.
    pub client_secret: Option<String>,
    pub scopes: Vec<String>,
    /// The redirect URI registered with the provider (typically a loopback
    /// address: `http://localhost:<port>/callback`).
    pub redirect_uri: String,
}

/// Stored OAuth2 token shape — the JSON written into the credentials row's
/// blob. Public so callers driving an explicit code-exchange flow can build
/// it directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredTokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default = "default_token_type")]
    pub token_type: String,
    #[serde(default)]
    pub scope: String,
}

fn default_token_type() -> String {
    "Bearer".into()
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    scope: Option<String>,
}

pub struct OAuth2Lifecycle;

impl Default for OAuth2Lifecycle {
    fn default() -> Self {
        Self
    }
}

impl OAuth2Lifecycle {
    /// Build the consent URL for the PKCE flow. Caller is expected to open
    /// it in a browser, capture the redirect, and feed the code back to
    /// `exchange_code`. Returns `(url, code_verifier)` — the verifier must
    /// be retained until the redirect completes so the token exchange has
    /// it.
    pub fn build_consent_url(provider: &OAuth2ProviderConfig, state: &str) -> (String, String) {
        let mut verifier_bytes = [0u8; 32];
        rand::rng().fill_bytes(&mut verifier_bytes);
        let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(verifier_bytes);
        let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(verifier.as_bytes()));
        let scope = provider.scopes.join(" ");
        let url = format!(
            "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}\
             &code_challenge={}&code_challenge_method=S256",
            provider.auth_url,
            urlencoding::encode(&provider.client_id),
            urlencoding::encode(&provider.redirect_uri),
            urlencoding::encode(&scope),
            urlencoding::encode(state),
            urlencoding::encode(&challenge),
        );
        (url, verifier)
    }

    /// Exchange a freshly-captured code for tokens. Used by `bootstrap` and
    /// by callers driving an explicit consent flow.
    pub async fn exchange_code(
        http: &reqwest::Client,
        provider: &OAuth2ProviderConfig,
        code: &str,
        code_verifier: &str,
    ) -> Result<(StoredTokens, Option<chrono::DateTime<chrono::Utc>>)> {
        let mut form = vec![
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", provider.redirect_uri.as_str()),
            ("client_id", provider.client_id.as_str()),
            ("code_verifier", code_verifier),
        ];
        if let Some(ref s) = provider.client_secret {
            form.push(("client_secret", s.as_str()));
        }
        let resp = http
            .post(&provider.token_url)
            .form(&form)
            .send()
            .await
            .context("oauth2 token exchange POST failed")?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("oauth2 token exchange failed: {status} body={body}");
        }
        let parsed: TokenResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid token response: {body}"))?;
        let expires_at = parsed
            .expires_in
            .map(|secs| Utc::now() + Duration::seconds(secs));
        let tokens = StoredTokens {
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
            token_type: parsed.token_type.unwrap_or_else(default_token_type),
            scope: parsed.scope.unwrap_or_default(),
        };
        Ok((tokens, expires_at))
    }
}

#[async_trait]
impl CredentialLifecycle for OAuth2Lifecycle {
    fn kind(&self) -> &'static str {
        "oauth2"
    }

    fn validate(&self, blob: &[u8], metadata: &serde_json::Value) -> Result<()> {
        let _: StoredTokens =
            serde_json::from_slice(blob).context("oauth2 blob must be StoredTokens-shaped JSON")?;
        // Ensure required metadata fields are present.
        for field in ["provider_kind", "token_url", "client_id"] {
            if metadata.get(field).is_none() {
                anyhow::bail!("oauth2 metadata missing '{field}'");
            }
        }
        Ok(())
    }

    async fn resolve(&self, ctx: &CredentialResolveContext<'_>) -> Result<UsableCredential> {
        let tokens: StoredTokens =
            serde_json::from_slice(ctx.plaintext).context("oauth2 blob shape mismatch")?;
        let header = format!("{} {}", tokens.token_type, tokens.access_token);
        Ok(UsableCredential {
            id: ctx.row.id.clone(),
            provider: ctx.row.provider.clone(),
            name: ctx.row.name.clone(),
            headers: vec![("Authorization".to_string(), header)],
            bearer: Some(tokens.access_token),
            raw: ctx.plaintext.to_vec(),
            metadata: ctx.metadata.clone(),
        })
    }

    async fn refresh(&self, ctx: &CredentialResolveContext<'_>) -> Result<RefreshResult> {
        let tokens: StoredTokens =
            serde_json::from_slice(ctx.plaintext).context("oauth2 blob shape mismatch")?;
        let refresh_token = match tokens.refresh_token.clone() {
            Some(t) if !t.is_empty() => t,
            _ => {
                return Ok(RefreshResult::Failed(
                    CredentialReasonCode::RefreshFailed,
                    "no refresh_token stored — re-bootstrap required".into(),
                ));
            }
        };
        let token_url = ctx
            .metadata
            .get("token_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("oauth2 metadata missing 'token_url'"))?;
        let client_id = ctx
            .metadata
            .get("client_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("oauth2 metadata missing 'client_id'"))?;
        let client_secret = ctx
            .metadata
            .get("client_secret")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let http = match ctx.http {
            Some(h) => h,
            None => {
                return Ok(RefreshResult::Failed(
                    CredentialReasonCode::RefreshFailed,
                    "no HTTP client available for refresh".into(),
                ));
            }
        };

        let mut form: Vec<(&str, &str)> = vec![
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", client_id),
        ];
        if let Some(ref s) = client_secret {
            form.push(("client_secret", s.as_str()));
        }
        let resp = match http.post(token_url).form(&form).send().await {
            Ok(r) => r,
            Err(e) => {
                return Ok(RefreshResult::Failed(
                    CredentialReasonCode::RefreshFailed,
                    format!("token endpoint POST failed: {e}"),
                ));
            }
        };
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            // 400 invalid_grant is the strongest signal of provider-side
            // revocation.
            let code = if body.contains("invalid_grant") {
                CredentialReasonCode::RevokedByProvider
            } else {
                CredentialReasonCode::RefreshFailed
            };
            return Ok(RefreshResult::Failed(
                code,
                format!("refresh failed status={status} body={body}"),
            ));
        }
        let parsed: TokenResponse = match serde_json::from_str(&body) {
            Ok(p) => p,
            Err(e) => {
                return Ok(RefreshResult::Failed(
                    CredentialReasonCode::RefreshFailed,
                    format!("token response parse failed: {e} body={body}"),
                ));
            }
        };
        // Provider may rotate the refresh_token; if so, replace it. Otherwise
        // keep the previous one.
        let new_refresh = parsed
            .refresh_token
            .clone()
            .or_else(|| Some(refresh_token.clone()));
        let new_tokens = StoredTokens {
            access_token: parsed.access_token.clone(),
            refresh_token: new_refresh.clone(),
            token_type: parsed.token_type.unwrap_or_else(default_token_type),
            scope: parsed.scope.unwrap_or_else(|| tokens.scope.clone()),
        };
        let plaintext = serde_json::to_vec(&new_tokens)?;
        let mut new_meta = ctx.metadata.clone();
        let new_expires = parsed
            .expires_in
            .map(|secs| Utc::now() + Duration::seconds(secs));
        if let serde_json::Value::Object(ref mut map) = new_meta {
            if let Some(exp) = new_expires {
                map.insert(
                    "expires_at".into(),
                    serde_json::Value::String(exp.to_rfc3339()),
                );
            } else {
                map.remove("expires_at");
            }
        }
        let header = format!("{} {}", new_tokens.token_type, new_tokens.access_token);
        let usable = UsableCredential {
            id: ctx.row.id.clone(),
            provider: ctx.row.provider.clone(),
            name: ctx.row.name.clone(),
            headers: vec![("Authorization".into(), header)],
            bearer: Some(new_tokens.access_token.clone()),
            raw: plaintext,
            metadata: new_meta,
        };
        Ok(RefreshResult::Refreshed(usable))
    }

    async fn revoke(&self, ctx: &CredentialResolveContext<'_>) -> Result<()> {
        let tokens: StoredTokens =
            serde_json::from_slice(ctx.plaintext).context("oauth2 blob shape mismatch")?;
        let revoke_url = ctx
            .metadata
            .get("revoke_url")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        if let (Some(url), Some(http)) = (revoke_url, ctx.http) {
            let target = tokens
                .refresh_token
                .clone()
                .unwrap_or_else(|| tokens.access_token.clone());
            // Best-effort — don't block delete on a failed revocation call.
            if let Err(e) = http
                .post(&url)
                .form(&[("token", target.as_str())])
                .send()
                .await
            {
                tracing::warn!(error = %e, "oauth2 revoke endpoint POST failed (ignored)");
            }
        }
        Ok(())
    }

    async fn bootstrap(&self, ctx: &CredentialBootstrapContext<'_>) -> Result<BootstrappedRow> {
        // Two bootstrap modes:
        //   1. "preauthorized" — caller hands in already-exchanged tokens
        //      and provider config (used by tests + programmatic flows).
        //   2. "code_exchange" — caller hands in `code` + `code_verifier` +
        //      provider config; we run the token exchange.
        let provider: OAuth2ProviderConfig = serde_json::from_value(
            ctx.config
                .get("provider")
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("oauth2 bootstrap missing 'provider' config"))?,
        )
        .context("invalid OAuth2ProviderConfig")?;
        let (tokens, expires_at) = if let Some(tokens_val) = ctx.config.get("tokens") {
            let tokens: StoredTokens =
                serde_json::from_value(tokens_val.clone()).context("invalid 'tokens' shape")?;
            let exp = ctx
                .config
                .get("expires_at")
                .and_then(|v| v.as_str())
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.with_timezone(&Utc));
            (tokens, exp)
        } else {
            let code = ctx
                .config
                .get("code")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("oauth2 bootstrap missing 'code'"))?;
            let verifier = ctx
                .config
                .get("code_verifier")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("oauth2 bootstrap missing 'code_verifier'"))?;
            let http = ctx
                .http
                .ok_or_else(|| anyhow::anyhow!("oauth2 code_exchange requires http client"))?;
            OAuth2Lifecycle::exchange_code(http, &provider, code, verifier).await?
        };
        let mut metadata = serde_json::json!({
            "provider_kind": provider.provider_kind,
            "token_url": provider.token_url,
            "auth_url": provider.auth_url,
            "revoke_url": provider.revoke_url,
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
            "scopes": provider.scopes,
            "redirect_uri": provider.redirect_uri,
        });
        if let Some(exp) = expires_at
            && let serde_json::Value::Object(ref mut map) = metadata
        {
            map.insert(
                "expires_at".into(),
                serde_json::Value::String(exp.to_rfc3339()),
            );
        }
        let plaintext_blob = serde_json::to_vec(&tokens)?;
        Ok(BootstrappedRow {
            plaintext_blob,
            metadata,
            expires_at,
            instructions: None,
        })
    }
}
