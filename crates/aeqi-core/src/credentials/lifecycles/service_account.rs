//! `service_account` lifecycle — GCP-shaped JSON key file.
//!
//! Blob shape (JSON):
//! ```json
//! {
//!   "key_file": { ... GCP service-account JSON ... },
//!   "scopes": ["https://www.googleapis.com/auth/cloud-platform"],
//!   "cached_token": "ya29...",
//!   "cached_token_expires_at": "ISO8601"
//! }
//! ```
//!
//! Resolve = mint short-lived OAuth token via service-account JWT (RS256
//! signed) hitting the OAuth2 token endpoint with
//! `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`.

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

const TOKEN_TTL_SAFETY_SECS: i64 = 30;
const DEFAULT_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredKey {
    /// Raw GCP service-account JSON. Required fields: `client_email`,
    /// `private_key`, `token_uri`.
    key_file: serde_json::Value,
    scopes: Vec<String>,
    #[serde(default)]
    cached_token: Option<String>,
    #[serde(default)]
    cached_token_expires_at: Option<String>,
}

#[derive(Debug, Serialize)]
struct JwtClaims<'a> {
    iss: &'a str,
    scope: &'a str,
    aud: &'a str,
    iat: i64,
    exp: i64,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<i64>,
}

pub struct ServiceAccountLifecycle;

impl Default for ServiceAccountLifecycle {
    fn default() -> Self {
        Self
    }
}

impl ServiceAccountLifecycle {
    fn extract_str(key_file: &serde_json::Value, field: &str) -> Result<String> {
        key_file
            .get(field)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| anyhow::anyhow!("service-account key_file missing '{field}'"))
    }

    async fn mint_token(
        http: &reqwest::Client,
        stored: &StoredKey,
    ) -> Result<(String, DateTime<Utc>)> {
        let client_email = Self::extract_str(&stored.key_file, "client_email")?;
        let private_key = Self::extract_str(&stored.key_file, "private_key")?;
        let token_uri = stored
            .key_file
            .get("token_uri")
            .and_then(|v| v.as_str())
            .unwrap_or(DEFAULT_TOKEN_URL)
            .to_string();
        let scope = stored.scopes.join(" ");
        let now = Utc::now().timestamp();
        let claims = JwtClaims {
            iss: client_email.as_str(),
            scope: scope.as_str(),
            aud: token_uri.as_str(),
            iat: now,
            exp: now + 3600,
        };
        let header = Header::new(jsonwebtoken::Algorithm::RS256);
        let key = EncodingKey::from_rsa_pem(private_key.as_bytes())
            .context("invalid service-account private_key PEM")?;
        let assertion = encode(&header, &claims, &key).context("JWT signing failed")?;
        let resp = http
            .post(&token_uri)
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
                ("assertion", assertion.as_str()),
            ])
            .send()
            .await
            .context("service-account token POST failed")?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            anyhow::bail!("service-account token mint failed: status={status} body={body}");
        }
        let parsed: TokenResponse = serde_json::from_str(&body)
            .with_context(|| format!("invalid service-account token response: {body}"))?;
        let expires_at = parsed
            .expires_in
            .map(|secs| Utc::now() + Duration::seconds(secs))
            .unwrap_or_else(|| Utc::now() + Duration::seconds(3600));
        Ok((parsed.access_token, expires_at))
    }
}

#[async_trait]
impl CredentialLifecycle for ServiceAccountLifecycle {
    fn kind(&self) -> &'static str {
        "service_account"
    }

    fn validate(&self, blob: &[u8], _metadata: &serde_json::Value) -> Result<()> {
        let stored: StoredKey =
            serde_json::from_slice(blob).context("service_account blob must be StoredKey JSON")?;
        for field in ["client_email", "private_key"] {
            if stored.key_file.get(field).is_none() {
                anyhow::bail!("service_account key_file missing '{field}'");
            }
        }
        if stored.scopes.is_empty() {
            anyhow::bail!("service_account scopes must not be empty");
        }
        Ok(())
    }

    async fn resolve(&self, ctx: &CredentialResolveContext<'_>) -> Result<UsableCredential> {
        let mut stored: StoredKey =
            serde_json::from_slice(ctx.plaintext).context("service_account shape mismatch")?;
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
            let http = ctx.http.ok_or_else(|| {
                anyhow::anyhow!("service_account needs an HTTP client to mint tokens")
            })?;
            let (token, exp) = Self::mint_token(http, &stored).await?;
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
            serde_json::from_slice(ctx.plaintext).context("service_account shape mismatch")?;
        let http = match ctx.http {
            Some(h) => h,
            None => {
                return Ok(RefreshResult::Failed(
                    CredentialReasonCode::RefreshFailed,
                    "no HTTP client available".into(),
                ));
            }
        };
        let (token, exp) = match Self::mint_token(http, &stored).await {
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
        Ok(())
    }

    async fn bootstrap(&self, ctx: &CredentialBootstrapContext<'_>) -> Result<BootstrappedRow> {
        let key_file = ctx
            .config
            .get("key_file")
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("service_account bootstrap requires 'key_file'"))?;
        let scopes: Vec<String> = match ctx.config.get("scopes") {
            Some(serde_json::Value::Array(arr)) => arr
                .iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
            _ => vec![],
        };
        if scopes.is_empty() {
            anyhow::bail!("service_account bootstrap requires non-empty 'scopes' array");
        }
        let stored = StoredKey {
            key_file,
            scopes,
            cached_token: None,
            cached_token_expires_at: None,
        };
        let plaintext_blob = serde_json::to_vec(&stored)?;
        Ok(BootstrappedRow {
            plaintext_blob,
            metadata: serde_json::json!({}),
            expires_at: None,
            instructions: None,
        })
    }
}
