//! `auth_methods` + `welcome_email_verifications` repository.
//!
//! Auth methods are many-to-one with companies: a single Company can have
//! a passkey + an email + a Google OAuth + a wallet SIWS auth, all
//! resolving to the same company_id. The `(kind, identity)` UNIQUE
//! constraint makes that pair the canonical lookup key — given a verified
//! email or a WebAuthn credential_id, find the Company.
//!
//! Email verifications hold short-lived magic-link tokens. The plaintext
//! token never lives on the server: it's hashed on insert, stored as
//! `token_hash`, and re-hashed on verify for comparison.

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};

use crate::store::repo::StoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthMethodKind {
    Email,
    Passkey,
    Google,
    WalletSiws,
}

impl AuthMethodKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Passkey => "passkey",
            Self::Google => "google",
            Self::WalletSiws => "wallet_siws",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "email" => Some(Self::Email),
            "passkey" => Some(Self::Passkey),
            "google" => Some(Self::Google),
            "wallet_siws" => Some(Self::WalletSiws),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StoredAuthMethod {
    pub id: String,
    pub company_id: String,
    pub kind: AuthMethodKind,
    pub identity: String,
    pub metadata_json: Option<String>,
    pub verified_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone)]
pub struct InsertAuthMethod {
    pub id: String,
    pub company_id: String,
    pub kind: AuthMethodKind,
    pub identity: String,
    pub metadata_json: Option<String>,
}

pub struct AuthMethodStore;

impl AuthMethodStore {
    pub fn insert(conn: &Connection, m: &InsertAuthMethod) -> Result<(), StoreError> {
        conn.execute(
            r#"INSERT INTO auth_methods
               (id, company_id, kind, identity, metadata_json, verified_at)
               VALUES (?, ?, ?, ?, ?, ?)"#,
            params![
                m.id,
                m.company_id,
                m.kind.as_str(),
                m.identity,
                m.metadata_json,
                Utc::now().to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Resolve `(kind, identity)` → Company. Returns `None` if no row matches
    /// (caller's signal to provision a new Company).
    pub fn lookup(
        conn: &Connection,
        kind: AuthMethodKind,
        identity: &str,
    ) -> Result<Option<StoredAuthMethod>, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, company_id, kind, identity, metadata_json,
                      verified_at, last_used_at
               FROM auth_methods
               WHERE kind = ? AND identity = ?"#,
        )?;
        let row = stmt
            .query_row(params![kind.as_str(), identity], row_to_auth_method)
            .optional()?
            .transpose()?;
        Ok(row)
    }

    pub fn list_for_company(
        conn: &Connection,
        company_id: &str,
    ) -> Result<Vec<StoredAuthMethod>, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, company_id, kind, identity, metadata_json,
                      verified_at, last_used_at
               FROM auth_methods WHERE company_id = ?
               ORDER BY verified_at"#,
        )?;
        let rows = stmt.query_map(params![company_id], row_to_auth_method)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r??);
        }
        Ok(out)
    }

    pub fn touch_last_used(conn: &Connection, id: &str) -> Result<(), StoreError> {
        conn.execute(
            "UPDATE auth_methods SET last_used_at = ? WHERE id = ?",
            params![Utc::now().to_rfc3339(), id],
        )?;
        Ok(())
    }
}

fn row_to_auth_method(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<Result<StoredAuthMethod, StoreError>> {
    let id: String = row.get(0)?;
    let company_id: String = row.get(1)?;
    let kind_s: String = row.get(2)?;
    let identity: String = row.get(3)?;
    let metadata_json: Option<String> = row.get(4)?;
    let verified_at_s: String = row.get(5)?;
    let last_used_at_s: Option<String> = row.get(6)?;

    Ok((|| -> Result<StoredAuthMethod, StoreError> {
        let kind =
            AuthMethodKind::parse(&kind_s).ok_or_else(|| StoreError::BadCustodyState(kind_s))?;
        let verified_at = DateTime::parse_from_rfc3339(&verified_at_s)
            .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
            .with_timezone(&Utc);
        let last_used_at = match last_used_at_s {
            Some(s) => Some(
                DateTime::parse_from_rfc3339(&s)
                    .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
                    .with_timezone(&Utc),
            ),
            None => None,
        };
        Ok(StoredAuthMethod {
            id,
            company_id,
            kind,
            identity,
            metadata_json,
            verified_at,
            last_used_at,
        })
    })())
}

// ── Email verifications ──────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct StoredEmailVerification {
    pub id: String,
    pub email_lower: String,
    pub token_hash: Vec<u8>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertEmailVerification {
    pub id: String,
    pub email_lower: String,
    pub token_hash: Vec<u8>,
    pub expires_at: DateTime<Utc>,
}

pub struct EmailVerificationStore;

impl EmailVerificationStore {
    pub fn insert(conn: &Connection, v: &InsertEmailVerification) -> Result<(), StoreError> {
        conn.execute(
            r#"INSERT INTO welcome_email_verifications
               (id, email_lower, token_hash, issued_at, expires_at)
               VALUES (?, ?, ?, ?, ?)"#,
            params![
                v.id,
                v.email_lower,
                v.token_hash,
                Utc::now().to_rfc3339(),
                v.expires_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    /// Look up by token hash. Returns `None` if not found (caller treats as
    /// invalid token). Does NOT enforce expiry — caller should compare
    /// `expires_at` to `Utc::now()` and reject if past.
    pub fn lookup_by_hash(
        conn: &Connection,
        token_hash: &[u8],
    ) -> Result<Option<StoredEmailVerification>, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, email_lower, token_hash, issued_at, expires_at
               FROM welcome_email_verifications WHERE token_hash = ?"#,
        )?;
        let row = stmt
            .query_row(params![token_hash], row_to_email_verification)
            .optional()?
            .transpose()?;
        Ok(row)
    }

    /// Consume (delete) a verification row by id. Called after successful
    /// verify to enforce single-use.
    pub fn consume(conn: &Connection, id: &str) -> Result<(), StoreError> {
        conn.execute("DELETE FROM welcome_email_verifications WHERE id = ?", params![id])?;
        Ok(())
    }

    /// Sweep expired rows. Cheap; safe to call on every verify.
    pub fn sweep_expired(conn: &Connection) -> Result<u64, StoreError> {
        let n = conn.execute(
            "DELETE FROM welcome_email_verifications WHERE expires_at < ?",
            params![Utc::now().to_rfc3339()],
        )?;
        Ok(n as u64)
    }
}

fn row_to_email_verification(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<Result<StoredEmailVerification, StoreError>> {
    let id: String = row.get(0)?;
    let email_lower: String = row.get(1)?;
    let token_hash: Vec<u8> = row.get(2)?;
    let issued_at_s: String = row.get(3)?;
    let expires_at_s: String = row.get(4)?;

    Ok((|| -> Result<StoredEmailVerification, StoreError> {
        let issued_at = DateTime::parse_from_rfc3339(&issued_at_s)
            .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
            .with_timezone(&Utc);
        let expires_at = DateTime::parse_from_rfc3339(&expires_at_s)
            .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
            .with_timezone(&Utc);
        Ok(StoredEmailVerification {
            id,
            email_lower,
            token_hash,
            issued_at,
            expires_at,
        })
    })())
}

// ── Wallet (SIWS) challenges ─────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct StoredWalletChallenge {
    pub id: String,
    pub pubkey_b58: String,
    pub nonce: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertWalletChallenge {
    pub id: String,
    pub pubkey_b58: String,
    pub nonce: String,
    pub expires_at: DateTime<Utc>,
}

pub struct WalletChallengeStore;

impl WalletChallengeStore {
    pub fn insert(conn: &Connection, c: &InsertWalletChallenge) -> Result<(), StoreError> {
        conn.execute(
            r#"INSERT INTO wallet_challenges
               (id, pubkey_b58, nonce, issued_at, expires_at)
               VALUES (?, ?, ?, ?, ?)"#,
            params![
                c.id,
                c.pubkey_b58,
                c.nonce,
                Utc::now().to_rfc3339(),
                c.expires_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn lookup_by_nonce(
        conn: &Connection,
        nonce: &str,
    ) -> Result<Option<StoredWalletChallenge>, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, pubkey_b58, nonce, issued_at, expires_at
               FROM wallet_challenges WHERE nonce = ?"#,
        )?;
        let row = stmt
            .query_row(params![nonce], row_to_wallet_challenge)
            .optional()?
            .transpose()?;
        Ok(row)
    }

    pub fn consume(conn: &Connection, id: &str) -> Result<(), StoreError> {
        conn.execute("DELETE FROM wallet_challenges WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn sweep_expired(conn: &Connection) -> Result<u64, StoreError> {
        let n = conn.execute(
            "DELETE FROM wallet_challenges WHERE expires_at < ?",
            params![Utc::now().to_rfc3339()],
        )?;
        Ok(n as u64)
    }
}

fn row_to_wallet_challenge(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<Result<StoredWalletChallenge, StoreError>> {
    let id: String = row.get(0)?;
    let pubkey_b58: String = row.get(1)?;
    let nonce: String = row.get(2)?;
    let issued_at_s: String = row.get(3)?;
    let expires_at_s: String = row.get(4)?;
    Ok((|| -> Result<StoredWalletChallenge, StoreError> {
        let issued_at = DateTime::parse_from_rfc3339(&issued_at_s)
            .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
            .with_timezone(&Utc);
        let expires_at = DateTime::parse_from_rfc3339(&expires_at_s)
            .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
            .with_timezone(&Utc);
        Ok(StoredWalletChallenge {
            id,
            pubkey_b58,
            nonce,
            issued_at,
            expires_at,
        })
    })())
}

// ── Passkey challenges ───────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PasskeyChallengeKind {
    Registration,
    Assertion,
}

impl PasskeyChallengeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Registration => "registration",
            Self::Assertion => "assertion",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "registration" => Some(Self::Registration),
            "assertion" => Some(Self::Assertion),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct StoredPasskeyChallenge {
    pub id: String,
    pub kind: PasskeyChallengeKind,
    pub state_json: String,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct InsertPasskeyChallenge {
    pub id: String,
    pub kind: PasskeyChallengeKind,
    pub state_json: String,
    pub expires_at: DateTime<Utc>,
}

pub struct PasskeyChallengeStore;

impl PasskeyChallengeStore {
    pub fn insert(conn: &Connection, c: &InsertPasskeyChallenge) -> Result<(), StoreError> {
        conn.execute(
            r#"INSERT INTO passkey_challenges
               (id, kind, state_json, issued_at, expires_at)
               VALUES (?, ?, ?, ?, ?)"#,
            params![
                c.id,
                c.kind.as_str(),
                c.state_json,
                Utc::now().to_rfc3339(),
                c.expires_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn lookup_by_id(
        conn: &Connection,
        id: &str,
    ) -> Result<Option<StoredPasskeyChallenge>, StoreError> {
        let mut stmt = conn.prepare(
            r#"SELECT id, kind, state_json, issued_at, expires_at
               FROM passkey_challenges WHERE id = ?"#,
        )?;
        let row = stmt
            .query_row(params![id], row_to_passkey_challenge)
            .optional()?
            .transpose()?;
        Ok(row)
    }

    pub fn consume(conn: &Connection, id: &str) -> Result<(), StoreError> {
        conn.execute("DELETE FROM passkey_challenges WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn sweep_expired(conn: &Connection) -> Result<u64, StoreError> {
        let n = conn.execute(
            "DELETE FROM passkey_challenges WHERE expires_at < ?",
            params![Utc::now().to_rfc3339()],
        )?;
        Ok(n as u64)
    }
}

fn row_to_passkey_challenge(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<Result<StoredPasskeyChallenge, StoreError>> {
    let id: String = row.get(0)?;
    let kind_s: String = row.get(1)?;
    let state_json: String = row.get(2)?;
    let issued_at_s: String = row.get(3)?;
    let expires_at_s: String = row.get(4)?;
    Ok((|| -> Result<StoredPasskeyChallenge, StoreError> {
        let kind = PasskeyChallengeKind::parse(&kind_s)
            .ok_or_else(|| StoreError::BadCustodyState(kind_s))?;
        let issued_at = DateTime::parse_from_rfc3339(&issued_at_s)
            .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
            .with_timezone(&Utc);
        let expires_at = DateTime::parse_from_rfc3339(&expires_at_s)
            .map_err(|e| StoreError::BadTimestamp(e.to_string()))?
            .with_timezone(&Utc);
        Ok(StoredPasskeyChallenge {
            id,
            kind,
            state_json,
            issued_at,
            expires_at,
        })
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::schema::migrate;
    use chrono::Duration;

    fn fresh_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn auth_method_insert_and_lookup() {
        let conn = fresh_db();
        AuthMethodStore::insert(
            &conn,
            &InsertAuthMethod {
                id: "auth-1".into(),
                company_id: "company-1".into(),
                kind: AuthMethodKind::Email,
                identity: "alice@example.com".into(),
                metadata_json: None,
            },
        )
        .unwrap();
        let found = AuthMethodStore::lookup(&conn, AuthMethodKind::Email, "alice@example.com")
            .unwrap()
            .expect("found");
        assert_eq!(found.company_id, "company-1");
        assert_eq!(found.kind, AuthMethodKind::Email);
    }

    #[test]
    fn auth_method_unique_kind_identity() {
        let conn = fresh_db();
        AuthMethodStore::insert(
            &conn,
            &InsertAuthMethod {
                id: "auth-1".into(),
                company_id: "company-1".into(),
                kind: AuthMethodKind::Email,
                identity: "alice@example.com".into(),
                metadata_json: None,
            },
        )
        .unwrap();
        let dup = AuthMethodStore::insert(
            &conn,
            &InsertAuthMethod {
                id: "auth-2".into(),
                company_id: "company-2".into(),
                kind: AuthMethodKind::Email,
                identity: "alice@example.com".into(),
                metadata_json: None,
            },
        );
        assert!(dup.is_err(), "should violate UNIQUE(kind, identity)");
    }

    #[test]
    fn auth_method_lookup_missing_returns_none() {
        let conn = fresh_db();
        let found =
            AuthMethodStore::lookup(&conn, AuthMethodKind::Email, "nobody@example.com").unwrap();
        assert!(found.is_none());
    }

    #[test]
    fn email_verification_roundtrip_and_consume() {
        let conn = fresh_db();
        let token_hash = vec![0xabu8; 32];
        EmailVerificationStore::insert(
            &conn,
            &InsertEmailVerification {
                id: "ev-1".into(),
                email_lower: "alice@example.com".into(),
                token_hash: token_hash.clone(),
                expires_at: Utc::now() + Duration::minutes(15),
            },
        )
        .unwrap();
        let found = EmailVerificationStore::lookup_by_hash(&conn, &token_hash)
            .unwrap()
            .expect("found");
        assert_eq!(found.email_lower, "alice@example.com");

        EmailVerificationStore::consume(&conn, &found.id).unwrap();
        let post = EmailVerificationStore::lookup_by_hash(&conn, &token_hash).unwrap();
        assert!(post.is_none(), "consume should delete");
    }

    #[test]
    fn wallet_challenge_roundtrip_and_consume() {
        let conn = fresh_db();
        WalletChallengeStore::insert(
            &conn,
            &InsertWalletChallenge {
                id: "wc-1".into(),
                pubkey_b58: "GsbwXfJraMomNxBcjkYBSnYoGGfyW3wQEQRRH4txk2GH".into(),
                nonce: "abc123nonce".into(),
                expires_at: Utc::now() + Duration::minutes(5),
            },
        )
        .unwrap();
        let found = WalletChallengeStore::lookup_by_nonce(&conn, "abc123nonce")
            .unwrap()
            .expect("found");
        assert_eq!(
            found.pubkey_b58,
            "GsbwXfJraMomNxBcjkYBSnYoGGfyW3wQEQRRH4txk2GH"
        );
        WalletChallengeStore::consume(&conn, &found.id).unwrap();
        let post = WalletChallengeStore::lookup_by_nonce(&conn, "abc123nonce").unwrap();
        assert!(post.is_none());
    }

    #[test]
    fn wallet_challenge_unique_nonce() {
        let conn = fresh_db();
        WalletChallengeStore::insert(
            &conn,
            &InsertWalletChallenge {
                id: "wc-1".into(),
                pubkey_b58: "AAA".into(),
                nonce: "shared-nonce".into(),
                expires_at: Utc::now() + Duration::minutes(5),
            },
        )
        .unwrap();
        let dup = WalletChallengeStore::insert(
            &conn,
            &InsertWalletChallenge {
                id: "wc-2".into(),
                pubkey_b58: "BBB".into(),
                nonce: "shared-nonce".into(),
                expires_at: Utc::now() + Duration::minutes(5),
            },
        );
        assert!(dup.is_err(), "should violate UNIQUE(nonce)");
    }

    #[test]
    fn passkey_challenge_roundtrip_and_consume() {
        let conn = fresh_db();
        PasskeyChallengeStore::insert(
            &conn,
            &InsertPasskeyChallenge {
                id: "pk-1".into(),
                kind: PasskeyChallengeKind::Registration,
                state_json: r#"{"fake":"state"}"#.into(),
                expires_at: Utc::now() + Duration::minutes(5),
            },
        )
        .unwrap();
        let found = PasskeyChallengeStore::lookup_by_id(&conn, "pk-1")
            .unwrap()
            .expect("found");
        assert_eq!(found.kind, PasskeyChallengeKind::Registration);
        assert_eq!(found.state_json, r#"{"fake":"state"}"#);
        PasskeyChallengeStore::consume(&conn, &found.id).unwrap();
        let post = PasskeyChallengeStore::lookup_by_id(&conn, "pk-1").unwrap();
        assert!(post.is_none());
    }

    #[test]
    fn email_verification_sweep_expired() {
        let conn = fresh_db();
        EmailVerificationStore::insert(
            &conn,
            &InsertEmailVerification {
                id: "ev-stale".into(),
                email_lower: "stale@example.com".into(),
                token_hash: vec![1u8; 32],
                expires_at: Utc::now() - Duration::minutes(1), // expired
            },
        )
        .unwrap();
        EmailVerificationStore::insert(
            &conn,
            &InsertEmailVerification {
                id: "ev-fresh".into(),
                email_lower: "fresh@example.com".into(),
                token_hash: vec![2u8; 32],
                expires_at: Utc::now() + Duration::minutes(15),
            },
        )
        .unwrap();

        let swept = EmailVerificationStore::sweep_expired(&conn).unwrap();
        assert_eq!(swept, 1);
        let stale = EmailVerificationStore::lookup_by_hash(&conn, &[1u8; 32]).unwrap();
        assert!(stale.is_none());
        let fresh = EmailVerificationStore::lookup_by_hash(&conn, &[2u8; 32]).unwrap();
        assert!(fresh.is_some());
    }
}
