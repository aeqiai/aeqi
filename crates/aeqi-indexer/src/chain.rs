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
                // (TrustCreated → trust, ModuleAdded → module) and the next
                // round picks them up.
                let watched: Vec<Address> = {
                    let conn = db.lock().await;
                    store::list_watched_addresses(&conn)?
                        .into_iter()
                        .filter_map(|w| w.address.parse().ok())
                        .collect()
                };

                if !watched.is_empty() {
                    let sigs = vec![
                        // Factory events
                        decode::Factory::Factory_TRUSTCreatedEvent::SIGNATURE_HASH,
                        decode::Factory::Factory_TRUSTRegisteredEvent::SIGNATURE_HASH,
                        decode::Factory::Factory_TRUSTSignerAdded::SIGNATURE_HASH,
                        // TRUST events (per-trust)
                        decode::TRUST::TRUST_ModuleAdded::SIGNATURE_HASH,
                    ];
                    let filter = Filter::new()
                        .from_block(block_num)
                        .to_block(block_num)
                        .address(watched)
                        .event_signature(sigs);

                    let logs = provider
                        .get_logs(&filter)
                        .await
                        .with_context(|| format!("get_logs block {}", block_num))?;

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
