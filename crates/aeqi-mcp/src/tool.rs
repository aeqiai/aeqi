//! `McpTool` — adapter that surfaces an MCP-side tool through aeqi's
//! [`Tool`](aeqi_core::traits::Tool) trait.
//!
//! Each `McpTool` holds:
//!
//! * The aeqi-side full name (`mcp:<server>:<tool>`).
//! * A weak handle to the [`McpRegistry`](crate::registry::McpRegistry) so
//!   the tool resolves the live [`McpClient`](crate::client::McpClient) at
//!   call time (and can fail with `unavailable` if the server has
//!   crashed).
//! * The original [`McpToolDescriptor`] so we can hand the input schema
//!   to the LLM without re-fetching `tools/list`.
//!
//! The tool's `execute` path translates aeqi's argument JSON to MCP's
//! `tools/call` shape, awaits the response, and maps protocol errors to
//! the stable [`McpReasonCode`](crate::errors::McpReasonCode) surface.

use aeqi_core::traits::{Tool, ToolResult, ToolSpec};
use async_trait::async_trait;
use tracing::warn;

use crate::errors::McpError;
use crate::protocol::McpToolDescriptor;
use crate::registry::McpRegistryHandle;

pub struct McpTool {
    /// `mcp:<server>:<tool>` — the fully-qualified aeqi name.
    full_name: String,
    /// Server prefix, used to look up the live client.
    server_name: String,
    /// Server-side tool name, sent verbatim in `tools/call`.
    remote_name: String,
    descriptor: McpToolDescriptor,
    handle: McpRegistryHandle,
}

impl McpTool {
    pub fn new(
        server_name: String,
        descriptor: McpToolDescriptor,
        handle: McpRegistryHandle,
    ) -> Self {
        let full_name = format!("mcp:{}:{}", server_name, descriptor.name);
        Self {
            full_name,
            server_name,
            remote_name: descriptor.name.clone(),
            descriptor,
            handle,
        }
    }

    pub fn full_name(&self) -> &str {
        &self.full_name
    }

    pub fn server_name(&self) -> &str {
        &self.server_name
    }
}

#[async_trait]
impl Tool for McpTool {
    async fn execute(&self, args: serde_json::Value) -> anyhow::Result<ToolResult> {
        let client = match self.handle.client_for(&self.server_name).await {
            Some(c) => c,
            None => {
                let err = McpError::unavailable(format!(
                    "mcp server '{}' is not connected",
                    self.server_name
                ));
                return Ok(mcp_error_to_tool_result(err, &self.full_name));
            }
        };

        match client.call_tool(&self.remote_name, args).await {
            Ok(call) => {
                let mut output = call.to_output_string();
                if output.is_empty() && call.structured_content.is_some() {
                    output = call
                        .structured_content
                        .as_ref()
                        .map(|v| v.to_string())
                        .unwrap_or_default();
                }
                let mut result = if call.is_error {
                    ToolResult::error(output)
                } else {
                    ToolResult::success(output)
                };
                if let Some(data) = call.structured_content {
                    result = result.with_data(data);
                }
                Ok(result)
            }
            Err(err) => {
                warn!(
                    tool = %self.full_name,
                    code = %err.code,
                    message = %err.message,
                    "mcp tool call failed"
                );
                Ok(mcp_error_to_tool_result(err, &self.full_name))
            }
        }
    }

    fn spec(&self) -> ToolSpec {
        ToolSpec {
            name: self.full_name.clone(),
            description: self
                .descriptor
                .description
                .clone()
                .unwrap_or_else(|| format!("MCP tool from server {}", self.server_name)),
            input_schema: self.descriptor.input_schema.clone(),
        }
    }

    fn name(&self) -> &str {
        &self.full_name
    }

    fn is_concurrent_safe(&self, _input: &serde_json::Value) -> bool {
        // We can't introspect MCP tools' side-effect profiles, so the
        // safe default is "not concurrent-safe" — the agent will
        // sequence them. Operators who know better can shadow specific
        // MCP tools with native wrappers.
        false
    }
}

fn mcp_error_to_tool_result(err: McpError, tool_name: &str) -> ToolResult {
    ToolResult::error(format!("[{}] {}: {}", err.code, tool_name, err.message))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::errors::McpReasonCode;

    /// The error formatter must surface the stable reason code so callers
    /// (UI, agents) can map it back to a [`McpReasonCode`] without parsing
    /// free-form prose.
    #[test]
    fn mcp_error_to_tool_result_carries_reason_code() {
        let err = McpError::new(McpReasonCode::Unavailable, "server crashed");
        let r = mcp_error_to_tool_result(err, "mcp:demo:thing");
        assert!(r.is_error);
        assert!(r.output.contains("unavailable"));
        assert!(r.output.contains("mcp:demo:thing"));
        assert!(r.output.contains("server crashed"));
    }
}
