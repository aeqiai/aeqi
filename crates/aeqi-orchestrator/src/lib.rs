#![allow(clippy::too_many_arguments)]
//! Agent orchestration engine — the operational heart of AEQI.
//!
//! Coordinates worker execution ([`AgentWorker`]), agent routing ([`AgentRouter`]),
//! global scheduling ([`Scheduler`]), agent registry ([`agent_registry::AgentRegistry`]),
//! activity log ([`ActivityLog`]), Prometheus metrics ([`AEQIMetrics`]), and session storage.

pub mod activity;
pub mod activity_log;
pub mod agent_registry;
pub mod agent_router;
pub mod agent_worker;
pub mod channel_registry;
pub mod checkpoint;
pub mod claude_code;
pub mod context_budget;
pub mod daemon;
pub mod escalation;
pub mod event_handler;
pub mod event_matcher;
pub mod executor;
pub mod failure_analysis;
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
pub mod prompt_loader;
pub mod runtime;
pub mod sandbox;
pub mod schedule_timer;
pub mod scheduler;
pub mod session_manager;
pub mod session_store;
pub mod template;
pub mod tools;
pub mod vfs;

pub use activity::{Activity, ActivityStream};
pub use activity_log::ActivityLog;
pub use agent_registry::Agent;
pub use agent_registry::RunRecord;
pub use agent_router::{AgentRouter, RouteDecision};
pub use agent_worker::{AgentWorker, WorkerState};
pub use channel_registry::{
    Channel, ChannelConfig, ChannelKind, ChannelStore, NewChannel, TelegramConfig,
};
pub use checkpoint::AgentCheckpoint;
pub use context_budget::ContextBudget;
pub use daemon::Daemon;
pub use event_handler::{Event, EventHandlerStore, NewEvent};
pub use event_matcher::event_idea_ids;
pub use executor::QuestOutcome;
pub use gateway_manager::GatewayManager;
pub use hook::Hook;
pub use message_router::MessageRouter;
pub use metrics::AEQIMetrics;
pub use operation::{Operation, OperationStore};
pub use pipeline::{Pipeline, PipelineStep};
pub use progress_tracker::ProgressTracker;
pub use prompt_loader::{PromptLoader, PromptLoaderConfig};
pub use runtime::{
    Artifact, ArtifactKind, Run, RunStatus, RuntimeExecution, RuntimeOutcome, RuntimeOutcomeStatus,
    RuntimePhase, RuntimeSession, RuntimeSessionStatus,
};
pub use sandbox::{FinalizeAction, QuestDiff, QuestSandbox, SandboxConfig, prune_stale_worktrees};
pub use schedule_timer::ScheduleTimer;
pub use scheduler::{Scheduler, SchedulerConfig};
pub use session_manager::SessionManager;
pub use session_store::{Sender, SessionStore, SessionTrace};
pub use template::Template;
pub use tools::SandboxedShellTool;
