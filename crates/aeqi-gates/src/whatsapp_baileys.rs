//! WhatsApp channel backed by the Baileys Node bridge.
//!
//! Unlike the Twilio WhatsApp channel (REST + webhook, centrally hosted),
//! this runs a user-owned WhatsApp Web client as a side process. Pairing
//! is done by scanning a QR code; the Noise-XX handshake and Signal-style
//! E2E cryptography all live in the Node `Baileys` library.
//!
//! The Rust side is a thin adapter: it spawns the bridge, subscribes to
//! `message_in` events, and translates `send` calls into `send_text`
//! bridge methods. Connection status and current QR code are held in a
//! shared `Arc<RwLock<_>>` so the HTTP layer can expose them for pairing.
//!
//! Auth state persists at `session_dir` (created if missing). A logout
//! wipes the directory.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

use aeqi_core::traits::{
    Channel, CompletedResponse, DeliveryMode, IncomingMessage, OutgoingMessage, SessionGateway,
};
use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{RwLock, mpsc};
use tracing::{debug, error, info, warn};

use crate::bridge::{BridgeClient, BridgeEvent};

/// Coarse-grained connection state reported to the UI for pairing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BaileysState {
    Spawning,
    Connecting,
    AwaitingQr,
    Ready,
    Disconnected,
}

/// Live snapshot the HTTP layer polls during the pairing flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaileysStatus {
    pub state: BaileysState,
    /// Raw QR payload (Baileys ref string) — present while pairing.
    pub qr: Option<String>,
    /// PNG data URL encoding the QR code — convenient for `<img src>`.
    pub qr_data_url: Option<String>,
    /// Last human-readable disconnect reason, if any.
    pub last_reason: Option<String>,
    /// Our own JID once paired.
    pub me: Option<String>,
}

impl Default for BaileysStatus {
    fn default() -> Self {
        Self {
            state: BaileysState::Spawning,
            qr: None,
            qr_data_url: None,
            last_reason: None,
            me: None,
        }
    }
}

/// Handle to the channel's live status — clone-friendly for HTTP handlers.
pub type StatusHandle = Arc<RwLock<BaileysStatus>>;

/// Process-wide registry of live Baileys channels keyed by `channel_id`.
///
/// Populated by the CLI spawner, queried by the IPC layer. Holding the
/// channel Arc keeps its forwarder task alive even if the spawner task
/// returns. `logout()` both wipes disk state and evicts from the map.
type BaileysRegistry = RwLock<HashMap<String, RegisteredBaileys>>;

/// A registered channel: status handle for cheap polling + full channel
/// handle for control plane (logout, restart, …).
#[derive(Clone)]
struct RegisteredBaileys {
    status: StatusHandle,
    channel: Arc<WhatsAppBaileysChannel>,
}

static REGISTRY: OnceLock<BaileysRegistry> = OnceLock::new();

fn registry() -> &'static BaileysRegistry {
    REGISTRY.get_or_init(|| RwLock::new(HashMap::new()))
}

/// Register a live channel under `channel_id`. Overwrites any previous
/// entry (e.g., after a reconnect spawn).
pub async fn register(channel_id: impl Into<String>, channel: Arc<WhatsAppBaileysChannel>) {
    let status = channel.status_handle();
    registry()
        .write()
        .await
        .insert(channel_id.into(), RegisteredBaileys { status, channel });
}

/// Look up a status handle for the pairing modal to poll.
pub async fn lookup_status(channel_id: &str) -> Option<StatusHandle> {
    registry()
        .read()
        .await
        .get(channel_id)
        .map(|r| r.status.clone())
}

/// Logout the channel (wipe creds + disconnect) and evict from the map.
pub async fn logout_channel(channel_id: &str) -> Result<bool> {
    let removed = registry().write().await.remove(channel_id);
    match removed {
        Some(r) => {
            r.channel.logout().await?;
            Ok(true)
        }
        None => Ok(false),
    }
}

pub struct WhatsAppBaileysChannel {
    bridge: BridgeClient,
    status: StatusHandle,
    incoming_rx: std::sync::Mutex<Option<mpsc::Receiver<IncomingMessage>>>,
    // Held so the forwarding task lives until drop.
    _forwarder: tokio::task::JoinHandle<()>,
}

impl WhatsAppBaileysChannel {
    /// Spawn the bridge and begin receiving events. `bridge_script` is
    /// typically `<repo>/bridges/baileys/src/bridge.mjs`; `session_dir`
    /// is per-channel (e.g. `~/.aeqi/platforms/whatsapp-baileys/<id>/`).
    pub async fn connect(
        bridge_script: PathBuf,
        session_dir: PathBuf,
        allowed_jids: Vec<String>,
    ) -> Result<Self> {
        let script_str = bridge_script
            .to_str()
            .context("bridge script path is not valid UTF-8")?
            .to_string();
        let session_str = session_dir
            .to_str()
            .context("session dir path is not valid UTF-8")?
            .to_string();

        let bridge =
            BridgeClient::spawn("whatsapp-baileys", "node", &[script_str.as_str()]).await?;

        let status: StatusHandle = Arc::new(RwLock::new(BaileysStatus::default()));
        let (tx, rx) = mpsc::channel::<IncomingMessage>(256);

        // Forward bridge events → status updates + incoming messages.
        let status_clone = status.clone();
        let mut events = bridge.subscribe();
        let forwarder = tokio::spawn(async move {
            while let Ok(ev) = events.recv().await {
                if let Err(e) = handle_bridge_event(&ev, &status_clone, &tx, &allowed_jids).await {
                    warn!(error = %e, event = %ev.event, "baileys forwarder error");
                }
            }
            debug!("baileys event forwarder exiting");
        });

        // Ask the bridge to open its socket. This returns quickly; actual
        // connection state arrives via events.
        bridge
            .call("start", json!({ "session_dir": session_str }))
            .await
            .context("bridge start() failed")?;

        info!(session_dir = %session_str, "whatsapp-baileys channel connecting");

        Ok(Self {
            bridge,
            status,
            incoming_rx: std::sync::Mutex::new(Some(rx)),
            _forwarder: forwarder,
        })
    }

    /// Snapshot of the current connection state. UI polls this during
    /// pairing to display the QR and detect the transition to ready.
    pub fn status_handle(&self) -> StatusHandle {
        self.status.clone()
    }

    /// Wipe credentials and disconnect. The user will need to re-scan.
    pub async fn logout(&self) -> Result<()> {
        self.bridge.call("logout", serde_json::Value::Null).await?;
        let mut s = self.status.write().await;
        s.state = BaileysState::Disconnected;
        s.qr = None;
        s.qr_data_url = None;
        s.me = None;
        s.last_reason = Some("logged_out".into());
        Ok(())
    }
}

async fn handle_bridge_event(
    ev: &BridgeEvent,
    status: &StatusHandle,
    tx: &mpsc::Sender<IncomingMessage>,
    allowed_jids: &[String],
) -> Result<()> {
    match ev.event.as_str() {
        "ready_bridge" => {
            // Bridge boot — not WA connection.
            Ok(())
        }
        "connecting" => {
            let mut s = status.write().await;
            s.state = BaileysState::Connecting;
            Ok(())
        }
        "qr" => {
            let qr = ev
                .data
                .get("qr")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let data_url = ev
                .data
                .get("data_url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut s = status.write().await;
            s.state = BaileysState::AwaitingQr;
            s.qr = qr;
            s.qr_data_url = data_url;
            Ok(())
        }
        "ready" => {
            let me = ev
                .data
                .get("jid")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut s = status.write().await;
            s.state = BaileysState::Ready;
            s.qr = None;
            s.qr_data_url = None;
            s.me = me.clone();
            s.last_reason = None;
            drop(s);
            info!(me = ?me, "whatsapp-baileys channel ready");
            Ok(())
        }
        "disconnected" => {
            let reason = ev
                .data
                .get("reason")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let mut s = status.write().await;
            s.state = BaileysState::Disconnected;
            s.last_reason = reason.clone();
            drop(s);
            warn!(reason = ?reason, "whatsapp-baileys disconnected");
            Ok(())
        }
        "message_in" => {
            let jid = ev
                .data
                .get("jid")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow!("message_in missing jid"))?;
            let text = ev
                .data
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // Own-echo filtering lives in the Node bridge now: it tracks
            // ids it sent via `send_text` and drops just those. We still
            // defensively reject self-authored messages unless they belong
            // to the paired account's actual chat-with-yourself thread.
            let paired_jid = {
                let s = status.read().await;
                s.me.clone()
            };
            if !should_forward_message_in(&ev.data, paired_jid.as_deref()) {
                debug!(
                    jid,
                    paired_jid = ?paired_jid,
                    "dropping self-authored non-self-chat message"
                );
                return Ok(());
            }

            if !allowed_jids.is_empty() && !allowed_jids.iter().any(|j| j == jid) {
                debug!(jid, "dropping message from non-allowed jid");
                return Ok(());
            }

            let msg = IncomingMessage {
                channel: "whatsapp-baileys".to_string(),
                sender: jid.to_string(),
                text,
                metadata: ev.data.clone(),
            };
            if tx.send(msg).await.is_err() {
                warn!("baileys incoming receiver dropped; stopping forward");
                return Err(anyhow!("receiver closed"));
            }
            Ok(())
        }
        other => {
            debug!(event = other, "unhandled baileys bridge event");
            Ok(())
        }
    }
}

fn should_forward_message_in(data: &serde_json::Value, paired_jid: Option<&str>) -> bool {
    let from_me = data
        .get("from_me")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    !from_me || is_self_chat_message(data, paired_jid)
}

fn is_self_chat_message(data: &serde_json::Value, paired_jid: Option<&str>) -> bool {
    if let Some(self_chat) = data.get("self_chat").and_then(|v| v.as_bool()) {
        return self_chat;
    }

    let jid = data.get("jid").and_then(|v| v.as_str());
    matches!(
        (jid, paired_jid),
        (Some(chat_jid), Some(me_jid)) if same_whatsapp_account(chat_jid, me_jid)
    )
}

fn same_whatsapp_account(left: &str, right: &str) -> bool {
    matches!(
        (whatsapp_account_user(left), whatsapp_account_user(right)),
        (Some(left_user), Some(right_user)) if left_user == right_user
    )
}

fn whatsapp_account_user(jid: &str) -> Option<&str> {
    let (user, _) = jid.split_once('@')?;
    let user = user.split(':').next().unwrap_or(user);
    (!user.is_empty()).then_some(user)
}

/// Normalize a user-supplied recipient into a WhatsApp JID.
///
/// Accepts bare international numbers (`+15551234567`, `15551234567`), JIDs
/// (`...@s.whatsapp.net`, `...@g.us`), or `whatsapp:+15551234567`
/// (Twilio-style) and emits a canonical JID Baileys understands.
fn normalize_jid(recipient: &str) -> Result<String> {
    let trimmed = recipient.trim();
    if trimmed.contains('@') {
        return Ok(trimmed.to_string());
    }
    let digits: String = trimmed
        .trim_start_matches("whatsapp:")
        .trim_start_matches('+')
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return Err(anyhow!("cannot derive JID from recipient `{}`", recipient));
    }
    Ok(format!("{}@s.whatsapp.net", digits))
}

#[async_trait]
impl Channel for WhatsAppBaileysChannel {
    async fn start(&self) -> Result<mpsc::Receiver<IncomingMessage>> {
        self.incoming_rx
            .lock()
            .map_err(|_| anyhow!("lock poisoned"))?
            .take()
            .ok_or_else(|| anyhow!("whatsapp-baileys channel already started (receiver taken)"))
    }

    async fn send(&self, message: OutgoingMessage) -> Result<()> {
        let jid = normalize_jid(&message.recipient)?;
        debug!(jid = %jid, "whatsapp-baileys sending text");
        let resp = self
            .bridge
            .call("send_text", json!({ "jid": jid, "text": message.text }))
            .await;
        match resp {
            Ok(_) => Ok(()),
            Err(e) => {
                error!(error = %e, "whatsapp-baileys send failed");
                Err(e)
            }
        }
    }

    fn name(&self) -> &str {
        "whatsapp-baileys"
    }

    async fn stop(&self) -> Result<()> {
        // Fire-and-forget shutdown; child exits on its own.
        let _ = self
            .bridge
            .notify("shutdown", serde_json::Value::Null)
            .await;
        Ok(())
    }
}

/// Per-(session, jid) gateway that delivers assembled responses back to
/// a specific WhatsApp conversation. Registered persistently so
/// web-originated responses in a session bound to this JID also land on
/// WhatsApp.
pub struct WhatsappBaileysGateway {
    channel: Arc<WhatsAppBaileysChannel>,
    jid: String,
    id: String,
}

impl WhatsappBaileysGateway {
    pub fn new(channel: Arc<WhatsAppBaileysChannel>, jid: impl Into<String>) -> Self {
        let jid = jid.into();
        let id = format!("whatsapp-baileys:{}", jid);
        Self { channel, jid, id }
    }
}

#[async_trait]
impl SessionGateway for WhatsappBaileysGateway {
    fn gateway_type(&self) -> &str {
        "whatsapp-baileys"
    }

    fn delivery_mode(&self) -> DeliveryMode {
        DeliveryMode::Batched
    }

    async fn deliver_response(
        &self,
        _session_id: &str,
        response: &CompletedResponse,
    ) -> anyhow::Result<()> {
        if response.text.trim().is_empty() {
            return Ok(());
        }
        let out = OutgoingMessage {
            channel: "whatsapp-baileys".to_string(),
            recipient: self.jid.clone(),
            text: response.text.clone(),
            metadata: json!({ "jid": self.jid }),
        };
        self.channel.send(out).await
    }

    fn gateway_id(&self) -> &str {
        &self.id
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_jid_accepts_bare_number() {
        assert_eq!(
            normalize_jid("+15551234567").unwrap(),
            "15551234567@s.whatsapp.net"
        );
    }

    #[test]
    fn normalize_jid_accepts_unprefixed_number() {
        assert_eq!(
            normalize_jid("15551234567").unwrap(),
            "15551234567@s.whatsapp.net"
        );
    }

    #[test]
    fn normalize_jid_passes_through_existing_jid() {
        assert_eq!(
            normalize_jid("12025551234@s.whatsapp.net").unwrap(),
            "12025551234@s.whatsapp.net"
        );
        assert_eq!(
            normalize_jid("1234567890-1234@g.us").unwrap(),
            "1234567890-1234@g.us"
        );
    }

    #[test]
    fn normalize_jid_strips_twilio_prefix() {
        assert_eq!(
            normalize_jid("whatsapp:+15551234567").unwrap(),
            "15551234567@s.whatsapp.net"
        );
    }

    #[test]
    fn normalize_jid_rejects_empty() {
        assert!(normalize_jid("").is_err());
        assert!(normalize_jid("   ").is_err());
    }

    #[test]
    fn same_whatsapp_account_ignores_device_suffix() {
        assert!(same_whatsapp_account(
            "15551234567@s.whatsapp.net",
            "15551234567:12@s.whatsapp.net"
        ));
    }

    #[test]
    fn same_whatsapp_account_rejects_different_users() {
        assert!(!same_whatsapp_account(
            "15551234567@s.whatsapp.net",
            "15557654321@s.whatsapp.net"
        ));
    }

    #[test]
    fn should_forward_non_self_message() {
        let data = json!({
            "jid": "15557654321@s.whatsapp.net",
            "from_me": false,
        });
        assert!(should_forward_message_in(
            &data,
            Some("15551234567@s.whatsapp.net")
        ));
    }

    #[test]
    fn should_forward_self_chat_from_me_message() {
        let data = json!({
            "jid": "15551234567@s.whatsapp.net",
            "from_me": true,
        });
        assert!(should_forward_message_in(
            &data,
            Some("15551234567:8@s.whatsapp.net")
        ));
    }

    #[test]
    fn should_drop_from_me_message_to_other_chat() {
        let data = json!({
            "jid": "15557654321@s.whatsapp.net",
            "from_me": true,
        });
        assert!(!should_forward_message_in(
            &data,
            Some("15551234567@s.whatsapp.net")
        ));
    }

    #[test]
    fn should_honor_explicit_self_chat_flag() {
        let data = json!({
            "jid": "15557654321@s.whatsapp.net",
            "from_me": true,
            "self_chat": true,
        });
        assert!(should_forward_message_in(&data, None));
    }
}
