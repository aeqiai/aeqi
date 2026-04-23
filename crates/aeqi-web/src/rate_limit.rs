//! Rate limiting middleware
//!
//! Provides rate limiting for API endpoints to prevent abuse
//! and brute force attacks.

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// Rate limiter configuration
#[derive(Debug, Clone)]
pub struct RateLimiterConfig {
    /// Maximum requests per window
    pub max_requests: usize,
    /// Time window in seconds
    pub window_seconds: u64,
    /// Whether to enable rate limiting
    pub enabled: bool,
}

impl Default for RateLimiterConfig {
    fn default() -> Self {
        Self {
            max_requests: 100,
            window_seconds: 60,
            enabled: true,
        }
    }
}

/// Rate limit entry for a client
#[derive(Debug, Clone)]
struct RateLimitEntry {
    requests: Vec<Instant>,
    blocked_until: Option<Instant>,
}

impl RateLimitEntry {
    fn new() -> Self {
        Self {
            requests: Vec::new(),
            blocked_until: None,
        }
    }
}

/// Rate limiter state
#[derive(Debug, Clone)]
pub struct RateLimiter {
    config: RateLimiterConfig,
    state: Arc<RwLock<HashMap<String, RateLimitEntry>>>,
}

impl RateLimiter {
    /// Create a new rate limiter with the given configuration
    pub fn new(config: RateLimiterConfig) -> Self {
        Self {
            config,
            state: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Check if a request from the given client should be allowed
    pub async fn check(&self, client_id: &str) -> bool {
        if !self.config.enabled {
            return true;
        }

        let now = Instant::now();
        let mut state = self.state.write().await;

        let entry = state
            .entry(client_id.to_string())
            .or_insert_with(RateLimitEntry::new);

        // Check if client is blocked
        if let Some(blocked_until) = entry.blocked_until {
            if now < blocked_until {
                warn!(client_id, "rate limit blocked");
                return false;
            } else {
                // Block period expired, reset
                entry.blocked_until = None;
            }
        }

        // Clean old requests
        let window = Duration::from_secs(self.config.window_seconds);
        entry
            .requests
            .retain(|&time| now.duration_since(time) < window);

        // Check if over limit
        if entry.requests.len() >= self.config.max_requests {
            // Block for 5 minutes
            entry.blocked_until = Some(now + Duration::from_secs(300));
            entry.requests.clear(); // Clear requests during block
            warn!(client_id, "rate limit exceeded, blocking for 5 minutes");
            return false;
        }

        // Add current request
        entry.requests.push(now);
        true
    }

    /// Get the number of remaining requests for a client
    pub async fn remaining(&self, client_id: &str) -> usize {
        if !self.config.enabled {
            return self.config.max_requests;
        }

        let now = Instant::now();
        let state = self.state.read().await;

        if let Some(entry) = state.get(client_id) {
            // Check if blocked
            if let Some(blocked_until) = entry.blocked_until
                && now < blocked_until
            {
                return 0;
            }

            // Count requests in window
            let window = Duration::from_secs(self.config.window_seconds);
            let count = entry
                .requests
                .iter()
                .filter(|&&time| now.duration_since(time) < window)
                .count();

            self.config.max_requests.saturating_sub(count)
        } else {
            self.config.max_requests
        }
    }

    /// Clean up old entries (call periodically)
    pub async fn cleanup(&self) {
        let now = Instant::now();
        let window = Duration::from_secs(self.config.window_seconds * 2); // Double window for cleanup

        let mut state = self.state.write().await;
        state.retain(|_, entry| {
            // Check if blocked entry should be kept
            if let Some(blocked_until) = entry.blocked_until
                && now < blocked_until
            {
                return true;
            }

            // Check if there are recent requests
            entry
                .requests
                .retain(|&time| now.duration_since(time) < window);
            !entry.requests.is_empty()
        });
    }
}

/// Extract client identifier from request
fn extract_client_id(headers: &HeaderMap) -> String {
    // Try to get IP from X-Forwarded-For header (behind proxy)
    if let Some(forwarded_for) = headers.get("X-Forwarded-For")
        && let Ok(ip) = forwarded_for.to_str()
    {
        // Take the first IP in the list (client IP)
        if let Some(client_ip) = ip.split(',').next() {
            return client_ip.trim().to_string();
        }
    }

    // Try to get IP from X-Real-IP header
    if let Some(real_ip) = headers.get("X-Real-IP")
        && let Ok(ip) = real_ip.to_str()
    {
        return ip.to_string();
    }

    // Fall back to remote address (if available)
    // Note: This requires the remote address to be available
    // In a real implementation, you'd extract this from the connection
    // For now, use a placeholder
    "unknown".to_string()
}

/// Rate limiting middleware
pub async fn rate_limit_middleware(
    State(limiter): State<Arc<RateLimiter>>,
    req: Request,
    next: Next,
) -> Response {
    let client_id = extract_client_id(req.headers());

    if !limiter.check(&client_id).await {
        let remaining = limiter.remaining(&client_id).await;

        let mut response = (
            StatusCode::TOO_MANY_REQUESTS,
            axum::Json(serde_json::json!({
                "ok": false,
                "error": "rate limit exceeded",
                "retry_after": 300, // 5 minutes in seconds
            })),
        )
            .into_response();

        // Add rate limit headers (RFC 6585)
        response.headers_mut().insert(
            "X-RateLimit-Limit",
            limiter.config.max_requests.to_string().parse().unwrap(),
        );
        response.headers_mut().insert(
            "X-RateLimit-Remaining",
            remaining.to_string().parse().unwrap(),
        );
        response.headers_mut().insert(
            "X-RateLimit-Reset",
            (chrono::Utc::now().timestamp() + 300)
                .to_string()
                .parse()
                .unwrap(),
        );

        warn!(client_id, "rate limit exceeded");
        return response;
    }

    let remaining = limiter.remaining(&client_id).await;

    let mut response = next.run(req).await;

    // Add rate limit headers to successful responses
    response.headers_mut().insert(
        "X-RateLimit-Limit",
        limiter.config.max_requests.to_string().parse().unwrap(),
    );
    response.headers_mut().insert(
        "X-RateLimit-Remaining",
        remaining.to_string().parse().unwrap(),
    );

    debug!(client_id, remaining, "rate limit check passed");
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_rate_limiter_basic() {
        let config = RateLimiterConfig {
            max_requests: 3,
            window_seconds: 1,
            enabled: true,
        };

        let limiter = RateLimiter::new(config);
        let client_id = "test-client";

        // First 3 requests should succeed
        assert!(limiter.check(client_id).await);
        assert!(limiter.check(client_id).await);
        assert!(limiter.check(client_id).await);

        // Wait for window to reset
        tokio::time::sleep(Duration::from_secs(2)).await;

        // Should succeed again
        assert!(limiter.check(client_id).await);
    }

    #[tokio::test]
    async fn test_rate_limiter_remaining() {
        let config = RateLimiterConfig {
            max_requests: 5,
            window_seconds: 10,
            enabled: true,
        };

        let limiter = RateLimiter::new(config);
        let client_id = "test-client";

        // Initially should have all requests remaining
        assert_eq!(limiter.remaining(client_id).await, 5);

        // Make some requests
        limiter.check(client_id).await;
        assert_eq!(limiter.remaining(client_id).await, 4);

        limiter.check(client_id).await;
        assert_eq!(limiter.remaining(client_id).await, 3);

        limiter.check(client_id).await;
        assert_eq!(limiter.remaining(client_id).await, 2);
    }

    #[tokio::test]
    async fn test_rate_limiter_blocking() {
        let config = RateLimiterConfig {
            max_requests: 2,
            window_seconds: 1,
            enabled: true,
        };

        let limiter = RateLimiter::new(config);
        let client_id = "test-client";

        // Exceed limit
        assert!(limiter.check(client_id).await);
        assert!(limiter.check(client_id).await);
        assert!(!limiter.check(client_id).await); // Should be blocked

        // Should still be blocked
        assert!(!limiter.check(client_id).await);
        assert_eq!(limiter.remaining(client_id).await, 0);

        // Wait for block to expire (5 minutes in real config, but we can't wait that long)
        // In a real test, you'd mock the time
    }

    #[tokio::test]
    async fn test_rate_limiter_disabled() {
        let config = RateLimiterConfig {
            max_requests: 1,
            window_seconds: 1,
            enabled: false,
        };

        let limiter = RateLimiter::new(config);
        let client_id = "test-client";

        // Should always succeed when disabled
        assert!(limiter.check(client_id).await);
        assert!(limiter.check(client_id).await);
        assert!(limiter.check(client_id).await);

        // Remaining should always be max_requests
        assert_eq!(limiter.remaining(client_id).await, 1);
    }

    #[tokio::test]
    async fn test_rate_limiter_cleanup() {
        let config = RateLimiterConfig {
            max_requests: 5,
            window_seconds: 1,
            enabled: true,
        };

        let limiter = RateLimiter::new(config);
        let client_id = "test-client";

        // Make a request
        limiter.check(client_id).await;

        // Should have entry
        let state = limiter.state.read().await;
        assert!(state.contains_key(client_id));
        drop(state);

        // Wait for request to expire (2x window for cleanup)
        tokio::time::sleep(Duration::from_secs(3)).await;

        // Clean up
        limiter.cleanup().await;

        // Entry should be removed
        let state = limiter.state.read().await;
        assert!(!state.contains_key(client_id));
    }

    #[test]
    fn test_rate_limiter_config_default() {
        let config = RateLimiterConfig::default();

        assert_eq!(config.max_requests, 100);
        assert_eq!(config.window_seconds, 60);
        assert!(config.enabled);
    }
}
