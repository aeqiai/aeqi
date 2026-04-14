use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Delivery mode — how a gateway wants to receive response events.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryMode {
    /// Receive each ChatStreamEvent as it arrives (WebSocket, SSE).
    Streaming,
    /// Receive the accumulated full response text after Complete (Telegram, webhook).
    Batched,
}

/// A completed response, assembled from stream events.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletedResponse {
    pub text: String,
    pub iterations: u32,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub cost_usd: f64,
}

/// Output gateway for a session. Each transport implements this.
#[async_trait]
pub trait SessionGateway: Send + Sync {
    /// Gateway type identifier (e.g., "telegram", "whatsapp", "webhook").
    fn gateway_type(&self) -> &str;

    /// How this gateway wants to receive events.
    fn delivery_mode(&self) -> DeliveryMode;

    /// Deliver a single stream event. Called only for Streaming gateways.
    async fn deliver_event(
        &self,
        session_id: &str,
        event: &crate::ChatStreamEvent,
    ) -> anyhow::Result<()> {
        let _ = (session_id, event);
        Ok(())
    }

    /// Deliver a completed response. Called only for Batched gateways.
    async fn deliver_response(
        &self,
        session_id: &str,
        response: &CompletedResponse,
    ) -> anyhow::Result<()> {
        let _ = (session_id, response);
        Ok(())
    }

    /// Whether this gateway is still alive / connected.
    fn is_alive(&self) -> bool {
        true
    }

    /// Unique identifier for this gateway instance (for deduplication).
    fn gateway_id(&self) -> &str;
}
