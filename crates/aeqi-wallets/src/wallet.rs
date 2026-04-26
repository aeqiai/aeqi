//! Top-level wallet service. Three operations cover the Phase 1 surface:
//!
//! - `provision_custodial` — generate keypair + recovery seed, envelope-encrypt
//!   the private key with a fresh per-wallet KEK wrapped by the master KEK,
//!   persist the row.
//! - `sign_custodial` — load a custodial wallet, decrypt the private key, sign
//!   a 32-byte digest, return EVM-style (r, s, v).
//! - `reveal_recovery_seed` — re-derive the BIP-39 mnemonic from the persisted
//!   key material so the user can write it down. Stamps
//!   `recovery_seed_revealed_at`.
//!
//! Async wrapper over sync rusqlite repos: every DB call is wrapped in
//! `tokio::task::spawn_blocking` per the aeqi convention.

use chacha20poly1305::{
    ChaCha20Poly1305, Key, Nonce,
    aead::{Aead, KeyInit},
};
use rand::RngCore;
use rusqlite::Connection;
use std::sync::Arc;
use tokio::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    Keypair,
    kek::{KekError, MasterKekProvider},
    keypair::KeypairError,
    recovery::{EntropySeed, RecoveryError},
    store::{
        WalletStore,
        repo::{InsertWallet, StoreError, StoredWallet},
    },
    types::{Address, CustodyState, EcdsaSignature, ProvisionedBy, Pubkey, WalletId},
};

const NONCE_LEN: usize = 12;

/// Shared async connection handle. Phase 1 holds it under a mutex; later we'll
/// swap for a connection pool.
pub type SharedDb = Arc<Mutex<Connection>>;

#[derive(Debug)]
pub struct ProvisionRequest {
    pub user_id: String,
    pub is_primary: bool,
    pub provisioned_by: ProvisionedBy,
}

#[derive(Debug, Clone)]
pub struct ProvisionedWallet {
    pub id: WalletId,
    pub address: Address,
    pub pubkey: Pubkey,
    pub mnemonic_revealed_once: String,
}

#[derive(Debug, Clone)]
pub struct RevealedRecovery {
    pub mnemonic: String,
    pub address: Address,
}

#[derive(Debug, thiserror::Error)]
pub enum WalletError {
    #[error(transparent)]
    Kek(#[from] KekError),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Recovery(#[from] RecoveryError),
    #[error(transparent)]
    Keypair(#[from] KeypairError),
    #[error("custody state {0} cannot sign on the server")]
    NotCustodialSignable(&'static str),
    #[error("wallet has no server share — cannot decrypt")]
    NoServerShare,
    #[error("aead error: {0}")]
    Aead(String),
    #[error("task join failed: {0}")]
    Join(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

/// Generate a fresh custodial wallet, persist it, and return the BIP-39
/// mnemonic ONCE. The mnemonic is not stored anywhere on the server — the
/// caller is responsible for showing it to the user (typically in a one-time
/// reveal flow). It can be re-derived later via `reveal_recovery_seed`.
///
/// The encrypted blob stores the 16 bytes of entropy (not the derived 32-byte
/// secret), so reveal can losslessly reconstruct the same mnemonic the user
/// saw at provisioning time. The signing key is deterministically derived
/// from the entropy whenever signing is needed.
pub async fn provision_custodial<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    req: ProvisionRequest,
) -> Result<ProvisionedWallet, WalletError> {
    // 1. Generate entropy + derive keypair + mnemonic.
    let entropy = EntropySeed::generate();
    let mnemonic = entropy.to_mnemonic()?.to_string();
    let mut secret = entropy.derive_private_key();
    let keypair = Keypair::from_secret_bytes(&secret)?;
    let address = keypair.address;
    let pubkey = keypair.pubkey.clone();

    // 2. Envelope-encrypt the entropy with a fresh per-wallet KEK.
    let mut per_wallet_kek = [0u8; 32];
    rand::rng().fill_bytes(&mut per_wallet_kek);
    let server_share_ciphertext = aead_encrypt(&per_wallet_kek, entropy.expose())?;
    let server_share_kek_ciphertext = master_kek.wrap(&per_wallet_kek).await?;

    // 3. Zeroize all the sensitive byte-buffers we touched.
    secret.zeroize();
    per_wallet_kek.zeroize();

    // 4. Persist.
    let wallet_id = WalletId::new();
    let insert = InsertWallet {
        id: wallet_id.clone(),
        user_id: req.user_id,
        address,
        pubkey: pubkey.0.clone(),
        custody_state: CustodyState::Custodial,
        is_primary: req.is_primary,
        provisioned_by: req.provisioned_by,
        server_share_ciphertext: Some(server_share_ciphertext),
        server_share_kek_ciphertext: Some(server_share_kek_ciphertext),
        kek_version: Some(master_kek.version()),
    };
    let db = db.clone();
    tokio::task::spawn_blocking(move || -> Result<(), WalletError> {
        let conn = db.blocking_lock();
        WalletStore::insert(&conn, &insert)?;
        Ok(())
    })
    .await
    .map_err(|e| WalletError::Join(e.to_string()))??;

    Ok(ProvisionedWallet {
        id: wallet_id,
        address,
        pubkey,
        mnemonic_revealed_once: mnemonic,
    })
}

/// Sign a 32-byte prehashed digest with a custodial-state wallet. Returns the
/// EVM-style (r, s, v).
pub async fn sign_custodial<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    wallet_id: &WalletId,
    digest: &[u8; 32],
) -> Result<EcdsaSignature, WalletError> {
    let stored = load_stored(db, wallet_id).await?;
    if stored.custody_state != CustodyState::Custodial {
        return Err(WalletError::NotCustodialSignable(
            stored.custody_state.as_str(),
        ));
    }
    let entropy = decrypt_entropy(master_kek, &stored).await?;
    let mut secret = EntropySeed::from_bytes(*entropy).derive_private_key();
    let keypair = Keypair::from_secret_bytes(&secret)?;
    let signature = keypair.sign_prehash(digest)?;
    secret.zeroize();
    Ok(signature)
}

/// Re-derive the BIP-39 mnemonic for a wallet so the user can write it down.
/// Re-auth gating happens at the platform endpoint layer; this function
/// assumes the caller has already verified authority. Stamps
/// `recovery_seed_revealed_at`.
pub async fn reveal_recovery_seed<K: MasterKekProvider + ?Sized>(
    db: &SharedDb,
    master_kek: &K,
    wallet_id: &WalletId,
) -> Result<RevealedRecovery, WalletError> {
    let stored = load_stored(db, wallet_id).await?;
    let entropy = decrypt_entropy(master_kek, &stored).await?;
    let mnemonic = EntropySeed::from_bytes(*entropy).to_mnemonic()?.to_string();

    // Stamp the timestamp.
    let db = db.clone();
    let id_for_block = wallet_id.clone();
    tokio::task::spawn_blocking(move || -> Result<(), WalletError> {
        let conn = db.blocking_lock();
        WalletStore::mark_recovery_revealed(&conn, &id_for_block)?;
        Ok(())
    })
    .await
    .map_err(|e| WalletError::Join(e.to_string()))??;

    Ok(RevealedRecovery {
        mnemonic,
        address: stored.address,
    })
}

// ── internal helpers ──────────────────────────────────────────────────────

async fn load_stored(db: &SharedDb, wallet_id: &WalletId) -> Result<StoredWallet, WalletError> {
    let db = db.clone();
    let id = wallet_id.clone();
    tokio::task::spawn_blocking(move || -> Result<StoredWallet, WalletError> {
        let conn = db.blocking_lock();
        let w = WalletStore::get_by_id(&conn, &id)?;
        Ok(w)
    })
    .await
    .map_err(|e| WalletError::Join(e.to_string()))?
}

async fn decrypt_entropy<K: MasterKekProvider + ?Sized>(
    master_kek: &K,
    stored: &StoredWallet,
) -> Result<Zeroizing<[u8; 16]>, WalletError> {
    let server_share_ct = stored
        .server_share_ciphertext
        .as_ref()
        .ok_or(WalletError::NoServerShare)?;
    let kek_ct = stored
        .server_share_kek_ciphertext
        .as_ref()
        .ok_or(WalletError::NoServerShare)?;

    let per_wallet_kek = master_kek.unwrap(kek_ct).await?;
    let mut entropy_bytes = aead_decrypt(per_wallet_kek.as_ref(), server_share_ct)?;
    if entropy_bytes.len() != 16 {
        entropy_bytes.zeroize();
        return Err(WalletError::Aead(format!(
            "decrypted entropy has wrong length: {}",
            entropy_bytes.len()
        )));
    }
    let mut out = Zeroizing::new([0u8; 16]);
    out.copy_from_slice(&entropy_bytes);
    entropy_bytes.zeroize();
    Ok(out)
}

fn aead_encrypt(key32: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, WalletError> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key32));
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| WalletError::Aead(format!("encrypt: {e}")))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn aead_decrypt(key32: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, WalletError> {
    if key32.len() != 32 {
        return Err(WalletError::Aead("key not 32 bytes".into()));
    }
    if ciphertext.len() < NONCE_LEN + 16 {
        return Err(WalletError::Aead("ciphertext too short".into()));
    }
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key32));
    let (nonce_bytes, ct) = ciphertext.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ct)
        .map_err(|e| WalletError::Aead(format!("decrypt: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kek::SoftwareKek;
    use sha3::{Digest, Keccak256};

    fn fresh_db() -> SharedDb {
        let conn = Connection::open_in_memory().unwrap();
        crate::store::schema::migrate(&conn).unwrap();
        Arc::new(Mutex::new(conn))
    }

    fn fresh_kek() -> SoftwareKek {
        // Bypass Argon2id (slow) for unit tests — derive from raw bytes.
        let mut master = [0u8; 32];
        rand::rng().fill_bytes(&mut master);
        SoftwareKek::from_bytes(master, 1)
    }

    #[tokio::test]
    async fn provision_then_sign_then_verify() {
        use k256::ecdsa::{Signature as KSig, VerifyingKey, signature::hazmat::PrehashVerifier};

        let db = fresh_db();
        let kek = fresh_kek();

        let provisioned = provision_custodial(
            &db,
            &kek,
            ProvisionRequest {
                user_id: "user-1".into(),
                is_primary: true,
                provisioned_by: ProvisionedBy::Runtime,
            },
        )
        .await
        .unwrap();

        // Sign a digest.
        let digest = Keccak256::digest(b"hello aeqi").into();
        let sig = sign_custodial(&db, &kek, &provisioned.id, &digest)
            .await
            .unwrap();

        // Verify against the stored pubkey.
        let mut r_s = [0u8; 64];
        r_s[..32].copy_from_slice(&sig.r);
        r_s[32..].copy_from_slice(&sig.s);
        let k_sig = KSig::from_slice(&r_s).unwrap();
        let vk = VerifyingKey::from_sec1_bytes(&provisioned.pubkey.0).unwrap();
        vk.verify_prehash(&digest, &k_sig)
            .expect("signature must verify");
    }

    #[tokio::test]
    async fn reveal_matches_provision_mnemonic() {
        let db = fresh_db();
        let kek = fresh_kek();
        let provisioned = provision_custodial(
            &db,
            &kek,
            ProvisionRequest {
                user_id: "user-1".into(),
                is_primary: true,
                provisioned_by: ProvisionedBy::Runtime,
            },
        )
        .await
        .unwrap();

        let r1 = reveal_recovery_seed(&db, &kek, &provisioned.id)
            .await
            .unwrap();
        let r2 = reveal_recovery_seed(&db, &kek, &provisioned.id)
            .await
            .unwrap();
        // The reveal MUST yield exactly the mnemonic the user was shown at
        // provisioning. Otherwise the user can't recover externally.
        assert_eq!(r1.mnemonic, provisioned.mnemonic_revealed_once);
        assert_eq!(r2.mnemonic, provisioned.mnemonic_revealed_once);
        assert_eq!(r1.address, provisioned.address);
    }

    #[tokio::test]
    async fn user_can_recover_address_from_mnemonic_alone() {
        // The strongest property: a user who walked away with only their
        // mnemonic can reconstruct the same address without server help.
        let db = fresh_db();
        let kek = fresh_kek();
        let provisioned = provision_custodial(
            &db,
            &kek,
            ProvisionRequest {
                user_id: "user-1".into(),
                is_primary: true,
                provisioned_by: ProvisionedBy::Runtime,
            },
        )
        .await
        .unwrap();

        let entropy =
            crate::recovery::entropy_from_phrase(&provisioned.mnemonic_revealed_once).unwrap();
        let secret = entropy.derive_private_key();
        let kp = crate::Keypair::from_secret_bytes(&secret).unwrap();
        assert_eq!(kp.address, provisioned.address);
    }

    #[tokio::test]
    async fn cannot_sign_self_custody_wallet_via_custodial_path() {
        let db = fresh_db();
        let kek = fresh_kek();
        // Manually seed a self_custody wallet (no server share).
        {
            let conn = db.lock().await;
            conn.execute(
                "INSERT INTO user_wallets (id, user_id, address, pubkey, custody_state,
                  is_primary, provisioned_by, server_share_ciphertext, added_at)
                 VALUES (?, ?, ?, ?, 'self_custody', 0, 'user', NULL, ?)",
                rusqlite::params![
                    "w-self",
                    "user-1",
                    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    vec![0x02u8; 33],
                    chrono::Utc::now().to_rfc3339(),
                ],
            )
            .unwrap();
        }
        let wid = WalletId("w-self".into());
        let digest = [0u8; 32];
        let r = sign_custodial(&db, &kek, &wid, &digest).await;
        assert!(matches!(r, Err(WalletError::NotCustodialSignable(_))));
    }
}
