//! Solana custodial wallet service. Mirrors `wallet.rs`'s shape but for
//! ed25519 + Solana semantics:
//!
//! - `provision_solana_custodial` — generate a 32-byte ed25519 seed,
//!   envelope-encrypt it with a fresh per-wallet KEK wrapped by the master
//!   KEK, persist the row, return the base58 pubkey.
//! - `sign_solana_custodial` — load a custodial wallet, decrypt the seed,
//!   sign an arbitrary message, return the 64-byte signature.
//! - `ensure_primary_solana_user_wallet` / `ensure_solana_agent_wallet` —
//!   idempotent provisioning helpers for signup / agent creation paths.
//!
//! Async wrapper over sync rusqlite repos: every DB call is wrapped in
//! `tokio::task::spawn_blocking` per the aeqi convention.
//!
//! No BIP-39 mnemonic recovery in this first cut. The cutover priority is
//! end-to-end Solana issuance; recovery seed re-derivation is a follow-up
//! (Solana wallets typically use BIP-39 + SLIP-0010 m/44'/501'/0'/0' to
//! derive the ed25519 seed — drop-in once we add the dep).

use chacha20poly1305::{
    ChaCha20Poly1305, Key, Nonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use zeroize::{Zeroize, Zeroizing};

use crate::kek::{KekError, MasterKekProvider};
use crate::solana_keypair::{Ed25519Signature, SolanaKeypair, SolanaPubkey};
use crate::store::repo::StoreError;
use crate::store::solana_repo::{
    InsertSolanaAgentWallet, InsertSolanaWallet, SolanaAgentWalletStore, SolanaWalletStore,
    StoredSolanaAgentWallet, StoredSolanaWallet,
};
use crate::types::{CustodyState, ProvisionedBy, WalletId};
use crate::wallet::SharedDb;

const NONCE_LEN: usize = 12;

#[derive(Debug)]
pub struct ProvisionSolanaRequest {
    pub user_id: String,
    pub is_primary: bool,
    pub provisioned_by: ProvisionedBy,
}

#[derive(Debug)]
pub struct ProvisionSolanaAgentRequest {
    pub agent_id: String,
    pub provisioned_by: ProvisionedBy,
}

#[derive(Debug, Clone)]
pub struct ProvisionedSolanaWallet {
    pub id: WalletId,
    pub pubkey: SolanaPubkey,
}

#[derive(Debug, thiserror::Error)]
pub enum SolanaWalletError {
    #[error(transparent)]
    Kek(#[from] KekError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error("custody state {0} cannot sign on the server")]
    NotCustodialSignable(&'static str),
    #[error("wallet has no server share — cannot decrypt")]
    NoServerShare,
    #[error("aead error: {0}")]
    Aead(String),
    #[error("decrypted seed is not 32 bytes")]
    BadSeedLength,
    #[error("task join failed: {0}")]
    Join(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

/// Generate a fresh custodial Solana wallet, persist it, return the pubkey.
pub async fn provision_solana_custodial<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    req: ProvisionSolanaRequest,
) -> Result<ProvisionedSolanaWallet, SolanaWalletError> {
    let keypair = SolanaKeypair::generate();
    let pubkey = keypair.pubkey;
    let mut seed = keypair.secret_bytes();

    let mut per_wallet_kek = [0u8; 32];
    rand::rng().fill_bytes(&mut per_wallet_kek);
    let server_share_ciphertext = aead_encrypt(&per_wallet_kek, &seed)?;
    let server_share_kek_ciphertext = master_kek.wrap(&per_wallet_kek).await?;

    seed.zeroize();
    per_wallet_kek.zeroize();

    let wallet_id = WalletId::new();
    let insert = InsertSolanaWallet {
        id: wallet_id.clone(),
        user_id: req.user_id,
        pubkey,
        custody_state: CustodyState::Custodial,
        is_primary: req.is_primary,
        provisioned_by: req.provisioned_by,
        server_share_ciphertext: Some(server_share_ciphertext),
        server_share_kek_ciphertext: Some(server_share_kek_ciphertext),
        kek_version: Some(master_kek.version()),
    };
    let db = db.clone();
    tokio::task::spawn_blocking(move || -> Result<(), SolanaWalletError> {
        let conn = db.lock().expect("wallet db mutex poisoned");
        SolanaWalletStore::insert(&conn, &insert)?;
        Ok(())
    })
    .await
    .map_err(|e| SolanaWalletError::Join(e.to_string()))??;

    Ok(ProvisionedSolanaWallet {
        id: wallet_id,
        pubkey,
    })
}

/// Sign an arbitrary message with a custodial Solana wallet. Returns the
/// 64-byte ed25519 signature.
pub async fn sign_solana_custodial<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    wallet_id: &WalletId,
    message: &[u8],
) -> Result<Ed25519Signature, SolanaWalletError> {
    let stored = load_user_wallet(db, wallet_id).await?;
    if stored.custody_state != CustodyState::Custodial {
        return Err(SolanaWalletError::NotCustodialSignable(
            stored.custody_state.as_str(),
        ));
    }
    let seed = decrypt_seed_user(master_kek, &stored).await?;
    let keypair = SolanaKeypair::from_secret_bytes(&seed);
    Ok(keypair.sign(message))
}

/// Idempotently ensure a user has a primary Solana custodial wallet.
pub async fn ensure_primary_solana_user_wallet<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    user_id: &str,
) -> Result<Option<ProvisionedSolanaWallet>, SolanaWalletError> {
    let existing = {
        let db = db.clone();
        let user_id = user_id.to_string();
        tokio::task::spawn_blocking(
            move || -> Result<Vec<StoredSolanaWallet>, SolanaWalletError> {
                let conn = db.lock().expect("wallet db mutex poisoned");
                Ok(SolanaWalletStore::list_for_user(&conn, &user_id)?)
            },
        )
        .await
        .map_err(|e| SolanaWalletError::Join(e.to_string()))??
    };
    if existing.iter().any(|w| w.is_primary) {
        return Ok(None);
    }
    let provisioned = provision_solana_custodial(
        db,
        master_kek,
        ProvisionSolanaRequest {
            user_id: user_id.to_string(),
            is_primary: true,
            provisioned_by: ProvisionedBy::Runtime,
        },
    )
    .await?;
    Ok(Some(provisioned))
}

/// Generate a fresh Solana custodial wallet for an agent. 1:1 with `agent_id`.
pub async fn provision_solana_custodial_for_agent<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    req: ProvisionSolanaAgentRequest,
) -> Result<ProvisionedSolanaWallet, SolanaWalletError> {
    let keypair = SolanaKeypair::generate();
    let pubkey = keypair.pubkey;
    let mut seed = keypair.secret_bytes();

    let mut per_wallet_kek = [0u8; 32];
    rand::rng().fill_bytes(&mut per_wallet_kek);
    let server_share_ciphertext = aead_encrypt(&per_wallet_kek, &seed)?;
    let server_share_kek_ciphertext = master_kek.wrap(&per_wallet_kek).await?;

    seed.zeroize();
    per_wallet_kek.zeroize();

    let wallet_id = WalletId::new();
    let insert = InsertSolanaAgentWallet {
        id: wallet_id.clone(),
        agent_id: req.agent_id,
        pubkey,
        custody_state: CustodyState::Custodial,
        provisioned_by: req.provisioned_by,
        server_share_ciphertext: Some(server_share_ciphertext),
        server_share_kek_ciphertext: Some(server_share_kek_ciphertext),
        kek_version: Some(master_kek.version()),
    };
    let db = db.clone();
    tokio::task::spawn_blocking(move || -> Result<(), SolanaWalletError> {
        let conn = db.lock().expect("wallet db mutex poisoned");
        SolanaAgentWalletStore::insert(&conn, &insert)?;
        Ok(())
    })
    .await
    .map_err(|e| SolanaWalletError::Join(e.to_string()))??;

    Ok(ProvisionedSolanaWallet {
        id: wallet_id,
        pubkey,
    })
}

/// Idempotently ensure an agent has a Solana custodial wallet.
pub async fn ensure_solana_agent_wallet<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    agent_id: &str,
) -> Result<Option<ProvisionedSolanaWallet>, SolanaWalletError> {
    let existing = {
        let db = db.clone();
        let agent_id = agent_id.to_string();
        tokio::task::spawn_blocking(
            move || -> Result<Option<StoredSolanaAgentWallet>, SolanaWalletError> {
                let conn = db.lock().expect("wallet db mutex poisoned");
                Ok(SolanaAgentWalletStore::get_by_agent(&conn, &agent_id)?)
            },
        )
        .await
        .map_err(|e| SolanaWalletError::Join(e.to_string()))??
    };
    if existing.is_some() {
        return Ok(None);
    }
    let provisioned = provision_solana_custodial_for_agent(
        db,
        master_kek,
        ProvisionSolanaAgentRequest {
            agent_id: agent_id.to_string(),
            provisioned_by: ProvisionedBy::Runtime,
        },
    )
    .await?;
    Ok(Some(provisioned))
}

/// Sign with an agent's Solana custodial wallet.
pub async fn sign_solana_agent_custodial<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    wallet_id: &WalletId,
    message: &[u8],
) -> Result<Ed25519Signature, SolanaWalletError> {
    let stored = load_agent_wallet(db, wallet_id).await?;
    if stored.custody_state != CustodyState::Custodial {
        return Err(SolanaWalletError::NotCustodialSignable(
            stored.custody_state.as_str(),
        ));
    }
    let seed = decrypt_seed_agent(master_kek, &stored).await?;
    let keypair = SolanaKeypair::from_secret_bytes(&seed);
    Ok(keypair.sign(message))
}

// ── internals ─────────────────────────────────────────────────────────────

async fn load_user_wallet(
    db: &SharedDb,
    wallet_id: &WalletId,
) -> Result<StoredSolanaWallet, SolanaWalletError> {
    let db = db.clone();
    let id = wallet_id.clone();
    let stored =
        tokio::task::spawn_blocking(move || -> Result<StoredSolanaWallet, SolanaWalletError> {
            let conn = db.lock().expect("wallet db mutex poisoned");
            Ok(SolanaWalletStore::get_by_id(&conn, &id)?)
        })
        .await
        .map_err(|e| SolanaWalletError::Join(e.to_string()))??;
    Ok(stored)
}

async fn load_agent_wallet(
    db: &SharedDb,
    wallet_id: &WalletId,
) -> Result<StoredSolanaAgentWallet, SolanaWalletError> {
    let db = db.clone();
    let id = wallet_id.clone();
    let stored = tokio::task::spawn_blocking(
        move || -> Result<StoredSolanaAgentWallet, SolanaWalletError> {
            let conn = db.lock().expect("wallet db mutex poisoned");
            Ok(SolanaAgentWalletStore::get_by_id(&conn, &id)?)
        },
    )
    .await
    .map_err(|e| SolanaWalletError::Join(e.to_string()))??;
    Ok(stored)
}

async fn decrypt_seed_user<K: MasterKekProvider + ?Sized>(
    master_kek: &K,
    stored: &StoredSolanaWallet,
) -> Result<Zeroizing<[u8; 32]>, SolanaWalletError> {
    let server_share_ciphertext = stored
        .server_share_ciphertext
        .as_deref()
        .ok_or(SolanaWalletError::NoServerShare)?;
    let server_share_kek_ciphertext = stored
        .server_share_kek_ciphertext
        .as_deref()
        .ok_or(SolanaWalletError::NoServerShare)?;
    decrypt_seed(
        master_kek,
        server_share_ciphertext,
        server_share_kek_ciphertext,
    )
    .await
}

async fn decrypt_seed_agent<K: MasterKekProvider + ?Sized>(
    master_kek: &K,
    stored: &StoredSolanaAgentWallet,
) -> Result<Zeroizing<[u8; 32]>, SolanaWalletError> {
    let server_share_ciphertext = stored
        .server_share_ciphertext
        .as_deref()
        .ok_or(SolanaWalletError::NoServerShare)?;
    let server_share_kek_ciphertext = stored
        .server_share_kek_ciphertext
        .as_deref()
        .ok_or(SolanaWalletError::NoServerShare)?;
    decrypt_seed(
        master_kek,
        server_share_ciphertext,
        server_share_kek_ciphertext,
    )
    .await
}

async fn decrypt_seed<K: MasterKekProvider + ?Sized>(
    master_kek: &K,
    server_share_ciphertext: &[u8],
    server_share_kek_ciphertext: &[u8],
) -> Result<Zeroizing<[u8; 32]>, SolanaWalletError> {
    let per_wallet_kek = master_kek.unwrap(server_share_kek_ciphertext).await?;
    let mut plain = aead_decrypt(&per_wallet_kek, server_share_ciphertext)?;
    if plain.len() != 32 {
        plain.zeroize();
        return Err(SolanaWalletError::BadSeedLength);
    }
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&plain);
    plain.zeroize();
    Ok(out)
}

fn aead_encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, SolanaWalletError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| SolanaWalletError::Aead(e.to_string()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn aead_decrypt(key: &[u8; 32], envelope: &[u8]) -> Result<Vec<u8>, SolanaWalletError> {
    if envelope.len() < NONCE_LEN {
        return Err(SolanaWalletError::Aead(
            "envelope shorter than nonce".into(),
        ));
    }
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let (nonce_bytes, ciphertext) = envelope.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| SolanaWalletError::Aead(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kek::{KekError, MasterKekProvider, RotationReceipt, SecretKek};
    use crate::solana_keypair::verify;
    use crate::store::schema::migrate;
    use async_trait::async_trait;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    /// Test KEK that uses an in-memory 32-byte master key. Wraps the
    /// per-wallet KEK with raw ChaCha20Poly1305.
    struct TestMasterKek {
        master: [u8; 32],
    }

    impl TestMasterKek {
        fn new() -> Self {
            let mut m = [0u8; 32];
            rand::rng().fill_bytes(&mut m);
            Self { master: m }
        }
    }

    #[async_trait]
    impl MasterKekProvider for TestMasterKek {
        async fn wrap(&self, plaintext: &[u8; 32]) -> Result<Vec<u8>, KekError> {
            let cipher = ChaCha20Poly1305::new(Key::from_slice(&self.master));
            let mut nonce_bytes = [0u8; NONCE_LEN];
            rand::rng().fill_bytes(&mut nonce_bytes);
            let nonce = Nonce::from_slice(&nonce_bytes);
            let ct = cipher
                .encrypt(nonce, plaintext.as_slice())
                .map_err(|e| KekError::Wrap(e.to_string()))?;
            let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
            out.extend_from_slice(&nonce_bytes);
            out.extend_from_slice(&ct);
            Ok(out)
        }

        async fn unwrap(&self, ciphertext: &[u8]) -> Result<SecretKek, KekError> {
            if ciphertext.len() < NONCE_LEN {
                return Err(KekError::Unwrap("envelope short".into()));
            }
            let cipher = ChaCha20Poly1305::new(Key::from_slice(&self.master));
            let (nonce_bytes, ct) = ciphertext.split_at(NONCE_LEN);
            let nonce = Nonce::from_slice(nonce_bytes);
            let pt = cipher
                .decrypt(nonce, ct)
                .map_err(|e| KekError::Unwrap(e.to_string()))?;
            let arr: [u8; 32] = pt
                .as_slice()
                .try_into()
                .map_err(|_| KekError::Unwrap("not 32 bytes".into()))?;
            Ok(Zeroizing::new(arr))
        }

        fn version(&self) -> u32 {
            1
        }

        async fn rotate(&self) -> Result<RotationReceipt, KekError> {
            Err(KekError::Rotation("test KEK does not rotate".into()))
        }
    }

    fn fresh_db() -> SharedDb {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    #[tokio::test]
    async fn provision_then_sign_then_verify() {
        let db = fresh_db();
        let kek = TestMasterKek::new();

        let provisioned = provision_solana_custodial(
            &db,
            &kek,
            ProvisionSolanaRequest {
                user_id: "user-1".into(),
                is_primary: true,
                provisioned_by: ProvisionedBy::Runtime,
            },
        )
        .await
        .unwrap();

        let message = b"register-trust-tx-bytes";
        let sig = sign_solana_custodial(&db, &kek, &provisioned.id, message)
            .await
            .unwrap();

        // Public verification using the same pubkey returned at provision time.
        assert!(verify(&provisioned.pubkey, message, &sig));
    }

    #[tokio::test]
    async fn ensure_primary_is_idempotent() {
        let db = fresh_db();
        let kek = TestMasterKek::new();

        let first = ensure_primary_solana_user_wallet(&db, &kek, "user-1")
            .await
            .unwrap()
            .expect("first call provisions");
        let second = ensure_primary_solana_user_wallet(&db, &kek, "user-1")
            .await
            .unwrap();
        assert!(second.is_none(), "second call must not provision");

        // Sign with the wallet from the first call to confirm it's wired up.
        let sig = sign_solana_custodial(&db, &kek, &first.id, b"x")
            .await
            .unwrap();
        assert!(verify(&first.pubkey, b"x", &sig));
    }

    #[tokio::test]
    async fn agent_wallet_provision_sign_verify() {
        let db = fresh_db();
        let kek = TestMasterKek::new();

        let provisioned = ensure_solana_agent_wallet(&db, &kek, "agent-1")
            .await
            .unwrap()
            .expect("first call provisions");
        let dup = ensure_solana_agent_wallet(&db, &kek, "agent-1")
            .await
            .unwrap();
        assert!(dup.is_none(), "second call must not provision");

        let sig = sign_solana_agent_custodial(&db, &kek, &provisioned.id, b"agent-tx")
            .await
            .unwrap();
        assert!(verify(&provisioned.pubkey, b"agent-tx", &sig));
    }
}
