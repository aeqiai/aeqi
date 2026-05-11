//! Wallet-side wiring for `aeqi-wallets`.
//!
//! Owns the wallet DB connection, KEK bootstrap, and the SIWE nonce store
//! used by `/api/auth/wallet/*`.

use std::path::Path;
use std::sync::{Arc, Mutex};

use aeqi_wallets::{SharedDb, kek::SoftwareKek, store::schema::migrate as wallet_migrate};
use anyhow::{Context, Result};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tracing::{info, warn};

/// Bundle of wallet dependencies stashed in `AppState`.
#[derive(Clone)]
pub struct WalletContext {
    pub kek: Arc<SoftwareKek>,
    pub db: SharedDb,
    pub nonces: Arc<NonceStore>,
}

/// In-memory SIWE nonce store with per-entry TTL. Fine for single-process dev
/// and the current control-plane deployment model.
#[derive(Default)]
pub struct NonceStore {
    inner: Mutex<std::collections::HashMap<String, chrono::DateTime<chrono::Utc>>>,
}

impl NonceStore {
    pub fn issue(&self) -> String {
        use rand::RngCore;
        let mut bytes = [0u8; 24];
        rand::rng().fill_bytes(&mut bytes);
        let nonce = hex::encode(bytes);
        let expires = chrono::Utc::now() + chrono::Duration::minutes(10);
        self.inner
            .lock()
            .expect("nonce store mutex poisoned")
            .insert(nonce.clone(), expires);
        nonce
    }

    pub fn consume(&self, nonce: &str) -> Result<(), NonceError> {
        let mut store = self.inner.lock().expect("nonce store mutex poisoned");
        let now = chrono::Utc::now();
        store.retain(|_, expires| *expires > now);

        let Some(expires) = store.remove(nonce) else {
            return Err(NonceError::Unknown);
        };
        if expires <= now {
            return Err(NonceError::Expired);
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum NonceError {
    #[error("nonce unknown — already consumed or never issued")]
    Unknown,
    #[error("nonce expired")]
    Expired,
}

impl WalletContext {
    pub fn bootstrap(auth_secret: &str, data_dir: &Path) -> Result<Self> {
        let passphrase = if auth_secret == "aeqi-dev" {
            warn!(
                "wallet KEK derived from default auth_secret 'aeqi-dev' — set AEQI_WEB_SECRET or [web].auth_secret in production"
            );
            auth_secret.to_string()
        } else {
            auth_secret.to_string()
        };

        let salt = stable_salt(auth_secret);
        let kek = SoftwareKek::derive(&passphrase, &salt)
            .context("derive wallet master KEK from passphrase + salt")?;

        let db_path = data_dir.join("accounts.db");
        let conn = Connection::open(db_path).context("open wallet DB connection")?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
        wallet_migrate(&conn).context("apply wallet schema migrations")?;

        info!(version = kek.version_value(), "wallet KEK + DB ready");

        Ok(Self {
            kek: Arc::new(kek),
            db: Arc::new(Mutex::new(conn)),
            nonces: Arc::new(NonceStore::default()),
        })
    }
}

fn stable_salt(auth_secret: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"aeqi-wallet-master-kek-salt-v1");
    hasher.update(auth_secret.as_bytes());
    hasher.finalize().to_vec()
}

trait VersionAccessor {
    fn version_value(&self) -> u32;
}

impl VersionAccessor for SoftwareKek {
    fn version_value(&self) -> u32 {
        use aeqi_wallets::MasterKekProvider;
        MasterKekProvider::version(self)
    }
}
