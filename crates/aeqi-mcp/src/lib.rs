//! `aeqi-mcp` — Model Context Protocol (MCP) client.
//!
//! Surfaces tools exposed by any MCP server (Anthropic reference servers,
//! community servers, future first-party Workspace / GitHub servers) as
//! `Arc<dyn aeqi_core::traits::Tool>` instances ready to be inserted into
//! aeqi's [`aeqi_core::tool_registry::ToolRegistry`].
//!
//! # Crate choice
//!
//! Implemented hand-rolled over JSON-RPC 2.0 + tokio rather than wrapping the
//! third-party `rmcp` crate. Rationale recorded in
//! `crates/aeqi-mcp/README` (TODO) and the T1.10 final report:
//!
//! * `rmcp` 1.5 ships its own connection model (`ServiceExt`, typed handlers)
//!   that does not slot cleanly into our [`Tool`](aeqi_core::traits::Tool) +
//!   [`ToolRegistry`](aeqi_core::tool_registry::ToolRegistry) abstraction.
//!   Wrapping it would mean two layers of dispatch / reconnect / ACL
//!   bookkeeping.
//! * MCP's wire protocol — JSON-RPC 2.0 with a small set of methods
//!   (`initialize`, `tools/list`, `tools/call`) and one notification
//!   (`notifications/tools/list_changed`) — is ~500 LOC to implement directly
//!   and gives us tight control over reconnect, ACL, and credential
//!   injection.
//! * Tests ship an in-process [`mock`] transport that speaks the same
//!   protocol — no `npx`-based fixtures, no external Node runtime.
//!
//! # Surface
//!
//! * [`config`] — TOML deserialisation for the `meta:mcp-servers` seed-idea
//!   body.
//! * [`transport`] — `Transport` trait + stdio + SSE implementations.
//! * [`client::McpClient`] — single-server connection: handshake, request /
//!   response correlation, notification stream.
//! * [`registry::McpRegistry`] — orchestrates multiple servers with
//!   reconnect-on-disconnect and exposes their tools as
//!   `Vec<Arc<dyn Tool>>`.
//! * [`tool::McpTool`] — adapter that implements
//!   [`aeqi_core::traits::Tool`] for a single MCP-exposed tool, including
//!   credential resolution + structured-error translation.

pub mod client;
pub mod config;
pub mod errors;
pub mod mock;
pub mod protocol;
pub mod registry;
pub mod tool;
pub mod transport;

pub use client::{McpClient, McpClientBuilder};
pub use config::{McpServerConfig, McpServerCredentialNeed, McpServersConfig, TransportKind};
pub use errors::{McpError, McpReasonCode};
pub use protocol::{McpToolDescriptor, ToolCallResult};
pub use registry::{McpRegistry, McpRegistryHandle};
pub use tool::McpTool;
