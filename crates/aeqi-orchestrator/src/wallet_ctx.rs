//! Runtime-side wiring for the `aeqi-wallets` crate.
//!
//! Mirrors the platform-side `WalletContext` but lives co-located with the
//! agents table on `aeqi.db`. Bootstraps the master KEK, opens a parallel
//! WAL-mode connection, runs wallet schema migrations, and exposes the
//! handles `AgentRegistry` needs to provision agent wallets at spawn time.

use std::path::Path;
use std::sync::{Arc, Mutex};

use aeqi_wallets::{SharedDb, kek::SoftwareKek, store::schema::migrate as wallet_migrate};
use anyhow::{Context, Result};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tracing::{info, warn};

#[derive(Clone)]
pub struct WalletProvisioner {
    pub kek: Arc<SoftwareKek>,
    pub db: SharedDb,
}

impl WalletProvisioner {
    /// Bootstrap from operator-provided passphrase + a stable salt seed.
    /// `data_dir/aeqi.db` is opened with WAL mode and the wallet schema is
    /// applied. `salt_seed` is typically the runtime's `auth_secret` or any
    /// other stable per-deployment string — anything sufficient to keep the
    /// KEK deterministic across restarts.
    pub fn bootstrap(data_dir: &Path, passphrase: &str, salt_seed: &str) -> Result<Self> {
        if passphrase.trim().is_empty() {
            warn!(
                "runtime wallet KEK bootstrapping with empty passphrase — \
                 set WALLET_PASSPHRASE on aeqi-runtime.service"
            );
        }
        let salt = stable_salt(salt_seed);
        let kek =
            SoftwareKek::derive(passphrase, &salt).context("derive runtime wallet master KEK")?;

        let db_path = data_dir.join("aeqi.db");
        let conn = Connection::open(&db_path).context("open runtime wallet DB")?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;")?;
        wallet_migrate(&conn).context("apply wallet schema migrations on aeqi.db")?;

        info!(
            db = %db_path.display(),
            "runtime wallet KEK + DB ready"
        );

        Ok(Self {
            kek: Arc::new(kek),
            db: Arc::new(Mutex::new(conn)),
        })
    }
}

fn stable_salt(seed: &str) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(b"aeqi-runtime-wallet-master-kek-salt-v1");
    hasher.update(seed.as_bytes());
    hasher.finalize().to_vec()
}
