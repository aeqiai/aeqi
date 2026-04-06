use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn render_user_service(config_path: &Path) -> Result<String> {
    if !cfg!(target_os = "linux") {
        anyhow::bail!("per-user service generation is currently supported on Linux systemd only");
    }

    let config_path = config_path
        .canonicalize()
        .with_context(|| format!("failed to resolve config path: {}", config_path.display()))?;
    let exe = std::env::current_exe().context("failed to locate current aeqi executable")?;
    let workspace_root = workspace_root_from_config(&config_path);

    Ok(format!(
        "[Unit]\n\
Description=AEQI daemon\n\
After=network-online.target\n\
Wants=network-online.target\n\
\n\
[Service]\n\
Type=simple\n\
WorkingDirectory={}\n\
Environment=AEQI_CONFIG={}\n\
ExecStart={} daemon start\n\
Restart=on-failure\n\
RestartSec=5\n\
\n\
[Install]\n\
WantedBy=default.target\n",
        workspace_root.display(),
        config_path.display(),
        exe.display(),
    ))
}

pub(crate) fn install_user_service(
    config_path: &Path,
    start: bool,
    force: bool,
) -> Result<(PathBuf, Vec<String>)> {
    let unit_path = user_service_path()?;
    if unit_path.exists() && !force {
        anyhow::bail!(
            "service file already exists: {} (re-run with --force to overwrite)",
            unit_path.display()
        );
    }

    if let Some(parent) = unit_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create service dir: {}", parent.display()))?;
    }

    let unit = render_user_service(config_path)?;
    std::fs::write(&unit_path, unit)
        .with_context(|| format!("failed to write service file: {}", unit_path.display()))?;

    let mut warnings = Vec::new();
    if systemctl_exists() {
        if let Err(e) = run_systemctl_user(["daemon-reload"]) {
            warnings.push(format!("systemctl --user daemon-reload failed: {e}"));
        }
        if let Err(e) = run_systemctl_user(["enable", "aeqi.service"]) {
            warnings.push(format!("systemctl --user enable failed: {e}"));
        }
        if start && let Err(e) = run_systemctl_user(["start", "aeqi.service"]) {
            warnings.push(format!("systemctl --user start failed: {e}"));
        }
    } else {
        warnings.push(
            "systemctl not found; service file was written but not activated automatically"
                .to_string(),
        );
    }

    Ok((unit_path, warnings))
}

pub(crate) fn uninstall_user_service(stop: bool) -> Result<(Option<PathBuf>, Vec<String>)> {
    let unit_path = user_service_path()?;
    let mut warnings = Vec::new();

    if systemctl_exists() {
        if stop && let Err(e) = run_systemctl_user(["stop", "aeqi.service"]) {
            warnings.push(format!("systemctl --user stop failed: {e}"));
        }
        if let Err(e) = run_systemctl_user(["disable", "aeqi.service"]) {
            warnings.push(format!("systemctl --user disable failed: {e}"));
        }
        if let Err(e) = run_systemctl_user(["daemon-reload"]) {
            warnings.push(format!("systemctl --user daemon-reload failed: {e}"));
        }
    }

    if unit_path.exists() {
        std::fs::remove_file(&unit_path)
            .with_context(|| format!("failed to remove service file: {}", unit_path.display()))?;
        if systemctl_exists()
            && let Err(e) = run_systemctl_user(["daemon-reload"])
        {
            warnings.push(format!("systemctl --user daemon-reload failed: {e}"));
        }
        Ok((Some(unit_path), warnings))
    } else {
        Ok((None, warnings))
    }
}

fn user_service_path() -> Result<PathBuf> {
    if !cfg!(target_os = "linux") {
        anyhow::bail!("per-user service management is currently supported on Linux systemd only");
    }

    let home = dirs::home_dir().context("failed to locate home directory")?;
    Ok(home.join(".config/systemd/user/aeqi.service"))
}

fn workspace_root_from_config(config_path: &Path) -> PathBuf {
    let parent = config_path.parent().unwrap_or_else(|| Path::new("."));
    if parent.file_name().and_then(|s| s.to_str()) == Some("config") {
        parent
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| parent.to_path_buf())
    } else {
        parent.to_path_buf()
    }
}

fn systemctl_exists() -> bool {
    std::env::var_os("PATH").is_some_and(|paths| {
        std::env::split_paths(&paths).any(|dir| dir.join("systemctl").exists())
    })
}

fn run_systemctl_user<const N: usize>(args: [&str; N]) -> Result<()> {
    let status = Command::new("systemctl")
        .arg("--user")
        .args(args)
        .status()
        .context("failed to invoke systemctl --user")?;
    if status.success() {
        Ok(())
    } else {
        anyhow::bail!("exited with status {status}");
    }
}
