//! BIP-39 mnemonic generation and seed reconstruction.
//!
//! The mnemonic is derived from the original keypair entropy at provisioning
//! time. Users can reveal it on demand. Master KEK loss does NOT brick
//! recovery: the user's client share + (optionally) revealed seed lets them
//! reconstruct the private key without server help.
//!
//! For Phase 1 (custodial-only) the seed phrase is just the encoded form of
//! the same 32-byte entropy used to seed the keypair, so reveal is mechanical.
//! Phase 3+ ties this into the share-binding ceremony.

use bip39::{Language, Mnemonic};
use rand::RngCore;
use secrecy::{ExposeSecret, SecretBox};

/// 16 bytes of entropy maps to a 12-word BIP-39 mnemonic. We hold it in a
/// zeroizing secret box so it never lingers in plaintext beyond its use.
pub struct EntropySeed(SecretBox<[u8; 16]>);

impl EntropySeed {
    pub fn generate() -> Self {
        let mut bytes = [0u8; 16];
        rand::rng().fill_bytes(&mut bytes);
        Self(SecretBox::new(Box::new(bytes)))
    }

    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(SecretBox::new(Box::new(bytes)))
    }

    pub fn expose(&self) -> &[u8; 16] {
        self.0.expose_secret()
    }

    /// Encode as a BIP-39 mnemonic (English wordlist, 12 words).
    pub fn to_mnemonic(&self) -> Result<Mnemonic, RecoveryError> {
        Mnemonic::from_entropy_in(Language::English, self.expose())
            .map_err(|e| RecoveryError::Mnemonic(format!("{e:?}")))
    }

    /// Derive the 32-byte secp256k1 private key from this entropy.
    /// Phase 1: the entropy is salted and stretched via SHA-256 to produce a
    /// uniform 32-byte secret. Phase 3+ uses BIP-32 derivation paths to
    /// support multiple chains/accounts from one mnemonic.
    pub fn derive_private_key(&self) -> [u8; 32] {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(b"aeqi-wallet-secp256k1-v1");
        hasher.update(self.expose());
        let out = hasher.finalize();
        let mut secret = [0u8; 32];
        secret.copy_from_slice(&out);
        secret
    }
}

impl std::fmt::Debug for EntropySeed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EntropySeed").finish_non_exhaustive()
    }
}

/// Parse a 12-word phrase back into entropy. Used on the user-driven recovery
/// path (Phase 5).
pub fn entropy_from_phrase(phrase: &str) -> Result<EntropySeed, RecoveryError> {
    let mnemonic = Mnemonic::parse_in(Language::English, phrase)
        .map_err(|e| RecoveryError::Mnemonic(format!("{e:?}")))?;
    let entropy = mnemonic.to_entropy();
    if entropy.len() != 16 {
        return Err(RecoveryError::Mnemonic(format!(
            "expected 16 bytes of entropy (12 words), got {}",
            entropy.len()
        )));
    }
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&entropy);
    Ok(EntropySeed::from_bytes(bytes))
}

#[derive(Debug, thiserror::Error)]
pub enum RecoveryError {
    #[error("mnemonic error: {0}")]
    Mnemonic(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entropy_roundtrip_via_mnemonic() {
        let seed = EntropySeed::generate();
        let phrase = seed.to_mnemonic().unwrap().to_string();
        assert_eq!(phrase.split_whitespace().count(), 12);

        let recovered = entropy_from_phrase(&phrase).unwrap();
        assert_eq!(seed.expose(), recovered.expose());
    }

    #[test]
    fn deterministic_private_key() {
        let seed = EntropySeed::from_bytes([0u8; 16]);
        let k1 = seed.derive_private_key();
        let k2 = seed.derive_private_key();
        assert_eq!(k1, k2);
        assert_ne!(k1, [0u8; 32], "must not collapse to zero");
    }

    #[test]
    fn distinct_entropy_yields_distinct_keys() {
        let s1 = EntropySeed::from_bytes([0u8; 16]);
        let s2 = EntropySeed::from_bytes([1u8; 16]);
        assert_ne!(s1.derive_private_key(), s2.derive_private_key());
    }

    #[test]
    fn invalid_phrase_rejected() {
        assert!(entropy_from_phrase("not actually a mnemonic phrase").is_err());
    }
}
