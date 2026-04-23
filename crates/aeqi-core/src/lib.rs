//! Foundation crate for the AEQI agent runtime and control plane.
//!
//! Provides core traits ([`traits::Provider`], [`traits::Tool`], [`traits::IdeaStore`],
//! [`traits::Observer`], [`traits::Channel`]), configuration loading ([`AEQIConfig`]),
//! the generic agent loop, and secret management.
//!
//! All other crates depend on `aeqi-core` for trait definitions and shared types.

pub mod agent;
pub mod chat_stream;
pub mod checkpoint;
pub mod config;
pub mod detector;
pub mod frontmatter;
pub mod hooks;
pub mod prompt;
pub mod sanitize;
pub mod scope;
pub mod secure_path;
pub mod security;
pub mod shell_hooks;
pub mod streaming_executor;
pub mod tool_registry;
pub mod traits;

pub use agent::{
    Agent, AgentConfig, AgentResult, AgentStopReason, ContentReplacementState, LoopNotification,
    NotificationReceiver, NotificationSender, SessionState, StepEventMeta, StepIdeaSpec,
};
pub use chat_stream::{ChatStreamEvent, ChatStreamSender, EventBacklog};
pub use config::{
    AEQIConfig, AgentPromptConfig, AgentSpawnConfig, AgentTriggerConfig, ContextBudgetConfig,
    ExecutionMode, ModelTierConfig, PeerAgentConfig, ProviderKind, RuntimePresetConfig, TeamConfig,
    discover_agents, load_agent_config,
};
pub use detector::{DetectedPattern, DetectionContext, PatternDetector, ToolCallRecord};
pub use hooks::{
    HookAction, HookRule, HookTrigger, HooksObserver, load_hooks_from_dir, match_hooks,
};
pub use prompt::{AssembledPrompt, PromptScope, ToolRestrictions};
pub use scope::Scope;
pub use security::SecretStore;
pub use tool_registry::{CallerKind, ExecutionContext, PatternDispatcher, ToolRegistry};
pub use traits::provider::{Message, MessageContent, Role};
pub use traits::{InjectedMessage, PendingMessageSource};
