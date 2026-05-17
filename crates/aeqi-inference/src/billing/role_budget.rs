//! Role-budget gating lane — second-tier accounting on top of the
//! workspace subscription lane.
//!
//! The subscription lane (`subscription.rs`) bills the workspace for
//! every inference call. The role-budget lane is a per-role accounting
//! layer that lets a TRUST track how each chair burns its inference
//! allowance, with optional pre-flight rejection when the budget is
//! exhausted.
//!
//! See `architecture_role_budget_canonical.md` § 14 (Inference rail
//! integration) for the design.
//!
//! ## Wire shape
//!
//! Headers (read on every `/v1/*` request):
//! - `X-Trust`: trust id (already extracted by the subscription layer).
//! - `X-Role-Id`: role the calling agent is acting as. Required when
//!   role gating is active for the workspace; ignored when the gate is
//!   the no-op variant.
//! - `X-Budget-Id`: optional explicit budget id. When omitted, the gate
//!   resolves to the role's primary budget.
//! - `X-Actor-Agent`: agent id to record on the spend event (for
//!   per-agent attribution).
//!
//! ## Phasing
//!
//! Phase 1 (this commit): trait + [`NoOpBudgetGate`] default.
//! aeqi-inference compiles standalone; existing tests are unaffected.
//!
//! Phase 2 (cross-repo): aeqi-platform implements [`BudgetGate`] by
//! calling the orchestrator IPC verbs `get_allowance` and
//! `spend_inference`. Wiring lives in aeqi-platform/src/inference.rs.

use async_trait::async_trait;
use std::sync::Arc;

/// Outcome of a pre-flight cap check.
#[derive(Debug, Clone)]
pub enum BudgetGateOutcome {
    /// Cap check passed (or gating skipped). The call may proceed.
    /// `resolved_budget_id` carries the budget the gate selected (the
    /// caller's `X-Budget-Id` if provided, else the role's primary
    /// budget). Settle uses this id to dedupe + debit.
    Allowed {
        resolved_budget_id: String,
        remaining_micro_usd: i64,
    },
    /// Insufficient headroom. The handler returns HTTP 402.
    Insufficient {
        budget_id: String,
        role_id: String,
        remaining_micro_usd: i64,
    },
    /// The gate is no-op for this trust (feature flag off, or trust
    /// has no `treasury_config`). The call proceeds; settle is a no-op.
    Skipped,
    /// Auth / identity error — e.g. missing `X-Role-Id` when gating is
    /// required, or role not in the trust. Handler returns HTTP 403.
    Forbidden(String),
    /// Internal error — handler should return 500 with the message.
    Error(String),
}

/// Errors from the post-settle path. Settle is best-effort; a failed
/// settle is logged and surfaced but does NOT block the in-flight
/// response (the user already paid the upstream cost).
#[derive(Debug, thiserror::Error)]
pub enum BudgetGateError {
    #[error("settle failed: {0}")]
    Settle(String),
}

/// The integration seam between aeqi-inference and the orchestrator's
/// budget primitive. aeqi-platform implements this with an IPC client;
/// tests + standalone inference use [`NoOpBudgetGate`].
#[async_trait]
pub trait BudgetGate: Send + Sync {
    /// Pre-flight cap check. Called BEFORE the upstream provider is
    /// invoked. Returning `Insufficient` causes the handler to short-
    /// circuit with HTTP 402.
    async fn pre_flight(
        &self,
        trust_id: &str,
        role_id: Option<&str>,
        budget_id: Option<&str>,
        estimated_micro_usd: i64,
    ) -> BudgetGateOutcome;

    /// Post-settle debit. Called AFTER the upstream provider has
    /// returned and we know the actual cost. Idempotent on
    /// `request_hash` — a duplicate settle is a no-op (the underlying
    /// `treasury_events.idempotency_key` is the dedup field).
    async fn settle(
        &self,
        trust_id: &str,
        budget_id: &str,
        actual_micro_usd: i64,
        request_hash: &str,
        actor_agent_id: &str,
    ) -> Result<(), BudgetGateError>;
}

/// Default gate — every call returns [`BudgetGateOutcome::Skipped`].
/// Used when `INFERENCE_ROLE_GATING` is off, in tests, and in the
/// standalone aeqi-inference dev harness.
#[derive(Debug, Default, Clone)]
pub struct NoOpBudgetGate;

#[async_trait]
impl BudgetGate for NoOpBudgetGate {
    async fn pre_flight(
        &self,
        _trust_id: &str,
        _role_id: Option<&str>,
        _budget_id: Option<&str>,
        _estimated_micro_usd: i64,
    ) -> BudgetGateOutcome {
        BudgetGateOutcome::Skipped
    }

    async fn settle(
        &self,
        _trust_id: &str,
        _budget_id: &str,
        _actual_micro_usd: i64,
        _request_hash: &str,
        _actor_agent_id: &str,
    ) -> Result<(), BudgetGateError> {
        Ok(())
    }
}

/// Type alias used in [`crate::api::AppState`].
pub type SharedBudgetGate = Arc<dyn BudgetGate>;

/// Compute the canonical `request_hash` for a given inference call.
/// Used by the gate's `settle` so that retries within an epoch dedupe
/// on the same request id, and by the audit log so events line up
/// with upstream provider traces.
///
/// `workspace_id`: stable per-tenant id (the trust id from `X-Trust`).
/// `request_id`: a per-call identifier — typically the response's
///               `id` from the upstream provider's chat-completion
///               envelope. Falls back to a uuid if absent.
/// `model`: the model the call routed to.
/// `prompt_tokens` + `completion_tokens`: usage the upstream returned.
pub fn request_hash(
    workspace_id: &str,
    request_id: &str,
    model: &str,
    prompt_tokens: u32,
    completion_tokens: u32,
) -> String {
    use std::hash::{DefaultHasher, Hash, Hasher};
    let mut h = DefaultHasher::new();
    workspace_id.hash(&mut h);
    request_id.hash(&mut h);
    model.hash(&mut h);
    prompt_tokens.hash(&mut h);
    completion_tokens.hash(&mut h);
    format!("ihash-{:016x}", h.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn no_op_gate_skips_pre_flight() {
        let gate = NoOpBudgetGate;
        let outcome = gate.pre_flight("trust-1", None, None, 100).await;
        assert!(matches!(outcome, BudgetGateOutcome::Skipped));
    }

    #[tokio::test]
    async fn no_op_gate_settles_ok() {
        let gate = NoOpBudgetGate;
        let res = gate
            .settle("trust-1", "budget-1", 50, "req-1", "agent-1")
            .await;
        assert!(res.is_ok());
    }

    #[test]
    fn request_hash_is_stable_for_same_inputs() {
        let a = request_hash("ws-1", "req-1", "deepseek-v3", 100, 200);
        let b = request_hash("ws-1", "req-1", "deepseek-v3", 100, 200);
        assert_eq!(a, b);
    }

    #[test]
    fn request_hash_changes_with_inputs() {
        let a = request_hash("ws-1", "req-1", "deepseek-v3", 100, 200);
        let b = request_hash("ws-1", "req-2", "deepseek-v3", 100, 200);
        assert_ne!(a, b);
    }

    #[test]
    fn request_hash_format_starts_with_prefix() {
        let h = request_hash("ws-1", "req-1", "model-x", 1, 1);
        assert!(h.starts_with("ihash-"));
        assert_eq!(h.len(), "ihash-".len() + 16);
    }
}
