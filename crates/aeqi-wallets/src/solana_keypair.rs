//! Raw ed25519 keypair for Solana custodial signing.
//!
//! Solana account pubkeys ARE ed25519 verifying keys (32 bytes, base58-encoded
//! at the wire/UI layer). This is the primitive the Solana custodial signing
//! path builds on — analogous to `keypair::Keypair` for the legacy EVM path.
//!
//! The 32-byte secret seed is held in a `Zeroizing` array; the `SigningKey` is
//! reconstructed on demand at signing time so we never hold the expanded key
//! in memory between signings.

use ed25519_dalek::{Signer, SigningKey, Verifier, VerifyingKey};
use rand::RngCore;
use zeroize::Zeroizing;

/// 32-byte Solana account pubkey (ed25519 verifying key bytes).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SolanaPubkey(pub [u8; 32]);

impl SolanaPubkey {
    /// Base58-encoded form, the canonical wire/UI representation on Solana.
    pub fn to_base58(self) -> String {
        bs58::encode(self.0).into_string()
    }

    /// Parse a base58-encoded Solana pubkey. Returns `None` if the input
    /// decodes to anything other than 32 bytes.
    pub fn from_base58(s: &str) -> Option<Self> {
        let bytes = bs58::decode(s).into_vec().ok()?;
        let arr: [u8; 32] = bytes.try_into().ok()?;
        Some(Self(arr))
    }
}

impl std::fmt::Display for SolanaPubkey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_base58())
    }
}

/// 64-byte ed25519 signature.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ed25519Signature(pub [u8; 64]);

impl Ed25519Signature {
    /// Base58-encoded form (matches Solana JSON-RPC `signature` strings).
    pub fn to_base58(self) -> String {
        bs58::encode(self.0).into_string()
    }
}

pub struct SolanaKeypair {
    secret: Zeroizing<[u8; 32]>,
    pub pubkey: SolanaPubkey,
}

impl SolanaKeypair {
    /// Generate a fresh random keypair. Unlike secp256k1, every 32-byte string
    /// is a valid ed25519 seed, so no rejection loop is required.
    pub fn generate() -> Self {
        let mut seed = [0u8; 32];
        rand::rng().fill_bytes(&mut seed);
        Self::from_secret_bytes(&seed)
    }

    /// Reconstruct from a raw 32-byte seed (used when decrypting a stored
    /// server share).
    pub fn from_secret_bytes(secret: &[u8; 32]) -> Self {
        let signing_key = SigningKey::from_bytes(secret);
        let verifying_key: VerifyingKey = signing_key.verifying_key();
        let pubkey = SolanaPubkey(verifying_key.to_bytes());
        Self {
            secret: Zeroizing::new(*secret),
            pubkey,
        }
    }

    /// Expose the secret seed bytes. Caller is responsible for not letting
    /// them outlive the operation. Used by the KEK envelope encryption layer.
    pub fn secret_bytes(&self) -> [u8; 32] {
        *self.secret
    }

    /// Sign an arbitrary message. ed25519 hashes internally — no separate
    /// prehash step like secp256k1 prehash signing. Returns the 64-byte sig.
    pub fn sign(&self, message: &[u8]) -> Ed25519Signature {
        let signing_key = SigningKey::from_bytes(&self.secret);
        let sig = signing_key.sign(message);
        Ed25519Signature(sig.to_bytes())
    }
}

impl std::fmt::Debug for SolanaKeypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SolanaKeypair")
            .field("pubkey", &self.pubkey.to_base58())
            .finish_non_exhaustive()
    }
}

/// Verify an ed25519 signature against a pubkey. Used in tests and any
/// caller that wants to check a signature without instantiating a full
/// keypair (e.g. SIWS-style auth flows on Solana).
pub fn verify(pubkey: &SolanaPubkey, message: &[u8], sig: &Ed25519Signature) -> bool {
    let Ok(vk) = VerifyingKey::from_bytes(&pubkey.0) else {
        return false;
    };
    let Ok(sig) = ed25519_dalek::Signature::from_slice(&sig.0) else {
        return false;
    };
    vk.verify(message, &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_secret_bytes() {
        let kp = SolanaKeypair::generate();
        let secret = kp.secret_bytes();
        let kp2 = SolanaKeypair::from_secret_bytes(&secret);
        assert_eq!(kp.pubkey, kp2.pubkey);
    }

    #[test]
    fn sign_and_verify() {
        let kp = SolanaKeypair::generate();
        let message = b"hello solana";
        let sig = kp.sign(message);
        assert!(verify(&kp.pubkey, message, &sig));
    }

    #[test]
    fn verify_rejects_tampered_message() {
        let kp = SolanaKeypair::generate();
        let sig = kp.sign(b"original");
        assert!(!verify(&kp.pubkey, b"tampered", &sig));
    }

    #[test]
    fn verify_rejects_wrong_pubkey() {
        let kp = SolanaKeypair::generate();
        let other = SolanaKeypair::generate();
        let sig = kp.sign(b"msg");
        assert!(!verify(&other.pubkey, b"msg", &sig));
    }

    #[test]
    fn pubkey_base58_roundtrip() {
        let kp = SolanaKeypair::generate();
        let b58 = kp.pubkey.to_base58();
        let parsed = SolanaPubkey::from_base58(&b58).expect("base58 roundtrip");
        assert_eq!(kp.pubkey, parsed);
    }

    #[test]
    fn pubkey_base58_rejects_wrong_length() {
        // 31 bytes encoded in base58 — must reject.
        let short = bs58::encode([0u8; 31]).into_string();
        assert!(SolanaPubkey::from_base58(&short).is_none());
    }

    #[test]
    fn pubkey_base58_is_32_to_44_chars() {
        // ed25519 pubkeys encode to 43 or 44 base58 chars (32 bytes).
        let kp = SolanaKeypair::generate();
        let s = kp.pubkey.to_base58();
        assert!(
            (43..=44).contains(&s.len()),
            "expected 43-44 chars, got {}",
            s.len()
        );
    }

    #[test]
    fn known_seed_yields_deterministic_pubkey() {
        // Regression: seed = 0x...01 yields a deterministic pubkey.
        let mut seed = [0u8; 32];
        seed[31] = 1;
        let kp = SolanaKeypair::from_secret_bytes(&seed);
        // ed25519 derives the pubkey via clamped scalar mult of the basepoint;
        // the exact value is deterministic for any given seed.
        let kp2 = SolanaKeypair::from_secret_bytes(&seed);
        assert_eq!(kp.pubkey, kp2.pubkey);
        // Also assert it's not the zero pubkey (sanity).
        assert_ne!(kp.pubkey.0, [0u8; 32]);
    }
}
