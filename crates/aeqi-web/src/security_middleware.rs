//! Security middleware for adding security headers
//!
//! Provides middleware to add security headers to HTTP responses
//! to protect against common web vulnerabilities.

use axum::{
    extract::{Request, State},
    http::HeaderValue,
    middleware::Next,
    response::Response,
};
use tracing::debug;

/// Security headers configuration
#[derive(Debug, Clone)]
pub struct SecurityHeadersConfig {
    /// Content Security Policy
    pub csp: Option<String>,
    /// Strict Transport Security
    pub hsts: Option<String>,
    /// X-Frame-Options
    pub x_frame_options: Option<String>,
    /// X-Content-Type-Options
    pub x_content_type_options: Option<String>,
    /// Referrer Policy
    pub referrer_policy: Option<String>,
    /// Permissions Policy
    pub permissions_policy: Option<String>,
}

impl Default for SecurityHeadersConfig {
    fn default() -> Self {
        Self {
            csp: Some("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'".to_string()),
            hsts: Some("max-age=31536000; includeSubDomains".to_string()),
            x_frame_options: Some("DENY".to_string()),
            x_content_type_options: Some("nosniff".to_string()),
            referrer_policy: Some("strict-origin-when-cross-origin".to_string()),
            permissions_policy: Some("geolocation=(), microphone=(), camera=()".to_string()),
        }
    }
}

/// Middleware that adds security headers to HTTP responses
pub async fn security_headers_middleware(
    State(config): State<SecurityHeadersConfig>,
    req: Request,
    next: Next,
) -> Response {
    let mut response = next.run(req).await;

    let headers = response.headers_mut();

    // Add Content-Security-Policy
    if let Some(csp) = &config.csp
        && let Ok(header_value) = HeaderValue::from_str(csp)
    {
        headers.insert("Content-Security-Policy", header_value);
    }

    // Add Strict-Transport-Security
    if let Some(hsts) = &config.hsts
        && let Ok(header_value) = HeaderValue::from_str(hsts)
    {
        headers.insert("Strict-Transport-Security", header_value);
    }

    // Add X-Frame-Options
    if let Some(xfo) = &config.x_frame_options
        && let Ok(header_value) = HeaderValue::from_str(xfo)
    {
        headers.insert("X-Frame-Options", header_value);
    }

    // Add X-Content-Type-Options
    if let Some(xcto) = &config.x_content_type_options
        && let Ok(header_value) = HeaderValue::from_str(xcto)
    {
        headers.insert("X-Content-Type-Options", header_value);
    }

    // Add Referrer-Policy
    if let Some(rp) = &config.referrer_policy
        && let Ok(header_value) = HeaderValue::from_str(rp)
    {
        headers.insert("Referrer-Policy", header_value);
    }

    // Add Permissions-Policy
    if let Some(pp) = &config.permissions_policy
        && let Ok(header_value) = HeaderValue::from_str(pp)
    {
        headers.insert("Permissions-Policy", header_value);
    }

    // Add X-XSS-Protection (legacy but still useful)
    if let Ok(header_value) = HeaderValue::from_str("1; mode=block") {
        headers.insert("X-XSS-Protection", header_value);
    }

    debug!("Added security headers to response");

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::{Body, to_bytes},
        routing::get,
    };
    use tower::ServiceExt;

    async fn test_handler() -> &'static str {
        "Hello, World!"
    }

    #[tokio::test]
    async fn test_security_headers_middleware() {
        let app = Router::new().route("/", get(test_handler)).layer(
            axum::middleware::from_fn_with_state(
                SecurityHeadersConfig::default(),
                security_headers_middleware,
            ),
        );

        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let headers = response.headers();

        // Check that security headers are present
        assert!(headers.contains_key("Content-Security-Policy"));
        assert!(headers.contains_key("Strict-Transport-Security"));
        assert!(headers.contains_key("X-Frame-Options"));
        assert!(headers.contains_key("X-Content-Type-Options"));
        assert!(headers.contains_key("Referrer-Policy"));
        assert!(headers.contains_key("Permissions-Policy"));
        assert!(headers.contains_key("X-XSS-Protection"));

        // Check specific values
        assert_eq!(headers.get("X-Frame-Options").unwrap(), "DENY");
        assert_eq!(headers.get("X-Content-Type-Options").unwrap(), "nosniff");

        // Check response body
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert_eq!(body, "Hello, World!");
    }

    #[tokio::test]
    async fn test_custom_security_headers() {
        let config = SecurityHeadersConfig {
            csp: Some("default-src 'none'".to_string()),
            hsts: Some("max-age=63072000".to_string()),
            x_frame_options: Some("SAMEORIGIN".to_string()),
            x_content_type_options: Some("nosniff".to_string()),
            referrer_policy: Some("no-referrer".to_string()),
            permissions_policy: Some("geolocation=()".to_string()),
        };

        let app = Router::new().route("/", get(test_handler)).layer(
            axum::middleware::from_fn_with_state(config.clone(), security_headers_middleware),
        );

        let response = app
            .oneshot(
                axum::http::Request::builder()
                    .uri("/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let headers = response.headers();

        // Check custom values
        assert_eq!(
            headers.get("Content-Security-Policy").unwrap(),
            "default-src 'none'"
        );
        assert_eq!(
            headers.get("Strict-Transport-Security").unwrap(),
            "max-age=63072000"
        );
        assert_eq!(headers.get("X-Frame-Options").unwrap(), "SAMEORIGIN");
        assert_eq!(headers.get("Referrer-Policy").unwrap(), "no-referrer");
    }

    #[test]
    fn test_security_headers_config_default() {
        let config = SecurityHeadersConfig::default();

        assert!(config.csp.is_some());
        assert!(config.hsts.is_some());
        assert!(config.x_frame_options.is_some());
        assert!(config.x_content_type_options.is_some());
        assert!(config.referrer_policy.is_some());
        assert!(config.permissions_policy.is_some());

        // Check default values
        assert_eq!(config.x_frame_options.unwrap(), "DENY");
        assert_eq!(config.x_content_type_options.unwrap(), "nosniff");
    }
}
