//! Passkey (WebAuthn) ceremony state and credential storage.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;
use webauthn_rs::prelude::*;

/// Configured WebAuthn instance + ceremony-state map.
#[derive(Clone)]
pub struct PasskeyContext {
    pub webauthn: Arc<Webauthn>,
    pub registrations: Arc<Mutex<HashMap<String, PendingRegistration>>>,
    pub authentications: Arc<Mutex<HashMap<String, PasskeyAuthentication>>>,
}

#[derive(Clone)]
pub struct PendingRegistration {
    pub user_id: String,
    pub state: PasskeyRegistration,
}

impl PasskeyContext {
    pub fn bootstrap(base_url: &str) -> Result<Self> {
        let (rp_id, rp_origin) = derive_rp(base_url)?;
        let webauthn = WebauthnBuilder::new(&rp_id, &rp_origin)
            .context("invalid WebAuthn RP config")?
            .rp_name("aeqi")
            .build()
            .context("failed to build WebAuthn instance")?;
        Ok(Self {
            webauthn: Arc::new(webauthn),
            registrations: Arc::new(Mutex::new(HashMap::new())),
            authentications: Arc::new(Mutex::new(HashMap::new())),
        })
    }
}

fn derive_rp(base_url: &str) -> Result<(String, Url)> {
    let trimmed = base_url.trim_end_matches('/');
    let parsed = Url::parse(trimmed).context("base_url is not a valid URL")?;
    let host = parsed
        .host_str()
        .context("base_url has no host")?
        .to_string();
    Ok((host, parsed))
}

#[derive(Debug, Clone)]
pub struct StoredCredential {
    pub user_id: String,
    pub passkey: Passkey,
}

pub fn insert_credential(conn: &Connection, user_id: &str, passkey: &Passkey) -> Result<()> {
    let cred_id = passkey.cred_id().as_ref().to_vec();
    let public_key = serde_json::to_vec(passkey).context("serialize passkey")?;
    conn.execute(
        r#"INSERT INTO passkey_credentials
           (id, user_id, credential_id, public_key, sign_count, added_at)
           VALUES (?, ?, ?, ?, 0, ?)"#,
        params![
            Uuid::new_v4().to_string(),
            user_id,
            cred_id,
            public_key,
            chrono::Utc::now().to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub fn get_credential_by_id(
    conn: &Connection,
    credential_id: &[u8],
) -> Result<Option<StoredCredential>> {
    let row: Option<(String, Vec<u8>)> = conn
        .query_row(
            r#"SELECT user_id, public_key
               FROM passkey_credentials
               WHERE credential_id = ?"#,
            params![credential_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((user_id, pk_bytes)) = row else {
        return Ok(None);
    };
    let passkey: Passkey =
        serde_json::from_slice(&pk_bytes).context("deserialize stored passkey")?;
    Ok(Some(StoredCredential { user_id, passkey }))
}

pub fn update_passkey(conn: &Connection, credential_id: &[u8], passkey: &Passkey) -> Result<()> {
    let pk_bytes = serde_json::to_vec(passkey).context("serialize passkey")?;
    conn.execute(
        r#"UPDATE passkey_credentials
           SET public_key = ?, last_used_at = ?
           WHERE credential_id = ?"#,
        params![pk_bytes, chrono::Utc::now().to_rfc3339(), credential_id],
    )?;
    Ok(())
}
