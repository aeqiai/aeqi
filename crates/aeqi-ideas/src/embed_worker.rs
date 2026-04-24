//! Async embedding worker.
//!
//! The write path inserts ideas with `embedding_pending = 1` and enqueues
//! an embedding job on [`EmbedQueue`]. A single background task
//! ([`run`]) drains the queue, computes the embedding via the wired
//! [`aeqi_core::traits::Embedder`], and persists via
//! [`aeqi_core::traits::IdeaStore::set_embedding`], which flips the
//! `embedding_pending` flag to `0`.
//!
//! This keeps the caller off the network round-trip. Search stays
//! functional even before the embedding flushes by gating vector
//! candidates on `embedding_pending = 0`; BM25 always serves.
//!
//! Dropped when the queue is full: the sender logs at WARN and the store
//! row stays `embedding_pending = 1`. A future decay-patrol sweep (Agent R)
//! can re-enqueue lingering pending rows if that turns out to matter.

use std::sync::Arc;

use tokio::sync::mpsc;

/// Job payload shuttled across the queue. Kept minimal: the worker
/// re-embeds from `content`, so we don't need to ferry anything else.
pub type EmbedJob = (String /* id */, String /* content */);

/// Handle on the sender side. Cheap to clone (wraps an `mpsc::Sender`).
#[derive(Clone)]
pub struct EmbedQueue {
    tx: mpsc::Sender<EmbedJob>,
}

impl EmbedQueue {
    /// Build an `(EmbedQueue, Receiver)` pair with the given backlog
    /// capacity. The receiver is owned by the worker task spawned via
    /// [`run`].
    pub fn channel(capacity: usize) -> (Self, mpsc::Receiver<EmbedJob>) {
        let (tx, rx) = mpsc::channel(capacity);
        (Self { tx }, rx)
    }

    /// Enqueue an embedding job. Non-blocking: if the queue is full the
    /// job is dropped and logged. The row remains `embedding_pending = 1`
    /// so a later sweep can retry.
    pub fn enqueue(&self, id: String, content: String) {
        if let Err(e) = self.tx.try_send((id.clone(), content)) {
            tracing::warn!(
                id = %id,
                error = %e,
                "embed queue full — dropping job; row stays embedding_pending=1"
            );
        }
    }
}

/// Drain the receiver, embed each job, and persist via the store.
///
/// Long-running: intended to be spawned once at daemon startup via
/// `tokio::spawn`. Exits when the sender side is dropped (every clone
/// goes away), which only happens at daemon shutdown.
pub async fn run(
    mut rx: mpsc::Receiver<EmbedJob>,
    store: Arc<dyn aeqi_core::traits::IdeaStore>,
    embedder: Arc<dyn aeqi_core::traits::Embedder>,
) {
    while let Some((id, content)) = rx.recv().await {
        match embedder.embed(&content).await {
            Ok(vec) => {
                if let Err(e) = store.set_embedding(&id, &vec).await {
                    tracing::warn!(id = %id, error = %e, "set_embedding failed");
                }
            }
            Err(e) => {
                tracing::warn!(id = %id, error = %e, "embedding failed");
            }
        }
    }
}

/// Sink-only drain: consume jobs and throw them away. Used when the
/// daemon starts without a configured embedder so the write path can
/// still `enqueue` without back-pressure deadlocks. Search falls back
/// to BM25 in this mode (the `embedding_pending=1` rows never flush).
pub async fn run_no_op(mut rx: mpsc::Receiver<EmbedJob>) {
    while let Some((id, _content)) = rx.recv().await {
        tracing::debug!(id = %id, "embed_worker (no embedder): dropping job");
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn enqueue_never_blocks_when_queue_full() {
        let (queue, _rx) = EmbedQueue::channel(1);
        // Fill the queue and then try to overflow — enqueue should just
        // log and return, not panic or block.
        queue.enqueue("id-1".to_string(), "c".to_string());
        queue.enqueue("id-2".to_string(), "c".to_string());
        queue.enqueue("id-3".to_string(), "c".to_string());
    }

    #[tokio::test]
    async fn no_op_worker_drains_without_embedder() {
        let (queue, rx) = EmbedQueue::channel(4);
        let handle = tokio::spawn(run_no_op(rx));
        queue.enqueue("a".into(), "content".into());
        queue.enqueue("b".into(), "content".into());
        drop(queue);
        // Worker exits cleanly when the sender drops.
        handle.await.expect("no-op worker joins");
    }
}
