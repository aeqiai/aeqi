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
use aeqi_tools::{TelegramReactTool, TelegramReplyTool};
use tracing::{info, warn};

use super::SpawnContext;
use super::util::resolve_channel_token;

/// Public entry point called by the dispatcher.
///
/// The dispatcher owns parsing (kind → `TelegramConfig`) and whitelist
/// conversion (db strings → i64); this function owns the runtime task and
/// the credential resolution. `_cfg` is kept on the signature for symmetry
/// with the other channel kinds even though `TelegramConfig` is now an
/// empty marker (T1.9.1 — token lives in the substrate).
pub(super) fn spawn_telegram_gateway(
    _cfg: TelegramConfig,
    channel_id: String,
    agent_id: String,
    allowed_chats_raw: Vec<String>,
    ctx: SpawnContext,
) {
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

    // The substrate is the sole source of truth — there is no
    // `cfg.token` fallback because the field doesn't exist on
    // `TelegramConfig` any more. A missing credential means the operator
    // has not provisioned this channel yet; skip without crashing the
    // daemon.
    let Some(credentials) = ctx.credentials.clone() else {
        warn!(
            channel_id = %channel_id,
            "telegram gateway: no credential substrate available — skipping spawn"
        );
        return;
    };

    tokio::spawn(async move {
        let token =
            match resolve_channel_token(&credentials, &channel_id, "telegram", "token").await {
                Some(t) => t,
                None => {
                    warn!(
                        channel_id = %channel_id,
                        "telegram gateway: no token in credentials substrate — skipping. \
                         Re-add via Settings → Integrations or `aeqi credentials set`."
                    );
                    return;
                }
            };
        let tg_channel = Arc::new(TelegramChannel::new(token, allowed_chats.clone()));
        info!(agent_id = %agent_id, channel_id = %channel_id, "started agent telegram gateway from channels table");
        run_telegram_gateway(agent_id, allowed_chats, tg_channel, ctx).await;
    });
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
        stream_registry,
        execution_registry,
        pattern_dispatcher,
        credentials: _credentials,
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

        // Route through the per-session queue.
        let tg = tg_channel.clone();
        let sm = session_manager.clone();
        let ar = agent_registry.clone();
        let sr = stream_registry.clone();
        let er = execution_registry.clone();
        let gm = gateway_manager.clone();
        let provider = default_provider.clone();
        let aid = agent_id.clone();
        let session_store_clone = session_store.clone();
        let pattern_dispatcher = pattern_dispatcher.clone();

        tokio::spawn(async move {
            let _ = tg.send_typing(chat_id).await;

            // Resolve the Telegram user sender identity + record the inbound
            // message with that identity before enqueueing, so the executor
            // loads it as part of the transcript.
            let user_sender_id = if let Some(ref ss) = session_store_clone {
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

                if let Some(ref s) = sender {
                    let _ = ss
                        .record_message(
                            &session_id,
                            &s.id,
                            "telegram",
                            "user",
                            &user_text,
                            Some(
                                &serde_json::json!({"chat_id": chat_id, "message_id": message_id}),
                            ),
                        )
                        .await;
                }
                sender.map(|s| s.id)
            } else {
                None
            };

            // Register persistent TelegramGateway so web-originated messages
            // also deliver to Telegram.
            let tg_gw: Arc<dyn aeqi_core::traits::SessionGateway> =
                Arc::new(TelegramGateway::new(tg.clone(), chat_id, &aid));
            gm.register_persistent(&session_id, tg_gw.clone()).await;

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

            let Some(ss) = session_store_clone else {
                let out = aeqi_core::traits::OutgoingMessage {
                    channel: "telegram".to_string(),
                    recipient: String::new(),
                    text: "No session store configured.".to_string(),
                    metadata: serde_json::json!({ "chat_id": chat_id }),
                };
                let _ = tg.send(out).await;
                return;
            };

            // Bind the persistent gateway to the session's broadcast bus and
            // ensure the dispatcher is live, so streamed events reach Telegram.
            let sender = sr.get_or_create(&session_id).await;
            gm.activate_persistent(&session_id, &sender).await;
            gm.ensure_dispatcher(&session_id, &sender).await;

            // Telegram sessions are chat-only; the adaptive_retry path only
            // fires on quest runs, so leave the classifier knobs at defaults.
            let tg_tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = vec![
                Arc::new(TelegramReplyTool {
                    channel: tg.clone(),
                }),
                Arc::new(TelegramReactTool {
                    channel: tg.clone(),
                }),
            ];
            let executor: Arc<dyn aeqi_orchestrator::session_queue::SessionExecutor> =
                Arc::new(aeqi_orchestrator::queue_executor::QueueExecutor {
                    session_manager: sm.clone(),
                    agent_registry: ar.clone(),
                    stream_registry: sr.clone(),
                    execution_registry: er.clone(),
                    provider,
                    activity_log: None,
                    session_store: Some(ss.clone()),
                    idea_store: None,
                    adaptive_retry: false,
                    failure_analysis_model: String::new(),
                    extra_tools: tg_tools,
                    pattern_dispatcher: pattern_dispatcher.clone(),
                });
            // The `record_message` call above already wrote the inbound
            // user-message row with Telegram metadata (chat_id, message_id).
            // Flag it so spawn_session skips its own user-message write and
            // we don't duplicate the row in the transcript.
            let queued = aeqi_orchestrator::queue_executor::QueuedMessage::chat(
                aid.clone(),
                user_text.clone(),
                user_sender_id.clone(),
                Some("telegram".to_string()),
            )
            .with_initial_message_recorded();
            let payload = queued
                .to_payload()
                .expect("QueuedMessage serialization is infallible");

            if let Err(e) =
                aeqi_orchestrator::session_queue::enqueue(ss, executor, &session_id, &payload).await
            {
                warn!(error = %e, session_id = %session_id, "telegram: failed to enqueue message");
                let out = aeqi_core::traits::OutgoingMessage {
                    channel: "telegram".to_string(),
                    recipient: String::new(),
                    text: format!("Error: {}", e),
                    metadata: serde_json::json!({ "chat_id": chat_id }),
                };
                let _ = tg.send(out).await;
                return;
            }
            info!(session_id = %session_id, agent_id = %aid, "enqueued telegram message");

            // React with thumbs up.
            if message_id > 0 {
                let _ = tg.react(chat_id, message_id, "\u{1f44d}").await;
            }
        });
    }
}
