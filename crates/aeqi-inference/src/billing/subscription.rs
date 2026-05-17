//! Subscription billing lane — JWT auth + dollar-balance debit.
//!
//! Tower [`Layer`] / [`Service`] stub for the subscription lane.
//!
//! **Current state (skeleton):** The middleware checks that `Authorization:
//! Bearer <token>` is present and that `X-Trust` is non-empty. No real JWT
//! validation occurs — that is deferred to Phase 1 implementation which will
//! verify signatures against aeqi-platform's JWT secret.
//!
//! **Phase 1 TODO:**
//! - Decode and verify the JWT (HS256 or RS256 depending on platform key type).
//! - Resolve `trust_id` from the `sub` claim.
//! - Read `inference_balance_cents` from an LRU-backed SQLite cache.
//! - Return 402 if balance == 0 and no Stripe top-up credit available.
//! - After response streams, debit `tokens_to_cents(usage, model)` from balance.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    task::{Context, Poll},
};

use axum::http::{Request, Response, StatusCode};
use futures::future::BoxFuture;
use tower::{Layer, Service};

/// In-memory stub balance store. Keyed by trust_id.
///
/// Phase 1 replacement: LRU cache backed by `inference_balance_cents` column
/// in platform SQLite.
#[derive(Clone, Debug, Default)]
pub struct BalanceStore {
    inner: Arc<Mutex<HashMap<String, i64>>>,
}

impl BalanceStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the current balance in cents for `trust_id`.
    /// Returns `None` if the entity has no record (treated as zero).
    pub fn get(&self, trust_id: &str) -> Option<i64> {
        self.inner.lock().unwrap().get(trust_id).copied()
    }

    /// Set the balance for `trust_id` (used in tests).
    pub fn set(&self, trust_id: &str, cents: i64) {
        self.inner
            .lock()
            .unwrap()
            .insert(trust_id.to_owned(), cents);
    }
}

/// Tower layer that injects subscription billing middleware.
#[derive(Clone)]
pub struct SubscriptionLayer {
    store: BalanceStore,
}

impl SubscriptionLayer {
    pub fn new(store: BalanceStore) -> Self {
        Self { store }
    }
}

impl<S> Layer<S> for SubscriptionLayer {
    type Service = SubscriptionMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        SubscriptionMiddleware {
            inner,
            store: self.store.clone(),
        }
    }
}

/// Tower service that enforces subscription billing checks.
#[derive(Clone)]
pub struct SubscriptionMiddleware<S> {
    inner: S,
    store: BalanceStore,
}

impl<S, ReqBody, ResBody> Service<Request<ReqBody>> for SubscriptionMiddleware<S>
where
    S: Service<Request<ReqBody>, Response = Response<ResBody>> + Clone + Send + 'static,
    S::Future: Send + 'static,
    ReqBody: Send + 'static,
    ResBody: Default + Send + 'static,
{
    type Response = Response<ResBody>;
    type Error = S::Error;
    type Future = BoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<ReqBody>) -> Self::Future {
        let auth = req
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_owned());
        let trust_id = req
            .headers()
            .get("x-entity")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_owned());

        // --- Stub auth check ---
        // Phase 1: decode JWT, verify signature, extract sub claim.
        let bearer = auth
            .as_deref()
            .and_then(|a| a.strip_prefix("Bearer "))
            .map(|s| s.to_owned());
        if bearer.is_none() {
            return Box::pin(async move {
                let mut res = Response::new(ResBody::default());
                *res.status_mut() = StatusCode::UNAUTHORIZED;
                Ok(res)
            });
        }

        // --- Stub balance check ---
        // Phase 1: replace with real LRU-cached SQLite read.
        let trust_id = trust_id.unwrap_or_else(|| "unknown".to_owned());
        let balance = self.store.get(&trust_id).unwrap_or(0);

        if balance <= 0 {
            tracing::warn!(trust_id, "subscription balance exhausted — returning 402");
            return Box::pin(async move {
                let mut res = Response::new(ResBody::default());
                *res.status_mut() = StatusCode::PAYMENT_REQUIRED;
                Ok(res)
            });
        }

        tracing::debug!(trust_id, balance, "subscription check passed");

        let mut inner = self.inner.clone();
        Box::pin(async move { inner.call(req).await })
    }
}
