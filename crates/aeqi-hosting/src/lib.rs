mod local;
#[cfg(feature = "managed")]
mod managed;
mod types;

pub use local::LocalProvider;
#[cfg(feature = "managed")]
pub use managed::ManagedProvider;
pub use types::*;

use anyhow::Result;
use async_trait::async_trait;

/// Hosting provider trait — same interface for local (nginx/systemd/certbot) and managed.
#[async_trait]
pub trait HostingProvider: Send + Sync {
    /// Deploy an app. Creates the process, allocates a port, but does NOT set up domain routing.
    async fn deploy_app(&self, config: &AppConfig) -> Result<Deployment>;

    /// Stop and remove a deployed app.
    async fn stop_app(&self, app_id: &str) -> Result<()>;

    /// Restart a deployed app.
    async fn restart_app(&self, app_id: &str) -> Result<()>;

    /// List all deployed apps and their status.
    async fn list_apps(&self) -> Result<Vec<AppStatus>>;

    /// Add a domain route to an app (nginx config + SSL cert).
    async fn add_domain(&self, domain: &str, app_id: &str) -> Result<DomainInfo>;

    /// Remove a domain route.
    async fn remove_domain(&self, domain: &str) -> Result<()>;

    /// List all configured domains.
    async fn list_domains(&self) -> Result<Vec<DomainInfo>>;

    /// Get the provider mode name.
    fn mode(&self) -> &'static str;
}

/// Create a hosting provider from config.
pub fn from_config(config: &HostingConfig) -> Result<Box<dyn HostingProvider>> {
    match config.provider.as_str() {
        "local" => Ok(Box::new(LocalProvider::new(
            config.local.clone().unwrap_or_default(),
        )?)),
        #[cfg(feature = "managed")]
        "managed" => Ok(Box::new(ManagedProvider::new(
            config.managed.clone().unwrap_or_default(),
        )?)),
        #[cfg(not(feature = "managed"))]
        "managed" => anyhow::bail!("managed hosting provider is not available in this build"),
        "none" => Ok(Box::new(NoneProvider)),
        other => anyhow::bail!("unknown hosting provider: {other}"),
    }
}

/// No-op provider for trial tier (no hosting).
struct NoneProvider;

#[async_trait]
impl HostingProvider for NoneProvider {
    async fn deploy_app(&self, _config: &AppConfig) -> Result<Deployment> {
        anyhow::bail!("hosting is not enabled on this instance")
    }
    async fn stop_app(&self, _app_id: &str) -> Result<()> {
        anyhow::bail!("hosting is not enabled on this instance")
    }
    async fn restart_app(&self, _app_id: &str) -> Result<()> {
        anyhow::bail!("hosting is not enabled on this instance")
    }
    async fn list_apps(&self) -> Result<Vec<AppStatus>> {
        Ok(vec![])
    }
    async fn add_domain(&self, _domain: &str, _app_id: &str) -> Result<DomainInfo> {
        anyhow::bail!("hosting is not enabled on this instance")
    }
    async fn remove_domain(&self, _domain: &str) -> Result<()> {
        anyhow::bail!("hosting is not enabled on this instance")
    }
    async fn list_domains(&self) -> Result<Vec<DomainInfo>> {
        Ok(vec![])
    }
    fn mode(&self) -> &'static str {
        "none"
    }
}
