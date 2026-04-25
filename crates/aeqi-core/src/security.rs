use anyhow::{Context, Result};
use chacha20poly1305::{
    ChaCha20Poly1305, Nonce,
    aead::{Aead, KeyInit},
};
use rand::Rng;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Encrypted secret store using ChaCha20-Poly1305.
pub struct SecretStore {
    path: PathBuf,
    key: [u8; 32],
}

impl SecretStore {
    /// Initialize or open a secret store.
    pub fn open(path: &Path) -> Result<Self> {
        std::fs::create_dir_all(path)
            .with_context(|| format!("failed to create secret store: {}", path.display()))?;

        let key_path = path.join(".key");
        let key = if key_path.exists() {
            let encoded =
                std::fs::read_to_string(&key_path).context("failed to read secret store key")?;
            let decoded =
                base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded.trim())
                    .context("failed to decode secret store key")?;
            let mut key = [0u8; 32];
            key.copy_from_slice(&decoded);
            key
        } else {
            let mut key = [0u8; 32];
            rand::rng().fill(&mut key);
            let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, key);
            std::fs::write(&key_path, &encoded).context("failed to write secret store key")?;

            // Restrict permissions on the key file.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600))?;
            }

            key
        };

        Ok(Self {
            path: path.to_path_buf(),
            key,
        })
    }

    /// Store an encrypted secret.
    pub fn set(&self, name: &str, value: &str) -> Result<()> {
        let cipher = ChaCha20Poly1305::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("cipher init failed: {e}"))?;

        let mut nonce_bytes = [0u8; 12];
        rand::rng().fill(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher
            .encrypt(nonce, value.as_bytes())
            .map_err(|e| anyhow::anyhow!("encryption failed: {e}"))?;

        // Store as: nonce (12 bytes) || ciphertext
        let mut data = Vec::with_capacity(12 + ciphertext.len());
        data.extend_from_slice(&nonce_bytes);
        data.extend_from_slice(&ciphertext);

        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);

        let file_path = self.path.join(format!("{name}.enc"));
        std::fs::write(&file_path, &encoded)
            .with_context(|| format!("failed to write secret: {name}"))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    }

    /// Retrieve a decrypted secret.
    pub fn get(&self, name: &str) -> Result<String> {
        let file_path = self.path.join(format!("{name}.enc"));
        let encoded = std::fs::read_to_string(&file_path)
            .with_context(|| format!("secret not found: {name}"))?;

        let data =
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encoded.trim())
                .context("failed to decode secret")?;

        if data.len() < 12 {
            anyhow::bail!("corrupt secret: {name}");
        }

        let nonce = Nonce::from_slice(&data[..12]);
        let ciphertext = &data[12..];

        let cipher = ChaCha20Poly1305::new_from_slice(&self.key)
            .map_err(|e| anyhow::anyhow!("cipher init failed: {e}"))?;

        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| anyhow::anyhow!("decryption failed: {e}"))?;

        String::from_utf8(plaintext).context("secret is not valid UTF-8")
    }

    /// List all secret names.
    pub fn list(&self) -> Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in std::fs::read_dir(&self.path)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".enc") {
                names.push(name.trim_end_matches(".enc").to_string());
            }
        }
        names.sort();
        Ok(names)
    }

    /// Delete a secret.
    pub fn delete(&self, name: &str) -> Result<()> {
        let file_path = self.path.join(format!("{name}.enc"));
        if file_path.exists() {
            std::fs::remove_file(&file_path)
                .with_context(|| format!("failed to delete secret: {name}"))?;
        }
        Ok(())
    }

    /// Load all secrets into a HashMap (for env injection).
    pub fn load_all(&self) -> Result<HashMap<String, String>> {
        let mut secrets = HashMap::new();
        for name in self.list()? {
            if let Ok(value) = self.get(&name) {
                secrets.insert(name, value);
            }
        }
        Ok(secrets)
    }

    /// One-shot migration helper: copy every filesystem-backed secret into
    /// the new credentials table as `(scope_kind='global', scope_id='',
    /// provider='legacy', name=<existing>, lifecycle_kind='static_secret')`.
    ///
    /// Idempotent — already-migrated entries fall through with a duplicate-
    /// key SQLite error which is logged and ignored. Returns `(inserted,
    /// skipped)` counts so callers can report progress.
    pub async fn migrate_to_credentials(
        &self,
        store: &crate::credentials::CredentialStore,
    ) -> Result<(usize, usize)> {
        use crate::credentials::{CredentialInsert, ScopeKind};
        let mut inserted = 0usize;
        let mut skipped = 0usize;
        for name in self.list()? {
            let value = match self.get(&name) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(name = %name, error = %e, "skipping unreadable secret");
                    skipped += 1;
                    continue;
                }
            };
            let ins = CredentialInsert {
                scope_kind: ScopeKind::Global,
                scope_id: String::new(),
                provider: "legacy".to_string(),
                name: name.clone(),
                lifecycle_kind: "static_secret".to_string(),
                plaintext_blob: value.into_bytes(),
                metadata: serde_json::json!({"source": "secret_store_migration"}),
                expires_at: None,
            };
            match store.insert(ins).await {
                Ok(_) => inserted += 1,
                Err(e) => {
                    // Duplicate-key (already migrated) is not fatal.
                    let msg = e.to_string();
                    if msg.contains("UNIQUE") || msg.contains("constraint") {
                        skipped += 1;
                    } else {
                        tracing::warn!(name = %name, error = %msg, "secret migration insert failed");
                        skipped += 1;
                    }
                }
            }
        }
        Ok((inserted, skipped))
    }

    /// Destructive purge: remove every `*.enc` blob from the secrets dir.
    ///
    /// Run once after `migrate_to_credentials` succeeds. The credentials
    /// substrate becomes the sole source of truth; subsequent
    /// `SecretStore::get` calls return errors (the daemon refuses to fall
    /// back, so the caller must read from `CredentialStore` instead).
    ///
    /// **Preserves `.key`** — the credential substrate's cipher reads the
    /// same key file from this directory, so deleting it would invalidate
    /// every encrypted blob in the `credentials` table. This is a
    /// deviation from the literal `fs::remove_dir_all` in the plan, forced
    /// by the shared cipher key.
    ///
    /// Idempotent: missing dir, missing files, all no-ops with `Ok(())`.
    pub fn purge_filesystem(&self) -> Result<()> {
        if !self.path.exists() {
            // Defensive: ensure the dir still exists for the cipher.
            std::fs::create_dir_all(&self.path).with_context(|| {
                format!(
                    "failed to recreate secret store dir: {}",
                    self.path.display()
                )
            })?;
            return Ok(());
        }
        // Walk the dir; remove every `*.enc` file. Leave `.key` intact.
        for entry in std::fs::read_dir(&self.path)
            .with_context(|| format!("failed to read secret store: {}", self.path.display()))?
        {
            let entry = entry?;
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.ends_with(".enc") {
                let p = entry.path();
                std::fs::remove_file(&p)
                    .with_context(|| format!("failed to remove secret blob: {}", p.display()))?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Move A guarantee: `purge_filesystem` removes every `.enc` blob but
    /// leaves `.key` (the cipher key the credentials substrate decrypts
    /// migrated blobs against). Deleting `.key` would brick the substrate.
    #[test]
    fn purge_filesystem_removes_enc_blobs_keeps_key() {
        let dir = TempDir::new().unwrap();
        let store = SecretStore::open(dir.path()).unwrap();
        store.set("API_KEY_ONE", "value-1").unwrap();
        store.set("API_KEY_TWO", "value-2").unwrap();
        assert_eq!(store.list().unwrap().len(), 2);
        let key_path = dir.path().join(".key");
        assert!(key_path.exists(), ".key must exist after writes");

        store.purge_filesystem().unwrap();

        // Every `.enc` blob is gone.
        assert!(store.list().unwrap().is_empty());
        // `.key` survived because the credentials substrate still uses it.
        assert!(
            key_path.exists(),
            "purge_filesystem must preserve .key for the credentials substrate cipher"
        );
    }

    /// Idempotent: re-running purge on a clean dir is a no-op.
    #[test]
    fn purge_filesystem_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let store = SecretStore::open(dir.path()).unwrap();
        store.set("X", "1").unwrap();
        store.purge_filesystem().unwrap();
        // Second purge does not error.
        store.purge_filesystem().unwrap();
        assert!(store.list().unwrap().is_empty());
    }
}
