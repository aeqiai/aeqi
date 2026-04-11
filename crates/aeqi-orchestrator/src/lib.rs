#![allow(clippy::too_many_arguments)]
//! Agent orchestration engine — the operational heart of AEQI.
//!
//! Coordinates worker execution ([`AgentWorker`]), agent routing ([`AgentRouter`]),
//! global scheduling ([`Scheduler`]), agent registry ([`agent_registry::AgentRegistry`]),
//! activity log ([`ActivityLog`]), Prometheus metrics ([`AEQIMetrics`]), and session storage.

pub mod agent_registry;
pub mod agent_router;
pub mod agent_worker;
pub mod checkpoint;
pub mod claude_code;
pub mod context_budget;
pub mod daemon;
pub mod delegate;
pub mod escalation;
pub mod event_handler;
pub mod event_matcher;
pub mod schedule_timer;
pub mod activity_log;
pub mod activity;
pub mod executor;
pub mod failure_analysis;
pub mod hook;
pub mod ipc;
pub mod message_router;
pub mod metrics;
pub mod middleware;
pub mod operation;
pub mod pipeline;
pub mod progress_tracker;
pub mod prompt_assembly;
pub mod runtime;
pub mod sandbox;
pub mod scheduler;
pub mod session_manager;
pub mod session_store;
pub mod prompt_loader;
pub mod template;
pub mod tools;
pub mod trigger;
pub mod vfs;

pub use agent_registry::{Agent, CompanyRecord, PromptRecord};
pub use agent_router::{AgentRouter, RouteDecision};
pub use agent_worker::{AgentWorker, WorkerState};
pub use checkpoint::AgentCheckpoint;
pub use context_budget::ContextBudget;
pub use daemon::Daemon;
pub use activity_log::{Dispatch, DispatchHealth, DispatchKind, ActivityLog};
pub use activity::{ActivityStream, Activity};
pub use executor::QuestOutcome;
pub use hook::Hook;
pub use message_router::MessageRouter;
pub use metrics::AEQIMetrics;
pub use operation::{Operation, OperationStore};
pub use pipeline::{Pipeline, PipelineStep};
pub use progress_tracker::ProgressTracker;
pub use runtime::{
    Artifact, ArtifactKind, Run, RunStatus, RuntimeExecution, RuntimeOutcome, RuntimeOutcomeStatus,
    RuntimePhase, RuntimeSession, RuntimeSessionStatus,
};
pub use sandbox::{FinalizeAction, QuestDiff, QuestSandbox, SandboxConfig};
pub use scheduler::{Scheduler, SchedulerConfig};
pub use session_manager::SessionManager;
pub use session_store::SessionStore;
pub use template::Template;
pub use tools::SandboxedShellTool;
pub use trigger::{EventPattern, Trigger, TriggerStore, TriggerType};
pub use event_handler::{Event, EventHandlerStore, NewEvent};
pub use event_matcher::EventMatcher;
pub use schedule_timer::ScheduleTimer;
pub use prompt_loader::{PromptLoader, PromptLoaderConfig};
