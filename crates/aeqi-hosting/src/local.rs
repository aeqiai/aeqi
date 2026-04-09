use anyhow::{Context, Result, bail};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use tokio::process::Command;
use tracing::{info, warn};

use crate::{AppConfig, AppState, AppStatus, Deployment, DomainInfo, HostingProvider, LocalConfig};

/// Validate a domain name per RFC 1035 / RFC 1123.
/// Allows alphanumeric, dots, hyphens. Labels must be 1-63 chars, total 1-253 chars.
/// Labels cannot start or end with a hyphen. Must have at least 2 labels.
fn validate_domain(domain: &str) -> Result<()> {
    if domain.is_empty() || domain.len() > 253 {
        bail!("domain must be 1-253 characters");
    }
    if !domain
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        bail!("domain contains invalid characters (only alphanumeric, dots, hyphens allowed)");
    }

    let labels: Vec<&str> = domain.split('.').collect();
    if labels.len() < 2 {
        bail!("domain must have at least two labels (e.g., example.com)");
    }
    for label in &labels {
        if label.is_empty() || label.len() > 63 {
            bail!("each domain label must be 1-63 characters");
        }
        if label.starts_with('-') || label.ends_with('-') {
            bail!("domain labels cannot start or end with a hyphen");
        }
    }

    Ok(())
}

/// Validate an app name — alphanumeric, hyphens, and underscores only, 1-64 chars.
fn validate_app_name(name: &str) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        bail!("app name must be 1-64 characters");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        bail!(
            "app name '{}' contains invalid characters (only alphanumeric, hyphens, underscores allowed)",
            name
        );
    }
    Ok(())
}

/// Validate that a path is absolute and doesn't contain null bytes.
fn validate_path(path: &str, label: &str) -> Result<()> {
    if path.is_empty() {
        bail!("{label} must not be empty");
    }
    if !path.starts_with('/') {
        bail!("{label} must be an absolute path");
    }
    if path.contains('\0') {
        bail!("{label} contains null bytes");
    }
    Ok(())
}

/// Sanitize a value for use in systemd unit files — escape newlines and quotes.
fn sanitize_systemd_value(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\n', "\\n")
        .replace('\r', "")
        .replace('"', "\\\"")
}

/// Persistent state tracking all deployments and domains.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct HostingState {
    apps: HashMap<String, AppRecord>,
    domains: HashMap<String, DomainRecord>,
    next_port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppRecord {
    app_id: String,
    name: String,
    port: u16,
    workdir: String,
    app_type: String,
    start_cmd: Option<String>,
    service_name: String,
    created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DomainRecord {
    domain: String,
    app_id: String,
    ssl: bool,
    nginx_conf: String,
    created_at: String,
}

pub struct LocalProvider {
    config: LocalConfig,
    /// Mutex to prevent concurrent state modifications.
    state_lock: Mutex<()>,
}

impl LocalProvider {
    pub fn new(config: LocalConfig) -> Result<Self> {
        if config.port_range_start >= config.port_range_end {
            bail!(
                "port_range_start ({}) must be less than port_range_end ({})",
                config.port_range_start,
                config.port_range_end
            );
        }

        // Ensure state directory exists.
        if let Some(parent) = Path::new(&config.state_file).parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create state dir: {}", parent.display()))?;
        }

        Ok(Self {
            config,
            state_lock: Mutex::new(()),
        })
    }

    fn load_state(&self) -> HostingState {
        match std::fs::read_to_string(&self.config.state_file) {
            Ok(data) => serde_json::from_str(&data).unwrap_or_else(|e| {
                warn!(
                    path = %self.config.state_file,
                    error = %e,
                    "state file corrupted, using default"
                );
                HostingState {
                    next_port: self.config.port_range_start,
                    ..Default::default()
                }
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => HostingState {
                next_port: self.config.port_range_start,
                ..Default::default()
            },
            Err(e) => {
                warn!(
                    path = %self.config.state_file,
                    error = %e,
                    "failed to read state file, using default"
                );
                HostingState {
                    next_port: self.config.port_range_start,
                    ..Default::default()
                }
            }
        }
    }

    /// Atomic write: write to temp file, then rename.
    fn save_state(&self, state: &HostingState) -> Result<()> {
        let data = serde_json::to_string_pretty(state)?;
        let tmp = format!("{}.tmp", self.config.state_file);
        std::fs::write(&tmp, &data)
            .with_context(|| format!("failed to write temp state file: {tmp}"))?;
        std::fs::rename(&tmp, &self.config.state_file)
            .with_context(|| format!("failed to rename state file: {}", self.config.state_file))?;
        Ok(())
    }

    fn allocate_port(&self, state: &mut HostingState) -> Result<u16> {
        let used: std::collections::HashSet<u16> = state.apps.values().map(|a| a.port).collect();

        for port in self.config.port_range_start..=self.config.port_range_end {
            if !used.contains(&port) {
                state.next_port = port + 1;
                return Ok(port);
            }
        }
        bail!(
            "no available ports in range {}-{}",
            self.config.port_range_start,
            self.config.port_range_end
        )
    }

    fn service_name(app_name: &str) -> String {
        // app_name is already validated to be [a-zA-Z0-9_-] so this is safe.
        format!("aeqi-app-{}", app_name.to_ascii_lowercase())
    }

    fn generate_systemd_unit(record: &AppRecord, env: &[(String, String)]) -> String {
        let exec_start =
            sanitize_systemd_value(record.start_cmd.as_deref().unwrap_or("npx next start"));

        let hostname_flag = match record.app_type.as_str() {
            "nextjs" | "node" => format!(" --hostname 127.0.0.1 -p {}", record.port),
            _ => String::new(),
        };

        let name = sanitize_systemd_value(&record.name);
        let workdir = sanitize_systemd_value(&record.workdir);

        let env_lines: String = env
            .iter()
            .map(|(k, v)| {
                let k = sanitize_systemd_value(k);
                let v = sanitize_systemd_value(v);
                format!("Environment=\"{k}={v}\"")
            })
            .collect::<Vec<_>>()
            .join("\n");

        format!(
            r#"[Unit]
Description=AEQI Hosted App: {name}
After=network.target

[Service]
Type=simple
User=claudedev
Group=claudedev
WorkingDirectory={workdir}
ExecStart={exec_start}{hostname_flag}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT={port}
{env_lines}

[Install]
WantedBy=multi-user.target
"#,
            name = name,
            workdir = workdir,
            exec_start = exec_start,
            hostname_flag = hostname_flag,
            port = record.port,
            env_lines = env_lines,
        )
    }

    fn generate_nginx_config(domain: &str, port: u16) -> String {
        // domain is pre-validated by validate_domain() to contain only [a-zA-Z0-9.-]
        format!(
            r#"# Managed by AEQI hosting — do not edit manually
server {{
    server_name {domain};

    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {{
        proxy_pass http://127.0.0.1:{port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }}

    listen 80;
}}
"#,
            domain = domain,
            port = port,
        )
    }

    async fn write_systemd_service(
        &self,
        record: &AppRecord,
        env: &[(String, String)],
    ) -> Result<()> {
        let unit = Self::generate_systemd_unit(record, env);
        let path = format!("/etc/systemd/system/{}.service", record.service_name);

        tokio::fs::write(&path, &unit)
            .await
            .with_context(|| format!("failed to write systemd unit: {path}"))?;

        // Reload systemd.
        let output = Command::new("systemctl")
            .args(["daemon-reload"])
            .output()
            .await
            .context("failed to run systemctl daemon-reload")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("systemctl daemon-reload failed: {stderr}");
        }

        Ok(())
    }

    async fn start_service(&self, service_name: &str) -> Result<()> {
        let output = Command::new("systemctl")
            .args(["start", service_name])
            .output()
            .await
            .context("failed to run systemctl start")?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("failed to start service {service_name}: {stderr}");
        }

        // Enable on boot.
        if let Err(e) = Command::new("systemctl")
            .args(["enable", service_name])
            .output()
            .await
        {
            warn!(service_name, error = %e, "failed to enable service on boot");
        }

        Ok(())
    }

    async fn stop_service(&self, service_name: &str) -> Result<()> {
        if let Err(e) = Command::new("systemctl")
            .args(["stop", service_name])
            .output()
            .await
        {
            warn!(service_name, error = %e, "failed to stop service");
        }
        if let Err(e) = Command::new("systemctl")
            .args(["disable", service_name])
            .output()
            .await
        {
            warn!(service_name, error = %e, "failed to disable service");
        }
        Ok(())
    }

    async fn remove_service(&self, service_name: &str) -> Result<()> {
        self.stop_service(service_name).await?;
        let path = format!("/etc/systemd/system/{service_name}.service");
        if let Err(e) = tokio::fs::remove_file(&path).await {
            warn!(path, error = %e, "failed to remove systemd unit file");
        }
        if let Err(e) = Command::new("systemctl")
            .args(["daemon-reload"])
            .output()
            .await
        {
            warn!(error = %e, "failed to run systemctl daemon-reload after service removal");
        }
        Ok(())
    }

    async fn write_nginx_config(&self, domain: &str, port: u16) -> Result<String> {
        let config = Self::generate_nginx_config(domain, port);
        let conf_name = format!("{domain}.conf");
        let available_path = format!("{}/{conf_name}", self.config.nginx_available_dir);
        let enabled_path = format!("{}/{conf_name}", self.config.nginx_enabled_dir);

        tokio::fs::write(&available_path, &config)
            .await
            .with_context(|| format!("failed to write nginx config: {available_path}"))?;

        // Symlink to sites-enabled.
        let _ = tokio::fs::remove_file(&enabled_path).await;
        tokio::fs::symlink(&available_path, &enabled_path)
            .await
            .with_context(|| format!("failed to symlink: {enabled_path}"))?;

        // Test and reload nginx.
        let test = Command::new("nginx")
            .args(["-t"])
            .output()
            .await
            .context("failed to run nginx -t")?;
        if !test.status.success() {
            // Rollback on bad config.
            let _ = tokio::fs::remove_file(&enabled_path).await;
            let _ = tokio::fs::remove_file(&available_path).await;
            let stderr = String::from_utf8_lossy(&test.stderr);
            bail!("nginx config test failed: {stderr}");
        }

        let reload = Command::new("systemctl")
            .args(["reload", "nginx"])
            .output()
            .await
            .context("failed to run systemctl reload nginx")?;
        if !reload.status.success() {
            let stderr = String::from_utf8_lossy(&reload.stderr);
            bail!("failed to reload nginx: {stderr}");
        }

        Ok(conf_name)
    }

    async fn remove_nginx_config(&self, domain: &str) -> Result<()> {
        let conf_name = format!("{domain}.conf");
        let available_path = format!("{}/{conf_name}", self.config.nginx_available_dir);
        let enabled_path = format!("{}/{conf_name}", self.config.nginx_enabled_dir);

        if let Err(e) = tokio::fs::remove_file(&enabled_path).await
            && e.kind() != std::io::ErrorKind::NotFound
        {
            warn!(path = %enabled_path, error = %e, "failed to remove nginx enabled symlink");
        }
        if let Err(e) = tokio::fs::remove_file(&available_path).await
            && e.kind() != std::io::ErrorKind::NotFound
        {
            warn!(path = %available_path, error = %e, "failed to remove nginx config");
        }

        if let Err(e) = Command::new("systemctl")
            .args(["reload", "nginx"])
            .output()
            .await
        {
            warn!(error = %e, "failed to reload nginx after config removal");
        }

        Ok(())
    }

    async fn obtain_ssl(&self, domain: &str) -> Result<bool> {
        let mut cmd = Command::new(&self.config.certbot_bin);
        cmd.args([
            "certonly",
            "--nginx",
            "-d",
            domain,
            "--non-interactive",
            "--agree-tos",
        ]);

        // Pass email as a separate arg to prevent injection.
        match &self.config.certbot_email {
            Some(email) => {
                cmd.args(["--email", email]);
            }
            None => {
                cmd.arg("--register-unsafely-without-email");
            }
        }

        let output = cmd.output().await.context("failed to run certbot")?;

        if output.status.success() {
            // Certbot modifies the nginx config to add SSL. Reload.
            if let Err(e) = Command::new("systemctl")
                .args(["reload", "nginx"])
                .output()
                .await
            {
                warn!(error = %e, "failed to reload nginx after SSL cert");
            }
            info!(domain, "SSL certificate obtained");
            Ok(true)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            warn!(domain, error = %stderr, "certbot failed — serving HTTP only");
            Ok(false)
        }
    }

    async fn check_service_active(&self, service_name: &str) -> AppState {
        let output = Command::new("systemctl")
            .args(["is-active", service_name])
            .output()
            .await;

        match output {
            Ok(o) => match String::from_utf8_lossy(&o.stdout).trim() {
                "active" => AppState::Running,
                "failed" => AppState::Failed,
                "activating" => AppState::Building,
                _ => AppState::Stopped,
            },
            Err(e) => {
                warn!(service_name, error = %e, "failed to check service status");
                AppState::Stopped
            }
        }
    }
}

#[async_trait]
impl HostingProvider for LocalProvider {
    async fn deploy_app(&self, config: &AppConfig) -> Result<Deployment> {
        // Validate inputs before touching any state.
        validate_app_name(&config.name)?;
        validate_path(&config.workdir, "workdir")?;
        if let Some(cmd) = &config.start_cmd
            && cmd.is_empty()
        {
            bail!("start_cmd must not be empty if provided");
        }

        // Allocate port and register app under lock (synchronous).
        let (record, service_name) = {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            let mut state = self.load_state();

            if state.apps.contains_key(&config.name) {
                bail!("app '{}' already deployed", config.name);
            }

            let port = config.port.unwrap_or(self.allocate_port(&mut state)?);
            let service_name = Self::service_name(&config.name);
            let now = chrono::Utc::now().to_rfc3339();

            let record = AppRecord {
                app_id: config.name.clone(),
                name: config.name.clone(),
                port,
                workdir: config.workdir.clone(),
                app_type: config.app_type.clone(),
                start_cmd: config.start_cmd.clone(),
                service_name: service_name.clone(),
                created_at: now,
            };

            state.apps.insert(config.name.clone(), record.clone());
            self.save_state(&state)?;
            (record, service_name)
        };

        // Async operations outside the lock.
        self.write_systemd_service(&record, &config.env).await?;
        self.start_service(&service_name).await?;

        let port = record.port;
        info!(app = %config.name, port, "app deployed");

        Ok(Deployment {
            app_id: config.name.clone(),
            name: config.name.clone(),
            port,
            status: AppState::Running,
        })
    }

    async fn stop_app(&self, app_id: &str) -> Result<()> {
        let record = {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            let mut state = self.load_state();
            let record = state
                .apps
                .remove(app_id)
                .with_context(|| format!("app '{app_id}' not found"))?;

            // Remove any domains pointing to this app from state first.
            let domains_to_remove: Vec<String> = state
                .domains
                .iter()
                .filter(|(_, d)| d.app_id == app_id)
                .map(|(k, _)| k.clone())
                .collect();

            for domain in &domains_to_remove {
                state.domains.remove(domain);
            }

            self.save_state(&state)?;
            (record, domains_to_remove)
        };

        // Perform async cleanup outside the lock. These are best-effort.
        for domain in &record.1 {
            if let Err(e) = self.remove_nginx_config(domain).await {
                warn!(domain, error = %e, "failed to remove nginx config during app stop");
            }
        }
        if let Err(e) = self.remove_service(&record.0.service_name).await {
            warn!(app_id, error = %e, "failed to remove systemd service during app stop");
        }

        info!(app = %app_id, "app stopped and removed");
        Ok(())
    }

    async fn restart_app(&self, app_id: &str) -> Result<()> {
        let service_name = {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            let state = self.load_state();
            let record = state
                .apps
                .get(app_id)
                .with_context(|| format!("app '{app_id}' not found"))?;
            record.service_name.clone()
        };

        let output = Command::new("systemctl")
            .args(["restart", &service_name])
            .output()
            .await
            .context("failed to run systemctl restart")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            bail!("failed to restart service {service_name}: {stderr}");
        }

        info!(app = %app_id, "app restarted");
        Ok(())
    }

    async fn list_apps(&self) -> Result<Vec<AppStatus>> {
        let state = {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            self.load_state()
        };

        let mut result = Vec::new();

        for record in state.apps.values() {
            let app_state = self.check_service_active(&record.service_name).await;
            let domains: Vec<String> = state
                .domains
                .values()
                .filter(|d| d.app_id == record.app_id)
                .map(|d| d.domain.clone())
                .collect();

            result.push(AppStatus {
                app_id: record.app_id.clone(),
                name: record.name.clone(),
                port: record.port,
                state: app_state,
                workdir: record.workdir.clone(),
                domains,
                created_at: record.created_at.clone(),
            });
        }

        Ok(result)
    }

    async fn add_domain(&self, domain: &str, app_id: &str) -> Result<DomainInfo> {
        validate_domain(domain)?;

        let port = {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            let state = self.load_state();

            // Verify app exists.
            let record = state
                .apps
                .get(app_id)
                .with_context(|| format!("app '{app_id}' not found"))?;
            let port = record.port;

            // Check domain not already taken.
            if state.domains.contains_key(domain) {
                bail!("domain '{domain}' already configured");
            }
            port
        };

        // Write nginx config and reload (async, outside lock).
        let nginx_conf = self.write_nginx_config(domain, port).await?;

        // Attempt SSL.
        let ssl = self.obtain_ssl(domain).await.unwrap_or(false);

        // Re-acquire lock to save the domain record.
        let save_result: Result<String> = {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            let mut state = self.load_state();

            // Re-check domain wasn't added concurrently.
            if state.domains.contains_key(domain) {
                Err(anyhow::anyhow!("domain '{domain}' was added concurrently"))
            } else {
                let now = chrono::Utc::now().to_rfc3339();
                let domain_record = DomainRecord {
                    domain: domain.to_string(),
                    app_id: app_id.to_string(),
                    ssl,
                    nginx_conf,
                    created_at: now.clone(),
                };

                state.domains.insert(domain.to_string(), domain_record);
                self.save_state(&state)?;
                Ok(now)
            }
        };

        match save_result {
            Ok(created_at) => {
                info!(domain, app_id, ssl, "domain added");
                Ok(DomainInfo {
                    domain: domain.to_string(),
                    app_id: app_id.to_string(),
                    ssl,
                    created_at,
                })
            }
            Err(e) => {
                // Roll back nginx config outside the lock.
                let _ = self.remove_nginx_config(domain).await;
                Err(e)
            }
        }
    }

    async fn remove_domain(&self, domain: &str) -> Result<()> {
        validate_domain(domain)?;

        {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            let mut state = self.load_state();

            state
                .domains
                .remove(domain)
                .with_context(|| format!("domain '{domain}' not found"))?;

            self.save_state(&state)?;
        }

        // Async cleanup outside lock (best-effort).
        if let Err(e) = self.remove_nginx_config(domain).await {
            warn!(domain, error = %e, "failed to remove nginx config during domain removal");
        }

        info!(domain, "domain removed");
        Ok(())
    }

    async fn list_domains(&self) -> Result<Vec<DomainInfo>> {
        let state = {
            let _lock = self
                .state_lock
                .lock()
                .map_err(|_| anyhow::anyhow!("state lock poisoned"))?;
            self.load_state()
        };

        Ok(state
            .domains
            .values()
            .map(|d| DomainInfo {
                domain: d.domain.clone(),
                app_id: d.app_id.clone(),
                ssl: d.ssl,
                created_at: d.created_at.clone(),
            })
            .collect())
    }

    fn mode(&self) -> &'static str {
        "local"
    }
}
