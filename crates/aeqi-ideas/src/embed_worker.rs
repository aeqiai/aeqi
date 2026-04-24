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
//!
//! ## Priority lane
//!
//! The queue carries two channels: `normal` (first-time embeds from
//! `dispatch_create`) and `priority` (re-embeds from `dispatch_merge` et
//! al. — rows that are ALREADY visible but will drop out of vector search
//! until the worker catches up). The worker drains priority first via a
//! biased `tokio::select!`, shrinking the "idea disappears from vector
//! results" window for active ideas that just had their content updated.

use std::sync::Arc;

use tokio::sync::mpsc;

/// Job payload shuttled across the queue. Kept minimal: the worker
/// re-embeds from `content`, so we don't need to ferry anything else.
pub type EmbedJob = (String /* id */, String /* content */);

/// Receiver half — returned by [`EmbedQueue::channel`] and consumed by
/// the worker loop in [`run`] / [`run_no_op`]. Bundles the normal and
/// priority channels so the worker can drain priority first.
pub struct EmbedQueueRx {
    normal: mpsc::Receiver<EmbedJob>,
    priority: mpsc::Receiver<EmbedJob>,
}

/// Handle on the sender side. Cheap to clone (wraps two `mpsc::Sender`s).
#[derive(Clone)]
pub struct EmbedQueue {
    normal: mpsc::Sender<EmbedJob>,
    priority: mpsc::Sender<EmbedJob>,
}

impl EmbedQueue {
    /// Build an `(EmbedQueue, EmbedQueueRx)` pair with the given backlog
    /// capacity (applied to each lane). The rx is owned by the worker
    /// task spawned via [`run`].
    pub fn channel(capacity: usize) -> (Self, EmbedQueueRx) {
        let (ntx, nrx) = mpsc::channel(capacity);
        let (ptx, prx) = mpsc::channel(capacity);
        (
            Self {
                normal: ntx,
                priority: ptx,
            },
            EmbedQueueRx {
                normal: nrx,
                priority: prx,
            },
        )
    }

    /// Enqueue a normal-priority embedding job. Used by `dispatch_create`
    /// — a first-time embed on a freshly-written idea, which isn't
    /// visible to vector search yet anyway (embedding_pending=1). Can
    /// wait behind merges.
    ///
    /// Non-blocking: if the queue is full the job is dropped and logged.
    /// The row remains `embedding_pending = 1` so a later sweep can retry.
    pub fn enqueue(&self, id: String, content: String) {
        if let Err(e) = self.normal.try_send((id.clone(), content)) {
            tracing::warn!(
                id = %id,
                error = %e,
                "embed queue (normal) full — dropping job; row stays embedding_pending=1"
            );
        }
    }

    /// Enqueue a priority embedding job. Used by `dispatch_merge` and any
    /// other path that UPDATES an existing idea's content: the row is
    /// already visible to callers, but `embedding_pending=1` removes it
    /// from vector search until the worker rewrites the vector. Jumping
    /// the queue shrinks that window.
    ///
    /// Non-blocking, same drop-on-full semantics as [`Self::enqueue`].
    pub fn enqueue_priority(&self, id: String, content: String) {
        if let Err(e) = self.priority.try_send((id.clone(), content)) {
            tracing::warn!(
                id = %id,
                error = %e,
                "embed queue (priority) full — dropping job; row stays embedding_pending=1"
            );
        }
    }
}

/// Drain the receiver, embed each job, and persist via the store.
///
/// Long-running: intended to be spawned once at daemon startup via
/// `tokio::spawn`. Exits when both sender sides are dropped (every clone
/// goes away), which only happens at daemon shutdown.
///
/// `biased` on the select ensures the priority channel is checked first
/// on every iteration — re-embeds (dispatch_merge) are served ahead of
/// fresh embeds (dispatch_create) so active ideas don't drop out of
/// vector search for longer than they need to.
pub async fn run(
    mut rx: EmbedQueueRx,
    store: Arc<dyn aeqi_core::traits::IdeaStore>,
    embedder: Arc<dyn aeqi_core::traits::Embedder>,
) {
    loop {
        let job = tokio::select! {
            biased;
            Some(j) = rx.priority.recv() => j,
            Some(j) = rx.normal.recv() => j,
            else => break,
        };
        let (id, content) = job;
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
pub async fn run_no_op(mut rx: EmbedQueueRx) {
    loop {
        let (id, _content) = tokio::select! {
            biased;
            Some(j) = rx.priority.recv() => j,
            Some(j) = rx.normal.recv() => j,
            else => break,
        };
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
    async fn enqueue_priority_never_blocks_when_queue_full() {
        let (queue, _rx) = EmbedQueue::channel(1);
        // Priority lane must share the same drop-on-full semantics as
        // the normal lane so merge dispatch never deadlocks.
        queue.enqueue_priority("id-1".to_string(), "c".to_string());
        queue.enqueue_priority("id-2".to_string(), "c".to_string());
        queue.enqueue_priority("id-3".to_string(), "c".to_string());
    }

    #[tokio::test]
    async fn no_op_worker_drains_without_embedder() {
        let (queue, rx) = EmbedQueue::channel(4);
        let handle = tokio::spawn(run_no_op(rx));
        queue.enqueue("a".into(), "content".into());
        queue.enqueue("b".into(), "content".into());
        queue.enqueue_priority("p".into(), "content".into());
        drop(queue);
        // Worker exits cleanly when both senders drop.
        handle.await.expect("no-op worker joins");
    }

    /// When three normal jobs are queued ahead of one priority job, the
    /// worker must drain the priority job FIRST. Enforces the
    /// dispatch_merge freshness contract: a row that got its content
    /// updated re-embeds ahead of first-time embeds still in the queue.
    ///
    /// Uses a dummy no-op receiver plus direct recv-ordering assertions
    /// so we don't need to stand up a real IdeaStore + Embedder just to
    /// test the biased select.
    #[tokio::test]
    async fn priority_drained_before_normal() {
        let (queue, mut rx) = EmbedQueue::channel(8);

        // Queue three normal jobs, THEN one priority. The priority
        // arrives AFTER the normals on the wire, but the biased select
        // must pick it first on the next iteration.
        queue.enqueue("n1".into(), "normal-1".into());
        queue.enqueue("n2".into(), "normal-2".into());
        queue.enqueue("n3".into(), "normal-3".into());
        queue.enqueue_priority("p1".into(), "priority-1".into());

        // Yield so both channels have their items visibly queued before
        // we try to recv on them.
        tokio::task::yield_now().await;

        // First biased-select iteration: priority wins even though the
        // normal lane has three items waiting.
        let first = tokio::select! {
            biased;
            Some(j) = rx.priority.recv() => j,
            Some(j) = rx.normal.recv() => j,
        };
        assert_eq!(
            first.0, "p1",
            "priority job must drain first; observed: {first:?}"
        );

        // Subsequent iterations drain the normal lane in FIFO order.
        let mut drained = Vec::<String>::new();
        for _ in 0..3 {
            let j = tokio::select! {
                biased;
                Some(j) = rx.priority.recv() => j,
                Some(j) = rx.normal.recv() => j,
            };
            drained.push(j.0);
        }
        assert_eq!(drained, vec!["n1", "n2", "n3"]);
    }
}
