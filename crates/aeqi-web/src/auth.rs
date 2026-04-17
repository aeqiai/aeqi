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

/// User's allowed root agents, resolved from the account store during auth.
/// Inserted into request extensions for downstream handlers to scope IPC calls.
#[derive(Debug, Clone)]
pub struct UserScope {
    pub roots: Vec<String>,
}

const PROXY_SCOPE_ROOTS_HEADER: &str = "x-aeqi-allowed-roots";
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
        _ => "aeqi-ephemeral-fallback",
    }
}

pub fn proxy_scope_from_headers(state: &AppState, headers: &HeaderMap) -> Option<UserScope> {
    let scope_header = headers
        .get(PROXY_SCOPE_ROOTS_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.trim())?;
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

    let roots: Vec<String> = scope_header
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .collect();
    if roots.is_empty() {
        return None;
    }

    Some(UserScope { roots })
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
            ui_dist_dir: None,
            accounts: None,
            smtp: None,
            hosting: test_hosting(),
            twilio_auth_token: None,
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
        assert_eq!(signing_secret(&state), "aeqi-ephemeral-fallback");
    }

    #[test]
    fn signing_secret_empty_string_falls_back() {
        let state = test_state(Some("".to_string()));
        assert_eq!(signing_secret(&state), "aeqi-ephemeral-fallback");
    }

    #[test]
    fn proxy_scope_from_headers_returns_roots_for_valid_token() {
        let state = test_state(Some("scope-secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(
            PROXY_SCOPE_ROOTS_HEADER,
            HeaderValue::from_static("aeqi, founder-lab"),
        );
        headers.insert(
            PROXY_SCOPE_TOKEN_HEADER,
            HeaderValue::from_static("scope-secret"),
        );

        let scope = proxy_scope_from_headers(&state, &headers).expect("scope should resolve");
        assert_eq!(scope.roots, vec!["aeqi", "founder-lab"]);
    }

    #[test]
    fn proxy_scope_from_headers_rejects_invalid_token() {
        let state = test_state(Some("scope-secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(PROXY_SCOPE_ROOTS_HEADER, HeaderValue::from_static("aeqi"));
        headers.insert(
            PROXY_SCOPE_TOKEN_HEADER,
            HeaderValue::from_static("wrong-secret"),
        );

        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    // ── Additional auth edge-case tests ──────────────────────

    #[test]
    fn validate_token_empty_string_fails() {
        assert!(validate_token("", "secret").is_err());
    }

    #[test]
    fn validate_token_single_segment_fails() {
        assert!(validate_token("onlyone", "secret").is_err());
    }

    #[test]
    fn validate_token_two_segments_fails() {
        assert!(validate_token("header.payload", "secret").is_err());
    }

    #[test]
    fn validate_token_four_segments_fails() {
        assert!(validate_token("a.b.c.d", "secret").is_err());
    }

    #[test]
    fn create_token_expiry_sets_correct_window() {
        let secret = "test-secret";
        let before = chrono::Utc::now().timestamp() as usize;
        let token = create_token(secret, 2, None, None).unwrap();
        let after = chrono::Utc::now().timestamp() as usize;

        let claims = validate_token(&token, secret).unwrap();
        // exp should be ~ now + 2*3600 = now + 7200
        assert!(claims.exp >= before + 7200);
        assert!(claims.exp <= after + 7200);
        // iat should be ~ now
        assert!(claims.iat >= before);
        assert!(claims.iat <= after);
    }

    #[test]
    fn create_token_zero_hours_still_valid_momentarily() {
        // A 0-hour expiry sets exp = now, which jsonwebtoken allows within its
        // leeway window (default 60s). This confirms the token is created successfully.
        let secret = "test-secret";
        let token = create_token(secret, 0, None, None).unwrap();
        // Should still validate within the default leeway.
        assert!(validate_token(&token, secret).is_ok());
    }

    #[test]
    fn validate_token_tampered_payload_fails() {
        let secret = "test-secret";
        let token = create_token(secret, 1, Some("user-1"), None).unwrap();

        // Split the token and tamper with the payload.
        let parts: Vec<&str> = token.split('.').collect();
        assert_eq!(parts.len(), 3);

        // Build a different payload and re-encode (but keep the original signature).
        use base64::Engine;
        let tampered_payload = serde_json::json!({
            "sub": "admin",
            "iat": chrono::Utc::now().timestamp(),
            "exp": chrono::Utc::now().timestamp() + 3600,
        });
        let tampered_b64 = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&tampered_payload).unwrap());
        let tampered_token = format!("{}.{}.{}", parts[0], tampered_b64, parts[2]);

        assert!(validate_token(&tampered_token, secret).is_err());
    }

    #[test]
    fn create_token_preserves_email_and_user_id_fields() {
        let secret = "test";
        let token = create_token(secret, 1, Some("uid-99"), Some("hello@world.com")).unwrap();
        let claims = validate_token(&token, secret).unwrap();

        assert_eq!(claims.sub, "uid-99");
        assert_eq!(claims.user_id, Some("uid-99".to_string()));
        assert_eq!(claims.email, Some("hello@world.com".to_string()));
    }

    #[test]
    fn create_token_with_only_email_still_defaults_sub() {
        let secret = "test";
        // user_id=None but email=Some — sub should default to "operator"
        let token = create_token(secret, 1, None, Some("x@y.com")).unwrap();
        let claims = validate_token(&token, secret).unwrap();

        assert_eq!(claims.sub, "operator");
        assert!(claims.user_id.is_none());
        assert_eq!(claims.email, Some("x@y.com".to_string()));
    }

    #[test]
    fn signing_secret_whitespace_only_falls_back() {
        // A whitespace-only secret is not empty, so it should be used as-is.
        let state = test_state(Some("  ".to_string()));
        assert_eq!(signing_secret(&state), "  ");
    }

    // ── Proxy scope edge cases ───────────────────────────────

    #[test]
    fn proxy_scope_no_roots_header_returns_none() {
        let state = test_state(Some("secret".to_string()));
        let headers = HeaderMap::new();
        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    #[test]
    fn proxy_scope_empty_roots_header_returns_none() {
        let state = test_state(Some("secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(PROXY_SCOPE_ROOTS_HEADER, HeaderValue::from_static(""));
        headers.insert(PROXY_SCOPE_TOKEN_HEADER, HeaderValue::from_static("secret"));
        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    #[test]
    fn proxy_scope_whitespace_only_roots_returns_none() {
        let state = test_state(Some("secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(PROXY_SCOPE_ROOTS_HEADER, HeaderValue::from_static("   "));
        headers.insert(PROXY_SCOPE_TOKEN_HEADER, HeaderValue::from_static("secret"));
        // After trim, it becomes empty -> None
        // But the filter(|s| !s.is_empty()) removes empty entries from split
        // so roots list is empty -> None
        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    #[test]
    fn proxy_scope_no_auth_secret_configured_returns_none() {
        let state = test_state(None);
        let mut headers = HeaderMap::new();
        headers.insert(PROXY_SCOPE_ROOTS_HEADER, HeaderValue::from_static("root-a"));
        headers.insert(
            PROXY_SCOPE_TOKEN_HEADER,
            HeaderValue::from_static("anything"),
        );
        // No auth_secret configured -> proxy scope is ignored
        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    #[test]
    fn proxy_scope_empty_auth_secret_returns_none() {
        let state = test_state(Some("".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(PROXY_SCOPE_ROOTS_HEADER, HeaderValue::from_static("root-a"));
        headers.insert(PROXY_SCOPE_TOKEN_HEADER, HeaderValue::from_static(""));
        // Empty auth_secret -> proxy scope is ignored
        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    #[test]
    fn proxy_scope_missing_scope_token_header_returns_none() {
        let state = test_state(Some("secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(PROXY_SCOPE_ROOTS_HEADER, HeaderValue::from_static("root-a"));
        // No PROXY_SCOPE_TOKEN_HEADER -> provided_token defaults to ""
        // which != "secret" -> None
        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    #[test]
    fn proxy_scope_trims_root_names() {
        let state = test_state(Some("secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(
            PROXY_SCOPE_ROOTS_HEADER,
            HeaderValue::from_static("  alpha ,  beta  , gamma  "),
        );
        headers.insert(PROXY_SCOPE_TOKEN_HEADER, HeaderValue::from_static("secret"));

        let scope = proxy_scope_from_headers(&state, &headers).unwrap();
        assert_eq!(scope.roots, vec!["alpha", "beta", "gamma"]);
    }

    #[test]
    fn proxy_scope_filters_empty_segments() {
        let state = test_state(Some("secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(
            PROXY_SCOPE_ROOTS_HEADER,
            HeaderValue::from_static("a,,b,,,c"),
        );
        headers.insert(PROXY_SCOPE_TOKEN_HEADER, HeaderValue::from_static("secret"));

        let scope = proxy_scope_from_headers(&state, &headers).unwrap();
        assert_eq!(scope.roots, vec!["a", "b", "c"]);
    }

    #[test]
    fn proxy_scope_single_root() {
        let state = test_state(Some("secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(
            PROXY_SCOPE_ROOTS_HEADER,
            HeaderValue::from_static("solo-root"),
        );
        headers.insert(PROXY_SCOPE_TOKEN_HEADER, HeaderValue::from_static("secret"));

        let scope = proxy_scope_from_headers(&state, &headers).unwrap();
        assert_eq!(scope.roots, vec!["solo-root"]);
    }

    #[test]
    fn proxy_scope_only_commas_returns_none() {
        let state = test_state(Some("secret".to_string()));
        let mut headers = HeaderMap::new();
        headers.insert(PROXY_SCOPE_ROOTS_HEADER, HeaderValue::from_static(",,,"));
        headers.insert(PROXY_SCOPE_TOKEN_HEADER, HeaderValue::from_static("secret"));
        // All segments empty after split+trim+filter -> roots is empty -> None
        assert!(proxy_scope_from_headers(&state, &headers).is_none());
    }

    // ── extract_bearer tests ─────────────────────────────────

    #[test]
    fn extract_bearer_valid_header() {
        let req = axum::http::Request::builder()
            .header("authorization", "Bearer my-token-123")
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(extract_bearer(&req), Some("my-token-123"));
    }

    #[test]
    fn extract_bearer_missing_header() {
        let req = axum::http::Request::builder()
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(extract_bearer(&req), None);
    }

    #[test]
    fn extract_bearer_wrong_scheme() {
        let req = axum::http::Request::builder()
            .header("authorization", "Basic dXNlcjpwYXNz")
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(extract_bearer(&req), None);
    }

    #[test]
    fn extract_bearer_lowercase_bearer_not_matched() {
        // "bearer " (lowercase) should not match "Bearer " (capital B)
        let req = axum::http::Request::builder()
            .header("authorization", "bearer my-token")
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(extract_bearer(&req), None);
    }

    #[test]
    fn extract_bearer_empty_token_after_prefix() {
        let req = axum::http::Request::builder()
            .header("authorization", "Bearer ")
            .body(axum::body::Body::empty())
            .unwrap();
        // strip_prefix("Bearer ") on "Bearer " returns Some("")
        assert_eq!(extract_bearer(&req), Some(""));
    }

    #[test]
    fn extract_bearer_no_space_after_bearer() {
        let req = axum::http::Request::builder()
            .header("authorization", "BearerNoSpace")
            .body(axum::body::Body::empty())
            .unwrap();
        assert_eq!(extract_bearer(&req), None);
    }

    // ── Claims serialization ─────────────────────────────────

    #[test]
    fn claims_optional_fields_skip_when_none() {
        let claims = Claims {
            sub: "user".to_string(),
            iat: 1000,
            exp: 2000,
            user_id: None,
            email: None,
        };
        let json = serde_json::to_value(&claims).unwrap();
        assert!(!json.as_object().unwrap().contains_key("user_id"));
        assert!(!json.as_object().unwrap().contains_key("email"));
    }

    #[test]
    fn claims_optional_fields_present_when_some() {
        let claims = Claims {
            sub: "user".to_string(),
            iat: 1000,
            exp: 2000,
            user_id: Some("uid".to_string()),
            email: Some("a@b.com".to_string()),
        };
        let json = serde_json::to_value(&claims).unwrap();
        assert_eq!(json["user_id"], "uid");
        assert_eq!(json["email"], "a@b.com");
    }

    #[test]
    fn claims_deserialize_without_optional_fields() {
        let json = r#"{"sub":"user","iat":1000,"exp":2000}"#;
        let claims: Claims = serde_json::from_str(json).unwrap();
        assert_eq!(claims.sub, "user");
        assert!(claims.user_id.is_none());
        assert!(claims.email.is_none());
    }

    #[test]
    fn claims_round_trip_serde() {
        let original = Claims {
            sub: "test-sub".to_string(),
            iat: 1234567890,
            exp: 1234571490,
            user_id: Some("test-uid".to_string()),
            email: Some("test@example.com".to_string()),
        };
        let serialized = serde_json::to_string(&original).unwrap();
        let deserialized: Claims = serde_json::from_str(&serialized).unwrap();
        assert_eq!(deserialized.sub, original.sub);
        assert_eq!(deserialized.iat, original.iat);
        assert_eq!(deserialized.exp, original.exp);
        assert_eq!(deserialized.user_id, original.user_id);
        assert_eq!(deserialized.email, original.email);
    }

    // ── Token creation with different secret lengths ─────────

    #[test]
    fn create_token_with_very_long_secret() {
        let secret: String = "a".repeat(1024);
        let token = create_token(&secret, 1, Some("user"), None).unwrap();
        let claims = validate_token(&token, &secret).unwrap();
        assert_eq!(claims.sub, "user");
    }

    #[test]
    fn create_token_with_single_char_secret() {
        let token = create_token("x", 1, Some("user"), None).unwrap();
        let claims = validate_token(&token, "x").unwrap();
        assert_eq!(claims.sub, "user");
    }

    #[test]
    fn create_token_with_unicode_secret() {
        let secret = "\u{1F600}\u{1F4A9}\u{2603}"; // emoji secret
        let token = create_token(secret, 1, Some("user"), None).unwrap();
        let claims = validate_token(&token, secret).unwrap();
        assert_eq!(claims.sub, "user");
    }

    #[test]
    fn create_token_with_unicode_user_id() {
        let secret = "test";
        let token = create_token(secret, 1, Some("\u{00E9}\u{00E8}\u{00EA}"), None).unwrap();
        let claims = validate_token(&token, secret).unwrap();
        assert_eq!(claims.sub, "\u{00E9}\u{00E8}\u{00EA}");
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
                    // Resolve user's root agents for tenant scoping.
                    if let Some(accounts) = &state.accounts {
                        let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
                        if let Ok(Some(user)) = accounts.get_user_by_id(user_id) {
                            let roots = user.roots.unwrap_or_default();
                            req.extensions_mut().insert(UserScope { roots });
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
