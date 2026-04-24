//! WhatsApp Baileys gateway spawner.
//!
//! Structurally parallel to `telegram.rs`: the dispatcher calls us with a
//! parsed `WhatsappBaileysConfig` + context; we spawn the bridge,
//! translate incoming messages into queued sessions, and hand streamed
//! responses back to the bridge for delivery.
//!
//! Unlike Telegram (a single long poll backed by a bot token), the Baileys
//! channel runs a **Node side-process** that owns the WhatsApp Web
//! protocol. We never see Noise frames, Signal ratchets, or QR raw bytes
//! in Rust — those stay inside the bridge. Rust sees JSON events and
//! outgoing send calls.

use std::path::PathBuf;
use std::sync::Arc;

use aeqi_core::traits::{Channel as ChannelTrait, OutgoingMessage, SessionGateway};
use aeqi_gates::{WhatsAppBaileysChannel, WhatsappBaileysGateway, whatsapp_baileys};
use aeqi_orchestrator::WhatsappBaileysConfig;
use aeqi_tools::{WhatsAppReactTool, WhatsAppReplyTool};
use tracing::{info, warn};

use super::SpawnContext;

/// Resolve the bridge script path. Default is relative to the workspace
/// root; override with `AEQI_BAILEYS_BRIDGE_SCRIPT` for deploy builds
/// where the Node side lives elsewhere.
fn resolve_bridge_script() -> PathBuf {
    if let Ok(p) = std::env::var("AEQI_BAILEYS_BRIDGE_SCRIPT") {
        return PathBuf::from(p);
    }
    // Walk up from the binary until we find `bridges/baileys/src/bridge.mjs`.
    let mut here = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    for _ in 0..6 {
        let candidate = here.join("bridges/baileys/src/bridge.mjs");
        if candidate.exists() {
            return candidate;
        }
        if !here.pop() {
            break;
        }
    }
    // Final fallback — works when running from the repo root.
    PathBuf::from("bridges/baileys/src/bridge.mjs")
}

/// Default filesystem location for a channel's Baileys auth state.
fn default_session_dir(channel_id: &str) -> PathBuf {
    let base = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aeqi")
        .join("platforms")
        .join("whatsapp-baileys");
    base.join(channel_id)
}

pub(super) fn spawn_whatsapp_baileys_gateway(
    cfg: WhatsappBaileysConfig,
    channel_id: String,
    agent_id: String,
    _allowed_chats_raw: Vec<String>,
    ctx: SpawnContext,
) {
    let script = resolve_bridge_script();
    let session_dir = cfg
        .session_dir
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| default_session_dir(&channel_id));

    tokio::spawn(async move {
        let allowed_jids = cfg.allowed_jids.clone();
        let ch = match WhatsAppBaileysChannel::connect(script, session_dir, allowed_jids).await {
            Ok(c) => Arc::new(c),
            Err(e) => {
                warn!(channel_id = %channel_id, error = %e, "failed to connect whatsapp-baileys bridge");
                return;
            }
        };

        whatsapp_baileys::register(channel_id.clone(), ch.clone()).await;

        info!(
            agent_id = %agent_id,
            channel_id = %channel_id,
            "whatsapp-baileys gateway connected (awaiting QR/auth)"
        );

        run_gateway(ch, agent_id, channel_id, ctx).await;
    });
}

async fn run_gateway(
    ch: Arc<WhatsAppBaileysChannel>,
    agent_id: String,
    _channel_id: String,
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
    } = ctx;

    let mut rx = match ChannelTrait::start(ch.as_ref()).await {
        Ok(rx) => rx,
        Err(e) => {
            warn!(agent_id = %agent_id, error = %e, "whatsapp-baileys start failed");
            return;
        }
    };

    // Restore persistent gateways for existing whatsapp-baileys channel sessions,
    // so responses to already-known conversations continue to route back to
    // WhatsApp after a daemon restart.
    if let Ok(channel_sessions) = agent_registry.list_channel_sessions(&agent_id).await {
        for (channel_key, session_id, _created_at) in &channel_sessions {
            let mut parts = channel_key.splitn(3, ':');
            let kind = parts.next().unwrap_or("");
            let _aid = parts.next().unwrap_or("");
            let jid = parts.next().unwrap_or("");
            if kind != "whatsapp-baileys" || jid.is_empty() {
                continue;
            }
            let gw: Arc<dyn SessionGateway> =
                Arc::new(WhatsappBaileysGateway::new(ch.clone(), jid.to_string()));
            gateway_manager.register_persistent(session_id, gw).await;
        }
    }

    while let Some(msg) = rx.recv().await {
        let jid = msg.sender.clone();
        let user_text = msg.text.clone();
        if user_text.is_empty() {
            continue;
        }

        let push_name = msg
            .metadata
            .get("push_name")
            .and_then(|v| v.as_str())
            .unwrap_or(&jid)
            .to_string();

        let channel_key = format!("whatsapp-baileys:{}:{}", agent_id, jid);
        let session_id = match agent_registry
            .get_or_create_channel_session(&channel_key, &agent_id)
            .await
        {
            Ok(sid) => sid,
            Err(e) => {
                warn!(error = %e, channel_key = %channel_key, "whatsapp-baileys: failed to resolve channel session");
                continue;
            }
        };

        let ch_clone = ch.clone();
        let sm = session_manager.clone();
        let ar = agent_registry.clone();
        let sr = stream_registry.clone();
        let er = execution_registry.clone();
        let gm = gateway_manager.clone();
        let provider = default_provider.clone();
        let aid = agent_id.clone();
        let session_store_clone = session_store.clone();

        tokio::spawn(async move {
            let user_sender_id = if let Some(ref ss) = session_store_clone {
                let sender = ss
                    .resolve_sender(
                        "whatsapp-baileys",
                        &jid,
                        &push_name,
                        None,
                        None,
                        Some(&serde_json::json!({"push_name": push_name, "jid": jid})),
                    )
                    .await
                    .ok();

                if let Some(ref s) = sender {
                    let message_id = msg
                        .metadata
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let from_me = msg
                        .metadata
                        .get("from_me")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    let participant = msg
                        .metadata
                        .get("participant")
                        .and_then(|v| v.as_str())
                        .map(|s| serde_json::Value::String(s.to_string()))
                        .unwrap_or(serde_json::Value::Null);
                    let _ = ss
                        .record_message(
                            &session_id,
                            &s.id,
                            "whatsapp-baileys",
                            "user",
                            &user_text,
                            Some(&serde_json::json!({
                                "jid": jid,
                                "message_id": message_id,
                                "from_me": from_me,
                                "participant": participant,
                            })),
                        )
                        .await;
                }
                sender.map(|s| s.id)
            } else {
                None
            };

            let Some(provider) = provider else {
                let out = OutgoingMessage {
                    channel: "whatsapp-baileys".to_string(),
                    recipient: jid.clone(),
                    text: "No provider configured.".to_string(),
                    metadata: serde_json::json!({ "jid": jid }),
                };
                let _ = ch_clone.send(out).await;
                return;
            };

            let Some(ss) = session_store_clone else {
                let out = OutgoingMessage {
                    channel: "whatsapp-baileys".to_string(),
                    recipient: jid.clone(),
                    text: "No session store configured.".to_string(),
                    metadata: serde_json::json!({ "jid": jid }),
                };
                let _ = ch_clone.send(out).await;
                return;
            };

            // Register persistent gateway so streamed responses reach this JID.
            let gw: Arc<dyn SessionGateway> =
                Arc::new(WhatsappBaileysGateway::new(ch_clone.clone(), jid.clone()));
            gm.register_persistent(&session_id, gw.clone()).await;

            // Bind the persistent gateway to the session bus and make sure
            // the dispatcher is live, so streamed events reach WhatsApp.
            let sender = sr.get_or_create(&session_id).await;
            gm.activate_persistent(&session_id, &sender).await;
            gm.ensure_dispatcher(&session_id, &sender).await;

            let wa_tools: Vec<Arc<dyn aeqi_core::traits::Tool>> = vec![
                Arc::new(WhatsAppReplyTool {
                    channel: ch_clone.clone(),
                }),
                Arc::new(WhatsAppReactTool {
                    channel: ch_clone.clone(),
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
                    extra_tools: wa_tools,
                });

            // The `record_message` call above already wrote the inbound
            // user-message row with WhatsApp-specific metadata (jid,
            // message_id, from_me, participant). Flag it so spawn_session
            // skips its own user-message write and we don't duplicate the
            // row in the transcript.
            let queued = aeqi_orchestrator::queue_executor::QueuedMessage::chat(
                aid.clone(),
                user_text.clone(),
                user_sender_id.clone(),
                Some("whatsapp-baileys".to_string()),
            )
            .with_initial_message_recorded();
            let payload = queued
                .to_payload()
                .expect("QueuedMessage serialization is infallible");

            if let Err(e) =
                aeqi_orchestrator::session_queue::enqueue(ss, executor, &session_id, &payload).await
            {
                warn!(error = %e, session_id = %session_id, "whatsapp-baileys: failed to enqueue message");
                let out = OutgoingMessage {
                    channel: "whatsapp-baileys".to_string(),
                    recipient: jid.clone(),
                    text: format!("Error: {}", e),
                    metadata: serde_json::json!({ "jid": jid }),
                };
                let _ = ch_clone.send(out).await;
            }
        });
    }
}
