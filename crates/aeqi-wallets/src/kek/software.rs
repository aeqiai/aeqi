//! Software KEK backend: Argon2id-derived master key, ChaCha20-Poly1305 wrapping.
//!
//! Threat coverage:
//! - DB leak / cold disk theft: protected (per-wallet KEK ciphertext is opaque
//!   without the master key).
//! - Process memory compromise: NOT protected. The master key lives briefly in
//!   process memory between unwrap calls. Mitigation: zeroize after use.
//! - Operator coercion: NOT protected. Operator with shell access can read the
//!   passphrase from the systemd EnvironmentFile.
//!
//! Higher-assurance backends (AWS KMS, GCP KMS, YubiHSM, Nitro Enclave) ship in
//! v2 behind Cargo features. The `MasterKekProvider` trait is the swap point.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    ChaCha20Poly1305, Key, Nonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use zeroize::{Zeroize, Zeroizing};

use super::{KekError, MasterKekProvider, RotationReceipt, SecretKek};

const ARGON2_M_KIB: u32 = 524_288; // 512 MiB
const ARGON2_T: u32 = 3;
const ARGON2_P: u32 = 4;
const NONCE_LEN: usize = 12;

pub struct SoftwareKek {
    master: Zeroizing<[u8; 32]>,
    version: u32,
}

impl SoftwareKek {
    /// Derive a master key from an operator passphrase + salt via Argon2id.
    /// Salt should be a stable per-deployment value (e.g. read from an
    /// operator-controlled file), NOT regenerated each boot.
    pub fn derive(passphrase: &str, salt: &[u8]) -> Result<Self, KekError> {
        if salt.len() < 16 {
            return Err(KekError::Bootstrap("salt must be >= 16 bytes".into()));
        }
        let params = Params::new(ARGON2_M_KIB, ARGON2_T, ARGON2_P, Some(32))
            .map_err(|e| KekError::Bootstrap(format!("argon2 params: {e}")))?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

        let mut master = Zeroizing::new([0u8; 32]);
        argon2
            .hash_password_into(passphrase.as_bytes(), salt, master.as_mut())
            .map_err(|e| KekError::Bootstrap(format!("argon2 hash: {e}")))?;
        Ok(Self { master, version: 1 })
    }

    /// Construct directly from a 32-byte master key. Used by tests and by
    /// higher-level bootstrap code that derives the key elsewhere.
    pub fn from_bytes(master: [u8; 32], version: u32) -> Self {
        Self {
            master: Zeroizing::new(master),
            version,
        }
    }

    fn cipher(&self) -> ChaCha20Poly1305 {
        ChaCha20Poly1305::new(Key::from_slice(self.master.as_ref()))
    }
}

#[async_trait::async_trait]
impl MasterKekProvider for SoftwareKek {
    async fn wrap(&self, plaintext: &[u8; 32]) -> Result<Vec<u8>, KekError> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        rand::rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = self
            .cipher()
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|e| KekError::Wrap(format!("aead: {e}")))?;
        let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ct);
        Ok(out)
    }

    async fn unwrap(&self, ciphertext: &[u8]) -> Result<SecretKek, KekError> {
        if ciphertext.len() < NONCE_LEN + 16 {
            return Err(KekError::Unwrap("ciphertext too short".into()));
        }
        let (nonce_bytes, ct) = ciphertext.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        let mut pt = self
            .cipher()
            .decrypt(nonce, ct)
            .map_err(|e| KekError::Unwrap(format!("aead: {e}")))?;
        if pt.len() != 32 {
            pt.zeroize();
            return Err(KekError::Unwrap("plaintext len != 32".into()));
        }
        let mut out = Zeroizing::new([0u8; 32]);
        out.copy_from_slice(&pt);
        pt.zeroize();
        Ok(out)
    }

    fn version(&self) -> u32 {
        self.version
    }

    async fn rotate(&self) -> Result<RotationReceipt, KekError> {
        // Software-backend rotation is owned by the operator: they generate a
        // new passphrase, instantiate a new SoftwareKek, and the higher-level
        // store walks every wallet ciphertext, unwrap-with-old, wrap-with-new.
        // Returning Unimplemented here keeps callers honest until that pass
        // exists.
        Err(KekError::Rotation(
            "software backend rotation handled by operator-driven re-wrap".into(),
        ))
    }
}
