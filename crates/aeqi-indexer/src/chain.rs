//! Chain interaction: alloy provider, block + log subscription, reorg tracking.
//!
//! Phase 1 deliverable. Connects to a JSON-RPC endpoint and polls for new
//! blocks, decoding Factory events into the SQLite store.

use anyhow::Result;
use rusqlite::{params, Connection};

/// Record a freshly committed block in `committed_blocks` and verify its
/// `parent_hash` matches the previously-committed block. Returns `Ok(true)`
/// if continuous, `Ok(false)` if a reorg/gap is detected.
pub fn commit_block(
    conn: &Connection,
    block_number: u64,
    block_hash: &str,
    parent_hash: &str,
) -> Result<bool> {
    let prev: Option<(i64, String)> = conn
        .query_row(
            "SELECT block_number, block_hash FROM committed_blocks
             ORDER BY block_number DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok();

    let continuous = match &prev {
        None => true,
        Some((prev_num, prev_hash)) => {
            *prev_num as u64 + 1 == block_number && prev_hash == parent_hash
        }
    };

    conn.execute(
        "INSERT OR REPLACE INTO committed_blocks
            (block_number, block_hash, parent_hash, committed_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            block_number as i64,
            block_hash,
            parent_hash,
            chrono::Utc::now().timestamp()
        ],
    )?;

    Ok(continuous)
}

/// Unwind committed blocks above `safe_block` — invoked on reorg detection.
pub fn unwind_above(conn: &Connection, safe_block: u64) -> Result<usize> {
    let n = conn.execute(
        "DELETE FROM committed_blocks WHERE block_number > ?1",
        params![safe_block as i64],
    )?;
    if n > 0 {
        tracing::warn!(
            "reorg unwind: removed {} committed_blocks above {}",
            n,
            safe_block
        );
    }
    Ok(n)
}

/// Look up the highest committed block_number, used as the resume point.
pub fn highest_committed(conn: &Connection) -> Result<Option<u64>> {
    let n: Option<i64> = conn
        .query_row(
            "SELECT MAX(block_number) FROM committed_blocks",
            [],
            |r| r.get(0),
        )
        .unwrap_or(None);
    Ok(n.map(|x| x as u64))
}

pub mod provider {
    use alloy::providers::{Provider, ProviderBuilder};
    use anyhow::{Context, Result};

    pub fn http_provider(rpc_url: &str) -> Result<impl Provider + Clone> {
        let url = rpc_url.parse().context("parse rpc url")?;
        Ok(ProviderBuilder::new().connect_http(url))
    }

    pub async fn latest_block(p: &impl Provider) -> Result<u64> {
        Ok(p.get_block_number().await?)
    }
}

pub mod poll {
    //! Poll-mode log fetcher. Walks blocks `from..=to`, fetches Factory logs,
    //! decodes via the `decode::Factory` sol! types, inserts TRUSTs into store,
    //! commits blocks (reorg-safe).

    use crate::{chain, decode, store};
    use alloy::primitives::Address;
    use alloy::providers::Provider;
    use alloy::rpc::types::{BlockNumberOrTag, Filter};
    use alloy::sol_types::SolEvent;
    use anyhow::{Context, Result};
    use rusqlite::Connection;
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::sync::Mutex;

    /// Configuration for the poll loop.
    ///
    /// The set of contract addresses to watch is NOT in this struct — it lives
    /// in the `watched_addresses` SQLite table and is re-read every round. To
    /// bootstrap the indexer with a factory address, write to
    /// `watched_addresses` before calling `run()`. Handlers self-register
    /// new addresses (TRUSTs, modules) as events flow.
    #[derive(Debug, Clone)]
    pub struct PollConfig {
        /// JSON-RPC endpoint (HTTP).
        pub rpc_url: String,
        /// First block to start indexing from (inclusive).
        pub start_block: u64,
        /// Confirmation depth — only commit blocks once `head - depth` ≥ block_number.
        pub confirmation_depth: u64,
        /// Sleep between catch-up rounds (typical: ~block time on the chain).
        pub poll_interval: Duration,
    }

    impl Default for PollConfig {
        fn default() -> Self {
            Self {
                rpc_url: "http://127.0.0.1:8545".into(),
                start_block: 0,
                confirmation_depth: 12,
                poll_interval: Duration::from_secs(2),
            }
        }
    }

    /// Persist a permissions event after the caller has decoded it. The 3
    /// variants share an on-wire shape (bytes32 indexed id, uint256 flags)
    /// but distinct topic0s — alloy's `decode_log` validates topic0, so each
    /// arm in the dispatcher decodes with its own type and then calls here.
    async fn persist_permissions_event(
        db: &Arc<Mutex<Connection>>,
        log: &alloy::rpc::types::Log,
        kind: &str,
        entity_id_hex: &str,
        flags_hex: &str,
        block_num: u64,
        tx_hash: &str,
    ) -> Result<()> {
        let trust_address = format!("{:#x}", log.address());
        let log_index = log.log_index.unwrap_or(0);
        let conn = db.lock().await;
        let coord = store::LogCoord {
            block_number: block_num,
            tx_hash,
            log_index,
        };
        store::insert_permissions_event(
            &conn,
            &trust_address,
            entity_id_hex,
            kind,
            flags_hex,
            coord,
        )?;
        tracing::info!(
            "indexed Permissions{}: trust={} entity={} flags={} block={}",
            capitalize(kind),
            trust_address,
            entity_id_hex,
            flags_hex,
            block_num
        );
        Ok(())
    }

    /// Persist a role assignment audit row for any of the Role_Role*
    /// account-event variants (Assigned, Resigned, Removed, Transferred).
    /// `kind` discriminates the variant; for Role_RoleTransferred the
    /// caller invokes this helper twice (transferred_from + transferred_to).
    async fn persist_role_assignment(
        db: &Arc<Mutex<Connection>>,
        log: &alloy::rpc::types::Log,
        role_id_hex: &str,
        account_hex: &str,
        kind: &str,
        block_num: u64,
        tx_hash: &str,
    ) -> Result<()> {
        let module_address = format!("{:#x}", log.address());
        let log_index = log.log_index.unwrap_or(0);
        let conn = db.lock().await;
        let coord = store::LogCoord {
            block_number: block_num,
            tx_hash,
            log_index,
        };
        store::insert_role_assignment(
            &conn,
            &module_address,
            role_id_hex,
            account_hex,
            kind,
            coord,
        )?;
        tracing::info!(
            "indexed Role_{}: module={} role={} account={} block={}",
            kind,
            module_address,
            role_id_hex,
            account_hex,
            block_num
        );
        Ok(())
    }

    /// Persist a Factory AdminsAdded or AdminsRemoved event. Both share the
    /// shape `(address[] admins)`; the array expands to one audit row per
    /// admin. Decoder is per-arm (alloy decode_log validates topic0).
    async fn persist_admin_event(
        db: &Arc<Mutex<Connection>>,
        log: &alloy::rpc::types::Log,
        kind: &str,
        block_num: u64,
        tx_hash: &str,
    ) -> Result<()> {
        let factory_address = format!("{:#x}", log.address());
        let log_index = log.log_index.unwrap_or(0);
        let admins: Vec<alloy::primitives::Address> = match kind {
            "added" => match decode::Factory::AdminsAdded::decode_log(&log.inner) {
                Ok(ev) => ev.admins.clone(),
                Err(e) => {
                    tracing::warn!(
                        "decode AdminsAdded failed at block {} tx {}: {}",
                        block_num, tx_hash, e
                    );
                    return Ok(());
                }
            },
            "removed" => match decode::Factory::AdminsRemoved::decode_log(&log.inner) {
                Ok(ev) => ev.admins.clone(),
                Err(e) => {
                    tracing::warn!(
                        "decode AdminsRemoved failed at block {} tx {}: {}",
                        block_num, tx_hash, e
                    );
                    return Ok(());
                }
            },
            _ => unreachable!("persist_admin_event called with kind={}", kind),
        };

        let conn = db.lock().await;
        let coord = store::LogCoord {
            block_number: block_num,
            tx_hash,
            log_index,
        };
        for admin in &admins {
            let admin_hex = format!("{:#x}", admin);
            store::insert_factory_admin_event(&conn, &factory_address, &admin_hex, kind, coord)?;
        }
        tracing::info!(
            "indexed Factory Admins{}: factory={} admins={} block={}",
            capitalize(kind),
            factory_address,
            admins.len(),
            block_num
        );
        Ok(())
    }

    /// Persist a proposal status update from any of the lifecycle events
    /// (Canceled, Succeeded, Executed). Each variant's decoder closure
    /// returns the proposal_id hex on success — the dispatcher passes it.
    async fn persist_proposal_status<F>(
        db: &Arc<Mutex<Connection>>,
        log: &alloy::rpc::types::Log,
        status: &str,
        decode_proposal_id: F,
        block_num: u64,
        tx_hash: &str,
    ) -> Result<()>
    where
        F: FnOnce(
            &alloy::primitives::Log,
        ) -> std::result::Result<String, alloy::sol_types::Error>,
    {
        let module_address = format!("{:#x}", log.address());
        match decode_proposal_id(&log.inner) {
            Ok(proposal_id_hex) => {
                let conn = db.lock().await;
                store::update_proposal_status(&conn, &module_address, &proposal_id_hex, status)?;
                tracing::info!(
                    "indexed Governance_Proposal{}: module={} proposal={} block={}",
                    capitalize(status),
                    module_address,
                    proposal_id_hex,
                    block_num
                );
            }
            Err(e) => tracing::warn!(
                "decode Governance_Proposal{} failed at block {} tx {}: {}",
                capitalize(status),
                block_num,
                tx_hash,
                e
            ),
        }
        Ok(())
    }

    fn capitalize(s: &str) -> String {
        let mut c = s.chars();
        match c.next() {
            None => String::new(),
            Some(first) => first.to_uppercase().chain(c).collect(),
        }
    }

    /// Spawn the poll loop. Runs until the provided cancellation signal fires
    /// or an unrecoverable error is hit.
    pub async fn run(cfg: PollConfig, db: Arc<Mutex<Connection>>) -> Result<()> {
        let provider = chain::provider::http_provider(&cfg.rpc_url)
            .context("connect provider")?;
        let initial_watched = {
            let conn = db.lock().await;
            store::list_watched_addresses(&conn)?
        };
        tracing::info!(
            "poll loop starting: rpc={} watched={} start_block={} depth={}",
            cfg.rpc_url,
            initial_watched.len(),
            cfg.start_block,
            cfg.confirmation_depth
        );

        loop {
            // Resume from highest_committed + 1, or start_block on cold start.
            let from = {
                let conn = db.lock().await;
                chain::highest_committed(&conn)?
                    .map(|h| h + 1)
                    .unwrap_or(cfg.start_block)
            };

            let head = provider.get_block_number().await?;
            // Don't process blocks that haven't reached confirmation depth.
            let safe_head = head.saturating_sub(cfg.confirmation_depth);
            if from > safe_head {
                tokio::time::sleep(cfg.poll_interval).await;
                continue;
            }

            let to = safe_head.min(from + 99); // Cap at 100 blocks per round
            tracing::debug!("poll round: blocks {}..={} (head={})", from, to, head);

            for block_num in from..=to {
                let blk = provider
                    .get_block_by_number(BlockNumberOrTag::Number(block_num))
                    .await
                    .with_context(|| format!("fetch block {}", block_num))?;

                let Some(blk) = blk else {
                    tracing::warn!("block {} returned None — skipping", block_num);
                    continue;
                };

                let block_hash = format!("{:#x}", blk.header.hash);
                let parent_hash = format!("{:#x}", blk.header.parent_hash);

                // Fetch logs from EVERY watched address. Factory + TRUSTs +
                // modules all flow through one filter. Topic0 dispatches to
                // the right handler — handlers may register more addresses
                // (TrustCreated → trust, ModuleAdded → module).
                //
                // CRITICAL: handlers may add new watched addresses MID-BLOCK.
                // E.g. a real registerTRUST tx auto-creates the TRUST proxy,
                // which initializes its modules in the SAME tx — TRUST_ModuleAdded
                // fires from the new trust address, but that address wasn't in
                // watched_addresses when we built this block's filter.
                //
                // Solution: fetch + dispatch in a loop. Each iteration pulls
                // logs only from the NEW addresses (delta vs already-fetched
                // for this block). Loop terminates when no new addresses were
                // registered. Bounded by gas (a tx can only create finitely
                // many contracts).
                let mut fetched_for_block: std::collections::HashSet<Address> =
                    std::collections::HashSet::new();
                loop {
                    let current_watched: Vec<Address> = {
                        let conn = db.lock().await;
                        store::list_watched_addresses(&conn)?
                            .into_iter()
                            .filter_map(|w| w.address.parse().ok())
                            .collect()
                    };
                    let new_addresses: Vec<Address> = current_watched
                        .into_iter()
                        .filter(|a| !fetched_for_block.contains(a))
                        .collect();
                    if new_addresses.is_empty() {
                        break;
                    }
                    for a in &new_addresses {
                        fetched_for_block.insert(*a);
                    }

                    let sigs = vec![
                        // Factory events
                        decode::Factory::Factory_TRUSTCreatedEvent::SIGNATURE_HASH,
                        decode::Factory::Factory_TRUSTRegisteredEvent::SIGNATURE_HASH,
                        decode::Factory::Factory_TRUSTSignerAdded::SIGNATURE_HASH,
                        decode::Factory::Factory_TRUSTApprovedEvent::SIGNATURE_HASH,
                        decode::Factory::Factory_TemplateReplaced::SIGNATURE_HASH,
                        decode::Factory::Factory_FactoryConfigSet::SIGNATURE_HASH,
                        decode::Factory::Factory_PartnerProfileSet::SIGNATURE_HASH,
                        decode::Factory::AdminsAdded::SIGNATURE_HASH,
                        decode::Factory::AdminsRemoved::SIGNATURE_HASH,
                        // TRUST events (per-trust)
                        decode::TRUST::TRUST_ModuleAdded::SIGNATURE_HASH,
                        decode::TRUST::PermissionsGranted::SIGNATURE_HASH,
                        decode::TRUST::PermissionsRevoked::SIGNATURE_HASH,
                        decode::TRUST::PermissionsSet::SIGNATURE_HASH,
                        // Role module events (per-module)
                        decode::Role::Role_RoleCreated::SIGNATURE_HASH,
                        decode::Role::Role_RoleAssigned::SIGNATURE_HASH,
                        decode::Role::Role_RoleResigned::SIGNATURE_HASH,
                        decode::Role::Role_RoleRemoved::SIGNATURE_HASH,
                        decode::Role::Role_RoleTransferred::SIGNATURE_HASH,
                        // Governance module events (per-module)
                        decode::Governance::Governance_ProposalCreated::SIGNATURE_HASH,
                        decode::Governance::Governance_ProposalCanceled::SIGNATURE_HASH,
                        decode::Governance::Governance_ProposalSucceeded::SIGNATURE_HASH,
                        decode::Governance::Governance_ProposalExecuted::SIGNATURE_HASH,
                        decode::Governance::Governance_VoteCast::SIGNATURE_HASH,
                        // Token module events (per-module / ERC20)
                        decode::Token::Transfer::SIGNATURE_HASH,
                        // Vesting module events (per-module)
                        decode::Vesting::Vesting_VestingPositionCreated::SIGNATURE_HASH,
                        decode::Vesting::Vesting_VestingPositionActivated::SIGNATURE_HASH,
                        decode::Vesting::Vesting_VestingPositionContributed::SIGNATURE_HASH,
                        decode::Vesting::Vesting_VestingClaimed::SIGNATURE_HASH,
                        decode::Vesting::Vesting_PositionRemoved::SIGNATURE_HASH,
                        // Funding module events (per-module)
                        decode::Funding::Funding_FundingCreated::SIGNATURE_HASH,
                        decode::Funding::Funding_FundingActivated::SIGNATURE_HASH,
                        decode::Funding::Funding_FinalizedFunding::SIGNATURE_HASH,
                        decode::Funding::Funding_FundingRemoved::SIGNATURE_HASH,
                        decode::Funding::Funding_ExitExecuted::SIGNATURE_HASH,
                        // Budget module events (per-module)
                        decode::Budget::Budget_BudgetCreated::SIGNATURE_HASH,
                        decode::Budget::Budget_BudgetFrozen::SIGNATURE_HASH,
                        decode::Budget::Budget_BudgetUnfrozen::SIGNATURE_HASH,
                        decode::Budget::Budget_BudgetRemoved::SIGNATURE_HASH,
                        decode::Budget::Budget_BudgetDeposited::SIGNATURE_HASH,
                        decode::Budget::Budget_BudgetConsumed::SIGNATURE_HASH,
                        // Fund module events (per-module)
                        decode::Fund::Fund_NavProcessed::SIGNATURE_HASH,
                        decode::Fund::Fund_FlowRequested::SIGNATURE_HASH,
                        decode::Fund::Fund_FlowClaimed::SIGNATURE_HASH,
                        decode::Fund::Fund_FlowCancelled::SIGNATURE_HASH,
                        decode::Fund::Fund_PositionOpened::SIGNATURE_HASH,
                        decode::Fund::Fund_PositionClosed::SIGNATURE_HASH,
                        decode::Fund::Fund_PositionInteracted::SIGNATURE_HASH,
                    ];
                    let filter = Filter::new()
                        .from_block(block_num)
                        .to_block(block_num)
                        .address(new_addresses)
                        .event_signature(sigs);

                    let mut logs = provider
                        .get_logs(&filter)
                        .await
                        .with_context(|| format!("get_logs block {}", block_num))?;

                    // 2-pass ordering: handlers that CREATE entities must run
                    // before handlers that REFERENCE them by their just-emitted
                    // ID. In real registerTRUST flows, the same tx emits
                    // SignerAdded → Registered → Created in that order — the
                    // first two handlers look up the trust by trust_id and find
                    // nothing because Created hasn't run yet. Sort logs so all
                    // -Created topic0s come first, then Registered, then the
                    // rest. Stable sort preserves natural log order within each
                    // priority bucket so log_index ties still resolve correctly.
                    fn topic0_priority(t: Option<alloy::primitives::B256>) -> u8 {
                        match t {
                            Some(h)
                                if h == decode::Factory::Factory_TRUSTCreatedEvent::SIGNATURE_HASH =>
                                0,
                            Some(h)
                                if h == decode::Factory::Factory_TRUSTRegisteredEvent::SIGNATURE_HASH =>
                                1,
                            // Module/Role/Token/Vesting/Governance "created" or
                            // "added" events that other handlers reference can
                            // be added here as we discover ordering bugs in
                            // real-tx flows. Default priority is 2 so anything
                            // not explicitly prioritized still runs after the
                            // critical creators.
                            _ => 2,
                        }
                    }
                    logs.sort_by_key(|l| topic0_priority(l.topic0().copied()));

                    for log in logs {
                        let tx_hash = log
                            .transaction_hash
                            .map(|h| format!("{:#x}", h))
                            .unwrap_or_default();
                        let topic0 = log.topic0().copied();

                        // Dispatch on topic0. Each branch decodes via its own
                        // sol! type, then writes to the store. Decode failures
                        // log a warning and continue (we still commit the block).
                        if topic0
                            == Some(decode::Factory::Factory_TRUSTCreatedEvent::SIGNATURE_HASH)
                        {
                            match decode::Factory::Factory_TRUSTCreatedEvent::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_trust_created(
                                        &conn,
                                        &format!("{:#x}", ev.trustAddress),
                                        &format!("{:#x}", ev.trustId),
                                        &format!("{:#x}", ev.creatorAddress),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Factory_TRUSTCreatedEvent: trust={:#x} creator={:#x} block={}",
                                        ev.trustAddress, ev.creatorAddress, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode TrustCreated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Factory::Factory_TRUSTRegisteredEvent::SIGNATURE_HASH)
                        {
                            match decode::Factory::Factory_TRUSTRegisteredEvent::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let cid = String::from_utf8_lossy(&ev.ipfsCid).to_string();
                                    store::update_trust_registered(
                                        &conn,
                                        &format!("{:#x}", ev.trustId),
                                        &format!("{:#x}", ev.templateId),
                                        &cid,
                                        ev.signersCount.try_into().unwrap_or(0),
                                        ev.valueConfigsCount.try_into().unwrap_or(0),
                                    )?;
                                    tracing::info!(
                                        "indexed Factory_TRUSTRegisteredEvent: trust_id={:#x} template={:#x} block={}",
                                        ev.trustId, ev.templateId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode TrustRegistered failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Factory::Factory_FactoryConfigSet::SIGNATURE_HASH)
                        {
                            let factory_address = format!("{:#x}", log.address());
                            match decode::Factory::Factory_FactoryConfigSet::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::upsert_factory_beacon(
                                        &conn,
                                        &factory_address,
                                        &format!("{:#x}", ev.beaconAddress),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Factory_FactoryConfigSet: factory={} beacon={:#x} block={}",
                                        factory_address, ev.beaconAddress, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Factory_FactoryConfigSet failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Factory::Factory_PartnerProfileSet::SIGNATURE_HASH)
                        {
                            let factory_address = format!("{:#x}", log.address());
                            match decode::Factory::Factory_PartnerProfileSet::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let cid = String::from_utf8_lossy(&ev.ipfsCid).to_string();
                                    store::upsert_factory_partner(
                                        &conn,
                                        &factory_address,
                                        &cid,
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Factory_PartnerProfileSet: factory={} cid={} block={}",
                                        factory_address, cid, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Factory_PartnerProfileSet failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0 == Some(decode::Factory::AdminsAdded::SIGNATURE_HASH) {
                            persist_admin_event(&db, &log, "added", block_num, &tx_hash).await?;
                        } else if topic0
                            == Some(decode::Factory::AdminsRemoved::SIGNATURE_HASH)
                        {
                            persist_admin_event(&db, &log, "removed", block_num, &tx_hash).await?;
                        } else if topic0
                            == Some(decode::Factory::Factory_TemplateReplaced::SIGNATURE_HASH)
                        {
                            // Template events come from the Factory address itself.
                            let factory_address = format!("{:#x}", log.address());
                            match decode::Factory::Factory_TemplateReplaced::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::upsert_template(
                                        &conn,
                                        &factory_address,
                                        &format!("{:#x}", ev.templateId),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Factory_TemplateReplaced: factory={} template={:#x} block={}",
                                        factory_address, ev.templateId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Factory_TemplateReplaced failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Factory::Factory_TRUSTApprovedEvent::SIGNATURE_HASH)
                        {
                            match decode::Factory::Factory_TRUSTApprovedEvent::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::mark_trust_signer_signed(
                                        &conn,
                                        &format!("{:#x}", ev.trustId),
                                        &format!("{:#x}", ev.signerAddress),
                                    )?;
                                    tracing::info!(
                                        "indexed Factory_TRUSTApprovedEvent: trust_id={:#x} signer={:#x} approvedFlag={} block={}",
                                        ev.trustId, ev.signerAddress, ev.isTRUSTApproved, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Factory_TRUSTApprovedEvent failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Factory::Factory_TRUSTSignerAdded::SIGNATURE_HASH)
                        {
                            match decode::Factory::Factory_TRUSTSignerAdded::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_trust_signer(
                                        &conn,
                                        &format!("{:#x}", ev.trustId),
                                        &format!("{:#x}", ev.addressKey),
                                        &format!("{:#x}", ev.signerAddress),
                                        ev.hasSigned,
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Factory_TRUSTSignerAdded: trust_id={:#x} signer={:#x} block={}",
                                        ev.trustId, ev.signerAddress, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode TrustSignerAdded failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::TRUST::TRUST_ModuleAdded::SIGNATURE_HASH)
                        {
                            // TRUST events come from the TRUST contract address
                            // itself — log.address() is the trust_address.
                            let trust_address = format!("{:#x}", log.address());
                            match decode::TRUST::TRUST_ModuleAdded::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_module(
                                        &conn,
                                        &trust_address,
                                        &format!("{:#x}", ev.moduleId),
                                        &format!("{:#x}", ev.moduleAddress),
                                        &format!("{:#x}", ev.moduleAcl),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed TRUST_ModuleAdded: trust={} module={:#x} module_id={:#x} block={}",
                                        trust_address, ev.moduleAddress, ev.moduleId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode TRUST_ModuleAdded failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::TRUST::PermissionsGranted::SIGNATURE_HASH)
                        {
                            match decode::TRUST::PermissionsGranted::decode_log(&log.inner) {
                                Ok(ev) => {
                                    persist_permissions_event(
                                        &db,
                                        &log,
                                        "granted",
                                        &format!("{:#x}", ev.id),
                                        &format!("{:#x}", ev.flags),
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                }
                                Err(e) => tracing::warn!(
                                    "decode PermissionsGranted failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::TRUST::PermissionsRevoked::SIGNATURE_HASH)
                        {
                            match decode::TRUST::PermissionsRevoked::decode_log(&log.inner) {
                                Ok(ev) => {
                                    persist_permissions_event(
                                        &db,
                                        &log,
                                        "revoked",
                                        &format!("{:#x}", ev.id),
                                        &format!("{:#x}", ev.flags),
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                }
                                Err(e) => tracing::warn!(
                                    "decode PermissionsRevoked failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::TRUST::PermissionsSet::SIGNATURE_HASH)
                        {
                            match decode::TRUST::PermissionsSet::decode_log(&log.inner) {
                                Ok(ev) => {
                                    persist_permissions_event(
                                        &db,
                                        &log,
                                        "set",
                                        &format!("{:#x}", ev.id),
                                        &format!("{:#x}", ev.flags),
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                }
                                Err(e) => tracing::warn!(
                                    "decode PermissionsSet failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Role::Role_RoleCreated::SIGNATURE_HASH)
                        {
                            // Role events come from the module address.
                            let module_address = format!("{:#x}", log.address());
                            match decode::Role::Role_RoleCreated::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_role_created(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.roleId),
                                        &format!("{:#x}", ev.creator),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Role_RoleCreated: module={} role={:#x} creator={:#x} block={}",
                                        module_address, ev.roleId, ev.creator, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Role_RoleCreated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Role::Role_RoleAssigned::SIGNATURE_HASH)
                        {
                            match decode::Role::Role_RoleAssigned::decode_log(&log.inner) {
                                Ok(ev) => {
                                    persist_role_assignment(
                                        &db,
                                        &log,
                                        &format!("{:#x}", ev.roleId),
                                        &format!("{:#x}", ev.occupant),
                                        "assigned",
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                }
                                Err(e) => tracing::warn!(
                                    "decode Role_RoleAssigned failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Role::Role_RoleResigned::SIGNATURE_HASH)
                        {
                            match decode::Role::Role_RoleResigned::decode_log(&log.inner) {
                                Ok(ev) => {
                                    persist_role_assignment(
                                        &db,
                                        &log,
                                        &format!("{:#x}", ev.roleId),
                                        &format!("{:#x}", ev.occupant),
                                        "resigned",
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                }
                                Err(e) => tracing::warn!(
                                    "decode Role_RoleResigned failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Role::Role_RoleRemoved::SIGNATURE_HASH)
                        {
                            match decode::Role::Role_RoleRemoved::decode_log(&log.inner) {
                                Ok(ev) => {
                                    persist_role_assignment(
                                        &db,
                                        &log,
                                        &format!("{:#x}", ev.roleId),
                                        &format!("{:#x}", ev.account),
                                        "removed",
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                }
                                Err(e) => tracing::warn!(
                                    "decode Role_RoleRemoved failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Role::Role_RoleTransferred::SIGNATURE_HASH)
                        {
                            // Transfer is split into two audit rows so
                            // get_role_assignments(module, role) returns the
                            // full chain regardless of which side it queries.
                            match decode::Role::Role_RoleTransferred::decode_log(&log.inner) {
                                Ok(ev) => {
                                    persist_role_assignment(
                                        &db,
                                        &log,
                                        &format!("{:#x}", ev.roleId),
                                        &format!("{:#x}", ev.oldHolder),
                                        "transferred_from",
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                    persist_role_assignment(
                                        &db,
                                        &log,
                                        &format!("{:#x}", ev.roleId),
                                        &format!("{:#x}", ev.newHolder),
                                        "transferred_to",
                                        block_num,
                                        &tx_hash,
                                    )
                                    .await?;
                                }
                                Err(e) => tracing::warn!(
                                    "decode Role_RoleTransferred failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Governance::Governance_ProposalCreated::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Governance::Governance_ProposalCreated::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let cid = String::from_utf8_lossy(&ev.ipfsCid).to_string();
                                    store::insert_proposal_created(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.proposalId),
                                        &format!("{:#x}", ev.governanceConfigId),
                                        &format!("{:#x}", ev.proposer),
                                        ev.voteStart.try_into().unwrap_or(0),
                                        ev.voteEnd.try_into().unwrap_or(0),
                                        &cid,
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Governance_ProposalCreated: module={} proposal={:#x} proposer={:#x} block={}",
                                        module_address, ev.proposalId, ev.proposer, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Governance_ProposalCreated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Governance::Governance_ProposalCanceled::SIGNATURE_HASH)
                        {
                            persist_proposal_status(
                                &db, &log, "canceled",
                                |inner| decode::Governance::Governance_ProposalCanceled::decode_log(inner)
                                    .map(|ev| format!("{:#x}", ev.proposalId)),
                                block_num, &tx_hash,
                            ).await?;
                        } else if topic0
                            == Some(decode::Governance::Governance_ProposalSucceeded::SIGNATURE_HASH)
                        {
                            persist_proposal_status(
                                &db, &log, "succeeded",
                                |inner| decode::Governance::Governance_ProposalSucceeded::decode_log(inner)
                                    .map(|ev| format!("{:#x}", ev.proposalId)),
                                block_num, &tx_hash,
                            ).await?;
                        } else if topic0
                            == Some(decode::Governance::Governance_ProposalExecuted::SIGNATURE_HASH)
                        {
                            persist_proposal_status(
                                &db, &log, "executed",
                                |inner| decode::Governance::Governance_ProposalExecuted::decode_log(inner)
                                    .map(|ev| format!("{:#x}", ev.proposalId)),
                                block_num, &tx_hash,
                            ).await?;
                        } else if topic0
                            == Some(decode::Governance::Governance_VoteCast::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Governance::Governance_VoteCast::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_vote(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.proposalId),
                                        &format!("{:#x}", ev.voter),
                                        ev.support,
                                        &format!("{:#x}", ev.weight),
                                        &ev.reason,
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Governance_VoteCast: module={} proposal={:#x} voter={:#x} support={} weight={:#x} block={}",
                                        module_address, ev.proposalId, ev.voter, ev.support, ev.weight, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Governance_VoteCast failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Token::Transfer::SIGNATURE_HASH)
                        {
                            // Token Transfer fires from the Token module address
                            // (which IS the ERC20 contract). Atomic balance
                            // update happens inside store::insert_token_transfer.
                            let token_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Token::Transfer::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_token_transfer(
                                        &conn,
                                        &token_address,
                                        &format!("{:#x}", ev.from),
                                        &format!("{:#x}", ev.to),
                                        &format!("{:#x}", ev.value),
                                        ev.value,
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Token Transfer: token={} from={:#x} to={:#x} value={:#x} block={}",
                                        token_address, ev.from, ev.to, ev.value, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Token Transfer failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Vesting::Vesting_VestingPositionCreated::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Vesting::Vesting_VestingPositionCreated::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_vesting_position(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.vestingPositionId),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Vesting_VestingPositionCreated: module={} position={:#x} block={}",
                                        module_address, ev.vestingPositionId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Vesting_VestingPositionCreated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Vesting::Vesting_VestingPositionActivated::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Vesting::Vesting_VestingPositionActivated::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_vesting_position_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.vestingPositionId),
                                        "active",
                                    )?;
                                    tracing::info!(
                                        "indexed Vesting_VestingPositionActivated: module={} position={:#x} block={}",
                                        module_address, ev.vestingPositionId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Vesting_VestingPositionActivated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Vesting::Vesting_VestingPositionContributed::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Vesting::Vesting_VestingPositionContributed::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_vesting_contribution(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.vestingPositionId),
                                        &format!("{:#x}", ev.from),
                                        &format!("{:#x}", ev.amount),
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Vesting_VestingPositionContributed: module={} position={:#x} from={:#x} amount={:#x} block={}",
                                        module_address, ev.vestingPositionId, ev.from, ev.amount, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Vesting_VestingPositionContributed failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Vesting::Vesting_VestingClaimed::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Vesting::Vesting_VestingClaimed::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_vesting_claim(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.vestingPositionId),
                                        &format!("{:#x}", ev.asset),
                                        &format!("{:#x}", ev.to),
                                        &format!("{:#x}", ev.amount),
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Vesting_VestingClaimed: module={} position={:#x} to={:#x} amount={:#x} block={}",
                                        module_address, ev.vestingPositionId, ev.to, ev.amount, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Vesting_VestingClaimed failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Vesting::Vesting_PositionRemoved::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Vesting::Vesting_PositionRemoved::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_vesting_position_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.vestingPositionId),
                                        "removed",
                                    )?;
                                    tracing::info!(
                                        "indexed Vesting_PositionRemoved: module={} position={:#x} block={}",
                                        module_address, ev.vestingPositionId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Vesting_PositionRemoved failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Funding::Funding_FundingCreated::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Funding::Funding_FundingCreated::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_funding(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.fundingId),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Funding_FundingCreated: module={} funding={:#x} block={}",
                                        module_address, ev.fundingId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Funding_FundingCreated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Funding::Funding_FundingActivated::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Funding::Funding_FundingActivated::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_funding_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.fundingId),
                                        "active",
                                    )?;
                                    tracing::info!(
                                        "indexed Funding_FundingActivated: module={} funding={:#x} block={}",
                                        module_address, ev.fundingId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Funding_FundingActivated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Funding::Funding_FinalizedFunding::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Funding::Funding_FinalizedFunding::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_funding_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.fundingId),
                                        "finalized",
                                    )?;
                                    tracing::info!(
                                        "indexed Funding_FinalizedFunding: module={} funding={:#x} block={}",
                                        module_address, ev.fundingId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Funding_FinalizedFunding failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Funding::Funding_FundingRemoved::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Funding::Funding_FundingRemoved::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_funding_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.fundingId),
                                        "removed",
                                    )?;
                                    tracing::info!(
                                        "indexed Funding_FundingRemoved: module={} funding={:#x} block={}",
                                        module_address, ev.fundingId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Funding_FundingRemoved failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Funding::Funding_ExitExecuted::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Funding::Funding_ExitExecuted::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_funding_exit(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.exitId),
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Funding_ExitExecuted: module={} exit={:#x} block={}",
                                        module_address, ev.exitId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Funding_ExitExecuted failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Budget::Budget_BudgetCreated::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Budget::Budget_BudgetCreated::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_budget(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.budgetId),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Budget_BudgetCreated: module={} budget={:#x} block={}",
                                        module_address, ev.budgetId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Budget_BudgetCreated failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Budget::Budget_BudgetFrozen::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Budget::Budget_BudgetFrozen::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_budget_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.budgetId),
                                        "frozen",
                                    )?;
                                    tracing::info!(
                                        "indexed Budget_BudgetFrozen: module={} budget={:#x} block={}",
                                        module_address, ev.budgetId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Budget_BudgetFrozen failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Budget::Budget_BudgetUnfrozen::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Budget::Budget_BudgetUnfrozen::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_budget_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.budgetId),
                                        "active",
                                    )?;
                                    tracing::info!(
                                        "indexed Budget_BudgetUnfrozen: module={} budget={:#x} block={}",
                                        module_address, ev.budgetId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Budget_BudgetUnfrozen failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Budget::Budget_BudgetRemoved::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Budget::Budget_BudgetRemoved::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_budget_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.budgetId),
                                        "removed",
                                    )?;
                                    tracing::info!(
                                        "indexed Budget_BudgetRemoved: module={} budget={:#x} block={}",
                                        module_address, ev.budgetId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Budget_BudgetRemoved failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Budget::Budget_BudgetDeposited::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Budget::Budget_BudgetDeposited::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_budget_movement(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.budgetId),
                                        "deposit",
                                        &format!("{:#x}", ev.from),
                                        &format!("{:#x}", ev.asset),
                                        &format!("{:#x}", ev.amount),
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Budget_BudgetDeposited: module={} budget={:#x} from={:#x} amount={:#x} block={}",
                                        module_address, ev.budgetId, ev.from, ev.amount, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Budget_BudgetDeposited failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Budget::Budget_BudgetConsumed::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Budget::Budget_BudgetConsumed::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_budget_movement(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.budgetId),
                                        "consume",
                                        &format!("{:#x}", ev.to),
                                        &format!("{:#x}", ev.asset),
                                        &format!("{:#x}", ev.amount),
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Budget_BudgetConsumed: module={} budget={:#x} to={:#x} amount={:#x} block={}",
                                        module_address, ev.budgetId, ev.to, ev.amount, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Budget_BudgetConsumed failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Fund::Fund_NavProcessed::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Fund::Fund_NavProcessed::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_fund_nav(
                                        &conn,
                                        &module_address,
                                        ev.checkpointId,
                                        &format!("{:#x}", ev.netNAV),
                                        &format!("{:#x}", ev.tokenQuote),
                                        &format!("{:#x}", ev.mgmtFeesCharged),
                                        &format!("{:#x}", ev.carryCharged),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Fund_NavProcessed: module={} checkpoint={} netNAV={:#x} block={}",
                                        module_address, ev.checkpointId, ev.netNAV, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Fund_NavProcessed failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Fund::Fund_FlowRequested::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Fund::Fund_FlowRequested::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_fund_flow(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.requestId),
                                        &format!("{:#x}", ev.roleId),
                                        ev.flowType,
                                        &format!("{:#x}", ev.amountIn),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Fund_FlowRequested: module={} request={:#x} flowType={} amountIn={:#x} block={}",
                                        module_address, ev.requestId, ev.flowType, ev.amountIn, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Fund_FlowRequested failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Fund::Fund_FlowClaimed::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Fund::Fund_FlowClaimed::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let amount_out_hex = format!("{:#x}", ev.amountOut);
                                    store::update_fund_flow_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.requestId),
                                        "claimed",
                                        Some(&amount_out_hex),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Fund_FlowClaimed: module={} request={:#x} amountOut={:#x} block={}",
                                        module_address, ev.requestId, ev.amountOut, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Fund_FlowClaimed failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Fund::Fund_FlowCancelled::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Fund::Fund_FlowCancelled::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::update_fund_flow_status(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.requestId),
                                        "cancelled",
                                        None,
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Fund_FlowCancelled: module={} request={:#x} block={}",
                                        module_address, ev.requestId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Fund_FlowCancelled failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Fund::Fund_PositionOpened::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Fund::Fund_PositionOpened::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::insert_fund_position(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.positionId),
                                        &format!("{:#x}", ev.positionManagerId),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Fund_PositionOpened: module={} position={:#x} pmId={:#x} block={}",
                                        module_address, ev.positionId, ev.positionManagerId, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Fund_PositionOpened failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Fund::Fund_PositionClosed::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            match decode::Fund::Fund_PositionClosed::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    store::close_fund_position(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.positionId),
                                        &format!("{:#x}", ev.quoteAssetReceived),
                                        block_num,
                                        &tx_hash,
                                    )?;
                                    tracing::info!(
                                        "indexed Fund_PositionClosed: module={} position={:#x} proceeds={:#x} block={}",
                                        module_address, ev.positionId, ev.quoteAssetReceived, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Fund_PositionClosed failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        } else if topic0
                            == Some(decode::Fund::Fund_PositionInteracted::SIGNATURE_HASH)
                        {
                            let module_address = format!("{:#x}", log.address());
                            let log_index = log.log_index.unwrap_or(0);
                            match decode::Fund::Fund_PositionInteracted::decode_log(&log.inner) {
                                Ok(ev) => {
                                    let conn = db.lock().await;
                                    let coord = store::LogCoord {
                                        block_number: block_num,
                                        tx_hash: &tx_hash,
                                        log_index,
                                    };
                                    store::insert_fund_position_interaction(
                                        &conn,
                                        &module_address,
                                        &format!("{:#x}", ev.positionId),
                                        &format!("{:#x}", ev.roleId),
                                        ev.action,
                                        coord,
                                    )?;
                                    tracing::info!(
                                        "indexed Fund_PositionInteracted: module={} position={:#x} action={} block={}",
                                        module_address, ev.positionId, ev.action, block_num
                                    );
                                }
                                Err(e) => tracing::warn!(
                                    "decode Fund_PositionInteracted failed at block {} tx {}: {}",
                                    block_num, tx_hash, e
                                ),
                            }
                        }
                    }
                }

                // Commit the block. If discontinuous, unwind + restart from safe point.
                let conn = db.lock().await;
                let continuous = chain::commit_block(&conn, block_num, &block_hash, &parent_hash)?;
                if !continuous {
                    tracing::warn!(
                        "REORG/GAP at block {} (hash={}, parent={}); unwinding",
                        block_num, block_hash, parent_hash
                    );
                    let safe = block_num.saturating_sub(1);
                    chain::unwind_above(&conn, safe)?;
                    // Loop will re-derive `from` next iteration via highest_committed.
                    break;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store;
    use tempfile::tempdir;

    fn fresh_db() -> (tempfile::TempDir, Connection) {
        let dir = tempdir().unwrap();
        let conn = store::open(dir.path().join("t.db")).expect("open");
        (dir, conn)
    }

    #[test]
    fn commit_continuous_blocks_reports_true() {
        let (_dir, conn) = fresh_db();
        let ok1 = commit_block(&conn, 1, "0xhash1", "0xgenesis").unwrap();
        assert!(ok1);
        let ok2 = commit_block(&conn, 2, "0xhash2", "0xhash1").unwrap();
        assert!(ok2);
    }

    #[test]
    fn commit_with_wrong_parent_reports_false() {
        let (_dir, conn) = fresh_db();
        commit_block(&conn, 1, "0xhash1", "0xgenesis").unwrap();
        let ok = commit_block(&conn, 2, "0xhash2-fork", "0xWRONG").unwrap();
        assert!(!ok);
    }

    #[test]
    fn commit_with_skipped_block_reports_false() {
        let (_dir, conn) = fresh_db();
        commit_block(&conn, 1, "0xhash1", "0xgenesis").unwrap();
        let ok = commit_block(&conn, 3, "0xhash3", "0xhash1").unwrap();
        assert!(!ok);
    }

    #[test]
    fn unwind_clears_blocks_above_safe() {
        let (_dir, conn) = fresh_db();
        commit_block(&conn, 1, "0xhash1", "0xg").unwrap();
        commit_block(&conn, 2, "0xhash2", "0xhash1").unwrap();
        commit_block(&conn, 3, "0xhash3", "0xhash2").unwrap();
        let removed = unwind_above(&conn, 1).unwrap();
        assert_eq!(removed, 2);
        let highest = highest_committed(&conn).unwrap();
        assert_eq!(highest, Some(1));
    }

    #[test]
    fn highest_committed_works() {
        let (_dir, conn) = fresh_db();
        assert_eq!(highest_committed(&conn).unwrap(), None);
        commit_block(&conn, 5, "0xh5", "0xprev").unwrap();
        commit_block(&conn, 6, "0xh6", "0xh5").unwrap();
        assert_eq!(highest_committed(&conn).unwrap(), Some(6));
    }

    #[tokio::test]
    async fn provider_connects_to_anvil_if_running() {
        let result = async {
            let p = provider::http_provider("http://127.0.0.1:8545")?;
            provider::latest_block(&p).await
        }
        .await;

        match result {
            Ok(n) => {
                tracing::info!("anvil latest block: {}", n);
                assert!(n >= 1);
            }
            Err(_) => {
                eprintln!("anvil not reachable at :8545 — skipping live provider test");
            }
        }
    }

    #[test]
    fn poll_config_default_is_sensible() {
        let cfg = poll::PollConfig::default();
        assert_eq!(cfg.confirmation_depth, 12);
        assert_eq!(cfg.start_block, 0);
    }
}
