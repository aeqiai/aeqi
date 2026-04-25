//! TOML deserialisation for the `meta:mcp-servers` seed-idea body.
//!
//! Operators describe MCP servers in a small TOML block stored as the
//! body of the global idea named `meta:mcp-servers`. The orchestrator
//! reads the idea on startup, parses it via [`McpServersConfig::from_toml`],
//! and hands each entry to the [`McpRegistry`](crate::registry::McpRegistry).
//!
//! Example body:
//!
//! ```toml
//! [[server]]
//! name = "github-mcp"
//! transport = "stdio"
//! command = "npx"
//! args = ["@modelcontextprotocol/server-github"]
//! caller_kind = "Llm"
//! requires_credential = { provider = "github", lifecycle = "github_app", scopes = ["repo:read"] }
//!
//! [[server]]
//! name = "filesystem-mcp"
//! transport = "stdio"
//! command = "npx"
//! args = ["@modelcontextprotocol/server-filesystem", "/some/path"]
//! caller_kind = "Llm"
//!
//! [[server]]
//! name = "remote-mcp"
//! transport = "sse"
//! url = "https://mcp.example.com/sse"
//! caller_kind = "Llm,Event"
//! ```

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransportKind {
    Stdio,
    Sse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerCredentialNeed {
    /// Provider key consulted by the credential substrate (`github`,
    /// `google`, ...). Matches `CredentialNeed::provider` shape.
    pub provider: String,
    /// Lifecycle kind expected for the credential row. Documentation
    /// surface — we don't switch on it, but operators read it.
    #[serde(default)]
    pub lifecycle: Option<String>,
    /// Credential `name` within the provider. Defaults to `oauth_token`
    /// when omitted to match the `oauth2` lifecycle convention.
    #[serde(default = "default_credential_name")]
    pub name: String,
    /// OAuth scopes the credential must cover (passed verbatim to the
    /// substrate so resolution can fail with `scope_mismatch` if needed).
    #[serde(default)]
    pub scopes: Vec<String>,
    /// How to inject the resolved bearer / blob into the server. The
    /// concrete shape depends on transport:
    ///
    /// * `env_var = "GITHUB_TOKEN"` (stdio) — passed via subprocess env.
    /// * `header = "Authorization"` (sse) — added as `Bearer <token>`.
    /// * `arg = "--token"` (stdio) — appended as `<arg> <token>` in the
    ///   command line.
    ///
    /// At most one inject mode should be set; if multiple are present we
    /// honour them in env → header → arg priority.
    #[serde(default)]
    pub env_var: Option<String>,
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub arg: Option<String>,
}

fn default_credential_name() -> String {
    "oauth_token".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    /// Stable namespace prefix — tools register as
    /// `mcp:<name>:<server-tool>`. Must be lowercase, alphanumeric +
    /// `-`/`_`. The substrate does not enforce this; the registry
    /// validates.
    pub name: String,
    pub transport: TransportKind,

    // Stdio fields.
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub cwd: Option<String>,

    // SSE fields.
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,

    /// Comma-separated list — `Llm`, `Event`, `System`. Defaults to
    /// `Llm` only (security boundary: never expose MCP tools to System
    /// callers without an operator opt-in).
    #[serde(default = "default_caller_kind")]
    pub caller_kind: String,

    /// Optional credential dependency. Substrate resolves before spawn;
    /// missing-and-required → server is left as `unavailable`.
    #[serde(default)]
    pub requires_credential: Option<McpServerCredentialNeed>,

    /// Maximum reconnect backoff in seconds. Default: 60.
    #[serde(default = "default_backoff_max")]
    pub backoff_max_secs: u64,

    /// Whether the server is enabled. Operators flip this without
    /// removing the entry. Defaults to true.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_caller_kind() -> String {
    "Llm".to_string()
}

fn default_backoff_max() -> u64 {
    60
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpServersConfig {
    #[serde(default, rename = "server")]
    pub servers: Vec<McpServerConfig>,
}

impl McpServersConfig {
    /// Parse a TOML body into the typed config. Empty / whitespace-only
    /// bodies parse to an empty config — operators can leave the
    /// `meta:mcp-servers` idea body blank and the daemon registers no
    /// servers.
    pub fn from_toml(body: &str) -> anyhow::Result<Self> {
        if body.trim().is_empty() {
            return Ok(Self::default());
        }
        let parsed: Self = toml::from_str(body)?;
        for s in &parsed.servers {
            s.validate()?;
        }
        Ok(parsed)
    }
}

impl McpServerConfig {
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.name.is_empty() {
            anyhow::bail!("mcp server entry missing 'name'");
        }
        if !self
            .name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            anyhow::bail!(
                "mcp server name '{}' must be ascii alphanumeric / '-' / '_'",
                self.name
            );
        }
        match self.transport {
            TransportKind::Stdio => {
                if self.command.as_deref().unwrap_or("").is_empty() {
                    anyhow::bail!(
                        "mcp server '{}' uses stdio transport but has no 'command'",
                        self.name
                    );
                }
            }
            TransportKind::Sse => {
                if self.url.as_deref().unwrap_or("").is_empty() {
                    anyhow::bail!(
                        "mcp server '{}' uses sse transport but has no 'url'",
                        self.name
                    );
                }
            }
        }
        for kind in self.caller_kinds() {
            match kind.trim() {
                "Llm" | "Event" | "System" => {}
                other => anyhow::bail!(
                    "mcp server '{}' has invalid caller_kind '{}' \
                     (expected Llm | Event | System)",
                    self.name,
                    other
                ),
            }
        }
        Ok(())
    }

    /// Trimmed, comma-separated allowed caller kinds.
    pub fn caller_kinds(&self) -> Vec<&str> {
        self.caller_kind
            .split(',')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect()
    }

    /// Whether `kind` is allowed by this server's caller_kind config.
    pub fn allows_caller(&self, kind: aeqi_core::tool_registry::CallerKind) -> bool {
        let want = match kind {
            aeqi_core::tool_registry::CallerKind::Llm => "Llm",
            aeqi_core::tool_registry::CallerKind::Event => "Event",
            aeqi_core::tool_registry::CallerKind::System => "System",
        };
        self.caller_kinds().contains(&want)
    }
}
