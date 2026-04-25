//! Single-server MCP client.
//!
//! Wraps a [`Transport`] and:
//!
//! * Drives the `initialize` handshake.
//! * Keeps a request id counter and a map from id → response sender so
//!   `tools/list` and `tools/call` can be awaited from any task.
//! * Forwards server-side notifications onto a [`broadcast`] channel that
//!   the [`McpRegistry`](crate::registry::McpRegistry) listens to.
//! * Surfaces transport closure via a oneshot so the registry can react
//!   (mark tools unavailable, schedule reconnect).
//!
//! The client is internally `Arc`-cloneable: every method takes `&self`
//! and uses interior mutability for the request map.

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use serde_json::{Value, json};
use tokio::sync::{Mutex, broadcast, oneshot};
use tokio::time::{Duration, timeout};
use tracing::{debug, warn};

use crate::errors::{McpError, McpReasonCode};
use crate::protocol::{
    ClientInfo, IncomingMessage, InitializeParams, InitializeResult, JsonRpcRequest,
    MCP_PROTOCOL_VERSION, McpToolDescriptor, NOTIFICATION_TOOLS_LIST_CHANGED, ToolCallResult,
};
use crate::transport::{Transport, TransportClosed};

/// Default per-call timeout — generous enough for slow LLM-backed tools,
/// tight enough that a hung server is surfaced quickly.
const DEFAULT_CALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Top-level client state, shared between the demuxer task and the
/// caller-facing methods.
struct Inner {
    next_id: AtomicU64,
    pending: Mutex<HashMap<u64, oneshot::Sender<IncomingMessage>>>,
    outbound: tokio::sync::mpsc::Sender<String>,
    /// `Some` once the transport closes — guards against double-close
    /// attempts and lets new requests fail fast with `Unavailable`.
    closed: Mutex<Option<TransportClosed>>,
    /// Broadcast channel for server-pushed notifications. Subscribers:
    /// the registry's reconnect loop, plus tests.
    notifications: broadcast::Sender<Notification>,
}

#[derive(Debug, Clone)]
pub enum Notification {
    /// `notifications/tools/list_changed` — server's catalogue updated.
    ToolsListChanged,
    /// Any other notification (the server may push log messages,
    /// progress events, etc.). Surface them but do not interpret.
    Other { method: String, params: Value },
}

/// Build a client by wiring a [`Transport`].
pub struct McpClientBuilder {
    transport: Arc<dyn Transport>,
    call_timeout: Duration,
}

impl McpClientBuilder {
    pub fn new(transport: Arc<dyn Transport>) -> Self {
        Self {
            transport,
            call_timeout: DEFAULT_CALL_TIMEOUT,
        }
    }

    pub fn with_call_timeout(mut self, t: Duration) -> Self {
        self.call_timeout = t;
        self
    }

    /// Bring the client up: connect the transport, run `initialize`,
    /// and start the inbound demuxer.
    pub async fn connect(self) -> Result<(McpClient, oneshot::Receiver<TransportClosed>), McpError> {
        let channels = self.transport.connect().await?;
        let (notifications_tx, _) = broadcast::channel(16);
        let inner = Arc::new(Inner {
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            outbound: channels.outbound_tx,
            closed: Mutex::new(None),
            notifications: notifications_tx,
        });
        let mut inbound_rx = channels.inbound_rx;
        let inner_demux = inner.clone();
        tokio::spawn(async move {
            while let Some(line) = inbound_rx.recv().await {
                Self::dispatch_inbound(&inner_demux, line).await;
            }
            debug!("mcp inbound demuxer exiting");
        });

        let client = McpClient {
            inner,
            call_timeout: self.call_timeout,
            description: self.transport.description(),
        };
        client.handshake().await?;
        Ok((client, channels.closed))
    }

    async fn dispatch_inbound(inner: &Arc<Inner>, line: String) {
        let parsed: IncomingMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(e) => {
                warn!(error = %e, line = %line, "mcp: failed to decode inbound message");
                return;
            }
        };
        match (parsed.id, &parsed.method) {
            (Some(id), _) => {
                // Response to one of our pending requests.
                let mut map = inner.pending.lock().await;
                if let Some(sender) = map.remove(&id) {
                    let _ = sender.send(parsed);
                } else {
                    warn!(id, "mcp: orphan response (no pending request)");
                }
            }
            (None, Some(method)) => {
                let params = parsed.params.unwrap_or(Value::Null);
                let notif = if method == NOTIFICATION_TOOLS_LIST_CHANGED {
                    Notification::ToolsListChanged
                } else {
                    Notification::Other {
                        method: method.clone(),
                        params,
                    }
                };
                // A slow consumer is OK — broadcast lossiness is fine.
                let _ = inner.notifications.send(notif);
            }
            _ => {
                warn!("mcp: malformed inbound (no id, no method)");
            }
        }
    }
}

#[derive(Clone)]
pub struct McpClient {
    inner: Arc<Inner>,
    call_timeout: Duration,
    description: String,
}

impl McpClient {
    /// Subscribe to server-side notifications. New subscribers see only
    /// notifications received after `subscribe` returns.
    pub fn subscribe(&self) -> broadcast::Receiver<Notification> {
        self.inner.notifications.subscribe()
    }

    pub fn description(&self) -> &str {
        &self.description
    }

    async fn handshake(&self) -> Result<(), McpError> {
        let params = InitializeParams {
            protocol_version: MCP_PROTOCOL_VERSION,
            capabilities: json!({}),
            client_info: ClientInfo {
                name: "aeqi",
                version: env!("CARGO_PKG_VERSION"),
            },
        };
        let raw = self.request("initialize", Some(serde_json::to_value(&params).unwrap())).await?;
        let parsed: InitializeResult = serde_json::from_value(raw).map_err(|e| {
            McpError::protocol(format!("initialize result decode failed: {e}"))
        })?;
        debug!(
            protocol = ?parsed.protocol_version,
            server = ?parsed.server_info,
            "mcp initialize ok"
        );
        // Spec: client must send `notifications/initialized` after the
        // initialize response. We fire-and-forget; a server that rejects
        // it will close the transport and the registry will reconnect.
        let init_complete = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {},
        });
        let _ = self
            .inner
            .outbound
            .send(serde_json::to_string(&init_complete).unwrap())
            .await;
        Ok(())
    }

    /// `tools/list` — return every tool the server currently exposes.
    pub async fn list_tools(&self) -> Result<Vec<McpToolDescriptor>, McpError> {
        let raw = self.request("tools/list", None).await?;
        let tools = raw
            .get("tools")
            .cloned()
            .ok_or_else(|| McpError::protocol("tools/list: missing 'tools' field"))?;
        let parsed: Vec<McpToolDescriptor> = serde_json::from_value(tools).map_err(|e| {
            McpError::protocol(format!("tools/list decode failed: {e}"))
        })?;
        Ok(parsed)
    }

    /// `tools/call` — invoke a tool by its server-side name.
    pub async fn call_tool(&self, name: &str, args: Value) -> Result<ToolCallResult, McpError> {
        let params = json!({
            "name": name,
            "arguments": args,
        });
        let raw = self.request("tools/call", Some(params)).await?;
        let parsed: ToolCallResult = serde_json::from_value(raw)
            .map_err(|e| McpError::protocol(format!("tools/call decode failed: {e}")))?;
        Ok(parsed)
    }

    /// Send a JSON-RPC request and await the matching response.
    ///
    /// Returns the response's `result` field on success, or maps the
    /// JSON-RPC error code to a stable [`McpReasonCode`].
    async fn request(&self, method: &str, params: Option<Value>) -> Result<Value, McpError> {
        // Refuse new requests if the transport already closed.
        {
            let closed = self.inner.closed.lock().await;
            if let Some(ref c) = *closed {
                return Err(McpError::unavailable(format!(
                    "mcp transport closed: {}",
                    c.reason
                )));
            }
        }

        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            id,
            method,
            params,
        };
        let payload = serde_json::to_string(&req)
            .map_err(|e| McpError::protocol(format!("encode failed: {e}")))?;

        let (tx, rx) = oneshot::channel();
        {
            let mut map = self.inner.pending.lock().await;
            map.insert(id, tx);
        }

        if let Err(e) = self.inner.outbound.send(payload).await {
            let mut map = self.inner.pending.lock().await;
            map.remove(&id);
            return Err(McpError::transport(format!("outbound send failed: {e}")));
        }

        let response = match timeout(self.call_timeout, rx).await {
            Ok(Ok(msg)) => msg,
            Ok(Err(_)) => {
                return Err(McpError::transport("response channel dropped"));
            }
            Err(_) => {
                let mut map = self.inner.pending.lock().await;
                map.remove(&id);
                return Err(McpError::timeout(format!(
                    "method '{method}' timed out after {:?}",
                    self.call_timeout
                )));
            }
        };

        if let Some(err) = response.error {
            return Err(McpError {
                code: McpReasonCode::from_jsonrpc(err.code),
                message: format!("server error {}: {}", err.code, err.message),
            });
        }
        response
            .result
            .ok_or_else(|| McpError::protocol("response missing both result and error"))
    }

    /// Mark the transport closed. Subsequent requests return
    /// `Unavailable` instead of hanging on a now-dead writer.
    pub async fn mark_closed(&self, reason: TransportClosed) {
        let mut closed = self.inner.closed.lock().await;
        *closed = Some(reason);
    }
}
