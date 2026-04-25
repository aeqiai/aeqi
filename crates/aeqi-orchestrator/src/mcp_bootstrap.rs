//! Wire `meta:mcp-servers` → live [`McpRegistry`](aeqi_mcp::McpRegistry).
//!
//! Read the operator-edited TOML body from the seed idea, parse via
//! [`McpServersConfig`](aeqi_mcp::McpServersConfig), and install each
//! server. Returns the constructed registry so the caller can inject it
//! into the [`SessionManager`](crate::session_manager::SessionManager)
//! and snapshot it from CLI surfaces (`aeqi doctor mcp`, future UI).
//!
//! When the seed body is empty, missing, or fails to parse, this
//! function still returns `Ok(None)` so the daemon boots cleanly with
//! no MCP integration enabled. A parse error is logged but does not
//! abort startup — the operator should fix the body and reload.

use std::sync::Arc;

use aeqi_core::credentials::CredentialResolver;
use aeqi_core::traits::IdeaStore;
use aeqi_mcp::{McpRegistry, McpServersConfig};
use tracing::{info, warn};

/// Read the seed idea, parse the TOML body, and install each declared
/// server. Returns the registry handle on success.
///
/// Returns `Ok(None)` for: missing idea, empty body, parse error
/// (logged), zero servers parsed.
pub async fn bootstrap_mcp_registry(
    idea_store: Option<&Arc<dyn IdeaStore>>,
    credentials: Option<CredentialResolver>,
) -> anyhow::Result<Option<Arc<McpRegistry>>> {
    let store = match idea_store {
        Some(s) => s,
        None => return Ok(None),
    };
    let idea = match store.get_by_name("meta:mcp-servers", None).await? {
        Some(i) => i,
        None => {
            info!("meta:mcp-servers idea not present — no MCP servers will be connected");
            return Ok(None);
        }
    };
    let cfg = match McpServersConfig::from_toml(&idea.content) {
        Ok(c) => c,
        Err(e) => {
            warn!(error = %e, "meta:mcp-servers TOML parse failed — skipping MCP boot");
            return Ok(None);
        }
    };
    if cfg.servers.is_empty() {
        info!("meta:mcp-servers body has no [[server]] entries — MCP integration disabled");
        return Ok(None);
    }
    let registry = Arc::new(McpRegistry::new(credentials));
    for server in &cfg.servers {
        if let Err(e) = registry.install_server(server.clone()).await {
            warn!(server = %server.name, error = %e, "mcp install_server failed");
        } else {
            info!(server = %server.name, transport = ?server.transport, "mcp server installed");
        }
    }
    Ok(Some(registry))
}
