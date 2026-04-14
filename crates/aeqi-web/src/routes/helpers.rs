use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::auth::UserScope;
use crate::extractors::Scope;
use crate::server::AppState;

/// Send an IPC command to the daemon, injecting tenant scope when available.
pub(super) async fn ipc_proxy(
    state: AppState,
    scope: Option<&UserScope>,
    cmd: &str,
    params: serde_json::Value,
) -> Response {
    // Merge allowed_companies into the params so the daemon can filter.
    let params = if let Some(scope) = scope {
        let mut p = if params.is_null() || params.as_object().is_some_and(|m| m.is_empty()) {
            serde_json::json!({})
        } else {
            params
        };
        p["allowed_companies"] = serde_json::json!(scope.companies);
        p
    } else {
        params
    };

    let result = if params.is_null() || params.as_object().is_some_and(|m| m.is_empty()) {
        state.ipc.cmd(cmd).await
    } else {
        state.ipc.cmd_with(cmd, params).await
    };

    match result {
        Ok(resp) => Json(resp).into_response(),
        Err(e) => (
            StatusCode::BAD_GATEWAY,
            Json(serde_json::json!({"ok": false, "error": e.to_string()})),
        )
            .into_response(),
    }
}

/// Hosting routes are admin-only. In multi-tenant mode (accounts), deny access
/// to scoped users. Only unscoped operators can manage hosting.
pub(super) fn hosting_deny_if_scoped(scope: &Scope) -> Option<Response> {
    if scope.as_ref().is_some() {
        Some(
            (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({"ok": false, "error": "hosting requires operator access"})),
            )
                .into_response(),
        )
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::UserScope;
    use axum::http::StatusCode;

    #[test]
    fn hosting_deny_if_scoped_returns_none_for_unscoped() {
        let scope = Scope(None);
        assert!(hosting_deny_if_scoped(&scope).is_none());
    }

    #[test]
    fn hosting_deny_if_scoped_returns_forbidden_for_scoped() {
        let scope = Scope(Some(UserScope {
            companies: vec!["tenant-a".to_string()],
        }));
        let response = hosting_deny_if_scoped(&scope).expect("should return a response");
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn hosting_deny_if_scoped_response_body_contains_error() {
        let scope = Scope(Some(UserScope {
            companies: vec!["tenant-a".to_string()],
        }));
        let response = hosting_deny_if_scoped(&scope).unwrap();
        let body = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["ok"], false);
        assert_eq!(json["error"], "hosting requires operator access");
    }

    #[test]
    fn hosting_deny_if_scoped_empty_companies_still_denied() {
        // Even with an empty companies list, the scope is Some, so access is denied.
        let scope = Scope(Some(UserScope {
            companies: vec![],
        }));
        let response = hosting_deny_if_scoped(&scope);
        assert!(response.is_some());
        assert_eq!(response.unwrap().status(), StatusCode::FORBIDDEN);
    }
}
