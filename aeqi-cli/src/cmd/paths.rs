use aeqi_core::AEQIConfig;
use aeqi_core::config::AuthMode;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

const CONFIG_FILE: &str = "aeqi.toml";

pub(crate) fn cmd_paths(config_path: &Option<PathBuf>) -> Result<()> {
    let report = PathsReport::resolve(config_path.as_deref())?;
    report.print();
    Ok(())
}

#[derive(Debug, PartialEq, Eq)]
enum ConfigStatus {
    Found,
    Missing,
}

struct PathsReport {
    config_status: ConfigStatus,
    config_path: PathBuf,
    data_dir: PathBuf,
    secrets_dir: PathBuf,
    agent_dir: PathBuf,
    project_dir: PathBuf,
    daemon_socket: PathBuf,
    dashboard_url: String,
    dashboard_auth: &'static str,
}

impl PathsReport {
    fn resolve(explicit_config: Option<&Path>) -> Result<Self> {
        let cwd = std::env::current_dir().context("failed to determine current directory")?;
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
        let env_config = std::env::var_os("AEQI_CONFIG").map(PathBuf::from);
        let config_path = match explicit_config {
            Some(path) => path.to_path_buf(),
            None => discover_config_path(&cwd, &home, env_config.as_deref())
                .unwrap_or_else(|| default_config_path(&home)),
        };

        Self::from_config_path(config_path, &home)
    }

    fn from_config_path(config_path: PathBuf, home: &Path) -> Result<Self> {
        let config_status = if config_path.exists() {
            ConfigStatus::Found
        } else {
            ConfigStatus::Missing
        };

        let (data_dir, web_bind, dashboard_auth, dashboard_base_url) =
            if config_status == ConfigStatus::Found {
                let config = load_path_config(&config_path)?;
                let data_dir = expand_tilde(&config.aeqi.data_dir, home);
                (
                    data_dir,
                    config.web.bind,
                    auth_mode_label(config.web.auth.mode),
                    config.web.auth.base_url,
                )
            } else {
                (
                    default_data_dir(home),
                    "127.0.0.1:8400".to_string(),
                    "secret",
                    None,
                )
            };

        let workspace_root = runtime_file_root(&config_path);
        let daemon_socket = data_dir.join("rm.sock");
        let dashboard_url =
            dashboard_base_url.unwrap_or_else(|| dashboard_url_from_bind(&web_bind));

        Ok(Self {
            config_status,
            config_path,
            secrets_dir: data_dir.join("secrets"),
            agent_dir: workspace_root.join("agents"),
            project_dir: workspace_root.join("projects"),
            daemon_socket,
            dashboard_url,
            dashboard_auth,
            data_dir,
        })
    }

    fn print(&self) {
        println!("AEQI paths");
        println!("Config: {}", self.config_path.display());
        match self.config_status {
            ConfigStatus::Found => println!("Config status: found"),
            ConfigStatus::Missing => {
                println!("Config status: not found (run `aeqi setup`)");
            }
        }
        println!("Data dir: {}", self.data_dir.display());
        println!("Secrets dir: {}", self.secrets_dir.display());
        println!("Agent dir: {}", self.agent_dir.display());
        println!("Project dir: {}", self.project_dir.display());
        println!("Daemon socket: {}", self.daemon_socket.display());
        println!("Dashboard URL: {}", self.dashboard_url);
        println!("Dashboard auth: {}", self.dashboard_auth);
    }
}

fn load_path_config(path: &Path) -> Result<AEQIConfig> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("failed to read config: {}", path.display()))?;
    toml::from_str(&content).context("failed to parse aeqi.toml")
}

fn discover_config_path(cwd: &Path, home: &Path, env_config: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = env_config {
        return Some(path.to_path_buf());
    }

    for dir in cwd.ancestors() {
        let candidate = dir.join(CONFIG_FILE);
        if candidate.exists() {
            return Some(candidate);
        }

        let candidate = dir.join("config").join(CONFIG_FILE);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let candidate = default_config_path(home);
    candidate.exists().then_some(candidate)
}

fn default_config_path(home: &Path) -> PathBuf {
    default_data_dir(home).join(CONFIG_FILE)
}

fn default_data_dir(home: &Path) -> PathBuf {
    home.join(".aeqi")
}

fn runtime_file_root(config_path: &Path) -> PathBuf {
    let Some(parent) = config_path.parent() else {
        return PathBuf::from(".");
    };

    if parent.file_name().and_then(|name| name.to_str()) == Some("config")
        && let Some(workspace) = parent.parent()
    {
        return workspace.to_path_buf();
    }

    parent.to_path_buf()
}

fn expand_tilde(path: &str, home: &Path) -> PathBuf {
    if path == "~" {
        return home.to_path_buf();
    }

    if let Some(rest) = path.strip_prefix("~/") {
        return home.join(rest);
    }

    PathBuf::from(path)
}

fn dashboard_url_from_bind(bind: &str) -> String {
    if bind.starts_with("http://") || bind.starts_with("https://") {
        return bind.to_string();
    }

    let host_port = bind
        .strip_prefix("0.0.0.0:")
        .map(|port| format!("127.0.0.1:{port}"))
        .unwrap_or_else(|| bind.to_string());

    format!("http://{host_port}")
}

fn auth_mode_label(mode: AuthMode) -> &'static str {
    match mode {
        AuthMode::None => "none",
        AuthMode::Secret => "secret",
        AuthMode::Accounts => "accounts",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_config_uses_default_home_layout() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let report = PathsReport::from_config_path(default_config_path(&home), &home).unwrap();

        assert_eq!(report.config_status, ConfigStatus::Missing);
        assert_eq!(report.config_path, home.join(".aeqi/aeqi.toml"));
        assert_eq!(report.data_dir, home.join(".aeqi"));
        assert_eq!(report.secrets_dir, home.join(".aeqi/secrets"));
        assert_eq!(report.agent_dir, home.join(".aeqi/agents"));
        assert_eq!(report.project_dir, home.join(".aeqi/projects"));
        assert_eq!(report.daemon_socket, home.join(".aeqi/rm.sock"));
        assert_eq!(report.dashboard_url, "http://127.0.0.1:8400");
        assert_eq!(report.dashboard_auth, "secret");
    }

    #[test]
    fn found_config_uses_configured_paths_without_opening_runtime_stores() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let config_path = temp.path().join("aeqi.toml");
        std::fs::write(
            &config_path,
            r#"
[aeqi]
name = "test"
data_dir = "~/custom-aeqi"

[web]
bind = "0.0.0.0:8501"
uds_bind = "~/custom-aeqi/web.sock"

[web.auth]
mode = "accounts"
base_url = "https://example.test"
"#,
        )
        .unwrap();

        let report = PathsReport::from_config_path(config_path.clone(), &home).unwrap();

        assert_eq!(report.config_status, ConfigStatus::Found);
        assert_eq!(report.config_path, config_path);
        assert_eq!(report.data_dir, home.join("custom-aeqi"));
        assert_eq!(report.daemon_socket, home.join("custom-aeqi/rm.sock"));
        assert_eq!(report.dashboard_url, "https://example.test");
        assert_eq!(report.dashboard_auth, "accounts");
    }

    #[test]
    fn workspace_config_reports_checkout_agent_and_project_dirs() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let workspace = temp.path().join("workspace");
        let config_path = workspace.join("config/aeqi.toml");
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        std::fs::write(
            &config_path,
            r#"
[aeqi]
name = "test"
data_dir = "~/.aeqi"
"#,
        )
        .unwrap();

        let report = PathsReport::from_config_path(config_path, &home).unwrap();

        assert_eq!(report.data_dir, home.join(".aeqi"));
        assert_eq!(report.secrets_dir, home.join(".aeqi/secrets"));
        assert_eq!(report.agent_dir, workspace.join("agents"));
        assert_eq!(report.project_dir, workspace.join("projects"));
        assert_eq!(report.daemon_socket, home.join(".aeqi/rm.sock"));
    }

    #[test]
    fn discovers_workspace_config_before_home_config() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let workspace = temp.path().join("workspace");
        let nested = workspace.join("a/b");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(home.join(".aeqi")).unwrap();
        std::fs::write(home.join(".aeqi/aeqi.toml"), "").unwrap();
        let workspace_config = workspace.join("config/aeqi.toml");
        std::fs::create_dir_all(workspace_config.parent().unwrap()).unwrap();
        std::fs::write(&workspace_config, "").unwrap();

        assert_eq!(
            discover_config_path(&nested, &home, None),
            Some(workspace_config)
        );
    }
}
