use aeqi_core::config::AuthMode;
use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

use crate::server::AppState;

/// User's allowed companies, resolved from the account store during auth.
/// Inserted into request extensions for downstream handlers to scope IPC calls.
#[derive(Debug, Clone)]
pub struct UserScope {
    pub companies: Vec<String>,
}

const PROXY_SCOPE_COMPANIES_HEADER: &str = "x-aeqi-allowed-companies";
const PROXY_SCOPE_TOKEN_HEADER: &str = "x-aeqi-scope-token";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub iat: usize,
    pub exp: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

/// Create a JWT token with optional user identity.
pub fn create_token(
    secret: &str,
    expiry_hours: u64,
    user_id: Option<&str>,
    email: Option<&str>,
) -> Result<String, jsonwebtoken::errors::Error> {
    let now = chrono::Utc::now().timestamp() as usize;
    let claims = Claims {
        sub: user_id.unwrap_or("operator").to_string(),
        iat: now,
        exp: now + (expiry_hours * 3600) as usize,
        user_id: user_id.map(|s| s.to_string()),
        email: email.map(|s| s.to_string()),
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

/// Validate a JWT token and return claims.
pub fn validate_token(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

/// Extract Bearer token from Authorization header.
fn extract_bearer(req: &Request) -> Option<&str> {
    req.headers()
        .get("authorization")?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
}

pub fn signing_secret(state: &AppState) -> &str {
    match state.auth_secret.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => "aeqi-dev",
    }
}

pub fn proxy_scope_from_headers(state: &AppState, headers: &HeaderMap) -> Option<UserScope> {
    let scope_header = headers
        .get(PROXY_SCOPE_COMPANIES_HEADER)?
        .to_str()
        .ok()?
        .trim();
    if scope_header.is_empty() {
        return None;
    }

    let Some(expected_token) = state.auth_secret.as_deref().filter(|s| !s.is_empty()) else {
        tracing::warn!("proxy scope header ignored: auth_secret not configured");
        return None;
    };

    let provided_token = headers
        .get(PROXY_SCOPE_TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided_token != expected_token {
        tracing::warn!("proxy scope header ignored: invalid scope token");
        return None;
    }

    let companies: Vec<String> = scope_header
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if companies.is_empty() {
        return None;
    }

    Some(UserScope { companies })
}

#[cfg(test)]
mod tests {
    use super::*;
    use aeqi_core::config::AuthConfig;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn create_and_validate_token_round_trip() {
        let secret = "test-secret-key";
        let token = create_token(secret, 1, Some("user-42"), Some("test@example.com")).unwrap();

        let claims = validate_token(&token, secret).unwrap();
        assert_eq!(claims.sub, "user-42");
        assert_eq!(claims.user_id.as_deref(), Some("user-42"));
        assert_eq!(claims.email.as_deref(), Some("test@example.com"));
    }

    #[test]
    fn create_token_without_user_defaults_sub_to_operator() {
        let secret = "test-secret";
        let token = create_token(secret, 1, None, None).unwrap();

        let claims = validate_token(&token, secret).unwrap();
        assert_eq!(claims.sub, "operator");
        assert!(claims.user_id.is_none());
        assert!(claims.email.is_none());
    }

    #[test]
    fn validate_token_wrong_secret_fails() {
        let token = create_token("secret-a", 1, Some("user"), None).unwrap();
        assert!(validate_token(&token, "secret-b").is_err());
    }

    #[test]
    fn validate_token_expired_fails() {
        // Create a token that expired 1 hour ago by using 0 hours expiry
        // (the exp would be in the past since we set it to now + 0).
        let secret = "test-secret";
        let now = chrono::Utc::now().timestamp() as usize;
        let claims = Claims {
            sub: "user".to_string(),
            iat: now - 7200,
            exp: now - 3600, // expired 1 hour ago
            user_id: None,
            email: None,
        };
        let token = jsonwebtoken::encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
        )
        .unwrap();

        assert!(validate_token(&token, secret).is_err());
    }

    #[test]
    fn validate_token_garbage_fails() {
        assert!(validate_token("not.a.jwt", "secret").is_err());
    }

    fn test_hosting() -> std::sync::Arc<dyn aeqi_hosting::HostingProvider> {
        let config = aeqi_hosting::HostingConfig {
            provider: "none".to_string(),
            local: None,
            managed: None,
        };
        std::sync::Arc::from(aeqi_hosting::from_config(&config).unwrap())
    }

    fn test_state(auth_secret: Option<String>) -> AppState {
        AppState {
            ipc: std::sync::Arc::new(crate::ipc::IpcClient::new("/tmp/test.sock".into())),
            auth_secret,
            auth_mode: AuthMode::None,
            auth_config: AuthConfig::default(),
            agents_config: vec![],
            ui_dist_dir: None,
            accounts: None,
            smtp: None,
            hosting: test_hosting(),
        }
    }

    #[test]
    fn signing_secret_returns_configured_value() {
        let state = test_state(Some("my-secret".to_string()));
        assert_eq!(signing_secret(&state), "my-secret");
    }

    #[test]
    fn signing_secret_falls_back_to_default() {
        let state = test_state(None);
        assert_eq!(signing_secret(&state), "aeqi-dev");
    }

    #[test]
    fn signing_secret_empty_string_falls_back() {
        let state = test_state(Some("".to_string()));
        assert_eq!(signing_secret(&state), "aeqi-dev");
    }

    #[test]
    fn proxy_scope_from_headers_returns_companies_for_valid_token() {
        let state = test_state(Some("scope-secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(
            PROXY_SCOPE_COMPANIES_HEADER,
            HeaderValue::from_static("aeqi, founder-lab"),
        );
        headers.insert(
            PROXY_SCOPE_TOKEN_HEADER,
            HeaderValue::from_static("scope-secret"),
        );

        let scope = proxy_scope_from_headers(&state, &headers).expect("scope should resolve");
        assert_eq!(scope.companies, vec!["aeqi", "founder-lab"]);
    }

    #[test]
    fn proxy_scope_from_headers_rejects_invalid_token() {
        let state = test_state(Some("scope-secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(
            PROXY_SCOPE_COMPANIES_HEADER,
            HeaderValue::from_static("aeqi"),
        );
        headers.insert(
            PROXY_SCOPE_TOKEN_HEADER,
            HeaderValue::from_static("wrong-secret"),
        );

        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }
}

/// Axum middleware — dispatches by auth mode.
pub async fn require_auth(State(state): State<AppState>, mut req: Request, next: Next) -> Response {
    match state.auth_mode {
        AuthMode::None => {
            if let Some(scope) = proxy_scope_from_headers(&state, req.headers()) {
                req.extensions_mut().insert(scope);
            }
            next.run(req).await
        }
        AuthMode::Secret | AuthMode::Accounts => {
            let secret = signing_secret(&state);
            let Some(token) = extract_bearer(&req) else {
                tracing::warn!("auth: missing authorization header");
                return (
                    StatusCode::UNAUTHORIZED,
                    axum::Json(
                        serde_json::json!({"ok": false, "error": "missing authorization header"}),
                    ),
                )
                    .into_response();
            };
            match validate_token(token, secret) {
                Ok(claims) => {
                    // Resolve user's companies for tenant scoping.
                    if let Some(accounts) = &state.accounts {
                        let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
                        if let Ok(Some(user)) = accounts.get_user_by_id(user_id) {
                            let companies = user.companies.unwrap_or_default();
                            req.extensions_mut().insert(UserScope { companies });
                        }
                    }
                    req.extensions_mut().insert(claims);
                    next.run(req).await
                }
                Err(_) => {
                    tracing::warn!("auth: invalid or expired token");
                    (
                        StatusCode::UNAUTHORIZED,
                        axum::Json(
                            serde_json::json!({"ok": false, "error": "invalid or expired token"}),
                        ),
                    )
                        .into_response()
                }
            }
        }
    }
}
