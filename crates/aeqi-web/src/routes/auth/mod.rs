use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use serde::Deserialize;

use crate::server::AppState;
use aeqi_core::config::AuthMode;

mod github;
mod google;
mod local;

// ── Request DTOs ──────────────────────────────────────────

#[derive(Deserialize)]
pub struct SecretLoginRequest {
    pub secret: Option<String>,
}

#[derive(Deserialize)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    pub name: String,
    pub invite_code: Option<String>,
}

#[derive(Deserialize)]
pub struct EmailLoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct VerifyEmailRequest {
    pub email: String,
    pub code: String,
}

#[derive(Deserialize)]
pub struct ResendCodeRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct WaitlistRequest {
    pub email: String,
}

#[derive(Deserialize)]
pub struct CheckInviteRequest {
    pub code: String,
}

// ── Route builders ────────────────────────────────────────

/// Exempt from rate limiting: health/liveness, auth-mode probe, Prometheus
/// metrics.  These are called by infrastructure (load balancer, scrape
/// jobs) and have no credential-testing surface.
pub fn exempt_routes() -> Router<AppState> {
    Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/auth/mode", get(auth_mode_handler))
        .route("/metrics", get(metrics_handler))
}

/// Login entry — isolated so server.rs can put just this one route in the
/// tight rate-limit tier.  The rest of the credential flows live in
/// [`accounts_routes`].
pub fn login_routes() -> Router<AppState> {
    Router::new().route("/api/auth/login", axum::routing::post(local::login_handler))
}

/// Account-related routes (signup, verify, me, OAuth, waitlist, invites).
pub fn accounts_routes() -> Router<AppState> {
    Router::new()
        .merge(local::routes())
        .merge(google::routes())
        .merge(github::routes())
}

// ── Shared helpers ────────────────────────────────────────

pub(super) fn server_configuration_error(err: &'static str) -> Response {
    tracing::error!("auth: {err}");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({
            "ok": false,
            "error": "server configuration error"
        })),
    )
        .into_response()
}

pub(super) fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}

// ── Handlers ──────────────────────────────────────────────

async fn metrics_handler(State(state): State<AppState>) -> Response {
    match state.ipc.cmd("metrics").await {
        Ok(resp) => {
            let text = resp.get("metrics").and_then(|v| v.as_str()).unwrap_or("");
            (
                axum::http::StatusCode::OK,
                [(
                    axum::http::header::CONTENT_TYPE,
                    "text/plain; version=0.0.4; charset=utf-8",
                )],
                text.to_string(),
            )
                .into_response()
        }
        Err(_) => (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "# metrics unavailable — daemon not connected\n",
        )
            .into_response(),
    }
}

async fn health_handler(State(state): State<AppState>) -> Response {
    match state.ipc.cmd("ping").await {
        Ok(resp) => Json(resp).into_response(),
        Err(_) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"ok": false, "error": "daemon not reachable"})),
        )
            .into_response(),
    }
}

async fn auth_mode_handler(State(state): State<AppState>) -> Response {
    let mode = match state.auth_mode {
        AuthMode::None => "none",
        AuthMode::Secret => "secret",
        AuthMode::Accounts => "accounts",
    };
    Json(serde_json::json!({
        "app_mode": "runtime",
        "mode": mode,
        "google_oauth": state.auth_config.google_oauth_enabled(),
        "github_oauth": state.auth_config.github_oauth_enabled(),
        "waitlist": state.auth_config.waitlist,
    }))
    .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── urlencoding tests ────────────────────────────────────

    #[test]
    fn urlencoding_preserves_unreserved_chars() {
        assert_eq!(urlencoding("abc"), "abc");
        assert_eq!(urlencoding("ABC"), "ABC");
        assert_eq!(urlencoding("0123456789"), "0123456789");
        assert_eq!(urlencoding("-_.~"), "-_.~");
    }

    #[test]
    fn urlencoding_encodes_spaces() {
        assert_eq!(urlencoding("hello world"), "hello%20world");
    }

    #[test]
    fn urlencoding_encodes_special_chars() {
        assert_eq!(urlencoding("a=b&c=d"), "a%3Db%26c%3Dd");
        assert_eq!(urlencoding("foo@bar.com"), "foo%40bar.com");
    }

    #[test]
    fn urlencoding_encodes_slash() {
        assert_eq!(urlencoding("/path/to"), "%2Fpath%2Fto");
    }

    #[test]
    fn urlencoding_empty_string() {
        assert_eq!(urlencoding(""), "");
    }

    #[test]
    fn urlencoding_encodes_question_mark_and_hash() {
        assert_eq!(urlencoding("?q=1#frag"), "%3Fq%3D1%23frag");
    }

    #[test]
    fn urlencoding_encodes_plus() {
        assert_eq!(urlencoding("a+b"), "a%2Bb");
    }

    #[test]
    fn urlencoding_encodes_percent() {
        assert_eq!(urlencoding("100%"), "100%25");
    }

    // ── Request DTO deserialization tests ─────────────────────

    #[test]
    fn secret_login_request_deserialize_with_secret() {
        let json = r#"{"secret": "my-secret"}"#;
        let req: SecretLoginRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.secret.as_deref(), Some("my-secret"));
    }

    #[test]
    fn secret_login_request_deserialize_without_secret() {
        let json = r#"{}"#;
        let req: SecretLoginRequest = serde_json::from_str(json).unwrap();
        assert!(req.secret.is_none());
    }

    #[test]
    fn signup_request_deserialize() {
        let json =
            r#"{"email":"a@b.com","password":"12345678","name":"Test","invite_code":"INV-1"}"#;
        let req: SignupRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "a@b.com");
        assert_eq!(req.password, "12345678");
        assert_eq!(req.name, "Test");
        assert_eq!(req.invite_code.as_deref(), Some("INV-1"));
    }

    #[test]
    fn signup_request_deserialize_without_invite_code() {
        let json = r#"{"email":"a@b.com","password":"12345678","name":"Test"}"#;
        let req: SignupRequest = serde_json::from_str(json).unwrap();
        assert!(req.invite_code.is_none());
    }

    #[test]
    fn email_login_request_deserialize() {
        let json = r#"{"email":"user@example.com","password":"secret123"}"#;
        let req: EmailLoginRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "user@example.com");
        assert_eq!(req.password, "secret123");
    }

    #[test]
    fn verify_email_request_deserialize() {
        let json = r#"{"email":"user@example.com","code":"123456"}"#;
        let req: VerifyEmailRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "user@example.com");
        assert_eq!(req.code, "123456");
    }

    #[test]
    fn resend_code_request_deserialize() {
        let json = r#"{"email":"user@example.com"}"#;
        let req: ResendCodeRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "user@example.com");
    }

    #[test]
    fn waitlist_request_deserialize() {
        let json = r#"{"email":"user@example.com"}"#;
        let req: WaitlistRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.email, "user@example.com");
    }

    #[test]
    fn check_invite_request_deserialize() {
        let json = r#"{"code":"INV-ABC"}"#;
        let req: CheckInviteRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.code, "INV-ABC");
    }

    // ── Reject missing required fields ───────────────────────

    #[test]
    fn email_login_request_missing_email_fails() {
        let json = r#"{"password":"secret123"}"#;
        assert!(serde_json::from_str::<EmailLoginRequest>(json).is_err());
    }

    #[test]
    fn email_login_request_missing_password_fails() {
        let json = r#"{"email":"user@example.com"}"#;
        assert!(serde_json::from_str::<EmailLoginRequest>(json).is_err());
    }

    #[test]
    fn signup_request_missing_email_fails() {
        let json = r#"{"password":"12345678","name":"Test"}"#;
        assert!(serde_json::from_str::<SignupRequest>(json).is_err());
    }

    #[test]
    fn signup_request_missing_password_fails() {
        let json = r#"{"email":"a@b.com","name":"Test"}"#;
        assert!(serde_json::from_str::<SignupRequest>(json).is_err());
    }

    #[test]
    fn signup_request_missing_name_fails() {
        let json = r#"{"email":"a@b.com","password":"12345678"}"#;
        assert!(serde_json::from_str::<SignupRequest>(json).is_err());
    }

    #[test]
    fn verify_email_request_missing_code_fails() {
        let json = r#"{"email":"a@b.com"}"#;
        assert!(serde_json::from_str::<VerifyEmailRequest>(json).is_err());
    }

    #[test]
    fn check_invite_request_missing_code_fails() {
        let json = r#"{}"#;
        assert!(serde_json::from_str::<CheckInviteRequest>(json).is_err());
    }
}
