//! Symmetric encryption helper shared by every lifecycle handler.
//!
//! Reuses the same 32-byte ChaCha20-Poly1305 key the legacy filesystem
//! `SecretStore` produces (`<store_dir>/.key`). New deployments get a fresh
//! key the first time the helper is opened; existing deployments keep
//! reading the same key the SecretStore already wrote, so SecretStore →
//! credentials migration is a pure re-encrypt-into-DB and round-trips
//! decrypt cleanly.

use anyhow::{Context, Result};
use base64::Engine;
use chacha20poly1305::{
    ChaCha20Poly1305, Nonce,
    aead::{Aead, KeyInit},
};
use rand::Rng;
use std::path::{Path, PathBuf};

/// 32-byte symmetric key used for credential encryption.
#[derive(Clone)]
pub struct CredentialCipher {
    key: [u8; 32],
}

impl CredentialCipher {
    /// Open or initialize the cipher rooted at the SecretStore directory.
    /// The `<store_dir>/.key` file is created with `0o600` permissions on
    /// first call; subsequent calls read it back.
    pub fn open(store_path: &Path) -> Result<Self> {
        std::fs::create_dir_all(store_path)
            .with_context(|| format!("failed to create cipher dir: {}", store_path.display()))?;
        let key_path = store_path.join(".key");
        let key = if key_path.exists() {
            let encoded =
                std::fs::read_to_string(&key_path).context("failed to read cipher key file")?;
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(encoded.trim())
                .context("failed to decode cipher key")?;
            if decoded.len() != 32 {
                anyhow::bail!(
                    "cipher key length wrong: expected 32, got {}",
                    decoded.len()
                );
            }
            let mut key = [0u8; 32];
            key.copy_from_slice(&decoded);
            key
        } else {
            let mut key = [0u8; 32];
            rand::rng().fill(&mut key);
            let encoded = base64::engine::general_purpose::STANDARD.encode(key);
            std::fs::write(&key_path, &encoded).context("failed to write cipher key")?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
            }
            key
        };
        Ok(Self { key })
    }

    /// In-memory cipher with a caller-supplied key. Useful for tests so
    /// they don't have to scribble a `.key` to disk.
    pub fn from_key(key: [u8; 32]) -> Self {
        Self { key }
    }

    /// Random ephemeral cipher — for tests only.
    pub fn ephemeral() -> Self {
        let mut key = [0u8; 32];
        rand::rng().fill(&mut key);
        Self { key }
    }

    /// Encrypt `plaintext`. Output is `nonce(12) || ciphertext` raw bytes.
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        let cipher = ChaCha20Poly1305::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("cipher init failed: {e}"))?;
        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, plaintext)
            .map_err(|e| anyhow::anyhow!("encryption failed: {e}"))?;
        let mut out = Vec::with_capacity(12 + ciphertext.len());
        out.extend_from_slice(&nonce_bytes);
        out.extend_from_slice(&ciphertext);
        Ok(out)
    }

    /// Decrypt `nonce(12) || ciphertext` raw bytes.
    pub fn decrypt(&self, blob: &[u8]) -> Result<Vec<u8>> {
        if blob.len() < 12 {
            anyhow::bail!("encrypted blob too short");
        }
        let nonce = Nonce::from_slice(&blob[..12]);
        let ciphertext = &blob[12..];
        let cipher = ChaCha20Poly1305::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("cipher init failed: {e}"))?;
        cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("decryption failed: {e}"))
    }
}

impl std::fmt::Debug for CredentialCipher {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredentialCipher").finish_non_exhaustive()
    }
}

/// Convenience: derive the SecretStore directory from a data dir.
pub fn default_store_path(data_dir: &Path) -> PathBuf {
    data_dir.join("secrets")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let cipher = CredentialCipher::ephemeral();
        let blob = cipher.encrypt(b"hello world").unwrap();
        let plain = cipher.decrypt(&blob).unwrap();
        assert_eq!(plain, b"hello world");
    }

    #[test]
    fn nonce_changes_each_encrypt() {
        let cipher = CredentialCipher::ephemeral();
        let a = cipher.encrypt(b"same").unwrap();
        let b = cipher.encrypt(b"same").unwrap();
        assert_ne!(
            a, b,
            "nonce reuse — same plaintext must produce different ciphertext"
        );
    }

    #[test]
    fn tamper_detected() {
        let cipher = CredentialCipher::ephemeral();
        let mut blob = cipher.encrypt(b"hello").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(cipher.decrypt(&blob).is_err());
    }

    #[test]
    fn open_reuses_key() {
        let dir = tempfile::TempDir::new().unwrap();
        let c1 = CredentialCipher::open(dir.path()).unwrap();
        let blob = c1.encrypt(b"persistent").unwrap();
        // Re-open — key is read back from `.key` and decrypts.
        let c2 = CredentialCipher::open(dir.path()).unwrap();
        let plain = c2.decrypt(&blob).unwrap();
        assert_eq!(plain, b"persistent");
    }
}
