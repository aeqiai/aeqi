use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use aeqi_core::ChatStreamEvent;
use aeqi_core::chat_stream::ChatStreamSender;
use aeqi_core::traits::{CompletedResponse, DeliveryMode, SessionGateway};

use crate::session_store::SessionStore;

/// Manages output gateways for sessions.
/// Each session can have multiple gateways. The dispatcher fans out
/// agent responses to all registered gateways. For gateway-originated
/// sessions (e.g. Telegram), the dispatcher also persists the
/// assistant response on Complete. For IPC-originated sessions (web UI),
/// the daemon IPC handler records per-step and calls `ensure_dispatcher`
/// for gateway fan-out only — that path explicitly skips DB writes to
/// avoid duplicates.
pub struct GatewayManager {
    /// Per-session registered gateways.
    registrations: Mutex<HashMap<String, Vec<Arc<dyn SessionGateway>>>>,
    /// Active dispatcher tasks per session.
    dispatchers: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    /// Session store for recording messages.
    session_store: Option<Arc<SessionStore>>,
    /// Persistent gateways: auto-registered when a session starts streaming.
    /// Keyed by session_id. These survive across session restarts.
    persistent: Mutex<HashMap<String, Vec<Arc<dyn SessionGateway>>>>,
}

impl Default for GatewayManager {
    fn default() -> Self {
        Self::new()
    }
}

impl GatewayManager {
    pub fn new() -> Self {
        Self {
            registrations: Mutex::new(HashMap::new()),
            dispatchers: Mutex::new(HashMap::new()),
            session_store: None,
            persistent: Mutex::new(HashMap::new()),
        }
    }

    pub fn with_session_store(mut self, ss: Arc<SessionStore>) -> Self {
        self.session_store = Some(ss);
        self
    }

    /// Pre-subscribe to a stream sender BEFORE spawning a session.
    /// This avoids the race condition where events are emitted before the gateway registers.
    pub fn pre_subscribe(
        &self,
        stream_sender: &ChatStreamSender,
    ) -> tokio::sync::broadcast::Receiver<ChatStreamEvent> {
        stream_sender.subscribe()
    }

    /// Register a persistent gateway for a session. It will be auto-registered
    /// whenever the session's dispatcher starts (including from the web path).
    pub async fn register_persistent(&self, session_id: &str, gateway: Arc<dyn SessionGateway>) {
        let gw_id = gateway.gateway_id().to_string();
        let mut persistent = self.persistent.lock().await;
        let entry = persistent.entry(session_id.to_string()).or_default();
        if !entry.iter().any(|g| g.gateway_id() == gw_id) {
            entry.push(gateway);
            info!(session_id = %session_id, gateway_id = %gw_id, "persistent gateway stored");
        }
    }

    /// Activate persistent gateways for a session using the given stream sender.
    /// Call this when a session starts from a non-gateway source (e.g. web UI)
    /// to ensure responses also deliver to persistent channels (e.g. Telegram).
    pub async fn activate_persistent(&self, session_id: &str, stream_sender: &ChatStreamSender) {
        let persistent = self.persistent.lock().await;
        let Some(pgws) = persistent.get(session_id) else {
            return;
        };
        let gws: Vec<Arc<dyn SessionGateway>> = pgws.clone();
        drop(persistent);

        for gw in gws {
            let rx = stream_sender.subscribe();
            self.register_with_rx(session_id, gw, rx).await;
        }
    }

    /// Register a gateway for a session. Starts the dispatcher if not already running.
    /// Pass a pre-subscribed receiver to avoid missing early events.
    pub async fn register(
        &self,
        session_id: &str,
        gateway: Arc<dyn SessionGateway>,
        stream_sender: &ChatStreamSender,
    ) {
        self.register_with_rx(session_id, gateway, stream_sender.subscribe())
            .await;
    }

    /// Register a gateway with a pre-created broadcast receiver.
    /// Use this when you subscribed before spawning to avoid race conditions.
    pub async fn register_with_rx(
        &self,
        session_id: &str,
        gateway: Arc<dyn SessionGateway>,
        rx: tokio::sync::broadcast::Receiver<ChatStreamEvent>,
    ) {
        let gw_id = gateway.gateway_id().to_string();
        let gw_type = gateway.gateway_type().to_string();

        let mut regs = self.registrations.lock().await;
        let entry = regs.entry(session_id.to_string()).or_default();

        // Deduplicate by gateway_id
        if entry.iter().any(|g| g.gateway_id() == gw_id) {
            return;
        }

        entry.push(gateway);

        // Also pull in any persistent gateways for this session.
        {
            let persistent = self.persistent.lock().await;
            if let Some(pgws) = persistent.get(session_id) {
                for pgw in pgws {
                    if !entry.iter().any(|g| g.gateway_id() == pgw.gateway_id()) {
                        entry.push(pgw.clone());
                        info!(session_id = %session_id, gateway_id = %pgw.gateway_id(), "persistent gateway activated");
                    }
                }
            }
        }

        let gateways = Arc::new(Mutex::new(entry.clone()));
        drop(regs);

        // Ensure dispatcher is running for this session
        let mut dispatchers = self.dispatchers.lock().await;
        if !dispatchers.contains_key(session_id) {
            let sid = session_id.to_string();
            let gw_clone = gateways.clone();
            let ss = self.session_store.clone();
            let handle = tokio::spawn(async move {
                dispatch_loop(sid, rx, gw_clone, ss).await;
            });
            dispatchers.insert(session_id.to_string(), handle);
        }

        info!(session_id = %session_id, gateway_id = %gw_id, gateway_type = %gw_type, "gateway registered");
    }

    /// Ensure a dispatcher is running for a session (fan-out only).
    /// Does NOT register a gateway and does NOT record to the session store —
    /// the caller (daemon IPC handler) is the authoritative recorder and
    /// persists per-step with sender identity. This path only ensures gateway
    /// fan-out survives a WebSocket disconnect.
    pub async fn ensure_dispatcher(&self, session_id: &str, stream_sender: &ChatStreamSender) {
        let mut dispatchers = self.dispatchers.lock().await;
        if dispatchers.contains_key(session_id) {
            return;
        }

        let regs = self.registrations.lock().await;
        let gateways = Arc::new(Mutex::new(
            regs.get(session_id).cloned().unwrap_or_default(),
        ));
        drop(regs);

        let rx = stream_sender.subscribe();
        let sid = session_id.to_string();
        let handle = tokio::spawn(async move {
            dispatch_loop(sid, rx, gateways, None).await;
        });
        dispatchers.insert(session_id.to_string(), handle);
    }

    /// Unregister a gateway from a session.
    pub async fn unregister(&self, session_id: &str, gateway_id: &str) {
        let mut regs = self.registrations.lock().await;
        if let Some(entry) = regs.get_mut(session_id) {
            entry.retain(|g| g.gateway_id() != gateway_id);
        }
    }

    /// List gateways for a session.
    pub async fn list_gateways(&self, session_id: &str) -> Vec<String> {
        let regs = self.registrations.lock().await;
        regs.get(session_id)
            .map(|v| v.iter().map(|g| g.gateway_id().to_string()).collect())
            .unwrap_or_default()
    }
}

async fn dispatch_loop(
    session_id: String,
    mut rx: tokio::sync::broadcast::Receiver<ChatStreamEvent>,
    gateways: Arc<Mutex<Vec<Arc<dyn SessionGateway>>>>,
    session_store: Option<Arc<SessionStore>>,
) {
    let mut accumulated_text = String::new();

    loop {
        match rx.recv().await {
            Ok(event) => {
                let gates = gateways.lock().await;

                // Fan out to streaming gateways immediately
                for gw in gates
                    .iter()
                    .filter(|g| g.is_alive() && g.delivery_mode() == DeliveryMode::Streaming)
                {
                    let gw = gw.clone();
                    let event = event.clone();
                    let sid = session_id.clone();
                    tokio::spawn(async move {
                        if let Err(e) = gw.deliver_event(&sid, &event).await {
                            warn!(gateway = gw.gateway_id(), error = %e, "streaming delivery failed");
                        }
                    });
                }

                // Accumulate for batched gateways
                match &event {
                    ChatStreamEvent::TextDelta { text } => {
                        accumulated_text.push_str(text);
                    }
                    ChatStreamEvent::Complete {
                        total_prompt_tokens,
                        total_completion_tokens,
                        iterations,
                        cost_usd,
                        ..
                    } => {
                        if !accumulated_text.is_empty() {
                            // Record the assistant response ONCE before delivering to gateways.
                            if let Some(ref ss) = session_store {
                                let _ = ss
                                    .record_event_by_session(
                                        &session_id,
                                        "message",
                                        "assistant",
                                        &accumulated_text,
                                        Some("agent"),
                                        None,
                                    )
                                    .await;
                            }

                            let response = CompletedResponse {
                                text: accumulated_text.clone(),
                                iterations: *iterations,
                                prompt_tokens: *total_prompt_tokens,
                                completion_tokens: *total_completion_tokens,
                                cost_usd: *cost_usd,
                            };

                            for gw in gates.iter().filter(|g| {
                                g.is_alive() && g.delivery_mode() == DeliveryMode::Batched
                            }) {
                                let gw = gw.clone();
                                let resp = response.clone();
                                let sid = session_id.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = gw.deliver_response(&sid, &resp).await {
                                        warn!(gateway = gw.gateway_id(), error = %e, "batched delivery failed");
                                    }
                                });
                            }
                        }
                        accumulated_text.clear();
                    }
                    _ => {}
                }

                // Prune dead gateways
                drop(gates);
                let mut gates = gateways.lock().await;
                gates.retain(|g| g.is_alive());
            }
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                warn!(session_id = %session_id, lagged = n, "gateway dispatcher lagged");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}
