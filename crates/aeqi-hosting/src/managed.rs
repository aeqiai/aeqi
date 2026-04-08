use anyhow::{Context, Result, bail};
use async_trait::async_trait;
use tracing::info;

use crate::{AppConfig, AppStatus, Deployment, DomainInfo, HostingProvider, ManagedConfig};

/// Managed hosting provider — delegates to aeqi-cloud API.
/// Used by containerized instances (Trial/Starter tiers).
pub struct ManagedProvider {
    config: ManagedConfig,
    client: reqwest::Client,
}

impl ManagedProvider {
    pub fn new(config: ManagedConfig) -> Result<Self> {
        if config.cloud_url.is_empty() {
            bail!("managed provider cloud_url must not be empty");
        }
        if !config.cloud_url.starts_with("http://") && !config.cloud_url.starts_with("https://") {
            bail!(
                "managed provider cloud_url must start with http:// or https://, got: {}",
                config.cloud_url
            );
        }
        Ok(Self {
            config,
            client: reqwest::Client::new(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.config.cloud_url.trim_end_matches('/'), path)
    }

    fn auth_header(&self) -> Option<(&str, String)> {
        self.config
            .auth_token
            .as_ref()
            .map(|token| ("Authorization", format!("Bearer {token}")))
    }

    async fn post<T: serde::Serialize, R: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &T,
    ) -> Result<R> {
        let mut req = self.client.post(self.url(path)).json(body);
        if let Some((key, value)) = self.auth_header() {
            req = req.header(key, value);
        }
        let resp = req.send().await.context("managed provider request failed")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("aeqi-cloud API error {status}: {body}");
        }
        resp.json().await.context("failed to parse response")
    }

    async fn get<R: serde::de::DeserializeOwned>(&self, path: &str) -> Result<R> {
        let mut req = self.client.get(self.url(path));
        if let Some((key, value)) = self.auth_header() {
            req = req.header(key, value);
        }
        let resp = req.send().await.context("managed provider request failed")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("aeqi-cloud API error {status}: {body}");
        }
        resp.json().await.context("failed to parse response")
    }

    async fn delete(&self, path: &str) -> Result<()> {
        let mut req = self.client.delete(self.url(path));
        if let Some((key, value)) = self.auth_header() {
            req = req.header(key, value);
        }
        let resp = req.send().await.context("managed provider request failed")?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            bail!("aeqi-cloud API error {status}: {body}");
        }
        Ok(())
    }
}

#[async_trait]
impl HostingProvider for ManagedProvider {
    async fn deploy_app(&self, config: &AppConfig) -> Result<Deployment> {
        let result: Deployment = self.post("/api/hosting/apps", config).await?;
        info!(app = %result.name, port = result.port, "app deployed via managed provider");
        Ok(result)
    }

    async fn stop_app(&self, app_id: &str) -> Result<()> {
        self.delete(&format!(
            "/api/hosting/apps/{}",
            urlencoding::encode(app_id)
        ))
        .await?;
        info!(app = %app_id, "app stopped via managed provider");
        Ok(())
    }

    async fn restart_app(&self, app_id: &str) -> Result<()> {
        let _: serde_json::Value = self
            .post(
                &format!(
                    "/api/hosting/apps/{}/restart",
                    urlencoding::encode(app_id)
                ),
                &(),
            )
            .await?;
        info!(app = %app_id, "app restarted via managed provider");
        Ok(())
    }

    async fn list_apps(&self) -> Result<Vec<AppStatus>> {
        self.get("/api/hosting/apps").await
    }

    async fn add_domain(&self, domain: &str, app_id: &str) -> Result<DomainInfo> {
        #[derive(serde::Serialize)]
        struct AddDomain<'a> {
            domain: &'a str,
            app_id: &'a str,
        }
        let result: DomainInfo = self
            .post("/api/hosting/domains", &AddDomain { domain, app_id })
            .await?;
        info!(domain, app_id, "domain added via managed provider");
        Ok(result)
    }

    async fn remove_domain(&self, domain: &str) -> Result<()> {
        self.delete(&format!(
            "/api/hosting/domains/{}",
            urlencoding::encode(domain)
        ))
        .await?;
        info!(domain, "domain removed via managed provider");
        Ok(())
    }

    async fn list_domains(&self) -> Result<Vec<DomainInfo>> {
        self.get("/api/hosting/domains").await
    }

    fn mode(&self) -> &'static str {
        "managed"
    }
}
