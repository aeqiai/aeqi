//! Channel gateway dispatcher.
//!
//! Each `Channel` row in the database is backed by a typed `ChannelConfig`
//! variant (telegram / whatsapp / …). At daemon startup we walk the enabled
//! channels and spawn a per-channel background task that polls that platform
//! and routes messages through the session_manager.
//!
//! The dispatcher is the one place that knows about all supported kinds.
//! Adding a new channel is a three-step recipe:
//!
//!   1. Add a variant to `ChannelConfig` in aeqi-orchestrator.
//!   2. Create a sibling module (e.g. `discord.rs`) that exposes
//!      `pub(super) fn spawn_discord_gateway(cfg, agent_id, ctx, allowed)`.
//!   3. Add one match arm here to wire the variant → the new spawner.
//!
//! Everything else (tenancy scoping, migration, IPC) is already generic
//! over `ChannelConfig`.

use std::sync::Arc;

use aeqi_orchestrator::{
    Channel, ChannelConfig, ChannelSpawner, GatewayManager, SessionManager, SessionStore,
    agent_registry::AgentRegistry, execution_registry::ExecutionRegistry,
    stream_registry::StreamRegistry,
};
use tracing::warn;

pub(crate) mod telegram;
pub(crate) mod util;
pub(crate) mod whatsapp_baileys;

/// Shared dependencies every gateway spawner needs. Cloned into each task.
#[derive(Clone)]
pub(crate) struct SpawnContext {
    pub session_manager: Arc<SessionManager>,
    pub agent_registry: Arc<AgentRegistry>,
    pub default_provider: Option<Arc<dyn aeqi_core::traits::Provider>>,
    pub session_store: Option<Arc<SessionStore>>,
    pub gateway_manager: Arc<GatewayManager>,
    pub stream_registry: Arc<StreamRegistry>,
    pub execution_registry: Arc<ExecutionRegistry>,
    /// Daemon-level pattern dispatcher used by gateway-spawned
    /// `QueueExecutor`s to fire `session:quest_end` on quest finalize.
    pub pattern_dispatcher: Option<Arc<dyn aeqi_core::tool_registry::PatternDispatcher>>,
    /// Substrate handle for channel-scoped token resolution (T1.9.1 Move B).
    /// `None` only on configurations that pre-date the credentials table —
    /// in that case gateway spawners refuse to spawn.
    pub credentials: Option<Arc<aeqi_core::credentials::CredentialStore>>,
}

/// Dispatch a single channel row to its kind-specific spawner.
///
/// Returns `true` if a background task was spawned, `false` if the channel
/// kind is not yet wired into a gateway (e.g. whatsapp webhook is owned by
/// the web server, not a poller).
pub(crate) fn dispatch(channel: Channel, ctx: &SpawnContext) -> bool {
    match channel.config {
        ChannelConfig::Telegram(cfg) => {
            // Telegram doesn't yet split inbound/outbound — every whitelisted
            // chat is treated as reply-allowed. Flatten to chat_ids for the
            // existing i64-parsing path; the read-only flag is ignored on
            // this transport in this pass and will be wired in a follow-up.
            let chat_ids: Vec<String> = channel
                .allowed_chats
                .iter()
                .map(|a| a.chat_id.clone())
                .collect();
            telegram::spawn_telegram_gateway(
                cfg,
                channel.id,
                channel.agent_id,
                chat_ids,
                ctx.clone(),
            );
            true
        }
        ChannelConfig::Whatsapp(_) => {
            // WhatsApp webhook receiver runs as part of the web server,
            // not as a background poller — nothing to spawn here yet.
            warn!(
                channel_id = %channel.id,
                "whatsapp channels don't have a pollable gateway yet — webhook integration pending"
            );
            false
        }
        ChannelConfig::WhatsappBaileys(cfg) => {
            // The Baileys gateway honors the inbound/outbound split: every
            // whitelisted JID is ingested, but only those with
            // `reply_allowed=true` are reachable by the agent's reply/react
            // tools. The full `Vec<AllowedChat>` is forwarded so the spawner
            // can compute both sets without re-querying the DB.
            whatsapp_baileys::spawn_whatsapp_baileys_gateway(
                cfg,
                channel.id,
                channel.agent_id,
                channel.allowed_chats,
                ctx.clone(),
            );
            true
        }
        ChannelConfig::Discord(_) | ChannelConfig::Slack(_) => {
            warn!(
                channel_id = %channel.id,
                kind = %channel.kind.as_str(),
                "channel kind not yet wired into a gateway"
            );
            false
        }
    }
}

/// `ChannelSpawner` impl that closes over a `SpawnContext` so IPC handlers
/// can bring a newly-created channel live without a daemon restart.
pub(crate) struct LiveChannelSpawner {
    ctx: SpawnContext,
}

impl LiveChannelSpawner {
    pub(crate) fn new(ctx: SpawnContext) -> Self {
        Self { ctx }
    }
}

impl ChannelSpawner for LiveChannelSpawner {
    fn spawn(&self, channel: Channel) -> bool {
        dispatch(channel, &self.ctx)
    }
}
