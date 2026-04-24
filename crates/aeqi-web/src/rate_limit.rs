//! Rate limit tiers.
//!
//! Thin wrapper over `tower_governor` (GCRA via the `governor` crate).  Two
//! tiers keyed by peer IP with `SmartIpKeyExtractor` — respects
//! `X-Forwarded-For` / `X-Real-IP` when behind a proxy, falls back to the
//! direct socket address otherwise.  The previous hand-rolled `HashMap<IP,
//! Vec<Instant>>` limiter is gone — `governor` does this correctly with
//! constant memory per key.
//!
//! Tiers:
//!
//!   [`loose`] — steady 10 req/s with a 100-req burst.  Default for
//!     authenticated reads + the general `/api/*` surface.  A browser SPA
//!     that polls six endpoints every 30s won't come close.
//!
//!   [`tight`] — steady 1 req/s with a 10-req burst.  Credential-testing
//!     endpoints (login, signup, verify, password reset, OAuth callbacks)
//!     where abuse *actually* matters.
//!
//! On 429, `tower_governor` emits the RFC 7231 `Retry-After` header so the
//! frontend's fetch wrapper can back off cleanly without guessing.

use std::{sync::Arc, time::Duration};
use tower_governor::{
    governor::{GovernorConfig, GovernorConfigBuilder},
    key_extractor::SmartIpKeyExtractor,
};

/// Concrete type of a configured tier — opaque to callers, who only need
/// it to hand to `GovernorLayer { config: ... }`.
pub type Tier = GovernorConfig<SmartIpKeyExtractor, governor::middleware::NoOpMiddleware>;

/// Loose tier — general API traffic.  10 req/s steady, 100-req burst.
pub fn loose() -> Arc<Tier> {
    build(Duration::from_millis(100), 100, "loose")
}

/// Tight tier — auth/credential endpoints.  1 req/s steady, 10-req burst.
pub fn tight() -> Arc<Tier> {
    build(Duration::from_secs(1), 10, "tight")
}

// tower_governor's `per_second(n)` actually means "one token every n
// seconds" (the period between refills), *not* n requests per second.
// We specify the period as a Duration to avoid ever tripping over that
// naming trap again — the variable name makes the meaning unambiguous.
fn build(replenish_period: Duration, burst: u32, name: &'static str) -> Arc<Tier> {
    let config = Arc::new(
        GovernorConfigBuilder::default()
            .key_extractor(SmartIpKeyExtractor)
            .period(replenish_period)
            .burst_size(burst)
            .finish()
            .expect("rate-limit: tier config rejected by governor"),
    );
    spawn_cleanup(config.clone(), name);
    config
}

/// Spawn a background task that prunes stale per-IP entries from the
/// tier's state every 60s.  Without this the governor's DashMap can grow
/// unbounded under sustained unique-IP traffic (scanners, CDN rotations).
fn spawn_cleanup(config: Arc<Tier>, name: &'static str) {
    let limiter = config.limiter().clone();
    tokio::spawn(async move {
        let interval = Duration::from_secs(60);
        loop {
            tokio::time::sleep(interval).await;
            let before = limiter.len();
            limiter.retain_recent();
            let after = limiter.len();
            if before != after {
                tracing::debug!(tier = name, before, after, "rate-limit state pruned");
            }
        }
    });
}
