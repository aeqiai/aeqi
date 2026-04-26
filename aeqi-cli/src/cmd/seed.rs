//! `aeqi seed` — hydrate the foundational idea library into the local DB.
//!
//! Standalone alternative to the daemon's boot-time preset seeding: useful
//! when operating against a stopped daemon or when re-seeding after manual
//! DB edits.
//!
//! Talks directly to the aeqi.db that `aeqi-ideas` + `aeqi-orchestrator` share.
//! Does not require the daemon to be running.

use aeqi_orchestrator::EventHandlerStore;
use aeqi_orchestrator::agent_registry::AgentRegistry;
use aeqi_orchestrator::preset_seeder::{SeedResult, SeedStatus, seed_preset_ideas};
use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;

use crate::helpers::load_config;

pub(crate) async fn cmd_seed(config_path: &Option<PathBuf>) -> Result<()> {
    let (config, _) = load_config(config_path)?;

    let agent_reg = Arc::new(AgentRegistry::open(&config.data_dir())?);
    let event_handler_store = EventHandlerStore::new(agent_reg.db());

    let results = seed_preset_ideas(&event_handler_store).await?;
    print_seed_summary(&results);

    Ok(())
}

fn print_seed_summary(results: &[SeedResult]) {
    if results.is_empty() {
        println!("No preset ideas found. Set AEQI_PRESETS_DIR or run from the aeqi repo root.");
        return;
    }

    let mut inserted = 0usize;
    let mut present = 0usize;
    let mut skipped = 0usize;

    for r in results {
        match &r.status {
            SeedStatus::Inserted => {
                inserted += 1;
                println!("  inserted: {} ({})", r.name, r.path.display());
            }
            SeedStatus::AlreadyPresent => {
                present += 1;
            }
            SeedStatus::Skipped(reason) => {
                skipped += 1;
                println!("  skipped:  {} ({}) — {}", r.name, r.path.display(), reason);
            }
        }
    }

    println!();
    println!(
        "Preset idea seeding: {inserted} inserted, {present} already present, {skipped} skipped."
    );
}
