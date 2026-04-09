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

/// Validate a WebSocket token and resolve user companies.
/// Shared between ws.rs and session_ws.rs to avoid duplication.
pub fn resolve_ws_companies(
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

    let secret = auth::signing_secret(state);
    let claims = auth::validate_token(token, secret).map_err(|_| "invalid token")?;

    let companies = if let Some(accounts) = &state.accounts {
        let user_id = claims.user_id.as_deref().unwrap_or(&claims.sub);
        accounts
            .get_user_by_id(user_id)
            .ok()
            .flatten()
            .and_then(|u| u.companies)
    } else {
        None
    };

    Ok(companies)
}
