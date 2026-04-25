//! Server-Sent Events transport for hosted MCP servers.
//!
//! The MCP spec ships a "JSON-RPC over SSE" pattern (the
//! `transport-streamable-http-client` family in `rmcp`):
//!
//! 1. Client opens a long-lived `GET <url>` with `Accept: text/event-stream`.
//!    The server responds with an SSE stream. Each `data: …` line is one
//!    JSON-RPC message **from the server** (responses + notifications).
//! 2. Client `POST <url>` with the JSON-RPC request body for any outbound
//!    message; the server queues the matching response on the SSE stream.
//!
//! Authentication: a resolved bearer token (typically OAuth2) is attached
//! as `Authorization: Bearer <token>` to both the GET and the POST. Per-
//! server config can also inject extra headers (`x-api-key`, etc.).
//!
//! This implementation deliberately covers only the request/response
//! shape — it does not yet support the "session id" cookie pattern some
//! servers use to multiplex multiple SSE connections, or HTTP/2 server
//! push. Both can be added on top of this module without rippling into
//! the client.

use async_trait::async_trait;
use futures::StreamExt;
use std::collections::HashMap;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, warn};

use super::{Transport, TransportChannels, TransportClosed};
use crate::errors::McpError;

#[derive(Debug, Clone)]
pub struct SseTransport {
    pub url: String,
    pub headers: HashMap<String, String>,
}

impl SseTransport {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            headers: HashMap::new(),
        }
    }

    pub fn with_header(mut self, k: impl Into<String>, v: impl Into<String>) -> Self {
        self.headers.insert(k.into(), v.into());
        self
    }
}

#[async_trait]
impl Transport for SseTransport {
    async fn connect(&self) -> Result<TransportChannels, McpError> {
        let client = reqwest::Client::builder()
            .build()
            .map_err(|e| McpError::transport(format!("reqwest client build failed: {e}")))?;
        let url = self.url.clone();
        let mut sse_req = client.get(&url).header("Accept", "text/event-stream");
        for (k, v) in &self.headers {
            sse_req = sse_req.header(k.as_str(), v.as_str());
        }
        let resp = sse_req
            .send()
            .await
            .map_err(|e| McpError::transport(format!("SSE GET failed: {e}")))?;
        if !resp.status().is_success() {
            return Err(McpError::transport(format!(
                "SSE GET returned {}",
                resp.status()
            )));
        }

        let (outbound_tx, mut outbound_rx) = mpsc::channel::<String>(64);
        let (inbound_tx, inbound_rx) = mpsc::channel::<String>(64);
        let (closed_tx, closed_rx) = oneshot::channel::<TransportClosed>();
        let closed_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(closed_tx)));

        // Reader task — split the byte stream on newlines and emit each
        // `data: …` block.
        let close_reader = closed_tx.clone();
        let mut byte_stream = resp.bytes_stream();
        tokio::spawn(async move {
            let mut buf = String::new();
            let mut current_event = String::new();
            while let Some(chunk) = byte_stream.next().await {
                let chunk = match chunk {
                    Ok(b) => b,
                    Err(e) => {
                        warn!(error = %e, "mcp sse reader stream error");
                        if let Some(tx) = close_reader.lock().await.take() {
                            let _ = tx.send(TransportClosed {
                                reason: format!("sse stream error: {e}"),
                            });
                        }
                        break;
                    }
                };
                let s = match std::str::from_utf8(&chunk) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                buf.push_str(s);
                while let Some(idx) = buf.find('\n') {
                    let line = buf[..idx].to_string();
                    buf.drain(..=idx);
                    let trimmed = line.trim_end_matches('\r');
                    if trimmed.is_empty() {
                        // Empty line — dispatch the accumulated event.
                        if !current_event.is_empty() {
                            let payload = std::mem::take(&mut current_event);
                            if inbound_tx.send(payload).await.is_err() {
                                break;
                            }
                        }
                        continue;
                    }
                    if let Some(rest) = trimmed.strip_prefix("data:") {
                        let data = rest.trim_start();
                        if !current_event.is_empty() {
                            current_event.push('\n');
                        }
                        current_event.push_str(data);
                    }
                    // Other field lines (`event:`, `id:`, `retry:`) are
                    // intentionally ignored — MCP cares only about `data:`.
                }
            }
            debug!("mcp sse reader: stream ended");
            if let Some(tx) = close_reader.lock().await.take() {
                let _ = tx.send(TransportClosed {
                    reason: "sse stream ended".into(),
                });
            }
        });

        // Writer task — POST each outbound message to the same URL.
        let close_writer = closed_tx;
        let writer_headers = self.headers.clone();
        let writer_url = url;
        tokio::spawn(async move {
            while let Some(msg) = outbound_rx.recv().await {
                let mut req = client
                    .post(&writer_url)
                    .header("Content-Type", "application/json")
                    .body(msg);
                for (k, v) in &writer_headers {
                    req = req.header(k.as_str(), v.as_str());
                }
                if let Err(e) = req.send().await {
                    warn!(error = %e, "mcp sse writer POST failed");
                    if let Some(tx) = close_writer.lock().await.take() {
                        let _ = tx.send(TransportClosed {
                            reason: format!("sse POST error: {e}"),
                        });
                    }
                    break;
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
        format!("sse:{}", self.url)
    }
}
