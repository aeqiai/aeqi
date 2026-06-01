//! axum router exposing OpenAI-compatible inference endpoints.
//!
//! Mount in aeqi-platform via:
//! ```rust,ignore
//! use aeqi_inference::{AppState, DeepInfraProvider, InferenceRouter, create_router};
//! use aeqi_inference::billing::subscription::{BalanceStore, SubscriptionLayer};
//! use std::sync::Arc;
//!
//! let mut router = InferenceRouter::new();
//! router.register("deepinfra", Arc::new(DeepInfraProvider::from_env()));
//! let state = AppState::new(router, BalanceStore::new());
//! let routes = create_router(state).layer(SubscriptionLayer::new(BalanceStore::new()));
//! let app = axum_app.nest("/v1", routes);
//! ```
//!
//! The router itself is stateless — all mutable state lives in [`AppState`].

use std::sync::Arc;

use axum::{
    Router,
    body::Body,
    extract::{Json, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures::StreamExt;
use serde_json::json;
use tracing::warn;

use crate::{
    billing::role_budget::{
        BudgetGateOutcome, NoOpBudgetGate, SharedBudgetGate, request_hash as compute_request_hash,
    },
    billing::subscription::BalanceStore,
    error::InferenceError,
    router::Router as InferenceRouter,
    types::{
        ChatCompletionRequest, EmbeddingRequest, InferenceProvisioningStatus, ModelInfo, ModelList,
    },
    upstream::deepinfra::compute_cost_microdollars,
};

// ---------------------------------------------------------------------------
// Shared application state
// ---------------------------------------------------------------------------

/// State shared across all axum handlers.
///
/// Cheap to clone — all fields are `Arc`-backed.
#[derive(Clone)]
pub struct AppState {
    /// Model → provider dispatch table.
    pub router: Arc<InferenceRouter>,
    /// Subscription balance store. Phase 1: in-memory keyed by trust_id.
    pub balances: BalanceStore,
    /// Role-budget gate. Defaults to [`NoOpBudgetGate`] which makes
    /// pre-flight a no-op and settle a no-op. aeqi-platform plugs in a
    /// real gate (IPC client to the orchestrator's `get_allowance` /
    /// `spend_inference` verbs) when the workspace has role gating
    /// enabled. See `architecture_role_budget_canonical.md` § 14.
    pub budget_gate: SharedBudgetGate,
    /// Runtime/provider ownership and allowance status for provisioning UIs.
    pub provisioning: InferenceProvisioningStatus,
}

impl AppState {
    pub fn new(router: InferenceRouter, balances: BalanceStore) -> Self {
        Self {
            router: Arc::new(router),
            balances,
            budget_gate: Arc::new(NoOpBudgetGate),
            provisioning: InferenceProvisioningStatus::default(),
        }
    }

    /// Plug in a real [`BudgetGate`](crate::billing::role_budget::BudgetGate).
    /// aeqi-platform calls this with its IPC-backed implementation.
    pub fn with_budget_gate(mut self, gate: SharedBudgetGate) -> Self {
        self.budget_gate = gate;
        self
    }

    /// Override the runtime/provider provisioning status exposed by
    /// `GET /provisioning`.
    pub fn with_provisioning(mut self, provisioning: InferenceProvisioningStatus) -> Self {
        self.provisioning = provisioning;
        self
    }
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/// Construct the axum `Router` for all OpenAI-compat endpoints.
///
/// Apply the subscription billing middleware layer on top of this router
/// before nesting into aeqi-platform:
/// ```rust,ignore
/// create_router(state).layer(SubscriptionLayer::new(store))
/// ```
pub fn create_router(state: AppState) -> Router {
    Router::new()
        .route("/chat/completions", post(chat_completions_handler))
        .route("/embeddings", post(embeddings_handler))
        .route("/models", get(models_handler))
        .route("/provisioning", get(provisioning_handler))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// `POST /v1/chat/completions`
///
/// Routes to the registered upstream provider. Supports both streaming (SSE)
/// and non-streaming responses. Cost is debited from the entity's balance
/// after the response is received (non-streaming) or estimated pre-call
/// (streaming, to be reconciled post-stream in Phase 2).
///
/// Entity ID is read from the `X-Trust` request header, set by the
/// subscription middleware after JWT validation.
async fn chat_completions_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChatCompletionRequest>,
) -> Response {
    // Extract trust_id for cost accounting. Falls back to "unknown" when
    // the middleware has not injected the header (e.g. in tests that bypass
    // the middleware layer).
    let trust_id = headers.entity_id().unwrap_or_else(|| "unknown".to_owned());

    // Role-budget gate inputs (optional headers; the no-op gate ignores
    // them, the IPC-backed gate enforces).
    let role_id = header_string(&headers, "x-role-id");
    let budget_id_hint = header_string(&headers, "x-budget-id");
    let actor_agent = header_string(&headers, "x-actor-agent").unwrap_or_else(|| trust_id.clone());

    // Pre-flight cap check. Estimate is cheap and conservative — actual
    // settle reconciles after upstream returns. We use 1 cent (100
    // micro-USD * 10_000 = 1_000_000 micro-USD = 1¢) as the floor so
    // the gate fires when the budget has zero headroom. Real cost is
    // applied on settle.
    let estimate_micro_usd = 1_000_000_i64;
    let pre = state
        .budget_gate
        .pre_flight(
            &trust_id,
            role_id.as_deref(),
            budget_id_hint.as_deref(),
            estimate_micro_usd,
        )
        .await;
    let resolved_budget_id = match pre {
        BudgetGateOutcome::Allowed {
            resolved_budget_id, ..
        } => Some(resolved_budget_id),
        BudgetGateOutcome::Skipped => None,
        BudgetGateOutcome::Insufficient {
            budget_id,
            role_id,
            remaining_micro_usd,
        } => {
            return (
                StatusCode::PAYMENT_REQUIRED,
                Json(json!({
                    "error": {
                        "type": "insufficient_budget_inference",
                        "message": format!(
                            "budget {budget_id} exhausted (remaining {remaining_micro_usd} \
                             micro-USD); role {role_id} cannot make this call",
                        ),
                        "budget_id": budget_id,
                        "role_id": role_id,
                        "remaining_micro_usd": remaining_micro_usd,
                    }
                })),
            )
                .into_response();
        }
        BudgetGateOutcome::Forbidden(msg) => {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({"error": {"type": "forbidden", "message": msg}})),
            )
                .into_response();
        }
        BudgetGateOutcome::Error(msg) => {
            warn!(error = %msg, "budget gate pre-flight error");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": {"type": "internal", "message": msg}})),
            )
                .into_response();
        }
    };

    if req.stream {
        handle_streaming(state, trust_id, req).await
    } else {
        handle_non_streaming(state, trust_id, req, resolved_budget_id, actor_agent).await
    }
}

fn header_string(headers: &HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

trait InferenceHeaderExt {
    fn entity_id(&self) -> Option<String>;
}

impl InferenceHeaderExt for HeaderMap {
    fn entity_id(&self) -> Option<String> {
        header_string(self, "x-entity").or_else(|| header_string(self, "x-trust"))
    }
}

/// Non-streaming path: call upstream, debit cost, return JSON.
async fn handle_non_streaming(
    state: AppState,
    trust_id: String,
    req: ChatCompletionRequest,
    resolved_budget_id: Option<String>,
    actor_agent: String,
) -> Response {
    let model = req.model.clone();
    match state.router.chat_completion(req).await {
        Ok(resp) => {
            // Debit cost from the entity's balance.
            if let Some(usage) = &resp.usage {
                let cost =
                    compute_cost_microdollars(&model, usage.prompt_tokens, usage.completion_tokens);
                // Phase 1: in-memory debit. Phase 2: SQLite write.
                // cost is in micro-dollars; store uses cents; convert (100 cents = $1 = 1e8 microdollars).
                let cost_cents = (cost / 1_000_000) as i64; // truncate to cents
                if cost_cents > 0 {
                    let current = state.balances.get(&trust_id).unwrap_or(0);
                    state
                        .balances
                        .set(&trust_id, current.saturating_sub(cost_cents));
                    tracing::debug!(
                        trust_id,
                        model,
                        prompt_tokens = usage.prompt_tokens,
                        completion_tokens = usage.completion_tokens,
                        cost_microdollars = cost,
                        cost_cents,
                        "inference cost debited"
                    );
                }

                // Settle on the role-budget gate. No-op gate is a no-op;
                // IPC-backed gate calls `spend_inference` on the
                // orchestrator. Idempotent on `request_hash`. Failures
                // here are logged but don't fail the in-flight response
                // (the user already incurred the upstream cost).
                if let Some(budget_id) = resolved_budget_id {
                    let req_hash = compute_request_hash(
                        &trust_id,
                        &resp.id,
                        &model,
                        usage.prompt_tokens,
                        usage.completion_tokens,
                    );
                    if let Err(e) = state
                        .budget_gate
                        .settle(&trust_id, &budget_id, cost as i64, &req_hash, &actor_agent)
                        .await
                    {
                        warn!(
                            trust_id,
                            budget_id,
                            cost_microdollars = cost,
                            error = %e,
                            "budget gate settle failed (call already returned to client)"
                        );
                    }
                }
            }
            Json(resp).into_response()
        }
        Err(e) => inference_error_response(e),
    }
}

/// Streaming path: call upstream, pipe SSE chunks to client.
///
/// Cost estimation in Phase 1 is not per-token — we estimate 1 cent per
/// call to ensure the balance check fires, then reconcile in Phase 2 with
/// real token counts from the stream's final chunk.
async fn handle_streaming(
    state: AppState,
    _entity_id: String,
    req: ChatCompletionRequest,
) -> Response {
    match state.router.chat_completion_stream(req).await {
        Ok(stream) => {
            // Convert the chunk stream into an SSE byte stream.
            let sse_stream = stream.map(|result| {
                result
                    .map(|chunk| {
                        let json = serde_json::to_string(&chunk).unwrap_or_default();
                        format!("data: {json}\n\n").into_bytes()
                    })
                    .unwrap_or_else(|e| {
                        warn!(error = %e, "upstream chunk error in SSE stream");
                        format!("data: {{\"error\": \"{e}\"}}\n\n").into_bytes()
                    })
            });

            // Append the [DONE] sentinel that OpenAI-compatible clients expect.
            let done_sentinel = futures::stream::once(async { b"data: [DONE]\n\n".to_vec() });

            let full_stream = sse_stream.chain(done_sentinel);
            let body = Body::from_stream(full_stream.map(Ok::<_, std::convert::Infallible>));

            let mut headers = HeaderMap::new();
            headers.insert(
                "content-type",
                HeaderValue::from_static("text/event-stream"),
            );
            headers.insert("cache-control", HeaderValue::from_static("no-cache"));
            headers.insert("x-accel-buffering", HeaderValue::from_static("no"));

            (StatusCode::OK, headers, body).into_response()
        }
        Err(e) => inference_error_response(e),
    }
}

/// `POST /v1/embeddings`
///
/// Phase 2 TODO: route to an embedding model adapter.
async fn embeddings_handler(
    State(_state): State<AppState>,
    Json(req): Json<EmbeddingRequest>,
) -> Response {
    let msg = format!("embeddings not yet implemented for model '{}'", req.model);
    warn!(model = req.model, "embeddings endpoint not yet implemented");
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({ "error": { "message": msg, "type": "not_implemented" } })),
    )
        .into_response()
}

/// `GET /v1/models`
///
/// Returns the whitelisted DeepInfra models plus placeholder stubs for the
/// Anthropic / OpenAI / DeepSeek adapters (Phase 2).
async fn models_handler(State(_state): State<AppState>) -> Json<ModelList> {
    use crate::upstream::deepinfra::ALLOWED_MODELS;

    let created = 1_746_403_200_i64; // 2026-05-05 00:00:00 UTC

    let mut data: Vec<ModelInfo> = ALLOWED_MODELS
        .iter()
        .map(|id| ModelInfo {
            id: (*id).to_owned(),
            object: "model".to_owned(),
            created,
            owned_by: "deepinfra".to_owned(),
        })
        .collect();

    // Stub entries for providers wired in Phase 2.
    for (id, owner) in [
        ("gpt-5", "openai"),
        ("claude-sonnet-4-6", "anthropic"),
        ("deepseek-v4", "deepseek"),
    ] {
        data.push(ModelInfo {
            id: id.to_owned(),
            object: "model".to_owned(),
            created,
            owned_by: owner.to_owned(),
        });
    }

    Json(ModelList {
        object: "list".to_owned(),
        data,
    })
}

/// `GET /v1/provisioning`
///
/// Returns the runtime-level provider/billing ownership contract without
/// exposing provider credentials. AEQI-managed mode can include the caller's
/// current allowance when the platform supplies `x-entity`.
async fn provisioning_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<InferenceProvisioningStatus> {
    let mut status = state.provisioning.clone();

    if let Some(allowance) = status.allowance.as_mut()
        && allowance.remaining_cents.is_none()
        && let Some(entity) = headers.entity_id()
    {
        allowance.remaining_cents = state.balances.get(&entity);
    }

    Json(status)
}

// ---------------------------------------------------------------------------
// Error conversion helper (used in tests and streaming error path)
// ---------------------------------------------------------------------------

/// Convert an `InferenceError` to an axum `Response` with the correct status.
pub fn inference_error_response(err: InferenceError) -> Response {
    match err {
        InferenceError::Auth | InferenceError::AuthPermanent => (
            StatusCode::UNAUTHORIZED,
            Json(
                json!({ "error": { "message": err.to_string(), "type": "auth_error" } }),
            ),
        )
            .into_response(),
        InferenceError::NoBalance | InferenceError::Billing => (
            StatusCode::PAYMENT_REQUIRED,
            Json(
                json!({ "error": { "message": err.to_string(), "type": "billing_error" } }),
            ),
        )
            .into_response(),
        InferenceError::RateLimit { retry_after_secs } => {
            let msg = err.to_string();
            let mut resp = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({ "error": { "message": msg, "type": "rate_limit_error" } })),
            )
                .into_response();
            if let Some(secs) = retry_after_secs
                && let Ok(value) = secs.to_string().parse()
            {
                resp.headers_mut()
                    .insert(axum::http::header::RETRY_AFTER, value);
            }
            resp
        }
        InferenceError::Overloaded => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": { "message": err.to_string(), "type": "overloaded_error" } })),
        )
            .into_response(),
        InferenceError::ServerError(msg) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": { "message": msg, "type": "upstream_error" } })),
        )
            .into_response(),
        InferenceError::Timeout => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(json!({ "error": { "message": err.to_string(), "type": "upstream_error" } })),
        )
            .into_response(),
        InferenceError::ContextOverflow => (
            StatusCode::BAD_REQUEST,
            Json(
                json!({ "error": { "message": err.to_string(), "type": "context_overflow_error" } }),
            ),
        )
            .into_response(),
        InferenceError::ModelNotFound(msg) => (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": { "message": msg, "type": "model_not_found" } })),
        )
            .into_response(),
        InferenceError::Unsupported(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": { "message": msg, "type": "invalid_request_error" } })),
        )
            .into_response(),
        InferenceError::UpstreamUnavailable(msg) => (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": { "message": msg, "type": "upstream_error" } })),
        )
            .into_response(),
        InferenceError::Internal(msg) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": { "message": msg, "type": "internal_error" } })),
        )
            .into_response(),
    }
}
