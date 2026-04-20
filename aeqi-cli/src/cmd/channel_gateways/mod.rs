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
    Channel, ChannelConfig, GatewayManager, SessionManager, SessionStore,
    agent_registry::AgentRegistry, execution_registry::ExecutionRegistry,
    stream_registry::StreamRegistry,
};
use tracing::warn;

pub(crate) mod telegram;

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
}

/// Dispatch a single channel row to its kind-specific spawner.
///
/// Returns `true` if a background task was spawned, `false` if the channel
/// kind is not yet wired into a gateway (e.g. whatsapp stub) — the caller
/// may use this to decide whether to fall back to the legacy
/// `[channels.telegram]` config block.
pub(crate) fn dispatch(channel: Channel, ctx: &SpawnContext) -> bool {
    match channel.config {
        ChannelConfig::Telegram(cfg) => {
            telegram::spawn_telegram_gateway(
                cfg,
                channel.id,
                channel.agent_id,
                channel.allowed_chats,
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
