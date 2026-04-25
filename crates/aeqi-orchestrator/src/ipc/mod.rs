//! IPC command handlers, split by domain.
//!
//! Each module provides handler functions that take a `CommandContext` reference
//! and a `serde_json::Value` request, returning a `serde_json::Value` response.

pub mod agents;
pub mod channels;
pub mod chat;
pub mod events;
pub mod files;
pub mod ideas;
pub mod inbox;
pub mod quests;
pub mod roots;
pub mod seed;
pub mod session_stream;
pub mod sessions;
pub mod status;
pub mod templates;
pub mod tenancy;
pub mod vfs;

use std::sync::Arc;
use tokio::sync::Mutex;

use crate::activity_log::ActivityLog;
use crate::agent_registry::AgentRegistry;
use crate::dispatch::Dispatcher;
use crate::event_handler::EventHandlerStore;
use crate::execution_registry::ExecutionRegistry;
use crate::message_router::MessageRouter;
use crate::metrics::AEQIMetrics;
use crate::session_manager::SessionManager;
use crate::session_store::SessionStore;
use crate::skill_loader::SkillLoader;
use crate::stream_registry::StreamRegistry;

use aeqi_ideas::embed_worker::EmbedQueue;
use aeqi_ideas::tag_policy::TagPolicyCache;

/// Shared context for all IPC command handlers.
/// Replaces the 13 loose parameters previously passed to handle_socket_connection.
pub struct CommandContext {
    pub metrics: Arc<AEQIMetrics>,
    pub activity_log: Arc<ActivityLog>,
    pub session_store: Option<Arc<SessionStore>>,
    pub event_handler_store: Option<Arc<EventHandlerStore>>,
    pub agent_registry: Arc<AgentRegistry>,
    pub idea_store: Option<Arc<dyn aeqi_core::traits::IdeaStore>>,
    pub message_router: Option<Arc<MessageRouter>>,
    pub activity_buffer: Arc<Mutex<ActivityBuffer>>,
    pub default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    pub default_model: String,
    pub session_manager: Arc<SessionManager>,
    pub dispatcher: Arc<Dispatcher>,
    pub daily_budget_usd: f64,
    pub skill_loader: Option<Arc<SkillLoader>>,
    pub execution_registry: Arc<ExecutionRegistry>,
    pub stream_registry: Arc<StreamRegistry>,
    pub channel_spawner: Option<Arc<dyn crate::channel_registry::ChannelSpawner>>,
    // ── Round 3 additions (Agent W — write-path wiring) ──────────────────
    /// Cache of `meta:tag-policy` meta-ideas, used by the store dispatch to
    /// resolve effective confidence/TTL/time_context and consolidation
    /// triggers. Invalidated on every `meta:tag-policy` write.
    pub tag_policy_cache: Arc<TagPolicyCache>,
    /// Async embedding work queue. The store path enqueues `(id, content)`
    /// after inserting rows with `embedding_pending=1`; a worker spawned
    /// in daemon startup drains the queue and flips the flag via
    /// `IdeaStore::set_embedding`.
    pub embed_queue: Arc<EmbedQueue>,
    // ── Round 3 retrieval-side additions (Agent R) ──────────────────────
    /// Embedder used by `search_explained` when present. `None` falls back
    /// to BM25-only search.
    pub embedder: Option<Arc<dyn aeqi_core::traits::Embedder>>,
    /// Daemon-side recall cache. Invalidated on store / update / delete /
    /// feedback / link writes so repeated MCP searches stay coherent.
    pub recall_cache: Arc<aeqi_ideas::RecallCache>,
    // ── Round 6 additions (event-chain reflection loop) ────────────────
    /// Daemon-level event dispatcher for IPC handlers that need to fire
    /// patterns outside of any live session. In particular
    /// `check_consolidation_threshold` (in `ipc/ideas.rs`) uses this to
    /// dispatch `ideas:threshold_reached` against the seeded event so the
    /// consolidator sub-agent spawns and its JSON is persisted via
    /// `ideas.store_many`. `None` in tests that only exercise the store
    /// layer — the caller falls back to a no-op log.
    pub pattern_dispatcher: Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
}

pub use crate::daemon::ActivityBuffer;

/// Extract a non-empty string field from a JSON request.
pub fn request_field<'a>(request: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    request
        .get(key)
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
}
