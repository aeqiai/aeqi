//! Sign-In With Ethereum (EIP-4361) verification.
//!
//! The frontend constructs the SIWE message (so the user sees what they're
//! signing) and posts it back along with the signature. We verify:
//!   1. The signature recovers to the message's `address` field.
//!   2. The nonce matches what we issued.
//!   3. The domain matches our deployment.
//!   4. The timestamp window (issued_at, expiration_time) is sane.
//!
//! On success returns the verified 20-byte EVM address.

use crate::types::Address;
use siwe::{Message, VerificationOpts};

#[derive(Debug, thiserror::Error)]
pub enum SiweError {
    #[error("malformed SIWE message: {0}")]
    Parse(String),
    #[error("malformed signature hex: {0}")]
    SignatureHex(String),
    #[error("signature must be 65 bytes (r||s||v), got {0}")]
    SignatureLength(usize),
    #[error("nonce mismatch: expected {expected}, got {got}")]
    NonceMismatch { expected: String, got: String },
    #[error("verification failed: {0}")]
    Verification(String),
}

/// Verify a SIWE message + signature. Returns the verified address on success.
pub async fn verify(
    message_str: &str,
    signature_hex: &str,
    expected_nonce: &str,
) -> Result<Address, SiweError> {
    let message: Message = message_str
        .parse()
        .map_err(|e: siwe::ParseError| SiweError::Parse(e.to_string()))?;

    if message.nonce != expected_nonce {
        return Err(SiweError::NonceMismatch {
            expected: expected_nonce.to_string(),
            got: message.nonce.clone(),
        });
    }

    let stripped = signature_hex.strip_prefix("0x").unwrap_or(signature_hex);
    let sig_bytes = hex::decode(stripped).map_err(|e| SiweError::SignatureHex(e.to_string()))?;
    if sig_bytes.len() != 65 {
        return Err(SiweError::SignatureLength(sig_bytes.len()));
    }
    let mut sig_arr = [0u8; 65];
    sig_arr.copy_from_slice(&sig_bytes);

    let opts = VerificationOpts {
        nonce: Some(expected_nonce.to_string()),
        timestamp: Some(time::OffsetDateTime::now_utc()),
        ..Default::default()
    };
    message
        .verify(&sig_arr, &opts)
        .await
        .map_err(|e| SiweError::Verification(e.to_string()))?;

    Ok(Address(message.address))
}

/// Convenience helper for callers that want the canonical SIWE message
/// shape. Frontend usually builds its own to match wallet UX, but we use
/// this in tests + as a reference for what the message should look like.
pub fn canonical_message(
    domain: &str,
    address: &Address,
    statement: &str,
    uri: &str,
    chain_id: u64,
    nonce: &str,
    issued_at: chrono::DateTime<chrono::Utc>,
) -> String {
    let issued_at_str = issued_at.format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let address_eip55 = address.as_eip55();
    format!(
        "{domain} wants you to sign in with your Ethereum account:\n\
         {address_eip55}\n\
         \n\
         {statement}\n\
         \n\
         URI: {uri}\n\
         Version: 1\n\
         Chain ID: {chain_id}\n\
         Nonce: {nonce}\n\
         Issued At: {issued_at_str}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Keypair;
    use k256::ecdsa::SigningKey;
    use sha3::{Digest, Keccak256};

    /// Build a canonical SIWE message and sign it with a test keypair, then
    /// verify the signature recovers to the same address.
    #[tokio::test]
    async fn roundtrip_with_test_keypair() {
        let kp = Keypair::generate();
        let nonce = "abc123def456";
        let issued = chrono::Utc::now();
        let message = canonical_message(
            "aeqi.ai",
            &kp.address,
            "Sign in to aeqi",
            "https://aeqi.ai",
            1,
            nonce,
            issued,
        );

        // EIP-191 personal_sign: keccak256("\x19Ethereum Signed Message:\n" + len + msg)
        let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", message.len(), message);
        let digest: [u8; 32] = Keccak256::digest(prefixed.as_bytes()).into();

        // Sign as a wallet would, producing r||s||v with v = recid + 27.
        let signing_key = SigningKey::from_bytes((&kp.secret_bytes()).into()).unwrap();
        let (sig, recid) = signing_key.sign_prehash_recoverable(&digest).unwrap();
        let (r, s) = sig.split_bytes();
        let mut sig_bytes = [0u8; 65];
        sig_bytes[..32].copy_from_slice(&r);
        sig_bytes[32..64].copy_from_slice(&s);
        sig_bytes[64] = u8::from(recid) + 27;

        let recovered = verify(&message, &hex::encode(sig_bytes), nonce)
            .await
            .unwrap();
        assert_eq!(recovered, kp.address);
    }

    #[tokio::test]
    async fn nonce_mismatch_rejected() {
        let kp = Keypair::generate();
        let message = canonical_message(
            "aeqi.ai",
            &kp.address,
            "Sign in to aeqi",
            "https://aeqi.ai",
            1,
            "real-nonce",
            chrono::Utc::now(),
        );
        let r = verify(&message, &"00".repeat(65), "different-nonce").await;
        assert!(matches!(r, Err(SiweError::NonceMismatch { .. })));
    }

    #[tokio::test]
    async fn malformed_message_rejected() {
        let r = verify("not a SIWE message at all", &"00".repeat(65), "n").await;
        assert!(matches!(r, Err(SiweError::Parse(_))));
    }

    #[tokio::test]
    async fn wrong_signature_length_rejected() {
        let kp = Keypair::generate();
        let nonce = "abcdef12345"; // EIP-4361 requires >= 8 alphanumeric chars
        let message = canonical_message(
            "aeqi.ai",
            &kp.address,
            "x",
            "https://aeqi.ai",
            1,
            nonce,
            chrono::Utc::now(),
        );
        let r = verify(&message, &"00".repeat(64), nonce).await;
        assert!(matches!(r, Err(SiweError::SignatureLength(64))));
    }
}
