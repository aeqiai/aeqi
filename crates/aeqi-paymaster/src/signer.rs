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
    /// The signed hash matches Paymaster.sol `validatePaymasterUserOp`:
    ///   `keccak256(abi.encodePacked(userOpHash, validUntil, validAfter, paymaster_address))`
    ///
    /// The `paymaster_address` is the deployed Paymaster.sol contract address — it must
    /// be committed to the digest so the contract cannot be replayed against a different
    /// deployment. The address is 20 bytes, not zero-padded to 32.
    ///
    /// Returns the 65-byte signature as a hex string prefixed with `0x`.
    pub async fn sign_paymaster_op(
        &self,
        user_op_hash: &str,
        valid_until: u64,
        valid_after: u64,
        paymaster_address: &str,
    ) -> Result<String, PaymasterError> {
        // Decode the UserOp hash.
        let hash_bytes = hex::decode(user_op_hash.trim_start_matches("0x"))
            .map_err(|e| PaymasterError::SignerKey(format!("invalid user_op_hash: {e}")))?;
        let user_op_hash_b256 = B256::from_slice(&hash_bytes);

        // Decode the paymaster contract address (20 bytes).
        let addr_bytes = hex::decode(paymaster_address.trim_start_matches("0x"))
            .map_err(|e| PaymasterError::SignerKey(format!("invalid paymaster_address: {e}")))?;
        if addr_bytes.len() != 20 {
            return Err(PaymasterError::SignerKey(format!(
                "paymaster_address must be 20 bytes, got {}",
                addr_bytes.len()
            )));
        }

        // Packed ABI encoding matching Paymaster.sol:
        //   keccak256(abi.encodePacked(userOpHash, validUntil, validAfter, address(this)))
        //   = keccak256(32 + 6 + 6 + 20 bytes = 64 bytes)
        //
        // validUntil and validAfter are uint48 (6 bytes each, big-endian).
        // The Solidity contract uses `uint48` which occupies 6 bytes in encodePacked.
        let mut packed = Vec::with_capacity(64);
        packed.extend_from_slice(user_op_hash_b256.as_slice()); // 32 bytes
        packed.extend_from_slice(&valid_until.to_be_bytes()[2..]); // uint48 = last 6 of 8 bytes
        packed.extend_from_slice(&valid_after.to_be_bytes()[2..]); // uint48 = last 6 of 8 bytes
        packed.extend_from_slice(&addr_bytes); // 20 bytes
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

    // Known zero address for unit tests — any valid 20-byte hex works.
    const TEST_PAYMASTER_ADDR: &str = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

    #[tokio::test]
    async fn test_sign_returns_65_byte_hex() {
        let signer = test_signer();
        let dummy_hash = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        let sig = signer
            .sign_paymaster_op(dummy_hash, 9999999999, 0, TEST_PAYMASTER_ADDR)
            .await
            .unwrap();
        // 0x prefix + 130 hex chars = 132 chars total
        assert!(sig.starts_with("0x"));
        assert_eq!(sig.len(), 132, "expected 65-byte (130 hex char) signature");
    }

    #[tokio::test]
    async fn test_sign_invalid_hash_returns_error() {
        let signer = test_signer();
        let result = signer
            .sign_paymaster_op("not-hex", 0, 0, TEST_PAYMASTER_ADDR)
            .await;
        assert!(result.is_err());
    }
}
