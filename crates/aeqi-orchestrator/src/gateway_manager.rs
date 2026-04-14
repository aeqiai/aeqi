use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{info, warn};

use aeqi_core::chat_stream::ChatStreamSender;
use aeqi_core::traits::{CompletedResponse, DeliveryMode, SessionGateway};
use aeqi_core::ChatStreamEvent;

/// Manages output gateways for sessions.
/// Each session can have multiple gateways. The dispatcher fans out
/// agent responses to all registered gateways.
pub struct GatewayManager {
    /// Per-session registered gateways.
    registrations: Mutex<HashMap<String, Vec<Arc<dyn SessionGateway>>>>,
    /// Active dispatcher tasks per session.
    dispatchers: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

impl GatewayManager {
    pub fn new() -> Self {
        Self {
            registrations: Mutex::new(HashMap::new()),
            dispatchers: Mutex::new(HashMap::new()),
        }
    }

    /// Register a gateway for a session. Starts the dispatcher if not already running.
    pub async fn register(
        &self,
        session_id: &str,
        gateway: Arc<dyn SessionGateway>,
        stream_sender: &ChatStreamSender,
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
        let gateways = Arc::new(Mutex::new(entry.clone()));
        drop(regs);

        // Ensure dispatcher is running for this session
        let mut dispatchers = self.dispatchers.lock().await;
        if !dispatchers.contains_key(session_id) {
            let rx = stream_sender.subscribe();
            let sid = session_id.to_string();
            let gw_clone = gateways.clone();
            let handle = tokio::spawn(async move {
                dispatch_loop(sid, rx, gw_clone).await;
            });
            dispatchers.insert(session_id.to_string(), handle);
        }

        info!(session_id = %session_id, gateway_id = %gw_id, gateway_type = %gw_type, "gateway registered");
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
