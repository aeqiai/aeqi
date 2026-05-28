//! End-to-end coverage for `aeqi setup`: clean home, idempotent re-run,
//! auth-secret preservation, and explicit workspace layout.
//!
//! Each test boots the debug `aeqi` binary against an isolated `$HOME`
//! and a neutral cwd, then asserts on the resulting filesystem. The
//! goal is to make the first 10 minutes of the user journey impossible
//! to misread — not to cover internal Rust APIs (those have unit tests).
//!
//! These tests intentionally don't shell out to a network: they run
//! `setup --runtime ollama_agent`, which doesn't require any provider
//! key. CI runs them as part of `cargo test --workspace`.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Locate the debug binary cargo built for this test run. `CARGO_BIN_EXE_aeqi`
/// is set by cargo for tests in the same crate as the bin target.
fn aeqi_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_aeqi"))
}

/// Run `aeqi <args>` with an isolated HOME and a neutral cwd. Returns the
/// captured stdout/stderr and the exit status. Inherits the parent's PATH
/// so the binary can find `sh` etc., but everything else is scrubbed.
fn run_aeqi(home: &Path, neutral_cwd: &Path, args: &[&str]) -> std::process::Output {
    Command::new(aeqi_bin())
        .args(args)
        .current_dir(neutral_cwd)
        .env_clear()
        .env("HOME", home)
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("XDG_CONFIG_HOME", home.join(".config"))
        .env("XDG_DATA_HOME", home.join(".local/share"))
        .output()
        .expect("failed to spawn aeqi binary")
}

/// Build a fresh tempdir layout: `$tmp/home` is the fake HOME, `$tmp/work`
/// is a neutral cwd that is NOT a workspace (no Cargo.toml / .git).
fn fresh_layout() -> tempfile::TempDir {
    let tmp = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(tmp.path().join("home")).unwrap();
    std::fs::create_dir_all(tmp.path().join("work")).unwrap();
    tmp
}

fn non_coverage_entries(path: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(path)
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) != Some("profraw"))
        .collect()
}

#[test]
fn setup_clean_home_writes_curl_install_layout() {
    let tmp = fresh_layout();
    let home = tmp.path().join("home");
    let cwd = tmp.path().join("work");

    let out = run_aeqi(&home, &cwd, &["setup", "--runtime", "ollama_agent"]);
    assert!(
        out.status.success(),
        "aeqi setup failed: stdout={}\nstderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    // Every starter file lands under ~/.aeqi/ (curl-install path),
    // NOT in the neutral cwd.
    let aeqi_dir = home.join(".aeqi");
    assert!(aeqi_dir.join("aeqi.toml").exists(), "aeqi.toml missing");
    assert!(aeqi_dir.join("agents/assistant/agent.md").exists());
    assert!(aeqi_dir.join("agents/shared/WORKFLOW.md").exists());
    assert!(aeqi_dir.join("secrets").exists());

    let toml = std::fs::read_to_string(aeqi_dir.join("aeqi.toml")).unwrap();
    let parsed: toml::Value = toml.parse().expect("config must be valid TOML");
    let first_agent_role = parsed
        .get("agents")
        .and_then(|agents| agents.as_array())
        .and_then(|agents| agents.first())
        .and_then(|agent| agent.get("role"))
        .and_then(|role| role.as_str());
    assert_eq!(
        first_agent_role,
        Some("orchestrator"),
        "setup must seed an orchestrator agent so `aeqi doctor --strict` can pass"
    );

    // Neutral cwd stays empty — setup must not have detected workspace mode.
    let unexpected_cwd_entries = non_coverage_entries(&cwd);
    assert!(
        unexpected_cwd_entries.is_empty(),
        "neutral cwd should be untouched but got: {:?}",
        unexpected_cwd_entries
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains(&format!("Runtime home: {}", aeqi_dir.display())),
        "setup should print the runtime home instead of an ambiguous workspace label: {stdout}"
    );
    assert!(
        !stdout.contains("Workspace:"),
        "plain setup should not label the home runtime as a workspace: {stdout}"
    );
}

#[test]
fn setup_writes_stable_web_auth_secret() {
    let tmp = fresh_layout();
    let home = tmp.path().join("home");
    let cwd = tmp.path().join("work");

    let out = run_aeqi(&home, &cwd, &["setup", "--runtime", "ollama_agent"]);
    assert!(out.status.success());

    let toml = std::fs::read_to_string(home.join(".aeqi/aeqi.toml")).unwrap();
    let parsed: toml::Value = toml.parse().expect("config must be valid TOML");
    let secret = parsed
        .get("web")
        .and_then(|w| w.get("auth_secret"))
        .and_then(|s| s.as_str())
        .expect("[web].auth_secret must be present after setup");
    assert!(
        secret.len() >= 32,
        "auth_secret should be a long random string, got {} chars",
        secret.len()
    );

    // Setup also prints the secret on stdout so the user can copy it.
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains(secret),
        "stdout must echo the generated secret so users see it"
    );
}

#[test]
fn setup_rerun_preserves_existing_auth_secret() {
    let tmp = fresh_layout();
    let home = tmp.path().join("home");
    let cwd = tmp.path().join("work");

    let first = run_aeqi(&home, &cwd, &["setup", "--runtime", "ollama_agent"]);
    assert!(first.status.success());

    let toml = std::fs::read_to_string(home.join(".aeqi/aeqi.toml")).unwrap();
    let secret_a = toml::from_str::<toml::Value>(&toml)
        .unwrap()
        .get("web")
        .and_then(|w| w.get("auth_secret"))
        .and_then(|s| s.as_str())
        .unwrap()
        .to_string();

    // Re-run setup with --force so the config is overwritten in place.
    let second = run_aeqi(
        &home,
        &cwd,
        &["setup", "--runtime", "ollama_agent", "--force"],
    );
    assert!(
        second.status.success(),
        "re-run failed: {}",
        String::from_utf8_lossy(&second.stderr)
    );

    let toml_b = std::fs::read_to_string(home.join(".aeqi/aeqi.toml")).unwrap();
    let secret_b = toml::from_str::<toml::Value>(&toml_b)
        .unwrap()
        .get("web")
        .and_then(|w| w.get("auth_secret"))
        .and_then(|s| s.as_str())
        .unwrap()
        .to_string();

    assert_eq!(
        secret_a, secret_b,
        "re-running setup must preserve the existing dashboard secret \
         so dashboard sessions don't get invalidated on every setup run"
    );
}

#[test]
fn setup_inside_checkout_defaults_to_home_layout() {
    let tmp = fresh_layout();
    let home = tmp.path().join("home");
    let cwd = tmp.path().join("work");

    // Mark cwd as a workspace by giving it a Cargo.toml. Plain setup should
    // still avoid writing runtime files into the source checkout.
    std::fs::write(cwd.join("Cargo.toml"), "[workspace]\nmembers = []\n").unwrap();

    let out = run_aeqi(&home, &cwd, &["setup", "--runtime", "ollama_agent"]);
    assert!(
        out.status.success(),
        "setup failed: stdout={}\nstderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    assert!(
        home.join(".aeqi/aeqi.toml").exists(),
        "plain setup inside a checkout should write config to ~/.aeqi/aeqi.toml"
    );
    assert!(
        !cwd.join("config/aeqi.toml").exists(),
        "plain setup should not create repo-local config"
    );
    assert!(
        !cwd.join("agents/assistant/agent.md").exists(),
        "plain setup should not create repo-local agents"
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("Detected a project checkout"),
        "setup should explain why it avoided writing into the checkout: {stdout}"
    );
    assert!(
        stdout.contains("aeqi setup --workspace"),
        "setup should show the explicit repo-local opt-in: {stdout}"
    );
    assert!(
        stdout.contains(&format!("Runtime home: {}", home.join(".aeqi").display())),
        "setup should print the home-scoped runtime path: {stdout}"
    );
}

#[test]
fn setup_workspace_flag_writes_to_cwd_not_home() {
    let tmp = fresh_layout();
    let home = tmp.path().join("home");
    let cwd = tmp.path().join("work");

    std::fs::write(cwd.join("Cargo.toml"), "[workspace]\nmembers = []\n").unwrap();

    let out = run_aeqi(
        &home,
        &cwd,
        &["setup", "--runtime", "ollama_agent", "--workspace"],
    );
    assert!(
        out.status.success(),
        "setup failed: stdout={}\nstderr={}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    assert!(cwd.join("config/aeqi.toml").exists());
    assert!(cwd.join("agents/assistant/agent.md").exists());

    // ~/.aeqi/ should NOT have a config in workspace mode (data_dir is
    // still ~/.aeqi for the secret store, but the toml lives in cwd).
    assert!(
        !home.join(".aeqi/aeqi.toml").exists(),
        "workspace mode should not write a config to ~/.aeqi/"
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains(&format!("Runtime home: {}", home.join(".aeqi").display())),
        "workspace setup should still show the runtime data home: {stdout}"
    );
    assert!(
        stdout.contains(&format!("Workspace files: {}", cwd.display())),
        "workspace setup should show where repo-local config and agents were written: {stdout}"
    );
}
