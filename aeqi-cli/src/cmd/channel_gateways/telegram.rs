//! Telegram gateway spawner.
//!
//! Extracted from the old `start_agent_telegram_gateway` in `daemon.rs` so
//! each supported channel kind lives in its own file. The dispatcher in
//! `mod.rs` calls `spawn_telegram_gateway` with parsed config + context;
//! nothing in `daemon.rs` needs to know Telegram specifics any more.

use std::sync::Arc;

use aeqi_core::traits::Channel as ChannelTrait;
use aeqi_gates::{TelegramChannel, TelegramGateway};
use aeqi_orchestrator::TelegramConfig;
use tracing::{info, warn};

use super::SpawnContext;

/// Public entry point called by the dispatcher.
///
/// The dispatcher owns parsing (kind → `TelegramConfig`) and whitelist
/// conversion (db strings → i64); this function just owns the runtime task.
pub(super) fn spawn_telegram_gateway(
    cfg: TelegramConfig,
    channel_id: String,
    agent_id: String,
    allowed_chats_raw: Vec<String>,
    ctx: SpawnContext,
) {
    if cfg.token.is_empty() {
        warn!(channel_id = %channel_id, "telegram channel has empty token, skipping");
        return;
    }

    // allowed_chats lives on the channel row (joined from
    // channel_allowed_chats) as strings — Telegram expects i64, so parse
    // and drop malformed entries with a warning rather than failing the
    // whole gateway.
    let allowed_chats: Vec<i64> = allowed_chats_raw
        .iter()
        .filter_map(|s| match s.parse::<i64>() {
            Ok(n) => Some(n),
            Err(_) => {
                warn!(channel_id = %channel_id, chat_id = %s, "skipping non-numeric allowed chat_id");
                None
            }
        })
        .collect();

    let tg_channel = Arc::new(TelegramChannel::new(cfg.token, allowed_chats.clone()));

    tokio::spawn(run_telegram_gateway(
        agent_id.clone(),
        allowed_chats,
        tg_channel,
        ctx,
    ));
    info!(agent_id = %agent_id, channel_id = %channel_id, "started agent telegram gateway from channels table");
}

/// Public shim used by the legacy `[channels.telegram]` TOML config path.
///
/// `daemon.rs` still owns the secret-store lookup + root-agent resolution for
/// the pre-channels-table config block. Once the channel type exists in the
/// DB we route through the normal dispatcher; this is the one-shot fallback.
pub(crate) fn spawn_legacy_telegram_gateway(
    agent_id: String,
    token: String,
    allowed_chats: Vec<i64>,
    ctx: SpawnContext,
) {
    let tg_channel = Arc::new(TelegramChannel::new(token, allowed_chats.clone()));
    tokio::spawn(run_telegram_gateway(
        agent_id.clone(),
        allowed_chats,
        tg_channel,
        ctx,
    ));
    info!(agent_id = %agent_id, "started legacy telegram gateway from [channels.telegram]");
}

/// Agent-driven Telegram gateway task.
///
/// Polls the given `TelegramChannel`, routes incoming messages through the
/// session_manager bound to the specified `agent_id`. Each (agent_id,
/// chat_id) pair gets a persistent session.
async fn run_telegram_gateway(
    agent_id: String,
    allowed_chats: Vec<i64>,
    tg_channel: Arc<TelegramChannel>,
    ctx: SpawnContext,
) {
    let SpawnContext {
        session_manager,
        agent_registry,
        default_provider,
        session_store,
        gateway_manager,
    } = ctx;

    let mut rx = match ChannelTrait::start(tg_channel.as_ref()).await {
        Ok(rx) => rx,
        Err(e) => {
            warn!(agent_id = %agent_id, error = %e, "failed to start telegram poller");
            return;
        }
    };

    info!(agent_id = %agent_id, "telegram gateway polling started");

    // Register persistent gateways for all known channel_sessions so
    // web-initiated messages on Telegram-bound sessions also deliver
    // responses to Telegram.
    if let Ok(channel_sessions) = agent_registry.list_channel_sessions(&agent_id).await {
        for (channel_key, session_id, _created_at) in &channel_sessions {
            if let Some(chat_id_str) = channel_key.split(':').nth(2)
                && let Ok(chat_id) = chat_id_str.parse::<i64>()
            {
                let tg_gw: Arc<dyn aeqi_core::traits::SessionGateway> =
                    Arc::new(TelegramGateway::new(tg_channel.clone(), chat_id, &agent_id));
                gateway_manager.register_persistent(session_id, tg_gw).await;
                info!(session_id = %session_id, chat_id, "restored persistent telegram gateway");
            }
        }
    }

    while let Some(msg) = rx.recv().await {
        let chat_id = msg
            .metadata
            .get("chat_id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if chat_id == 0 {
            continue;
        }
        let message_id = msg
            .metadata
            .get("message_id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Whitelist check.
        if !allowed_chats.is_empty() && !allowed_chats.contains(&chat_id) {
            continue;
        }

        let user_text = msg.text;
        if user_text.is_empty() {
            continue;
        }

        let sender_name = msg.sender.clone();
        let telegram_user_id = msg
            .metadata
            .get("from_id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        // Get or create session for this (agent, chat) pair.
        let channel_key = format!("telegram:{}:{}", agent_id, chat_id);
        let session_id = match agent_registry
            .get_or_create_channel_session(&channel_key, &agent_id)
            .await
        {
            Ok(sid) => sid,
            Err(e) => {
                warn!(error = %e, channel_key = %channel_key, "failed to resolve channel session");
                continue;
            }
        };

        // Route through session_manager.
        let tg = tg_channel.clone();
        let sm = session_manager.clone();
        let gm = gateway_manager.clone();
        let provider = default_provider.clone();
        let aid = agent_id.clone();
        let session_store_clone = session_store.clone();

        tokio::spawn(async move {
            let _ = tg.send_typing(chat_id).await;

            // Resolve the Telegram user sender identity.
            let user_sender_id =
                if let Some(ref ss) = session_store_clone {
                    let sender = ss
                        .resolve_sender(
                            "telegram",
                            &telegram_user_id.to_string(),
                            &sender_name,
                            None,
                            None,
                            Some(&serde_json::json!({"username": sender_name, "chat_id": chat_id})),
                        )
                        .await
                        .ok();

                    // Record the user's inbound message with sender identity.
                    if let Some(ref s) = sender {
                        let _ = ss.record_message(
                        &session_id,
                        &s.id,
                        "telegram",
                        "user",
                        &user_text,
                        Some(&serde_json::json!({"chat_id": chat_id, "message_id": message_id})),
                    ).await;
                    }
                    sender.map(|s| s.id)
                } else {
                    None
                };

            // Register TelegramGateway for this session (deduplicated by gateway_id).
            let tg_gw: Arc<dyn aeqi_core::traits::SessionGateway> =
                Arc::new(TelegramGateway::new(tg.clone(), chat_id, &aid));

            // Store as persistent so web-originated messages also deliver to Telegram.
            gm.register_persistent(&session_id, tg_gw.clone()).await;

            if sm.is_running(&session_id).await {
                // Session already alive — register gateway and inject message.
                // GatewayManager's dispatcher delivers the response to Telegram.
                if let Some(stream_sender) = sm.get_stream_sender(&session_id).await {
                    gm.register(&session_id, tg_gw, &stream_sender).await;
                }
                if let Err(e) = sm.send_streaming(&session_id, &user_text).await {
                    warn!(error = %e, session_id = %session_id, "session send failed");
                    let out = aeqi_core::traits::OutgoingMessage {
                        channel: "telegram".to_string(),
                        recipient: String::new(),
                        text: format!("Error: {}", e),
                        metadata: serde_json::json!({ "chat_id": chat_id }),
                    };
                    let _ = tg.send(out).await;
                }
            } else {
                // No running session — spawn a new interactive session.
                let Some(provider) = provider else {
                    let out = aeqi_core::traits::OutgoingMessage {
                        channel: "telegram".to_string(),
                        recipient: String::new(),
                        text: "No provider configured.".to_string(),
                        metadata: serde_json::json!({ "chat_id": chat_id }),
                    };
                    let _ = tg.send(out).await;
                    return;
                };

                let mut opts = aeqi_orchestrator::session_manager::SpawnOptions::interactive()
                    .with_session_id(session_id.clone())
                    .with_name(format!("telegram:{}", chat_id))
                    .with_transport("telegram".to_string());
                // Pass sender_id so spawn_session records the initial prompt with identity.
                if let Some(ref sid) = user_sender_id {
                    opts = opts.with_sender_id(sid.clone());
                }
                // The initial prompt is already recorded above with sender identity,
                // so skip the default recording in spawn_session.
                opts = opts.without_initial_prompt_record();

                match sm.spawn_session(&aid, &user_text, provider, opts).await {
                    Ok(spawned) => {
                        info!(
                            session_id = %spawned.session_id,
                            agent_id = %aid,
                            "spawned telegram session"
                        );
                        // Pre-subscribe before registering to avoid missing early events.
                        let pre_rx = spawned.stream_sender.subscribe();
                        gm.register_with_rx(&session_id, tg_gw, pre_rx).await;
                    }
                    Err(e) => {
                        warn!(error = %e, "failed to spawn session for telegram");
                        let out = aeqi_core::traits::OutgoingMessage {
                            channel: "telegram".to_string(),
                            recipient: String::new(),
                            text: format!("Error: {}", e),
                            metadata: serde_json::json!({ "chat_id": chat_id }),
                        };
                        let _ = tg.send(out).await;
                    }
                }
            }

            // React with thumbs up.
            if message_id > 0 {
                let _ = tg.react(chat_id, message_id, "\u{1f44d}").await;
            }
        });
    }
}
