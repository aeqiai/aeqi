#![allow(clippy::too_many_arguments)]
//! Agent orchestration engine — the operational heart of AEQI.
//!
//! Coordinates quest dispatch ([`quest_enqueuer::QuestEnqueuer`]), session
//! execution ([`queue_executor::QueueExecutor`] via [`SessionManager`]), agent
//! routing ([`AgentRouter`]), dispatch config ([`Dispatcher`]), agent
//! registry ([`agent_registry::AgentRegistry`]), activity log
//! ([`ActivityLog`]), Prometheus metrics ([`AEQIMetrics`]), and session storage.

pub mod activity;
pub mod activity_log;
pub mod agent_registry;
pub mod agent_router;
pub mod channel_registry;
pub mod checkpoint;
pub mod claude_code;
pub mod context_budget;
pub mod daemon;
pub mod dispatch;
pub mod escalation;
pub mod event_handler;
pub mod event_matcher;
pub mod event_validation;
pub mod execution_registry;
pub mod executor;
pub mod failure_analysis;
pub mod failure_classifier;
pub mod file_store;
pub mod gateway_manager;
pub mod hook;
pub mod idea_assembly;
pub mod ipc;
pub mod message_router;
pub mod metrics;
pub mod middleware;
pub mod operation;
pub mod pipeline;
pub mod progress_tracker;
pub mod quest_context;
pub mod quest_enqueuer;
pub mod queue_executor;
pub mod runtime;
pub mod runtime_tools;
pub mod sandbox;
pub mod schedule_timer;
pub mod session_manager;
pub mod session_queue;
pub mod session_store;
pub mod skill_loader;
pub mod stream_registry;
pub mod template;
pub mod tools;
pub mod vfs;

pub use activity::{Activity, ActivityStream};
pub use activity_log::ActivityLog;
pub use agent_registry::Agent;
pub use agent_registry::RunRecord;
pub use agent_router::{AgentRouter, RouteDecision};
pub use channel_registry::{
    Channel, ChannelConfig, ChannelKind, ChannelStore, NewChannel, TelegramConfig,
    WhatsappBaileysConfig,
};
pub use checkpoint::AgentCheckpoint;
pub use context_budget::ContextBudget;
pub use daemon::Daemon;
pub use dispatch::{DispatchConfig, Dispatcher};
pub use event_handler::{Event, EventHandlerStore, NewEvent, ToolCall};
pub use event_matcher::event_idea_ids;
pub use executor::QuestOutcome;
pub use gateway_manager::GatewayManager;
pub use hook::Hook;
pub use idea_assembly::EventPatternDispatcher;
pub use message_router::MessageRouter;
pub use metrics::AEQIMetrics;
pub use operation::{Operation, OperationStore};
pub use pipeline::{Pipeline, PipelineStep};
pub use progress_tracker::ProgressTracker;
pub use runtime::{
    Artifact, ArtifactKind, Run, RunStatus, RuntimeExecution, RuntimeOutcome, RuntimeOutcomeStatus,
    RuntimePhase, RuntimeSession, RuntimeSessionStatus,
};
pub use runtime_tools::build_runtime_registry;
pub use sandbox::{FinalizeAction, QuestDiff, QuestSandbox, SandboxConfig, prune_stale_worktrees};
pub use schedule_timer::ScheduleTimer;
pub use session_manager::SessionManager;
pub use session_store::{Sender, SessionStore, SessionTrace};
pub use skill_loader::{SkillLoader, SkillLoaderConfig};
pub use template::Template;
pub use tools::SandboxedShellTool;
