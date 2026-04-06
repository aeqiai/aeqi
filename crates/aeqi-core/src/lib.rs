//! Foundation crate for the AEQI agent runtime and control plane.
//!
//! Provides core traits ([`traits::Provider`], [`traits::Tool`], [`traits::Insight`],
//! [`traits::Observer`], [`traits::Channel`]), configuration loading ([`AEQIConfig`]),
//! the generic agent loop, and secret management.
//!
//! All other crates depend on `aeqi-core` for trait definitions and shared types.

pub mod agent;
pub mod chat_stream;
pub mod checkpoint;
pub mod config;
pub mod frontmatter;
pub mod prompt;
pub mod sanitize;
pub mod security;
pub mod shell_hooks;
pub mod streaming_executor;
pub mod traits;

pub use agent::{
    Agent, AgentConfig, AgentResult, AgentStopReason, ContentReplacementState, LoopNotification,
    NotificationReceiver, NotificationSender, SessionInput, SessionState, SessionType,
    TurnPromptSpec,
};
pub use chat_stream::{ChatStreamEvent, ChatStreamSender};
pub use config::{
    AEQIConfig, AgentPromptConfig, AgentSpawnConfig, AgentTriggerConfig, ContextBudgetConfig,
    ExecutionMode, ModelTierConfig, PeerAgentConfig, ProviderKind, RuntimePresetConfig, TeamConfig,
    discover_agents, load_agent_config,
};
/// Compat alias — old callers used `CompanyConfig`.
pub type CompanyConfig = AgentSpawnConfig;
pub use prompt::{AssembledPrompt, PromptEntry, PromptPosition, PromptScope, ToolRestrictions};
pub use security::SecretStore;
