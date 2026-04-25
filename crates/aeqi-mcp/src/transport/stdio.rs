//! Subprocess (stdio) transport.
//!
//! Spawns the configured command, pipes stdin / stdout / stderr, and
//! forwards line-delimited JSON-RPC messages between the in-process
//! channels and the subprocess's stdio.
//!
//! Each line on the child's stdout is treated as one JSON-RPC message.
//! Stderr is line-buffered and forwarded to `tracing::warn` so server
//! diagnostics remain visible without polluting the protocol stream.

use std::collections::HashMap;
use std::process::Stdio;

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, warn};

use super::{Transport, TransportChannels, TransportClosed};
use crate::errors::McpError;

#[derive(Debug, Clone)]
pub struct StdioTransport {
    pub command: String,
    pub args: Vec<String>,
    /// Extra environment variables — typically holds resolved credentials
    /// (`{"GITHUB_TOKEN": "ghp_..."}`).
    pub env: HashMap<String, String>,
    /// Optional working directory for the child.
    pub cwd: Option<std::path::PathBuf>,
}

impl StdioTransport {
    pub fn new(command: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            command: command.into(),
            args,
            env: HashMap::new(),
            cwd: None,
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(key.into(), value.into());
        self
    }
}

#[async_trait]
impl Transport for StdioTransport {
    async fn connect(&self) -> Result<TransportChannels, McpError> {
        let mut cmd = Command::new(&self.command);
        cmd.args(&self.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (k, v) in &self.env {
            cmd.env(k, v);
        }
        if let Some(dir) = &self.cwd {
            cmd.current_dir(dir);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| McpError::transport(format!("failed to spawn {}: {e}", self.command)))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| McpError::transport("subprocess stdin not piped"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| McpError::transport("subprocess stdout not piped"))?;
        let stderr = child.stderr.take();

        let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(64);
        let (inbound_tx, inbound_rx) = mpsc::channel::<String>(64);
        let (closed_tx, closed_rx) = oneshot::channel::<TransportClosed>();
        let closed_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(closed_tx)));

        // Writer task: drain outbound channel into stdin.
        let close_writer = closed_tx.clone();
        let mut child_stdin = stdin;
        tokio::spawn(async move {
            while let Some(msg) = outbound_rx.recv().await {
                let mut payload = msg;
                if !payload.ends_with('\n') {
                    payload.push('\n');
                }
                if let Err(e) = child_stdin.write_all(payload.as_bytes()).await {
                    warn!(error = %e, "mcp stdio writer failed");
                    if let Some(tx) = close_writer.lock().await.take() {
                        let _ = tx.send(TransportClosed {
                            reason: format!("writer error: {e}"),
                        });
                    }
                    break;
                }
                if let Err(e) = child_stdin.flush().await {
                    warn!(error = %e, "mcp stdio writer flush failed");
                    break;
                }
            }
        });

        // Reader task: forward each line of stdout into the inbound channel.
        let close_reader = closed_tx.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            loop {
                match reader.next_line().await {
                    Ok(Some(line)) => {
                        if line.trim().is_empty() {
                            continue;
                        }
                        if inbound_tx.send(line).await.is_err() {
                            break;
                        }
                    }
                    Ok(None) => {
                        debug!("mcp stdio reader: EOF");
                        if let Some(tx) = close_reader.lock().await.take() {
                            let _ = tx.send(TransportClosed {
                                reason: "subprocess stdout EOF".into(),
                            });
                        }
                        break;
                    }
                    Err(e) => {
                        warn!(error = %e, "mcp stdio reader error");
                        if let Some(tx) = close_reader.lock().await.take() {
                            let _ = tx.send(TransportClosed {
                                reason: format!("reader error: {e}"),
                            });
                        }
                        break;
                    }
                }
            }
        });

        // Stderr forwarder — best-effort.
        if let Some(stderr) = stderr {
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    warn!(target: "aeqi_mcp::stderr", "{line}");
                }
            });
        }

        // Child watcher: surface non-zero exits via the close channel.
        let close_child = closed_tx;
        tokio::spawn(async move {
            match child.wait().await {
                Ok(status) => {
                    debug!(?status, "mcp subprocess exited");
                    if let Some(tx) = close_child.lock().await.take() {
                        let _ = tx.send(TransportClosed {
                            reason: format!("subprocess exited: {status}"),
                        });
                    }
                }
                Err(e) => {
                    warn!(error = %e, "mcp subprocess wait failed");
                    if let Some(tx) = close_child.lock().await.take() {
                        let _ = tx.send(TransportClosed {
                            reason: format!("subprocess wait failed: {e}"),
                        });
                    }
                }
            }
        });

        Ok(TransportChannels {
            outbound_tx,
            inbound_rx,
            closed: closed_rx,
        })
    }

    fn description(&self) -> String {
        format!("stdio:{} {}", self.command, self.args.join(" "))
    }
}
