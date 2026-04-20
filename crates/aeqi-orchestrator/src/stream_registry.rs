//! Per-session `ChatStreamSender` registry — the pubsub bus that glues
//! short-lived executors to long-lived WebSocket subscribers.
//!
//! Model: a session has no in-memory presence. But while a WS client is
//! watching a session (or while an execution is running), we need a
//! durable fan-out point. That's this registry: one
//! [`ChatStreamSender`] per `session_id`, lazily created on first
//! subscribe-or-publish, kept in memory as long as there are subscribers
//! or recent writes. Subscribers call [`StreamRegistry::get_or_create`]
//! and `.subscribe()` on the returned sender. Executors do the same and
//! publish events with `.send()`.
//!
//! Cleanup is deliberately lazy: broadcast channels with zero subscribers
//! cost ~one `Arc` + a small buffer. Call [`StreamRegistry::reap_idle`]
//! from a periodic tick if you want to trim, or just leave it alone.

use std::collections::HashMap;
use std::sync::Arc;

use aeqi_core::chat_stream::ChatStreamSender;
use tokio::sync::Mutex;

const DEFAULT_CAPACITY: usize = 1024;

/// Thread-safe map from `session_id` to its broadcast sender.
#[derive(Default)]
pub struct StreamRegistry {
    inner: Mutex<HashMap<String, ChatStreamSender>>,
}

impl StreamRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Return the sender for `session_id`, creating one if absent.
    /// Cheap to call from both executor (publisher) and WS client
    /// (subscriber) paths — whoever arrives first creates the entry.
    pub async fn get_or_create(self: &Arc<Self>, session_id: &str) -> ChatStreamSender {
        let mut map = self.inner.lock().await;
        if let Some(sender) = map.get(session_id) {
            return sender.clone();
        }
        let (sender, _rx_seed) = ChatStreamSender::new(DEFAULT_CAPACITY);
        map.insert(session_id.to_string(), sender.clone());
        sender
    }

    /// Return the sender for `session_id` if one exists. Publishers
    /// should usually prefer [`Self::get_or_create`] — this is for
    /// callers that explicitly want to no-op when there's no active
    /// bus (e.g. server-side probes).
    pub async fn get(&self, session_id: &str) -> Option<ChatStreamSender> {
        self.inner.lock().await.get(session_id).cloned()
    }

    /// Remove senders with zero subscribers. Safe to call from a
    /// periodic tick; not required for correctness.
    pub async fn reap_idle(&self) -> usize {
        let mut map = self.inner.lock().await;
        let before = map.len();
        map.retain(|_id, sender| sender.subscriber_count() > 0);
        before - map.len()
    }
}
