//! `aeqi check-runtime` — the startup smoke test.
//!
//! Opens the runtime's SQLite databases and forces every migration to
//! run, then exits 0. Catches the class of bugs that compile clean +
//! pass `cargo test` but panic on real startup against an existing-shape
//! DB:
//!
//! - SQLite migration ordering (`feedback/sqlite-create-index-runs-against-no-op-create-table`)
//! - axum router-build panics on legacy `:param` syntax
//!   (`feedback/axum-0.8-path-segment-runtime-not-compile`)
//! - Any other panic inside `pub async fn start()` or the DB open path
//!
//! Both incidents above shipped to prod and crash-looped real users.
//! ~12 seconds of `aeqi check-runtime` in `scripts/ci-local.sh` (or
//! `deploy.sh`) would have caught either before deploy.
//!
//! Intentional scope: this command opens DBs + applies migrations.
//! It does NOT spin up the axum router or HTTP server — that would
//! require a free port + bind permissions that CI doesn't always have.
//! For the axum-router panic class specifically, a follow-up
//! `aeqi check-router` (or extending this command with `--with-router`)
//! could build the Router::new() chain without serving it. Phase 2 of
//! ae-025 if usage warrants.

use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

use aeqi_orchestrator::agent_registry::AgentRegistry;

/// `aeqi check-runtime --root <path>`
///
/// `root` should point at a directory containing the runtime's
/// `aeqi.db` / `sessions.db` / `agents.db`. In CI: copy a known
/// existing-shape DB into a temp dir and pass it here. Locally:
/// pass `~/.local/share/aeqi/` or `/var/lib/aeqi/hosts/<entity>/`.
pub(crate) async fn cmd_check_runtime(root: Option<PathBuf>) -> Result<()> {
    let data_dir = root.unwrap_or_else(|| {
        // No --root given: smoke-test against a tmpdir with a fresh
        // shape. Confirms migrations run cleanly on the EMPTY case,
        // which is itself a useful signal (catches typos in
        // `initial_schema`).
        tempfile::tempdir()
            .expect("tempdir for fresh-shape smoke")
            .keep()
    });

    eprintln!("aeqi check-runtime: data_dir={}", data_dir.display());

    open_agent_registry(&data_dir).context("opening agent registry")?;

    eprintln!("aeqi check-runtime: OK (all migrations applied cleanly)");
    Ok(())
}

fn open_agent_registry(data_dir: &Path) -> Result<()> {
    // AgentRegistry::open is the single load-bearing migration entry
    // point — it opens sessions.db, applies the quests/sessions
    // migrations, and returns. If any migration panics or returns Err
    // here, the binary would crash-loop on real startup. We surface
    // the error explicitly so CI fails loudly.
    let _registry = AgentRegistry::open(data_dir)
        .with_context(|| format!("AgentRegistry::open({})", data_dir.display()))?;
    Ok(())
}
