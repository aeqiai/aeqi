//! Error types for aeqi-paymaster.

use thiserror::Error;

/// All errors that can occur in the paymaster service.
#[derive(Debug, Error)]
pub enum PaymasterError {
    /// SQLite database operation failed.
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    /// Entity not found in the platform DB — sponsorship denied by policy.
    #[error("entity not found: {0}")]
    EntityNotFound(String),

    /// Entity billing status is not active — sponsorship denied.
    #[error("entity billing inactive: {0}")]
    BillingInactive(String),

    /// Gas budget exhausted for this billing period.
    #[error("gas budget exhausted for entity {0}")]
    BudgetExhausted(String),

    /// Private key is missing or malformed.
    #[error("signer key error: {0}")]
    SignerKey(String),

    /// alloy signing failed.
    #[error("signing error: {0}")]
    Signing(String),

    /// JSON serialisation / deserialisation failure.
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    /// Generic internal error.
    #[error("internal error: {0}")]
    Internal(String),
}
