//! Transport abstraction for MCP clients.
//!
//! MCP messages are line-delimited JSON-RPC 2.0 frames. Two transports
//! cover ~95% of real servers in 2026:
//!
//! * [`stdio`] — subprocess MCP server. We launch the child process,
//!   write requests to its stdin, and read framed JSON from stdout.
//! * [`sse`] — hosted MCP server, JSON-RPC over HTTP+SSE. We POST
//!   requests to a URL and listen for responses on the same connection's
//!   SSE stream.
//!
//! Both expose a uniform pair of [`mpsc`](tokio::sync::mpsc) channels —
//! one outbound (client → server, JSON strings) and one inbound (server →
//! client, JSON strings). The [`McpClient`](crate::client::McpClient)
//! sits on top and owns request/response correlation.
//!
//! Adding a new transport (websocket, HTTP-streaming, unix-socket) is a
//! single new sub-module — neither the client nor the registry change.

pub mod sse;
pub mod stdio;

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::errors::McpError;

/// Channels exposed by every transport. The transport owns the actual
/// I/O loop; the client publishes outbound messages on `outbound_tx` and
/// reads inbound on `inbound_rx`.
pub struct TransportChannels {
    pub outbound_tx: mpsc::Sender<String>,
    pub inbound_rx: mpsc::Receiver<String>,
    /// Notified once when the underlying I/O loop exits (subprocess
    /// crashed, SSE stream closed). Reconnection is the registry's job;
    /// the transport itself is one-shot.
    pub closed: tokio::sync::oneshot::Receiver<TransportClosed>,
}

#[derive(Debug, Clone)]
pub struct TransportClosed {
    pub reason: String,
}

#[async_trait]
pub trait Transport: Send + Sync {
    /// Bring the transport up. Spawns whatever background tasks are
    /// needed (subprocess child, SSE listener) and returns the
    /// uniform channel surface.
    async fn connect(&self) -> Result<TransportChannels, McpError>;

    /// Best-effort name for diagnostics.
    fn description(&self) -> String;
}
