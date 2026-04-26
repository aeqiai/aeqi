//! Master KEK abstraction with pluggable backends.
//!
//! The `MasterKekProvider` trait wraps and unwraps per-wallet KEKs. The DB
//! stores only `(wallet_id, wrapped_kek_ciphertext, kek_version)`; the master
//! KEK never touches disk in plaintext. v1 ships with the software backend
//! (Argon2id-derived from an operator passphrase). v2 adds AWS KMS, GCP KMS,
//! YubiHSM, and Nitro Enclave implementations behind Cargo features.

mod software;

pub use software::SoftwareKek;

use thiserror::Error;
use zeroize::Zeroizing;

#[derive(Debug, Error)]
pub enum KekError {
    #[error("KEK bootstrap failed: {0}")]
    Bootstrap(String),
    #[error("wrap failed: {0}")]
    Wrap(String),
    #[error("unwrap failed: {0}")]
    Unwrap(String),
    #[error("rotation failed: {0}")]
    Rotation(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// 32-byte plaintext KEK material that zeroizes when dropped.
pub type SecretKek = Zeroizing<[u8; 32]>;

/// Receipt returned after a successful KEK rotation. Lets the caller write a
/// versioned audit trail.
#[derive(Debug, Clone)]
pub struct RotationReceipt {
    pub old_version: u32,
    pub new_version: u32,
    pub rotated_wallet_count: u64,
    pub at: chrono::DateTime<chrono::Utc>,
}

/// All KEK backends implement this trait. Same code paths across deployment
/// modes; only the backend differs.
#[async_trait::async_trait]
pub trait MasterKekProvider: Send + Sync {
    /// Encrypt a 32-byte plaintext per-wallet KEK; returns opaque ciphertext.
    async fn wrap(&self, plaintext: &[u8; 32]) -> Result<Vec<u8>, KekError>;

    /// Decrypt a wrapped per-wallet KEK. Caller MUST zeroize the returned
    /// secret immediately after use (handled by `SecretKek`'s Drop).
    async fn unwrap(&self, ciphertext: &[u8]) -> Result<SecretKek, KekError>;

    /// Current key version. Increments on rotate().
    fn version(&self) -> u32;

    /// Rotate the master KEK and re-wrap every per-wallet KEK ciphertext.
    /// Implementations that don't need to re-wrap (KMS-backed, where the
    /// master KEK is opaque) may return a no-op receipt.
    async fn rotate(&self) -> Result<RotationReceipt, KekError>;

    /// Optional attestation document (Nitro Enclave PCRs, etc.). Returns None
    /// for backends without verifiable attestation.
    fn attestation(&self) -> Option<Vec<u8>> {
        None
    }
}
