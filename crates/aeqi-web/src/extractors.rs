use axum::extract::FromRequestParts;
use axum::http::request::Parts;

use crate::auth::UserScope;

/// Extracts the optional UserScope from request extensions.
/// Replaces the verbose `scope: Option<axum::Extension<UserScope>>` + `scope_ref(&scope)` pattern.
pub struct Scope(pub Option<UserScope>);

impl Scope {
    pub fn as_ref(&self) -> Option<&UserScope> {
        self.0.as_ref()
    }
}

impl<S: Send + Sync> FromRequestParts<S> for Scope {
    type Rejection = std::convert::Infallible;

    fn from_request_parts(
        parts: &mut Parts,
        _state: &S,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        std::future::ready(Ok(Self(parts.extensions.get::<UserScope>().cloned())))
    }
}

/// Validate a WebSocket token and resolve user root agents.
/// Shared between ws.rs and session_ws.rs to avoid duplication.
pub fn resolve_ws_roots(
    state: &crate::server::AppState,
    token: Option<&str>,
) -> Result<Option<Vec<String>>, &'static str> {
    use crate::auth;

    if state.auth_mode == aeqi_core::config::AuthMode::None {
        return Ok(None);
    }

    let Some(token) = token else {
        return Err("missing token");
    };

    let secret = auth::signing_secret(state)?;
    let claims = auth::validate_token(token, secret).map_err(|_| "invalid token")?;

    let roots = if let Some(accounts) = &state.accounts {
        let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
        accounts
            .get_user_by_id(user_id)
            .ok()
            .flatten()
            .and_then(|u| u.roots)
    } else {
        None
    };

    Ok(roots)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::UserScope;
    use aeqi_core::config::{AuthConfig, AuthMode};

    fn test_hosting() -> std::sync::Arc<dyn aeqi_hosting::HostingProvider> {
        let config = aeqi_hosting::HostingConfig {
            provider: "none".to_string(),
            local: None,
            managed: None,
        };
        std::sync::Arc::from(aeqi_hosting::from_config(&config).unwrap())
    }

    fn test_state(auth_secret: Option<String>, auth_mode: AuthMode) -> crate::server::AppState {
        crate::server::AppState {
            ipc: std::sync::Arc::new(crate::ipc::IpcClient::new("/tmp/test.sock".into())),
            auth_secret,
            auth_mode,
            auth_config: AuthConfig::default(),
            ui_dist_dir: None,
            accounts: None,
            smtp: None,
            hosting: test_hosting(),
            twilio_auth_token: None,
            data_dir: std::path::PathBuf::from("/tmp/aeqi-test"),
            default_blueprint_slug: "aeqi".to_string(),
            bootstrap_registry: std::sync::Arc::new(
                crate::routes::integrations::BootstrapRegistry::new(),
            ),
        }
    }

    // ── Scope extractor tests ────────────────────────────────

    #[test]
    fn scope_as_ref_returns_none_when_empty() {
        let scope = Scope(None);
        assert!(scope.as_ref().is_none());
    }

    #[test]
    fn scope_as_ref_returns_some_when_present() {
        let scope = Scope(Some(UserScope {
            roots: vec!["acme".to_string()],
        }));
        let inner = scope.as_ref().unwrap();
        assert_eq!(inner.roots, vec!["acme"]);
    }

    #[tokio::test]
    async fn scope_extracts_user_scope_from_extensions() {
        // Build a request with UserScope in extensions, then extract Scope from parts.
        let mut req = axum::http::Request::builder().body(()).unwrap();
        req.extensions_mut().insert(UserScope {
            roots: vec!["co-a".to_string(), "co-b".to_string()],
        });
        let (mut parts, _body) = req.into_parts();

        let scope: Scope = Scope::from_request_parts(&mut parts, &()).await.unwrap();
        let inner = scope.as_ref().unwrap();
        assert_eq!(inner.roots, vec!["co-a", "co-b"]);
    }

    #[tokio::test]
    async fn scope_extracts_none_when_no_extension() {
        let req = axum::http::Request::builder().body(()).unwrap();
        let (mut parts, _body) = req.into_parts();

        let scope: Scope = Scope::from_request_parts(&mut parts, &()).await.unwrap();
        assert!(scope.as_ref().is_none());
    }

    // ── resolve_ws_roots tests ───────────────────────────

    #[test]
    fn resolve_ws_roots_auth_none_returns_ok_none() {
        let state = test_state(None, AuthMode::None);
        let result = resolve_ws_roots(&state, Some("any-token"));
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn resolve_ws_roots_auth_none_without_token_returns_ok_none() {
        let state = test_state(None, AuthMode::None);
        let result = resolve_ws_roots(&state, None);
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn resolve_ws_roots_secret_mode_missing_token_returns_err() {
        let state = test_state(Some("secret".to_string()), AuthMode::Secret);
        let result = resolve_ws_roots(&state, None);
        assert_eq!(result.unwrap_err(), "missing token");
    }

    #[test]
    fn resolve_ws_roots_secret_mode_invalid_token_returns_err() {
        let state = test_state(Some("secret".to_string()), AuthMode::Secret);
        let result = resolve_ws_roots(&state, Some("garbage.token.here"));
        assert_eq!(result.unwrap_err(), "invalid token");
    }

    #[test]
    fn resolve_ws_roots_secret_mode_valid_token_no_accounts() {
        let state = test_state(Some("secret".to_string()), AuthMode::Secret);
        let token = crate::auth::create_token("secret", 1, Some("user-1"), None).unwrap();
        let result = resolve_ws_roots(&state, Some(&token));
        // No accounts store -> roots is None
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn resolve_ws_roots_accounts_mode_missing_token_returns_err() {
        let state = test_state(Some("secret".to_string()), AuthMode::Accounts);
        let result = resolve_ws_roots(&state, None);
        assert_eq!(result.unwrap_err(), "missing token");
    }

    #[test]
    fn resolve_ws_roots_wrong_secret_returns_invalid() {
        let state = test_state(Some("real-secret".to_string()), AuthMode::Secret);
        let token = crate::auth::create_token("wrong-secret", 1, Some("user"), None).unwrap();
        let result = resolve_ws_roots(&state, Some(&token));
        assert_eq!(result.unwrap_err(), "invalid token");
    }

    #[test]
    fn resolve_ws_roots_default_secret_fallback() {
        // No auth_secret configured -> signing_secret returns an error.
        let state = test_state(None, AuthMode::Secret);
        let token =
            crate::auth::create_token("aeqi-ephemeral-fallback", 1, Some("user"), None).unwrap();
        let result = resolve_ws_roots(&state, Some(&token));
        assert_eq!(
            result.unwrap_err(),
            "JWT signing secret not configured. Set AEQI_AUTH_SECRET environment variable."
        );
    }
}
