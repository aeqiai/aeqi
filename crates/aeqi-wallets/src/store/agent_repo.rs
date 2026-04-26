//! `agent_wallets` repository. Parallel to `user_wallets` but agent-keyed and
//! 1:1 (every agent has exactly one wallet at creation time). No primary-swap
//! semantics; the `agent_id UNIQUE` constraint is what enforces single-wallet.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};

use crate::store::repo::StoreError;
use crate::types::{Address, CustodyState, ProvisionedBy, WalletId};

#[derive(Debug, Clone)]
pub struct StoredAgentWallet {
    pub id: WalletId,
    pub agent_id: String,
    pub address: Address,
    pub pubkey: Vec<u8>,
    pub custody_state: CustodyState,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
    pub client_share_commitment: Option<Vec<u8>>,
    pub recovery_seed_revealed_at: Option<DateTime<Utc>>,
    pub added_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertAgentWallet {
    pub id: WalletId,
    pub agent_id: String,
    pub address: Address,
    pub pubkey: Vec<u8>,
    pub custody_state: CustodyState,
    pub provisioned_by: ProvisionedBy,
    pub server_share_ciphertext: Option<Vec<u8>>,
    pub server_share_kek_ciphertext: Option<Vec<u8>>,
    pub kek_version: Option<u32>,
}

pub struct AgentWalletStore;

impl AgentWalletStore {
    pub fn insert(conn: &Connection, w: &InsertAgentWallet) -> Result<(), StoreError> {
        conn.execute(
            r#"INSERT INTO agent_wallets
               (id, agent_id, address, pubkey, custody_state, provisioned_by,
                server_share_ciphertext, server_share_kek_ciphertext,
                kek_version, added_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            params![
                w.id.as_str(),
                w.agent_id,
                w.address.as_hex(),
                w.pubkey,
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
    ) -> Result<Option<StoredAgentWallet>, StoreError> {
        Self::query_one(conn, "agent_id = ?", params![agent_id])
    }

    pub fn get_by_address(
        conn: &Connection,
        address: &Address,
    ) -> Result<StoredAgentWallet, StoreError> {
        let hex = address.as_hex();
        Self::query_one(conn, "address = ?", params![hex])
            .and_then(|opt| opt.ok_or_else(|| StoreError::NotFound(hex)))
    }

    pub fn mark_recovery_revealed(conn: &Connection, agent_id: &str) -> Result<(), StoreError> {
        let updated = conn.execute(
            "UPDATE agent_wallets SET recovery_seed_revealed_at = ? WHERE agent_id = ?",
            params![Utc::now().to_rfc3339(), agent_id],
        )?;
        if updated == 0 {
            return Err(StoreError::NotFound(agent_id.into()));
        }
        Ok(())
    }

    fn query_one(
        conn: &Connection,
        where_clause: &str,
        params: impl rusqlite::Params,
    ) -> Result<Option<StoredAgentWallet>, StoreError> {
        let sql = format!(
            r#"SELECT id, agent_id, address, pubkey, custody_state, provisioned_by,
                       server_share_ciphertext, server_share_kek_ciphertext,
                       kek_version, client_share_commitment,
                       recovery_seed_revealed_at, added_at
               FROM agent_wallets
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

fn parse_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Result<StoredAgentWallet, StoreError>> {
    let id: String = row.get(0)?;
    let agent_id: String = row.get(1)?;
    let address_hex: String = row.get(2)?;
    let pubkey: Vec<u8> = row.get(3)?;
    let custody_str: String = row.get(4)?;
    let provisioned_by_str: String = row.get(5)?;
    let server_share_ciphertext: Option<Vec<u8>> = row.get(6)?;
    let server_share_kek_ciphertext: Option<Vec<u8>> = row.get(7)?;
    let kek_version: Option<u32> = row.get(8)?;
    let client_share_commitment: Option<Vec<u8>> = row.get(9)?;
    let recovery_revealed_str: Option<String> = row.get(10)?;
    let added_at_str: String = row.get(11)?;

    Ok((|| -> Result<StoredAgentWallet, StoreError> {
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
        Ok(StoredAgentWallet {
            id: WalletId(id),
            agent_id,
            address,
            pubkey,
            custody_state,
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

    fn sample_insert(agent_id: &str, addr_byte: u8) -> InsertAgentWallet {
        InsertAgentWallet {
            id: WalletId::new(),
            agent_id: agent_id.into(),
            address: Address([addr_byte; 20]),
            pubkey: vec![0x02; 33],
            custody_state: CustodyState::Custodial,
            provisioned_by: ProvisionedBy::Runtime,
            server_share_ciphertext: Some(vec![0x01; 32]),
            server_share_kek_ciphertext: Some(vec![0x02; 60]),
            kek_version: Some(1),
        }
    }

    #[test]
    fn insert_and_get_by_agent() {
        let conn = fresh_db();
        let w = sample_insert("agent-1", 0xaa);
        AgentWalletStore::insert(&conn, &w).unwrap();
        let got = AgentWalletStore::get_by_agent(&conn, "agent-1").unwrap();
        assert!(got.is_some());
        assert_eq!(got.unwrap().address, w.address);
    }

    #[test]
    fn agent_id_is_unique_one_wallet_per_agent() {
        let conn = fresh_db();
        AgentWalletStore::insert(&conn, &sample_insert("agent-1", 0xaa)).unwrap();
        let r = AgentWalletStore::insert(&conn, &sample_insert("agent-1", 0xbb));
        assert!(r.is_err(), "second wallet for same agent must fail unique");
    }

    #[test]
    fn get_by_address_finds_it() {
        let conn = fresh_db();
        let w = sample_insert("agent-1", 0xaa);
        AgentWalletStore::insert(&conn, &w).unwrap();
        let got = AgentWalletStore::get_by_address(&conn, &w.address).unwrap();
        assert_eq!(got.agent_id, "agent-1");
    }
}
