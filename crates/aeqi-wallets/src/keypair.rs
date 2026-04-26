//! Raw secp256k1 keypair with EVM address derivation. Used as the primitive
//! under custodial wallets; co-custody and self-custody wallets keep the same
//! address but distribute the private key differently.
//!
//! The private key is held as a 32-byte `Zeroizing` array — `k256::SigningKey`
//! does not itself implement `Zeroize`, so we keep the canonical secret in
//! bytes and reconstruct the SigningKey on demand at signing time.

use k256::ecdsa::{RecoveryId, Signature, SigningKey, VerifyingKey};
use rand::RngCore;
use sha3::{Digest, Keccak256};
use zeroize::Zeroizing;

use crate::types::{Address, EcdsaSignature, Pubkey};

pub struct Keypair {
    secret: Zeroizing<[u8; 32]>,
    pub address: Address,
    pub pubkey: Pubkey,
}

impl Keypair {
    /// Generate a fresh random keypair. Loops on the rare event that 32
    /// random bytes don't form a valid scalar (probability ~2^-128).
    pub fn generate() -> Self {
        loop {
            let mut bytes = [0u8; 32];
            rand::rng().fill_bytes(&mut bytes);
            if let Ok(kp) = Self::from_secret_bytes(&bytes) {
                return kp;
            }
        }
    }

    /// Reconstruct from a raw 32-byte private key (used when decrypting a
    /// stored server share).
    pub fn from_secret_bytes(secret: &[u8; 32]) -> Result<Self, KeypairError> {
        let signing_key =
            SigningKey::from_bytes(secret.into()).map_err(|_| KeypairError::InvalidSecret)?;
        let stored = Zeroizing::new(*secret);
        let (address, pubkey) = derive_public(&signing_key);
        Ok(Self {
            secret: stored,
            address,
            pubkey,
        })
    }

    /// Expose the secret bytes as a 32-byte array. Caller is responsible for
    /// not letting them outlive the operation. Useful for re-keying paths.
    pub fn secret_bytes(&self) -> [u8; 32] {
        *self.secret
    }

    /// Sign a 32-byte prehashed digest. Returns r || s || v in EVM convention.
    pub fn sign_prehash(&self, digest: &[u8; 32]) -> Result<EcdsaSignature, KeypairError> {
        let signing_key = SigningKey::from_bytes((&*self.secret).into())
            .map_err(|_| KeypairError::InvalidSecret)?;
        let (sig, recovery_id): (Signature, RecoveryId) = signing_key
            .sign_prehash_recoverable(digest)
            .map_err(|_| KeypairError::SigningFailed)?;
        let (r, s) = sig.split_bytes();
        let mut r_arr = [0u8; 32];
        let mut s_arr = [0u8; 32];
        r_arr.copy_from_slice(&r);
        s_arr.copy_from_slice(&s);
        Ok(EcdsaSignature {
            r: r_arr,
            s: s_arr,
            v: u8::from(recovery_id),
        })
    }
}

impl std::fmt::Debug for Keypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Keypair")
            .field("address", &self.address)
            .field("pubkey_compressed", &hex::encode(&self.pubkey.0))
            .finish_non_exhaustive()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum KeypairError {
    #[error("invalid 32-byte secret")]
    InvalidSecret,
    #[error("signing failed")]
    SigningFailed,
}

fn derive_public(sk: &SigningKey) -> (Address, Pubkey) {
    let vk: &VerifyingKey = sk.verifying_key();
    let address = derive_address(vk);
    let pubkey = Pubkey(vk.to_encoded_point(true).as_bytes().to_vec());
    (address, pubkey)
}

fn derive_address(verifying_key: &VerifyingKey) -> Address {
    let encoded = verifying_key.to_encoded_point(false);
    let pubkey_bytes = encoded.as_bytes();
    debug_assert_eq!(
        pubkey_bytes[0], 0x04,
        "uncompressed pubkey must start with 0x04"
    );
    let hash = Keccak256::digest(&pubkey_bytes[1..]);
    let mut addr = [0u8; 20];
    addr.copy_from_slice(&hash[12..]);
    Address(addr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::{VerifyingKey, signature::hazmat::PrehashVerifier};

    #[test]
    fn roundtrip_secret_bytes() {
        let kp = Keypair::generate();
        let secret = kp.secret_bytes();
        let kp2 = Keypair::from_secret_bytes(&secret).unwrap();
        assert_eq!(kp.address, kp2.address);
        assert_eq!(kp.pubkey, kp2.pubkey);
    }

    #[test]
    fn sign_and_verify_prehash() {
        let kp = Keypair::generate();
        let digest = Keccak256::digest(b"test message").into();
        let sig = kp.sign_prehash(&digest).unwrap();

        let mut r_s = [0u8; 64];
        r_s[..32].copy_from_slice(&sig.r);
        r_s[32..].copy_from_slice(&sig.s);
        let k256_sig = Signature::from_slice(&r_s).unwrap();

        let verifying_key =
            VerifyingKey::from_sec1_bytes(&kp.pubkey.0).expect("pubkey decodes as sec1");
        verifying_key
            .verify_prehash(&digest, &k256_sig)
            .expect("signature verifies");
    }

    #[test]
    fn known_address_matches_keccak() {
        // Regression: priv = 0x...01 yields a deterministic address.
        let mut secret = [0u8; 32];
        secret[31] = 1;
        let kp = Keypair::from_secret_bytes(&secret).unwrap();
        assert_eq!(
            kp.address.as_hex(),
            "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf"
        );
    }
}
