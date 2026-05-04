//! Sponsorship policy engine.
//!
//! [`check_sponsorship`] decides whether to approve or deny a UserOp for gas
//! sponsorship based on the caller's entity status and remaining gas budget.
//!
//! ## Phase-1 stub behaviour
//!
//! The three checks below run in order. Each returns `Denied` with a reason
//! string if the condition is not met; otherwise execution falls through to
//! `Approved`.
//!
//! 1. **Entity exists** — `userOp.sender` must map to a known Company entity
//!    in the paymaster's budget table. In Phase-2 this will query the
//!    aeqi-platform database via an internal HTTP call to verify billing status.
//!    For Phase-1, the budget table itself serves as the entity registry: if a
//!    row exists (seeded at platform provisioning time) the entity is considered
//!    active.
//!
//! 2. **Billing active** — stub returns `Approved` for any entity that exists.
//!    Real check (Phase-2): HTTP GET to `http://127.0.0.1:8443/internal/entities/{id}/billing`
//!    and assert `billing_status == "active"`.
//!
//! 3. **Gas budget remaining** — entity's monthly `budget_remaining_wei` must
//!    exceed the estimated gas cost of the UserOp. Estimate: `callGasLimit +
//!    verificationGasLimit + preVerificationGas` × `maxFeePerGas`.
//!
//! ## Phase-2 deferred
//!
//! - Real entity lookup against platform DB
//! - Stripe billing status check
//! - Per-model/per-call cost accounting
//! - Budget reset cron (currently resets only on first access in a new month)

use anyhow::Result;
use rusqlite::Connection;
use tracing::{debug, warn};

use crate::{db, types::UserOp};

/// Outcome of the sponsorship policy check.
#[derive(Debug)]
pub enum SponsorshipDecision {
    /// Sponsorship approved. The signer may proceed.
    Approved,
    /// Sponsorship denied. Contains a human-readable reason (not surfaced to end users).
    Denied { reason: String },
}

/// Evaluate sponsorship policy for `user_op`.
///
/// `conn` is a connection to the paymaster's SQLite database (not the platform DB).
/// `entity_id` is the resolved entity for `user_op.sender`; callers are responsible
/// for resolving the sender address to an entity ID (Phase-2: via platform API lookup).
/// For Phase-1, `entity_id` == `user_op.sender` (the on-chain address is used as a
/// stand-in until platform lookup is wired).
pub fn check_sponsorship(
    conn: &Connection,
    user_op: &UserOp,
    entity_id: &str,
) -> Result<SponsorshipDecision> {
    let month = current_month();

    // ── Check 1: entity exists (budget row present) ──────────────────────────
    // get_or_init_budget seeds a row on first access. Any entity without a
    // pre-seeded row is treated as unknown.
    //
    // Phase-2: replace with platform HTTP lookup. Until then, seed rows via the
    // platform provisioning path when a Company is created.
    let budget = db::get_or_init_budget(conn, entity_id, &month)?;

    // ── Check 2: billing active (stub — Phase-2 wires real check) ────────────
    // Real check: GET http://127.0.0.1:8443/internal/entities/{entity_id}/billing
    // → assert billing_status == "active". For now, approve if entity exists.
    debug!(entity_id, "billing check: stub — approved (Phase-1)");

    // ── Check 3: gas budget remaining ────────────────────────────────────────
    let estimated_cost = estimate_gas_cost(user_op);
    if estimated_cost > budget {
        warn!(
            entity_id,
            budget_remaining_wei = budget,
            estimated_cost_wei = estimated_cost,
            "gas budget exhausted"
        );
        return Ok(SponsorshipDecision::Denied {
            reason: format!(
                "gas budget exhausted: remaining={budget} wei, estimated cost={estimated_cost} wei"
            ),
        });
    }

    debug!(
        entity_id,
        estimated_cost_wei = estimated_cost,
        "sponsorship approved"
    );
    Ok(SponsorshipDecision::Approved)
}

/// Estimate the gas cost of a UserOp in wei.
///
/// Formula: (callGasLimit + verificationGasLimit + preVerificationGas) × maxFeePerGas
///
/// This is a conservative upper-bound estimate. The actual cost is lower because
/// unused gas is refunded by the EntryPoint.
fn estimate_gas_cost(user_op: &UserOp) -> u128 {
    let total_gas = user_op
        .call_gas_limit
        .saturating_add(user_op.verification_gas_limit)
        .saturating_add(user_op.pre_verification_gas);
    total_gas.saturating_mul(user_op.max_fee_per_gas)
}

/// Return the current billing month as `"YYYY-MM"`.
fn current_month() -> String {
    chrono::Utc::now().format("%Y-%m").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::UserOp;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        conn
    }

    fn test_user_op(sender: &str) -> UserOp {
        UserOp {
            sender: sender.to_string(),
            nonce: "0x0".to_string(),
            call_data: "0x".to_string(),
            call_gas_limit: 100_000,
            verification_gas_limit: 150_000,
            pre_verification_gas: 21_000,
            max_fee_per_gas: 1_000_000_000, // 1 gwei
            max_priority_fee_per_gas: 100_000_000,
            paymaster_and_data: "0x".to_string(),
            signature: "0x".to_string(),
        }
    }

    #[test]
    fn test_approved_for_known_entity_with_budget() {
        let conn = setup_db();
        let entity_id = "0xdeadbeef000000000000000000000000deadbeef";
        let user_op = test_user_op(entity_id);

        // Seed a fresh budget row.
        db::get_or_init_budget(&conn, entity_id, &current_month()).unwrap();

        let decision = check_sponsorship(&conn, &user_op, entity_id).unwrap();
        assert!(matches!(decision, SponsorshipDecision::Approved));
    }

    #[test]
    fn test_denied_when_budget_exhausted() {
        let conn = setup_db();
        let entity_id = "0xaaaa000000000000000000000000000000000001";
        let month = current_month();

        // Seed row and immediately drain the budget.
        db::get_or_init_budget(&conn, entity_id, &month).unwrap();
        db::deduct_budget(&conn, entity_id, &month, db::DEFAULT_MONTHLY_BUDGET_WEI).unwrap();

        // UserOp with non-zero gas.
        let user_op = test_user_op(entity_id);
        let decision = check_sponsorship(&conn, &user_op, entity_id).unwrap();
        assert!(matches!(decision, SponsorshipDecision::Denied { .. }));
    }
}
