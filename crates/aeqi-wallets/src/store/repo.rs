//! `user_wallets` repository. Sync rusqlite calls, intended to run inside
//! `tokio::task::spawn_blocking` from the async service layer (matches the
//! convention used elsewhere in aeqi).

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};

use crate::types::{Address, CustodyState, ProvisionedBy, WalletId};

/// One row of `user_wallets` mapped to a value type. Ciphertext fields stay as
/// raw bytes; decryption happens in the service layer with the master KEK.
#[derive(Debug, Clone)]
pub struct StoredWallet {
    pub id: WalletId,
    pub user_id: String,
    pub address: Address,
    pub pubkey: Vec<u8>,
    pub custody_state: CustodyState,
    pub is_primary: bool,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
    pub client_share_commitment: Option<Vec<u8>>,
    pub recovery_seed_revealed_at: Option<DateTime<Utc>>,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertWallet {
    pub id: WalletId,
    pub user_id: String,
    pub address: Address,
    pub pubkey: Vec<u8>,
    pub custody_state: CustodyState,
    pub is_primary: bool,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
}

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
    #[error("wallet not found: {0}")]
    NotFound(String),
    #[error("address parse error: {0}")]
    AddressParse(String),
    #[error("invalid custody state in db: {0}")]
    BadCustodyState(String),
    #[error("invalid provisioned_by in db: {0}")]
    BadProvisionedBy(String),
    #[error("invalid timestamp: {0}")]
    BadTimestamp(String),
}

pub struct WalletStore;

impl WalletStore {
    pub fn insert(conn: &Connection, w: &InsertWallet) -> Result<(), StoreError> {
        // Atomic: clear any existing primary for this user before inserting a
        // new primary, so the partial unique index never trips.
        let tx = conn.unchecked_transaction()?;
        if w.is_primary {
            tx.execute(
                "UPDATE user_wallets SET is_primary = 0 WHERE user_id = ? AND is_primary = 1",
                params![w.user_id],
            )?;
        }
        tx.execute(
            r#"INSERT INTO user_wallets
               (id, user_id, address, pubkey, custody_state, is_primary,
                provisioned_by, server_share_ciphertext,
                server_share_kek_ciphertext, kek_version, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            params![
                w.id.as_str(),
                w.user_id,
                w.address.as_hex(),
                w.pubkey,
                w.custody_state.as_str(),
                w.is_primary as i32,
                w.provisioned_by.as_str(),
                w.server_share_ciphertext,
                w.server_share_kek_ciphertext,
                w.kek_version,
                Utc::now().to_rfc3339(),
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_by_id(conn: &Connection, id: &WalletId) -> Result<StoredWallet, StoreError> {
        Self::query_one(conn, "id = ?", params![id.as_str()])
            .and_then(|opt| opt.ok_or_else(|| StoreError::NotFound(id.0.clone())))
    }

    pub fn get_by_address(
        conn: &Connection,
        address: &Address,
    ) -> Result<StoredWallet, StoreError> {
        let hex = address.as_hex();
        Self::query_one(conn, "address = ?", params![hex])
            .and_then(|opt| opt.ok_or_else(|| StoreError::NotFound(hex)))
    }

    pub fn list_for_user(
        conn: &Connection,
        user_id: &str,
    ) -> Result<Vec<StoredWallet>, StoreError> {
        let mut stmt = conn.prepare(SELECT_ALL)?;
        let rows = stmt.query_map(params![user_id], parse_row)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
        }
        Ok(out)
    }

    pub fn set_primary(conn: &Connection, id: &WalletId) -> Result<(), StoreError> {
        let tx = conn.unchecked_transaction()?;
        // Look up which user owns this wallet so we know the scope.
        let user_id: String = tx.query_row(
            "SELECT user_id FROM user_wallets WHERE id = ?",
            params![id.as_str()],
            |row| row.get(0),
        )?;
        tx.execute(
            "UPDATE user_wallets SET is_primary = 0 WHERE user_id = ? AND is_primary = 1",
            params![user_id],
        )?;
        let updated = tx.execute(
            "UPDATE user_wallets SET is_primary = 1 WHERE id = ?",
            params![id.as_str()],
        )?;
        if updated == 0 {
            return Err(StoreError::NotFound(id.0.clone()));
        }
        tx.commit()?;
        Ok(())
    }

    pub fn mark_recovery_revealed(conn: &Connection, id: &WalletId) -> Result<(), StoreError> {
        let updated = conn.execute(
            "UPDATE user_wallets SET recovery_seed_revealed_at = ? WHERE id = ?",
            params![Utc::now().to_rfc3339(), id.as_str()],
        )?;
        if updated == 0 {
            return Err(StoreError::NotFound(id.0.clone()));
        }
        Ok(())
    }

    fn query_one(
        conn: &Connection,
        where_clause: &str,
        params: impl rusqlite::Params,
    ) -> Result<Option<StoredWallet>, StoreError> {
        let sql = format!(
            r#"SELECT id, user_id, address, pubkey, custody_state, is_primary,
                       provisioned_by, server_share_ciphertext,
                       server_share_kek_ciphertext, kek_version,
                       client_share_commitment, recovery_seed_revealed_at, added_at
               FROM user_wallets
               WHERE {where_clause}"#
        );
        let mut stmt = conn.prepare(&sql)?;
        let row = stmt.query_row(params, parse_row).optional()?;
        match row {
            Some(Ok(w)) => Ok(Some(w)),
            Some(Err(e)) => Err(e),
            None => Ok(None),
        }
    }
}

const SELECT_ALL: &str = r#"SELECT id, user_id, address, pubkey, custody_state, is_primary,
                                   provisioned_by, server_share_ciphertext,
                                   server_share_kek_ciphertext, kek_version,
                                   client_share_commitment, recovery_seed_revealed_at, added_at
                            FROM user_wallets
                            WHERE user_id = ?
                            ORDER BY is_primary DESC, added_at ASC"#;

fn parse_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<StoredWallet, StoreError>> {
    let id: String = row.get(0)?;
    let user_id: String = row.get(1)?;
    let address_hex: String = row.get(2)?;
    let pubkey: Vec<u8> = row.get(3)?;
    let custody_str: String = row.get(4)?;
    let is_primary_int: i32 = row.get(5)?;
    let provisioned_by_str: String = row.get(6)?;
    let server_share_ciphertext: Option<Vec<u8>> = row.get(7)?;
    let server_share_kek_ciphertext: Option<Vec<u8>> = row.get(8)?;
    let kek_version: Option<u32> = row.get(9)?;
    let client_share_commitment: Option<Vec<u8>> = row.get(10)?;
    let recovery_revealed_str: Option<String> = row.get(11)?;
    let added_at_str: String = row.get(12)?;

    Ok((|| -> Result<StoredWallet, StoreError> {
        let address = parse_address(&address_hex)?;
        let custody_state = CustodyState::parse(&custody_str)
            .ok_or_else(|| StoreError::BadCustodyState(custody_str.clone()))?;
        let provisioned_by = match provisioned_by_str.as_str() {
            "runtime" => ProvisionedBy::Runtime,
            "user" => ProvisionedBy::User,
            other => return Err(StoreError::BadProvisionedBy(other.into())),
        };
        let added_at = parse_ts(&added_at_str)?;
        let recovery_seed_revealed_at =
            recovery_revealed_str.as_deref().map(parse_ts).transpose()?;
        Ok(StoredWallet {
            id: WalletId(id),
            user_id,
            address,
            pubkey,
            custody_state,
            is_primary: is_primary_int != 0,
            provisioned_by,
            server_share_ciphertext,
            server_share_kek_ciphertext,
            kek_version,
            client_share_commitment,
            recovery_seed_revealed_at,
            added_at,
        })
    })())
}

fn parse_address(hex_str: &str) -> Result<Address, StoreError> {
    let stripped = hex_str.strip_prefix("0x").unwrap_or(hex_str);
    let bytes = hex::decode(stripped).map_err(|e| StoreError::AddressParse(e.to_string()))?;
    if bytes.len() != 20 {
        return Err(StoreError::AddressParse(format!(
            "expected 20 bytes, got {}",
            bytes.len()
        )));
    }
    let mut out = [0u8; 20];
    out.copy_from_slice(&bytes);
    Ok(Address(out))
}

fn parse_ts(s: &str) -> Result<DateTime<Utc>, StoreError> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| StoreError::BadTimestamp(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::store::schema::migrate(&conn).unwrap();
        conn
    }

    fn sample_insert(user_id: &str, addr_byte: u8, primary: bool) -> InsertWallet {
        InsertWallet {
            id: WalletId::new(),
            user_id: user_id.to_string(),
            address: Address([addr_byte; 20]),
            pubkey: vec![0x02; 33],
            custody_state: CustodyState::Custodial,
            is_primary: primary,
            provisioned_by: ProvisionedBy::Runtime,
            server_share_ciphertext: Some(vec![0x01; 64]),
            server_share_kek_ciphertext: Some(vec![0x02; 60]),
            kek_version: Some(1),
        }
    }

    #[test]
    fn insert_and_get_roundtrip() {
        let conn = fresh_db();
        let w = sample_insert("user-1", 0xaa, true);
        WalletStore::insert(&conn, &w).unwrap();

        let got = WalletStore::get_by_id(&conn, &w.id).unwrap();
        assert_eq!(got.user_id, "user-1");
        assert_eq!(got.address, w.address);
        assert!(got.is_primary);
        assert_eq!(got.custody_state, CustodyState::Custodial);
        assert_eq!(got.provisioned_by, ProvisionedBy::Runtime);
        assert_eq!(got.kek_version, Some(1));
    }

    #[test]
    fn inserting_second_primary_demotes_the_first() {
        let conn = fresh_db();
        let w1 = sample_insert("user-1", 0xaa, true);
        let w2 = sample_insert("user-1", 0xbb, true);
        WalletStore::insert(&conn, &w1).unwrap();
        WalletStore::insert(&conn, &w2).unwrap();

        let all = WalletStore::list_for_user(&conn, "user-1").unwrap();
        assert_eq!(all.len(), 2);
        let primaries: Vec<_> = all.iter().filter(|w| w.is_primary).collect();
        assert_eq!(primaries.len(), 1, "exactly one primary per user");
        assert_eq!(primaries[0].address, w2.address);
    }

    #[test]
    fn set_primary_swaps_winner() {
        let conn = fresh_db();
        let w1 = sample_insert("user-1", 0xaa, true);
        let w2 = sample_insert("user-1", 0xbb, false);
        WalletStore::insert(&conn, &w1).unwrap();
        WalletStore::insert(&conn, &w2).unwrap();

        WalletStore::set_primary(&conn, &w2.id).unwrap();

        let after_w1 = WalletStore::get_by_id(&conn, &w1.id).unwrap();
        let after_w2 = WalletStore::get_by_id(&conn, &w2.id).unwrap();
        assert!(!after_w1.is_primary);
        assert!(after_w2.is_primary);
    }

    #[test]
    fn list_for_user_orders_primary_first() {
        let conn = fresh_db();
        WalletStore::insert(&conn, &sample_insert("user-1", 0xaa, false)).unwrap();
        WalletStore::insert(&conn, &sample_insert("user-1", 0xbb, true)).unwrap();
        WalletStore::insert(&conn, &sample_insert("user-1", 0xcc, false)).unwrap();

        let all = WalletStore::list_for_user(&conn, "user-1").unwrap();
        assert_eq!(all.len(), 3);
        assert!(all[0].is_primary, "primary should be first");
    }

    #[test]
    fn get_by_address_finds_it() {
        let conn = fresh_db();
        let w = sample_insert("user-1", 0xaa, true);
        WalletStore::insert(&conn, &w).unwrap();
        let got = WalletStore::get_by_address(&conn, &w.address).unwrap();
        assert_eq!(got.id, w.id);
    }

    #[test]
    fn mark_recovery_revealed_sets_timestamp() {
        let conn = fresh_db();
        let w = sample_insert("user-1", 0xaa, true);
        WalletStore::insert(&conn, &w).unwrap();
        assert!(
            WalletStore::get_by_id(&conn, &w.id)
                .unwrap()
                .recovery_seed_revealed_at
                .is_none()
        );

        WalletStore::mark_recovery_revealed(&conn, &w.id).unwrap();
        assert!(
            WalletStore::get_by_id(&conn, &w.id)
                .unwrap()
                .recovery_seed_revealed_at
                .is_some()
        );
    }
}
