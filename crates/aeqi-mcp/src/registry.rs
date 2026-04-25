//! [`McpRegistry`] — orchestrates a set of MCP servers and surfaces their
//! tools as `Vec<Arc<dyn Tool>>` for aeqi's
//! [`ToolRegistry`](aeqi_core::tool_registry::ToolRegistry).
//!
//! Responsibilities:
//!
//! * Spawn each configured server (via [`Transport`]).
//! * Drive reconnect with exponential backoff on transport closure.
//! * Maintain a server-name → live client map shared with every
//!   [`McpTool`](crate::tool::McpTool).
//! * Listen for `notifications/tools/list_changed` and refresh the
//!   server's tool catalogue.
//! * Enforce per-server [`CallerKind`](aeqi_core::tool_registry::CallerKind)
//!   ACL — server config picks an allowlist; the registry installs
//!   `set_event_only` / `set_llm_only` flags accordingly.
//!
//! Per-server credential resolution happens here too: if a server
//! declares `requires_credential`, the registry resolves it via
//! T1.9's [`CredentialResolver`](aeqi_core::credentials::CredentialResolver)
//! and threads the result into the transport (env var / header / cli arg
//! per the server config). A required-but-missing credential leaves the
//! server in `Unavailable` state — its tools are still registered so the
//! LLM sees their schemas, but every call returns the stable
//! `missing_credential` reason code.

use std::collections::HashMap;
use std::sync::Arc;

use aeqi_core::credentials::{
    CredentialNeed, CredentialResolver, ResolutionScope, ScopeHint, UsableCredential,
};
use aeqi_core::traits::Tool;
use tokio::sync::{Mutex, RwLock};
use tokio::time::{Duration, sleep};
use tracing::{debug, info, warn};

use crate::client::{McpClient, McpClientBuilder, Notification};
use crate::config::{McpServerConfig, TransportKind};
use crate::errors::{McpError, McpReasonCode};
use crate::tool::McpTool;
use crate::transport::{Transport, sse::SseTransport, stdio::StdioTransport};

/// Per-server runtime entry. Holds the live client, the latest descriptors,
/// and the per-server caller-kind ACL.
struct ServerEntry {
    name: String,
    config: McpServerConfig,
    client: Option<McpClient>,
    descriptors: Vec<crate::protocol::McpToolDescriptor>,
    /// `Some(reason)` when the server is unavailable; tools registered
    /// for the server still exist but their `execute` returns the
    /// stable reason.
    unavailable_reason: Option<String>,
}

/// Snapshot of registered tools — the orchestrator clones this slice
/// straight into [`ToolRegistry`](aeqi_core::tool_registry::ToolRegistry).
#[derive(Default)]
pub struct McpToolSnapshot {
    pub tools: Vec<Arc<dyn Tool>>,
    /// Tool names whose registered server allows only `Llm` callers.
    pub llm_only: Vec<String>,
    /// Tool names whose registered server allows only `Event` callers.
    pub event_only: Vec<String>,
}

/// Public handle handed to every [`McpTool`]. Internally the same
/// `Arc<RwLock<...>>` the registry mutates.
#[derive(Clone)]
pub struct McpRegistryHandle {
    inner: Arc<RegistryInner>,
}

struct RegistryInner {
    servers: RwLock<HashMap<String, ServerEntry>>,
    /// Optional credential resolver (T1.9 substrate). When `None`,
    /// servers that declare `requires_credential` start in
    /// `unavailable` state.
    credentials: Option<CredentialResolver>,
}

impl McpRegistryHandle {
    pub async fn client_for(&self, server_name: &str) -> Option<McpClient> {
        let servers = self.inner.servers.read().await;
        servers.get(server_name).and_then(|e| e.client.clone())
    }

    pub async fn unavailable_reason(&self, server_name: &str) -> Option<String> {
        let servers = self.inner.servers.read().await;
        servers
            .get(server_name)
            .and_then(|e| e.unavailable_reason.clone())
    }
}

pub struct McpRegistry {
    handle: McpRegistryHandle,
    /// Background reconnect tasks — one per server.
    _join_handles: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl McpRegistry {
    /// Build a registry with no servers; call [`Self::install_server`] for
    /// each entry from the parsed `meta:mcp-servers` config.
    pub fn new(credentials: Option<CredentialResolver>) -> Self {
        Self {
            handle: McpRegistryHandle {
                inner: Arc::new(RegistryInner {
                    servers: RwLock::new(HashMap::new()),
                    credentials,
                }),
            },
            _join_handles: Mutex::new(Vec::new()),
        }
    }

    pub fn handle(&self) -> McpRegistryHandle {
        self.handle.clone()
    }

    /// Install + start a server. Returns the snapshot of tools registered
    /// **right now** (which may be empty if the server is unreachable —
    /// the background loop will refresh the snapshot once it connects;
    /// callers should re-query via `snapshot()` after a reconnect
    /// notification). Errors only on configuration validation; transport
    /// failures are logged and the server enters `unavailable` state.
    pub async fn install_server(&self, config: McpServerConfig) -> Result<(), McpError> {
        if !config.enabled {
            info!(server = %config.name, "mcp server disabled — skipping install");
            return Ok(());
        }
        config
            .validate()
            .map_err(|e| McpError::protocol(format!("invalid mcp config: {e}")))?;

        let name = config.name.clone();
        {
            let mut servers = self.handle.inner.servers.write().await;
            servers.insert(
                name.clone(),
                ServerEntry {
                    name: name.clone(),
                    config: config.clone(),
                    client: None,
                    descriptors: Vec::new(),
                    unavailable_reason: Some("starting".into()),
                },
            );
        }

        let inner = self.handle.inner.clone();
        let task = tokio::spawn(async move {
            run_server_loop(inner, name).await;
        });
        let mut joins = self._join_handles.lock().await;
        joins.push(task);
        Ok(())
    }

    /// Snapshot every currently-registered MCP tool plus the per-tool ACL
    /// markers. The orchestrator merges these into its top-level
    /// [`ToolRegistry`](aeqi_core::tool_registry::ToolRegistry) at startup
    /// and after any `tools/list_changed` event.
    pub async fn snapshot(&self) -> McpToolSnapshot {
        let servers = self.handle.inner.servers.read().await;
        let mut snap = McpToolSnapshot::default();
        for entry in servers.values() {
            for descriptor in &entry.descriptors {
                let tool = McpTool::new(entry.name.clone(), descriptor.clone(), self.handle.clone());
                let full_name = tool.full_name().to_string();
                snap.tools.push(Arc::new(tool));
                let kinds = entry.config.caller_kinds();
                let allows_llm = kinds.contains(&"Llm");
                let allows_event = kinds.contains(&"Event");
                if allows_llm && !allows_event {
                    snap.llm_only.push(full_name.clone());
                }
                if allows_event && !allows_llm {
                    snap.event_only.push(full_name.clone());
                }
            }
        }
        snap
    }

    /// Drop every server. Used by tests and graceful shutdown paths.
    pub async fn shutdown(&self) {
        let mut joins = self._join_handles.lock().await;
        for j in joins.drain(..) {
            j.abort();
        }
        let mut servers = self.handle.inner.servers.write().await;
        servers.clear();
    }
}

async fn run_server_loop(inner: Arc<RegistryInner>, name: String) {
    let mut backoff = Duration::from_millis(500);
    loop {
        let config = match read_config(&inner, &name).await {
            Some(c) => c,
            None => return,
        };
        let max_backoff = Duration::from_secs(config.backoff_max_secs.max(1));

        match resolve_credential(&inner, &config).await {
            Ok(cred) => match build_transport(&config, cred.as_ref()) {
                Ok(transport) => match McpClientBuilder::new(transport).connect().await {
                    Ok((client, closed_rx)) => {
                        let mut subscriber = client.subscribe();
                        // Initial tools/list.
                        match client.list_tools().await {
                            Ok(tools) => {
                                set_state(
                                    &inner,
                                    &name,
                                    Some(client.clone()),
                                    tools,
                                    None,
                                )
                                .await;
                                info!(server = %name, "mcp server connected");
                                backoff = Duration::from_millis(500);
                            }
                            Err(e) => {
                                warn!(server = %name, error = %e, "mcp tools/list failed");
                                set_state(
                                    &inner,
                                    &name,
                                    Some(client.clone()),
                                    Vec::new(),
                                    Some(format!("tools/list: {e}")),
                                )
                                .await;
                            }
                        }

                        // Listen until close. Refresh on tools/list_changed.
                        let close_or_notif = tokio::select! {
                            res = closed_rx => {
                                match res {
                                    Ok(c) => c.reason,
                                    Err(_) => "closed channel dropped".into(),
                                }
                            }
                            _ = async {
                                while let Ok(notif) = subscriber.recv().await {
                                    if matches!(notif, Notification::ToolsListChanged) {
                                        match client.list_tools().await {
                                            Ok(tools) => {
                                                debug!(server = %name, count = tools.len(), "mcp tools list refreshed");
                                                set_state(
                                                    &inner,
                                                    &name,
                                                    Some(client.clone()),
                                                    tools,
                                                    None,
                                                )
                                                .await;
                                            }
                                            Err(e) => {
                                                warn!(server = %name, error = %e, "mcp refresh tools/list failed");
                                            }
                                        }
                                    }
                                }
                            } => {
                                "notification stream ended".into()
                            }
                        };
                        warn!(server = %name, reason = %close_or_notif, "mcp server disconnected");
                        client
                            .mark_closed(crate::transport::TransportClosed {
                                reason: close_or_notif.clone(),
                            })
                            .await;
                        set_state(
                            &inner,
                            &name,
                            None,
                            // Keep descriptors so existing snapshots stay
                            // pointed at the same tool names — calls now
                            // fall through to the unavailable error path.
                            current_descriptors(&inner, &name).await,
                            Some(format!("disconnected: {close_or_notif}")),
                        )
                        .await;
                    }
                    Err(e) => {
                        warn!(server = %name, error = %e, "mcp connect/handshake failed");
                        set_state(
                            &inner,
                            &name,
                            None,
                            current_descriptors(&inner, &name).await,
                            Some(format!("connect failed: {e}")),
                        )
                        .await;
                    }
                },
                Err(e) => {
                    warn!(server = %name, error = %e, "mcp transport build failed");
                    set_state(
                        &inner,
                        &name,
                        None,
                        Vec::new(),
                        Some(format!("transport build: {e}")),
                    )
                    .await;
                }
            },
            Err(e) => {
                warn!(server = %name, error = %e, "mcp credential resolution failed");
                set_state(
                    &inner,
                    &name,
                    None,
                    Vec::new(),
                    Some(format!("credential: {e}")),
                )
                .await;
            }
        }

        // Backoff before reconnect.
        sleep(backoff).await;
        backoff = (backoff * 2).min(max_backoff);
        if !still_installed(&inner, &name).await {
            return;
        }
    }
}

async fn read_config(inner: &Arc<RegistryInner>, name: &str) -> Option<McpServerConfig> {
    let servers = inner.servers.read().await;
    servers.get(name).map(|e| e.config.clone())
}

async fn current_descriptors(
    inner: &Arc<RegistryInner>,
    name: &str,
) -> Vec<crate::protocol::McpToolDescriptor> {
    let servers = inner.servers.read().await;
    servers
        .get(name)
        .map(|e| e.descriptors.clone())
        .unwrap_or_default()
}

async fn still_installed(inner: &Arc<RegistryInner>, name: &str) -> bool {
    let servers = inner.servers.read().await;
    servers.contains_key(name)
}

async fn set_state(
    inner: &Arc<RegistryInner>,
    name: &str,
    client: Option<McpClient>,
    descriptors: Vec<crate::protocol::McpToolDescriptor>,
    unavailable_reason: Option<String>,
) {
    let mut servers = inner.servers.write().await;
    if let Some(entry) = servers.get_mut(name) {
        entry.client = client;
        entry.descriptors = descriptors;
        entry.unavailable_reason = unavailable_reason;
    }
}

async fn resolve_credential(
    inner: &Arc<RegistryInner>,
    config: &McpServerConfig,
) -> Result<Option<UsableCredential>, McpError> {
    let need = match &config.requires_credential {
        Some(n) => n,
        None => return Ok(None),
    };
    let resolver = match &inner.credentials {
        Some(r) => r,
        None => {
            return Err(McpError::new(
                McpReasonCode::MissingCredential,
                format!(
                    "server '{}' requires credential but no resolver wired",
                    config.name
                ),
            ));
        }
    };
    // Box the provider/name strings on the heap so we can build a
    // CredentialNeed with `'static` strs. We leak intentionally — the
    // server config lives for the daemon's lifetime.
    let provider_static: &'static str = Box::leak(need.provider.clone().into_boxed_str());
    let name_static: &'static str = Box::leak(need.name.clone().into_boxed_str());
    let scopes_static: Vec<&'static str> = need
        .scopes
        .iter()
        .map(|s| Box::leak(s.clone().into_boxed_str()) as &'static str)
        .collect();
    let mut credential_need = CredentialNeed::new(provider_static, name_static, ScopeHint::Global);
    credential_need.oauth_scopes = scopes_static;
    let scope = ResolutionScope::default();
    match resolver.resolve(&credential_need, &scope).await {
        Ok(Some(c)) => Ok(Some(c)),
        Ok(None) => Err(McpError::new(
            McpReasonCode::MissingCredential,
            format!(
                "no credential row for provider={} name={}",
                need.provider, need.name
            ),
        )),
        Err(e) => Err(McpError::new(
            McpReasonCode::MissingCredential,
            format!("{}: {}", e.code, e.message),
        )),
    }
}

fn build_transport(
    config: &McpServerConfig,
    credential: Option<&UsableCredential>,
) -> Result<Arc<dyn Transport>, McpError> {
    match config.transport {
        TransportKind::Stdio => {
            let command = config
                .command
                .as_deref()
                .ok_or_else(|| McpError::protocol("stdio transport: missing 'command'"))?;
            let mut args = config.args.clone();
            let mut transport = StdioTransport::new(command, args.clone());
            for (k, v) in &config.env {
                transport = transport.with_env(k, v);
            }
            if let Some(dir) = &config.cwd {
                transport.cwd = Some(std::path::PathBuf::from(dir));
            }
            if let (Some(cred_need), Some(cred)) = (&config.requires_credential, credential) {
                let bearer = cred
                    .bearer
                    .clone()
                    .unwrap_or_else(|| String::from_utf8_lossy(&cred.raw).to_string());
                if let Some(env_var) = &cred_need.env_var {
                    transport = transport.with_env(env_var, bearer);
                } else if let Some(arg) = &cred_need.arg {
                    args.push(arg.clone());
                    args.push(bearer);
                    transport.args = args;
                } else if cred_need.header.is_some() {
                    // header injection is meaningless for stdio — log and ignore.
                    warn!(
                        server = %config.name,
                        "credential 'header' inject mode is not supported on stdio transport — ignored"
                    );
                }
            }
            Ok(Arc::new(transport))
        }
        TransportKind::Sse => {
            let url = config
                .url
                .as_deref()
                .ok_or_else(|| McpError::protocol("sse transport: missing 'url'"))?;
            let mut transport = SseTransport::new(url);
            for (k, v) in &config.headers {
                transport = transport.with_header(k, v);
            }
            if let (Some(cred_need), Some(cred)) = (&config.requires_credential, credential) {
                if let Some(header) = &cred_need.header {
                    let value = if let Some(bearer) = &cred.bearer {
                        format!("Bearer {bearer}")
                    } else {
                        String::from_utf8_lossy(&cred.raw).to_string()
                    };
                    transport = transport.with_header(header, value);
                } else {
                    // Default: send `Authorization: Bearer <token>`.
                    if let Some(bearer) = &cred.bearer {
                        transport = transport.with_header("Authorization", format!("Bearer {bearer}"));
                    }
                }
            }
            Ok(Arc::new(transport))
        }
    }
}

/// Helper: install a parsed [`McpServersConfig`] in one shot.
pub async fn install_servers(
    registry: &McpRegistry,
    config: &crate::config::McpServersConfig,
) -> Result<(), McpError> {
    for server in &config.servers {
        registry.install_server(server.clone()).await?;
    }
    Ok(())
}

/// Configure an [`aeqi_core::tool_registry::ToolRegistry`] with a snapshot
/// from the MCP registry — pushes the per-server caller-kind flags via
/// `set_llm_only` / `set_event_only` so the existing ACL pipeline applies
/// to MCP tools without any additional plumbing. Callers are responsible
/// for inserting `snapshot.tools` into the registry separately (the
/// `ToolRegistry` API is build-once today; this helper covers the ACL
/// portion only).
pub fn apply_snapshot_to_registry(
    snapshot: &McpToolSnapshot,
    registry: &mut aeqi_core::tool_registry::ToolRegistry,
) {
    for name in &snapshot.llm_only {
        registry.set_llm_only(name.clone());
    }
    for name in &snapshot.event_only {
        registry.set_event_only(name.clone());
    }
}

/// Quick helper: build a [`ToolRegistry`](aeqi_core::tool_registry::ToolRegistry)
/// pre-populated with the MCP snapshot. Used by tests.
pub fn registry_with_snapshot(
    snapshot: McpToolSnapshot,
) -> aeqi_core::tool_registry::ToolRegistry {
    let tools = snapshot.tools.clone();
    let mut reg = aeqi_core::tool_registry::ToolRegistry::new(tools);
    for name in &snapshot.llm_only {
        reg.set_llm_only(name.clone());
    }
    for name in &snapshot.event_only {
        reg.set_event_only(name.clone());
    }
    reg
}

