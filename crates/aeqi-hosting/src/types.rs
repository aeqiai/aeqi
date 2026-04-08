use serde::{Deserialize, Serialize};

/// Top-level hosting configuration.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct HostingConfig {
    /// Provider type: "local", "managed", or "none".
    pub provider: String,
    /// Configuration for LocalProvider.
    pub local: Option<LocalConfig>,
    /// Configuration for ManagedProvider.
    pub managed: Option<ManagedConfig>,
}

/// Configuration for LocalProvider (manages nginx/systemd/certbot directly).
#[derive(Debug, Clone, Deserialize)]
pub struct LocalConfig {
    /// Directory for nginx site configs (default: /etc/nginx/sites-available).
    #[serde(default = "default_nginx_available")]
    pub nginx_available_dir: String,
    /// Directory for nginx enabled symlinks (default: /etc/nginx/sites-enabled).
    #[serde(default = "default_nginx_enabled")]
    pub nginx_enabled_dir: String,
    /// Path to certbot binary (default: certbot).
    #[serde(default = "default_certbot")]
    pub certbot_bin: String,
    /// Certbot email for SSL registration.
    pub certbot_email: Option<String>,
    /// Port range for app allocation.
    #[serde(default = "default_port_start")]
    pub port_range_start: u16,
    #[serde(default = "default_port_end")]
    pub port_range_end: u16,
    /// State file for tracking deployments.
    #[serde(default = "default_state_file")]
    pub state_file: String,
}

impl Default for LocalConfig {
    fn default() -> Self {
        Self {
            nginx_available_dir: default_nginx_available(),
            nginx_enabled_dir: default_nginx_enabled(),
            certbot_bin: default_certbot(),
            certbot_email: None,
            port_range_start: default_port_start(),
            port_range_end: default_port_end(),
            state_file: default_state_file(),
        }
    }
}

fn default_nginx_available() -> String { "/etc/nginx/sites-available".into() }
fn default_nginx_enabled() -> String { "/etc/nginx/sites-enabled".into() }
fn default_certbot() -> String { "certbot".into() }
fn default_port_start() -> u16 { 3100 }
fn default_port_end() -> u16 { 3999 }
fn default_state_file() -> String { "/var/lib/aeqi/hosting.json".into() }

/// Configuration for ManagedProvider (calls aeqi-cloud API).
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ManagedConfig {
    /// URL of the aeqi-cloud API.
    pub cloud_url: String,
    /// Auth token for the API.
    pub auth_token: Option<String>,
}

/// App deployment configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// Human-readable app name (used as identifier).
    pub name: String,
    /// App type: "nextjs", "static", "node", "custom".
    pub app_type: String,
    /// Working directory where the app lives.
    pub workdir: String,
    /// Build command (e.g., "npm run build").
    pub build_cmd: Option<String>,
    /// Start command (e.g., "npx next start").
    pub start_cmd: Option<String>,
    /// Environment variables.
    #[serde(default)]
    pub env: Vec<(String, String)>,
    /// Port the app listens on internally (if known). Otherwise auto-allocated.
    pub port: Option<u16>,
}

/// Result of deploying an app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deployment {
    pub app_id: String,
    pub name: String,
    pub port: u16,
    pub status: AppState,
}

/// Current status of a deployed app.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStatus {
    pub app_id: String,
    pub name: String,
    pub port: u16,
    pub state: AppState,
    pub workdir: String,
    pub domains: Vec<String>,
    pub created_at: String,
}

/// App lifecycle state.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AppState {
    Running,
    Stopped,
    Failed,
    Building,
}

/// Domain routing info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainInfo {
    pub domain: String,
    pub app_id: String,
    pub ssl: bool,
    pub created_at: String,
}
