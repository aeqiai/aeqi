//! MCP wire types — JSON-RPC 2.0 envelopes + the small subset of MCP
//! methods this client speaks.
//!
//! aeqi only needs the *client* side of the spec: it issues `initialize`,
//! `tools/list`, `tools/call`, and listens for the
//! `notifications/tools/list_changed` notification. Other MCP capabilities
//! (resources, prompts, sampling, roots) are intentionally not modelled —
//! adding them is additive and only touches this module.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Protocol version aeqi advertises in the `initialize` handshake. Matches
/// the 2025-06-18 revision that ships with `rmcp` 1.5.
pub const MCP_PROTOCOL_VERSION: &str = "2025-06-18";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest<'a> {
    pub jsonrpc: &'a str,
    pub id: u64,
    pub method: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

/// Either a response to a request, or a notification we received from the
/// server. We disambiguate on the presence of `id`.
#[derive(Debug, Clone, Deserialize)]
pub struct IncomingMessage {
    #[serde(default)]
    pub id: Option<u64>,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<JsonRpcErrorObject>,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct JsonRpcErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

/// A tool descriptor returned by `tools/list`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDescriptor {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// JSON-Schema describing the tool's input shape. Pass-through to LLM
    /// function-calling.
    #[serde(default = "default_input_schema", rename = "inputSchema")]
    pub input_schema: Value,
}

fn default_input_schema() -> Value {
    serde_json::json!({"type": "object"})
}

/// Result returned by `tools/call`. The MCP spec wraps the actual content
/// in a `content[]` array (sequence of text/image/resource blocks). We
/// flatten to a string for aeqi's `ToolResult.output`.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ToolCallResult {
    #[serde(default)]
    pub content: Vec<ToolContentBlock>,
    #[serde(default, rename = "isError")]
    pub is_error: bool,
    /// Some servers ship `structuredContent`; pass-through into
    /// [`ToolResult::data`](aeqi_core::traits::ToolResult::data).
    #[serde(default, rename = "structuredContent")]
    pub structured_content: Option<Value>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ToolContentBlock {
    Text {
        text: String,
    },
    Image {
        #[serde(default)]
        data: String,
        #[serde(default, rename = "mimeType")]
        mime_type: String,
    },
    Resource {
        #[serde(default)]
        resource: Value,
    },
    /// Unknown block kinds are preserved as opaque JSON so a future server
    /// extension doesn't break our deserialiser.
    #[serde(other)]
    Unknown,
}

impl ToolCallResult {
    /// Render the content array as a single string suitable for aeqi's
    /// `ToolResult::output`. Text blocks are concatenated with newlines;
    /// non-text blocks fall back to a `[image:mime]` placeholder.
    pub fn to_output_string(&self) -> String {
        let mut out = String::new();
        for (i, block) in self.content.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            match block {
                ToolContentBlock::Text { text } => out.push_str(text),
                ToolContentBlock::Image { mime_type, .. } => {
                    let mt = if mime_type.is_empty() {
                        "image/*"
                    } else {
                        mime_type.as_str()
                    };
                    out.push_str(&format!("[image:{mt}]"));
                }
                ToolContentBlock::Resource { resource } => {
                    out.push_str(&format!("[resource:{resource}]"));
                }
                ToolContentBlock::Unknown => out.push_str("[unknown-content]"),
            }
        }
        out
    }
}

/// `initialize` request params.
#[derive(Debug, Clone, Serialize)]
pub struct InitializeParams<'a> {
    #[serde(rename = "protocolVersion")]
    pub protocol_version: &'a str,
    pub capabilities: Value,
    #[serde(rename = "clientInfo")]
    pub client_info: ClientInfo<'a>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientInfo<'a> {
    pub name: &'a str,
    pub version: &'a str,
}

/// `initialize` response shape — we only care that the server reported
/// matching protocol semantics + may declare a `tools` capability.
#[derive(Debug, Clone, Deserialize)]
pub struct InitializeResult {
    #[serde(default, rename = "protocolVersion")]
    pub protocol_version: Option<String>,
    #[serde(default)]
    pub capabilities: Value,
    #[serde(default, rename = "serverInfo")]
    pub server_info: Value,
}

/// Server pushes this when its tool catalogue changes. We respond by
/// re-running `tools/list` and re-registering with the client owner.
pub const NOTIFICATION_TOOLS_LIST_CHANGED: &str = "notifications/tools/list_changed";
