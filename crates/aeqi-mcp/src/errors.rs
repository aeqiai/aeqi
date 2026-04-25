//! Stable error / reason-code surface for MCP failures.
//!
//! Mirrors the closed-enum pattern used by
//! [`aeqi_core::credentials::CredentialReasonCode`]: agents and any future
//! `aeqi doctor mcp` surface read these strings as a public contract, so
//! cases get added by extending the enum, not by inventing new strings
//! out-of-band.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpReasonCode {
    /// MCP server has not yet been spawned, or is reconnecting.
    Unavailable,
    /// MCP server returned a JSON-RPC error.
    ProtocolError,
    /// Tool argument validation failed before the call left the client.
    InvalidArgs,
    /// Tool name did not match a registered MCP-side tool.
    UnknownTool,
    /// Caller is not allowed to invoke this MCP tool (CallerKind ACL deny).
    CallerDenied,
    /// Credential needed for this server failed to resolve.
    MissingCredential,
    /// Transport failure (subprocess crashed, SSE stream closed, ...).
    TransportError,
    /// Client-side timeout elapsed before the server replied.
    Timeout,
}

impl McpReasonCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unavailable => "unavailable",
            Self::ProtocolError => "protocol_error",
            Self::InvalidArgs => "invalid_args",
            Self::UnknownTool => "unknown_tool",
            Self::CallerDenied => "caller_denied",
            Self::MissingCredential => "missing_credential",
            Self::TransportError => "transport_error",
            Self::Timeout => "timeout",
        }
    }

    /// Map a JSON-RPC `code` from a server response to the matching aeqi
    /// reason code. Unknown codes collapse to [`Self::ProtocolError`].
    ///
    /// JSON-RPC codes covered:
    ///
    /// * `-32700` parse error / `-32600` invalid request → `protocol_error`
    /// * `-32601` method not found → `unknown_tool`
    /// * `-32602` invalid params → `invalid_args`
    /// * `-32603` internal error → `protocol_error`
    pub fn from_jsonrpc(code: i64) -> Self {
        match code {
            -32601 => Self::UnknownTool,
            -32602 => Self::InvalidArgs,
            _ => Self::ProtocolError,
        }
    }
}

impl std::fmt::Display for McpReasonCode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Error)]
pub struct McpError {
    pub code: McpReasonCode,
    pub message: String,
}

impl std::fmt::Display for McpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl McpError {
    pub fn new(code: McpReasonCode, msg: impl Into<String>) -> Self {
        Self {
            code,
            message: msg.into(),
        }
    }

    pub fn unavailable(msg: impl Into<String>) -> Self {
        Self::new(McpReasonCode::Unavailable, msg)
    }

    pub fn protocol(msg: impl Into<String>) -> Self {
        Self::new(McpReasonCode::ProtocolError, msg)
    }

    pub fn transport(msg: impl Into<String>) -> Self {
        Self::new(McpReasonCode::TransportError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(McpReasonCode::Timeout, msg)
    }
}
