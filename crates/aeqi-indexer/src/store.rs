//! Storage layer: SQLite via rusqlite.
//!
//! Schema migrations are additive-only. Each entity gets a numbered .sql file.
//! The migrator is idempotent: it tracks applied migration IDs in a meta table
//! and re-runs only what's new.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::Path;

/// All schema migrations in order. Add new entries; never remove or reorder.
const MIGRATIONS: &[(&str, &str)] = &[
    (
        "001_meta",
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
        "#,
    ),
    (
        "002_committed_blocks",
        r#"
        -- Tracks which blocks the indexer has fully processed. Used for reorg
        -- detection: on every new block, the parent_hash must match the most
        -- recent committed block_hash.
        CREATE TABLE IF NOT EXISTS committed_blocks (
            block_number INTEGER PRIMARY KEY,
            block_hash TEXT NOT NULL,
            parent_hash TEXT NOT NULL,
            committed_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_committed_blocks_hash
          ON committed_blocks(block_hash);
        "#,
    ),
    (
        "003_accounts",
        r#"
        -- The Account fan-in primitive — every address that appears in any event
        -- gets a row here. Specialized tables (trusts, modules, etc.) FK to this.
        CREATE TABLE IF NOT EXISTS accounts (
            address TEXT PRIMARY KEY,
            first_seen_block INTEGER NOT NULL,
            first_seen_tx TEXT NOT NULL
        );
        "#,
    ),
    (
        "004_trusts",
        r#"
        -- A deployed TRUST contract. Created via Factory.Factory_TRUSTCreatedEvent.
        CREATE TABLE IF NOT EXISTS trusts (
            address TEXT PRIMARY KEY,
            trust_id TEXT NOT NULL UNIQUE,
            creator_address TEXT NOT NULL,
            template_id TEXT,
            ipfs_cid TEXT,
            signers_count INTEGER,
            value_configs_count INTEGER,
            created_block INTEGER NOT NULL,
            created_tx TEXT NOT NULL,
            FOREIGN KEY (creator_address) REFERENCES accounts(address),
            FOREIGN KEY (address) REFERENCES accounts(address)
        );
        CREATE INDEX IF NOT EXISTS idx_trusts_creator ON trusts(creator_address);
        CREATE INDEX IF NOT EXISTS idx_trusts_template ON trusts(template_id);
        "#,
    ),
    (
        "005_trust_signers",
        r#"
        -- Authorized signers for a TRUST. Many-to-many (trust × signer).
        CREATE TABLE IF NOT EXISTS trust_signers (
            trust_address TEXT NOT NULL,
            signer_address TEXT NOT NULL,
            address_key TEXT NOT NULL,
            has_signed INTEGER NOT NULL DEFAULT 0,
            added_block INTEGER NOT NULL,
            added_tx TEXT NOT NULL,
            PRIMARY KEY (trust_address, signer_address),
            FOREIGN KEY (trust_address) REFERENCES trusts(address),
            FOREIGN KEY (signer_address) REFERENCES accounts(address)
        );
        "#,
    ),
    (
        "006_watched_addresses",
        r#"
        -- The dispatch source-of-truth for the poll loop. Each round selects
        -- every address here, builds a single Filter spanning all of them, and
        -- runs the topic0 handler on every returned log.
        -- Seeded by main with the factory address; handlers self-register
        -- new addresses (e.g. TrustCreated → register trust as 'trust',
        -- ModuleAdded → register module as 'module') so the next round picks
        -- them up automatically. This is how the indexer scales from 1 contract
        -- to N without recompile.
        CREATE TABLE IF NOT EXISTS watched_addresses (
            address TEXT PRIMARY KEY,
            kind TEXT NOT NULL,           -- 'factory' | 'trust' | 'module'
            registered_block INTEGER NOT NULL
        );
        "#,
    ),
    (
        "007_modules",
        r#"
        -- A module attached to a TRUST. Created via TRUST_ModuleAdded
        -- (bytes32 moduleId, address moduleAddress, uint256 moduleAcl) emitted
        -- by the TRUST contract itself (not Factory). The TRUST is the proxy
        -- and modules are pluggable behavior contracts attached to it.
        --
        -- module_acl is a uint256 bit-flag set; stored as hex (TEXT) since
        -- u256 doesn't fit in SQLite's 64-bit INTEGER reliably.
        CREATE TABLE IF NOT EXISTS modules (
            trust_address TEXT NOT NULL,
            module_id TEXT NOT NULL,
            module_address TEXT NOT NULL,
            module_acl TEXT NOT NULL,
            attached_block INTEGER NOT NULL,
            attached_tx TEXT NOT NULL,
            PRIMARY KEY (trust_address, module_id),
            FOREIGN KEY (trust_address) REFERENCES trusts(address)
        );
        CREATE INDEX IF NOT EXISTS idx_modules_module_address
          ON modules(module_address);
        "#,
    ),
    (
        "008_permissions_events",
        r#"
        -- Audit log of TRUST permissions changes. The TRUST emits three
        -- variants — Granted (set bits), Revoked (clear bits), Set (overwrite).
        -- We persist each as an event row; computing effective flags is the
        -- consumer's job (frontend / GraphQL aggregator). This is simpler
        -- than maintaining a derived "current flags" table that would need
        -- bitwise updates on every event.
        --
        -- entity_id is opaque to the indexer — it's a bytes32 hash that the
        -- TRUST resolves to an agent / role / arbitrary subject internally.
        CREATE TABLE IF NOT EXISTS permissions_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trust_address TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            kind TEXT NOT NULL,         -- 'granted' | 'revoked' | 'set'
            flags TEXT NOT NULL,        -- u256 hex
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            UNIQUE (trust_address, block_number, tx_hash, log_index),
            FOREIGN KEY (trust_address) REFERENCES trusts(address)
        );
        CREATE INDEX IF NOT EXISTS idx_perms_trust_entity
          ON permissions_events(trust_address, entity_id, block_number);
        "#,
    ),
    (
        "009_roles",
        r#"
        -- A role created on a Role module. The Role module is identified by
        -- module_address (which lives in modules.module_address with a TRUST
        -- backref). Created via Role_RoleCreated(roleId, creator).
        CREATE TABLE IF NOT EXISTS roles (
            module_address TEXT NOT NULL,
            role_id TEXT NOT NULL,
            creator_address TEXT NOT NULL,
            created_block INTEGER NOT NULL,
            created_tx TEXT NOT NULL,
            PRIMARY KEY (module_address, role_id)
        );
        CREATE INDEX IF NOT EXISTS idx_roles_creator ON roles(creator_address);
        "#,
    ),
    (
        "010_role_assignments",
        r#"
        -- An audit log of role assignments. Each row is one event:
        -- Role_RoleAssigned (kind='assigned'), Role_RoleResigned ('resigned'),
        -- Role_RoleRemoved ('removed'), Role_RoleTransferred ('transferred_to'
        -- + 'transferred_from' as two rows). UNIQUE on the log coord makes
        -- replay-safe.
        --
        -- account_address is the occupant for assigned/resigned/removed,
        -- and the new holder for 'transferred_to' (old holder for
        -- 'transferred_from').
        CREATE TABLE IF NOT EXISTS role_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_address TEXT NOT NULL,
            role_id TEXT NOT NULL,
            account_address TEXT NOT NULL,
            kind TEXT NOT NULL,
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            -- kind in the UNIQUE because Role_RoleTransferred produces TWO
            -- audit rows (transferred_from + transferred_to) for ONE log;
            -- they share the log_index so the kind discriminator is needed.
            UNIQUE (module_address, block_number, tx_hash, log_index, kind)
        );
        CREATE INDEX IF NOT EXISTS idx_role_assign_module_role
          ON role_assignments(module_address, role_id);
        CREATE INDEX IF NOT EXISTS idx_role_assign_account
          ON role_assignments(account_address);
        "#,
    ),
    (
        "011_proposals",
        r#"
        -- A governance proposal on a Governance module. Created via
        -- Governance_ProposalCreated. The dynamic-array fields
        -- (targets/values/signatures/calldatas) are NOT persisted in v1 —
        -- the ipfs_cid references the human-readable proposal body and the
        -- executable payload can be fetched on demand. v1 indexer surface
        -- focuses on proposal lifecycle visibility for the demo.
        --
        -- status transitions: 'created' → ('succeeded' | 'canceled') → 'executed'.
        -- Frontend should treat these as monotonic — Governance modules don't
        -- emit a "now back to created" event.
        CREATE TABLE IF NOT EXISTS proposals (
            module_address TEXT NOT NULL,
            proposal_id TEXT NOT NULL,
            governance_config_id TEXT NOT NULL,
            proposer_address TEXT NOT NULL,
            vote_start INTEGER NOT NULL,
            vote_end INTEGER NOT NULL,
            ipfs_cid TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'created',
            created_block INTEGER NOT NULL,
            created_tx TEXT NOT NULL,
            PRIMARY KEY (module_address, proposal_id)
        );
        CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON proposals(proposer_address);
        CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
        "#,
    ),
    (
        "012_votes",
        r#"
        -- A vote cast on a proposal via Governance_VoteCast. The 'support'
        -- field is OpenZeppelin Bravo convention: 0=Against, 1=For, 2=Abstain.
        -- weight is u256 hex (vote weight in token-decimal units).
        --
        -- One row per (proposal, voter, log_index) — same voter can re-vote
        -- via tx replay if the governor allows; UNIQUE on log coord prevents
        -- double-count from indexer reorg replay.
        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_address TEXT NOT NULL,
            proposal_id TEXT NOT NULL,
            voter_address TEXT NOT NULL,
            support INTEGER NOT NULL,
            weight TEXT NOT NULL,
            reason TEXT NOT NULL,
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            UNIQUE (module_address, block_number, tx_hash, log_index)
        );
        CREATE INDEX IF NOT EXISTS idx_votes_proposal
          ON votes(module_address, proposal_id);
        CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter_address);
        "#,
    ),
    (
        "013_token_balances",
        r#"
        -- Per-(token, holder) balance, mutated on every Transfer event.
        -- Token modules in AEQI are ERC20s — one module = one token —
        -- so token_address is the module address.
        --
        -- balance is stored as u256 hex (TEXT). u256 doesn't fit in
        -- SQLite's 64-bit INTEGER, and arithmetic is done in alloy U256
        -- before the write. Mint = Transfer(from=0x0,to,value),
        -- burn = Transfer(from,to=0x0,value); both update only the
        -- non-zero side.
        CREATE TABLE IF NOT EXISTS token_balances (
            token_address TEXT NOT NULL,
            holder_address TEXT NOT NULL,
            balance TEXT NOT NULL DEFAULT '0x0',
            last_updated_block INTEGER NOT NULL,
            PRIMARY KEY (token_address, holder_address)
        );
        CREATE INDEX IF NOT EXISTS idx_token_balances_holder
          ON token_balances(holder_address);
        "#,
    ),
    (
        "014_token_transfers",
        r#"
        -- Append-only audit log of every Transfer event. UNIQUE on log coord
        -- makes replay-safe. value is u256 hex.
        --
        -- Per-token cap-table view = SELECT holder_address, balance
        --   FROM token_balances WHERE token_address = ? ORDER BY balance DESC.
        -- Per-holder portfolio view = SELECT token_address, balance
        --   FROM token_balances WHERE holder_address = ?.
        CREATE TABLE IF NOT EXISTS token_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_address TEXT NOT NULL,
            from_address TEXT NOT NULL,
            to_address TEXT NOT NULL,
            value TEXT NOT NULL,
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            UNIQUE (token_address, block_number, tx_hash, log_index)
        );
        CREATE INDEX IF NOT EXISTS idx_token_transfers_token
          ON token_transfers(token_address, block_number);
        CREATE INDEX IF NOT EXISTS idx_token_transfers_from
          ON token_transfers(from_address);
        CREATE INDEX IF NOT EXISTS idx_token_transfers_to
          ON token_transfers(to_address);
        "#,
    ),
    (
        "015_vesting_positions",
        r#"
        -- A vesting position on a Vesting module. Created via
        -- Vesting_VestingPositionCreated; status transitions:
        --   'created' → 'active' (Activated) → 'removed' (Removed)
        -- The event payload only carries the positionId; richer metadata
        -- (beneficiary role, asset, amount, cliff, duration) lives in
        -- contract storage and would need eth_call backfill — out of v1.
        CREATE TABLE IF NOT EXISTS vesting_positions (
            module_address TEXT NOT NULL,
            position_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'created',
            created_block INTEGER NOT NULL,
            created_tx TEXT NOT NULL,
            PRIMARY KEY (module_address, position_id)
        );
        CREATE INDEX IF NOT EXISTS idx_vesting_positions_status
          ON vesting_positions(module_address, status);
        "#,
    ),
    (
        "016_vesting_contributions",
        r#"
        -- Append-only audit log of contributions into a vesting position
        -- (Vesting_VestingPositionContributed). Funders deposit tokens that
        -- become claimable by the beneficiary over time.
        CREATE TABLE IF NOT EXISTS vesting_contributions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_address TEXT NOT NULL,
            position_id TEXT NOT NULL,
            from_address TEXT NOT NULL,
            amount TEXT NOT NULL,
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            UNIQUE (module_address, block_number, tx_hash, log_index)
        );
        CREATE INDEX IF NOT EXISTS idx_vesting_contrib_position
          ON vesting_contributions(module_address, position_id);
        "#,
    ),
    (
        "017_vesting_claims",
        r#"
        -- Append-only audit log of claims from a vesting position
        -- (Vesting_VestingClaimed). Beneficiary withdraws vested tokens.
        CREATE TABLE IF NOT EXISTS vesting_claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            module_address TEXT NOT NULL,
            position_id TEXT NOT NULL,
            asset_address TEXT NOT NULL,
            to_address TEXT NOT NULL,
            amount TEXT NOT NULL,
            block_number INTEGER NOT NULL,
            tx_hash TEXT NOT NULL,
            log_index INTEGER NOT NULL,
            UNIQUE (module_address, block_number, tx_hash, log_index)
        );
        CREATE INDEX IF NOT EXISTS idx_vesting_claims_position
          ON vesting_claims(module_address, position_id);
        CREATE INDEX IF NOT EXISTS idx_vesting_claims_to
          ON vesting_claims(to_address);
        "#,
    ),
    (
        "018_templates",
        r#"
        -- Templates registered on a Factory via Factory.replaceTemplate.
        -- Each Factory_TemplateReplaced event UPSERTs the row + bumps
        -- replace_count so the UI can tell "this template was edited 3
        -- times since launch".
        --
        -- factory_address join is implicit: log.address() at indexing time.
        -- Templates are scoped per-factory; the tuple (factory, template_id)
        -- is the identity.
        CREATE TABLE IF NOT EXISTS templates (
            factory_address TEXT NOT NULL,
            template_id TEXT NOT NULL,
            replace_count INTEGER NOT NULL DEFAULT 1,
            first_seen_block INTEGER NOT NULL,
            last_replaced_block INTEGER NOT NULL,
            last_replaced_tx TEXT NOT NULL,
            PRIMARY KEY (factory_address, template_id)
        );
        "#,
    ),
];

/// Open the SQLite database, applying any pending migrations.
pub fn open<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path).context("open sqlite")?;
    apply_migrations(&conn)?;
    Ok(conn)
}

/// Apply any migrations not yet recorded in `schema_migrations`.
fn apply_migrations(conn: &Connection) -> Result<()> {
    // Always run the meta migration first (it's idempotent — IF NOT EXISTS).
    for (id, sql) in MIGRATIONS {
        if id == &"001_meta" {
            conn.execute_batch(sql)
                .with_context(|| format!("apply migration {}", id))?;
        }
    }

    for (id, sql) in MIGRATIONS {
        let already: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if already > 0 {
            continue;
        }
        conn.execute_batch(sql)
            .with_context(|| format!("apply migration {}", id))?;
        conn.execute(
            "INSERT INTO schema_migrations (id, applied_at) VALUES (?1, ?2)",
            params![
                id,
                chrono::Utc::now().timestamp()
            ],
        )?;
        tracing::info!("applied migration: {}", id);
    }
    Ok(())
}

/// Insert a new TRUST row + the corresponding accounts entries.
/// Idempotent: re-applying the same TRUST creation is a no-op.
pub fn insert_trust_created(
    conn: &Connection,
    trust_address: &str,
    trust_id: &str,
    creator_address: &str,
    block_number: u64,
    tx_hash: &str,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Upsert accounts
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx) VALUES (?1, ?2, ?3)",
        params![trust_address, block_number as i64, tx_hash],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx) VALUES (?1, ?2, ?3)",
        params![creator_address, block_number as i64, tx_hash],
    )?;

    // Upsert trust (no-op if address already present)
    tx.execute(
        "INSERT OR IGNORE INTO trusts (address, trust_id, creator_address, created_block, created_tx) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![trust_address, trust_id, creator_address, block_number as i64, tx_hash],
    )?;

    // Auto-subscribe: every newly indexed TRUST is added to watched_addresses,
    // so the next poll round catches its module/role/governance events.
    tx.execute(
        "INSERT OR IGNORE INTO watched_addresses (address, kind, registered_block)
         VALUES (?1, 'trust', ?2)",
        params![trust_address, block_number as i64],
    )?;

    tx.commit()?;
    Ok(())
}

/// Enrich an existing TRUST row with registration metadata
/// (template_id, ipfs_cid, signers_count, value_configs_count).
/// Created via Factory.Factory_TRUSTRegisteredEvent which fires
/// AFTER Factory_TRUSTCreatedEvent in the same transaction.
/// Idempotent: updating with the same values is a no-op.
pub fn update_trust_registered(
    conn: &Connection,
    trust_id: &str,
    template_id: &str,
    ipfs_cid: &str,
    signers_count: u64,
    value_configs_count: u64,
) -> Result<()> {
    conn.execute(
        "UPDATE trusts SET template_id = ?1, ipfs_cid = ?2,
                signers_count = ?3, value_configs_count = ?4
         WHERE trust_id = ?5",
        params![
            template_id,
            ipfs_cid,
            signers_count as i64,
            value_configs_count as i64,
            trust_id
        ],
    )?;
    Ok(())
}

/// Insert a signer authorization for a TRUST.
/// Resolves trust_address from trust_id; no-op if the trust isn't yet known
/// (the corresponding TrustCreated event must already be indexed).
pub fn insert_trust_signer(
    conn: &Connection,
    trust_id: &str,
    address_key: &str,
    signer_address: &str,
    has_signed: bool,
    block_number: u64,
    tx_hash: &str,
) -> Result<()> {
    let trust_address: Option<String> = conn
        .query_row(
            "SELECT address FROM trusts WHERE trust_id = ?1",
            params![trust_id],
            |r| r.get(0),
        )
        .ok();
    let Some(trust_address) = trust_address else {
        tracing::warn!(
            "TRUSTSignerAdded for unknown trust_id {} — skipping (TrustCreated not yet indexed)",
            trust_id
        );
        return Ok(());
    };

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx) VALUES (?1, ?2, ?3)",
        params![signer_address, block_number as i64, tx_hash],
    )?;
    tx.execute(
        "INSERT OR REPLACE INTO trust_signers
            (trust_address, signer_address, address_key, has_signed, added_block, added_tx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            trust_address,
            signer_address,
            address_key,
            has_signed as i64,
            block_number as i64,
            tx_hash
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct SignerRow {
    pub trust_address: String,
    pub signer_address: String,
    pub address_key: String,
    pub has_signed: bool,
    pub added_block: u64,
    pub added_tx: String,
}

/// Fetch all signers authorized on a TRUST.
pub fn get_trust_signers(conn: &Connection, trust_address: &str) -> Result<Vec<SignerRow>> {
    let mut stmt = conn.prepare(
        "SELECT trust_address, signer_address, address_key, has_signed, added_block, added_tx
         FROM trust_signers WHERE trust_address = ?1
         ORDER BY added_block ASC",
    )?;
    let rows = stmt
        .query_map(params![trust_address], |r| {
            Ok(SignerRow {
                trust_address: r.get(0)?,
                signer_address: r.get(1)?,
                address_key: r.get(2)?,
                has_signed: r.get::<_, i64>(3)? != 0,
                added_block: r.get::<_, i64>(4)? as u64,
                added_tx: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Register a contract address to be watched on subsequent poll rounds.
/// Idempotent: re-registering the same address is a no-op (kind is preserved
/// from the first registration, since the first-seen provenance is what
/// matters for the dispatch routing).
pub fn register_watched_address(
    conn: &Connection,
    address: &str,
    kind: &str,
    registered_block: u64,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO watched_addresses (address, kind, registered_block)
         VALUES (?1, ?2, ?3)",
        params![address, kind, registered_block as i64],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct WatchedAddress {
    pub address: String,
    pub kind: String,
    pub registered_block: u64,
}

/// Fetch all watched addresses. Used by the poll loop each round to build
/// the multi-address log filter.
pub fn list_watched_addresses(conn: &Connection) -> Result<Vec<WatchedAddress>> {
    let mut stmt = conn.prepare(
        "SELECT address, kind, registered_block FROM watched_addresses
         ORDER BY registered_block ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(WatchedAddress {
                address: r.get(0)?,
                kind: r.get(1)?,
                registered_block: r.get::<_, i64>(2)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a module attached to a TRUST. Created via TRUST_ModuleAdded.
/// Idempotent on (trust_address, module_id). module_acl is the uint256 bit
/// flags formatted as hex string (e.g. "0x...").
pub fn insert_module(
    conn: &Connection,
    trust_address: &str,
    module_id: &str,
    module_address: &str,
    module_acl: &str,
    attached_block: u64,
    attached_tx: &str,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![module_address, attached_block as i64, attached_tx],
    )?;
    tx.execute(
        "INSERT OR REPLACE INTO modules
            (trust_address, module_id, module_address, module_acl, attached_block, attached_tx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            trust_address,
            module_id,
            module_address,
            module_acl,
            attached_block as i64,
            attached_tx
        ],
    )?;
    // Auto-subscribe the module address so its own events get caught.
    tx.execute(
        "INSERT OR IGNORE INTO watched_addresses (address, kind, registered_block)
         VALUES (?1, 'module', ?2)",
        params![module_address, attached_block as i64],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ModuleRow {
    pub trust_address: String,
    pub module_id: String,
    pub module_address: String,
    pub module_acl: String,
    pub attached_block: u64,
    pub attached_tx: String,
}

/// Fetch all modules attached to a TRUST.
pub fn get_modules_for_trust(conn: &Connection, trust_address: &str) -> Result<Vec<ModuleRow>> {
    let mut stmt = conn.prepare(
        "SELECT trust_address, module_id, module_address, module_acl,
                attached_block, attached_tx
         FROM modules WHERE trust_address = ?1
         ORDER BY attached_block ASC",
    )?;
    let rows = stmt
        .query_map(params![trust_address], |r| {
            Ok(ModuleRow {
                trust_address: r.get(0)?,
                module_id: r.get(1)?,
                module_address: r.get(2)?,
                module_acl: r.get(3)?,
                attached_block: r.get::<_, i64>(4)? as u64,
                attached_tx: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Identifying coordinates for a single emitted log — block + tx + log index.
/// Used as the idempotency key when persisting per-event audit rows.
#[derive(Debug, Clone, Copy)]
pub struct LogCoord<'a> {
    pub block_number: u64,
    pub tx_hash: &'a str,
    pub log_index: u64,
}

/// Insert a row in the permissions audit log. UNIQUE on
/// (trust_address, block_number, tx_hash, log_index) makes this idempotent
/// across reorg-recovery replays.
pub fn insert_permissions_event(
    conn: &Connection,
    trust_address: &str,
    entity_id: &str,
    kind: &str,
    flags: &str,
    coord: LogCoord<'_>,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO permissions_events
            (trust_address, entity_id, kind, flags, block_number, tx_hash, log_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            trust_address,
            entity_id,
            kind,
            flags,
            coord.block_number as i64,
            coord.tx_hash,
            coord.log_index as i64
        ],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct PermissionsEventRow {
    pub trust_address: String,
    pub entity_id: String,
    pub kind: String,
    pub flags: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// Audit log of permissions events for an entity within a TRUST, oldest first.
pub fn get_permissions_events(
    conn: &Connection,
    trust_address: &str,
    entity_id: &str,
) -> Result<Vec<PermissionsEventRow>> {
    let mut stmt = conn.prepare(
        "SELECT trust_address, entity_id, kind, flags, block_number, tx_hash, log_index
         FROM permissions_events
         WHERE trust_address = ?1 AND entity_id = ?2
         ORDER BY block_number ASC, log_index ASC",
    )?;
    let rows = stmt
        .query_map(params![trust_address, entity_id], |r| {
            Ok(PermissionsEventRow {
                trust_address: r.get(0)?,
                entity_id: r.get(1)?,
                kind: r.get(2)?,
                flags: r.get(3)?,
                block_number: r.get::<_, i64>(4)? as u64,
                tx_hash: r.get(5)?,
                log_index: r.get::<_, i64>(6)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a role created by Role_RoleCreated. Idempotent on (module, role_id).
pub fn insert_role_created(
    conn: &Connection,
    module_address: &str,
    role_id: &str,
    creator_address: &str,
    created_block: u64,
    created_tx: &str,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![creator_address, created_block as i64, created_tx],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO roles
            (module_address, role_id, creator_address, created_block, created_tx)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            module_address,
            role_id,
            creator_address,
            created_block as i64,
            created_tx
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct RoleRow {
    pub module_address: String,
    pub role_id: String,
    pub creator_address: String,
    pub created_block: u64,
    pub created_tx: String,
}

/// All roles defined on a Role module, oldest first.
pub fn get_roles_for_module(conn: &Connection, module_address: &str) -> Result<Vec<RoleRow>> {
    let mut stmt = conn.prepare(
        "SELECT module_address, role_id, creator_address, created_block, created_tx
         FROM roles WHERE module_address = ?1
         ORDER BY created_block ASC",
    )?;
    let rows = stmt
        .query_map(params![module_address], |r| {
            Ok(RoleRow {
                module_address: r.get(0)?,
                role_id: r.get(1)?,
                creator_address: r.get(2)?,
                created_block: r.get::<_, i64>(3)? as u64,
                created_tx: r.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a role assignment audit-log row. UNIQUE (module, block, tx, log_index)
/// makes this replay-safe.
pub fn insert_role_assignment(
    conn: &Connection,
    module_address: &str,
    role_id: &str,
    account_address: &str,
    kind: &str,
    coord: LogCoord<'_>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![account_address, coord.block_number as i64, coord.tx_hash],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO role_assignments
            (module_address, role_id, account_address, kind, block_number, tx_hash, log_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            module_address,
            role_id,
            account_address,
            kind,
            coord.block_number as i64,
            coord.tx_hash,
            coord.log_index as i64
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct RoleAssignmentRow {
    pub module_address: String,
    pub role_id: String,
    pub account_address: String,
    pub kind: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// Audit log of role assignments for a (module, role), oldest first.
pub fn get_role_assignments(
    conn: &Connection,
    module_address: &str,
    role_id: &str,
) -> Result<Vec<RoleAssignmentRow>> {
    let mut stmt = conn.prepare(
        "SELECT module_address, role_id, account_address, kind,
                block_number, tx_hash, log_index
         FROM role_assignments
         WHERE module_address = ?1 AND role_id = ?2
         ORDER BY block_number ASC, log_index ASC",
    )?;
    let rows = stmt
        .query_map(params![module_address, role_id], |r| {
            Ok(RoleAssignmentRow {
                module_address: r.get(0)?,
                role_id: r.get(1)?,
                account_address: r.get(2)?,
                kind: r.get(3)?,
                block_number: r.get::<_, i64>(4)? as u64,
                tx_hash: r.get(5)?,
                log_index: r.get::<_, i64>(6)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a governance proposal (Governance_ProposalCreated).
/// Idempotent on (module, proposal_id).
#[allow(clippy::too_many_arguments)]
pub fn insert_proposal_created(
    conn: &Connection,
    module_address: &str,
    proposal_id: &str,
    governance_config_id: &str,
    proposer_address: &str,
    vote_start: u64,
    vote_end: u64,
    ipfs_cid: &str,
    created_block: u64,
    created_tx: &str,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![proposer_address, created_block as i64, created_tx],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO proposals
            (module_address, proposal_id, governance_config_id, proposer_address,
             vote_start, vote_end, ipfs_cid, status, created_block, created_tx)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'created', ?8, ?9)",
        params![
            module_address,
            proposal_id,
            governance_config_id,
            proposer_address,
            vote_start as i64,
            vote_end as i64,
            ipfs_cid,
            created_block as i64,
            created_tx
        ],
    )?;
    tx.commit()?;
    Ok(())
}

/// Update a proposal's status. Used by ProposalSucceeded / ProposalCanceled /
/// ProposalExecuted handlers. No-op if the proposal isn't yet indexed (the
/// ProposalCreated must land first; if it doesn't, the status update is lost
/// and re-indexing from genesis is the fix).
pub fn update_proposal_status(
    conn: &Connection,
    module_address: &str,
    proposal_id: &str,
    status: &str,
) -> Result<()> {
    let n = conn.execute(
        "UPDATE proposals SET status = ?1
         WHERE module_address = ?2 AND proposal_id = ?3",
        params![status, module_address, proposal_id],
    )?;
    if n == 0 {
        tracing::warn!(
            "proposal status update for unknown proposal: module={} proposal_id={} (ProposalCreated not indexed?)",
            module_address, proposal_id
        );
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ProposalRow {
    pub module_address: String,
    pub proposal_id: String,
    pub governance_config_id: String,
    pub proposer_address: String,
    pub vote_start: u64,
    pub vote_end: u64,
    pub ipfs_cid: String,
    pub status: String,
    pub created_block: u64,
    pub created_tx: String,
}

/// All proposals on a Governance module, newest first (most useful for UI).
pub fn get_proposals_for_module(
    conn: &Connection,
    module_address: &str,
) -> Result<Vec<ProposalRow>> {
    let mut stmt = conn.prepare(
        "SELECT module_address, proposal_id, governance_config_id, proposer_address,
                vote_start, vote_end, ipfs_cid, status, created_block, created_tx
         FROM proposals WHERE module_address = ?1
         ORDER BY created_block DESC",
    )?;
    let rows = stmt
        .query_map(params![module_address], |r| {
            Ok(ProposalRow {
                module_address: r.get(0)?,
                proposal_id: r.get(1)?,
                governance_config_id: r.get(2)?,
                proposer_address: r.get(3)?,
                vote_start: r.get::<_, i64>(4)? as u64,
                vote_end: r.get::<_, i64>(5)? as u64,
                ipfs_cid: r.get(6)?,
                status: r.get(7)?,
                created_block: r.get::<_, i64>(8)? as u64,
                created_tx: r.get(9)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a vote cast row. Idempotent on the log coord.
#[allow(clippy::too_many_arguments)]
pub fn insert_vote(
    conn: &Connection,
    module_address: &str,
    proposal_id: &str,
    voter_address: &str,
    support: u8,
    weight: &str,
    reason: &str,
    coord: LogCoord<'_>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![voter_address, coord.block_number as i64, coord.tx_hash],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO votes
            (module_address, proposal_id, voter_address, support, weight, reason,
             block_number, tx_hash, log_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            module_address,
            proposal_id,
            voter_address,
            support as i64,
            weight,
            reason,
            coord.block_number as i64,
            coord.tx_hash,
            coord.log_index as i64
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct VoteRow {
    pub module_address: String,
    pub proposal_id: String,
    pub voter_address: String,
    pub support: u8,
    pub weight: String,
    pub reason: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// All votes cast on a proposal, oldest first.
pub fn get_votes_for_proposal(
    conn: &Connection,
    module_address: &str,
    proposal_id: &str,
) -> Result<Vec<VoteRow>> {
    let mut stmt = conn.prepare(
        "SELECT module_address, proposal_id, voter_address, support, weight, reason,
                block_number, tx_hash, log_index
         FROM votes
         WHERE module_address = ?1 AND proposal_id = ?2
         ORDER BY block_number ASC, log_index ASC",
    )?;
    let rows = stmt
        .query_map(params![module_address, proposal_id], |r| {
            Ok(VoteRow {
                module_address: r.get(0)?,
                proposal_id: r.get(1)?,
                voter_address: r.get(2)?,
                support: r.get::<_, i64>(3)? as u8,
                weight: r.get(4)?,
                reason: r.get(5)?,
                block_number: r.get::<_, i64>(6)? as u64,
                tx_hash: r.get(7)?,
                log_index: r.get::<_, i64>(8)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// The canonical zero address — Transfer(from=0x0, ...) means mint;
/// Transfer(..., to=0x0) means burn. Both branches skip the zero-side update.
pub const ZERO_ADDRESS: &str = "0x0000000000000000000000000000000000000000";

/// Persist a Token Transfer event AND atomically update both balance rows.
/// Token modules in AEQI are ERC20s (one module = one token), so
/// `token_address` is the module address.
///
/// `value_hex` and `value` parallel each other — the caller has already
/// formatted both because we need the alloy U256 for arithmetic and the
/// hex string for the audit-log row + balance write-back.
#[allow(clippy::too_many_arguments)]
pub fn insert_token_transfer(
    conn: &Connection,
    token_address: &str,
    from_address: &str,
    to_address: &str,
    value_hex: &str,
    value: alloy::primitives::U256,
    coord: LogCoord<'_>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;

    // Account fan-in for both sides (zero address is a normal Account row;
    // we don't filter — easier query patterns and tiny extra storage).
    for addr in [from_address, to_address] {
        tx.execute(
            "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
             VALUES (?1, ?2, ?3)",
            params![addr, coord.block_number as i64, coord.tx_hash],
        )?;
    }

    // Audit log row (idempotent on log coord).
    let n = tx.execute(
        "INSERT OR IGNORE INTO token_transfers
            (token_address, from_address, to_address, value, block_number, tx_hash, log_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            token_address,
            from_address,
            to_address,
            value_hex,
            coord.block_number as i64,
            coord.tx_hash,
            coord.log_index as i64
        ],
    )?;
    if n == 0 {
        // Replay: row already exists. Don't double-update balances.
        tx.commit()?;
        return Ok(());
    }

    // Decrement sender (skip if mint).
    if from_address != ZERO_ADDRESS {
        let prev: String = tx
            .query_row(
                "SELECT balance FROM token_balances
                 WHERE token_address = ?1 AND holder_address = ?2",
                params![token_address, from_address],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "0x0".to_string());
        let prev_u: alloy::primitives::U256 =
            prev.parse().unwrap_or(alloy::primitives::U256::ZERO);
        let new_balance = prev_u.saturating_sub(value);
        tx.execute(
            "INSERT INTO token_balances (token_address, holder_address, balance, last_updated_block)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(token_address, holder_address) DO UPDATE SET
                balance = excluded.balance,
                last_updated_block = excluded.last_updated_block",
            params![
                token_address,
                from_address,
                format!("{:#x}", new_balance),
                coord.block_number as i64
            ],
        )?;
    }

    // Increment receiver (skip if burn).
    if to_address != ZERO_ADDRESS {
        let prev: String = tx
            .query_row(
                "SELECT balance FROM token_balances
                 WHERE token_address = ?1 AND holder_address = ?2",
                params![token_address, to_address],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "0x0".to_string());
        let prev_u: alloy::primitives::U256 =
            prev.parse().unwrap_or(alloy::primitives::U256::ZERO);
        let new_balance = prev_u.saturating_add(value);
        tx.execute(
            "INSERT INTO token_balances (token_address, holder_address, balance, last_updated_block)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(token_address, holder_address) DO UPDATE SET
                balance = excluded.balance,
                last_updated_block = excluded.last_updated_block",
            params![
                token_address,
                to_address,
                format!("{:#x}", new_balance),
                coord.block_number as i64
            ],
        )?;
    }

    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct TokenBalanceRow {
    pub token_address: String,
    pub holder_address: String,
    pub balance: String,
    pub last_updated_block: u64,
}

/// Cap-table view: all holders of a token, largest balance first.
/// Excludes the zero address (mint/burn pseudo-account) and zero-balance rows.
pub fn get_token_holders(conn: &Connection, token_address: &str) -> Result<Vec<TokenBalanceRow>> {
    let mut stmt = conn.prepare(
        "SELECT token_address, holder_address, balance, last_updated_block
         FROM token_balances
         WHERE token_address = ?1
           AND holder_address != ?2
           AND balance != '0x0'
         ORDER BY length(balance) DESC, balance DESC",
    )?;
    let rows = stmt
        .query_map(params![token_address, ZERO_ADDRESS], |r| {
            Ok(TokenBalanceRow {
                token_address: r.get(0)?,
                holder_address: r.get(1)?,
                balance: r.get(2)?,
                last_updated_block: r.get::<_, i64>(3)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone)]
pub struct TokenTransferRow {
    pub token_address: String,
    pub from_address: String,
    pub to_address: String,
    pub value: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// Audit log of all Transfer events for a token, oldest first.
pub fn get_token_transfers(
    conn: &Connection,
    token_address: &str,
) -> Result<Vec<TokenTransferRow>> {
    let mut stmt = conn.prepare(
        "SELECT token_address, from_address, to_address, value,
                block_number, tx_hash, log_index
         FROM token_transfers
         WHERE token_address = ?1
         ORDER BY block_number ASC, log_index ASC",
    )?;
    let rows = stmt
        .query_map(params![token_address], |r| {
            Ok(TokenTransferRow {
                token_address: r.get(0)?,
                from_address: r.get(1)?,
                to_address: r.get(2)?,
                value: r.get(3)?,
                block_number: r.get::<_, i64>(4)? as u64,
                tx_hash: r.get(5)?,
                log_index: r.get::<_, i64>(6)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a vesting position (Vesting_VestingPositionCreated).
/// Idempotent on (module, position_id).
pub fn insert_vesting_position(
    conn: &Connection,
    module_address: &str,
    position_id: &str,
    created_block: u64,
    created_tx: &str,
) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO vesting_positions
            (module_address, position_id, status, created_block, created_tx)
         VALUES (?1, ?2, 'created', ?3, ?4)",
        params![module_address, position_id, created_block as i64, created_tx],
    )?;
    Ok(())
}

/// Update vesting position status. Used by Activated / Removed handlers.
/// No-op + warn if position not yet indexed.
pub fn update_vesting_position_status(
    conn: &Connection,
    module_address: &str,
    position_id: &str,
    status: &str,
) -> Result<()> {
    let n = conn.execute(
        "UPDATE vesting_positions SET status = ?1
         WHERE module_address = ?2 AND position_id = ?3",
        params![status, module_address, position_id],
    )?;
    if n == 0 {
        tracing::warn!(
            "vesting position status update for unknown position: module={} position_id={}",
            module_address, position_id
        );
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct VestingPositionRow {
    pub module_address: String,
    pub position_id: String,
    pub status: String,
    pub created_block: u64,
    pub created_tx: String,
}

/// All vesting positions on a module, oldest first.
pub fn get_vesting_positions(
    conn: &Connection,
    module_address: &str,
) -> Result<Vec<VestingPositionRow>> {
    let mut stmt = conn.prepare(
        "SELECT module_address, position_id, status, created_block, created_tx
         FROM vesting_positions WHERE module_address = ?1
         ORDER BY created_block ASC",
    )?;
    let rows = stmt
        .query_map(params![module_address], |r| {
            Ok(VestingPositionRow {
                module_address: r.get(0)?,
                position_id: r.get(1)?,
                status: r.get(2)?,
                created_block: r.get::<_, i64>(3)? as u64,
                created_tx: r.get(4)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a vesting contribution audit row.
pub fn insert_vesting_contribution(
    conn: &Connection,
    module_address: &str,
    position_id: &str,
    from_address: &str,
    amount: &str,
    coord: LogCoord<'_>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![from_address, coord.block_number as i64, coord.tx_hash],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO vesting_contributions
            (module_address, position_id, from_address, amount,
             block_number, tx_hash, log_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            module_address,
            position_id,
            from_address,
            amount,
            coord.block_number as i64,
            coord.tx_hash,
            coord.log_index as i64
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct VestingContributionRow {
    pub module_address: String,
    pub position_id: String,
    pub from_address: String,
    pub amount: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// All contributions to a vesting position, oldest first.
pub fn get_vesting_contributions(
    conn: &Connection,
    module_address: &str,
    position_id: &str,
) -> Result<Vec<VestingContributionRow>> {
    let mut stmt = conn.prepare(
        "SELECT module_address, position_id, from_address, amount,
                block_number, tx_hash, log_index
         FROM vesting_contributions
         WHERE module_address = ?1 AND position_id = ?2
         ORDER BY block_number ASC, log_index ASC",
    )?;
    let rows = stmt
        .query_map(params![module_address, position_id], |r| {
            Ok(VestingContributionRow {
                module_address: r.get(0)?,
                position_id: r.get(1)?,
                from_address: r.get(2)?,
                amount: r.get(3)?,
                block_number: r.get::<_, i64>(4)? as u64,
                tx_hash: r.get(5)?,
                log_index: r.get::<_, i64>(6)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Insert a vesting claim audit row.
#[allow(clippy::too_many_arguments)]
pub fn insert_vesting_claim(
    conn: &Connection,
    module_address: &str,
    position_id: &str,
    asset_address: &str,
    to_address: &str,
    amount: &str,
    coord: LogCoord<'_>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR IGNORE INTO accounts (address, first_seen_block, first_seen_tx)
         VALUES (?1, ?2, ?3)",
        params![to_address, coord.block_number as i64, coord.tx_hash],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO vesting_claims
            (module_address, position_id, asset_address, to_address, amount,
             block_number, tx_hash, log_index)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            module_address,
            position_id,
            asset_address,
            to_address,
            amount,
            coord.block_number as i64,
            coord.tx_hash,
            coord.log_index as i64
        ],
    )?;
    tx.commit()?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct VestingClaimRow {
    pub module_address: String,
    pub position_id: String,
    pub asset_address: String,
    pub to_address: String,
    pub amount: String,
    pub block_number: u64,
    pub tx_hash: String,
    pub log_index: u64,
}

/// All claims from a vesting position, oldest first.
pub fn get_vesting_claims(
    conn: &Connection,
    module_address: &str,
    position_id: &str,
) -> Result<Vec<VestingClaimRow>> {
    let mut stmt = conn.prepare(
        "SELECT module_address, position_id, asset_address, to_address, amount,
                block_number, tx_hash, log_index
         FROM vesting_claims
         WHERE module_address = ?1 AND position_id = ?2
         ORDER BY block_number ASC, log_index ASC",
    )?;
    let rows = stmt
        .query_map(params![module_address, position_id], |r| {
            Ok(VestingClaimRow {
                module_address: r.get(0)?,
                position_id: r.get(1)?,
                asset_address: r.get(2)?,
                to_address: r.get(3)?,
                amount: r.get(4)?,
                block_number: r.get::<_, i64>(5)? as u64,
                tx_hash: r.get(6)?,
                log_index: r.get::<_, i64>(7)? as u64,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Record a Factory_TemplateReplaced event. Idempotent on
/// (factory_address, template_id); replace_count is incremented on
/// subsequent calls.
pub fn upsert_template(
    conn: &Connection,
    factory_address: &str,
    template_id: &str,
    block_number: u64,
    tx_hash: &str,
) -> Result<()> {
    conn.execute(
        "INSERT INTO templates
            (factory_address, template_id, replace_count,
             first_seen_block, last_replaced_block, last_replaced_tx)
         VALUES (?1, ?2, 1, ?3, ?3, ?4)
         ON CONFLICT(factory_address, template_id) DO UPDATE SET
            replace_count = replace_count + 1,
            last_replaced_block = excluded.last_replaced_block,
            last_replaced_tx = excluded.last_replaced_tx",
        params![factory_address, template_id, block_number as i64, tx_hash],
    )?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct TemplateRow {
    pub factory_address: String,
    pub template_id: String,
    pub replace_count: u64,
    pub first_seen_block: u64,
    pub last_replaced_block: u64,
    pub last_replaced_tx: String,
}

/// All templates registered on a Factory, oldest-first by first appearance.
pub fn get_templates_for_factory(
    conn: &Connection,
    factory_address: &str,
) -> Result<Vec<TemplateRow>> {
    let mut stmt = conn.prepare(
        "SELECT factory_address, template_id, replace_count,
                first_seen_block, last_replaced_block, last_replaced_tx
         FROM templates WHERE factory_address = ?1
         ORDER BY first_seen_block ASC",
    )?;
    let rows = stmt
        .query_map(params![factory_address], |r| {
            Ok(TemplateRow {
                factory_address: r.get(0)?,
                template_id: r.get(1)?,
                replace_count: r.get::<_, i64>(2)? as u64,
                first_seen_block: r.get::<_, i64>(3)? as u64,
                last_replaced_block: r.get::<_, i64>(4)? as u64,
                last_replaced_tx: r.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Look up a TRUST by its on-chain address.
pub fn get_trust(conn: &Connection, address: &str) -> Result<Option<TrustRow>> {
    let row = conn
        .query_row(
            "SELECT address, trust_id, creator_address, template_id, ipfs_cid,
                    signers_count, value_configs_count, created_block, created_tx
             FROM trusts WHERE address = ?1",
            params![address],
            |r| {
                Ok(TrustRow {
                    address: r.get(0)?,
                    trust_id: r.get(1)?,
                    creator_address: r.get(2)?,
                    template_id: r.get(3)?,
                    ipfs_cid: r.get(4)?,
                    signers_count: r.get(5)?,
                    value_configs_count: r.get(6)?,
                    created_block: r.get::<_, i64>(7)? as u64,
                    created_tx: r.get(8)?,
                })
            },
        )
        .ok();
    Ok(row)
}

#[derive(Debug, Clone)]
pub struct TrustRow {
    pub address: String,
    pub trust_id: String,
    pub creator_address: String,
    pub template_id: Option<String>,
    pub ipfs_cid: Option<String>,
    pub signers_count: Option<i64>,
    pub value_configs_count: Option<i64>,
    pub created_block: u64,
    pub created_tx: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn migrations_are_idempotent_and_applied_in_order() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("test.db");

        // First open: applies all migrations
        let conn1 = open(&path).expect("first open");
        let count1: i64 = conn1
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count1, MIGRATIONS.len() as i64);
        drop(conn1);

        // Second open: no-op (migrations already recorded)
        let conn2 = open(&path).expect("second open");
        let count2: i64 = conn2
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count2, MIGRATIONS.len() as i64);
    }

    #[test]
    fn update_trust_registered_enriches_existing_row() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc")
            .expect("create");
        update_trust_registered(
            &conn,
            trust_id,
            "0xtemplate0001",
            "QmIPFSCID",
            3,
            5,
        )
        .expect("register");

        let row = get_trust(&conn, trust_addr).expect("query").expect("row");
        assert_eq!(row.template_id.as_deref(), Some("0xtemplate0001"));
        assert_eq!(row.ipfs_cid.as_deref(), Some("QmIPFSCID"));
        assert_eq!(row.signers_count, Some(3));
        assert_eq!(row.value_configs_count, Some(5));
    }

    #[test]
    fn insert_trust_signer_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        let signer = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
        let address_key = "0x000000000000000000000000a0ee7a142d267c1f36714e4a8f75612f20a79720";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xtx1")
            .expect("create");
        insert_trust_signer(&conn, trust_id, address_key, signer, true, 43, "0xtx2")
            .expect("signer");

        let signers = get_trust_signers(&conn, trust_addr).expect("query");
        assert_eq!(signers.len(), 1);
        assert_eq!(signers[0].signer_address, signer);
        assert_eq!(signers[0].address_key, address_key);
        assert!(signers[0].has_signed);
    }

    #[test]
    fn insert_trust_signer_for_unknown_trust_skips_silently() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let unknown_trust_id =
            "0x0000000000000000000000000000000000000000000000000000000000000099";
        let signer = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";

        insert_trust_signer(&conn, unknown_trust_id, "0xkey", signer, true, 43, "0xtx")
            .expect("should not error");

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM trust_signers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn watched_addresses_register_and_list() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        register_watched_address(&conn, "0xfactory", "factory", 10).unwrap();
        register_watched_address(&conn, "0xtrust1", "trust", 20).unwrap();
        // Idempotent: re-register same address is a no-op
        register_watched_address(&conn, "0xtrust1", "trust", 20).unwrap();

        let watched = list_watched_addresses(&conn).unwrap();
        assert_eq!(watched.len(), 2);
        assert_eq!(watched[0].address, "0xfactory");
        assert_eq!(watched[0].kind, "factory");
        assert_eq!(watched[1].address, "0xtrust1");
        assert_eq!(watched[1].kind, "trust");
    }

    #[test]
    fn insert_trust_created_auto_subscribes() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc").unwrap();

        // The TRUST should now be in watched_addresses with kind='trust'
        let watched = list_watched_addresses(&conn).unwrap();
        let trust_watch = watched
            .iter()
            .find(|w| w.address == trust_addr)
            .expect("trust auto-registered");
        assert_eq!(trust_watch.kind, "trust");
        assert_eq!(trust_watch.registered_block, 42);
    }

    #[test]
    fn module_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        let module_id = "0x000000000000000000000000000000000000000000000000000000000000abcd";
        let module_addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let module_acl = "0x000000000000000000000000000000000000000000000000000000000000000f";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xtx1").unwrap();
        insert_module(&conn, trust_addr, module_id, module_addr, module_acl, 43, "0xtx2")
            .unwrap();

        let modules = get_modules_for_trust(&conn, trust_addr).unwrap();
        assert_eq!(modules.len(), 1);
        assert_eq!(modules[0].module_id, module_id);
        assert_eq!(modules[0].module_address, module_addr);
        assert_eq!(modules[0].module_acl, module_acl);
        assert_eq!(modules[0].attached_block, 43);

        // The module address is also auto-subscribed
        let watched = list_watched_addresses(&conn).unwrap();
        let module_watch = watched
            .iter()
            .find(|w| w.address == module_addr)
            .expect("module auto-watched");
        assert_eq!(module_watch.kind, "module");

        // Idempotent: re-insert same module is a no-op (still 1 row)
        insert_module(&conn, trust_addr, module_id, module_addr, module_acl, 43, "0xtx2")
            .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM modules", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn permissions_events_audit_log_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        let entity = "0x000000000000000000000000000000000000000000000000000000000000beef";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xtx0").unwrap();

        // Granted then Revoked then Set
        let c1 = LogCoord { block_number: 50, tx_hash: "0xtx1", log_index: 0 };
        let c2 = LogCoord { block_number: 51, tx_hash: "0xtx2", log_index: 0 };
        let c3 = LogCoord { block_number: 52, tx_hash: "0xtx3", log_index: 0 };
        insert_permissions_event(&conn, trust_addr, entity, "granted", "0x3", c1).unwrap();
        insert_permissions_event(&conn, trust_addr, entity, "revoked", "0x1", c2).unwrap();
        insert_permissions_event(&conn, trust_addr, entity, "set", "0xff", c3).unwrap();

        let events = get_permissions_events(&conn, trust_addr, entity).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].kind, "granted");
        assert_eq!(events[0].flags, "0x3");
        assert_eq!(events[1].kind, "revoked");
        assert_eq!(events[2].kind, "set");
        assert_eq!(events[2].flags, "0xff");

        // Idempotent: re-insert same event is a no-op
        insert_permissions_event(&conn, trust_addr, entity, "set", "0xff", c3).unwrap();
        let events = get_permissions_events(&conn, trust_addr, entity).unwrap();
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn role_creation_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let module_addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let role_id = "0x0000000000000000000000000000000000000000000000000000000000000aaa";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_role_created(&conn, module_addr, role_id, creator, 100, "0xtx").unwrap();
        let roles = get_roles_for_module(&conn, module_addr).unwrap();
        assert_eq!(roles.len(), 1);
        assert_eq!(roles[0].role_id, role_id);
        assert_eq!(roles[0].creator_address, creator);

        // Idempotent on (module, role_id)
        insert_role_created(&conn, module_addr, role_id, creator, 100, "0xtx").unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM roles", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn role_assignment_audit_log_with_transferred_split() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let module_addr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let role_id = "0x0000000000000000000000000000000000000000000000000000000000000aaa";
        let alice = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
        let bob = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

        // assigned to alice, then transferred to bob (two rows for one log)
        let c1 = LogCoord { block_number: 100, tx_hash: "0xtx1", log_index: 0 };
        let c2 = LogCoord { block_number: 101, tx_hash: "0xtx2", log_index: 0 };

        insert_role_assignment(&conn, module_addr, role_id, alice, "assigned", c1).unwrap();
        insert_role_assignment(&conn, module_addr, role_id, alice, "transferred_from", c2)
            .unwrap();
        insert_role_assignment(&conn, module_addr, role_id, bob, "transferred_to", c2).unwrap();

        let log = get_role_assignments(&conn, module_addr, role_id).unwrap();
        assert_eq!(log.len(), 3);
        assert_eq!(log[0].kind, "assigned");
        assert_eq!(log[1].kind, "transferred_from");
        assert_eq!(log[2].kind, "transferred_to");

        // Idempotent: re-insert same triple is no-op
        insert_role_assignment(&conn, module_addr, role_id, alice, "transferred_from", c2)
            .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM role_assignments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn proposal_lifecycle_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let module = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let proposal_id = "0x42";
        let proposer = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_proposal_created(
            &conn,
            module,
            proposal_id,
            "0xcfg",
            proposer,
            100,
            200,
            "QmCID",
            42,
            "0xtx",
        )
        .unwrap();

        let proposals = get_proposals_for_module(&conn, module).unwrap();
        assert_eq!(proposals.len(), 1);
        assert_eq!(proposals[0].status, "created");
        assert_eq!(proposals[0].vote_start, 100);
        assert_eq!(proposals[0].vote_end, 200);

        update_proposal_status(&conn, module, proposal_id, "succeeded").unwrap();
        let proposals = get_proposals_for_module(&conn, module).unwrap();
        assert_eq!(proposals[0].status, "succeeded");

        update_proposal_status(&conn, module, proposal_id, "executed").unwrap();
        let proposals = get_proposals_for_module(&conn, module).unwrap();
        assert_eq!(proposals[0].status, "executed");

        // Updating an unknown proposal is a no-op (logs a warning)
        update_proposal_status(&conn, module, "0xnonexistent", "executed").unwrap();
    }

    #[test]
    fn vote_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let module = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let proposal_id = "0x42";
        let alice = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
        let bob = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

        let c1 = LogCoord { block_number: 100, tx_hash: "0xtx1", log_index: 0 };
        let c2 = LogCoord { block_number: 101, tx_hash: "0xtx2", log_index: 0 };

        insert_vote(&conn, module, proposal_id, alice, 1, "0x64", "yes!", c1).unwrap();
        insert_vote(&conn, module, proposal_id, bob, 0, "0x32", "nope", c2).unwrap();

        let votes = get_votes_for_proposal(&conn, module, proposal_id).unwrap();
        assert_eq!(votes.len(), 2);
        assert_eq!(votes[0].voter_address, alice);
        assert_eq!(votes[0].support, 1);
        assert_eq!(votes[0].weight, "0x64");
        assert_eq!(votes[1].voter_address, bob);
        assert_eq!(votes[1].support, 0);

        // Idempotent: re-insert same coord drops
        insert_vote(&conn, module, proposal_id, alice, 1, "0x64", "yes!", c1).unwrap();
        let votes = get_votes_for_proposal(&conn, module, proposal_id).unwrap();
        assert_eq!(votes.len(), 2);
    }

    #[test]
    fn token_transfer_mint_then_transfer_then_burn() {
        use alloy::primitives::U256;
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let token = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let alice = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
        let bob = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

        // Mint 1000 to alice
        let v1000 = U256::from(1000u64);
        insert_token_transfer(
            &conn, token, ZERO_ADDRESS, alice, "0x3e8", v1000,
            LogCoord { block_number: 1, tx_hash: "0xtx1", log_index: 0 },
        ).unwrap();

        // Alice → Bob 300
        let v300 = U256::from(300u64);
        insert_token_transfer(
            &conn, token, alice, bob, "0x12c", v300,
            LogCoord { block_number: 2, tx_hash: "0xtx2", log_index: 0 },
        ).unwrap();

        // Burn 100 from bob
        let v100 = U256::from(100u64);
        insert_token_transfer(
            &conn, token, bob, ZERO_ADDRESS, "0x64", v100,
            LogCoord { block_number: 3, tx_hash: "0xtx3", log_index: 0 },
        ).unwrap();

        let holders = get_token_holders(&conn, token).unwrap();
        assert_eq!(holders.len(), 2, "should be 2 non-zero holders");
        // alice has 700, bob has 200
        let alice_row = holders.iter().find(|r| r.holder_address == alice).unwrap();
        let bob_row = holders.iter().find(|r| r.holder_address == bob).unwrap();
        assert_eq!(alice_row.balance, "0x2bc"); // 700
        assert_eq!(bob_row.balance, "0xc8");    // 200

        // Audit log has 3 transfers
        let transfers = get_token_transfers(&conn, token).unwrap();
        assert_eq!(transfers.len(), 3);
        assert_eq!(transfers[0].from_address, ZERO_ADDRESS);
        assert_eq!(transfers[2].to_address, ZERO_ADDRESS);

        // Replay protection: re-insert same transfer doesn't double-mutate balance
        insert_token_transfer(
            &conn, token, alice, bob, "0x12c", v300,
            LogCoord { block_number: 2, tx_hash: "0xtx2", log_index: 0 },
        ).unwrap();
        let alice_row = get_token_holders(&conn, token).unwrap()
            .into_iter().find(|r| r.holder_address == alice).unwrap();
        assert_eq!(alice_row.balance, "0x2bc"); // still 700
    }

    #[test]
    fn vesting_position_lifecycle_round_trip() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let module = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
        let pos = "0x0000000000000000000000000000000000000000000000000000000000000aaa";
        let funder = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
        let beneficiary = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720";
        let asset = "0x3Aa5ebB10DC797CAC828524e59A333d0A371443c";

        // Create → Activate → Contribute → Claim → Remove
        insert_vesting_position(&conn, module, pos, 100, "0xtx1").unwrap();
        let positions = get_vesting_positions(&conn, module).unwrap();
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[0].status, "created");

        update_vesting_position_status(&conn, module, pos, "active").unwrap();
        let positions = get_vesting_positions(&conn, module).unwrap();
        assert_eq!(positions[0].status, "active");

        let c1 = LogCoord { block_number: 110, tx_hash: "0xtx2", log_index: 0 };
        insert_vesting_contribution(&conn, module, pos, funder, "0x3e8", c1).unwrap();
        let contribs = get_vesting_contributions(&conn, module, pos).unwrap();
        assert_eq!(contribs.len(), 1);
        assert_eq!(contribs[0].from_address, funder);
        assert_eq!(contribs[0].amount, "0x3e8");

        let c2 = LogCoord { block_number: 200, tx_hash: "0xtx3", log_index: 0 };
        insert_vesting_claim(&conn, module, pos, asset, beneficiary, "0x12c", c2).unwrap();
        let claims = get_vesting_claims(&conn, module, pos).unwrap();
        assert_eq!(claims.len(), 1);
        assert_eq!(claims[0].to_address, beneficiary);
        assert_eq!(claims[0].asset_address, asset);
        assert_eq!(claims[0].amount, "0x12c");

        update_vesting_position_status(&conn, module, pos, "removed").unwrap();
        let positions = get_vesting_positions(&conn, module).unwrap();
        assert_eq!(positions[0].status, "removed");

        // Updating an unknown position is a no-op
        update_vesting_position_status(&conn, module, "0xnonexistent", "removed").unwrap();
    }

    #[test]
    fn template_upsert_increments_replace_count() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let factory = "0x67d269191c92Caf3cD7723F116c85e6E9bf55933";
        let template_id = "0x7a79b2e3cb9e64062fccc5f9b9a9c1a92244d4cf027fc63be451cfc4b9d9f6d0";

        upsert_template(&conn, factory, template_id, 100, "0xtx1").unwrap();
        let templates = get_templates_for_factory(&conn, factory).unwrap();
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].replace_count, 1);
        assert_eq!(templates[0].first_seen_block, 100);
        assert_eq!(templates[0].last_replaced_block, 100);

        // Re-replace bumps count + updates last_*
        upsert_template(&conn, factory, template_id, 200, "0xtx2").unwrap();
        let templates = get_templates_for_factory(&conn, factory).unwrap();
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].replace_count, 2);
        assert_eq!(templates[0].first_seen_block, 100, "first_seen unchanged");
        assert_eq!(templates[0].last_replaced_block, 200);
        assert_eq!(templates[0].last_replaced_tx, "0xtx2");
    }

    #[test]
    fn round_trip_trust_creation() {
        let dir = tempdir().unwrap();
        let conn = open(dir.path().join("test.db")).expect("open");

        let trust_addr = "0x9131b1DEC7d1fE791C599E9D0b94D6414cae0747";
        let trust_id = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc")
            .expect("insert");

        let row = get_trust(&conn, trust_addr)
            .expect("query")
            .expect("row exists");

        assert_eq!(row.address, trust_addr);
        assert_eq!(row.trust_id, trust_id);
        assert_eq!(row.creator_address, creator);
        assert_eq!(row.created_block, 42);

        // Idempotency: insert again, count stays the same
        insert_trust_created(&conn, trust_addr, trust_id, creator, 42, "0xabc")
            .expect("re-insert");

        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM trusts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }
}
