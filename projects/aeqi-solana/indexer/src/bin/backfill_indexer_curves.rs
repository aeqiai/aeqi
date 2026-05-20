//! ja-017 one-shot: scan an existing indexer SQLite for raw
//! `aeqi_unifutures` curve events and project them into the new
//! `curves` + `curve_trades` typed tables.
//!
//! Idempotent: re-runs only land rows the typed tables don't already have.
//! Reads + writes only the indexer's own DB — no RPC traffic, no chain
//! access.
//!
//! Usage:
//!
//! ```text
//! aeqi-backfill-indexer-curves --db-path /var/lib/aeqi/indexer-solana.db
//! ```
//!
//! Exit codes:
//!   0 — success (counts printed to stdout)
//!   1 — could not open the DB or run the backfill
//!
//! Operationally: stop `aeqi-solana-indexer.service` before running
//! against the live DB so the WAL doesn't move underneath the scan,
//! though the operation is read-from-events + INSERT OR IGNORE so a
//! hot run is *safe* (just may miss the latest few events until the
//! next live-tail tick projects them).

use std::path::PathBuf;
use std::process::ExitCode;

use aeqi_indexer::sink::Sink;
use anyhow::{Context, Result};
use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "aeqi-backfill-indexer-curves",
    about = "Project existing aeqi_unifutures curve events into curves + curve_trades."
)]
struct Args {
    /// Path to the indexer SQLite. Defaults to the canonical live path.
    #[arg(long, env = "AEQI_INDEXER_DB", default_value = "/var/lib/aeqi/indexer-solana.db")]
    db_path: PathBuf,
}

fn run(args: Args) -> Result<()> {
    let sink = Sink::open(&args.db_path)
        .with_context(|| format!("opening indexer db at {}", args.db_path.display()))?;
    let counts = sink.replay_unifutures_curves().context("running replay_unifutures_curves")?;
    println!(
        "backfill complete — curves_inserted={} trades_inserted={} decode_failures={}",
        counts.curves_inserted, counts.trades_inserted, counts.decode_failures
    );
    Ok(())
}

fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
    let args = Args::parse();
    match run(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::FAILURE
        }
    }
}
