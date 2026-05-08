//! `solana_company_wallets` + `solana_agent_wallets` repository. Sync rusqlite
//! calls, intended to run inside `tokio::task::spawn_blocking` from the async
//! service layer (matches the convention used elsewhere in aeqi).

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};

use crate::solana_keypair::SolanaPubkey;
use crate::store::repo::StoreError;
use crate::types::{CustodyState, ProvisionedBy, WalletId};

/// One row of `solana_company_wallets` mapped to a value type.
#[derive(Debug, Clone)]
pub struct StoredSolanaWallet {
    pub id: WalletId,
    pub company_id: String,
    pub pubkey: SolanaPubkey,
    pub custody_state: CustodyState,
    pub is_primary: bool,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertSolanaWallet {
    pub id: WalletId,
    pub company_id: String,
    pub pubkey: SolanaPubkey,
    pub custody_state: CustodyState,
    pub is_primary: bool,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct StoredSolanaAgentWallet {
    pub id: WalletId,
    pub agent_id: String,
    pub pubkey: SolanaPubkey,
    pub custody_state: CustodyState,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertSolanaAgentWallet {
    pub id: WalletId,
    pub agent_id: String,
    pub pubkey: SolanaPubkey,
    pub custody_state: CustodyState,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
}

pub struct SolanaWalletStore;

impl SolanaWalletStore {
    pub fn insert(conn: &Connection, w: &InsertSolanaWallet) -> Result<(), StoreError> {
        let tx = conn.unchecked_transaction()?;
        if w.is_primary {
            tx.execute(
                "UPDATE solana_company_wallets SET is_primary = 0 WHERE company_id = ? AND is_primary = 1",
                params![w.company_id],
            )?;
        }
        tx.execute(
            r#"INSERT INTO solana_company_wallets
               (id, company_id, pubkey_b58, pubkey_bytes, custody_state, is_primary,
                provisioned_by, server_share_ciphertext,
                server_share_kek_ciphertext, kek_version, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            params![
                w.id.as_str(),
                w.company_id,
                w.pubkey.to_base58(),
                &w.pubkey.0[..],
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

    pub fn get_by_id(conn: &Connection, id: &WalletId) -> Result<StoredSolanaWallet, StoreError> {
        Self::query_one(conn, "id = ?", params![id.as_str()])
            .and_then(|opt| opt.ok_or_else(|| StoreError::NotFound(id.0.clone())))
    }

    pub fn list_for_company(
        conn: &Connection,
        company_id: &str,
    ) -> Result<Vec<StoredSolanaWallet>, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, company_id, pubkey_b58, pubkey_bytes, custody_state,
                      is_primary, provisioned_by, server_share_ciphertext,
                      server_share_kek_ciphertext, kek_version, added_at
               FROM solana_company_wallets WHERE company_id = ?"#,
        )?;
        let rows = stmt.query_map(params![company_id], row_to_company_wallet)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
        }
        Ok(out)
    }

    fn query_one(
        conn: &Connection,
        where_clause: &str,
        params: impl rusqlite::Params,
    ) -> Result<Option<StoredSolanaWallet>, StoreError> {
        let sql = format!(
            r#"SELECT id, company_id, pubkey_b58, pubkey_bytes, custody_state,
                      is_primary, provisioned_by, server_share_ciphertext,
                      server_share_kek_ciphertext, kek_version, added_at
               FROM solana_company_wallets WHERE {where_clause}"#
        );
        let mut stmt = conn.prepare(&sql)?;
        let row = stmt
            .query_row(params, row_to_company_wallet)
            .optional()?
            .transpose()?;
        Ok(row)
    }
}

pub struct SolanaAgentWalletStore;

impl SolanaAgentWalletStore {
    pub fn insert(conn: &Connection, w: &InsertSolanaAgentWallet) -> Result<(), StoreError> {
        conn.execute(
            r#"INSERT INTO solana_agent_wallets
               (id, agent_id, pubkey_b58, pubkey_bytes, custody_state,
                provisioned_by, server_share_ciphertext,
                server_share_kek_ciphertext, kek_version, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            params![
                w.id.as_str(),
                w.agent_id,
                w.pubkey.to_base58(),
                &w.pubkey.0[..],
                w.custody_state.as_str(),
                w.provisioned_by.as_str(),
                w.server_share_ciphertext,
                w.server_share_kek_ciphertext,
                w.kek_version,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_by_agent(
        conn: &Connection,
        agent_id: &str,
    ) -> Result<Option<StoredSolanaAgentWallet>, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, agent_id, pubkey_b58, pubkey_bytes, custody_state,
                      provisioned_by, server_share_ciphertext,
                      server_share_kek_ciphertext, kek_version, added_at
               FROM solana_agent_wallets WHERE agent_id = ?"#,
        )?;
        let row = stmt
            .query_row(params![agent_id], row_to_agent_wallet)
            .optional()?
            .transpose()?;
        Ok(row)
    }

    pub fn get_by_id(
        conn: &Connection,
        id: &WalletId,
    ) -> Result<StoredSolanaAgentWallet, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, agent_id, pubkey_b58, pubkey_bytes, custody_state,
                      provisioned_by, server_share_ciphertext,
                      server_share_kek_ciphertext, kek_version, added_at
               FROM solana_agent_wallets WHERE id = ?"#,
        )?;
        stmt.query_row(params![id.as_str()], row_to_agent_wallet)
            .optional()?
            .transpose()?
            .ok_or_else(|| StoreError::NotFound(id.0.clone()))
    }
}

fn row_to_company_wallet(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<Result<StoredSolanaWallet, StoreError>> {
    let id: String = row.get(0)?;
    let company_id: String = row.get(1)?;
    let _pubkey_b58: String = row.get(2)?;
    let pubkey_bytes: Vec<u8> = row.get(3)?;
    let custody_state: String = row.get(4)?;
    let is_primary: i32 = row.get(5)?;
    let provisioned_by: String = row.get(6)?;
    let server_share_ciphertext: Option<Vec<u8>> = row.get(7)?;
    let server_share_kek_ciphertext: Option<Vec<u8>> = row.get(8)?;
    let kek_version: Option<u32> = row.get(9)?;
    let added_at: String = row.get(10)?;

    Ok((|| -> Result<StoredSolanaWallet, StoreError> {
        let pubkey_arr: [u8; 32] = pubkey_bytes
            .try_into()
            .map_err(|_| StoreError::AddressParse("pubkey not 32 bytes".into()))?;
        Ok(StoredSolanaWallet {
            id: WalletId(id),
            company_id,
            pubkey: SolanaPubkey(pubkey_arr),
            custody_state: CustodyState::parse(&custody_state)
                .ok_or_else(|| StoreError::BadCustodyState(custody_state.clone()))?,
            is_primary: is_primary != 0,
            provisioned_by: parse_provisioned_by(&provisioned_by)?,
            server_share_ciphertext,
            server_share_kek_ciphertext,
            kek_version,
            added_at: DateTime::parse_from_rfc3339(&added_at)
                .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
                .with_timezone(&Utc),
        })
    })())
}

fn row_to_agent_wallet(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<Result<StoredSolanaAgentWallet, StoreError>> {
    let id: String = row.get(0)?;
    let agent_id: String = row.get(1)?;
    let _pubkey_b58: String = row.get(2)?;
    let pubkey_bytes: Vec<u8> = row.get(3)?;
    let custody_state: String = row.get(4)?;
    let provisioned_by: String = row.get(5)?;
    let server_share_ciphertext: Option<Vec<u8>> = row.get(6)?;
    let server_share_kek_ciphertext: Option<Vec<u8>> = row.get(7)?;
    let kek_version: Option<u32> = row.get(8)?;
    let added_at: String = row.get(9)?;

    Ok((|| -> Result<StoredSolanaAgentWallet, StoreError> {
        let pubkey_arr: [u8; 32] = pubkey_bytes
            .try_into()
            .map_err(|_| StoreError::AddressParse("pubkey not 32 bytes".into()))?;
        Ok(StoredSolanaAgentWallet {
            id: WalletId(id),
            agent_id,
            pubkey: SolanaPubkey(pubkey_arr),
            custody_state: CustodyState::parse(&custody_state)
                .ok_or_else(|| StoreError::BadCustodyState(custody_state.clone()))?,
            provisioned_by: parse_provisioned_by(&provisioned_by)?,
            server_share_ciphertext,
            server_share_kek_ciphertext,
            kek_version,
            added_at: DateTime::parse_from_rfc3339(&added_at)
                .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
                .with_timezone(&Utc),
        })
    })())
}

fn parse_provisioned_by(s: &str) -> Result<ProvisionedBy, StoreError> {
    match s {
        "runtime" => Ok(ProvisionedBy::Runtime),
        "user" => Ok(ProvisionedBy::User),
        other => Err(StoreError::BadProvisionedBy(other.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solana_keypair::SolanaKeypair;
    use crate::store::schema::migrate;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn insert_and_fetch_user_wallet() {
        let conn = fresh_db();
        let kp = SolanaKeypair::generate();
        let w = InsertSolanaWallet {
            id: WalletId::new(),
            company_id: "company-1".into(),
            pubkey: kp.pubkey,
            custody_state: CustodyState::Custodial,
            is_primary: true,
            provisioned_by: ProvisionedBy::Runtime,
            server_share_ciphertext: Some(vec![0u8; 32]),
            server_share_kek_ciphertext: Some(vec![0u8; 64]),
            kek_version: Some(1),
        };
        SolanaWalletStore::insert(&conn, &w).unwrap();

        let fetched = SolanaWalletStore::get_by_id(&conn, &w.id).unwrap();
        assert_eq!(fetched.company_id, "company-1");
        assert_eq!(fetched.pubkey, kp.pubkey);
        assert!(fetched.is_primary);
    }

    #[test]
    fn one_primary_per_user() {
        let conn = fresh_db();
        let kp1 = SolanaKeypair::generate();
        let kp2 = SolanaKeypair::generate();

        SolanaWalletStore::insert(
            &conn,
            &InsertSolanaWallet {
                id: WalletId::new(),
                company_id: "company-1".into(),
                pubkey: kp1.pubkey,
                custody_state: CustodyState::Custodial,
                is_primary: true,
                provisioned_by: ProvisionedBy::Runtime,
                server_share_ciphertext: Some(vec![0u8; 32]),
                server_share_kek_ciphertext: Some(vec![0u8; 64]),
                kek_version: Some(1),
            },
        )
        .unwrap();

        // Inserting another primary for the same user demotes the first.
        SolanaWalletStore::insert(
            &conn,
            &InsertSolanaWallet {
                id: WalletId::new(),
                company_id: "company-1".into(),
                pubkey: kp2.pubkey,
                custody_state: CustodyState::Custodial,
                is_primary: true,
                provisioned_by: ProvisionedBy::Runtime,
                server_share_ciphertext: Some(vec![0u8; 32]),
                server_share_kek_ciphertext: Some(vec![0u8; 64]),
                kek_version: Some(1),
            },
        )
        .unwrap();

        let wallets = SolanaWalletStore::list_for_company(&conn, "company-1").unwrap();
        assert_eq!(wallets.len(), 2);
        let primaries: Vec<_> = wallets.iter().filter(|w| w.is_primary).collect();
        assert_eq!(primaries.len(), 1);
        assert_eq!(primaries[0].pubkey, kp2.pubkey);
    }

    #[test]
    fn agent_wallet_one_per_agent() {
        let conn = fresh_db();
        let kp = SolanaKeypair::generate();
        SolanaAgentWalletStore::insert(
            &conn,
            &InsertSolanaAgentWallet {
                id: WalletId::new(),
                agent_id: "agent-1".into(),
                pubkey: kp.pubkey,
                custody_state: CustodyState::Custodial,
                provisioned_by: ProvisionedBy::Runtime,
                server_share_ciphertext: Some(vec![0u8; 32]),
                server_share_kek_ciphertext: Some(vec![0u8; 64]),
                kek_version: Some(1),
            },
        )
        .unwrap();

        // Second insert for same agent must fail (UNIQUE on agent_id).
        let dup = InsertSolanaAgentWallet {
            id: WalletId::new(),
            agent_id: "agent-1".into(),
            pubkey: SolanaKeypair::generate().pubkey,
            custody_state: CustodyState::Custodial,
            provisioned_by: ProvisionedBy::Runtime,
            server_share_ciphertext: Some(vec![0u8; 32]),
            server_share_kek_ciphertext: Some(vec![0u8; 64]),
            kek_version: Some(1),
        };
        let err = SolanaAgentWalletStore::insert(&conn, &dup);
        assert!(err.is_err(), "expected unique constraint violation");

        let fetched = SolanaAgentWalletStore::get_by_agent(&conn, "agent-1")
            .unwrap()
            .expect("agent wallet present");
        assert_eq!(fetched.pubkey, kp.pubkey);
    }
}
