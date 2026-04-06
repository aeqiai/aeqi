use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Client for the AEQI daemon's Unix socket IPC.
/// Protocol: one JSON line in → one JSON line out (or multiple for streaming).
#[derive(Debug, Clone)]
pub struct IpcClient {
    socket_path: PathBuf,
}

impl IpcClient {
    pub fn new(socket_path: PathBuf) -> Self {
        Self { socket_path }
    }

    /// Derive socket path from a data directory.
    pub fn from_data_dir(data_dir: &Path) -> Self {
        Self::new(data_dir.join("rm.sock"))
    }

    /// Get the socket path for direct connections.
    pub fn socket_path(&self) -> &Path {
        &self.socket_path
    }

    /// Send a JSON request and get a JSON response (with 10s timeout).
    pub async fn request(&self, request: &serde_json::Value) -> Result<serde_json::Value> {
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.request_inner(request),
        )
        .await
        .map_err(|_| anyhow::anyhow!("IPC request timed out after 10s"))?
    }

    async fn request_inner(&self, request: &serde_json::Value) -> Result<serde_json::Value> {
        if !self.socket_path.exists() {
            anyhow::bail!(
                "IPC socket not found: {}. Is the daemon running?",
                self.socket_path.display()
            );
        }

        let stream = tokio::net::UnixStream::connect(&self.socket_path)
            .await
            .with_context(|| {
                format!(
                    "failed to connect to IPC socket: {}",
                    self.socket_path.display()
                )
            })?;

        let (reader, mut writer) = stream.into_split();
        let mut req_bytes = serde_json::to_vec(request)?;
        req_bytes.push(b'\n');
        writer.write_all(&req_bytes).await?;

        let mut lines = BufReader::new(reader).lines();
        let Some(line) = lines.next_line().await? else {
            anyhow::bail!("IPC socket closed without response");
        };

        let response: serde_json::Value = serde_json::from_str(&line)?;
        Ok(response)
    }

    /// Send a request and read streaming JSON lines until the connection closes
    /// or a line with `"done": true` is received. Each line is passed to the callback.
    pub async fn request_stream<F>(
        &self,
        request: &serde_json::Value,
        mut on_event: F,
    ) -> Result<()>
    where
        F: FnMut(serde_json::Value) -> bool,
    {
        if !self.socket_path.exists() {
            anyhow::bail!(
                "IPC socket not found: {}. Is the daemon running?",
                self.socket_path.display()
            );
        }

        let stream = tokio::net::UnixStream::connect(&self.socket_path)
            .await
            .with_context(|| {
                format!(
                    "failed to connect to IPC socket: {}",
                    self.socket_path.display()
                )
            })?;

        let (reader, mut writer) = stream.into_split();
        let mut req_bytes = serde_json::to_vec(request)?;
        req_bytes.push(b'\n');
        writer.write_all(&req_bytes).await?;

        let mut lines = BufReader::new(reader).lines();
        while let Some(line) = lines.next_line().await? {
            let event: serde_json::Value = serde_json::from_str(&line)?;
            let is_done = event.get("done").and_then(|v| v.as_bool()).unwrap_or(false);
            let should_continue = on_event(event);
            if is_done || !should_continue {
                break;
            }
        }

        Ok(())
    }

    /// Convenience: send a simple command with no extra params.
    pub async fn cmd(&self, cmd: &str) -> Result<serde_json::Value> {
        self.request(&serde_json::json!({"cmd": cmd})).await
    }

    /// Convenience: send a command with params merged in.
    pub async fn cmd_with(
        &self,
        cmd: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value> {
        let mut req = params;
        req["cmd"] = serde_json::Value::String(cmd.to_string());
        self.request(&req).await
    }

    /// Send a streaming command — returns events via callback until done.
    pub async fn cmd_stream<F>(
        &self,
        cmd: &str,
        params: serde_json::Value,
        on_event: F,
    ) -> Result<()>
    where
        F: FnMut(serde_json::Value) -> bool,
    {
        let mut req = params;
        req["cmd"] = serde_json::Value::String(cmd.to_string());
        self.request_stream(&req, on_event).await
    }
}
