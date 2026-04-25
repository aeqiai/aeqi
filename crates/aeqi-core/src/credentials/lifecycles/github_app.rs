//! `github_app` lifecycle — JWT-signed installation tokens.
//!
//! Blob shape (JSON):
//! ```json
//! {
//!   "app_id": "12345",
//!   "private_key_pem": "-----BEGIN RSA PRIVATE KEY-----\n...",
//!   "installation_id": "67890",
//!   "cached_token": "ghs_abc...",   // optional, present after first mint
//!   "cached_token_expires_at": "ISO8601"
//! }
//! ```
//!
//! Resolve:
//! - If `cached_token` is non-expired (with 30s safety margin) return it.
//! - Otherwise mint a fresh installation token via the GitHub API:
//!   POST `https://api.github.com/app/installations/{id}/access_tokens`
//!   `Authorization: Bearer <jwt-signed-with-app-private-key>`
//!
//! Refresh: same as Resolve but always mints fresh.
//!
//! Bootstrap: caller hands in `app_id`, `private_key_pem`,
//! `installation_id` (acquired from the GitHub App install flow). Optional
//! `api_base` to point at GitHub Enterprise.

use anyhow::{Context, Result};
use async_trait::async_trait;
use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{EncodingKey, Header, encode};
use serde::{Deserialize, Serialize};

use crate::credentials::lifecycle::{BootstrappedRow, CredentialLifecycle};
use crate::credentials::types::{
    CredentialBootstrapContext, CredentialReasonCode, CredentialResolveContext, RefreshResult,
    UsableCredential,
};

const DEFAULT_API_BASE: &str = "https://api.github.com";
const TOKEN_TTL_SAFETY_SECS: i64 = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredKey {
    app_id: String,
    private_key_pem: String,
    installation_id: String,
    #[serde(default)]
    cached_token: Option<String>,
    #[serde(default)]
    cached_token_expires_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct JwtClaims<'a> {
    iat: i64,
    exp: i64,
    iss: &'a str,
}

#[derive(Debug, Deserialize)]
struct InstallationTokenResponse {
    token: String,
    expires_at: String,
}

pub struct GithubAppLifecycle;

impl Default for GithubAppLifecycle {
    fn default() -> Self {
        Self
    }
}

impl GithubAppLifecycle {
    fn sign_app_jwt(stored: &StoredKey) -> Result<String> {
        let now = Utc::now().timestamp();
        let claims = JwtClaims {
            iat: now - 60,
            exp: now + 9 * 60,
            iss: stored.app_id.as_str(),
        };
        let header = Header::new(jsonwebtoken::Algorithm::RS256);
        let key = EncodingKey::from_rsa_pem(stored.private_key_pem.as_bytes())
            .context("invalid GitHub App private key PEM")?;
        encode(&header, &claims, &key).context("JWT signing failed")
    }

    async fn mint_installation_token(
        http: &reqwest::Client,
        api_base: &str,
        stored: &StoredKey,
    ) -> Result<(String, DateTime<Utc>)> {
        let jwt = Self::sign_app_jwt(stored)?;
        let url = format!(
            "{}/app/installations/{}/access_tokens",
            api_base.trim_end_matches('/'),
            stored.installation_id
        );
        let resp = http
            .post(&url)
            .bearer_auth(jwt)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .context("github app token POST failed")?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("github app token mint failed: status={status} body={body}");
        }
        let parsed: InstallationTokenResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid installation token response: {body}"))?;
        let expires_at = DateTime::parse_from_rfc3339(&parsed.expires_at)
            .map(|d| d.with_timezone(&Utc))
            .context("github expires_at parse failed")?;
        Ok((parsed.token, expires_at))
    }

    fn api_base(metadata: &serde_json::Value) -> String {
        metadata
            .get("api_base")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_API_BASE)
            .to_string()
    }
}

#[async_trait]
impl CredentialLifecycle for GithubAppLifecycle {
    fn kind(&self) -> &'static str {
        "github_app"
    }

    fn validate(&self, blob: &[u8], _metadata: &serde_json::Value) -> Result<()> {
        let stored: StoredKey =
            serde_json::from_slice(blob).context("github_app blob must be StoredKey JSON")?;
        if stored.app_id.is_empty() {
            anyhow::bail!("github_app: app_id required");
        }
        if stored.installation_id.is_empty() {
            anyhow::bail!("github_app: installation_id required");
        }
        if stored.private_key_pem.is_empty() {
            anyhow::bail!("github_app: private_key_pem required");
        }
        Ok(())
    }

    async fn resolve(&self, ctx: &CredentialResolveContext<'_>) -> Result<UsableCredential> {
        let mut stored: StoredKey =
            serde_json::from_slice(ctx.plaintext).context("github_app blob shape mismatch")?;
        let now = Utc::now();
        let valid = match (&stored.cached_token, &stored.cached_token_expires_at) {
            (Some(t), Some(exp_str)) if !t.is_empty() => {
                match DateTime::parse_from_rfc3339(exp_str) {
                    Ok(exp) => {
                        let exp = exp.with_timezone(&Utc);
                        exp > now + Duration::seconds(TOKEN_TTL_SAFETY_SECS)
                    }
                    Err(_) => false,
                }
            }
            _ => false,
        };
        let (token, _exp) = if valid {
            (
                stored.cached_token.clone().unwrap(),
                stored
                    .cached_token_expires_at
                    .as_deref()
                    .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or(now),
            )
        } else {
            let http = ctx
                .http
                .ok_or_else(|| anyhow::anyhow!("github_app needs an HTTP client to mint tokens"))?;
            let api_base = Self::api_base(ctx.metadata);
            let (token, exp) = Self::mint_installation_token(http, &api_base, &stored).await?;
            stored.cached_token = Some(token.clone());
            stored.cached_token_expires_at = Some(exp.to_rfc3339());
            (token, exp)
        };
        Ok(UsableCredential {
            id: ctx.row.id.clone(),
            provider: ctx.row.provider.clone(),
            name: ctx.row.name.clone(),
            headers: vec![("Authorization".into(), format!("Bearer {token}"))],
            bearer: Some(token),
            raw: serde_json::to_vec(&stored)?,
            metadata: ctx.metadata.clone(),
        })
    }

    async fn refresh(&self, ctx: &CredentialResolveContext<'_>) -> Result<RefreshResult> {
        let mut stored: StoredKey =
            serde_json::from_slice(ctx.plaintext).context("github_app blob shape mismatch")?;
        let http = match ctx.http {
            Some(h) => h,
            None => {
                return Ok(RefreshResult::Failed(
                    CredentialReasonCode::RefreshFailed,
                    "no HTTP client available".into(),
                ));
            }
        };
        let api_base = Self::api_base(ctx.metadata);
        let (token, exp) = match Self::mint_installation_token(http, &api_base, &stored).await {
            Ok(pair) => pair,
            Err(e) => {
                return Ok(RefreshResult::Failed(
                    CredentialReasonCode::RefreshFailed,
                    format!("{e}"),
                ));
            }
        };
        stored.cached_token = Some(token.clone());
        stored.cached_token_expires_at = Some(exp.to_rfc3339());
        let plaintext = serde_json::to_vec(&stored)?;
        let mut new_meta = ctx.metadata.clone();
        if let serde_json::Value::Object(ref mut m) = new_meta {
            m.insert(
                "expires_at".into(),
                serde_json::Value::String(exp.to_rfc3339()),
            );
        }
        Ok(RefreshResult::Refreshed(UsableCredential {
            id: ctx.row.id.clone(),
            provider: ctx.row.provider.clone(),
            name: ctx.row.name.clone(),
            headers: vec![("Authorization".into(), format!("Bearer {token}"))],
            bearer: Some(token),
            raw: plaintext,
            metadata: new_meta,
        }))
    }

    async fn revoke(&self, _ctx: &CredentialResolveContext<'_>) -> Result<()> {
        // GitHub App installation tokens self-expire — revoke is a no-op
        // beyond row deletion.
        Ok(())
    }

    async fn bootstrap(&self, ctx: &CredentialBootstrapContext<'_>) -> Result<BootstrappedRow> {
        let app_id = ctx
            .config
            .get("app_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("github_app bootstrap requires 'app_id'"))?;
        let private_key_pem = ctx
            .config
            .get("private_key_pem")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("github_app bootstrap requires 'private_key_pem'"))?;
        let installation_id = ctx
            .config
            .get("installation_id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("github_app bootstrap requires 'installation_id'"))?;
        let api_base = ctx
            .config
            .get("api_base")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_API_BASE)
            .to_string();
        let stored = StoredKey {
            app_id: app_id.to_string(),
            private_key_pem: private_key_pem.to_string(),
            installation_id: installation_id.to_string(),
            cached_token: None,
            cached_token_expires_at: None,
        };
        let plaintext_blob = serde_json::to_vec(&stored)?;
        let metadata = serde_json::json!({
            "api_base": api_base,
        });
        Ok(BootstrappedRow {
            plaintext_blob,
            metadata,
            expires_at: None,
            instructions: None,
        })
    }
}
