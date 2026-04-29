//! Wallet schema migrations. Mirrors the hand-rolled idempotent style used
//! elsewhere in aeqi-platform — `CREATE TABLE IF NOT EXISTS`, additive ALTERs,
//! safe to run on every boot. Both `aeqi-platform` (SaaS) and `aeqi-web`
//! (self-hosted) call `migrate(conn)` against their respective DBs at startup.

use rusqlite::Connection;

/// Apply all wallet-layer migrations idempotently. Safe to call repeatedly.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        -- Top-level user wallet table. Holds both runtime-provisioned
        -- (custodial) and user-supplied (external) wallets. SIWE login
        -- resolves through `address`; `user_id` is the canonical owner.
        CREATE TABLE IF NOT EXISTS user_wallets (
            id                            TEXT PRIMARY KEY,
            user_id                       TEXT NOT NULL,
            address                       TEXT NOT NULL UNIQUE,
            pubkey                        BLOB NOT NULL,
            custody_state                 TEXT NOT NULL CHECK (custody_state IN ('custodial','co_custody','self_custody')),
            is_primary                    INTEGER NOT NULL DEFAULT 0,
            provisioned_by                TEXT NOT NULL CHECK (provisioned_by IN ('runtime','user')),
            server_share_ciphertext       BLOB,
            server_share_kek_ciphertext   BLOB,
            kek_version                   INTEGER,
            client_share_commitment       BLOB,
            recovery_seed_revealed_at     TEXT,
            added_at                      TEXT NOT NULL,
            CHECK (
                (custody_state = 'self_custody'  AND server_share_ciphertext IS NULL)
                OR (custody_state IN ('custodial','co_custody') AND server_share_ciphertext IS NOT NULL)
            )
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_user_wallets_one_primary
            ON user_wallets(user_id) WHERE is_primary = 1;

        CREATE INDEX IF NOT EXISTS idx_user_wallets_user_id
            ON user_wallets(user_id);

        CREATE INDEX IF NOT EXISTS idx_user_wallets_address
            ON user_wallets(address);

        -- WebAuthn passkeys. A user may have many. Used as a second auth
        -- method AND as the seal for the client share of co-custody wallets.
        CREATE TABLE IF NOT EXISTS passkey_credentials (
            id                  TEXT PRIMARY KEY,
            user_id             TEXT NOT NULL,
            credential_id       BLOB NOT NULL UNIQUE,
            public_key          BLOB NOT NULL,
            sign_count          INTEGER NOT NULL DEFAULT 0,
            transports          TEXT,
            attestation_format  TEXT,
            prf_supported       INTEGER NOT NULL DEFAULT 0,
            added_at            TEXT NOT NULL,
            last_used_at        TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_passkey_credentials_user
            ON passkey_credentials(user_id);

        -- Session keys (delegated signing subkeys). User signs a delegation
        -- granting limited scope to a runtime-managed subkey; runtime can sign
        -- routine ops within that scope without re-prompting the user.
        CREATE TABLE IF NOT EXISTS session_keys (
            id                 TEXT PRIMARY KEY,
            parent_wallet_id   TEXT NOT NULL,
            subkey_pubkey      BLOB NOT NULL,
            scope_jsonb        TEXT NOT NULL,
            expires_at         TEXT NOT NULL,
            parent_signature   BLOB NOT NULL,
            created_at         TEXT NOT NULL,
            revoked_at         TEXT,
            FOREIGN KEY (parent_wallet_id) REFERENCES user_wallets(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_session_keys_parent_active
            ON session_keys(parent_wallet_id) WHERE revoked_at IS NULL;

        -- Append-only signing audit. Every signature operation gets a row;
        -- we never delete from this table.
        CREATE TABLE IF NOT EXISTS wallet_signing_audit (
            id                 TEXT PRIMARY KEY,
            wallet_id          TEXT NOT NULL,
            session_key_id     TEXT,
            payload_hash       BLOB NOT NULL,
            scope_match        TEXT NOT NULL,
            signed_at          TEXT NOT NULL,
            FOREIGN KEY (wallet_id) REFERENCES user_wallets(id) ON DELETE CASCADE,
            FOREIGN KEY (session_key_id) REFERENCES session_keys(id)
        );

        CREATE INDEX IF NOT EXISTS idx_wallet_signing_audit_wallet
            ON wallet_signing_audit(wallet_id);

        CREATE INDEX IF NOT EXISTS idx_wallet_signing_audit_signed_at
            ON wallet_signing_audit(signed_at);

        -- Agent wallets. Every agent (company / sub-agent / AI worker) gets
        -- exactly one wallet at creation time, parallel to user_wallets but
        -- without the multi-wallet / primary-swap concerns. Custody, signing,
        -- and recovery are otherwise identical.
        CREATE TABLE IF NOT EXISTS agent_wallets (
            id                            TEXT PRIMARY KEY,
            agent_id                      TEXT NOT NULL UNIQUE,
            address                       TEXT NOT NULL UNIQUE,
            pubkey                        BLOB NOT NULL,
            custody_state                 TEXT NOT NULL CHECK (custody_state IN ('custodial','co_custody','self_custody')),
            provisioned_by                TEXT NOT NULL CHECK (provisioned_by IN ('runtime','user')),
            server_share_ciphertext       BLOB,
            server_share_kek_ciphertext   BLOB,
            kek_version                   INTEGER,
            client_share_commitment       BLOB,
            recovery_seed_revealed_at     TEXT,
            added_at                      TEXT NOT NULL,
            CHECK (
                (custody_state = 'self_custody'  AND server_share_ciphertext IS NULL)
                OR (custody_state IN ('custodial','co_custody') AND server_share_ciphertext IS NOT NULL)
            )
        );

        CREATE INDEX IF NOT EXISTS idx_agent_wallets_address
            ON agent_wallets(address);
        "#,
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap(); // second run must succeed
        migrate(&conn).unwrap(); // third run must also succeed

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='user_wallets'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn one_primary_per_user_invariant() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        // First primary insert: ok
        conn.execute(
            "INSERT INTO user_wallets (id, user_id, address, pubkey, custody_state, is_primary, provisioned_by, server_share_ciphertext, added_at)
             VALUES (?, ?, ?, ?, 'custodial', 1, 'runtime', X'00', ?)",
            rusqlite::params![
                "w1", "u1", "0xaaaa", b"pk", "2026-01-01T00:00:00Z"
            ],
        )
        .unwrap();

        // Second primary for same user: must fail (partial unique index).
        let err = conn.execute(
            "INSERT INTO user_wallets (id, user_id, address, pubkey, custody_state, is_primary, provisioned_by, server_share_ciphertext, added_at)
             VALUES (?, ?, ?, ?, 'custodial', 1, 'runtime', X'00', ?)",
            rusqlite::params![
                "w2", "u1", "0xbbbb", b"pk", "2026-01-01T00:00:00Z"
            ],
        );
        assert!(err.is_err(), "expected unique constraint violation");

        // Non-primary for same user: ok.
        conn.execute(
            "INSERT INTO user_wallets (id, user_id, address, pubkey, custody_state, is_primary, provisioned_by, server_share_ciphertext, added_at)
             VALUES (?, ?, ?, ?, 'custodial', 0, 'runtime', X'00', ?)",
            rusqlite::params![
                "w3", "u1", "0xcccc", b"pk", "2026-01-01T00:00:00Z"
            ],
        )
        .unwrap();
    }

    #[test]
    fn self_custody_must_have_no_server_share() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();

        // self_custody with server share present: must fail (CHECK constraint).
        let err = conn.execute(
            "INSERT INTO user_wallets (id, user_id, address, pubkey, custody_state, is_primary, provisioned_by, server_share_ciphertext, added_at)
             VALUES (?, ?, ?, ?, 'self_custody', 0, 'user', X'01', ?)",
            rusqlite::params![
                "w1", "u1", "0xaaaa", b"pk", "2026-01-01T00:00:00Z"
            ],
        );
        assert!(err.is_err(), "expected CHECK violation");

        // self_custody with no server share: ok.
        conn.execute(
            "INSERT INTO user_wallets (id, user_id, address, pubkey, custody_state, is_primary, provisioned_by, server_share_ciphertext, added_at)
             VALUES (?, ?, ?, ?, 'self_custody', 0, 'user', NULL, ?)",
            rusqlite::params![
                "w2", "u2", "0xbbbb", b"pk", "2026-01-01T00:00:00Z"
            ],
        )
        .unwrap();

        // custodial with server share: ok.
        conn.execute(
            "INSERT INTO user_wallets (id, user_id, address, pubkey, custody_state, is_primary, provisioned_by, server_share_ciphertext, added_at)
             VALUES (?, ?, ?, ?, 'custodial', 0, 'runtime', X'01', ?)",
            rusqlite::params![
                "w3", "u3", "0xcccc", b"pk", "2026-01-01T00:00:00Z"
            ],
        )
        .unwrap();
    }
}
