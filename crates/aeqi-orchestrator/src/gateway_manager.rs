use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use aeqi_core::ChatStreamEvent;
use aeqi_core::chat_stream::ChatStreamSender;
use aeqi_core::traits::{CompletedResponse, DeliveryMode, SessionGateway};

/// Manages output gateways for sessions. The dispatcher fans out agent
/// responses to every registered gateway; persistence is owned elsewhere
/// (the IPC chat_send handler writes per-iteration rows), so the dispatcher
/// itself is write-only on the network side.
pub struct GatewayManager {
    /// Per-session registered gateways.
    registrations: Mutex<HashMap<String, Vec<Arc<dyn SessionGateway>>>>,
    /// Active dispatcher tasks per session.
    dispatchers: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
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
            persistent: Mutex::new(HashMap::new()),
        }
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
            let handle = tokio::spawn(async move {
                dispatch_loop(sid, rx, gw_clone).await;
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
            dispatch_loop(sid, rx, gateways).await;
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
) {
    // Batched gateways (Telegram, WhatsApp) ship only the final assistant
    // message — not the intermediate "let me check X" monologue the model
    // emits between tool calls. StepComplete marks an iteration boundary;
    // we drop everything accumulated before it so only the last iteration's
    // text reaches the channel at Complete.
    let mut accumulated_text = String::new();
    let mut reset_on_next_delta = false;

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
                        if reset_on_next_delta {
                            accumulated_text.clear();
                            reset_on_next_delta = false;
                        }
                        accumulated_text.push_str(text);
                    }
                    ChatStreamEvent::StepComplete { .. } => {
                        // An iteration just finished. If another TextDelta
                        // arrives, it's the next iteration speaking and we
                        // want to keep only its text. If Complete arrives
                        // first (last iteration, no more tools), the flag
                        // stays set but never triggers — leaving the final
                        // iteration's accumulated text intact.
                        reset_on_next_delta = true;
                    }
                    ChatStreamEvent::Complete {
                        total_prompt_tokens,
                        total_completion_tokens,
                        iterations,
                        cost_usd,
                        ..
                    } => {
                        if !accumulated_text.is_empty() {
                            // Persistence is owned by the IPC chat_send handler
                            // (daemon.rs) which writes per-iteration rows with
                            // `source=web`. Recording here too would duplicate
                            // the final iteration's text under `source=agent`
                            // and make the UI show it twice.
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
                        reset_on_next_delta = false;
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
