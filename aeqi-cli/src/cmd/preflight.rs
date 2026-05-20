//! Boot-time pre-flight checks for `aeqi start` / daemon::Start.
//!
//! Two cheapest+highest-ROI checks from SA37's boot audit (AEQI idea
//! `08c226f3-…`): wire `AEQIConfig::validate()` into the daemon boot
//! path (it previously only ran from `aeqi doctor`), and add a minimal
//! env-var-presence check so the daemon refuses to boot half-configured.
//!
//! Phase-1 deliberately omits C4 (last-5-rows of `llm_calls` health
//! warning); that one needs DB access at the same boot point and is a
//! follow-up.
//!
//! Both checks are fatal: a half-validated boot would silently keep the
//! runtime alive while sessions emit empty completions or fail in
//! unexpected places. Failing fast at startup is the cheapest signal.

use aeqi_core::AEQIConfig;
use anyhow::{Result, bail};
use tracing::info;

/// Required runtime env vars. Empty / unset values are treated the
/// same — both indicate the operator hasn't wired the variable.
///
/// `AEQI_WEB_SECRET`  — required for stable session cookies; an
///                      ephemeral secret invalidates every sign-in on
///                      restart.
/// `AEQI_DATA_DIR`    — required so the daemon, web, and CLI all
///                      resolve the same `aeqi.db` / `sessions.db` /
///                      `rm.sock`.
/// `AEQI_CONFIG`      — required so callers can't accidentally boot
///                      against a default config when they expected
///                      a specific path.
const REQUIRED_ENV_VARS: &[&str] = &["AEQI_WEB_SECRET", "AEQI_DATA_DIR", "AEQI_CONFIG"];

/// Verify every required env var is present and non-empty (after
/// trim). Returns `Err` listing the missing names so the operator
/// fixes the entire set in one pass.
pub(crate) fn pre_flight_env_check() -> Result<()> {
    let missing: Vec<&&str> = REQUIRED_ENV_VARS
        .iter()
        .filter(|name| {
            std::env::var(name)
                .map(|v| v.trim().is_empty())
                .unwrap_or(true)
        })
        .collect();
    if !missing.is_empty() {
        let names: Vec<&str> = missing.iter().map(|s| **s).collect();
        bail!("missing required env vars: {:?}", names);
    }
    Ok(())
}

/// Run `AEQIConfig::validate()` and bail with the joined error list
/// on any reported issue. `validate()` returns `Vec<String>` because
/// it surfaces every issue at once; a fatal boot collapses that to a
/// single `Err` so systemd / the operator sees the whole set in the
/// log line.
pub(crate) fn pre_flight_config_validate(config: &AEQIConfig) -> Result<()> {
    let issues = config.validate();
    if !issues.is_empty() {
        bail!("config validation failed: {}", issues.join("; "));
    }
    Ok(())
}

/// Boot pre-flight entry point. Runs the env-var presence check and
/// `AEQIConfig::validate()`; logs `preflight: OK` on success.
pub(crate) fn run_boot_preflight(config: &AEQIConfig) -> Result<()> {
    pre_flight_env_check()?;
    pre_flight_config_validate(config)?;
    info!("preflight: OK");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serialise env-var manipulation across tests in this module —
    /// `std::env::set_var` / `remove_var` are process-global and not
    /// thread-safe under `cargo test`'s default parallelism. A
    /// per-module mutex is the cheapest way to keep the asserts
    /// deterministic.
    static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct EnvGuard {
        original: Vec<(&'static str, Option<String>)>,
    }

    impl EnvGuard {
        fn snapshot() -> Self {
            let original = REQUIRED_ENV_VARS
                .iter()
                .map(|name| (*name, std::env::var(name).ok()))
                .collect();
            Self { original }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for (name, val) in &self.original {
                // SAFETY: tests serialise env access via ENV_MUTEX.
                unsafe {
                    match val {
                        Some(v) => std::env::set_var(name, v),
                        None => std::env::remove_var(name),
                    }
                }
            }
        }
    }

    #[test]
    fn pre_flight_env_check_fails_when_required_missing() {
        let _lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _guard = EnvGuard::snapshot();
        for name in REQUIRED_ENV_VARS {
            // SAFETY: tests serialise env access via ENV_MUTEX.
            unsafe {
                std::env::set_var(name, "");
            }
        }
        let err = pre_flight_env_check().expect_err("expected missing-env error");
        let msg = format!("{err}");
        for name in REQUIRED_ENV_VARS {
            assert!(
                msg.contains(name),
                "error message {msg:?} should mention {name}"
            );
        }
    }

    #[test]
    fn pre_flight_env_check_passes_when_set() {
        let _lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _guard = EnvGuard::snapshot();
        for name in REQUIRED_ENV_VARS {
            // SAFETY: tests serialise env access via ENV_MUTEX.
            unsafe {
                std::env::set_var(name, "non-empty-value");
            }
        }
        pre_flight_env_check().expect("all required env vars set");
    }
}
