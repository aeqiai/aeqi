//! Tool-layer write/read protection for sensitive host paths.
//!
//! Defense-in-depth layer for host-tier runtimes (`aeqi-host-<trust_id>.service`)
//! that don't carry a bwrap allowlist mount. Sandbox-tier runtimes
//! (`aeqi-sandbox-<trust_id>.service`) are already structurally protected
//! by the bwrap mount in `aeqi-platform/src/sandbox.rs::SandboxManager`;
//! this module is the equivalent guard at the tool-call layer for the
//! shell tool, which calls `Command::new("bash")` directly with no mount.
//!
//! See idea `architecture/aeqi-sandbox-audit-2026-05-15` for the full audit
//! and the cost-of-mistake (prompt-injected agent on host-tier exfiltrating
//! `~/.ssh/id_rsa`, AWS creds, `/etc/aeqi/secrets.env` via `web.fetch`).
//!
//! The `file` + `edit` tools are NOT consumed by this module because they
//! already route through `aeqi_core::secure_path::secure_path`, which
//! canonicalizes + workspace-scopes every path. This module adds the
//! missing protection at the shell-tool layer.

use std::path::Path;
use std::sync::OnceLock;

/// Tier-aware protection mode. `host` applies the denylist; `sandbox` skips
/// the check (bwrap mount already enforces the equivalent). Unset env defaults
/// to `host` — strict by default — so a deployment that hasn't been updated
/// to inject the env hint still gets protection.
pub fn current_tier() -> &'static str {
    static TIER: OnceLock<String> = OnceLock::new();
    TIER.get_or_init(|| std::env::var("AEQI_PLACEMENT_TIER").unwrap_or_else(|_| "host".to_string()))
}

/// Optional env-pinned writable subtree. When set, writes outside this root
/// are denied. Reads are NOT gated by this — `is_path_denied` carries the
/// read denylist instead.
pub fn current_safe_write_root() -> Option<&'static Path> {
    static ROOT: OnceLock<Option<std::path::PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| {
        std::env::var("AEQI_WRITE_SAFE_ROOT")
            .ok()
            .map(std::path::PathBuf::from)
    })
    .as_deref()
}

/// Exact paths that are denied — the agent cannot read or write these
/// regardless of tier (when tier=host). These are the highest-value
/// credential and config targets: SSH keys, shell rc files, sudoers,
/// passwd/shadow, platform secrets.
fn denied_exact_paths_with_home(home: &str) -> Vec<String> {
    vec![
        format!("{home}/.ssh/authorized_keys"),
        format!("{home}/.ssh/id_rsa"),
        format!("{home}/.ssh/id_ed25519"),
        format!("{home}/.ssh/id_ecdsa"),
        format!("{home}/.ssh/config"),
        format!("{home}/.ssh/known_hosts"),
        format!("{home}/.bashrc"),
        format!("{home}/.zshrc"),
        format!("{home}/.profile"),
        format!("{home}/.bash_profile"),
        format!("{home}/.zprofile"),
        format!("{home}/.netrc"),
        format!("{home}/.pgpass"),
        format!("{home}/.npmrc"),
        format!("{home}/.pypirc"),
        "/etc/sudoers".to_string(),
        "/etc/shadow".to_string(),
        "/etc/aeqi/secrets.env".to_string(),
    ]
}

/// Directory prefixes that are denied — anything below them is also denied.
fn denied_prefixes_with_home(home: &str) -> Vec<String> {
    vec![
        format!("{home}/.ssh"),
        format!("{home}/.aws"),
        format!("{home}/.gnupg"),
        format!("{home}/.kube"),
        format!("{home}/.docker"),
        format!("{home}/.azure"),
        format!("{home}/.config/gh"),
        "/etc/sudoers.d".to_string(),
        "/etc/aeqi".to_string(),
    ]
}

fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/root".to_string())
}

/// Check whether a path is on the denylist for the given tier.
///
/// Returns false for `tier == "sandbox"` (bwrap mount already enforces);
/// returns true for `tier == "host"` (and any unknown tier — strict default)
/// when the path matches an exact-deny entry or is below a denied prefix.
///
/// Path is matched as a string against the denylist. Callers that have
/// already canonicalized the path get the most reliable result; callers
/// that haven't (the shell-tool string scanner) get a heuristic match.
pub fn is_path_denied_for_tier(tier: &str, path: &str) -> bool {
    if tier == "sandbox" {
        return false;
    }
    let home = home_dir();
    let exact = denied_exact_paths_with_home(&home);
    let prefixes = denied_prefixes_with_home(&home);
    if exact.iter().any(|p| p == path) {
        return true;
    }
    if prefixes
        .iter()
        .any(|p| path == p || path.starts_with(&format!("{p}/")))
    {
        return true;
    }
    false
}

/// Heuristic scan over a shell command string for denied path references.
///
/// Returns the first denied path encountered (for error messages) or `None`
/// if the command is clean by this heuristic.
///
/// This is deliberately a substring scanner: cheap, catches the obvious
/// cases (`cat ~/.ssh/id_rsa`, `echo X > /etc/sudoers`), and accepts false
/// negatives on obfuscated commands (`X=~; cat $X/.ssh/id_rsa`). Defense-
/// in-depth — bwrap on sandbox-tier and the agent's charter idea on host-
/// tier are the load-bearing layers; this layer catches the dumb mistakes.
///
/// Tilde expansion is approximated by also matching `~/...` literal tokens.
pub fn scan_command_for_denied_paths(tier: &str, command: &str) -> Option<String> {
    if tier == "sandbox" {
        return None;
    }
    let home = home_dir();
    let exact = denied_exact_paths_with_home(&home);
    let prefixes = denied_prefixes_with_home(&home);

    // Build the tilde-form mirrors for HOME-relative denies.
    let mut all_needles: Vec<String> = Vec::new();
    for path in &exact {
        all_needles.push(path.clone());
        if let Some(suffix) = path.strip_prefix(&home) {
            all_needles.push(format!("~{suffix}"));
        }
    }
    for prefix in &prefixes {
        all_needles.push(prefix.clone());
        if let Some(suffix) = prefix.strip_prefix(&home) {
            all_needles.push(format!("~{suffix}"));
        }
    }

    for needle in &all_needles {
        if command.contains(needle) {
            return Some(needle.clone());
        }
    }
    None
}

/// Check whether a write to `target_path` is allowed by the safe-write-root
/// policy. Returns true (allowed) when no root is configured. Returns false
/// (denied) when a root is configured and `target_path` is outside it.
///
/// Reads are NOT affected by this check; only writes.
pub fn is_write_allowed_by_safe_root(target_path: &Path) -> bool {
    match current_safe_write_root() {
        None => true,
        Some(root) => target_path.starts_with(root),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_home<R>(home: &str, f: impl FnOnce() -> R) -> R {
        // Tests that depend on HOME re-derive it from env each call (no
        // OnceLock cache for HOME in this module). Use `unsafe` per
        // Rust 2024 edition trap (see workspace trap doc).
        //
        // `std::env::set_var` is process-global. Without serialization,
        // parallel tests racing through `with_home` could see one test's
        // restore step revert the env mid-read of another test (the
        // failing assertions look like `denied_exact_paths_with_home`
        // computing against the wrong HOME). Serialize via a static
        // Mutex so each `with_home` body sees a consistent HOME.
        use std::sync::Mutex;
        static ENV_LOCK: Mutex<()> = Mutex::new(());
        // PoisonError can only happen if a prior holder panicked; we
        // still want to restore env, so recover from the poison.
        let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());

        let old = std::env::var("HOME").ok();
        unsafe {
            std::env::set_var("HOME", home);
        }
        let result = f();
        unsafe {
            if let Some(prev) = old {
                std::env::set_var("HOME", prev);
            } else {
                std::env::remove_var("HOME");
            }
        }
        result
    }

    #[test]
    fn sandbox_tier_skips_all_checks() {
        with_home("/home/test", || {
            assert!(!is_path_denied_for_tier(
                "sandbox",
                "/home/test/.ssh/id_rsa"
            ));
            assert!(scan_command_for_denied_paths("sandbox", "cat ~/.ssh/id_rsa").is_none());
        });
    }

    #[test]
    fn host_tier_denies_exact_ssh_keys() {
        with_home("/home/test", || {
            for key in [
                "/home/test/.ssh/id_rsa",
                "/home/test/.ssh/id_ed25519",
                "/home/test/.ssh/authorized_keys",
                "/home/test/.ssh/config",
            ] {
                assert!(
                    is_path_denied_for_tier("host", key),
                    "must deny {key} on host tier"
                );
            }
        });
    }

    #[test]
    fn host_tier_denies_etc_sensitive() {
        assert!(is_path_denied_for_tier("host", "/etc/sudoers"));
        assert!(is_path_denied_for_tier("host", "/etc/shadow"));
        assert!(is_path_denied_for_tier("host", "/etc/aeqi/secrets.env"));
        assert!(is_path_denied_for_tier(
            "host",
            "/etc/sudoers.d/custom-rule"
        ));
        assert!(is_path_denied_for_tier(
            "host",
            "/etc/aeqi/something-else.toml"
        ));
    }

    #[test]
    fn host_tier_denies_cloud_creds_dirs() {
        with_home("/home/test", || {
            assert!(is_path_denied_for_tier(
                "host",
                "/home/test/.aws/credentials"
            ));
            assert!(is_path_denied_for_tier("host", "/home/test/.kube/config"));
            assert!(is_path_denied_for_tier(
                "host",
                "/home/test/.docker/config.json"
            ));
            assert!(is_path_denied_for_tier(
                "host",
                "/home/test/.config/gh/hosts.yml"
            ));
        });
    }

    #[test]
    fn host_tier_allows_normal_workspace_paths() {
        with_home("/home/test", || {
            assert!(!is_path_denied_for_tier(
                "host",
                "/home/test/projects/foo/Cargo.toml"
            ));
            assert!(!is_path_denied_for_tier("host", "/tmp/scratch.txt"));
            assert!(!is_path_denied_for_tier(
                "host",
                "/var/lib/aeqi/hosts/abc/aeqi.db"
            ));
        });
    }

    #[test]
    fn scan_catches_tilde_form_denies() {
        with_home("/home/test", || {
            assert!(scan_command_for_denied_paths("host", "cat ~/.ssh/id_rsa").is_some());
            assert!(scan_command_for_denied_paths("host", "echo X > /etc/sudoers").is_some());
            assert!(scan_command_for_denied_paths("host", "ls /home/test/.aws/").is_some());
        });
    }

    #[test]
    fn scan_passes_legitimate_workspace_commands() {
        with_home("/home/test", || {
            assert!(scan_command_for_denied_paths("host", "cargo build --release").is_none());
            assert!(scan_command_for_denied_paths("host", "git status").is_none());
            assert!(
                scan_command_for_denied_paths("host", "cat README.md && ls -la src/").is_none()
            );
        });
    }

    #[test]
    fn scan_reports_the_first_matched_needle() {
        with_home("/home/test", || {
            // Both /etc/sudoers (exact) and /etc/aeqi (prefix) could match;
            // contract is "first denied path encountered" — caller logs it
            // for diagnostics, the specific needle is not load-bearing.
            let cmd = "cat /etc/aeqi/secrets.env; rm /etc/sudoers";
            let found = scan_command_for_denied_paths("host", cmd);
            assert!(found.is_some());
        });
    }

    #[test]
    fn safe_write_root_unset_allows_all() {
        // No env set → all writes allowed by safe-root policy.
        // (Skipped if AEQI_WRITE_SAFE_ROOT is set in test env.)
        if std::env::var("AEQI_WRITE_SAFE_ROOT").is_err() {
            assert!(is_write_allowed_by_safe_root(Path::new("/tmp/anywhere")));
            assert!(is_write_allowed_by_safe_root(Path::new(
                "/home/test/work/file.txt"
            )));
        }
    }

    #[test]
    fn unknown_tier_defaults_to_strict() {
        // Unknown tier value → strict denylist applies (fail-closed).
        assert!(is_path_denied_for_tier("unknown-tier", "/etc/sudoers"));
        assert!(is_path_denied_for_tier("", "/etc/sudoers"));
    }
}
