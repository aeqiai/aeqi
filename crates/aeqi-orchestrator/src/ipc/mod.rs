//! IPC command handlers, split by domain.
//!
//! Each module provides handler functions that take a `CommandContext` reference
//! and a `serde_json::Value` request, returning a `serde_json::Value` response.

pub mod agents;
pub mod chat;
pub mod companies;
pub mod events;
pub mod ideas;
pub mod notes;
pub mod prompts;
pub mod quests;
pub mod sessions;
pub mod status;
pub mod tenancy;
pub mod vfs;

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::agent_registry::AgentRegistry;
use crate::activity_log::ActivityLog;
use crate::message_router::MessageRouter;
use crate::metrics::AEQIMetrics;
use crate::scheduler::Scheduler;
use crate::session_manager::SessionManager;
use crate::session_store::SessionStore;
use crate::prompt_loader::PromptLoader;
use crate::event_handler::EventHandlerStore;

/// Shared context for all IPC command handlers.
/// Replaces the 13 loose parameters previously passed to handle_socket_connection.
pub struct CommandContext {
    pub metrics: Arc<AEQIMetrics>,
    pub activity_log: Arc<ActivityLog>,
    pub session_store: Option<Arc<SessionStore>>,
    pub event_handler_store: Option<Arc<EventHandlerStore>>,
    pub agent_registry: Arc<AgentRegistry>,
    pub message_router: Option<Arc<MessageRouter>>,
    pub activity_buffer: Arc<Mutex<ActivityBuffer>>,
    pub default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    pub default_model: String,
    pub session_manager: Arc<SessionManager>,
    pub scheduler: Arc<Scheduler>,
    pub daily_budget_usd: f64,
    pub project_budgets: std::collections::HashMap<String, f64>,
    pub prompt_loader: Option<Arc<PromptLoader>>,
}

pub use crate::daemon::ActivityBuffer;

/// Extract a non-empty string field from a JSON request.
pub fn request_field<'a>(request: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    request
        .get(key)
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
}
