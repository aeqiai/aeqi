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
use std::path::Path;
use tracing::info;

/// Verify every required runtime value is available either from the
/// environment or from the discovered config. `aeqi setup && aeqi start`
/// should work as a single-binary local flow, while systemd/platform
/// deployments can still inject the same values explicitly.
pub(crate) fn pre_flight_env_check(config: &AEQIConfig, config_path: &Path) -> Result<()> {
    let mut missing = Vec::new();

    if env_is_empty("AEQI_WEB_SECRET") && config.web.auth_secret.as_deref().unwrap_or("").is_empty()
    {
        missing.push("AEQI_WEB_SECRET");
    }
    if env_is_empty("AEQI_DATA_DIR") && config.aeqi.data_dir.trim().is_empty() {
        missing.push("AEQI_DATA_DIR");
    }
    if env_is_empty("AEQI_CONFIG") && config_path.as_os_str().is_empty() {
        missing.push("AEQI_CONFIG");
    }

    if !missing.is_empty() {
        bail!("missing required runtime values: {:?}", missing);
    }
    Ok(())
}

fn env_is_empty(name: &str) -> bool {
    std::env::var(name)
        .map(|v| v.trim().is_empty())
        .unwrap_or(true)
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
pub(crate) fn run_boot_preflight(config: &AEQIConfig, config_path: &Path) -> Result<()> {
    pre_flight_env_check(config, config_path)?;
    pre_flight_config_validate(config)?;
    info!("preflight: OK");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const REQUIRED_ENV_VARS: &[&str] = &["AEQI_WEB_SECRET", "AEQI_DATA_DIR", "AEQI_CONFIG"];

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
    fn local_config_satisfies_preflight_without_env_vars() {
        let _lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _guard = EnvGuard::snapshot();
        for name in REQUIRED_ENV_VARS {
            // SAFETY: tests serialise env access via ENV_MUTEX.
            unsafe {
                std::env::set_var(name, "");
            }
        }

        let config = config_for_preflight("~/.aeqi", Some("local-secret"));

        pre_flight_env_check(&config, Path::new("/tmp/aeqi.toml"))
            .expect("config-backed local start should pass without env vars");
    }

    #[test]
    fn pre_flight_env_check_fails_when_required_values_missing() {
        let _lock = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
        let _guard = EnvGuard::snapshot();
        for name in REQUIRED_ENV_VARS {
            // SAFETY: tests serialise env access via ENV_MUTEX.
            unsafe {
                std::env::set_var(name, "");
            }
        }

        let config = config_for_preflight("", None);

        let err = pre_flight_env_check(&config, Path::new(""))
            .expect_err("expected missing-runtime-values error");
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
        let config = config_for_preflight("", None);
        pre_flight_env_check(&config, Path::new("")).expect("all required env vars set");
    }

    fn config_for_preflight(data_dir: &str, auth_secret: Option<&str>) -> AEQIConfig {
        let web_secret = auth_secret
            .map(|secret| format!("auth_secret = \"{secret}\""))
            .unwrap_or_default();
        AEQIConfig::parse(&format!(
            r#"
[aeqi]
name = "test"
data_dir = "{data_dir}"

[web]
{web_secret}

[security]
autonomy = "supervised"
workspace_only = true
max_cost_per_day_usd = 1.0

[memory]
backend = "sqlite"
"#,
        ))
        .expect("test config parses")
    }
}
