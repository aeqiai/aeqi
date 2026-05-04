//! aeqi-paymaster binary entry point.
//!
//! Loads config from environment, initialises the SQLite schema, wires the
//! axum router, and serves on `PAYMASTER_BIND` (default `127.0.0.1:8460`).

use std::sync::Arc;

use anyhow::{Context, Result};
use tracing::info;
use tracing_subscriber::{EnvFilter, fmt};

use aeqi_paymaster::{AppState, PaymasterSigner, db, router};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialise tracing.
    fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    info!("aeqi-paymaster starting");

    // Config from environment.
    let db_path = std::env::var("PAYMASTER_DB_PATH").unwrap_or_else(|_| db::DB_PATH.to_string());
    let bind_addr =
        std::env::var("PAYMASTER_BIND").unwrap_or_else(|_| "127.0.0.1:8460".to_string());
    let valid_for_secs: u64 = std::env::var("PAYMASTER_VALID_FOR_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(900); // 15 minutes

    // Ensure parent directory for DB exists.
    if let Some(parent) = std::path::Path::new(&db_path).parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create DB directory {parent:?}"))?;
    }

    // Initialise SQLite schema.
    let conn = rusqlite::Connection::open(&db_path)
        .with_context(|| format!("failed to open paymaster DB at {db_path}"))?;
    db::init_schema(&conn)?;
    drop(conn); // Each request opens its own connection via spawn_blocking.

    // Load signer.
    let signer = Arc::new(PaymasterSigner::from_env()?);
    info!(address = %signer.address(), bind = %bind_addr, "paymaster ready");

    // Build router.
    let state = AppState {
        signer,
        db_path,
        valid_for_secs,
    };
    let app = router(state);

    // Bind and serve.
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .with_context(|| format!("failed to bind to {bind_addr}"))?;
    info!("listening on {bind_addr}");
    axum::serve(listener, app)
        .await
        .context("axum serve error")?;

    Ok(())
}
