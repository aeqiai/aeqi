//! aeqi-indexer binary entry point.
//!
//! Spawns:
//!   1. The GraphQL HTTP server (port AEQI_INDEXER_PORT, default 8500)
//!   2. The chain poll loop (RPC = AEQI_INDEXER_RPC, default http://127.0.0.1:8545)
//!
//! Env:
//!   AEQI_INDEXER_DB         — sqlite path (default ./aeqi-indexer.db)
//!   AEQI_INDEXER_PORT       — HTTP port (default 8500)
//!   AEQI_INDEXER_RPC        — JSON-RPC URL (default http://127.0.0.1:8545)
//!   AEQI_INDEXER_FACTORY    — factory address (hex, optional — when unset,
//!                              poll loop runs in "smoke mode" tracking blocks
//!                              but skipping log decoding)
//!   AEQI_INDEXER_START_BLOCK — first block to index (default 0)

use aeqi_indexer::{api, chain::poll, store};
use alloy::primitives::Address;
use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tracing::{info, Level};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .with_target(false)
        .init();

    let db_path = std::env::var("AEQI_INDEXER_DB").unwrap_or_else(|_| "./aeqi-indexer.db".to_string());
    let port: u16 = std::env::var("AEQI_INDEXER_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8500);
    let rpc_url = std::env::var("AEQI_INDEXER_RPC")
        .unwrap_or_else(|_| "http://127.0.0.1:8545".to_string());
    let factory_address: Option<Address> = std::env::var("AEQI_INDEXER_FACTORY")
        .ok()
        .and_then(|s| s.parse().ok());
    let start_block: u64 = std::env::var("AEQI_INDEXER_START_BLOCK")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    info!("aeqi-indexer v{} starting", aeqi_indexer::VERSION);
    info!("db: {}", db_path);

    let conn = store::open(&db_path)?;

    // Seed the factory address into watched_addresses if provided. Subsequent
    // TRUST + module addresses register themselves via the handlers.
    if let Some(factory) = factory_address {
        let addr_hex = format!("{:#x}", factory);
        store::register_watched_address(&conn, &addr_hex, "factory", start_block)?;
        info!("seeded factory address into watched_addresses: {}", addr_hex);
    }

    let db = Arc::new(Mutex::new(conn));

    // Build poll config
    let poll_cfg = poll::PollConfig {
        rpc_url: rpc_url.clone(),
        start_block,
        confirmation_depth: 12,
        poll_interval: Duration::from_secs(2),
    };

    // Spawn poll loop alongside GraphQL server.
    let poll_db = db.clone();
    let poll_handle = tokio::spawn(async move {
        if let Err(e) = poll::run(poll_cfg, poll_db).await {
            tracing::error!("poll loop crashed: {:#}", e);
        }
    });

    // Serve GraphQL — this future is the long-runner, indexer exits when it returns.
    let serve_result = api::serve(port, db).await;

    // Cancel poll task if serve exits.
    poll_handle.abort();

    serve_result
}
