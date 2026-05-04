//! Shared data types for the paymaster service.

use serde::{Deserialize, Serialize};

/// Packed ERC-4337 UserOperation as received from the bundler.
///
/// Field names follow the ERC-4337 spec. All gas values are `u128` to avoid
/// U256 serialisation complexity in Phase-1; promote to `U256` when on-chain
/// verifier integration requires it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserOp {
    /// The account making the operation (the Entity contract address).
    pub sender: String,
    /// Anti-replay nonce (hex string).
    pub nonce: String,
    /// Encoded call data.
    pub call_data: String,
    /// Gas limit for the main execution call.
    pub call_gas_limit: u128,
    /// Gas limit for the account verification step.
    pub verification_gas_limit: u128,
    /// Pre-verification overhead gas.
    pub pre_verification_gas: u128,
    /// Maximum total fee per gas unit (wei).
    pub max_fee_per_gas: u128,
    /// Maximum priority fee per gas unit (wei).
    pub max_priority_fee_per_gas: u128,
    /// Existing paymaster data (usually empty — filled in by us).
    pub paymaster_and_data: String,
    /// Existing signature (usually empty — the account hasn't signed yet).
    pub signature: String,
}

/// Successful paymaster approval response.
///
/// The bundler appends `paymasterAndData` to the UserOp and resubmits.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SponsorResponse {
    /// ABI-encoded `abi.encode(address paymaster, uint48 validUntil, uint48 validAfter, bytes signature)`.
    pub paymaster_and_data: String,
    /// Validity window — upper bound (Unix timestamp, seconds).
    pub valid_until: u64,
    /// Validity window — lower bound (Unix timestamp, seconds).
    pub valid_after: u64,
    /// Paymaster signature over the UserOp hash.
    pub signature: String,
}

/// Error response body.
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub error: String,
}
