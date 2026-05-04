//! Paymaster hot-key signer.
//!
//! Wraps an alloy [`PrivateKeySigner`] loaded from the `PAYMASTER_PRIVATE_KEY`
//! environment variable. The key is a 32-byte hex-encoded secp256k1 private key
//! (no `0x` prefix required; `0x` is stripped if present).
//!
//! # Security
//!
//! The paymaster key is a "hot" signing key — it lives in process memory for the
//! service lifetime. Treat it like a Stripe secret key: rotate quarterly, restrict
//! OS-level file permissions on whatever secret store delivers it, and never log it.
//!
//! In Phase-2 this can be swapped for an AWS KMS or HashiCorp Vault backend by
//! replacing the `sign_paymaster_op` implementation with an async KMS call.

use alloy::primitives::{B256, keccak256};
use alloy::signers::Signer;
use alloy::signers::local::PrivateKeySigner;
use anyhow::{Context, Result};
use tracing::info;

use crate::error::PaymasterError;

/// Paymaster signer backed by an in-memory secp256k1 key.
pub struct PaymasterSigner {
    inner: PrivateKeySigner,
}

impl PaymasterSigner {
    /// Load the signer from the `PAYMASTER_PRIVATE_KEY` environment variable.
    ///
    /// Expects a 64-character hex string (32 bytes). The `0x` prefix is optional.
    pub fn from_env() -> Result<Self> {
        let raw = std::env::var("PAYMASTER_PRIVATE_KEY")
            .context("PAYMASTER_PRIVATE_KEY env var not set")?;
        let hex = raw.trim().trim_start_matches("0x");
        let inner = hex
            .parse::<PrivateKeySigner>()
            .map_err(|e| PaymasterError::SignerKey(format!("invalid private key: {e}")))?;
        info!(address = %inner.address(), "paymaster signer loaded");
        Ok(Self { inner })
    }

    /// Return the Ethereum address of the paymaster signing key.
    pub fn address(&self) -> alloy::primitives::Address {
        self.inner.address()
    }

    /// Sign a paymaster approval for the given parameters.
    ///
    /// The signed hash follows the ERC-4337 paymaster spec:
    ///   `keccak256(abi.encode(userOpHash, validUntil, validAfter))`
    ///
    /// The bundler will verify this signature against the paymaster contract's
    /// `validatePaymasterUserOp` implementation.
    ///
    /// Returns the 65-byte signature as a hex string prefixed with `0x`.
    pub async fn sign_paymaster_op(
        &self,
        user_op_hash: &str,
        valid_until: u64,
        valid_after: u64,
    ) -> Result<String, PaymasterError> {
        // Decode the UserOp hash.
        let hash_bytes = hex::decode(user_op_hash.trim_start_matches("0x"))
            .map_err(|e| PaymasterError::SignerKey(format!("invalid user_op_hash: {e}")))?;
        let user_op_hash_b256 = B256::from_slice(&hash_bytes);

        // Encode: keccak256(userOpHash ++ validUntil ++ validAfter)
        // Packed ABI encoding: 32 + 8 + 8 = 48 bytes.
        let mut packed = Vec::with_capacity(48);
        packed.extend_from_slice(user_op_hash_b256.as_slice());
        packed.extend_from_slice(&valid_until.to_be_bytes());
        packed.extend_from_slice(&valid_after.to_be_bytes());
        let signing_hash: B256 = keccak256(&packed);

        let sig = self
            .inner
            .sign_hash(&signing_hash)
            .await
            .map_err(|e| PaymasterError::Signing(e.to_string()))?;

        // Serialise to 65-byte hex (r || s || v).
        let sig_bytes = sig.as_bytes();
        Ok(format!("0x{}", hex::encode(sig_bytes)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_signer() -> PaymasterSigner {
        // Known test key — never use in production.
        // Private: ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
        // Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
        // SAFETY: single-threaded test context; no concurrent env reads.
        unsafe {
            std::env::set_var(
                "PAYMASTER_PRIVATE_KEY",
                "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            );
        }
        PaymasterSigner::from_env().unwrap()
    }

    #[tokio::test]
    async fn test_sign_returns_65_byte_hex() {
        let signer = test_signer();
        let dummy_hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let sig = signer
            .sign_paymaster_op(dummy_hash, 9999999999, 0)
            .await
            .unwrap();
        // 0x prefix + 130 hex chars = 132 chars total
        assert!(sig.starts_with("0x"));
        assert_eq!(sig.len(), 132, "expected 65-byte (130 hex char) signature");
    }

    #[tokio::test]
    async fn test_sign_invalid_hash_returns_error() {
        let signer = test_signer();
        let result = signer.sign_paymaster_op("not-hex", 0, 0).await;
        assert!(result.is_err());
    }
}
